-- =====================================================================
-- Scenario Test — รันหลัง migrations (ด้วย tests/run.sh)
-- ใช้ Go-live 01 Jul 2026 เพื่อให้ปิดเดือน Jul/Aug ได้จริง (วันนี้ = Oct 2026)
-- ทุกขั้นตอนรันเป็น Role จริงของ Supabase (authenticated / service_role)
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
SET client_min_messages = notice;

-- ---------- test helpers ----------
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE FUNCTION t.login(p uuid) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claims', CASE WHEN p IS NULL THEN '' ELSE json_build_object('sub', p, 'role', 'authenticated')::text END, false) $$;
CREATE FUNCTION t.ok(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'TEST FAILED: %', msg; END IF;
  RAISE NOTICE 'PASS: %', msg;
END $$;
CREATE FUNCTION t.fails(p_sql text, p_pattern text, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    IF SQLERRM ~* p_pattern THEN RAISE NOTICE 'PASS: % → %', msg, left(SQLERRM, 90); RETURN; END IF;
    RAISE EXCEPTION 'TEST FAILED: % — wrong error: %', msg, SQLERRM;
  END;
  RAISE EXCEPTION 'TEST FAILED: % — expected an error', msg;
END $$;
CREATE FUNCTION t.a(p_name text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT id FROM public.assets WHERE name = p_name $$;
CREATE FUNCTION t.p(p_name text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT id FROM public.persons WHERE name = p_name $$;
CREATE FUNCTION t.h(p_name text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT id FROM public.investment_holdings WHERE name = p_name $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO anon, authenticated, service_role;

INSERT INTO auth.users(id, email) VALUES
 ('00000000-0000-0000-0000-00000000000a','admin@fam.test'),
 ('00000000-0000-0000-0000-00000000000b','admin2@fam.test'),
 ('00000000-0000-0000-0000-00000000000e','editor@fam.test'),
 ('00000000-0000-0000-0000-00000000000c','contrib@fam.test'),
 ('00000000-0000-0000-0000-00000000000f','viewer@fam.test'),
 ('00000000-0000-0000-0000-00000000000d','disabled@fam.test'),
 ('00000000-0000-0000-0000-000000000099','dup@fam.test');

\echo '== 1. Bootstrap (service_role)'
SET ROLE service_role; SELECT t.login(NULL);
SELECT public.server_bootstrap_family('ครอบครัวทดสอบ', '2026-07-01', '00000000-0000-0000-0000-00000000000a', 'Admin@Fam.test', 'คุณพ่อ') IS NOT NULL AS bootstrapped;
SELECT t.fails($$SELECT public.server_bootstrap_family('x','2026-07-01','00000000-0000-0000-0000-00000000000b','b@x.test')$$,
               'ครอบครัวในระบบแล้ว', 'bootstrap ได้ครั้งเดียว');
DO $$ DECLARE a uuid := (SELECT id FROM public.app_users WHERE role = 'ADMIN');
BEGIN
  PERFORM public.server_register_invited_user('00000000-0000-0000-0000-00000000000b','admin2@fam.test','ADMIN', a);
  PERFORM public.server_register_invited_user('00000000-0000-0000-0000-00000000000e','editor@fam.test','EDITOR', a);
  PERFORM public.server_register_invited_user('00000000-0000-0000-0000-00000000000c','contrib@fam.test','CONTRIBUTOR', a);
  PERFORM public.server_register_invited_user('00000000-0000-0000-0000-00000000000f','viewer@fam.test','VIEWER', a);
  PERFORM public.server_register_invited_user('00000000-0000-0000-0000-00000000000d','disabled@fam.test','EDITOR', a);
END $$;
SELECT t.fails($$SELECT public.server_register_invited_user('00000000-0000-0000-0000-000000000099','DISABLED@Fam.test','EDITOR',
                 (SELECT id FROM public.app_users WHERE role='ADMIN' LIMIT 1))$$, 'app_users_email_ci_uq', 'email ซ้ำแบบ case-insensitive');
-- FX: USD ทุกวัน 1 Jun – 3 Oct 2026
SELECT public.server_upsert_fx_rates((
  SELECT jsonb_agg(jsonb_build_object('rate_date', d::date, 'currency', 'USD',
                   'rate_to_thb', 35 + (extract(doy FROM d)::int % 10) / 100.0, 'source_reference', 'TEST'))
    FROM generate_series('2026-06-01'::date, '2026-10-03'::date, '1 day') d)) AS fx_rows;

\echo '== 2. Login + roles'
SET ROLE authenticated;
SELECT t.login('00000000-0000-0000-0000-00000000000a'); SELECT public.record_login();
SELECT t.login('00000000-0000-0000-0000-00000000000b'); SELECT public.record_login();
SELECT t.login('00000000-0000-0000-0000-00000000000e'); SELECT public.record_login();
SELECT t.login('00000000-0000-0000-0000-00000000000c'); SELECT public.record_login();
SELECT t.login('00000000-0000-0000-0000-00000000000f'); SELECT public.record_login();
SELECT t.login('00000000-0000-0000-0000-00000000000d'); SELECT public.record_login();
SELECT t.login('00000000-0000-0000-0000-00000000000a');
SELECT public.admin_set_user_status((SELECT id FROM public.app_users WHERE email = 'disabled@fam.test'), 'DISABLED');
SELECT public.admin_set_user_role((SELECT id FROM public.app_users WHERE email='admin2@fam.test'),'EDITOR');
SELECT t.fails($$SELECT public.admin_set_user_role((SELECT id FROM public.app_users WHERE email='admin@fam.test'),'EDITOR')$$,
               'ADMIN ที่ ACTIVE อย่างน้อย', 'ห้ามลด ADMIN คนสุดท้าย');
SELECT public.admin_set_user_role((SELECT id FROM public.app_users WHERE email='admin2@fam.test'),'ADMIN');
SELECT t.login('00000000-0000-0000-0000-00000000000e');
UPDATE public.app_users SET role = 'ADMIN' WHERE auth_user_id = auth.uid();
SELECT t.ok((SELECT role FROM public.app_users WHERE auth_user_id = auth.uid()) = 'EDITOR', 'EDITOR เปลี่ยน role ตัวเองไม่ได้ (RLS)');
SELECT t.ok((SELECT count(*) FROM public.app_users) = 1, 'EDITOR เห็น app_users เฉพาะของตัวเอง');

\echo '== 3. Opening Setup (SETUP) โดย EDITOR'
INSERT INTO public.persons(family_id, name, relationship)
  SELECT id, 'คุณแม่', 'SPOUSE' FROM public.families;
-- บัญชี THB
INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency)
  SELECT id, 'FINANCIAL', 'BANK_ACCOUNT', 'KBank ออมทรัพย์', 'THB' FROM public.families;
INSERT INTO public.bank_accounts(asset_id, bank_name, account_type) VALUES (t.a('KBank ออมทรัพย์'), 'KBank', 'SAVING');
INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
  VALUES (t.a('KBank ออมทรัพย์'), t.p('คุณพ่อ'), 100, '2020-01-01');
INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening)
  VALUES (t.a('KBank ออมทรัพย์'), '2026-06-30', 1000000, 'STATEMENT', 'OPENING', true);
SELECT t.fails($$INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
                 VALUES (t.a('KBank ออมทรัพย์'), t.p('คุณแม่'), 10, '2026-01-01')$$, 'OWNERSHIP_OVER_100', 'Ownership เกิน 100% ถูกปฏิเสธ');
SELECT t.fails($$UPDATE public.assets SET current_value = 1 WHERE name = 'KBank ออมทรัพย์'$$, 'CACHE_FIELD', 'Client แก้ Cache Field ไม่ได้');
SELECT t.ok((SELECT current_value FROM public.assets WHERE name = 'KBank ออมทรัพย์') = 1000000, 'assets.current_value Cache = ยอดตั้งต้น');
-- บัญชี USD (ร่วม 50/50)
INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency)
  SELECT id, 'FINANCIAL', 'BANK_ACCOUNT', 'BBL USD', 'USD' FROM public.families;
INSERT INTO public.bank_accounts(asset_id, bank_name, account_type) VALUES (t.a('BBL USD'), 'BBL', 'FOREIGN_CURRENCY');
INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date) VALUES
  (t.a('BBL USD'), t.p('คุณพ่อ'), 50, '2020-01-01'), (t.a('BBL USD'), t.p('คุณแม่'), 50, '2020-01-01');
INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening)
  VALUES (t.a('BBL USD'), '2026-06-30', 10000, 'STATEMENT', 'OPENING', true);
-- บ้าน
INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency)
  SELECT id, 'PROPERTY', 'HOUSE', 'บ้าน A', 'THB' FROM public.families;
INSERT INTO public.property_details(asset_id, property_type, usage_type, land_area_sq_wa)
  VALUES (t.a('บ้าน A'), 'HOUSE', 'OWNER_OCCUPIED', 1371);
INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date) VALUES
  (t.a('บ้าน A'), t.p('คุณพ่อ'), 60, '2020-01-01'), (t.a('บ้าน A'), t.p('คุณแม่'), 40, '2020-01-01');
INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening)
  VALUES (t.a('บ้าน A'), '2026-06-30', 10000000, 'APPRAISAL', 'OPENING', true);
INSERT INTO public.property_leases(property_id, unit_label, tenant_name, start_date, end_date, rent_amount,
            payment_due_day, security_deposit, deposit_received_date)
  SELECT id, 'ชั้น 2', 'ผู้เช่า ก', '2026-01-01', '2026-12-31', 25000, 5, 30000, '2026-01-01'
    FROM public.property_details WHERE asset_id = t.a('บ้าน A');
SELECT t.ok((SELECT usage_type FROM public.property_details WHERE asset_id = t.a('บ้าน A')) = 'RENTAL', 'สร้าง Lease → usage_type = RENTAL');
-- พอร์ต USD
INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency)
  SELECT id, 'INVESTMENT', 'INVESTMENT_PORTFOLIO', 'Brokerage USD', 'USD' FROM public.families;
INSERT INTO public.investment_portfolios(asset_id, institution) VALUES (t.a('Brokerage USD'), 'IB');
INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
  VALUES (t.a('Brokerage USD'), t.p('คุณพ่อ'), 100, '2020-01-01');
INSERT INTO public.investment_holdings(portfolio_id, holding_type, name, currency)
  SELECT p.id, x.ht, x.nm, 'USD' FROM public.investment_portfolios p,
         (VALUES ('CASH','Cash USD'), ('EQUITY','AAPL')) x(ht, nm);
INSERT INTO public.investment_transactions(portfolio_id, holding_id, transaction_date, transaction_type, quantity, price, currency, actual_fx_rate)
  SELECT portfolio_id, id, '2026-06-30', 'OPENING_BALANCE', 5000, 1, 'USD', 35 FROM public.investment_holdings WHERE name = 'Cash USD';
INSERT INTO public.investment_transactions(portfolio_id, holding_id, transaction_date, transaction_type, quantity, price, currency, actual_fx_rate)
  SELECT portfolio_id, id, '2026-06-30', 'OPENING_BALANCE', 10, 150, 'USD', 33 FROM public.investment_holdings WHERE name = 'AAPL';
INSERT INTO public.investment_valuations(holding_id, valuation_date, price, quantity, market_value) VALUES
  (t.h('AAPL'), '2026-06-30', 200, 10, 2000), (t.h('Cash USD'), '2026-06-30', 1, 5000, 5000);
SELECT t.ok((SELECT quantity = 10 AND average_cost = 150 AND current_value = 2000 FROM public.investment_holdings WHERE name = 'AAPL'),
            'Holding cache: qty 10, avg cost 150, value 2000');
SELECT t.ok((SELECT current_value FROM public.assets WHERE name = 'Brokerage USD') = 7000, 'Portfolio Display Value = 7,000 USD');
-- เงินให้กู้
INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency)
  SELECT id, 'FINANCIAL', 'LOAN_RECEIVABLE', 'เงินกู้ญาติ', 'THB' FROM public.families;
INSERT INTO public.loan_details(asset_id, borrower_name, principal, opening_outstanding_principal, opening_date)
  VALUES (t.a('เงินกู้ญาติ'), 'ญาติ', 600000, 500000, '2026-06-30');
INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
  VALUES (t.a('เงินกู้ญาติ'), t.p('คุณแม่'), 100, '2020-01-01');
