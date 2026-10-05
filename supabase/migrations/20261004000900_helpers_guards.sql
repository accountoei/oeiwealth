-- =====================================================================
-- 0900 Helper functions + Generic Guard Triggers
-- Section 5 (Roles), 6 (Database Security Rules), 16 (FX), 37 (Period Lock),
-- 3 (Go-live lock), 39 (Audit)
--
-- หลักแยก "Client Write" กับ "Trusted Write" (Section 24 Derived Income Lock):
--   Client  = current_user ∈ {authenticated, anon}  (มาจาก Supabase API)
--   Trusted = ทุกอย่างที่วิ่งใน SECURITY DEFINER function ของระบบ (owner = postgres)
--             หรือ service_role (Edge Function) — current_user จะไม่ใช่ authenticated
--   วิธีนี้ปลอมไม่ได้จาก Client (ต่างจาก Session Flag ที่ client อาจตั้งเองได้ถ้าเปิด RPC ผิด)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Identity & Role
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.app_user_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  SELECT u.id INTO v FROM public.app_users u
   WHERE u.auth_user_id = auth.uid() AND u.status = 'ACTIVE';
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION private.app_role() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text;
BEGIN
  SELECT u.role INTO v FROM public.app_users u
   WHERE u.auth_user_id = auth.uid() AND u.status = 'ACTIVE';   -- DISABLED/INVITED = ไม่มีสิทธิ์
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION private.has_role(VARIADIC p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(private.app_role() = ANY (p_roles), false)
$$;

-- เรียกต้น Controlled Function: คืน app_user_id หรือ raise
CREATE OR REPLACE FUNCTION private.require_role(VARIADIC p_roles text[]) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_role(VARIADIC p_roles) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: ต้องเป็น % เท่านั้น', array_to_string(p_roles, ' / ')
      USING ERRCODE = '42501';
  END IF;
  RETURN private.app_user_id();
END $$;

-- ใช้ใน Read Helper ที่เป็น SECURITY DEFINER (Defense in depth):
--   ผู้ใช้ผ่าน API ต้องมี Role ที่ ACTIVE; service_role / งานระบบ (ไม่มี JWT ของผู้ใช้) อ่านได้
CREATE OR REPLACE FUNCTION private.can_read() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')
      OR coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'none')
         NOT IN ('authenticated', 'anon')
$$;

-- SECURITY INVOKER โดยตั้งใจ: ต้องเห็น current_user จริงของ statement
CREATE OR REPLACE FUNCTION private.is_client() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT current_user IN ('authenticated', 'anon')
$$;

-- ---------------------------------------------------------------------
-- Family / Go-live / Period
-- ---------------------------------------------------------------------
-- V1 = ครอบครัวเดียว (Section 3) — ตารางลูกที่ไม่มี family_id ใช้ครอบครัวนี้
CREATE OR REPLACE FUNCTION private.default_family_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT f.id FROM public.families f WHERE f.deleted_at IS NULL ORDER BY f.created_at LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.family_of(p_row jsonb) RETURNS uuid
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce((p_row ->> 'family_id')::uuid, private.default_family_id())
$$;

