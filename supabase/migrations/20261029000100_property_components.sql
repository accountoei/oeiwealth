-- =====================================================================
-- Property: ทรัพย์สิน = ชุดของ "ส่วนประกอบ" (ตกลง 29 ต.ค. 2026)
--   property_deeds เดิม (โฉนด) ขยายเป็นตารางส่วนประกอบ: ที่ดิน (LAND = โฉนด) · อาคาร (BUILDING) · สิ่งปลูกสร้างอื่น (OTHER)
--   แต่ละแถวมี ข้อมูลตัวทรัพย์ + วันที่ได้มา + ต้นทุนที่ได้มา (acq_cost) + อายุใช้งาน (อาคาร / อื่น ๆ)
--   มูลค่าแต่ละแถว = asset_valuation_parts.deed_id (ชี้ได้ทุกชนิด) · Net Worth ยังใช้ยอดรวม (asset_valuations.value)
--   เนื้อที่ / เลขที่โฉนดของทรัพย์สิน = ผลรวมเฉพาะแถวที่ดิน
--   ต้นทุนรายก้อน (v_property_cost_lots): มีต้นทุนรายแถว → ราคาที่ได้มาแยกตามแถว (อาคารหักค่าเสื่อมตามอายุของหลังนั้น)
--   save_property_components(...) = บันทึกตารางส่วนประกอบทั้งชุด (+ มูลค่าใหม่ ถ้ามี) ในคราวเดียว
--   จ่ายเพิ่มที่เพิ่มมูลค่า + ครั้งก่อนมีรายละเอียด → แถวจ่ายเพิ่มผูกกับส่วนประกอบ (เลือกได้ metadata.component_id · ไม่เลือก = สร้างแถว "อื่น ๆ" ให้)
--   ย้ายข้อมูลเดิม: ค่าอาคารในราคาที่ได้มา → แถวอาคาร · มูลค่ารายส่วนที่ยังไม่ผูก → แถวส่วนประกอบตามชื่อ
--   ★ ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) คอลัมน์ส่วนประกอบ ---------------------------------------------------------------------------------
ALTER TABLE public.property_deeds ADD COLUMN IF NOT EXISTS component_type text NOT NULL DEFAULT 'LAND';
ALTER TABLE public.property_deeds ADD COLUMN IF NOT EXISTS label text;                       -- ชื่อ เช่น บ้านเดี่ยว 2 ชั้น · รั้ว
ALTER TABLE public.property_deeds ADD COLUMN IF NOT EXISTS building_area_sqm numeric(14,2);  -- พื้นที่ใช้สอย (ตร.ม.)
ALTER TABLE public.property_deeds ADD COLUMN IF NOT EXISTS useful_life_years integer;       -- อายุใช้งาน (ปี) ใช้หักค่าเสื่อม
ALTER TABLE public.property_deeds ADD COLUMN IF NOT EXISTS acquired_date date;              -- วันที่ได้มา / สร้างเสร็จ (ว่าง = วันที่ได้มาของทรัพย์สิน)
ALTER TABLE public.property_deeds ADD COLUMN IF NOT EXISTS acq_cost public.d_money;         -- ต้นทุนที่ได้มาของแถวนี้ (ส่วนของราคาที่ได้มา)
ALTER TABLE public.property_deeds ADD COLUMN IF NOT EXISTS source_movement_id uuid REFERENCES public.cash_movements(id);  -- แถวที่ระบบสร้างจากจ่ายเพิ่ม
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pdeed_component_ck') THEN
    ALTER TABLE public.property_deeds ADD CONSTRAINT pdeed_component_ck CHECK (
      component_type IN ('LAND','BUILDING','OTHER')
      AND (building_area_sqm IS NULL OR building_area_sqm >= 0)
      AND (useful_life_years IS NULL OR useful_life_years BETWEEN 1 AND 100)
      AND (acq_cost IS NULL OR acq_cost >= 0)
      AND (component_type = 'LAND' OR land_area_sq_wa IS NULL));
  END IF;
END $$;

