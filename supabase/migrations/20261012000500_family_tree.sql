-- =====================================================================
-- ผังครอบครัว + หัวหน้าครอบครัว
--   persons.father_id / mother_id / spouse_id — ความสัมพันธ์จริง (เลือกจากสมาชิก)
--   families.head_person_id — หัวหน้าครอบครัว (มีคนเดียว · โอนได้: set_family_head — ADMIN)
--   persons.relationship = ความสัมพันธ์ "เทียบกับหัวหน้า" → ระบบคำนวณให้เองเมื่อผูกพ่อ/แม่/คู่สมรสไว้
--     ตัวเอง · คู่สมรส · พ่อแม่ · ปู่ย่าตายาย · พ่อแม่คู่สมรส · พี่น้อง · ลูก · ลูกเขย/สะใภ้ · หลาน
--     คนที่คำนวณไม่ได้ (ไม่ได้ผูกไว้) → ใช้ค่าที่เลือกเองเหมือนเดิม
--   คู่สมรสผูกสองทาง: ตั้ง A เป็นคู่สมรสของ B → B เป็นคู่สมรสของ A ให้เอง
-- รันซ้ำได้ (ADD COLUMN IF NOT EXISTS · DROP CONSTRAINT/TRIGGER/FUNCTION IF EXISTS · CREATE OR REPLACE)
-- =====================================================================

ALTER TABLE public.persons
  ADD COLUMN IF NOT EXISTS father_id uuid REFERENCES public.persons(id),
  ADD COLUMN IF NOT EXISTS mother_id uuid REFERENCES public.persons(id),
  ADD COLUMN IF NOT EXISTS spouse_id uuid REFERENCES public.persons(id);
ALTER TABLE public.persons DROP CONSTRAINT IF EXISTS persons_links_not_self;
ALTER TABLE public.persons ADD CONSTRAINT persons_links_not_self CHECK (
  (father_id IS NULL OR father_id <> id) AND (mother_id IS NULL OR mother_id <> id) AND (spouse_id IS NULL OR spouse_id <> id)
  AND (father_id IS NULL OR mother_id IS NULL OR father_id <> mother_id));

ALTER TABLE public.families ADD COLUMN IF NOT EXISTS head_person_id uuid REFERENCES public.persons(id);

-- หัวหน้าตั้งต้น = คนที่เป็น "ตัวเอง" (SELF) คนแรก
UPDATE public.families f SET head_person_id = (
  SELECT p.id FROM public.persons p WHERE p.family_id = f.id AND p.deleted_at IS NULL AND p.relationship = 'SELF'
   ORDER BY p.sort_order NULLS LAST, p.created_at LIMIT 1)
 WHERE f.head_person_id IS NULL;

-- ---------------------------------------------------------------- คำนวณความสัมพันธ์เทียบกับหัวหน้า
-- INVOKER: แก้ได้เฉพาะแถวที่ผู้ใช้มีสิทธิ์แก้ (RLS) · เปลี่ยนเฉพาะคนที่คำนวณได้และค่าต่างจากเดิม
CREATE OR REPLACE FUNCTION private.recompute_relationships(p_family uuid) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE h public.persons; v_head uuid;
BEGIN
  SELECT head_person_id INTO v_head FROM public.families WHERE id = p_family;
  IF v_head IS NULL THEN RETURN; END IF;
  SELECT * INTO h FROM public.persons WHERE id = v_head AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;

  WITH ppl AS (SELECT * FROM public.persons WHERE family_id = p_family AND deleted_at IS NULL),
  par AS (SELECT id FROM ppl WHERE id IN (h.father_id, h.mother_id)),                                   -- พ่อแม่
  sp  AS (SELECT id FROM ppl WHERE id = h.spouse_id OR spouse_id = h.id),                               -- คู่สมรส
  kid AS (SELECT id FROM ppl WHERE father_id = h.id OR mother_id = h.id
            OR father_id IN (SELECT id FROM sp) OR mother_id IN (SELECT id FROM sp)),                   -- ลูก (ของหัวหน้า / คู่สมรส)
  rel AS (
    SELECT p.id, CASE
      WHEN p.id = h.id THEN 'SELF'
      WHEN p.id IN (SELECT id FROM sp) THEN 'SPOUSE'
      WHEN p.id IN (SELECT id FROM par) THEN 'PARENT'
      WHEN p.id IN (SELECT q.father_id FROM ppl q WHERE q.id IN (SELECT id FROM par)
                    UNION SELECT q.mother_id FROM ppl q WHERE q.id IN (SELECT id FROM par)) THEN 'GRANDPARENT'
      WHEN p.id IN (SELECT q.father_id FROM ppl q WHERE q.id IN (SELECT id FROM sp)
                    UNION SELECT q.mother_id FROM ppl q WHERE q.id IN (SELECT id FROM sp)) THEN 'PARENT_IN_LAW'
      WHEN p.id IN (SELECT id FROM kid) THEN 'CHILD'
      WHEN p.father_id IN (SELECT id FROM kid) OR p.mother_id IN (SELECT id FROM kid) THEN 'GRANDCHILD'
      WHEN p.spouse_id IN (SELECT id FROM kid) OR p.id IN (SELECT q.spouse_id FROM ppl q WHERE q.id IN (SELECT id FROM kid)) THEN 'CHILD_IN_LAW'
      WHEN (p.father_id IS NOT NULL AND p.father_id IN (h.father_id, h.mother_id))
        OR (p.mother_id IS NOT NULL AND p.mother_id IN (h.father_id, h.mother_id)) THEN 'SIBLING'
      ELSE NULL END AS r
    FROM ppl p)
  UPDATE public.persons p
     SET relationship = coalesce(rel.r, CASE WHEN p.relationship = 'SELF' THEN 'RELATIVE' ELSE p.relationship END)
    FROM rel
   WHERE p.id = rel.id
     AND p.relationship IS DISTINCT FROM coalesce(rel.r, CASE WHEN p.relationship = 'SELF' THEN 'RELATIVE' ELSE p.relationship END);
