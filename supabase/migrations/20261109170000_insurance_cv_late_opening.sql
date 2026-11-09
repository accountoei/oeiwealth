-- =====================================================================
-- ประกัน: มูลค่าเวนคืนที่ใส่ยอดเองลงวันที่หลัง Go-live ทั้งที่ยอดนั้นเป็นของปีกรมธรรม์ที่ครบก่อน Go-live (ตกลง 9 พ.ย. 2026)
--   เช่น ตารางปีที่ 9 ครบ 20 ก.ค. (ก่อน Go-live) แต่บันทึกยอดเดียวกันไว้ลงวันที่ 12 ต.ค. (หลัง Go-live)
--   → ระบบถือว่า "ได้มาหลัง Go-live" · ยอดตั้งต้นหาย · หน้าเตรียม Go-live ขึ้น "ไม่ต้องมี"
--   ซ่อม (เจ้าของอนุมัติ "ทำเลย" 9 พ.ย. 2026) — เฉพาะที่เข้าเงื่อนไขทุกข้อ:
--     มูลค่าเวนคืนของกรมธรรม์ · ระบบสถานะ SETUP · วันที่ได้มา ≥ Go-live · ยังไม่มียอดตั้งต้น
--     · มียอดเดียว · ยอดนั้นเท่ากับยอดในตารางของปีล่าสุดที่ครบก่อน Go-live
--   → เพิ่มยอดตั้งต้นเท่าเดิม ณ วันก่อน Go-live (เหมือนมูลค่าเวนคืนฉบับอื่น) · ลบยอดเดิมแบบ soft delete (ย้อนได้)
--     · ล้างวันที่ได้มา · เลื่อนวันเริ่มถือครองเป็นวันเดียวกัน
--   ★ รันซ้ำได้ (รอบสองไม่มีรายการเข้าเงื่อนไข) · ต้องรันหลัง 20261109160000
-- =====================================================================

CREATE OR REPLACE FUNCTION private.repair_cv_late_opening()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; v_fixed integer := 0;
BEGIN
  FOR r IN
    SELECT a.id AS asset_id, a.acquisition_date, f.go_live_date, t.policy_year, v.id AS val_id, v.value, v.notes
      FROM public.insurance_policies i
      JOIN public.assets a ON a.id = i.cash_value_asset_id AND a.deleted_at IS NULL AND a.asset_type = 'INSURANCE_CASH_VALUE'
      JOIN public.families f ON f.id = a.family_id AND f.system_status = 'SETUP'
      JOIN public.asset_valuations v ON v.asset_id = a.id AND v.deleted_at IS NULL
      CROSS JOIN LATERAL (
        SELECT c.policy_year, c.value FROM public.insurance_cash_value_table c
         WHERE c.policy_id = i.id AND c.deleted_at IS NULL AND c.value_date < f.go_live_date
         ORDER BY c.value_date DESC LIMIT 1) t
     WHERE i.deleted_at IS NULL
       AND a.acquisition_date >= f.go_live_date
       AND (SELECT count(*) FROM public.asset_valuations x WHERE x.asset_id = a.id AND x.deleted_at IS NULL) = 1
       AND NOT v.is_opening
       AND v.value = t.value
  LOOP
    UPDATE public.asset_valuations SET deleted_at = now() WHERE id = r.val_id;
    UPDATE public.assets SET acquisition_date = NULL WHERE id = r.asset_id;
    UPDATE public.asset_ownerships SET start_date = r.go_live_date - 1
     WHERE asset_id = r.asset_id AND start_date = r.acquisition_date;
    INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening, notes)
    VALUES (r.asset_id, r.go_live_date - 1, r.value, 'STATEMENT', 'OPENING', true,
            coalesce(r.notes, 'ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ' || r.policy_year));
    v_fixed := v_fixed + 1;
  END LOOP;
  IF v_fixed > 0 THEN   -- ให้หน้าที่จำผลไว้ (Dashboard ฯลฯ) คำนวณใหม่
    INSERT INTO public.system_job_runs(job_type, result, finished_at, details)
    VALUES ('INSURANCE_CV', 'SUCCESS', now(), jsonb_build_object('late_opening_fixed', v_fixed));
  END IF;
  RETURN v_fixed;
END $$;
REVOKE ALL ON FUNCTION private.repair_cv_late_opening() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.repair_cv_late_opening() TO service_role;

DO $$ BEGIN RAISE NOTICE 'มูลค่าเวนคืน: ย้ายเป็นยอดตั้งต้น % รายการ', private.repair_cv_late_opening(); END $$;
