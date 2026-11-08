-- ประกัน: บันทึกรับเงินเคลม รอบ 8 พ.ย. 2026 (ต่อจาก 20261108100000) · ไม่ลบตาราง / คอลัมน์ · ไม่แก้ข้อมูลเดิม · รันซ้ำได้
-- 1) สถานะเคลมใหม่ SETTLED = "ได้ไม่เต็ม" (ปิดเคลมแล้ว ไม่รอรับส่วนที่เหลือ) · เพิ่มในเงื่อนไขสถานะของ insurance_claims
-- 2) refresh_claim: เคลมที่ได้ไม่เต็มคงสถานะไว้ · ได้ครบยอดเคลมภายหลัง → จ่ายครบ · ยกเลิกเงินที่ผูกหมด → กลับเป็น "ยื่นแล้ว"
-- 3) receive_insurance_claim (ชื่อ / พารามิเตอร์เดิม · เพิ่ม key ใน jsonb) บันทึกรับเงินทั้ง 2 แบบในคำสั่งเดียว
--      kind = 'INCOME' (เดิม · เงินชดเชย / สินไหม = รายได้) หรือ 'REIMB' (เงินคืนค่าใช้จ่ายที่จ่ายไปก่อน · ผ่าน record_reimbursement)
--      ได้น้อยกว่าที่รอรับ + close = true → ปิดเคลมเป็น "ได้ไม่เต็ม" · ไม่ส่ง close = ยังรอรับส่วนที่เหลือ (เหมือนเดิม)
--      ได้มากกว่ายอดเคลม + raise_claim = true (ผู้ใช้ยืนยันแล้ว) → แก้ยอดเคลมเป็นยอดที่ได้รับรวม · ไม่ส่ง = ไม่บันทึก (เหมือนเดิม)
--      ทุกขั้นอยู่ในธุรกรรมเดียว: ผิดขั้นใด = ไม่บันทึกอะไรเลย
-- 4) close_insurance_claim: ไม่ได้เงิน (ส่วนที่เหลือ) → ยังไม่เคยได้เงิน = "ปฏิเสธ" · ได้ไปบางส่วนแล้ว = "ได้ไม่เต็ม"
-- ทุกฟังก์ชันที่ผู้ใช้เรียกเป็น SECURITY INVOKER → RLS / Trigger / สิทธิ์เดิมของ insurance_claims, income_transactions, expense_reimbursements ใช้ตามปกติ

-- ---------------------------------------------------------------------
-- 1) สถานะ SETTLED
-- ---------------------------------------------------------------------
ALTER TABLE public.insurance_claims DROP CONSTRAINT IF EXISTS insurance_claims_status_check;
ALTER TABLE public.insurance_claims ADD CONSTRAINT insurance_claims_status_check
  CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','PARTIALLY_PAID','PAID','SETTLED','REJECTED','CANCELLED'));

