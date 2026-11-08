-- =====================================================================
-- ประกัน: งานประจำวันสร้างมูลค่าเวนคืนจากตารางตามสัญญาให้ด้วย (ตกลง 8 พ.ย. 2026)
--   เดิม server_sync_insurance_cash_values ลงยอดเฉพาะกรมธรรม์ที่มีมูลค่าเวนคืนอยู่แล้ว
--   เลิกใช้ปุ่มติ๊ก "มีมูลค่าเวนคืน" ในฟอร์มเพิ่มกรมธรรม์ → กรมธรรม์ที่มีตารางแต่ยังไม่มีมูลค่าเวนคืน
--   ต้องสร้างได้เองเมื่อถึงปีแรกในตาราง แม้ไม่มีการจ่ายเบี้ย / บันทึกตารางหลังวันนั้น
--   (เช่น จ่ายเบี้ยก่อนวันครบปี หรือจ่ายเบี้ยครบหมดแล้ว)
--
--   เงื่อนไขเดียวกับ sync_insurance_cash_value (ตอนบันทึกตาราง / จ่ายเบี้ย):
--     กรมธรรม์ที่มีผล · ปีล่าสุดในตารางที่ถึงวันแล้ว · ไม่อยู่ในเดือนที่ปิดงวด · เบี้ยก่อนวันนั้นจ่ายครบ (จ่าย / ประวัติ / ไม่ได้จ่าย)
--     เจ้าของ = ผู้เอาประกัน (ไม่มี = ผู้จ่ายเบี้ย · ไม่มีทั้งคู่ = ข้าม) 100% · ก่อน Go-live = ยอดยกมา
--   กรมธรรม์ที่สร้างไม่สำเร็จ = ข้ามไป (บันทึกจำนวนไว้ใน details.errors) ไม่ทำให้ทั้งงานล้ม
--   คืนค่า = จำนวนยอดที่ลง (รวมที่สร้างใหม่) · details: added, created, policies, errors
--   ★ แก้เฉพาะฟังก์ชัน · ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้ · ต้องรันหลัง 20261102000600
-- =====================================================================

CREATE OR REPLACE FUNCTION public.server_sync_insurance_cash_values()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_job bigint; v_added integer := 0; v_created integer := 0; v_errors integer := 0; v_policies integer := 0;
  pol record; p public.insurance_policies; r record;
  v_go_live date; v_lock date; v_last date; v_n integer;
  v_year integer; v_date date; v_val numeric; v_cv uuid; v_opening boolean; v_notes text;
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

  -- 2) มีมูลค่าเวนคืนแล้ว → ลงปีที่ถึงวันแล้วและยังไม่ได้ลง (เหมือนเดิม)
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
      INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
      VALUES (pol.cash_value_asset_id, r.value_date, r.value, 'STATEMENT', 'STATEMENT',
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
