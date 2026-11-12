-- =====================================================================
-- ล้างข้อมูลทดสอบก่อนลงข้อมูลจริง (เจ้าของตอบ "ทำเลยตามที่แนะนำ" 12 พ.ย. 2026)
--   ไฟล์นี้ "ไม่ใช่ migration": รันครั้งเดียวใน Supabase SQL Editor โดยเจ้าของ · ย้อนกลับไม่ได้
--   (อยู่นอก supabase/migrations/ เพื่อไม่ให้ไปรันตอนติดตั้งระบบใหม่)
--
--   เก็บไว้ (ไม่แตะ):
--     - ผู้ใช้ (app_users + บัญชี login / MFA / สิทธิ์)  - สมาชิกครอบครัว (persons) + รูปครอบครัว (families.photo)
--     - ตั้งค่าครอบครัว (families: ชื่อ / วัน Go-live)  - หมวดหมู่ (asset_categories / ie_categories)
--     - อัตราแลกเปลี่ยน (fx_rates) · ดัชนี CPI (cpi_annual) · กฎความครบของข้อมูล (data_completeness_rules)
--     - ประวัติงานเบื้องหลัง (system_job_runs) · การเชื่อม Google Drive (private.drive_settings) · กุญแจใน Vault
--   ล้าง: ตารางอื่นทุกตารางใน public (ทุกเมนู รวมแท็บ สุขภาพ / สมาชิกภาพ / บัตร / บริจาค / ภาษี ของเมนู Family,
--         เอกสาร (ไฟล์ใน Google Drive ยังอยู่ · ลิงก์ในระบบหายไป), เดือนที่ปิด, ยอดสิ้นเดือนอัตโนมัติ)
--   ประวัติการแก้ไข (audit_logs): ลบเฉพาะแถวของตารางที่ล้าง · เก็บแถวของผู้ใช้ / สมาชิก / ตั้งค่า / Go-live
--   ระบบกลับเป็น SETUP (วัน Go-live คงเดิม) ถ้ายังเป็น LIVE อยู่
--   ใช้ TRUNCATE (ไม่ผ่าน Trigger ล็อกงวด / ล็อก Go-live / ห้ามลบจริง) ในบล็อกเดียว → ล้มเหลวกลางทาง = ไม่มีอะไรเปลี่ยน
--   ท้ายบล็อกตรวจเองว่าตารางที่ล้างเหลือ 0 แถวทุกตาราง ไม่อย่างนั้นยกเลิกทั้งหมด
-- =====================================================================
DO $$
DECLARE
  v_keep text[] := ARRAY['app_users', 'asset_categories', 'audit_logs', 'cpi_annual', 'data_completeness_rules',
                         'families', 'fx_rates', 'ie_categories', 'persons', 'system_job_runs'];
  v_wipe text[];
  v_list text;
  v_audit integer;
  v_left text;
  f public.families;
BEGIN
  IF (SELECT count(*) FROM public.families) <> 1 THEN
    RAISE EXCEPTION 'หยุด: ต้องมีครอบครัวเดียวในระบบ';
  END IF;

  SELECT array_agg(c.relname ORDER BY c.relname) INTO v_wipe
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> ALL (v_keep);
  SELECT string_agg(format('public.%I', t), ', ') INTO v_list FROM unnest(v_wipe) t;

  -- 1) ล้างข้อมูลทุกเมนู (ตารางที่เก็บไว้ไม่มี Foreign key ชี้มาที่ตารางเหล่านี้ → ไม่ใช้ CASCADE)
  EXECUTE 'TRUNCATE ' || v_list;

  -- 2) ประวัติการแก้ไขของข้อมูลที่ล้าง (audit_logs ปกติแก้ / ลบไม่ได้ → ปิด Trigger ชั่วคราวในบล็อกนี้)
  ALTER TABLE public.audit_logs DISABLE TRIGGER t00_audit_immutable;
  DELETE FROM public.audit_logs WHERE entity_type = ANY (v_wipe);
  GET DIAGNOSTICS v_audit = ROW_COUNT;
  ALTER TABLE public.audit_logs ENABLE TRIGGER t00_audit_immutable;

  -- 3) กลับเป็น SETUP (ทางเดียวกับปุ่มยกเลิก Go-live)
  SELECT * INTO f FROM public.families;
  IF f.system_status = 'LIVE' THEN
    PERFORM set_config('fwv.cancel_go_live', 'on', true);
    UPDATE public.families SET system_status = 'SETUP', go_live_confirmed_at = NULL, go_live_confirmed_by = NULL
     WHERE id = f.id;
    PERFORM set_config('fwv.cancel_go_live', 'off', true);
  END IF;

  -- 4) หน้าเว็บที่จำผลคำนวณไว้ (Dashboard ฯลฯ) ต้องคำนวณใหม่ → เพิ่มแถวงานเบื้องหลัง (ป้าย data_version เปลี่ยน)
  INSERT INTO public.system_job_runs(job_type, started_at, finished_at, result, details)
  VALUES ('MONTH_AUTO', now(), now(), 'SUCCESS', jsonb_build_object('note', 'ล้างข้อมูลทดสอบ', 'tables', cardinality(v_wipe)));

  PERFORM private.write_audit('HARD_DELETE', 'families', f.id::text,
          jsonb_build_object('note', 'ล้างข้อมูลทดสอบ', 'tables', cardinality(v_wipe), 'audit_rows_removed', v_audit,
                             'was_status', f.system_status, 'go_live_date', f.go_live_date), f.id);

  -- 5) ตรวจ: ทุกตารางที่ล้างต้องเหลือ 0 แถว
  SELECT string_agg(t, ', ') INTO v_left FROM unnest(v_wipe) t
   WHERE (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', t), false, true, '')))[1]::text::int > 0;
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'หยุด: ยังมีข้อมูลค้างใน %', v_left;
  END IF;

  RAISE NOTICE 'ล้างแล้ว % ตาราง · ลบประวัติการแก้ไข % แถว · สถานะ %', cardinality(v_wipe), v_audit,
    (SELECT system_status FROM public.families);
END $$;

-- ผลหลังล้าง (แสดงในช่อง Results)
SELECT (SELECT system_status FROM public.families) AS "สถานะ",
       (SELECT go_live_date FROM public.families) AS "วัน Go-live",
       (SELECT count(*) FROM public.persons WHERE deleted_at IS NULL) AS "สมาชิก",
       (SELECT count(*) FROM public.app_users) AS "ผู้ใช้",
       (SELECT count(*) FROM public.assets) AS "ทรัพย์สิน (ต้องเป็น 0)",
       (SELECT count(*) FROM public.cash_movements) AS "รายการเงิน (ต้องเป็น 0)";
