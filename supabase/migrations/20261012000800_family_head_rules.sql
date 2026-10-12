-- =====================================================================
-- กติกาหัวหน้าครอบครัว
--   1) หัวหน้าต้องเป็นสมาชิก Active เท่านั้น (Inactive / Archived ตั้งเป็นหัวหน้าไม่ได้)
--   2) เปลี่ยนหัวหน้าปัจจุบันเป็น Inactive / Archived ไม่ได้ → ต้องตั้งหัวหน้าคนใหม่ก่อน
--      (หน้าจอให้เลือกหัวหน้าคนใหม่ในฟอร์มเดียวกัน แล้วโอนให้ก่อนเปลี่ยนสถานะ)
-- รันซ้ำได้ (CREATE OR REPLACE · DROP TRIGGER IF EXISTS) · signature เดิม
-- =====================================================================

CREATE OR REPLACE FUNCTION public.set_family_head(p_person_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_family uuid; v_status text;
BEGIN
  PERFORM private.require_role('ADMIN');
  SELECT family_id, status INTO v_family, v_status FROM public.persons WHERE id = p_person_id AND deleted_at IS NULL;
  IF v_family IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบสมาชิก' USING ERRCODE = '22023'; END IF;
  IF v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'INVALID: หัวหน้าครอบครัวต้องเป็นสมาชิก Active (คนนี้เป็น Inactive / Archived)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.families SET head_person_id = p_person_id WHERE id = v_family;
  PERFORM private.recompute_relationships(v_family);
END $$;
REVOKE ALL ON FUNCTION public.set_family_head(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_family_head(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.tg_person_head_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status <> 'ACTIVE' AND OLD.status = 'ACTIVE'
     AND EXISTS (SELECT 1 FROM public.families f WHERE f.id = NEW.family_id AND f.head_person_id = NEW.id) THEN
    RAISE EXCEPTION 'INVALID: คนนี้เป็นหัวหน้าครอบครัว — เลือกหัวหน้าครอบครัวคนใหม่ก่อน จึงเปลี่ยนเป็น Inactive / Archived ได้'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_person_head_status() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t45_head_status ON public.persons;
CREATE TRIGGER t45_head_status BEFORE UPDATE OF status ON public.persons
  FOR EACH ROW EXECUTE FUNCTION private.tg_person_head_status();
