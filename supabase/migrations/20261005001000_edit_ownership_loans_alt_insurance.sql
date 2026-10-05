-- =====================================================================
-- 1) สัดส่วนเจ้าของ / ผู้รับผิดชอบหนี้ / ผู้รับผลประโยชน์
-- 2) ลบรายการหลัก (Soft Delete ทั้งชุด) — ปฏิเสธถ้ายังมีรายการเงินเข้าออกผูกอยู่
-- 3) เงินให้กู้ยืม · สินทรัพย์อื่น · ประกัน
-- ทุกฟังก์ชันเป็น SECURITY INVOKER: RLS / Guard / Period Lock / Go-live Lock ทำงานตามสิทธิ์ผู้เรียก
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Ownership
--   p_mode = CORRECT : แก้ข้อมูลที่กรอกผิด (แทนสัดส่วนปัจจุบันทั้งชุด ตั้งแต่วันเริ่มเดิม)
--   p_mode = CHANGE  : เปลี่ยนเจ้าของจริงตั้งแต่ p_effective_date (เก็บประวัติเดิมไว้)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_asset_ownership(
  p_asset_id uuid, p_owners jsonb, p_mode text DEFAULT 'CORRECT', p_effective_date date DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_start date; v_go_live date; o jsonb; v_total numeric := 0;
BEGIN
  SELECT f.go_live_date INTO v_go_live FROM public.assets a JOIN public.families f ON f.id = a.family_id
   WHERE a.id = p_asset_id AND a.deleted_at IS NULL;
  IF v_go_live IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบรายการนี้' USING ERRCODE = '22023'; END IF;
  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p_owners, '[]'::jsonb)) LOOP
    v_total := v_total + (o->>'percent')::numeric;
  END LOOP;
  IF v_total > 100 THEN RAISE EXCEPTION 'INVALID: สัดส่วนรวม % %% เกิน 100%%', v_total USING ERRCODE = '22023'; END IF;

  IF p_mode = 'CHANGE' THEN
    IF p_effective_date IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่วันที่เริ่มมีผล' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.asset_ownerships WHERE asset_id = p_asset_id AND deleted_at IS NULL
                AND end_date IS NULL AND start_date >= p_effective_date) THEN
      RAISE EXCEPTION 'INVALID: วันที่เริ่มมีผลต้องอยู่หลังวันเริ่มของเจ้าของปัจจุบัน (ถ้ากรอกผิดให้เลือก "แก้ข้อมูลที่กรอกผิด")'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.asset_ownerships SET end_date = p_effective_date - 1
     WHERE asset_id = p_asset_id AND deleted_at IS NULL AND end_date IS NULL;
    v_start := p_effective_date;
  ELSE
    SELECT min(start_date) INTO v_start FROM public.asset_ownerships
     WHERE asset_id = p_asset_id AND deleted_at IS NULL AND end_date IS NULL;
    v_start := coalesce(v_start, (SELECT coalesce(a.acquisition_date, v_go_live - 1) FROM public.assets a WHERE a.id = p_asset_id));
    UPDATE public.asset_ownerships SET deleted_at = now()
     WHERE asset_id = p_asset_id AND deleted_at IS NULL AND end_date IS NULL;
  END IF;

  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p_owners, '[]'::jsonb)) LOOP
    INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
    VALUES (p_asset_id, (o->>'person_id')::uuid, (o->>'percent')::numeric, v_start);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.set_liability_responsibility(p_liability_id uuid, p_owners jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE o jsonb;
BEGIN
  UPDATE public.liability_ownerships SET deleted_at = now() WHERE liability_id = p_liability_id AND deleted_at IS NULL;
  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p_owners, '[]'::jsonb)) LOOP
    INSERT INTO public.liability_ownerships(liability_id, person_id, responsibility_percent)
    VALUES (p_liability_id, (o->>'person_id')::uuid, (o->>'percent')::numeric);
  END LOOP;
END $$;

