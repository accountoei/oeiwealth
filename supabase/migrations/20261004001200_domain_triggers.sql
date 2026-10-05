-- =====================================================================
-- 1200 Domain Triggers: Validation (BEFORE t50_*) + Sync Derived/Cache (AFTER a50_*)
-- Source Matrix (Section 25B) / Cash Flow Integrity (Section 44A)
-- AFTER triggers เป็น SECURITY DEFINER → การเขียนของมันเป็น Trusted Write
-- แต่ยังผ่าน Period Lock ทุกครั้ง (Section 37: ไม่มี Bypass)
-- =====================================================================

-- =====================================================================
-- families: หลัง LIVE แก้ go_live_date / base_currency ไม่ได้ (Section 3)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_families_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.system_status = 'LIVE' AND (NEW.go_live_date IS DISTINCT FROM OLD.go_live_date
                                     OR NEW.base_currency IS DISTINCT FROM OLD.base_currency) THEN
    RAISE EXCEPTION 'GO_LIVE_LOCKED: หลัง LIVE แก้ Go-live Date / Base Currency ไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF OLD.system_status = 'LIVE' AND NEW.system_status = 'SETUP' THEN
    RAISE EXCEPTION 'GO_LIVE_LOCKED: ย้อนสถานะเป็น SETUP ไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF private.is_client() AND NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: แก้ข้อมูลครอบครัวได้เฉพาะ ADMIN' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t50_families BEFORE UPDATE ON public.families
  FOR EACH ROW EXECUTE FUNCTION private.tg_families_guard();

-- =====================================================================
-- app_users: Client แก้ role/status/auth/email ไม่ได้ (ผ่าน admin_* function เท่านั้น)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_app_users_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF private.is_client() THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: เพิ่มผู้ใช้ผ่าน Invite Function เท่านั้น' USING ERRCODE = '42501';
    END IF;
    IF (NEW.role, NEW.status, NEW.auth_user_id, NEW.email, NEW.family_id, NEW.disabled_at, NEW.disabled_by,
        NEW.invited_by, NEW.invited_at, NEW.last_login_at)
       IS DISTINCT FROM
       (OLD.role, OLD.status, OLD.auth_user_id, OLD.email, OLD.family_id, OLD.disabled_at, OLD.disabled_by,
        OLD.invited_by, OLD.invited_at, OLD.last_login_at) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: เปลี่ยน Role / Status ผ่าน admin function เท่านั้น' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.email := lower(trim(NEW.email));
  RETURN NEW;
END $$;
CREATE TRIGGER t50_app_users BEFORE INSERT OR UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION private.tg_app_users_guard();

-- =====================================================================
-- Extension tables: Asset ต้องอยู่ถูกกลุ่ม/ประเภท
--   TG_ARGV[0] = asset_group, TG_ARGV[1] = asset_type ('*' = ไม่บังคับ)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_extension_asset_type() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.assets;
BEGIN
  SELECT * INTO a FROM public.assets WHERE id = NEW.asset_id;
  IF a.asset_group <> TG_ARGV[0] OR (TG_ARGV[1] <> '*' AND a.asset_type <> TG_ARGV[1]) THEN
    RAISE EXCEPTION 'INVALID_ASSET: % ต้องผูกกับ Asset กลุ่ม % ประเภท % (ได้ %/%)',
      TG_TABLE_NAME, TG_ARGV[0], TG_ARGV[1], a.asset_group, a.asset_type USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t50_asset_type BEFORE INSERT OR UPDATE OF asset_id ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION private.tg_extension_asset_type('FINANCIAL','BANK_ACCOUNT');
CREATE TRIGGER t50_asset_type BEFORE INSERT OR UPDATE OF asset_id ON public.investment_portfolios
  FOR EACH ROW EXECUTE FUNCTION private.tg_extension_asset_type('INVESTMENT','INVESTMENT_PORTFOLIO');
CREATE TRIGGER t50_asset_type BEFORE INSERT OR UPDATE OF asset_id ON public.loan_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_extension_asset_type('FINANCIAL','LOAN_RECEIVABLE');
CREATE TRIGGER t50_asset_type BEFORE INSERT OR UPDATE OF asset_id ON public.private_business_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_extension_asset_type('FINANCIAL','PRIVATE_BUSINESS');
CREATE TRIGGER t50_asset_type BEFORE INSERT OR UPDATE OF asset_id ON public.property_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_extension_asset_type('PROPERTY','*');
CREATE TRIGGER t50_asset_type BEFORE INSERT OR UPDATE OF asset_id ON public.alternative_asset_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_extension_asset_type('ALTERNATIVE','*');

-- =====================================================================
-- Ownership / Beneficiary / Responsibility รวมไม่เกิน 100% (Section 8, 21, 26)
-- (ไม่ครบ 100% ได้ระหว่างกรอก → แสดง Unallocated)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_asset_ownership_sum() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_point date; v_sum numeric;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  -- ผลรวมเปลี่ยนเฉพาะที่วันเริ่มของแต่ละแถว → ตรวจทุกวันเริ่มที่อยู่ในช่วงของแถวนี้
  FOR v_point IN
    SELECT NEW.start_date UNION
    SELECT o.start_date FROM public.asset_ownerships o
     WHERE o.asset_id = NEW.asset_id AND o.deleted_at IS NULL AND o.id <> NEW.id
       AND o.start_date BETWEEN NEW.start_date AND coalesce(NEW.end_date, 'infinity'::date)
  LOOP
    SELECT NEW.ownership_percent + coalesce(sum(o.ownership_percent), 0) INTO v_sum
      FROM public.asset_ownerships o
     WHERE o.asset_id = NEW.asset_id AND o.deleted_at IS NULL AND o.id <> NEW.id
       AND o.start_date <= v_point AND (o.end_date IS NULL OR o.end_date >= v_point);
    IF v_sum > 100 THEN
      RAISE EXCEPTION 'OWNERSHIP_OVER_100: สัดส่วนเจ้าของรวม % %% ณ % เกิน 100%%', v_sum, v_point
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER t50_sum BEFORE INSERT OR UPDATE ON public.asset_ownerships
  FOR EACH ROW EXECUTE FUNCTION private.tg_asset_ownership_sum();

-- Generic: TG_ARGV[0] = parent column, TG_ARGV[1] = percent column
CREATE OR REPLACE FUNCTION private.tg_percent_sum() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_sum numeric; v_parent uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT coalesce(sum(%I),0) FROM public.%I WHERE %I = $1 AND deleted_at IS NULL AND id <> $2',
                 TG_ARGV[1], TG_TABLE_NAME, TG_ARGV[0])
     INTO v_sum USING v_parent, NEW.id;
  v_sum := v_sum + (to_jsonb(NEW) ->> TG_ARGV[1])::numeric;
  IF v_sum > 100 THEN
    RAISE EXCEPTION 'PERCENT_OVER_100: %.% รวม % %% เกิน 100%%', TG_TABLE_NAME, TG_ARGV[1], v_sum
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t50_sum BEFORE INSERT OR UPDATE ON public.liability_ownerships
  FOR EACH ROW EXECUTE FUNCTION private.tg_percent_sum('liability_id','responsibility_percent');
