-- =====================================================================
-- ประกัน: ประเภทบำนาญ · แก้ประเภทได้ · ตารางความคุ้มครองมาตรฐาน (ตกลงกับเจ้าของ 7 พ.ย. 2026 · "ทำเลย")
--   1) ประเภทใหม่ ANNUITY "ประกันชีวิตแบบบำนาญ" → ค่าลดหย่อน "เบี้ยประกันชีวิตแบบบำนาญ" (PENSION_INS)
--      รายการติดตามเมื่อผู้เอาประกันเสียชีวิต: บำนาญ = ยื่นเคลมสินไหมมรณกรรม (เหมือนประกันชีวิต)
--   2) แก้ประเภทได้ระหว่าง ชีวิต / บำนาญ / สุขภาพ / อุบัติเหตุ · ประกันทรัพย์สินเปลี่ยนไม่ได้ (ทั้งเปลี่ยนออกและเปลี่ยนเข้า)
--   3) ความคุ้มครอง: หัวข้อครบตามตารางมาตรฐาน + จำนวนสูงสุด (ครั้ง / วัน / งวด) + ณ วันที่
--      หัวข้อใหม่: สูญเสียอวัยวะ / ทุพพลภาพจากอุบัติเหตุ · ค่ารักษาจากอุบัติเหตุ · ทุพพลภาพรายงวด · โรคร้ายแรงระยะเริ่มต้น–ปานกลาง
--                  ความรับผิดส่วนแรก · ร่วมจ่าย (%) · ยกเว้นเบี้ย (มีสิทธิ์ · วงเงินเก็บเป็น 0)
--      ข้อมูลเดิมไม่แก้ (ชื่อหัวข้อเดิมบางตัวแสดงชัดขึ้นเท่านั้น)
--   4) public.set_insurance_coverages(p): บันทึกตารางความคุ้มครองทั้งชุด (หลายส่วนของเล่มในครั้งเดียว · ผิดแถวเดียว = ไม่บันทึกเลย)
--      แถวที่ไม่ได้ส่งมา = ลบ (soft delete · ADMIN / EDITOR ตามกติกาเดิม) · แถวที่ไม่เปลี่ยน = ไม่แตะ
--   5) create_insurance_policy รับ coverages มาพร้อมกัน (คำสั่งเดียว)
-- รันซ้ำได้ (DROP CONSTRAINT IF EXISTS · ADD COLUMN IF NOT EXISTS · CREATE OR REPLACE · DROP TRIGGER IF EXISTS)
-- ไม่แก้ / ไม่ลบข้อมูลเดิม
-- =====================================================================

-- ---------------------------------------------------------------- 1) ประเภทบำนาญ
ALTER TABLE public.insurance_policies DROP CONSTRAINT IF EXISTS insurance_policies_insurance_type_check;
ALTER TABLE public.insurance_policies ADD CONSTRAINT insurance_policies_insurance_type_check
  CHECK (insurance_type IN ('PROPERTY','LIFE','ANNUITY','HEALTH','ACCIDENT'));

-- ---------------------------------------------------------------- 2) แก้ประเภทได้ (ยกเว้นประกันทรัพย์สิน)
CREATE OR REPLACE FUNCTION private.tg_policy_type_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.insurance_type IS DISTINCT FROM OLD.insurance_type AND 'PROPERTY' IN (OLD.insurance_type, NEW.insurance_type) THEN
    RAISE EXCEPTION 'INVALID: ประกันทรัพย์สินเปลี่ยนประเภทไม่ได้ (และเปลี่ยนเป็นประกันทรัพย์สินไม่ได้) · ถ้าเลือกผิด ลบแล้วเพิ่มใหม่'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.tg_policy_type_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t17_type_change ON public.insurance_policies;
CREATE TRIGGER t17_type_change BEFORE UPDATE OF insurance_type ON public.insurance_policies
  FOR EACH ROW EXECUTE FUNCTION private.tg_policy_type_change();

