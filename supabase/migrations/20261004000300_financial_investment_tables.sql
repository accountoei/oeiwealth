-- =====================================================================
-- 0300 Financial Assets + Investments
-- Section 10, 11–15, 18, 19, 20
-- =====================================================================

-- ---------------------------------------------------------------------
-- 10. bank_accounts
-- ---------------------------------------------------------------------
CREATE TABLE public.bank_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          uuid NOT NULL UNIQUE REFERENCES public.assets(id),
  bank_name         text NOT NULL,
  account_no_last4  text CHECK (account_no_last4 ~ '^[0-9]{4}$'),  -- เขียนผ่าน set_bank_account_no() เท่านั้น
  account_name      text,
  account_type      text NOT NULL DEFAULT 'SAVING'
                    CHECK (account_type IN ('SAVING','FIXED','FOREIGN_CURRENCY','OTHER')),
  interest_rate     public.d_rate,
  maturity_date     date,
  branch            text,
  notes             text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);

-- Client ไม่มีสิทธิ์ใด ๆ บนตารางนี้ (ไม่มี RLS Policy + REVOKE ใน 1500)
CREATE TABLE public.bank_account_secrets (
  bank_account_id       uuid PRIMARY KEY REFERENCES public.bank_accounts(id),
  account_no_encrypted  bytea NOT NULL,     -- pgp_sym_encrypt ด้วย Key จาก Supabase Vault
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);

-- ---------------------------------------------------------------------
-- 11. investment_portfolios
-- ---------------------------------------------------------------------
CREATE TABLE public.investment_portfolios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        uuid NOT NULL UNIQUE REFERENCES public.assets(id),
  institution     text NOT NULL,
  portfolio_type  text NOT NULL DEFAULT 'BROKERAGE'
                  CHECK (portfolio_type IN ('PRIVATE_FUND','BROKERAGE','OTHER')),
  start_date      date,
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
  notes           text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);

-- ---------------------------------------------------------------------
-- 12. investment_holdings
-- ---------------------------------------------------------------------
CREATE TABLE public.investment_holdings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id        uuid NOT NULL REFERENCES public.investment_portfolios(id),
  holding_type        text NOT NULL CHECK (holding_type IN
                      ('CASH','EQUITY','BOND','FUND','FCN','STRUCTURED_PRODUCT','OTHER')),
  name                text NOT NULL,
  symbol              text,
  currency            public.d_currency NOT NULL,
  quantity            public.d_qty NOT NULL DEFAULT 0,  -- Cache จาก Transactions
  average_cost        public.d_price,                   -- Cache (Average Cost)
  current_price       public.d_price,                   -- Cache
  current_value       public.d_money,                   -- Cache (ใน holding currency)
  current_value_date  date,                             -- Cache
  maturity_date       date,
  status              text NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','SOLD','MATURED','AUTOCALLED')),
  notes               text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);
CREATE INDEX investment_holdings_portfolio_idx ON public.investment_holdings(portfolio_id);

-- ---------------------------------------------------------------------
-- 13. investment_transactions
-- ---------------------------------------------------------------------
CREATE TABLE public.investment_transactions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id          uuid NOT NULL REFERENCES public.investment_portfolios(id),
  holding_id            uuid REFERENCES public.investment_holdings(id),
  transaction_date      date NOT NULL,
  settlement_date       date,
  transaction_type      text NOT NULL CHECK (transaction_type IN (
                          'OPENING_BALANCE','DEPOSIT','WITHDRAWAL','BUY','SELL','DIVIDEND',
                          'INTEREST','COUPON','FEE','TAX','MATURITY','REDEMPTION',
                          'FX_EXCHANGE','ADJUSTMENT')),
  quantity              public.d_qty  CHECK (quantity IS NULL OR quantity >= 0),
  price                 public.d_price CHECK (price IS NULL OR price >= 0),
  amount                public.d_money NOT NULL CHECK (amount >= 0),   -- Gross, ค่าบวกเสมอ
  currency              public.d_currency NOT NULL,
  counter_amount        public.d_money CHECK (counter_amount IS NULL OR counter_amount > 0),
  counter_currency      public.d_currency,
  direction             text CHECK (direction IN ('IN','OUT')),
  settle_from_asset_id  uuid REFERENCES public.assets(id),
  settle_to_asset_id    uuid REFERENCES public.assets(id),
  cash_movement_id      uuid,               -- FK เพิ่มหลังสร้าง cash_movements (0500)
  fee                   public.d_money CHECK (fee IS NULL OR fee >= 0),
  tax                   public.d_money CHECK (tax IS NULL OR tax >= 0),
  actual_fx_rate        public.d_fx,
  cost_base_currency    public.d_money,     -- THB
  amount_base_currency  public.d_money,     -- THB (Trigger เติมให้ถ้าไม่ระบุ)
  notes                 text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,

  CONSTRAINT itx_settlement_after_trade
    CHECK (settlement_date IS NULL OR settlement_date >= transaction_date),
  CONSTRAINT itx_one_settlement_side
    CHECK (num_nonnulls(settle_from_asset_id, settle_to_asset_id) <= 1),
  CONSTRAINT itx_settle_from_buy_only
    CHECK (settle_from_asset_id IS NULL OR transaction_type = 'BUY'),
  CONSTRAINT itx_settle_to_types
    CHECK (settle_to_asset_id IS NULL OR transaction_type IN
           ('SELL','REDEMPTION','MATURITY','DIVIDEND','INTEREST','COUPON')),
  CONSTRAINT itx_buy_sell_required
    CHECK (transaction_type NOT IN ('BUY','SELL')
           OR (holding_id IS NOT NULL AND quantity IS NOT NULL AND price IS NOT NULL)),
  CONSTRAINT itx_redemption_maturity_required
    CHECK (transaction_type NOT IN ('REDEMPTION','MATURITY') OR holding_id IS NOT NULL),
  CONSTRAINT itx_opening_required
    CHECK (transaction_type <> 'OPENING_BALANCE' OR (
           holding_id IS NOT NULL AND quantity IS NOT NULL AND price IS NOT NULL
           AND (cost_base_currency IS NOT NULL OR actual_fx_rate IS NOT NULL OR currency = 'THB'))),
  CONSTRAINT itx_fx_required
    CHECK ((transaction_type = 'FX_EXCHANGE')
           = (counter_amount IS NOT NULL AND counter_currency IS NOT NULL)
           AND (transaction_type <> 'FX_EXCHANGE' OR actual_fx_rate IS NOT NULL OR
                (currency <> 'THB' AND counter_currency <> 'THB'))),
  CONSTRAINT itx_adjustment_required
    CHECK ((transaction_type = 'ADJUSTMENT') = (direction IS NOT NULL)
           AND (transaction_type <> 'ADJUSTMENT' OR length(trim(coalesce(notes,''))) > 0)),
  CONSTRAINT itx_cash_movement_types
    CHECK (cash_movement_id IS NULL OR transaction_type IN ('DEPOSIT','WITHDRAWAL','FEE'))
);
CREATE INDEX itx_portfolio_date_idx ON public.investment_transactions(portfolio_id, transaction_date);
CREATE INDEX itx_holding_date_idx   ON public.investment_transactions(holding_id, transaction_date);
-- Derived จาก Cash Movement: 1 Movement → DEPOSIT/WITHDRAWAL ได้ 1 + FEE ได้ 1 (Idempotent)
CREATE UNIQUE INDEX itx_cash_movement_uq
  ON public.investment_transactions(cash_movement_id, transaction_type)
  WHERE cash_movement_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 15. investment_valuations
