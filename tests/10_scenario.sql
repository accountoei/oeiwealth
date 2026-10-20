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

\echo '== 3b. เปลี่ยนวัน Go-live ก่อน Confirm (ย้ายยอดตั้งต้นให้)'
SELECT t.fails($$SELECT public.change_go_live_date('2026-08-01')$$, 'PERMISSION_DENIED', 'Go-live: EDITOR เปลี่ยนวันไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000a');
SELECT t.fails($$SELECT public.change_go_live_date('2026-08-15')$$, 'วันที่ 1 ของเดือน', 'Go-live: ต้องเป็นวันที่ 1 ของเดือน');
SELECT t.ok((public.change_go_live_date('2026-07-01') ->> 'changed')::boolean = false, 'Go-live: วันเดิม = ไม่เปลี่ยนอะไร');
SELECT public.change_go_live_date('2026-08-01') -> 'moved' AS moved_later;
SELECT t.ok((SELECT go_live_date FROM public.families) = '2026-08-01', 'Go-live: เลื่อนเป็น 1 ส.ค.');
SELECT t.ok((SELECT valuation_date FROM public.asset_valuations WHERE asset_id = t.a('KBank ออมทรัพย์') AND is_opening) = '2026-07-31'
            AND (SELECT valuation_date FROM public.asset_valuations WHERE asset_id = t.a('บ้าน A') AND is_opening) = '2026-07-31'
            AND (SELECT valuation_date FROM public.liability_valuations WHERE is_opening AND deleted_at IS NULL) = '2026-07-31'
            AND (SELECT opening_date FROM public.loan_details WHERE asset_id = t.a('เงินกู้ญาติ')) = '2026-07-31',
            'Go-live: ยอดตั้งต้น บัญชี / บ้าน / หนี้ / เงินให้กู้ ย้ายไปวันก่อน Go-live ใหม่');
SELECT t.ok((SELECT bool_and(transaction_date = '2026-07-31') FROM public.investment_transactions WHERE transaction_type = 'OPENING_BALANCE' AND deleted_at IS NULL)
            AND (SELECT valuation_date FROM public.investment_valuations WHERE holding_id = t.h('AAPL') AND deleted_at IS NULL) = '2026-07-31',
            'Go-live: ยอดตั้งต้นพอร์ต + ราคา ณ วันตั้งต้น ย้ายตาม');
SELECT t.ok((SELECT quantity = 10 AND average_cost = 150 AND current_value = 2000 FROM public.investment_holdings WHERE name = 'AAPL')
            AND (SELECT current_value FROM public.assets WHERE name = 'Brokerage USD') = 7000
            AND (SELECT current_value FROM public.assets WHERE name = 'KBank ออมทรัพย์') = 1000000
            AND (SELECT current_value FROM public.assets WHERE name = 'เงินกู้ญาติ') = 500000
            AND (SELECT outstanding_amount FROM public.liabilities) = 3000000,
            'Go-live: มูลค่าทุกรายการเท่าเดิมหลังย้ายวัน');
SELECT t.ok((SELECT balance_date FROM public.credit_cards) = '2026-06-25', 'Go-live: ยอดบัตรที่ไม่ได้ลงวันก่อน Go-live เดิม ไม่ย้าย');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.v_go_live_readiness WHERE status = 'MISSING'), 'Go-live: Readiness ยังไม่มี MISSING หลังเลื่อน');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.expense_items WHERE pending_split) AND NOT EXISTS (SELECT 1 FROM public.income_transactions WHERE pending_split),
            'Go-live: ย้ายวันไม่สร้างก้อนรอแยกรายละเอียด');
SELECT public.change_go_live_date('2026-07-01') -> 'moved' AS moved_back;
SELECT t.ok((SELECT go_live_date FROM public.families) = '2026-07-01'
            AND (SELECT valuation_date FROM public.asset_valuations WHERE asset_id = t.a('KBank ออมทรัพย์') AND is_opening) = '2026-06-30'
            AND (SELECT bool_and(transaction_date = '2026-06-30') FROM public.investment_transactions WHERE transaction_type = 'OPENING_BALANCE' AND deleted_at IS NULL)
            AND (SELECT opening_date FROM public.loan_details WHERE asset_id = t.a('เงินกู้ญาติ')) = '2026-06-30'
            AND (SELECT current_value FROM public.assets WHERE name = 'Brokerage USD') = 7000,
            'Go-live: เลื่อนกลับ 1 ก.ค. → ยอดตั้งต้นกลับไป 30 มิ.ย.');
SELECT t.fails($$SELECT public.change_go_live_date('2026-06-01')$$, 'GO_LIVE_CHANGE_BLOCKED.*ยอดตั้งต้นที่ลงวันที่',
               'Go-live: เลื่อนเร็วขึ้นแต่มียอดตั้งต้นลงวันที่หลังวันใหม่ (บัตร 25 มิ.ย.) → ปฏิเสธ');
SELECT t.fails($$SELECT public.change_go_live_date('2099-01-01')$$, 'GO_LIVE_CHANGE_BLOCKED.*ยังไม่ถึง',
               'Go-live: วันตั้งต้นใหม่ในอนาคต แต่มียอดตั้งต้นแล้ว → ปฏิเสธ');
SELECT t.ok((SELECT go_live_date FROM public.families) = '2026-07-01', 'Go-live: ปฏิเสธแล้วไม่แก้อะไร');
SELECT t.ok((SELECT count(*) FROM public.audit_logs WHERE action = 'EDIT_OPENING_POSITION' AND metadata ->> 'kind' = 'CHANGE_GO_LIVE_DATE') = 2, 'Go-live: บันทึก Audit ทุกครั้งที่เปลี่ยน');
SELECT t.ok(NOT has_function_privilege('anon', 'public.change_go_live_date(date)', 'EXECUTE'), 'Go-live: anon เรียกไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000e');

\echo '== 4. Go-live'
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.v_go_live_readiness WHERE status = 'MISSING'), 'Readiness ไม่มี MISSING');
SELECT t.fails($$SELECT public.confirm_go_live()$$, 'PERMISSION_DENIED', 'EDITOR Confirm Go-live ไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000a');
SELECT public.confirm_go_live() ->> 'status' AS go_live_status;
SELECT t.fails($$UPDATE public.families SET go_live_date = '2026-08-01'$$, 'GO_LIVE_LOCKED', 'หลัง LIVE แก้ go_live_date ไม่ได้');
SELECT t.fails($$SELECT public.change_go_live_date('2026-08-01')$$, 'GO_LIVE_LOCKED', 'Go-live: หลัง LIVE เปลี่ยนวันด้วยปุ่มไม่ได้');

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
SELECT t.ok((SELECT in_transit FROM public.v_portfolio_values) = 0 AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('Cash USD')) = 6000,
            'เงินโอนเข้าพอร์ต 1,000 USD เข้าบัญชีเงินฝากทันที (5,000 + 1,000) · ไม่เป็นเงินระหว่างทาง');
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
UPDATE public.credit_cards SET outstanding_balance = 8000, balance_date = '2026-07-27';
-- Mortgage + valuations ปลายเดือน
INSERT INTO public.liability_valuations(liability_id, valuation_date, balance, source)
  SELECT id, '2026-07-31', 2990000, 'STATEMENT' FROM public.liabilities;
INSERT INTO public.investment_valuations(holding_id, valuation_date, price, quantity, market_value) VALUES
  (t.h('AAPL'), '2026-07-31', 210, 10, 2100), (t.h('Cash USD'), '2026-07-31', 1, 6000, 6000);
SELECT t.ok((SELECT in_transit FROM public.v_portfolio_values) = 0 AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('Cash USD')) = 6000,
            'Statement ใหม่ ≥ วันโอน → ยอดตาม Statement (ไม่นับเงินโอนซ้ำ)');

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
SELECT t.ok((SELECT status FROM public.month_closing_checks('2026-07-01') WHERE category = 'LIABILITIES') IS DISTINCT FROM 'REVIEW',
            'จ่ายบัตรหลังวันที่ของยอด → ยอดบัตรลดเอง ไม่ต้องเตือนให้อัปเดตยอด');
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
SELECT t.ok((SELECT value = 8000 AND value_date = '2026-07-27' FROM public.net_worth_snapshot_items WHERE item_subtype = 'CREDIT_CARD'),
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
SELECT t.ok((SELECT status FROM public.month_closing_checks('2026-08-01') WHERE category = 'CASH') = 'REVIEW',
            'ส.ค. ยังไม่อัปเดตยอดสิ้นเดือน → CASH = REVIEW (เตือน · ใช้ยอดตามระบบ ปิดงวดได้)');
BEGIN;
SELECT t.ok(public.finalize_month('2026-08-01') IS NOT NULL, 'ไม่ได้อัปเดตยอดสิ้นเดือน → ยังปิดงวดได้ (ทดลองแล้วยกเลิก)');
ROLLBACK;
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
            AND (SELECT current_value FROM public.investment_holdings WHERE name = 'เงินฝาก THB'
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
SELECT (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี A')) AS a0 \gset
SELECT public.transfer_money(t.a('BBL USD'), t.a('พอร์ตหลายบัญชี'), 300, current_date, 0, 'เติมเงินทดสอบ') IS NOT NULL AS transferred_in;
SELECT t.ok((SELECT in_transit FROM public.v_portfolio_values WHERE asset_id = t.a('พอร์ตหลายบัญชี')) = 0
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี A')) = :a0 + 300
            AND (SELECT cash_holding_id FROM public.investment_transactions WHERE transaction_type = 'DEPOSIT'
                  AND portfolio_id = (SELECT id FROM public.investment_portfolios WHERE asset_id = t.a('พอร์ตหลายบัญชี'))) = t.h('เงินสด USD บัญชี A'),
            'โอนเข้าพอร์ต → เข้าบัญชีหลัก (A) +300 ทันที (ไม่เป็นเงินระหว่างทาง)');
INSERT INTO public.investment_valuations(holding_id, valuation_date, price, quantity, market_value, source)
  VALUES (t.h('เงินสด USD บัญชี A'), current_date, 1, 2710, 2710, 'STATEMENT');
SELECT t.ok((SELECT in_transit FROM public.v_portfolio_values WHERE asset_id = t.a('พอร์ตหลายบัญชี')) = 0
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี A')) = 2710,
            'Statement ของบัญชีที่รับเงิน → ยอดตาม Statement');
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

\echo '== 13k. หน้าพอร์ต: จัดลำดับ · แก้ไขพอร์ต · ลบพอร์ตเฉพาะ ADMIN'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT t.ok((SELECT bool_and(sort_order IS NOT NULL) FROM public.investment_holdings)
            AND (SELECT max(sort_order) FROM public.investment_holdings WHERE portfolio_id = (SELECT portfolio_id FROM public.investment_holdings WHERE id = t.h('AAPL')))
                > (SELECT sort_order FROM public.investment_holdings WHERE id = t.h('Cash USD')),
            'ทุกรายการมีลำดับ · รายการใหม่ต่อท้าย');
CREATE TEMP TABLE so AS SELECT id, sort_order FROM public.investment_holdings WHERE id IN (t.h('AAPL'), t.h('MSFT'), t.h('Cash USD'));
SELECT public.move_holding(t.h('MSFT'), -1);
SELECT t.ok((SELECT sort_order FROM public.investment_holdings WHERE id = t.h('MSFT'))
              < (SELECT sort_order FROM public.investment_holdings WHERE id = t.h('AAPL')),
            'เลื่อนหลักทรัพย์ขึ้น: MSFT อยู่ก่อน AAPL');
SELECT public.move_holding(t.h('MSFT'), -1);
SELECT t.ok((SELECT sort_order FROM public.investment_holdings WHERE id = t.h('MSFT'))
              > (SELECT sort_order FROM public.investment_holdings WHERE id = t.h('Cash USD')),
            'เลื่อนหลักทรัพย์ข้ามไปกลุ่มเงินสดไม่ได้ (บนสุดของกลุ่มแล้ว)');
SELECT t.ok((SELECT array_agg(name ORDER BY ord) FROM public.investment_returns(t.a('Brokerage USD')) WITH ORDINALITY r(holding_id, name, a,b,c,d,e,f,g,h2,i,j,k,l, ord)
              WHERE name IN ('AAPL','MSFT')) = ARRAY['MSFT','AAPL'],
            'ตารางผลตอบแทนเรียงตามลำดับกล่องหลักทรัพย์');
SELECT t.login('00000000-0000-0000-0000-00000000000c');
SELECT t.fails($$SELECT public.move_holding(t.h('MSFT'), 1)$$, 'PERMISSION_DENIED', 'CONTRIBUTOR จัดลำดับไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.update_portfolio(t.a('พอร์ตหลายบัญชี'), '{"name":"พอร์ตหลายบัญชี (แก้)","institution":"ธนาคารทดสอบ 2","portfolio_type":"OTHER","currency":"USD","notes":"ทดสอบ"}');
SELECT t.ok((SELECT a.name = 'พอร์ตหลายบัญชี (แก้)' AND p.institution = 'ธนาคารทดสอบ 2' AND p.portfolio_type = 'OTHER' AND a.notes = 'ทดสอบ'
               FROM public.assets a JOIN public.investment_portfolios p ON p.asset_id = a.id WHERE a.name = 'พอร์ตหลายบัญชี (แก้)'),
            'แก้ไขพอร์ต: ชื่อ / สถาบัน / ประเภท / หมายเหตุ');
SELECT t.fails($$SELECT public.update_portfolio(t.a('พอร์ตหลายบัญชี (แก้)'), '{"name":"x","currency":"XYZ"}')$$, 'ยังไม่มีอัตรา', 'เปลี่ยนเป็นสกุลที่ไม่มีอัตราแลกเปลี่ยนไม่ได้');
SELECT t.fails($$SELECT public.update_portfolio(t.a('พอร์ตหลายบัญชี (แก้)'), '{"name":""}')$$, 'กรุณาใส่ชื่อ', 'ชื่อพอร์ตห้ามว่าง');
-- ลบพอร์ต: EDITOR ไม่ได้ · ADMIN ได้ (พอร์ตที่มีแค่ยอดตั้งต้น) · ทรัพย์สินอื่น EDITOR ยังลบได้ตามเดิม
INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency)
  SELECT id, 'INVESTMENT', 'INVESTMENT_PORTFOLIO', 'พอร์ตลบทดสอบ', 'THB' FROM public.families;
INSERT INTO public.investment_portfolios(asset_id, institution) VALUES (t.a('พอร์ตลบทดสอบ'), 'ทดสอบ');
SELECT t.fails($$SELECT public.delete_asset(t.a('พอร์ตลบทดสอบ'), 'ทดสอบลบ')$$, 'เฉพาะผู้ดูแลระบบ', 'EDITOR ลบพอร์ตลงทุนไม่ได้');
INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency)
  SELECT id, 'ALTERNATIVE', 'COLLECTIBLE', 'ของสะสมลบทดสอบ', 'THB' FROM public.families;
SELECT public.delete_asset(t.a('ของสะสมลบทดสอบ'), 'ทดสอบลบ');
SELECT t.ok((SELECT deleted_at IS NOT NULL FROM public.assets WHERE name = 'ของสะสมลบทดสอบ'), 'EDITOR ยังลบทรัพย์สินอื่นได้ตามเดิม');
SELECT t.login('00000000-0000-0000-0000-00000000000a');
SELECT public.delete_asset(t.a('พอร์ตลบทดสอบ'), 'ทดสอบลบ');
SELECT t.ok((SELECT deleted_at IS NOT NULL FROM public.assets WHERE name = 'พอร์ตลบทดสอบ')
            AND (SELECT p.deleted_at IS NOT NULL FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id WHERE a.name = 'พอร์ตลบทดสอบ'),
            'ADMIN ลบพอร์ตลงทุนได้');
RESET ROLE;

\echo '== 13l. โอนเงิน ธนาคาร ↔ พอร์ต ข้ามสกุล · ยอดปลายทางใส่ทีหลัง · ค่าธรรมเนียม 2 ฝั่งเป็นค่าใช้จ่าย'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.add_holding(t.a('พอร์ตหลายบัญชี (แก้)'), 'CASH', 'เงินสด USD บัญชี C', NULL, 'USD', NULL, NULL, NULL) IS NOT NULL AS cash_c;
SELECT public.add_holding(t.a('พอร์ตหลายบัญชี (แก้)'), 'CASH', 'เงินสด USD บัญชี D', NULL, 'USD', NULL, NULL, NULL) IS NOT NULL AS cash_d;
SELECT public.record_investment_tx(t.a('พอร์ตหลายบัญชี (แก้)'),
  jsonb_build_object('type','ADJUSTMENT','direction','IN','date',current_date,'holding_id',t.h('เงินสด USD บัญชี D'),'amount',500,'notes','ยอดเริ่มทดสอบ')) IS NOT NULL AS seed_d;
CREATE TEMP TABLE x13l AS SELECT
  (SELECT calculated_balance FROM public.v_bank_balance_current WHERE name = 'KBank ออมทรัพย์') AS kb0,
  (SELECT in_transit FROM public.v_portfolio_values WHERE asset_id = t.a('พอร์ตหลายบัญชี (แก้)')) AS it0,
  (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี C')) AS c0,
  NULL::uuid AS m_in, NULL::uuid AS m_out;
-- ขาเข้า บาท → USD (บัญชี C) ยังไม่รู้ยอด USD
UPDATE x13l SET m_in = public.transfer_portfolio_money(t.a('พอร์ตหลายบัญชี (แก้)'),
  jsonb_build_object('direction','IN','bank_asset_id',t.a('KBank ออมทรัพย์'),'cash_holding_id',t.h('เงินสด USD บัญชี C'),
                     'date',current_date,'amount','34,000','fee',100,'description','ทดสอบข้ามสกุล'));
SELECT t.ok((SELECT calculated_balance FROM public.v_bank_balance_current WHERE name = 'KBank ออมทรัพย์') = (SELECT kb0 - 34100 FROM x13l),
            'ขาเข้ารอยอด: บัญชีบาทลด เงินที่ออก + ค่าธรรมเนียม ทันที');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.investment_transactions x WHERE x.cash_movement_id = (SELECT m_in FROM x13l) AND x.deleted_at IS NULL)
            AND abs((SELECT in_transit FROM public.v_portfolio_values WHERE asset_id = t.a('พอร์ตหลายบัญชี (แก้)'))
                    - (SELECT it0 FROM x13l) - 34000 / private.fx_rate('USD', current_date)) < 0.01,
            'ขาเข้ารอยอด: ยังไม่มีรายการฝาก · เงินระหว่างทาง = ยอดบาทที่ส่ง (แปลงเป็น USD) → ไม่หายจาก Net Worth');
SELECT t.ok((SELECT amount = 100 AND currency = 'THB' AND expense_category = 'BANK_FEE' FROM public.expense_items
              WHERE source_cash_movement_id = (SELECT m_in FROM x13l) AND deleted_at IS NULL),
            'ค่าธรรมเนียมฝั่งบาท = ค่าใช้จ่ายค่าธรรมเนียมธนาคาร');
-- ได้ Statement: ใส่ยอด USD ที่เข้าจริง 990 + ค่าธรรมเนียมปลายทาง 10
SELECT public.update_portfolio_transfer((SELECT m_in FROM x13l), '{"counter_amount":"990","counter_fee":"10"}');
SELECT t.ok((SELECT amount = 990 AND currency = 'USD' AND holding_id = t.h('เงินสด USD บัญชี C') AND transaction_type = 'DEPOSIT'
               FROM public.investment_transactions WHERE cash_movement_id = (SELECT m_in FROM x13l) AND deleted_at IS NULL)
            AND abs((SELECT in_transit FROM public.v_portfolio_values WHERE asset_id = t.a('พอร์ตหลายบัญชี (แก้)')) - (SELECT it0 FROM x13l)) < 0.0001
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี C')) = (SELECT c0 + 990 FROM x13l)
            AND (SELECT round(actual_fx_rate, 4) FROM public.cash_movements WHERE id = (SELECT m_in FROM x13l)) = round(34000 / 990.0, 4),
            'ใส่ยอดปลายทาง: บัญชี C +990 USD ทันที · หายจากเงินระหว่างทาง · อัตราที่ได้จริง = 34,000 ÷ 990');
SELECT t.ok((SELECT count(*) FROM public.expense_items WHERE source_cash_movement_id = (SELECT m_in FROM x13l) AND deleted_at IS NULL) = 2
            AND (SELECT amount = 10 AND currency = 'USD' FROM public.expense_items
                  WHERE source_cash_movement_id = (SELECT m_in FROM x13l) AND source_fee_side = 'TO' AND deleted_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM public.investment_transactions WHERE cash_movement_id = (SELECT m_in FROM x13l) AND transaction_type = 'FEE'),
            'ค่าธรรมเนียม 2 ฝั่ง = ค่าใช้จ่าย 2 รายการ (บาท + USD) · ไม่ลดผลตอบแทนพอร์ต');
INSERT INTO public.investment_valuations(holding_id, valuation_date, price, quantity, market_value, source)
  VALUES (t.h('เงินสด USD บัญชี C'), current_date, 1, 990, 990, 'STATEMENT');
SELECT t.ok((SELECT in_transit FROM public.v_portfolio_values WHERE asset_id = t.a('พอร์ตหลายบัญชี (แก้)')) = (SELECT it0 FROM x13l),
            'Statement บัญชี C → ไม่มีเงินระหว่างทาง');
-- ขาออก USD (บัญชี D) → บาท ยังไม่รู้ยอดบาท
UPDATE x13l SET kb0 = (SELECT calculated_balance FROM public.v_bank_balance_current WHERE name = 'KBank ออมทรัพย์'),
                it0 = (SELECT in_transit FROM public.v_portfolio_values WHERE asset_id = t.a('พอร์ตหลายบัญชี (แก้)'));
UPDATE x13l SET m_out = public.transfer_portfolio_money(t.a('พอร์ตหลายบัญชี (แก้)'),
  jsonb_build_object('direction','OUT','bank_asset_id',t.a('KBank ออมทรัพย์'),'cash_holding_id',t.h('เงินสด USD บัญชี D'),
                     'date',current_date,'amount',100,'fee',5));
SELECT t.ok((SELECT calculated_balance FROM public.v_bank_balance_current WHERE name = 'KBank ออมทรัพย์') = (SELECT kb0 FROM x13l)
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี D')) = 395
            AND (SELECT in_transit FROM public.v_portfolio_values WHERE asset_id = t.a('พอร์ตหลายบัญชี (แก้)')) = (SELECT it0 + 100 FROM x13l),
            'ขาออกรอยอด: บัญชีบาทยังไม่เพิ่ม · บัญชี D หัก 105 ทันที · ยอดที่ออก 100 เป็นเงินระหว่างทาง (Net Worth หักเฉพาะค่าธรรมเนียม 5)');
SELECT t.ok((SELECT amount = 5 AND currency = 'USD' FROM public.expense_items
              WHERE source_cash_movement_id = (SELECT m_out FROM x13l) AND coalesce(source_fee_side, 'FROM') = 'FROM' AND deleted_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM public.investment_transactions WHERE cash_movement_id = (SELECT m_out FROM x13l) AND transaction_type = 'FEE'),
            'ขาออก: ค่าธรรมเนียมฝั่ง USD = ค่าใช้จ่าย (ไม่ใช่ค่าธรรมเนียมพอร์ต)');
SELECT public.update_portfolio_transfer((SELECT m_out FROM x13l), '{"counter_amount":"3300"}');
SELECT t.ok((SELECT calculated_balance FROM public.v_bank_balance_current WHERE name = 'KBank ออมทรัพย์') = (SELECT kb0 + 3300 FROM x13l)
            AND (SELECT in_transit FROM public.v_portfolio_values WHERE asset_id = t.a('พอร์ตหลายบัญชี (แก้)')) = (SELECT it0 FROM x13l)
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี D')) = 395
            AND (SELECT round(actual_fx_rate, 4) FROM public.cash_movements WHERE id = (SELECT m_out FROM x13l)) = 33,
            'ใส่ยอดบาทที่เข้า: บัญชีบาท +3,300 · บัญชี D หัก 105 · ไม่มีเงินระหว่างทาง · อัตรา 33');
SELECT public.update_portfolio_transfer((SELECT m_out FROM x13l), '{"counter_amount":"","fee":""}');
SELECT t.ok((SELECT calculated_balance FROM public.v_bank_balance_current WHERE name = 'KBank ออมทรัพย์') = (SELECT kb0 FROM x13l)
            AND NOT EXISTS (SELECT 1 FROM public.expense_items WHERE source_cash_movement_id = (SELECT m_out FROM x13l) AND deleted_at IS NULL),
            'แก้กลับเป็นรอยอด / ลบค่าธรรมเนียมได้ (ค่าใช้จ่ายหายตาม)');
SELECT t.ok((SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินสด USD บัญชี D')) = 400
            AND (SELECT in_transit FROM public.v_portfolio_values WHERE asset_id = t.a('พอร์ตหลายบัญชี (แก้)')) = (SELECT it0 + 100 FROM x13l),
            'แก้เฉพาะค่าธรรมเนียม → ยอดบัญชี D คำนวณใหม่ทันที (หัก 100) · รอยอดธนาคาร 100 ยังเป็นเงินระหว่างทาง');
SELECT t.fails($$SELECT public.transfer_portfolio_money(t.a('พอร์ตหลายบัญชี (แก้)'),
  jsonb_build_object('direction','IN','bank_asset_id',t.a('KBank ออมทรัพย์'),'cash_holding_id',t.h('Cash USD'),'date',current_date,'amount',10))$$,
  'ไม่ได้อยู่ในพอร์ตนี้', 'โอนเข้าบัญชีเงินสดของพอร์ตอื่นไม่ได้');
SELECT t.fails($$SELECT public.transfer_portfolio_money(t.a('พอร์ตหลายบัญชี (แก้)'),
  jsonb_build_object('direction','IN','bank_asset_id',t.a('KBank ออมทรัพย์'),'date',current_date,'amount',10,'counter_amount',0))$$,
  'มากกว่า 0', 'ยอดที่เข้า 0 ไม่ได้ (ไม่ทราบ = เว้นว่าง)');
SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$SELECT public.transfer_portfolio_money(t.a('พอร์ตหลายบัญชี (แก้)'),
  jsonb_build_object('direction','IN','bank_asset_id',t.a('KBank ออมทรัพย์'),'date',current_date,'amount',10))$$,
  'PERMISSION_DENIED', 'VIEWER บันทึกการโอนไม่ได้');
RESET ROLE;

\echo '== 13m. คำว่า "เงินฝากในพอร์ต" (ชื่อบัญชีที่ระบบสร้าง)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.investment_holdings WHERE holding_type = 'CASH' AND name ~ '^เงินสด [A-Z]{3}$')
            AND EXISTS (SELECT 1 FROM public.investment_holdings WHERE holding_type = 'CASH' AND name = 'เงินฝาก THB'),
            'บัญชีที่ระบบสร้างอัตโนมัติชื่อ "เงินฝาก XXX"');