CREATE TRIGGER t50_sum BEFORE INSERT OR UPDATE ON public.insurance_beneficiaries
  FOR EACH ROW EXECUTE FUNCTION private.tg_percent_sum('policy_id','percentage');

-- =====================================================================
-- asset_valuations (Section 9, 14A, 25C)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_asset_valuation_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.assets; v_go_live date;
BEGIN
  SELECT * INTO a FROM public.assets WHERE id = NEW.asset_id;
  SELECT go_live_date INTO v_go_live FROM public.families WHERE id = a.family_id;
  IF a.asset_type IN ('INVESTMENT_PORTFOLIO','LOAN_RECEIVABLE') THEN
    RAISE EXCEPTION 'INVALID: มูลค่า % คำนวณจาก Holding / Movement ไม่ใช้ asset_valuations', a.asset_type
      USING ERRCODE = '22023';
  END IF;
  IF NEW.valuation_date > current_date THEN
    RAISE EXCEPTION 'INVALID: วันที่ของยอดเป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF NEW.is_opening AND NEW.valuation_date >= v_go_live THEN
    RAISE EXCEPTION 'INVALID_OPENING: ยอดตั้งต้นต้องลงวันที่ก่อน Go-live (%)', v_go_live USING ERRCODE = '22023';
  END IF;
  IF NOT NEW.is_opening AND NEW.valuation_date < v_go_live THEN
    RAISE EXCEPTION 'BEFORE_GO_LIVE: มูลค่าก่อน Go-live ต้องเป็นยอดตั้งต้น (is_opening)' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t50_check BEFORE INSERT OR UPDATE ON public.asset_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_asset_valuation_check();

CREATE OR REPLACE FUNCTION private.tg_asset_valuation_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.refresh_asset_value(coalesce(NEW.asset_id, OLD.asset_id));
  IF TG_OP = 'UPDATE' AND OLD.asset_id <> NEW.asset_id THEN PERFORM private.refresh_asset_value(OLD.asset_id); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER a50_sync AFTER INSERT OR UPDATE OR DELETE ON public.asset_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_asset_valuation_sync();

-- =====================================================================
-- liability_valuations → liabilities cache (Section 21)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_liability_valuation_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_go_live date;
BEGIN
  SELECT f.go_live_date INTO v_go_live FROM public.liabilities l JOIN public.families f ON f.id = l.family_id
   WHERE l.id = NEW.liability_id;
  IF NEW.valuation_date > current_date THEN
    RAISE EXCEPTION 'INVALID: วันที่ของยอดเป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF NEW.is_opening AND NEW.valuation_date >= v_go_live THEN
    RAISE EXCEPTION 'INVALID_OPENING: ยอดตั้งต้นต้องลงวันที่ก่อน Go-live (%)', v_go_live USING ERRCODE = '22023';
  END IF;
  IF NOT NEW.is_opening AND NEW.valuation_date < v_go_live THEN
    RAISE EXCEPTION 'BEFORE_GO_LIVE: ยอดก่อน Go-live ต้องเป็นยอดตั้งต้น (is_opening)' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t50_check BEFORE INSERT OR UPDATE ON public.liability_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_liability_valuation_check();

CREATE OR REPLACE FUNCTION private.tg_liability_valuation_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.refresh_liability(coalesce(NEW.liability_id, OLD.liability_id));
  RETURN NULL;
END $$;
CREATE TRIGGER a50_sync AFTER INSERT OR UPDATE OR DELETE ON public.liability_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_liability_valuation_sync();

-- =====================================================================
-- credit_cards: Period Lock เฉพาะตอนเปลี่ยนยอด (Section 37)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_card_balance_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_family uuid; v_locked date; v_go_live date; v_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.outstanding_balance, NEW.balance_date)
                          IS NOT DISTINCT FROM (OLD.outstanding_balance, OLD.balance_date) THEN
    RETURN NEW;
  END IF;
  IF NEW.balance_date IS NULL THEN RETURN NEW; END IF;
  SELECT p.family_id INTO v_family FROM public.persons p WHERE p.id = NEW.person_id;
  v_locked := private.locked_through(v_family);
  SELECT go_live_date, system_status INTO v_go_live, v_status FROM public.families WHERE id = v_family;
  IF NEW.balance_date > current_date THEN
    RAISE EXCEPTION 'INVALID: วันที่ของยอดบัตรเป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF v_locked IS NOT NULL AND NEW.balance_date <= v_locked THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: balance_date ใหม่ต้องอยู่หลังงวดที่ปิดแล้ว (%)', v_locked USING ERRCODE = '42501';
  END IF;
  IF v_status = 'LIVE' AND NEW.balance_date < v_go_live AND private.is_client()
     AND (NOT private.has_role('ADMIN') OR length(trim(coalesce(NEW.notes,''))) = 0) THEN
    RAISE EXCEPTION 'OPENING_LOCKED: ยอดบัตรก่อน Go-live แก้ได้เฉพาะ ADMIN พร้อมเหตุผล (notes)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t90_period_lock BEFORE INSERT OR UPDATE ON public.credit_cards
  FOR EACH ROW EXECUTE FUNCTION private.tg_card_balance_lock();

-- =====================================================================
-- loan_details → cache
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_loan_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;   -- กันวนจาก refresh_loan เอง
  PERFORM private.refresh_loan(NEW.asset_id);
  RETURN NULL;
END $$;
CREATE TRIGGER a50_sync AFTER INSERT OR UPDATE ON public.loan_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_loan_sync();

-- ยอดตั้งต้นของเงินให้กู้ = Opening Position (Section 3, 14A, 19)
CREATE OR REPLACE FUNCTION private.tg_loan_opening_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_family uuid; v_go_live date; v_status text; v_locked date; v_min date;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.opening_outstanding_principal, NEW.opening_date)
                          IS NOT DISTINCT FROM (OLD.opening_outstanding_principal, OLD.opening_date) THEN
    RETURN NEW;
  END IF;
  SELECT a.family_id INTO v_family FROM public.assets a WHERE a.id = NEW.asset_id;
  SELECT go_live_date, system_status INTO v_go_live, v_status FROM public.families WHERE id = v_family;
  v_min := least(NEW.opening_date, CASE WHEN TG_OP = 'UPDATE' THEN OLD.opening_date END);
  IF v_status <> 'LIVE' OR v_min >= v_go_live THEN RETURN NEW; END IF;   -- เงินกู้ใหม่หลัง Go-live
  v_locked := private.locked_through(v_family);
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: ยอดตั้งต้นเงินให้กู้กระทบทุกเดือนหลัง Go-live ต้อง Reopen ถึงเดือนแรกก่อน'
      USING ERRCODE = '42501';
  END IF;
  IF private.is_client() AND (NOT private.has_role('ADMIN') OR length(trim(coalesce(NEW.notes, ''))) = 0) THEN
    RAISE EXCEPTION 'OPENING_LOCKED: ยอดตั้งต้นหลัง Go-live แก้ได้เฉพาะ ADMIN พร้อมเหตุผล (notes)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t90_period_lock BEFORE INSERT OR UPDATE ON public.loan_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_loan_opening_guard();

