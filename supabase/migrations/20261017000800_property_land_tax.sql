-- =====================================================================
-- ภาษีที่ดินและสิ่งปลูกสร้าง: ข้อมูล + คำนวณรายปีต่อทรัพย์สิน (ตามแบบแสดงรายการคำนวณภาษีของเขต)
--   1 ทรัพย์สิน (1 โฉนด / 1 ห้องชุด) มีได้หลายรายการต่อปี — เช่น ตึกชั้น 1 เก็บอัตราหนึ่ง ชั้น 2–4 อีกอัตราหนึ่ง
--   ต่อรายการ: ที่ดิน (ตร.ว. × ราคาประเมิน/ตร.ว.) + สิ่งปลูกสร้าง (ตร.ม. × ราคา/ตร.ม. − ค่าเสื่อม %)
--              − มูลค่ายกเว้น (ติดลบ = บวกเพิ่ม) = ฐานภาษี × อัตรา % − ส่วนลด % = ภาษี (ปัด 2 ตำแหน่ง)
--   ตารางใหม่ property_tax_lines: RLS มาตรฐาน + trigger META / soft delete / audit เหมือนตารางข้อมูลอื่น
--   view v_property_tax_lines (security_invoker) คำนวณทุกขั้นในฐานข้อมูล
--   copy_property_tax_year(): คัดลอกรายการจากปีก่อน (ค่าเริ่มต้นของปีใหม่ = ตามปีก่อน)
--   sync_land_tax_estimate(): ตั้งยอดประมาณค่าใช้จ่ายประจำ "ภาษีที่ดิน" ของทรัพย์สิน = ภาษีรวมปีปัจจุบัน
--   ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.property_tax_lines (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id               uuid NOT NULL REFERENCES public.assets(id),
  tax_year               integer NOT NULL CHECK (tax_year BETWEEN 2000 AND 2200),   -- ค.ศ. (แสดงเป็น พ.ศ.)
  sort_order             integer NOT NULL DEFAULT 0,
  description            text,
  land_sq_wa             numeric CHECK (land_sq_wa IS NULL OR land_sq_wa >= 0),
  land_price_per_sq_wa   numeric CHECK (land_price_per_sq_wa IS NULL OR land_price_per_sq_wa >= 0),
  building_type          text,
  building_sqm           numeric CHECK (building_sqm IS NULL OR building_sqm >= 0),
  building_price_per_sqm numeric CHECK (building_price_per_sqm IS NULL OR building_price_per_sqm >= 0),
  building_age           integer CHECK (building_age IS NULL OR building_age >= 0),
  depreciation_pct       numeric NOT NULL DEFAULT 0 CHECK (depreciation_pct BETWEEN 0 AND 100),
  exemption              numeric NOT NULL DEFAULT 0,          -- มูลค่าที่ได้รับยกเว้น (บาท) · ติดลบ = ปรับเพิ่มฐานภาษี
  exemption_reason       text,
  rate_pct               numeric NOT NULL CHECK (rate_pct BETWEEN 0 AND 10),
  discount_pct           numeric NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  notes                  text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE INDEX IF NOT EXISTS property_tax_lines_asset_year_idx ON public.property_tax_lines(asset_id, tax_year);

DROP TRIGGER IF EXISTS t10_meta ON public.property_tax_lines;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.property_tax_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.property_tax_lines;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.property_tax_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.property_tax_lines;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.property_tax_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

-- ทรัพย์สินต้องเป็นอสังหาฯ
CREATE OR REPLACE FUNCTION private.tg_property_tax_line_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.property_details pd WHERE pd.asset_id = NEW.asset_id AND pd.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ภาษีที่ดินบันทึกได้เฉพาะทรัพย์สินประเภทอสังหาริมทรัพย์' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t20_check ON public.property_tax_lines;
CREATE TRIGGER t20_check BEFORE INSERT OR UPDATE OF asset_id ON public.property_tax_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_property_tax_line_check();

ALTER TABLE public.property_tax_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_tax_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.property_tax_lines TO authenticated;
DROP POLICY IF EXISTS p_select ON public.property_tax_lines;
CREATE POLICY p_select ON public.property_tax_lines FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
DROP POLICY IF EXISTS p_insert ON public.property_tax_lines;
CREATE POLICY p_insert ON public.property_tax_lines FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR')));
DROP POLICY IF EXISTS p_update ON public.property_tax_lines;
CREATE POLICY p_update ON public.property_tax_lines FOR UPDATE TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND created_at >= now() - interval '24 hours' AND deleted_at IS NULL))
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND deleted_at IS NULL));

