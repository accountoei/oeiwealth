-- =====================================================================
-- ภาษีเงินได้บุคคลธรรมดารายปี (Family → แท็บ Tax) · ส่วนที่ 1–4 + สถานะ / ประวัติการยื่น
--   tax_returns       : แบบภาษี 1 ฉบับ = ผู้เสียภาษี 1 คน × ปีภาษี 1 ปี × ฉบับที่ (version · ยื่นเพิ่มเติม = ฉบับใหม่)
--                       สถานะ DRAFT → REVIEWED → FILED · FILED แล้วเก็บยอดที่ยื่นจริงไว้ (filed_snapshot) แก้ไม่ได้
--   tax_return_lines  : รายการในแบบ (รายได้ ม.40 · ค่าใช้จ่าย · ค่าลดหย่อน · เงินบริจาค · เครดิตภาษี)
--                       system_amount = ยอดจากระบบ (ดึงใหม่ได้ ไม่ทับยอดที่แก้เอง) · filed_amount = ยอดใช้ยื่น (แก้ได้ + เหตุผล)
--   tax_system_lines  : ดึงยอดจากธุรกรรมเดิม (รายได้ · ภาษีหัก ณ ที่จ่าย · เบี้ยประกัน · ดอกเบี้ยบ้าน · บริจาค · ข้อมูลครอบครัว)
--                       ไม่สร้าง / ไม่แก้ธุรกรรมใด ๆ · ไม่กระทบ Net Worth / Month Closing
--   สิทธิ์: ADMIN เห็น / แก้ได้ทุกคน · บทบาทอื่นเห็นเฉพาะของตัวเอง (app_users.person_id) · VIEWER อ่านอย่างเดียว
--   การคำนวณภาษี (อัตรา / เพดานตามปีภาษี) อยู่ใน PR ถัดไป
-- รันซ้ำได้ · ไม่แก้ตาราง / ข้อมูลเดิม
-- =====================================================================