-- ---------------------------------------------------------------- 3) หัวข้อความคุ้มครอง + จำนวนสูงสุด + ณ วันที่
ALTER TABLE public.insurance_coverages DROP CONSTRAINT IF EXISTS insurance_coverages_coverage_type_check;
ALTER TABLE public.insurance_coverages ADD CONSTRAINT insurance_coverages_coverage_type_check CHECK (coverage_type IN (
  'LIFE','ACCIDENT_DEATH','ACCIDENT_DISMEMBER','ACCIDENT_MEDICAL','DISABILITY','DISABILITY_INCOME','CI_EARLY','CRITICAL_ILLNESS',
  'IPD_ANNUAL','IPD_PER_ADMIT','ROOM_PER_DAY','OPD_PER_VISIT','OPD_ANNUAL','HOSPITAL_CASH_PER_DAY','DEDUCTIBLE','COPAY','WAIVER','OTHER'));
ALTER TABLE public.insurance_coverages ADD COLUMN IF NOT EXISTS max_count integer;
ALTER TABLE public.insurance_coverages ADD COLUMN IF NOT EXISTS as_of_date date;
ALTER TABLE public.insurance_coverages DROP CONSTRAINT IF EXISTS insurance_coverages_max_count_check;
ALTER TABLE public.insurance_coverages ADD CONSTRAINT insurance_coverages_max_count_check CHECK (max_count IS NULL OR max_count > 0);
-- ร่วมจ่าย = เปอร์เซ็นต์ (0–100)
ALTER TABLE public.insurance_coverages DROP CONSTRAINT IF EXISTS insurance_coverages_copay_check;
ALTER TABLE public.insurance_coverages ADD CONSTRAINT insurance_coverages_copay_check CHECK (coverage_type <> 'COPAY' OR limit_amount <= 100);

