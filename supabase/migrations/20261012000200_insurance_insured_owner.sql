-- =====================================================================
-- เจ้าของมูลค่าเวนคืน = ผู้เอาประกัน (ค่าเริ่มต้น) · แก้ผู้เอาประกันได้ → มูลค่าเวนคืนย้ายตาม
--   1) create_insurance_policy: ไม่ส่ง owners มา → ผู้เอาประกัน 100%
--   2) add_insurance_cash_value: ไม่ระบุเจ้าของ → ผู้เอาประกัน (เดิม: ผู้จ่ายเบี้ย)
--   3) แก้ผู้เอาประกัน (insurance_policies.person_id): ถ้าเจ้าของมูลค่าเวนคืนปัจจุบัน = ผู้เอาประกันเดิม 100%
--      → ย้ายเป็นผู้เอาประกันใหม่ (แบบ "แก้ข้อมูลที่กรอกผิด" ย้อนถึงวันเริ่ม) · ถ้าตั้งเจ้าของแบบพิเศษไว้ → ไม่แตะ
-- รันซ้ำได้ (CREATE OR REPLACE / DROP TRIGGER IF EXISTS) · signature เดิม
-- =====================================================================

-- ---------------------------------------------------------------- 1) สร้างกรมธรรม์
CREATE OR REPLACE FUNCTION public.create_insurance_policy(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_family uuid; v_go_live date; v_id uuid; v_cv uuid; o jsonb; v_start date;
  v_has_cv boolean := coalesce((p->>'has_cash_value')::boolean, false);
  v_opening boolean := coalesce((p->>'is_opening')::boolean, false);
  v_cv_value numeric := nullif(p->>'cash_value', '')::numeric; v_cv_date date := nullif(p->>'cash_value_date', '')::date;
  v_ccy text := upper(coalesce(nullif(p->>'currency', ''), 'THB'));
BEGIN
  IF length(trim(coalesce(p->>'insurer', ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่บริษัทประกัน' USING ERRCODE = '22023'; END IF;
  SELECT id, go_live_date INTO v_family, v_go_live FROM public.families WHERE deleted_at IS NULL LIMIT 1;

  IF v_has_cv THEN
    IF v_cv_value IS NULL OR v_cv_date IS NULL THEN
      RAISE EXCEPTION 'INVALID: กรมธรรม์ที่มีมูลค่าเวนคืนต้องใส่มูลค่าเวนคืนและวันที่' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency, acquisition_date, notes)
    VALUES (v_family, 'FINANCIAL', 'INSURANCE_CASH_VALUE',
            'มูลค่าเวนคืน ' || trim(p->>'insurer') || coalesce(' ' || nullif(trim(p->>'policy_no'), ''), ''), v_ccy,
            CASE WHEN NOT v_opening THEN coalesce(nullif(p->>'start_date', '')::date, v_cv_date) END, nullif(trim(p->>'notes'), ''))
    RETURNING id INTO v_cv;
    v_start := CASE WHEN v_opening THEN v_cv_date ELSE coalesce(nullif(p->>'start_date', '')::date, v_cv_date) END;
    -- เจ้าของมูลค่าเวนคืน: ไม่ระบุ = ผู้เอาประกัน 100%
    FOR o IN SELECT * FROM jsonb_array_elements(CASE
               WHEN jsonb_array_length(coalesce(p->'owners', '[]'::jsonb)) > 0 THEN p->'owners'
               WHEN nullif(p->>'person_id', '') IS NOT NULL
                 THEN jsonb_build_array(jsonb_build_object('person_id', p->>'person_id', 'percent', 100))
               ELSE '[]'::jsonb END) LOOP
      INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
      VALUES (v_cv, (o->>'person_id')::uuid, (o->>'percent')::numeric, least(v_start, v_cv_date));
    END LOOP;
    INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening, notes)
    VALUES (v_cv, v_cv_date, v_cv_value, 'STATEMENT', CASE WHEN v_opening THEN 'OPENING' ELSE 'STATEMENT' END, v_opening,
            nullif(trim(p->>'notes'), ''));
  END IF;

  INSERT INTO public.insurance_policies(family_id, insurance_type, person_id, asset_id, insurer, policy_no, start_date, end_date,
              insured_amount, insured_amount_currency, premium, premium_currency, has_cash_value, cash_value_asset_id, notes)
  VALUES (v_family, p->>'insurance_type', nullif(p->>'person_id', '')::uuid, nullif(p->>'insured_asset_id', '')::uuid,
          trim(p->>'insurer'), nullif(trim(p->>'policy_no'), ''), nullif(p->>'start_date', '')::date, nullif(p->>'end_date', '')::date,
          nullif(p->>'insured_amount', '')::numeric, CASE WHEN nullif(p->>'insured_amount', '') IS NOT NULL THEN v_ccy END,
          nullif(p->>'premium', '')::numeric, CASE WHEN nullif(p->>'premium', '') IS NOT NULL THEN v_ccy END,
          v_has_cv, v_cv, nullif(trim(p->>'notes'), ''))
  RETURNING id INTO v_id;
  PERFORM public.set_beneficiaries(v_id, coalesce(p->'beneficiaries', '[]'::jsonb));
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------- 2) เพิ่มมูลค่าเวนคืนให้กรมธรรม์เดิม
CREATE OR REPLACE FUNCTION public.add_insurance_cash_value(p_policy_id uuid, p jsonb)
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

  v_owner := coalesce(nullif(p->>'owner_person_id', '')::uuid, pol.person_id, pol.payer_person_id);
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

-- ---------------------------------------------------------------- 3) แก้ผู้เอาประกัน → มูลค่าเวนคืนย้ายตาม
-- INVOKER: ทำด้วยสิทธิ์ของผู้แก้ (RLS / Trigger ของ asset_ownerships ทำงานตามปกติ)
CREATE OR REPLACE FUNCTION private.tg_policy_insured_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.person_id IS DISTINCT FROM OLD.person_id AND NEW.person_id IS NOT NULL AND OLD.person_id IS NOT NULL
     AND NEW.cash_value_asset_id IS NOT NULL AND NEW.deleted_at IS NULL
     AND (SELECT count(*) FROM public.asset_ownerships
           WHERE asset_id = NEW.cash_value_asset_id AND deleted_at IS NULL AND end_date IS NULL) = 1
     AND EXISTS (SELECT 1 FROM public.asset_ownerships
                  WHERE asset_id = NEW.cash_value_asset_id AND deleted_at IS NULL AND end_date IS NULL
                    AND person_id = OLD.person_id AND ownership_percent = 100) THEN
    PERFORM public.set_asset_ownership(NEW.cash_value_asset_id,
      jsonb_build_array(jsonb_build_object('person_id', NEW.person_id, 'percent', 100)), 'CORRECT', NULL);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.tg_policy_insured_owner() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS a55_insured_owner ON public.insurance_policies;
CREATE TRIGGER a55_insured_owner AFTER UPDATE OF person_id ON public.insurance_policies
  FOR EACH ROW EXECUTE FUNCTION private.tg_policy_insured_owner();
