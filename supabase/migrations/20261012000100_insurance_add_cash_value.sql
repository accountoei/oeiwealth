-- =====================================================================
-- เพิ่มมูลค่าเวนคืนให้กรมธรรม์ที่มีอยู่แล้ว (ตอนสร้างกรมธรรม์ไม่ได้ใส่ไว้)
--   add_insurance_cash_value(policy_id, {value, valuation_date, notes, owner_person_id?})
--   - ยอด = มูลค่าเวนคืน + เงินปันผลสะสม รวมเป็นตัวเลขเดียว (รายละเอียดเขียนในหมายเหตุ)
--   - วันที่ก่อน Go-live → ยอดตั้งต้น (OPENING) · ตั้งแต่ Go-live → ตามหนังสือแจ้ง (STATEMENT)
--   - เจ้าของมูลค่าเวนคืน = owner_person_id ถ้าระบุ / ไม่งั้น ผู้จ่ายเบี้ย / ไม่งั้น ผู้เอาประกัน (100%)
--   - ทำได้ครั้งเดียวต่อกรมธรรม์ · หลังจากนั้นอัปเดตมูลค่าที่ส่วน "มูลค่าเวนคืน" ตามปกติ
-- รันซ้ำได้ (DROP FUNCTION IF EXISTS / CREATE)
-- =====================================================================

DROP FUNCTION IF EXISTS public.add_insurance_cash_value(uuid, jsonb);
CREATE FUNCTION public.add_insurance_cash_value(p_policy_id uuid, p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  pol public.insurance_policies; v_go_live date; v_cv uuid; v_owner uuid; v_opening boolean;
  v_value numeric := nullif(p->>'value', '')::numeric;
  v_date  date    := nullif(p->>'valuation_date', '')::date;
  v_notes text    := nullif(trim(coalesce(p->>'notes', '')), '');
  v_ccy   text;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO pol FROM public.insurance_policies WHERE id = p_policy_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023'; END IF;
  IF pol.cash_value_asset_id IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID: กรมธรรม์นี้มีมูลค่าเวนคืนแล้ว — อัปเดตมูลค่าที่ส่วน "มูลค่าเวนคืน"' USING ERRCODE = '22023';
  END IF;
  IF v_value IS NULL OR v_value < 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่มูลค่าเวนคืน' USING ERRCODE = '22023'; END IF;
  IF v_date IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่วันที่ของยอด' USING ERRCODE = '22023'; END IF;

  v_owner := coalesce(nullif(p->>'owner_person_id', '')::uuid, pol.payer_person_id, pol.person_id);
  IF v_owner IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกเจ้าของมูลค่าเวนคืน' USING ERRCODE = '22023'; END IF;

  SELECT go_live_date INTO v_go_live FROM public.families WHERE id = pol.family_id;
  v_opening := v_date < v_go_live;
  v_ccy := coalesce(pol.insured_amount_currency, pol.premium_currency, 'THB');

  INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency, acquisition_date, notes)
  VALUES (pol.family_id, 'FINANCIAL', 'INSURANCE_CASH_VALUE',
          'มูลค่าเวนคืน ' || pol.insurer || coalesce(' ' || nullif(pol.policy_no, ''), ''), v_ccy,
          CASE WHEN NOT v_opening THEN v_date END, v_notes)
  RETURNING id INTO v_cv;
  INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
  VALUES (v_cv, v_owner, 100, v_date);
  INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening, notes)
  VALUES (v_cv, v_date, v_value, 'STATEMENT', CASE WHEN v_opening THEN 'OPENING' ELSE 'STATEMENT' END, v_opening, v_notes);

  UPDATE public.insurance_policies SET has_cash_value = true, cash_value_asset_id = v_cv WHERE id = p_policy_id;
  RETURN v_cv;
END $$;
REVOKE ALL ON FUNCTION public.add_insurance_cash_value(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_insurance_cash_value(uuid, jsonb) TO authenticated;