RESET ROLE;

\echo '== 13n. ธุรกิจ: เจ้าของเป็นจำนวนหุ้น (มูลค่ารายคนไม่ปัดเศษ · หน้าแรกแสดงหุ้น / % ของบริษัท)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.create_private_business(jsonb_build_object(
  'name','บริษัทหุ้นทดสอบ','company_name','บริษัท ทดสอบหุ้น จำกัด','total_shares',10000,'investment_cost',900000,
  'value',900000,'value_date',current_date,'is_opening',false,'acquisition_date',current_date,'valuation_method','BOOK_VALUE',
  'owners', jsonb_build_array(jsonb_build_object('person_id',t.p('คุณพ่อ'),'shares',4000), jsonb_build_object('person_id',t.p('คุณแม่'),'shares',5000)))) IS NOT NULL AS biz;
SELECT t.ok((SELECT shares_owned = 9000 AND company_ownership_percent = 90 FROM public.private_business_details WHERE company_name = 'บริษัท ทดสอบหุ้น จำกัด')
            AND (SELECT ownership_percent FROM public.asset_ownerships WHERE asset_id = t.a('บริษัทหุ้นทดสอบ') AND person_id = t.p('คุณพ่อ') AND deleted_at IS NULL) = 44.4444,
            'สร้างธุรกิจด้วยจำนวนหุ้น: หุ้นครอบครัว 9,000 · 90% ของบริษัท · % ภายในครอบครัวคำนวณให้ (44.4444)');
SELECT t.ok((SELECT base_value FROM public.v_net_worth_items_current WHERE asset_id = t.a('บริษัทหุ้นทดสอบ') AND person_id = t.p('คุณพ่อ')) = 400000
            AND (SELECT base_value FROM public.v_net_worth_items_current WHERE asset_id = t.a('บริษัทหุ้นทดสอบ') AND person_id = t.p('คุณแม่')) = 500000
            AND NOT EXISTS (SELECT 1 FROM public.v_net_worth_items_current WHERE asset_id = t.a('บริษัทหุ้นทดสอบ') AND person_id IS NULL),
            'มูลค่ารายคนจากหุ้นไม่ปัดเศษ: 400,000.00 / 500,000.00 · ไม่มีส่วน "ไม่ระบุเจ้าของ"');
SELECT t.ok((SELECT share_note FROM public.month_person_items(current_date, t.p('คุณพ่อ')) WHERE item_name = 'บริษัทหุ้นทดสอบ') = '4,000 หุ้น · 40% ของบริษัท',
            'หน้าแรก: แสดง "4,000 หุ้น · 40% ของบริษัท"');
SELECT public.set_asset_ownership(t.a('บริษัทหุ้นทดสอบ'),
  jsonb_build_array(jsonb_build_object('person_id',t.p('คุณพ่อ'),'shares',4500), jsonb_build_object('person_id',t.p('คุณแม่'),'shares',4500)), 'CORRECT', NULL);
SELECT t.ok((SELECT shares_owned = 9000 FROM public.private_business_details WHERE company_name = 'บริษัท ทดสอบหุ้น จำกัด')
            AND (SELECT base_value FROM public.v_net_worth_items_current WHERE asset_id = t.a('บริษัทหุ้นทดสอบ') AND person_id = t.p('คุณพ่อ')) = 450000,
            'แก้จำนวนหุ้นรายคน → มูลค่ารายคนเปลี่ยนตาม');
UPDATE public.private_business_details SET par_value = 100 WHERE company_name = 'บริษัท ทดสอบหุ้น จำกัด';
SELECT t.ok((SELECT total_shares * par_value FROM public.private_business_details WHERE company_name = 'บริษัท ทดสอบหุ้น จำกัด') = 1000000,
            'มูลค่าหุ้นที่ตราไว้ (par) → ทุนจดทะเบียน = หุ้นทั้งหมด × par');
SELECT t.fails($$UPDATE public.private_business_details SET par_value = 0 WHERE company_name = 'บริษัท ทดสอบหุ้น จำกัด'$$, 'pbd_par_value_ck', 'par ต้องมากกว่า 0');
-- หุ้นหารไม่ลงตัว (3 คน × 3,000 หุ้น → 33.33…% × 3 = 99.99999…%) → หน้า Opening ต้องไม่เตือน "ระบุเจ้าของไม่ครบ"
SELECT public.set_asset_ownership(t.a('บริษัทหุ้นทดสอบ'),
  jsonb_build_array(jsonb_build_object('person_id',t.p('คุณพ่อ'),'shares',3000), jsonb_build_object('person_id',t.p('คุณแม่'),'shares',3000),
                    jsonb_build_object('person_id',t.p('ญาติทดสอบ'),'shares',3000)), 'CORRECT', NULL);
RESET ROLE;
SELECT t.ok((SELECT sum(pct) FROM private.asset_owner_shares(t.a('บริษัทหุ้นทดสอบ'), current_date) WHERE person_id IS NOT NULL) < 100
            AND NOT EXISTS (SELECT 1 FROM private.go_live_readiness(private.default_family_id()) r WHERE r.category = 'OWNERSHIP' AND r.entity_id = t.a('บริษัทหุ้นทดสอบ')),
            'หุ้นหารไม่ลงตัว (รวม 99.99999…%) → Opening ไม่เตือนระบุเจ้าของไม่ครบ');
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.set_asset_ownership(t.a('บริษัทหุ้นทดสอบ'),
  jsonb_build_array(jsonb_build_object('person_id',t.p('คุณพ่อ'),'shares',4500), jsonb_build_object('person_id',t.p('คุณแม่'),'shares',4500)), 'CORRECT', NULL);
SELECT t.fails($$SELECT public.set_asset_ownership(t.a('บริษัทหุ้นทดสอบ'),
  jsonb_build_array(jsonb_build_object('person_id',t.p('คุณพ่อ'),'shares',8000), jsonb_build_object('person_id',t.p('คุณแม่'),'shares',4000)), 'CORRECT', NULL)$$,
  'เกินจำนวนหุ้นทั้งหมด', 'หุ้นรวมเกินหุ้นทั้งหมดของบริษัทไม่ได้');
SELECT t.fails($$SELECT public.set_asset_ownership(t.a('KBank ออมทรัพย์'),
  jsonb_build_array(jsonb_build_object('person_id',t.p('คุณพ่อ'),'shares',10)), 'CORRECT', NULL)$$,
  'เฉพาะธุรกิจ', 'ทรัพย์สินที่ไม่ใช่ธุรกิจระบุเป็นหุ้นไม่ได้');
RESET ROLE;

\echo '== 13o. รายคนตามบัญชี / บัตร · จ่ายหนี้แยกเงินต้น / ดอกเบี้ย · บัตรตัดบัญชีอัตโนมัติ'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
-- ค่าใช้จ่ายจากบัญชี (ไม่ระบุคน) → เจ้าของบัญชี · จ่ายจากบัญชีแต่ระบุคนเอง → คนนั้น 100%
SELECT public.add_expense(jsonb_build_object('date', current_date, 'description', 'ทดสอบแบ่งตามบัญชี', 'amount', 1000,
  'paid_from_asset_id', t.a('KBank ออมทรัพย์'))) IS NOT NULL AS e1;
SELECT public.add_expense(jsonb_build_object('date', current_date, 'description', 'ทดสอบระบุคนเอง', 'amount', 700,
  'paid_from_asset_id', t.a('KBank ออมทรัพย์'), 'person_id', t.p('คุณแม่'))) IS NOT NULL AS e2;
SELECT t.ok((SELECT string_agg(coalesce(p.name, '-') || ':' || v.share_percent::int, ',') FROM public.v_expense_by_person v
              JOIN public.expense_items i ON i.id = v.expense_item_id LEFT JOIN public.persons p ON p.id = v.person_id
             WHERE i.description = 'ทดสอบแบ่งตามบัญชี') = 'คุณพ่อ:100',
            'ค่าใช้จ่ายจากบัญชี (ไม่ระบุคน) → แบ่งตามเจ้าของบัญชี');
SELECT t.ok((SELECT string_agg(coalesce(p.name, '-') || ':' || v.share_percent::int, ',') FROM public.v_expense_by_person v
              JOIN public.expense_items i ON i.id = v.expense_item_id LEFT JOIN public.persons p ON p.id = v.person_id
             WHERE i.description = 'ทดสอบระบุคนเอง') = 'คุณแม่:100',
            'ระบุ "ของใคร" เอง → ใช้คนนั้นก่อนเจ้าของบัญชี (ไม่นับซ้ำ)');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.v_expense_by_person GROUP BY expense_item_id HAVING abs(sum(share_percent) - 100) > 0.0001),
            'ทุกรายการค่าใช้จ่ายแบ่งรวมได้ 100% พอดี');
-- รายได้ที่ไม่ระบุคน / ทรัพย์สิน → เจ้าของบัญชีที่รับเงิน
INSERT INTO public.income_transactions(family_id, received_to_asset_id, date, income_type, amount, currency, notes)
  SELECT id, t.a('KBank ออมทรัพย์'), current_date, 'OTHER', 500, 'THB', 'ทดสอบรายได้ตามบัญชี' FROM public.families;
SELECT t.ok((SELECT v.person_id = t.p('คุณพ่อ') AND v.share_percent = 100 FROM public.v_income_by_person v
              JOIN public.income_transactions i ON i.id = v.income_id WHERE i.notes = 'ทดสอบรายได้ตามบัญชี'),
            'รายได้ (ไม่ระบุคน) → แบ่งตามเจ้าของบัญชีที่รับเงิน');
SELECT t.ok((SELECT (public.person_dashboard(current_date, t.p('คุณแม่'))->>'expenses')::numeric
              >= 700 AND (public.person_dashboard(current_date, t.p('คุณพ่อ'))->>'income')::numeric >= 500),
            'Dashboard รายคนใช้กติกาเดียวกัน (ค่าใช้จ่ายที่ระบุคน / รายได้ตามบัญชี)');

-- จ่ายหนี้: เงินต้น 10,000 ลดยอดหนี้ · ดอกเบี้ย 2,000 เป็นค่าใช้จ่าย "ดอกเบี้ยจ่าย"
SELECT (SELECT outstanding_amount FROM public.liabilities WHERE name = 'สินเชื่อบ้าน') AS debt_before \gset
SELECT public.pay_liability(jsonb_build_object('liability_id', (SELECT id FROM public.liabilities WHERE name = 'สินเชื่อบ้าน'),
  'bank_asset_id', t.a('KBank ออมทรัพย์'), 'date', current_date, 'principal', 10000, 'interest', 2000)) IS NOT NULL AS paid;
SELECT t.ok((SELECT outstanding_amount FROM public.liabilities WHERE name = 'สินเชื่อบ้าน') = :debt_before - 10000
            AND (SELECT balance_date FROM public.liabilities WHERE name = 'สินเชื่อบ้าน') = current_date,
            'จ่ายเงินต้น → ยอดหนี้ลดลงทันที');
SELECT t.ok((SELECT sum(base_value) FROM public.v_net_worth_items_current WHERE liability_id = (SELECT id FROM public.liabilities WHERE name = 'สินเชื่อบ้าน'))
              = :debt_before - 10000, 'Net Worth ใช้ยอดหนี้หลังหักเงินต้น');
SELECT t.ok((SELECT count(*) FROM public.expense_items WHERE expense_category = 'ดอกเบี้ยจ่าย' AND amount = 2000 AND deleted_at IS NULL
              AND liability_id = (SELECT id FROM public.liabilities WHERE name = 'สินเชื่อบ้าน')) = 1
            AND EXISTS (SELECT 1 FROM public.cash_movements WHERE movement_type = 'EXPENSE' AND amount = 2000 AND is_derived AND deleted_at IS NULL),
            'ดอกเบี้ย → ค่าใช้จ่าย "ดอกเบี้ยจ่าย" + เงินออกจากบัญชี');
SELECT t.fails($$SELECT public.pay_liability(jsonb_build_object('liability_id', (SELECT id FROM public.liabilities WHERE name = 'สินเชื่อบ้าน'),
  'bank_asset_id', t.a('KBank ออมทรัพย์'), 'date', current_date, 'principal', 99000000))$$, 'มากกว่ายอดหนี้คงค้าง', 'เงินต้นเกินยอดหนี้ไม่ได้');
UPDATE public.cash_movements SET deleted_at = now() WHERE reduces_liability AND movement_date = current_date;
SELECT t.ok((SELECT outstanding_amount FROM public.liabilities WHERE name = 'สินเชื่อบ้าน') = :debt_before,
            'ลบรายการจ่ายเงินต้น → ยอดหนี้กลับคืน');

-- บัตรตัดบัญชีอัตโนมัติ
SELECT t.fails($$UPDATE public.credit_cards SET autopay_asset_id = t.a('KBank ออมทรัพย์') WHERE card_last4 = '7788'$$,
               'cc_autopay', 'ตั้งบัญชีตัดต้องเลือกแบบ เต็มจำนวน / ขั้นต่ำ ด้วย');
UPDATE public.credit_cards SET autopay_asset_id = t.a('KBank ออมทรัพย์'), autopay_mode = 'FULL' WHERE card_last4 = '7788';
SELECT (SELECT outstanding_balance FROM public.credit_cards WHERE card_last4 = '7788') AS card_before \gset
SELECT public.pay_credit_card(jsonb_build_object('card_id', (SELECT id FROM public.credit_cards WHERE card_last4 = '7788'),
  'bank_asset_id', t.a('KBank ออมทรัพย์'), 'date', current_date, 'amount', 3000, 'autopay', true)) IS NOT NULL AS card_paid;
SELECT t.ok((SELECT outstanding_balance = :card_before FROM public.credit_cards WHERE card_last4 = '7788')
            AND (SELECT current_balance FROM public.v_card_balances WHERE card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '7788'))
                = greatest(:card_before + private.card_activity((SELECT id FROM public.credit_cards WHERE card_last4 = '7788'),
                    (SELECT balance_date FROM public.credit_cards WHERE card_last4 = '7788'), current_date), 0)
            AND EXISTS (SELECT 1 FROM public.cash_movements WHERE movement_type = 'CARD_PAYMENT' AND amount = 3000 AND (metadata->>'autopay')::boolean),
            'ยืนยันตัดบัญชีอัตโนมัติ → บันทึกจ่ายบัตร · ยอด Statement คงเดิม · ยอดปัจจุบันลดตามการจ่าย');
RESET ROLE;

\echo '== 13p. จัดลำดับรายการ (swap_sort_order · move_health_metric)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT (SELECT sort_order FROM public.assets WHERE id = t.a('KBank ออมทรัพย์')) AS so_k, (SELECT sort_order FROM public.assets WHERE id = t.a('BBL USD')) AS so_b \gset
SELECT t.ok(:so_k IS NOT NULL AND :so_b IS NOT NULL AND :so_k <> :so_b, 'บัญชีทุกบัญชีมีลำดับ (ไม่ซ้ำ)');
SELECT public.swap_sort_order('assets', t.a('KBank ออมทรัพย์'), t.a('BBL USD'));
SELECT t.ok((SELECT sort_order FROM public.assets WHERE id = t.a('KBank ออมทรัพย์')) = :so_b
            AND (SELECT sort_order FROM public.assets WHERE id = t.a('BBL USD')) = :so_k, 'สลับลำดับบัญชีสองบัญชีได้');
SELECT t.fails($$SELECT public.swap_sort_order('assets', t.a('KBank ออมทรัพย์'), t.a('บริษัทหุ้นทดสอบ'))$$, 'คนละกลุ่ม', 'สลับข้ามหน้า (บัญชี ↔ ธุรกิจ) ไม่ได้');
SELECT t.fails($$SELECT public.swap_sort_order('persons', t.a('KBank ออมทรัพย์'), t.a('BBL USD'))$$, 'ประเภทนี้ไม่ได้', 'ตารางที่ไม่อยู่ในรายการจัดลำดับไม่ได้');
INSERT INTO public.memberships(person_id, program_name) VALUES (t.p('คุณพ่อ'), 'สมาชิก A'), (t.p('คุณพ่อ'), 'สมาชิก B');
SELECT t.ok((SELECT sort_order FROM public.memberships WHERE program_name = 'สมาชิก B') > (SELECT sort_order FROM public.memberships WHERE program_name = 'สมาชิก A'),
            'รายการใหม่ต่อท้าย');
SELECT public.swap_sort_order('memberships', (SELECT id FROM public.memberships WHERE program_name = 'สมาชิก A'), (SELECT id FROM public.memberships WHERE program_name = 'สมาชิก B'));
SELECT t.ok((SELECT sort_order FROM public.memberships WHERE program_name = 'สมาชิก B') < (SELECT sort_order FROM public.memberships WHERE program_name = 'สมาชิก A'),
            'สลับลำดับสมาชิกภาพได้');
SELECT public.add_health_checkup(jsonb_build_object('person_id', t.p('คุณพ่อ'), 'checkup_date', current_date,
  'results', jsonb_build_array(jsonb_build_object('metric','FBS','value_numeric',90), jsonb_build_object('metric','LDL','value_numeric',120)))) IS NOT NULL AS hc;
SELECT public.move_health_metric(t.p('คุณพ่อ'), 'LDL', 'FBS');
SELECT t.ok((SELECT sort_order FROM public.health_results WHERE metric = 'LDL' AND deleted_at IS NULL LIMIT 1)
            < (SELECT sort_order FROM public.health_results WHERE metric = 'FBS' AND deleted_at IS NULL LIMIT 1), 'จัดลำดับรายการผลตรวจได้');
SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$SELECT public.swap_sort_order('assets', t.a('KBank ออมทรัพย์'), t.a('BBL USD'))$$, 'PERMISSION', 'VIEWER จัดลำดับไม่ได้');
RESET ROLE;

\echo '== 13q. ส่วนต่าง → ก้อนรอแยกรายละเอียด (ธนาคาร / บัตร / เงินกู้) · ปรับอัตโนมัติ · แยกรายการ'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.create_bank_account('บัญชีทดสอบก้อน', 'ทดสอบ', 'THB', 10000, '2026-08-31', false, 'SAVING', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('person_id', t.p('คุณพ่อ'), 'percent', 100)), NULL, NULL) IS NOT NULL AS lump_bank;
SELECT public.add_expense(jsonb_build_object('date','2026-09-10','description','ค่าใช้จ่ายทดสอบก้อน','amount',1000,
  'paid_from_asset_id', t.a('บัญชีทดสอบก้อน'))) IS NOT NULL AS e1;
SELECT public.prepare_bank_reconciliation(t.a('บัญชีทดสอบก้อน'), '2026-09-01') IS NOT NULL AS rec;
SELECT public.settle_bank_difference((SELECT id FROM public.bank_reconciliations WHERE bank_asset_id = t.a('บัญชีทดสอบก้อน')), 8500)->>'kind' AS lump_kind;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND paid_from_asset_id = t.a('บัญชีทดสอบก้อน') AND deleted_at IS NULL) = 500
            AND (SELECT status FROM public.bank_reconciliations WHERE bank_asset_id = t.a('บัญชีทดสอบก้อน')) = 'RECONCILED',
            'กระทบยอด: เงินหาย 500 → ค่าใช้จ่ายก้อนรอแยก 500 · กระทบยอดผ่าน');
SELECT public.add_expense(jsonb_build_object('date','2026-09-15','description','เจอใบเสร็จ','amount',200,
  'paid_from_asset_id', t.a('บัญชีทดสอบก้อน'))) IS NOT NULL AS e2;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND paid_from_asset_id = t.a('บัญชีทดสอบก้อน') AND deleted_at IS NULL) = 300,
            'บันทึกค่าใช้จ่ายจริงเพิ่มในเดือนเดียวกัน → ก้อนลดเองเหลือ 300');
SELECT t.ok(public.split_pending_item('EXPENSE', (SELECT id FROM public.expense_items WHERE pending_split AND paid_from_asset_id = t.a('บัญชีทดสอบก้อน') AND deleted_at IS NULL),
  jsonb_build_array(jsonb_build_object('description','ค่ากาแฟ','amount',100,'expense_category','อาหาร'))) = 200,
  'แยกรายการ 100 → ก้อนเหลือ 200 · ยอดรวมเท่าเดิม');