-- ---------------------------------------------------------------- สิทธิ์รายผู้เสียภาษี
CREATE OR REPLACE FUNCTION private.my_person_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.person_id FROM public.app_users u WHERE u.auth_user_id = auth.uid() AND u.status = 'ACTIVE'
$$;
CREATE OR REPLACE FUNCTION private.tax_can_read(p_person uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_role('ADMIN')
      OR (private.has_role('EDITOR','CONTRIBUTOR','VIEWER') AND p_person IS NOT NULL AND p_person = private.my_person_id())
$$;
CREATE OR REPLACE FUNCTION private.tax_can_write(p_person uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_role('ADMIN')
      OR (private.has_role('EDITOR','CONTRIBUTOR') AND p_person IS NOT NULL AND p_person = private.my_person_id())
$$;
REVOKE ALL ON FUNCTION private.my_person_id(), private.tax_can_read(uuid), private.tax_can_write(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.my_person_id(), private.tax_can_read(uuid), private.tax_can_write(uuid) TO authenticated;

-- ---------------------------------------------------------------- ตาราง
CREATE TABLE IF NOT EXISTS public.tax_returns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id          uuid NOT NULL REFERENCES public.persons(id),
  tax_year           integer NOT NULL CHECK (tax_year BETWEEN 2000 AND 2100),      -- ปีภาษี (ค.ศ.) · ไม่ใช่ปีที่ยื่น
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id      uuid REFERENCES public.tax_returns(id),                       -- ยื่นเพิ่มเติม: ฉบับก่อนหน้า
  form_type          text NOT NULL DEFAULT 'PND90' CHECK (form_type IN ('PND90','PND91','PND94')),
  status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEWED','FILED')),
  amend_reason       text,
  filed_date         date,
  reference_no       text,
  tax_result         public.d_money,                                               -- + ชำระเพิ่ม / − ขอคืน (ตามแบบที่ยื่น)
  settlement_status  text CHECK (settlement_status IN ('PAID','WAIT_REFUND','REFUNDED','NONE')),
  settled_date       date,
  filed_snapshot     jsonb,                                                        -- รายการตามที่ยื่นจริง (คงสภาพ)
  refreshed_at       timestamptz,
  notes              text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id),
  CONSTRAINT tr_filed CHECK (status <> 'FILED' OR filed_date IS NOT NULL),
  CONSTRAINT tr_amend CHECK ((version = 1) = (supersedes_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS tax_returns_uq ON public.tax_returns(person_id, tax_year, version) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.tax_return_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id      uuid NOT NULL REFERENCES public.tax_returns(id),
  section        text NOT NULL CHECK (section IN ('INCOME','EXPENSE','DEDUCTION','DONATION','CREDIT')),
  code           text NOT NULL,
  label          text NOT NULL,
  sort_order     integer NOT NULL DEFAULT 0,
  system_amount  numeric,                     -- ยอดจากระบบ (บาท) · null = ระบบไม่มีข้อมูล (กรอกเอง)
  qty            numeric,                     -- จำนวน (เช่น บุตร 2 คน) จากระบบ
  detail         jsonb,                       -- ที่มาของยอด (สำหรับกดดู)
  filed_amount   numeric,                     -- ยอดใช้ยื่น / ใช้สิทธิ (null = ยังไม่กรอก → ใช้ยอดจากระบบ)
  filed_qty      numeric,
  method         text CHECK (method IN ('FLAT','ACTUAL','NONE')),   -- วิธีหักค่าใช้จ่าย (ส่วนที่ 3)
  reason         text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS tax_return_lines_uq ON public.tax_return_lines(return_id, code) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------- กติกา
-- แบบที่ยื่นแล้ว (FILED): แก้ได้เฉพาะผลการชำระ / รับคืน และหมายเหตุ · ห้ามลบ (ยื่นเพิ่มเติม = ฉบับใหม่)
CREATE OR REPLACE FUNCTION private.tg_tax_return_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_keep text[] := ARRAY['settlement_status','settled_date','notes','updated_at','updated_by'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'INVALID: แบบภาษีใหม่ต้องเริ่มที่ฉบับร่าง' USING ERRCODE = '22023'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'FILED' AND (to_jsonb(NEW) - v_keep) IS DISTINCT FROM (to_jsonb(OLD) - v_keep) THEN
    RAISE EXCEPTION 'LOCKED: แบบที่ยื่นแล้วแก้ไม่ได้ (แก้ได้เฉพาะผลการชำระ / รับคืน) — ถ้าต้องแก้ให้ทำ "ยื่นเพิ่มเติม"' USING ERRCODE = '42501';
  END IF;
  IF NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.tax_year IS DISTINCT FROM OLD.tax_year OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'INVALID: เปลี่ยนผู้เสียภาษี / ปีภาษี / ฉบับที่ไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF NEW.status = 'FILED' AND OLD.status <> 'FILED' AND current_setting('fwv.tax_file', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'INVALID: บันทึกยื่นแบบผ่านปุ่ม "บันทึกว่ายื่นแล้ว" เท่านั้น' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.tg_tax_line_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.tax_returns WHERE id = NEW.return_id;
  IF v_status = 'FILED' THEN
    RAISE EXCEPTION 'LOCKED: แบบที่ยื่นแล้วแก้ไม่ได้ — ถ้าต้องแก้ให้ทำ "ยื่นเพิ่มเติม"' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.return_id, NEW.code, NEW.section) IS DISTINCT FROM (OLD.return_id, OLD.code, OLD.section) THEN
    RAISE EXCEPTION 'INVALID: เปลี่ยนรายการไม่ได้' USING ERRCODE = '22023';
  END IF;
  NEW.reason := nullif(trim(NEW.reason), '');
  -- ยอดใช้ยื่นต่างจากยอดระบบ → ต้องมีเหตุผล (ตรวจเฉพาะตอนผู้ใช้แก้ยอด / เหตุผล · ดึงยอดระบบใหม่ไม่ติด)
  IF NEW.filed_amount IS NOT NULL AND NEW.system_amount IS NOT NULL AND round(NEW.filed_amount, 2) <> round(NEW.system_amount, 2)
     AND NEW.reason IS NULL
     AND (TG_OP = 'INSERT' OR NEW.filed_amount IS DISTINCT FROM OLD.filed_amount OR NEW.reason IS DISTINCT FROM OLD.reason) THEN
    RAISE EXCEPTION 'INVALID: ยอดใช้ยื่น "%" ต่างจากยอดในระบบ — กรุณาใส่เหตุผล', NEW.label USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_tax_return_guard(), private.tg_tax_line_guard() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_returns','tax_return_lines'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS t10_meta ON public.%I', t);
    EXECUTE format('CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.tg_meta(''soft'')', t);
    EXECUTE format('DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS z90_audit ON public.%I', t);
    EXECUTE format('CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.tg_audit()', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated, service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS p_select ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS p_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS p_update ON public.%I', t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS t20_tax_guard ON public.tax_returns;
CREATE TRIGGER t20_tax_guard BEFORE INSERT OR UPDATE ON public.tax_returns FOR EACH ROW EXECUTE FUNCTION private.tg_tax_return_guard();
DROP TRIGGER IF EXISTS t20_tax_guard ON public.tax_return_lines;
CREATE TRIGGER t20_tax_guard BEFORE INSERT OR UPDATE ON public.tax_return_lines FOR EACH ROW EXECUTE FUNCTION private.tg_tax_line_guard();

CREATE POLICY p_select ON public.tax_returns FOR SELECT TO authenticated USING ((SELECT private.tax_can_read(person_id)));
CREATE POLICY p_insert ON public.tax_returns FOR INSERT TO authenticated WITH CHECK ((SELECT private.tax_can_write(person_id)));
CREATE POLICY p_update ON public.tax_returns FOR UPDATE TO authenticated
  USING ((SELECT private.tax_can_write(person_id))) WITH CHECK ((SELECT private.tax_can_write(person_id)));
CREATE POLICY p_select ON public.tax_return_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tax_returns r WHERE r.id = return_id AND private.tax_can_read(r.person_id)));
CREATE POLICY p_insert ON public.tax_return_lines FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.tax_returns r WHERE r.id = return_id AND private.tax_can_write(r.person_id)));
CREATE POLICY p_update ON public.tax_return_lines FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tax_returns r WHERE r.id = return_id AND private.tax_can_write(r.person_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tax_returns r WHERE r.id = return_id AND private.tax_can_write(r.person_id)));