SELECT t.ok((SELECT current_value FROM public.assets WHERE name = 'เงินกู้ญาติ') = 500000, 'Loan value = opening outstanding');
-- ตารางผ่อน: ตั้ง / แก้ทั้งชุด ได้ก่อนบันทึกรับชำระครั้งแรก
SELECT t.login('00000000-0000-0000-0000-00000000000c');
SELECT t.fails($$SELECT public.set_loan_schedule(t.a('เงินกู้ญาติ'), '[{"due_date":"2026-02-28","principal":1}]')$$,
  'PERMISSION_DENIED', 'CONTRIBUTOR ตั้งตารางผ่อนทั้งชุดไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT t.fails($$SELECT public.set_loan_schedule(t.a('บ้าน A'), '[{"due_date":"2026-02-28","principal":1}]')$$,
  'ไม่พบเงินให้กู้', 'ตารางผ่อนผูกได้เฉพาะเงินให้กู้');
SELECT t.fails($$SELECT public.set_loan_schedule(t.a('เงินกู้ญาติ'), '[{"due_date":"2026-02-28","principal":0}]')$$,
  'มากกว่า 0', 'งวดยอด 0 ไม่ได้');
SELECT t.ok(public.set_loan_schedule(t.a('เงินกู้ญาติ'), '[{"due_date":"2027-01-31","principal":450000}]') = 1, 'ตั้งตาราง 1 งวด');
-- ทั้งสัญญา 600,000: 6 งวด ๆ ละ 100,000 + ดอก 2,500 (ก.พ.–ก.ค.) + งวดอนาคต (ดอกอย่างเดียว)
SELECT t.ok(public.set_loan_schedule(t.a('เงินกู้ญาติ'), jsonb_build_array(
  jsonb_build_object('due_date', '2026-07-31', 'principal', 100000, 'interest', 2500),
  jsonb_build_object('due_date', '2026-02-28', 'principal', 100000, 'interest', 2500),
  jsonb_build_object('due_date', '2026-03-31', 'principal', 100000, 'interest', 2500),
  jsonb_build_object('due_date', '2026-04-30', 'principal', 100000, 'interest', 2500),
  jsonb_build_object('due_date', '2026-05-31', 'principal', 100000, 'interest', 2500),
  jsonb_build_object('due_date', '2026-06-30', 'principal', 100000, 'interest', 2500),
  jsonb_build_object('due_date', current_date + 20, 'interest', 2500))) = 7, 'แก้ทั้งชุด (ยังไม่รับชำระ) → 7 งวด');
SELECT t.ok((SELECT count(*) FROM public.loan_schedule_lines WHERE deleted_at IS NULL) = 7
            AND (SELECT count(*) FROM public.loan_schedule_lines WHERE deleted_at IS NOT NULL) = 1,
            'แก้ทั้งชุด → แทนที่ของเดิม (soft delete)');
SELECT t.ok((SELECT due_date = current_date + 20 AND derived_status = 'DUE_SOON' FROM public.v_loans_status),
            'วันครบกำหนดสัญญา = งวดสุดท้ายของตาราง · เตือนใกล้ครบ');
SELECT t.ok((SELECT installment_no = 1 FROM public.loan_schedule_lines WHERE due_date = '2026-02-28' AND deleted_at IS NULL),
            'เรียงเลขงวดตามวันที่ให้เอง');
UPDATE public.loan_schedule_lines SET notes = 'ตรวจตารางที่นำเข้า' WHERE installment_no = 1 AND deleted_at IS NULL;
SELECT t.ok((SELECT notes = 'ตรวจตารางที่นำเข้า' FROM public.loan_schedule_lines WHERE installment_no = 1 AND deleted_at IS NULL),
            'ยังไม่รับชำระ: งวดที่ขึ้นรับแล้ว (จากยอดยกมา) ยังแก้ได้');
-- หนี้บ้าน
INSERT INTO public.liabilities(family_id, liability_type, name, lender, currency, monthly_payment, payment_due_day)
  SELECT id, 'MORTGAGE', 'สินเชื่อบ้าน', 'SCB', 'THB', 30000, 1 FROM public.families;
INSERT INTO public.liability_valuations(liability_id, valuation_date, balance, source, is_opening)
  SELECT id, '2026-06-30', 3000000, 'OPENING', true FROM public.liabilities;
INSERT INTO public.liability_ownerships(liability_id, person_id, responsibility_percent)
  SELECT id, t.p('คุณพ่อ'), 100 FROM public.liabilities;
SELECT t.ok((SELECT outstanding_amount FROM public.liabilities) = 3000000, 'liabilities.outstanding_amount Cache');
-- บัตรเครดิต
INSERT INTO public.credit_cards(person_id, issuer, card_name, card_last4, outstanding_balance, balance_date)
  VALUES (t.p('คุณพ่อ'), 'SCB', 'Prestige', '7788', 20000, '2026-06-25');

\echo '== 4. Go-live'
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.v_go_live_readiness WHERE status = 'MISSING'), 'Readiness ไม่มี MISSING');
SELECT t.fails($$SELECT public.confirm_go_live()$$, 'PERMISSION_DENIED', 'EDITOR Confirm Go-live ไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000a');
SELECT public.confirm_go_live() ->> 'status' AS go_live_status;
SELECT t.fails($$UPDATE public.families SET go_live_date = '2026-08-01'$$, 'GO_LIVE_LOCKED', 'หลัง LIVE แก้ go_live_date ไม่ได้');

\echo '== 5. July transactions (EDITOR)'
SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT t.fails($$INSERT INTO public.income_transactions(family_id, date, income_type, amount, currency)
                 SELECT id, '2026-06-15', 'OTHER', 100, 'THB' FROM public.families$$, 'BEFORE_GO_LIVE', 'รายการก่อน Go-live ถูกปฏิเสธ');
SELECT t.fails($$UPDATE public.asset_valuations SET value = 1 WHERE is_opening AND asset_id = t.a('บ้าน A')$$,
               'OPENING_LOCKED', 'EDITOR แก้ยอดตั้งต้นหลัง LIVE ไม่ได้');
-- Recurring salary
INSERT INTO public.recurring_income_templates(family_id, person_id, name, income_type, expected_amount, due_day, receive_to_asset_id, start_date)
  SELECT id, t.p('คุณพ่อ'), 'เงินเดือน บริษัท A', 'SALARY', 100000, 25, t.a('KBank ออมทรัพย์'), '2026-01-01' FROM public.families;
INSERT INTO public.income_transactions(family_id, person_id, recurring_template_id, received_to_asset_id, date, income_type, amount, tax, currency)
  SELECT id, t.p('คุณพ่อ'), (SELECT id FROM public.recurring_income_templates), t.a('KBank ออมทรัพย์'), '2026-07-25', 'SALARY', 100000, 5000, 'THB'
    FROM public.families;
SELECT t.ok((SELECT amount FROM public.cash_movements WHERE source_entity_type = 'INCOME' AND movement_type = 'INCOME') = 95000,
            'Income → Derived Movement INCOME = amount − tax (95,000)');
SELECT t.fails($$UPDATE public.cash_movements SET amount = 1 WHERE is_derived$$, 'DERIVED_RECORD', 'แก้ Derived Movement ตรงไม่ได้');
SELECT t.fails($$INSERT INTO public.cash_movements(family_id, movement_date, movement_type, to_asset_id, amount, currency, is_derived, source_entity_type, source_entity_id)
                 SELECT id, '2026-07-02', 'INCOME', t.a('KBank ออมทรัพย์'), 1, 'THB', true, 'INCOME', gen_random_uuid() FROM public.families$$,
               'DERIVED_RECORD', 'Client สร้าง Derived Movement ไม่ได้');
-- Rent (Lease) เข้า KBank
INSERT INTO public.income_transactions(family_id, lease_id, received_to_asset_id, date, income_type, amount, currency)
  SELECT f.id, l.id, t.a('KBank ออมทรัพย์'), '2026-07-05', 'RENT', 25000, 'THB' FROM public.families f, public.property_leases l;
SELECT t.ok((SELECT asset_id = t.a('บ้าน A') AND income_period = '2026-07-01' FROM public.income_transactions WHERE income_type = 'RENT'),
            'RENT: asset_id + income_period ตั้งจาก Lease');
-- Expenses
INSERT INTO public.monthly_expenses(family_id, year_month) SELECT id, '2026-07-01' FROM public.families;
INSERT INTO public.expense_items(monthly_expense_id, paid_from_asset_id, date, description, amount, currency)
  SELECT id, t.a('KBank ออมทรัพย์'), '2026-07-10', 'ค่าใช้จ่ายทั่วไป ก.ค.', 30000, 'THB' FROM public.monthly_expenses;
INSERT INTO public.expense_items(monthly_expense_id, paid_from_credit_card_id, date, description, amount, currency, is_reimbursable, expected_reimbursement_amount)
  SELECT m.id, c.id, '2026-07-12', 'ค่ารักษาพยาบาล (เคลมได้)', 8000, 'THB', true, 8000 FROM public.monthly_expenses m, public.credit_cards c;
SELECT t.ok((SELECT tracking_status = 'PARTIAL' AND total_amount = 38000 FROM public.monthly_expenses), 'Expense: PARTIAL + total 38,000');
SELECT t.ok((SELECT count(*) FROM public.cash_movements WHERE movement_type = 'EXPENSE') = 1, 'จ่ายบัญชี → 1 Movement; รูดบัตร → ไม่มี Movement');
-- Transfer Money ธนาคาร USD → พอร์ต (fee 10)
SELECT public.transfer_money(t.a('BBL USD'), t.a('Brokerage USD'), 1000, '2026-07-15', 10, 'เติมเงินพอร์ต') IS NOT NULL AS transferred;
SELECT t.ok((SELECT count(*) FROM public.investment_transactions WHERE transaction_type = 'DEPOSIT' AND cash_movement_id IS NOT NULL) = 1,
            'Transfer → Derived DEPOSIT ในพอร์ต');
SELECT t.ok((SELECT amount = 10 AND expense_category = 'BANK_FEE' FROM public.expense_items WHERE source_cash_movement_id IS NOT NULL),
            'ค่าธรรมเนียมโอน → Derived Expense BANK_FEE');
SELECT t.ok((SELECT tracking_status FROM public.monthly_expenses) = 'PARTIAL', 'Derived Fee ไม่เปลี่ยน tracking_status');
SELECT t.ok((SELECT in_transit FROM public.v_portfolio_values) = 1000, 'In-transit = 1,000 USD (รอ Statement)');
-- Direct BUY จากบัญชี USD (Trade 30 Jul, Settle 3 Aug)
INSERT INTO public.investment_holdings(portfolio_id, holding_type, name, symbol, currency)
  SELECT id, 'EQUITY', 'MSFT', 'MSFT', 'USD' FROM public.investment_portfolios;
INSERT INTO public.investment_transactions(portfolio_id, holding_id, transaction_date, settlement_date, transaction_type, quantity, price, amount, fee, currency, settle_from_asset_id)
  SELECT portfolio_id, id, '2026-07-30', '2026-08-03', 'BUY', 2, 400, 800, 5, 'USD', t.a('BBL USD') FROM public.investment_holdings WHERE name = 'MSFT';
SELECT t.ok((SELECT amount = 805 AND movement_date = '2026-08-03' AND movement_type = 'INVESTMENT_OUT'
               FROM public.cash_movements WHERE source_entity_type = 'INVESTMENT_TX'),
            'Direct BUY → INVESTMENT_OUT = amount + fee (805) วันที่ Settlement');
SELECT t.ok((SELECT current_value = 805 FROM public.investment_holdings WHERE name = 'MSFT'), 'Holding ใหม่ยังไม่มี Statement → ราคาทุน 805');
-- Dividend AAPL เข้าบัญชีตรง
INSERT INTO public.investment_transactions(portfolio_id, holding_id, transaction_date, transaction_type, amount, tax, currency, settle_to_asset_id)
  SELECT portfolio_id, id, '2026-07-20', 'DIVIDEND', 20, 2, 'USD', t.a('BBL USD') FROM public.investment_holdings WHERE name = 'AAPL';
SELECT t.ok((SELECT count(*) FROM public.income_transactions WHERE source_transaction_id IS NOT NULL) = 1, 'DIVIDEND → Derived Income 1 แถว');
SELECT t.ok((SELECT amount FROM public.cash_movements WHERE source_entity_type = 'INVESTMENT_TX' AND movement_type = 'INCOME') = 18,
            'DIVIDEND เข้าบัญชี → Movement INCOME = 18 (ไม่ใช่ INVESTMENT_IN)');
SELECT t.fails($$UPDATE public.income_transactions SET amount = 1 WHERE source_transaction_id IS NOT NULL$$, 'DERIVED_RECORD', 'Derived Income Lock');
-- Loan payment
SELECT public.receive_loan_payment(t.a('เงินกู้ญาติ'), t.a('KBank ออมทรัพย์'), '2026-07-28', 50000, 2500) IS NOT NULL AS loan_paid;
SELECT t.ok((SELECT outstanding_principal FROM public.loan_details) = 450000, 'Loan outstanding 500,000 − 50,000 = 450,000');
SELECT t.ok((SELECT count(DISTINCT movement_group_id) = 1 AND count(*) = 2 FROM public.cash_movements
              WHERE movement_group_id IS NOT NULL), 'เงินต้น + ดอกเบี้ย ผูก movement_group_id เดียวกัน');
