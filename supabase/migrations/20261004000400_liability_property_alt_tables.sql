-- =====================================================================
-- 0400 Liabilities, Property, Alternative Assets
-- Section 21, 22, 23
-- =====================================================================

-- ---------------------------------------------------------------------
-- 21. liabilities
-- ---------------------------------------------------------------------
CREATE TABLE public.liabilities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id           uuid NOT NULL REFERENCES public.families(id),
  liability_type      text NOT NULL CHECK (liability_type IN
                      ('MORTGAGE','CAR_LOAN','PERSONAL_LOAN','CREDIT_LINE','OTHER')),
  name                text NOT NULL,
  lender              text,
  currency            public.d_currency NOT NULL,
  original_amount     public.d_money CHECK (original_amount IS NULL OR original_amount >= 0),
  outstanding_amount  public.d_money,      -- Cache จาก liability_valuations ล่าสุด
  balance_date        date,                -- Cache
  interest_rate       public.d_rate,
  monthly_payment     public.d_money CHECK (monthly_payment IS NULL OR monthly_payment >= 0),
  payment_due_day     smallint CHECK (payment_due_day BETWEEN 1 AND 31),
  start_date          date,
  due_date            date,
  linked_asset_id     uuid REFERENCES public.assets(id),
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED','WRITTEN_OFF')),
  notes               text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);

CREATE TABLE public.liability_valuations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  liability_id    uuid NOT NULL REFERENCES public.liabilities(id),
  valuation_date  date NOT NULL,
  balance         public.d_money NOT NULL CHECK (balance >= 0),
  source          text NOT NULL DEFAULT 'USER' CHECK (source IN ('STATEMENT','USER','OPENING')),
  is_opening      boolean NOT NULL DEFAULT false,
  notes           text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (is_opening = (source = 'OPENING'))
);
CREATE UNIQUE INDEX liability_valuations_date_uq
  ON public.liability_valuations(liability_id, valuation_date) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX liability_valuations_opening_uq
  ON public.liability_valuations(liability_id) WHERE is_opening AND deleted_at IS NULL;

CREATE TABLE public.liability_ownerships (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  liability_id            uuid NOT NULL REFERENCES public.liabilities(id),
  person_id               uuid NOT NULL REFERENCES public.persons(id),
  responsibility_percent  public.d_pct NOT NULL CHECK (responsibility_percent > 0),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);
CREATE UNIQUE INDEX liability_ownerships_uq
  ON public.liability_ownerships(liability_id, person_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- 22. property_details / property_utilities / property_leases
-- ---------------------------------------------------------------------
CREATE TABLE public.property_details (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id         uuid NOT NULL UNIQUE REFERENCES public.assets(id),
  property_type    text NOT NULL CHECK (property_type IN ('HOUSE','LAND','CONDO','OTHER')),
  usage_type       text NOT NULL DEFAULT 'OWNER_OCCUPIED' CHECK (usage_type IN
                   ('OWNER_OCCUPIED','PERSONAL_USE','RENTAL','VACANT','BUSINESS_USE','OTHER')),
  location_group   text,
  address          text,
  land_area_sq_wa  numeric(14,2) CHECK (land_area_sq_wa IS NULL OR land_area_sq_wa >= 0),
  title_type       text,
  title_deed_no    text,
  land_no          text,
  notes            text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);

CREATE TABLE public.property_utilities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES public.property_details(id),
  utility_type  text NOT NULL CHECK (utility_type IN ('ELECTRICITY','WATER','OTHER')),
  provider      text,
  account_no    text,
  meter_no      text,
  notes         text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);

CREATE TABLE public.property_leases (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id                    uuid NOT NULL REFERENCES public.property_details(id),
  unit_label                     text,
  tenant_name                    text NOT NULL,
  contract_no                    text,
  start_date                     date NOT NULL,
  end_date                       date NOT NULL,
  terminated_date                date,
  rent_amount                    public.d_money NOT NULL CHECK (rent_amount >= 0),
  rent_currency                  public.d_currency NOT NULL DEFAULT 'THB',
  payment_frequency              text NOT NULL DEFAULT 'MONTHLY'
                                 CHECK (payment_frequency IN ('MONTHLY','QUARTERLY','YEARLY','OTHER')),
  payment_due_day                smallint CHECK (payment_due_day BETWEEN 1 AND 31),
  security_deposit               public.d_money CHECK (security_deposit IS NULL OR security_deposit >= 0),
  deposit_currency               public.d_currency,
  deposit_received_date          date,
  deposit_settled_date           date,
  deposit_refunded_amount        public.d_money CHECK (deposit_refunded_amount IS NULL OR deposit_refunded_amount >= 0),
  deposit_settlement_type        text CHECK (deposit_settlement_type IN ('REFUNDED','CARRIED_TO_NEW_LEASE')),
  deposit_carried_from_lease_id  uuid REFERENCES public.property_leases(id),
  deposit_carried_amount         public.d_money CHECK (deposit_carried_amount IS NULL OR deposit_carried_amount > 0),
  status                         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','TERMINATED')),
  notes                          text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,

  CHECK (end_date > start_date),
  CHECK (terminated_date IS NULL OR status = 'TERMINATED'),
  CHECK (status <> 'TERMINATED' OR terminated_date IS NOT NULL),
  CHECK (security_deposit IS NULL OR security_deposit = 0 OR deposit_currency IS NOT NULL),
  CHECK (deposit_refunded_amount IS NULL OR deposit_refunded_amount <= security_deposit),
  CHECK ((deposit_settled_date IS NULL) = (deposit_settlement_type IS NULL)),
  CHECK ((deposit_carried_from_lease_id IS NULL) = (deposit_carried_amount IS NULL)),
  CHECK (deposit_carried_amount IS NULL OR deposit_carried_amount <= security_deposit),
  CHECK (deposit_carried_from_lease_id IS DISTINCT FROM id)
);
CREATE INDEX property_leases_property_idx ON public.property_leases(property_id);
-- สัญญาเดิม 1 สัญญายกเงินประกันไปได้ 1 สัญญาใหม่
CREATE UNIQUE INDEX property_leases_carry_uq
  ON public.property_leases(deposit_carried_from_lease_id)
  WHERE deposit_carried_from_lease_id IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- 23. asset_categories / alternative_asset_details
-- ---------------------------------------------------------------------
CREATE TABLE public.asset_categories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      uuid REFERENCES public.families(id),     -- NULL = หมวดมาตรฐาน
  category_code  text NOT NULL CHECK (category_code ~ '^[A-Z][A-Z0-9_]*$'),
  category_name  text NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);
-- NULLS NOT DISTINCT: หมวดมาตรฐาน (family_id NULL) ห้ามซ้ำกันเอง
CREATE UNIQUE INDEX asset_categories_code_uq
  ON public.asset_categories(family_id, category_code) NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

CREATE TABLE public.alternative_asset_details (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          uuid NOT NULL UNIQUE REFERENCES public.assets(id),
  category_id       uuid NOT NULL REFERENCES public.asset_categories(id),
  brand             text,
  model             text,
  serial_no         text,
  quantity          public.d_qty CHECK (quantity IS NULL OR quantity >= 0),
  storage_location  text,
  condition         text,
  details           text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);