-- วันสุดท้ายของเดือน FINAL ล่าสุด (NULL = ยังไม่มีเดือนที่ปิด)
CREATE OR REPLACE FUNCTION private.locked_through(p_family uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (max(s.snapshot_month) + interval '1 month' - interval '1 day')::date
    FROM public.net_worth_snapshots s
   WHERE s.family_id = p_family AND s.status = 'FINAL' AND s.deleted_at IS NULL
$$;

CREATE OR REPLACE FUNCTION private.month_end(p_month date) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date
$$;

-- ---------------------------------------------------------------------
-- FX — Previous Available Rate (Section 16): rate_date < D
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.fx_rate_row(p_currency text, p_date date)
RETURNS public.fx_rates
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.* FROM public.fx_rates r
   WHERE r.currency = p_currency AND r.rate_type = 'MID_AVERAGE'
     AND r.deleted_at IS NULL AND r.rate_date < p_date
   ORDER BY r.rate_date DESC LIMIT 1
$$;

-- คืน Rate (THB = 1) หรือ NULL ถ้าไม่มีข้อมูล (ให้ Closing Check จับ ไม่ Block การกรอก)
CREATE OR REPLACE FUNCTION private.fx_rate(p_currency text, p_date date) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p_currency = 'THB' THEN 1::numeric
              ELSE (private.fx_rate_row(p_currency, p_date)).rate_to_thb END
$$;

-- ---------------------------------------------------------------------
-- Opening row detection (Section 3 Go-live, 14A)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.is_opening_row(p_table text, p_row jsonb, p_go_live date)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_table
    WHEN 'asset_valuations'        THEN coalesce((p_row->>'is_opening')::boolean, false)
    WHEN 'liability_valuations'    THEN coalesce((p_row->>'is_opening')::boolean, false)
    WHEN 'investment_transactions' THEN p_row->>'transaction_type' = 'OPENING_BALANCE'
    WHEN 'investment_valuations'   THEN (p_row->>'valuation_date')::date < p_go_live
    WHEN 'credit_cards'            THEN (p_row->>'balance_date')::date < p_go_live
    ELSE false END
$$;

-- ---------------------------------------------------------------------
-- Audit writer (เรียกจาก SECURITY DEFINER code เท่านั้น)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.write_audit(
  p_action text, p_entity_type text, p_entity_id text, p_metadata jsonb,
  p_family uuid DEFAULT NULL, p_field text DEFAULT NULL, p_user uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := coalesce(p_user, private.app_user_id());
  v_headers jsonb;
BEGIN
  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN v_headers := NULL;
  END;
  INSERT INTO public.audit_logs(family_id, user_id, actor_type, action, entity_type, entity_id,
                                field_name, ip_address, user_agent, metadata)
  VALUES (coalesce(p_family, private.default_family_id()), v_user,
          CASE WHEN v_user IS NULL THEN 'SYSTEM' ELSE 'USER' END,
          p_action, p_entity_type, p_entity_id, p_field,
          split_part(coalesce(v_headers->>'x-forwarded-for', v_headers->>'x-real-ip', ''), ',', 1),
          v_headers->>'user-agent', p_metadata);
END $$;

-- =====================================================================
-- Generic Trigger 1: META + Soft Delete / Restore Rule (Section 2.5, 6.2, 6.3)
--   TG_ARGV[0] = 'no_soft_delete' สำหรับ app_users
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_meta() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_client boolean := private.is_client();
  v_uid    uuid    := private.app_user_id();
  v_soft   boolean := coalesce(TG_ARGV[0], '') <> 'no_soft_delete';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_client THEN
      NEW.created_at := now();
      NEW.created_by := v_uid;
    ELSE
      NEW.created_at := coalesce(NEW.created_at, now());
      NEW.created_by := coalesce(NEW.created_by, v_uid);
    END IF;
    NEW.updated_at := NEW.created_at;
    NEW.updated_by := NEW.created_by;
    IF v_soft THEN                                   -- (ซ้อน IF: app_users ไม่มีคอลัมน์ deleted_at)
      IF NEW.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVALID: สร้าง Record ที่ถูกลบแล้วไม่ได้' USING ERRCODE = '22023';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'IMMUTABLE: created_at / created_by แก้ไม่ได้' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := v_uid;

  IF v_soft THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN            -- SOFT DELETE
      IF v_client AND NOT private.has_role('ADMIN','EDITOR') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: ลบได้เฉพาะ ADMIN / EDITOR' USING ERRCODE = '42501';
      END IF;
      NEW.deleted_at := now();
      NEW.deleted_by := v_uid;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN         -- RESTORE
      IF v_client AND NOT private.has_role('ADMIN') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: กู้คืนได้เฉพาะ ADMIN' USING ERRCODE = '42501';
      END IF;
      NEW.deleted_by := NULL;
    ELSIF OLD.deleted_at IS NOT NULL THEN                                    -- แก้ Record ที่ถูกลบ
      IF v_client THEN
        RAISE EXCEPTION 'INVALID: Record ถูกลบแล้ว ต้องกู้คืนก่อนแก้ไข' USING ERRCODE = '22023';
      END IF;
      NEW.deleted_at := OLD.deleted_at;
      NEW.deleted_by := OLD.deleted_by;
    ELSE
      NEW.deleted_by := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- =====================================================================
-- Generic Trigger 2: ห้าม Hard Delete จาก Client
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_block_hard_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF private.is_client() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: ลบถาวรไม่ได้ ใช้ Soft Delete (deleted_at)' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;

-- =====================================================================
-- Generic Trigger 3: Cache Field Guard (Section 42)
--   TG_ARGV = รายชื่อคอลัมน์ ('col' หรือ 'col=ค่าเริ่มต้น')
--   Client INSERT → ค่าถูกรีเซ็ต ; Client UPDATE เปลี่ยนค่า → raise
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_cache_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_arg text; v_col text; v_def text;
  v_new jsonb; v_old jsonb; v_reset jsonb := '{}'::jsonb;
BEGIN
  IF NOT private.is_client() THEN RETURN NEW; END IF;
  v_new := to_jsonb(NEW);
  IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;
  FOREACH v_arg IN ARRAY TG_ARGV LOOP
    v_col := split_part(v_arg, '=', 1);
    v_def := nullif(split_part(v_arg, '=', 2), '');
    IF TG_OP = 'INSERT' THEN
      v_reset := v_reset || jsonb_build_object(v_col, v_def);
    ELSIF (v_new -> v_col) IS DISTINCT FROM (v_old -> v_col) THEN
      RAISE EXCEPTION 'CACHE_FIELD: %.% ระบบคำนวณเอง แก้ตรงไม่ได้', TG_TABLE_NAME, v_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF TG_OP = 'INSERT' THEN
    NEW := jsonb_populate_record(NEW, v_reset);
  END IF;
  RETURN NEW;
END $$;

-- =====================================================================
-- Generic Trigger 4: Derived Record Lock (Section 24, 25A, 25B)
--   TG_ARGV[0] = คอลัมน์ที่บอกว่าเป็น Derived (มีค่า / true)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_derived_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_col text := TG_ARGV[0];
  v_new text; v_old text;
BEGIN
  IF NOT private.is_client() THEN RETURN NEW; END IF;
  v_new := to_jsonb(NEW) ->> v_col;
  IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD) ->> v_col; END IF;
  IF (v_new IS NOT NULL AND v_new <> 'false') OR (v_old IS NOT NULL AND v_old <> 'false') THEN
    RAISE EXCEPTION 'DERIVED_RECORD: % ถูกสร้างจาก Source อื่น ให้แก้ที่รายการต้นทาง', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- =====================================================================
-- Generic Trigger 5: Period Lock + Go-live Lock (Section 3, 37)
--   TG_ARGV = คอลัมน์ Effective Date (ตรวจทุกคอลัมน์ ทั้ง OLD และ NEW)
--   - วันใดอยู่ใน Period ที่ FINAL → Block ทุกการเขียน (รวม Trusted Trigger)
--   - หลัง LIVE: วันที่ < go_live_date → Block
--       ยกเว้นแถวยอดตั้งต้น ที่ ADMIN แก้พร้อมเหตุผล (notes) หรือ Trusted Function
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_period_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_rows jsonb[] := ARRAY[]::jsonb[];
  v_row jsonb; v_col text; v_d date;
  v_family uuid; v_locked date; v_go_live date; v_status text;
  v_client boolean := private.is_client();
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN v_rows := v_rows || to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN v_rows := v_rows || to_jsonb(NEW); END IF;

  v_family := private.family_of(v_rows[array_length(v_rows,1)]);
  v_locked := private.locked_through(v_family);
  SELECT f.go_live_date, f.system_status INTO v_go_live, v_status
    FROM public.families f WHERE f.id = v_family;

  FOREACH v_row IN ARRAY v_rows LOOP
    FOREACH v_col IN ARRAY TG_ARGV LOOP
      v_d := (v_row ->> v_col)::date;
      CONTINUE WHEN v_d IS NULL;
      IF v_locked IS NOT NULL AND v_d <= v_locked THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: %.% = % อยู่ในงวดที่ปิดแล้ว (ถึง %) ต้อง Reopen ก่อน',
          TG_TABLE_NAME, v_col, v_d, v_locked USING ERRCODE = '42501';
      END IF;
      IF v_status = 'LIVE' AND v_d < v_go_live THEN
        IF NOT private.is_opening_row(TG_TABLE_NAME, v_row, v_go_live) THEN
          RAISE EXCEPTION 'BEFORE_GO_LIVE: %.% = % อยู่ก่อน Go-live (%) ยอดก่อนหน้านี้รวมใน Opening Position แล้ว',
            TG_TABLE_NAME, v_col, v_d, v_go_live USING ERRCODE = '42501';
        END IF;
        IF v_client AND NOT private.has_role('ADMIN') THEN
          RAISE EXCEPTION 'OPENING_LOCKED: ยอดตั้งต้นหลัง Go-live แก้ได้เฉพาะ ADMIN' USING ERRCODE = '42501';
        END IF;
        IF v_client AND TG_OP <> 'DELETE' AND to_jsonb(NEW) ? 'notes'
           AND length(trim(coalesce(to_jsonb(NEW)->>'notes',''))) = 0 THEN
          RAISE EXCEPTION 'OPENING_REASON_REQUIRED: แก้ยอดตั้งต้นหลัง Go-live ต้องระบุเหตุผลใน notes'
            USING ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- =====================================================================
-- Generic Trigger 6: Audit (Section 39) — CREATE/UPDATE/DELETE/RESTORE
--   ใช้ EDIT_OPENING_POSITION เมื่อแก้ยอดตั้งต้นหลัง LIVE
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_new jsonb; v_old jsonb; v_before jsonb := '{}'; v_after jsonb := '{}';
  v_key text; v_action text; v_row jsonb; v_family uuid;
  v_go_live date; v_status text;
  c_sensitive constant text[] := ARRAY['account_no_encrypted'];
BEGIN
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW) - c_sensitive; END IF;
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD) - c_sensitive; END IF;
  v_row := coalesce(v_new, v_old);

  IF TG_OP = 'INSERT' THEN
    v_action := 'CREATE'; v_after := v_new - ARRAY['created_at','created_by','updated_at','updated_by','deleted_at','deleted_by'];
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'HARD_DELETE'; v_before := v_old;
  ELSE
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      CONTINUE WHEN v_key IN ('updated_at','updated_by');
      IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
        v_before := v_before || jsonb_build_object(v_key, v_old -> v_key);
        v_after  := v_after  || jsonb_build_object(v_key, v_new -> v_key);
      END IF;
    END LOOP;
    IF v_after = '{}'::jsonb THEN RETURN NULL; END IF;
    v_action := CASE
      WHEN v_old->>'deleted_at' IS NULL AND v_new->>'deleted_at' IS NOT NULL THEN 'DELETE'
      WHEN v_old->>'deleted_at' IS NOT NULL AND v_new->>'deleted_at' IS NULL THEN 'RESTORE'
      ELSE 'UPDATE' END;
  END IF;

  v_family := private.family_of(v_row);
  SELECT f.go_live_date, f.system_status INTO v_go_live, v_status FROM public.families f WHERE f.id = v_family;
  IF v_status = 'LIVE' AND TG_TABLE_NAME <> 'families'
     AND (private.is_opening_row(TG_TABLE_NAME, v_row, v_go_live)
          OR (TG_TABLE_NAME = 'loan_details' AND (v_after ? 'opening_outstanding_principal' OR v_after ? 'opening_date')
              AND (v_row->>'opening_date')::date < v_go_live)) THEN
    v_after := v_after || jsonb_build_object('_op', v_action, '_reason', v_row->>'notes');
    v_action := 'EDIT_OPENING_POSITION';
  END IF;

  PERFORM private.write_audit(
    v_action, TG_TABLE_NAME,
    coalesce(v_row->>'id', v_row->>'bank_account_id'),
    jsonb_strip_nulls(jsonb_build_object(
      'before', CASE WHEN v_before = '{}'::jsonb THEN NULL ELSE v_before END,
      'after',  CASE WHEN v_after  = '{}'::jsonb THEN NULL ELSE v_after END)),
    v_family);
  RETURN NULL;
END $$;

-- audit_logs: Immutable (UPDATE / DELETE = DENY ALL รวม ADMIN และรวม Trusted)
CREATE OR REPLACE FUNCTION private.tg_audit_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE: audit_logs แก้หรือลบไม่ได้' USING ERRCODE = '42501';
END $$;
