-- =====================================================================
-- ลำดับสมาชิกครอบครัว (ใช้เรียงในทุกหน้า / ตัวกรอง / ช่องเลือกคน)
--   persons.sort_order — ค่าเริ่มต้นตามความสัมพันธ์: ตัวเอง → คู่สมรส → พ่อแม่ → พ่อแม่คู่สมรส → ลูก → ลูกเขย/สะใภ้
--                         → หลาน → พี่น้อง → ญาติ → อื่น ๆ (เท่ากัน → ตามลำดับที่สร้าง)
--   เพิ่มสมาชิกใหม่ → ต่อท้าย · ย้ายขึ้น / ลง: move_person(person_id, -1 | +1) (ADMIN / EDITOR)
-- รันซ้ำได้ (ADD COLUMN IF NOT EXISTS · ตั้งค่าเฉพาะแถวที่ยังว่าง · CREATE OR REPLACE · DROP TRIGGER IF EXISTS)
-- =====================================================================

ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS sort_order integer;

-- ค่าเริ่มต้นสำหรับสมาชิกที่มีอยู่ (เฉพาะแถวที่ยังไม่มีลำดับ)
WITH base AS (
  SELECT family_id, coalesce(max(sort_order), 0) AS mx FROM public.persons GROUP BY family_id
), r AS (
  SELECT p.id, b.mx + row_number() OVER (PARTITION BY p.family_id ORDER BY
           CASE p.relationship WHEN 'SELF' THEN 1 WHEN 'SPOUSE' THEN 2 WHEN 'PARENT' THEN 3 WHEN 'PARENT_IN_LAW' THEN 4
                               WHEN 'CHILD' THEN 5 WHEN 'CHILD_IN_LAW' THEN 6 WHEN 'GRANDCHILD' THEN 7 WHEN 'SIBLING' THEN 8
                               WHEN 'RELATIVE' THEN 9 ELSE 10 END,
           p.deleted_at IS NOT NULL, p.created_at) AS n
    FROM public.persons p JOIN base b ON b.family_id = p.family_id
   WHERE p.sort_order IS NULL
)
UPDATE public.persons p SET sort_order = r.n FROM r WHERE p.id = r.id;

-- สมาชิกใหม่ → ต่อท้าย
CREATE OR REPLACE FUNCTION private.tg_person_sort_order() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.sort_order IS NULL THEN
    SELECT coalesce(max(sort_order), 0) + 1 INTO NEW.sort_order FROM public.persons WHERE family_id = NEW.family_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_person_sort_order() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t15_sort_order ON public.persons;
CREATE TRIGGER t15_sort_order BEFORE INSERT ON public.persons
  FOR EACH ROW EXECUTE FUNCTION private.tg_person_sort_order();

-- ย้ายขึ้น (-1) / ลง (+1) หนึ่งตำแหน่ง (นับเฉพาะสมาชิกที่ยังไม่ถูกลบ)
DROP FUNCTION IF EXISTS public.move_person(uuid, integer);
CREATE FUNCTION public.move_person(p_person_id uuid, p_direction integer)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_family uuid; v_cur integer; v_target integer;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF p_direction NOT IN (-1, 1) THEN RAISE EXCEPTION 'INVALID: ทิศทางต้องเป็น -1 หรือ 1' USING ERRCODE = '22023'; END IF;
  SELECT family_id INTO v_family FROM public.persons WHERE id = p_person_id AND deleted_at IS NULL;
  IF v_family IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบสมาชิก' USING ERRCODE = '22023'; END IF;

  -- เรียงเลขใหม่ 1..n ให้ต่อเนื่อง แล้วสลับกับคนข้าง ๆ
  WITH o AS (
    SELECT id, row_number() OVER (ORDER BY sort_order NULLS LAST, created_at)::integer AS n
      FROM public.persons WHERE family_id = v_family AND deleted_at IS NULL
  )
  UPDATE public.persons p SET sort_order = o.n FROM o WHERE p.id = o.id AND p.sort_order IS DISTINCT FROM o.n;

  SELECT sort_order INTO v_cur FROM public.persons WHERE id = p_person_id;
  v_target := v_cur + p_direction;
  IF NOT EXISTS (SELECT 1 FROM public.persons WHERE family_id = v_family AND deleted_at IS NULL AND sort_order = v_target) THEN
    RETURN;   -- อยู่บนสุด / ล่างสุดแล้ว
  END IF;
  UPDATE public.persons SET sort_order = v_cur
   WHERE family_id = v_family AND deleted_at IS NULL AND sort_order = v_target;
  UPDATE public.persons SET sort_order = v_target WHERE id = p_person_id;
END $$;
REVOKE ALL ON FUNCTION public.move_person(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_person(uuid, integer) TO authenticated;