-- 2) ค่าสรุปที่ทรัพย์สิน = เฉพาะแถวที่ดิน ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_property_deed_summary() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_n integer; v_area numeric; v_nos text;
BEGIN
  SELECT count(*), sum(d.land_area_sq_wa),
         string_agg(nullif(trim(d.title_deed_no), ''), ', ' ORDER BY d.sort_order, d.created_at, d.id)
    INTO v_n, v_area, v_nos
    FROM public.property_deeds d WHERE d.property_id = NEW.id AND d.deleted_at IS NULL AND d.component_type = 'LAND';
  IF v_n > 0 THEN
    NEW.land_area_sq_wa := v_area;
    NEW.title_deed_no   := v_nos;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_property_deed_summary() FROM PUBLIC, anon;

-- 3) มูลค่ารายส่วนชี้ได้ทุกส่วนประกอบ · ชนิดของรายส่วนตามชนิดของส่วนประกอบ ------------------------------------
ALTER TABLE public.asset_valuation_parts DROP CONSTRAINT IF EXISTS avp_deed_ck;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'avp_deed_ck2') THEN
    ALTER TABLE public.asset_valuation_parts ADD CONSTRAINT avp_deed_ck2 CHECK (part_type <> 'DEED' OR deed_id IS NOT NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS avp_deed_idx ON public.asset_valuation_parts(deed_id) WHERE deed_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.tg_valuation_part_check() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v record; v_locked date; v_type text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.valuation_id IS DISTINCT FROM OLD.valuation_id THEN
    RAISE EXCEPTION 'INVALID: ย้ายรายละเอียดไปมูลค่าครั้งอื่นไม่ได้' USING ERRCODE = '22023';
  END IF;
  SELECT av.asset_id, av.valuation_date, av.deleted_at, a.family_id INTO v
    FROM public.asset_valuations av JOIN public.assets a ON a.id = av.asset_id
   WHERE av.id = NEW.valuation_id;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.property_details pd WHERE pd.asset_id = v.asset_id AND pd.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: รายละเอียดมูลค่าใช้ได้เฉพาะทรัพย์สินประเภท Property' USING ERRCODE = '22023';
  END IF;
  IF v.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'INVALID: มูลค่าครั้งนี้ถูกลบแล้ว' USING ERRCODE = '22023';
  END IF;
  NEW.asset_id := v.asset_id;
  IF NEW.deed_id IS NOT NULL THEN
    SELECT d.component_type INTO v_type
      FROM public.property_deeds d JOIN public.property_details pd ON pd.id = d.property_id
     WHERE d.id = NEW.deed_id AND pd.asset_id = v.asset_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID: ส่วนประกอบนี้ไม่ใช่ของทรัพย์สินนี้' USING ERRCODE = '22023';
    END IF;
    NEW.part_type := CASE v_type WHEN 'LAND' THEN 'DEED' ELSE v_type END;
  END IF;
  v_locked := private.locked_through(v.family_id);
  IF v_locked IS NOT NULL AND v.valuation_date <= v_locked THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: มูลค่าวันที่ % อยู่ในงวดที่ปิดแล้ว (ถึง %) ต้อง Reopen ก่อน', v.valuation_date, v_locked
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_valuation_part_check() FROM PUBLIC, anon;

-- 4) บันทึกตารางส่วนประกอบทั้งชุด (+ มูลค่าใหม่) ---------------------------------------------------------------
--   p_rows = [{id?, type, label, title_type, title_deed_no, land_no, deed_book, deed_page, map_sheet, survey_page, land_area_sq_wa,
--             building_area_sqm, useful_life_years, acquired_date, acq_cost, notes, value?}, …] เรียงตามลำดับที่แสดง
--   p_removed = id ส่วนประกอบที่ลบ (soft delete · สิทธิ์ตาม RLS)
--   p_valuation = {date, method, notes, total?} หรือ NULL (ไม่บันทึกมูลค่า) · มี value รายแถว → ต้องครบทุกแถว ยอดรวม = ผลรวม
--   คืน id ของแต่ละแถวตามลำดับ p_rows
CREATE OR REPLACE FUNCTION public.save_property_components(p_asset_id uuid, p_rows jsonb, p_removed uuid[], p_valuation jsonb)
RETURNS uuid[]
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_pid uuid; r record; v_id uuid; v_ids uuid[] := '{}'; v_type text; v_n integer; v_withval integer; v_parts jsonb := '[]';
        v_total numeric; v_latest uuid; v_label text;
