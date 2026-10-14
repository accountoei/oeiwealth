-- =====================================================================
-- แก้บัญชีที่รับ / จ่าย และประเภทรายได้ ของรายการที่บันทึกเองในหน้า Income & Expenses
--   - เฉพาะรายการที่ไม่ผูกกับระบบอื่น (ลงทุน / สัญญาเช่า / เงินให้กู้ / ประกัน / ค่าส่วนกลาง / จ่ายหนี้ / ค่าธรรมเนียมโอน)
--     และไม่ใช่ก้อน "รอแยกรายละเอียด"
--   - งวดที่ปิดแล้วแก้ไม่ได้ (Period Lock) · สิทธิ์ตาม RLS เดิม (CONTRIBUTOR: ของตัวเอง < 24 ชม.)
--   - รายการเงินเข้า / ออก ที่ผูกไว้ย้ายบัญชีตามเอง · ก้อนรอแยกของบัญชี / บัตรเดิมและใหม่ปรับเอง
--   - คืน recon_warning = true ถ้าบัญชีเดิม / ใหม่ กระทบยอดเดือนนั้นแล้ว (ต้องกระทบยอดใหม่)
-- p_account: '' = ไม่ผ่านบัญชี · 'a:<asset_id>' = บัญชีธนาคาร · 'c:<card_id>' = บัตรเครดิต (เฉพาะค่าใช้จ่าย)
-- รันซ้ำได้
-- =====================================================================
DROP FUNCTION IF EXISTS public.change_entry_account(text, uuid, text, text);
CREATE OR REPLACE FUNCTION public.change_entry_account(p_kind text, p_id uuid, p_account text, p_income_type text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE i public.income_transactions; e public.expense_items; v_asset uuid; v_card uuid; v_old uuid; v_date date; v_n int;
  v_acc text := coalesce(trim(p_account), '');
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF v_acc LIKE 'a:%' THEN v_asset := substr(v_acc, 3)::uuid;
  ELSIF v_acc LIKE 'c:%' THEN v_card := substr(v_acc, 3)::uuid;
  ELSIF v_acc <> '' THEN RAISE EXCEPTION 'INVALID: บัญชีไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'INCOME' THEN
    SELECT * INTO i FROM public.income_transactions WHERE id = p_id AND deleted_at IS NULL;
    IF i.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการ' USING ERRCODE = '22023'; END IF;
    IF i.pending_split OR i.source_transaction_id IS NOT NULL OR i.lease_id IS NOT NULL OR i.asset_id IS NOT NULL
       OR i.insurance_schedule_line_id IS NOT NULL OR i.received_to_credit_card_id IS NOT NULL THEN
      RAISE EXCEPTION 'LINKED: รายการนี้ผูกกับหน้าอื่น แก้บัญชี / ประเภทที่หน้าต้นทาง' USING ERRCODE = '22023';
    END IF;
    IF v_card IS NOT NULL THEN RAISE EXCEPTION 'INVALID: รายได้เลือกได้เฉพาะบัญชีธนาคาร' USING ERRCODE = '22023'; END IF;
    IF p_income_type IS NOT NULL AND p_income_type IN ('DIVIDEND','COUPON','RENT') AND p_income_type <> i.income_type THEN
      RAISE EXCEPTION 'INVALID: ปันผล / Coupon / ค่าเช่า บันทึกจากหน้าลงทุน / ทรัพย์สิน' USING ERRCODE = '22023';
    END IF;
    v_old := i.received_to_asset_id; v_date := i.date;
    UPDATE public.income_transactions SET received_to_asset_id = v_asset, income_type = coalesce(nullif(p_income_type, ''), income_type)
     WHERE id = i.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSIF p_kind = 'EXPENSE' THEN
    SELECT * INTO e FROM public.expense_items WHERE id = p_id AND deleted_at IS NULL;
    IF e.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการ' USING ERRCODE = '22023'; END IF;
    IF e.pending_split OR e.source_cash_movement_id IS NOT NULL OR e.liability_id IS NOT NULL OR e.insurance_schedule_line_id IS NOT NULL
       OR e.property_utility_id IS NOT NULL OR e.source_fee_side IS NOT NULL THEN
      RAISE EXCEPTION 'LINKED: รายการนี้ผูกกับหน้าอื่น แก้บัญชีที่หน้าต้นทาง' USING ERRCODE = '22023';
    END IF;
    IF v_card IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.credit_cards WHERE id = v_card AND deleted_at IS NULL AND currency = e.currency) THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: บัตรต้องสกุลเดียวกับรายการ (%)', e.currency USING ERRCODE = '22023';
    END IF;
    v_old := e.paid_from_asset_id; v_date := e.date;
    UPDATE public.expense_items SET paid_from_asset_id = v_asset, paid_from_credit_card_id = v_card WHERE id = e.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'INVALID: ประเภทรายการไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF v_n = 0 THEN RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้รายการนี้' USING ERRCODE = '42501'; END IF;

  RETURN jsonb_build_object('recon_warning', EXISTS (
    SELECT 1 FROM public.bank_reconciliations br
     WHERE br.deleted_at IS NULL AND br.status <> 'OPEN' AND br.year_month = date_trunc('month', v_date)::date
       AND br.bank_asset_id IN (v_old, v_asset)));
END $$;
REVOKE ALL ON FUNCTION public.change_entry_account(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_entry_account(text, uuid, text, text) TO authenticated;
