-- ประกัน รอบ 8 พ.ย. 2026 (ต่อจาก #380) · ไม่ลบตาราง / คอลัมน์ · ไม่แก้ข้อมูลเดิม · รันซ้ำได้
-- 1) set_insurance_booklet_schedule: ตารางเบี้ยทั้งเล่ม (สัญญาหลัก + สัญญาเพิ่มเติม) บันทึกในคำสั่งเดียว · ผิดส่วนเดียว = ไม่บันทึกเลย
-- 2) set_insurance_cash_value_table: แก้ตารางมูลค่าเวนคืนแล้ว ยอดที่ลงตามตาราง (หลัง Go-live · ยังไม่ปิดงวด · ยอดยังเท่าตารางเดิม)
--    ขยับตามตารางใหม่ · ยอดที่แก้เอง / ตามหนังสือแจ้ง / เดือนที่ปิดแล้ว ไม่แตะ
-- 3) เงินเคลมที่เป็นรายได้ (สินไหม / ค่าชดเชย) ผูกกับเคลม: income_transactions.insurance_claim_id (เพิ่มคอลัมน์) + receive_insurance_claim
--    ยอดได้รับของเคลม = เงินคืนค่าใช้จ่ายที่ผูก + รายได้ที่ผูก · ยกเลิกเงินที่ผูกหมด → ได้รับ 0 และสถานะจ่ายบางส่วน / จ่ายครบ กลับเป็น "ยื่นแล้ว"