BEGIN
  SELECT pd.id INTO v_pid FROM public.property_details pd WHERE pd.asset_id = p_asset_id AND pd.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบทรัพย์สิน' USING ERRCODE = '22023'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'INVALID: รูปแบบตารางส่วนประกอบไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_rows);
  SELECT count(*) INTO v_withval FROM jsonb_array_elements(p_rows) x WHERE nullif(x->>'value', '') IS NOT NULL;
  IF p_valuation IS NOT NULL AND v_withval > 0 AND v_withval < v_n THEN
    RAISE EXCEPTION 'INVALID: ใส่มูลค่าให้ครบทุกแถว หรือเว้นว่างทุกแถวแล้วใส่ยอดรวม' USING ERRCODE = '22023';
  END IF;

  -- ลบก่อน (ตรวจด้านล่างว่าส่วนที่ลบยังมีมูลค่าในครั้งล่าสุดหรือไม่)
  IF coalesce(array_length(p_removed, 1), 0) > 0 THEN
    UPDATE public.property_deeds SET deleted_at = now()
     WHERE id = ANY(p_removed) AND property_id = v_pid AND deleted_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (SELECT count(DISTINCT x) FROM unnest(p_removed) x) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: ลบส่วนประกอบไม่ได้ (ไม่มีสิทธิ์ หรือถูกลบไปแล้ว)' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR r IN SELECT x, o FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(x, o) LOOP
    v_type := coalesce(nullif(r.x->>'type', ''), 'LAND');
    IF v_type NOT IN ('LAND','BUILDING','OTHER') THEN
      RAISE EXCEPTION 'INVALID: ชนิดส่วนประกอบไม่ถูกต้อง (แถวที่ %)', r.o USING ERRCODE = '22023';
    END IF;
    v_label := nullif(trim(r.x->>'label'), '');
    IF v_type = 'LAND' AND num_nonnulls(nullif(trim(r.x->>'title_deed_no'), ''), nullif(trim(r.x->>'land_no'), ''),
                                       nullif(r.x->>'land_area_sq_wa', ''), v_label) = 0 THEN
      RAISE EXCEPTION 'INVALID: แถวที่ % (ที่ดิน) ใส่เลขที่โฉนด เลขที่ดิน หรือเนื้อที่ อย่างน้อย 1 ช่อง', r.o USING ERRCODE = '22023';
    END IF;
    IF v_type <> 'LAND' AND v_label IS NULL THEN
      RAISE EXCEPTION 'INVALID: แถวที่ % ใส่ชื่ออาคาร / สิ่งปลูกสร้าง', r.o USING ERRCODE = '22023';
    END IF;
    IF nullif(r.x->>'id', '') IS NOT NULL THEN
      UPDATE public.property_deeds SET
        sort_order = r.o::integer, component_type = v_type, label = v_label,
        title_type = CASE WHEN v_type = 'LAND' THEN nullif(trim(r.x->>'title_type'), '') END,
        title_deed_no = CASE WHEN v_type = 'LAND' THEN nullif(trim(r.x->>'title_deed_no'), '') END,
        land_no = CASE WHEN v_type = 'LAND' THEN nullif(trim(r.x->>'land_no'), '') END,
        deed_book = CASE WHEN v_type = 'LAND' THEN nullif(trim(r.x->>'deed_book'), '') END,
        deed_page = CASE WHEN v_type = 'LAND' THEN nullif(trim(r.x->>'deed_page'), '') END,
        map_sheet = CASE WHEN v_type = 'LAND' THEN nullif(trim(r.x->>'map_sheet'), '') END,
        survey_page = CASE WHEN v_type = 'LAND' THEN nullif(trim(r.x->>'survey_page'), '') END,
        land_area_sq_wa = CASE WHEN v_type = 'LAND' THEN nullif(r.x->>'land_area_sq_wa', '')::numeric END,
        building_area_sqm = CASE WHEN v_type <> 'LAND' THEN nullif(r.x->>'building_area_sqm', '')::numeric END,
        useful_life_years = CASE WHEN v_type <> 'LAND' THEN nullif(r.x->>'useful_life_years', '')::integer END,
        acquired_date = nullif(r.x->>'acquired_date', '')::date,
        acq_cost = nullif(r.x->>'acq_cost', '')::numeric,
        notes = nullif(trim(r.x->>'notes'), '')
       WHERE id = (r.x->>'id')::uuid AND property_id = v_pid AND deleted_at IS NULL
      RETURNING id INTO v_id;
      IF v_id IS NULL THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: แก้ส่วนประกอบแถวที่ % ไม่ได้ (ไม่มีสิทธิ์ หรือถูกลบไปแล้ว)', r.o USING ERRCODE = '42501';
      END IF;
    ELSE
      INSERT INTO public.property_deeds(property_id, sort_order, component_type, label, title_type, title_deed_no, land_no, deed_book,
                                        deed_page, map_sheet, survey_page, land_area_sq_wa, building_area_sqm, useful_life_years,
                                        acquired_date, acq_cost, notes)
      VALUES (v_pid, r.o::integer, v_type, v_label,
              CASE WHEN v_type = 'LAND' THEN nullif(trim(r.x->>'title_type'), '') END,
              CASE WHEN v_type = 'LAND' THEN nullif(trim(r.x->>'title_deed_no'), '') END,
              CASE WHEN v_type = 'LAND' THEN nullif(trim(r.x->>'land_no'), '') END,
              CASE WHEN v_type = 'LAND' THEN nullif(trim(r.x->>'deed_book'), '') END,
              CASE WHEN v_type = 'LAND' THEN nullif(trim(r.x->>'deed_page'), '') END,
              CASE WHEN v_type = 'LAND' THEN nullif(trim(r.x->>'map_sheet'), '') END,
              CASE WHEN v_type = 'LAND' THEN nullif(trim(r.x->>'survey_page'), '') END,
              CASE WHEN v_type = 'LAND' THEN nullif(r.x->>'land_area_sq_wa', '')::numeric END,
              CASE WHEN v_type <> 'LAND' THEN nullif(r.x->>'building_area_sqm', '')::numeric END,
              CASE WHEN v_type <> 'LAND' THEN nullif(r.x->>'useful_life_years', '')::integer END,
              nullif(r.x->>'acquired_date', '')::date, nullif(r.x->>'acq_cost', '')::numeric, nullif(trim(r.x->>'notes'), ''))
      RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || v_id;
    IF nullif(r.x->>'value', '') IS NOT NULL THEN
      v_parts := v_parts || jsonb_build_array(jsonb_build_object('type', CASE v_type WHEN 'LAND' THEN 'DEED' ELSE v_type END,
                                                                 'deed_id', v_id, 'value', (r.x->>'value')::numeric));
    END IF;
    v_id := NULL;
  END LOOP;

  IF p_valuation IS NOT NULL THEN
    v_total := CASE WHEN jsonb_array_length(v_parts) > 0 THEN (SELECT sum((p->>'value')::numeric) FROM jsonb_array_elements(v_parts) p)
                    ELSE nullif(p_valuation->>'total', '')::numeric END;
    IF v_total IS NULL OR v_total < 0 THEN
      RAISE EXCEPTION 'INVALID: กรุณาใส่มูลค่า' USING ERRCODE = '22023';
    END IF;
    PERFORM public.add_property_valuation(p_asset_id, nullif(p_valuation->>'date', '')::date, v_total,
                                          p_valuation->>'method', p_valuation->>'notes', v_parts);
  ELSIF coalesce(array_length(p_removed, 1), 0) > 0 THEN
    -- ลบส่วนที่ยังมีมูลค่าในครั้งล่าสุด → ต้องบันทึกมูลค่าใหม่ด้วย (ไม่งั้นยอดรวมรายส่วนไม่ตรง)
    SELECT v.id INTO v_latest FROM public.asset_valuations v WHERE v.asset_id = p_asset_id AND v.deleted_at IS NULL
     ORDER BY v.valuation_date DESC, v.created_at DESC LIMIT 1;
    IF EXISTS (SELECT 1 FROM public.asset_valuation_parts p WHERE p.valuation_id = v_latest AND p.deleted_at IS NULL
                AND p.deed_id = ANY(p_removed)) THEN
      RAISE EXCEPTION 'INVALID: ส่วนที่ลบยังมีมูลค่าอยู่ ต้องบันทึกมูลค่าใหม่ไปพร้อมกัน' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN v_ids;
