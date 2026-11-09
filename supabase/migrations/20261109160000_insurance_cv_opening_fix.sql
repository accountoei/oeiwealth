-- =====================================================================
-- ประกัน: มูลค่าเวนคืนที่ระบบสร้างครั้งแรก ต้องมียอดตั้งต้นถ้าในตารางมีปีที่ครบก่อน Go-live (ตกลง 9 พ.ย. 2026)
--   ปัญหา: ตอนสร้างครั้งแรก (งานประจำวัน / ปุ่มลงยอด / บันทึกตาราง) ระบบหยิบ "ปีล่าสุดที่ถึงวันแล้ว"
--     ถ้าปีนั้นครบหลัง Go-live (เช่น ครบปี ต.ค. – พ.ย.) → ตั้งเป็น "ได้มาหลัง Go-live" ทั้งที่ปีก่อนหน้าครบก่อน Go-live แล้ว
--     → Net Worth ณ วันตั้งต้นขาดมูลค่าเวนคืน · หน้าเตรียม Go-live แสดง "ไม่ต้องมี"
--   แก้: 1) ตอนสร้างครั้งแรก ถ้ามีปีที่ครบก่อน Go-live → ใช้ปีล่าสุดก่อน Go-live เป็นยอดตั้งต้น แล้วลงปีหลัง Go-live ต่อตามปกติ
--        2) ซ่อมรายการที่สร้างผิดไปแล้ว (เจ้าของอนุมัติ "ทำเลย" 9 พ.ย. 2026) — เฉพาะที่เข้าเงื่อนไขทุกข้อ:
--           มูลค่าเวนคืนของกรมธรรม์ · ระบบสถานะ SETUP · วันที่ได้มา ≥ Go-live · ยังไม่มียอดตั้งต้น
--           · ยอดแรกเป็นยอดที่ระบบลงตามตาราง (หมายเหตุ "ตามตาราง…") · ตารางมีปีที่ครบก่อน Go-live
--           → เพิ่มยอดตั้งต้น (ปีล่าสุดก่อน Go-live) · ล้างวันที่ได้มา · เลื่อนวันเริ่มถือครองเป็นวันนั้น
--           ยอดหลัง Go-live ที่ลงไว้แล้ว เก็บไว้เหมือนเดิม · ไม่ลบข้อมูลใด
--   ★ รันซ้ำได้ (รอบสองไม่มีรายการเข้าเงื่อนไข) · ต้องรันหลัง 20261109130000
-- =====================================================================

-- ---------------------------------------------------------------- 1) ปุ่มลงยอดตามตาราง / บันทึกตาราง (ต่อกรมธรรม์)
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
     ORDER BY (c.value_date < coalesce(v_go_live, '-infinity'::date)) DESC, c.value_date DESC LIMIT 1;  -- มีปีก่อน Go-live = ใช้ปีล่าสุดก่อน Go-live เป็นยอดตั้งต้น
    IF NOT FOUND THEN RETURN jsonb_build_object('added', 0, 'created', false); END IF;
    pol.cash_value_asset_id := public.add_insurance_cash_value(p_policy_id, jsonb_build_object(
      'value', v_val, 'valuation_date', v_date, 'notes', 'ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ' || v_year));
    v_created := true; v_added := 1;
    -- ไม่จบตรงนี้: ลงปีที่ครบหลัง Go-live ต่อด้านล่าง (กรณีเพิ่งสร้างยอดตั้งต้นจากปีก่อน Go-live)
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

-- ---------------------------------------------------------------- 2) งานประจำวัน
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
      SELECT go_live_date INTO v_go_live FROM public.families WHERE id = p.family_id;
      SELECT c.policy_year, c.value_date, c.value INTO v_year, v_date, v_val
        FROM public.insurance_cash_value_table c
       WHERE c.policy_id = p.id AND c.deleted_at IS NULL AND c.value_date <= current_date
         AND (v_lock IS NULL OR c.value_date > v_lock)
         AND NOT EXISTS (SELECT 1 FROM public.v_insurance_schedule_status s
                          WHERE s.policy_id = p.id AND s.kind = 'PREMIUM' AND s.due_date < c.value_date AND s.status NOT IN ('PAID','HISTORY','SKIPPED'))
       ORDER BY (c.value_date < coalesce(v_go_live, '-infinity'::date)) DESC, c.value_date DESC LIMIT 1;  -- มีปีก่อน Go-live = ใช้ปีล่าสุดก่อน Go-live เป็นยอดตั้งต้น
      IF NOT FOUND THEN CONTINUE; END IF;

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

-- ---------------------------------------------------------------- 3) ซ่อมรายการที่สร้างผิดไปแล้ว
CREATE OR REPLACE FUNCTION private.repair_cv_opening()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; v_fixed integer := 0;
BEGIN
  FOR r IN
    SELECT a.id AS asset_id, a.acquisition_date, f.go_live_date, t.policy_year, t.value_date, t.value
      FROM public.insurance_policies i
      JOIN public.assets a ON a.id = i.cash_value_asset_id AND a.deleted_at IS NULL AND a.asset_type = 'INSURANCE_CASH_VALUE'
      JOIN public.families f ON f.id = a.family_id AND f.system_status = 'SETUP'
      CROSS JOIN LATERAL (
        SELECT c.policy_year, c.value_date, c.value FROM public.insurance_cash_value_table c
         WHERE c.policy_id = i.id AND c.deleted_at IS NULL AND c.value_date < f.go_live_date
         ORDER BY c.value_date DESC LIMIT 1) t
     WHERE i.deleted_at IS NULL
       AND a.acquisition_date >= f.go_live_date
       AND NOT EXISTS (SELECT 1 FROM public.asset_valuations v WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.is_opening)
       AND (SELECT v.notes FROM public.asset_valuations v WHERE v.asset_id = a.id AND v.deleted_at IS NULL
             ORDER BY v.valuation_date, v.created_at LIMIT 1) LIKE 'ตามตารางมูลค่าเวนคืนในสัญญา%'
  LOOP
    UPDATE public.assets SET acquisition_date = NULL WHERE id = r.asset_id;
    UPDATE public.asset_ownerships SET start_date = r.value_date
     WHERE asset_id = r.asset_id AND start_date = r.acquisition_date;
    INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening, notes)
    VALUES (r.asset_id, r.value_date, r.value, 'STATEMENT', 'OPENING', true,
            'ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ' || r.policy_year);
    v_fixed := v_fixed + 1;
  END LOOP;
  IF v_fixed > 0 THEN   -- ให้หน้าที่จำผลไว้ (Dashboard ฯลฯ) คำนวณใหม่
    INSERT INTO public.system_job_runs(job_type, result, finished_at, details)
    VALUES ('INSURANCE_CV', 'SUCCESS', now(), jsonb_build_object('opening_fixed', v_fixed));
  END IF;
  RETURN v_fixed;
END $$;
REVOKE ALL ON FUNCTION private.repair_cv_opening() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.repair_cv_opening() TO service_role;

DO $$ BEGIN RAISE NOTICE 'มูลค่าเวนคืน: เพิ่มยอดตั้งต้นให้ % รายการ', private.repair_cv_opening(); END $$;