END $$;
REVOKE ALL ON FUNCTION private.recompute_relationships(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.recompute_relationships(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- คู่สมรสสองทาง + คำนวณใหม่เมื่อแก้พ่อ/แม่/คู่สมรส
CREATE OR REPLACE FUNCTION private.tg_person_links() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;   -- แถวที่ฟังก์ชันนี้แก้เอง ไม่ต้องทำซ้ำ
  IF NEW.spouse_id IS DISTINCT FROM OLD.spouse_id THEN
    -- คู่เดิมที่ยังชี้มาที่คนนี้ → ล้าง
    UPDATE public.persons SET spouse_id = NULL WHERE spouse_id = NEW.id AND id IS DISTINCT FROM NEW.spouse_id;
    IF NEW.spouse_id IS NOT NULL THEN
      -- คู่ใหม่: ล้างคู่เดิมของเขา (ถ้ามี) แล้วผูกกลับมา
      UPDATE public.persons SET spouse_id = NULL
       WHERE spouse_id = NEW.spouse_id AND id <> NEW.id;
      UPDATE public.persons SET spouse_id = NEW.id WHERE id = NEW.spouse_id AND spouse_id IS DISTINCT FROM NEW.id;
    END IF;
  END IF;
  PERFORM private.recompute_relationships(NEW.family_id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.tg_person_links() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS a40_person_links ON public.persons;
CREATE TRIGGER a40_person_links AFTER UPDATE OF father_id, mother_id, spouse_id ON public.persons
  FOR EACH ROW EXECUTE FUNCTION private.tg_person_links();

-- ---------------------------------------------------------------- ตั้ง / โอนหัวหน้าครอบครัว (ADMIN)
DROP FUNCTION IF EXISTS public.set_family_head(uuid);
CREATE FUNCTION public.set_family_head(p_person_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_family uuid;
BEGIN
  PERFORM private.require_role('ADMIN');
  SELECT family_id INTO v_family FROM public.persons WHERE id = p_person_id AND deleted_at IS NULL;
  IF v_family IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบสมาชิก' USING ERRCODE = '22023'; END IF;
  UPDATE public.families SET head_person_id = p_person_id WHERE id = v_family;
  PERFORM private.recompute_relationships(v_family);
END $$;
REVOKE ALL ON FUNCTION public.set_family_head(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_family_head(uuid) TO authenticated;

-- ---------------------------------------------------------------- ครอบครัวที่ยังไม่มีหัวหน้า: สมาชิก "ตัวเอง" คนแรกเป็นหัวหน้า (เช่น ตอนตั้งระบบใหม่)
CREATE OR REPLACE FUNCTION private.tg_person_default_head() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.relationship = 'SELF' THEN
    UPDATE public.families SET head_person_id = NEW.id WHERE id = NEW.family_id AND head_person_id IS NULL;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.tg_person_default_head() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS a41_default_head ON public.persons;
CREATE TRIGGER a41_default_head AFTER INSERT ON public.persons
  FOR EACH ROW EXECUTE FUNCTION private.tg_person_default_head();
