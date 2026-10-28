-- =====================================================================
-- Property: มูลค่าแยกตามโฉนด + อาคาร (ตกลง 28 ต.ค. 2026)
--   ★ มูลค่าใน Net Worth ยังเป็นยอดรวมก้อนเดียว (asset_valuations.value) เหมือนเดิม
--     asset_valuation_parts = รายละเอียดแยกส่วนของมูลค่าแต่ละครั้ง (โฉนดแต่ละใบ · อาคาร / สิ่งปลูกสร้าง · อื่น ๆ)
--     ยอดรวมรายส่วนต้องเท่ามูลค่าครั้งนั้น (ตรวจใน set_valuation_parts) · มูลค่าที่ไม่มีรายละเอียด = แสดงยอดรวมอย่างเดียว
--   add_property_valuation(...) = บันทึกมูลค่าใหม่ + รายละเอียดในคราวเดียว
--   แก้มูลค่าครั้งนั้นทางอื่นจนยอดไม่ตรง → รายละเอียดถูกล้าง (กลับเป็นยอดรวมอย่างเดียว) · ลบมูลค่า → ลบรายละเอียดด้วย
--   "จ่ายเพิ่ม" ที่เพิ่มมูลค่า: คัดลอกรายละเอียดครั้งก่อน + แถว "จ่ายเพิ่ม" (ปรับ / ลบตามรายการจ่าย)
--   แก้รายการจ่ายที่ยังไม่ได้เพิ่มมูลค่า → ติ๊ก "เพิ่มมูลค่า" ย้อนหลังได้ (และเอาติ๊กออกได้)
--   งวดที่ปิดแล้ว แก้รายละเอียดไม่ได้ · เพิ่มอย่างเดียว ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.asset_valuation_parts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valuation_id        uuid NOT NULL REFERENCES public.asset_valuations(id),
  asset_id            uuid NOT NULL REFERENCES public.assets(id),          -- ระบบเติมจากมูลค่าครั้งนั้น
  part_type           text NOT NULL CHECK (part_type IN ('DEED','BUILDING','OTHER')),
  deed_id             uuid REFERENCES public.property_deeds(id),
  label               text,
  value               public.d_money NOT NULL,
  sort_order          integer NOT NULL DEFAULT 0,
  source_movement_id  uuid REFERENCES public.cash_movements(id),          -- แถว "จ่ายเพิ่ม" ที่ระบบเพิ่มให้
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id),
  CONSTRAINT avp_value_ck CHECK (value >= 0),
  CONSTRAINT avp_deed_ck  CHECK ((part_type = 'DEED') = (deed_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS avp_valuation_idx ON public.asset_valuation_parts(valuation_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS avp_asset_idx ON public.asset_valuation_parts(asset_id);

DROP TRIGGER IF EXISTS t10_meta ON public.asset_valuation_parts;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.asset_valuation_parts
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.asset_valuation_parts;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.asset_valuation_parts
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.asset_valuation_parts;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.asset_valuation_parts
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

-- ต้องเป็นมูลค่าของ Property ที่ยังไม่ลบ · โฉนดต้องเป็นของทรัพย์สินนี้ · ห้ามย้ายไปมูลค่าครั้งอื่น · งวดที่ปิดแล้วแก้ไม่ได้
CREATE OR REPLACE FUNCTION private.tg_valuation_part_check() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v record; v_locked date;
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
  IF NEW.deed_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.property_deeds d JOIN public.property_details pd ON pd.id = d.property_id
        WHERE d.id = NEW.deed_id AND pd.asset_id = v.asset_id) THEN
    RAISE EXCEPTION 'INVALID: โฉนดนี้ไม่ใช่ของทรัพย์สินนี้' USING ERRCODE = '22023';
  END IF;
  v_locked := private.locked_through(v.family_id);
  IF v_locked IS NOT NULL AND v.valuation_date <= v_locked THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: มูลค่าวันที่ % อยู่ในงวดที่ปิดแล้ว (ถึง %) ต้อง Reopen ก่อน', v.valuation_date, v_locked
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_valuation_part_check() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t20_check ON public.asset_valuation_parts;
CREATE TRIGGER t20_check BEFORE INSERT OR UPDATE ON public.asset_valuation_parts
  FOR EACH ROW EXECUTE FUNCTION private.tg_valuation_part_check();

ALTER TABLE public.asset_valuation_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.asset_valuation_parts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.asset_valuation_parts TO authenticated;
DROP POLICY IF EXISTS p_select ON public.asset_valuation_parts;
CREATE POLICY p_select ON public.asset_valuation_parts FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
DROP POLICY IF EXISTS p_insert ON public.asset_valuation_parts;
CREATE POLICY p_insert ON public.asset_valuation_parts FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR')));
DROP POLICY IF EXISTS p_update ON public.asset_valuation_parts;
CREATE POLICY p_update ON public.asset_valuation_parts FOR UPDATE TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND created_at >= now() - interval '24 hours' AND deleted_at IS NULL))
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND deleted_at IS NULL));

