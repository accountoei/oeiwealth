-- =====================================================================
-- Property รอบ 2 ข้อ 2 (ตกลง 27 ต.ค. 2026 · แบบ A): 1 รายการทรัพย์สิน มีได้หลายโฉนด / เอกสารสิทธิ์
--   1) ตารางใหม่ property_deeds = 1 แถวต่อ 1 โฉนด (ประเภท · เลขที่ · เลขที่ดิน · เล่ม / หน้า · ระวาง · หน้าสำรวจ · เนื้อที่)
--   2) property_details.land_area_sq_wa / title_deed_no = ค่าสรุปจากโฉนด (ระบบคำนวณให้ เมื่อมีโฉนดอย่างน้อย 1 แถว)
--        เนื้อที่ = ผลรวมเนื้อที่ของทุกโฉนด · เลขที่โฉนด = เลขที่ทุกโฉนดคั่นด้วย ", "
--        → หน้ารายการ / ภาษีที่ดิน / ความครบถ้วนของข้อมูล ใช้ค่าเดิมได้ต่อ · ภาษีที่ดินยังคิดต่อทรัพย์สิน
--        ไม่มีโฉนดเลย (เช่น คอนโด) → แก้เนื้อที่ที่ทรัพย์สินได้เหมือนเดิม
--   3) สร้างทรัพย์สินพร้อมเลขที่โฉนด / เนื้อที่ → ระบบสร้างโฉนดแถวแรกให้
--   4) ย้ายข้อมูลเดิม: ทรัพย์สินที่มีข้อมูลโฉนด / เนื้อที่ → สร้างโฉนดแถวแรกจากข้อมูลเดิม (ค่าเดิมไม่ถูกลบ · รันซ้ำไม่สร้างซ้ำ)
--   ตำบล / อำเภอ / จังหวัด / ภาระผูกพัน ยังอยู่ที่ทรัพย์สิน (ใช้ร่วมกันทุกโฉนด)
-- =====================================================================

-- 1) ตารางโฉนด ------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.property_deeds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      uuid NOT NULL REFERENCES public.property_details(id),
  sort_order       integer NOT NULL DEFAULT 0,
  title_type       text,                                                -- โฉนด · น.ส.3ก · อ.ช.2 ฯลฯ
  title_deed_no    text,                                                -- เลขที่โฉนด
  land_no          text,                                                -- เลขที่ดิน
  deed_book        text,                                                -- เล่ม
  deed_page        text,                                                -- หน้า
  map_sheet        text,                                                -- ระวาง
  survey_page      text,                                                -- หน้าสำรวจ
  land_area_sq_wa  numeric(14,2) CHECK (land_area_sq_wa IS NULL OR land_area_sq_wa >= 0),
  notes            text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE INDEX IF NOT EXISTS pdeed_property_idx ON public.property_deeds(property_id);

DROP TRIGGER IF EXISTS t10_meta ON public.property_deeds;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.property_deeds
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.property_deeds;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.property_deeds
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.property_deeds;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.property_deeds
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

ALTER TABLE public.property_deeds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_deeds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.property_deeds TO authenticated;
DROP POLICY IF EXISTS p_select ON public.property_deeds;
CREATE POLICY p_select ON public.property_deeds FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
DROP POLICY IF EXISTS p_insert ON public.property_deeds;
CREATE POLICY p_insert ON public.property_deeds FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR')));
DROP POLICY IF EXISTS p_update ON public.property_deeds;
CREATE POLICY p_update ON public.property_deeds FOR UPDATE TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND created_at >= now() - interval '24 hours' AND deleted_at IS NULL))
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND deleted_at IS NULL));

-- 2) ค่าสรุปที่ทรัพย์สิน = คำนวณจากโฉนด (ก่อนบันทึก property_details ทุกครั้ง) ---------------------------------
CREATE OR REPLACE FUNCTION private.tg_property_deed_summary() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_n integer; v_area numeric; v_nos text;
BEGIN
  SELECT count(*), sum(d.land_area_sq_wa),
         string_agg(nullif(trim(d.title_deed_no), ''), ', ' ORDER BY d.sort_order, d.created_at, d.id)
    INTO v_n, v_area, v_nos
    FROM public.property_deeds d WHERE d.property_id = NEW.id AND d.deleted_at IS NULL;
  IF v_n > 0 THEN
    NEW.land_area_sq_wa := v_area;
    NEW.title_deed_no   := v_nos;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_property_deed_summary() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t19_deed_summary ON public.property_details;