-- =====================================================================
-- investment_holdings: สถานะ / ลบ → คำนวณมูลค่าพอร์ตใหม่
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_holding_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;   -- refresh_holding เป็นผู้แก้เอง
  PERFORM private.refresh_portfolio_value(NEW.portfolio_id);
  RETURN NULL;
END $$;
CREATE TRIGGER a50_sync AFTER INSERT OR UPDATE ON public.investment_holdings
  FOR EACH ROW EXECUTE FUNCTION private.tg_holding_sync();

-- =====================================================================
-- investment_valuations: FX + base_value (Section 15, 16)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_investment_valuation_calc() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ccy text; r public.fx_rates;
BEGIN
  SELECT currency INTO v_ccy FROM public.investment_holdings WHERE id = NEW.holding_id;
  IF NEW.valuation_date > current_date THEN
    RAISE EXCEPTION 'INVALID: วันที่ Valuation เป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF v_ccy = 'THB' THEN
    NEW.fx_rate_id := NULL; NEW.base_value := NEW.market_value;
  ELSE
    r := private.fx_rate_row(v_ccy, NEW.valuation_date);
    NEW.fx_rate_id := r.id;
    NEW.base_value := round(NEW.market_value * r.rate_to_thb, 4);   -- NULL ถ้ายังไม่มี Rate → FX Check
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t50_calc BEFORE INSERT OR UPDATE ON public.investment_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_investment_valuation_calc();

CREATE OR REPLACE FUNCTION private.tg_investment_valuation_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.refresh_holding(coalesce(NEW.holding_id, OLD.holding_id));
  RETURN NULL;
END $$;
CREATE TRIGGER a50_sync AFTER INSERT OR UPDATE OR DELETE ON public.investment_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_investment_valuation_sync();

-- =====================================================================
-- investment_transactions (Section 13, 14, 25B)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_itx_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.investment_holdings; v_go_live date; v_bank uuid; v_bank_ccy text; v_rate numeric;
BEGIN
  SELECT f.go_live_date INTO v_go_live
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
    JOIN public.families f ON f.id = a.family_id WHERE p.id = NEW.portfolio_id;

  IF NEW.holding_id IS NOT NULL THEN
    SELECT * INTO h FROM public.investment_holdings WHERE id = NEW.holding_id;
    IF h.portfolio_id <> NEW.portfolio_id THEN
      RAISE EXCEPTION 'INVALID: Holding ไม่ได้อยู่ในพอร์ตนี้' USING ERRCODE = '22023';
    END IF;
    IF h.currency <> NEW.currency THEN
      RAISE EXCEPTION 'INVALID: สกุลรายการ (%) ต้องเท่ากับสกุล Holding (%)', NEW.currency, h.currency USING ERRCODE = '22023';
    END IF;
  END IF;

  v_bank := coalesce(NEW.settle_from_asset_id, NEW.settle_to_asset_id);
  IF v_bank IS NOT NULL THEN
    IF NOT private.is_bank_asset(v_bank) THEN
      RAISE EXCEPTION 'INVALID: settle_from/settle_to ต้องเป็นบัญชีธนาคาร' USING ERRCODE = '22023';
    END IF;
    SELECT currency INTO v_bank_ccy FROM public.assets WHERE id = v_bank;
    IF v_bank_ccy <> NEW.currency THEN
      RAISE EXCEPTION 'INVALID: บัญชีที่ชำระ (%) ต้องสกุลเดียวกับรายการ (%)', v_bank_ccy, NEW.currency USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Section 44A #5 / V1.1 #15: ฝาก/ถอนพอร์ตต้องเริ่มจาก Cash Movement (Transfer Money) เท่านั้น
  IF NEW.transaction_type IN ('DEPOSIT','WITHDRAWAL') AND NEW.cash_movement_id IS NULL THEN
    RAISE EXCEPTION 'INVALID: DEPOSIT / WITHDRAWAL ของพอร์ตบันทึกผ่าน Transfer Money เท่านั้น' USING ERRCODE = '22023';
  END IF;

  IF NEW.transaction_type = 'OPENING_BALANCE' THEN
    IF NEW.transaction_date >= v_go_live THEN
      RAISE EXCEPTION 'INVALID_OPENING: OPENING_BALANCE ต้องลงวันที่ก่อน Go-live (%)', v_go_live USING ERRCODE = '22023';
    END IF;
    NEW.amount := round(NEW.quantity * NEW.price, 4);                     -- Section 14
    NEW.cost_base_currency := coalesce(NEW.cost_base_currency,
        CASE WHEN NEW.currency = 'THB' THEN NEW.amount ELSE round(NEW.amount * NEW.actual_fx_rate, 4) END);
  ELSIF NEW.transaction_date < v_go_live THEN
    RAISE EXCEPTION 'BEFORE_GO_LIVE: รายการก่อน Go-live ต้องเป็น OPENING_BALANCE' USING ERRCODE = '22023';
  END IF;

  -- FX_EXCHANGE: คำนวณ actual_fx_rate ถ้าคู่มี THB
  IF NEW.transaction_type = 'FX_EXCHANGE' AND NEW.actual_fx_rate IS NULL THEN
    NEW.actual_fx_rate := CASE WHEN NEW.currency = 'THB' THEN round(NEW.amount / NEW.counter_amount, 10)
                               WHEN NEW.counter_currency = 'THB' THEN round(NEW.counter_amount / NEW.amount, 10) END;
  END IF;

  v_rate := CASE WHEN NEW.currency = 'THB' THEN 1
                 WHEN NEW.actual_fx_rate IS NOT NULL AND NEW.transaction_type <> 'FX_EXCHANGE' THEN NEW.actual_fx_rate
                 WHEN NEW.transaction_type = 'FX_EXCHANGE' AND NEW.counter_currency = 'THB' THEN NEW.actual_fx_rate
                 ELSE private.fx_rate(NEW.currency, NEW.transaction_date) END;
  NEW.amount_base_currency := round(NEW.amount * v_rate, 4);
  IF NEW.transaction_type = 'BUY' AND NEW.cost_base_currency IS NULL THEN
    NEW.cost_base_currency := round((NEW.amount + coalesce(NEW.fee, 0)) * v_rate, 4);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t50_check BEFORE INSERT OR UPDATE ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_itx_check();

CREATE OR REPLACE FUNCTION private.tg_itx_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.investment_transactions := coalesce(NEW, OLD);
  v_asset uuid; v_family uuid; v_name text;
  v_active boolean; v_net numeric; v_type text; v_from uuid; v_to uuid;
  inc public.income_transactions;
  v_need_inc boolean;
