-- =====================================================================
-- สถานะสมาชิก: แสดงเป็น Active / Inactive / Archived (ค่าในฐานข้อมูลเดิม ACTIVE / INACTIVE / DECEASED)
--   Archived (DECEASED) ยังทำงานเหมือนเดิม: สร้างรายการติดตามกรมธรรม์ให้เอง · ไม่ขึ้นในช่องเลือกคน
--   เพิ่ม persons.death_date (วันที่เสียชีวิต) — ใส่ได้เฉพาะสมาชิก Archived
-- รันซ้ำได้ (ADD COLUMN IF NOT EXISTS · DROP CONSTRAINT IF EXISTS)
-- =====================================================================

ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS death_date date;
ALTER TABLE public.persons DROP CONSTRAINT IF EXISTS persons_death_date_status;
ALTER TABLE public.persons ADD CONSTRAINT persons_death_date_status
  CHECK (death_date IS NULL OR status = 'DECEASED');
