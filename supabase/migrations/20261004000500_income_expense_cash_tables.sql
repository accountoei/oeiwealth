-- =====================================================================
-- 0500 Income, Expenses, Cash Movements, Reconciliation, Recurring
-- Section 24, 25, 25A–25E
-- =====================================================================

-- ---------------------------------------------------------------------
-- 25E. recurring_income_templates (สร้างก่อนเพราะ income_transactions อ้าง)
-- ---------------------------------------------------------------------
CREATE TABLE public.recurring_income_templates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id            uuid NOT NULL REFERENCES public.families(id),
  person_id            uuid REFERENCES public.persons(id),
  name                 text NOT NULL,
  income_type          text NOT NULL CHECK (income_type IN
                       ('SALARY','BONUS','INTEREST','DIVIDEND','COUPON','RENT','LOAN_INTEREST','BUSINESS_DIVIDEND','OTHER')),
  expected_amount      public.d_money NOT NULL CHECK (expected_amount >= 0),
  currency             public.d_currency NOT NULL DEFAULT 'THB',
  frequency            text NOT NULL DEFAULT 'MONTHLY' CHECK (frequency IN ('MONTHLY','QUARTERLY','YEARLY')),
  due_day              smallint CHECK (due_day BETWEEN 1 AND 31),
  receive_to_asset_id  uuid REFERENCES public.assets(id),
  start_date           date NOT NULL,
  end_date             date,
  active               boolean NOT NULL DEFAULT true,
  notes                text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE public.expected_income_dismissals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type     text NOT NULL CHECK (source_type IN ('RECURRING','LEASE')),
  source_id       uuid NOT NULL,
  income_period   public.d_month NOT NULL,
  reason          text NOT NULL CHECK (length(trim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);
CREATE UNIQUE INDEX expected_income_dismissals_uq
  ON public.expected_income_dismissals(source_type, source_id, income_period)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- 25A. cash_movements
-- ---------------------------------------------------------------------
CREATE TABLE public.cash_movements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id           uuid NOT NULL REFERENCES public.families(id),
  movement_date       date NOT NULL,
  movement_type       text NOT NULL CHECK (movement_type IN (
                        'INCOME','EXPENSE','TRANSFER','FX_EXCHANGE','INVESTMENT_OUT','INVESTMENT_IN',
                        'LOAN_DISBURSEMENT','LOAN_PRINCIPAL_RECEIPT','ASSET_PURCHASE','ASSET_SALE',
                        'CARD_PAYMENT','LIABILITY_PAYMENT','SECURITY_DEPOSIT_IN','SECURITY_DEPOSIT_OUT',
                        'REIMBURSEMENT_IN','OTHER_IN','OTHER_OUT')),
  from_asset_id       uuid REFERENCES public.assets(id),
  to_asset_id         uuid REFERENCES public.assets(id),
  to_credit_card_id   uuid REFERENCES public.credit_cards(id),
  to_liability_id     uuid REFERENCES public.liabilities(id),
  related_lease_id    uuid REFERENCES public.property_leases(id),
  amount              public.d_money NOT NULL CHECK (amount > 0),
  currency            public.d_currency NOT NULL,
  counter_amount      public.d_money CHECK (counter_amount IS NULL OR counter_amount > 0),
  counter_currency    public.d_currency,
  actual_fx_rate      public.d_fx,
  fee                 public.d_money CHECK (fee IS NULL OR fee >= 0),
  fee_currency        public.d_currency,
  base_amount         public.d_money,          -- THB (Trigger)
  movement_group_id   uuid,
  source_entity_type  text CHECK (source_entity_type IN ('INCOME','EXPENSE','INVESTMENT_TX','REIMBURSEMENT')),
  source_entity_id    uuid,
  is_derived          boolean NOT NULL DEFAULT false,
  description         text,
  notes               text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- เช่น {"fee_as_expense": false}
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,

  CONSTRAINT cm_has_side        CHECK (num_nonnulls(from_asset_id, to_asset_id) >= 1),
  CONSTRAINT cm_not_same        CHECK (from_asset_id IS DISTINCT FROM to_asset_id),
  CONSTRAINT cm_derived_source  CHECK (is_derived = (source_entity_type IS NOT NULL AND source_entity_id IS NOT NULL)),
  -- Section 44A #1–2: รายได้ / ค่าใช้จ่าย / เงินคืน สร้างจาก Source Record เท่านั้น
  CONSTRAINT cm_source_only     CHECK (is_derived OR movement_type NOT IN ('INCOME','EXPENSE','REIMBURSEMENT_IN')),
  CONSTRAINT cm_fee_currency    CHECK ((coalesce(fee,0) = 0) OR fee_currency IS NOT NULL),
  CONSTRAINT cm_counter         CHECK ((movement_type = 'FX_EXCHANGE')
                                       = (counter_amount IS NOT NULL AND counter_currency IS NOT NULL)),
  CONSTRAINT cm_fx_diff_ccy     CHECK (movement_type <> 'FX_EXCHANGE' OR counter_currency <> currency),
  CONSTRAINT cm_card            CHECK ((movement_type = 'CARD_PAYMENT') = (to_credit_card_id IS NOT NULL)),
  CONSTRAINT cm_liability       CHECK ((movement_type = 'LIABILITY_PAYMENT') = (to_liability_id IS NOT NULL)),
  CONSTRAINT cm_lease           CHECK ((movement_type IN ('SECURITY_DEPOSIT_IN','SECURITY_DEPOSIT_OUT'))
                                       = (related_lease_id IS NOT NULL)),
  -- ทิศทางตามประเภท (Section 25A ตาราง Movement Types)
  CONSTRAINT cm_direction CHECK (CASE
    WHEN movement_type IN ('INCOME','OTHER_IN','REIMBURSEMENT_IN','SECURITY_DEPOSIT_IN')
      THEN from_asset_id IS NULL AND to_asset_id IS NOT NULL
    WHEN movement_type IN ('EXPENSE','OTHER_OUT','SECURITY_DEPOSIT_OUT','CARD_PAYMENT','LIABILITY_PAYMENT')
      THEN from_asset_id IS NOT NULL AND to_asset_id IS NULL
    ELSE from_asset_id IS NOT NULL AND to_asset_id IS NOT NULL END)
);
CREATE INDEX cm_from_date_idx ON public.cash_movements(from_asset_id, movement_date);
CREATE INDEX cm_to_date_idx   ON public.cash_movements(to_asset_id, movement_date);
CREATE INDEX cm_family_date_idx ON public.cash_movements(family_id, movement_date);
CREATE INDEX cm_group_idx ON public.cash_movements(movement_group_id) WHERE movement_group_id IS NOT NULL;
-- Idempotent Derived Movement: 1 Source = 1 Derived Movement (แถวเดิมถูก Soft Delete/Restore/Update)
CREATE UNIQUE INDEX cm_derived_source_uq
  ON public.cash_movements(source_entity_type, source_entity_id) WHERE is_derived;

