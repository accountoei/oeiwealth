-- =====================================================================
-- ธุรกิจ: มูลค่าหุ้นที่ตราไว้ (par · บาท/หุ้น) → ทุนจดทะเบียน = หุ้นทั้งหมดของบริษัท × par (คำนวณในหน้าเว็บ)
--   คอลัมน์ใหม่ไม่บังคับ · ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================
ALTER TABLE public.private_business_details ADD COLUMN IF NOT EXISTS par_value numeric;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pbd_par_value_ck') THEN
    ALTER TABLE public.private_business_details ADD CONSTRAINT pbd_par_value_ck CHECK (par_value IS NULL OR par_value > 0);
  END IF;
END $$;
