-- =====================================================================
-- ประกัน: ปรับความคุ้มครอง (ตกลงกับเจ้าของ 8 พ.ย. 2026 · "ทำเลย")
--   1) ต่อส่วนของเล่ม (insurance_policies):
--        plan_name           ชื่อแบบประกัน / ชื่อสัญญา (หัวกล่อง "สัญญาเพิ่มเติม · สุขภาพ · <ชื่อแบบ>")
--        coverage_scope      คุ้มครองเฉพาะ (เช่น มะเร็ง) · ว่าง = ทั่วไป · สรุปสิทธิ์แยกไว้ ไม่บวกรวมกับวงเงินทั่วไป
--        coverage_checked_on ตรวจความคุ้มครองกับกรมธรรม์เมื่อ · ว่าง = ยังไม่ได้ตรวจ (แทน "ณ วันที่" รายแถว)
--   2) ต่อแถวความคุ้มครอง (insurance_coverages):
--        count_period        รอบของจำนวนสูงสุด / ความรับผิดส่วนแรก: PER_EVENT ต่อครั้ง · PER_YEAR ต่อปี · PER_TERM ตลอดสัญญา
--        label               ชื่อความคุ้มครองของหัวข้อ "อื่น ๆ" (แยกจากหมายเหตุ)
--        as_of_date เดิมเลิกใช้ในหน้าจอ (คอลัมน์ยังอยู่ · ข้อมูลเดิมไม่แก้)
--   3) v_insurance_status สร้างใหม่ให้มีคอลัมน์ใหม่ (นิยามเดิม)
--   4) set_insurance_coverages: รับ count_period / label ต่อแถว + plan_name / coverage_scope / coverage_checked_on ต่อกรมธรรม์ (ส่งมาเฉพาะที่จะตั้ง)
--   5) create_insurance_booklet: รับ plan_name / coverage_scope ต่อส่วน · coverage_checked_on ของเล่มใหม่ใช้กับทุกส่วน
-- เพิ่มคอลัมน์ / ฟังก์ชันอย่างเดียว ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้ (ADD COLUMN IF NOT EXISTS · DROP CONSTRAINT IF EXISTS · CREATE OR REPLACE)
-- =====================================================================

-- ---------------------------------------------------------------- 1) ต่อส่วนของเล่ม
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS plan_name text;
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS coverage_scope text;
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS coverage_checked_on date;
ALTER TABLE public.insurance_policies DROP CONSTRAINT IF EXISTS insurance_policies_plan_name_check;
ALTER TABLE public.insurance_policies ADD CONSTRAINT insurance_policies_plan_name_check CHECK (plan_name IS NULL OR length(plan_name) <= 200);
ALTER TABLE public.insurance_policies DROP CONSTRAINT IF EXISTS insurance_policies_coverage_scope_check;
ALTER TABLE public.insurance_policies ADD CONSTRAINT insurance_policies_coverage_scope_check CHECK (coverage_scope IS NULL OR length(coverage_scope) <= 100);

-- ---------------------------------------------------------------- 2) ต่อแถวความคุ้มครอง
ALTER TABLE public.insurance_coverages ADD COLUMN IF NOT EXISTS count_period text;
ALTER TABLE public.insurance_coverages ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE public.insurance_coverages DROP CONSTRAINT IF EXISTS insurance_coverages_count_period_check;
ALTER TABLE public.insurance_coverages ADD CONSTRAINT insurance_coverages_count_period_check
  CHECK (count_period IS NULL OR count_period IN ('PER_EVENT','PER_YEAR','PER_TERM'));
ALTER TABLE public.insurance_coverages DROP CONSTRAINT IF EXISTS insurance_coverages_label_check;
ALTER TABLE public.insurance_coverages ADD CONSTRAINT insurance_coverages_label_check CHECK (label IS NULL OR length(label) <= 200);

