-- =====================================================================
-- ปุ่ม "คำนวณยอดสิ้นเดือนใหม่" มุมขวาล่างกล่องกราฟ Net Worth บน Dashboard (เจ้าของขอ "ทำเลย" 9 พ.ย. 2026)
--   เดิม: จุดสิ้นเดือนที่ยังไม่ปิด (net_worth_month_auto) คำนวณใหม่เฉพาะงานเช้า 07:30 (month-auto.yml)
--         → บันทึกรายการย้อนหลัง (เช่น อัปเดตมูลค่าธุรกิจลงวันที่ในเดือนก่อน) ต้องรอถึงเช้าวันถัดไปกราฟจึงเปลี่ยน
--   ใหม่: ADMIN / EDITOR กดปุ่มให้ทำงานเดียวกับงานเช้าได้ทันที ตามลำดับเดิม
--         1) ลงมูลค่าเวนคืนประกันตามตาราง (server_sync_insurance_cash_values)
--         2) คำนวณยอดสิ้นเดือนอัตโนมัติใหม่ (server_refresh_month_auto)
--         ทั้งสองขั้นบันทึกผลใน system_job_runs เหมือนเดิม → แคชหน้าเว็บล้างเอง (data_version)
--   เดือนที่ปิดแล้ว (FINAL) ไม่แตะเหมือนเดิม · ไม่แก้ / ไม่ลบข้อมูลที่กรอก · ฟังก์ชันใหม่ฟังก์ชันเดียว · รันซ้ำได้
-- =====================================================================
CREATE OR REPLACE FUNCTION public.refresh_month_auto_now()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cv integer; v_months integer;
BEGIN
  PERFORM private.require_role('ADMIN', 'EDITOR');
  v_cv := public.server_sync_insurance_cash_values();
  v_months := public.server_refresh_month_auto();
  RETURN jsonb_build_object('cash_values', v_cv, 'months', v_months);
END $$;
REVOKE ALL ON FUNCTION public.refresh_month_auto_now() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_month_auto_now() TO authenticated;
