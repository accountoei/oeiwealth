-- =====================================================================
-- 0600 Documents, Important Information, Month Closing, System
-- Section 31–36, 41, 45
-- =====================================================================

-- ---------------------------------------------------------------------
-- 31. documents / document_links  (ไฟล์อยู่ใน Google Drive ของระบบ)
-- ---------------------------------------------------------------------
CREATE TABLE public.documents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id               uuid NOT NULL REFERENCES public.families(id),
  module                  text NOT NULL CHECK (module IN ('FAMILY','FINANCIAL','INVESTMENT','PROPERTY',
                          'ALTERNATIVE','INSURANCE','HEALTH','CARD_MEMBERSHIP','SYSTEM')),
  document_type           text NOT NULL,
  title                   text NOT NULL,
  drive_file_id           text NOT NULL,
  mime_type               text,
  file_size               bigint CHECK (file_size IS NULL OR file_size >= 0),
  issue_date              date,
  expiry_date             date,
  version_status          text NOT NULL DEFAULT 'CURRENT' CHECK (version_status IN ('CURRENT','SUPERSEDED')),
  supersedes_document_id  uuid REFERENCES public.documents(id),
  notes                   text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (supersedes_document_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX documents_drive_file_uq ON public.documents(drive_file_id) WHERE deleted_at IS NULL;

CREATE TABLE public.document_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES public.documents(id),
  entity_type  text NOT NULL CHECK (entity_type ~ '^[A-Z][A-Z0-9_]*$'),   -- ASSET, PROPERTY_LEASE, INSURANCE_POLICY, PERSON ...
  entity_id    uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);
CREATE UNIQUE INDEX document_links_uq ON public.document_links(document_id, entity_type, entity_id)
  WHERE deleted_at IS NULL;
CREATE INDEX document_links_entity_idx ON public.document_links(entity_type, entity_id);

-- ---------------------------------------------------------------------
-- 32. important_information  (ห้ามเก็บ Password / Secret)
-- ---------------------------------------------------------------------
CREATE TABLE public.important_information (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    uuid NOT NULL REFERENCES public.families(id),
  entity_type  text CHECK (entity_type ~ '^[A-Z][A-Z0-9_]*$'),
  entity_id    uuid,
  title        text NOT NULL,
  value        text,
  notes        text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK ((entity_type IS NULL) = (entity_id IS NULL))
);

-- ---------------------------------------------------------------------
-- 33. net_worth_snapshots  (เขียนผ่าน finalize_month / reopen_month เท่านั้น)
-- ---------------------------------------------------------------------
CREATE TABLE public.net_worth_snapshots (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id                uuid NOT NULL REFERENCES public.families(id),
  snapshot_month           public.d_month NOT NULL,
  snapshot_date            date NOT NULL,
  status                   text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FINAL')),
  financial_assets         public.d_money NOT NULL DEFAULT 0,
  investments              public.d_money NOT NULL DEFAULT 0,
  property_assets          public.d_money NOT NULL DEFAULT 0,
  alternative_assets       public.d_money NOT NULL DEFAULT 0,
  total_assets             public.d_money NOT NULL DEFAULT 0,
  unallocated_assets       public.d_money NOT NULL DEFAULT 0,
  total_liabilities        public.d_money NOT NULL DEFAULT 0,
  unallocated_liabilities  public.d_money NOT NULL DEFAULT 0,
  net_worth                public.d_money NOT NULL DEFAULT 0,
  finalized_at             timestamptz,
  finalized_by             uuid,
  pdf_document_id          uuid REFERENCES public.documents(id),
  version                  integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  closing_warnings         jsonb,
  fx_rate_dates            jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid,
  CHECK (snapshot_date = (snapshot_month + interval '1 month' - interval '1 day')::date),
  CHECK (status = 'DRAFT' OR finalized_at IS NOT NULL),
  CHECK (total_assets = financial_assets + investments + property_assets + alternative_assets),
  CHECK (net_worth = total_assets - total_liabilities)
);
CREATE UNIQUE INDEX net_worth_snapshots_uq ON public.net_worth_snapshots(family_id, snapshot_month)
  WHERE deleted_at IS NULL;