SELECT t.fails($$UPDATE public.expense_items SET amount = 1 WHERE pending_split AND paid_from_asset_id = t.a('บัญชีทดสอบก้อน')$$,
  'แยกรายการ', 'แก้ยอดก้อนรอแยกตรง ๆ ไม่ได้');
SELECT t.fails($$SELECT public.split_pending_item('EXPENSE', (SELECT id FROM public.expense_items WHERE pending_split AND paid_from_asset_id = t.a('บัญชีทดสอบก้อน') AND deleted_at IS NULL),
  jsonb_build_array(jsonb_build_object('description','เกิน','amount',999)))$$, 'มากกว่ายอดรอแยก', 'แยกเกินยอดก้อนไม่ได้');
-- เงินเกิน → รายได้ก้อน
SELECT public.create_bank_account('บัญชีทดสอบก้อน 2', 'ทดสอบ', 'THB', 10000, '2026-08-31', false, 'SAVING', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('person_id', t.p('คุณพ่อ'), 'percent', 100)), NULL, NULL) IS NOT NULL AS lump_bank2;
SELECT public.prepare_bank_reconciliation(t.a('บัญชีทดสอบก้อน 2'), '2026-09-01') IS NOT NULL AS rec2;
SELECT public.settle_bank_difference((SELECT id FROM public.bank_reconciliations WHERE bank_asset_id = t.a('บัญชีทดสอบก้อน 2')), 10300)->>'kind' AS lump_kind2;
SELECT t.ok((SELECT amount FROM public.income_transactions WHERE pending_split AND received_to_asset_id = t.a('บัญชีทดสอบก้อน 2') AND deleted_at IS NULL) = 300,
            'กระทบยอด: เงินเกิน 300 → รายได้ก้อนรอแยก 300');
SELECT t.ok(public.split_pending_item('INCOME', (SELECT id FROM public.income_transactions WHERE pending_split AND received_to_asset_id = t.a('บัญชีทดสอบก้อน 2') AND deleted_at IS NULL),
  jsonb_build_array(jsonb_build_object('description','ดอกเบี้ยเงินฝาก','amount',300,'income_type','INTEREST'))) = 0, 'แยกรายได้ครบ → เหลือ 0');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.income_transactions WHERE pending_split AND received_to_asset_id = t.a('บัญชีทดสอบก้อน 2') AND deleted_at IS NULL)
            AND EXISTS (SELECT 1 FROM public.income_transactions WHERE income_type = 'INTEREST' AND received_to_asset_id = t.a('บัญชีทดสอบก้อน 2') AND deleted_at IS NULL),
            'ก้อนหายไป · มีรายได้ดอกเบี้ยแทน');
-- บัตรเครดิต
INSERT INTO public.credit_cards(person_id, issuer, card_name, card_last4, outstanding_balance, balance_date)
  VALUES (t.p('คุณพ่อ'), 'ทดสอบ', 'ก้อน', '4455', 1000, '2026-09-01');
SELECT public.add_expense(jsonb_build_object('date','2026-09-20','description','รูดบัตรทดสอบ','amount',300,
  'paid_from_credit_card_id', (SELECT id FROM public.credit_cards WHERE card_last4 = '4455'))) IS NOT NULL AS c1;
SELECT (public.update_card_statement((SELECT id FROM public.credit_cards WHERE card_last4 = '4455'), '2026-09-30', 2000, true))->>'lump' AS card_lump;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND lump_kind = 'CARD' AND deleted_at IS NULL) = 700
            AND (SELECT outstanding_balance FROM public.credit_cards WHERE card_last4 = '4455') = 2000,
            'ยอดบัตรจาก Statement สูงกว่าที่บันทึก 700 → ค่าใช้จ่ายก้อน (จ่ายด้วยบัตร) · อัปเดตยอดบัตร');
SELECT public.add_expense(jsonb_build_object('date','2026-09-25','description','รูดบัตรที่ลืม','amount',200,
  'paid_from_credit_card_id', (SELECT id FROM public.credit_cards WHERE card_last4 = '4455'))) IS NOT NULL AS c2;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND lump_kind = 'CARD' AND deleted_at IS NULL) = 500,
            'บันทึกรายการบัตรที่ลืม → ก้อนบัตรลดเองเหลือ 500');
-- เงินกู้
INSERT INTO public.liabilities(family_id, liability_type, name, currency) SELECT id, 'PERSONAL_LOAN', 'หนี้ทดสอบก้อน', 'THB' FROM public.families;
INSERT INTO public.liability_valuations(liability_id, valuation_date, balance, source)
  SELECT id, '2026-08-31', 100000, 'STATEMENT' FROM public.liabilities WHERE name = 'หนี้ทดสอบก้อน';
SELECT (public.update_liability_statement((SELECT id FROM public.liabilities WHERE name = 'หนี้ทดสอบก้อน'), '2026-09-30', 100500, 'STATEMENT', NULL, true))->>'lump' AS liab_lump;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND lump_kind = 'LIABILITY' AND deleted_at IS NULL) = 500
            AND (SELECT outstanding_amount FROM public.liabilities WHERE name = 'หนี้ทดสอบก้อน') = 100500,
            'ยอดหนี้จาก Statement สูงกว่าที่คำนวณ 500 → ค่าใช้จ่ายก้อน (ดอกเบี้ย / ค่าธรรมเนียม)');
-- งวดที่ปิดแล้ว: ปกติแก้ไม่ได้ · ระหว่างแยกรายการ (flag) ทำได้
SELECT t.fails($$SELECT public.add_expense(jsonb_build_object('date','2026-07-15','description','ย้อนงวด','amount',1))$$, 'PERIOD_LOCKED', 'งวดที่ปิดแล้วเพิ่มค่าใช้จ่ายไม่ได้');
BEGIN;
SELECT set_config('fwv.split', 'on', true);
SELECT t.ok(public.add_expense(jsonb_build_object('date','2026-07-15','description','แยกในงวดปิด','amount',1)) IS NOT NULL,
            'งวดที่ปิดแล้ว: ยอมเฉพาะระหว่างแยกรายการ');
ROLLBACK;
RESET ROLE;

\echo '== 13r. ยอดบัตรคำนวณอัตโนมัติ (ยอด Statement + รูด − จ่าย หลังวันที่ของยอด)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.add_expense(jsonb_build_object('date', current_date, 'description', 'รูดบัตรหลัง Statement', 'amount', 150,
  'paid_from_credit_card_id', (SELECT id FROM public.credit_cards WHERE card_last4 = '4455'))) IS NOT NULL AS c3;
SELECT t.ok((SELECT current_balance FROM public.v_card_balances WHERE card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '4455')) = 2150
            AND (SELECT statement_balance FROM public.v_card_balances WHERE card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '4455')) = 2000,
            'บันทึกรูดบัตรหลังวันที่ของยอด → ยอดค้างปัจจุบันเพิ่มทันที (Statement คงเดิม)');
SELECT t.ok((SELECT sum(value) FROM public.v_net_worth_items_current WHERE credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '4455')) = 2150,
            'Net Worth ใช้ยอดบัตรปัจจุบัน');
SELECT t.ok((SELECT amount FROM public.v_liabilities_all WHERE source_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '4455')) = 2150,
            'หน้า Liabilities ใช้ยอดบัตรปัจจุบัน');
RESET ROLE;

\echo '== 13s. ยอดบัตรจาก Statement ต่ำกว่าที่บันทึก → รายได้ก้อนเข้าบัตร (รอแยก) · ปรับอัตโนมัติ · แยกรายการ'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
INSERT INTO public.credit_cards(person_id, issuer, card_name, card_last4, outstanding_balance, balance_date)
  VALUES (t.p('คุณพ่อ'), 'ทดสอบ', 'เครดิต', '6677', 1000, '2026-09-01');
SELECT public.add_expense(jsonb_build_object('date','2026-09-20','description','รูดบัตรทดสอบเครดิต','amount',300,
  'paid_from_credit_card_id', (SELECT id FROM public.credit_cards WHERE card_last4 = '6677'))) IS NOT NULL AS s1;
SELECT (public.update_card_statement((SELECT id FROM public.credit_cards WHERE card_last4 = '6677'), '2026-09-30', 1100, true))->>'lump' AS card_credit_lump;
SELECT t.ok((SELECT amount FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
              AND received_to_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '6677')) = 200
            AND NOT EXISTS (SELECT 1 FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
              AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '6677')),
            'ยอด Statement ต่ำกว่าที่บันทึก 200 → รายได้ก้อนรอแยก 200 เข้าบัตร');
SELECT t.ok((SELECT current_balance FROM public.v_card_balances WHERE card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '6677')) = 1100,
            'ยอดบัตรปัจจุบัน = ยอด Statement');
SELECT public.add_expense(jsonb_build_object('date','2026-09-25','description','รูดบัตรที่ลืม (เครดิต)','amount',100,
  'paid_from_credit_card_id', (SELECT id FROM public.credit_cards WHERE card_last4 = '6677'))) IS NOT NULL AS s2;
SELECT t.ok((SELECT amount FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
              AND received_to_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '6677')) = 300,
            'บันทึกรูดบัตรเพิ่ม → รายได้ก้อนปรับเองเป็น 300 (ยอดบัตรยังตรง Statement)');
SELECT t.ok(public.split_pending_item('INCOME', (SELECT id FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
              AND received_to_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '6677')),
  jsonb_build_array(jsonb_build_object('description','เงินคืนจากร้านค้า','amount',100,'income_type','OTHER'))) = 200,
  'แยกรายได้ก้อนบัตร 100 → เหลือ 200');
SELECT t.ok(EXISTS (SELECT 1 FROM public.income_transactions WHERE NOT pending_split AND deleted_at IS NULL AND notes = 'เงินคืนจากร้านค้า'
              AND received_to_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '6677'))
            AND (SELECT current_balance FROM public.v_card_balances WHERE card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '6677')) = 1100,
            'รายการที่แยกออกเข้าบัตรเดิม · ยอดบัตรเท่าเดิม');
UPDATE public.expense_items SET deleted_at = now()
 WHERE paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '6677') AND NOT pending_split;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
              AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '6677')) = 200
            AND NOT EXISTS (SELECT 1 FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
              AND received_to_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '6677')),
            'ลบรายการรูดบัตร → ส่วนต่างกลับด้าน เปลี่ยนเป็นค่าใช้จ่ายก้อน 200 แทน');
RESET ROLE;

\echo '== 13t. ประวัติยอดบัตร: ลงก้อนเสมอ (ไม่มีช่องติ๊ก) · อัปเดตยอดวันเดิมซ้ำไม่ซ้ำก้อน · ยอดย้อนหลังเก็บเป็นประวัติ'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
INSERT INTO public.credit_cards(person_id, issuer, card_name, card_last4, outstanding_balance, balance_date)
  VALUES (t.p('คุณพ่อ'), 'ทดสอบ', 'ประวัติ', '8899', 1000, '2026-09-01');
SELECT public.add_expense(jsonb_build_object('date','2026-09-20','description','รูดบัตรทดสอบประวัติ','amount',300,
  'paid_from_credit_card_id', (SELECT id FROM public.credit_cards WHERE card_last4 = '8899'))) IS NOT NULL AS h1;
SELECT (public.update_card_statement((SELECT id FROM public.credit_cards WHERE card_last4 = '8899'), '2026-09-30', 1100, false, 'รอบ ก.ย.'))->>'difference' AS forgot_diff;
SELECT t.ok((SELECT count(*) FROM public.credit_card_statements WHERE credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '8899')) = 2
            AND (SELECT notes FROM public.credit_card_statements WHERE statement_date = '2026-09-30'
                  AND credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '8899')) = 'รอบ ก.ย.'
            AND (SELECT amount FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
                  AND received_to_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '8899')) = 200,
            'เพิ่มบัตร + อัปเดตยอด → ประวัติ 2 แถว (มีหมายเหตุ) · ลงก้อน 200 ให้เลย (p_settle = false ก็ลง)');
SELECT (public.update_card_statement((SELECT id FROM public.credit_cards WHERE card_last4 = '8899'), '2026-09-30', 1100, true))->>'lump' AS retick_lump;
SELECT t.ok((SELECT amount FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
              AND received_to_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '8899')) = 200,
            'อัปเดตยอดวันเดิมซ้ำ → ก้อนยัง 200 (ไม่ซ้ำ · คิดจากยอดครั้งก่อนในประวัติ)');
SELECT (public.update_card_statement((SELECT id FROM public.credit_cards WHERE card_last4 = '8899'), '2026-09-15', 1200, false))->>'history_only' AS backdated;
SELECT t.ok((SELECT outstanding_balance FROM public.credit_cards WHERE card_last4 = '8899') = 1100
            AND (SELECT balance_date FROM public.credit_cards WHERE card_last4 = '8899') = '2026-09-30'
            AND (SELECT count(*) FROM public.credit_card_statements WHERE credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '8899')) = 3,
            'ยอดย้อนหลัง → เก็บเป็นประวัติ · ยอดล่าสุดไม่เปลี่ยน');
SELECT t.fails($$INSERT INTO public.credit_card_statements(credit_card_id, statement_date, balance)
  SELECT id, '2026-09-10', 1 FROM public.credit_cards WHERE card_last4 = '8899'$$, 'permission denied', 'แก้ประวัติยอดบัตรตรง ๆ ไม่ได้');
RESET ROLE;

\echo '== 13u. แก้บัญชีที่รับ / จ่าย และประเภทรายได้ (รายการที่บันทึกเอง)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.add_expense(jsonb_build_object('date','2026-09-12','description','ทดสอบย้ายบัญชี','amount',50,
  'paid_from_asset_id', t.a('บัญชีทดสอบก้อน 2'))) IS NOT NULL AS mv1;
SELECT public.change_entry_account('EXPENSE', (SELECT id FROM public.expense_items WHERE description = 'ทดสอบย้ายบัญชี'), '') ? 'recon_warning' AS mv2;
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.cash_movements WHERE is_derived AND deleted_at IS NULL
              AND source_entity_id = (SELECT id FROM public.expense_items WHERE description = 'ทดสอบย้ายบัญชี')),
            'ค่าใช้จ่ายย้ายเป็น "ไม่ผ่านบัญชี" → รายการเงินออกจากบัญชีหายไป');
SELECT public.change_entry_account('EXPENSE', (SELECT id FROM public.expense_items WHERE description = 'ทดสอบย้ายบัญชี'),
  'c:' || (SELECT id FROM public.credit_cards WHERE card_last4 = '6677')) IS NOT NULL AS mv3;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
              AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '6677')) = 150,
            'ย้ายไปจ่ายด้วยบัตร (ในช่วง Statement) → ก้อนรอแยกของบัตรปรับเอง 200 → 150');
SELECT public.change_entry_account('EXPENSE', (SELECT id FROM public.expense_items WHERE description = 'ทดสอบย้ายบัญชี'),
  'a:' || t.a('บัญชีทดสอบก้อน 2')) IS NOT NULL AS mv4;
SELECT t.ok((SELECT from_asset_id FROM public.cash_movements WHERE is_derived AND deleted_at IS NULL
              AND source_entity_id = (SELECT id FROM public.expense_items WHERE description = 'ทดสอบย้ายบัญชี')) = t.a('บัญชีทดสอบก้อน 2')
            AND (SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
              AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '6677')) = 200,
            'ย้ายกลับเข้าบัญชี → มีรายการเงินออกอีกครั้ง · ก้อนบัตรกลับเป็น 200');
INSERT INTO public.income_transactions(family_id, person_id, date, income_type, amount, currency, notes)
  SELECT id, t.p('คุณพ่อ'), '2026-09-14', 'OTHER', 700, 'THB', 'ทดสอบย้ายรายได้' FROM public.families;
SELECT public.change_entry_account('INCOME', (SELECT id FROM public.income_transactions WHERE notes = 'ทดสอบย้ายรายได้'),
  'a:' || t.a('บัญชีทดสอบก้อน 2'), 'INTEREST') IS NOT NULL AS mv5;
SELECT t.ok((SELECT income_type FROM public.income_transactions WHERE notes = 'ทดสอบย้ายรายได้') = 'INTEREST'
            AND (SELECT to_asset_id FROM public.cash_movements WHERE is_derived AND deleted_at IS NULL
              AND source_entity_id = (SELECT id FROM public.income_transactions WHERE notes = 'ทดสอบย้ายรายได้')) = t.a('บัญชีทดสอบก้อน 2'),
            'รายได้: เปลี่ยนประเภท + ย้ายเข้าบัญชี → มีรายการเงินเข้าบัญชี');
SELECT t.fails($$SELECT public.change_entry_account('INCOME', (SELECT id FROM public.income_transactions WHERE notes = 'ทดสอบย้ายรายได้'), '', 'DIVIDEND')$$,
  'ปันผล', 'เปลี่ยนเป็นปันผล / ค่าเช่า จากหน้านี้ไม่ได้');
SELECT t.fails($$SELECT public.change_entry_account('EXPENSE', (SELECT id FROM public.expense_items WHERE pending_split AND deleted_at IS NULL LIMIT 1), '')$$,
  'LINKED', 'ก้อนรอแยกย้ายบัญชีไม่ได้');
SELECT t.fails($$SELECT public.change_entry_account('INCOME', (SELECT id FROM public.income_transactions WHERE lease_id IS NOT NULL AND deleted_at IS NULL LIMIT 1), '')$$,
  'LINKED', 'รายได้ค่าเช่า (ผูกสัญญาเช่า) ย้ายบัญชีจากหน้านี้ไม่ได้');
SELECT t.fails($$SELECT public.change_entry_account('EXPENSE', (SELECT id FROM public.expense_items WHERE date < '2026-08-01' AND deleted_at IS NULL
  AND source_cash_movement_id IS NULL AND liability_id IS NULL AND property_utility_id IS NULL AND insurance_schedule_line_id IS NULL
  AND source_fee_side IS NULL AND NOT pending_split LIMIT 1), '')$$, 'PERIOD_LOCKED', 'งวดที่ปิดแล้วย้ายบัญชีไม่ได้');
RESET ROLE;

\echo '== 13v. ยกเลิกทั้งก้อน (ผลประโยชน์ประกัน · คืนเงินประกันการเช่า · เงินต้น + ดอกเบี้ย)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT t.ok((SELECT count(*) FROM public.insurance_benefit_receipts WHERE undone_at IS NULL) = 2, 'รับผลประโยชน์ 2 ครั้ง → มีใบรับ 2 ใบ');
SELECT public.undo_insurance_benefit((SELECT id FROM public.insurance_benefit_receipts WHERE outcome = 'MATURED')) IS NULL AS undo1;
SELECT t.ok((SELECT status FROM public.insurance_policies WHERE id = (SELECT policy_id FROM public.insurance_benefit_receipts WHERE outcome = 'MATURED')) = 'ACTIVE'
            AND (SELECT status = 'ACTIVE' AND current_value = 70000 FROM public.assets WHERE id = (SELECT cash_value_asset_id FROM public.insurance_policies WHERE id = (SELECT policy_id FROM public.insurance_benefit_receipts LIMIT 1)))
            AND NOT EXISTS (SELECT 1 FROM public.income_transactions WHERE income_type = 'INSURANCE_BENEFIT' AND deleted_at IS NULL),
            'ยกเลิกครบสัญญา → กรมธรรม์กลับเป็น "มีผล" · มูลค่าเวนคืนกลับ 70,000 · รายได้ส่วนเกินหายไป');
SELECT t.fails($$SELECT public.undo_insurance_benefit((SELECT id FROM public.insurance_benefit_receipts WHERE outcome = 'MATURED'))$$,
  'ยกเลิกไปแล้ว', 'ยกเลิกซ้ำไม่ได้');
SELECT public.undo_insurance_benefit((SELECT id FROM public.insurance_benefit_receipts WHERE outcome IS NULL)) IS NULL AS undo2;
SELECT t.ok((SELECT current_value = 100000 FROM public.assets WHERE id = (SELECT cash_value_asset_id FROM public.insurance_policies WHERE id = (SELECT policy_id FROM public.insurance_benefit_receipts LIMIT 1)))
            AND (SELECT status <> 'PAID' FROM public.v_insurance_schedule_status WHERE kind = 'BENEFIT')
            AND NOT EXISTS (SELECT 1 FROM public.cash_movements WHERE movement_type = 'ASSET_SALE' AND deleted_at IS NULL
                              AND metadata ? 'policy_id'),
            'ยกเลิกเงินคืนรายงวด → มูลค่าเวนคืนกลับ 100,000 · งวดกลับเป็นยังไม่รับ');
-- คืนเงินประกันการเช่า
SELECT public.undo_security_deposit((SELECT id FROM public.property_leases WHERE tenant_name = 'ผู้เช่า ข')) IS NULL AS undo_dep;
SELECT t.ok((SELECT deposit_settlement_type IS NULL AND deposit_settled_date IS NULL FROM public.property_leases WHERE tenant_name = 'ผู้เช่า ข')
            AND NOT EXISTS (SELECT 1 FROM public.cash_movements WHERE movement_type = 'SECURITY_DEPOSIT_OUT' AND deleted_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM public.income_transactions WHERE income_type = 'OTHER' AND lease_id IS NOT NULL AND deleted_at IS NULL
                              AND notes LIKE 'หักจากเงินประกัน:%'),
            'ยกเลิกคืนเงินประกัน → เงินคืน + รายได้ส่วนที่หักหายไป · สัญญากลับมาถือเงินประกัน');
-- เงินให้กู้: เงินต้น + ดอกเบี้ย
SELECT public.receive_loan_payment(t.a('เงินกู้ญาติ'), t.a('KBank ออมทรัพย์'), current_date, 1000, 100, NULL, 'ทดสอบยกเลิก') AS loan_grp \gset
SELECT t.ok(public.undo_payment_group(:'loan_grp') = 2, 'ยกเลิกรับชำระเงินให้กู้: 2 รายการ');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.cash_movements WHERE movement_group_id = :'loan_grp' AND deleted_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM public.income_transactions WHERE notes = 'ทดสอบยกเลิก' AND deleted_at IS NULL),
            'ยกเลิกรับชำระเงินให้กู้ → เงินต้น + ดอกเบี้ยหายพร้อมกัน');
-- จ่ายหนี้: เงินต้น + ดอกเบี้ย
SELECT (SELECT outstanding_amount FROM public.liabilities WHERE name = 'สินเชื่อบ้าน') AS debt_b4 \gset
SELECT public.pay_liability(jsonb_build_object('liability_id', (SELECT id FROM public.liabilities WHERE name = 'สินเชื่อบ้าน'),
  'bank_asset_id', t.a('KBank ออมทรัพย์'), 'date', current_date, 'principal', 300, 'interest', 40)) ->> 'group_id' AS liab_grp \gset
SELECT t.ok((SELECT count(*) FROM public.cash_movements WHERE movement_group_id = :'liab_grp' AND deleted_at IS NULL) = 2,
            'จ่ายหนี้: ดอกเบี้ยผูกกลุ่มเดียวกับเงินต้น');
SELECT t.ok(public.undo_payment_group(:'liab_grp') = 2, 'ยกเลิกจ่ายหนี้: 2 รายการ');
SELECT t.ok((SELECT outstanding_amount FROM public.liabilities WHERE name = 'สินเชื่อบ้าน') = :debt_b4,
            'ยกเลิกจ่ายหนี้ → เงินต้น + ดอกเบี้ยหาย · ยอดหนี้กลับเท่าเดิม');
RESET ROLE;
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$SELECT public.undo_payment_group(gen_random_uuid())$$, 'PERMISSION_DENIED', 'VIEWER ยกเลิกทั้งก้อนไม่ได้');
RESET ROLE;

