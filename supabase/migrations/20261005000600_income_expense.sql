-- =====================================================================
-- Income & Expenses (Core Schema Section 24, 25, 25E)
--   add_expense             : หาเดือน monthly_expenses (สร้างถ้ายังไม่มี) แล้วเพิ่ม expense_items
--   set_expense_month_status: PARTIAL / COMPLETE (ผู้ใช้ยืนยันเอง)
--   record_reimbursement    : เงินคืน · ห้ามเกินยอดที่คาดว่าจะได้คืนที่ยังค้าง
--   SECURITY INVOKER: RLS / Guard / Period Lock ทำงานตามสิทธิ์ผู้เรียก
-- =====================================================================

CREATE OR REPLACE FUNCTION private.expense_month_id(p_date date) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_family uuid; v_id uuid; v_month date := date_trunc('month', p_date)::date;
BEGIN
  SELECT id INTO v_family FROM public.families WHERE deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_id FROM public.monthly_expenses
   WHERE family_id = v_family AND year_month = v_month AND deleted_at IS NULL;
  IF v_id IS NULL THEN
    INSERT INTO public.monthly_expenses(family_id, year_month, tracking_status)
    VALUES (v_family, v_month, 'NOT_TRACKED') RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

-- p: {"date","description","amount","currency","expense_category","paid_from_asset_id","paid_from_credit_card_id",
--     "person_id","related_asset_id","is_reimbursable","expected_reimbursement_amount","notes"}
CREATE OR REPLACE FUNCTION public.add_expense(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_date date := nullif(p->>'date', '')::date; v_id uuid; v_ccy text; v_bank uuid; v_card uuid;
BEGIN
  IF v_date IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่วันที่' USING ERRCODE = '22023'; END IF;
  IF v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่เป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p->>'description', ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่รายละเอียด' USING ERRCODE = '22023';
  END IF;
  v_bank := nullif(p->>'paid_from_asset_id', '')::uuid;
  v_card := nullif(p->>'paid_from_credit_card_id', '')::uuid;
  v_ccy := upper(coalesce(nullif(p->>'currency', ''), 'THB'));
  IF v_bank IS NOT NULL THEN SELECT currency INTO v_ccy FROM public.assets WHERE id = v_bank; END IF;
  IF v_card IS NOT NULL THEN SELECT currency INTO v_ccy FROM public.credit_cards WHERE id = v_card; END IF;

  INSERT INTO public.expense_items(monthly_expense_id, related_asset_id, paid_from_asset_id, paid_from_credit_card_id,
              person_id, date, description, amount, currency, expense_category, is_reimbursable,
              expected_reimbursement_amount, notes)
  VALUES (private.expense_month_id(v_date), nullif(p->>'related_asset_id', '')::uuid, v_bank, v_card,
          CASE WHEN v_bank IS NULL AND v_card IS NULL THEN nullif(p->>'person_id', '')::uuid END,
          v_date, trim(p->>'description'), (p->>'amount')::numeric, v_ccy, nullif(trim(p->>'expense_category'), ''),
          coalesce((p->>'is_reimbursable')::boolean, false),
          CASE WHEN coalesce((p->>'is_reimbursable')::boolean, false)
               THEN coalesce(nullif(p->>'expected_reimbursement_amount', '')::numeric, (p->>'amount')::numeric) END,
          nullif(trim(p->>'notes'), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.set_expense_month_status(p_month date, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF p_status NOT IN ('PARTIAL','COMPLETE') THEN
    RAISE EXCEPTION 'INVALID: สถานะต้องเป็น PARTIAL หรือ COMPLETE' USING ERRCODE = '22023';
  END IF;
  v_id := private.expense_month_id(p_month);
  UPDATE public.monthly_expenses SET tracking_status = p_status WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้สถานะนี้' USING ERRCODE = '42501'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_reimbursement(
  p_expense_item_id uuid, p_received_date date, p_amount numeric,
  p_received_to_asset_id uuid DEFAULT NULL, p_received_to_credit_card_id uuid DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE i public.expense_items; v_got numeric; v_cap numeric; v_id uuid;
BEGIN
  SELECT * INTO i FROM public.expense_items WHERE id = p_expense_item_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบค่าใช้จ่ายนี้' USING ERRCODE = '22023'; END IF;
  IF NOT i.is_reimbursable THEN
    RAISE EXCEPTION 'INVALID: ค่าใช้จ่ายนี้ไม่ได้ตั้งว่าจะได้เงินคืน' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดเงินคืน' USING ERRCODE = '22023'; END IF;
  IF p_received_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่เป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(sum(amount), 0) INTO v_got FROM public.expense_reimbursements
   WHERE expense_item_id = i.id AND deleted_at IS NULL;
  v_cap := coalesce(i.expected_reimbursement_amount, i.amount);
  IF v_got + p_amount > v_cap THEN
    RAISE EXCEPTION 'INVALID: เงินคืนเกินยอดค้างรับ (ค้างอีก % %)', round(v_cap - v_got, 2), i.currency USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.expense_reimbursements(expense_item_id, received_date, amount, currency,
              received_to_asset_id, received_to_credit_card_id, notes)
  VALUES (i.id, p_received_date, p_amount, i.currency, p_received_to_asset_id, p_received_to_credit_card_id,
          nullif(trim(p_notes), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION private.expense_month_id(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.expense_month_id(date) TO authenticated;
REVOKE ALL ON FUNCTION public.add_expense(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_expense(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.set_expense_month_status(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_expense_month_status(date, text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_reimbursement(uuid, date, numeric, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_reimbursement(uuid, date, numeric, uuid, uuid, text) TO authenticated;