-- Card payment + update card balance
INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_credit_card_id, amount, currency)
  SELECT f.id, '2026-07-26', 'CARD_PAYMENT', t.a('KBank ออมทรัพย์'), c.id, 20000, 'THB' FROM public.families f, public.credit_cards c;
UPDATE public.credit_cards SET outstanding_balance = 8000, balance_date = '2026-07-25';
-- Mortgage + valuations ปลายเดือน
INSERT INTO public.liability_valuations(liability_id, valuation_date, balance, source)
  SELECT id, '2026-07-31', 2990000, 'STATEMENT' FROM public.liabilities;
INSERT INTO public.investment_valuations(holding_id, valuation_date, price, quantity, market_value) VALUES
  (t.h('AAPL'), '2026-07-31', 210, 10, 2100), (t.h('Cash USD'), '2026-07-31', 1, 6000, 6000);
SELECT t.ok((SELECT in_transit FROM public.v_portfolio_values) = 0, 'Statement ใหม่ ≥ วันโอน → In-transit หายเอง');

\echo '== 6. Permissions: CONTRIBUTOR / VIEWER / DISABLED'
SELECT t.login('00000000-0000-0000-0000-00000000000c');
INSERT INTO public.expense_items(monthly_expense_id, date, description, amount, currency, person_id)
  SELECT id, '2026-07-18', 'ค่าอาหาร (เงินสด)', 1500, 'THB', t.p('คุณแม่') FROM public.monthly_expenses;
UPDATE public.expense_items SET amount = 1600 WHERE description = 'ค่าอาหาร (เงินสด)';
SELECT t.ok((SELECT amount FROM public.expense_items WHERE description = 'ค่าอาหาร (เงินสด)') = 1600, 'CONTRIBUTOR แก้รายการตัวเองภายใน 24 ชม.');
UPDATE public.expense_items SET amount = 1 WHERE description = 'ค่าใช้จ่ายทั่วไป ก.ค.';
SELECT t.ok((SELECT amount FROM public.expense_items WHERE description = 'ค่าใช้จ่ายทั่วไป ก.ค.') = 30000, 'CONTRIBUTOR แก้รายการคนอื่นไม่ได้ (RLS)');
SELECT t.fails($$UPDATE public.expense_items SET deleted_at = now() WHERE description = 'ค่าอาหาร (เงินสด)'$$, 'row-level security|PERMISSION', 'CONTRIBUTOR Soft Delete ไม่ได้');
SELECT t.fails($$DELETE FROM public.expense_items$$, 'permission denied', 'Hard Delete ไม่ได้ (ไม่มีสิทธิ์ DELETE)');
SELECT t.fails($$SELECT public.reveal_bank_account((SELECT id FROM public.bank_accounts LIMIT 1))$$, 'PERMISSION_DENIED', 'CONTRIBUTOR Reveal ไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$INSERT INTO public.persons(family_id, name) SELECT id, 'x' FROM public.families$$, 'row-level security', 'VIEWER เพิ่มข้อมูลไม่ได้');
SELECT t.ok((SELECT count(*) FROM public.assets) > 0, 'VIEWER อ่านได้');
SELECT t.ok((SELECT count(*) FROM public.audit_logs) = 0, 'VIEWER อ่าน Audit Log ไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000d');
SELECT t.ok((SELECT count(*) FROM public.assets) = 0 AND (SELECT count(*) FROM public.v_net_worth_items_current) = 0,
            'DISABLED user มองไม่เห็นข้อมูล (ตาราง + View)');
SELECT t.fails($$SELECT public.record_login()$$, 'ไม่มีสิทธิ์', 'DISABLED login ถูกปฏิเสธ');
SET ROLE anon; SELECT t.login(NULL);
SELECT t.fails($$SELECT count(*) FROM public.assets$$, 'permission denied', 'anon อ่านตารางไม่ได้');
SET ROLE authenticated;

\echo '== 7. Sensitive: Bank account number'
SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.set_bank_account_no((SELECT id FROM public.bank_accounts WHERE bank_name = 'KBank'), '123-4-56789-0') AS last4;
SELECT t.ok((SELECT account_no_masked FROM public.v_bank_accounts_safe WHERE bank_name = 'KBank') = '••••7890', 'Safe View แสดง Mask');
SELECT t.ok(public.reveal_bank_account((SELECT id FROM public.bank_accounts WHERE bank_name = 'KBank')) = '1234567890', 'EDITOR Reveal ได้เลขเต็ม');
SELECT t.fails($$SELECT * FROM public.bank_account_secrets$$, 'permission denied', 'Client อ่าน bank_account_secrets ไม่ได้');

\echo '== 8. Bank Reconciliation July'
SELECT public.prepare_bank_reconciliation(t.a('KBank ออมทรัพย์'), '2026-07-01') IS NOT NULL AS prepared;
SELECT opening_balance, known_inflows, known_outflows, calculated_closing FROM public.bank_reconciliations;
SELECT t.ok((SELECT calculated_closing FROM public.bank_reconciliations WHERE bank_asset_id = t.a('KBank ออมทรัพย์'))
            = 1000000 + 95000 + 25000 + 50000 + 2500 - 30000 - 20000, 'Calculated Closing = ยอดต้น + เข้า − ออก (1,122,500)');
SELECT t.fails($$SELECT public.confirm_bank_reconciliation((SELECT id FROM public.bank_reconciliations LIMIT 1), 1122000)$$,
               'RECON_DIFFERENCE', 'มีผลต่างต้องมีเหตุผล');
SELECT public.confirm_bank_reconciliation((SELECT id FROM public.bank_reconciliations WHERE bank_asset_id = t.a('KBank ออมทรัพย์')), 1122500) IS NOT NULL;
SELECT public.prepare_bank_reconciliation(t.a('BBL USD'), '2026-07-01') IS NOT NULL;
SELECT t.ok((SELECT calculated_closing FROM public.bank_reconciliations WHERE bank_asset_id = t.a('BBL USD'))
            = 10000 - 1010 + 18, 'USD: −(1,000 + fee 10) + Dividend 18 (BUY settle Aug ยังไม่นับ)');
SELECT public.confirm_bank_reconciliation((SELECT id FROM public.bank_reconciliations WHERE bank_asset_id = t.a('BBL USD')),
                                          9007.50, NULL, -0.50) IS NOT NULL;
SELECT t.ok((SELECT bool_and(status = 'RECONCILED') FROM public.bank_reconciliations), 'ทั้งสองบัญชี RECONCILED (รวม Rounding 0.50)');
UPDATE public.monthly_expenses SET tracking_status = 'COMPLETE' WHERE year_month = '2026-07-01';

\echo '== 9. Month Closing July'
SELECT category, status, issue_count FROM public.month_closing_checks('2026-07-01');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.month_closing_checks('2026-07-01') WHERE status = 'BLOCKED'), 'July ไม่มี BLOCKED');
SELECT t.ok((SELECT status FROM public.month_closing_checks('2026-07-01') WHERE category = 'LIABILITIES') = 'REVIEW',
            'จ่ายบัตรหลังวันที่ของยอด → REVIEW');
SELECT t.ok((SELECT status FROM public.month_closing_checks('2026-07-01') WHERE category = 'INVESTMENTS') = 'REVIEW',
            'MSFT ราคาทุน + Unsettled → REVIEW');