-- p_list: [{"person_id": ".."} | {"name": ".."}, "percent": 50]
CREATE OR REPLACE FUNCTION public.set_beneficiaries(p_policy_id uuid, p_list jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE o jsonb;
BEGIN
  UPDATE public.insurance_beneficiaries SET deleted_at = now() WHERE policy_id = p_policy_id AND deleted_at IS NULL;
  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) LOOP
    INSERT INTO public.insurance_beneficiaries(policy_id, person_id, beneficiary_name, percentage)
    VALUES (p_policy_id, nullif(o->>'person_id', '')::uuid,
            CASE WHEN nullif(o->>'person_id', '') IS NULL THEN nullif(trim(o->>'name'), '') END, (o->>'percent')::numeric);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2) ลบรายการหลัก
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_asset(p_asset_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.assets; v_pf uuid; v_prop uuid; v_n int; v_note text;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาระบุเหตุผลที่ลบ' USING ERRCODE = '22023'; END IF;
  v_note := 'ลบ: ' || trim(p_reason);
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบรายการนี้' USING ERRCODE = '22023'; END IF;
  SELECT id INTO v_pf FROM public.investment_portfolios WHERE asset_id = a.id AND deleted_at IS NULL;
  SELECT id INTO v_prop FROM public.property_details WHERE asset_id = a.id AND deleted_at IS NULL;

  -- ยังมีรายการเงินผูกอยู่ → ให้ลบรายการเหล่านั้นก่อน (หรือเปลี่ยนสถานะเป็นปิด / ขายแล้ว)
  SELECT count(*) INTO v_n FROM public.cash_movements m
   WHERE m.deleted_at IS NULL AND (m.from_asset_id = a.id OR m.to_asset_id = a.id
         OR m.related_lease_id IN (SELECT l.id FROM public.property_leases l WHERE l.property_id = v_prop));
  v_n := v_n + (SELECT count(*) FROM public.income_transactions i WHERE i.deleted_at IS NULL
                 AND (i.asset_id = a.id OR i.received_to_asset_id = a.id))
             + (SELECT count(*) FROM public.expense_items e WHERE e.deleted_at IS NULL
                 AND (e.paid_from_asset_id = a.id OR e.related_asset_id = a.id))
             + (SELECT count(*) FROM public.investment_transactions t WHERE t.deleted_at IS NULL
                 AND (t.settle_from_asset_id = a.id OR t.settle_to_asset_id = a.id
                      OR (t.portfolio_id = v_pf AND t.transaction_type <> 'OPENING_BALANCE')))
             + (SELECT count(*) FROM public.insurance_policies p WHERE p.deleted_at IS NULL AND p.cash_value_asset_id = a.id);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'INVALID: ยังมี % รายการที่ผูกกับรายการนี้ (รายได้ / ค่าใช้จ่าย / โอน / ลงทุน) — ลบรายการเหล่านั้นก่อน หรือเปลี่ยนสถานะเป็นปิด/ขายแล้วแทนการลบ', v_n
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.asset_valuations SET notes = concat_ws(' · ', notes, v_note), deleted_at = now()
   WHERE asset_id = a.id AND deleted_at IS NULL;
  UPDATE public.asset_ownerships SET deleted_at = now() WHERE asset_id = a.id AND deleted_at IS NULL;
  UPDATE public.bank_accounts SET deleted_at = now() WHERE asset_id = a.id AND deleted_at IS NULL;
  UPDATE public.loan_details SET deleted_at = now() WHERE asset_id = a.id AND deleted_at IS NULL;
  UPDATE public.alternative_asset_details SET deleted_at = now() WHERE asset_id = a.id AND deleted_at IS NULL;
  UPDATE public.private_business_details SET deleted_at = now() WHERE asset_id = a.id AND deleted_at IS NULL;
  IF v_prop IS NOT NULL THEN
    UPDATE public.property_utilities SET deleted_at = now() WHERE property_id = v_prop AND deleted_at IS NULL;
    UPDATE public.property_leases SET deleted_at = now() WHERE property_id = v_prop AND deleted_at IS NULL;
    UPDATE public.property_details SET deleted_at = now() WHERE id = v_prop;
  END IF;
  IF v_pf IS NOT NULL THEN
    UPDATE public.investment_valuations v SET deleted_at = now() FROM public.investment_holdings h
     WHERE v.holding_id = h.id AND h.portfolio_id = v_pf AND v.deleted_at IS NULL;
    UPDATE public.investment_transactions SET notes = concat_ws(' · ', notes, v_note), deleted_at = now()
     WHERE portfolio_id = v_pf AND deleted_at IS NULL;
    UPDATE public.investment_holdings SET deleted_at = now() WHERE portfolio_id = v_pf AND deleted_at IS NULL;
    UPDATE public.investment_portfolios SET deleted_at = now() WHERE id = v_pf;
  END IF;
  UPDATE public.liabilities SET linked_asset_id = NULL WHERE linked_asset_id = a.id AND deleted_at IS NULL;
  UPDATE public.assets SET notes = concat_ws(' · ', notes, v_note), deleted_at = now() WHERE id = a.id;
END $$;

CREATE OR REPLACE FUNCTION public.delete_liability(p_liability_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_note text := 'ลบ: ' || trim(coalesce(p_reason, ''));
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาระบุเหตุผลที่ลบ' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_movements WHERE to_liability_id = p_liability_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: มีรายการจ่ายหนี้ผูกอยู่ — ลบรายการจ่ายก่อน หรือเปลี่ยนสถานะเป็นปิดหนี้แทน' USING ERRCODE = '22023';
  END IF;
  UPDATE public.liability_valuations SET notes = concat_ws(' · ', notes, v_note), deleted_at = now()
   WHERE liability_id = p_liability_id AND deleted_at IS NULL;
  UPDATE public.liability_ownerships SET deleted_at = now() WHERE liability_id = p_liability_id AND deleted_at IS NULL;
  UPDATE public.liabilities SET notes = concat_ws(' · ', notes, v_note), deleted_at = now()
   WHERE id = p_liability_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบรายการนี้ หรือไม่มีสิทธิ์ลบ' USING ERRCODE = '22023'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.delete_credit_card(p_card_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาระบุเหตุผลที่ลบ' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_movements WHERE to_credit_card_id = p_card_id AND deleted_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.expense_items WHERE paid_from_credit_card_id = p_card_id AND deleted_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.expense_reimbursements WHERE received_to_credit_card_id = p_card_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: มีค่าใช้จ่ายหรือรายการจ่ายบัตรผูกอยู่ — เปลี่ยนสถานะเป็น "ยกเลิกบัตรแล้ว" แทนการลบ' USING ERRCODE = '22023';
  END IF;
  UPDATE public.credit_cards SET notes = concat_ws(' · ', notes, 'ลบ: ' || trim(p_reason)), deleted_at = now()
   WHERE id = p_card_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบบัตรนี้ หรือไม่มีสิทธิ์ลบ' USING ERRCODE = '22023'; END IF;
END $$;

-- สัญญาเช่า: ลบพร้อมรายการรับเงินประกันของสัญญานี้ (ถ้ามีค่าเช่าบันทึกแล้ว ต้องลบค่าเช่าก่อน)
CREATE OR REPLACE FUNCTION public.delete_lease(p_lease_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.income_transactions WHERE lease_id = p_lease_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: มีค่าเช่าที่บันทึกรับแล้ว — ลบรายการค่าเช่าที่หน้า Income & Expenses ก่อน' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.property_leases WHERE id = p_lease_id AND deposit_settlement_type = 'REFUNDED') THEN
    RAISE EXCEPTION 'INVALID: สัญญานี้คืนเงินประกันแล้ว ลบไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.property_leases WHERE deposit_carried_from_lease_id = p_lease_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: เงินประกันของสัญญานี้ถูกยกไปสัญญาใหม่แล้ว — ลบสัญญาใหม่ก่อน' USING ERRCODE = '22023';
  END IF;
  UPDATE public.cash_movements SET deleted_at = now()
   WHERE related_lease_id = p_lease_id AND movement_type = 'SECURITY_DEPOSIT_IN' AND deleted_at IS NULL AND NOT is_derived;
  UPDATE public.expected_income_dismissals SET deleted_at = now()
   WHERE source_type = 'LEASE' AND source_id = p_lease_id AND deleted_at IS NULL;
  UPDATE public.property_leases SET deleted_at = now() WHERE id = p_lease_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบสัญญานี้ หรือไม่มีสิทธิ์ลบ' USING ERRCODE = '22023'; END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3a) เงินให้กู้ยืม (Section 19)
--   ก่อน Go-live: opening_outstanding ณ วันตั้งต้น · หลัง Go-live: เริ่ม 0 แล้วจ่ายเงินกู้จากบัญชี (LOAN_DISBURSEMENT)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_loan(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_family uuid; v_go_live date; v_asset uuid; v_ccy text; o jsonb;
  v_opening boolean := coalesce((p->>'is_opening')::boolean, false);
  v_open_date date; v_disb_date date := nullif(p->>'disburse_date', '')::date;
  v_from uuid := nullif(p->>'disburse_from_asset_id', '')::uuid; v_principal numeric := nullif(p->>'principal', '')::numeric;
BEGIN
  IF length(trim(coalesce(p->>'name', ''))) = 0 OR length(trim(coalesce(p->>'borrower_name', ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อรายการและชื่อผู้กู้' USING ERRCODE = '22023';
  END IF;
  IF v_principal IS NULL OR v_principal < 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่เงินต้น' USING ERRCODE = '22023'; END IF;
  SELECT id, go_live_date INTO v_family, v_go_live FROM public.families WHERE deleted_at IS NULL LIMIT 1;
  v_ccy := upper(coalesce(nullif(p->>'currency', ''), 'THB'));
  IF v_from IS NOT NULL THEN SELECT currency INTO v_ccy FROM public.assets WHERE id = v_from; END IF;

  IF v_opening THEN
    v_open_date := v_go_live - 1;
  ELSE
    IF v_from IS NULL OR v_disb_date IS NULL THEN
      RAISE EXCEPTION 'INVALID: เงินให้กู้ใหม่ต้องเลือกบัญชีที่จ่ายเงินและวันที่จ่าย' USING ERRCODE = '22023';
    END IF;
    IF v_disb_date < v_go_live THEN
      RAISE EXCEPTION 'INVALID: ให้กู้ก่อน Go-live (%) ให้ติ๊ก "มีอยู่ก่อน Go-live" แล้วใส่ยอดคงเหลือ', v_go_live USING ERRCODE = '22023';
    END IF;
    v_open_date := v_disb_date - 1;
  END IF;

  INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency, acquisition_date, acquisition_cost, notes)
  VALUES (v_family, 'FINANCIAL', 'LOAN_RECEIVABLE', trim(p->>'name'), v_ccy,
          coalesce(nullif(p->>'loan_date', '')::date, v_disb_date), v_principal, nullif(trim(p->>'notes'), ''))
  RETURNING id INTO v_asset;
  INSERT INTO public.loan_details(asset_id, borrower_name, principal, interest_rate, loan_date, due_date,
              opening_outstanding_principal, opening_date, notes)
  VALUES (v_asset, trim(p->>'borrower_name'), v_principal, nullif(p->>'interest_rate', '')::numeric,
          coalesce(nullif(p->>'loan_date', '')::date, v_disb_date), nullif(p->>'due_date', '')::date,
          CASE WHEN v_opening THEN coalesce(nullif(p->>'opening_outstanding', '')::numeric, v_principal) ELSE 0 END,
          v_open_date, coalesce(nullif(trim(p->>'notes'), ''), CASE WHEN v_opening THEN 'ยอดตั้งต้น' ELSE 'ให้กู้ใหม่' END));
  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p->'owners', '[]'::jsonb)) LOOP
    INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
    VALUES (v_asset, (o->>'person_id')::uuid, (o->>'percent')::numeric, CASE WHEN v_opening THEN v_open_date ELSE v_disb_date END);
  END LOOP;
  IF NOT v_opening THEN
    INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_asset_id, amount, currency, description)
    VALUES (v_family, v_disb_date, 'LOAN_DISBURSEMENT', v_from, v_asset, v_principal, v_ccy, 'ให้กู้ · ' || trim(p->>'borrower_name'));
  END IF;
  RETURN v_asset;
END $$;

-- ---------------------------------------------------------------------
-- 3b) สินทรัพย์อื่น (Section 23) — asset_type = category_code
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_alternative_asset(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_family uuid; v_go_live date; v_asset uuid; v_code text; o jsonb; v_start date;
  v_opening boolean := coalesce((p->>'is_opening')::boolean, false);
  v_date date := nullif(p->>'value_date', '')::date; v_value numeric := nullif(p->>'value', '')::numeric;
  v_acq date := nullif(p->>'acquisition_date', '')::date;
BEGIN
  IF length(trim(coalesce(p->>'name', ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อ' USING ERRCODE = '22023'; END IF;
  IF v_value IS NULL OR v_date IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่มูลค่าและวันที่' USING ERRCODE = '22023'; END IF;
  SELECT id, go_live_date INTO v_family, v_go_live FROM public.families WHERE deleted_at IS NULL LIMIT 1;
  SELECT category_code INTO v_code FROM public.asset_categories
   WHERE id = (p->>'category_id')::uuid AND deleted_at IS NULL AND (family_id IS NULL OR family_id = v_family);
  IF v_code IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกหมวด' USING ERRCODE = '22023'; END IF;
  IF NOT v_opening AND (v_acq IS NULL OR v_acq < v_go_live) THEN
    RAISE EXCEPTION 'INVALID: สินทรัพย์ที่ได้มาหลัง Go-live ต้องระบุวันที่ได้มา (ตั้งแต่ %) — ถ้ามีอยู่ก่อน ให้ติ๊ก "มีอยู่ก่อน Go-live"', v_go_live
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency, acquisition_date, acquisition_cost, notes)
  VALUES (v_family, 'ALTERNATIVE', v_code, trim(p->>'name'), upper(coalesce(nullif(p->>'currency', ''), 'THB')),
          v_acq, nullif(p->>'acquisition_cost', '')::numeric, nullif(trim(p->>'notes'), ''))
  RETURNING id INTO v_asset;
  INSERT INTO public.alternative_asset_details(asset_id, category_id, brand, model, serial_no, quantity, storage_location, condition, details)
  VALUES (v_asset, (p->>'category_id')::uuid, nullif(trim(p->>'brand'), ''), nullif(trim(p->>'model'), ''),
          nullif(trim(p->>'serial_no'), ''), nullif(p->>'quantity', '')::numeric, nullif(trim(p->>'storage_location'), ''),
          nullif(trim(p->>'condition'), ''), nullif(trim(p->>'details'), ''));
  v_start := CASE WHEN v_opening THEN least(v_date, coalesce(v_acq, v_date)) ELSE v_acq END;
  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p->'owners', '[]'::jsonb)) LOOP
    INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
    VALUES (v_asset, (o->>'person_id')::uuid, (o->>'percent')::numeric, v_start);
  END LOOP;
  INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening, notes)
  VALUES (v_asset, v_date, v_value, coalesce(nullif(p->>'valuation_method', ''), 'USER_ESTIMATE'),
          CASE WHEN v_opening THEN 'OPENING' WHEN p->>'valuation_method' = 'APPRAISAL' THEN 'APPRAISAL' ELSE 'USER' END,
          v_opening, nullif(trim(p->>'notes'), ''));
  RETURN v_asset;
END $$;

-- ---------------------------------------------------------------------
-- 3c) ประกัน (Section 26) — มีมูลค่าเวนคืน → Asset FINANCIAL / INSURANCE_CASH_VALUE
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_insurance_policy(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_family uuid; v_go_live date; v_id uuid; v_cv uuid; o jsonb; v_start date;
  v_has_cv boolean := coalesce((p->>'has_cash_value')::boolean, false);
  v_opening boolean := coalesce((p->>'is_opening')::boolean, false);
  v_cv_value numeric := nullif(p->>'cash_value', '')::numeric; v_cv_date date := nullif(p->>'cash_value_date', '')::date;
  v_ccy text := upper(coalesce(nullif(p->>'currency', ''), 'THB'));
BEGIN
  IF length(trim(coalesce(p->>'insurer', ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่บริษัทประกัน' USING ERRCODE = '22023'; END IF;
  SELECT id, go_live_date INTO v_family, v_go_live FROM public.families WHERE deleted_at IS NULL LIMIT 1;

  IF v_has_cv THEN
    IF v_cv_value IS NULL OR v_cv_date IS NULL THEN
      RAISE EXCEPTION 'INVALID: กรมธรรม์ที่มีมูลค่าเวนคืนต้องใส่มูลค่าเวนคืนและวันที่' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency, acquisition_date, notes)
    VALUES (v_family, 'FINANCIAL', 'INSURANCE_CASH_VALUE',
            'มูลค่าเวนคืน ' || trim(p->>'insurer') || coalesce(' ' || nullif(trim(p->>'policy_no'), ''), ''), v_ccy,
            CASE WHEN NOT v_opening THEN coalesce(nullif(p->>'start_date', '')::date, v_cv_date) END, nullif(trim(p->>'notes'), ''))
    RETURNING id INTO v_cv;
    v_start := CASE WHEN v_opening THEN v_cv_date ELSE coalesce(nullif(p->>'start_date', '')::date, v_cv_date) END;
    FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p->'owners', '[]'::jsonb)) LOOP
      INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
      VALUES (v_cv, (o->>'person_id')::uuid, (o->>'percent')::numeric, least(v_start, v_cv_date));
    END LOOP;
    INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening, notes)
    VALUES (v_cv, v_cv_date, v_cv_value, 'STATEMENT', CASE WHEN v_opening THEN 'OPENING' ELSE 'STATEMENT' END, v_opening,
            nullif(trim(p->>'notes'), ''));
  END IF;

  INSERT INTO public.insurance_policies(family_id, insurance_type, person_id, asset_id, insurer, policy_no, start_date, end_date,
              insured_amount, insured_amount_currency, premium, premium_currency, has_cash_value, cash_value_asset_id, notes)
  VALUES (v_family, p->>'insurance_type', nullif(p->>'person_id', '')::uuid, nullif(p->>'insured_asset_id', '')::uuid,
          trim(p->>'insurer'), nullif(trim(p->>'policy_no'), ''), nullif(p->>'start_date', '')::date, nullif(p->>'end_date', '')::date,
          nullif(p->>'insured_amount', '')::numeric, CASE WHEN nullif(p->>'insured_amount', '') IS NOT NULL THEN v_ccy END,
          nullif(p->>'premium', '')::numeric, CASE WHEN nullif(p->>'premium', '') IS NOT NULL THEN v_ccy END,
          v_has_cv, v_cv, nullif(trim(p->>'notes'), ''))
  RETURNING id INTO v_id;
  PERFORM public.set_beneficiaries(v_id, coalesce(p->'beneficiaries', '[]'::jsonb));
  RETURN v_id;
END $$;

-- ลบกรมธรรม์ (พร้อมมูลค่าเวนคืน) — มีเคลมที่ผูกเงินคืนแล้วลบไม่ได้
CREATE OR REPLACE FUNCTION public.delete_insurance_policy(p_policy_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_cv uuid;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาระบุเหตุผลที่ลบ' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.expense_reimbursements r JOIN public.insurance_claims c ON c.id = r.insurance_claim_id
              WHERE c.policy_id = p_policy_id AND r.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: มีเงินคืนจากเคลมผูกอยู่ — เปลี่ยนสถานะกรมธรรม์แทนการลบ' USING ERRCODE = '22023';
  END IF;
  SELECT cash_value_asset_id INTO v_cv FROM public.insurance_policies WHERE id = p_policy_id AND deleted_at IS NULL;
  UPDATE public.insurance_claims SET deleted_at = now() WHERE policy_id = p_policy_id AND deleted_at IS NULL;
  UPDATE public.insurance_beneficiaries SET deleted_at = now() WHERE policy_id = p_policy_id AND deleted_at IS NULL;
  UPDATE public.insurance_policies SET notes = concat_ws(' · ', notes, 'ลบ: ' || trim(p_reason)), deleted_at = now()
   WHERE id = p_policy_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์ หรือไม่มีสิทธิ์ลบ' USING ERRCODE = '22023'; END IF;
  IF v_cv IS NOT NULL THEN PERFORM public.delete_asset(v_cv, p_reason); END IF;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.set_asset_ownership(uuid,jsonb,text,date)', 'public.set_liability_responsibility(uuid,jsonb)',
    'public.set_beneficiaries(uuid,jsonb)', 'public.delete_asset(uuid,text)', 'public.delete_liability(uuid,text)',
    'public.delete_credit_card(uuid,text)', 'public.delete_lease(uuid)', 'public.create_loan(jsonb)',
    'public.create_alternative_asset(jsonb)', 'public.create_insurance_policy(jsonb)', 'public.delete_insurance_policy(uuid,text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
