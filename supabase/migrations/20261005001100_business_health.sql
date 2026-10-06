-- =====================================================================
-- Private Business (Section 20) · Health (Section 27)
-- SECURITY INVOKER: RLS / Guard / Period Lock ทำงานตามสิทธิ์ผู้เรียก
-- =====================================================================

-- ธุรกิจ / หุ้นนอกตลาด → Asset FINANCIAL / PRIVATE_BUSINESS + มูลค่า (asset_valuations)
CREATE OR REPLACE FUNCTION public.create_private_business(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_family uuid; v_go_live date; v_asset uuid; o jsonb; v_start date;
  v_opening boolean := coalesce((p->>'is_opening')::boolean, false);
  v_date date := nullif(p->>'value_date', '')::date; v_value numeric := nullif(p->>'value', '')::numeric;
  v_acq date := nullif(p->>'acquisition_date', '')::date;
BEGIN
  IF length(trim(coalesce(p->>'company_name', ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อบริษัท' USING ERRCODE = '22023'; END IF;
  IF v_value IS NULL OR v_date IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่มูลค่าและวันที่' USING ERRCODE = '22023'; END IF;
  SELECT id, go_live_date INTO v_family, v_go_live FROM public.families WHERE deleted_at IS NULL LIMIT 1;
  IF NOT v_opening AND (v_acq IS NULL OR v_acq < v_go_live) THEN
    RAISE EXCEPTION 'INVALID: ที่ได้มาหลัง Go-live ต้องระบุวันที่ได้มา (ตั้งแต่ %) — ถ้ามีอยู่ก่อน ให้ติ๊ก "มีอยู่ก่อน Go-live"', v_go_live
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency, acquisition_date, acquisition_cost, notes)
  VALUES (v_family, 'FINANCIAL', 'PRIVATE_BUSINESS', coalesce(nullif(trim(p->>'name'), ''), trim(p->>'company_name')),
          upper(coalesce(nullif(p->>'currency', ''), 'THB')), v_acq, nullif(p->>'investment_cost', '')::numeric, nullif(trim(p->>'notes'), ''))
  RETURNING id INTO v_asset;
  INSERT INTO public.private_business_details(asset_id, company_name, registration_no, business_type, total_shares,
              shares_owned, company_ownership_percent, investment_cost, notes)
  VALUES (v_asset, trim(p->>'company_name'), nullif(trim(p->>'registration_no'), ''), nullif(trim(p->>'business_type'), ''),
          nullif(p->>'total_shares', '')::numeric, nullif(p->>'shares_owned', '')::numeric,
          nullif(p->>'company_ownership_percent', '')::numeric, nullif(p->>'investment_cost', '')::numeric, nullif(trim(p->>'notes'), ''));
  v_start := CASE WHEN v_opening THEN least(v_date, coalesce(v_acq, v_date)) ELSE v_acq END;
  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p->'owners', '[]'::jsonb)) LOOP
    INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
    VALUES (v_asset, (o->>'person_id')::uuid, (o->>'percent')::numeric, v_start);
  END LOOP;
  INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening, notes)
  VALUES (v_asset, v_date, v_value, coalesce(nullif(p->>'valuation_method', ''), 'BOOK_VALUE'),
          CASE WHEN v_opening THEN 'OPENING' WHEN p->>'valuation_method' = 'APPRAISAL' THEN 'APPRAISAL' ELSE 'USER' END,
          v_opening, nullif(trim(p->>'notes'), ''));
  RETURN v_asset;
END $$;

-- ตรวจสุขภาพ 1 ครั้ง + ผลตรวจหลายรายการ ใน Transaction เดียว
-- p: {"person_id","checkup_date","hospital","package_name","cost","currency","notes",
--     "results":[{"metric","value_numeric","value_text","unit","reference_min","reference_max","reference_text","abnormal_flag","notes"}]}
CREATE OR REPLACE FUNCTION public.add_health_checkup(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id uuid; r jsonb; v_metric text;
BEGIN
  IF nullif(p->>'person_id', '') IS NULL OR nullif(p->>'checkup_date', '') IS NULL THEN
    RAISE EXCEPTION 'INVALID: กรุณาเลือกสมาชิกและวันที่ตรวจ' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.health_checkups(person_id, checkup_date, hospital, package_name, cost, currency, notes)
  VALUES ((p->>'person_id')::uuid, (p->>'checkup_date')::date, nullif(trim(p->>'hospital'), ''), nullif(trim(p->>'package_name'), ''),
          nullif(p->>'cost', '')::numeric, coalesce(nullif(p->>'currency', ''), 'THB'), nullif(trim(p->>'notes'), ''))
  RETURNING id INTO v_id;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p->'results', '[]'::jsonb)) LOOP
    v_metric := upper(regexp_replace(trim(coalesce(r->>'metric', '')), '[^A-Za-z0-9]+', '_', 'g'));
    CONTINUE WHEN v_metric = '' OR (nullif(r->>'value_numeric', '') IS NULL AND nullif(trim(r->>'value_text'), '') IS NULL);
    INSERT INTO public.health_results(checkup_id, metric, value_numeric, value_text, unit, reference_min, reference_max,
                reference_text, abnormal_flag, notes)
    VALUES (v_id, v_metric, nullif(r->>'value_numeric', '')::numeric, nullif(trim(r->>'value_text'), ''), nullif(trim(r->>'unit'), ''),
            nullif(r->>'reference_min', '')::numeric, nullif(r->>'reference_max', '')::numeric, nullif(trim(r->>'reference_text'), ''),
            nullif(r->>'abnormal_flag', ''), nullif(trim(r->>'notes'), ''));
  END LOOP;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.create_private_business(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_private_business(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.add_health_checkup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_health_checkup(jsonb) TO authenticated;
