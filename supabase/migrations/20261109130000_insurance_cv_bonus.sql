-- =====================================================================
-- ประกัน: โบนัส (ไม่การันตี) ในมูลค่าเวนคืน (ตกลง 9 พ.ย. 2026)
--   กรมธรรม์แบบมีเงินปันผล / โบนัสปลายสัญญา (เช่น ประกันต่างประเทศ) มูลค่าเวนคืนจริง = ส่วนที่การันตี + โบนัส
--   ★ มูลค่าใน Net Worth ยังเป็นยอดรวมก้อนเดียว (asset_valuations.value) เหมือนเดิม
--     asset_valuations.bonus_part = ส่วนที่เป็นโบนัสของยอดนั้น (ไม่มี / 0 = NULL) · ส่วนการันตี = value − bonus_part
--     ใส่ได้เฉพาะมูลค่าเวนคืนของกรมธรรม์ (INSURANCE_CASH_VALUE) · ต้องไม่เกินยอดรวม
--   ระบบลงยอดตามตารางในสัญญา (ทุกวันครบรอบปีกรมธรรม์ · ปุ่มลงยอด · แก้ตาราง) = ยอดตามตาราง + โบนัสล่าสุด
--     (ยกโบนัสของยอดล่าสุดก่อนวันนั้นมาบวก จนกว่าจะกรอกยอดใหม่จากหนังสือแจ้ง) · ไม่มีโบนัส = เหมือนเดิมทุกอย่าง
--   เพิ่มคอลัมน์ + ฟังก์ชันเท่านั้น · ไม่แก้ / ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

ALTER TABLE public.asset_valuations ADD COLUMN IF NOT EXISTS bonus_part public.d_money;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'av_bonus_part_ck' AND conrelid = 'public.asset_valuations'::regclass) THEN
    ALTER TABLE public.asset_valuations ADD CONSTRAINT av_bonus_part_ck
      CHECK (bonus_part IS NULL OR (bonus_part > 0 AND bonus_part <= value));
  END IF;
END $$;

-- โบนัสใส่ได้เฉพาะมูลค่าเวนคืนของกรมธรรม์
CREATE OR REPLACE FUNCTION private.tg_valuation_bonus_check() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.bonus_part IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.id = NEW.asset_id AND a.asset_type = 'INSURANCE_CASH_VALUE') THEN
    RAISE EXCEPTION 'INVALID: โบนัสใส่ได้เฉพาะมูลค่าเวนคืนของกรมธรรม์' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t52_bonus_check ON public.asset_valuations;
CREATE TRIGGER t52_bonus_check BEFORE INSERT OR UPDATE OF bonus_part, asset_id ON public.asset_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_valuation_bonus_check();

