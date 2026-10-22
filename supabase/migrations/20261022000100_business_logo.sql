-- =====================================================================
-- โลโก้บริษัท (Private Business) — ตกลง 22 ต.ค. 2026
--   เก็บเป็นรูปเล็ก (ย่อเป็น 128×128 ในเบราว์เซอร์) แบบ data URL ในคอลัมน์เดียว
--   ไม่ใช้ Google Drive: หน้า "กิจการทั้งหมด" ต้องแสดงทุกครั้งที่เปิด (Drive ช้า + เกิด Audit Log ทุกครั้ง)
--   ไม่ใส่ = แสดงกล่องตัวย่อสีเหมือนเดิม · เพิ่มคอลัมน์อย่างเดียว ไม่แตะข้อมูลเดิม
--   สิทธิ์ / RLS / Audit ใช้ของตาราง private_business_details เดิม
-- =====================================================================

ALTER TABLE public.private_business_details ADD COLUMN IF NOT EXISTS logo_data text;

-- รับเฉพาะรูป PNG / JPEG / WebP แบบ base64 และไม่เกิน 60,000 ตัวอักษร (~45 KB · รูป 128×128 ใช้จริง ~5–20 KB)
DO $$ BEGIN
  ALTER TABLE public.private_business_details ADD CONSTRAINT pbd_logo_data_ck
    CHECK (logo_data IS NULL OR (length(logo_data) <= 60000
           AND logo_data ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.private_business_details.logo_data IS
  'โลโก้บริษัท: data URL (png / jpeg / webp · base64 · ≤ 60,000 ตัวอักษร) · NULL = แสดงตัวย่อ';
