-- =====================================================================
-- ประกัน (Insurance) — ชุดใหญ่
--   1) ผู้จ่ายเบี้ย (payer_person_id) — ว่าง = ผู้เอาประกันเป็นผู้จ่าย
--   2) ตารางเบี้ย (PREMIUM) / ตารางรับผลประโยชน์ (BENEFIT) ต่อกรมธรรม์: insurance_schedule_lines
--      · จ่ายเบี้ย = ค่าใช้จ่ายผูกงวด (add_expense รับ insurance_schedule_line_id · หมวด "ประกัน")
--      · สถานะงวด: v_insurance_schedule_status (ชำระแล้ว / บางส่วน / รอ / เลยกำหนด / ปิดแล้ว)
--      · set_insurance_schedule: ตั้ง / แทนงวดที่ยังไม่มีการชำระ (งวดที่ชำระแล้วเก็บไว้ · ห้ามแก้งวดที่ชำระครบ)
--   3) รับผลประโยชน์: receive_insurance_benefit — รายงวด หรือ ก้อนเดียว (ครบสัญญา / เวนคืน / สินไหม)
--      · มีมูลค่าเวนคืน: ถอนจากมูลค่าเวนคืนก่อน (ASSET_SALE + ลดมูลค่า) ส่วนที่เกิน = รายได้ "ผลประโยชน์ประกัน"
--      · ปิดกรมธรรม์: สถานะกรมธรรม์ + มูลค่าเวนคืนเป็น 0 / ปิดสินทรัพย์
--   4) ความคุ้มครอง: insurance_coverages (+ insurance_claims.coverage_id ใช้คำนวณวงเงินที่ใช้ไปในปี)
--   5) ติดตามหลังเสียชีวิต: insurance_followups — สร้างให้เองเมื่อเปลี่ยนสมาชิกเป็น "เสียชีวิต"
-- รันซ้ำได้ (IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS)
-- =====================================================================

-- ---------------------------------------------------------------- 1) ผู้จ่ายเบี้ย
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS payer_person_id uuid REFERENCES public.persons(id);
-- v_insurance_status ใช้ p.* (ขยายคอลัมน์ตอนสร้าง) → สร้างใหม่ให้มีคอลัมน์ผู้จ่ายเบี้ย
DROP VIEW IF EXISTS public.v_insurance_status;
CREATE VIEW public.v_insurance_status WITH (security_invoker = true) AS
  SELECT p.*,
         CASE WHEN p.end_date IS NULL THEN NULL
              WHEN p.end_date < current_date THEN 'EXPIRED'
              WHEN p.end_date <= current_date + 60 THEN 'EXPIRING_SOON' END AS derived_status
    FROM public.insurance_policies p WHERE p.deleted_at IS NULL;
REVOKE ALL ON public.v_insurance_status FROM PUBLIC, anon;
GRANT SELECT ON public.v_insurance_status TO authenticated;

-- ---------------------------------------------------------------- 3) ประเภทรายได้ "ผลประโยชน์ประกัน"
ALTER TABLE public.income_transactions DROP CONSTRAINT IF EXISTS income_transactions_income_type_check;
ALTER TABLE public.income_transactions ADD CONSTRAINT income_transactions_income_type_check CHECK (income_type IN
  ('SALARY','BONUS','INTEREST','DIVIDEND','COUPON','RENT','LOAN_INTEREST','BUSINESS_DIVIDEND','INSURANCE_BENEFIT','OTHER'));
ALTER TABLE public.recurring_income_templates DROP CONSTRAINT IF EXISTS recurring_income_templates_income_type_check;
ALTER TABLE public.recurring_income_templates ADD CONSTRAINT recurring_income_templates_income_type_check CHECK (income_type IN
  ('SALARY','BONUS','INTEREST','DIVIDEND','COUPON','RENT','LOAN_INTEREST','BUSINESS_DIVIDEND','INSURANCE_BENEFIT','OTHER'));