ALTER TABLE public.investment_transactions
  ADD CONSTRAINT itx_cash_movement_fk FOREIGN KEY (cash_movement_id) REFERENCES public.cash_movements(id);

-- ---------------------------------------------------------------------
-- 24. income_transactions
-- ---------------------------------------------------------------------
CREATE TABLE public.income_transactions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id              uuid NOT NULL REFERENCES public.families(id),
  person_id              uuid REFERENCES public.persons(id),
  asset_id               uuid REFERENCES public.assets(id),
  source_transaction_id  uuid REFERENCES public.investment_transactions(id),
  lease_id               uuid REFERENCES public.property_leases(id),
  recurring_template_id  uuid REFERENCES public.recurring_income_templates(id),
  income_period          public.d_month,
  received_to_asset_id   uuid REFERENCES public.assets(id),
  date                   date NOT NULL,
  income_type            text NOT NULL CHECK (income_type IN
                         ('SALARY','BONUS','INTEREST','DIVIDEND','COUPON','RENT','LOAN_INTEREST','BUSINESS_DIVIDEND','OTHER')),
  amount                 public.d_money NOT NULL CHECK (amount >= 0),   -- Gross
  tax                    public.d_money CHECK (tax IS NULL OR (tax >= 0 AND tax <= amount)),
  currency               public.d_currency NOT NULL,
  base_amount            public.d_money,                                -- THB Gross (Trigger)
  notes                  text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,

  -- RENT ผูก Lease; ส่วนที่หักจากเงินประกันเป็น OTHER ผูก Lease ได้ (Section 22 Settle)
  CONSTRAINT inc_lease_type    CHECK (lease_id IS NULL OR income_type IN ('RENT','OTHER')),
  CONSTRAINT inc_derived_clean CHECK (source_transaction_id IS NULL OR (
                                 person_id IS NULL AND received_to_asset_id IS NULL
                                 AND lease_id IS NULL AND recurring_template_id IS NULL)),
  CONSTRAINT inc_one_expected  CHECK (num_nonnulls(lease_id, recurring_template_id) <= 1),
  CONSTRAINT inc_period_needs_source CHECK (income_period IS NULL
                                 OR lease_id IS NOT NULL OR recurring_template_id IS NOT NULL)
);
CREATE UNIQUE INDEX income_source_tx_uq ON public.income_transactions(source_transaction_id)
  WHERE source_transaction_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX income_family_date_idx ON public.income_transactions(family_id, date);
