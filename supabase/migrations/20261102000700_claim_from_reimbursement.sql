-- =====================================================================
-- ประกัน: บันทึกเงินคืนจากประกันแล้วสร้างเคลมให้เอง (ตกลง 2 พ.ย. 2026)
--   ฟอร์ม "บันทึกเงินคืน" ใน Income & Expenses: เลือก "เคลมใหม่ · ความคุ้มครอง …" แทนการสร้างเคลมที่หน้ากรมธรรม์ก่อน
--   record_reimbursement_new_claim(...) — สร้างเคลม (ผูกความคุ้มครอง · วันเกิดเหตุ = วันที่ค่าใช้จ่าย · ยื่นเคลม = วันที่ได้รับ ·
--     ยอดเคลม = ยอดเงินคืน) แล้วบันทึกเงินคืนผูกเคลมนั้นในธุรกรรมเดียว → ยอดได้รับ / สถานะเคลมอัปเดตตามกติกาเดิม (private.refresh_claim)
--   SECURITY INVOKER → RLS / Trigger / สิทธิ์เดิมของ insurance_claims และ expense_reimbursements ใช้ตามปกติ
--   ★ ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

CREATE OR REPLACE FUNCTION public.record_reimbursement_new_claim(
  p_coverage_id uuid, p_expense_item_id uuid, p_received_date date, p_amount numeric,
  p_received_to_asset_id uuid DEFAULT NULL, p_received_to_credit_card_id uuid DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c public.insurance_coverages; i public.expense_items; v_claim uuid;
BEGIN
  SELECT * INTO c FROM public.insurance_coverages WHERE id = p_coverage_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.insurance_policies p WHERE p.id = c.policy_id AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ไม่พบความคุ้มครองที่เลือก' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO i FROM public.expense_items WHERE id = p_expense_item_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบค่าใช้จ่ายนี้' USING ERRCODE = '22023'; END IF;
  IF c.currency <> i.currency THEN
    RAISE EXCEPTION 'INVALID: สกุลเงินของความคุ้มครอง (%) ไม่ตรงกับค่าใช้จ่าย (%)', c.currency, i.currency USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.insurance_claims(policy_id, coverage_id, incident_date, claim_date, claimed_amount, currency, status, notes)
  VALUES (c.policy_id, c.id, i.date, p_received_date, p_amount, i.currency, 'SUBMITTED', left('สร้างจากเงินคืน · ' || i.description, 500))
  RETURNING id INTO v_claim;
  PERFORM public.record_reimbursement(p_expense_item_id, p_received_date, p_amount, p_received_to_asset_id,
                                      p_received_to_credit_card_id, p_notes, v_claim);
  RETURN v_claim;
END $$;
REVOKE ALL ON FUNCTION public.record_reimbursement_new_claim(uuid, uuid, date, numeric, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_reimbursement_new_claim(uuid, uuid, date, numeric, uuid, uuid, text) TO authenticated;
