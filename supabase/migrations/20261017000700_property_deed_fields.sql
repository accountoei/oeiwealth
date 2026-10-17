-- =====================================================================
-- Property: ข้อมูลโฉนดเพิ่ม (ตามแบบแสดงรายการภาษีที่ดิน) — เล่ม · หน้า · ระวาง · หน้าสำรวจ · ตำบล · อำเภอ · จังหวัด
--   เพิ่มคอลัมน์ไม่บังคับ (ข้อความ) · ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
--   สิทธิ์ใช้ของตาราง property_details เดิม (RLS + trigger เดิม)
-- =====================================================================
ALTER TABLE public.property_details
  ADD COLUMN IF NOT EXISTS deed_book    text,   -- เล่ม
  ADD COLUMN IF NOT EXISTS deed_page    text,   -- หน้า
  ADD COLUMN IF NOT EXISTS map_sheet    text,   -- ระวาง
  ADD COLUMN IF NOT EXISTS survey_page  text,   -- หน้าสำรวจ
  ADD COLUMN IF NOT EXISTS subdistrict  text,   -- ตำบล / แขวง
  ADD COLUMN IF NOT EXISTS district     text,   -- อำเภอ / เขต
  ADD COLUMN IF NOT EXISTS province     text;   -- จังหวัด