-- โบนัสของยอดล่าสุด ณ วันนั้น (ลำดับเดียวกับมูลค่าล่าสุด) · ไม่มี = NULL
CREATE OR REPLACE FUNCTION private.cv_latest_bonus(p_asset uuid, p_as_of date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT (private.latest_asset_valuation(p_asset, p_as_of)).bonus_part
$$;
REVOKE ALL ON FUNCTION private.cv_latest_bonus(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.cv_latest_bonus(uuid, date) TO authenticated, service_role;

-- ---------------------------------------------------------------- 1) ปุ่มลงยอดตามตาราง (ต่อกรมธรรม์)
CREATE OR REPLACE FUNCTION public.sync_insurance_cash_value(p_policy_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  pol public.insurance_policies; v_go_live date; v_lock date; v_last date;
  r record; v_added integer := 0; v_created boolean := false; v_val numeric; v_date date; v_year integer; v_bonus numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT * INTO pol FROM public.insurance_policies WHERE id = p_policy_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023'; END IF;
  IF pol.status <> 'ACTIVE' THEN RETURN jsonb_build_object('added', 0, 'created', false); END IF;
  SELECT go_live_date INTO v_go_live FROM public.families WHERE id = pol.family_id;
  v_lock := private.locked_through(pol.family_id);

  IF pol.cash_value_asset_id IS NULL THEN
    IF NOT private.has_role('ADMIN','EDITOR') THEN RETURN jsonb_build_object('added', 0, 'created', false); END IF;
    SELECT c.policy_year, c.value_date, c.value INTO v_year, v_date, v_val
      FROM public.insurance_cash_value_table c
     WHERE c.policy_id = p_policy_id AND c.deleted_at IS NULL AND c.value_date <= current_date
       AND (v_lock IS NULL OR c.value_date > v_lock)
       AND NOT EXISTS (SELECT 1 FROM public.v_insurance_schedule_status s
                        WHERE s.policy_id = p_policy_id AND s.kind = 'PREMIUM' AND s.due_date < c.value_date AND s.status NOT IN ('PAID','HISTORY','SKIPPED'))
     ORDER BY c.value_date DESC LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('added', 0, 'created', false); END IF;
    PERFORM public.add_insurance_cash_value(p_policy_id, jsonb_build_object(
      'value', v_val, 'valuation_date', v_date, 'notes', 'ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ' || v_year));
    RETURN jsonb_build_object('added', 1, 'created', true, 'value', v_val, 'date', v_date, 'policy_year', v_year);
  END IF;

  SELECT max(v.valuation_date) INTO v_last FROM public.asset_valuations v
   WHERE v.asset_id = pol.cash_value_asset_id AND v.deleted_at IS NULL;
  FOR r IN
    SELECT c.policy_year, c.value_date, c.value FROM public.insurance_cash_value_table c
     WHERE c.policy_id = p_policy_id AND c.deleted_at IS NULL AND c.value_date <= current_date
       AND c.value_date >= coalesce(v_go_live, '-infinity'::date) AND (v_lock IS NULL OR c.value_date > v_lock)
       AND (v_last IS NULL OR c.value_date > v_last)
       AND NOT EXISTS (SELECT 1 FROM public.v_insurance_schedule_status s
                        WHERE s.policy_id = p_policy_id AND s.kind = 'PREMIUM' AND s.due_date < c.value_date AND s.status NOT IN ('PAID','HISTORY','SKIPPED'))
     ORDER BY c.value_date
  LOOP
    v_bonus := private.cv_latest_bonus(pol.cash_value_asset_id, r.value_date);
    INSERT INTO public.asset_valuations(asset_id, valuation_date, value, bonus_part, valuation_method, source, notes)
    VALUES (pol.cash_value_asset_id, r.value_date, r.value + coalesce(v_bonus, 0), v_bonus, 'STATEMENT', 'STATEMENT',
            'ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ' || r.policy_year);
    v_added := v_added + 1; v_val := r.value + coalesce(v_bonus, 0); v_date := r.value_date; v_year := r.policy_year;
  END LOOP;
  RETURN jsonb_build_object('added', v_added, 'created', v_created, 'value', v_val, 'date', v_date, 'policy_year', v_year);
END $$;
REVOKE ALL ON FUNCTION public.sync_insurance_cash_value(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_insurance_cash_value(uuid) TO authenticated;

-- ---------------------------------------------------------------- 2) งานประจำวัน (ลงยอดตามตารางทุกกรมธรรม์)
CREATE OR REPLACE FUNCTION public.server_sync_insurance_cash_values()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_job bigint; v_added integer := 0; v_created integer := 0; v_errors integer := 0; v_policies integer := 0;
  pol record; p public.insurance_policies; r record;
  v_go_live date; v_lock date; v_last date; v_n integer;
  v_year integer; v_date date; v_val numeric; v_cv uuid; v_opening boolean; v_notes text; v_bonus numeric;
BEGIN
  INSERT INTO public.system_job_runs(job_type, result) VALUES ('INSURANCE_CV', 'RUNNING') RETURNING id INTO v_job;

  -- 1) ยังไม่มีมูลค่าเวนคืน แต่มีตารางที่ถึงวันแล้ว → สร้างจากปีล่าสุดที่เข้าเงื่อนไข
  FOR pol IN
    SELECT i.id FROM public.insurance_policies i
     WHERE i.deleted_at IS NULL AND i.status = 'ACTIVE' AND i.cash_value_asset_id IS NULL
       AND coalesce(i.person_id, i.payer_person_id) IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.insurance_cash_value_table c
                    WHERE c.policy_id = i.id AND c.deleted_at IS NULL AND c.value_date <= current_date)
  LOOP
    BEGIN
      SELECT * INTO p FROM public.insurance_policies
       WHERE id = pol.id AND deleted_at IS NULL AND status = 'ACTIVE' AND cash_value_asset_id IS NULL FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      v_lock := private.locked_through(p.family_id);
      SELECT c.policy_year, c.value_date, c.value INTO v_year, v_date, v_val
        FROM public.insurance_cash_value_table c
       WHERE c.policy_id = p.id AND c.deleted_at IS NULL AND c.value_date <= current_date
         AND (v_lock IS NULL OR c.value_date > v_lock)
         AND NOT EXISTS (SELECT 1 FROM public.v_insurance_schedule_status s
                          WHERE s.policy_id = p.id AND s.kind = 'PREMIUM' AND s.due_date < c.value_date AND s.status NOT IN ('PAID','HISTORY','SKIPPED'))
       ORDER BY c.value_date DESC LIMIT 1;
      IF NOT FOUND THEN CONTINUE; END IF;

      SELECT go_live_date INTO v_go_live FROM public.families WHERE id = p.family_id;
      v_opening := v_date < v_go_live;
      v_notes := 'ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ' || v_year;
      INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency, acquisition_date, notes)
      VALUES (p.family_id, 'FINANCIAL', 'INSURANCE_CASH_VALUE',
              'มูลค่าเวนคืน ' || p.insurer || coalesce(' ' || nullif(p.policy_no, ''), ''),
              coalesce(p.insured_amount_currency, p.premium_currency, 'THB'),
              CASE WHEN NOT v_opening THEN v_date END, v_notes)
      RETURNING id INTO v_cv;
      INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
      VALUES (v_cv, coalesce(p.person_id, p.payer_person_id), 100, v_date);
      INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening, notes)
      VALUES (v_cv, v_date, v_val, 'STATEMENT', CASE WHEN v_opening THEN 'OPENING' ELSE 'STATEMENT' END, v_opening, v_notes);
      UPDATE public.insurance_policies SET has_cash_value = true, cash_value_asset_id = v_cv WHERE id = p.id;
      v_created := v_created + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
    END;
  END LOOP;

  -- 2) มีมูลค่าเวนคืนแล้ว → ลงปีที่ถึงวันแล้วและยังไม่ได้ลง · ยกโบนัสล่าสุดมาบวก (ถ้ามี)
  FOR pol IN
    SELECT i.id, i.family_id, i.cash_value_asset_id
      FROM public.insurance_policies i
      JOIN public.assets a ON a.id = i.cash_value_asset_id AND a.deleted_at IS NULL AND a.status = 'ACTIVE'
     WHERE i.deleted_at IS NULL AND i.status = 'ACTIVE'
       AND EXISTS (SELECT 1 FROM public.insurance_cash_value_table c
                    WHERE c.policy_id = i.id AND c.deleted_at IS NULL AND c.value_date <= current_date)
  LOOP
    SELECT go_live_date INTO v_go_live FROM public.families WHERE id = pol.family_id;
    v_lock := private.locked_through(pol.family_id);
    SELECT max(v.valuation_date) INTO v_last FROM public.asset_valuations v
     WHERE v.asset_id = pol.cash_value_asset_id AND v.deleted_at IS NULL;
    v_n := 0;
    FOR r IN
      SELECT c.policy_year, c.value_date, c.value FROM public.insurance_cash_value_table c
       WHERE c.policy_id = pol.id AND c.deleted_at IS NULL AND c.value_date <= current_date
         AND c.value_date >= coalesce(v_go_live, '-infinity'::date) AND (v_lock IS NULL OR c.value_date > v_lock)
         AND (v_last IS NULL OR c.value_date > v_last)
         AND NOT EXISTS (SELECT 1 FROM public.v_insurance_schedule_status s
                          WHERE s.policy_id = pol.id AND s.kind = 'PREMIUM' AND s.due_date < c.value_date AND s.status NOT IN ('PAID','HISTORY','SKIPPED'))
       ORDER BY c.value_date
    LOOP
      v_bonus := private.cv_latest_bonus(pol.cash_value_asset_id, r.value_date);
      INSERT INTO public.asset_valuations(asset_id, valuation_date, value, bonus_part, valuation_method, source, notes)
      VALUES (pol.cash_value_asset_id, r.value_date, r.value + coalesce(v_bonus, 0), v_bonus, 'STATEMENT', 'STATEMENT',
              'ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ' || r.policy_year);
      v_n := v_n + 1;
    END LOOP;
    IF v_n > 0 THEN v_added := v_added + v_n; v_policies := v_policies + 1; END IF;
  END LOOP;

  UPDATE public.system_job_runs SET result = 'SUCCESS', finished_at = now(),
         details = jsonb_build_object('added', v_added, 'created', v_created, 'policies', v_policies, 'errors', v_errors) WHERE id = v_job;
  RETURN v_added + v_created;