\echo '== 13w. หมวดค่าใช้จ่าย / ประเภทย่อยรายได้อื่น (ตั้งค่าเอง)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
INSERT INTO public.ie_categories(kind, name, sort_order) VALUES ('EXPENSE', 'หมวดทดสอบงวดปิด', 999);
-- รายการในงวดที่ปิดแล้ว (ใส่ผ่านช่องทางแยกรายการ เพื่อจำลองข้อมูลเก่า)
BEGIN;
SELECT set_config('fwv.split', 'on', true);
SELECT public.add_expense(jsonb_build_object('date','2026-07-20','description','ค่าใช้จ่ายงวดปิด','amount',10,'expense_category','หมวดทดสอบงวดปิด')) IS NOT NULL AS old_exp;
COMMIT;
SELECT t.ok(public.rename_ie_category((SELECT id FROM public.ie_categories WHERE name = 'หมวดทดสอบงวดปิด'), 'หมวดเปลี่ยนชื่อ') = 1,
            'เปลี่ยนชื่อหมวด → รายการที่ใช้หมวดนี้เปลี่ยนตาม (แม้งวดปิดแล้ว)');
SELECT t.ok(EXISTS (SELECT 1 FROM public.expense_items WHERE description = 'ค่าใช้จ่ายงวดปิด' AND expense_category = 'หมวดเปลี่ยนชื่อ')
            AND (SELECT amount FROM public.expense_items WHERE description = 'ค่าใช้จ่ายงวดปิด') = 10,
            'ชื่อหมวดในรายการเดิมเปลี่ยน · ยอดเท่าเดิม');
SELECT t.fails($$SELECT public.add_expense(jsonb_build_object('date','2026-07-21','description','ห้ามเพิ่ม','amount',1))$$,
  'PERIOD_LOCKED', 'หลังเปลี่ยนชื่อ งวดที่ปิดแล้วยังล็อกเหมือนเดิม');
SELECT public.move_ie_category((SELECT id FROM public.ie_categories WHERE name = 'หมวดเปลี่ยนชื่อ'), -1) IS NULL AS moved;
SELECT t.ok((SELECT sort_order FROM public.ie_categories WHERE name = 'หมวดเปลี่ยนชื่อ')
            < (SELECT max(sort_order) FROM public.ie_categories WHERE kind = 'EXPENSE' AND deleted_at IS NULL),
            'เลื่อนลำดับหมวดขึ้นได้');
SELECT t.fails($$INSERT INTO public.ie_categories(kind, name) VALUES ('EXPENSE', 'อาหาร')$$, 'duplicate', 'ชื่อหมวดซ้ำไม่ได้');
SELECT t.fails($$UPDATE public.income_transactions SET income_subtype = 'ทดสอบ' WHERE notes = 'ทดสอบย้ายรายได้'$$,
  'inc_subtype_other', 'ประเภทย่อยใช้ได้เฉพาะรายได้อื่น');
SELECT t.fails($$SELECT public.rename_ie_category((SELECT id FROM public.ie_categories WHERE kind = 'EXPENSE' AND name = 'ดอกเบี้ยจ่าย'), 'ดอกเบี้ย')$$,
  'อัตโนมัติ', 'หมวดที่ระบบใช้อัตโนมัติ เปลี่ยนชื่อไม่ได้');
INSERT INTO public.income_transactions(family_id, person_id, date, income_type, income_subtype, amount, currency, notes)
  SELECT id, t.p('คุณพ่อ'), '2026-09-15', 'OTHER', 'ขายของมือสอง', 300, 'THB', 'ทดสอบประเภทย่อย' FROM public.families;
SELECT public.change_entry_account('INCOME', (SELECT id FROM public.income_transactions WHERE notes = 'ทดสอบประเภทย่อย'), '', 'BONUS') IS NOT NULL AS mv6;
SELECT t.ok((SELECT income_type = 'BONUS' AND income_subtype IS NULL FROM public.income_transactions WHERE notes = 'ทดสอบประเภทย่อย'),
            'เปลี่ยนประเภทออกจากรายได้อื่น → ล้างประเภทย่อยให้เอง');
RESET ROLE;
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$INSERT INTO public.ie_categories(kind, name) VALUES ('EXPENSE', 'หมวดจาก VIEWER')$$, 'row-level security', 'VIEWER เพิ่มหมวดไม่ได้');
RESET ROLE;

\echo '== 13x. ค่าใช้จ่ายประจำทั่วไป · บันทึกจ่าย · เดือนนี้ไม่ได้จ่าย'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
INSERT INTO public.recurring_expense_templates(family_id, name, expense_category, expected_amount, frequency, due_day, pay_via, pay_from_asset_id, start_date)
  SELECT id, 'ค่าอินเทอร์เน็ตทดสอบ', 'บ้าน / สาธารณูปโภค', 600, 'MONTHLY', 5, 'BANK', t.a('บัญชีทดสอบก้อน 2'), '2026-09-01' FROM public.families;
SELECT t.ok((SELECT status FROM public.v_recurring_expense_tracking WHERE name = 'ค่าอินเทอร์เน็ตทดสอบ' AND cost_period = '2026-09-01') = 'OVERDUE',
            'ค่าใช้จ่ายประจำ: งวดที่เลยกำหนดแล้วยังไม่จ่าย = OVERDUE');
SELECT public.add_expense(jsonb_build_object('date','2026-09-06','description','ค่าอินเทอร์เน็ต ก.ย.','amount',620,
  'paid_from_asset_id', t.a('บัญชีทดสอบก้อน 2'), 'cost_period', '2026-09-01',
  'recurring_expense_id', (SELECT id FROM public.recurring_expense_templates WHERE name = 'ค่าอินเทอร์เน็ตทดสอบ'))) IS NOT NULL AS rexp_paid;
SELECT t.ok((SELECT status = 'PAID' AND paid_amount = 620 FROM public.v_recurring_expense_tracking
              WHERE name = 'ค่าอินเทอร์เน็ตทดสอบ' AND cost_period = '2026-09-01')
            AND (SELECT expense_category FROM public.expense_items WHERE description = 'ค่าอินเทอร์เน็ต ก.ย.') = 'บ้าน / สาธารณูปโภค',
            'บันทึกจ่ายงวด → PAID ด้วยยอดจริง · หมวดตามรายการประจำ');
INSERT INTO public.expected_expense_dismissals(source_type, source_id, cost_period, reason)
  SELECT 'RECURRING', id, '2026-10-01', 'ทดสอบไม่ได้จ่าย' FROM public.recurring_expense_templates WHERE name = 'ค่าอินเทอร์เน็ตทดสอบ';
SELECT t.ok(coalesce((SELECT status FROM public.v_recurring_expense_tracking WHERE name = 'ค่าอินเทอร์เน็ตทดสอบ' AND cost_period = '2026-10-01'),
                     'DISMISSED') = 'DISMISSED', 'เดือนนี้ไม่ได้จ่าย → DISMISSED');
SELECT t.fails($$INSERT INTO public.expected_expense_dismissals(source_type, source_id, cost_period, reason)
  SELECT 'RECURRING', id, '2026-10-01', 'ซ้ำ' FROM public.recurring_expense_templates WHERE name = 'ค่าอินเทอร์เน็ตทดสอบ'$$,
  'duplicate', 'บันทึก "ไม่ได้จ่าย" งวดเดียวกันซ้ำไม่ได้');
SELECT t.fails($$INSERT INTO public.recurring_expense_templates(family_id, name, expense_category, expected_amount, pay_via, start_date)
  SELECT id, 'บัตรไม่ระบุ', 'ทั่วไป', 100, 'CARD', '2026-09-01' FROM public.families$$, 'rexp_pay_from', 'จ่ายด้วยบัตรต้องระบุบัตร');
SELECT t.fails($$SELECT public.add_expense(jsonb_build_object('date','2026-09-07','description','ผูกสองอย่าง','amount',1,
  'recurring_expense_id', (SELECT id FROM public.recurring_expense_templates WHERE name = 'ค่าอินเทอร์เน็ตทดสอบ'),
  'insurance_schedule_line_id', gen_random_uuid()))$$, 'ทีละอย่าง', 'ผูกค่าใช้จ่ายประจำกับเบี้ยประกันพร้อมกันไม่ได้');
RESET ROLE;
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$INSERT INTO public.recurring_expense_templates(family_id, name, expense_category, expected_amount, start_date)
  SELECT id, 'จาก VIEWER', 'ทั่วไป', 1, '2026-09-01' FROM public.families$$, 'row-level security', 'VIEWER เพิ่มค่าใช้จ่ายประจำไม่ได้');
RESET ROLE;

\echo '== 13y. แก้รายการด้วยปุ่มบันทึกปุ่มเดียว (ช่องทั่วไป + บัญชี + ประเภท ในคำสั่งเดียว)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.add_expense(jsonb_build_object('date','2026-09-13','description','ทดสอบแก้ครั้งเดียว','amount',80,
  'expense_category','ทั่วไป','paid_from_asset_id', t.a('บัญชีทดสอบก้อน 2'))) IS NOT NULL AS ue1;
SELECT public.update_entry('EXPENSE', (SELECT id FROM public.expense_items WHERE description = 'ทดสอบแก้ครั้งเดียว'),
  jsonb_build_object('amount','90','notes','แก้แล้ว','description','ทดสอบแก้ครั้งเดียว'),
  'c:' || (SELECT id FROM public.credit_cards WHERE card_last4 = '6677')) IS NOT NULL AS ue2;
SELECT t.ok((SELECT amount = 90 AND notes = 'แก้แล้ว' AND paid_from_asset_id IS NULL
                AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '6677')
             FROM public.expense_items WHERE description = 'ทดสอบแก้ครั้งเดียว')
            AND NOT EXISTS (SELECT 1 FROM public.cash_movements WHERE is_derived AND deleted_at IS NULL
              AND source_entity_id = (SELECT id FROM public.expense_items WHERE description = 'ทดสอบแก้ครั้งเดียว')),
            'แก้ยอด + หมายเหตุ + ย้ายไปบัตร ในครั้งเดียว → ไม่มีเงินออกจากบัญชีแล้ว');
SELECT t.fails($$SELECT public.update_entry('EXPENSE', (SELECT id FROM public.expense_items WHERE description = 'ทดสอบแก้ครั้งเดียว'),
  jsonb_build_object('date','2026-07-15'), 'a:' || t.a('บัญชีทดสอบก้อน 2'))$$, 'ไม่อยู่ในเดือน', 'ย้ายวันที่ข้ามเดือนไม่ได้ (กติกาเดิม)');
SELECT t.ok((SELECT paid_from_credit_card_id IS NOT NULL AND date = '2026-09-13' FROM public.expense_items WHERE description = 'ทดสอบแก้ครั้งเดียว'),
            'ช่องหนึ่งผิด → ไม่บันทึกเลยสักช่อง (บัญชียังเป็นบัตรเดิม)');
SELECT public.update_entry('EXPENSE', (SELECT id FROM public.expense_items WHERE description = 'ทดสอบแก้ครั้งเดียว'),
  jsonb_build_object('amount','95'), NULL) IS NOT NULL AS ue3;
SELECT t.ok((SELECT amount = 95 AND paid_from_credit_card_id IS NOT NULL FROM public.expense_items WHERE description = 'ทดสอบแก้ครั้งเดียว'),
            'ไม่ส่งบัญชี → บัญชีเดิมไม่เปลี่ยน');
INSERT INTO public.income_transactions(family_id, person_id, date, income_type, amount, currency, notes)
  SELECT id, t.p('คุณพ่อ'), '2026-09-14', 'INTEREST', 300, 'THB', 'ทดสอบแก้รายได้ครั้งเดียว' FROM public.families;
SELECT public.update_entry('INCOME', (SELECT id FROM public.income_transactions WHERE notes = 'ทดสอบแก้รายได้ครั้งเดียว'),
  jsonb_build_object('amount','350','income_subtype','งานพิเศษ'), 'a:' || t.a('บัญชีทดสอบก้อน 2'), 'OTHER') IS NOT NULL AS ue4;
SELECT t.ok((SELECT amount = 350 AND income_type = 'OTHER' AND income_subtype = 'งานพิเศษ' AND received_to_asset_id = t.a('บัญชีทดสอบก้อน 2')
             FROM public.income_transactions WHERE notes = 'ทดสอบแก้รายได้ครั้งเดียว'),
            'รายได้: ยอด + ประเภท + ประเภทย่อย + บัญชี ในครั้งเดียว');
RESET ROLE;
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000c');
SELECT t.fails($$SELECT public.update_entry('EXPENSE', (SELECT id FROM public.expense_items WHERE description = 'ทดสอบแก้ครั้งเดียว'),
  jsonb_build_object('amount','1'), NULL)$$, 'PERMISSION_DENIED|ไม่มีสิทธิ์', 'CONTRIBUTOR แก้รายการของคนอื่นไม่ได้');
RESET ROLE;
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$SELECT public.update_entry('EXPENSE', (SELECT id FROM public.expense_items WHERE description = 'ทดสอบแก้ครั้งเดียว'),
  jsonb_build_object('amount','1'), NULL)$$, 'PERMISSION|สิทธิ์|role', 'VIEWER แก้รายการไม่ได้');
RESET ROLE;

\echo '== 13z. ก้อนรอแยก: บัญชีละ 1 ก้อนต่อเดือน (ธนาคารจากหน้า Cash + กระทบยอด · บัตรหลายยอดในเดือนเดียว)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.create_bank_account('บัญชีก้อนรายเดือน', 'ทดสอบ', 'THB', 10000, '2026-08-31', false, 'SAVING', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('person_id', t.p('คุณพ่อ'), 'percent', 100)), NULL, NULL) IS NOT NULL AS mb1;
SELECT public.create_bank_account('บัญชีก้อนรายเดือน B', 'ทดสอบ', 'THB', 5000, '2026-08-31', false, 'SAVING', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('person_id', t.p('คุณพ่อ'), 'percent', 100)), NULL, NULL) IS NOT NULL AS mb2;
SELECT public.add_expense(jsonb_build_object('date','2026-09-05','description','จ่ายจริงก่อนยอด','amount',300,
  'paid_from_asset_id', t.a('บัญชีก้อนรายเดือน'))) IS NOT NULL AS mb3;
SELECT (public.update_bank_statement(t.a('บัญชีก้อนรายเดือน'), '2026-09-10', 9500, NULL, true))->>'lump' AS mb_lump1;
SELECT t.ok((SELECT amount = 200 AND date = '2026-09-10' FROM public.expense_items
              WHERE pending_split AND lump_kind = 'BANK' AND paid_from_asset_id = t.a('บัญชีก้อนรายเดือน') AND deleted_at IS NULL),
            'หน้า Cash: บันทึกยอด + ติ๊กลงส่วนต่าง → ก้อนรอแยก 200 ทันที (ไม่ต้องรอ Month Closing)');
SELECT (public.update_bank_statement(t.a('บัญชีก้อนรายเดือน'), '2026-09-20', 9000))->>'merged' AS mb_merged;
SELECT t.ok((SELECT count(*) FROM public.expense_items WHERE pending_split AND paid_from_asset_id = t.a('บัญชีก้อนรายเดือน') AND deleted_at IS NULL) = 1
            AND (SELECT amount = 700 AND date = '2026-09-20' FROM public.expense_items
                  WHERE pending_split AND paid_from_asset_id = t.a('บัญชีก้อนรายเดือน') AND deleted_at IS NULL),
            'บันทึกยอดซ้ำในเดือนเดียวกัน → ปรับก้อนเดิมเป็น 700 + ย้ายวันที่ (ยังมีก้อนเดียว)');
SELECT t.ok(((public.update_bank_statement(t.a('บัญชีก้อนรายเดือน'), '2026-09-15', 9200))->>'history_only')::boolean
            AND (SELECT amount = 700 AND date = '2026-09-20' FROM public.expense_items
                  WHERE pending_split AND paid_from_asset_id = t.a('บัญชีก้อนรายเดือน') AND deleted_at IS NULL),
            'ยอดวันก่อนวันที่ของก้อน → เก็บเป็นยอดอย่างเดียว ก้อนไม่เปลี่ยน');
SELECT public.add_expense(jsonb_build_object('date','2026-09-12','description','เจอใบเสร็จในช่วงก้อน','amount',100,
  'paid_from_asset_id', t.a('บัญชีก้อนรายเดือน'))) IS NOT NULL AS mb4;
SELECT public.add_expense(jsonb_build_object('date','2026-09-25','description','จ่ายหลังวันที่ของก้อน','amount',50,
  'paid_from_asset_id', t.a('บัญชีก้อนรายเดือน'))) IS NOT NULL AS mb5;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND paid_from_asset_id = t.a('บัญชีก้อนรายเดือน') AND deleted_at IS NULL) = 600,
            'รายการจริงในช่วงก้อน → ก้อนลด 700 → 600 · รายการหลังวันที่ของก้อนไม่กระทบ');
INSERT INTO public.cash_movements(movement_date, movement_type, amount, currency, from_asset_id, to_asset_id, description)
  VALUES ('2026-09-14', 'TRANSFER', 100, 'THB', t.a('บัญชีก้อนรายเดือน'), t.a('บัญชีก้อนรายเดือน B'), 'โอนที่ลืมบันทึก');
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND paid_from_asset_id = t.a('บัญชีก้อนรายเดือน') AND deleted_at IS NULL) = 500,
            'บันทึกโอนระหว่างบัญชีในช่วงก้อน → ก้อนลดเองเหลือ 500');
SELECT public.prepare_bank_reconciliation(t.a('บัญชีก้อนรายเดือน'), '2026-09-01') IS NOT NULL AS mb7;
SELECT public.settle_bank_difference((SELECT id FROM public.bank_reconciliations WHERE bank_asset_id = t.a('บัญชีก้อนรายเดือน')), 8700)->>'amount' AS mb_settle;
SELECT t.ok((SELECT count(*) FROM public.expense_items WHERE pending_split AND paid_from_asset_id = t.a('บัญชีก้อนรายเดือน') AND deleted_at IS NULL) = 1
            AND (SELECT amount = 750 AND date = '2026-09-30' FROM public.expense_items
                  WHERE pending_split AND paid_from_asset_id = t.a('บัญชีก้อนรายเดือน') AND deleted_at IS NULL)
            AND (SELECT status FROM public.bank_reconciliations WHERE bank_asset_id = t.a('บัญชีก้อนรายเดือน')) = 'RECONCILED',
            'กระทบยอดสิ้นเดือน → ใช้ก้อนเดิม (750 ย้ายไปสิ้นเดือน) · กระทบยอดผ่าน');
SELECT t.ok((public.lump_status('BANK', t.a('บัญชีก้อนรายเดือน'), '2026-09-01')->>'amount')::numeric = 750,
            'lump_status: ยอดก้อนของเดือน');
RESET ROLE;
SELECT t.ok(private.bank_calculated_balance(t.a('บัญชีก้อนรายเดือน'), '2026-09-30') = 8700
            AND private.bank_calculated_balance(t.a('บัญชีก้อนรายเดือน'), '2026-09-20') = 9000,
            'ยอดบัญชีตรง Statement ทุกจุด (กลางเดือน / สิ้นเดือน)');
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000c');
SELECT (public.update_bank_statement(t.a('บัญชีก้อนรายเดือน B'), '2026-09-20', 5050))->>'lump' AS mb_contrib;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
              AND paid_from_asset_id = t.a('บัญชีก้อนรายเดือน B')) = 50,
            'CONTRIBUTOR บันทึกยอด → ลงก้อนให้อัตโนมัติ (รับโอน 100 แต่ยอดขึ้น 50 → ค่าใช้จ่ายก้อน 50)');
RESET ROLE;
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
-- บัตร: หลายยอดในเดือนเดียว → ก้อนเดียว · เดือนถัดไป → ก้อนใหม่
INSERT INTO public.credit_cards(person_id, issuer, card_name, card_last4, outstanding_balance, balance_date)
  VALUES (t.p('คุณพ่อ'), 'ทดสอบ', 'รายเดือน', '8811', 1000, '2026-09-01');
SELECT public.add_expense(jsonb_build_object('date','2026-09-05','description','รูดบัตรรายเดือน','amount',200,
  'paid_from_credit_card_id', (SELECT id FROM public.credit_cards WHERE card_last4 = '8811'))) IS NOT NULL AS mc1;
SELECT (public.update_card_statement((SELECT id FROM public.credit_cards WHERE card_last4 = '8811'), '2026-09-10', 1500, true))->>'lump' AS mc_lump1;
SELECT (public.update_card_statement((SELECT id FROM public.credit_cards WHERE card_last4 = '8811'), '2026-09-28', 1900, false))->>'merged' AS mc_merged;
SELECT t.ok((SELECT count(*) FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
              AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '8811')) = 1
            AND (SELECT amount = 700 AND date = '2026-09-28' AND lump_from = '2026-09-01' FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
                  AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '8811')),
            'บัตร: ยอดที่ 2 ในเดือนเดียวกัน → ก้อนเดิมปรับเป็น 700 + ย้ายไปวันยอดล่าสุด (จุดตั้งต้นเดิม)');
SELECT (public.update_card_statement((SELECT id FROM public.credit_cards WHERE card_last4 = '8811'), '2026-10-05', 2000, true))->>'lump' AS mc_lump2;
SELECT t.ok((SELECT count(*) FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
              AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '8811')) = 2
            AND (SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND date = '2026-10-05'
                  AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '8811')) = 100,
            'บัตร: เดือนถัดไป → ก้อนใหม่ 100 (นับต่อจากยอดล่าสุดของเดือนก่อน)');
SELECT public.add_expense(jsonb_build_object('date','2026-09-20','description','รูดบัตรที่ลืม ก.ย.','amount',300,
  'paid_from_credit_card_id', (SELECT id FROM public.credit_cards WHERE card_last4 = '8811'))) IS NOT NULL AS mc2;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND date = '2026-09-28'
              AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '8811')) = 400
            AND (SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND date = '2026-10-05'
                  AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '8811')) = 100,
            'บัตร: รายการที่ลืมในเดือนก่อน → ก้อนเดือนนั้นลด 700 → 400 · ก้อนเดือนถัดไปไม่เปลี่ยน');
RESET ROLE;

\echo '== 13za. แยกก้อนครบแล้วลบ / ลดยอดรายการที่แยก → ก้อนกลับมา (บัตร + ธนาคาร)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
INSERT INTO public.credit_cards(person_id, issuer, card_name, card_last4, outstanding_balance, balance_date)
  VALUES (t.p('คุณพ่อ'), 'ทดสอบ', 'ก้อนกลับ', '7711', 5000, '2026-09-30');
SELECT (public.update_card_statement((SELECT id FROM public.credit_cards WHERE card_last4 = '7711'), '2026-10-05', 7000, true))->>'lump' AS rv1;
SELECT public.split_pending_item('EXPENSE', (SELECT id FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
  AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '7711')),
  jsonb_build_array(jsonb_build_object('description','ของใช้ทดสอบก้อนกลับ','amount',2000,'expense_category','ทั่วไป'))) AS rv2;
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
              AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '7711')),
            'บัตร: แยกครบ 2,000 → ก้อนปิด');
UPDATE public.expense_items SET amount = 1500 WHERE description = 'ของใช้ทดสอบก้อนกลับ' AND deleted_at IS NULL;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
              AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '7711')) = 500,
            'บัตร: ลดยอดรายการที่แยกเหลือ 1,500 → ก้อนเดิมกลับมา 500');