-- ---------------------------------------------------------------- 4) บันทึกตารางความคุ้มครองทั้งชุด
-- p = {"policies": [{"policy_id": uuid, "rows": [{"id"?, "coverage_type", "limit_amount", "max_count"?, "as_of_date"?, "notes"?, "currency"?}]}]}
-- INVOKER: RLS / Trigger ของ insurance_coverages ทำงานตามปกติ (CONTRIBUTOR เพิ่มได้ · ลบได้เฉพาะ ADMIN / EDITOR)
CREATE OR REPLACE FUNCTION public.set_insurance_coverages(p jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  pp jsonb; r jsonb; pol public.insurance_policies; v_ids uuid[]; v_seen uuid[] := '{}'; v_n integer := 0;
  v_type text; v_amt numeric; v_cnt integer; v_asof date; v_notes text; v_ccy text; v_del integer;
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
    v_ccy := coalesce(pol.insured_amount_currency, pol.premium_currency, 'THB');
    SELECT coalesce(array_agg((x->>'id')::uuid), '{}') INTO v_ids
      FROM jsonb_array_elements(coalesce(pp->'rows', '[]'::jsonb)) x WHERE nullif(x->>'id', '') IS NOT NULL;
    -- แถวเดิมที่ส่งมาต้องเป็นของกรมธรรม์นี้ (และยังไม่ถูกลบ)
    IF EXISTS (SELECT 1 FROM unnest(v_ids) i
                WHERE NOT EXISTS (SELECT 1 FROM public.insurance_coverages c WHERE c.id = i AND c.policy_id = pol.id AND c.deleted_at IS NULL)) THEN
      RAISE EXCEPTION 'INVALID: รายการความคุ้มครองเปลี่ยนไปแล้ว (อาจมีคนแก้พร้อมกัน) · โหลดหน้าใหม่แล้วลองอีกครั้ง' USING ERRCODE = '22023';
    END IF;
    -- แถวเดิมที่ไม่ได้ส่งมา (ช่องว่าง = ไม่คุ้มครอง) → ลบ · RLS กรองแถวที่ไม่มีสิทธิ์ออกเงียบ ๆ → นับเทียบแล้วแจ้ง
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
      IF nullif(r->>'id', '') IS NULL THEN
        INSERT INTO public.insurance_coverages(policy_id, coverage_type, limit_amount, currency, max_count, as_of_date, notes)
        VALUES (pol.id, v_type, v_amt, upper(coalesce(nullif(r->>'currency', ''), v_ccy)), v_cnt, v_asof, v_notes);
      ELSIF EXISTS (SELECT 1 FROM public.insurance_coverages c WHERE c.id = (r->>'id')::uuid
                     AND (c.coverage_type, c.limit_amount, c.max_count, c.as_of_date, c.notes) IS DISTINCT FROM (v_type, v_amt, v_cnt, v_asof, v_notes)) THEN
        -- แก้เฉพาะแถวที่เปลี่ยนจริง (แถวเดิมของคนอื่น / เกิน 24 ชม. ที่ไม่ได้แก้ ไม่ติดสิทธิ์ CONTRIBUTOR)
        UPDATE public.insurance_coverages c
           SET coverage_type = v_type, limit_amount = v_amt, max_count = v_cnt, as_of_date = v_asof, notes = v_notes
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

-- ---------------------------------------------------------------- 5) สร้างกรมธรรม์ + ความคุ้มครองในคำสั่งเดียว (signature เดิม)
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
  -- ตารางความคุ้มครองมาตรฐาน (ถ้ากรอกมาพร้อมกัน · บันทึกในคำสั่งเดียวกัน ผิด = ไม่บันทึกทั้งกรมธรรม์)
  IF jsonb_typeof(p->'coverages') = 'array' AND jsonb_array_length(p->'coverages') > 0 THEN
    PERFORM public.set_insurance_coverages(jsonb_build_object('policies',
      jsonb_build_array(jsonb_build_object('policy_id', v_id, 'rows', p->'coverages'))));
  END IF;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------- 6) ภาษี: บำนาญ → ค่าลดหย่อนเบี้ยประกันชีวิตแบบบำนาญ (ที่เหลือเหมือนเดิม)
CREATE OR REPLACE FUNCTION public.tax_system_lines(p_person uuid, p_year integer)
RETURNS TABLE (section text, code text, label text, sort_order integer, system_amount numeric, qty numeric, detail jsonb)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE v_from date := make_date(p_year, 1, 1); v_to date := make_date(p_year, 12, 31);
        p public.persons; v_children int; v_parents int;