END $$;
REVOKE ALL ON FUNCTION public.server_sync_insurance_cash_values() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_sync_insurance_cash_values() TO service_role;

-- ---------------------------------------------------------------- 3) แก้ตารางมูลค่าเวนคืน → ยอดที่ระบบลงตามตารางเปลี่ยนตาม (คงโบนัสของยอดนั้น)
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

  -- ยอดที่ระบบลงตามตาราง (หมายเหตุ "ตามตาราง… ปีที่ N" · วันเดิม · ส่วนการันตียังเท่าตารางเดิม) → ยอดตามตารางใหม่ของปีนั้น + โบนัสเดิมของยอดนั้น (วันเดิม)
  --   ไม่แตะ: ก่อน Go-live (ยอดยกมา) · เดือนที่ปิดงวดแล้ว · ยอดที่แก้เอง (ไม่เท่าตารางเดิม) · ปีที่ถูกลบออก / ย้ายวัน
  IF pol.cash_value_asset_id IS NOT NULL THEN
    SELECT f.go_live_date INTO v_go_live FROM public.families f WHERE f.id = pol.family_id;
    v_lock := private.locked_through(pol.family_id);
    UPDATE public.asset_valuations v SET value = n.value + coalesce(v.bonus_part, 0)
      FROM jsonb_to_recordset(v_old) AS o(policy_year integer, value_date date, value numeric),
           public.insurance_cash_value_table n
     WHERE n.policy_id = p_policy_id AND n.deleted_at IS NULL AND n.policy_year = o.policy_year
       AND n.value_date = o.value_date AND n.value <> o.value
       AND v.asset_id = pol.cash_value_asset_id AND v.deleted_at IS NULL
       AND v.valuation_date = o.value_date AND v.value - coalesce(v.bonus_part, 0) = o.value
       AND v.notes = 'ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ' || o.policy_year
       AND v.valuation_date >= coalesce(v_go_live, '-infinity'::date)
       AND (v_lock IS NULL OR v.valuation_date > v_lock);
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('count', v_count, 'updated', v_updated, 'sync', public.sync_insurance_cash_value(p_policy_id));
END $$;
REVOKE ALL ON FUNCTION public.set_insurance_cash_value_table(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_insurance_cash_value_table(uuid, jsonb) TO authenticated;