END $$;
REVOKE ALL ON FUNCTION public.save_property_components(uuid, jsonb, uuid[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_property_components(uuid, jsonb, uuid[], jsonb) TO authenticated;

-- 5) จ่ายเพิ่มที่เพิ่มมูลค่า: แถวจ่ายเพิ่มผูกกับส่วนประกอบ ---------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_property_pay_value() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_prev record; v_ccy text; v_id uuid; v_on boolean; v_was boolean; v_comp uuid; v_pid uuid; v_label text;
BEGIN
  IF NEW.movement_type <> 'ASSET_PURCHASE' THEN RETURN NULL; END IF;
  v_on := coalesce(NEW.metadata->>'add_value', '') = 'true';
  v_was := TG_OP = 'UPDATE' AND coalesce(OLD.metadata->>'add_value', '') = 'true';
  IF NOT v_on AND NOT v_was THEN RETURN NULL; END IF;
  SELECT a.currency, pd.id INTO v_ccy, v_pid FROM public.assets a
    JOIN public.property_details pd ON pd.asset_id = a.id AND pd.deleted_at IS NULL
   WHERE a.id = NEW.to_asset_id;
  IF v_ccy IS NULL OR v_ccy <> NEW.currency THEN RETURN NULL; END IF;

  IF NEW.deleted_at IS NOT NULL OR (v_was AND NOT v_on) THEN
    -- ลบรายการจ่าย / เอาติ๊กเพิ่มมูลค่าออก → ลบมูลค่าที่ระบบเพิ่มให้ (+ แถวอื่น ๆ ที่ระบบสร้างให้ ถ้าไม่มีมูลค่าครั้งอื่นใช้อยู่)
    IF TG_OP = 'UPDATE' AND (OLD.deleted_at IS NULL) THEN
      UPDATE public.asset_valuations SET deleted_at = now() WHERE source_movement_id = NEW.id AND deleted_at IS NULL;
      UPDATE public.property_deeds d SET deleted_at = now()
       WHERE d.source_movement_id = NEW.id AND d.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.asset_valuation_parts p WHERE p.deed_id = d.id AND p.deleted_at IS NULL);
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.asset_valuations WHERE source_movement_id = NEW.id AND deleted_at IS NULL) THEN
    -- ใหม่ / ติ๊กย้อนหลัง → มูลค่าใหม่ = มูลค่าล่าสุด ณ วันที่จ่าย + ยอดจ่าย
    SELECT v.id, v.value INTO v_prev FROM public.asset_valuations v
     WHERE v.asset_id = NEW.to_asset_id AND v.deleted_at IS NULL AND v.valuation_date <= NEW.movement_date
     ORDER BY v.valuation_date DESC, v.created_at DESC LIMIT 1;
    v_label := 'จ่ายเพิ่ม' || coalesce(' · ' || nullif(trim(NEW.description), ''), '');
    INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes, source_movement_id)
    VALUES (NEW.to_asset_id, NEW.movement_date, coalesce(v_prev.value, 0) + NEW.amount, 'BOOK_VALUE', 'USER', v_label, NEW.id)
    RETURNING id INTO v_id;
    -- ครั้งก่อนมีรายละเอียดแยกส่วน → คัดลอก + แถวจ่ายเพิ่ม (ผูกกับส่วนประกอบที่เลือก หรือแถว "อื่น ๆ" ที่สร้างให้)
    IF v_prev.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.asset_valuation_parts p WHERE p.valuation_id = v_prev.id AND p.deleted_at IS NULL) THEN
      INSERT INTO public.asset_valuation_parts(valuation_id, asset_id, part_type, deed_id, label, value, sort_order, source_movement_id)
      SELECT v_id, p.asset_id, p.part_type, p.deed_id, p.label, p.value, p.sort_order, p.source_movement_id
        FROM public.asset_valuation_parts p WHERE p.valuation_id = v_prev.id AND p.deleted_at IS NULL;
      SELECT d.id INTO v_comp FROM public.property_deeds d
       WHERE d.id = nullif(NEW.metadata->>'component_id', '')::uuid AND d.property_id = v_pid AND d.deleted_at IS NULL;
      IF v_comp IS NULL THEN
        SELECT d.id INTO v_comp FROM public.property_deeds d WHERE d.source_movement_id = NEW.id AND d.deleted_at IS NULL LIMIT 1;
      END IF;
      IF v_comp IS NULL THEN
        INSERT INTO public.property_deeds(property_id, sort_order, component_type, label, acquired_date, source_movement_id)
        VALUES (v_pid, coalesce((SELECT max(d.sort_order) FROM public.property_deeds d WHERE d.property_id = v_pid AND d.deleted_at IS NULL), 0) + 1,
                'OTHER', v_label, NEW.movement_date, NEW.id)
        RETURNING id INTO v_comp;
      END IF;
      INSERT INTO public.asset_valuation_parts(valuation_id, asset_id, part_type, deed_id, label, value, sort_order, source_movement_id)
      VALUES (v_id, NEW.to_asset_id, 'OTHER', v_comp, v_label, NEW.amount,
              coalesce((SELECT max(p.sort_order) FROM public.asset_valuation_parts p WHERE p.valuation_id = v_prev.id AND p.deleted_at IS NULL), 0) + 1,
              NEW.id);
    END IF;
  ELSIF TG_OP = 'UPDATE' AND (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.movement_date IS DISTINCT FROM OLD.movement_date) THEN
    -- แก้ยอด / วันที่ → มูลค่า (และแถวจ่ายเพิ่มในรายละเอียด) ปรับตามส่วนต่าง
    UPDATE public.asset_valuation_parts p SET value = p.value + (NEW.amount - OLD.amount)
     WHERE p.source_movement_id = NEW.id AND p.deleted_at IS NULL
       AND p.valuation_id IN (SELECT v.id FROM public.asset_valuations v WHERE v.source_movement_id = NEW.id AND v.deleted_at IS NULL);
    UPDATE public.asset_valuations SET value = value + (NEW.amount - OLD.amount), valuation_date = NEW.movement_date
     WHERE source_movement_id = NEW.id AND deleted_at IS NULL;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.tg_property_pay_value() FROM PUBLIC, anon;