-- ตั้งรายละเอียดแยกส่วนของมูลค่าครั้งหนึ่ง (แทนของเดิมทั้งชุด) · [] / NULL = ล้าง (ยอดรวมอย่างเดียว)
--   p_parts = [{"type":"DEED","deed_id":"…","label":"…","value":123}, {"type":"BUILDING","label":"บ้าน","value":…}, …]
CREATE OR REPLACE FUNCTION public.set_valuation_parts(p_valuation_id uuid, p_parts jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_value numeric; v_sum numeric; v_n integer := 0;
BEGIN
  SELECT av.value INTO v_value FROM public.asset_valuations av WHERE av.id = p_valuation_id AND av.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบมูลค่าครั้งนี้' USING ERRCODE = '22023'; END IF;
  IF p_parts IS NOT NULL AND jsonb_typeof(p_parts) <> 'array' THEN
    RAISE EXCEPTION 'INVALID: รูปแบบรายละเอียดไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF coalesce(jsonb_array_length(p_parts), 0) > 0 THEN
    SELECT sum((x->>'value')::numeric) INTO v_sum FROM jsonb_array_elements(p_parts) x;
    IF v_sum IS NULL OR abs(v_sum - v_value) > 0.005 THEN
      RAISE EXCEPTION 'INVALID: ยอดรวมรายส่วน (%) ไม่เท่ามูลค่า (%)', coalesce(v_sum, 0), v_value USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.asset_valuation_parts SET deleted_at = now() WHERE valuation_id = p_valuation_id AND deleted_at IS NULL;
  IF coalesce(jsonb_array_length(p_parts), 0) > 0 THEN
    INSERT INTO public.asset_valuation_parts(valuation_id, asset_id, part_type, deed_id, label, value, sort_order, source_movement_id)
    SELECT p_valuation_id, av.asset_id, coalesce(nullif(x->>'type', ''), 'OTHER'), nullif(x->>'deed_id', '')::uuid,
           nullif(trim(x->>'label'), ''), (x->>'value')::numeric, o::integer, nullif(x->>'source_movement_id', '')::uuid
      FROM jsonb_array_elements(p_parts) WITH ORDINALITY AS t(x, o)
      JOIN public.asset_valuations av ON av.id = p_valuation_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.set_valuation_parts(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_valuation_parts(uuid, jsonb) TO authenticated;

-- มูลค่าใหม่ของ Property + รายละเอียดแยกส่วนในคราวเดียว → id ของมูลค่าครั้งนั้น
CREATE OR REPLACE FUNCTION public.add_property_valuation(p_asset_id uuid, p_date date, p_value numeric, p_method text,
  p_notes text, p_parts jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id uuid; v_method text := coalesce(nullif(p_method, ''), 'USER_ESTIMATE');
BEGIN
  INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
  VALUES (p_asset_id, p_date, p_value, v_method, CASE WHEN v_method = 'APPRAISAL' THEN 'APPRAISAL' ELSE 'USER' END, nullif(trim(p_notes), ''))
  RETURNING id INTO v_id;
  PERFORM public.set_valuation_parts(v_id, p_parts);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.add_property_valuation(uuid, date, numeric, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_property_valuation(uuid, date, numeric, text, text, jsonb) TO authenticated;

-- มูลค่าถูกแก้ทางอื่นจนยอดรวมรายส่วนไม่ตรง → ล้างรายละเอียด · มูลค่าถูกลบ → ลบรายละเอียดด้วย
CREATE OR REPLACE FUNCTION private.tg_valuation_parts_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.asset_valuation_parts SET deleted_at = now() WHERE valuation_id = NEW.id AND deleted_at IS NULL;
  ELSIF NEW.deleted_at IS NULL AND NEW.value IS DISTINCT FROM OLD.value
        AND abs(coalesce((SELECT sum(p.value) FROM public.asset_valuation_parts p WHERE p.valuation_id = NEW.id AND p.deleted_at IS NULL), NEW.value)
                - NEW.value) > 0.005 THEN
    UPDATE public.asset_valuation_parts SET deleted_at = now() WHERE valuation_id = NEW.id AND deleted_at IS NULL;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.tg_valuation_parts_sync() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS a55_parts_sync ON public.asset_valuations;
CREATE TRIGGER a55_parts_sync AFTER UPDATE ON public.asset_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_valuation_parts_sync();

-- จ่ายเพิ่มที่ติ๊ก "เพิ่มมูลค่า" → มูลค่าใหม่ (+ รายละเอียดครั้งก่อน + แถวจ่ายเพิ่ม) / ปรับตาม / ลบตาม · ติ๊กย้อนหลัง / เอาติ๊กออกได้
CREATE OR REPLACE FUNCTION private.tg_property_pay_value() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_prev record; v_ccy text; v_id uuid; v_on boolean; v_was boolean;
BEGIN
  IF NEW.movement_type <> 'ASSET_PURCHASE' THEN RETURN NULL; END IF;
  v_on := coalesce(NEW.metadata->>'add_value', '') = 'true';
  v_was := TG_OP = 'UPDATE' AND coalesce(OLD.metadata->>'add_value', '') = 'true';
  IF NOT v_on AND NOT v_was THEN RETURN NULL; END IF;
  SELECT a.currency INTO v_ccy FROM public.assets a
   WHERE a.id = NEW.to_asset_id AND EXISTS (SELECT 1 FROM public.property_details pd WHERE pd.asset_id = a.id AND pd.deleted_at IS NULL);
  IF v_ccy IS NULL OR v_ccy <> NEW.currency THEN RETURN NULL; END IF;

  IF NEW.deleted_at IS NOT NULL OR (v_was AND NOT v_on) THEN
    -- ลบรายการจ่าย / เอาติ๊กเพิ่มมูลค่าออก → ลบมูลค่าที่ระบบเพิ่มให้
    IF TG_OP = 'UPDATE' AND (OLD.deleted_at IS NULL) THEN
      UPDATE public.asset_valuations SET deleted_at = now() WHERE source_movement_id = NEW.id AND deleted_at IS NULL;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.asset_valuations WHERE source_movement_id = NEW.id AND deleted_at IS NULL) THEN
    -- ใหม่ / ติ๊กย้อนหลัง → มูลค่าใหม่ = มูลค่าล่าสุด ณ วันที่จ่าย + ยอดจ่าย
    SELECT v.id, v.value INTO v_prev FROM public.asset_valuations v
     WHERE v.asset_id = NEW.to_asset_id AND v.deleted_at IS NULL AND v.valuation_date <= NEW.movement_date
     ORDER BY v.valuation_date DESC, v.created_at DESC LIMIT 1;
    INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes, source_movement_id)
    VALUES (NEW.to_asset_id, NEW.movement_date, coalesce(v_prev.value, 0) + NEW.amount, 'BOOK_VALUE', 'USER',
            'จ่ายเพิ่ม' || coalesce(' · ' || nullif(trim(NEW.description), ''), ''), NEW.id)
    RETURNING id INTO v_id;
    -- ครั้งก่อนมีรายละเอียดแยกส่วน → คัดลอก + แถวจ่ายเพิ่ม
    IF v_prev.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.asset_valuation_parts p WHERE p.valuation_id = v_prev.id AND p.deleted_at IS NULL) THEN
      INSERT INTO public.asset_valuation_parts(valuation_id, asset_id, part_type, deed_id, label, value, sort_order, source_movement_id)
      SELECT v_id, p.asset_id, p.part_type, p.deed_id, p.label, p.value, p.sort_order, p.source_movement_id
        FROM public.asset_valuation_parts p WHERE p.valuation_id = v_prev.id AND p.deleted_at IS NULL;
      INSERT INTO public.asset_valuation_parts(valuation_id, asset_id, part_type, label, value, sort_order, source_movement_id)
      VALUES (v_id, NEW.to_asset_id, 'OTHER', 'จ่ายเพิ่ม' || coalesce(' · ' || nullif(trim(NEW.description), ''), ''), NEW.amount,
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
