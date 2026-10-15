-- =====================================================================
-- ยกเลิกทั้งก้อน (ย้อนทุกส่วนที่เกิดจากการบันทึกครั้งเดียว)
--   1) รับผลประโยชน์ประกัน: บันทึก "ใบรับ" (insurance_benefit_receipts) ทุกครั้ง → undo_insurance_benefit
--      ย้อน: ถอนจากมูลค่าเวนคืน (รายการเงิน + มูลค่า) · รายได้ส่วนเกิน · สถานะกรมธรรม์ / มูลค่าเวนคืน
--      (การรับก่อน migration นี้ไม่มีใบรับ → แก้ทีละส่วนเหมือนเดิม)
--   2) คืนเงินประกันการเช่า: undo_security_deposit → ลบเงินคืน + รายได้ส่วนที่หัก · สัญญากลับมาถือเงินประกัน
--   3) รับชำระเงินให้กู้ / จ่ายหนี้ (เงินต้น + ดอกเบี้ย ครั้งเดียวกัน): undo_payment_group
--      + จ่ายหนี้ใหม่: ผูกดอกเบี้ยเข้ากลุ่มเดียวกับเงินต้น (movement_group_id)
--   งวดที่ปิดแล้วทำไม่ได้ (Period Lock) · ADMIN / EDITOR เท่านั้น
-- รันซ้ำได้
-- =====================================================================

-- ---------------------------------------------------------------- 1) ใบรับผลประโยชน์ประกัน
CREATE TABLE IF NOT EXISTS public.insurance_benefit_receipts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id          uuid NOT NULL REFERENCES public.insurance_policies(id),
  line_id            uuid REFERENCES public.insurance_schedule_lines(id),
  receipt_date       date NOT NULL,
  amount             public.d_money NOT NULL,
  currency           public.d_currency NOT NULL,
  bank_asset_id      uuid REFERENCES public.assets(id),
  cash_value_part    numeric NOT NULL DEFAULT 0,
  income_part        numeric NOT NULL DEFAULT 0,
  movement_id        uuid REFERENCES public.cash_movements(id),
  income_id          uuid REFERENCES public.income_transactions(id),
  valuation_ids      uuid[] NOT NULL DEFAULT '{}',
  outcome            text,
  prev_policy_status text,
  prev_cv_status     text,
  undone_at          timestamptz,
  notes              text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE INDEX IF NOT EXISTS insurance_benefit_receipts_policy_idx ON public.insurance_benefit_receipts(policy_id);

DROP TRIGGER IF EXISTS t10_meta ON public.insurance_benefit_receipts;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.insurance_benefit_receipts
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.insurance_benefit_receipts;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.insurance_benefit_receipts
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.insurance_benefit_receipts;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.insurance_benefit_receipts
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

-- อ่านได้ทุกบทบาท · เขียนผ่านระบบเท่านั้น
ALTER TABLE public.insurance_benefit_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.insurance_benefit_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.insurance_benefit_receipts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.insurance_benefit_receipts TO service_role;
DROP POLICY IF EXISTS p_select ON public.insurance_benefit_receipts;
CREATE POLICY p_select ON public.insurance_benefit_receipts FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));

