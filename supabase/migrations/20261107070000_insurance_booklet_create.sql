-- =====================================================================
-- Insurance: สร้างกรมธรรม์พร้อมสัญญาเพิ่มเติมในคำสั่งเดียว (ตกลง 7 พ.ย. 2026)
--   public.create_insurance_booklet(p jsonb) RETURNS uuid = id ของสัญญาหลัก
--     ก) สร้างเล่มใหม่: p = ข้อมูลแบบ create_insurance_policy
--          + payer_person_id / paid_from_asset_id / paid_from_credit_card_id (ผู้จ่ายเบี้ย · จ่ายเบี้ยจาก)
--          + riders = [{insurance_type, insured_amount, premium, end_date, notes, coverages}]
--     ข) เพิ่มสัญญาเพิ่มเติมในเล่มที่มีอยู่: p = {main_id, riders}
--   สัญญาเพิ่มเติมใช้ บริษัท · เลขกรมธรรม์ · ผู้เอาประกัน · ผู้จ่ายเบี้ย · จ่ายเบี้ยจาก · วันเริ่ม · สกุลเงิน ของสัญญาหลัก
--     (เล่มเดียวกัน = บริษัท + เลขกรมธรรม์เดียวกัน → ต้องมีเลขกรมธรรม์) · ไม่มีมูลค่าเวนคืน / ผู้รับผลประโยชน์ (ของสัญญาหลัก)
--   ผิดส่วนเดียว = ไม่บันทึกเลยทั้งเล่ม · INVOKER: RLS / Trigger / สิทธิ์ทำงานตามปกติ
--   เพิ่มฟังก์ชันอย่างเดียว ไม่แตะข้อมูลเดิม · รันซ้ำได้ (CREATE OR REPLACE)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_insurance_booklet(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  m public.insurance_policies; r jsonb; v_id uuid; v_n integer := 0;
  v_riders jsonb := coalesce(p->'riders', '[]'::jsonb);
  v_payer uuid; v_bank uuid; v_card uuid; v_ccy text;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF jsonb_typeof(v_riders) <> 'array' THEN
    RAISE EXCEPTION 'INVALID: ข้อมูลสัญญาเพิ่มเติมไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF nullif(p->>'main_id', '') IS NOT NULL THEN
    -- ข) เล่มที่มีอยู่
    SELECT * INTO m FROM public.insurance_policies WHERE id = (p->>'main_id')::uuid AND deleted_at IS NULL;
    IF m.id IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023'; END IF;
    IF jsonb_array_length(v_riders) = 0 THEN
      RAISE EXCEPTION 'INVALID: ยังไม่ได้ใส่สัญญาเพิ่มเติม' USING ERRCODE = '22023';
    END IF;
  ELSE
    -- ก) เล่มใหม่: สัญญาหลัก (+ มูลค่าเวนคืน / ผู้รับผลประโยชน์ / ความคุ้มครอง ตาม create_insurance_policy)
    v_id := public.create_insurance_policy(p);
    v_payer := nullif(p->>'payer_person_id', '')::uuid;
    v_bank := nullif(p->>'paid_from_asset_id', '')::uuid;
    v_card := nullif(p->>'paid_from_credit_card_id', '')::uuid;
    IF v_payer IS NOT NULL OR v_bank IS NOT NULL OR v_card IS NOT NULL THEN
      -- ผู้จ่ายเบี้ย = ผู้เอาประกัน → เก็บว่าง (ความหมายเดียวกัน)
      UPDATE public.insurance_policies
         SET payer_person_id = CASE WHEN v_payer IS DISTINCT FROM person_id THEN v_payer END,
             paid_from_asset_id = v_bank, paid_from_credit_card_id = v_card
       WHERE id = v_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้กรมธรรม์นี้' USING ERRCODE = '42501'; END IF;
    END IF;
    SELECT * INTO m FROM public.insurance_policies WHERE id = v_id;
  END IF;

  IF jsonb_array_length(v_riders) = 0 THEN RETURN m.id; END IF;
  IF m.insurance_type = 'PROPERTY' THEN
    RAISE EXCEPTION 'INVALID: ประกันทรัพย์สินเพิ่มสัญญาเพิ่มเติมไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF nullif(regexp_replace(coalesce(m.policy_no, ''), '\s', '', 'g'), '') IS NULL THEN
    RAISE EXCEPTION 'INVALID: ใส่เลขกรมธรรม์ก่อนเพิ่มสัญญาเพิ่มเติม (สัญญาเพิ่มเติมผูกกับเล่มด้วยบริษัท + เลขกรมธรรม์)' USING ERRCODE = '22023';
  END IF;
  v_ccy := coalesce(m.premium_currency, m.insured_amount_currency, 'THB');
  -- บัญชี / บัตรตั้งต้นที่ถูกลบไปแล้ว → ไม่คัดลอก (เลือกตอนจ่ายแทน)
  v_bank := CASE WHEN EXISTS (SELECT 1 FROM public.assets a WHERE a.id = m.paid_from_asset_id AND a.deleted_at IS NULL) THEN m.paid_from_asset_id END;
  v_card := CASE WHEN EXISTS (SELECT 1 FROM public.credit_cards c WHERE c.id = m.paid_from_credit_card_id AND c.deleted_at IS NULL) THEN m.paid_from_credit_card_id END;

  FOR r IN SELECT * FROM jsonb_array_elements(v_riders) LOOP
    v_n := v_n + 1;
    IF coalesce(r->>'insurance_type', '') NOT IN ('LIFE','ANNUITY','HEALTH','ACCIDENT') THEN
      RAISE EXCEPTION 'INVALID: สัญญาเพิ่มเติมที่ % ต้องเป็นประกันชีวิต / บำนาญ / สุขภาพ / อุบัติเหตุ', v_n USING ERRCODE = '22023';
    END IF;
    v_id := public.create_insurance_policy(jsonb_build_object(
      'insurance_type', r->>'insurance_type', 'person_id', m.person_id, 'insurer', m.insurer, 'policy_no', m.policy_no,
      'start_date', m.start_date, 'end_date', r->>'end_date', 'insured_amount', r->>'insured_amount', 'premium', r->>'premium',
      'currency', v_ccy, 'has_cash_value', false, 'notes', r->>'notes', 'coverages', coalesce(r->'coverages', '[]'::jsonb)));
    IF m.payer_person_id IS NOT NULL OR v_bank IS NOT NULL OR v_card IS NOT NULL THEN
      UPDATE public.insurance_policies
         SET payer_person_id = m.payer_person_id, paid_from_asset_id = v_bank, paid_from_credit_card_id = v_card
       WHERE id = v_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้กรมธรรม์นี้' USING ERRCODE = '42501'; END IF;
    END IF;
  END LOOP;
  RETURN m.id;
END $$;
REVOKE ALL ON FUNCTION public.create_insurance_booklet(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_insurance_booklet(jsonb) TO authenticated;