BEGIN
  SELECT p.asset_id, a.family_id, a.name INTO v_asset, v_family, v_name
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id WHERE p.id = t.portfolio_id;
  v_active := TG_OP <> 'DELETE' AND NEW.deleted_at IS NULL;

  IF t.cash_movement_id IS NULL THEN                       -- เป็น Source (ไม่ใช่ Derived จาก Movement)
    -- 1) Derived Cash Movement (Direct Settlement กับบัญชีธนาคาร)
    v_type := NULL; v_from := NULL; v_to := NULL; v_net := NULL;
    IF t.transaction_type = 'BUY' AND t.settle_from_asset_id IS NOT NULL THEN
      v_type := 'INVESTMENT_OUT'; v_from := t.settle_from_asset_id; v_to := v_asset;
      v_net := t.amount + coalesce(t.fee, 0);
    ELSIF t.transaction_type IN ('SELL','REDEMPTION','MATURITY') AND t.settle_to_asset_id IS NOT NULL THEN
      v_type := 'INVESTMENT_IN'; v_from := v_asset; v_to := t.settle_to_asset_id;
      v_net := t.amount - coalesce(t.fee, 0) - coalesce(t.tax, 0);
    ELSIF t.transaction_type IN ('DIVIDEND','INTEREST','COUPON') AND t.settle_to_asset_id IS NOT NULL THEN
      v_type := 'INCOME'; v_to := t.settle_to_asset_id;            -- รายได้จริง ไม่ใช่ INVESTMENT_IN
      v_net := t.amount - coalesce(t.fee, 0) - coalesce(t.tax, 0);
    END IF;
    PERFORM private.sync_derived_movement('INVESTMENT_TX', t.id, v_active AND v_type IS NOT NULL,
      v_family, coalesce(t.settlement_date, t.transaction_date), v_type, v_from, v_to, v_net, t.currency,
      t.transaction_type || ' · ' || v_name);

    -- 2) Derived Income (DIVIDEND / INTEREST / COUPON) — 1 Transaction = 1 Income Row
    v_need_inc := v_active AND t.transaction_type IN ('DIVIDEND','INTEREST','COUPON');
    SELECT * INTO inc FROM public.income_transactions WHERE source_transaction_id = t.id
     ORDER BY (deleted_at IS NULL) DESC, created_at DESC LIMIT 1;
    IF v_need_inc THEN
      IF inc.id IS NULL THEN
        INSERT INTO public.income_transactions(family_id, asset_id, source_transaction_id, date, income_type,
                                               amount, tax, currency, notes)
        VALUES (v_family, v_asset, t.id, t.transaction_date, t.transaction_type, t.amount, t.tax, t.currency,
                'Auto: ' || v_name);
      ELSIF (inc.date, inc.income_type, inc.amount, inc.tax, inc.currency, inc.asset_id, inc.deleted_at IS NULL)
            IS DISTINCT FROM (t.transaction_date, t.transaction_type, t.amount, t.tax, t.currency, v_asset, true) THEN
        UPDATE public.income_transactions SET date = t.transaction_date, income_type = t.transaction_type,
               amount = t.amount, tax = t.tax, currency = t.currency, asset_id = v_asset, deleted_at = NULL
         WHERE id = inc.id;
      END IF;
    ELSIF inc.id IS NOT NULL AND inc.deleted_at IS NULL THEN
      UPDATE public.income_transactions SET deleted_at = now() WHERE id = inc.id;
    END IF;
  END IF;

  -- 3) Holding cache (quantity / average_cost / value / status)
  IF TG_OP <> 'INSERT' AND OLD.holding_id IS NOT NULL THEN PERFORM private.refresh_holding(OLD.holding_id); END IF;
  IF TG_OP <> 'DELETE' AND NEW.holding_id IS NOT NULL THEN
    PERFORM private.refresh_holding(NEW.holding_id);
  END IF;
  -- CASH Holding ของพอร์ตได้รับผลจากทุกรายการในพอร์ต
  PERFORM private.refresh_holding(h.id) FROM public.investment_holdings h
   WHERE h.portfolio_id = t.portfolio_id AND h.holding_type = 'CASH' AND h.deleted_at IS NULL
     AND h.id IS DISTINCT FROM t.holding_id;
  RETURN NULL;
END $$;
CREATE TRIGGER a50_sync AFTER INSERT OR UPDATE OR DELETE ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_itx_sync();

-- =====================================================================
-- cash_movements (Section 25A)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_cash_movement_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  fa public.assets; ta public.assets;
  v_from_bank boolean; v_to_bank boolean; v_ccy text;
BEGIN
  NEW.family_id := coalesce(NEW.family_id, private.default_family_id());
  IF NEW.from_asset_id IS NOT NULL THEN SELECT * INTO fa FROM public.assets WHERE id = NEW.from_asset_id; END IF;
  IF NEW.to_asset_id   IS NOT NULL THEN SELECT * INTO ta FROM public.assets WHERE id = NEW.to_asset_id;   END IF;
  v_from_bank := NEW.from_asset_id IS NOT NULL AND private.is_bank_asset(NEW.from_asset_id);
  v_to_bank   := NEW.to_asset_id   IS NOT NULL AND private.is_bank_asset(NEW.to_asset_id);

  -- อย่างน้อย 1 ฝั่งเป็นบัญชีธนาคาร; ฝั่งที่เป็นบัญชีตามประเภท
  IF NOT (v_from_bank OR v_to_bank) THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: ต้องมีบัญชีธนาคารอย่างน้อย 1 ฝั่ง' USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type IN ('TRANSFER','FX_EXCHANGE') AND NOT (v_from_bank AND v_to_bank) THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: % ต้องเป็นบัญชีธนาคารทั้งสองฝั่ง', NEW.movement_type USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type IN ('EXPENSE','OTHER_OUT','SECURITY_DEPOSIT_OUT','CARD_PAYMENT','LIABILITY_PAYMENT',
                           'INVESTMENT_OUT','LOAN_DISBURSEMENT','ASSET_PURCHASE') AND NOT v_from_bank THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: % ต้องออกจากบัญชีธนาคาร', NEW.movement_type USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type IN ('INCOME','OTHER_IN','REIMBURSEMENT_IN','SECURITY_DEPOSIT_IN',
                           'INVESTMENT_IN','LOAN_PRINCIPAL_RECEIPT','ASSET_SALE') AND NOT v_to_bank THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: % ต้องเข้าบัญชีธนาคาร', NEW.movement_type USING ERRCODE = '22023';
  END IF;
  -- คู่สินทรัพย์ฝั่งตรงข้าม
  IF NEW.movement_type = 'INVESTMENT_OUT' AND ta.asset_group <> 'INVESTMENT' OR
     NEW.movement_type = 'INVESTMENT_IN'  AND fa.asset_group <> 'INVESTMENT' THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: INVESTMENT_OUT/IN ต้องคู่กับพอร์ตลงทุน' USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type = 'LOAN_DISBURSEMENT'      AND ta.asset_type <> 'LOAN_RECEIVABLE' OR
     NEW.movement_type = 'LOAN_PRINCIPAL_RECEIPT' AND fa.asset_type <> 'LOAN_RECEIVABLE' THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: เงินให้กู้ต้องคู่กับ Asset ประเภท LOAN_RECEIVABLE' USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type = 'ASSET_PURCHASE' AND (v_to_bank OR ta.asset_type IN ('INVESTMENT_PORTFOLIO','LOAN_RECEIVABLE')) OR
     NEW.movement_type = 'ASSET_SALE'     AND (v_from_bank OR fa.asset_type IN ('INVESTMENT_PORTFOLIO','LOAN_RECEIVABLE')) THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: ซื้อ/ขายสินทรัพย์ต้องคู่กับ Property / Alternative / Business' USING ERRCODE = '22023';
  END IF;

  -- สกุลเงิน (Section 25A โครงสร้าง Movement)
  IF NEW.from_asset_id IS NOT NULL AND fa.currency <> NEW.currency THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: สกุลต้นทาง (%) ต้องเท่ากับ currency (%)', fa.currency, NEW.currency USING ERRCODE = '22023';
  END IF;
  IF NEW.to_asset_id IS NOT NULL
     AND ta.currency <> (CASE WHEN NEW.movement_type = 'FX_EXCHANGE' THEN NEW.counter_currency ELSE NEW.currency END) THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: สกุลปลายทาง (%) ไม่ตรงกับรายการ', ta.currency USING ERRCODE = '22023';
  END IF;
  IF coalesce(NEW.fee, 0) > 0 AND NEW.fee_currency <> NEW.currency THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: fee_currency ต้องเท่ากับสกุลบัญชีต้นทาง' USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type = 'CARD_PAYMENT' THEN
    SELECT currency INTO v_ccy FROM public.credit_cards WHERE id = NEW.to_credit_card_id;
    IF v_ccy <> NEW.currency THEN RAISE EXCEPTION 'INVALID_CURRENCY: สกุลบัตรไม่ตรงกับรายการ' USING ERRCODE = '22023'; END IF;
  ELSIF NEW.movement_type = 'LIABILITY_PAYMENT' THEN
    SELECT currency INTO v_ccy FROM public.liabilities WHERE id = NEW.to_liability_id;
    IF v_ccy <> NEW.currency THEN RAISE EXCEPTION 'INVALID_CURRENCY: สกุลหนี้ไม่ตรงกับรายการ' USING ERRCODE = '22023'; END IF;
  END IF;

  -- FX_EXCHANGE: actual_fx_rate คำนวณจากยอดจริงสองฝั่ง (คู่ที่ไม่มี THB = NULL)
  IF NEW.movement_type = 'FX_EXCHANGE' THEN
    IF NEW.currency <> 'THB' AND NEW.counter_currency <> 'THB' THEN
      NEW.actual_fx_rate := NULL;
    ELSIF NEW.actual_fx_rate IS NULL THEN
      NEW.actual_fx_rate := CASE WHEN NEW.currency = 'THB' THEN round(NEW.amount / NEW.counter_amount, 10)
                                 ELSE round(NEW.counter_amount / NEW.amount, 10) END;
    END IF;
  ELSIF NEW.currency = 'THB' THEN
    NEW.actual_fx_rate := NULL;
  END IF;

  -- base_amount (THB): Rate จริง → Previous Available Rate
  NEW.base_amount := round(NEW.amount * CASE
      WHEN NEW.currency = 'THB' THEN 1
      WHEN NEW.actual_fx_rate IS NOT NULL THEN NEW.actual_fx_rate
      ELSE private.fx_rate(NEW.currency, NEW.movement_date) END, 4);
  RETURN NEW;
