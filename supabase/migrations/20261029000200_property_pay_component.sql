-- =====================================================================
-- Property ส่วนประกอบ รอบ 2 (ตกลง 29 ต.ค. 2026)
--   1) จ่ายซื้อ / จ่ายเพิ่ม เลือกได้ว่าเป็นของส่วนประกอบไหน (metadata.component_id) หรือสร้างแถวใหม่ในคราวเดียว
--      (ซื้อที่ดินเพิ่ม = แถวที่ดินใหม่ · สร้าง / ต่อเติม = แถวอาคาร / สิ่งปลูกสร้าง) → pay_property(...)
--      แก้รายการจ่ายเปลี่ยนแถว → มูลค่ารายแถวที่ระบบเพิ่มให้ย้ายตาม · ลบรายการจ่าย → แถวที่สร้างจากรายการนี้ถูกลบด้วย (ถ้าไม่มีมูลค่าใช้อยู่)
--      ต้นทุนรายก้อนของรายการจ่ายที่ผูกกับอาคาร / สิ่งปลูกสร้าง → หักค่าเสื่อมตามอายุของแถวนั้น
--   2) แท็บอัปเดตมูลค่า: batch_property_values(...) บันทึกหลายทรัพย์สินในคราวเดียว
--      ใส่รายแถว → ตามนั้น · ใส่ยอดรวม + ครั้งก่อนมีรายแถว → แบ่งตามสัดส่วนครั้งก่อน · ไม่มี → ยอดรวมอย่างเดียว
--   ★ ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) จ่ายเพิ่มที่เพิ่มมูลค่า + ผูกกับส่วนประกอบ -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_property_pay_value() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_prev record; v_ccy text; v_id uuid; v_on boolean; v_was boolean; v_comp uuid; v_pid uuid; v_label text;
BEGIN
  IF NEW.movement_type <> 'ASSET_PURCHASE' THEN RETURN NULL; END IF;
  SELECT a.currency, pd.id INTO v_ccy, v_pid FROM public.assets a
    JOIN public.property_details pd ON pd.asset_id = a.id AND pd.deleted_at IS NULL
   WHERE a.id = NEW.to_asset_id;
  IF v_pid IS NULL THEN RETURN NULL; END IF;
  v_on := coalesce(NEW.metadata->>'add_value', '') = 'true' AND v_ccy = NEW.currency;
  v_was := TG_OP = 'UPDATE' AND coalesce(OLD.metadata->>'add_value', '') = 'true';

  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND (NEW.deleted_at IS NOT NULL OR (v_was AND NOT v_on)) THEN
    -- ลบรายการจ่าย / เอาติ๊กเพิ่มมูลค่าออก → ลบมูลค่าที่ระบบเพิ่มให้
    UPDATE public.asset_valuations SET deleted_at = now() WHERE source_movement_id = NEW.id AND deleted_at IS NULL;
  ELSIF NEW.deleted_at IS NULL AND v_on
        AND NOT EXISTS (SELECT 1 FROM public.asset_valuations WHERE source_movement_id = NEW.id AND deleted_at IS NULL) THEN
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
       WHERE d.id::text = NEW.metadata->>'component_id' AND d.property_id = v_pid AND d.deleted_at IS NULL;
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
  ELSIF TG_OP = 'UPDATE' AND NEW.deleted_at IS NULL AND v_on THEN
    IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.movement_date IS DISTINCT FROM OLD.movement_date THEN
      -- แก้ยอด / วันที่ → มูลค่า (และแถวจ่ายเพิ่มในรายละเอียด) ปรับตามส่วนต่าง
      UPDATE public.asset_valuation_parts p SET value = p.value + (NEW.amount - OLD.amount)
       WHERE p.source_movement_id = NEW.id AND p.deleted_at IS NULL
         AND p.valuation_id IN (SELECT v.id FROM public.asset_valuations v WHERE v.source_movement_id = NEW.id AND v.deleted_at IS NULL);
      UPDATE public.asset_valuations SET value = value + (NEW.amount - OLD.amount), valuation_date = NEW.movement_date
       WHERE source_movement_id = NEW.id AND deleted_at IS NULL;
    END IF;
    IF (NEW.metadata->>'component_id') IS DISTINCT FROM (OLD.metadata->>'component_id') THEN
      -- เปลี่ยนแถวของรายการจ่าย → มูลค่ารายแถวที่ระบบเพิ่มให้ย้ายไปแถวใหม่
      SELECT d.id INTO v_comp FROM public.property_deeds d
       WHERE d.id::text = NEW.metadata->>'component_id' AND d.property_id = v_pid AND d.deleted_at IS NULL;
      IF v_comp IS NOT NULL THEN
        UPDATE public.asset_valuation_parts p SET deed_id = v_comp
         WHERE p.source_movement_id = NEW.id AND p.deleted_at IS NULL AND p.deed_id IS DISTINCT FROM v_comp
           AND p.valuation_id IN (SELECT v.id FROM public.asset_valuations v WHERE v.source_movement_id = NEW.id AND v.deleted_at IS NULL);
      END IF;
    END IF;
  END IF;

  -- แถวที่ระบบ / ฟอร์มจ่ายสร้างจากรายการนี้ ที่ไม่มีมูลค่าใช้อยู่แล้ว → ลบ (รายการจ่ายถูกลบ / ย้ายไปแถวอื่น / เอาติ๊กออก)
  IF TG_OP = 'UPDATE' AND (NEW.deleted_at IS NOT NULL
       OR (NEW.metadata->>'component_id') IS DISTINCT FROM (OLD.metadata->>'component_id') OR (v_was AND NOT v_on)) THEN
    UPDATE public.property_deeds d SET deleted_at = now()
     WHERE d.source_movement_id = NEW.id AND d.deleted_at IS NULL
       AND (NEW.deleted_at IS NOT NULL OR d.id::text IS DISTINCT FROM NEW.metadata->>'component_id')
       AND NOT EXISTS (SELECT 1 FROM public.asset_valuation_parts p WHERE p.deed_id = d.id AND p.deleted_at IS NULL);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.tg_property_pay_value() FROM PUBLIC, anon;

