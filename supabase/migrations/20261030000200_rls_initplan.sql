-- =====================================================================
-- เช็กสิทธิ์ (RLS) ครั้งเดียวต่อคำสั่ง แทนทีละแถว (30 ต.ค. 2026)
-- 16 Policy ด้านล่าง (ตั้งแต่ 20261004001600_rls_grants.sql + net_worth_month_auto จาก 20261025000100)
--   เรียก private.has_role(...) / auth.uid() ตรง ๆ → Postgres เรียกฟังก์ชันซ้ำทุกแถวที่อ่าน
--   (has_role เป็น SECURITY DEFINER จึงพับเข้าคำสั่งไม่ได้ · เช่น fx_rates ~800 แถว = เรียก ~800 ครั้งต่อการอ่านหนึ่งครั้ง และโตขึ้นทุกวัน)
-- ห่อด้วย (SELECT ...) = คำนวณครั้งเดียวต่อคำสั่ง (initPlan) — แบบเดียวกับ Policy มาตรฐานของตารางอื่นทุกตาราง
-- เงื่อนไขสิทธิ์เหมือนเดิมทุกข้อ (ใครอ่าน / แก้อะไรได้ไม่เปลี่ยน) · ALTER POLICY ไม่ลบ / ไม่สร้าง Policy ใหม่ · รันซ้ำได้
-- ไม่แตะ tax_return_lines: สิทธิ์ขึ้นกับเจ้าของแต่ละแถว (private.tax_can_read(r.person_id)) จึงต้องเช็กทีละแถวอยู่แล้ว
-- =====================================================================

-- families: ทุก Role อ่านได้; แก้ได้เฉพาะ ADMIN
ALTER POLICY p_select ON public.families
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
ALTER POLICY p_update ON public.families
  USING ((SELECT private.has_role('ADMIN'))) WITH CHECK ((SELECT private.has_role('ADMIN')));

-- app_users: ADMIN เห็นทุกคน, ผู้ใช้อื่นเห็นเฉพาะตัวเอง
ALTER POLICY p_select ON public.app_users
  USING ((SELECT private.has_role('ADMIN')) OR auth_user_id = (SELECT auth.uid()));
ALTER POLICY p_update ON public.app_users
  USING ((SELECT private.has_role('ADMIN'))) WITH CHECK ((SELECT private.has_role('ADMIN')));

-- audit_logs / system_job_runs: อ่านได้เฉพาะ ADMIN
ALTER POLICY p_select ON public.audit_logs
  USING ((SELECT private.has_role('ADMIN')));
ALTER POLICY p_select ON public.system_job_runs
  USING ((SELECT private.has_role('ADMIN')));

-- Snapshot + Snapshot อัตโนมัติสิ้นเดือน: ทุก Role อ่านได้
ALTER POLICY p_select ON public.net_worth_snapshots
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
ALTER POLICY p_select ON public.net_worth_snapshot_items
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
ALTER POLICY p_select ON public.net_worth_snapshot_lines
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
ALTER POLICY p_select ON public.net_worth_month_auto
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));

-- fx_rates: ทุก Role อ่าน; ADMIN Override (Trigger บังคับ source/reason เหมือนเดิม)
ALTER POLICY p_select ON public.fx_rates
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
ALTER POLICY p_insert ON public.fx_rates
  WITH CHECK ((SELECT private.has_role('ADMIN')));
ALTER POLICY p_update ON public.fx_rates
  USING ((SELECT private.has_role('ADMIN'))) WITH CHECK ((SELECT private.has_role('ADMIN')));

-- data_completeness_rules: ทุก Role อ่าน; ADMIN ตั้งค่า
ALTER POLICY p_select ON public.data_completeness_rules
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
ALTER POLICY p_insert ON public.data_completeness_rules
  WITH CHECK ((SELECT private.has_role('ADMIN')));
ALTER POLICY p_update ON public.data_completeness_rules
  USING ((SELECT private.has_role('ADMIN'))) WITH CHECK ((SELECT private.has_role('ADMIN')));
