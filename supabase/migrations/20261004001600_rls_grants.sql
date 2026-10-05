-- =====================================================================
-- 1600 RLS Policies + Grants (Section 5 Permission Matrix, 6, 39, 40, 46)
--   - RLS ตรวจ Role เท่านั้น ไม่กรอง deleted_at (Section 40)
--   - ไม่มี DELETE Policy ใด ๆ (Hard Delete ห้ามจาก Client)
--   - Soft Delete / Restore / Cache / Derived / Period Lock บังคับด้วย Trigger
-- =====================================================================

-- ---------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
-- Object ที่สร้างภายหลัง: ไม่ได้สิทธิ์อัตโนมัติ (ต้อง GRANT + RLS เองใน Migration ของมัน)
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
  c_read_only  constant text[] := ARRAY['net_worth_snapshots','net_worth_snapshot_items','net_worth_snapshot_lines',
                                        'audit_logs','system_job_runs'];
  c_no_access  constant text[] := ARRAY['bank_account_secrets'];
  c_special    constant text[] := ARRAY['families','app_users','fx_rates','data_completeness_rules'];
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF t = ANY (c_no_access) THEN
      CONTINUE;                                                       -- ไม่มี GRANT / Policy = ปิดสนิท
    ELSIF t = ANY (c_read_only) THEN
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
    END IF;

    IF t = ANY (c_read_only) OR t = ANY (c_special) THEN CONTINUE; END IF;

    -- Data tables: Permission Matrix มาตรฐาน
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

-- ---------------------------------------------------------------------
-- ตารางพิเศษ
-- ---------------------------------------------------------------------
-- families: ทุก Role อ่านได้; แก้ได้เฉพาะ ADMIN; สร้างผ่าน server_bootstrap_family
CREATE POLICY p_select ON public.families FOR SELECT TO authenticated
  USING (private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER'));
CREATE POLICY p_update ON public.families FOR UPDATE TO authenticated
  USING (private.has_role('ADMIN')) WITH CHECK (private.has_role('ADMIN'));
REVOKE INSERT ON public.families FROM authenticated;

-- app_users: ADMIN เห็นทุกคน, ผู้ใช้อื่นเห็นเฉพาะตัวเอง; Role/Status เปลี่ยนผ่าน admin_* เท่านั้น
CREATE POLICY p_select ON public.app_users FOR SELECT TO authenticated
  USING (private.has_role('ADMIN') OR auth_user_id = auth.uid());
CREATE POLICY p_update ON public.app_users FOR UPDATE TO authenticated
  USING (private.has_role('ADMIN')) WITH CHECK (private.has_role('ADMIN'));
REVOKE INSERT ON public.app_users FROM authenticated;

-- audit_logs: SELECT เฉพาะ ADMIN; INSERT/UPDATE/DELETE = ไม่มี Policy (Trigger/Trusted Function เท่านั้น)
CREATE POLICY p_select ON public.audit_logs FOR SELECT TO authenticated USING (private.has_role('ADMIN'));
CREATE POLICY p_select ON public.system_job_runs FOR SELECT TO authenticated USING (private.has_role('ADMIN'));

-- Snapshot: ทุก Role อ่านได้; เขียนผ่าน finalize_month / reopen_month เท่านั้น
CREATE POLICY p_select ON public.net_worth_snapshots      FOR SELECT TO authenticated
  USING (private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER'));
CREATE POLICY p_select ON public.net_worth_snapshot_items FOR SELECT TO authenticated
  USING (private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER'));
CREATE POLICY p_select ON public.net_worth_snapshot_lines FOR SELECT TO authenticated
  USING (private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER'));

-- fx_rates: ทุก Role อ่าน; ADMIN Override (Trigger บังคับ source/reason)
CREATE POLICY p_select ON public.fx_rates FOR SELECT TO authenticated
  USING (private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER'));
CREATE POLICY p_insert ON public.fx_rates FOR INSERT TO authenticated WITH CHECK (private.has_role('ADMIN'));
CREATE POLICY p_update ON public.fx_rates FOR UPDATE TO authenticated
  USING (private.has_role('ADMIN')) WITH CHECK (private.has_role('ADMIN'));

-- data_completeness_rules: ทุก Role อ่าน; ADMIN ตั้งค่า
CREATE POLICY p_select ON public.data_completeness_rules FOR SELECT TO authenticated
  USING (private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER'));
CREATE POLICY p_insert ON public.data_completeness_rules FOR INSERT TO authenticated WITH CHECK (private.has_role('ADMIN'));
CREATE POLICY p_update ON public.data_completeness_rules FOR UPDATE TO authenticated
  USING (private.has_role('ADMIN')) WITH CHECK (private.has_role('ADMIN'));

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
DO $$
DECLARE v text;
BEGIN
  FOR v IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;

-- private: helper แบบอ่านอย่างเดียว (ใช้ใน RLS / Invoker Trigger / View)
DO $$
DECLARE f record;
  c_writers constant text[] := ARRAY['write_audit','sync_derived_movement','refresh_holding','refresh_portfolio_value',
    'refresh_loan','refresh_asset_value','refresh_liability','refresh_monthly_expense','refresh_claim',
    'ensure_monthly_expense','fill_missing_base_amounts','bank_key'];
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'private' AND p.prorettype <> 'trigger'::regtype LOOP
    IF NOT f.proname = ANY (c_writers) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
  END LOOP;
END $$;

-- public RPC สำหรับผู้ใช้ (ตรวจ Role ภายใน)
GRANT EXECUTE ON FUNCTION
  public.set_bank_account_no(uuid, text),
  public.reveal_bank_account(uuid),
  public.confirm_go_live(),
  public.transfer_money(uuid, uuid, numeric, date, numeric, text, boolean),
  public.record_holding_maturity(uuid, date, numeric, uuid, date, numeric, numeric, text),
  public.receive_loan_payment(uuid, uuid, date, numeric, numeric, numeric, text),
  public.settle_security_deposit(uuid, date, numeric, uuid, text, boolean),
  public.update_bank_balance(uuid, date, numeric, text),
  public.prepare_bank_reconciliation(uuid, date),
  public.confirm_bank_reconciliation(uuid, numeric, date, numeric, text),
  public.finalize_month(date),
  public.reopen_month(date, text),
  public.month_closing_checks(date),
  public.admin_set_user_role(uuid, text),
  public.admin_set_user_status(uuid, text),
  public.record_login()
TO authenticated;

-- server_* = service_role เท่านั้น (Edge Function / Scheduled Job)
GRANT EXECUTE ON FUNCTION
  public.server_attach_month_pdf(uuid, uuid),
  public.server_register_invited_user(uuid, text, text, uuid, uuid),
  public.server_bootstrap_family(text, date, uuid, text, text),
  public.server_log_event(uuid, text, text, text, jsonb),
  public.server_upsert_fx_rates(jsonb, text)
TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO service_role;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
