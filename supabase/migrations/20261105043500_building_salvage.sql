-- =====================================================================
-- ราคาซากสิ่งปลูกสร้าง + อายุใช้งาน 0 ปี = ไม่หักค่าเสื่อม (ตกลง 5 พ.ย. 2026)
--   property_deeds.salvage_value (บาท) / salvage_pct (% ของต้นทุน) — ใส่ได้อย่างใดอย่างหนึ่ง เฉพาะสิ่งปลูกสร้าง · ว่าง = 0
--   ค่าเสื่อม (ราคาขายขั้นต่ำที่คุ้ม · ไม่นับในความมั่งคั่งสุทธิ) = (ต้นทุน − ราคาซาก) × ปีที่ถือ ÷ อายุใช้งาน
--   ราคาซากเป็นบาท + แถวมีต้นทุนหลายก้อน (ซื้อมา + จ่ายต่อเติม) → แบ่งให้แต่ละก้อนตามสัดส่วนต้นทุน
--   อายุใช้งาน: 0 = ไม่หักค่าเสื่อม · ว่าง = 20 ปีเหมือนเดิม
--   ★ ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) คอลัมน์ + เงื่อนไข -----------------------------------------------------------------------------------------
ALTER TABLE public.property_deeds ADD COLUMN IF NOT EXISTS salvage_value public.d_money;   -- ราคาซาก (บาท)
ALTER TABLE public.property_deeds ADD COLUMN IF NOT EXISTS salvage_pct numeric(5,2);       -- ราคาซาก (% ของต้นทุนแถวนี้)
ALTER TABLE public.property_deeds DROP CONSTRAINT IF EXISTS pdeed_component_ck;
ALTER TABLE public.property_deeds ADD CONSTRAINT pdeed_component_ck CHECK (
  component_type IN ('LAND','BUILDING','OTHER')
  AND (building_area_sqm IS NULL OR building_area_sqm >= 0)
  AND (useful_life_years IS NULL OR useful_life_years BETWEEN 0 AND 100)
  AND (acq_cost IS NULL OR acq_cost >= 0)
  AND (component_type = 'LAND' OR land_area_sq_wa IS NULL));
ALTER TABLE public.property_deeds DROP CONSTRAINT IF EXISTS pdeed_salvage_ck;
ALTER TABLE public.property_deeds ADD CONSTRAINT pdeed_salvage_ck CHECK (
  (salvage_value IS NULL OR salvage_value >= 0)
  AND (salvage_pct IS NULL OR salvage_pct BETWEEN 0 AND 100)
  AND num_nonnulls(salvage_value, salvage_pct) <= 1
  AND (component_type <> 'LAND' OR num_nonnulls(salvage_value, salvage_pct) = 0));

-- ตรวจค่าราคาซากใน JSON ของแถว (ข้อความ error ภาษาไทยแทน error ของ constraint)
CREATE OR REPLACE FUNCTION private.salvage_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT num_nonnulls(nullif(p->>'salvage_value', ''), nullif(p->>'salvage_pct', '')) <= 1
     AND coalesce(nullif(p->>'salvage_value', '') ~ '^[0-9]+(\.[0-9]+)?$', true)
     AND CASE WHEN nullif(p->>'salvage_pct', '') IS NULL THEN true
              WHEN p->>'salvage_pct' ~ '^[0-9]+(\.[0-9]+)?$' THEN (p->>'salvage_pct')::numeric <= 100
              ELSE false END;
$$;
REVOKE ALL ON FUNCTION private.salvage_ok(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.salvage_ok(jsonb) TO authenticated, service_role;

-- 2) บันทึกตารางส่วนประกอบ: + ราคาซาก (p_rows แต่ละแถวมี salvage_value หรือ salvage_pct ได้) ----------------------------------
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
    IF v_type <> 'LAND' AND NOT private.salvage_ok(r.x) THEN
      RAISE EXCEPTION 'INVALID: แถวที่ % ราคาซากต้องเป็นจำนวนเงินไม่ติดลบ หรือ 0–100%%', r.o USING ERRCODE = '22023';
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
        salvage_value = CASE WHEN v_type <> 'LAND' THEN nullif(r.x->>'salvage_value', '')::numeric END,
        salvage_pct = CASE WHEN v_type <> 'LAND' THEN nullif(r.x->>'salvage_pct', '')::numeric END,
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
                                        salvage_value, salvage_pct, acquired_date, acq_cost, notes)
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
              CASE WHEN v_type <> 'LAND' THEN nullif(r.x->>'salvage_value', '')::numeric END,
              CASE WHEN v_type <> 'LAND' THEN nullif(r.x->>'salvage_pct', '')::numeric END,
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