BEGIN
  IF NOT private.tax_can_read(p_person) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: ดูข้อมูลภาษีได้เฉพาะของตัวเอง (ADMIN ดูได้ทุกคน)' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.persons WHERE id = p_person;

  SELECT count(*) INTO v_children FROM public.persons c
   WHERE c.deleted_at IS NULL AND c.status <> 'DECEASED' AND (c.father_id = p_person OR c.mother_id = p_person);
  SELECT count(*) INTO v_parents FROM public.persons x
   WHERE x.deleted_at IS NULL AND x.id IN (p.father_id, p.mother_id)
     AND (x.death_date IS NULL OR x.death_date > v_to) AND x.status <> 'DECEASED'
     AND x.birth_date IS NOT NULL AND x.birth_date <= (v_to - interval '60 years')::date;

  RETURN QUERY
  WITH tpl(section, code, label, sort_order) AS (VALUES
    ('INCOME','40(1)','40(1) เงินเดือน โบนัส ค่าจ้าง', 10), ('INCOME','40(2)','40(2) ค่าตอบแทนจากหน้าที่หรืองานที่ทำให้', 20),
    ('INCOME','40(3)','40(3) ค่าลิขสิทธิ์และสิทธิอื่น', 30), ('INCOME','40(4)','40(4) ดอกเบี้ย เงินปันผล', 40),
    ('INCOME','40(5)','40(5) ค่าเช่าทรัพย์สิน', 50), ('INCOME','40(6)','40(6) วิชาชีพอิสระ', 60),
    ('INCOME','40(7)','40(7) รับเหมา', 70), ('INCOME','40(8)','40(8) ธุรกิจ การพาณิชย์ และเงินได้อื่น', 80),
    ('INCOME','REVIEW','รอตรวจสอบ: รายได้อื่น / กำไรจากการขาย / ผลประโยชน์ประกัน / รายได้รอแยก (ยังไม่รวมคำนวณ)', 90),
    ('EXPENSE','EXP_40_1_2','ค่าใช้จ่าย 40(1)–(2) (หักแบบเหมา)', 110), ('EXPENSE','EXP_40_5','ค่าใช้จ่าย 40(5) ค่าเช่า', 120),
    ('EXPENSE','EXP_40_6_8','ค่าใช้จ่าย 40(6)–(8)', 130),
    ('DEDUCTION','PERSONAL','ผู้มีเงินได้', 210), ('DEDUCTION','SPOUSE','คู่สมรส (ไม่มีเงินได้)', 220), ('DEDUCTION','CHILD','บุตร', 230),
    ('DEDUCTION','PARENT','บิดามารดา (อายุ 60 ปีขึ้นไป)', 240), ('DEDUCTION','DISABLED','อุปการะคนพิการ / ทุพพลภาพ', 245),
    ('DEDUCTION','LIFE_INS','เบี้ยประกันชีวิต', 250), ('DEDUCTION','HEALTH_INS','เบี้ยประกันสุขภาพ', 260),
    ('DEDUCTION','PARENT_HEALTH_INS','เบี้ยประกันสุขภาพบิดามารดา', 270), ('DEDUCTION','PENSION_INS','เบี้ยประกันชีวิตแบบบำนาญ', 280),
    ('DEDUCTION','PVD','กองทุนสำรองเลี้ยงชีพ / กบข.', 290), ('DEDUCTION','RMF','กองทุน RMF', 300), ('DEDUCTION','SSF','กองทุน SSF', 310),
    ('DEDUCTION','THAI_ESG','กองทุน Thai ESG', 320), ('DEDUCTION','SOCIAL_SECURITY','เงินสมทบประกันสังคม', 330),
    ('DEDUCTION','HOME_LOAN_INT','ดอกเบี้ยเงินกู้ซื้อที่อยู่อาศัย', 340), ('DEDUCTION','OTHER_DEDUCTION','ค่าลดหย่อนอื่นตามปีภาษี', 350),
    ('DONATION','DON_DOUBLE','เงินบริจาคที่หักได้ 2 เท่า (การศึกษา / โรงพยาบาลรัฐ ฯลฯ)', 410),
    ('DONATION','DON_GENERAL','เงินบริจาคทั่วไป', 420), ('DONATION','DON_POLITICAL','เงินบริจาคพรรคการเมือง', 430),
    ('CREDIT','WHT','ภาษีหัก ณ ที่จ่าย', 510), ('CREDIT','HALF_YEAR','ภาษีที่ชำระแล้ว (ภ.ง.ด.94 ครึ่งปี)', 520),
    ('CREDIT','DIVIDEND_CREDIT','เครดิตภาษีเงินปันผล', 530), ('CREDIT','OTHER_CREDIT','เครดิตภาษีอื่น', 540)),
  raw AS (
    SELECT CASE WHEN i.pending_split THEN 'REVIEW'
                WHEN i.income_type IN ('SALARY','BONUS') THEN '40(1)'
                WHEN i.income_type IN ('INTEREST','DIVIDEND','COUPON','LOAN_INTEREST','BUSINESS_DIVIDEND') THEN '40(4)'
                WHEN i.income_type = 'RENT' THEN '40(5)'
                ELSE 'REVIEW' END AS code,
           CASE WHEN i.pending_split THEN 'PENDING_SPLIT' WHEN i.income_type = 'OTHER' AND i.income_subtype IS NOT NULL THEN 'OTHER:' || i.income_subtype ELSE i.income_type END AS income_type,
           round(coalesce(i.base_amount, i.amount) * sh.pct / 100, 2) AS amount,
           round(CASE WHEN i.amount > 0 THEN coalesce(i.tax, 0) * coalesce(i.base_amount, i.amount) / i.amount ELSE 0 END * sh.pct / 100, 2) AS wht,
           i.person_id IS NULL AS shared
      FROM public.income_transactions i
      CROSS JOIN LATERAL private.income_shares(i.person_id, i.asset_id, i.received_to_asset_id, i.date, i.received_to_liability_id) sh
     WHERE i.deleted_at IS NULL AND i.date BETWEEN v_from AND v_to AND sh.person_id = p_person),
  inc AS (
    SELECT t.code, sum(t.amount) AS amount, sum(t.wht) AS wht,
           sum(t.amount) FILTER (WHERE t.shared) AS shared_amount,
           jsonb_object_agg(t.income_type, jsonb_build_object('amount', t.amount, 'wht', t.wht)) AS by_type
      FROM (SELECT code, income_type, bool_or(shared) AS shared, sum(amount) AS amount, sum(wht) AS wht
              FROM raw GROUP BY code, income_type) t
     GROUP BY t.code),
  ins AS (                                                       -- เบี้ยประกันที่จ่ายในปี (ผูกงวดเบี้ยของกรมธรรม์)
    SELECT CASE WHEN pol.insurance_type = 'LIFE' AND pol.person_id = p_person THEN 'LIFE_INS'
                WHEN pol.insurance_type = 'ANNUITY' AND pol.person_id = p_person THEN 'PENSION_INS'
                WHEN pol.insurance_type = 'HEALTH' AND pol.person_id = p_person THEN 'HEALTH_INS'
                WHEN pol.insurance_type = 'HEALTH' AND pol.person_id IN (p.father_id, p.mother_id) AND sh.person_id = p_person THEN 'PARENT_HEALTH_INS' END AS code,
           round(coalesce(e.base_amount, e.amount) * CASE WHEN pol.person_id = p_person THEN 1 ELSE sh.pct / 100 END, 2) AS amount,
           jsonb_build_object('date', e.date, 'text', pol.insurer || coalesce(' ' || pol.policy_no, ''), 'amount', coalesce(e.base_amount, e.amount)) AS item
      FROM public.expense_items e
      JOIN public.monthly_expenses me ON me.id = e.monthly_expense_id AND me.deleted_at IS NULL
      JOIN public.insurance_schedule_lines l ON l.id = e.insurance_schedule_line_id
      JOIN public.insurance_policies pol ON pol.id = l.policy_id
      LEFT JOIN LATERAL (SELECT s.person_id, s.pct FROM private.expense_shares(e.person_id, e.paid_from_credit_card_id, e.paid_from_asset_id, e.date, e.liability_id) s
                          WHERE s.person_id = p_person LIMIT 1) sh ON true
     WHERE e.deleted_at IS NULL AND e.date BETWEEN v_from AND v_to
       AND (pol.person_id = p_person OR (pol.person_id IN (p.father_id, p.mother_id) AND sh.person_id = p_person))),
  home AS (                                                      -- ดอกเบี้ยจ่ายของหนี้ประเภทเงินกู้บ้าน (ตามผู้รับผิดชอบหนี้)
    SELECT round(coalesce(e.base_amount, e.amount) * sh.pct / 100, 2) AS amount,
           jsonb_build_object('date', e.date, 'text', l.name, 'amount', round(coalesce(e.base_amount, e.amount) * sh.pct / 100, 2)) AS item
      FROM public.expense_items e
      JOIN public.monthly_expenses me ON me.id = e.monthly_expense_id AND me.deleted_at IS NULL
      JOIN public.liabilities l ON l.id = e.liability_id AND l.liability_type = 'MORTGAGE'
      CROSS JOIN LATERAL private.expense_shares(e.person_id, e.paid_from_credit_card_id, e.paid_from_asset_id, e.date, e.liability_id) sh
     WHERE e.deleted_at IS NULL AND e.date BETWEEN v_from AND v_to AND e.expense_category = 'ดอกเบี้ยจ่าย' AND sh.person_id = p_person),
  prop AS (                                                      -- ค่าใช้จ่ายของทรัพย์สินกลุ่มอสังหาฯ (ตามจริง · ใช้ประกอบ 40(5))
    SELECT round(coalesce(e.base_amount, e.amount) * sh.pct / 100, 2) AS amount
      FROM public.expense_items e
      JOIN public.monthly_expenses me ON me.id = e.monthly_expense_id AND me.deleted_at IS NULL
      JOIN public.assets a ON a.id = e.related_asset_id AND a.asset_group = 'PROPERTY'
      CROSS JOIN LATERAL private.expense_shares(e.person_id, e.paid_from_credit_card_id, e.paid_from_asset_id, e.date, e.liability_id) sh
     WHERE e.deleted_at IS NULL AND e.date BETWEEN v_from AND v_to AND sh.person_id = p_person),
  don AS (                                                       -- เงินบริจาค (แท็บ Donations · ผู้ใช้สิทธิ = คนนี้)
    SELECT CASE WHEN d.tax_kind = 'DOUBLE' THEN 'DON_DOUBLE' WHEN d.tax_kind = 'POLITICAL' THEN 'DON_POLITICAL' ELSE 'DON_GENERAL' END AS code,
           d.tax_status, d.amount,
           jsonb_build_object('date', d.donation_date, 'text', d.donee_name, 'amount', d.amount, 'e_donation', d.e_donation, 'status', d.tax_status) AS item
      FROM public.donation_records d
     WHERE d.deleted_at IS NULL AND d.donor_kind = 'PERSON' AND coalesce(d.claimant_person_id, d.donor_person_id) = p_person
       AND d.donation_date BETWEEN v_from AND v_to AND d.tax_status <> 'NONE')
  SELECT t.section, t.code, t.label, t.sort_order,
         CASE
           WHEN t.section = 'INCOME' THEN (SELECT inc.amount FROM inc WHERE inc.code = t.code)
           WHEN t.code = 'EXP_40_5' THEN (SELECT sum(prop.amount) FROM prop)
           WHEN t.code IN ('LIFE_INS','PENSION_INS','HEALTH_INS','PARENT_HEALTH_INS') THEN (SELECT sum(ins.amount) FROM ins WHERE ins.code = t.code)
           WHEN t.code = 'HOME_LOAN_INT' THEN (SELECT sum(home.amount) FROM home)
           WHEN t.section = 'DONATION' THEN (SELECT sum(don.amount) FROM don WHERE don.code = t.code AND don.tax_status = 'ELIGIBLE')
           WHEN t.code = 'WHT' THEN (SELECT sum(inc.wht) FROM inc WHERE inc.code <> 'REVIEW')
         END,
         CASE t.code WHEN 'PERSONAL' THEN 1 WHEN 'SPOUSE' THEN (p.spouse_id IS NOT NULL)::int WHEN 'CHILD' THEN v_children WHEN 'PARENT' THEN v_parents END::numeric,
         CASE
           WHEN t.section = 'INCOME' THEN (SELECT jsonb_build_object('by_type', inc.by_type, 'wht', inc.wht, 'shared_amount', inc.shared_amount) FROM inc WHERE inc.code = t.code)
           WHEN t.code IN ('LIFE_INS','PENSION_INS','HEALTH_INS','PARENT_HEALTH_INS') THEN
             (SELECT jsonb_build_object('items', jsonb_agg(ins.item ORDER BY ins.item->>'date')) FROM ins WHERE ins.code = t.code)
           WHEN t.code = 'HOME_LOAN_INT' THEN (SELECT jsonb_build_object('items', jsonb_agg(home.item ORDER BY home.item->>'date')) FROM home)
           WHEN t.section = 'DONATION' THEN
             (SELECT jsonb_build_object('items', jsonb_agg(don.item ORDER BY don.item->>'date'),
                                        'pending', count(*) FILTER (WHERE don.tax_status = 'PENDING'),
                                        'pending_amount', sum(don.amount) FILTER (WHERE don.tax_status = 'PENDING'))
                FROM don WHERE don.code = t.code)
           WHEN t.code = 'WHT' THEN (SELECT jsonb_build_object('review_wht', inc.wht) FROM inc WHERE inc.code = 'REVIEW')
         END
    FROM tpl t
   ORDER BY t.sort_order;