-- ---------------------------------------------------------------------
-- 1) ตารางเบี้ยทั้งเล่ม
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_insurance_booklet_schedule(p_parts jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_part jsonb; v_ids uuid[]; v_found integer; v_keys integer; v_total integer := 0; v_label text;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF jsonb_typeof(p_parts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_parts) = 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_parts) x
                 WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR nullif(x->>'policy_id', '') IS NULL
                    OR jsonb_typeof(x->'lines') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'INVALID: อ่านตารางเบี้ยไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_parts) > 20 THEN RAISE EXCEPTION 'INVALID: ส่วนของเล่มเกิน 20 ส่วน' USING ERRCODE = '22023'; END IF;
  SELECT array_agg(DISTINCT (x->>'policy_id')::uuid) INTO v_ids FROM jsonb_array_elements(p_parts) x;
  IF cardinality(v_ids) <> jsonb_array_length(p_parts) THEN
    RAISE EXCEPTION 'INVALID: ส่วนของเล่มซ้ำกัน' USING ERRCODE = '22023';
  END IF;
  -- เล่มเดียวกัน = บริษัท + เลขกรมธรรม์เดียวกัน (ตัดช่องว่าง · ไม่สนตัวพิมพ์ เหมือนหน้าเว็บ)
  SELECT count(*), count(DISTINCT lower(btrim(p.insurer)) || '|' || upper(regexp_replace(coalesce(p.policy_no, ''), '\s', '', 'g')))
    INTO v_found, v_keys
    FROM public.insurance_policies p WHERE p.id = ANY (v_ids) AND p.deleted_at IS NULL;
  IF v_found <> cardinality(v_ids) THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023'; END IF;
  IF cardinality(v_ids) > 1 AND (v_keys <> 1 OR EXISTS (
       SELECT 1 FROM public.insurance_policies p
        WHERE p.id = ANY (v_ids) AND nullif(regexp_replace(coalesce(p.policy_no, ''), '\s', '', 'g'), '') IS NULL)) THEN
    RAISE EXCEPTION 'INVALID: ทุกส่วนต้องอยู่ในกรมธรรม์เล่มเดียวกัน (บริษัท + เลขกรมธรรม์เดียวกัน)' USING ERRCODE = '22023';
  END IF;

  -- ทีละส่วน ด้วยกติกาเดิมของ set_insurance_schedule (งวดที่ชำระแล้วเก็บไว้ · งวดที่ยังไม่ชำระแทนทั้งชุด)
  FOR v_part IN SELECT x FROM jsonb_array_elements(p_parts) x LOOP
    v_label := left(nullif(btrim(v_part->>'label'), ''), 60);
    BEGIN
      v_total := v_total + public.set_insurance_schedule((v_part->>'policy_id')::uuid, 'PREMIUM', v_part->'lines');
    EXCEPTION WHEN sqlstate '22023' THEN
      IF v_label IS NULL THEN RAISE; END IF;
      RAISE EXCEPTION '%', regexp_replace(SQLERRM, '^INVALID: ', 'INVALID: ' || v_label || ': ') USING ERRCODE = '22023';
    END;
  END LOOP;
  RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public.set_insurance_booklet_schedule(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_insurance_booklet_schedule(jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 2) ตารางมูลค่าเวนคืน: ยอดที่ระบบลงตามตารางขยับตามตารางใหม่
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_insurance_cash_value_table(p_policy_id uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE pol public.insurance_policies; v_ccy text; v_count integer; v_old jsonb; v_updated integer := 0; v_go_live date; v_lock date;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO pol FROM public.insurance_policies WHERE id = p_policy_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID: รูปแบบตารางไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(p_lines) > 120 THEN RAISE EXCEPTION 'INVALID: ตารางยาวเกิน 120 ปี' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
              WHERE coalesce(nullif(x->>'policy_year', '')::integer, 0) NOT BETWEEN 1 AND 120
                 OR nullif(x->>'value', '') IS NULL OR (x->>'value')::numeric < 0) THEN
    RAISE EXCEPTION 'INVALID: ทุกแถวต้องมีปีกรมธรรม์ (1–120) และมูลค่าไม่ติดลบ' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT (x->>'policy_year')::integer) <> count(*) FROM jsonb_array_elements(p_lines) x) THEN
    RAISE EXCEPTION 'INVALID: ปีกรมธรรม์ซ้ำกัน' USING ERRCODE = '22023';
  END IF;
  IF pol.start_date IS NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x WHERE nullif(x->>'value_date', '') IS NULL) THEN
    RAISE EXCEPTION 'INVALID: กรมธรรม์ยังไม่มีวันเริ่มสัญญา — ใส่วันเริ่มที่ "แก้ไขข้อมูล" หรือใส่วันที่ทุกแถว' USING ERRCODE = '22023';
  END IF;
  v_ccy := coalesce(pol.insured_amount_currency, pol.premium_currency, 'THB');

  -- ตารางเดิม (ใช้เทียบว่ายอดที่ลงไว้ยังเป็นยอดตามตารางเดิมหรือไม่)
  SELECT coalesce(jsonb_agg(jsonb_build_object('policy_year', c.policy_year, 'value_date', c.value_date, 'value', c.value)), '[]'::jsonb)
    INTO v_old FROM public.insurance_cash_value_table c WHERE c.policy_id = p_policy_id AND c.deleted_at IS NULL;

  UPDATE public.insurance_cash_value_table SET deleted_at = now() WHERE policy_id = p_policy_id AND deleted_at IS NULL;
  INSERT INTO public.insurance_cash_value_table(policy_id, policy_year, value_date, value, currency, notes)
  SELECT p_policy_id, (x->>'policy_year')::integer,
         coalesce(nullif(x->>'value_date', '')::date, (pol.start_date + make_interval(years => (x->>'policy_year')::integer))::date),
         round((x->>'value')::numeric, 2), v_ccy, nullif(trim(x->>'notes'), '')
    FROM jsonb_array_elements(p_lines) x;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- ยอดที่ระบบลงตามตาราง (หมายเหตุ "ตามตาราง… ปีที่ N" · วันเดิม · ยอดยังเท่าตารางเดิม) → ยอดตามตารางใหม่ของปีนั้น (วันเดิม)
  --   ไม่แตะ: ก่อน Go-live (ยอดยกมา) · เดือนที่ปิดงวดแล้ว · ยอดที่แก้เอง (ไม่เท่าตารางเดิม) · ปีที่ถูกลบออก / ย้ายวัน
  IF pol.cash_value_asset_id IS NOT NULL THEN
    SELECT f.go_live_date INTO v_go_live FROM public.families f WHERE f.id = pol.family_id;
    v_lock := private.locked_through(pol.family_id);
    UPDATE public.asset_valuations v SET value = n.value
      FROM jsonb_to_recordset(v_old) AS o(policy_year integer, value_date date, value numeric),
           public.insurance_cash_value_table n
     WHERE n.policy_id = p_policy_id AND n.deleted_at IS NULL AND n.policy_year = o.policy_year
       AND n.value_date = o.value_date AND n.value <> o.value
       AND v.asset_id = pol.cash_value_asset_id AND v.deleted_at IS NULL
       AND v.valuation_date = o.value_date AND v.value = o.value
       AND v.notes = 'ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ' || o.policy_year
       AND v.valuation_date >= coalesce(v_go_live, '-infinity'::date)
       AND (v_lock IS NULL OR v.valuation_date > v_lock);
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('count', v_count, 'updated', v_updated, 'sync', public.sync_insurance_cash_value(p_policy_id));
END $$;
REVOKE ALL ON FUNCTION public.set_insurance_cash_value_table(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_insurance_cash_value_table(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 3) เงินเคลมที่เป็นรายได้ ผูกกับเคลม
-- ---------------------------------------------------------------------
ALTER TABLE public.income_transactions ADD COLUMN IF NOT EXISTS insurance_claim_id uuid REFERENCES public.insurance_claims(id);
CREATE INDEX IF NOT EXISTS income_claim_idx ON public.income_transactions (insurance_claim_id) WHERE insurance_claim_id IS NOT NULL;

-- ยอดได้รับของเคลม = เงินคืนค่าใช้จ่าย + รายได้ที่ผูก (ที่ยังไม่ลบ)
--   เคยผูกแต่ยกเลิกหมดแล้ว → ได้รับ 0 · สถานะจ่ายบางส่วน / จ่ายครบ กลับเป็น "ยื่นแล้ว" (ไม่เคยผูก = กรอกยอดเองได้เหมือนเดิม)
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
           status = CASE WHEN c.status NOT IN ('DRAFT','SUBMITTED','APPROVED','PARTIALLY_PAID','PAID') THEN c.status
                         WHEN c.claimed_amount IS NULL OR v_sum >= c.claimed_amount THEN 'PAID'
                         ELSE 'PARTIALLY_PAID' END
     WHERE c.id = p_claim;
  ELSIF v_ever > 0 THEN
    UPDATE public.insurance_claims c SET received_amount = 0,
           status = CASE WHEN c.status IN ('PARTIALLY_PAID','PAID') THEN 'SUBMITTED' ELSE c.status END
     WHERE c.id = p_claim AND (c.received_amount IS DISTINCT FROM 0 OR c.status IN ('PARTIALLY_PAID','PAID'));
  END IF;
END $$;

-- ยอดได้รับเป็นค่าคำนวณเมื่อมีเงินที่ผูก (เงินคืน หรือ รายได้)
CREATE OR REPLACE FUNCTION private.claim_has_reimbursements(p_claim uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.expense_reimbursements r WHERE r.insurance_claim_id = p_claim AND r.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.income_transactions i WHERE i.insurance_claim_id = p_claim AND i.deleted_at IS NULL)
$$;

CREATE OR REPLACE FUNCTION private.tg_income_claim_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.refresh_claim(OLD.insurance_claim_id);
    RETURN NULL;
  END IF;
  PERFORM private.refresh_claim(NEW.insurance_claim_id);
  IF TG_OP = 'UPDATE' AND OLD.insurance_claim_id IS DISTINCT FROM NEW.insurance_claim_id THEN
    PERFORM private.refresh_claim(OLD.insurance_claim_id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.tg_income_claim_sync() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a60_claim_sync ON public.income_transactions;
CREATE TRIGGER a60_claim_sync AFTER INSERT OR DELETE OR UPDATE OF insurance_claim_id, amount, deleted_at ON public.income_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_income_claim_sync();

-- บันทึกรับเงินเคลมที่เป็นรายได้ (สินไหม / ค่าชดเชย เช่น ค่าชดเชยนอนโรงพยาบาล) เข้าบัญชี · ผูกกับเคลม
--   เงินคืนค่าใช้จ่ายที่จ่ายไปก่อน ใช้ record_reimbursement (ลดค่าใช้จ่าย ไม่ใช่รายได้) เหมือนเดิม
CREATE OR REPLACE FUNCTION public.receive_insurance_claim(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c public.insurance_claims; pol public.insurance_policies;
  v_date date := nullif(p->>'date', '')::date; v_amount numeric := nullif(p->>'amount', '')::numeric;
  v_bank uuid := nullif(p->>'bank_asset_id', '')::uuid; v_person uuid := nullif(p->>'person_id', '')::uuid;
  v_notes text := nullif(btrim(p->>'notes'), ''); v_ccy text; v_got numeric; v_id uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT * INTO c FROM public.insurance_claims WHERE id = nullif(p->>'claim_id', '')::uuid AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบเคลม' USING ERRCODE = '22023'; END IF;
  IF c.status IN ('REJECTED','CANCELLED') THEN RAISE EXCEPTION 'INVALID: เคลมนี้ถูกปฏิเสธ / ยกเลิกแล้ว' USING ERRCODE = '22023'; END IF;
  SELECT * INTO pol FROM public.insurance_policies WHERE id = c.policy_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์ของเคลมนี้' USING ERRCODE = '22023'; END IF;
  IF v_date IS NULL OR v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่รับไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดที่ได้รับ' USING ERRCODE = '22023'; END IF;
  IF v_bank IS NULL OR NOT private.is_bank_asset(v_bank) THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่รับเงิน' USING ERRCODE = '22023'; END IF;
  SELECT currency INTO v_ccy FROM public.assets WHERE id = v_bank;
  IF v_ccy IS DISTINCT FROM c.currency THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีที่รับต้องสกุลเดียวกับเคลม (%)', c.currency USING ERRCODE = '22023';
  END IF;
  v_got := coalesce(c.received_amount, 0);
  IF c.claimed_amount IS NOT NULL AND v_got + v_amount > c.claimed_amount + 0.005 THEN
    RAISE EXCEPTION 'INVALID: เกินยอดเคลม (รอรับอีก % %)', round(greatest(c.claimed_amount - v_got, 0), 2), c.currency USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.income_transactions(family_id, person_id, received_to_asset_id, date, income_type, amount, currency, notes, insurance_claim_id)
  VALUES (pol.family_id, coalesce(v_person, pol.person_id, pol.payer_person_id), v_bank, v_date, 'INSURANCE_BENEFIT', round(v_amount, 2), v_ccy,
          concat_ws(' · ', 'เงินเคลมประกัน ' || pol.insurer || coalesce(' ' || pol.policy_no, ''), 'ยื่น ' || to_char(c.claim_date, 'DD/MM/YYYY'), v_notes),
          c.id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.receive_insurance_claim(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_insurance_claim(jsonb) TO authenticated;