-- 6) ต้นทุนแต่ละก้อน: มีต้นทุนรายแถว → ราคาที่ได้มาแยกตามแถว (ที่เหลือ = ส่วนที่ยังไม่แยก) · ไม่มี → แบบเดิม --------------
CREATE OR REPLACE VIEW public.v_property_cost_lots WITH (security_invoker = true) AS
WITH base AS (
  SELECT a.id AS asset_id, a.currency, a.acquisition_date, a.acquisition_cost,
         least(coalesce(pd.acq_building_cost, 0), coalesce(a.acquisition_cost, 0)) AS acq_building, pd.acq_building_years,
         pd.opportunity_rate_pct AS own_rate, f.opportunity_rate_pct AS family_rate, pd.id AS property_id,
         (SELECT sum(d.acq_cost) FROM public.property_deeds d WHERE d.property_id = pd.id AND d.deleted_at IS NULL) AS comp_cost,
         -- "จ่ายจากบัญชี" ตอนเพิ่มทรัพย์สิน = เงินออกวันเดียวกัน ยอดเท่าราคาที่ได้มา → ซ้ำกับราคาที่ได้มา ไม่นับอีก
         (SELECT m.id FROM public.cash_movements m
           WHERE m.to_asset_id = a.id AND m.movement_type = 'ASSET_PURCHASE' AND m.deleted_at IS NULL
             AND m.movement_date = a.acquisition_date AND m.amount = a.acquisition_cost
           ORDER BY m.created_at, m.id LIMIT 1) AS acq_movement_id
    FROM public.assets a
    JOIN public.property_details pd ON pd.asset_id = a.id AND pd.deleted_at IS NULL
    LEFT JOIN public.families f ON true
   WHERE a.deleted_at IS NULL
), lots AS (
  -- แบบเดิม (ยังไม่มีต้นทุนรายแถว)
  SELECT b.asset_id, 'ACQUISITION'::text AS source, NULL::uuid AS item_id, NULL::uuid AS movement_id,
         b.acquisition_date AS lot_date, (b.acquisition_cost - b.acq_building)::public.d_money AS amount,
         CASE WHEN b.acq_building > 0 THEN 'ราคาที่ได้มา (ที่ดิน)' ELSE 'ราคาที่ได้มา' END::text AS description,
         false AS is_building, NULL::integer AS depreciation_years, NULL::text AS notes
    FROM base b WHERE b.comp_cost IS NULL AND b.acquisition_cost > b.acq_building AND b.acquisition_date IS NOT NULL
  UNION ALL
  SELECT b.asset_id, 'ACQUISITION', NULL, NULL, b.acquisition_date, b.acq_building::public.d_money, 'ราคาที่ได้มา (อาคาร)',
         true, b.acq_building_years, NULL
    FROM base b WHERE b.comp_cost IS NULL AND b.acq_building > 0 AND b.acquisition_date IS NOT NULL
  UNION ALL
  -- ต้นทุนรายแถวของส่วนประกอบ
  SELECT b.asset_id, 'ACQUISITION', NULL, NULL, coalesce(d.acquired_date, b.acquisition_date), d.acq_cost,
         'ราคาที่ได้มา · ' || coalesce(d.label, nullif(concat_ws(' ', d.title_type, 'เลขที่ ' || d.title_deed_no), ''),
                                      CASE d.component_type WHEN 'LAND' THEN 'ที่ดิน' WHEN 'BUILDING' THEN 'อาคาร' ELSE 'อื่น ๆ' END),
         d.component_type <> 'LAND', CASE WHEN d.component_type <> 'LAND' THEN coalesce(d.useful_life_years, 20) END, NULL
    FROM base b JOIN public.property_deeds d ON d.property_id = b.property_id AND d.deleted_at IS NULL
   WHERE b.comp_cost IS NOT NULL AND d.acq_cost > 0 AND coalesce(d.acquired_date, b.acquisition_date) IS NOT NULL
  UNION ALL
  SELECT b.asset_id, 'ACQUISITION', NULL, NULL, b.acquisition_date, (b.acquisition_cost - b.comp_cost)::public.d_money,
         'ราคาที่ได้มา (ส่วนที่ยังไม่แยก)', false, NULL, NULL
    FROM base b WHERE b.comp_cost IS NOT NULL AND b.acquisition_cost - b.comp_cost > 0.005 AND b.acquisition_date IS NOT NULL
  UNION ALL
  SELECT b.asset_id, 'PAYMENT', NULL, m.id, m.movement_date, m.amount, coalesce(m.description, 'จ่ายเพิ่ม'), false, NULL, NULL
    FROM base b
    JOIN public.cash_movements m ON m.to_asset_id = b.asset_id AND m.movement_type = 'ASSET_PURCHASE' AND m.deleted_at IS NULL
                                AND m.currency = b.currency
   WHERE m.id IS DISTINCT FROM b.acq_movement_id
     AND NOT EXISTS (SELECT 1 FROM public.property_cost_items i WHERE i.movement_id = m.id AND i.deleted_at IS NULL)
  UNION ALL
  SELECT i.asset_id, CASE WHEN i.movement_id IS NULL THEN 'MANUAL' ELSE 'PAYMENT' END, i.id, i.movement_id,
         i.cost_date, i.amount, i.description, i.is_building, i.depreciation_years, i.notes
    FROM public.property_cost_items i
    JOIN base b ON b.asset_id = i.asset_id
   WHERE i.deleted_at IS NULL
     AND (i.movement_id IS NULL OR EXISTS (SELECT 1 FROM public.cash_movements m WHERE m.id = i.movement_id AND m.deleted_at IS NULL))
)
SELECT l.*, coalesce(b.own_rate, b.family_rate, 0) AS rate_pct,
       round(greatest((now() AT TIME ZONE 'Asia/Bangkok')::date - l.lot_date, 0) / 365.0, 4) AS years_held,
       round(l.amount * (power(1 + coalesce(b.own_rate, b.family_rate, 0) / 100.0,
                               greatest((now() AT TIME ZONE 'Asia/Bangkok')::date - l.lot_date, 0) / 365.0) - 1), 2) AS interest,
       CASE WHEN l.is_building THEN round(l.amount * least(greatest((now() AT TIME ZONE 'Asia/Bangkok')::date - l.lot_date, 0) / 365.0
                                                           / l.depreciation_years, 1), 2) ELSE 0 END AS depreciation
  FROM lots l JOIN base b ON b.asset_id = l.asset_id;