END $$;
REVOKE ALL ON FUNCTION public.tax_system_lines(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tax_system_lines(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------- 7) รายการติดตามเมื่อผู้เอาประกันเสียชีวิต: บำนาญ = เคลมสินไหมมรณกรรม (ที่เหลือเหมือนเดิม)
CREATE OR REPLACE FUNCTION private.tg_person_deceased_followups() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- กลับจาก Archived → ปิดรายการที่ยังไม่เริ่ม
  IF OLD.status = 'DECEASED' AND NEW.status IS DISTINCT FROM 'DECEASED' THEN
    UPDATE public.insurance_followups SET status = 'NOT_APPLICABLE', auto_closed = true
     WHERE person_id = NEW.id AND status = 'OPEN' AND deleted_at IS NULL;
  END IF;

  IF NEW.status = 'DECEASED' AND OLD.status IS DISTINCT FROM 'DECEASED' AND NEW.deleted_at IS NULL THEN
    -- เคยถูกระบบปิดไว้ → เปิดกลับ
    UPDATE public.insurance_followups SET status = 'OPEN', auto_closed = false
     WHERE person_id = NEW.id AND auto_closed AND deleted_at IS NULL;
    INSERT INTO public.insurance_followups(person_id, policy_id, role, action)
    SELECT NEW.id, p.id, 'INSURED',
           CASE WHEN p.insurance_type IN ('LIFE','ANNUITY','ACCIDENT') THEN 'ยื่นเคลมสินไหมมรณกรรม ติดตามจนได้รับเงิน'
                ELSE 'แจ้งบริษัทประกัน ยกเลิกกรมธรรม์ / ขอคืนเบี้ยส่วนที่เหลือ' END
      FROM public.insurance_policies p
     WHERE p.person_id = NEW.id AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
    ON CONFLICT DO NOTHING;
    INSERT INTO public.insurance_followups(person_id, policy_id, role, action)
    SELECT NEW.id, p.id, 'PAYER', 'ตัดสินใจ: เวนคืนกรมธรรม์ หรือ ให้สมาชิกคนอื่นจ่ายเบี้ยต่อ (เปลี่ยนผู้จ่ายเบี้ย)'
      FROM public.insurance_policies p
     WHERE p.payer_person_id = NEW.id AND p.person_id IS DISTINCT FROM NEW.id AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
    ON CONFLICT DO NOTHING;
    INSERT INTO public.insurance_followups(person_id, policy_id, role, action)
    SELECT DISTINCT NEW.id, b.policy_id, 'BENEFICIARY', 'เปลี่ยนผู้รับผลประโยชน์ (แจ้งบริษัทประกัน + แก้ในระบบ)'
      FROM public.insurance_beneficiaries b JOIN public.insurance_policies p ON p.id = b.policy_id
     WHERE b.person_id = NEW.id AND b.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
       AND p.person_id IS DISTINCT FROM NEW.id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION private.tg_person_deceased_followups() FROM PUBLIC, anon, authenticated;