-- ---------------------------------------------------------------------
CREATE TABLE public.investment_valuations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holding_id      uuid NOT NULL REFERENCES public.investment_holdings(id),
  valuation_date  date NOT NULL,
  price           public.d_price CHECK (price IS NULL OR price >= 0),
  quantity        public.d_qty NOT NULL CHECK (quantity >= 0),
  market_value    public.d_money NOT NULL,          -- ใน holding currency
  fx_rate_id      uuid REFERENCES public.fx_rates(id),  -- Trigger ตั้ง (NULL = THB)
  base_value      public.d_money,                   -- THB (Trigger คำนวณ)
  source          text NOT NULL DEFAULT 'STATEMENT' CHECK (source IN ('STATEMENT','USER','MARKET')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);
CREATE INDEX investment_valuations_holding_date_idx
  ON public.investment_valuations(holding_id, valuation_date DESC);

-- ---------------------------------------------------------------------
-- 18. FCN
-- ---------------------------------------------------------------------
CREATE TABLE public.fcn_details (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holding_id             uuid NOT NULL UNIQUE REFERENCES public.investment_holdings(id),
  issuer                 text NOT NULL,
  principal              public.d_money NOT NULL,
  trade_date             date,
  issue_date             date,
  coupon_rate            public.d_rate,
  coupon_frequency       text CHECK (coupon_frequency IN ('MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL','AT_MATURITY','OTHER')),
  strike_level           public.d_rate,
  barrier_level          public.d_rate,
  autocall_level         public.d_rate,
  observation_frequency  text,
  knock_in_occurred      boolean,
  knock_in_date          date,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (knock_in_date IS NULL OR knock_in_occurred IS TRUE)
);

CREATE TABLE public.fcn_underlyings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fcn_id         uuid NOT NULL REFERENCES public.fcn_details(id),
  symbol         text NOT NULL,
  name           text,
  initial_price  public.d_price,
  strike_price   public.d_price,
  barrier_price  public.d_price,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);

-- ---------------------------------------------------------------------
-- 19. loan_details  (Loans Receivable)
-- ---------------------------------------------------------------------
CREATE TABLE public.loan_details (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id                       uuid NOT NULL UNIQUE REFERENCES public.assets(id),
  borrower_name                  text NOT NULL,
  principal                      public.d_money NOT NULL CHECK (principal >= 0),
  interest_rate                  public.d_rate,
  loan_date                      date,
  due_date                       date,
  opening_outstanding_principal  public.d_money NOT NULL DEFAULT 0 CHECK (opening_outstanding_principal >= 0),
  opening_date                   date NOT NULL,
  outstanding_principal          public.d_money,   -- Cache (Trigger)
  status                         text NOT NULL DEFAULT 'ACTIVE'
                                 CHECK (status IN ('ACTIVE','AT_RISK','CLOSED','WRITTEN_OFF')),
  notes                          text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);

-- ---------------------------------------------------------------------
-- 20. private_business_details
-- ---------------------------------------------------------------------
CREATE TABLE public.private_business_details (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id                   uuid NOT NULL UNIQUE REFERENCES public.assets(id),
  company_name               text NOT NULL,
  registration_no            text,
  business_type              text,
  total_shares               public.d_qty,
  shares_owned               public.d_qty,
  company_ownership_percent  public.d_pct,
  investment_cost            public.d_money,
  status                     text NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE','DORMANT','CLOSED','SOLD')),
  notes                      text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (shares_owned IS NULL OR total_shares IS NULL OR shares_owned <= total_shares)
);