END $$;
CREATE TRIGGER t50_check BEFORE INSERT OR UPDATE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.tg_cash_movement_check();

CREATE OR REPLACE FUNCTION private.tg_cash_movement_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.cash_movements := coalesce(NEW, OLD);
  v_active boolean := TG_OP <> 'DELETE' AND NEW.deleted_at IS NULL;
  v_pf uuid; v_cash_holding uuid; x public.investment_transactions; e public.expense_items;
  v_kind text; v_need boolean; v_type text; v_amount numeric; v_monthly uuid;
  v_asset uuid;
BEGIN
  IF NOT m.is_derived THEN
    -- 1) Transfer Money: INVESTMENT_OUT/IN (Source) → DEPOSIT / WITHDRAWAL (+FEE) ในพอร์ต
    v_pf := CASE m.movement_type WHEN 'INVESTMENT_OUT' THEN private.portfolio_of_asset(m.to_asset_id)
                                 WHEN 'INVESTMENT_IN'  THEN private.portfolio_of_asset(m.from_asset_id) END;
    FOREACH v_kind IN ARRAY ARRAY['MAIN','FEE'] LOOP
      IF v_kind = 'MAIN' THEN
        v_type := CASE m.movement_type WHEN 'INVESTMENT_OUT' THEN 'DEPOSIT' ELSE 'WITHDRAWAL' END;
        v_amount := m.amount;
        v_need := v_active AND v_pf IS NOT NULL;
      ELSE
        v_type := 'FEE';                                   -- พอร์ต → ธนาคาร: fee เป็น Investment FEE
        v_amount := m.fee;
        v_need := v_active AND v_pf IS NOT NULL AND m.movement_type = 'INVESTMENT_IN' AND coalesce(m.fee, 0) > 0;
      END IF;
      SELECT * INTO x FROM public.investment_transactions
       WHERE cash_movement_id = m.id AND transaction_type IN (v_type, CASE v_kind WHEN 'MAIN' THEN 'DEPOSIT' END,
                                                             CASE v_kind WHEN 'MAIN' THEN 'WITHDRAWAL' END)
       ORDER BY created_at DESC LIMIT 1;
      IF v_need THEN
        SELECT h.id INTO v_cash_holding FROM public.investment_holdings h
         WHERE h.portfolio_id = v_pf AND h.holding_type = 'CASH' AND h.currency = m.currency AND h.deleted_at IS NULL
         ORDER BY h.created_at LIMIT 1;
        IF x.id IS NULL THEN
          INSERT INTO public.investment_transactions(portfolio_id, holding_id, transaction_date, transaction_type,
                                                     amount, currency, cash_movement_id, notes)
          VALUES (v_pf, v_cash_holding, m.movement_date, v_type, v_amount, m.currency, m.id,
                  'Auto: Transfer Money');
        ELSIF (x.portfolio_id, x.holding_id, x.transaction_date, x.transaction_type, x.amount, x.currency, x.deleted_at IS NULL)
              IS DISTINCT FROM (v_pf, v_cash_holding, m.movement_date, v_type, v_amount::numeric(20,4), m.currency, true) THEN
          UPDATE public.investment_transactions SET portfolio_id = v_pf, holding_id = v_cash_holding,
                 transaction_date = m.movement_date, transaction_type = v_type, amount = v_amount,
                 currency = m.currency, deleted_at = NULL
           WHERE id = x.id;
        END IF;
      ELSIF x.id IS NOT NULL AND x.deleted_at IS NULL THEN
        UPDATE public.investment_transactions SET deleted_at = now() WHERE id = x.id;
      END IF;
    END LOOP;

    -- 2) ค่าธรรมเนียมจากบัญชีธนาคาร → Derived Expense BANK_FEE (Section 11, 25)
    v_need := v_active AND coalesce(m.fee, 0) > 0 AND private.is_bank_asset(m.from_asset_id)
              AND coalesce((m.metadata ->> 'fee_as_expense')::boolean, true);
    SELECT * INTO e FROM public.expense_items WHERE source_cash_movement_id = m.id;
    IF v_need THEN
      v_monthly := private.ensure_monthly_expense(m.family_id, m.movement_date);
      IF e.id IS NULL THEN
        INSERT INTO public.expense_items(monthly_expense_id, date, description, amount, currency,
                                         expense_category, source_cash_movement_id)
        VALUES (v_monthly, m.movement_date, 'ค่าธรรมเนียม ' || m.movement_type || coalesce(' · ' || m.description, ''),
                m.fee, m.fee_currency, 'BANK_FEE', m.id);
      ELSIF (e.monthly_expense_id, e.date, e.amount, e.currency, e.deleted_at IS NULL)
            IS DISTINCT FROM (v_monthly, m.movement_date, m.fee, m.fee_currency, true) THEN
        UPDATE public.expense_items SET monthly_expense_id = v_monthly, date = m.movement_date,
               amount = m.fee, currency = m.fee_currency, deleted_at = NULL
         WHERE id = e.id;
      END IF;
    ELSIF e.id IS NOT NULL AND e.deleted_at IS NULL THEN
      UPDATE public.expense_items SET deleted_at = now() WHERE id = e.id;
    END IF;

    -- 3) เงินประกันเช่าที่รับเข้า → ตั้ง deposit_received_date ถ้ายังไม่มี
    IF v_active AND m.movement_type = 'SECURITY_DEPOSIT_IN' THEN
      UPDATE public.property_leases SET deposit_received_date = m.movement_date
       WHERE id = m.related_lease_id AND deposit_received_date IS NULL;
    END IF;
  END IF;

  -- 4) Loan cache (Section 19)
  FOR v_asset IN SELECT unnest(ARRAY[m.from_asset_id, m.to_asset_id,
                                     CASE WHEN TG_OP = 'UPDATE' THEN OLD.from_asset_id END,
                                     CASE WHEN TG_OP = 'UPDATE' THEN OLD.to_asset_id END])
  LOOP
    IF v_asset IS NOT NULL AND EXISTS (SELECT 1 FROM public.loan_details l WHERE l.asset_id = v_asset) THEN
      PERFORM private.refresh_loan(v_asset);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER a50_sync AFTER INSERT OR UPDATE OR DELETE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.tg_cash_movement_sync();

