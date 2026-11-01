-- =====================================================================
-- ป้ายข้อมูลจากงานเบื้องหลัง (ตกลง 1 พ.ย. 2026)
--   หน้าเว็บจำผลคำนวณที่หนัก (Dashboard / ผลตอบแทนพอร์ต / ตัวเลข To-Do) ไว้จนกว่าจะมีการบันทึก
--   งานเบื้องหลัง (อัตราแลกเปลี่ยน / ราคาอัตโนมัติ / ยอดสิ้นเดือนอัตโนมัติ) ไม่ผ่านหน้าเว็บ
--   → ล้างผลที่จำไว้เองไม่ได้ (ถ้าใช้รหัสลับเรียกหน้าเว็บ ต้องเก็บรหัสลับใน Vercel ซึ่งกติกาห้าม)
--   ทางนี้: งานทุกตัวบันทึกประวัติลง system_job_runs อยู่แล้ว (ในคำสั่งเดียวกับที่บันทึกข้อมูล)
--   ฟังก์ชันนี้คืน "ป้าย" (จำนวนแถว + แถวล่าสุด + เวลาล่าสุด) ที่เปลี่ยนทุกครั้งที่มีงานบันทึก
--   หน้าเว็บใส่ป้ายนี้ในชื่อผลที่จำไว้ → งานเสร็จปุ๊บ ผลเดิมไม่ถูกใช้ คำนวณใหม่ทันที
--   - นับจำนวนแถวด้วย: งาน 2 ตัวที่ทำพร้อมกันแล้วบันทึกสลับลำดับ ป้ายก็ยังเปลี่ยน
--   - คืนแค่ตัวเลข ไม่คืนรายละเอียดงาน (ตาราง system_job_runs ยังอ่านได้เฉพาะ ADMIN เหมือนเดิม)
--   ไม่แก้ตาราง / ข้อมูลเดิม · รันซ้ำได้
-- =====================================================================
CREATE OR REPLACE FUNCTION public.data_version()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  SELECT count(*)::text || '-' || coalesce(max(r.id), 0)::text || '-'
         || coalesce(extract(epoch FROM max(coalesce(r.finished_at, r.started_at)))::text, '0')
    INTO v
    FROM public.system_job_runs r;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.data_version() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.data_version() TO authenticated;