UPDATE public.expense_items SET deleted_at = now() WHERE description = 'ของใช้ทดสอบก้อนกลับ' AND deleted_at IS NULL;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
              AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '7711')) = 2000
            AND (SELECT count(*) FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
              AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '7711')) = 1,
            'บัตร: ลบรายการที่แยก → ก้อนกลับเป็น 2,000 (ก้อนเดียว)');
UPDATE public.expense_items SET notes = 'แก้แค่หมายเหตุ' WHERE pending_split AND deleted_at IS NULL
  AND paid_from_credit_card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '7711');
-- ธนาคาร
SELECT public.create_bank_account('บัญชีก้อนกลับ', 'ทดสอบ', 'THB', 10000, '2026-08-31', false, 'SAVING', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('person_id', t.p('คุณพ่อ'), 'percent', 100)), NULL, NULL) IS NOT NULL AS rv3;
SELECT (public.update_bank_statement(t.a('บัญชีก้อนกลับ'), '2026-09-15', 9000, NULL, true))->>'lump' AS rv4;
SELECT public.split_pending_item('EXPENSE', (SELECT id FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
  AND paid_from_asset_id = t.a('บัญชีก้อนกลับ')),
  jsonb_build_array(jsonb_build_object('description','ค่าซ่อมทดสอบก้อนกลับ','amount',1000,'expense_category','ทั่วไป'))) AS rv5;
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีก้อนกลับ')),
            'ธนาคาร: แยกครบ 1,000 → ก้อนปิด');
UPDATE public.expense_items SET deleted_at = now() WHERE description = 'ค่าซ่อมทดสอบก้อนกลับ' AND deleted_at IS NULL;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีก้อนกลับ')) = 1000,
            'ธนาคาร: ลบรายการที่แยก → ก้อนกลับเป็น 1,000');
RESET ROLE;
SELECT t.ok(private.bank_calculated_balance(t.a('บัญชีก้อนกลับ'), '2026-09-15') = 9000, 'ธนาคาร: ยอดบัญชียังตรง Statement');

\echo '== 13zb. หน้าบัญชี: สถานะยอดล่าสุดแบบคำนวณสด · ปุ่มสำรองลงส่วนต่างของยอดล่าสุดเป็นก้อน'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.create_bank_account('บัญชีสถานะยอด', 'ทดสอบ', 'THB', 10000, '2026-08-31', false, 'SAVING', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('person_id', t.p('คุณพ่อ'), 'percent', 100)), NULL, NULL) IS NOT NULL AS ss0;
RESET ROLE;
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000c');
SELECT (public.update_bank_statement(t.a('บัญชีสถานะยอด'), '2026-09-12', 9600))->>'lump' AS ss1;
SELECT t.ok((public.bank_statement_status(t.a('บัญชีสถานะยอด'))->>'difference')::numeric = 0
            AND (public.bank_statement_status(t.a('บัญชีสถานะยอด'))->>'lump')::numeric = 400,
            'CONTRIBUTOR บันทึกยอด → ก้อน 400 อัตโนมัติ · ส่วนต่างเหลือ 0');
RESET ROLE;
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
UPDATE public.asset_valuations SET value = 9500 WHERE asset_id = t.a('บัญชีสถานะยอด') AND valuation_date = '2026-09-12' AND deleted_at IS NULL;
SELECT t.ok((public.bank_statement_status(t.a('บัญชีสถานะยอด'))->>'difference')::numeric = 0
            AND (public.bank_statement_status(t.a('บัญชีสถานะยอด'))->>'lump')::numeric = 500,
            'แก้ยอดในประวัติตรง ๆ → ก้อนคำนวณใหม่เองเป็น 500 · ส่วนต่างเหลือ 0');
RESET ROLE;
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000c');
SELECT (public.settle_bank_latest(t.a('บัญชีสถานะยอด')))->>'lump' AS ss2;
SELECT t.ok((public.bank_statement_status(t.a('บัญชีสถานะยอด'))->>'difference')::numeric = 0
            AND (public.bank_statement_status(t.a('บัญชีสถานะยอด'))->>'lump')::numeric = 500
            AND (SELECT count(*) FROM public.asset_valuations WHERE asset_id = t.a('บัญชีสถานะยอด') AND deleted_at IS NULL) = 2,
            'ปุ่มสำรอง → ก้อนปรับเป็น 500 · ส่วนต่าง 0 · ไม่สร้างยอดซ้ำ');
SELECT public.add_expense(jsonb_build_object('date','2026-09-11','description','เจอค่าใช้จ่ายสถานะยอด','amount',500,
  'paid_from_asset_id', t.a('บัญชีสถานะยอด'))) IS NOT NULL AS ss3;
SELECT t.ok(public.bank_statement_status(t.a('บัญชีสถานะยอด'))->'lump' = 'null'::jsonb
            AND (public.bank_statement_status(t.a('บัญชีสถานะยอด'))->>'difference')::numeric = 0,
            'บันทึกรายการจริงครบ → ก้อนหมด · ส่วนต่าง 0 (ไม่ค้างตัวเลขเก่า)');
RESET ROLE;
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$SELECT public.settle_bank_latest(t.a('บัญชีสถานะยอด'))$$, 'PERMISSION|สิทธิ์|role', 'VIEWER ใช้ปุ่มสำรองไม่ได้');
RESET ROLE;

\echo '== 13zc. ยอดหนี้ / บัตรต่ำกว่าที่คำนวณ → รายได้ก้อนรอแยก · "ลงเป็นการจ่าย" จากบัญชี'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.create_bank_account('บัญชีจ่ายหนี้ลด', 'ทดสอบ', 'THB', 50000, '2026-08-31', false, 'SAVING', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('person_id', t.p('คุณพ่อ'), 'percent', 100)), NULL, NULL) IS NOT NULL AS dd0;
INSERT INTO public.liabilities(family_id, liability_type, name, currency) SELECT id, 'PERSONAL_LOAN', 'หนี้ลดทดสอบ', 'THB' FROM public.families;
INSERT INTO public.liability_valuations(liability_id, valuation_date, balance, source)
  SELECT id, '2026-08-31', 10000, 'STATEMENT' FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ';