REVOKE ALL ON public.v_property_cost_lots FROM PUBLIC, anon;
GRANT SELECT ON public.v_property_cost_lots TO authenticated;

-- 7) ย้ายข้อมูลเดิม (รันซ้ำไม่สร้างซ้ำ) -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.property_components_backfill() RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE g record; v_id uuid; v_n integer := 0; v_b integer; v_one boolean;
BEGIN
  -- มูลค่ารายส่วน (อาคาร / อื่น ๆ) ที่ยังไม่ผูก → แถวส่วนประกอบตามชื่อ
  --   ทรัพย์สินที่มีค่าอาคารในราคาที่ได้มา + มีชื่ออาคารชื่อเดียว → แถวเดียวกัน (ต้นทุน = ค่าอาคาร)
  FOR g IN
    SELECT p.asset_id, pd.id AS property_id, p.part_type, coalesce(p.label, '') AS label, min(v.valuation_date) AS first_date,
           bool_and(p.source_movement_id IS NOT NULL) AS from_pay, min(p.source_movement_id::text)::uuid AS mv,
           pd.acq_building_cost, pd.acq_building_years, a.acquisition_date
      FROM public.asset_valuation_parts p
      JOIN public.asset_valuations v ON v.id = p.valuation_id
      JOIN public.property_details pd ON pd.asset_id = p.asset_id AND pd.deleted_at IS NULL
      JOIN public.assets a ON a.id = p.asset_id
     WHERE p.deed_id IS NULL AND p.part_type <> 'DEED'
     GROUP BY p.asset_id, pd.id, p.part_type, coalesce(p.label, ''), pd.acq_building_cost, pd.acq_building_years, a.acquisition_date
  LOOP
    v_one := g.part_type = 'BUILDING' AND coalesce(g.acq_building_cost, 0) > 0
             AND (SELECT count(DISTINCT coalesce(x.label, '')) FROM public.asset_valuation_parts x
                   WHERE x.asset_id = g.asset_id AND x.deed_id IS NULL AND x.part_type = 'BUILDING') = 1
             AND NOT EXISTS (SELECT 1 FROM public.property_deeds d WHERE d.property_id = g.property_id AND d.component_type = 'BUILDING');
    INSERT INTO public.property_deeds(property_id, sort_order, component_type, label, acquired_date, acq_cost, useful_life_years,
                                      source_movement_id)
    VALUES (g.property_id,
            coalesce((SELECT max(d.sort_order) FROM public.property_deeds d WHERE d.property_id = g.property_id AND d.deleted_at IS NULL), 0) + 1,
            g.part_type, coalesce(nullif(g.label, ''), CASE g.part_type WHEN 'BUILDING' THEN 'อาคาร' ELSE 'อื่น ๆ' END),
            CASE WHEN v_one THEN g.acquisition_date WHEN g.from_pay THEN g.first_date END,
            CASE WHEN v_one THEN g.acq_building_cost END,
            CASE WHEN g.part_type = 'BUILDING' THEN coalesce(CASE WHEN v_one THEN g.acq_building_years END, 20) END,
            CASE WHEN g.from_pay THEN g.mv END)
    RETURNING id INTO v_id;
    UPDATE public.asset_valuation_parts SET deed_id = v_id
     WHERE asset_id = g.asset_id AND deed_id IS NULL AND part_type = g.part_type AND coalesce(label, '') = g.label;
    v_n := v_n + 1;
  END LOOP;
  -- ค่าอาคารในราคาที่ได้มา (ยังไม่มีแถวอาคาร) → แถวอาคาร
  INSERT INTO public.property_deeds(property_id, sort_order, component_type, label, acquired_date, acq_cost, useful_life_years)
  SELECT pd.id, coalesce((SELECT max(d.sort_order) FROM public.property_deeds d WHERE d.property_id = pd.id AND d.deleted_at IS NULL), 0) + 1,
         'BUILDING', 'อาคาร', a.acquisition_date, pd.acq_building_cost, pd.acq_building_years
    FROM public.property_details pd JOIN public.assets a ON a.id = pd.asset_id
   WHERE pd.deleted_at IS NULL AND coalesce(pd.acq_building_cost, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM public.property_deeds d WHERE d.property_id = pd.id AND d.component_type = 'BUILDING');
  GET DIAGNOSTICS v_b = ROW_COUNT;
  RETURN v_n + v_b;
END $$;
REVOKE ALL ON FUNCTION private.property_components_backfill() FROM PUBLIC, anon, authenticated;

SELECT private.property_components_backfill() AS components_created;