-- 2) จ่ายซื้อ / จ่ายเพิ่มของ Property (+ แถวส่วนประกอบใหม่) ในคราวเดียว → id ของรายการจ่าย -----------------------
--   p_new_component = {type, label, title_type, title_deed_no, land_no, land_area_sq_wa, building_area_sqm, useful_life_years} หรือ NULL
CREATE OR REPLACE FUNCTION public.pay_property(p_asset_id uuid, p_bank_asset_id uuid, p_date date, p_amount numeric, p_fee numeric,
  p_description text, p_add_value boolean, p_component_id uuid, p_new_component jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_pid uuid; v_ccy text; v_comp uuid; v_type text; v_label text; v_mv uuid; v_meta jsonb := '{}';
BEGIN
  SELECT pd.id INTO v_pid FROM public.property_details pd WHERE pd.asset_id = p_asset_id AND pd.deleted_at IS NULL;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบทรัพย์สิน' USING ERRCODE = '22023'; END IF;
  SELECT a.currency INTO v_ccy FROM public.assets a WHERE a.id = p_bank_asset_id AND a.deleted_at IS NULL;
  IF v_ccy IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัญชีที่จ่าย' USING ERRCODE = '22023'; END IF;
  IF p_component_id IS NOT NULL THEN
    SELECT d.id INTO v_comp FROM public.property_deeds d WHERE d.id = p_component_id AND d.property_id = v_pid AND d.deleted_at IS NULL;
    IF v_comp IS NULL THEN RAISE EXCEPTION 'INVALID: ส่วนประกอบนี้ไม่ใช่ของทรัพย์สินนี้' USING ERRCODE = '22023'; END IF;
  ELSIF p_new_component IS NOT NULL THEN
    v_type := coalesce(nullif(p_new_component->>'type', ''), 'LAND');
    IF v_type NOT IN ('LAND','BUILDING','OTHER') THEN RAISE EXCEPTION 'INVALID: ชนิดส่วนประกอบไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
    v_label := nullif(trim(p_new_component->>'label'), '');
    IF v_type = 'LAND' AND num_nonnulls(nullif(trim(p_new_component->>'title_deed_no'), ''), nullif(trim(p_new_component->>'land_no'), ''),
                                       nullif(p_new_component->>'land_area_sq_wa', ''), v_label) = 0 THEN
      RAISE EXCEPTION 'INVALID: ที่ดินที่ซื้อเพิ่ม ใส่เลขที่โฉนด เลขที่ดิน หรือเนื้อที่ อย่างน้อย 1 ช่อง' USING ERRCODE = '22023';
    END IF;
    IF v_type <> 'LAND' AND v_label IS NULL THEN RAISE EXCEPTION 'INVALID: ใส่ชื่ออาคาร / สิ่งปลูกสร้าง' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.property_deeds(property_id, sort_order, component_type, label, title_type, title_deed_no, land_no, land_area_sq_wa,
                                      building_area_sqm, useful_life_years, acquired_date)
    VALUES (v_pid, coalesce((SELECT max(d.sort_order) FROM public.property_deeds d WHERE d.property_id = v_pid AND d.deleted_at IS NULL), 0) + 1,
            v_type, v_label,
            CASE WHEN v_type = 'LAND' THEN coalesce(nullif(trim(p_new_component->>'title_type'), ''), 'โฉนด') END,
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'title_deed_no'), '') END,
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'land_no'), '') END,
            CASE WHEN v_type = 'LAND' THEN nullif(p_new_component->>'land_area_sq_wa', '')::numeric END,
            CASE WHEN v_type <> 'LAND' THEN nullif(p_new_component->>'building_area_sqm', '')::numeric END,
            CASE WHEN v_type <> 'LAND' THEN coalesce(nullif(p_new_component->>'useful_life_years', '')::integer, 20) END,
            p_date)
    RETURNING id INTO v_comp;
  END IF;
  IF p_add_value THEN v_meta := v_meta || '{"add_value": true}'; END IF;
  IF v_comp IS NOT NULL THEN v_meta := v_meta || jsonb_build_object('component_id', v_comp); END IF;
  INSERT INTO public.cash_movements(movement_date, movement_type, from_asset_id, to_asset_id, amount, fee, currency, description, metadata)
  VALUES (p_date, 'ASSET_PURCHASE', p_bank_asset_id, p_asset_id, p_amount, p_fee, v_ccy, coalesce(nullif(trim(p_description), ''), 'จ่ายซื้อทรัพย์สิน'),
          CASE WHEN v_meta = '{}' THEN NULL ELSE v_meta END)
  RETURNING id INTO v_mv;
  IF p_new_component IS NOT NULL AND p_component_id IS NULL THEN
    UPDATE public.property_deeds SET source_movement_id = v_mv WHERE id = v_comp;
  END IF;
  RETURN v_mv;