SELECT t.login('00000000-0000-0000-0000-00000000000c');
SELECT t.fails($$SELECT public.finalize_month('2026-07-01')$$, 'PERMISSION_DENIED', 'CONTRIBUTOR Finalize ไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.finalize_month('2026-07-01') IS NOT NULL AS finalized;
SELECT snapshot_month, status, version, financial_assets, investments, property_assets, total_assets,
       unallocated_assets, total_liabilities, net_worth, fx_rate_dates FROM public.net_worth_snapshots;
SELECT item_group, item_subtype, item_name, person_id IS NULL AS unalloc, value, currency, fx_rate, base_value, is_carried_forward
  FROM public.net_worth_snapshot_items ORDER BY item_type, item_group, item_name;
SELECT t.ok((SELECT s.total_assets = (SELECT sum(base_value) FROM public.net_worth_snapshot_items i WHERE i.snapshot_id = s.id AND item_type = 'ASSET')
               AND s.net_worth = s.total_assets - s.total_liabilities FROM public.net_worth_snapshots s), 'Header = SUM Items');
SELECT t.ok((SELECT sum(net_worth) FROM public.net_worth_snapshot_lines) + (SELECT unallocated_assets - unallocated_liabilities FROM public.net_worth_snapshots)
            = (SELECT net_worth FROM public.net_worth_snapshots), 'Person Lines + Unallocated = Family Net Worth');
SELECT t.ok((SELECT value FROM public.net_worth_snapshot_items WHERE item_subtype = 'UNSETTLED_PAYABLE') = -805, 'Unsettled Payable −805 USD');
SELECT t.ok((SELECT count(*) FROM public.net_worth_snapshot_items WHERE item_subtype = 'SECURITY_DEPOSIT') = 2, 'เงินประกัน = หนี้ของเจ้าของบ้าน 60/40 (2 แถว)');

\echo '== 10. Period Lock'
SELECT t.fails($$INSERT INTO public.income_transactions(family_id, date, income_type, amount, currency)
                 SELECT id, '2026-07-31', 'OTHER', 100, 'THB' FROM public.families$$, 'PERIOD_LOCKED', 'เพิ่มรายการในเดือน FINAL ไม่ได้');
SELECT t.fails($$UPDATE public.expense_items SET description = 'x' WHERE description = 'ค่าใช้จ่ายทั่วไป ก.ค.'$$, 'PERIOD_LOCKED', 'แก้รายการในเดือน FINAL ไม่ได้');
SELECT t.fails($$UPDATE public.investment_transactions SET settlement_date = '2026-08-04' WHERE transaction_type = 'BUY'$$,
               'PERIOD_LOCKED', 'Trade ปลาย Jul settle Aug: แก้ไม่ได้เพราะวันหนึ่งอยู่ในเดือน FINAL');
SELECT t.fails($$UPDATE public.credit_cards SET outstanding_balance = 1, balance_date = '2026-07-30'$$, 'PERIOD_LOCKED', 'ยอดบัตรวันที่ในงวดที่ปิดไม่ได้');
SELECT t.fails($$UPDATE public.loan_details SET opening_outstanding_principal = 1, notes = 'x'$$, 'PERIOD_LOCKED', 'ยอดตั้งต้นเงินกู้แก้ไม่ได้เมื่อมีเดือน FINAL');
SELECT t.fails($$INSERT INTO public.investment_transactions(portfolio_id, transaction_date, transaction_type, amount, currency)
                 SELECT id, '2026-08-05', 'DEPOSIT', 1000000, 'USD' FROM public.investment_portfolios$$, 'Transfer Money', 'DEPOSIT ตรงในพอร์ตไม่ได้ (ต้องผ่าน Transfer Money)');
SELECT t.fails($$INSERT INTO public.cash_movements(family_id, movement_date, movement_type, to_asset_id, amount, currency)
                 SELECT id, '2026-08-05', 'INCOME', t.a('KBank ออมทรัพย์'), 100, 'THB' FROM public.families$$, 'cm_source_only', 'Movement INCOME ลอย ๆ ไม่ได้ (ต้องมาจาก income_transactions)');
SELECT t.fails($$UPDATE public.property_leases SET deposit_settled_date = '2026-08-01', deposit_settlement_type = 'REFUNDED', deposit_refunded_amount = 30000
                 WHERE tenant_name = 'ผู้เช่า ก'$$, 'CACHE_FIELD', 'Settle เงินประกันตรงไม่ได้ (ต้องผ่าน settle_security_deposit)');
UPDATE public.credit_cards SET outstanding_balance = 12000, balance_date = '2026-08-25';
SELECT t.ok((SELECT outstanding_balance FROM public.credit_cards) = 12000, 'อัปเดตยอดบัตรหลังงวดที่ปิดได้');

\echo '== 11. August: Derived sync on soft delete / restore'
INSERT INTO public.investment_transactions(portfolio_id, holding_id, transaction_date, transaction_type, amount, currency, settle_to_asset_id)
  SELECT portfolio_id, id, '2026-08-20', 'DIVIDEND', 30, 'USD', t.a('BBL USD') FROM public.investment_holdings WHERE name = 'AAPL';
UPDATE public.investment_transactions SET deleted_at = now() WHERE transaction_date = '2026-08-20';
SELECT t.ok((SELECT i.deleted_at IS NOT NULL FROM public.income_transactions i JOIN public.investment_transactions x ON x.id = i.source_transaction_id
              WHERE x.transaction_date = '2026-08-20')
        AND (SELECT m.deleted_at IS NOT NULL FROM public.cash_movements m JOIN public.investment_transactions x ON x.id = m.source_entity_id
              WHERE x.transaction_date = '2026-08-20'), 'Soft Delete Source → Derived Income + Movement ถูกลบตาม');
SELECT t.fails($$UPDATE public.investment_transactions SET deleted_at = NULL WHERE transaction_date = '2026-08-20'$$,
               'กู้คืนได้เฉพาะ ADMIN', 'EDITOR Restore ไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000a');
UPDATE public.investment_transactions SET deleted_at = NULL WHERE transaction_date = '2026-08-20';
SELECT t.ok((SELECT count(*) FROM public.cash_movements m JOIN public.investment_transactions x ON x.id = m.source_entity_id
              WHERE x.transaction_date = '2026-08-20' AND m.deleted_at IS NULL) = 1, 'ADMIN Restore → Derived Movement กลับมา (แถวเดิม ไม่ซ้ำ)');
-- Lease 2: รับเงินประกัน (Movement) → หมดสัญญา → คืนบางส่วน + หักเป็นรายได้
SELECT t.login('00000000-0000-0000-0000-00000000000e');
INSERT INTO public.property_leases(property_id, unit_label, tenant_name, start_date, end_date, rent_amount, security_deposit)
  SELECT id, 'ชั้น 1', 'ผู้เช่า ข', '2026-08-01', '2026-08-31', 10000, 10000 FROM public.property_details;
INSERT INTO public.cash_movements(family_id, movement_date, movement_type, to_asset_id, related_lease_id, amount, currency)
  SELECT f.id, '2026-08-01', 'SECURITY_DEPOSIT_IN', t.a('KBank ออมทรัพย์'), l.id, 10000, 'THB'
    FROM public.families f, public.property_leases l WHERE l.tenant_name = 'ผู้เช่า ข';
SELECT t.fails($$SELECT public.settle_security_deposit((SELECT id FROM public.property_leases WHERE tenant_name='ผู้เช่า ข'),
                 '2026-09-05', 8000, t.a('KBank ออมทรัพย์'))$$, 'ต้องระบุเหตุผล', 'หักเงินประกันต้องมีเหตุผล');
SELECT public.settle_security_deposit((SELECT id FROM public.property_leases WHERE tenant_name = 'ผู้เช่า ข'),
       '2026-09-05', 8000, t.a('KBank ออมทรัพย์'), 'ค่าซ่อมผนัง') ->> 'deducted' AS deducted;
SELECT t.ok((SELECT amount FROM public.income_transactions WHERE income_type = 'OTHER' AND lease_id IS NOT NULL) = 2000
        AND (SELECT count(*) FROM public.cash_movements WHERE movement_type = 'SECURITY_DEPOSIT_OUT') = 1,
            'คืน 8,000 (Movement OUT) + หัก 2,000 เป็นรายได้อื่น (ไม่มี Movement)');
-- ต่อสัญญา ผู้เช่า ก ยกเงินประกันไปสัญญาใหม่
INSERT INTO public.property_leases(property_id, unit_label, tenant_name, start_date, end_date, rent_amount, security_deposit,
            deposit_carried_from_lease_id, deposit_carried_amount)
  SELECT p.id, 'ชั้น 2', 'ผู้เช่า ก', '2027-01-01', '2027-12-31', 26000, 30000, l.id, 30000
    FROM public.property_details p, public.property_leases l WHERE l.tenant_name = 'ผู้เช่า ก' AND l.start_date = '2026-01-01';
SELECT t.ok((SELECT deposit_settlement_type = 'CARRIED_TO_NEW_LEASE' AND deposit_settled_date = '2027-01-01'
               FROM public.property_leases WHERE tenant_name = 'ผู้เช่า ก' AND start_date = '2026-01-01'),
            'ยกเงินประกัน → สัญญาเดิมปิดหนี้วันเดียวกับสัญญาใหม่เริ่ม');

\echo '== 12. Reopen'
SELECT t.fails($$SELECT public.reopen_month('2026-07-01', 'แก้ยอด')$$, 'PERMISSION_DENIED', 'EDITOR Reopen ไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000a');
SELECT t.fails($$SELECT public.reopen_month('2026-07-01', '')$$, 'เหตุผล', 'Reopen ต้องมีเหตุผล');
SELECT public.reopen_month('2026-07-01', 'ทดสอบ Reopen') IS NOT NULL AS reopened;
UPDATE public.expense_items SET description = 'ค่าใช้จ่ายทั่วไป ก.ค. (แก้)' WHERE description = 'ค่าใช้จ่ายทั่วไป ก.ค.';
SELECT public.finalize_month('2026-07-01') IS NOT NULL AS refinalized;
SELECT t.ok((SELECT version FROM public.net_worth_snapshots) = 2, 'Finalize ใหม่ → version 2');
SELECT t.ok((SELECT value = 8000 AND value_date = '2026-07-25' FROM public.net_worth_snapshot_items WHERE item_subtype = 'CREDIT_CARD'),
            'ปิด ก.ค. ใหม่หลังอัปเดตบัตร 25 ส.ค. → ยังใช้ยอดบัตร ณ 31 ก.ค. (8,000) จาก Audit');

\echo '== 13. Audit'
SELECT t.ok((SELECT count(*) FROM public.audit_logs WHERE action = 'FINALIZE_MONTH') = 2
        AND (SELECT count(*) FROM public.audit_logs WHERE action = 'REOPEN_MONTH') = 1
        AND (SELECT count(*) FROM public.audit_logs WHERE action = 'VIEW_SENSITIVE') = 1
        AND (SELECT count(*) FROM public.audit_logs WHERE action = 'CONFIRM_GO_LIVE') = 1, 'Audit actions ครบ');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE metadata::text LIKE '%1234567890%'), 'ไม่มีเลขบัญชีเต็มใน Audit');
RESET ROLE;
SELECT t.fails($$UPDATE public.audit_logs SET action = 'LOGIN'$$, 'IMMUTABLE', 'audit_logs แก้ไม่ได้ (แม้ postgres)');
SELECT t.fails($$DELETE FROM public.audit_logs$$, 'IMMUTABLE', 'audit_logs ลบไม่ได้ (แม้ postgres)');

\echo '== 13b. August closing checks + FX override'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT t.ok((SELECT status FROM public.month_closing_checks('2026-08-01') WHERE category = 'CASH') = 'BLOCKED',
            'ส.ค. ยังไม่กระทบยอดบัญชี → CASH = BLOCKED');
SELECT t.fails($$SELECT public.finalize_month('2026-08-01')$$, 'CLOSING_BLOCKED', 'Finalize ไม่ได้เมื่อมี BLOCKED');
SELECT t.fails($$SELECT public.finalize_month('2026-09-01')$$, 'CLOSING_BLOCKED', 'ข้ามเดือนไม่ได้ (Aug ยังไม่ FINAL)');
SELECT t.fails($$INSERT INTO public.fx_rates(rate_date, currency, rate_to_thb, source, is_override, override_reason)
                 VALUES ('2026-10-04','EUR',40,'ADMIN_OVERRIDE',true,'API ล่ม')$$, 'row-level security|PERMISSION_DENIED', 'EDITOR Override FX ไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000a');
SELECT t.fails($$INSERT INTO public.fx_rates(rate_date, currency, rate_to_thb, source) VALUES ('2026-10-04','EUR',40,'BOT_API')$$,
               'ADMIN_OVERRIDE', 'ADMIN บันทึก FX ได้เฉพาะแบบ Override');
-- รายการ EUR ที่ยังไม่มี Rate → base_amount ว่าง → Override แล้วเติมให้เอง
INSERT INTO public.monthly_expenses(family_id, year_month) SELECT id, '2026-09-01' FROM public.families;
INSERT INTO public.expense_items(monthly_expense_id, date, description, amount, currency)
  SELECT id, '2026-09-10', 'ค่าโรงแรม (EUR)', 200, 'EUR' FROM public.monthly_expenses WHERE year_month = '2026-09-01';
SELECT t.ok((SELECT base_amount IS NULL FROM public.expense_items WHERE currency = 'EUR'), 'ไม่มี FX → base_amount ว่าง (ไม่ Block การกรอก)');
INSERT INTO public.fx_rates(rate_date, currency, rate_to_thb, source, is_override, override_reason)
  VALUES ('2026-09-09','EUR',38.5,'ADMIN_OVERRIDE',true,'BOT API ไม่มีข้อมูล EUR');
SELECT t.ok((SELECT base_amount FROM public.expense_items WHERE currency = 'EUR') = 7700, 'Override → เติม base_amount = 200 × 38.5');
SELECT t.ok((SELECT count(*) FROM public.audit_logs WHERE action = 'FX_OVERRIDE') = 1, 'Audit FX_OVERRIDE');