-- ---------------------------------------------------------------- คำนวณทุกขั้น
CREATE OR REPLACE VIEW public.v_property_tax_lines WITH (security_invoker = true) AS
  WITH b AS (
    SELECT l.*,
           round(coalesce(l.land_sq_wa, 0) * coalesce(l.land_price_per_sq_wa, 0), 2) AS land_value,
           round(coalesce(l.building_sqm, 0) * coalesce(l.building_price_per_sqm, 0), 2) AS building_gross
      FROM public.property_tax_lines l
     WHERE l.deleted_at IS NULL),
  c AS (
    SELECT b.*, round(b.building_gross * b.depreciation_pct / 100, 2) AS depreciation FROM b),
  d AS (
    SELECT c.*, c.building_gross - c.depreciation AS building_value,
           c.land_value + c.building_gross - c.depreciation AS total_value,
           greatest(c.land_value + c.building_gross - c.depreciation - c.exemption, 0) AS taxable_value FROM c)
  SELECT d.id, d.asset_id, d.tax_year, d.sort_order, d.description, d.land_sq_wa, d.land_price_per_sq_wa, d.land_value,
         d.building_type, d.building_sqm, d.building_price_per_sqm, d.building_gross, d.building_age, d.depreciation_pct,
         d.depreciation, d.building_value, d.total_value, d.exemption, d.exemption_reason, d.taxable_value,
         d.rate_pct, round(d.taxable_value * d.rate_pct / 100, 2) AS tax_full, d.discount_pct,
         round(d.taxable_value * d.rate_pct / 100 * (1 - d.discount_pct / 100), 2) AS tax_amount,
         d.notes, d.created_at, d.created_by
    FROM d;
REVOKE ALL ON public.v_property_tax_lines FROM PUBLIC, anon;
GRANT SELECT ON public.v_property_tax_lines TO authenticated;

-- ---------------------------------------------------------------- คัดลอกจากปีก่อน
CREATE OR REPLACE FUNCTION public.copy_property_tax_year(p_asset_id uuid, p_from_year integer, p_to_year integer)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
  IF p_from_year = p_to_year THEN RAISE EXCEPTION 'INVALID: ปีต้นทางกับปลายทางต้องต่างกัน' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.property_tax_lines WHERE asset_id = p_asset_id AND tax_year = p_to_year AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ปีนี้มีรายการแล้ว (ลบรายการเดิมก่อนถ้าต้องการคัดลอกใหม่)' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.property_tax_lines(asset_id, tax_year, sort_order, description, land_sq_wa, land_price_per_sq_wa,
              building_type, building_sqm, building_price_per_sqm, building_age, depreciation_pct, exemption, exemption_reason,
              rate_pct, discount_pct, notes)
  SELECT asset_id, p_to_year, sort_order, description, land_sq_wa, land_price_per_sq_wa,
         building_type, building_sqm, building_price_per_sqm,
         CASE WHEN building_age IS NULL THEN NULL ELSE building_age + (p_to_year - p_from_year) END,
         depreciation_pct, exemption, exemption_reason, rate_pct, discount_pct, notes
    FROM public.property_tax_lines
   WHERE asset_id = p_asset_id AND tax_year = p_from_year AND deleted_at IS NULL
   ORDER BY sort_order, created_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'NOT_FOUND: ไม่มีรายการในปีต้นทาง' USING ERRCODE = '22023'; END IF;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.copy_property_tax_year(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_property_tax_year(uuid, integer, integer) TO authenticated;

-- ---------------------------------------------------------------- ยอดประมาณ "ภาษีที่ดิน" = ภาษีรวมปีปัจจุบัน
-- มีรายการค่าใช้จ่ายประจำ "ภาษีที่ดิน" แล้ว → แก้ยอดประมาณ · ยังไม่มี → สร้างใหม่ (รายปี · เม.ย. วันที่ 30)
-- คืนค่า: ภาษีรวม (NULL = ไม่ใช่ปีปัจจุบัน / ไม่มีรายการ → ไม่แก้อะไร)
CREATE OR REPLACE FUNCTION public.sync_land_tax_estimate(p_asset_id uuid, p_tax_year integer)
RETURNS numeric
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_total numeric; v_pid uuid; v_ccy text; v_util uuid;
BEGIN
  IF p_tax_year <> extract(year FROM current_date)::int THEN RETURN NULL; END IF;
  SELECT sum(tax_amount) INTO v_total FROM public.v_property_tax_lines WHERE asset_id = p_asset_id AND tax_year = p_tax_year;
  IF v_total IS NULL THEN RETURN NULL; END IF;
  SELECT pd.id, a.currency INTO v_pid, v_ccy FROM public.property_details pd JOIN public.assets a ON a.id = pd.asset_id
   WHERE pd.asset_id = p_asset_id AND pd.deleted_at IS NULL;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบทรัพย์สิน' USING ERRCODE = '22023'; END IF;
  SELECT u.id INTO v_util FROM public.property_utilities u
   WHERE u.property_id = v_pid AND u.utility_type = 'LAND_TAX' AND u.deleted_at IS NULL
   ORDER BY u.active DESC, u.created_at LIMIT 1;
  IF v_util IS NOT NULL THEN
    UPDATE public.property_utilities
       SET expected_amount = v_total, frequency = coalesce(frequency, 'YEARLY'),
           due_month = CASE WHEN frequency IS NULL THEN 4 ELSE due_month END,
           due_day = CASE WHEN frequency IS NULL THEN 30 ELSE due_day END
     WHERE id = v_util;
  ELSIF v_total > 0 THEN
    INSERT INTO public.property_utilities(property_id, utility_type, provider, expected_amount, frequency, currency, due_day, due_month, notes)
    VALUES (v_pid, 'LAND_TAX', NULL, v_total, 'YEARLY', coalesce(v_ccy, 'THB'), 30, 4, 'ยอดประมาณจากการคำนวณภาษีที่ดิน');
  END IF;
  RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public.sync_land_tax_estimate(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_land_tax_estimate(uuid, integer) TO authenticated;
