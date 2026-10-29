-- ฟอร์มเพิ่ม / แก้ไข / จ่าย Property รอบ 4 (ตกลง 29 ต.ค. 2026 · ข้อ 11 + 12.1 ใน proposals/property-market-price.md)
--   1) จ่ายซื้อ / จ่ายเพิ่ม ต้องระบุแถว (เลิก "ไม่ระบุแถว" · อาคาร / ไม่ใช่ ตามชนิดของแถว) · แถวที่ขาย / รื้อถอนแล้วรับรายการจ่ายไม่ได้
--   2) แถวส่วนประกอบ (property_deeds):
--      · ผูกกับรายการเงิน (สร้างจากรายการจ่าย / มีรายการจ่ายผูกอยู่) → ลบไม่ได้ · แก้ต้นทุนในแถวไม่ได้ (แก้ข้อความได้)
--      · ขาย / รื้อถอนแล้ว → อ่านอย่างเดียว (ยกเลิกรายการขาย / รื้อถอนก่อน)
--      · ต้องเหลืออย่างน้อย 1 แถวที่ยังถืออยู่ (ยกเว้นลบแถวที่ระบบสร้างจากรายการจ่ายที่ถูกลบ)
--   ไม่แก้ข้อมูลเดิม · รันซ้ำได้

-- 1) จ่ายซื้อ / จ่ายเพิ่ม ต้องเลือกแถว ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_property(p_asset_id uuid, p_bank_asset_id uuid, p_date date, p_amount numeric, p_fee numeric,
  p_description text, p_add_value boolean, p_component_id uuid, p_new_component jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_pid uuid; v_ccy text; v_comp uuid; v_type text; v_label text; v_mv uuid; v_meta jsonb := '{}';
BEGIN
  SELECT pd.id INTO v_pid FROM public.property_details pd WHERE pd.asset_id = p_asset_id AND pd.deleted_at IS NULL;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบทรัพย์สิน' USING ERRCODE = '22023'; END IF;
  SELECT a.currency INTO v_ccy FROM public.assets a WHERE a.id = p_bank_asset_id AND a.deleted_at IS NULL;
  IF v_ccy IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัญชีที่จ่าย' USING ERRCODE = '22023'; END IF;
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

-- 2) แถวที่ผูกกับรายการเงิน -----------------------------------------------------------------------------------------
--   สร้างจากรายการจ่ายที่ยังอยู่ หรือมีรายการจ่าย (ASSET_PURCHASE) ที่ยังอยู่ผูกด้วย metadata.component_id
CREATE OR REPLACE FUNCTION private.component_linked(p_id uuid, p_source uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.cash_movements m WHERE m.id = p_source AND m.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.cash_movements m WHERE m.movement_type = 'ASSET_PURCHASE' AND m.deleted_at IS NULL
                  AND m.metadata->>'component_id' = p_id::text);
$$;
REVOKE ALL ON FUNCTION private.component_linked(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.component_linked(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.tg_component_lock_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- แถวที่ขาย / รื้อถอนแล้ว: แก้ข้อมูลไม่ได้ (การยกเลิกรายการขาย / รื้อถอนเปลี่ยนเฉพาะช่องสถานะ ผ่านได้)
  IF OLD.ended_date IS NOT NULL AND NEW.ended_date IS NOT NULL AND OLD.deleted_at IS NULL
     AND (NEW.component_type, NEW.label, NEW.title_type, NEW.title_deed_no, NEW.land_no, NEW.deed_book, NEW.deed_page, NEW.map_sheet,
          NEW.survey_page, NEW.land_area_sq_wa, NEW.building_area_sqm, NEW.useful_life_years, NEW.acquired_date, NEW.acq_cost, NEW.notes)
         IS DISTINCT FROM
         (OLD.component_type, OLD.label, OLD.title_type, OLD.title_deed_no, OLD.land_no, OLD.deed_book, OLD.deed_page, OLD.map_sheet,
          OLD.survey_page, OLD.land_area_sq_wa, OLD.building_area_sqm, OLD.useful_life_years, OLD.acquired_date, OLD.acq_cost, OLD.notes) THEN
    RAISE EXCEPTION 'INVALID: แถวนี้ขาย / รื้อถอนแล้ว แก้ไขไม่ได้ (ยกเลิกรายการขาย / รื้อถอนก่อน)' USING ERRCODE = '22023';
  END IF;
  -- ระบบลบ / ปรับแถวตามรายการจ่าย (trigger ของ cash_movements · ลึก > 1) ผ่านได้
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF private.component_linked(OLD.id, OLD.source_movement_id) THEN
      RAISE EXCEPTION 'INVALID: แถวนี้ผูกกับรายการจ่ายเงิน ลบไม่ได้ (ลบ / ย้ายรายการจ่ายก่อน)' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.deleted_at IS NULL AND NEW.acq_cost IS DISTINCT FROM OLD.acq_cost
        AND private.component_linked(OLD.id, OLD.source_movement_id) THEN
    RAISE EXCEPTION 'INVALID: แถวนี้ผูกกับรายการจ่ายเงิน แก้ต้นทุนในแถวไม่ได้ (แก้ยอดที่รายการจ่าย)' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_component_lock_guard() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t21_lock_guard ON public.property_deeds;
CREATE TRIGGER t21_lock_guard BEFORE UPDATE ON public.property_deeds
  FOR EACH ROW EXECUTE FUNCTION private.tg_component_lock_guard();

-- ต้องเหลืออย่างน้อย 1 แถวที่ยังถืออยู่ · ตรวจตอนจบรายการ (แยกโฉนด = ลบแถวเดิม + เพิ่มแถวใหม่ในการบันทึกครั้งเดียวได้)
--   แถวที่ระบบสร้างจากรายการจ่ายที่ถูกลบ ลบตามได้เสมอ · ทรัพย์สินที่ถูกลบไม่ต้องตรวจ
CREATE OR REPLACE FUNCTION private.tg_component_keep_one() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND OLD.ended_date IS NULL AND OLD.source_movement_id IS NULL
     AND EXISTS (SELECT 1 FROM public.property_details pd JOIN public.assets a ON a.id = pd.asset_id
                  WHERE pd.id = OLD.property_id AND pd.deleted_at IS NULL AND a.deleted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.property_deeds d WHERE d.property_id = OLD.property_id
                      AND d.deleted_at IS NULL AND d.ended_date IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ต้องเหลือส่วนประกอบอย่างน้อย 1 แถว' USING ERRCODE = '22023';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.tg_component_keep_one() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS z20_keep_one ON public.property_deeds;
CREATE CONSTRAINT TRIGGER z20_keep_one AFTER UPDATE ON public.property_deeds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.tg_component_keep_one();
