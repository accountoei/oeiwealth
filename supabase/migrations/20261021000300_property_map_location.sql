-- =====================================================================
-- อสังหาฯ: ตำแหน่งบนแผนที่ — ลิงก์ Google Maps และ / หรือ พิกัด (ละติจูด · ลองจิจูด)
--   ไม่บังคับกรอก · ไม่แก้ข้อมูลเดิม · สิทธิ์ตาม RLS เดิมของตาราง · รันซ้ำได้
-- =====================================================================
ALTER TABLE public.property_details ADD COLUMN IF NOT EXISTS map_url text;
ALTER TABLE public.property_details ADD COLUMN IF NOT EXISTS latitude numeric(9,6);
ALTER TABLE public.property_details ADD COLUMN IF NOT EXISTS longitude numeric(9,6);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pd_map_location') THEN
    ALTER TABLE public.property_details ADD CONSTRAINT pd_map_location CHECK (
      (map_url IS NULL OR (length(map_url) <= 2000 AND map_url ~* '^https://'))
      AND ((latitude IS NULL) = (longitude IS NULL))
      AND (latitude IS NULL OR latitude BETWEEN -90 AND 90)
      AND (longitude IS NULL OR longitude BETWEEN -180 AND 180));
  END IF;
END $$;
