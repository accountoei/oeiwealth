-- =====================================================================
-- 1000 Wiring: FK ของ META → app_users และติด Generic Triggers ทุกตาราง
--
-- ลำดับ Trigger (PostgreSQL เรียงตามชื่อ):
--   BEFORE : t10_meta → t20_cache → t30_derived → t50_* (คำนวณ/ตรวจ ของแต่ละตาราง)
--            → t90_period_lock (ตรวจค่าสุดท้าย)
--   AFTER  : a50_* (Sync Derived / Cache) → z90_audit
-- =====================================================================

DO $$
DECLARE
  t record;
  c text;
BEGIN
  -- 1) FK ของ created_by / updated_by / deleted_by → app_users
  FOR t IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
       AND c.column_name IN ('created_by','updated_by','deleted_by')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.app_users(id)',
                   t.table_name, left(t.table_name || '_' || t.column_name || '_fk', 63), t.column_name);
  END LOOP;

  -- 2) META trigger (ทุกตารางที่มี updated_at) + ห้าม Hard Delete จาก Client
  FOR t IN
    SELECT DISTINCT c.table_name,
           bool_or(c.column_name = 'deleted_at') OVER (PARTITION BY c.table_name) AS has_soft
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name IN ('updated_at','deleted_at')
  LOOP
    EXECUTE format('CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION private.tg_meta(%L)',
                   t.table_name, CASE WHEN t.has_soft THEN 'soft' ELSE 'no_soft_delete' END);
    EXECUTE format('CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete()', t.table_name);
  END LOOP;

  -- 3) Audit trigger (ยกเว้นตารางระบบ / Frozen / Secret)
  FOR t IN
    SELECT tb.table_name FROM information_schema.tables tb
     WHERE tb.table_schema = 'public' AND tb.table_type = 'BASE TABLE'
       AND tb.table_name NOT IN ('audit_logs','net_worth_snapshot_items','net_worth_snapshot_lines',
                                 'system_job_runs','bank_account_secrets')
  LOOP
    EXECUTE format('CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION private.tg_audit()', t.table_name);
  END LOOP;
END $$;

-- Reference อื่นที่ชี้ app_users
ALTER TABLE public.families             ADD CONSTRAINT families_go_live_confirmed_by_fk  FOREIGN KEY (go_live_confirmed_by) REFERENCES public.app_users(id);
ALTER TABLE public.bank_reconciliations ADD CONSTRAINT bank_recon_confirmed_by_fk        FOREIGN KEY (confirmed_by)         REFERENCES public.app_users(id);
ALTER TABLE public.net_worth_snapshots  ADD CONSTRAINT nws_finalized_by_fk               FOREIGN KEY (finalized_by)         REFERENCES public.app_users(id);
ALTER TABLE public.net_worth_snapshot_items ADD CONSTRAINT nws_items_created_by_fk       FOREIGN KEY (created_by)           REFERENCES public.app_users(id);
ALTER TABLE public.net_worth_snapshot_lines ADD CONSTRAINT nws_lines_created_by_fk       FOREIGN KEY (created_by)           REFERENCES public.app_users(id);

-- audit_logs Immutable
CREATE TRIGGER t00_audit_immutable BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit_immutable();

-- ---------------------------------------------------------------------
-- Cache Field Guards (Section 42) — Client แก้ไม่ได้
-- ---------------------------------------------------------------------
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.families
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('system_status=SETUP','go_live_confirmed_at','go_live_confirmed_by');
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('current_value','current_value_date');
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('account_no_last4');
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.investment_holdings
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('quantity=0','average_cost','current_price','current_value','current_value_date');
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('amount_base_currency');
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.investment_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('fx_rate_id','base_value');
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.loan_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('outstanding_principal');
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.liabilities
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('outstanding_amount','balance_date');
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.income_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('base_amount');
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.monthly_expenses
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('total_amount=0');
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('fx_rate_id','base_amount');
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('base_amount');
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard(
    'opening_valuation_id','opening_balance=0','known_inflows=0','known_outflows=0','calculated_closing=0',
    'status=OPEN','closing_valuation_id','confirmed_at','confirmed_by','difference');

-- ---------------------------------------------------------------------
-- Derived Record Lock (Section 24, 25A, 25B)
-- ---------------------------------------------------------------------
CREATE TRIGGER t30_derived BEFORE INSERT OR UPDATE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.tg_derived_guard('is_derived');
CREATE TRIGGER t30_derived BEFORE INSERT OR UPDATE ON public.income_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_derived_guard('source_transaction_id');
CREATE TRIGGER t30_derived BEFORE INSERT OR UPDATE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_derived_guard('source_cash_movement_id');
CREATE TRIGGER t30_derived BEFORE INSERT OR UPDATE ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_derived_guard('cash_movement_id');

-- ---------------------------------------------------------------------
-- Period Lock + Go-live Lock (Section 37 ตาราง Effective Date)
-- ---------------------------------------------------------------------
CREATE TRIGGER t90_period_lock BEFORE INSERT OR UPDATE OR DELETE ON public.asset_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_period_lock('valuation_date');
CREATE TRIGGER t90_period_lock BEFORE INSERT OR UPDATE OR DELETE ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_period_lock('transaction_date','settlement_date');
CREATE TRIGGER t90_period_lock BEFORE INSERT OR UPDATE OR DELETE ON public.investment_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_period_lock('valuation_date');
CREATE TRIGGER t90_period_lock BEFORE INSERT OR UPDATE OR DELETE ON public.income_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_period_lock('date');
CREATE TRIGGER t90_period_lock BEFORE INSERT OR UPDATE OR DELETE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_period_lock('date');
CREATE TRIGGER t90_period_lock BEFORE INSERT OR UPDATE OR DELETE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.tg_period_lock('movement_date');
CREATE TRIGGER t90_period_lock BEFORE INSERT OR UPDATE OR DELETE ON public.expense_reimbursements
  FOR EACH ROW EXECUTE FUNCTION private.tg_period_lock('received_date');
CREATE TRIGGER t90_period_lock BEFORE INSERT OR UPDATE OR DELETE ON public.bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION private.tg_period_lock('year_month');
CREATE TRIGGER t90_period_lock BEFORE INSERT OR UPDATE OR DELETE ON public.monthly_expenses
  FOR EACH ROW EXECUTE FUNCTION private.tg_period_lock('year_month');
CREATE TRIGGER t90_period_lock BEFORE INSERT OR UPDATE OR DELETE ON public.liability_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_period_lock('valuation_date');
-- credit_cards: ตรวจเฉพาะตอนเปลี่ยนยอด (Trigger เฉพาะ อยู่ใน 1100)
