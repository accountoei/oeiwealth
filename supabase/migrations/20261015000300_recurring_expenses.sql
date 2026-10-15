-- =====================================================================
-- ค่าใช้จ่ายประจำทั่วไป (ไม่ผูกทรัพย์สิน) — แบบเดียวกับรายได้ประจำ
--   1) recurring_expense_templates: ชื่อ · หมวด · ของใคร · ยอด · ความถี่ · วันที่จ่าย · จ่ายจาก (บัญชี / บัตร / เงินสด) · เริ่ม / สิ้นสุด
--   2) expense_items.recurring_expense_id (+ cost_period เดิม) ผูกรายการจ่ายจริงกับงวด
--   3) expected_expense_dismissals: "เดือนนี้ไม่ได้จ่าย" (ทั้งค่าใช้จ่ายประจำทั่วไป และของทรัพย์สิน)
--   4) add_expense(): รับ recurring_expense_id (หมวดตั้งต้นจากรายการประจำ)
--   5) v_recurring_expense_tracking (ใหม่) · v_property_cost_tracking เพิ่มสถานะ DISMISSED
--   ระบบไม่สร้างค่าใช้จ่ายเอง — ผู้ใช้กด "บันทึกจ่าย" ด้วยยอดจริง
-- รันซ้ำได้
-- =====================================================================

-- ---------------------------------------------------------------- 1) recurring_expense_templates
CREATE TABLE IF NOT EXISTS public.recurring_expense_templates (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id                uuid NOT NULL REFERENCES public.families(id),
  name                     text NOT NULL CHECK (length(trim(name)) > 0),
  expense_category         text NOT NULL CHECK (length(trim(expense_category)) > 0),
  person_id                uuid REFERENCES public.persons(id),
  expected_amount          public.d_money NOT NULL CHECK (expected_amount >= 0),
  currency                 public.d_currency NOT NULL DEFAULT 'THB',
  frequency                text NOT NULL DEFAULT 'MONTHLY' CHECK (frequency IN ('MONTHLY','QUARTERLY','YEARLY')),
  due_day                  smallint CHECK (due_day BETWEEN 1 AND 31),
  pay_via                  text NOT NULL DEFAULT 'BANK' CHECK (pay_via IN ('BANK','CARD','CASH')),
  pay_from_asset_id        uuid REFERENCES public.assets(id),
  pay_from_credit_card_id  uuid REFERENCES public.credit_cards(id),
  start_date               date NOT NULL,
  end_date                 date,
  active                   boolean NOT NULL DEFAULT true,
  notes                    text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id),
  CONSTRAINT rexp_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT rexp_pay_from CHECK (
    (pay_via = 'BANK' AND pay_from_credit_card_id IS NULL) OR
    (pay_via = 'CARD' AND pay_from_credit_card_id IS NOT NULL AND pay_from_asset_id IS NULL) OR
    (pay_via = 'CASH' AND pay_from_asset_id IS NULL AND pay_from_credit_card_id IS NULL))
);

DROP TRIGGER IF EXISTS t10_meta ON public.recurring_expense_templates;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.recurring_expense_templates FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.recurring_expense_templates;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.recurring_expense_templates FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.recurring_expense_templates;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.recurring_expense_templates FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