-- 3) จ่ายซื้อ / จ่ายเพิ่ม: สิ่งปลูกสร้างแถวใหม่ใส่ราคาซากได้ · อายุใช้งาน 0 = ไม่หักค่าเสื่อม ------------------------------------
CREATE OR REPLACE FUNCTION public.pay_property(p_asset_id uuid, p_bank_asset_id uuid, p_date date, p_amount numeric, p_fee numeric,
  p_description text, p_add_value boolean, p_component_id uuid, p_new_component jsonb,
  p_card_id uuid DEFAULT NULL, p_cash_person_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_pid uuid; v_ccy text; v_comp uuid; v_type text; v_label text; v_mv uuid; v_meta jsonb := '{}';
BEGIN
  SELECT pd.id INTO v_pid FROM public.property_details pd WHERE pd.asset_id = p_asset_id AND pd.deleted_at IS NULL;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบทรัพย์สิน' USING ERRCODE = '22023'; END IF;
  IF num_nonnulls(p_bank_asset_id, p_card_id, p_cash_person_id) <> 1 THEN
    RAISE EXCEPTION 'INVALID: เลือกจ่ายจากบัญชี บัตรเครดิต หรือเงินสด อย่างใดอย่างหนึ่ง' USING ERRCODE = '22023';
  END IF;
  IF p_bank_asset_id IS NOT NULL THEN
    SELECT a.currency INTO v_ccy FROM public.assets a WHERE a.id = p_bank_asset_id AND a.deleted_at IS NULL;
    IF v_ccy IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัญชีที่จ่าย' USING ERRCODE = '22023'; END IF;
  ELSIF p_card_id IS NOT NULL THEN
    SELECT c.currency INTO v_ccy FROM public.credit_cards c WHERE c.id = p_card_id AND c.deleted_at IS NULL;
    IF v_ccy IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัตรที่จ่าย' USING ERRCODE = '22023'; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = p_cash_person_id AND p.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'NOT_FOUND: ไม่พบผู้จ่าย' USING ERRCODE = '22023';
    END IF;
    SELECT a.currency INTO v_ccy FROM public.assets a WHERE a.id = p_asset_id;
    v_meta := jsonb_build_object('paid_via', 'cash', 'person_id', p_cash_person_id);
  END IF;
  IF p_bank_asset_id IS NULL AND coalesce(p_fee, 0) <> 0 THEN
    RAISE EXCEPTION 'INVALID: ค่าธรรมเนียมใช้กับการจ่ายจากบัญชีเท่านั้น' USING ERRCODE = '22023';
  END IF;
  IF p_component_id IS NULL AND p_new_component IS NULL THEN
    RAISE EXCEPTION 'INVALID: กรุณาเลือกแถวของรายการจ่าย (ที่ดิน / อาคาร / แถวใหม่)' USING ERRCODE = '22023';
  END IF;
  IF p_component_id IS NOT NULL THEN
    SELECT d.id INTO v_comp FROM public.property_deeds d WHERE d.id = p_component_id AND d.property_id = v_pid AND d.deleted_at IS NULL AND d.ended_date IS NULL;
    IF v_comp IS NULL THEN RAISE EXCEPTION 'INVALID: ส่วนประกอบนี้ไม่ใช่ของทรัพย์สินนี้ หรือขาย / รื้อถอนแล้ว' USING ERRCODE = '22023'; END IF;
  ELSIF p_new_component IS NOT NULL THEN
    v_type := coalesce(nullif(p_new_component->>'type', ''), 'LAND');
    IF v_type NOT IN ('LAND','BUILDING','OTHER') THEN RAISE EXCEPTION 'INVALID: ชนิดส่วนประกอบไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
    v_label := nullif(trim(p_new_component->>'label'), '');
    IF v_type = 'LAND' AND num_nonnulls(nullif(trim(p_new_component->>'title_deed_no'), ''), nullif(trim(p_new_component->>'land_no'), ''),
                                       nullif(p_new_component->>'land_area_sq_wa', ''), v_label) = 0 THEN
      RAISE EXCEPTION 'INVALID: ที่ดินที่ซื้อเพิ่ม ใส่เลขที่โฉนด เลขที่ดิน หรือเนื้อที่ อย่างน้อย 1 ช่อง' USING ERRCODE = '22023';
    END IF;
    IF v_type <> 'LAND' AND v_label IS NULL THEN RAISE EXCEPTION 'INVALID: ใส่ชื่ออาคาร / สิ่งปลูกสร้าง' USING ERRCODE = '22023'; END IF;
    IF v_type <> 'LAND' AND NOT private.salvage_ok(p_new_component) THEN
      RAISE EXCEPTION 'INVALID: ราคาซากต้องเป็นจำนวนเงินไม่ติดลบ หรือ 0–100%%' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.property_deeds(property_id, sort_order, component_type, label, title_type, title_deed_no, land_no, land_area_sq_wa,
                                      deed_book, deed_page, map_sheet, survey_page, building_area_sqm, useful_life_years,
                                      salvage_value, salvage_pct, acquired_date)
    VALUES (v_pid, coalesce((SELECT max(d.sort_order) FROM public.property_deeds d WHERE d.property_id = v_pid AND d.deleted_at IS NULL), 0) + 1,
            v_type, v_label,
            CASE WHEN v_type = 'LAND' THEN coalesce(nullif(trim(p_new_component->>'title_type'), ''), 'โฉนด') END,
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'title_deed_no'), '') END,
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'land_no'), '') END,
            CASE WHEN v_type = 'LAND' THEN nullif(p_new_component->>'land_area_sq_wa', '')::numeric END,
            -- เล่ม · หน้า · ระวาง · หน้าสำรวจ (ตกลง 29 ต.ค. 2026)
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'deed_book'), '') END,
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'deed_page'), '') END,
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'map_sheet'), '') END,
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'survey_page'), '') END,
            CASE WHEN v_type <> 'LAND' THEN nullif(p_new_component->>'building_area_sqm', '')::numeric END,
            CASE WHEN v_type <> 'LAND' THEN coalesce(nullif(p_new_component->>'useful_life_years', '')::integer, 20) END,
            CASE WHEN v_type <> 'LAND' THEN nullif(p_new_component->>'salvage_value', '')::numeric END,
            CASE WHEN v_type <> 'LAND' THEN nullif(p_new_component->>'salvage_pct', '')::numeric END,
            p_date)
    RETURNING id INTO v_comp;
  END IF;
  IF p_add_value THEN v_meta := v_meta || '{"add_value": true}'; END IF;
  IF v_comp IS NOT NULL THEN v_meta := v_meta || jsonb_build_object('component_id', v_comp); END IF;
  INSERT INTO public.cash_movements(movement_date, movement_type, from_asset_id, from_credit_card_id, to_asset_id, amount, fee, currency, description, metadata)
  VALUES (p_date, 'ASSET_PURCHASE', p_bank_asset_id, p_card_id, p_asset_id, p_amount, CASE WHEN p_bank_asset_id IS NOT NULL THEN p_fee END, v_ccy,
          coalesce(nullif(trim(p_description), ''), 'จ่ายซื้อทรัพย์สิน'), CASE WHEN v_meta = '{}' THEN NULL ELSE v_meta END)
  RETURNING id INTO v_mv;
  IF p_new_component IS NOT NULL AND p_component_id IS NULL THEN
    UPDATE public.property_deeds SET source_movement_id = v_mv WHERE id = v_comp;
  END IF;
  RETURN v_mv;