CREATE INDEX income_lease_idx ON public.income_transactions(lease_id, income_period) WHERE lease_id IS NOT NULL;
CREATE INDEX income_template_idx ON public.income_transactions(recurring_template_id, income_period)
  WHERE recurring_template_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 25. monthly_expenses / expense_items / expense_reimbursements
-- ---------------------------------------------------------------------
CREATE TABLE public.monthly_expenses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        uuid NOT NULL REFERENCES public.families(id),
  year_month       public.d_month NOT NULL,
  total_amount     public.d_money NOT NULL DEFAULT 0,   -- Derived THB (Trigger)
  currency         public.d_currency NOT NULL DEFAULT 'THB' CHECK (currency = 'THB'),
  tracking_status  text NOT NULL DEFAULT 'NOT_TRACKED'
                   CHECK (tracking_status IN ('NOT_TRACKED','PARTIAL','COMPLETE')),
  notes            text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);
CREATE UNIQUE INDEX monthly_expenses_uq ON public.monthly_expenses(family_id, year_month)
  WHERE deleted_at IS NULL;

CREATE TABLE public.expense_items (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_expense_id             uuid NOT NULL REFERENCES public.monthly_expenses(id),
  related_asset_id               uuid REFERENCES public.assets(id),
  paid_from_asset_id             uuid REFERENCES public.assets(id),
  paid_from_credit_card_id       uuid REFERENCES public.credit_cards(id),
  person_id                      uuid REFERENCES public.persons(id),
  date                           date NOT NULL,
  description                    text NOT NULL,
  amount                         public.d_money NOT NULL CHECK (amount > 0),
  currency                       public.d_currency NOT NULL DEFAULT 'THB',
  fx_rate_id                     uuid REFERENCES public.fx_rates(id),   -- Trigger
  base_amount                    public.d_money,                        -- Trigger (THB)
  expense_category               text,
  source_cash_movement_id        uuid REFERENCES public.cash_movements(id),
  is_reimbursable                boolean NOT NULL DEFAULT false,
  expected_reimbursement_amount  public.d_money CHECK (expected_reimbursement_amount IS NULL OR expected_reimbursement_amount >= 0),
  notes                          text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,

  CONSTRAINT exp_one_payment   CHECK (num_nonnulls(paid_from_asset_id, paid_from_credit_card_id) <= 1),
  CONSTRAINT exp_owner_source  CHECK (person_id IS NULL OR
                                      num_nonnulls(paid_from_asset_id, paid_from_credit_card_id) = 0),
  CONSTRAINT exp_reimb_amount  CHECK (expected_reimbursement_amount IS NULL OR is_reimbursable),
  CONSTRAINT exp_derived_clean CHECK (source_cash_movement_id IS NULL OR (
                                      paid_from_asset_id IS NULL AND paid_from_credit_card_id IS NULL
                                      AND person_id IS NULL AND expense_category = 'BANK_FEE'))
);
CREATE INDEX expense_items_month_idx ON public.expense_items(monthly_expense_id);
CREATE INDEX expense_items_date_idx  ON public.expense_items(date);
CREATE UNIQUE INDEX expense_items_source_cm_uq ON public.expense_items(source_cash_movement_id)
  WHERE source_cash_movement_id IS NOT NULL;