-- ---------------------------------------------------------------- ตารางใหม่ 3 ตาราง
CREATE TABLE IF NOT EXISTS public.insurance_schedule_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id       uuid NOT NULL REFERENCES public.insurance_policies(id),
  kind            text NOT NULL CHECK (kind IN ('PREMIUM','BENEFIT')),
  installment_no  integer NOT NULL CHECK (installment_no >= 1),
  due_date        date NOT NULL,
  amount          public.d_money NOT NULL CHECK (amount > 0),
  currency        public.d_currency NOT NULL DEFAULT 'THB',
  benefit_type    text CHECK (benefit_type IN ('CASH_BACK','ANNUITY','MATURITY','OTHER')),
  notes           text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id),
  CONSTRAINT isl_benefit_type CHECK ((kind = 'BENEFIT') OR benefit_type IS NULL)
);
CREATE INDEX IF NOT EXISTS insurance_schedule_lines_policy_idx
  ON public.insurance_schedule_lines (policy_id, kind, due_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.insurance_coverages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id      uuid NOT NULL REFERENCES public.insurance_policies(id),
  coverage_type  text NOT NULL CHECK (coverage_type IN ('LIFE','ACCIDENT_DEATH','DISABILITY','CRITICAL_ILLNESS',
                   'IPD_ANNUAL','IPD_PER_ADMIT','ROOM_PER_DAY','OPD_PER_VISIT','OPD_ANNUAL','HOSPITAL_CASH_PER_DAY','OTHER')),
  limit_amount   public.d_money NOT NULL CHECK (limit_amount >= 0),
  currency       public.d_currency NOT NULL DEFAULT 'THB',
  notes          text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE INDEX IF NOT EXISTS insurance_coverages_policy_idx ON public.insurance_coverages (policy_id) WHERE deleted_at IS NULL;
ALTER TABLE public.insurance_claims ADD COLUMN IF NOT EXISTS coverage_id uuid REFERENCES public.insurance_coverages(id);

CREATE TABLE IF NOT EXISTS public.insurance_followups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES public.persons(id),
  policy_id   uuid NOT NULL REFERENCES public.insurance_policies(id),
  role        text NOT NULL CHECK (role IN ('INSURED','PAYER','BENEFICIARY')),
  action      text NOT NULL,
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','DONE','NOT_APPLICABLE')),
  notes       text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS insurance_followups_uq
  ON public.insurance_followups (person_id, policy_id, role) WHERE deleted_at IS NULL;

-- ผูกรายการเงินกับงวด
ALTER TABLE public.expense_items      ADD COLUMN IF NOT EXISTS insurance_schedule_line_id uuid REFERENCES public.insurance_schedule_lines(id);
ALTER TABLE public.income_transactions ADD COLUMN IF NOT EXISTS insurance_schedule_line_id uuid REFERENCES public.insurance_schedule_lines(id);
CREATE INDEX IF NOT EXISTS expense_items_ins_line_idx ON public.expense_items (insurance_schedule_line_id)
  WHERE insurance_schedule_line_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS income_ins_line_idx ON public.income_transactions (insurance_schedule_line_id)
  WHERE insurance_schedule_line_id IS NOT NULL AND deleted_at IS NULL;

-- Generic triggers + RLS มาตรฐาน (เหมือน 20261004001000 / 20261004001600)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['insurance_schedule_lines','insurance_coverages','insurance_followups'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS t10_meta ON public.%I', t);
    EXECUTE format('CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.tg_meta(%L)', t, 'soft');
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
    EXECUTE format($p$CREATE POLICY p_select ON public.%I FOR SELECT TO authenticated
                      USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')))$p$, t);
    EXECUTE format($p$CREATE POLICY p_insert ON public.%I FOR INSERT TO authenticated
                      WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR')))$p$, t);
    EXECUTE format($p$CREATE POLICY p_update ON public.%I FOR UPDATE TO authenticated
                      USING ((SELECT private.has_role('ADMIN','EDITOR'))
                             OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
                                 AND created_at >= now() - interval '24 hours' AND deleted_at IS NULL))
                      WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR'))
                             OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
                                 AND deleted_at IS NULL))$p$, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- 2) สถานะงวด
CREATE OR REPLACE VIEW public.v_insurance_schedule_status WITH (security_invoker = true) AS
SELECT l.id, l.policy_id, l.kind, l.installment_no, l.due_date, l.amount, l.currency, l.benefit_type, l.notes,
       p.family_id, p.insurer, p.policy_no, p.insurance_type, p.person_id, coalesce(p.payer_person_id, p.person_id) AS payer_person_id,
       p.cash_value_asset_id, p.status AS policy_status,
       x.paid_amount, greatest(l.amount - x.paid_amount, 0) AS remaining,
       CASE WHEN x.paid_amount >= l.amount - 0.005 THEN 'PAID'
            WHEN p.status <> 'ACTIVE' THEN 'CLOSED'
            WHEN l.due_date < current_date THEN 'OVERDUE'
            WHEN x.paid_amount > 0 THEN 'PARTIAL'
            ELSE 'PENDING' END AS status
  FROM public.insurance_schedule_lines l
  JOIN public.insurance_policies p ON p.id = l.policy_id AND p.deleted_at IS NULL
  CROSS JOIN LATERAL (SELECT
      coalesce((SELECT sum(e.amount) FROM public.expense_items e
                 WHERE e.insurance_schedule_line_id = l.id AND e.deleted_at IS NULL), 0)
    + coalesce((SELECT sum(i.amount) FROM public.income_transactions i
                 WHERE i.insurance_schedule_line_id = l.id AND i.deleted_at IS NULL), 0)
    + coalesce((SELECT sum(m.amount) FROM public.cash_movements m
                 WHERE m.movement_type = 'ASSET_SALE' AND m.deleted_at IS NULL
                   AND m.metadata ->> 'insurance_schedule_line_id' = l.id::text), 0) AS paid_amount) x
 WHERE l.deleted_at IS NULL;
REVOKE ALL ON public.v_insurance_schedule_status FROM PUBLIC, anon;
GRANT SELECT ON public.v_insurance_schedule_status TO authenticated;

-- งวด: ต้องผูกกรมธรรม์ · ย้ายไปกรมธรรม์อื่น / เปลี่ยนชนิดไม่ได้ · งวดที่ชำระครบแล้วแก้ / ลบไม่ได้
CREATE OR REPLACE FUNCTION private.tg_insurance_schedule_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.policy_id IS DISTINCT FROM OLD.policy_id OR NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION 'IMMUTABLE: ย้ายงวดไปกรมธรรม์อื่น / เปลี่ยนชนิดงวดไม่ได้' USING ERRCODE = '42501';
    END IF;
    IF OLD.deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.v_insurance_schedule_status s WHERE s.id = OLD.id AND s.status = 'PAID') THEN
      RAISE EXCEPTION 'LOCKED: งวดที่ชำระ / รับครบแล้วแก้ไข / ลบไม่ได้ — ถ้าบันทึกผิด ให้แก้ / ลบรายการเงินแทน' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.insurance_policies p WHERE p.id = NEW.policy_id AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t50_insurance_schedule_check ON public.insurance_schedule_lines;