END $$;
REVOKE ALL ON FUNCTION public.pay_property(uuid, uuid, date, numeric, numeric, text, boolean, uuid, jsonb, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_property(uuid, uuid, date, numeric, numeric, text, boolean, uuid, jsonb, uuid, uuid) TO authenticated;

-- 4) ต้นทุนรายก้อน: ค่าเสื่อมหักราคาซาก · อายุ 0 ปี = ไม่หัก (คอลัมน์เดิมเหมือนเดิม + component_id / salvage ต่อท้าย) -------------
CREATE OR REPLACE VIEW public.v_property_cost_lots WITH (security_invoker = true) AS
WITH base AS (
  SELECT a.id AS asset_id, a.currency, a.acquisition_date, a.acquisition_cost,
         least(coalesce(pd.acq_building_cost, 0), coalesce(a.acquisition_cost, 0)) AS acq_building, pd.acq_building_years,
         pd.opportunity_rate_pct AS own_rate, f.opportunity_rate_pct AS family_rate, pd.id AS property_id,
         -- วิธีคิด: แปลงที่ตั้งอัตราเอง → วิธีของแปลง (ไม่ระบุ = คงที่ เหมือนเดิม) · ไม่ได้ตั้ง → ของครอบครัว
         CASE WHEN pd.opportunity_rate_pct IS NOT NULL THEN coalesce(pd.opportunity_method, 'FIXED')
              ELSE coalesce(f.opportunity_method, 'FIXED') END AS method,
         -- มีต้นทุนรายแถว (นับแถวที่จบแล้วด้วย) → ยอดของแถวที่ยังถืออยู่
         CASE WHEN EXISTS (SELECT 1 FROM public.property_deeds d WHERE d.property_id = pd.id AND d.deleted_at IS NULL AND d.acq_cost IS NOT NULL)
              THEN coalesce((SELECT sum(d.acq_cost) FROM public.property_deeds d
                              WHERE d.property_id = pd.id AND d.deleted_at IS NULL AND d.ended_date IS NULL), 0) END AS comp_cost,
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
         false AS is_building, NULL::integer AS depreciation_years, NULL::text AS notes, NULL::uuid AS component_id
    FROM base b WHERE b.comp_cost IS NULL AND b.acquisition_cost > b.acq_building AND b.acquisition_date IS NOT NULL
  UNION ALL
  SELECT b.asset_id, 'ACQUISITION', NULL, NULL, b.acquisition_date, b.acq_building::public.d_money, 'ราคาที่ได้มา (อาคาร)',
         true, b.acq_building_years, NULL, NULL
    FROM base b WHERE b.comp_cost IS NULL AND b.acq_building > 0 AND b.acquisition_date IS NOT NULL
  UNION ALL
  -- ต้นทุนรายแถวของส่วนประกอบที่ยังถืออยู่
  SELECT b.asset_id, 'ACQUISITION', NULL, NULL, coalesce(d.acquired_date, b.acquisition_date), d.acq_cost,
         'ราคาที่ได้มา · ' || coalesce(d.label, nullif(concat_ws(' ', d.title_type, 'เลขที่ ' || d.title_deed_no), ''),
                                      CASE d.component_type WHEN 'LAND' THEN 'ที่ดิน' WHEN 'BUILDING' THEN 'อาคาร' ELSE 'อื่น ๆ' END),
         d.component_type <> 'LAND', CASE WHEN d.component_type <> 'LAND' THEN coalesce(d.useful_life_years, 20) END, NULL, d.id
    FROM base b JOIN public.property_deeds d ON d.property_id = b.property_id AND d.deleted_at IS NULL AND d.ended_date IS NULL
   WHERE b.comp_cost IS NOT NULL AND d.acq_cost > 0 AND coalesce(d.acquired_date, b.acquisition_date) IS NOT NULL
  UNION ALL
  SELECT b.asset_id, 'ACQUISITION', NULL, NULL, b.acquisition_date, (b.acquisition_cost - b.comp_cost)::public.d_money,
         'ราคาที่ได้มา (ส่วนที่ยังไม่แยก)', false, NULL, NULL, NULL
    FROM base b WHERE b.comp_cost IS NOT NULL AND b.acquisition_cost - b.comp_cost > 0.005 AND b.acquisition_date IS NOT NULL
  UNION ALL
  -- รายการจ่าย: ผูกกับอาคาร / สิ่งปลูกสร้าง → หักค่าเสื่อมตามอายุของแถวนั้น · แถวที่จบแล้ว → ไม่นับ
  SELECT b.asset_id, 'PAYMENT', NULL, m.id, m.movement_date, m.amount,
         coalesce(m.description, 'จ่ายเพิ่ม') || coalesce(' · ' || coalesce(d.label, nullif(concat_ws(' ', d.title_type, 'เลขที่ ' || d.title_deed_no), '')), ''),
         coalesce(d.component_type <> 'LAND', false), CASE WHEN d.component_type <> 'LAND' THEN coalesce(d.useful_life_years, 20) END, NULL, d.id
    FROM base b
    JOIN public.cash_movements m ON m.to_asset_id = b.asset_id AND m.movement_type = 'ASSET_PURCHASE' AND m.deleted_at IS NULL
                                AND m.currency = b.currency
    LEFT JOIN public.property_deeds d ON d.id::text = m.metadata->>'component_id' AND d.property_id = b.property_id AND d.deleted_at IS NULL
   WHERE m.id IS DISTINCT FROM b.acq_movement_id
     AND coalesce((m.metadata->>'acquisition')::boolean, false) = false   -- เงินออกตอนเพิ่มทรัพย์สิน (เช่น เงินดาวน์) อยู่ในราคาที่ได้มาแล้ว
     AND d.ended_date IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.property_cost_items i WHERE i.movement_id = m.id AND i.deleted_at IS NULL)
  UNION ALL
  SELECT i.asset_id, CASE WHEN i.movement_id IS NULL THEN 'MANUAL' ELSE 'PAYMENT' END, i.id, i.movement_id,
         i.cost_date, i.amount, i.description, i.is_building, i.depreciation_years, i.notes, NULL
    FROM public.property_cost_items i
    JOIN base b ON b.asset_id = i.asset_id
   WHERE i.deleted_at IS NULL
     AND (i.movement_id IS NULL OR EXISTS (SELECT 1 FROM public.cash_movements m WHERE m.id = i.movement_id AND m.deleted_at IS NULL))
), cpi_last AS (
  -- ปีล่าสุดที่มีดัชนีทั้งปี (ไม่ใช้ข้อมูลบางเดือน)
  SELECT c.year, c.cpi_index FROM public.cpi_annual c WHERE c.deleted_at IS NULL ORDER BY c.year DESC LIMIT 1
), x AS (
  SELECT l.*, b.method, coalesce(b.own_rate, b.family_rate, 0) AS rate_pct,
         greatest((now() AT TIME ZONE 'Asia/Bangkok')::date - l.lot_date, 0) / 365.0 AS yrs,
         -- เงินเฟ้อ + ส่วนเพิ่ม: ดัชนีปีล่าสุด ÷ ดัชนีปีที่จ่าย · จ่ายหลังปีล่าสุด (หรือไม่มีดัชนีปีนั้น) → 1
         CASE WHEN b.method = 'CPI_PLUS' THEN
              CASE WHEN cl.year IS NULL OR extract(year FROM l.lot_date)::int >= cl.year THEN 1::numeric
                   ELSE coalesce(cl.cpi_index / nullif(c0.cpi_index, 0), 1) END END AS cpi_factor,
         cl.year AS cpi_to_year,
         -- ราคาซาก (เฉพาะสิ่งปลูกสร้าง): % → % ของแต่ละก้อน · จำนวนเงิน → แบ่งให้แต่ละก้อนตามสัดส่วนต้นทุนของแถวนั้น (ไม่เกินต้นทุน)
         CASE WHEN NOT l.is_building THEN 0
              WHEN dc.salvage_pct IS NOT NULL THEN round(l.amount * least(dc.salvage_pct, 100) / 100.0, 2)
              WHEN dc.salvage_value IS NOT NULL
              THEN round(l.amount * least(dc.salvage_value / nullif(sum(l.amount) OVER (PARTITION BY l.component_id), 0), 1), 2)
              ELSE 0 END AS salvage
    FROM lots l
    JOIN base b ON b.asset_id = l.asset_id
    LEFT JOIN cpi_last cl ON true
    LEFT JOIN public.cpi_annual c0 ON c0.year = extract(year FROM l.lot_date)::int AND c0.deleted_at IS NULL
    LEFT JOIN public.property_deeds dc ON dc.id = l.component_id
)
SELECT x.asset_id, x.source, x.item_id, x.movement_id, x.lot_date, x.amount, x.description, x.is_building, x.depreciation_years, x.notes,
       x.rate_pct, round(x.yrs, 4) AS years_held,
       round(x.amount * (coalesce(x.cpi_factor, 1) * power(1 + x.rate_pct / 100.0, x.yrs) - 1), 2) AS interest,
       -- ค่าเสื่อม = (ต้นทุน − ราคาซาก) × ปีที่ถือ ÷ อายุใช้งาน (ไม่เกินครบอายุ) · อายุ 0 ปี = ไม่หักค่าเสื่อม
       CASE WHEN x.is_building AND x.depreciation_years > 0
            THEN round((x.amount - x.salvage) * least(x.yrs / x.depreciation_years, 1), 2) ELSE 0 END AS depreciation,
       x.method, round(x.cpi_factor, 6) AS cpi_factor, x.cpi_to_year, x.component_id, x.salvage
  FROM x;
REVOKE ALL ON public.v_property_cost_lots FROM PUBLIC, anon;
GRANT SELECT ON public.v_property_cost_lots TO authenticated;