-- ---------------------------------------------------------------- ยอดจากระบบ
-- รายการทั้งหมดของแบบ (section, code, label, sort) + ยอดจากระบบของผู้เสียภาษี / ปีภาษี (1 ม.ค. – 31 ธ.ค.)
--   รายได้: ตามประเภทรายได้ → ม.40 · Gross เป็นบาท · ภาษีหัก ณ ที่จ่ายแยก · รายการที่แบ่งตามสัดส่วนเจ้าของทรัพย์สิน (ไม่ได้ระบุคน) แจ้งไว้ให้ตรวจ
--   รายได้อื่น / ผลประโยชน์ประกัน / รายได้รอแยก → "รอตรวจสอบ" (ไม่รวมใน ม.40 อัตโนมัติ)
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
           WHEN t.code IN ('LIFE_INS','HEALTH_INS','PARENT_HEALTH_INS') THEN (SELECT sum(ins.amount) FROM ins WHERE ins.code = t.code)
           WHEN t.code = 'HOME_LOAN_INT' THEN (SELECT sum(home.amount) FROM home)
           WHEN t.section = 'DONATION' THEN (SELECT sum(don.amount) FROM don WHERE don.code = t.code AND don.tax_status = 'ELIGIBLE')
           WHEN t.code = 'WHT' THEN (SELECT sum(inc.wht) FROM inc WHERE inc.code <> 'REVIEW')
         END,
         CASE t.code WHEN 'PERSONAL' THEN 1 WHEN 'SPOUSE' THEN (p.spouse_id IS NOT NULL)::int WHEN 'CHILD' THEN v_children WHEN 'PARENT' THEN v_parents END::numeric,
         CASE
           WHEN t.section = 'INCOME' THEN (SELECT jsonb_build_object('by_type', inc.by_type, 'wht', inc.wht, 'shared_amount', inc.shared_amount) FROM inc WHERE inc.code = t.code)
           WHEN t.code IN ('LIFE_INS','HEALTH_INS','PARENT_HEALTH_INS') THEN
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