-- 34. net_worth_snapshot_items  (Frozen; ไม่มี META เต็ม — Insert/Delete โดย finalize เท่านั้น)
CREATE TABLE public.net_worth_snapshot_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id         uuid NOT NULL REFERENCES public.net_worth_snapshots(id) ON DELETE RESTRICT,
  item_type           text NOT NULL CHECK (item_type IN ('ASSET','LIABILITY')),
  asset_id            uuid REFERENCES public.assets(id) ON DELETE RESTRICT,
  liability_id        uuid REFERENCES public.liabilities(id) ON DELETE RESTRICT,
  credit_card_id      uuid REFERENCES public.credit_cards(id) ON DELETE RESTRICT,
  lease_id            uuid REFERENCES public.property_leases(id) ON DELETE RESTRICT,
  person_id           uuid REFERENCES public.persons(id) ON DELETE RESTRICT,   -- NULL = Unallocated
  item_name           text NOT NULL,
  item_group          text NOT NULL CHECK (item_group IN ('FINANCIAL','INVESTMENT','PROPERTY','ALTERNATIVE',
                      'LIABILITY_LOAN','LIABILITY_CARD','LIABILITY_DEPOSIT')),
  item_subtype        text NOT NULL,
  value               public.d_money NOT NULL,
  currency            public.d_currency NOT NULL,
  value_date          date NOT NULL,
  is_carried_forward  boolean NOT NULL DEFAULT false,
  fx_rate             public.d_fx,           -- NULL = Portfolio หลายสกุล
  base_value          public.d_money NOT NULL,
  ownership_percent   public.d_pct NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  CHECK (num_nonnulls(asset_id, liability_id, credit_card_id, lease_id) = 1),
  CHECK ((item_type = 'ASSET') = (item_group IN ('FINANCIAL','INVESTMENT','PROPERTY','ALTERNATIVE')))
);
CREATE INDEX nws_items_snapshot_idx ON public.net_worth_snapshot_items(snapshot_id);

-- 35. net_worth_snapshot_lines (ต่อ Person, ไม่รวม Unallocated)
CREATE TABLE public.net_worth_snapshot_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id        uuid NOT NULL REFERENCES public.net_worth_snapshots(id) ON DELETE RESTRICT,
  person_id          uuid NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  total_assets       public.d_money NOT NULL,
  total_liabilities  public.d_money NOT NULL,
  net_worth          public.d_money NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  UNIQUE (snapshot_id, person_id),
  CHECK (net_worth = total_assets - total_liabilities)
);

-- ---------------------------------------------------------------------
-- 41. data_completeness_rules
-- ---------------------------------------------------------------------
CREATE TABLE public.data_completeness_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     text NOT NULL,
  entity_subtype  text,
  field_key       text NOT NULL,
  importance      text NOT NULL CHECK (importance IN ('REQUIRED','RECOMMENDED','OPTIONAL')),
  weight          numeric(8,2) NOT NULL DEFAULT 0 CHECK (weight >= 0),
  active          boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);
CREATE UNIQUE INDEX data_completeness_rules_uq
  ON public.data_completeness_rules(entity_type, entity_subtype, field_key) NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- 16 / 45. system_job_runs  (ตารางปฏิบัติการ: ผล FX Job และ Backup Job)
--   Physical-only: Logical Schema กำหนดให้ "บันทึกผล Job" และ
--   "backup_date, schema_version, checksum, result" แต่ไม่ได้ตั้งชื่อตาราง
-- ---------------------------------------------------------------------
CREATE TABLE public.system_job_runs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_type        text NOT NULL CHECK (job_type IN ('FX_FETCH','FX_BACKFILL','BACKUP','RESTORE_TEST','MONTHLY_PDF')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  result          text NOT NULL CHECK (result IN ('RUNNING','SUCCESS','PARTIAL','FAILED')),
  schema_version  text,
  checksum        text,
  details         jsonb
);