-- ---------------------------------------------------------------------
-- 2) ยอดได้รับ / สถานะของเคลม
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.refresh_claim(p_claim uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_sum numeric; v_n int; v_ever int;
BEGIN
  IF p_claim IS NULL THEN RETURN; END IF;
  SELECT coalesce(sum(x.amount) FILTER (WHERE x.live), 0), count(*) FILTER (WHERE x.live), count(*)
    INTO v_sum, v_n, v_ever
    FROM (SELECT r.amount, r.deleted_at IS NULL AS live FROM public.expense_reimbursements r WHERE r.insurance_claim_id = p_claim
          UNION ALL
          SELECT i.amount, i.deleted_at IS NULL FROM public.income_transactions i WHERE i.insurance_claim_id = p_claim) x;
  IF v_n > 0 THEN
    UPDATE public.insurance_claims c SET received_amount = v_sum,
           status = CASE WHEN c.status NOT IN ('DRAFT','SUBMITTED','APPROVED','PARTIALLY_PAID','PAID','SETTLED') THEN c.status
                         WHEN c.claimed_amount IS NULL OR v_sum >= c.claimed_amount THEN 'PAID'
                         WHEN c.status = 'SETTLED' THEN 'SETTLED'
                         ELSE 'PARTIALLY_PAID' END
     WHERE c.id = p_claim;
  ELSIF v_ever > 0 THEN
    UPDATE public.insurance_claims c SET received_amount = 0,
           status = CASE WHEN c.status IN ('PARTIALLY_PAID','PAID','SETTLED') THEN 'SUBMITTED' ELSE c.status END
     WHERE c.id = p_claim AND (c.received_amount IS DISTINCT FROM 0 OR c.status IN ('PARTIALLY_PAID','PAID','SETTLED'));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3) บันทึกรับเงินเคลม (รายได้ หรือ เงินคืนค่าใช้จ่าย) · ปิดเคลมเมื่อได้ไม่เต็ม · แก้ยอดเคลมเมื่อได้มากกว่า
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_insurance_claim(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c public.insurance_claims; pol public.insurance_policies;
  v_kind text := coalesce(nullif(p->>'kind', ''), 'INCOME');
  v_date date := nullif(p->>'date', '')::date; v_amount numeric := round(nullif(p->>'amount', '')::numeric, 2);
  v_bank uuid := nullif(p->>'bank_asset_id', '')::uuid; v_person uuid := nullif(p->>'person_id', '')::uuid;
  v_exp uuid := nullif(p->>'expense_item_id', '')::uuid;
  v_close boolean := coalesce(nullif(p->>'close', '')::boolean, false);
  v_raise boolean := coalesce(nullif(p->>'raise_claim', '')::boolean, false);
  v_notes text := nullif(btrim(p->>'notes'), ''); v_ccy text; v_eccy text; v_got numeric; v_id uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF v_kind NOT IN ('INCOME','REIMB') THEN RAISE EXCEPTION 'INVALID: ประเภทเงินที่รับไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.insurance_claims WHERE id = nullif(p->>'claim_id', '')::uuid AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบเคลม' USING ERRCODE = '22023'; END IF;
  IF c.status IN ('REJECTED','CANCELLED','SETTLED') THEN
    RAISE EXCEPTION 'INVALID: เคลมนี้ปิดแล้ว (ถูกปฏิเสธ / ได้ไม่เต็ม / ยกเลิก) · แก้สถานะเคลมก่อนถ้าจะบันทึกรับเพิ่ม' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO pol FROM public.insurance_policies WHERE id = c.policy_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์ของเคลมนี้' USING ERRCODE = '22023'; END IF;
  IF v_date IS NULL OR v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่รับไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดที่ได้รับ' USING ERRCODE = '22023'; END IF;
  IF v_bank IS NULL OR NOT private.is_bank_asset(v_bank) THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่รับเงิน' USING ERRCODE = '22023'; END IF;
  SELECT currency INTO v_ccy FROM public.assets WHERE id = v_bank;
  IF v_ccy IS DISTINCT FROM c.currency THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีที่รับต้องสกุลเดียวกับเคลม (%)', c.currency USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'REIMB' THEN
    IF v_exp IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกค่าใช้จ่ายที่จ่ายไปก่อน' USING ERRCODE = '22023'; END IF;
    SELECT currency INTO v_eccy FROM public.expense_items WHERE id = v_exp AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบค่าใช้จ่ายนี้' USING ERRCODE = '22023'; END IF;
    IF v_eccy IS DISTINCT FROM c.currency THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: ค่าใช้จ่ายต้องสกุลเดียวกับเคลม (%)', c.currency USING ERRCODE = '22023';
    END IF;
  END IF;

  v_got := coalesce(c.received_amount, 0);
  -- ได้มากกว่ายอดเคลม: ต้องยืนยัน (raise_claim) → ยอดเคลม = ยอดได้รับรวม
  IF c.claimed_amount IS NOT NULL AND v_got + v_amount > c.claimed_amount + 0.005 THEN
    IF NOT v_raise THEN
      RAISE EXCEPTION 'INVALID: เกินยอดเคลม (รอรับอีก % %)', round(greatest(c.claimed_amount - v_got, 0), 2), c.currency USING ERRCODE = '22023';
    END IF;
    UPDATE public.insurance_claims SET claimed_amount = v_got + v_amount WHERE id = c.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_DENIED: ไม่มีสิทธิ์แก้ยอดเคลมนี้' USING ERRCODE = '42501'; END IF;
  END IF;

  IF v_kind = 'REIMB' THEN
    v_id := public.record_reimbursement(v_exp, v_date, v_amount, v_bank, NULL, v_notes, c.id);
  ELSE
    INSERT INTO public.income_transactions(family_id, person_id, received_to_asset_id, date, income_type, amount, currency, notes, insurance_claim_id)
    VALUES (pol.family_id, coalesce(v_person, pol.person_id, pol.payer_person_id), v_bank, v_date, 'INSURANCE_BENEFIT', v_amount, v_ccy,
            concat_ws(' · ', 'เงินเคลมประกัน ' || pol.insurer || coalesce(' ' || pol.policy_no, ''), 'ยื่น ' || to_char(c.claim_date, 'DD/MM/YYYY'), v_notes),
            c.id)
    RETURNING id INTO v_id;
  END IF;

  -- ได้น้อยกว่าที่รอรับ + เลือก "ได้ไม่เต็ม · ปิดเคลม"
  IF v_close AND c.claimed_amount IS NOT NULL AND v_got + v_amount < c.claimed_amount - 0.005 THEN
    UPDATE public.insurance_claims SET status = 'SETTLED' WHERE id = c.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_DENIED: ไม่มีสิทธิ์ปิดเคลมนี้' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.receive_insurance_claim(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_insurance_claim(jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 4) ปิดเคลมโดยไม่ได้เงิน (ส่วนที่เหลือ)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_insurance_claim(p_claim_id uuid, p_notes text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c public.insurance_claims; v_status text; v_notes text := nullif(btrim(p_notes), '');
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT * INTO c FROM public.insurance_claims WHERE id = p_claim_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบเคลม' USING ERRCODE = '22023'; END IF;
  IF c.status NOT IN ('DRAFT','SUBMITTED','APPROVED','PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'INVALID: เคลมนี้จบแล้ว' USING ERRCODE = '22023';
  END IF;
  v_status := CASE WHEN coalesce(c.received_amount, 0) > 0 THEN 'SETTLED' ELSE 'REJECTED' END;
  UPDATE public.insurance_claims
     SET status = v_status, notes = coalesce(nullif(concat_ws(' · ', nullif(btrim(c.notes), ''), v_notes), ''), c.notes)
   WHERE id = c.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_DENIED: ไม่มีสิทธิ์แก้เคลมนี้' USING ERRCODE = '42501'; END IF;
  RETURN v_status;
END $$;
REVOKE ALL ON FUNCTION public.close_insurance_claim(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_insurance_claim(uuid, text) TO authenticated;
