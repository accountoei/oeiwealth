-- =====================================================================
-- Property & Leases (Core Schema Section 22)
--   create_lease     : สร้างสัญญาเช่า (+ ยกเงินประกันจากสัญญาเดิม + รับเงินประกันเข้าบัญชี)
--   create_property  : assets + property_details + asset_ownerships + asset_valuations (+ สัญญาแรก)
--   SECURITY INVOKER: RLS / Guard / Period Lock / Go-live Lock ทำงานตามสิทธิ์ผู้เรียก
--   ทั้งหมดอยู่ใน Transaction เดียว ถ้าขั้นใดผิด ไม่มีอะไรถูกบันทึกเลย
-- =====================================================================

-- p_lease: {"unit_label","tenant_name","contract_no","start_date","end_date","rent_amount","rent_currency",
--           "payment_frequency","payment_due_day","security_deposit","deposit_received_date",
--           "carried_from_lease_id","deposit_to_asset_id","notes"}
CREATE OR REPLACE FUNCTION public.create_lease(p_property_asset_id uuid, p_lease jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_prop uuid; v_family uuid; v_go_live date; v_id uuid;
  v_dep numeric; v_ccy text; v_start date; v_recv date;
  o public.property_leases; v_carried numeric; v_extra numeric; v_to uuid;
BEGIN
  SELECT pd.id, a.family_id, upper(coalesce(nullif(p_lease->>'rent_currency', ''), a.currency))
    INTO v_prop, v_family, v_ccy
    FROM public.property_details pd JOIN public.assets a ON a.id = pd.asset_id
   WHERE pd.asset_id = p_property_asset_id AND pd.deleted_at IS NULL AND a.deleted_at IS NULL;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบทรัพย์สินนี้' USING ERRCODE = '22023'; END IF;
  SELECT go_live_date INTO v_go_live FROM public.families WHERE id = v_family;

  IF length(trim(coalesce(p_lease->>'tenant_name', ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อผู้เช่า' USING ERRCODE = '22023';
  END IF;
  IF nullif(p_lease->>'start_date', '') IS NULL OR nullif(p_lease->>'end_date', '') IS NULL
     OR nullif(p_lease->>'rent_amount', '') IS NULL THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่วันเริ่ม วันสิ้นสุด และค่าเช่า' USING ERRCODE = '22023';
  END IF;

  v_start := (p_lease->>'start_date')::date;
  v_dep   := nullif(p_lease->>'security_deposit', '')::numeric;
  v_recv  := nullif(p_lease->>'deposit_received_date', '')::date;

  IF nullif(p_lease->>'carried_from_lease_id', '') IS NOT NULL THEN
    SELECT * INTO o FROM public.property_leases
     WHERE id = (p_lease->>'carried_from_lease_id')::uuid AND deleted_at IS NULL;
    IF NOT FOUND OR coalesce(o.security_deposit, 0) = 0 THEN
      RAISE EXCEPTION 'INVALID: สัญญาเดิมไม่มีเงินประกันให้ยกมา' USING ERRCODE = '22023';
    END IF;
    IF o.deposit_settled_date IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID: เงินประกันของสัญญาเดิมถูกคืน / ยกไปแล้ว' USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_dep, 0) < o.security_deposit THEN
      RAISE EXCEPTION 'INVALID: เงินประกันใหม่ต้องไม่น้อยกว่าเงินประกันเดิม (%) — ถ้าน้อยกว่า ให้คืนเงินประกันเดิมแล้วรับใหม่',
        o.security_deposit USING ERRCODE = '22023';
    END IF;
    v_carried := o.security_deposit;
    v_recv := v_start;
  END IF;

  INSERT INTO public.property_leases(
    property_id, unit_label, tenant_name, contract_no, start_date, end_date,
    rent_amount, rent_currency, payment_frequency, payment_due_day,
    security_deposit, deposit_currency, deposit_received_date,
    deposit_carried_from_lease_id, deposit_carried_amount, notes)
  VALUES (
    v_prop, nullif(trim(p_lease->>'unit_label'), ''), trim(p_lease->>'tenant_name'),
    nullif(trim(p_lease->>'contract_no'), ''), v_start, (p_lease->>'end_date')::date,
    (p_lease->>'rent_amount')::numeric, v_ccy, coalesce(nullif(p_lease->>'payment_frequency', ''), 'MONTHLY'),
    nullif(p_lease->>'payment_due_day', '')::smallint,
    v_dep, CASE WHEN coalesce(v_dep, 0) > 0 THEN coalesce(o.deposit_currency, v_ccy) END, v_recv,
    o.id, v_carried, nullif(trim(p_lease->>'notes'), ''))
  RETURNING id INTO v_id;

  -- รับเงินประกัน (เฉพาะส่วนที่รับเพิ่มจริง) เข้าบัญชี — รับก่อน Go-live อยู่ในยอดตั้งต้นแล้ว ไม่สร้างรายการ
  v_to := nullif(p_lease->>'deposit_to_asset_id', '')::uuid;
  v_extra := coalesce(v_dep, 0) - coalesce(v_carried, 0);
  IF v_to IS NOT NULL AND v_extra > 0 THEN
    IF coalesce(v_recv, v_start) < v_go_live THEN
      RAISE EXCEPTION 'INVALID: เงินประกันที่รับก่อน Go-live (%) อยู่ในยอดบัญชีตั้งต้นแล้ว ไม่ต้องเลือกบัญชีที่รับเงิน', v_go_live
        USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.cash_movements(family_id, movement_date, movement_type, to_asset_id, related_lease_id,
                                      amount, currency, description)
    VALUES (v_family, coalesce(v_recv, v_start), 'SECURITY_DEPOSIT_IN', v_to, v_id,
            v_extra, coalesce(o.deposit_currency, v_ccy), 'รับเงินประกัน · ' || trim(p_lease->>'tenant_name'));
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.create_property(
  p_name              text,
  p_property_type     text,
  p_usage_type        text,
  p_currency          text,
  p_value             numeric,
  p_value_date        date,
  p_is_opening        boolean DEFAULT false,
  p_valuation_method  text    DEFAULT 'USER_ESTIMATE',
  p_acquisition_date  date    DEFAULT NULL,
  p_acquisition_cost  numeric DEFAULT NULL,
  p_location_group    text    DEFAULT NULL,
  p_address           text    DEFAULT NULL,
  p_land_area_sq_wa   numeric DEFAULT NULL,
  p_title_type        text    DEFAULT NULL,
  p_title_deed_no     text    DEFAULT NULL,
  p_land_no           text    DEFAULT NULL,
  p_owners            jsonb   DEFAULT '[]'::jsonb,   -- [{"person_id": "...", "percent": 50}]
  p_lease             jsonb   DEFAULT NULL,          -- สัญญาแรก (เมื่อปล่อยเช่า)
  p_notes             text    DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_family uuid; v_go_live date; v_asset uuid; o jsonb; v_own_start date;
BEGIN
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อทรัพย์สิน' USING ERRCODE = '22023';
  END IF;
  IF p_value IS NULL OR p_value_date IS NULL THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่มูลค่าและวันที่ของมูลค่า' USING ERRCODE = '22023';
  END IF;
  SELECT id, go_live_date INTO v_family, v_go_live FROM public.families WHERE deleted_at IS NULL LIMIT 1;
  IF v_family IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED: ไม่พบข้อมูลครอบครัว' USING ERRCODE = '42501'; END IF;
  IF NOT p_is_opening AND (p_acquisition_date IS NULL OR p_acquisition_date < v_go_live) THEN
    RAISE EXCEPTION 'INVALID: ทรัพย์สินที่ได้มาหลัง Go-live ต้องระบุวันที่ได้มา (ตั้งแต่ %) — ถ้ามีอยู่ก่อน ให้ติ๊ก "มีอยู่ก่อน Go-live"',
      v_go_live USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency,
                            acquisition_date, acquisition_cost, notes)
  VALUES (v_family, 'PROPERTY', p_property_type, trim(p_name), upper(p_currency),
          p_acquisition_date, p_acquisition_cost, p_notes)
  RETURNING id INTO v_asset;

  INSERT INTO public.property_details(asset_id, property_type, usage_type, location_group, address,
                                      land_area_sq_wa, title_type, title_deed_no, land_no)
  VALUES (v_asset, p_property_type, coalesce(p_usage_type, 'OWNER_OCCUPIED'), nullif(trim(p_location_group), ''),
          nullif(trim(p_address), ''), p_land_area_sq_wa, nullif(trim(p_title_type), ''),
          nullif(trim(p_title_deed_no), ''), nullif(trim(p_land_no), ''));

  v_own_start := CASE WHEN p_is_opening THEN least(p_value_date, coalesce(p_acquisition_date, p_value_date))
                      ELSE p_acquisition_date END;
  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p_owners, '[]'::jsonb)) LOOP
    INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
    VALUES (v_asset, (o->>'person_id')::uuid, (o->>'percent')::numeric, v_own_start);
  END LOOP;

  INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening, notes)
  VALUES (v_asset, p_value_date, p_value, coalesce(p_valuation_method, 'USER_ESTIMATE'),
          CASE WHEN p_is_opening THEN 'OPENING'
               WHEN p_valuation_method = 'APPRAISAL' THEN 'APPRAISAL' ELSE 'USER' END,
          p_is_opening, p_notes);

  IF p_lease IS NOT NULL AND length(trim(coalesce(p_lease->>'tenant_name', ''))) > 0 THEN
    PERFORM public.create_lease(v_asset, p_lease);
  END IF;
  RETURN v_asset;
END $$;

REVOKE ALL ON FUNCTION public.create_lease(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_lease(uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.create_property(text,text,text,text,numeric,date,boolean,text,date,numeric,text,text,numeric,text,text,text,jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_property(text,text,text,text,numeric,date,boolean,text,date,numeric,text,text,numeric,text,text,text,jsonb,jsonb,text) TO authenticated;
