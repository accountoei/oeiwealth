-- =====================================================================
-- 0200 Core: families, persons, app_users, audit_logs, assets,
--      asset_ownerships, asset_valuations, fx_rates
-- META (Section 2.5) = created_at, created_by, updated_at, updated_by,
--                      deleted_at, deleted_by
-- FK ของ created_by/updated_by/deleted_by → app_users ใส่ใน 1100_wiring
-- =====================================================================

-- ---------------------------------------------------------------------
-- 3. families
-- ---------------------------------------------------------------------
CREATE TABLE public.families (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  base_currency         public.d_currency NOT NULL DEFAULT 'THB'
                        CHECK (base_currency = 'THB'),             -- V1 ห้ามเปลี่ยน
  go_live_date          date NOT NULL
                        CHECK (extract(day FROM go_live_date) = 1), -- วันที่ 1 ของเดือน
  system_status         text NOT NULL DEFAULT 'SETUP'
                        CHECK (system_status IN ('SETUP','LIVE')),
  go_live_confirmed_at  timestamptz,
  go_live_confirmed_by  uuid,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CONSTRAINT families_live_confirmed CHECK (
    system_status = 'SETUP' OR go_live_confirmed_at IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- 4. persons
-- ---------------------------------------------------------------------
CREATE TABLE public.persons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     uuid NOT NULL REFERENCES public.families(id),
  name          text NOT NULL,
  relationship  text,
  birth_date    date,
  status        text NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE','INACTIVE','DECEASED')),
  notes         text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);
CREATE INDEX persons_family_idx ON public.persons(family_id);

-- ---------------------------------------------------------------------
-- 5. app_users  (ไม่มี Soft Delete → ใช้ status = DISABLED)
-- ---------------------------------------------------------------------
CREATE TABLE public.app_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id   uuid NOT NULL UNIQUE REFERENCES auth.users(id),
  family_id      uuid NOT NULL REFERENCES public.families(id),
  person_id      uuid REFERENCES public.persons(id),
  email          text NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1),
  role           text NOT NULL CHECK (role IN ('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')),
  status         text NOT NULL DEFAULT 'INVITED'
                 CHECK (status IN ('INVITED','ACTIVE','DISABLED')),
  invited_by     uuid REFERENCES public.app_users(id),
  invited_at     timestamptz,
  last_login_at  timestamptz,
  disabled_at    timestamptz,
  disabled_by    uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT app_users_disabled_consistent CHECK (
    (status = 'DISABLED') = (disabled_at IS NOT NULL))
);
-- Case-insensitive unique (V0.9.1 #8) — email ถูกบังคับเป็นตัวพิมพ์เล็กแล้ว
CREATE UNIQUE INDEX app_users_email_ci_uq ON public.app_users (lower(email));

-- ---------------------------------------------------------------------
-- 39. audit_logs  (Immutable: INSERT โดย Trigger/Trusted Function เท่านั้น)
-- ---------------------------------------------------------------------
CREATE TABLE public.audit_logs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id    uuid REFERENCES public.families(id),
  user_id      uuid REFERENCES public.app_users(id),
  actor_type   text NOT NULL CHECK (actor_type IN ('USER','SYSTEM')),
  action       text NOT NULL CHECK (action IN (
                 'CREATE','UPDATE','DELETE','RESTORE',
                 'VIEW_SENSITIVE','VIEW_DOCUMENT','DOWNLOAD_DOCUMENT','EXPORT',
                 'LOGIN','INVITE_USER','DISABLE_USER','ENABLE_USER','CHANGE_ROLE',
                 'FX_OVERRIDE','FINALIZE_MONTH','REOPEN_MONTH',
                 'CONFIRM_GO_LIVE','EDIT_OPENING_POSITION','SET_SENSITIVE','HARD_DELETE')),
  entity_type  text NOT NULL,
  entity_id    text,
  field_name   text,
  event_at     timestamptz NOT NULL DEFAULT now(),
  ip_address   text,
  user_agent   text,
  metadata     jsonb,
  CONSTRAINT audit_actor_consistent CHECK (actor_type = 'USER' OR user_id IS NULL)
);
CREATE INDEX audit_logs_entity_idx ON public.audit_logs(entity_type, entity_id);
CREATE INDEX audit_logs_event_idx  ON public.audit_logs(event_at DESC);

