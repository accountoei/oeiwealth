-- =====================================================================
-- 0450 Protection, Family & Lifestyle
-- Section 26 Insurance, 27 Health, 28 Credit Cards, 29 Membership,
--         30 Points & Miles
-- (สร้างก่อน Income/Expense เพราะ expense_items / cash_movements อ้าง credit_cards
--  และ expense_reimbursements อ้าง insurance_claims)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 26. Insurance
-- ---------------------------------------------------------------------
CREATE TABLE public.insurance_policies (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id                uuid NOT NULL REFERENCES public.families(id),
  insurance_type           text NOT NULL CHECK (insurance_type IN ('PROPERTY','LIFE','HEALTH','ACCIDENT')),
  person_id                uuid REFERENCES public.persons(id),     -- ผู้เอาประกัน
  asset_id                 uuid REFERENCES public.assets(id),      -- ทรัพย์สินที่เอาประกัน
  insurer                  text NOT NULL,
  policy_no                text,
  start_date               date,
  end_date                 date,
  insured_amount           public.d_money,
  insured_amount_currency  public.d_currency,
  premium                  public.d_money,
  premium_currency         public.d_currency,
  has_cash_value           boolean NOT NULL DEFAULT false,
  cash_value_asset_id      uuid UNIQUE REFERENCES public.assets(id),
  status                   text NOT NULL DEFAULT 'ACTIVE'
                           CHECK (status IN ('ACTIVE','LAPSED','SURRENDERED','MATURED','CLAIMED','CANCELLED')),
  notes                    text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (cash_value_asset_id IS NULL OR has_cash_value),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CHECK (insured_amount IS NULL OR insured_amount_currency IS NOT NULL),
  CHECK (premium IS NULL OR premium_currency IS NOT NULL)
);

CREATE TABLE public.insurance_beneficiaries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id         uuid NOT NULL REFERENCES public.insurance_policies(id),
  person_id         uuid REFERENCES public.persons(id),
  beneficiary_name  text,
  percentage        public.d_pct NOT NULL CHECK (percentage > 0),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (num_nonnulls(person_id, nullif(trim(beneficiary_name), '')) = 1)
);

CREATE TABLE public.insurance_claims (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id        uuid NOT NULL REFERENCES public.insurance_policies(id),
  incident_date    date,
  claim_date       date,
  claimed_amount   public.d_money CHECK (claimed_amount IS NULL OR claimed_amount >= 0),
  currency         public.d_currency NOT NULL DEFAULT 'THB',
  received_amount  public.d_money,   -- Cache = SUM(expense_reimbursements) เมื่อมีการผูก
  status           text NOT NULL DEFAULT 'SUBMITTED'
                   CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','PARTIALLY_PAID','PAID','REJECTED','CANCELLED')),
  notes            text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);

-- ---------------------------------------------------------------------
-- 27. Health
-- ---------------------------------------------------------------------
CREATE TABLE public.health_checkups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id     uuid NOT NULL REFERENCES public.persons(id),
  checkup_date  date NOT NULL,
  hospital      text,
  package_name  text,
  cost          public.d_money,
  currency      public.d_currency DEFAULT 'THB',
  notes         text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);

CREATE TABLE public.health_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkup_id      uuid NOT NULL REFERENCES public.health_checkups(id),
  metric          text NOT NULL CHECK (metric ~ '^[A-Z][A-Z0-9_]*$'),  -- LDL, HBA1C, SYSTOLIC_BP ...
  value_numeric   numeric(20,6),
  value_text      text,
  unit            text,
  reference_min   numeric(20,6),
  reference_max   numeric(20,6),
  reference_text  text,
  abnormal_flag   text CHECK (abnormal_flag IN ('H','L','ABNORMAL')),
  notes           text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (value_numeric IS NOT NULL OR value_text IS NOT NULL),
  CHECK (metric <> 'BLOOD_PRESSURE')   -- ต้องแยก SYSTOLIC_BP / DIASTOLIC_BP
);

-- ---------------------------------------------------------------------
-- 28. Credit Cards  (ไม่เก็บเลขบัตรเต็ม / CVV)
-- ---------------------------------------------------------------------
CREATE TABLE public.credit_cards (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id            uuid NOT NULL REFERENCES public.persons(id),
  issuer               text NOT NULL,
  card_name            text,
  card_last4           text CHECK (card_last4 ~ '^[0-9]{4}$'),
  credit_limit         public.d_money,
  currency             public.d_currency NOT NULL DEFAULT 'THB',
  statement_day        smallint CHECK (statement_day BETWEEN 1 AND 31),
  due_day              smallint CHECK (due_day BETWEEN 1 AND 31),
  annual_fee           public.d_money,
  annual_fee_currency  public.d_currency,
  expiry_date          date,
  outstanding_balance  public.d_money NOT NULL DEFAULT 0 CHECK (outstanding_balance >= 0),
  balance_date         date,
  status               text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED','SUSPENDED')),
  notes                text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (outstanding_balance = 0 OR balance_date IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- 29. Membership
-- ---------------------------------------------------------------------
CREATE TABLE public.memberships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id     uuid NOT NULL REFERENCES public.persons(id),
  program_name  text NOT NULL,
  member_id     text,
  tier          text,
  benefits      text,
  expiry_date   date,
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','CANCELLED')),
  notes         text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);

-- ---------------------------------------------------------------------
-- 30. Points & Miles  (ไม่รวม Net Worth)
-- ---------------------------------------------------------------------
CREATE TABLE public.points_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       uuid NOT NULL REFERENCES public.persons(id),
  program_name    text NOT NULL,
  membership_id   uuid REFERENCES public.memberships(id),
  credit_card_id  uuid REFERENCES public.credit_cards(id),
  balance         public.d_qty NOT NULL DEFAULT 0,
  balance_date    date,
  expiry_date     date,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (num_nonnulls(membership_id, credit_card_id) <= 1)
);

CREATE TABLE public.points_transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  points_account_id   uuid NOT NULL REFERENCES public.points_accounts(id),
  date                date NOT NULL,
  transaction_type    text NOT NULL CHECK (transaction_type IN
                      ('EARN','REDEEM','TRANSFER_IN','TRANSFER_OUT','EXPIRE','ADJUST')),
  points              public.d_qty NOT NULL,
  conversion_rate     numeric(20,10),
  related_account_id  uuid REFERENCES public.points_accounts(id),
  notes               text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (related_account_id IS NULL OR transaction_type IN ('TRANSFER_IN','TRANSFER_OUT')),
  CHECK (related_account_id IS DISTINCT FROM points_account_id)
);