-- =====================================================================
-- income_transactions (Section 24)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_income_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_prop_asset uuid; v_ccy text;
BEGIN
  NEW.family_id := coalesce(NEW.family_id, private.default_family_id());
  IF NEW.lease_id IS NOT NULL THEN
    SELECT pd.asset_id INTO v_prop_asset FROM public.property_leases l
      JOIN public.property_details pd ON pd.id = l.property_id WHERE l.id = NEW.lease_id;
    IF NEW.asset_id IS NOT NULL AND NEW.asset_id <> v_prop_asset THEN
      RAISE EXCEPTION 'INVALID: asset_id ต้องเป็น Property ของสัญญาเช่า' USING ERRCODE = '22023';
    END IF;
    NEW.asset_id := v_prop_asset;
    NEW.person_id := NULL;                       -- แบ่งตาม Ownership ของ Property
  END IF;
  IF NEW.received_to_asset_id IS NOT NULL THEN
    IF NOT private.is_bank_asset(NEW.received_to_asset_id) THEN
      RAISE EXCEPTION 'INVALID: received_to_asset_id ต้องเป็นบัญชีธนาคาร' USING ERRCODE = '22023';
    END IF;
    SELECT currency INTO v_ccy FROM public.assets WHERE id = NEW.received_to_asset_id;
    IF v_ccy <> NEW.currency THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: รายได้ที่เข้าบัญชีต้องสกุลเดียวกับบัญชี (%) — บันทึกตามยอดที่เข้าบัญชีจริง', v_ccy
        USING ERRCODE = '22023';
    END IF;
  END IF;
  IF (NEW.lease_id IS NOT NULL OR NEW.recurring_template_id IS NOT NULL) AND NEW.income_period IS NULL THEN
    NEW.income_period := date_trunc('month', NEW.date)::date;
  END IF;
  NEW.base_amount := round(NEW.amount * private.fx_rate(NEW.currency, NEW.date), 4);
  RETURN NEW;
END $$;
CREATE TRIGGER t50_check BEFORE INSERT OR UPDATE ON public.income_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_income_check();

CREATE OR REPLACE FUNCTION private.tg_income_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.income_transactions := coalesce(NEW, OLD);
BEGIN
  IF i.source_transaction_id IS NOT NULL THEN RETURN NULL; END IF;   -- Derived Income ไม่สร้าง Movement ซ้ำ
  PERFORM private.sync_derived_movement('INCOME', i.id,
    TG_OP <> 'DELETE' AND NEW.deleted_at IS NULL AND i.received_to_asset_id IS NOT NULL,
    i.family_id, i.date, 'INCOME', NULL, i.received_to_asset_id,
    i.amount - coalesce(i.tax, 0), i.currency, i.income_type || coalesce(' · ' || i.notes, ''));
  RETURN NULL;
END $$;
CREATE TRIGGER a50_sync AFTER INSERT OR UPDATE OR DELETE ON public.income_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_income_sync();

-- =====================================================================
-- expense_items (Section 25)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_expense_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE me public.monthly_expenses; r public.fx_rates; v_ccy text;
BEGIN
  SELECT * INTO me FROM public.monthly_expenses WHERE id = NEW.monthly_expense_id;
  IF me.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'INVALID: เดือนค่าใช้จ่ายนี้ถูกลบแล้ว' USING ERRCODE = '22023';
  END IF;
  IF date_trunc('month', NEW.date)::date <> me.year_month THEN
    RAISE EXCEPTION 'INVALID: วันที่ % ไม่อยู่ในเดือน %', NEW.date, me.year_month USING ERRCODE = '22023';
  END IF;
  IF NEW.paid_from_asset_id IS NOT NULL THEN
    IF NOT private.is_bank_asset(NEW.paid_from_asset_id) THEN
      RAISE EXCEPTION 'INVALID: paid_from_asset_id ต้องเป็นบัญชีธนาคาร' USING ERRCODE = '22023';
    END IF;
    SELECT currency INTO v_ccy FROM public.assets WHERE id = NEW.paid_from_asset_id;
    IF v_ccy <> NEW.currency THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: จ่ายจากบัญชีต้องสกุลเดียวกับบัญชี (%)', v_ccy USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.currency = 'THB' THEN
    NEW.fx_rate_id := NULL; NEW.base_amount := NEW.amount;
  ELSE
    r := private.fx_rate_row(NEW.currency, NEW.date);
    NEW.fx_rate_id := r.id; NEW.base_amount := round(NEW.amount * r.rate_to_thb, 4);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t50_check BEFORE INSERT OR UPDATE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_expense_check();