-- เขียนใบรับ (เรียกจาก receive_insurance_benefit) / ปิดใบรับ (เรียกจาก undo)
CREATE OR REPLACE FUNCTION private.write_benefit_receipt(r jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF r ? 'undo_id' THEN
    UPDATE public.insurance_benefit_receipts SET undone_at = now()
     WHERE id = (r->>'undo_id')::uuid AND undone_at IS NULL RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  INSERT INTO public.insurance_benefit_receipts(policy_id, line_id, receipt_date, amount, currency, bank_asset_id, cash_value_part,
              income_part, movement_id, income_id, valuation_ids, outcome, prev_policy_status, prev_cv_status, notes)
  VALUES ((r->>'policy_id')::uuid, nullif(r->>'line_id', '')::uuid, (r->>'date')::date, (r->>'amount')::numeric, r->>'currency',
          nullif(r->>'bank', '')::uuid, coalesce((r->>'cv_part')::numeric, 0), coalesce((r->>'income_part')::numeric, 0),
          nullif(r->>'movement_id', '')::uuid, nullif(r->>'income_id', '')::uuid,
          coalesce(ARRAY(SELECT jsonb_array_elements_text(r->'valuation_ids'))::uuid[], '{}'),
          nullif(r->>'outcome', ''), nullif(r->>'prev_policy_status', ''), nullif(r->>'prev_cv_status', ''), nullif(r->>'notes', ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION private.write_benefit_receipt(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.write_benefit_receipt(jsonb) TO authenticated, service_role;

-- รับผลประโยชน์: เหมือนเดิม + เก็บใบรับ
CREATE OR REPLACE FUNCTION public.receive_insurance_benefit(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  pol public.insurance_policies; v_line uuid := nullif(p->>'line_id', '')::uuid;
  v_date date := nullif(p->>'date', '')::date; v_amount numeric := nullif(p->>'amount', '')::numeric;
  v_bank uuid := nullif(p->>'bank_asset_id', '')::uuid; v_use_cv boolean := coalesce((p->>'use_cash_value')::boolean, true);
  v_outcome text := nullif(p->>'outcome', ''); v_person uuid := nullif(p->>'person_id', '')::uuid;
  v_notes text := nullif(trim(p->>'notes'), ''); v_ccy text; v_cv_ccy text; v_cv_val numeric := 0; v_part numeric := 0;
  v_income numeric; v_label text; v_mv uuid; v_inc uuid; v_val uuid; v_vals uuid[] := '{}'; v_cv_status text; v_receipt uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF v_outcome IS NOT NULL THEN PERFORM private.require_role('ADMIN','EDITOR'); END IF;
  SELECT * INTO pol FROM public.insurance_policies WHERE id = (p->>'policy_id')::uuid AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023'; END IF;
  IF v_outcome IS NOT NULL AND v_outcome NOT IN ('MATURED','SURRENDERED','CLAIMED') THEN
    RAISE EXCEPTION 'INVALID: ผลของการรับไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF v_line IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.insurance_schedule_lines
                                         WHERE id = v_line AND policy_id = pol.id AND kind = 'BENEFIT' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: งวดผลประโยชน์ไม่ตรงกับกรมธรรม์' USING ERRCODE = '22023';
  END IF;
  IF v_date IS NULL OR v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่รับไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดที่ได้รับ' USING ERRCODE = '22023'; END IF;
  IF v_bank IS NULL OR NOT private.is_bank_asset(v_bank) THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่รับเงิน' USING ERRCODE = '22023'; END IF;
  SELECT currency INTO v_ccy FROM public.assets WHERE id = v_bank;
  v_label := 'ผลประโยชน์ประกัน · ' || pol.insurer || coalesce(' ' || pol.policy_no, '');
  IF pol.cash_value_asset_id IS NOT NULL THEN
    SELECT status INTO v_cv_status FROM public.assets WHERE id = pol.cash_value_asset_id;
  END IF;

  -- มีมูลค่าเวนคืน: ถอนจากมูลค่าเวนคืนก่อน
  IF pol.cash_value_asset_id IS NOT NULL THEN
    SELECT currency INTO v_cv_ccy FROM public.assets WHERE id = pol.cash_value_asset_id;
    v_cv_val := greatest(coalesce((private.latest_asset_valuation(pol.cash_value_asset_id, v_date)).value, 0), 0);
    IF v_use_cv AND v_cv_val > 0 THEN
      IF v_cv_ccy <> v_ccy THEN
        RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีที่รับต้องสกุลเดียวกับมูลค่าเวนคืน (%)', v_cv_ccy USING ERRCODE = '22023';
      END IF;
      v_part := least(v_amount, v_cv_val);
      INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_asset_id, amount, currency,
                                        description, notes, metadata)
      VALUES (pol.family_id, v_date, 'ASSET_SALE', pol.cash_value_asset_id, v_bank, v_part, v_ccy, v_label || ' (จากมูลค่าเวนคืน)', v_notes,
              jsonb_build_object('policy_id', pol.id, 'insurance_schedule_line_id', v_line))
      RETURNING id INTO v_mv;
      INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
      VALUES (pol.cash_value_asset_id, v_date, v_cv_val - v_part, 'LATEST_TRANSACTION', 'USER', 'รับผลประโยชน์ประกัน (ถอนจากมูลค่าเวนคืน)')
      RETURNING id INTO v_val;
      v_vals := v_vals || v_val;
    END IF;
  END IF;

  -- ส่วนที่เกินมูลค่าเวนคืน = รายได้
  v_income := v_amount - v_part;
  IF v_income > 0 THEN
    INSERT INTO public.income_transactions(family_id, asset_id, person_id, received_to_asset_id, date, income_type, amount, currency,
                                           notes, insurance_schedule_line_id)
    VALUES (pol.family_id,
            CASE WHEN v_person IS NULL THEN pol.cash_value_asset_id END,
            CASE WHEN v_person IS NOT NULL OR pol.cash_value_asset_id IS NULL
                 THEN coalesce(v_person, pol.payer_person_id, pol.person_id) END,
            v_bank, v_date, 'INSURANCE_BENEFIT', v_income, v_ccy, concat_ws(' · ', v_label, v_notes), v_line)
    RETURNING id INTO v_inc;
  END IF;

  -- ปิดกรมธรรม์: สถานะ + มูลค่าเวนคืนที่เหลือเป็น 0 + ปิดสินทรัพย์
  IF v_outcome IS NOT NULL THEN
    UPDATE public.insurance_policies SET status = v_outcome WHERE id = pol.id;
    IF pol.cash_value_asset_id IS NOT NULL THEN
      IF v_cv_val - v_part > 0.005 OR NOT v_use_cv THEN
        INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
        VALUES (pol.cash_value_asset_id, v_date, 0, 'LATEST_TRANSACTION', 'USER', 'ปิดกรมธรรม์')
        RETURNING id INTO v_val;
        v_vals := v_vals || v_val;
      END IF;
      UPDATE public.assets SET status = 'CLOSED' WHERE id = pol.cash_value_asset_id AND status = 'ACTIVE';
    END IF;
  END IF;

  v_receipt := private.write_benefit_receipt(jsonb_build_object(
    'policy_id', pol.id, 'line_id', v_line, 'date', v_date, 'amount', v_amount, 'currency', v_ccy, 'bank', v_bank,
    'cv_part', v_part, 'income_part', greatest(v_income, 0), 'movement_id', v_mv, 'income_id', v_inc,
    'valuation_ids', to_jsonb(v_vals), 'outcome', v_outcome, 'prev_policy_status', pol.status, 'prev_cv_status', v_cv_status,
    'notes', v_notes));
  RETURN jsonb_build_object('cash_value_part', v_part, 'income_part', greatest(v_income, 0), 'receipt_id', v_receipt);
END $$;
REVOKE ALL ON FUNCTION public.receive_insurance_benefit(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_insurance_benefit(jsonb) TO authenticated;

-- ยกเลิกการรับผลประโยชน์ทั้งก้อน
CREATE OR REPLACE FUNCTION public.undo_insurance_benefit(p_receipt_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.insurance_benefit_receipts; pol public.insurance_policies;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO r FROM public.insurance_benefit_receipts WHERE id = p_receipt_id AND deleted_at IS NULL;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการรับผลประโยชน์' USING ERRCODE = '22023'; END IF;
  IF r.undone_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID: รายการนี้ยกเลิกไปแล้ว' USING ERRCODE = '22023'; END IF;
  SELECT * INTO pol FROM public.insurance_policies WHERE id = r.policy_id;
  IF r.outcome IS NOT NULL AND EXISTS (SELECT 1 FROM public.insurance_benefit_receipts x
       WHERE x.policy_id = r.policy_id AND x.undone_at IS NULL AND x.deleted_at IS NULL AND x.id <> r.id
         AND (x.receipt_date, x.created_at) > (r.receipt_date, r.created_at)) THEN
    RAISE EXCEPTION 'INVALID: มีการรับผลประโยชน์ครั้งหลังจากนี้ — ยกเลิกรายการล่าสุดก่อน' USING ERRCODE = '22023';
  END IF;
  -- รายการเงิน / รายได้ / มูลค่าเวนคืน (Period Lock ตรวจที่ Trigger)
  IF r.movement_id IS NOT NULL THEN
    UPDATE public.cash_movements SET deleted_at = now() WHERE id = r.movement_id AND deleted_at IS NULL;
  END IF;
  IF r.income_id IS NOT NULL THEN
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = r.income_id AND deleted_at IS NULL;
  END IF;
  IF cardinality(r.valuation_ids) > 0 THEN
    UPDATE public.asset_valuations SET deleted_at = now() WHERE id = ANY (r.valuation_ids) AND deleted_at IS NULL;
  END IF;
  -- สถานะกรมธรรม์ / มูลค่าเวนคืน กลับเหมือนก่อนรับ
  IF r.outcome IS NOT NULL THEN
    UPDATE public.insurance_policies SET status = coalesce(r.prev_policy_status, 'ACTIVE') WHERE id = r.policy_id;
    IF pol.cash_value_asset_id IS NOT NULL AND r.prev_cv_status IS NOT NULL THEN
      UPDATE public.assets SET status = r.prev_cv_status WHERE id = pol.cash_value_asset_id AND status IS DISTINCT FROM r.prev_cv_status;
    END IF;
  END IF;
  PERFORM private.write_benefit_receipt(jsonb_build_object('undo_id', r.id));
END $$;
REVOKE ALL ON FUNCTION public.undo_insurance_benefit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_insurance_benefit(uuid) TO authenticated;

-- ---------------------------------------------------------------- 2) ยกเลิกการคืนเงินประกันการเช่า
CREATE OR REPLACE FUNCTION public.undo_security_deposit(p_lease_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$     -- DEFINER: ฟิลด์ Settle เป็น Cache (Client แก้ตรงไม่ได้)
DECLARE l public.property_leases;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO l FROM public.property_leases WHERE id = p_lease_id AND deleted_at IS NULL FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบสัญญา' USING ERRCODE = '22023'; END IF;
  IF l.deposit_settlement_type IS DISTINCT FROM 'REFUNDED' THEN
    RAISE EXCEPTION 'INVALID: สัญญานี้ยังไม่ได้คืนเงินประกัน (หรือยกไปสัญญาใหม่ — ให้ลบสัญญาใหม่แทน)' USING ERRCODE = '22023';
  END IF;
  -- เงินคืนผู้เช่า + รายได้ส่วนที่หัก (Period Lock ตรวจที่ Trigger)
  UPDATE public.cash_movements SET deleted_at = now()
   WHERE related_lease_id = l.id AND movement_type = 'SECURITY_DEPOSIT_OUT' AND NOT is_derived AND deleted_at IS NULL;
  UPDATE public.income_transactions SET deleted_at = now()
   WHERE lease_id = l.id AND income_type = 'OTHER' AND date = l.deposit_settled_date AND notes LIKE 'หักจากเงินประกัน:%' AND deleted_at IS NULL;
  UPDATE public.property_leases SET deposit_settled_date = NULL, deposit_settlement_type = NULL, deposit_refunded_amount = NULL
   WHERE id = l.id;
  -- Audit Log บันทึกการเปลี่ยนแปลงทุกตารางให้อยู่แล้ว (z90_audit)
END $$;
REVOKE ALL ON FUNCTION public.undo_security_deposit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_security_deposit(uuid) TO authenticated;

-- ---------------------------------------------------------------- 3) ยกเลิกรับ / จ่าย เงินต้น + ดอกเบี้ย ครั้งเดียวกัน
CREATE OR REPLACE FUNCTION public.undo_payment_group(p_group_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_n int := 0; v_k int; v_inc uuid[]; v_exp uuid[];
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF p_group_id IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบรายการ' USING ERRCODE = '22023'; END IF;
  SELECT array_agg(source_entity_id) FILTER (WHERE source_entity_type = 'INCOME'),
         array_agg(source_entity_id) FILTER (WHERE source_entity_type = 'EXPENSE')
    INTO v_inc, v_exp
    FROM public.cash_movements WHERE movement_group_id = p_group_id AND is_derived AND deleted_at IS NULL;
  IF v_inc IS NOT NULL THEN
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = ANY (v_inc) AND deleted_at IS NULL;
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  END IF;
  IF v_exp IS NOT NULL THEN
    UPDATE public.expense_items SET deleted_at = now() WHERE id = ANY (v_exp) AND deleted_at IS NULL AND NOT pending_split;
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  END IF;
  UPDATE public.cash_movements SET deleted_at = now()
   WHERE movement_group_id = p_group_id AND NOT is_derived AND deleted_at IS NULL
     AND movement_type IN ('LOAN_PRINCIPAL_RECEIPT','LIABILITY_PAYMENT');
  GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  IF v_n = 0 THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการ หรือไม่มีสิทธิ์ลบ' USING ERRCODE = '22023'; END IF;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.undo_payment_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_payment_group(uuid) TO authenticated;

-- จ่ายหนี้: ผูกรายการดอกเบี้ยเข้ากลุ่มเดียวกับเงินต้น (รายการเงินที่ระบบสร้าง แก้ได้เฉพาะผ่านระบบ)
CREATE OR REPLACE FUNCTION private.set_movement_group(p_source_type text, p_source_id uuid, p_group uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  UPDATE public.cash_movements SET movement_group_id = p_group
   WHERE is_derived AND source_entity_type = p_source_type AND source_entity_id = p_source_id AND movement_group_id IS NULL;
END $$;
REVOKE ALL ON FUNCTION private.set_movement_group(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.set_movement_group(text, uuid, uuid) TO authenticated, service_role;

DO $$
DECLARE d text;
  old_txt text := '    RETURNING id INTO v_exp;
  END IF;';
  new_txt text := '    RETURNING id INTO v_exp;
    PERFORM private.set_movement_group(''EXPENSE'', v_exp, v_group);        -- ผูกดอกเบี้ยกับเงินต้นครั้งเดียวกัน
  END IF;';
BEGIN
  d := pg_get_functiondef('public.pay_liability(jsonb)'::regprocedure);
  IF position('ผูกดอกเบี้ยกับเงินต้นครั้งเดียวกัน' IN d) > 0 THEN RETURN; END IF;   -- รันซ้ำ
  IF (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 THEN
    RAISE EXCEPTION 'pay_liability: ไม่พบจุดที่ต้องแก้';
  END IF;
  EXECUTE replace(d, old_txt, new_txt);
END $$;
