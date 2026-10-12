-- =====================================================================
-- ข้อมูลส่วนบุคคลของสมาชิก (หน้า Family → Members → รายคน)
--   คำนำหน้า · ชื่อ-นามสกุลเต็ม (ไทย / อังกฤษ) · ชื่อเล่น · รูปโปรไฟล์ (ไม่บังคับ)
--   การติดต่อ · ผู้ติดต่อฉุกเฉิน · เลขบัตรประชาชน / หนังสือเดินทาง / ทะเบียนบ้าน (เก็บปกติ ไม่เข้ารหัส — ตามที่เจ้าของตกลง)
--   สำเนาเอกสารแนบผ่าน Documents (entity PERSON) เหมือนเดิม
--   รูปโปรไฟล์: ย่อในเบราว์เซอร์ก่อนบันทึก (data URL รูปภาพ ไม่เกิน ~200 KB)
-- RLS / Trigger ของ persons ใช้ตามเดิม (ทุกบทบาทดูได้ · แก้ได้ตามสิทธิ์)
-- รันซ้ำได้ (ADD COLUMN IF NOT EXISTS · DROP CONSTRAINT IF EXISTS)
-- =====================================================================

ALTER TABLE public.persons
  ADD COLUMN IF NOT EXISTS title_prefix            text,
  ADD COLUMN IF NOT EXISTS full_name_th            text,
  ADD COLUMN IF NOT EXISTS full_name_en            text,
  ADD COLUMN IF NOT EXISTS nickname                text,
  ADD COLUMN IF NOT EXISTS photo                   text,
  ADD COLUMN IF NOT EXISTS phone                   text,
  ADD COLUMN IF NOT EXISTS email                   text,
  ADD COLUMN IF NOT EXISTS address                 text,
  ADD COLUMN IF NOT EXISTS emergency_contact_name  text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS national_id             text,
  ADD COLUMN IF NOT EXISTS passport_no             text,
  ADD COLUMN IF NOT EXISTS passport_expiry         date,
  ADD COLUMN IF NOT EXISTS house_registration_no   text;

ALTER TABLE public.persons DROP CONSTRAINT IF EXISTS persons_national_id_format;
ALTER TABLE public.persons ADD CONSTRAINT persons_national_id_format
  CHECK (national_id IS NULL OR national_id ~ '^[0-9]{13}$');
ALTER TABLE public.persons DROP CONSTRAINT IF EXISTS persons_photo_format;
ALTER TABLE public.persons ADD CONSTRAINT persons_photo_format
  CHECK (photo IS NULL OR (photo ~ '^data:image/(jpeg|png|webp);base64,' AND length(photo) <= 300000));
