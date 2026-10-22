-- =====================================================================
-- สมาชิกครอบครัว: เพศ + การศึกษา / การทำงาน / ตำแหน่งทางสังคม (เก็บเฉพาะข้อมูลปัจจุบัน)
--   gender: 'M' ชาย · 'F' หญิง · ว่าง = ไม่ระบุ → ใช้แสดงชื่อเรียกตามเพศ (บิดา / มารดา · บุตรชาย / บุตรสาว ฯลฯ)
--     ว่างอยู่ + มีคำนำหน้าที่บอกเพศ (นาย / นาง / นางสาว / เด็กชาย / เด็กหญิง / Mr. / Mrs. / Ms. / Miss) → เติมให้เอง
--     ข้อมูลเดิม: เติมจากคำนำหน้า แล้วจากผังครอบครัว (เป็น "พ่อ" ของใคร = ชาย · "แม่" = หญิง) เฉพาะคนที่ยังว่าง
--   education_level / education_institution / education_major · occupation / workplace / job_title · social_positions
-- RLS / Trigger ของ persons ใช้ตามเดิม
-- รันซ้ำได้ (ADD COLUMN IF NOT EXISTS · DROP CONSTRAINT / TRIGGER IF EXISTS · CREATE OR REPLACE · เติมเฉพาะแถวที่ยังว่าง)
-- =====================================================================

ALTER TABLE public.persons
  ADD COLUMN IF NOT EXISTS gender                text,
  ADD COLUMN IF NOT EXISTS education_level       text,
  ADD COLUMN IF NOT EXISTS education_institution text,
  ADD COLUMN IF NOT EXISTS education_major       text,
  ADD COLUMN IF NOT EXISTS occupation            text,
  ADD COLUMN IF NOT EXISTS workplace             text,
  ADD COLUMN IF NOT EXISTS job_title             text,
  ADD COLUMN IF NOT EXISTS social_positions      text;

ALTER TABLE public.persons DROP CONSTRAINT IF EXISTS persons_gender_ck;
ALTER TABLE public.persons ADD CONSTRAINT persons_gender_ck CHECK (gender IS NULL OR gender IN ('M', 'F'));
ALTER TABLE public.persons DROP CONSTRAINT IF EXISTS persons_education_level_ck;
ALTER TABLE public.persons ADD CONSTRAINT persons_education_level_ck CHECK (education_level IS NULL OR education_level IN
  ('PRIMARY', 'LOWER_SECONDARY', 'UPPER_SECONDARY', 'DIPLOMA', 'BACHELOR', 'MASTER', 'DOCTORATE'));

-- ---------------------------------------------------------------- เพศจากคำนำหน้า
CREATE OR REPLACE FUNCTION private.gender_from_prefix(p_prefix text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN lower(btrim(p_prefix)) IN ('นาย', 'เด็กชาย', 'ด.ช.', 'mr.', 'mr', 'master') THEN 'M'
    WHEN lower(btrim(p_prefix)) IN ('นาง', 'นางสาว', 'น.ส.', 'เด็กหญิง', 'ด.ญ.', 'mrs.', 'mrs', 'ms.', 'ms', 'miss') THEN 'F'
  END $$;
REVOKE ALL ON FUNCTION private.gender_from_prefix(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.gender_from_prefix(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.tg_person_gender_default() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.gender IS NULL THEN NEW.gender := private.gender_from_prefix(NEW.title_prefix); END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_person_gender_default() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS b05_person_gender_default ON public.persons;
CREATE TRIGGER b05_person_gender_default BEFORE INSERT OR UPDATE OF gender, title_prefix ON public.persons
  FOR EACH ROW EXECUTE FUNCTION private.tg_person_gender_default();

-- ---------------------------------------------------------------- เติมข้อมูลเดิม (เฉพาะคนที่ยังว่าง)
UPDATE public.persons SET gender = private.gender_from_prefix(title_prefix)
 WHERE gender IS NULL AND private.gender_from_prefix(title_prefix) IS NOT NULL;
UPDATE public.persons p SET gender = 'M'
 WHERE p.gender IS NULL AND EXISTS (SELECT 1 FROM public.persons c WHERE c.father_id = p.id AND c.deleted_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM public.persons c WHERE c.mother_id = p.id AND c.deleted_at IS NULL);
UPDATE public.persons p SET gender = 'F'
 WHERE p.gender IS NULL AND EXISTS (SELECT 1 FROM public.persons c WHERE c.mother_id = p.id AND c.deleted_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM public.persons c WHERE c.father_id = p.id AND c.deleted_at IS NULL);