CREATE TRIGGER t50_insurance_schedule_check BEFORE INSERT OR UPDATE ON public.insurance_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_insurance_schedule_check();
REVOKE EXECUTE ON FUNCTION private.tg_insurance_schedule_check() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 2) ตั้ง / แทนงวดที่ยังไม่มีการชำระ
-- p_lines: [{ "due_date": "2026-11-05", "amount": 25000, "benefit_type": "CASH_BACK", "notes": "…" }, …]
DROP FUNCTION IF EXISTS public.set_insurance_schedule(uuid, text, jsonb);
CREATE FUNCTION public.set_insurance_schedule(p_policy_id uuid, p_kind text, p_lines jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ccy text; v_kept_max date; v_next integer; v_first date; v_count integer;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF p_kind NOT IN ('PREMIUM','BENEFIT') THEN RAISE EXCEPTION 'INVALID: ชนิดตารางไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(p.premium_currency, p.insured_amount_currency, 'THB') INTO v_ccy
    FROM public.insurance_policies p WHERE p.id = p_policy_id AND p.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'INVALID: ตารางต้องมีอย่างน้อย 1 งวด' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) > 600 THEN RAISE EXCEPTION 'INVALID: ตารางยาวเกิน 600 งวด' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
              WHERE nullif(x->>'due_date', '') IS NULL OR coalesce(nullif(x->>'amount', '')::numeric, 0) <= 0
                 OR (p_kind = 'BENEFIT' AND coalesce(nullif(x->>'benefit_type', ''), 'OTHER') NOT IN ('CASH_BACK','ANNUITY','MATURITY','OTHER'))) THEN
    RAISE EXCEPTION 'INVALID: ทุกงวดต้องมีวันที่ และยอดมากกว่า 0' USING ERRCODE = '22023';
  END IF;

  -- งวดที่ยังไม่มีการชำระ → แทนที่ · งวดที่มีการชำระแล้ว (ครบ / บางส่วน) เก็บไว้
  UPDATE public.insurance_schedule_lines l SET deleted_at = now()
   WHERE l.policy_id = p_policy_id AND l.kind = p_kind AND l.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.v_insurance_schedule_status s WHERE s.id = l.id AND s.paid_amount = 0);

  SELECT max(due_date), coalesce(max(installment_no), 0) + 1 INTO v_kept_max, v_next
    FROM public.insurance_schedule_lines WHERE policy_id = p_policy_id AND kind = p_kind AND deleted_at IS NULL;
  SELECT min((x->>'due_date')::date) INTO v_first FROM jsonb_array_elements(p_lines) x;
  IF v_kept_max IS NOT NULL AND v_first <= v_kept_max THEN
    RAISE EXCEPTION 'INVALID: งวดแรกต้องอยู่หลังงวดที่มีการชำระแล้ว (%)', to_char(v_kept_max, 'DD/MM/YYYY') USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.insurance_schedule_lines(policy_id, kind, installment_no, due_date, amount, currency, benefit_type, notes)
  SELECT p_policy_id, p_kind, v_next - 1 + row_number() OVER (ORDER BY (x->>'due_date')::date, ord),
         (x->>'due_date')::date, round((x->>'amount')::numeric, 2), v_ccy,
         CASE WHEN p_kind = 'BENEFIT' THEN coalesce(nullif(x->>'benefit_type', ''), 'OTHER') END,
         nullif(trim(x->>'notes'), '')
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(x, ord);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.set_insurance_schedule(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_insurance_schedule(uuid, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------- 2) จ่ายเบี้ย: add_expense รับ insurance_schedule_line_id (signature เดิม)
CREATE OR REPLACE FUNCTION public.add_expense(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_date date := nullif(p->>'date', '')::date; v_id uuid; v_ccy text; v_bank uuid; v_card uuid;
        v_util uuid := nullif(p->>'property_utility_id', '')::uuid; v_period date; v_related uuid;
        v_ins uuid := nullif(p->>'insurance_schedule_line_id', '')::uuid; v_cat text := nullif(trim(p->>'expense_category'), '');
BEGIN
  IF v_date IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่วันที่' USING ERRCODE = '22023'; END IF;
  IF v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่เป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p->>'description', ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่รายละเอียด' USING ERRCODE = '22023';
  END IF;
  v_bank := nullif(p->>'paid_from_asset_id', '')::uuid;
  v_card := nullif(p->>'paid_from_credit_card_id', '')::uuid;
  v_ccy := upper(coalesce(nullif(p->>'currency', ''), 'THB'));
  IF v_bank IS NOT NULL THEN SELECT currency INTO v_ccy FROM public.assets WHERE id = v_bank; END IF;
  IF v_card IS NOT NULL THEN SELECT currency INTO v_ccy FROM public.credit_cards WHERE id = v_card; END IF;
  v_related := nullif(p->>'related_asset_id', '')::uuid;

  -- เบี้ยประกันตามตาราง: ต้องเป็นงวดเบี้ย (PREMIUM) ของกรมธรรม์ที่ยังไม่ถูกลบ · หมวดตั้งต้น "ประกัน"
  IF v_ins IS NOT NULL THEN
    IF v_util IS NOT NULL THEN RAISE EXCEPTION 'INVALID: ผูกได้ทีละอย่าง (ค่าใช้จ่ายประจำ หรือ เบี้ยประกัน)' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.insurance_schedule_lines l JOIN public.insurance_policies ip ON ip.id = l.policy_id
                    WHERE l.id = v_ins AND l.kind = 'PREMIUM' AND l.deleted_at IS NULL AND ip.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'NOT_FOUND: ไม่พบงวดเบี้ยประกัน' USING ERRCODE = '22023';
    END IF;
    v_cat := coalesce(v_cat, 'ประกัน');
  END IF;

  -- ค่าใช้จ่ายประจำของอสังหาฯ: ต้องระบุงวด · ผูกทรัพย์สินให้เองถ้าไม่ได้ส่งมา
  IF v_util IS NOT NULL THEN
    v_period := date_trunc('month', coalesce(nullif(p->>'cost_period', '')::date, v_date))::date;
    SELECT pd.asset_id INTO v_related
      FROM public.property_utilities u JOIN public.property_details pd ON pd.id = u.property_id
     WHERE u.id = v_util AND u.deleted_at IS NULL;
    IF v_related IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการค่าใช้จ่ายประจำ' USING ERRCODE = '22023'; END IF;
  END IF;

  INSERT INTO public.expense_items(monthly_expense_id, related_asset_id, paid_from_asset_id, paid_from_credit_card_id,
              person_id, date, description, amount, currency, expense_category, is_reimbursable,
              expected_reimbursement_amount, notes, property_utility_id, cost_period, insurance_schedule_line_id)
  VALUES (private.expense_month_id(v_date), v_related, v_bank, v_card,
          CASE WHEN v_bank IS NULL AND v_card IS NULL THEN nullif(p->>'person_id', '')::uuid END,
          v_date, trim(p->>'description'), (p->>'amount')::numeric, v_ccy, v_cat,
          coalesce((p->>'is_reimbursable')::boolean, false),
          CASE WHEN coalesce((p->>'is_reimbursable')::boolean, false)
               THEN coalesce(nullif(p->>'expected_reimbursement_amount', '')::numeric, (p->>'amount')::numeric) END,
          nullif(trim(p->>'notes'), ''), v_util, v_period, v_ins)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.add_expense(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_expense(jsonb) TO authenticated;

-- ---------------------------------------------------------------- 3) รับผลประโยชน์
-- p: { policy_id, line_id?, date, amount, bank_asset_id, use_cash_value (ตั้งต้น true), outcome? (MATURED | SURRENDERED | CLAIMED),
--      person_id? (ผู้รับ — ตั้งต้น: เจ้าของมูลค่าเวนคืน / ผู้จ่ายเบี้ย), notes? }
DROP FUNCTION IF EXISTS public.receive_insurance_benefit(jsonb);
CREATE FUNCTION public.receive_insurance_benefit(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  pol public.insurance_policies; v_line uuid := nullif(p->>'line_id', '')::uuid;
  v_date date := nullif(p->>'date', '')::date; v_amount numeric := nullif(p->>'amount', '')::numeric;
  v_bank uuid := nullif(p->>'bank_asset_id', '')::uuid; v_use_cv boolean := coalesce((p->>'use_cash_value')::boolean, true);
  v_outcome text := nullif(p->>'outcome', ''); v_person uuid := nullif(p->>'person_id', '')::uuid;
  v_notes text := nullif(trim(p->>'notes'), ''); v_ccy text; v_cv_ccy text; v_cv_val numeric := 0; v_part numeric := 0;
  v_income numeric; v_label text;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF v_outcome IS NOT NULL THEN PERFORM private.require_role('ADMIN','EDITOR'); END IF;
  SELECT * INTO pol FROM public.insurance_policies WHERE id = (p->>'policy_id')::uuid AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023'; END IF;
  IF v_outcome IS NOT NULL AND v_outcome NOT IN ('MATURED','SURRENDERED','CLAIMED') THEN
    RAISE EXCEPTION 'INVALID: ผลของการรับไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF v_line IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.insurance_schedule_lines
                                         WHERE id = v_line AND policy_id = pol.id AND kind = 'BENEFIT' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: งวดผลประโยชน์ไม่ตรงกับกรมธรรม์' USING ERRCODE = '22023';
  END IF;
  IF v_date IS NULL OR v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่รับไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดที่ได้รับ' USING ERRCODE = '22023'; END IF;
  IF v_bank IS NULL OR NOT private.is_bank_asset(v_bank) THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่รับเงิน' USING ERRCODE = '22023'; END IF;
  SELECT currency INTO v_ccy FROM public.assets WHERE id = v_bank;
  v_label := 'ผลประโยชน์ประกัน · ' || pol.insurer || coalesce(' ' || pol.policy_no, '');

  -- มีมูลค่าเวนคืน: ถอนจากมูลค่าเวนคืนก่อน
  IF pol.cash_value_asset_id IS NOT NULL THEN
    SELECT currency INTO v_cv_ccy FROM public.assets WHERE id = pol.cash_value_asset_id;
    v_cv_val := greatest(coalesce((private.latest_asset_valuation(pol.cash_value_asset_id, v_date)).value, 0), 0);
    IF v_use_cv AND v_cv_val > 0 THEN
      IF v_cv_ccy <> v_ccy THEN
        RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีที่รับต้องสกุลเดียวกับมูลค่าเวนคืน (%)', v_cv_ccy USING ERRCODE = '22023';
      END IF;
      v_part := least(v_amount, v_cv_val);
      INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_asset_id, amount, currency,
                                        description, notes, metadata)
      VALUES (pol.family_id, v_date, 'ASSET_SALE', pol.cash_value_asset_id, v_bank, v_part, v_ccy, v_label || ' (จากมูลค่าเวนคืน)', v_notes,
              jsonb_build_object('policy_id', pol.id, 'insurance_schedule_line_id', v_line));
      INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
      VALUES (pol.cash_value_asset_id, v_date, v_cv_val - v_part, 'LATEST_TRANSACTION', 'USER', 'รับผลประโยชน์ประกัน (ถอนจากมูลค่าเวนคืน)');
    END IF;
  END IF;

  -- ส่วนที่เกินมูลค่าเวนคืน = รายได้
  v_income := v_amount - v_part;
  IF v_income > 0 THEN
    INSERT INTO public.income_transactions(family_id, asset_id, person_id, received_to_asset_id, date, income_type, amount, currency,
                                           notes, insurance_schedule_line_id)
    VALUES (pol.family_id,
            CASE WHEN v_person IS NULL THEN pol.cash_value_asset_id END,
            CASE WHEN v_person IS NOT NULL OR pol.cash_value_asset_id IS NULL
                 THEN coalesce(v_person, pol.payer_person_id, pol.person_id) END,
            v_bank, v_date, 'INSURANCE_BENEFIT', v_income, v_ccy, concat_ws(' · ', v_label, v_notes), v_line);
  END IF;

  -- ปิดกรมธรรม์: สถานะ + มูลค่าเวนคืนที่เหลือเป็น 0 + ปิดสินทรัพย์
  IF v_outcome IS NOT NULL THEN
    UPDATE public.insurance_policies SET status = v_outcome WHERE id = pol.id;
    IF pol.cash_value_asset_id IS NOT NULL THEN
      IF v_cv_val - v_part > 0.005 OR NOT v_use_cv THEN
        INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
        VALUES (pol.cash_value_asset_id, v_date, 0, 'LATEST_TRANSACTION', 'USER', 'ปิดกรมธรรม์');
      END IF;
      UPDATE public.assets SET status = 'CLOSED' WHERE id = pol.cash_value_asset_id AND status = 'ACTIVE';
    END IF;
  END IF;
  RETURN jsonb_build_object('cash_value_part', v_part, 'income_part', greatest(v_income, 0));
END $$;
REVOKE ALL ON FUNCTION public.receive_insurance_benefit(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_insurance_benefit(jsonb) TO authenticated;

-- ---------------------------------------------------------------- 5) ติดตามหลังเสียชีวิต
-- เปลี่ยนสมาชิกเป็น "เสียชีวิต" → สร้างรายการติดตามตามบทบาทในกรมธรรม์ที่ยังมีผล (ซ้ำไม่ได้)
CREATE OR REPLACE FUNCTION private.tg_person_deceased_followups() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'DECEASED' AND OLD.status IS DISTINCT FROM 'DECEASED' AND NEW.deleted_at IS NULL THEN
    INSERT INTO public.insurance_followups(person_id, policy_id, role, action)
    SELECT NEW.id, p.id, 'INSURED',
           CASE WHEN p.insurance_type IN ('LIFE','ACCIDENT') THEN 'ยื่นเคลมสินไหมมรณกรรม ติดตามจนได้รับเงิน'
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
DROP TRIGGER IF EXISTS a60_deceased_followups ON public.persons;
CREATE TRIGGER a60_deceased_followups AFTER UPDATE OF status ON public.persons
  FOR EACH ROW EXECUTE FUNCTION private.tg_person_deceased_followups();
REVOKE EXECUTE ON FUNCTION private.tg_person_deceased_followups() FROM PUBLIC, anon, authenticated;