CREATE TABLE public.expense_reimbursements (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_item_id             uuid NOT NULL REFERENCES public.expense_items(id),
  insurance_claim_id          uuid REFERENCES public.insurance_claims(id),
  received_date               date NOT NULL,
  amount                      public.d_money NOT NULL CHECK (amount > 0),
  currency                    public.d_currency NOT NULL,
  received_to_asset_id        uuid REFERENCES public.assets(id),
  received_to_credit_card_id  uuid REFERENCES public.credit_cards(id),
  notes                       text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (num_nonnulls(received_to_asset_id, received_to_credit_card_id) <= 1)
);
CREATE INDEX expense_reimb_item_idx ON public.expense_reimbursements(expense_item_id);

-- ---------------------------------------------------------------------
-- 25D. bank_reconciliations  (1 บัญชี × 1 เดือน)
-- ---------------------------------------------------------------------
CREATE TABLE public.bank_reconciliations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_asset_id         uuid NOT NULL REFERENCES public.assets(id),
  year_month            public.d_month NOT NULL,
  currency              public.d_currency NOT NULL,
  opening_valuation_id  uuid REFERENCES public.asset_valuations(id),
  opening_balance       public.d_money NOT NULL DEFAULT 0,
  known_inflows         public.d_money NOT NULL DEFAULT 0,
  known_outflows        public.d_money NOT NULL DEFAULT 0,
  calculated_closing    public.d_money NOT NULL DEFAULT 0,
  actual_closing        public.d_money,
  actual_closing_date   date,
  difference            public.d_money,
  rounding_adjustment   public.d_money NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN','RECONCILED','CONFIRMED_WITH_DIFFERENCE')),
  difference_reason     text,
  closing_valuation_id  uuid REFERENCES public.asset_valuations(id),
  confirmed_at          timestamptz,
  confirmed_by          uuid,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,

  CHECK (calculated_closing = opening_balance + known_inflows - known_outflows),
  CHECK (abs(rounding_adjustment) <= 1),                       -- ไม่เกิน 1 หน่วยสกุลบัญชี
  CHECK (difference IS NULL OR difference = actual_closing - (calculated_closing + rounding_adjustment)),
  CHECK (status = 'OPEN' OR (actual_closing IS NOT NULL AND closing_valuation_id IS NOT NULL
                             AND confirmed_at IS NOT NULL)),
  CHECK (status <> 'RECONCILED' OR difference = 0),
  CHECK (status <> 'CONFIRMED_WITH_DIFFERENCE' OR length(trim(coalesce(difference_reason,''))) > 0)
);
CREATE UNIQUE INDEX bank_reconciliations_uq ON public.bank_reconciliations(bank_asset_id, year_month)
  WHERE deleted_at IS NULL;