-- ---------------------------------------------------------------------
-- 7. assets
-- ---------------------------------------------------------------------
CREATE TABLE public.assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id           uuid NOT NULL REFERENCES public.families(id),
  asset_group         text NOT NULL CHECK (asset_group IN ('FINANCIAL','INVESTMENT','PROPERTY','ALTERNATIVE')),
  asset_type          text NOT NULL CHECK (asset_type ~ '^[A-Z][A-Z0-9_]*$'),
  name                text NOT NULL,
  currency            public.d_currency NOT NULL,
  acquisition_date    date,
  acquisition_cost    public.d_money,
  current_value       public.d_money,       -- Cache (Section 42)
  current_value_date  date,                 -- Cache
  status              text NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','SOLD','GIFTED','LOST','CLOSED')),
  notes               text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  -- asset_type ที่ระบบใช้ต้องอยู่ถูกกลุ่ม
  CONSTRAINT assets_type_group CHECK (
    (asset_type <> 'BANK_ACCOUNT'          OR asset_group = 'FINANCIAL') AND
    (asset_type <> 'LOAN_RECEIVABLE'       OR asset_group = 'FINANCIAL') AND
    (asset_type <> 'PRIVATE_BUSINESS'      OR asset_group = 'FINANCIAL') AND
    (asset_type <> 'INSURANCE_CASH_VALUE'  OR asset_group = 'FINANCIAL') AND
    (asset_type <> 'INVESTMENT_PORTFOLIO'  OR asset_group = 'INVESTMENT'))
);
CREATE INDEX assets_family_group_idx ON public.assets(family_id, asset_group, asset_type);

-- ---------------------------------------------------------------------
-- 8. asset_ownerships
-- ---------------------------------------------------------------------
CREATE TABLE public.asset_ownerships (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id           uuid NOT NULL REFERENCES public.assets(id),
  person_id          uuid NOT NULL REFERENCES public.persons(id),
  ownership_percent  public.d_pct NOT NULL CHECK (ownership_percent > 0),
  start_date         date NOT NULL DEFAULT current_date,
  end_date           date,                  -- inclusive; NULL = ยังมีผล
  notes              text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX asset_ownerships_asset_idx ON public.asset_ownerships(asset_id);

-- ---------------------------------------------------------------------
-- 9. asset_valuations
-- ---------------------------------------------------------------------
CREATE TABLE public.asset_valuations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id                uuid NOT NULL REFERENCES public.assets(id),
  valuation_date          date NOT NULL,
  value                   public.d_money NOT NULL,
  valuation_method        text NOT NULL DEFAULT 'USER_ESTIMATE' CHECK (valuation_method IN
                          ('BOOK_VALUE','LATEST_TRANSACTION','USER_ESTIMATE','APPRAISAL','STATEMENT')),
  source                  text NOT NULL DEFAULT 'USER' CHECK (source IN
                          ('STATEMENT','APPRAISAL','USER','ACCOUNT_SETUP','BALANCE_UPDATE','RECONCILIATION','OPENING')),
  is_opening              boolean NOT NULL DEFAULT false,
  unexplained_difference  public.d_money,
  notes                   text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (is_opening = (source = 'OPENING'))
);
CREATE UNIQUE INDEX asset_valuations_opening_uq
  ON public.asset_valuations(asset_id) WHERE is_opening AND deleted_at IS NULL;
CREATE INDEX asset_valuations_asset_date_idx
  ON public.asset_valuations(asset_id, valuation_date DESC);

-- ---------------------------------------------------------------------
-- 16. fx_rates  (System Table)
-- ---------------------------------------------------------------------
CREATE TABLE public.fx_rates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_date         date NOT NULL,
  currency          public.d_currency NOT NULL CHECK (currency <> 'THB'),  -- THB→THB = 1 ไม่เก็บ
  rate_to_thb       public.d_fx NOT NULL,
  rate_type         text NOT NULL DEFAULT 'MID_AVERAGE' CHECK (rate_type IN ('MID_AVERAGE')),
  source            text NOT NULL CHECK (source IN ('BOT_API','ADMIN_OVERRIDE')),
  source_reference  text,
  is_override       boolean NOT NULL DEFAULT false,
  override_reason   text,
  fetched_at        timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (is_override = (source = 'ADMIN_OVERRIDE')),
  CHECK (NOT is_override OR length(trim(override_reason)) > 0)
);
CREATE UNIQUE INDEX fx_rates_uq ON public.fx_rates(rate_date, currency, rate_type)
  WHERE deleted_at IS NULL;
CREATE INDEX fx_rates_lookup_idx ON public.fx_rates(currency, rate_type, rate_date DESC)
  WHERE deleted_at IS NULL;