CREATE OR REPLACE FUNCTION private.tg_expense_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.expense_items := coalesce(NEW, OLD); v_family uuid;
BEGIN
  SELECT family_id INTO v_family FROM public.monthly_expenses WHERE id = i.monthly_expense_id;
  IF i.source_cash_movement_id IS NULL THEN
    PERFORM private.sync_derived_movement('EXPENSE', i.id,
      TG_OP <> 'DELETE' AND NEW.deleted_at IS NULL AND i.paid_from_asset_id IS NOT NULL,
      v_family, i.date, 'EXPENSE', i.paid_from_asset_id, NULL, i.amount, i.currency, i.description);
    -- Item แรกที่ผู้ใช้บันทึกเอง: NOT_TRACKED → PARTIAL (Section 25 Expense Optional)
    IF TG_OP = 'INSERT' THEN
      UPDATE public.monthly_expenses SET tracking_status = 'PARTIAL'
       WHERE id = i.monthly_expense_id AND tracking_status = 'NOT_TRACKED';
    END IF;
  END IF;
  PERFORM private.refresh_monthly_expense(i.monthly_expense_id);
  IF TG_OP = 'UPDATE' AND OLD.monthly_expense_id <> NEW.monthly_expense_id THEN
    PERFORM private.refresh_monthly_expense(OLD.monthly_expense_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER a50_sync AFTER INSERT OR UPDATE OR DELETE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_expense_sync();

-- =====================================================================
-- expense_reimbursements (Section 25 Reimbursement)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_reimbursement_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_item_ccy text; v_ccy text;
BEGIN
  SELECT currency INTO v_item_ccy FROM public.expense_items WHERE id = NEW.expense_item_id;
  IF NEW.currency <> v_item_ccy THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: เงินคืนต้องสกุลเดียวกับค่าใช้จ่าย (%)', v_item_ccy USING ERRCODE = '22023';
  END IF;
  IF NEW.received_to_asset_id IS NOT NULL THEN
    IF NOT private.is_bank_asset(NEW.received_to_asset_id) THEN
      RAISE EXCEPTION 'INVALID: received_to_asset_id ต้องเป็นบัญชีธนาคาร' USING ERRCODE = '22023';
    END IF;
    SELECT currency INTO v_ccy FROM public.assets WHERE id = NEW.received_to_asset_id;
    IF v_ccy <> NEW.currency THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีรับเงินคืนต้องสกุลเดียวกับรายการ' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t50_check BEFORE INSERT OR UPDATE ON public.expense_reimbursements
  FOR EACH ROW EXECUTE FUNCTION private.tg_reimbursement_check();

CREATE OR REPLACE FUNCTION private.tg_reimbursement_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.expense_reimbursements := coalesce(NEW, OLD); v_family uuid;
BEGIN
  SELECT me.family_id INTO v_family FROM public.expense_items i
    JOIN public.monthly_expenses me ON me.id = i.monthly_expense_id WHERE i.id = r.expense_item_id;
  PERFORM private.sync_derived_movement('REIMBURSEMENT', r.id,
    TG_OP <> 'DELETE' AND NEW.deleted_at IS NULL AND r.received_to_asset_id IS NOT NULL,
    v_family, r.received_date, 'REIMBURSEMENT_IN', NULL, r.received_to_asset_id, r.amount, r.currency,
    'เงินคืนค่าใช้จ่าย');
  PERFORM private.refresh_claim(r.insurance_claim_id);
  IF TG_OP = 'UPDATE' AND OLD.insurance_claim_id IS DISTINCT FROM NEW.insurance_claim_id THEN
    PERFORM private.refresh_claim(OLD.insurance_claim_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER a50_sync AFTER INSERT OR UPDATE OR DELETE ON public.expense_reimbursements
  FOR EACH ROW EXECUTE FUNCTION private.tg_reimbursement_sync();

-- insurance_claims.received_amount = Cache เมื่อมี Reimbursement ผูก (กรอกเองได้ถ้าไม่มี)
CREATE OR REPLACE FUNCTION private.claim_has_reimbursements(p_claim uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.expense_reimbursements r
                  WHERE r.insurance_claim_id = p_claim AND r.deleted_at IS NULL)
$$;
CREATE OR REPLACE FUNCTION private.tg_claim_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF private.is_client() AND NEW.received_amount IS DISTINCT FROM OLD.received_amount
     AND private.claim_has_reimbursements(NEW.id) THEN
    RAISE EXCEPTION 'CACHE_FIELD: received_amount คำนวณจากเงินคืนที่ผูกกับ Claim นี้' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t20_cache BEFORE UPDATE ON public.insurance_claims
  FOR EACH ROW EXECUTE FUNCTION private.tg_claim_guard();

-- insurance_policies: cash_value_asset_id ต้องเป็น FINANCIAL / INSURANCE_CASH_VALUE (Section 26)
CREATE OR REPLACE FUNCTION private.tg_policy_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.cash_value_asset_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.assets a WHERE a.id = NEW.cash_value_asset_id
          AND a.asset_group = 'FINANCIAL' AND a.asset_type = 'INSURANCE_CASH_VALUE') THEN
    RAISE EXCEPTION 'INVALID_ASSET: cash_value_asset_id ต้องเป็น Asset FINANCIAL / INSURANCE_CASH_VALUE'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t50_check BEFORE INSERT OR UPDATE ON public.insurance_policies
  FOR EACH ROW EXECUTE FUNCTION private.tg_policy_check();

-- =====================================================================
-- property_leases (Section 22) — เงินประกัน / ยกไปสัญญาใหม่ / usage_type
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_lease_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$          -- INVOKER: ต้องเห็น current_user จริงใน is_client()
DECLARE o public.property_leases;
BEGIN
  IF coalesce(NEW.security_deposit, 0) > 0 THEN
    NEW.deposit_currency := coalesce(NEW.deposit_currency, NEW.rent_currency);
  END IF;
  IF NEW.deposit_carried_from_lease_id IS NOT NULL THEN
    SELECT * INTO o FROM public.property_leases WHERE id = NEW.deposit_carried_from_lease_id;
    IF o.property_id <> NEW.property_id THEN
      RAISE EXCEPTION 'INVALID: ยกเงินประกันได้เฉพาะสัญญาของ Property เดียวกัน' USING ERRCODE = '22023';
    END IF;
    IF NEW.deposit_carried_amount <> o.security_deposit OR NEW.deposit_currency <> o.deposit_currency THEN
      RAISE EXCEPTION 'INVALID: ยอดยกมาต้องเท่ากับเงินประกันของสัญญาเดิม (% %)', o.security_deposit, o.deposit_currency
        USING ERRCODE = '22023';
    END IF;
    IF o.deposit_settlement_type = 'REFUNDED' THEN
      RAISE EXCEPTION 'INVALID: สัญญาเดิมคืนเงินประกันไปแล้ว' USING ERRCODE = '22023';
    END IF;
    NEW.deposit_received_date := NEW.start_date;
  END IF;
  IF NEW.deposit_settlement_type = 'REFUNDED' THEN
    IF NEW.deposit_settled_date < coalesce(NEW.terminated_date, NEW.end_date) THEN
      RAISE EXCEPTION 'INVALID: คืนเงินประกันได้ตั้งแต่วันสิ้นสุดสัญญา (%)', coalesce(NEW.terminated_date, NEW.end_date)
        USING ERRCODE = '22023';
    END IF;
    IF NEW.deposit_settled_date > current_date THEN
      RAISE EXCEPTION 'INVALID: วันคืนเงินประกันเป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.deposit_settlement_type = 'CARRIED_TO_NEW_LEASE' AND private.is_client()
     AND (TG_OP = 'INSERT' OR OLD.deposit_settlement_type IS DISTINCT FROM 'CARRIED_TO_NEW_LEASE') THEN
    RAISE EXCEPTION 'INVALID: ยกเงินประกันทำโดยสร้างสัญญาใหม่ที่อ้าง deposit_carried_from_lease_id' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t50_check BEFORE INSERT OR UPDATE ON public.property_leases
  FOR EACH ROW EXECUTE FUNCTION private.tg_lease_check();
-- การ Settle เงินประกันต้องผ่าน settle_security_deposit() / การยกไปสัญญาใหม่ เท่านั้น
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.property_leases
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('deposit_settled_date','deposit_settlement_type','deposit_refunded_amount');

CREATE OR REPLACE FUNCTION private.tg_lease_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  -- สัญญาใหม่ยกเงินประกัน → ปิดหนี้ของสัญญาเดิมในวันเดียวกับที่สัญญาใหม่เริ่มนับ
  IF NEW.deposit_carried_from_lease_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
    UPDATE public.property_leases SET deposit_settled_date = NEW.start_date,
           deposit_settlement_type = 'CARRIED_TO_NEW_LEASE', deposit_refunded_amount = 0
     WHERE id = NEW.deposit_carried_from_lease_id
       AND (deposit_settled_date, deposit_settlement_type)
           IS DISTINCT FROM (NEW.start_date, 'CARRIED_TO_NEW_LEASE');
  ELSIF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
        AND NEW.deposit_carried_from_lease_id IS NOT NULL THEN
    -- ลบสัญญาใหม่ → สัญญาเดิมกลับมาถือเงินประกันต่อ
    UPDATE public.property_leases SET deposit_settled_date = NULL, deposit_settlement_type = NULL,
           deposit_refunded_amount = NULL
     WHERE id = NEW.deposit_carried_from_lease_id AND deposit_settlement_type = 'CARRIED_TO_NEW_LEASE';
  END IF;
  -- สร้าง Lease ใหม่ → Property เป็น RENTAL (Section 22 Usage Type)
  IF TG_OP = 'INSERT' THEN
    UPDATE public.property_details SET usage_type = 'RENTAL'
     WHERE id = NEW.property_id AND usage_type <> 'RENTAL';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER a50_sync AFTER INSERT OR UPDATE ON public.property_leases
  FOR EACH ROW EXECUTE FUNCTION private.tg_lease_sync();

-- =====================================================================
-- fx_rates: Client (ADMIN) เขียนได้เฉพาะ Override พร้อมเหตุผล + Audit FX_OVERRIDE
--          หลังมี Rate ใหม่ → เติม base_amount ที่ยังว่าง (Section 16)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_fx_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF private.is_client() THEN
    IF NOT private.has_role('ADMIN') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: FX Override ได้เฉพาะ ADMIN' USING ERRCODE = '42501';
    END IF;
    IF NEW.source <> 'ADMIN_OVERRIDE' OR NOT NEW.is_override THEN
      RAISE EXCEPTION 'INVALID: ผู้ใช้บันทึก FX ได้เฉพาะแบบ ADMIN_OVERRIDE พร้อม override_reason' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t50_check BEFORE INSERT OR UPDATE ON public.fx_rates
  FOR EACH ROW EXECUTE FUNCTION private.tg_fx_check();

CREATE OR REPLACE FUNCTION private.fill_missing_base_amounts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int := 0; k int; v_locked date := private.locked_through(private.default_family_id());
BEGIN
  -- แตะเฉพาะแถวที่ base ยังว่าง และไม่อยู่ในงวดที่ปิด (UPDATE no-op ให้ BEFORE trigger คำนวณใหม่)
  UPDATE public.cash_movements SET base_amount = base_amount
   WHERE base_amount IS NULL AND deleted_at IS NULL AND movement_date > coalesce(v_locked, '-infinity');
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.expense_items SET base_amount = base_amount
   WHERE base_amount IS NULL AND deleted_at IS NULL AND date > coalesce(v_locked, '-infinity');
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.income_transactions SET base_amount = base_amount
   WHERE base_amount IS NULL AND deleted_at IS NULL AND date > coalesce(v_locked, '-infinity');
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.investment_valuations SET base_value = base_value
   WHERE base_value IS NULL AND deleted_at IS NULL AND valuation_date > coalesce(v_locked, '-infinity');
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.investment_transactions SET amount_base_currency = amount_base_currency
   WHERE amount_base_currency IS NULL AND deleted_at IS NULL AND transaction_date > coalesce(v_locked, '-infinity');
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION private.tg_fx_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.is_override AND (TG_OP = 'INSERT' OR NEW.rate_to_thb IS DISTINCT FROM OLD.rate_to_thb) THEN
    PERFORM private.write_audit('FX_OVERRIDE', 'fx_rates', NEW.id::text,
      jsonb_build_object('rate_date', NEW.rate_date, 'currency', NEW.currency,
                         'rate_to_thb', NEW.rate_to_thb, 'reason', NEW.override_reason));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER a50_sync AFTER INSERT OR UPDATE ON public.fx_rates
  FOR EACH ROW EXECUTE FUNCTION private.tg_fx_sync();

-- เติม base_amount ครั้งเดียวต่อ Statement (FX Job ส่งหลายร้อยแถวต่อครั้ง)
CREATE OR REPLACE FUNCTION private.tg_fx_fill() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.fill_missing_base_amounts();
  RETURN NULL;
END $$;
CREATE TRIGGER a60_fill AFTER INSERT OR UPDATE ON public.fx_rates
  FOR EACH STATEMENT EXECUTE FUNCTION private.tg_fx_fill();

-- =====================================================================
-- Snapshot: FINAL แก้ไม่ได้ (Section 6.1, 34) — รวม Trusted
--   ยกเว้น reopen_month (FINAL → DRAFT) และผูก pdf_document_id
-- =====================================================================
CREATE OR REPLACE FUNCTION private.tg_snapshot_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'FINAL' THEN
    IF NEW.status = 'DRAFT' AND current_setting('fwv.reopening', true) = 'on' THEN
      RETURN NEW;                                   -- ตั้งเฉพาะใน reopen_month
    END IF;
    IF (to_jsonb(NEW) - ARRAY['pdf_document_id','updated_at','updated_by'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['pdf_document_id','updated_at','updated_by']) THEN
      RAISE EXCEPTION 'FINAL_SNAPSHOT: Snapshot ที่ FINAL แก้ไม่ได้ ต้อง Reopen' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t40_final_guard BEFORE UPDATE ON public.net_worth_snapshots
  FOR EACH ROW EXECUTE FUNCTION private.tg_snapshot_guard();

CREATE OR REPLACE FUNCTION private.tg_snapshot_child_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'FINAL_SNAPSHOT: Snapshot Item / Line แก้ไม่ได้ (สร้างใหม่ตอน Finalize)' USING ERRCODE = '42501';
  END IF;
  SELECT s.status INTO v_status FROM public.net_worth_snapshots s
   WHERE s.id = coalesce(NEW.snapshot_id, OLD.snapshot_id);
  IF v_status = 'FINAL' THEN
    RAISE EXCEPTION 'FINAL_SNAPSHOT: Snapshot ที่ FINAL เพิ่ม/ลบรายการไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF private.is_client() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Snapshot สร้างผ่าน finalize_month() เท่านั้น' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER t40_final_guard BEFORE INSERT OR UPDATE OR DELETE ON public.net_worth_snapshot_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_snapshot_child_guard();
CREATE TRIGGER t40_final_guard BEFORE INSERT OR UPDATE OR DELETE ON public.net_worth_snapshot_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_snapshot_child_guard();
