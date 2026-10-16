-- =====================================================================
-- แก้รายได้ / ค่าใช้จ่ายที่บันทึกเอง ด้วยปุ่ม "บันทึก" ปุ่มเดียว
--   update_entry(): แก้ช่องทั่วไป (วันที่ · ยอด · หมวด · ของใคร · หมายเหตุ ฯลฯ) + บัญชีที่รับ / จ่าย + ประเภทรายได้
--   ในคำสั่งเดียว (transaction เดียว) — ช่องไหนผิด ไม่บันทึกเลยสักช่อง
--   การย้ายบัญชีใช้ change_entry_account() เดิม (กติกา / การปรับยอดบัญชี / บัตร / ก้อนรอแยก เหมือนเดิมทุกอย่าง)
--   ไม่มีการเปลี่ยนตารางหรือข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

DROP FUNCTION IF EXISTS public.update_entry(text, uuid, jsonb, text, text);
CREATE FUNCTION public.update_entry(p_kind text, p_id uuid, p_fields jsonb DEFAULT '{}'::jsonb,
  p_account text DEFAULT NULL, p_income_type text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE i public.income_transactions; e public.expense_items; f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_cur text; v_acc text := nullif(trim(coalesce(p_account, '')), ''); v_type text := nullif(trim(coalesce(p_income_type, '')), '');
  v_change boolean; v_n int; v_banks uuid[]; v_dates date[];
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');

  IF p_kind = 'INCOME' THEN
    SELECT * INTO i FROM public.income_transactions WHERE id = p_id AND deleted_at IS NULL;
    IF i.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการ' USING ERRCODE = '22023'; END IF;
    v_cur := CASE WHEN i.received_to_asset_id IS NOT NULL THEN 'a:' || i.received_to_asset_id ELSE '' END;
    v_change := (p_account IS NOT NULL AND coalesce(v_acc, '') <> v_cur) OR (v_type IS NOT NULL AND v_type <> i.income_type);
    v_banks := ARRAY[i.received_to_asset_id]; v_dates := ARRAY[i.date];
    -- 1) บัญชี / ประเภท (ผ่านฟังก์ชันเดิม: ตรวจรายการผูกหน้าอื่น · งวดปิด · สิทธิ์)
    IF v_change THEN
      PERFORM public.change_entry_account('INCOME', i.id, CASE WHEN p_account IS NULL THEN v_cur ELSE coalesce(v_acc, '') END, v_type);
      SELECT * INTO i FROM public.income_transactions WHERE id = p_id;
    END IF;
    -- 2) ช่องทั่วไป
    UPDATE public.income_transactions SET
      date           = CASE WHEN f ? 'date'      THEN (f->>'date')::date ELSE date END,
      amount         = CASE WHEN f ? 'amount'    THEN (f->>'amount')::numeric ELSE amount END,
      tax            = CASE WHEN f ? 'tax'       THEN nullif(f->>'tax', '')::numeric ELSE tax END,
      notes          = CASE WHEN f ? 'notes'     THEN nullif(trim(f->>'notes'), '') ELSE notes END,
      person_id      = CASE WHEN f ? 'person_id' THEN nullif(f->>'person_id', '')::uuid ELSE person_id END,
      income_subtype = CASE WHEN income_type <> 'OTHER' THEN NULL
                            WHEN f ? 'income_subtype' THEN nullif(trim(f->>'income_subtype'), '') ELSE income_subtype END
     WHERE id = i.id AND deleted_at IS NULL
     RETURNING received_to_asset_id, date INTO i.received_to_asset_id, i.date;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_banks := v_banks || i.received_to_asset_id; v_dates := v_dates || i.date;

  ELSIF p_kind = 'EXPENSE' THEN
    SELECT * INTO e FROM public.expense_items WHERE id = p_id AND deleted_at IS NULL;
    IF e.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการ' USING ERRCODE = '22023'; END IF;
    IF v_type IS NOT NULL THEN RAISE EXCEPTION 'INVALID: ค่าใช้จ่ายไม่มีประเภทรายได้' USING ERRCODE = '22023'; END IF;
    v_cur := CASE WHEN e.paid_from_asset_id IS NOT NULL THEN 'a:' || e.paid_from_asset_id
                  WHEN e.paid_from_credit_card_id IS NOT NULL THEN 'c:' || e.paid_from_credit_card_id ELSE '' END;
    v_change := p_account IS NOT NULL AND coalesce(v_acc, '') <> v_cur;
    v_banks := ARRAY[e.paid_from_asset_id]; v_dates := ARRAY[e.date];
    IF v_change THEN
      PERFORM public.change_entry_account('EXPENSE', e.id, coalesce(v_acc, ''), NULL);
    END IF;
    UPDATE public.expense_items SET
      date            = CASE WHEN f ? 'date'             THEN (f->>'date')::date ELSE date END,
      description     = CASE WHEN f ? 'description'      THEN nullif(trim(f->>'description'), '') ELSE description END,
      amount          = CASE WHEN f ? 'amount'           THEN (f->>'amount')::numeric ELSE amount END,
      expense_category = CASE WHEN f ? 'expense_category' THEN nullif(trim(f->>'expense_category'), '') ELSE expense_category END,
      notes           = CASE WHEN f ? 'notes'            THEN nullif(trim(f->>'notes'), '') ELSE notes END,
      person_id       = CASE WHEN f ? 'person_id'        THEN nullif(f->>'person_id', '')::uuid ELSE person_id END,
      expected_reimbursement_amount = CASE WHEN f ? 'expected_reimbursement_amount'
                                           THEN nullif(f->>'expected_reimbursement_amount', '')::numeric
                                           ELSE expected_reimbursement_amount END
     WHERE id = e.id AND deleted_at IS NULL
     RETURNING paid_from_asset_id, date INTO e.paid_from_asset_id, e.date;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_banks := v_banks || e.paid_from_asset_id; v_dates := v_dates || e.date;

  ELSE
    RAISE EXCEPTION 'INVALID: ประเภทรายการไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้รายการนี้ (ผู้บันทึกแก้ได้เฉพาะรายการของตัวเองภายใน 24 ชม.)' USING ERRCODE = '42501';
  END IF;

  -- เตือนถ้าบัญชีเดิม / ใหม่ กระทบยอดเดือนนั้น (เดิม / ใหม่) ไปแล้ว
  RETURN jsonb_build_object('recon_warning', EXISTS (
    SELECT 1 FROM public.bank_reconciliations br
     WHERE br.deleted_at IS NULL AND br.status <> 'OPEN'
       AND br.bank_asset_id = ANY (v_banks)
       AND br.year_month IN (SELECT date_trunc('month', d)::date FROM unnest(v_dates) d)));
END $$;
REVOKE ALL ON FUNCTION public.update_entry(text, uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_entry(text, uuid, jsonb, text, text) TO authenticated;