\echo '== 13c. RLS coverage'
SELECT t.ok(NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity), 'ทุกตารางใน public เปิด RLS');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public'
              AND grantee IN ('authenticated','anon') AND privilege_type IN ('DELETE','TRUNCATE')), 'Client ไม่มีสิทธิ์ DELETE / TRUNCATE');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public'
              AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = viewname AND c.reloptions::text LIKE '%security_invoker=true%')),
            'ทุก View เป็น security_invoker');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public','private') AND p.prosecdef
                AND NOT coalesce('search_path=""' = ANY (p.proconfig), false)), 'ทุก SECURITY DEFINER ตั้ง search_path = ''''');

\echo '== 13d. ค่าใช้จ่ายประจำอสังหาฯ (ประมาณ vs จ่ายจริง)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT t.fails($$INSERT INTO public.property_utilities(property_id, utility_type, expected_amount)
  SELECT id, 'COMMON_FEE', 1000 FROM public.property_details WHERE asset_id = t.a('บ้าน A')$$,
  'pu_schedule_pair', 'ยอดประมาณต้องมีความถี่คู่กัน');
INSERT INTO public.property_utilities(property_id, utility_type, provider, expected_amount, frequency, due_day)
  SELECT id, 'COMMON_FEE', 'นิติบุคคล', 1500, 'MONTHLY', 1 FROM public.property_details WHERE asset_id = t.a('บ้าน A');
INSERT INTO public.property_utilities(property_id, utility_type, expected_amount, frequency, due_day, due_month)
  SELECT id, 'LAND_TAX', 3000, 'YEARLY', 30, (extract(month FROM current_date)::int % 12) + 1
    FROM public.property_details WHERE asset_id = t.a('บ้าน A');
SELECT t.ok((SELECT count(*) FROM public.v_property_cost_tracking WHERE utility_type = 'COMMON_FEE') = 1
            AND (SELECT status FROM public.v_property_cost_tracking WHERE utility_type = 'COMMON_FEE') IN ('OVERDUE','PENDING'),
            'ค่าส่วนกลางรายเดือน: เริ่มงวดเดือนที่เพิ่มรายการ · ยังไม่จ่าย');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.v_property_cost_tracking WHERE utility_type = 'LAND_TAX'),
            'ภาษีที่ดินรายปี (ครบกำหนดเดือนหน้า) ยังไม่ขึ้นงวด');
SELECT public.add_expense(jsonb_build_object('date', current_date, 'description', 'ค่าส่วนกลาง บ้าน A', 'amount', 1500,
  'paid_from_asset_id', t.a('KBank ออมทรัพย์'), 'expense_category', 'บ้าน / สาธารณูปโภค',
  'property_utility_id', (SELECT id FROM public.property_utilities WHERE utility_type = 'COMMON_FEE'),
  'cost_period', date_trunc('month', current_date)::date));
SELECT t.ok((SELECT status = 'PAID' AND paid_amount = 1500 AND gap = 0 FROM public.v_property_cost_tracking WHERE utility_type = 'COMMON_FEE'),
            'บันทึกจ่าย → PAID · ยอดจ่าย = ประมาณ');
SELECT t.ok((SELECT related_asset_id = t.a('บ้าน A') AND cost_period = date_trunc('month', current_date)::date
               FROM public.expense_items WHERE property_utility_id IS NOT NULL),
            'ค่าใช้จ่ายผูกทรัพย์สิน + งวดให้เอง');
SELECT t.fails($$INSERT INTO public.expense_items(monthly_expense_id, date, description, amount, property_utility_id)
  SELECT m.id, current_date, 'x', 1, u.id FROM public.monthly_expenses m, public.property_utilities u
   WHERE m.year_month = date_trunc('month', current_date)::date LIMIT 1$$,
  'exp_cost_period_pair', 'ผูกรายการต้องมีงวดเสมอ');
UPDATE public.expense_items SET deleted_at = now() WHERE property_utility_id IS NOT NULL;
SELECT t.ok((SELECT status <> 'PAID' FROM public.v_property_cost_tracking WHERE utility_type = 'COMMON_FEE'),
            'ลบรายการจ่าย → กลับเป็นยังไม่จ่าย');
RESET ROLE;

\echo '== 13e. ตารางผ่อนเงินให้กู้ (หลังรับชำระ)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT t.ok((SELECT principal_covered = 600000 - (SELECT outstanding_principal FROM public.loan_details)
               FROM public.v_loan_schedule_status WHERE installment_no = 1),
            'เงินต้นที่ได้คืน = ยอดตามตาราง − เงินต้นคงเหลือจริง');
SELECT t.ok((SELECT status = 'PAID' AND total_remaining = 0 FROM public.v_loan_schedule_status WHERE installment_no = 1),
            'งวดแรกได้คืนครบ → PAID');
SELECT t.ok((SELECT status = 'OVERDUE' AND principal_remaining > 0 AND interest_remaining = 0
               FROM public.v_loan_schedule_status WHERE installment_no = 5),
            'งวด มิ.ย. (ก่อนยอดตั้งต้น): ดอกถือว่าเรียบร้อย · เงินต้นยังค้าง → OVERDUE');
SELECT t.ok((SELECT interest_remaining = 0 FROM public.v_loan_schedule_status WHERE installment_no = 6),
            'งวด ก.ค.: ดอกเบี้ย 2,500 บันทึกรับแล้ว');
SELECT t.ok((SELECT status = 'PENDING' AND total_remaining = 2500 FROM public.v_loan_schedule_status WHERE installment_no = 7),
            'งวดอนาคต → PENDING');
SELECT t.fails($$SELECT public.set_loan_schedule(t.a('เงินกู้ญาติ'), '[{"due_date":"2027-01-31","principal":450000}]')$$,
  'บันทึกรับชำระแล้ว', 'รับชำระแล้ว → แก้ตารางทั้งชุดไม่ได้');
SELECT t.fails($$UPDATE public.loan_schedule_lines SET principal_due = 1 WHERE installment_no = 1 AND deleted_at IS NULL$$,
  'LOCKED', 'งวดที่รับแล้ว แก้ไขไม่ได้');
SELECT t.fails($$UPDATE public.loan_schedule_lines SET deleted_at = now() WHERE installment_no = 1 AND deleted_at IS NULL$$,
  'LOCKED', 'งวดที่รับแล้ว ลบไม่ได้');
UPDATE public.loan_schedule_lines SET interest_due = 2600 WHERE installment_no = 7 AND deleted_at IS NULL;
SELECT t.ok((SELECT interest_due = 2600 FROM public.loan_schedule_lines WHERE installment_no = 7 AND deleted_at IS NULL),
            'งวดที่ยังไม่ครบ แก้ได้');
UPDATE public.loan_schedule_lines SET interest_due = 2500 WHERE installment_no = 7 AND deleted_at IS NULL;
SELECT t.fails($$UPDATE public.loan_schedule_lines SET loan_asset_id = t.a('บ้าน A') WHERE installment_no = 7 AND deleted_at IS NULL$$,
  'IMMUTABLE', 'ย้ายงวดไปสัญญาอื่นไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.ok((SELECT count(*) FROM public.v_loan_schedule_status) = 7, 'VIEWER อ่านตารางผ่อนได้');
SELECT t.fails($$SELECT public.restructure_loan_schedule(t.a('เงินกู้ญาติ'), '[{"due_date":"2027-01-31","principal":1}]')$$,
  'PERMISSION_DENIED', 'VIEWER ปรับตารางผ่อนไม่ได้');
RESET ROLE;

\echo '== 13f. ปรับตารางผ่อน (คำนวณงวดที่เหลือใหม่)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT t.ok((SELECT outstanding_principal FROM public.loan_details) = 450000, 'เงินต้นคงเหลือ 450,000 ก่อนปรับตาราง');
SELECT t.ok((SELECT status = 'OVERDUE' AND principal_remaining = 50000 FROM public.v_loan_schedule_status WHERE installment_no = 2)
            AND (SELECT status = 'OVERDUE' AND principal_remaining = 100000 AND interest_remaining = 0
                   FROM public.v_loan_schedule_status WHERE installment_no = 6),
            'ก่อนปรับ: งวด 2 ค้างต้น 50,000 · งวด ก.ค. ได้ดอกแล้ว ค้างต้น 100,000');
SELECT t.fails($$SELECT public.restructure_loan_schedule(t.a('เงินกู้ญาติ'), '[{"due_date":"2026-01-31","principal":450000}]')$$,
  'หลังงวดที่รับครบแล้ว', 'ตารางใหม่เริ่มก่อนงวดที่รับครบแล้วไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000c');
SELECT t.fails($$SELECT public.restructure_loan_schedule(t.a('เงินกู้ญาติ'), '[{"due_date":"2027-01-31","principal":450000}]')$$,
  'PERMISSION_DENIED', 'CONTRIBUTOR ปรับตารางไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT t.ok(public.restructure_loan_schedule(t.a('เงินกู้ญาติ'), '[
  {"due_date":"2027-01-31","principal":225000,"interest":3000},
  {"due_date":"2027-02-28","principal":225000,"interest":1500}]', 'ผู้กู้ขอขยายเวลา') = 2, 'ปรับตาราง: ใส่งวดใหม่ 2 งวด');
SELECT t.ok((SELECT count(*) FROM public.loan_schedule_lines WHERE deleted_at IS NULL) = 8,
            'เหลือ 8 งวด (เดิม 6 ที่รับแล้ว / ตัดเหลือส่วนที่รับ + ใหม่ 2) · งวดอนาคตที่ยังไม่รับถูกแทน');
SELECT t.ok((SELECT status = 'PAID' AND principal_due = 50000 FROM public.v_loan_schedule_status WHERE installment_no = 2)
            AND (SELECT status = 'PAID' AND principal_due = 0 AND interest_due = 2500 FROM public.v_loan_schedule_status WHERE installment_no = 6),
            'งวดที่รับบางส่วน ถูกตัดเหลือส่วนที่รับแล้ว → รับแล้ว');
SELECT t.ok((SELECT status = 'PENDING' AND interest_remaining = 3000 AND principal_remaining = 225000
               AND notes LIKE '%ผู้กู้ขอขยายเวลา%' FROM public.v_loan_schedule_status WHERE installment_no = 7),
            'งวดใหม่แรก: ต่อเลขงวด · ดอกที่รับไปแล้วไม่ถูกนำมาหัก · มีหมายเหตุการปรับ');
SELECT t.ok((SELECT sum(principal_due) FROM public.loan_schedule_lines WHERE deleted_at IS NULL)
              - (SELECT outstanding_principal FROM public.loan_details) = 150000,
            'เงินต้นตามตาราง − คงเหลือ = ส่วนที่ได้คืนแล้ว (สอดคล้องหลังปรับ)');
SELECT t.ok((SELECT due_date = '2027-02-28' FROM public.loan_details), 'ปรับตาราง (ต่อสัญญา) → วันครบกำหนดสัญญาเลื่อนตาม');
SELECT t.fails($$UPDATE public.loan_schedule_lines SET notes = 'x' WHERE installment_no = 6 AND deleted_at IS NULL$$,
  'LOCKED', 'หลังปรับ: งวดที่ตัดแล้ว (รับแล้ว) แก้ไม่ได้');
RESET ROLE;

\echo '== 13g. ประกัน: ผู้จ่ายเบี้ย · ตารางเบี้ย / ผลประโยชน์ · รับผลประโยชน์ · ติดตามหลังเสียชีวิต'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
CREATE TEMP TABLE IF NOT EXISTS tp(k text PRIMARY KEY, id uuid);
GRANT ALL ON tp TO authenticated;
INSERT INTO tp SELECT 'pol', public.create_insurance_policy(jsonb_build_object(
  'insurance_type', 'LIFE', 'person_id', t.p('คุณแม่'), 'insurer', 'ประกันทดสอบ', 'policy_no', 'T-001',
  'insured_amount', 1000000, 'premium', 20000, 'currency', 'THB', 'has_cash_value', true,
  'cash_value', 100000, 'cash_value_date', current_date,
  'owners', jsonb_build_array(jsonb_build_object('person_id', t.p('คุณแม่'), 'percent', 100))));
UPDATE public.insurance_policies SET payer_person_id = t.p('คุณพ่อ') WHERE id = (SELECT id FROM tp WHERE k = 'pol');
SELECT t.ok((SELECT payer_person_id = t.p('คุณพ่อ') AND person_id = t.p('คุณแม่') FROM public.v_insurance_status WHERE id = (SELECT id FROM tp WHERE k = 'pol')),
            'ผู้จ่ายเบี้ยแยกจากผู้เอาประกันได้');
SELECT t.ok(public.set_insurance_schedule((SELECT id FROM tp WHERE k = 'pol'), 'PREMIUM', jsonb_build_array(
  jsonb_build_object('due_date', current_date - 5, 'amount', 20000),
  jsonb_build_object('due_date', current_date + 300, 'amount', 20000))) = 2, 'ตั้งตารางเบี้ย 2 งวด');
SELECT t.ok((SELECT status = 'OVERDUE' AND payer_person_id = t.p('คุณพ่อ') FROM public.v_insurance_schedule_status WHERE installment_no = 1 AND kind = 'PREMIUM'),
            'งวดเบี้ยเลยกำหนด · ผู้จ่ายเบี้ย = คุณพ่อ');
SELECT public.add_expense(jsonb_build_object('date', current_date, 'description', 'เบี้ยประกันทดสอบ', 'amount', 20000,
  'paid_from_asset_id', t.a('KBank ออมทรัพย์'),
  'insurance_schedule_line_id', (SELECT id FROM public.insurance_schedule_lines WHERE kind = 'PREMIUM' AND installment_no = 1 AND deleted_at IS NULL)));
SELECT t.ok((SELECT status = 'PAID' FROM public.v_insurance_schedule_status WHERE installment_no = 1 AND kind = 'PREMIUM')
            AND (SELECT expense_category = 'ประกัน' FROM public.expense_items WHERE insurance_schedule_line_id IS NOT NULL),
            'บันทึกจ่ายเบี้ย → ชำระแล้ว · หมวด "ประกัน"');
SELECT t.fails($$UPDATE public.insurance_schedule_lines SET amount = 1 WHERE kind = 'PREMIUM' AND installment_no = 1 AND deleted_at IS NULL$$,
  'LOCKED', 'งวดเบี้ยที่ชำระแล้วแก้ไม่ได้');
SELECT t.fails($$SELECT public.set_insurance_schedule((SELECT id FROM tp WHERE k = 'pol'), 'PREMIUM',
  jsonb_build_array(jsonb_build_object('due_date', current_date - 30, 'amount', 1)))$$, 'หลังงวดที่มีการชำระแล้ว', 'ตารางใหม่ต้องอยู่หลังงวดที่ชำระแล้ว');
SELECT t.ok(public.set_insurance_schedule((SELECT id FROM tp WHERE k = 'pol'), 'PREMIUM', jsonb_build_array(
  jsonb_build_object('due_date', current_date + 360, 'amount', 21000))) = 1
  AND (SELECT count(*) FROM public.insurance_schedule_lines WHERE kind = 'PREMIUM' AND deleted_at IS NULL) = 2,
  'ตั้งตารางเบี้ยใหม่: เก็บงวดที่ชำระแล้ว · แทนงวดที่ยังไม่ชำระ');
-- ผลประโยชน์รายงวด: ถอนจากมูลค่าเวนคืน (100,000) ก่อน
SELECT public.set_insurance_schedule((SELECT id FROM tp WHERE k = 'pol'), 'BENEFIT',
  jsonb_build_array(jsonb_build_object('due_date', current_date - 1, 'amount', 30000, 'benefit_type', 'CASH_BACK')));
SELECT public.receive_insurance_benefit(jsonb_build_object('policy_id', (SELECT id FROM tp WHERE k = 'pol'),
  'line_id', (SELECT id FROM public.insurance_schedule_lines WHERE kind = 'BENEFIT' AND deleted_at IS NULL),
  'date', current_date, 'amount', 30000, 'bank_asset_id', t.a('KBank ออมทรัพย์')));
SELECT t.ok((SELECT status = 'PAID' FROM public.v_insurance_schedule_status WHERE kind = 'BENEFIT')
            AND (SELECT current_value = 70000 FROM public.assets WHERE asset_type = 'INSURANCE_CASH_VALUE')
            AND NOT EXISTS (SELECT 1 FROM public.income_transactions WHERE income_type = 'INSURANCE_BENEFIT'),
            'เงินคืนรายงวด 30,000 = ถอนจากมูลค่าเวนคืน (เหลือ 70,000) · ไม่ใช่รายได้');
-- ครบสัญญา 120,000: 70,000 จากมูลค่าเวนคืน · 50,000 รายได้ · ปิดกรมธรรม์
SELECT t.ok((SELECT (r->>'income_part')::numeric = 50000 FROM public.receive_insurance_benefit(jsonb_build_object(
  'policy_id', (SELECT id FROM tp WHERE k = 'pol'), 'date', current_date, 'amount', 120000,
  'bank_asset_id', t.a('KBank ออมทรัพย์'), 'outcome', 'MATURED')) r), 'ครบสัญญา: ส่วนเกินมูลค่าเวนคืน 50,000 = รายได้');
SELECT t.ok((SELECT status = 'MATURED' FROM public.insurance_policies WHERE id = (SELECT id FROM tp WHERE k = 'pol'))
            AND (SELECT status = 'CLOSED' AND current_value = 0 FROM public.assets WHERE asset_type = 'INSURANCE_CASH_VALUE')
            AND (SELECT amount = 50000 AND asset_id IS NOT NULL FROM public.income_transactions WHERE income_type = 'INSURANCE_BENEFIT'),
            'ปิดกรมธรรม์ · มูลค่าเวนคืน 0 · รายได้แบ่งตามเจ้าของมูลค่าเวนคืน');
SELECT t.ok((SELECT status = 'CLOSED' FROM public.v_insurance_schedule_status WHERE kind = 'PREMIUM' AND installment_no = 2),
            'กรมธรรม์ปิดแล้ว → งวดเบี้ยที่เหลือไม่ต้องจ่าย');
-- ความคุ้มครอง
INSERT INTO public.insurance_coverages(policy_id, coverage_type, limit_amount) VALUES ((SELECT id FROM tp WHERE k = 'pol'), 'LIFE', 1000000);
SELECT t.ok((SELECT count(*) FROM public.insurance_coverages) = 1, 'เพิ่มความคุ้มครองได้');
-- ติดตามหลังเสียชีวิต
INSERT INTO public.persons(family_id, name, relationship) SELECT id, 'ญาติทดสอบ', 'OTHER' FROM public.families;
INSERT INTO tp SELECT 'health', public.create_insurance_policy(jsonb_build_object(
  'insurance_type', 'HEALTH', 'person_id', t.p('ญาติทดสอบ'), 'insurer', 'สุขภาพทดสอบ', 'currency', 'THB'));
INSERT INTO tp SELECT 'life2', public.create_insurance_policy(jsonb_build_object(
  'insurance_type', 'LIFE', 'person_id', t.p('คุณแม่'), 'insurer', 'ชีวิตทดสอบ 2', 'currency', 'THB',
  'beneficiaries', jsonb_build_array(jsonb_build_object('person_id', t.p('ญาติทดสอบ'), 'percent', 100))));
UPDATE public.insurance_policies SET payer_person_id = t.p('ญาติทดสอบ') WHERE id = (SELECT id FROM tp WHERE k = 'life2');
UPDATE public.persons SET status = 'DECEASED' WHERE name = 'ญาติทดสอบ';
SELECT t.ok((SELECT count(*) FROM public.insurance_followups WHERE person_id = t.p('ญาติทดสอบ')) = 3
            AND EXISTS (SELECT 1 FROM public.insurance_followups WHERE role = 'INSURED' AND policy_id = (SELECT id FROM tp WHERE k = 'health'))
            AND EXISTS (SELECT 1 FROM public.insurance_followups WHERE role = 'PAYER' AND policy_id = (SELECT id FROM tp WHERE k = 'life2'))
            AND EXISTS (SELECT 1 FROM public.insurance_followups WHERE role = 'BENEFICIARY' AND policy_id = (SELECT id FROM tp WHERE k = 'life2')),
            'เสียชีวิต → รายการติดตาม 3 บทบาท (ผู้เอาประกัน · ผู้จ่ายเบี้ย · ผู้รับประโยชน์)');
UPDATE public.persons SET notes = 'x' WHERE name = 'ญาติทดสอบ';
SELECT t.ok((SELECT count(*) FROM public.insurance_followups) = 3, 'แก้ข้อมูลอื่นของสมาชิก → ไม่สร้างรายการซ้ำ');
-- กลับจาก Archived → ปิดรายการที่ยังไม่เริ่มให้เอง · Archived อีกครั้ง → เปิดกลับ
UPDATE public.insurance_followups SET status = 'IN_PROGRESS' WHERE person_id = t.p('ญาติทดสอบ') AND role = 'BENEFICIARY';
UPDATE public.persons SET status = 'ACTIVE' WHERE name = 'ญาติทดสอบ';
SELECT t.ok((SELECT count(*) FROM public.insurance_followups WHERE person_id = t.p('ญาติทดสอบ') AND status = 'NOT_APPLICABLE' AND auto_closed) = 2
            AND (SELECT status = 'IN_PROGRESS' AND NOT auto_closed FROM public.insurance_followups WHERE person_id = t.p('ญาติทดสอบ') AND role = 'BENEFICIARY'),
            'กลับเป็น Active → รายการที่ยังไม่เริ่มปิดให้เอง · ที่กำลังทำไม่แตะ');
UPDATE public.persons SET status = 'DECEASED' WHERE name = 'ญาติทดสอบ';
SELECT t.ok((SELECT count(*) FROM public.insurance_followups WHERE person_id = t.p('ญาติทดสอบ') AND status = 'OPEN' AND NOT auto_closed) = 2
            AND (SELECT count(*) FROM public.insurance_followups WHERE person_id = t.p('ญาติทดสอบ') AND deleted_at IS NULL) = 3,
            'ตั้ง Archived อีกครั้ง → รายการที่ระบบปิดไว้เปิดกลับ · ไม่สร้างซ้ำ');
-- เพิ่มมูลค่าเวนคืนให้กรมธรรม์ที่มีอยู่แล้ว
INSERT INTO tp SELECT 'cv2', public.add_insurance_cash_value((SELECT id FROM tp WHERE k = 'life2'), jsonb_build_object(
  'value', 55000, 'valuation_date', current_date, 'owner_person_id', t.p('คุณแม่'), 'notes', 'เวนคืน 50,000 + ปันผลสะสม 5,000'));
SELECT t.ok((SELECT has_cash_value AND cash_value_asset_id = (SELECT id FROM tp WHERE k = 'cv2')
               FROM public.insurance_policies WHERE id = (SELECT id FROM tp WHERE k = 'life2'))
            AND (SELECT current_value = 55000 AND asset_type = 'INSURANCE_CASH_VALUE' FROM public.assets WHERE id = (SELECT id FROM tp WHERE k = 'cv2'))
            AND (SELECT person_id = t.p('คุณแม่') AND ownership_percent = 100 FROM public.asset_ownerships WHERE asset_id = (SELECT id FROM tp WHERE k = 'cv2')),
            'เพิ่มมูลค่าเวนคืนให้กรมธรรม์เดิม → สินทรัพย์ 55,000 ผูกกรมธรรม์ · เจ้าของตามที่เลือก');
SELECT t.fails($$SELECT public.add_insurance_cash_value((SELECT id FROM tp WHERE k = 'life2'),
  '{"value":1,"valuation_date":"2026-10-01"}')$$, 'มีมูลค่าเวนคืนแล้ว', 'เพิ่มมูลค่าเวนคืนซ้ำไม่ได้');
-- เจ้าของมูลค่าเวนคืน = ผู้เอาประกัน · แก้ผู้เอาประกัน → ย้ายตาม
UPDATE public.insurance_policies SET person_id = t.p('คุณพ่อ') WHERE id = (SELECT id FROM tp WHERE k = 'life2');
SELECT t.ok((SELECT count(*) = 1 AND bool_and(person_id = t.p('คุณพ่อ') AND ownership_percent = 100) FROM public.asset_ownerships
              WHERE asset_id = (SELECT id FROM tp WHERE k = 'cv2') AND deleted_at IS NULL AND end_date IS NULL),
            'แก้ผู้เอาประกัน → เจ้าของมูลค่าเวนคืนย้ายตาม (100%)');
SELECT public.set_asset_ownership((SELECT id FROM tp WHERE k = 'cv2'), jsonb_build_array(
  jsonb_build_object('person_id', t.p('คุณพ่อ'), 'percent', 50), jsonb_build_object('person_id', t.p('คุณแม่'), 'percent', 50)));
UPDATE public.insurance_policies SET person_id = t.p('คุณแม่') WHERE id = (SELECT id FROM tp WHERE k = 'life2');
SELECT t.ok((SELECT count(*) FROM public.asset_ownerships
              WHERE asset_id = (SELECT id FROM tp WHERE k = 'cv2') AND deleted_at IS NULL AND end_date IS NULL) = 2,
            'เจ้าของมูลค่าเวนคืนแบบพิเศษ (50/50) → แก้ผู้เอาประกันแล้วไม่แตะ');
INSERT INTO tp SELECT 'life3', public.create_insurance_policy(jsonb_build_object(
  'insurance_type', 'LIFE', 'person_id', t.p('คุณพ่อ'), 'insurer', 'ชีวิตทดสอบ 3', 'currency', 'THB',
  'has_cash_value', true, 'cash_value', 1000, 'cash_value_date', current_date));
SELECT t.ok((SELECT o.person_id = t.p('คุณพ่อ') AND o.ownership_percent = 100
               FROM public.insurance_policies i JOIN public.asset_ownerships o ON o.asset_id = i.cash_value_asset_id AND o.deleted_at IS NULL
              WHERE i.id = (SELECT id FROM tp WHERE k = 'life3')),
            'สร้างกรมธรรม์ไม่ระบุเจ้าของ → เจ้าของมูลค่าเวนคืน = ผู้เอาประกัน 100%');
SELECT t.login('00000000-0000-0000-0000-00000000000c');
SELECT t.fails($$SELECT public.add_insurance_cash_value((SELECT id FROM tp WHERE k = 'health'),
  jsonb_build_object('value', 1, 'valuation_date', current_date))$$, 'PERMISSION_DENIED', 'CONTRIBUTOR เพิ่มมูลค่าเวนคืนไม่ได้');
SELECT t.fails($$SELECT public.set_insurance_schedule((SELECT id FROM tp WHERE k = 'health'), 'PREMIUM',
  '[{"due_date":"2027-01-01","amount":1}]')$$, 'PERMISSION_DENIED', 'CONTRIBUTOR ตั้งตารางเบี้ยไม่ได้');
RESET ROLE;

\echo '== 13h. ลำดับสมาชิกครอบครัว'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.persons WHERE sort_order IS NULL), 'สมาชิกทุกคนมีลำดับ');
INSERT INTO public.persons(family_id, name, relationship) SELECT id, 'หลานทดสอบ', 'GRANDCHILD' FROM public.families;
SELECT t.ok((SELECT sort_order FROM public.persons WHERE name = 'หลานทดสอบ') = (SELECT max(sort_order) FROM public.persons),
            'เพิ่มสมาชิกใหม่ → ต่อท้าย');
SELECT public.move_person(t.p('หลานทดสอบ'), -1);
SELECT t.ok((SELECT count(*) FROM public.persons p WHERE p.deleted_at IS NULL
              AND p.sort_order > (SELECT sort_order FROM public.persons WHERE name = 'หลานทดสอบ')) = 1
            AND (SELECT count(DISTINCT sort_order) = count(*) FROM public.persons WHERE deleted_at IS NULL),
            'ย้ายขึ้น 1 ตำแหน่ง · ลำดับไม่ซ้ำกัน');
SELECT t.login('00000000-0000-0000-0000-00000000000c');
SELECT t.fails($$SELECT public.move_person(t.p('หลานทดสอบ'), 1)$$, 'PERMISSION_DENIED', 'CONTRIBUTOR ย้ายลำดับสมาชิกไม่ได้');
-- ข้อมูลส่วนบุคคล
SELECT t.login('00000000-0000-0000-0000-00000000000e');
UPDATE public.persons SET title_prefix = 'เด็กชาย', nickname = 'ทดสอบ', national_id = '1234567890123',
  photo = 'data:image/jpeg;base64,AAAA' WHERE name = 'หลานทดสอบ';
SELECT t.ok((SELECT national_id = '1234567890123' AND nickname = 'ทดสอบ' FROM public.persons WHERE name = 'หลานทดสอบ'),
            'บันทึกข้อมูลส่วนบุคคล (คำนำหน้า · ชื่อเล่น · เลขบัตร · รูป) ได้');
SELECT t.fails($$UPDATE public.persons SET national_id = '123-45' WHERE name = 'หลานทดสอบ'$$, 'persons_national_id_format',
  'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก');
SELECT t.fails($$UPDATE public.persons SET photo = 'javascript:alert(1)' WHERE name = 'หลานทดสอบ'$$, 'persons_photo_format',
  'รูปโปรไฟล์ต้องเป็นไฟล์รูปภาพเท่านั้น');
-- ผังครอบครัว / หัวหน้าครอบครัว
SELECT t.login('00000000-0000-0000-0000-00000000000a');
SELECT t.ok((SELECT head_person_id = t.p('คุณพ่อ') FROM public.families), 'หัวหน้าครอบครัวตั้งต้น = สมาชิก "ตัวเอง" ตอนตั้งระบบ');
UPDATE public.persons SET spouse_id = t.p('คุณแม่') WHERE name = 'คุณพ่อ';
SELECT t.ok((SELECT spouse_id = t.p('คุณพ่อ') AND relationship = 'SPOUSE' FROM public.persons WHERE name = 'คุณแม่'),
            'ตั้งคู่สมรส → ผูกกลับสองทาง · ความสัมพันธ์ = คู่สมรส');
UPDATE public.persons SET father_id = t.p('คุณพ่อ'), mother_id = t.p('คุณแม่') WHERE name = 'หลานทดสอบ';
UPDATE public.persons SET father_id = t.p('หลานทดสอบ') WHERE name = 'ญาติทดสอบ';
SELECT t.ok((SELECT relationship FROM public.persons WHERE name = 'หลานทดสอบ') = 'CHILD'
            AND (SELECT relationship FROM public.persons WHERE name = 'ญาติทดสอบ') = 'GRANDCHILD',
            'ผูกพ่อแม่ → ความสัมพันธ์คำนวณเอง (ลูก · หลาน)');
SELECT public.set_family_head(t.p('หลานทดสอบ'));
SELECT t.ok((SELECT relationship FROM public.persons WHERE name = 'หลานทดสอบ') = 'SELF'
            AND (SELECT relationship FROM public.persons WHERE name = 'คุณพ่อ') = 'PARENT'
            AND (SELECT relationship FROM public.persons WHERE name = 'คุณแม่') = 'PARENT'
            AND (SELECT relationship FROM public.persons WHERE name = 'ญาติทดสอบ') = 'CHILD',
            'โอนหัวหน้าครอบครัว → ความสัมพันธ์ของทุกคนเปลี่ยนตาม');
SELECT public.set_family_head(t.p('คุณพ่อ'));
SELECT t.ok((SELECT count(*) FROM public.persons WHERE relationship = 'SELF' AND deleted_at IS NULL) = 1,
            'โอนกลับ → มีหัวหน้า ("ตัวเอง") คนเดียว');
SELECT t.fails($$SELECT public.set_family_head(t.p('ญาติทดสอบ'))$$, 'ต้องเป็นสมาชิก Active', 'สมาชิก Archived / Inactive ตั้งเป็นหัวหน้าไม่ได้');
SELECT t.fails($$UPDATE public.persons SET status = 'DECEASED' WHERE name = 'คุณพ่อ'$$, 'เลือกหัวหน้าครอบครัวคนใหม่ก่อน',
  'เปลี่ยนหัวหน้าเป็น Archived ไม่ได้ถ้ายังไม่ตั้งหัวหน้าใหม่');
SELECT t.fails($$UPDATE public.persons SET father_id = id WHERE name = 'คุณแม่'$$, 'persons_links_not_self', 'เป็นพ่อ / แม่ของตัวเองไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT t.fails($$SELECT public.set_family_head(t.p('คุณแม่'))$$, 'PERMISSION_DENIED', 'EDITOR โอนหัวหน้าครอบครัวไม่ได้ (ADMIN เท่านั้น)');
SELECT t.fails($$UPDATE public.persons SET death_date = current_date WHERE name = 'คุณแม่'$$, 'persons_death_date_status',
  'วันที่เสียชีวิตใส่ได้เฉพาะสมาชิก Archived');
UPDATE public.persons SET death_date = current_date - 3 WHERE name = 'ญาติทดสอบ';
SELECT t.ok((SELECT death_date = current_date - 3 FROM public.persons WHERE name = 'ญาติทดสอบ'), 'สมาชิก Archived ใส่วันที่เสียชีวิตได้');
RESET ROLE;

\echo '== 13i. Dashboard 5 หมวด (ธุรกิจแยกจากการเงิน)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
CREATE TEMP TABLE IF NOT EXISTS dm0 AS SELECT public.dashboard_month(current_date) AS d;
INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency)
  SELECT id, 'FINANCIAL', 'PRIVATE_BUSINESS', 'บริษัททดสอบ', 'THB' FROM public.families;
INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source)
  VALUES (t.a('บริษัททดสอบ'), current_date, 500000, 'USER_ESTIMATE', 'STATEMENT');
SELECT t.ok((SELECT (d->>'business')::numeric = (SELECT (d->>'business')::numeric FROM dm0) + 500000
                AND (d->>'financial')::numeric = (SELECT (d->>'financial')::numeric FROM dm0)
                AND (d->>'total_assets')::numeric = (SELECT (d->>'total_assets')::numeric FROM dm0) + 500000
             FROM (SELECT public.dashboard_month(current_date) AS d) x),
            'Dashboard: ธุรกิจแยกเป็นหมวดของตัวเอง · การเงินไม่รวมธุรกิจ · ยอดรวมถูกต้อง');
SELECT t.ok((SELECT (d->>'loans')::numeric = coalesce((SELECT sum(base_value) FROM public.v_net_worth_items_current
                                                         WHERE item_type = 'ASSET' AND item_subtype = 'LOAN_RECEIVABLE'), 0)
                AND (d->>'insurance')::numeric = coalesce((SELECT sum(base_value) FROM public.v_net_worth_items_current
                                                         WHERE item_type = 'ASSET' AND item_subtype = 'INSURANCE_CASH_VALUE'), 0)
                AND (d->>'financial')::numeric + (d->>'loans')::numeric + (d->>'insurance')::numeric + (d->>'business')::numeric
                    + (d->>'investment')::numeric + (d->>'property')::numeric + (d->>'alternative')::numeric = (d->>'total_assets')::numeric
                AND (d->>'total_assets')::numeric = (SELECT sum(base_value) FROM public.v_net_worth_items_current WHERE item_type = 'ASSET')
             FROM (SELECT public.dashboard_month(current_date) AS d) x),
            'Dashboard 7 หมวด: เงินให้กู้ · ประกันแยกออก · รวม 7 หมวด = ยอดสินทรัพย์ทั้งหมด');
-- Dashboard รายคน: ยอดตั้งต้นของทุกคนรวมกัน + ส่วนที่ยังไม่ระบุเจ้าของ = ยอดตั้งต้นครอบครัว · รายได้แบ่งแล้วไม่เกินยอดครอบครัว
CREATE TEMP TABLE pd AS SELECT p.id, public.person_dashboard(current_date, p.id) AS j FROM public.persons p WHERE p.deleted_at IS NULL;
SELECT t.ok((SELECT sum((j->'opening'->>'net_worth')::numeric) FROM pd)
              + (SELECT coalesce(sum(CASE WHEN n.item_type = 'ASSET' THEN n.base_value ELSE -n.base_value END), 0)
                   FROM public.families f, private.net_worth_items(f.id, f.go_live_date - 1, true) n WHERE n.person_id IS NULL)
            = (SELECT (public.net_worth_history()->'opening'->>'net_worth')::numeric),
            'Dashboard รายคน: ยอดตั้งต้นทุกคน + ไม่ระบุเจ้าของ = ยอดตั้งต้นครอบครัว');
SELECT t.ok((SELECT sum((j->>'income')::numeric + (j->>'investment_income')::numeric) FROM pd)
              <= (SELECT (p->>'income')::numeric + (p->>'investment_income')::numeric FROM (SELECT public.month_net_worth_preview(current_date) AS p) x) + 0.01
            AND (SELECT bool_and(j ? 'snapshots' AND j ? 'expenses' AND j ? 'reimbursements') FROM pd),
            'Dashboard รายคน: รายได้ที่แบ่งให้แต่ละคนรวมแล้วไม่เกินรายได้ครอบครัว');
SELECT t.ok((SELECT coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET'), 0) = (d->>'total_assets')::numeric
                AND coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET' AND item_group = 'LOANS'), 0) = (d->>'loans')::numeric
                AND coalesce(sum(base_value) FILTER (WHERE item_type = 'LIABILITY'), 0) = (d->>'total_liabilities')::numeric
               FROM public.month_family_items(current_date), (SELECT public.dashboard_month(current_date) AS d) x GROUP BY d),
            'Dashboard: รายการรายหมวดของครอบครัวรวมแล้วตรงกับยอดแต่ละหมวด');
RESET ROLE;

\echo '== 13j. พอร์ต: เงินสดหลายบัญชีต่อสกุล (บัญชีหลัก · เลือกบัญชี · โอนภายใน · ไม่นับซ้ำ)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000a');
INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency)
  SELECT id, 'INVESTMENT', 'INVESTMENT_PORTFOLIO', 'พอร์ตหลายบัญชี', 'USD' FROM public.families;
INSERT INTO public.investment_portfolios(asset_id, institution) VALUES (t.a('พอร์ตหลายบัญชี'), 'ธนาคารทดสอบ');
SELECT public.add_holding(t.a('พอร์ตหลายบัญชี'), 'CASH', 'เงินสด USD บัญชี A', NULL, 'USD', NULL, NULL, NULL) IS NOT NULL AS cash_a;
SELECT public.add_holding(t.a('พอร์ตหลายบัญชี'), 'CASH', 'เงินสด USD บัญชี B', NULL, 'USD', NULL, NULL, NULL) IS NOT NULL AS cash_b;
SELECT public.add_holding(t.a('พอร์ตหลายบัญชี'), 'BOND', 'หุ้นกู้ทดสอบ X', NULL, 'USD', NULL, NULL, NULL) IS NOT NULL AS bond_x;
-- ยอดเริ่ม (งวดก่อนหน้าปิดแล้ว → ใช้รายการปรับปรุงวันนี้): A 1,000 · B 6,000 แล้วซื้อหุ้นกู้ 1,000 จาก B
SELECT public.record_investment_tx(t.a('พอร์ตหลายบัญชี'),
  jsonb_build_object('type','ADJUSTMENT','direction','IN','date',current_date,'holding_id',t.h('เงินสด USD บัญชี A'),'amount',1000,'notes','ยอดเริ่มทดสอบ')) IS NOT NULL AS seed_a;
SELECT public.record_investment_tx(t.a('พอร์ตหลายบัญชี'),
  jsonb_build_object('type','ADJUSTMENT','direction','IN','date',current_date,'holding_id',t.h('เงินสด USD บัญชี B'),'amount',6000,'notes','ยอดเริ่มทดสอบ')) IS NOT NULL AS seed_b;
SELECT public.record_investment_tx(t.a('พอร์ตหลายบัญชี'),
  jsonb_build_object('type','BUY','date',current_date,'holding_id',t.h('หุ้นกู้ทดสอบ X'),'quantity',100,'price',10,
                     'cash_holding_id',t.h('เงินสด USD บัญชี B'))) IS NOT NULL AS buy_from_b;
SELECT t.ok((SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี A')) = 1000
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี B')) = 5000,
            'ปรับยอด / ซื้อ แยกตามบัญชีที่เลือก · ไม่นับซ้ำ');
SELECT t.ok((SELECT is_default_cash FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี A'))
            AND NOT (SELECT is_default_cash FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี B')),
            'บัญชีเงินสดแรกของสกุล = บัญชีหลักอัตโนมัติ');
SELECT t.fails($$UPDATE public.investment_holdings SET is_default_cash = true WHERE name = 'เงินสด USD บัญชี B'$$,
               'ih_default_cash_uq', 'บัญชีหลักมีได้สกุลละ 1 บัญชีต่อพอร์ต');
UPDATE public.investment_holdings SET is_default_cash = true WHERE name = 'หุ้นกู้ทดสอบ X';
SELECT t.ok((SELECT NOT is_default_cash FROM public.investment_holdings WHERE name = 'หุ้นกู้ทดสอบ X'), 'บัญชีหลักต้องเป็นเงินสด (หลักทรัพย์ตั้งไม่ได้)');
SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.set_default_cash_account(t.h('เงินสด USD บัญชี B'));
SELECT t.ok((SELECT NOT is_default_cash FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี A'))
            AND (SELECT is_default_cash FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี B')),
            'เปลี่ยนบัญชีหลักเป็นบัญชี B ได้');
-- ดอกเบี้ยของบัญชี A (เลือกบัญชีเป็น holding) · Coupon ไม่ระบุบัญชี → บัญชีหลัก B
SELECT public.record_investment_tx(t.a('พอร์ตหลายบัญชี'),
  jsonb_build_object('type','INTEREST','date',current_date,'holding_id',t.h('เงินสด USD บัญชี A'),'amount',10)) IS NOT NULL AS interest_a;
SELECT public.record_investment_tx(t.a('พอร์ตหลายบัญชี'),
  jsonb_build_object('type','COUPON','date',current_date,'holding_id',t.h('หุ้นกู้ทดสอบ X'),'amount',20)) IS NOT NULL AS coupon_default;
SELECT t.ok((SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี A')) = 1010
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี B')) = 5020,
            'ดอกเบี้ยเข้าเฉพาะบัญชี A · Coupon เข้าบัญชีหลัก B · ไม่นับซ้ำ 2 บัญชี');
-- ซื้อโดยเลือกจ่ายจากบัญชี A
SELECT public.record_investment_tx(t.a('พอร์ตหลายบัญชี'),
  jsonb_build_object('type','BUY','date',current_date,'holding_id',t.h('หุ้นกู้ทดสอบ X'),'quantity',10,'price',10,
                     'cash_holding_id',t.h('เงินสด USD บัญชี A'))) IS NOT NULL AS buy_from_a;
SELECT t.ok((SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี A')) = 910
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี B')) = 5020
            AND (SELECT quantity FROM public.investment_holdings WHERE id = t.h('หุ้นกู้ทดสอบ X')) = 110,
            'ซื้อจากบัญชีที่เลือก (A) · บัญชี B ไม่เปลี่ยน');
-- โอนภายในพอร์ต B → A
SELECT public.transfer_portfolio_cash(t.a('พอร์ตหลายบัญชี'),
  jsonb_build_object('from_holding_id',t.h('เงินสด USD บัญชี B'),'to_holding_id',t.h('เงินสด USD บัญชี A'),
                     'amount',500,'date',current_date)) IS NOT NULL AS internal_transfer;
SELECT t.ok((SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี A')) = 1410
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี B')) = 4520,
            'โอนระหว่างบัญชีในพอร์ต: B ลด 500 · A เพิ่ม 500');
SELECT t.ok((SELECT net_cash FROM public.v_investment_transactions_net WHERE transaction_type = 'CASH_TRANSFER') = 0
            AND NOT EXISTS (SELECT 1 FROM public.income_transactions i JOIN public.investment_transactions x ON x.id = i.source_transaction_id
                             WHERE x.transaction_type = 'CASH_TRANSFER'),
            'โอนภายในพอร์ต: ยอดสุทธิทั้งพอร์ต 0 · ไม่ใช่รายได้');
SELECT t.fails($$SELECT public.transfer_portfolio_cash(t.a('พอร์ตหลายบัญชี'),
  jsonb_build_object('from_holding_id',t.h('เงินสด USD บัญชี A'),'to_holding_id',t.h('เงินสด USD บัญชี A'),'amount',1,'date',current_date))$$,
  'ต้องต่างกัน', 'โอนเข้าบัญชีเดิมไม่ได้');
SELECT t.fails($$SELECT public.record_investment_tx(t.a('พอร์ตหลายบัญชี'),
  jsonb_build_object('type','COUPON','date',current_date,'holding_id',t.h('หุ้นกู้ทดสอบ X'),'amount',1,
                     'cash_holding_id',t.h('Cash USD')))$$,
  'ไม่ได้อยู่ในพอร์ตนี้', 'เลือกบัญชีเงินสดของพอร์ตอื่นไม่ได้');
-- แลกเงิน: จากบัญชี A → THB (สร้างบัญชี THB ให้อัตโนมัติ เป็นบัญชีหลักของ THB)
SELECT public.record_investment_fx(t.a('พอร์ตหลายบัญชี'),
  jsonb_build_object('date',current_date,'currency','USD','counter_currency','THB','amount',100,'counter_amount',3500,
                     'cash_holding_id',t.h('เงินสด USD บัญชี A'))) IS NOT NULL AS fx_from_a;
SELECT t.ok((SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี A')) = 1310
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี B')) = 4520
            AND (SELECT current_value FROM public.investment_holdings WHERE name = 'เงินสด THB'
                   AND portfolio_id = (SELECT id FROM public.investment_portfolios WHERE asset_id = t.a('พอร์ตหลายบัญชี'))) = 3500,
            'แลกเงินจากบัญชีที่เลือก · บัญชี THB ใหม่ได้รับเงิน');
-- ครบกำหนด: เงินต้นเข้าบัญชี A ที่เลือก
SELECT public.record_holding_maturity(t.h('หุ้นกู้ทดสอบ X'), current_date, 1100, NULL, NULL, NULL, NULL, 'ครบกำหนดทดสอบ',
                                      t.h('เงินสด USD บัญชี A')) IS NOT NULL AS matured;
SELECT t.ok((SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี A')) = 2410
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี B')) = 4520,
            'ครบกำหนด: เงินต้นเข้าบัญชีที่เลือก (A)');
-- Statement รายบัญชี: ใส่ยอดบัญชี B ตาม Statement → A ไม่เปลี่ยน
INSERT INTO public.investment_valuations(holding_id, valuation_date, price, quantity, market_value, source)
  VALUES (t.h('เงินสด USD บัญชี B'), current_date, 1, 4600, 4600, 'STATEMENT');
SELECT t.ok((SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี A')) = 2410
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี B')) = 4600,
            'Statement รายบัญชี: ยอด B ตาม Statement · A คงเดิม');
-- พอร์ตรวม = ผลรวมทุกบัญชี (สกุลพอร์ต USD · THB แปลงตามอัตรา)
SELECT t.ok((SELECT a.current_value FROM public.assets a WHERE a.id = t.a('พอร์ตหลายบัญชี'))
            = round(2410 + 4600 + 3500 / (SELECT private.fx_rate('USD', current_date)), 4),
            'มูลค่าพอร์ต = ผลรวมเงินสดทุกบัญชี (หุ้นกู้ครบกำหนดแล้ว)');
-- ลบบัญชีหลัก → บัญชีที่เหลือเป็นบัญชีหลักแทน
SELECT t.login('00000000-0000-0000-0000-00000000000a');
UPDATE public.investment_holdings SET deleted_at = now() WHERE id = t.h('เงินสด USD บัญชี B');
SELECT t.ok((SELECT is_default_cash FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี A')),
            'ลบบัญชีหลัก → บัญชีที่เหลือเป็นบัญชีหลักแทน');
-- เงินโอนเข้าพอร์ต = ระหว่างทาง จนบัญชีที่รับเงิน (บัญชีหลัก) มี Statement
SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.transfer_money(t.a('BBL USD'), t.a('พอร์ตหลายบัญชี'), 300, current_date, 0, 'เติมเงินทดสอบ') IS NOT NULL AS transferred_in;
SELECT t.ok((SELECT in_transit FROM public.v_portfolio_values WHERE asset_id = t.a('พอร์ตหลายบัญชี')) = 300
            AND (SELECT cash_holding_id FROM public.investment_transactions WHERE transaction_type = 'DEPOSIT'
                  AND portfolio_id = (SELECT id FROM public.investment_portfolios WHERE asset_id = t.a('พอร์ตหลายบัญชี'))) = t.h('เงินสด USD บัญชี A'),
            'โอนเข้าพอร์ต → เข้าบัญชีหลัก (A) เป็นเงินระหว่างทาง 300');
INSERT INTO public.investment_valuations(holding_id, valuation_date, price, quantity, market_value, source)
  VALUES (t.h('เงินสด USD บัญชี A'), current_date, 1, 2710, 2710, 'STATEMENT');
SELECT t.ok((SELECT in_transit FROM public.v_portfolio_values WHERE asset_id = t.a('พอร์ตหลายบัญชี')) = 0
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี A')) = 2710,
            'Statement ของบัญชีที่รับเงิน → เงินระหว่างทางเคลียร์ · ยอดตาม Statement');
-- มูลค่าเป็นบาทของพอร์ต = มูลค่าในสกุลเดิม × อัตรา ณ วันที่ดูยอด (ไม่ล็อกอัตราวัน Statement)
SELECT t.ok((SELECT round(hv.value_thb, 2) = round(hv.value * private.fx_rate('USD', '2026-09-15'), 2)
               FROM private.holding_value_at(t.h('AAPL'), '2026-09-15') hv)
            AND (SELECT round(hv.value_thb, 2) = round(hv.value * private.fx_rate('USD', '2026-08-20'), 2)
               FROM private.holding_value_at(t.h('AAPL'), '2026-08-20') hv)
            AND private.fx_rate('USD', '2026-09-15') <> private.fx_rate('USD', '2026-08-20'),
            'หลักทรัพย์ USD: บาท = มูลค่า × อัตรา ณ วันที่ดูยอด (คนละวัน = คนละอัตรา)');
SELECT t.ok((SELECT round(hv.value_thb, 2) = round(hv.value * private.fx_rate('USD', '2026-09-15'), 2)
               FROM private.holding_value_at(t.h('Cash USD'), '2026-09-15') hv),
            'เงินสด USD ในพอร์ต: บาท = ยอด × อัตรา ณ วันที่ดูยอด');
SELECT t.ok((SELECT round(sum(h.value_thb), 2) FROM public.v_holdings_active h WHERE h.portfolio_asset_id = t.a('พอร์ตหลายบัญชี'))
            = (SELECT round(thb_value, 2) FROM public.v_portfolio_values WHERE asset_id = t.a('พอร์ตหลายบัญชี'))
            AND (SELECT round(portfolio_value * portfolio_fx_rate, 2) = round(thb_value, 2) FROM public.v_portfolio_values
                  WHERE asset_id = t.a('พอร์ตหลายบัญชี')),
            'หน้าพอร์ต: บาทรายตัวรวมกัน = มูลค่าเป็นบาท · มูลค่าสกุลพอร์ต × อัตรา = มูลค่าเป็นบาท');
-- ผลตอบแทนในสกุลหลักทรัพย์ (ปุ่ม ดูเป็น USD): จำนวนแถวเท่ากัน · มูลค่า × อัตราวันนี้ = มูลค่าเป็นบาท · รวม = ส่วนประกอบ
SELECT t.ok((SELECT count(*) FROM public.investment_returns_local(t.a('Brokerage USD')))
              = (SELECT count(*) FROM public.investment_returns(t.a('Brokerage USD')))
            AND NOT EXISTS (SELECT 1 FROM public.investment_returns_local(t.a('Brokerage USD')) l
                              JOIN public.investment_returns(t.a('Brokerage USD')) b USING (holding_id)
                             WHERE abs(l.value * private.fx_rate('USD', current_date) - b.value_thb) > 0.05
                                OR l.total <> l.unrealized + l.realized + l.income - l.fees),
            'ผลตอบแทนสกุลหลักทรัพย์: มูลค่า × อัตราวันนี้ = มูลค่าเป็นบาท · รวม = ยังไม่รับรู้ + รับรู้ + รายได้ − ค่าธรรมเนียม');
SELECT t.ok((SELECT l.realized = 0 AND l.value = 0 AND l.cost = 0 FROM public.investment_returns_local(t.a('พอร์ตหลายบัญชี')) l
              WHERE l.name = 'หุ้นกู้ทดสอบ X')
            AND (SELECT l.income = 20 FROM public.investment_returns_local(t.a('พอร์ตหลายบัญชี')) l WHERE l.name = 'หุ้นกู้ทดสอบ X'),
            'หุ้นกู้ครบกำหนด: เงินคืน 1,100 = ต้นทุน 1,100 → รับรู้ 0 (สกุลเดิม) · Coupon นับเป็นรายได้');
-- พอร์ตเดิม (บัญชีเดียว) ไม่ได้รับผลกระทบ
SELECT t.ok((SELECT is_default_cash FROM public.investment_holdings WHERE id = t.h('Cash USD')), 'พอร์ตเดิม: เงินสดบัญชีเดียว = บัญชีหลัก');
RESET ROLE;

\echo '== 14. Views'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT person_name, round(total_assets) AS assets, round(total_liabilities) AS liabilities, round(net_worth) AS net_worth
  FROM public.v_net_worth_by_person ORDER BY person_name NULLS LAST;
SELECT liability_source, name, amount, derived_status FROM public.v_liabilities_all ORDER BY 1, 2;
SELECT name, to_char(income_period, 'YYYY-MM') AS period, status FROM public.v_expected_income ORDER BY 1, 2;
SELECT name, confirmed_balance, calculated_balance, balance_label FROM public.v_bank_balance_current;
\echo 'ALL SCENARIO TESTS PASSED'