-- ---------------------------------------------------------------- 3) เดือนนี้ไม่ได้จ่าย
CREATE TABLE IF NOT EXISTS public.expected_expense_dismissals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type  text NOT NULL CHECK (source_type IN ('RECURRING','PROPERTY')),
  source_id    uuid NOT NULL,
  cost_period  public.d_month NOT NULL,
  reason       text NOT NULL CHECK (length(trim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS expected_expense_dismissals_uq
  ON public.expected_expense_dismissals(source_type, source_id, cost_period) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS t10_meta ON public.expected_expense_dismissals;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.expected_expense_dismissals FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.expected_expense_dismissals;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.expected_expense_dismissals FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.expected_expense_dismissals;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.expected_expense_dismissals FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

-- RLS มาตรฐาน (เหมือน 20261004001600_rls_grants.sql)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recurring_expense_templates', 'expected_expense_dismissals'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
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

-- ---------------------------------------------------------------- 2) expense_items
ALTER TABLE public.expense_items ADD COLUMN IF NOT EXISTS recurring_expense_id uuid REFERENCES public.recurring_expense_templates(id);
ALTER TABLE public.expense_items DROP CONSTRAINT IF EXISTS exp_cost_period_pair;
ALTER TABLE public.expense_items ADD CONSTRAINT exp_cost_period_pair
  CHECK ((cost_period IS NOT NULL) = (property_utility_id IS NOT NULL OR recurring_expense_id IS NOT NULL));
ALTER TABLE public.expense_items DROP CONSTRAINT IF EXISTS exp_one_schedule;
ALTER TABLE public.expense_items ADD CONSTRAINT exp_one_schedule
  CHECK (NOT (property_utility_id IS NOT NULL AND recurring_expense_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS expense_items_recurring_idx
  ON public.expense_items (recurring_expense_id, cost_period) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------- 4) add_expense (signature เดิม · เพิ่ม recurring_expense_id)
CREATE OR REPLACE FUNCTION public.add_expense(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_date date := nullif(p->>'date', '')::date; v_id uuid; v_ccy text; v_bank uuid; v_card uuid;
        v_util uuid := nullif(p->>'property_utility_id', '')::uuid; v_period date; v_related uuid;
        v_ins uuid := nullif(p->>'insurance_schedule_line_id', '')::uuid; v_cat text := nullif(trim(p->>'expense_category'), '');
        v_rexp uuid := nullif(p->>'recurring_expense_id', '')::uuid; v_rcat text;
BEGIN
  IF v_date IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่วันที่' USING ERRCODE = '22023'; END IF;
  IF v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่เป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p->>'description', ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่รายละเอียด' USING ERRCODE = '22023';
  END IF;
  IF (v_util IS NOT NULL)::int + (v_ins IS NOT NULL)::int + (v_rexp IS NOT NULL)::int > 1 THEN
    RAISE EXCEPTION 'INVALID: ผูกได้ทีละอย่าง (ค่าใช้จ่ายประจำ หรือ เบี้ยประกัน)' USING ERRCODE = '22023';
  END IF;
  v_bank := nullif(p->>'paid_from_asset_id', '')::uuid;
  v_card := nullif(p->>'paid_from_credit_card_id', '')::uuid;
  v_ccy := upper(coalesce(nullif(p->>'currency', ''), 'THB'));
  IF v_bank IS NOT NULL THEN SELECT currency INTO v_ccy FROM public.assets WHERE id = v_bank; END IF;
  IF v_card IS NOT NULL THEN SELECT currency INTO v_ccy FROM public.credit_cards WHERE id = v_card; END IF;
  v_related := nullif(p->>'related_asset_id', '')::uuid;

  -- เบี้ยประกันตามตาราง: ต้องเป็นงวดเบี้ย (PREMIUM) ของกรมธรรม์ที่ยังไม่ถูกลบ · หมวดตั้งต้น "ประกัน"
  IF v_ins IS NOT NULL THEN
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

  -- ค่าใช้จ่ายประจำทั่วไป: ต้องระบุงวด · หมวดตั้งต้นจากรายการประจำ
  IF v_rexp IS NOT NULL THEN
    v_period := date_trunc('month', coalesce(nullif(p->>'cost_period', '')::date, v_date))::date;
    SELECT t.expense_category INTO v_rcat FROM public.recurring_expense_templates t WHERE t.id = v_rexp AND t.deleted_at IS NULL;
    IF v_rcat IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการค่าใช้จ่ายประจำ' USING ERRCODE = '22023'; END IF;
    v_cat := coalesce(v_cat, v_rcat);
  END IF;

  INSERT INTO public.expense_items(monthly_expense_id, related_asset_id, paid_from_asset_id, paid_from_credit_card_id,
              person_id, date, description, amount, currency, expense_category, is_reimbursable,
              expected_reimbursement_amount, notes, property_utility_id, cost_period, insurance_schedule_line_id, recurring_expense_id)
  VALUES (private.expense_month_id(v_date), v_related, v_bank, v_card,
          nullif(p->>'person_id', '')::uuid,   -- ระบุคนเองได้เสมอ (ใช้ก่อนเจ้าของบัญชี / บัตร)
          v_date, trim(p->>'description'), (p->>'amount')::numeric, v_ccy, v_cat,
          coalesce((p->>'is_reimbursable')::boolean, false),
          CASE WHEN coalesce((p->>'is_reimbursable')::boolean, false)
               THEN coalesce(nullif(p->>'expected_reimbursement_amount', '')::numeric, (p->>'amount')::numeric) END,
          nullif(trim(p->>'notes'), ''), v_util, v_period, v_ins, v_rexp)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.add_expense(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_expense(jsonb) TO authenticated;

-- ---------------------------------------------------------------- 5a) ค่าใช้จ่ายประจำทั่วไป: ประมาณ vs จ่ายจริง รายงวด
-- งวด: ตั้งแต่เดือนที่เริ่ม (ไม่ก่อน Go-live) ถึงเดือนปัจจุบัน / เดือนสิ้นสุด · ราย 3 เดือน / รายปี นับจากเดือนที่เริ่ม
-- สถานะ: PAID · DISMISSED (เดือนนี้ไม่ได้จ่าย) · PENDING (ยังไม่ถึงกำหนด) · OVERDUE (เลยกำหนดแล้วยังไม่จ่าย)
CREATE OR REPLACE VIEW public.v_recurring_expense_tracking WITH (security_invoker = true) AS
WITH fam AS (
  SELECT f.id, date_trunc('month', f.go_live_date)::date AS go_live_month
    FROM public.families f WHERE f.deleted_at IS NULL
), src AS (
  SELECT t.id, t.family_id, t.name, t.expense_category, t.person_id, t.expected_amount, t.currency, t.frequency,
         t.pay_via, t.pay_from_asset_id, t.pay_from_credit_card_id, t.start_date, coalesce(t.end_date, 'infinity'::date) AS end_date,
         CASE t.frequency WHEN 'MONTHLY' THEN 1 WHEN 'QUARTERLY' THEN 3 WHEN 'YEARLY' THEN 12 END AS step,
         coalesce(t.due_day, extract(day FROM t.start_date)::int) AS due_day
    FROM public.recurring_expense_templates t
   WHERE t.deleted_at IS NULL AND t.active
), periods AS (
  SELECT s.*, g::date AS cost_period,
         make_date(extract(year FROM g)::int, extract(month FROM g)::int,
                   least(s.due_day, extract(day FROM (g + interval '1 month' - interval '1 day'))::int)) AS due_date
    FROM src s JOIN fam ON fam.id = s.family_id
   CROSS JOIN LATERAL generate_series(date_trunc('month', s.start_date),
                                      least(date_trunc('month', s.end_date), date_trunc('month', current_date)),
                                      make_interval(months => s.step)) g
   WHERE g >= fam.go_live_month
)
SELECT p.id AS template_id, p.family_id, p.name, p.expense_category, p.person_id, p.pay_via, p.pay_from_asset_id,
       p.pay_from_credit_card_id, p.frequency, p.cost_period, p.due_date, p.expected_amount, p.currency,
       coalesce(x.paid_amount, 0) AS paid_amount, coalesce(x.paid_count, 0) AS paid_count, x.last_paid_date,
       d.id AS dismissal_id, d.reason AS dismissal_reason,
       CASE WHEN coalesce(x.paid_count, 0) > 0 THEN 'PAID'
            WHEN d.id IS NOT NULL THEN 'DISMISSED'
            WHEN p.due_date >= current_date THEN 'PENDING'
            ELSE 'OVERDUE' END AS status
  FROM periods p
  LEFT JOIN LATERAL (
    SELECT sum(e.amount) AS paid_amount, count(*) AS paid_count, max(e.date) AS last_paid_date
      FROM public.expense_items e
     WHERE e.deleted_at IS NULL AND e.recurring_expense_id = p.id AND e.cost_period = p.cost_period
  ) x ON true
  LEFT JOIN public.expected_expense_dismissals d
    ON d.source_type = 'RECURRING' AND d.source_id = p.id AND d.cost_period = p.cost_period AND d.deleted_at IS NULL;

REVOKE ALL ON public.v_recurring_expense_tracking FROM PUBLIC, anon;
GRANT SELECT ON public.v_recurring_expense_tracking TO authenticated;

-- ---------------------------------------------------------------- 5b) ค่าใช้จ่ายประจำของทรัพย์สิน: เพิ่ม "เดือนนี้ไม่ได้จ่าย"
-- (เหมือนเดิมทุกอย่าง + สถานะ DISMISSED + คอลัมน์ dismissal_id / dismissal_reason ต่อท้าย)
CREATE OR REPLACE VIEW public.v_property_cost_tracking WITH (security_invoker = true) AS
WITH fam AS (
  SELECT f.id, date_trunc('month', f.go_live_date)::date AS go_live_month
    FROM public.families f WHERE f.deleted_at IS NULL
), src AS (
  SELECT u.id AS utility_id, a.id AS property_asset_id, a.family_id, a.name AS property_name,
         u.utility_type, u.provider, u.expected_amount, u.currency, u.frequency, u.due_day, u.due_month,
         CASE u.frequency WHEN 'MONTHLY' THEN 1 WHEN 'QUARTERLY' THEN 3 WHEN 'YEARLY' THEN 12 END AS step,
         date_trunc('month', (u.created_at AT TIME ZONE 'Asia/Bangkok'))::date AS created_month
    FROM public.property_utilities u
    JOIN public.property_details pd ON pd.id = u.property_id
    JOIN public.assets a ON a.id = pd.asset_id
   WHERE u.deleted_at IS NULL AND pd.deleted_at IS NULL AND a.deleted_at IS NULL
     AND a.status = 'ACTIVE' AND u.active AND u.frequency IS NOT NULL
), periods AS (
  SELECT s.*, g::date AS cost_period,
         make_date(extract(year FROM g)::int, extract(month FROM g)::int,
                   least(coalesce(s.due_day, 31), extract(day FROM (g + interval '1 month' - interval '1 day'))::int)) AS due_date
    FROM src s
    JOIN fam ON fam.id = s.family_id
   CROSS JOIN LATERAL generate_series(
           make_date(extract(year FROM fam.go_live_month)::int - 1,
                     coalesce(s.due_month, extract(month FROM fam.go_live_month)::int), 1)::timestamp,
           date_trunc('month', current_date)::timestamp,
           make_interval(months => s.step)) g
   WHERE g::date >= greatest(fam.go_live_month, s.created_month)
)
SELECT p.utility_id, p.property_asset_id, p.family_id, p.property_name, p.utility_type, p.provider,
       p.frequency, p.cost_period, p.due_date, p.expected_amount, p.currency,
       coalesce(x.paid_amount, 0) AS paid_amount,
       p.expected_amount - coalesce(x.paid_amount, 0) AS gap,
       coalesce(x.paid_count, 0) AS paid_count,
       x.last_paid_date,
       CASE WHEN coalesce(x.paid_count, 0) > 0 THEN 'PAID'
            WHEN d.id IS NOT NULL THEN 'DISMISSED'
            WHEN p.due_date >= current_date THEN 'PENDING'
            ELSE 'OVERDUE' END AS status,
       d.id AS dismissal_id, d.reason AS dismissal_reason
  FROM periods p
  LEFT JOIN LATERAL (
    SELECT sum(e.amount) AS paid_amount, count(*) AS paid_count, max(e.date) AS last_paid_date
      FROM public.expense_items e
     WHERE e.deleted_at IS NULL AND e.property_utility_id = p.utility_id AND e.cost_period = p.cost_period
  ) x ON true
  LEFT JOIN public.expected_expense_dismissals d
    ON d.source_type = 'PROPERTY' AND d.source_id = p.utility_id AND d.cost_period = p.cost_period AND d.deleted_at IS NULL;

GRANT SELECT ON public.v_property_cost_tracking TO authenticated;