-- ---------------------------------------------------------------- คำสั่ง
-- ดึงยอดจากระบบใหม่ (ไม่ทับยอดใช้ยื่น / เหตุผลที่กรอกเอง) · แบบที่ยื่นแล้วดึงไม่ได้
CREATE OR REPLACE FUNCTION public.tax_refresh_return(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.tax_returns; s record;
BEGIN
  SELECT * INTO r FROM public.tax_returns WHERE id = p_id AND deleted_at IS NULL;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบแบบภาษี' USING ERRCODE = '22023'; END IF;
  IF NOT private.tax_can_write(r.person_id) THEN RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้ข้อมูลภาษีของคนนี้' USING ERRCODE = '42501'; END IF;
  IF r.status = 'FILED' THEN RAISE EXCEPTION 'LOCKED: แบบที่ยื่นแล้วดึงยอดใหม่ไม่ได้' USING ERRCODE = '42501'; END IF;
  FOR s IN SELECT * FROM public.tax_system_lines(r.person_id, r.tax_year) LOOP
    UPDATE public.tax_return_lines l
       SET system_amount = s.system_amount, qty = s.qty, detail = s.detail, label = s.label, sort_order = s.sort_order
     WHERE l.return_id = p_id AND l.code = s.code AND l.deleted_at IS NULL
       AND (l.system_amount, l.qty, l.detail, l.label, l.sort_order) IS DISTINCT FROM (s.system_amount, s.qty, s.detail, s.label, s.sort_order);
    IF NOT EXISTS (SELECT 1 FROM public.tax_return_lines l WHERE l.return_id = p_id AND l.code = s.code AND l.deleted_at IS NULL) THEN
      INSERT INTO public.tax_return_lines(return_id, section, code, label, sort_order, system_amount, qty, detail, method)
      VALUES (p_id, s.section, s.code, s.label, s.sort_order, s.system_amount, s.qty, s.detail,
              CASE WHEN s.code IN ('EXP_40_1_2','EXP_40_5','EXP_40_6_8') THEN 'FLAT' END);
    END IF;
  END LOOP;
  UPDATE public.tax_returns SET refreshed_at = now() WHERE id = p_id;
END $$;

-- สร้างแบบร่าง (ฉบับที่ 1) + ดึงยอดจากระบบ
CREATE OR REPLACE FUNCTION public.tax_create_return(p_person uuid, p_year integer, p_form text DEFAULT 'PND90')
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT private.tax_can_write(p_person) THEN RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้ข้อมูลภาษีของคนนี้' USING ERRCODE = '42501'; END IF;
  IF p_year > extract(year FROM current_date)::int THEN RAISE EXCEPTION 'INVALID: ปีภาษียังไม่เริ่ม' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.tax_returns WHERE person_id = p_person AND tax_year = p_year AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: มีแบบภาษีของปีนี้อยู่แล้ว' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.tax_returns(person_id, tax_year, form_type) VALUES (p_person, p_year, coalesce(p_form, 'PND90')) RETURNING id INTO v_id;
  PERFORM public.tax_refresh_return(v_id);
  RETURN v_id;
END $$;

-- เปลี่ยนสถานะ: DRAFT ↔ REVIEWED · → FILED (ต้องมีวันที่ยื่น · เก็บยอดที่ยื่นไว้คงสภาพ)
CREATE OR REPLACE FUNCTION public.tax_set_status(p_id uuid, p_status text, p_info jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.tax_returns; v_snap jsonb;
BEGIN
  SELECT * INTO r FROM public.tax_returns WHERE id = p_id AND deleted_at IS NULL;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบแบบภาษี' USING ERRCODE = '22023'; END IF;
  IF NOT private.tax_can_write(r.person_id) THEN RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้ข้อมูลภาษีของคนนี้' USING ERRCODE = '42501'; END IF;
  IF r.status = 'FILED' THEN RAISE EXCEPTION 'LOCKED: แบบที่ยื่นแล้วเปลี่ยนสถานะไม่ได้ — ถ้าต้องแก้ให้ทำ "ยื่นเพิ่มเติม"' USING ERRCODE = '42501'; END IF;
  IF p_status IN ('DRAFT','REVIEWED') THEN
    UPDATE public.tax_returns SET status = p_status WHERE id = p_id;
    RETURN;
  END IF;
  IF p_status <> 'FILED' THEN RAISE EXCEPTION 'INVALID: สถานะไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF nullif(p_info->>'filed_date', '') IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่วันที่ยื่น' USING ERRCODE = '22023'; END IF;
  IF (p_info->>'filed_date')::date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ยื่นเป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023'; END IF;
  SELECT jsonb_agg(jsonb_build_object('section', l.section, 'code', l.code, 'label', l.label, 'system_amount', l.system_amount, 'qty', l.qty,
                   'filed_amount', coalesce(l.filed_amount, l.system_amount), 'filed_qty', coalesce(l.filed_qty, l.qty), 'method', l.method, 'reason', l.reason)
                   ORDER BY l.sort_order)
    INTO v_snap FROM public.tax_return_lines l WHERE l.return_id = p_id AND l.deleted_at IS NULL;
  PERFORM set_config('fwv.tax_file', 'on', true);
  UPDATE public.tax_returns
     SET status = 'FILED', filed_date = (p_info->>'filed_date')::date, reference_no = nullif(trim(p_info->>'reference_no'), ''),
         tax_result = nullif(p_info->>'tax_result', '')::numeric, settlement_status = nullif(p_info->>'settlement_status', ''),
         settled_date = nullif(p_info->>'settled_date', '')::date, filed_snapshot = jsonb_build_object('filed_at', now(), 'lines', coalesce(v_snap, '[]'::jsonb))
   WHERE id = p_id;
  PERFORM set_config('fwv.tax_file', 'off', true);
END $$;

-- ยื่นเพิ่มเติม: ฉบับใหม่ (version + 1) คัดลอกยอดใช้ยื่นจากฉบับที่ยื่นแล้ว · ฉบับเดิมคงไว้
CREATE OR REPLACE FUNCTION public.tax_amend_return(p_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.tax_returns; v_id uuid;
BEGIN
  SELECT * INTO r FROM public.tax_returns WHERE id = p_id AND deleted_at IS NULL;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบแบบภาษี' USING ERRCODE = '22023'; END IF;
  IF NOT private.tax_can_write(r.person_id) THEN RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้ข้อมูลภาษีของคนนี้' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'FILED' THEN RAISE EXCEPTION 'INVALID: ยื่นเพิ่มเติมได้เฉพาะแบบที่ยื่นแล้ว' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.tax_returns WHERE person_id = r.person_id AND tax_year = r.tax_year AND version > r.version AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: มีฉบับยื่นเพิ่มเติมที่ใหม่กว่าอยู่แล้ว' USING ERRCODE = '22023';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่เหตุผลที่ยื่นเพิ่มเติม' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.tax_returns(person_id, tax_year, version, supersedes_id, form_type, amend_reason)
  VALUES (r.person_id, r.tax_year, r.version + 1, r.id, r.form_type, trim(p_reason)) RETURNING id INTO v_id;
  INSERT INTO public.tax_return_lines(return_id, section, code, label, sort_order, system_amount, qty, detail, filed_amount, filed_qty, method, reason)
  SELECT v_id, l.section, l.code, l.label, l.sort_order, l.system_amount, l.qty, l.detail, l.filed_amount, l.filed_qty, l.method, l.reason
    FROM public.tax_return_lines l WHERE l.return_id = r.id AND l.deleted_at IS NULL;
  RETURN v_id;
END $$;

-- ลบแบบร่าง (ยังไม่ยื่น) พร้อมรายการ
CREATE OR REPLACE FUNCTION public.tax_delete_return(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.tax_returns;
BEGIN
  SELECT * INTO r FROM public.tax_returns WHERE id = p_id AND deleted_at IS NULL;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบแบบภาษี' USING ERRCODE = '22023'; END IF;
  IF NOT private.tax_can_write(r.person_id) THEN RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้ข้อมูลภาษีของคนนี้' USING ERRCODE = '42501'; END IF;
  IF r.status = 'FILED' THEN RAISE EXCEPTION 'LOCKED: แบบที่ยื่นแล้วลบไม่ได้' USING ERRCODE = '42501'; END IF;
  UPDATE public.tax_return_lines SET deleted_at = now() WHERE return_id = p_id AND deleted_at IS NULL;
  UPDATE public.tax_returns SET deleted_at = now() WHERE id = p_id;
END $$;

REVOKE ALL ON FUNCTION public.tax_refresh_return(uuid), public.tax_create_return(uuid, integer, text), public.tax_set_status(uuid, text, jsonb),
  public.tax_amend_return(uuid, text), public.tax_delete_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tax_refresh_return(uuid), public.tax_create_return(uuid, integer, text), public.tax_set_status(uuid, text, jsonb),
  public.tax_amend_return(uuid, text), public.tax_delete_return(uuid) TO authenticated;