END $$;
REVOKE ALL ON FUNCTION public.pay_property(uuid, uuid, date, numeric, numeric, text, boolean, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_property(uuid, uuid, date, numeric, numeric, text, boolean, uuid, jsonb) TO authenticated;

-- 3) แท็บอัปเดตมูลค่า: หลายทรัพย์สินในคราวเดียว (ผิดแถวเดียว = ไม่บันทึกเลย) -------------------------------------------
--   p_rows = [{asset_id, value?, parts?: [{deed_id, value}]}]
CREATE OR REPLACE FUNCTION public.batch_property_values(p_date date, p_method text, p_notes text, p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r record; v_asset uuid; v_value numeric; v_parts jsonb; v_prev uuid; v_prev_sum numeric; v_n integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'INVALID: ข้อมูลไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT x FROM jsonb_array_elements(p_rows) x LOOP
    v_asset := (r.x->>'asset_id')::uuid;
    v_parts := '[]';
    IF jsonb_typeof(r.x->'parts') = 'array' AND jsonb_array_length(r.x->'parts') > 0 THEN
      v_parts := (SELECT jsonb_agg(jsonb_build_object('deed_id', p->>'deed_id', 'value', (p->>'value')::numeric)) FROM jsonb_array_elements(r.x->'parts') p);
      v_value := (SELECT sum((p->>'value')::numeric) FROM jsonb_array_elements(r.x->'parts') p);
    ELSE
      v_value := nullif(r.x->>'value', '')::numeric;
      IF v_value IS NULL OR v_value < 0 THEN RAISE EXCEPTION 'INVALID: มูลค่าต้องเป็นตัวเลขไม่ติดลบ' USING ERRCODE = '22023'; END IF;
      -- ครั้งก่อนมีรายแถว → แบ่งตามสัดส่วนครั้งก่อน (ปัด 2 ตำแหน่ง เศษไปแถวสุดท้าย)
      SELECT v.id INTO v_prev FROM public.asset_valuations v
       WHERE v.asset_id = v_asset AND v.deleted_at IS NULL AND v.valuation_date <= p_date
       ORDER BY v.valuation_date DESC, v.created_at DESC LIMIT 1;
      SELECT sum(p.value) INTO v_prev_sum FROM public.asset_valuation_parts p
       WHERE p.valuation_id = v_prev AND p.deleted_at IS NULL AND p.deed_id IS NOT NULL;
      IF coalesce(v_prev_sum, 0) > 0 THEN
        WITH g AS (
          SELECT p.deed_id, sum(p.value) AS v, min(p.sort_order) AS o FROM public.asset_valuation_parts p
           WHERE p.valuation_id = v_prev AND p.deleted_at IS NULL AND p.deed_id IS NOT NULL GROUP BY p.deed_id
        ), s AS (
          SELECT g.deed_id, round(v_value * g.v / v_prev_sum, 2) AS v, row_number() OVER (ORDER BY g.o, g.deed_id) AS rn, count(*) OVER () AS n FROM g
        )
        SELECT jsonb_agg(jsonb_build_object('deed_id', s.deed_id,
                 'value', CASE WHEN s.rn = s.n THEN v_value - coalesce((SELECT sum(s2.v) FROM s s2 WHERE s2.rn < s.n), 0) ELSE s.v END) ORDER BY s.rn)
          INTO v_parts FROM s;
      END IF;
    END IF;
    PERFORM public.add_property_valuation(v_asset, p_date, v_value, p_method, p_notes, v_parts);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_property_values(date, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_property_values(date, text, text, jsonb) TO authenticated;

-- 4) ต้นทุนรายก้อน: รายการจ่ายที่ผูกกับอาคาร / สิ่งปลูกสร้าง → หักค่าเสื่อมตามอายุของแถวนั้น -------------------------
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
  -- รายการจ่าย: ผูกกับอาคาร / สิ่งปลูกสร้าง → หักค่าเสื่อมตามอายุของแถวนั้น
  SELECT b.asset_id, 'PAYMENT', NULL, m.id, m.movement_date, m.amount,
         coalesce(m.description, 'จ่ายเพิ่ม') || coalesce(' · ' || coalesce(d.label, nullif(concat_ws(' ', d.title_type, 'เลขที่ ' || d.title_deed_no), '')), ''),
         coalesce(d.component_type <> 'LAND', false), CASE WHEN d.component_type <> 'LAND' THEN coalesce(d.useful_life_years, 20) END, NULL
    FROM base b
    JOIN public.cash_movements m ON m.to_asset_id = b.asset_id AND m.movement_type = 'ASSET_PURCHASE' AND m.deleted_at IS NULL
                                AND m.currency = b.currency
    LEFT JOIN public.property_deeds d ON d.id::text = m.metadata->>'component_id' AND d.property_id = b.property_id AND d.deleted_at IS NULL
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
