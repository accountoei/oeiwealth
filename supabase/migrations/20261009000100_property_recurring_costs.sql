-- =====================================================================
-- ค่าใช้จ่ายประจำของอสังหาฯ (สาธารณูปโภค · ค่าส่วนกลาง · ภาษีที่ดิน)
--   1) property_utilities: เพิ่มประเภท COMMON_FEE / LAND_TAX + ยอดประมาณ / ความถี่ / วันครบกำหนด
--   2) expense_items: ผูกค่าใช้จ่ายจริงกับรายการด้านบน (property_utility_id + cost_period)
--   3) add_expense(): รับ 2 ช่องใหม่ (เติม related_asset_id ให้เองจากรายการ)
--   4) v_property_cost_tracking: ประมาณ vs จ่ายจริง รายงวด (เหมือน v_lease_rent_tracking ฝั่งรายได้)
-- รันซ้ำได้ (IF NOT EXISTS / CREATE OR REPLACE)
-- =====================================================================

-- ---------------------------------------------------------------- 1) property_utilities
ALTER TABLE public.property_utilities DROP CONSTRAINT IF EXISTS property_utilities_utility_type_check;
ALTER TABLE public.property_utilities ADD CONSTRAINT property_utilities_utility_type_check
  CHECK (utility_type IN ('ELECTRICITY','WATER','COMMON_FEE','LAND_TAX','OTHER'));

ALTER TABLE public.property_utilities
  ADD COLUMN IF NOT EXISTS expected_amount public.d_money,
  ADD COLUMN IF NOT EXISTS currency        public.d_currency NOT NULL DEFAULT 'THB',
  ADD COLUMN IF NOT EXISTS frequency       text,
  ADD COLUMN IF NOT EXISTS due_day         smallint,
  ADD COLUMN IF NOT EXISTS due_month       smallint,
  ADD COLUMN IF NOT EXISTS active          boolean NOT NULL DEFAULT true;

ALTER TABLE public.property_utilities DROP CONSTRAINT IF EXISTS pu_expected_amount_check;
ALTER TABLE public.property_utilities ADD CONSTRAINT pu_expected_amount_check
  CHECK (expected_amount IS NULL OR expected_amount >= 0);
ALTER TABLE public.property_utilities DROP CONSTRAINT IF EXISTS pu_frequency_check;
ALTER TABLE public.property_utilities ADD CONSTRAINT pu_frequency_check
  CHECK (frequency IS NULL OR frequency IN ('MONTHLY','QUARTERLY','YEARLY'));
ALTER TABLE public.property_utilities DROP CONSTRAINT IF EXISTS pu_due_day_check;
ALTER TABLE public.property_utilities ADD CONSTRAINT pu_due_day_check
  CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31);
ALTER TABLE public.property_utilities DROP CONSTRAINT IF EXISTS pu_due_month_check;
ALTER TABLE public.property_utilities ADD CONSTRAINT pu_due_month_check
  CHECK (due_month IS NULL OR due_month BETWEEN 1 AND 12);
-- ยอดประมาณกับความถี่ต้องมาคู่กัน (มีทั้งคู่ = ติดตามประมาณ vs จ่ายจริง · ไม่มีทั้งคู่ = เก็บแค่ข้อมูลมิเตอร์)
ALTER TABLE public.property_utilities DROP CONSTRAINT IF EXISTS pu_schedule_pair;
ALTER TABLE public.property_utilities ADD CONSTRAINT pu_schedule_pair
  CHECK ((expected_amount IS NULL) = (frequency IS NULL));

-- ---------------------------------------------------------------- 2) expense_items
ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS property_utility_id uuid REFERENCES public.property_utilities(id),
  ADD COLUMN IF NOT EXISTS cost_period         public.d_month;
ALTER TABLE public.expense_items DROP CONSTRAINT IF EXISTS exp_cost_period_pair;
ALTER TABLE public.expense_items ADD CONSTRAINT exp_cost_period_pair
  CHECK ((property_utility_id IS NULL) = (cost_period IS NULL));
CREATE INDEX IF NOT EXISTS expense_items_property_utility_idx
  ON public.expense_items (property_utility_id, cost_period) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------- 3) add_expense (signature เดิม)
CREATE OR REPLACE FUNCTION public.add_expense(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_date date := nullif(p->>'date', '')::date; v_id uuid; v_ccy text; v_bank uuid; v_card uuid;
        v_util uuid := nullif(p->>'property_utility_id', '')::uuid; v_period date; v_related uuid;
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
              expected_reimbursement_amount, notes, property_utility_id, cost_period)
  VALUES (private.expense_month_id(v_date), v_related, v_bank, v_card,
          CASE WHEN v_bank IS NULL AND v_card IS NULL THEN nullif(p->>'person_id', '')::uuid END,
          v_date, trim(p->>'description'), (p->>'amount')::numeric, v_ccy, nullif(trim(p->>'expense_category'), ''),
          coalesce((p->>'is_reimbursable')::boolean, false),
          CASE WHEN coalesce((p->>'is_reimbursable')::boolean, false)
               THEN coalesce(nullif(p->>'expected_reimbursement_amount', '')::numeric, (p->>'amount')::numeric) END,
          nullif(trim(p->>'notes'), ''), v_util, v_period)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.add_expense(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_expense(jsonb) TO authenticated;

-- ---------------------------------------------------------------- 4) ประมาณ vs จ่ายจริง
-- งวด: ตั้งแต่ max(เดือน Go-live, เดือนที่เพิ่มรายการ) ถึงเดือนปัจจุบัน · รายไตรมาส / รายปี นับจาก due_month
-- สถานะ: PAID (มีรายการจ่ายในงวดนั้น) · PENDING (ยังไม่ถึงกำหนด) · OVERDUE (เลยกำหนดแล้วยังไม่จ่าย)
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
            WHEN p.due_date >= current_date THEN 'PENDING'
            ELSE 'OVERDUE' END AS status
  FROM periods p
  LEFT JOIN LATERAL (
    SELECT sum(e.amount) AS paid_amount, count(*) AS paid_count, max(e.date) AS last_paid_date
      FROM public.expense_items e
     WHERE e.deleted_at IS NULL AND e.property_utility_id = p.utility_id AND e.cost_period = p.cost_period
  ) x ON true;

GRANT SELECT ON public.v_property_cost_tracking TO authenticated;