CREATE TRIGGER t19_deed_summary BEFORE UPDATE ON public.property_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_property_deed_summary();

-- 3) เพิ่ม / แก้ / ลบโฉนด → คำนวณค่าสรุปที่ทรัพย์สินใหม่ (ต้องมีสิทธิ์แก้ทรัพย์สินนั้นด้วย) -------------------------
CREATE OR REPLACE FUNCTION private.tg_property_deed_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.property_id IS DISTINCT FROM OLD.property_id THEN
    RAISE EXCEPTION 'INVALID: ย้ายโฉนดไปทรัพย์สินอื่นไม่ได้ (ลบแล้วเพิ่มใหม่ที่ทรัพย์สินนั้น)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.property_details SET land_area_sq_wa = land_area_sq_wa WHERE id = NEW.property_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: ไม่มีสิทธิ์แก้ไขข้อมูลโฉนดของทรัพย์สินนี้' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.tg_property_deed_sync() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t30_sync ON public.property_deeds;
CREATE TRIGGER t30_sync AFTER INSERT OR UPDATE ON public.property_deeds
  FOR EACH ROW EXECUTE FUNCTION private.tg_property_deed_sync();

-- 4) สร้างทรัพย์สินพร้อมข้อมูลโฉนด → โฉนดแถวแรก ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_property_first_deed() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF num_nonnulls(nullif(trim(NEW.title_type), ''), nullif(trim(NEW.title_deed_no), ''), nullif(trim(NEW.land_no), ''),
                  nullif(trim(NEW.deed_book), ''), nullif(trim(NEW.deed_page), ''), nullif(trim(NEW.map_sheet), ''),
                  nullif(trim(NEW.survey_page), ''), NEW.land_area_sq_wa) > 0 THEN
    INSERT INTO public.property_deeds(property_id, title_type, title_deed_no, land_no, deed_book, deed_page, map_sheet, survey_page, land_area_sq_wa)
    VALUES (NEW.id, nullif(trim(NEW.title_type), ''), nullif(trim(NEW.title_deed_no), ''), nullif(trim(NEW.land_no), ''),
            nullif(trim(NEW.deed_book), ''), nullif(trim(NEW.deed_page), ''), nullif(trim(NEW.map_sheet), ''),
            nullif(trim(NEW.survey_page), ''), NEW.land_area_sq_wa);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.tg_property_first_deed() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t30_first_deed ON public.property_details;
CREATE TRIGGER t30_first_deed AFTER INSERT ON public.property_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_property_first_deed();

-- 5) ย้ายข้อมูลเดิม: ทรัพย์สินที่ยังไม่มีโฉนดเลย + มีข้อมูลโฉนด / เนื้อที่ → โฉนดแถวแรก (รันซ้ำไม่สร้างซ้ำ) -------------
CREATE OR REPLACE FUNCTION private.property_deeds_backfill() RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.property_deeds(property_id, title_type, title_deed_no, land_no, deed_book, deed_page, map_sheet, survey_page, land_area_sq_wa,
                                    created_by, updated_by)
  SELECT p.id, nullif(trim(p.title_type), ''), nullif(trim(p.title_deed_no), ''), nullif(trim(p.land_no), ''),
         nullif(trim(p.deed_book), ''), nullif(trim(p.deed_page), ''), nullif(trim(p.map_sheet), ''),
         nullif(trim(p.survey_page), ''), p.land_area_sq_wa, p.created_by, p.created_by
    FROM public.property_details p
   WHERE p.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.property_deeds d WHERE d.property_id = p.id)
     AND num_nonnulls(nullif(trim(p.title_type), ''), nullif(trim(p.title_deed_no), ''), nullif(trim(p.land_no), ''),
                      nullif(trim(p.deed_book), ''), nullif(trim(p.deed_page), ''), nullif(trim(p.map_sheet), ''),
                      nullif(trim(p.survey_page), ''), p.land_area_sq_wa) > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION private.property_deeds_backfill() FROM PUBLIC, anon, authenticated;

SELECT private.property_deeds_backfill() AS deeds_created;