SELECT t.ok(((public.update_liability_statement((SELECT id FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ'), '2026-09-20', 7000))->>'lump')::numeric = -3000,
            'ยอดหนี้ต่ำกว่าที่คำนวณ 3,000 → คืนค่าก้อน −3,000');
SELECT t.ok((SELECT amount FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
               AND received_to_liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ')) = 3000
            AND (SELECT outstanding_amount FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ') = 7000,
            'หนี้: รายได้ก้อนรอแยก 3,000 (ไม่หายเงียบ) · ยอดหนี้ = 7,000 ตาม Statement');
RESET ROLE;
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000c');
SELECT (public.pay_from_statement_drop(jsonb_build_object('kind','LIABILITY','id',(SELECT id FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ'),
  'bank_asset_id', t.a('บัญชีจ่ายหนี้ลด'), 'date','2026-09-20', 'amount', 2000)))->>'lump_left' AS dd1;
SELECT t.ok((SELECT amount FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
               AND received_to_liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ')) = 1000
            AND (SELECT outstanding_amount FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ') = 7000,
            'CONTRIBUTOR ลงเป็นการจ่าย 2,000 → ก้อนเหลือ 1,000 · ยอดหนี้ยัง 7,000 (ไม่หักซ้ำ)');
SELECT t.fails($$SELECT public.pay_from_statement_drop(jsonb_build_object('kind','LIABILITY','id',(SELECT id FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ'),
  'bank_asset_id', t.a('บัญชีจ่ายหนี้ลด'), 'date','2026-09-20', 'amount', 5000))$$, 'มากกว่าส่วนที่ลดลง', 'จ่ายเกินส่วนที่ลดลงไม่ได้');
RESET ROLE;
SELECT t.ok(private.bank_calculated_balance(t.a('บัญชีจ่ายหนี้ลด'), '2026-09-20') = 48000, 'เงินออกจากบัญชี 2,000 จริง');
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$SELECT public.pay_from_statement_drop(jsonb_build_object('kind','LIABILITY','id',(SELECT id FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ'),
  'bank_asset_id', t.a('บัญชีจ่ายหนี้ลด'), 'date','2026-09-20', 'amount', 100))$$, 'PERMISSION|สิทธิ์|role', 'VIEWER ลงเป็นการจ่ายไม่ได้');
RESET ROLE;
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.split_pending_item('INCOME', (SELECT id FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
  AND received_to_liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ')),
  jsonb_build_array(jsonb_build_object('description','ส่วนลดดอกเบี้ยทดสอบ','amount',1000,'income_type','OTHER','date','2026-09-15'))) AS dd2;
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
               AND received_to_liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ'))
            AND (SELECT received_to_liability_id FROM public.income_transactions WHERE notes = 'ส่วนลดดอกเบี้ยทดสอบ' AND deleted_at IS NULL)
                = (SELECT id FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ')
            AND (SELECT outstanding_amount FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ') = 7000,
            'แยกก้อนรายได้ลดหนี้ครบ → ก้อนปิด · รายการที่แยกผูกกับหนี้ · ยอดหนี้ไม่เปลี่ยน');
SELECT t.fails($$UPDATE public.income_transactions SET date = '2026-09-25' WHERE notes = 'ส่วนลดดอกเบี้ยทดสอบ' AND deleted_at IS NULL$$,
               'นอกช่วง', 'รายได้ลดหนี้ย้ายวันที่ออกนอกช่วงของยอดไม่ได้');
SELECT t.fails($$INSERT INTO public.income_transactions(received_to_liability_id, date, income_type, amount, currency)
  SELECT id, '2026-09-10', 'OTHER', 10, 'THB' FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ'$$, 'ต้องแยกมาจาก', 'รายได้ลดหนี้สร้างเองตรง ๆ ไม่ได้');
UPDATE public.income_transactions SET deleted_at = now() WHERE notes = 'ส่วนลดดอกเบี้ยทดสอบ' AND deleted_at IS NULL;
SELECT t.ok((SELECT amount FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
               AND received_to_liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ')) = 1000,
            'ลบรายการที่แยก → ก้อนรายได้ลดหนี้กลับมา 1,000');
SELECT t.ok(((public.pay_from_statement_drop(jsonb_build_object('kind','LIABILITY','id',(SELECT id FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ'),
  'bank_asset_id', t.a('บัญชีจ่ายหนี้ลด'), 'date','2026-09-20', 'amount', 1000)))->>'lump_left')::numeric = 0,
            'ลงเป็นการจ่ายส่วนที่เหลือ → ก้อนหมด');
SELECT t.ok(((public.update_liability_statement((SELECT id FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ'), '2026-09-20', 7500))->>'lump')::numeric = 500,
            'บันทึกยอดวันเดิมใหม่ให้สูงกว่า → คืนค่าก้อน +500');
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND lump_kind = 'LIABILITY' AND deleted_at IS NULL
                   AND liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้ลดทดสอบ')) = 500,
            'บันทึกยอดวันเดิมใหม่ให้สูงกว่า (จ่ายแล้ว 3,000) → กลับเป็นค่าใช้จ่ายก้อน 500');
-- บัญชีธนาคาร: ยอดสูงกว่า → รายได้ก้อน · บันทึกรายได้จริงทีหลังมากกว่าส่วนต่าง → กลับเป็นค่าใช้จ่ายก้อน
SELECT public.create_bank_account('บัญชีกลับด้าน', 'ทดสอบ', 'THB', 10000, '2026-08-31', false, 'SAVING', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('person_id', t.p('คุณพ่อ'), 'percent', 100)), NULL, NULL) IS NOT NULL AS dd3;
SELECT t.ok(((public.update_bank_statement(t.a('บัญชีกลับด้าน'), '2026-09-20', 15000))->>'lump')::numeric = 5000,
            'ธนาคาร: ยอดสูงกว่า 5,000 → รายได้ก้อน 5,000');
INSERT INTO public.income_transactions(family_id, person_id, received_to_asset_id, date, income_type, amount, currency, notes)
  SELECT id, t.p('คุณพ่อ'), t.a('บัญชีกลับด้าน'), '2026-09-10', 'OTHER', 20000, 'THB', 'รายได้ที่บันทึกทีหลัง' FROM public.families;
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL AND received_to_asset_id = t.a('บัญชีกลับด้าน'))
            AND (SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีกลับด้าน')) = 15000,
            'ธนาคาร: บันทึกรายได้ 20,000 ทีหลัง → รายได้ก้อนหาย · กลายเป็นค่าใช้จ่ายก้อน 15,000');
-- บัตร
INSERT INTO public.credit_cards(person_id, issuer, card_name, card_last4, outstanding_balance, balance_date)
  VALUES (t.p('คุณพ่อ'), 'ทดสอบ', 'ยอดลด', '6633', 5000, '2026-08-31');
SELECT t.ok(((public.update_card_statement((SELECT id FROM public.credit_cards WHERE card_last4 = '6633'), '2026-09-20', 4000))->>'lump')::numeric = -1000,
            'ยอดบัตรต่ำกว่าที่บันทึก 1,000 → รายได้ก้อนเข้าบัตร');
SELECT t.ok(((public.pay_from_statement_drop(jsonb_build_object('kind','CARD','id',(SELECT id FROM public.credit_cards WHERE card_last4 = '6633'),
  'bank_asset_id', t.a('บัญชีจ่ายหนี้ลด'), 'date','2026-09-20', 'amount', 1000)))->>'lump_left')::numeric = 0,
            'บัตร: ลงเป็นการจ่าย 1,000 → ก้อนหมด');
SELECT t.ok((SELECT current_balance FROM public.v_card_balances WHERE card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '6633')) = 4000,
            'บัตร: ยอดบัตรยัง 4,000 หลังจ่าย (ไม่หักซ้ำ)');
RESET ROLE;
SELECT t.ok(private.bank_calculated_balance(t.a('บัญชีจ่ายหนี้ลด'), '2026-09-20') = 46000, 'บัญชี: เงินออกรวม 4,000 (หนี้ 3,000 + บัตร 1,000)');

\echo '== 13zd. แยกก้อนเป็นการจ่าย / โอน (split_lump) · ก้อนที่ปิดแล้วกลับมาเมื่อลบรายการ · ส่วนแบ่งตามผู้รับผิดชอบหนี้'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
INSERT INTO public.liabilities(family_id, liability_type, name, currency) SELECT id, 'PERSONAL_LOAN', 'หนี้ก้อนกลับ', 'THB' FROM public.families;
INSERT INTO public.liability_ownerships(liability_id, person_id, responsibility_percent)
  SELECT id, t.p('คุณแม่'), 60 FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ';
INSERT INTO public.liability_ownerships(liability_id, person_id, responsibility_percent)
  SELECT id, t.p('คุณพ่อ'), 40 FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ';
INSERT INTO public.liability_valuations(liability_id, valuation_date, balance, source)
  SELECT id, '2026-08-31', 10000, 'STATEMENT' FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ';
SELECT (public.update_liability_statement((SELECT id FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ'), '2026-09-20', 8000))->>'lump' AS sl0;
SELECT (public.pay_from_statement_drop(jsonb_build_object('kind','LIABILITY','id',(SELECT id FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ'),
  'bank_asset_id', t.a('บัญชีจ่ายหนี้ลด'), 'date','2026-09-20', 'amount', 2000)))->>'lump_left' AS sl1;
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
              AND received_to_liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ')), 'ลงเป็นการจ่ายเต็มจำนวน → ก้อนหมด');
UPDATE public.cash_movements SET deleted_at = now()
 WHERE to_liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ') AND deleted_at IS NULL;
SELECT t.ok((SELECT amount FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
              AND received_to_liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ')) = 2000,
            'ลบรายการจ่ายที่ลงไว้ → รายได้ก้อนลดหนี้กลับมา 2,000 (ก้อนเคยหมดไปแล้ว)');
SELECT t.fails($$SELECT public.split_lump('INCOME', (SELECT id FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
  AND received_to_liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ')),
  jsonb_build_array(jsonb_build_object('description','ส่วนลดทดสอบ','amount',500,'income_type','OTHER'),
                    jsonb_build_object('move','TRANSFER','target', t.a('บัญชีจ่ายหนี้ลด'),'amount',1500)))$$,
  'แยกเป็น', 'ก้อนของหนี้แยกเป็นเงินโอนไม่ได้');
SELECT t.ok((SELECT amount FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
              AND received_to_liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ')) = 2000
            AND NOT EXISTS (SELECT 1 FROM public.income_transactions WHERE notes = 'ส่วนลดทดสอบ'),
            'แยกไม่สำเร็จ → ไม่มีอะไรเปลี่ยน (ทำทั้งหมดหรือไม่ทำเลย)');
SELECT t.ok(public.split_lump('INCOME', (SELECT id FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
  AND received_to_liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ')),
  jsonb_build_array(jsonb_build_object('description','ส่วนลดทดสอบ','amount',500,'income_type','OTHER'),
                    jsonb_build_object('move','PAY_FROM','target', t.a('บัญชีจ่ายหนี้ลด'),'amount','1,500'))) = 0,
            'แยกก้อนลดหนี้: ส่วนลด 500 (รายได้) + จ่ายจากบัญชี 1,500 ในคำสั่งเดียว → ก้อนหมด');
SELECT t.ok((SELECT sum(amount) FROM public.cash_movements WHERE deleted_at IS NULL AND movement_type = 'LIABILITY_PAYMENT'
              AND to_liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ')) = 1500
            AND (SELECT outstanding_amount FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ') = 8000,
            'จ่ายเงินต้น 1,500 จากบัญชี · ยอดหนี้ยัง 8,000 ตาม Statement');
SELECT t.ok((SELECT share_percent FROM public.v_income_by_person WHERE person_id = t.p('คุณแม่')
              AND income_id = (SELECT id FROM public.income_transactions WHERE notes = 'ส่วนลดทดสอบ' AND deleted_at IS NULL)) = 60
            AND (SELECT share_percent FROM public.v_income_by_person WHERE person_id = t.p('คุณพ่อ')
              AND income_id = (SELECT id FROM public.income_transactions WHERE notes = 'ส่วนลดทดสอบ' AND deleted_at IS NULL)) = 40,
            'รายได้ลดหนี้ (ไม่ระบุคน) แบ่งตามผู้รับผิดชอบหนี้ 60 / 40');
SELECT (public.update_liability_statement((SELECT id FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ'), '2026-09-25', 8300))->>'lump' AS sl2;
SELECT t.ok((SELECT share_percent FROM public.v_expense_by_person WHERE person_id = t.p('คุณแม่')
              AND expense_item_id = (SELECT id FROM public.expense_items WHERE pending_split AND deleted_at IS NULL
                AND liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้ก้อนกลับ'))) = 60,
            'ค่าใช้จ่ายก้อนของหนี้ (ไม่ระบุคน) แบ่งตามผู้รับผิดชอบหนี้');
-- บัญชีธนาคาร: แยกก้อนค่าใช้จ่ายเป็น เงินโอน + จ่ายบัตร + ค่าใช้จ่าย
SELECT public.create_bank_account('บัญชีก้อนโอน', 'ทดสอบ', 'THB', 10000, '2026-08-31', false, 'SAVING', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('person_id', t.p('คุณพ่อ'), 'percent', 100)), NULL, NULL) IS NOT NULL AS sl3;
SELECT (public.update_bank_statement(t.a('บัญชีก้อนโอน'), '2026-09-20', 7000))->>'lump' AS sl4;
SELECT t.ok(public.split_lump('EXPENSE', (SELECT id FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีก้อนโอน')),
  jsonb_build_array(jsonb_build_object('move','TRANSFER','target', t.a('บัญชีจ่ายหนี้ลด'),'amount',1000),
                    jsonb_build_object('move','CARD_PAYMENT','target',(SELECT id FROM public.credit_cards WHERE card_last4 = '6633'),'amount',500),
                    jsonb_build_object('description','ค่าอาหารก้อนโอน','amount',1500,'expense_category','ทั่วไป'))) = 0,
            'ก้อนบัญชี 3,000 → โอน 1,000 + จ่ายบัตร 500 + ค่าใช้จ่าย 1,500 → ก้อนหมด');
SELECT t.ok((SELECT count(*) FROM public.cash_movements WHERE deleted_at IS NULL AND from_asset_id = t.a('บัญชีก้อนโอน')
              AND movement_type IN ('TRANSFER','CARD_PAYMENT') AND metadata->>'via' = 'split_pending') = 2,
            'เงินโอน / จ่ายบัตร บันทึกเป็นรายการเคลื่อนเงินวันเดียวกับก้อน');
-- แก้เงินโอน: เปลี่ยนบัญชีปลายทาง → ก้อนของบัญชีปลายทางปรับเอง
SELECT public.update_transfer((SELECT id FROM public.cash_movements WHERE deleted_at IS NULL AND movement_type = 'TRANSFER'
  AND from_asset_id = t.a('บัญชีก้อนโอน')), t.a('บัญชีก้อนโอน'), t.a('บัญชีกลับด้าน'), '2026-09-20', 1000, NULL, 'โอนแก้บัญชี') AS sl5;
SELECT t.ok((SELECT to_asset_id FROM public.cash_movements WHERE deleted_at IS NULL AND movement_type = 'TRANSFER'
              AND from_asset_id = t.a('บัญชีก้อนโอน')) = t.a('บัญชีกลับด้าน')
            AND (SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีกลับด้าน')) = 16000
            AND NOT EXISTS (SELECT 1 FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีก้อนโอน')),
            'แก้บัญชีปลายทางของเงินโอน → ก้อนบัญชีปลายทางใหม่ปรับ (+1,000) · ก้อนบัญชีต้นทางยังหมด');
SELECT t.fails($$SELECT public.update_transfer((SELECT id FROM public.cash_movements WHERE deleted_at IS NULL AND movement_type = 'TRANSFER'
  AND from_asset_id = t.a('บัญชีก้อนโอน')), t.a('บัญชีก้อนโอน'), t.a('บัญชีก้อนโอน'), '2026-09-20', 1000, NULL, NULL)$$,
  'คนละบัญชี', 'เงินโอนต้นทาง / ปลายทางต้องคนละบัญชี');
-- ลบเงินโอน → ก้อนบัญชีต้นทางที่ปิดไปแล้วกลับมา · ก้อนบัญชีปลายทางกลับเป็น 15,000
UPDATE public.cash_movements SET deleted_at = now() WHERE deleted_at IS NULL AND movement_type = 'TRANSFER' AND from_asset_id = t.a('บัญชีก้อนโอน');
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีก้อนโอน')) = 1000
            AND (SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีกลับด้าน')) = 15000,
            'ลบเงินโอน → ก้อนบัญชีต้นทางกลับมา 1,000 · ก้อนบัญชีปลายทางกลับเป็น 15,000');
RESET ROLE;
SELECT t.ok(private.bank_calculated_balance(t.a('บัญชีก้อนโอน'), '2026-09-20') = 7000, 'บัญชีต้นทางยังตรง Statement 7,000');
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$SELECT public.split_lump('EXPENSE', (SELECT id FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีก้อนโอน')),
  jsonb_build_array(jsonb_build_object('description','x','amount',1,'expense_category','ทั่วไป')))$$, 'PERMISSION|สิทธิ์|role', 'VIEWER แยกก้อนไม่ได้');
RESET ROLE;

\echo '== 13ze. แก้ / ลบยอดตาม Statement ในตารางประวัติ → ก้อนคำนวณตาม · ล็อกงวดยอดบัตร · Checklist ก้อนรอแยก'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
INSERT INTO public.liabilities(family_id, liability_type, name, currency) SELECT id, 'PERSONAL_LOAN', 'หนี้แก้ประวัติ', 'THB' FROM public.families;
INSERT INTO public.liability_valuations(liability_id, valuation_date, balance, source)
  SELECT id, '2026-08-31', 10000, 'STATEMENT' FROM public.liabilities WHERE name = 'หนี้แก้ประวัติ';
SELECT (public.update_liability_statement((SELECT id FROM public.liabilities WHERE name = 'หนี้แก้ประวัติ'), '2026-09-10', 10200))->>'lump' AS rs0;
SELECT (public.update_liability_statement((SELECT id FROM public.liabilities WHERE name = 'หนี้แก้ประวัติ'), '2026-09-20', 10500))->>'lump' AS rs1;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND date = '2026-09-20'
              AND liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้แก้ประวัติ')) = 300, 'หนี้: ก้อน 10 ก.ย. 200 · 20 ก.ย. 300');
UPDATE public.liability_valuations SET balance = 10800 WHERE valuation_date = '2026-09-20' AND deleted_at IS NULL
   AND liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้แก้ประวัติ');
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND date = '2026-09-20'
              AND liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้แก้ประวัติ')) = 600,
            'หนี้: แก้ยอด 20 ก.ย. ในประวัติเป็น 10,800 → ก้อนปรับเป็น 600 เอง');
UPDATE public.liability_valuations SET balance = 10100 WHERE valuation_date = '2026-09-10' AND deleted_at IS NULL
   AND liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้แก้ประวัติ');
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND date = '2026-09-10'
              AND liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้แก้ประวัติ')) = 100
            AND (SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND date = '2026-09-20'
              AND liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้แก้ประวัติ')) = 700,
            'หนี้: แก้ยอด 10 ก.ย. เป็น 10,100 → ก้อนของยอดนั้น 100 · ก้อนถัดไปใช้จุดตั้งต้นใหม่ = 700');
UPDATE public.liability_valuations SET deleted_at = now() WHERE valuation_date = '2026-09-10' AND deleted_at IS NULL
   AND liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้แก้ประวัติ');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND date = '2026-09-10'
              AND liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้แก้ประวัติ'))
            AND (SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND date = '2026-09-20'
              AND liability_id = (SELECT id FROM public.liabilities WHERE name = 'หนี้แก้ประวัติ')) = 800,
            'หนี้: ลบยอด 10 ก.ย. → ก้อนของยอดนั้นหาย · ก้อน 20 ก.ย. ใช้ยอด 31 ส.ค. เป็นจุดตั้งต้น = 800');
-- บัญชีธนาคาร
SELECT public.create_bank_account('บัญชีแก้ประวัติ', 'ทดสอบ', 'THB', 10000, '2026-08-31', false, 'SAVING', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('person_id', t.p('คุณพ่อ'), 'percent', 100)), NULL, NULL) IS NOT NULL AS rs2;
SELECT (public.update_bank_statement(t.a('บัญชีแก้ประวัติ'), '2026-09-10', 9500))->>'lump' AS rs3;
SELECT (public.update_bank_statement(t.a('บัญชีแก้ประวัติ'), '2026-09-20', 9000))->>'lump' AS rs4;
UPDATE public.asset_valuations SET deleted_at = now() WHERE asset_id = t.a('บัญชีแก้ประวัติ') AND valuation_date = '2026-09-20' AND deleted_at IS NULL;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีแก้ประวัติ')) = 500
            AND (SELECT date FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีแก้ประวัติ')) = '2026-09-10',
            'บัญชี: ลบยอดล่าสุดของเดือน → ก้อนย้ายกลับไปยอด 10 ก.ย. = 500');
UPDATE public.asset_valuations SET value = 9700 WHERE asset_id = t.a('บัญชีแก้ประวัติ') AND valuation_date = '2026-09-10' AND deleted_at IS NULL;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีแก้ประวัติ')) = 300,
            'บัญชี: แก้ยอดในประวัติเป็น 9,700 → ก้อนปรับเป็น 300 เอง');
UPDATE public.asset_valuations SET deleted_at = now() WHERE asset_id = t.a('บัญชีแก้ประวัติ') AND valuation_date = '2026-09-10' AND deleted_at IS NULL;
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีแก้ประวัติ'))
            AND NOT EXISTS (SELECT 1 FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL AND received_to_asset_id = t.a('บัญชีแก้ประวัติ')),
            'บัญชี: ลบยอดทั้งหมดของเดือน → ก้อนหาย');
-- ยอดบัตรในงวดที่ปิดแล้ว
SELECT t.fails($$SELECT public.update_card_statement((SELECT id FROM public.credit_cards WHERE card_last4 = '6633'), '2026-07-20', 123)$$,
  'PERIOD_LOCKED', 'ยอดบัตรตาม Statement ในงวดที่ปิดแล้วบันทึกไม่ได้');
RESET ROLE;
SELECT t.ok(EXISTS (SELECT 1 FROM private.month_closing_issues(private.default_family_id(), '2026-09-01') i
                    WHERE i.category = 'INCOME_EXPENSES' AND i.code = 'PENDING_SPLIT' AND i.entity_type = 'PENDING_EXPENSE')
            AND EXISTS (SELECT 1 FROM private.month_closing_issues(private.default_family_id(), '2026-09-01') i
                    WHERE i.category = 'INCOME_EXPENSES' AND i.code = 'PENDING_SPLIT' AND i.severity = 'REVIEW'),
            'Month Closing: Checklist Income & Expenses แสดงก้อนรอแยกของเดือน (เตือนเท่านั้น)');

\echo '== 13zf. อัปเดตยอดคงเหลือหลายบัญชีพร้อมกัน · สรุปรายเดือน · ปิดงวดใช้ยอดตามระบบ'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.create_bank_account('บัญชีชุด A', 'ธนาคารชุด', 'THB', 10000, '2026-08-31', false, 'SAVING', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('person_id', t.p('คุณพ่อ'), 'percent', 100)), NULL, NULL) IS NOT NULL AS bt0;
SELECT public.create_bank_account('บัญชีชุด B', 'ธนาคารชุด', 'THB', 5000, '2026-08-31', false, 'SAVING', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('person_id', t.p('คุณแม่'), 'percent', 100)), NULL, NULL) IS NOT NULL AS bt1;
SELECT t.fails($$SELECT public.batch_update_bank_statements('2026-07-20', jsonb_build_array(
  jsonb_build_object('asset_id', t.a('บัญชีชุด A'), 'value', 10000)))$$, 'บัญชีชุด A', 'วันที่ในงวดที่ปิดแล้ว → ไม่บันทึก และบอกชื่อบัญชีที่ผิด');
SELECT t.fails($$SELECT public.batch_update_bank_statements('2026-09-25', jsonb_build_array(
  jsonb_build_object('asset_id', t.a('บัญชีชุด A'), 'value', 10000), jsonb_build_object('asset_id', t.a('บัญชีชุด A'), 'value', 1)))$$,
  'ซ้ำ', 'บัญชีซ้ำในชุดเดียวกันไม่ได้');
SELECT t.ok(jsonb_array_length(public.batch_update_bank_statements('2026-09-25', jsonb_build_array(
  jsonb_build_object('asset_id', t.a('บัญชีชุด A'), 'value', '10,000'),
  jsonb_build_object('asset_id', t.a('บัญชีชุด B'), 'value', 4700)))) = 2, 'บันทึก 2 บัญชีในคำสั่งเดียว');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีชุด A'))
            AND (SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีชุด B')) = 300,
            'บัญชีที่ตรง → ไม่มีก้อน · บัญชีที่ต่ำกว่า 300 → ค่าใช้จ่ายก้อน 300');
INSERT INTO public.cash_movements(movement_date, movement_type, from_asset_id, to_asset_id, amount, currency, description)
  VALUES ('2026-09-26', 'TRANSFER', t.a('บัญชีชุด A'), t.a('บัญชีชุด B'), 1000, 'THB', 'โอนระหว่างบัญชีชุด');
SELECT t.ok((SELECT calculated FROM public.bank_balances_at('2026-09-27') WHERE asset_id = t.a('บัญชีชุด A')) = 9000
            AND (SELECT last_date FROM public.bank_balances_at('2026-09-27') WHERE asset_id = t.a('บัญชีชุด A')) = '2026-09-25',
            'ยอดตามระบบ ณ วันที่ = ยอดล่าสุด + เงินเข้า − เงินออก');
SELECT t.ok((SELECT internal_out FROM public.bank_month_summary('2026-09-01') WHERE asset_id = t.a('บัญชีชุด A')) = 1000
            AND (SELECT internal_in FROM public.bank_month_summary('2026-09-01') WHERE asset_id = t.a('บัญชีชุด B')) = 1000
            AND (SELECT n_out FROM public.bank_month_summary('2026-09-01') WHERE asset_id = t.a('บัญชีชุด A')) = 0
            AND (SELECT balance FROM public.bank_month_summary('2026-09-01') WHERE asset_id = t.a('บัญชีชุด A')) = 9000
            AND (SELECT prev_balance FROM public.bank_month_summary('2026-09-01') WHERE asset_id = t.a('บัญชีชุด A')) = 10000,
            'สรุปรายเดือน: แยกเงินโอนระหว่างบัญชีของครอบครัว · ยอดสิ้นเดือน / เดือนก่อน');
RESET ROLE;
SELECT t.ok((SELECT value FROM private.net_worth_items(private.default_family_id(), '2026-09-30', true) WHERE asset_id = t.a('บัญชีชุด A')) = 9000,
            'ปิดงวดโดยไม่ได้อัปเดตยอดสิ้นเดือน → Snapshot ใช้ยอดตามระบบ (ไม่ใช่ยอด Statement เก่า)');
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$SELECT public.batch_update_bank_statements('2026-09-28', jsonb_build_array(
  jsonb_build_object('asset_id', t.a('บัญชีชุด A'), 'value', 9000)))$$, 'PERMISSION|สิทธิ์|role', 'VIEWER อัปเดตยอดไม่ได้');
RESET ROLE;

\echo '== 13zg. ธุรกิจ: ขายหุ้นรายคน (บางส่วน · หมด · ยกเลิกครั้งล่าสุด)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.create_private_business(jsonb_build_object(
  'name','บริษัทขายหุ้น','company_name','บริษัท ขายหุ้นทดสอบ จำกัด','total_shares',1000,'investment_cost',1000000,
  'value',1000000,'value_date',current_date - 2,'is_opening',false,'acquisition_date',current_date - 2,'valuation_method','BOOK_VALUE',
  'owners', jsonb_build_array(jsonb_build_object('person_id',t.p('คุณพ่อ'),'shares',600), jsonb_build_object('person_id',t.p('คุณแม่'),'shares',400)))) IS NOT NULL AS biz2;
SELECT public.sell_business_shares(t.a('บริษัทขายหุ้น'), t.p('คุณพ่อ'), current_date - 1, 200, 300000, 1000, t.a('KBank ออมทรัพย์'), 'ผู้ซื้อทดสอบ') IS NOT NULL AS sale1;
SELECT t.ok((SELECT shares_owned FROM public.private_business_details WHERE asset_id = t.a('บริษัทขายหุ้น')) = 800
            AND (SELECT shares FROM public.asset_ownerships WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณพ่อ') AND end_date IS NULL AND deleted_at IS NULL) = 400
            AND (SELECT end_date FROM public.asset_ownerships WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณพ่อ') AND shares = 600 AND deleted_at IS NULL) = current_date - 2
            AND (SELECT value FROM public.asset_valuations WHERE asset_id = t.a('บริษัทขายหุ้น') AND valuation_date = current_date - 1 AND deleted_at IS NULL) = 800000
            AND (SELECT amount FROM public.cash_movements WHERE movement_type = 'ASSET_SALE' AND from_asset_id = t.a('บริษัทขายหุ้น') AND deleted_at IS NULL) = 200000
            AND (SELECT amount FROM public.income_transactions WHERE asset_id = t.a('บริษัทขายหุ้น') AND income_subtype = 'กำไรจากการขายหุ้น' AND deleted_at IS NULL) = 99000
            AND (SELECT person_id FROM public.income_transactions WHERE asset_id = t.a('บริษัทขายหุ้น') AND income_subtype = 'กำไรจากการขายหุ้น' AND deleted_at IS NULL) = t.p('คุณพ่อ'),
            'ขายหุ้นบางส่วน: หุ้นผู้ขายลดตั้งแต่วันขาย · หุ้นครอบครัว 800 · มูลค่า 800,000 · เงินเข้าบัญชี 299,000 = ทุนคืน 200,000 + กำไร 99,000 (รายได้ของผู้ขาย)');
SELECT t.ok((SELECT investment_cost FROM public.private_business_details WHERE asset_id = t.a('บริษัทขายหุ้น')) = 800000
            AND (SELECT gain FROM public.business_share_sales WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณพ่อ') AND deleted_at IS NULL) = 99000,
            'เงินลงทุนลดตามทุนของหุ้นที่ขาย (เฉลี่ย 1,000 × 200) · บันทึกกำไรในประวัติขาย');
SELECT t.ok((SELECT base_value FROM public.v_net_worth_items_current WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณพ่อ')) = 400000
            AND (SELECT base_value FROM public.v_net_worth_items_current WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณแม่')) = 400000,
            'มูลค่ารายคนหลังขาย: พ่อ 400 หุ้น = 400,000 · แม่ 400 หุ้น = 400,000');
SELECT t.fails($$SELECT public.sell_business_shares(t.a('บริษัทขายหุ้น'), t.p('คุณแม่'), current_date - 1, 500, 100, NULL, NULL, NULL)$$,
  'ขายเกินที่ถือ', 'ขายเกินจำนวนหุ้นที่ถือไม่ได้');
-- ขายหมดวันเดียวกัน (แถวที่เริ่มวันขาย → แก้ในแถว)
SELECT public.sell_business_shares(t.a('บริษัทขายหุ้น'), t.p('คุณแม่'), current_date - 1, 400, 420000, NULL, NULL, NULL) IS NOT NULL AS sale2;
SELECT t.ok((SELECT shares_owned FROM public.private_business_details WHERE asset_id = t.a('บริษัทขายหุ้น')) = 400
            AND NOT EXISTS (SELECT 1 FROM public.asset_ownerships WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณแม่') AND end_date IS NULL AND deleted_at IS NULL)
            AND (SELECT value FROM public.asset_valuations WHERE asset_id = t.a('บริษัทขายหุ้น') AND valuation_date = current_date - 1 AND deleted_at IS NULL) = 400000
            AND (SELECT status FROM public.assets WHERE id = t.a('บริษัทขายหุ้น')) = 'ACTIVE',
            'แม่ขายหมด (วันเดียวกัน): หลุดจากเจ้าของ · หุ้นครอบครัว 400 · มูลค่า 400,000 · ธุรกิจยังถืออยู่');
SELECT t.fails($$SELECT public.undo_business_share_sale((SELECT id FROM public.business_share_sales WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณพ่อ') AND deleted_at IS NULL))$$,
  'รายการล่าสุด', 'ยกเลิกได้เฉพาะการขายครั้งล่าสุด');
SELECT public.undo_business_share_sale((SELECT id FROM public.business_share_sales WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณแม่') AND deleted_at IS NULL));
SELECT t.ok((SELECT shares_owned FROM public.private_business_details WHERE asset_id = t.a('บริษัทขายหุ้น')) = 800
            AND (SELECT shares FROM public.asset_ownerships WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณแม่') AND end_date IS NULL AND deleted_at IS NULL) = 400
            AND (SELECT value FROM public.asset_valuations WHERE asset_id = t.a('บริษัทขายหุ้น') AND valuation_date = current_date - 1 AND deleted_at IS NULL) = 800000,
            'ยกเลิกครั้งล่าสุด: แม่ได้หุ้นคืน 400 · หุ้นครอบครัว 800 · มูลค่ากลับเป็น 800,000');
-- ทุกคนขายหมด → ขายหุ้นแล้ว · ยกเลิก → กลับมาถืออยู่
SELECT public.sell_business_shares(t.a('บริษัทขายหุ้น'), t.p('คุณแม่'), current_date, 400, 400000, NULL, t.a('KBank ออมทรัพย์'), NULL) IS NOT NULL AS sale3;
SELECT public.sell_business_shares(t.a('บริษัทขายหุ้น'), t.p('คุณพ่อ'), current_date, 400, 400000, NULL, t.a('KBank ออมทรัพย์'), NULL) IS NOT NULL AS sale4;
SELECT t.ok((SELECT status FROM public.assets WHERE id = t.a('บริษัทขายหุ้น')) = 'SOLD'
            AND (SELECT status FROM public.private_business_details WHERE asset_id = t.a('บริษัทขายหุ้น')) = 'SOLD'
            AND (SELECT value FROM public.asset_valuations WHERE asset_id = t.a('บริษัทขายหุ้น') AND valuation_date = current_date AND deleted_at IS NULL) = 0
            AND NOT EXISTS (SELECT 1 FROM public.v_net_worth_items_current WHERE asset_id = t.a('บริษัทขายหุ้น') AND base_value <> 0),
            'ทุกคนขายหมด → ขายหุ้นแล้ว · มูลค่า 0 · ไม่นับใน Net Worth');
SELECT public.undo_business_share_sale((SELECT id FROM public.business_share_sales WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณพ่อ') AND sale_date = current_date AND deleted_at IS NULL));
SELECT t.ok((SELECT status FROM public.assets WHERE id = t.a('บริษัทขายหุ้น')) = 'ACTIVE'
            AND (SELECT shares FROM public.asset_ownerships WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณพ่อ') AND end_date IS NULL AND deleted_at IS NULL) = 400
            AND (SELECT count(*) FROM public.cash_movements WHERE movement_type = 'ASSET_SALE' AND from_asset_id = t.a('บริษัทขายหุ้น') AND deleted_at IS NULL) = 2,
            'ยกเลิกการขายที่ทำให้ขายหมด → กลับมาถืออยู่ · เงินเข้าบัญชีของครั้งนั้นถูกลบ');
-- ขาดทุน → ค่าใช้จ่าย (ไม่มีเงินออก) · ยกเลิกแล้วหายด้วย
SELECT public.sell_business_shares(t.a('บริษัทขายหุ้น'), t.p('คุณพ่อ'), current_date, 100, 70000, NULL, t.a('KBank ออมทรัพย์'), NULL) IS NOT NULL AS sale_loss;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE related_asset_id = t.a('บริษัทขายหุ้น') AND expense_category = 'ขาดทุนจากการขายหุ้น' AND deleted_at IS NULL) = 30000
            AND (SELECT paid_from_asset_id FROM public.expense_items WHERE related_asset_id = t.a('บริษัทขายหุ้น') AND expense_category = 'ขาดทุนจากการขายหุ้น' AND deleted_at IS NULL) IS NULL
            AND (SELECT amount FROM public.cash_movements WHERE movement_type = 'ASSET_SALE' AND from_asset_id = t.a('บริษัทขายหุ้น') AND deleted_at IS NULL AND movement_date = current_date AND amount = 70000) = 70000,
            'ขายขาดทุน (มูลค่า 100,000 ขายได้ 70,000): ค่าใช้จ่ายขาดทุน 30,000 ไม่ผ่านบัญชี · เงินเข้าบัญชี 70,000');
SELECT public.undo_business_share_sale((SELECT id FROM public.business_share_sales WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณพ่อ') AND sale_date = current_date AND deleted_at IS NULL));
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.expense_items WHERE related_asset_id = t.a('บริษัทขายหุ้น') AND expense_category = 'ขาดทุนจากการขายหุ้น' AND deleted_at IS NULL),
            'ยกเลิกการขาย → ค่าใช้จ่ายขาดทุนถูกลบด้วย');
-- ลงทุนเพิ่ม (ออกหุ้นใหม่): หุ้น / ทุนเฉลี่ย / มูลค่า + ยอดจ่าย · ยกเลิก
SELECT public.buy_business_shares(t.a('บริษัทขายหุ้น'), t.p('คุณแม่'), current_date, 200, 300000, t.a('KBank ออมทรัพย์'), true, NULL) IS NOT NULL AS buy1;
SELECT t.ok((SELECT total_shares FROM public.private_business_details WHERE asset_id = t.a('บริษัทขายหุ้น')) = 1200
            AND (SELECT shares_owned FROM public.private_business_details WHERE asset_id = t.a('บริษัทขายหุ้น')) = 600
            AND (SELECT shares FROM public.asset_ownerships WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณแม่') AND end_date IS NULL AND deleted_at IS NULL) = 200
            AND (SELECT round(cost_per_share, 2) FROM public.asset_ownerships WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณแม่') AND end_date IS NULL AND deleted_at IS NULL) = 1500
            AND (SELECT value FROM public.asset_valuations WHERE asset_id = t.a('บริษัทขายหุ้น') AND valuation_date = current_date AND deleted_at IS NULL) = 700000
            AND (SELECT investment_cost FROM public.private_business_details WHERE asset_id = t.a('บริษัทขายหุ้น')) = 700000
            AND (SELECT sum(ownership_percent) FROM public.asset_ownerships WHERE asset_id = t.a('บริษัทขายหุ้น') AND end_date IS NULL AND deleted_at IS NULL) BETWEEN 99.99 AND 100,
            'ลงทุนเพิ่ม (ผู้ถือใหม่) 200 หุ้น 300,000 ออกหุ้นใหม่: หุ้นทั้งหมด 1,200 · ครอบครัว 600 · แม่ 200 หุ้น ทุนหุ้นละ 1,500 · มูลค่า +300,000 · เงินลงทุน +300,000');
SELECT public.undo_business_share_sale((SELECT id FROM public.business_share_sales WHERE asset_id = t.a('บริษัทขายหุ้น') AND kind = 'BUY' AND deleted_at IS NULL));
SELECT t.ok((SELECT total_shares FROM public.private_business_details WHERE asset_id = t.a('บริษัทขายหุ้น')) = 1000
            AND (SELECT shares_owned FROM public.private_business_details WHERE asset_id = t.a('บริษัทขายหุ้น')) = 400
            AND NOT EXISTS (SELECT 1 FROM public.asset_ownerships WHERE asset_id = t.a('บริษัทขายหุ้น') AND person_id = t.p('คุณแม่') AND end_date IS NULL AND deleted_at IS NULL)
            AND (SELECT investment_cost FROM public.private_business_details WHERE asset_id = t.a('บริษัทขายหุ้น')) = 400000
            AND NOT EXISTS (SELECT 1 FROM public.cash_movements WHERE movement_type = 'ASSET_PURCHASE' AND to_asset_id = t.a('บริษัทขายหุ้น') AND deleted_at IS NULL AND metadata ? 'share_buy'),
            'ยกเลิกการลงทุนเพิ่ม: หุ้นทั้งหมด / ครอบครัว / ของแม่ กลับเป็นเดิม · เงินจ่ายถูกลบ');
SELECT t.fails($$SELECT public.buy_business_shares(t.a('บริษัทขายหุ้น'), t.p('คุณแม่'), current_date, 700, 100, t.a('KBank ออมทรัพย์'), false, NULL)$$,
  'เกินหุ้นทั้งหมด', 'ซื้อหุ้น (ไม่ออกหุ้นใหม่) เกินหุ้นทั้งหมดของบริษัทไม่ได้');
-- ขายทั้งก้อน (สินทรัพย์อื่น): กำไรเทียบมูลค่าล่าสุด → รายได้แบ่งตามเจ้าของ · ขาดทุน → ค่าใช้จ่ายรายคน
INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency, acquisition_date, acquisition_cost)
  SELECT id, 'ALTERNATIVE', 'COLLECTIBLE', 'ของสะสมขายกำไร', 'THB', current_date - 2, 1000 FROM public.families;
INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source) VALUES (t.a('ของสะสมขายกำไร'), current_date - 2, 5000, 'USER_ESTIMATE', 'USER');
SELECT public.set_asset_ownership(t.a('ของสะสมขายกำไร'), jsonb_build_array(jsonb_build_object('person_id',t.p('คุณพ่อ'),'percent',50), jsonb_build_object('person_id',t.p('คุณแม่'),'percent',50)), 'CORRECT', NULL);
SELECT public.sell_asset(t.a('ของสะสมขายกำไร'), current_date, 8000, t.a('KBank ออมทรัพย์'), 500, NULL);
SELECT t.ok((SELECT amount FROM public.cash_movements WHERE movement_type = 'ASSET_SALE' AND from_asset_id = t.a('ของสะสมขายกำไร') AND deleted_at IS NULL) = 5000
            AND (SELECT amount FROM public.income_transactions WHERE asset_id = t.a('ของสะสมขายกำไร') AND income_subtype = 'กำไรจากการขายทรัพย์สิน' AND deleted_at IS NULL) = 2500
            AND (SELECT sum(amount_share) FROM public.v_income_by_person v JOIN public.income_transactions i ON i.id = v.income_id
                  WHERE i.asset_id = t.a('ของสะสมขายกำไร') AND v.person_id = t.p('คุณพ่อ')) = 1250,
            'ขายทั้งก้อน: ขาย 8,000 ค่าใช้จ่าย 500 · มูลค่าล่าสุด 5,000 → ทุนคืน 5,000 + กำไร 2,500 (แบ่งตามเจ้าของ 50/50)');
INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency, acquisition_date, acquisition_cost)
  SELECT id, 'ALTERNATIVE', 'COLLECTIBLE', 'ของสะสมขายขาดทุน', 'THB', current_date - 2, 1000 FROM public.families;
INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source) VALUES (t.a('ของสะสมขายขาดทุน'), current_date - 2, 5000, 'USER_ESTIMATE', 'USER');
SELECT public.set_asset_ownership(t.a('ของสะสมขายขาดทุน'), jsonb_build_array(jsonb_build_object('person_id',t.p('คุณพ่อ'),'percent',60), jsonb_build_object('person_id',t.p('คุณแม่'),'percent',40)), 'CORRECT', NULL);
SELECT public.sell_asset(t.a('ของสะสมขายขาดทุน'), current_date, 4000, t.a('KBank ออมทรัพย์'), NULL, NULL);
SELECT t.ok((SELECT sum(amount) FROM public.expense_items WHERE related_asset_id = t.a('ของสะสมขายขาดทุน') AND expense_category = 'ขาดทุนจากการขายทรัพย์สิน' AND deleted_at IS NULL) = 1000
            AND (SELECT amount FROM public.expense_items WHERE related_asset_id = t.a('ของสะสมขายขาดทุน') AND person_id = t.p('คุณพ่อ') AND deleted_at IS NULL) = 600
            AND (SELECT amount FROM public.cash_movements WHERE movement_type = 'ASSET_SALE' AND from_asset_id = t.a('ของสะสมขายขาดทุน') AND deleted_at IS NULL) = 4000,
            'ขายทั้งก้อนขาดทุน 1,000: ค่าใช้จ่ายรายคนตามเจ้าของ (พ่อ 600 · แม่ 400) · เงินเข้าบัญชี 4,000');
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$SELECT public.sell_business_shares(t.a('บริษัทขายหุ้น'), t.p('คุณพ่อ'), current_date, 1, 1, NULL, NULL, NULL)$$,
  'PERMISSION|สิทธิ์|role', 'VIEWER ขายหุ้นไม่ได้');
RESET ROLE;

\echo '== 13x. Property: บันทึกหลายรายการพร้อมกัน'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000a');
SELECT public.batch_record_rent(jsonb_build_array(
  jsonb_build_object('lease_id', (SELECT id FROM public.property_leases WHERE deleted_at IS NULL AND status = 'ACTIVE' AND end_date >= current_date ORDER BY created_at LIMIT 1),
                     'date', current_date, 'amount', 1234, 'received_to_asset_id', t.a('KBank ออมทรัพย์'), 'notes', 'batch-rent-test')));
SELECT t.ok((SELECT income_type = 'RENT' AND asset_id IS NOT NULL AND amount = 1234 FROM public.income_transactions WHERE notes = 'batch-rent-test'),
            'รับค่าเช่าหลายรายการ: บันทึกเป็น RENT ผูกทรัพย์สินจากสัญญา');
SELECT t.fails($$SELECT public.batch_record_rent(jsonb_build_array(
  jsonb_build_object('lease_id', (SELECT id FROM public.property_leases WHERE deleted_at IS NULL AND status = 'ACTIVE' AND end_date >= current_date ORDER BY created_at LIMIT 1),
                     'date', current_date, 'amount', 500, 'notes', 'batch-rent-bad'),
  jsonb_build_object('lease_id', (SELECT id FROM public.property_leases WHERE deleted_at IS NULL AND status = 'ACTIVE' AND end_date >= current_date ORDER BY created_at LIMIT 1),
                     'date', current_date + 1, 'amount', 500, 'notes', 'batch-rent-bad')))$$, 'อนาคต', 'รับค่าเช่า: วันที่อนาคตไม่ได้');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.income_transactions WHERE notes = 'batch-rent-bad'), 'รับค่าเช่า: แถวไหนผิด = ไม่บันทึกเลยทั้งชุด');
SELECT public.batch_add_property_expenses(jsonb_build_array(
  jsonb_build_object('date', current_date, 'description', 'batch-exp-test', 'amount', 800, 'related_asset_id', t.a('บ้าน A'),
                     'paid_from_asset_id', t.a('KBank ออมทรัพย์'), 'expense_category', 'บ้าน / สาธารณูปโภค')));
SELECT t.ok((SELECT related_asset_id = t.a('บ้าน A') AND amount = 800 FROM public.expense_items WHERE description = 'batch-exp-test' AND deleted_at IS NULL),
            'ค่าใช้จ่ายทรัพย์สินหลายรายการ: ผูกทรัพย์สิน + จ่ายจากบัญชี');
SELECT t.fails($$SELECT public.batch_add_property_expenses(jsonb_build_array(
  jsonb_build_object('date', current_date, 'description', 'batch-exp-bad', 'amount', 100, 'related_asset_id', t.a('KBank ออมทรัพย์'),
                     'paid_from_asset_id', t.a('KBank ออมทรัพย์'))))$$, 'เลือกทรัพย์สิน', 'ค่าใช้จ่าย: ต้องผูกอสังหาฯ');
SELECT t.fails($$SELECT public.batch_add_property_expenses(jsonb_build_array(
  jsonb_build_object('date', current_date, 'description', 'batch-exp-bad', 'amount', 100, 'related_asset_id', t.a('บ้าน A'))))$$,
  'บัญชี / บัตร', 'ค่าใช้จ่าย: ต้องเลือกบัญชี / บัตรที่จ่าย');
SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$SELECT public.batch_add_property_expenses(jsonb_build_array(
  jsonb_build_object('date', current_date, 'description', 'batch-exp-viewer', 'amount', 100, 'related_asset_id', t.a('บ้าน A'),
                     'paid_from_asset_id', t.a('KBank ออมทรัพย์'))))$$, 'PERMISSION|สิทธิ์|row-level|policy', 'VIEWER บันทึกค่าใช้จ่ายไม่ได้');
RESET ROLE;

\echo '== 13y. ความครบถ้วน: เจ้าของเป็นจำนวนหุ้นที่หารไม่ลงตัว = ครบ 100%'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000a');
SELECT public.create_private_business(jsonb_build_object(
  'name','บริษัทหุ้นหารไม่ลงตัว','company_name','บริษัท หารไม่ลงตัว จำกัด','total_shares',10,'investment_cost',3000,
  'value',3000,'value_date',current_date - 2,'is_opening',false,'acquisition_date',current_date - 2,'valuation_method','BOOK_VALUE',
  'owners', jsonb_build_array(jsonb_build_object('person_id',t.p('คุณพ่อ'),'shares',1), jsonb_build_object('person_id',t.p('คุณแม่'),'shares',2)))) IS NOT NULL AS biz3;
SELECT t.ok((SELECT sum(ownership_percent) FROM public.asset_ownerships WHERE asset_id = t.a('บริษัทหุ้นหารไม่ลงตัว') AND deleted_at IS NULL) < 100
            AND (SELECT NOT ('ownership' = ANY (missing)) FROM public.asset_completeness() WHERE asset_id = t.a('บริษัทหุ้นหารไม่ลงตัว')),
            'ความครบถ้วน: หุ้น 1 + 2 (% เก็บรวม 99.9999) ถือว่าเจ้าของครบ');
RESET ROLE;

\echo '== 13z. Property: ข้อมูลโฉนดเพิ่ม'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000a');
UPDATE public.property_details SET deed_book = '12', deed_page = '34', map_sheet = '5136 IV', survey_page = '99',
  subdistrict = 'ตำบลทดสอบ', district = 'อำเภอทดสอบ', province = 'จังหวัดทดสอบ' WHERE asset_id = t.a('บ้าน A');
SELECT t.ok((SELECT deed_book = '12' AND map_sheet = '5136 IV' AND province = 'จังหวัดทดสอบ' FROM public.property_details WHERE asset_id = t.a('บ้าน A')),
            'ข้อมูลโฉนด: เล่ม / ระวาง / จังหวัด บันทึกได้');
SELECT t.login('00000000-0000-0000-0000-00000000000f');
UPDATE public.property_details SET province = 'แก้โดย VIEWER' WHERE asset_id = t.a('บ้าน A');
RESET ROLE;
SELECT t.ok((SELECT province FROM public.property_details WHERE asset_id = t.a('บ้าน A')) = 'จังหวัดทดสอบ', 'ข้อมูลโฉนด: VIEWER แก้ไม่ได้');

\echo '== 13za. ภาษีที่ดินและสิ่งปลูกสร้าง: คำนวณรายปี · คัดลอกจากปีก่อน · ยอดประมาณ'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000a');
INSERT INTO public.property_tax_lines(asset_id, tax_year, sort_order, description, land_sq_wa, land_price_per_sq_wa,
  building_type, building_sqm, building_price_per_sqm, building_age, depreciation_pct, exemption, exemption_reason, rate_pct, discount_pct)
VALUES (t.a('บ้าน A'), extract(year FROM current_date)::int, 1, 'ชั้น 2-4 ห้องพัก', 100, 10000, 'ตึกแถว', 200, 8000, 10, 20, 280000, 'ทดสอบ', 0.3, 10),
       (t.a('บ้าน A'), extract(year FROM current_date)::int, 2, 'ชั้น 1 ร้านค้า', NULL, NULL, 'ตึกแถว', 100, 5000, NULL, 0, 0, NULL, 0.02, 0);
SELECT t.ok((SELECT land_value = 1000000 AND building_value = 1280000 AND total_value = 2280000 AND taxable_value = 2000000
               AND tax_full = 6000 AND tax_amount = 5400 FROM public.v_property_tax_lines WHERE description = 'ชั้น 2-4 ห้องพัก'),
            'ภาษีที่ดิน: ที่ดิน + สิ่งปลูกสร้าง − ค่าเสื่อม − ยกเว้น × อัตรา − ส่วนลด = 5,400');
SELECT t.ok((SELECT sum(tax_amount) FROM public.v_property_tax_lines WHERE asset_id = t.a('บ้าน A') AND tax_year = extract(year FROM current_date)::int) = 5500,
            'ภาษีที่ดิน: หลายรายการ อัตราต่างกันในโฉนดเดียว รวม 5,500');
SELECT public.sync_land_tax_estimate(t.a('บ้าน A'), extract(year FROM current_date)::int) AS land_tax_total;
SELECT t.ok((SELECT expected_amount FROM public.property_utilities u JOIN public.property_details pd ON pd.id = u.property_id
              WHERE pd.asset_id = t.a('บ้าน A') AND u.utility_type = 'LAND_TAX' AND u.deleted_at IS NULL ORDER BY u.active DESC, u.created_at LIMIT 1) = 5500,
            'ภาษีที่ดิน: ยอดประมาณค่าใช้จ่ายประจำ = ภาษีรวมปีปัจจุบัน');
SELECT t.ok(public.sync_land_tax_estimate(t.a('บ้าน A'), extract(year FROM current_date)::int - 1) IS NULL, 'ภาษีที่ดิน: ปีอื่นไม่แก้ยอดประมาณ');
SELECT public.copy_property_tax_year(t.a('บ้าน A'), extract(year FROM current_date)::int, extract(year FROM current_date)::int + 1) AS copied;
SELECT t.ok((SELECT count(*) FROM public.property_tax_lines WHERE asset_id = t.a('บ้าน A') AND tax_year = extract(year FROM current_date)::int + 1 AND deleted_at IS NULL) = 2
            AND (SELECT building_age FROM public.property_tax_lines WHERE asset_id = t.a('บ้าน A') AND tax_year = extract(year FROM current_date)::int + 1
                   AND description = 'ชั้น 2-4 ห้องพัก' AND deleted_at IS NULL) = 11
            AND (SELECT rate_pct FROM public.property_tax_lines WHERE asset_id = t.a('บ้าน A') AND tax_year = extract(year FROM current_date)::int + 1
                   AND description = 'ชั้น 1 ร้านค้า' AND deleted_at IS NULL) = 0.02,
            'ภาษีที่ดิน: คัดลอกจากปีก่อน (อัตราเดิม · อายุอาคาร +1)');
SELECT t.fails($$SELECT public.copy_property_tax_year(t.a('บ้าน A'), extract(year FROM current_date)::int, extract(year FROM current_date)::int + 1)$$,
  'มีรายการแล้ว', 'ภาษีที่ดิน: คัดลอกซ้ำทับปีที่มีรายการไม่ได้');
SELECT t.fails($$INSERT INTO public.property_tax_lines(asset_id, tax_year, rate_pct) VALUES (t.a('KBank ออมทรัพย์'), 2026, 0.3)$$,
  'อสังหาริมทรัพย์', 'ภาษีที่ดิน: ทรัพย์สินที่ไม่ใช่อสังหาฯ บันทึกไม่ได้');
SELECT t.fails($$INSERT INTO public.property_tax_lines(asset_id, tax_year, rate_pct) VALUES (t.a('บ้าน A'), 2026, -1)$$,
  'check', 'ภาษีที่ดิน: อัตราติดลบไม่ได้');
SELECT t.ok(NOT has_function_privilege('anon', 'private.tg_property_tax_line_check()', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'private.tg_property_tax_line_check()', 'EXECUTE'),
            'ภาษีที่ดิน: ฟังก์ชัน trigger ไม่เปิดให้ผู้ใช้เรียกตรง');
SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$INSERT INTO public.property_tax_lines(asset_id, tax_year, rate_pct) VALUES (t.a('บ้าน A'), 2026, 0.3)$$,
  'row-level|policy|PERMISSION', 'ภาษีที่ดิน: VIEWER บันทึกไม่ได้');
RESET ROLE;

\echo '== 13zb. Alternative: หน่วยนับ + ความบริสุทธิ์'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000a');
SELECT public.create_alternative_asset(jsonb_build_object('name','ทองแท่งทดสอบ','category_id',(SELECT id FROM public.asset_categories WHERE category_code = 'GOLD'),
  'value',100000,'value_date',current_date - 1,'is_opening',false,'acquisition_date',current_date - 1,'quantity',2.5,'purity_pct',96.5)) IS NOT NULL AS gold;
SELECT t.ok((SELECT unit = 'บาททองคำ' AND purity_pct = 96.5 AND quantity = 2.5 FROM public.alternative_asset_details d JOIN public.assets a ON a.id = d.asset_id WHERE a.name = 'ทองแท่งทดสอบ'),
            'Alternative: ไม่ระบุหน่วย = หน่วยตั้งต้นของหมวด (ทองคำ = บาททองคำ)');
SELECT public.create_alternative_asset(jsonb_build_object('name','สร้อยทดสอบ','category_id',(SELECT id FROM public.asset_categories WHERE category_code = 'GOLD'),
  'value',5000,'value_date',current_date - 1,'is_opening',false,'acquisition_date',current_date - 1,'quantity',3,'unit','กรัม')) IS NOT NULL AS gold2;
SELECT t.ok((SELECT unit FROM public.alternative_asset_details d JOIN public.assets a ON a.id = d.asset_id WHERE a.name = 'สร้อยทดสอบ') = 'กรัม',
            'Alternative: ระบุหน่วยเองได้');
SELECT t.fails($$UPDATE public.alternative_asset_details SET purity_pct = 120 WHERE asset_id = t.a('ทองแท่งทดสอบ')$$, 'aad_purity_pct_ck', 'Alternative: ความบริสุทธิ์เกิน 100% ไม่ได้');
RESET ROLE;
SELECT t.ok((SELECT count(*) FROM public.asset_categories WHERE deleted_at IS NULL AND default_unit IS NULL) = 0, 'Alternative: ทุกหมวดมีหน่วยตั้งต้น');

\echo '== 13zc. แหล่งอัตราแลกเปลี่ยน ธปท. / ธนาคารกรุงเทพ (ไม่เปลี่ยนอัตราเดิม)'
SET ROLE service_role; SELECT t.login(NULL);
SELECT public.server_upsert_fx_rates(jsonb_build_array(jsonb_build_object('rate_date', current_date - 1, 'currency', 'EUR', 'rate_to_thb', 38, 'source_reference', 'TEST'))) AS eur_yesterday;
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT t.fails($$SELECT public.set_fx_source('BBL')$$, 'PERMISSION_DENIED', 'FX: EDITOR เปลี่ยนแหล่งไม่ได้');
SELECT t.fails($$SELECT public.server_fx_settings()$$, 'permission denied', 'FX: ผู้ใช้อ่านค่าของ Job ตรงไม่ได้');
SELECT t.fails($$SELECT public.server_upsert_fx_rates('[]'::jsonb, 'FX_FETCH', 'BBL_API')$$, 'permission denied', 'FX: ผู้ใช้บันทึกอัตราตรงไม่ได้');
SELECT t.login('00000000-0000-0000-0000-00000000000a');
SELECT t.fails($$SELECT public.set_fx_source('XYZ')$$, 'BOT หรือ BBL', 'FX: แหล่งต้องเป็น BOT / BBL');
SELECT t.ok((public.set_fx_source('BBL', 'MID') ->> 'since')::date = (now() AT TIME ZONE 'Asia/Bangkok')::date, 'FX: เปลี่ยนเป็น BBL มีผลตั้งแต่วันนี้');
RESET ROLE;
SET ROLE service_role; SELECT t.login(NULL);
SELECT t.ok((public.server_fx_settings() ->> 'source') = 'BBL', 'FX: Job อ่านแหล่งปัจจุบันได้');
SELECT public.server_upsert_fx_rates(jsonb_build_array(
  jsonb_build_object('rate_date', '2026-10-02', 'currency', 'USD', 'rate_to_thb', 35.5, 'source_reference', 'BBL TEST'),
  jsonb_build_object('rate_date', (now() AT TIME ZONE 'Asia/Bangkok')::date, 'currency', 'EUR', 'rate_to_thb', 45, 'source_reference', 'BBL TEST'),
  jsonb_build_object('rate_date', (now() AT TIME ZONE 'Asia/Bangkok')::date, 'currency', 'GBP', 'rate_to_thb', 44, 'source_reference', 'BBL TEST')),
  'FX_FETCH', 'BBL_API') AS bbl_rows;
SELECT t.ok((SELECT source = 'BOT_API' AND rate_to_thb <> 35.5 FROM public.fx_rates WHERE currency = 'USD' AND rate_date = '2026-10-02' AND deleted_at IS NULL),
            'FX: อัตรา ธปท. เดิมไม่ถูกอัตรา BBL ทับ');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.fx_rates WHERE currency = 'EUR' AND rate_date = (now() AT TIME ZONE 'Asia/Bangkok')::date AND deleted_at IS NULL),
            'FX: BBL ต่างจากอัตราก่อนหน้าเกิน 5% → ไม่บันทึก');
SELECT t.ok((SELECT source = 'BBL_API' AND rate_to_thb = 44 FROM public.fx_rates WHERE currency = 'GBP' AND rate_date = (now() AT TIME ZONE 'Asia/Bangkok')::date AND deleted_at IS NULL),
            'FX: BBL วันนี้ (ไม่มีอัตราก่อนหน้าให้เทียบ) → บันทึกเป็น BBL_API');
SELECT t.ok((SELECT result = 'PARTIAL' AND jsonb_array_length(details -> 'skipped') = 1 FROM public.system_job_runs ORDER BY id DESC LIMIT 1),
            'FX: รายการที่ไม่บันทึกแสดงใน Job log (PARTIAL)');
SELECT public.server_upsert_fx_rates(jsonb_build_array(
  jsonb_build_object('rate_date', (now() AT TIME ZONE 'Asia/Bangkok')::date, 'currency', 'GBP', 'rate_to_thb', 43, 'source_reference', 'BOT TEST'))) AS bot_today;
SELECT t.ok((SELECT source = 'BBL_API' AND rate_to_thb = 44 FROM public.fx_rates WHERE currency = 'GBP' AND rate_date = (now() AT TIME ZONE 'Asia/Bangkok')::date AND deleted_at IS NULL),
            'FX: ตั้งแต่วันเปลี่ยน รับเฉพาะแหล่งปัจจุบัน (ธปท. ไม่ทับ)');
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000a');
SELECT public.set_fx_source('BOT') ->> 'source' AS back_to_bot;
RESET ROLE;
SET ROLE service_role; SELECT t.login(NULL);
SELECT public.server_upsert_fx_rates(jsonb_build_array(
  jsonb_build_object('rate_date', (now() AT TIME ZONE 'Asia/Bangkok')::date, 'currency', 'GBP', 'rate_to_thb', 43, 'source_reference', 'BOT TEST'))) AS bot_today2;
SELECT t.ok((SELECT source = 'BBL_API' AND rate_to_thb = 44 FROM public.fx_rates WHERE currency = 'GBP' AND rate_date = (now() AT TIME ZONE 'Asia/Bangkok')::date AND deleted_at IS NULL),
            'FX: เปลี่ยนกลับเป็น ธปท. → อัตรา BBL ที่บันทึกแล้วไม่เปลี่ยน');
RESET ROLE;
SELECT t.ok((SELECT count(*) FROM public.audit_logs WHERE metadata ->> 'kind' = 'FX_SOURCE') = 2, 'FX: บันทึก Audit ทุกครั้งที่เปลี่ยนแหล่ง');
UPDATE public.fx_rates SET deleted_at = now() WHERE source_reference IN ('BBL TEST', 'BOT TEST') OR (currency = 'EUR' AND source_reference = 'TEST');

\echo '== 13zd. ราคาอัตโนมัติ (หุ้น / กองทุน / ทองคำ)'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000a');
UPDATE public.investment_holdings SET auto_price = true, price_ref = 'AAPL' WHERE id = t.h('AAPL');
UPDATE public.alternative_asset_details SET auto_price = true WHERE asset_id IN (t.a('ทองแท่งทดสอบ'), t.a('สร้อยทดสอบ'));
SELECT t.fails($$SELECT public.server_price_targets()$$, 'permission denied', 'ราคา: ผู้ใช้อ่านรายการของ Job ตรงไม่ได้');
SELECT t.fails($$SELECT public.server_upsert_prices('[]'::jsonb)$$, 'permission denied', 'ราคา: ผู้ใช้บันทึกราคาตรงไม่ได้');
INSERT INTO public.investment_valuations(holding_id, valuation_date, price, quantity, market_value, source)
  SELECT id, current_date - 1, 205, quantity, quantity * 205, 'USER' FROM public.investment_holdings WHERE id = t.h('AAPL');
RESET ROLE;
SET ROLE service_role; SELECT t.login(NULL);
SELECT t.ok((SELECT count(*) FROM jsonb_array_elements(public.server_price_targets() -> 'holdings') x WHERE x ->> 'name' = 'AAPL') = 1
            AND jsonb_array_length(public.server_price_targets() -> 'gold') = 2, 'ราคา: Job เห็นเฉพาะรายการที่เปิดดึงราคาอัตโนมัติ');
SELECT public.server_upsert_prices(jsonb_build_array(
  jsonb_build_object('kind', 'HOLDING', 'id', t.h('AAPL'), 'date', (now() AT TIME ZONE 'Asia/Bangkok')::date, 'price', 210, 'source_reference', 'TEST'),
  jsonb_build_object('kind', 'HOLDING', 'id', t.h('AAPL'), 'date', current_date - 1, 'price', 206, 'source_reference', 'TEST'),
  jsonb_build_object('kind', 'HOLDING', 'id', t.h('Cash USD'), 'date', (now() AT TIME ZONE 'Asia/Bangkok')::date, 'price', 1, 'source_reference', 'TEST'),
  jsonb_build_object('kind', 'GOLD', 'asset_id', t.a('ทองแท่งทดสอบ'), 'date', (now() AT TIME ZONE 'Asia/Bangkok')::date, 'price_per_baht_965', 41000, 'source_reference', 'TEST'),
  jsonb_build_object('kind', 'GOLD', 'asset_id', t.a('สร้อยทดสอบ'), 'date', (now() AT TIME ZONE 'Asia/Bangkok')::date, 'price_per_baht_965', 41000, 'source_reference', 'TEST'))) AS prices_saved;
SELECT t.ok((SELECT current_price = 210 AND current_value = quantity * 210 FROM public.investment_holdings WHERE id = t.h('AAPL')),
            'ราคา: หุ้น → ราคาล่าสุด × จำนวนที่ถือ');
SELECT t.ok((SELECT price FROM public.investment_valuations WHERE holding_id = t.h('AAPL') AND valuation_date = current_date - 1 AND deleted_at IS NULL AND source = 'USER') = 205
            AND NOT EXISTS (SELECT 1 FROM public.investment_valuations WHERE holding_id = t.h('AAPL') AND valuation_date = current_date - 1 AND source = 'MARKET'),
            'ราคา: ไม่ทับราคาที่ผู้ใช้ / Statement บันทึกในวันเดียวกัน');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.investment_valuations WHERE holding_id = t.h('Cash USD') AND source = 'MARKET'), 'ราคา: รายการที่ไม่ได้เปิดดึงราคา ไม่บันทึก');
SELECT t.ok((SELECT current_value FROM public.assets WHERE id = t.a('ทองแท่งทดสอบ')) = 102500, 'ราคา: ทองคำ 2.5 บาททองคำ × 41,000 = 102,500');
SELECT t.ok((SELECT current_value FROM public.assets WHERE id = t.a('สร้อยทดสอบ')) = 5000, 'ราคา: มูลค่าใหม่ต่างจากเดิมเกิน 20% → ไม่บันทึก');
SELECT t.ok((SELECT result = 'PARTIAL' AND (details ->> 'rows')::int = 2 AND jsonb_array_length(details -> 'skipped') = 3 FROM public.system_job_runs ORDER BY id DESC LIMIT 1),
            'ราคา: Job log บอกจำนวนที่บันทึก + รายการที่ข้าม');
SELECT public.server_upsert_prices(jsonb_build_array(
  jsonb_build_object('kind', 'HOLDING', 'id', t.h('AAPL'), 'date', (now() AT TIME ZONE 'Asia/Bangkok')::date, 'price', 211, 'source_reference', 'TEST'),
  jsonb_build_object('kind', 'HOLDING', 'id', t.h('AAPL'), 'date', (now() AT TIME ZONE 'Asia/Bangkok')::date, 'price', 900, 'source_reference', 'TEST'))) AS prices_again;
SELECT t.ok((SELECT count(*) FROM public.investment_valuations WHERE holding_id = t.h('AAPL') AND valuation_date = (now() AT TIME ZONE 'Asia/Bangkok')::date AND source = 'MARKET' AND deleted_at IS NULL) = 1
            AND (SELECT current_price FROM public.investment_holdings WHERE id = t.h('AAPL')) = 211,
            'ราคา: ดึงซ้ำวันเดียวกัน = แก้ราคาเดิม · ราคาผิดปกติ (เกิน 20%) ไม่บันทึก');
RESET ROLE;
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.server_upsert_prices(jsonb, text)', 'EXECUTE'), 'ราคา: authenticated ไม่มีสิทธิ์ server_upsert_prices');

\echo '== 13zz. ปิดเดือนไม่ได้ถ้าบัญชีติดลบ · แยกก้อน: เงินโอนเกินยอดก้อนได้'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.create_bank_account('บัญชีโอนเกิน', 'ทดสอบ', 'THB', 5000, '2026-08-31', false, 'SAVING', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('person_id', t.p('คุณพ่อ'), 'percent', 100)), NULL, NULL) IS NOT NULL AS ov0;
SELECT (public.update_bank_statement(t.a('บัญชีโอนเกิน'), '2026-09-20', 4000))->>'lump' AS ov1;
SELECT t.ok((SELECT amount FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีโอนเกิน')) = 1000,
            'โอนเกิน: ก้อนค่าใช้จ่ายรอแยก 1,000');
SELECT t.fails($$SELECT public.split_lump('EXPENSE', (SELECT id FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีโอนเกิน')),
  jsonb_build_array(jsonb_build_object('description','ค่าใช้จ่ายเกินก้อน','amount',1200,'expense_category','ทั่วไป')))$$,
  'มากกว่ายอดรอแยก', 'โอนเกิน: ค่าใช้จ่ายอย่างเดียวเกินก้อนไม่ได้');
SELECT t.fails($$SELECT public.split_lump('EXPENSE', (SELECT id FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีโอนเกิน')),
  jsonb_build_array(jsonb_build_object('description','ค่าใช้จ่ายเกินก้อน','amount',1100,'expense_category','ทั่วไป'),
                    jsonb_build_object('move','TRANSFER','target', t.a('บัญชีจ่ายหนี้ลด'),'amount',100)))$$,
  'เฉพาะเงินโอน', 'โอนเกิน: บรรทัดที่ไม่ใช่เงินโอนรวมกันยังต้องไม่เกินก้อน');
SELECT t.fails($$SELECT public.split_lump('EXPENSE', (SELECT id FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีโอนเกิน')),
  jsonb_build_array(jsonb_build_object('move','CARD_PAYMENT','target',(SELECT id FROM public.credit_cards WHERE card_last4 = '6633'),'amount',1500)))$$,
  'มากกว่ายอดรอแยก', 'โอนเกิน: จ่ายบัตรเกินก้อนไม่ได้ (เกินได้เฉพาะเงินโอน)');
SELECT t.ok(public.split_lump('EXPENSE', (SELECT id FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีโอนเกิน')),
  jsonb_build_array(jsonb_build_object('description','ค่าใช้จ่ายโอนเกิน','amount',400,'expense_category','ทั่วไป'),
                    jsonb_build_object('move','TRANSFER','target', t.a('บัญชีจ่ายหนี้ลด'),'amount',900))) = -300,
            'โอนเกิน: ค่าใช้จ่าย 400 + โอน 900 (เกินก้อน 300) → คืนค่า −300');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีโอนเกิน'))
            AND (SELECT amount FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL AND received_to_asset_id = t.a('บัญชีโอนเกิน')) = 300,
            'โอนเกิน: ก้อนค่าใช้จ่ายหมด · ส่วนเกินเป็นรายได้รอแยก 300 ในบัญชีเดียวกัน');
SELECT t.ok(public.split_lump('INCOME', (SELECT id FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL AND received_to_asset_id = t.a('บัญชีโอนเกิน')),
  jsonb_build_array(jsonb_build_object('move','TRANSFER','target', t.a('บัญชีจ่ายหนี้ลด'),'amount',350))) = -50,
            'โอนเกิน: ก้อนรายได้ 300 แยกเป็นโอนเข้า 350 → ส่วนเกิน 50 รวมเป็นก้อนค่าใช้จ่ายของเดือนเดียวกัน');
SELECT t.ok((SELECT count(*) FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND paid_from_asset_id = t.a('บัญชีโอนเกิน')) = 1
            AND NOT EXISTS (SELECT 1 FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL AND received_to_asset_id = t.a('บัญชีโอนเกิน')),
            'โอนเกิน: ก้อนของบัญชีในเดือนนั้นมีฝั่งเดียว แถวเดียว');
RESET ROLE;
SELECT t.ok(private.bank_calculated_balance(t.a('บัญชีโอนเกิน'), '2026-09-20') = 4000, 'โอนเกิน: ยอดบัญชียังตรง Statement 4,000');
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT public.create_bank_account('บัญชีติดลบทดสอบ', 'ทดสอบ', 'THB', 100, '2026-08-31', false, 'SAVING', NULL, NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('person_id', t.p('คุณพ่อ'), 'percent', 100)), NULL, NULL) IS NOT NULL AS ng0;
SELECT t.ok(NOT (SELECT issues::text LIKE '%NEGATIVE_BALANCE%' FROM public.month_closing_checks('2026-09-01') WHERE category = 'CASH'), 'บัญชีติดลบ: ยังไม่ติดลบ → ไม่มีเงื่อนไขนี้');
INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, amount, currency, description)
  SELECT id, '2026-09-15', 'OTHER_OUT', t.a('บัญชีติดลบทดสอบ'), 500, 'THB', 'เงินออกทดสอบติดลบ' FROM public.families;
SELECT t.ok((SELECT status = 'BLOCKED' AND issues::text LIKE '%NEGATIVE_BALANCE%' AND issues::text LIKE '%บัญชีติดลบทดสอบ%'
               FROM public.month_closing_checks('2026-09-01') WHERE category = 'CASH'),
            'บัญชีติดลบ ณ สิ้นเดือน (−400) → หมวด Cash เป็น BLOCKED (ปิดเดือนไม่ได้)');
UPDATE public.cash_movements SET deleted_at = now() WHERE description = 'เงินออกทดสอบติดลบ' AND deleted_at IS NULL;
SELECT t.ok(NOT (SELECT issues::text LIKE '%NEGATIVE_BALANCE%' FROM public.month_closing_checks('2026-09-01') WHERE category = 'CASH'), 'บัญชีติดลบ: ลบรายการแล้วกลับเป็นบวก → เงื่อนไขหายไป');
RESET ROLE;

\echo '== 13zz2. เงินให้กู้: เบอร์ติดต่อ / เลขที่สัญญา / วัตถุประสงค์'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
UPDATE public.loan_details SET borrower_phone = '080-000-0000', contract_no = 'LN-TEST-001', purpose = 'ทดสอบ' WHERE asset_id = t.a('เงินกู้ญาติ');
SELECT t.ok((SELECT borrower_phone = '080-000-0000' AND contract_no = 'LN-TEST-001' AND purpose = 'ทดสอบ' FROM public.loan_details WHERE asset_id = t.a('เงินกู้ญาติ')),
            'เงินให้กู้: บันทึกเบอร์ติดต่อ / เลขที่สัญญา / วัตถุประสงค์ได้ (แม้มีเดือน FINAL — ไม่ใช่ยอดเงิน)');
SELECT t.fails($$UPDATE public.loan_details SET borrower_phone = repeat('9', 60) WHERE asset_id = t.a('เงินกู้ญาติ')$$, 'loan_details_extra_len', 'เงินให้กู้: เบอร์ติดต่อยาวเกิน 50 ตัวอักษรไม่ได้');
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.ok((SELECT count(*) FROM public.loan_details WHERE borrower_phone = '080-000-0000') = 1, 'เงินให้กู้: VIEWER อ่านเบอร์ได้ (ตามสิทธิ์อ่านเดิม)');
RESET ROLE;

\echo '== 13zz3. จ่ายออกจากบัญชีเงินฝากในพอร์ต: ค่าใช้จ่าย · จ่ายบัตร · ตัดบัตรอัตโนมัติ'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
SELECT (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินฝาก THB')) AS pf_thb0 \gset
SELECT public.add_expense(jsonb_build_object('date', current_date, 'description', 'ค่าเทอมจากพอร์ต', 'amount', 500,
  'expense_category', 'ทั่วไป', 'paid_from_cash_holding_id', t.h('เงินฝาก THB'))) AS pf_exp \gset
SELECT t.ok((SELECT currency = 'THB' AND paid_from_cash_holding_id = t.h('เงินฝาก THB') AND paid_from_asset_id IS NULL FROM public.expense_items WHERE id = :'pf_exp')
            AND (SELECT count(*) FROM public.investment_transactions WHERE source_expense_item_id = :'pf_exp' AND transaction_type = 'PAYMENT'
                   AND amount = 500 AND cash_holding_id = t.h('เงินฝาก THB') AND deleted_at IS NULL) = 1
            AND NOT EXISTS (SELECT 1 FROM public.cash_movements WHERE source_entity_type = 'EXPENSE' AND source_entity_id = :'pf_exp' AND deleted_at IS NULL),
            'ค่าใช้จ่ายจากพอร์ต → รายการ PAYMENT ในพอร์ต (ไม่มีเงินออกจากบัญชีธนาคาร)');
SELECT t.ok((SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินฝาก THB')) = :pf_thb0 - 500,
            'ค่าใช้จ่ายจากพอร์ต: เงินฝากในพอร์ตลด 500');
SELECT t.fails($$UPDATE public.investment_transactions SET amount = 1 WHERE source_expense_item_id = '$$ || :'pf_exp' || $$'$$,
               'DERIVED_RECORD', 'รายการ PAYMENT ที่สร้างจากค่าใช้จ่าย แก้ตรง ๆ ไม่ได้');
SELECT t.fails($$INSERT INTO public.investment_transactions(portfolio_id, transaction_date, transaction_type, amount, currency, source_expense_item_id)
  SELECT portfolio_id, current_date, 'PAYMENT', 1, 'THB', '$$ || :'pf_exp' || $$' FROM public.investment_holdings WHERE id = t.h('เงินฝาก THB')$$,
               'DERIVED_RECORD', 'สร้างรายการ PAYMENT ผูกค่าใช้จ่ายเองไม่ได้');
SELECT public.update_entry('EXPENSE', :'pf_exp', jsonb_build_object('amount', 650)) IS NOT NULL AS pf_exp_edit;
SELECT t.ok((SELECT amount FROM public.investment_transactions WHERE source_expense_item_id = :'pf_exp') = 650
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินฝาก THB')) = :pf_thb0 - 650,
            'แก้ยอดค่าใช้จ่าย → รายการในพอร์ตและเงินฝากเปลี่ยนตาม');
SELECT t.fails($$SELECT public.update_entry('EXPENSE', '$$ || :'pf_exp' || $$', '{}'::jsonb, 'h:' || t.h('เงินสด USD บัญชี A'))$$,
               'INVALID_CURRENCY', 'ย้ายไปบัญชีเงินฝากในพอร์ตคนละสกุลไม่ได้');
SELECT public.update_entry('EXPENSE', :'pf_exp', '{}'::jsonb, 'a:' || t.a('KBank ออมทรัพย์')) IS NOT NULL AS pf_to_bank;
SELECT t.ok((SELECT deleted_at IS NOT NULL FROM public.investment_transactions WHERE source_expense_item_id = :'pf_exp')
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินฝาก THB')) = :pf_thb0
            AND EXISTS (SELECT 1 FROM public.cash_movements WHERE source_entity_type = 'EXPENSE' AND source_entity_id = :'pf_exp'
                          AND from_asset_id = t.a('KBank ออมทรัพย์') AND deleted_at IS NULL),
            'เปลี่ยนไปจ่ายจากบัญชีธนาคาร → รายการในพอร์ตถูกลบ · เงินออกจากบัญชีธนาคารแทน');
SELECT public.update_entry('EXPENSE', :'pf_exp', '{}'::jsonb, 'h:' || t.h('เงินฝาก THB')) IS NOT NULL AS pf_back;
SELECT t.ok((SELECT deleted_at IS NULL FROM public.investment_transactions WHERE source_expense_item_id = :'pf_exp')
            AND NOT EXISTS (SELECT 1 FROM public.cash_movements WHERE source_entity_type = 'EXPENSE' AND source_entity_id = :'pf_exp' AND deleted_at IS NULL)
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินฝาก THB')) = :pf_thb0 - 650,
            'เปลี่ยนกลับมาจ่ายจากพอร์ต → รายการในพอร์ตกลับมา · เงินออกจากธนาคารหาย');
SELECT t.ok((SELECT round(sum(share_percent), 4) FROM public.v_expense_by_person WHERE expense_item_id = :'pf_exp') = 100,
            'ค่าใช้จ่ายจากพอร์ต: แบ่งรายบุคคลตามเจ้าของพอร์ต ครบ 100%');
SELECT t.fails($$SELECT public.add_expense(jsonb_build_object('date', current_date, 'description', 'x', 'amount', 1, 'expense_category', 'ทั่วไป',
  'paid_from_asset_id', t.a('KBank ออมทรัพย์'), 'paid_from_cash_holding_id', t.h('เงินฝาก THB')))$$, 'ทางเดียว', 'ค่าใช้จ่าย: เลือกจ่ายจากได้ทางเดียว');
UPDATE public.expense_items SET deleted_at = now() WHERE id = :'pf_exp';
SELECT t.ok((SELECT deleted_at IS NOT NULL FROM public.investment_transactions WHERE source_expense_item_id = :'pf_exp')
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินฝาก THB')) = :pf_thb0,
            'ลบค่าใช้จ่าย → รายการในพอร์ตถูกลบตาม · เงินฝากกลับเท่าเดิม');
-- จ่ายบัตรจากพอร์ต
SELECT (SELECT current_balance FROM public.v_card_balances WHERE card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '4455')) AS card0 \gset
SELECT public.pay_credit_card(jsonb_build_object('card_id', (SELECT id FROM public.credit_cards WHERE card_last4 = '4455'),
  'cash_holding_id', t.h('เงินฝาก THB'), 'date', current_date, 'amount', 300)) AS pf_card_pay \gset
SELECT t.ok((SELECT transaction_type = 'PAYMENT' AND to_credit_card_id IS NOT NULL AND cash_holding_id = t.h('เงินฝาก THB')
               FROM public.investment_transactions WHERE id = :'pf_card_pay')
            AND (SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินฝาก THB')) = :pf_thb0 - 300
            AND (SELECT current_balance FROM public.v_card_balances WHERE card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '4455'))
                = greatest(:card0 - 300, 0),
            'จ่ายบัตรจากพอร์ต: เงินฝากในพอร์ตลด 300 · ยอดบัตรปัจจุบันลด 300');
SELECT t.fails($$SELECT public.pay_credit_card(jsonb_build_object('card_id', (SELECT id FROM public.credit_cards WHERE card_last4 = '4455'),
  'cash_holding_id', t.h('เงินสด USD บัญชี A'), 'date', current_date, 'amount', 1))$$, 'INVALID_CURRENCY', 'จ่ายบัตรจากพอร์ตคนละสกุลไม่ได้');
SELECT t.fails($$SELECT public.pay_credit_card(jsonb_build_object('card_id', (SELECT id FROM public.credit_cards WHERE card_last4 = '4455'),
  'cash_holding_id', t.h('เงินฝาก THB'), 'bank_asset_id', t.a('KBank ออมทรัพย์'), 'date', current_date, 'amount', 1))$$, 'ทางเดียว', 'จ่ายบัตร: เลือกบัญชีที่จ่ายได้ทางเดียว');
UPDATE public.investment_transactions SET deleted_at = now() WHERE id = :'pf_card_pay';
SELECT t.ok((SELECT current_value FROM public.investment_holdings WHERE id = t.h('เงินฝาก THB')) = :pf_thb0
            AND (SELECT current_balance FROM public.v_card_balances WHERE card_id = (SELECT id FROM public.credit_cards WHERE card_last4 = '4455')) = :card0,
            'ลบการจ่ายบัตรจากพอร์ต → เงินฝากและยอดบัตรกลับเท่าเดิม');
-- ตัดบัตรอัตโนมัติจากพอร์ต (สกุลเดียวกับบัตร · ผูกได้ทางเดียว)
UPDATE public.credit_cards SET autopay_cash_holding_id = t.h('เงินฝาก THB'), autopay_mode = 'FULL' WHERE card_last4 = '4455';
SELECT t.ok((SELECT autopay_cash_holding_id = t.h('เงินฝาก THB') FROM public.credit_cards WHERE card_last4 = '4455'), 'ตั้งบัตรตัดอัตโนมัติจากบัญชีเงินฝากในพอร์ตได้');
SELECT t.fails($$UPDATE public.credit_cards SET autopay_asset_id = t.a('KBank ออมทรัพย์') WHERE card_last4 = '4455'$$, 'cc_autopay', 'ตัดอัตโนมัติผูกได้ทางเดียว (ธนาคาร หรือ พอร์ต)');
SELECT t.fails($$UPDATE public.credit_cards SET autopay_cash_holding_id = t.h('เงินสด USD บัญชี A') WHERE card_last4 = '4455'$$, 'INVALID_CURRENCY', 'ตัดอัตโนมัติจากพอร์ตต้องสกุลเดียวกับบัตร');
UPDATE public.credit_cards SET autopay_cash_holding_id = NULL, autopay_mode = NULL WHERE card_last4 = '4455';
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000c');
SELECT public.add_expense(jsonb_build_object('date', current_date, 'description', 'ค่าใช้จ่ายพอร์ต (ผู้บันทึก)', 'amount', 50,
  'expense_category', 'ทั่วไป', 'paid_from_cash_holding_id', t.h('เงินฝาก THB'))) AS pf_exp_c \gset
SELECT t.ok((SELECT count(*) FROM public.investment_transactions WHERE source_expense_item_id = :'pf_exp_c' AND deleted_at IS NULL) = 1,
            'CONTRIBUTOR บันทึกค่าใช้จ่ายจากพอร์ตได้ (ระบบสร้างรายการในพอร์ตให้)');
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000e');
UPDATE public.expense_items SET deleted_at = now() WHERE id = :'pf_exp_c';
SELECT t.ok((SELECT deleted_at IS NOT NULL FROM public.investment_transactions WHERE source_expense_item_id = :'pf_exp_c'), 'ลบค่าใช้จ่ายของผู้บันทึก → รายการในพอร์ตถูกลบตาม');
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT t.fails($$SELECT public.pay_credit_card(jsonb_build_object('card_id', (SELECT id FROM public.credit_cards WHERE card_last4 = '4455'),
  'cash_holding_id', t.h('เงินฝาก THB'), 'date', current_date, 'amount', 1))$$, 'PERMISSION|สิทธิ์|role', 'VIEWER จ่ายบัตรจากพอร์ตไม่ได้');
RESET ROLE;

\echo '== 14. Views'
SET ROLE authenticated; SELECT t.login('00000000-0000-0000-0000-00000000000f');
SELECT person_name, round(total_assets) AS assets, round(total_liabilities) AS liabilities, round(net_worth) AS net_worth
  FROM public.v_net_worth_by_person ORDER BY person_name NULLS LAST;
SELECT liability_source, name, amount, derived_status FROM public.v_liabilities_all ORDER BY 1, 2;
SELECT name, to_char(income_period, 'YYYY-MM') AS period, status FROM public.v_expected_income ORDER BY 1, 2;
SELECT name, confirmed_balance, calculated_balance, balance_label FROM public.v_bank_balance_current;
\echo 'ALL SCENARIO TESTS PASSED'