-- ---------------------------------------------------------------- 3) v_insurance_status (นิยามเดิมจาก 20261103124500 · p.* รวมคอลัมน์ใหม่)
DROP VIEW IF EXISTS public.v_insurance_status;
CREATE VIEW public.v_insurance_status WITH (security_invoker = true) AS
  SELECT p.*,
         CASE WHEN p.end_date IS NULL THEN NULL
              WHEN p.end_date < current_date THEN 'EXPIRED'
              WHEN p.end_date <= current_date + 60 THEN 'EXPIRING_SOON' END AS derived_status
    FROM public.insurance_policies p WHERE p.deleted_at IS NULL;
REVOKE ALL ON public.v_insurance_status FROM PUBLIC, anon;
GRANT SELECT ON public.v_insurance_status TO authenticated;

-- ---------------------------------------------------------------- 4) บันทึกตารางความคุ้มครองทั้งชุด (+ ข้อมูลต่อส่วน)
-- p = {"policies": [{"policy_id", "plan_name"?, "coverage_scope"?, "coverage_checked_on"?,
--                    "rows": [{"id"?, "coverage_type", "limit_amount", "max_count"?, "count_period"?, "label"?, "as_of_date"?, "notes"?, "currency"?}]}]}
--   ข้อมูลต่อส่วน: ส่งคีย์มา = ตั้งค่า (ว่าง = ล้าง) · ไม่ส่ง = ไม่แตะ · แก้เฉพาะเมื่อเปลี่ยนจริง (ไม่ติดสิทธิ์ CONTRIBUTOR ถ้าไม่ได้แก้)
-- INVOKER: RLS / Trigger ของ insurance_coverages / insurance_policies ทำงานตามปกติ
CREATE OR REPLACE FUNCTION public.set_insurance_coverages(p jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  pp jsonb; r jsonb; pol public.insurance_policies; v_ids uuid[]; v_seen uuid[] := '{}'; v_n integer := 0;
  v_type text; v_amt numeric; v_cnt integer; v_asof date; v_notes text; v_ccy text; v_del integer;
  v_period text; v_label text; v_plan text; v_scope text; v_checked date;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF jsonb_typeof(p->'policies') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID: ข้อมูลความคุ้มครองไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  FOR pp IN SELECT * FROM jsonb_array_elements(p->'policies') LOOP
    SELECT * INTO pol FROM public.insurance_policies WHERE id = nullif(pp->>'policy_id', '')::uuid AND deleted_at IS NULL;
    IF pol.id IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023'; END IF;
    IF pol.id = ANY(v_seen) THEN RAISE EXCEPTION 'INVALID: ส่งกรมธรรม์เดียวกันซ้ำ' USING ERRCODE = '22023'; END IF;
    v_seen := v_seen || pol.id;
    IF jsonb_typeof(coalesce(pp->'rows', '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'INVALID: ข้อมูลความคุ้มครองไม่ถูกต้อง' USING ERRCODE = '22023';
    END IF;
    -- ข้อมูลต่อส่วน (ชื่อแบบ · คุ้มครองเฉพาะ · ตรวจกับกรมธรรม์เมื่อ)
    v_plan := CASE WHEN pp ? 'plan_name' THEN nullif(trim(coalesce(pp->>'plan_name', '')), '') ELSE pol.plan_name END;
    v_scope := CASE WHEN pp ? 'coverage_scope' THEN nullif(trim(coalesce(pp->>'coverage_scope', '')), '') ELSE pol.coverage_scope END;
    v_checked := CASE WHEN pp ? 'coverage_checked_on' THEN nullif(pp->>'coverage_checked_on', '')::date ELSE pol.coverage_checked_on END;
    IF (pol.plan_name, pol.coverage_scope, pol.coverage_checked_on) IS DISTINCT FROM (v_plan, v_scope, v_checked) THEN
      UPDATE public.insurance_policies SET plan_name = v_plan, coverage_scope = v_scope, coverage_checked_on = v_checked WHERE id = pol.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้กรมธรรม์นี้' USING ERRCODE = '42501'; END IF;
    END IF;
    v_ccy := coalesce(pol.insured_amount_currency, pol.premium_currency, 'THB');
    SELECT coalesce(array_agg((x->>'id')::uuid), '{}') INTO v_ids
      FROM jsonb_array_elements(coalesce(pp->'rows', '[]'::jsonb)) x WHERE nullif(x->>'id', '') IS NOT NULL;
    -- แถวเดิมที่ส่งมาต้องเป็นของกรมธรรม์นี้ (และยังไม่ถูกลบ)
    IF EXISTS (SELECT 1 FROM unnest(v_ids) i
                WHERE NOT EXISTS (SELECT 1 FROM public.insurance_coverages c WHERE c.id = i AND c.policy_id = pol.id AND c.deleted_at IS NULL)) THEN
      RAISE EXCEPTION 'INVALID: รายการความคุ้มครองเปลี่ยนไปแล้ว (อาจมีคนแก้พร้อมกัน) · โหลดหน้าใหม่แล้วลองอีกครั้ง' USING ERRCODE = '22023';
    END IF;
    -- แถวเดิมที่ไม่ได้ส่งมา → ลบ · RLS กรองแถวที่ไม่มีสิทธิ์ออกเงียบ ๆ → นับเทียบแล้วแจ้ง
    SELECT count(*) INTO v_del FROM public.insurance_coverages WHERE policy_id = pol.id AND deleted_at IS NULL AND id <> ALL(v_ids);
    UPDATE public.insurance_coverages SET deleted_at = now()
     WHERE policy_id = pol.id AND deleted_at IS NULL AND id <> ALL(v_ids);
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt < v_del THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: ลบความคุ้มครองได้เฉพาะ ADMIN / EDITOR' USING ERRCODE = '42501';
    END IF;
    FOR r IN SELECT * FROM jsonb_array_elements(coalesce(pp->'rows', '[]'::jsonb)) LOOP
      v_type := r->>'coverage_type';
      v_amt := CASE WHEN v_type = 'WAIVER' THEN 0 ELSE nullif(replace(r->>'limit_amount', ',', ''), '')::numeric END;
      IF v_amt IS NULL OR v_amt < 0 THEN
        RAISE EXCEPTION 'INVALID: กรุณาใส่วงเงินของทุกแถวที่กรอก (0 ขึ้นไป)' USING ERRCODE = '22023';
      END IF;
      v_cnt := nullif(replace(r->>'max_count', ',', ''), '')::integer;
      v_asof := nullif(r->>'as_of_date', '')::date;
      v_notes := nullif(trim(coalesce(r->>'notes', '')), '');
      v_period := nullif(r->>'count_period', '');
      v_label := nullif(trim(coalesce(r->>'label', '')), '');
      -- "อื่น ๆ" ต้องมีชื่อ (รายการเดิมที่เขียนชื่อไว้ในหมายเหตุ ยังผ่าน)
      IF v_type = 'OTHER' AND v_label IS NULL AND v_notes IS NULL THEN
        RAISE EXCEPTION 'INVALID: ใส่ชื่อความคุ้มครองของหัวข้อ "อื่น ๆ"' USING ERRCODE = '22023';
      END IF;
      IF nullif(r->>'id', '') IS NULL THEN
        INSERT INTO public.insurance_coverages(policy_id, coverage_type, limit_amount, currency, max_count, as_of_date, notes, count_period, label)
        VALUES (pol.id, v_type, v_amt, upper(coalesce(nullif(r->>'currency', ''), v_ccy)), v_cnt, v_asof, v_notes, v_period, v_label);
      ELSIF EXISTS (SELECT 1 FROM public.insurance_coverages c WHERE c.id = (r->>'id')::uuid
                     AND (c.coverage_type, c.limit_amount, c.max_count, c.as_of_date, c.notes, c.count_period, c.label)
                         IS DISTINCT FROM (v_type, v_amt, v_cnt, v_asof, v_notes, v_period, v_label)) THEN
        -- แก้เฉพาะแถวที่เปลี่ยนจริง (แถวเดิมของคนอื่น / เกิน 24 ชม. ที่ไม่ได้แก้ ไม่ติดสิทธิ์ CONTRIBUTOR)
        UPDATE public.insurance_coverages c
           SET coverage_type = v_type, limit_amount = v_amt, max_count = v_cnt, as_of_date = v_asof, notes = v_notes,
               count_period = v_period, label = v_label
         WHERE c.id = (r->>'id')::uuid;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้ความคุ้มครองรายการนี้' USING ERRCODE = '42501';
        END IF;
      END IF;
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.set_insurance_coverages(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_insurance_coverages(jsonb) TO authenticated;

-- ---------------------------------------------------------------- 5) สร้างเล่ม (เหมือน 20261107070000 + ชื่อแบบ / คุ้มครองเฉพาะ / ตรวจเมื่อ)
--   ก) เล่มใหม่: p.plan_name / p.coverage_scope = ของสัญญาหลัก · p.coverage_checked_on = ทุกส่วนของเล่มใหม่
--      riders[].plan_name / riders[].coverage_scope = ของส่วนนั้น
--   ข) เพิ่มในเล่มเดิม: riders[].plan_name / coverage_scope / coverage_checked_on ของส่วนใหม่เท่านั้น
CREATE OR REPLACE FUNCTION public.create_insurance_booklet(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  m public.insurance_policies; r jsonb; v_id uuid; v_n integer := 0;
  v_riders jsonb := coalesce(p->'riders', '[]'::jsonb);
  v_payer uuid; v_bank uuid; v_card uuid; v_ccy text; v_checked date; v_plan text; v_scope text;
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
    v_checked := nullif(p->>'coverage_checked_on', '')::date;
    v_plan := nullif(trim(coalesce(p->>'plan_name', '')), '');
    v_scope := nullif(trim(coalesce(p->>'coverage_scope', '')), '');
    IF v_payer IS NOT NULL OR v_bank IS NOT NULL OR v_card IS NOT NULL OR v_checked IS NOT NULL OR v_plan IS NOT NULL OR v_scope IS NOT NULL THEN
      -- ผู้จ่ายเบี้ย = ผู้เอาประกัน → เก็บว่าง (ความหมายเดียวกัน)
      UPDATE public.insurance_policies
         SET payer_person_id = CASE WHEN v_payer IS DISTINCT FROM person_id THEN v_payer END,
             paid_from_asset_id = v_bank, paid_from_credit_card_id = v_card,
             plan_name = v_plan, coverage_scope = v_scope, coverage_checked_on = v_checked
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
    v_plan := nullif(trim(coalesce(r->>'plan_name', '')), '');
    v_scope := nullif(trim(coalesce(r->>'coverage_scope', '')), '');
    IF m.payer_person_id IS NOT NULL OR v_bank IS NOT NULL OR v_card IS NOT NULL OR v_plan IS NOT NULL OR v_scope IS NOT NULL
       OR coalesce(nullif(r->>'coverage_checked_on', '')::date, v_checked) IS NOT NULL THEN
      UPDATE public.insurance_policies
         SET payer_person_id = m.payer_person_id, paid_from_asset_id = v_bank, paid_from_credit_card_id = v_card,
             plan_name = v_plan, coverage_scope = v_scope, coverage_checked_on = coalesce(nullif(r->>'coverage_checked_on', '')::date, v_checked)
       WHERE id = v_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้กรมธรรม์นี้' USING ERRCODE = '42501'; END IF;
    END IF;
  END LOOP;
  RETURN m.id;
END $$;
REVOKE ALL ON FUNCTION public.create_insurance_booklet(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_insurance_booklet(jsonb) TO authenticated;
