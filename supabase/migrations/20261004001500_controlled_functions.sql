-- =====================================================================
-- 1500 Controlled Functions (RPC) — Section 6.5
--   SECURITY DEFINER + ตรวจ Role ทุกครั้ง + search_path = '' + Audit ใน Transaction เดียว
--   server_* = เรียกได้เฉพาะ service_role (Edge Function / Scheduled Job)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Encryption key จาก Supabase Vault (Section 10, 46) — ห้ามเก็บ Key ในตาราง
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.bank_key() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text;
BEGIN
  SELECT s.decrypted_secret INTO k FROM vault.decrypted_secrets s WHERE s.name = 'fwv_bank_account_key';
  IF k IS NULL OR length(k) < 16 THEN
    RAISE EXCEPTION 'CONFIG: ยังไม่ได้ตั้ง Vault secret fwv_bank_account_key' USING ERRCODE = '55000';
  END IF;
  RETURN k;
END $$;

-- =====================================================================
-- Bank account number (Section 10)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_bank_account_no(p_bank_account_id uuid, p_account_no text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid; b public.bank_accounts; v_digits text;
BEGIN
  v_uid := private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT * INTO b FROM public.bank_accounts WHERE id = p_bank_account_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัญชี' USING ERRCODE = 'P0002'; END IF;
  IF private.app_role() = 'CONTRIBUTOR'
     AND NOT (b.created_by = v_uid AND b.created_at >= now() - interval '24 hours') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: CONTRIBUTOR แก้ได้เฉพาะบัญชีที่ตนสร้างภายใน 24 ชั่วโมง' USING ERRCODE = '42501';
  END IF;
  v_digits := regexp_replace(coalesce(p_account_no, ''), '[\s-]', '', 'g');
  IF v_digits !~ '^[0-9]{6,20}$' THEN
    RAISE EXCEPTION 'INVALID: เลขบัญชีต้องเป็นตัวเลข 6–20 หลัก' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.bank_account_secrets(bank_account_id, account_no_encrypted)
  VALUES (b.id, extensions.pgp_sym_encrypt(v_digits, private.bank_key()))
  ON CONFLICT (bank_account_id) DO UPDATE SET account_no_encrypted = EXCLUDED.account_no_encrypted, deleted_at = NULL;
  UPDATE public.bank_accounts SET account_no_last4 = right(v_digits, 4) WHERE id = b.id;
  PERFORM private.write_audit('SET_SENSITIVE', 'bank_accounts', b.id::text,
          jsonb_build_object('field', 'account_no', 'last4', right(v_digits, 4)), NULL, 'account_no');
  RETURN right(v_digits, 4);
END $$;

CREATE OR REPLACE FUNCTION public.reveal_bank_account(p_bank_account_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_plain text;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT extensions.pgp_sym_decrypt(s.account_no_encrypted, private.bank_key()) INTO v_plain
    FROM public.bank_account_secrets s JOIN public.bank_accounts b ON b.id = s.bank_account_id
   WHERE s.bank_account_id = p_bank_account_id AND s.deleted_at IS NULL AND b.deleted_at IS NULL;
  IF v_plain IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ยังไม่ได้บันทึกเลขบัญชีเต็ม' USING ERRCODE = 'P0002'; END IF;
  PERFORM private.write_audit('VIEW_SENSITIVE', 'bank_accounts', p_bank_account_id::text,
          jsonb_build_object('field', 'account_no'), NULL, 'account_no');
  RETURN v_plain;
END $$;

-- =====================================================================
-- Go-live (Section 3, 14A)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.confirm_go_live()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid; f public.families; v_missing jsonb; v_warn jsonb;
BEGIN
  v_uid := private.require_role('ADMIN');
  SELECT * INTO f FROM public.families WHERE id = private.default_family_id() FOR UPDATE;
  IF f.system_status = 'LIVE' THEN RAISE EXCEPTION 'INVALID: ระบบ LIVE แล้ว' USING ERRCODE = '22023'; END IF;
  SELECT jsonb_agg(to_jsonb(r)) FILTER (WHERE r.status = 'MISSING'),
         jsonb_agg(to_jsonb(r)) FILTER (WHERE r.status = 'WARN')
    INTO v_missing, v_warn FROM private.go_live_readiness(f.id) r;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'GO_LIVE_BLOCKED: ยังมีรายการที่ต้องแก้ % รายการ', jsonb_array_length(v_missing)
      USING ERRCODE = '22023', DETAIL = v_missing::text;
  END IF;
  UPDATE public.families SET system_status = 'LIVE', go_live_confirmed_at = now(), go_live_confirmed_by = v_uid
   WHERE id = f.id;
  PERFORM private.write_audit('CONFIRM_GO_LIVE', 'families', f.id::text,
          jsonb_build_object('go_live_date', f.go_live_date, 'warnings', coalesce(v_warn, '[]'::jsonb)), f.id);
  RETURN jsonb_build_object('status', 'LIVE', 'warnings', coalesce(v_warn, '[]'::jsonb));
END $$;

-- =====================================================================
-- Transfer Money ธนาคาร ↔ พอร์ต (Section 11) — Cash Movement เป็น Source เสมอ
-- =====================================================================
CREATE OR REPLACE FUNCTION public.transfer_money(
  p_from_asset_id uuid, p_to_asset_id uuid, p_amount numeric, p_date date,
  p_fee numeric DEFAULT 0, p_description text DEFAULT NULL, p_fee_as_expense boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_type text; v_ccy text; v_id uuid; v_pf_ccy text;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF private.is_bank_asset(p_from_asset_id) AND private.portfolio_of_asset(p_to_asset_id) IS NOT NULL THEN
    v_type := 'INVESTMENT_OUT';
  ELSIF private.portfolio_of_asset(p_from_asset_id) IS NOT NULL AND private.is_bank_asset(p_to_asset_id) THEN
    v_type := 'INVESTMENT_IN';
  ELSE
    RAISE EXCEPTION 'INVALID: Transfer Money ต้องเป็น บัญชีธนาคาร ↔ พอร์ตลงทุน' USING ERRCODE = '22023';
  END IF;
  SELECT currency INTO v_ccy FROM public.assets WHERE id = p_from_asset_id;
  SELECT currency INTO v_pf_ccy FROM public.assets WHERE id = p_to_asset_id;
  IF v_ccy <> v_pf_ccy THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีธนาคารต้องสกุลเดียวกับพอร์ต (%/%)', v_ccy, v_pf_ccy USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_asset_id,
                                    amount, currency, fee, fee_currency, description, metadata)
  VALUES (private.default_family_id(), p_date, v_type, p_from_asset_id, p_to_asset_id, p_amount, v_ccy,
          nullif(p_fee, 0), CASE WHEN coalesce(p_fee, 0) > 0 THEN v_ccy END, p_description,
          jsonb_build_object('fee_as_expense', p_fee_as_expense, 'via', 'transfer_money'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- =====================================================================
-- FCN / Holding ครบกำหนด (Section 25B ตัวอย่าง) — 1 Transaction
-- =====================================================================
CREATE OR REPLACE FUNCTION public.record_holding_maturity(
  p_holding_id uuid, p_date date, p_amount numeric, p_settle_to_asset_id uuid DEFAULT NULL,
  p_settlement_date date DEFAULT NULL, p_fee numeric DEFAULT NULL, p_tax numeric DEFAULT NULL,
  p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.investment_holdings; v_id uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT * INTO h FROM public.investment_holdings WHERE id = p_holding_id AND deleted_at IS NULL;
  IF NOT FOUND OR h.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'INVALID: Holding ไม่ได้อยู่ในสถานะ ACTIVE' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.investment_transactions(portfolio_id, holding_id, transaction_date, settlement_date,
              transaction_type, quantity, amount, currency, settle_to_asset_id, fee, tax, notes)
  VALUES (h.portfolio_id, h.id, p_date, p_settlement_date, 'MATURITY', h.quantity, p_amount, h.currency,
          p_settle_to_asset_id, p_fee, p_tax, p_notes)
  RETURNING id INTO v_id;                       -- Trigger: status = MATURED + INVESTMENT_IN (ถ้าเข้าบัญชี)
  RETURN v_id;
END $$;

-- =====================================================================
-- รับชำระเงินกู้ = เงินต้น (Movement) + ดอกเบี้ย (Income) ผูก movement_group_id (Section 19)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.receive_loan_payment(
  p_loan_asset_id uuid, p_bank_asset_id uuid, p_date date, p_principal numeric,
  p_interest numeric DEFAULT 0, p_interest_tax numeric DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_group uuid := gen_random_uuid(); v_ccy text; v_income uuid; v_family uuid := private.default_family_id();
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT currency INTO v_ccy FROM public.assets WHERE id = p_loan_asset_id AND asset_type = 'LOAN_RECEIVABLE';
  IF v_ccy IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบเงินให้กู้' USING ERRCODE = '22023'; END IF;
  IF coalesce(p_principal, 0) <= 0 AND coalesce(p_interest, 0) <= 0 THEN
    RAISE EXCEPTION 'INVALID: ต้องมีเงินต้นหรือดอกเบี้ย' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_principal, 0) > 0 THEN
    INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_asset_id,
                                      amount, currency, movement_group_id, description, notes)
    VALUES (v_family, p_date, 'LOAN_PRINCIPAL_RECEIPT', p_loan_asset_id, p_bank_asset_id, p_principal, v_ccy,
            v_group, 'รับชำระเงินต้น', p_notes);
  END IF;
  IF coalesce(p_interest, 0) > 0 THEN
    INSERT INTO public.income_transactions(family_id, asset_id, received_to_asset_id, date, income_type,
                                           amount, tax, currency, notes)
    VALUES (v_family, p_loan_asset_id, p_bank_asset_id, p_date, 'LOAN_INTEREST', p_interest, p_interest_tax, v_ccy, p_notes)
    RETURNING id INTO v_income;
    UPDATE public.cash_movements SET movement_group_id = v_group
     WHERE is_derived AND source_entity_type = 'INCOME' AND source_entity_id = v_income;
  END IF;
  RETURN v_group;
END $$;

-- =====================================================================
-- คืน / หักเงินประกันเช่า (Section 22 Settle)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.settle_security_deposit(
  p_lease_id uuid, p_settled_date date, p_refunded_amount numeric,
  p_refund_from_asset_id uuid DEFAULT NULL, p_deduction_reason text DEFAULT NULL,
  p_record_deduction_as_income boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l public.property_leases; v_deduct numeric; v_mv uuid; v_inc uuid; v_prop_asset uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO l FROM public.property_leases WHERE id = p_lease_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR coalesce(l.security_deposit, 0) = 0 THEN
    RAISE EXCEPTION 'INVALID: สัญญานี้ไม่มีเงินประกัน' USING ERRCODE = '22023';
  END IF;
  IF l.deposit_settled_date IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID: เงินประกันของสัญญานี้ Settle แล้ว' USING ERRCODE = '22023';
  END IF;
  IF p_refunded_amount < 0 OR p_refunded_amount > l.security_deposit THEN
    RAISE EXCEPTION 'INVALID: ยอดคืนต้องอยู่ระหว่าง 0 ถึง %', l.security_deposit USING ERRCODE = '22023';
  END IF;
  v_deduct := l.security_deposit - p_refunded_amount;
  IF v_deduct > 0 AND length(trim(coalesce(p_deduction_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: ส่วนที่หักต้องระบุเหตุผล' USING ERRCODE = '22023';
  END IF;
  IF p_refunded_amount > 0 THEN
    IF p_refund_from_asset_id IS NULL THEN
      RAISE EXCEPTION 'INVALID: ต้องระบุบัญชีที่จ่ายคืน' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, related_lease_id,
                                      amount, currency, description)
    VALUES (private.default_family_id(), p_settled_date, 'SECURITY_DEPOSIT_OUT', p_refund_from_asset_id, l.id,
            p_refunded_amount, l.deposit_currency, 'คืนเงินประกัน · ' || l.tenant_name)
    RETURNING id INTO v_mv;
  END IF;
  UPDATE public.property_leases SET deposit_settled_date = p_settled_date, deposit_settlement_type = 'REFUNDED',
         deposit_refunded_amount = p_refunded_amount,
         notes = concat_ws(E'\n', notes, CASE WHEN v_deduct > 0 THEN 'หักเงินประกัน: ' || p_deduction_reason END)
   WHERE id = l.id;
  IF v_deduct > 0 AND p_record_deduction_as_income THEN
    SELECT pd.asset_id INTO v_prop_asset FROM public.property_details pd WHERE pd.id = l.property_id;
    INSERT INTO public.income_transactions(family_id, asset_id, lease_id, date, income_type, amount, currency, notes)
    VALUES (private.default_family_id(), v_prop_asset, l.id, p_settled_date, 'OTHER', v_deduct, l.deposit_currency,
            'หักจากเงินประกัน: ' || p_deduction_reason)
    RETURNING id INTO v_inc;                    -- ไม่มี Cash Movement ใหม่ (เงินอยู่ในบัญชีแล้ว)
  END IF;
  RETURN jsonb_build_object('movement_id', v_mv, 'income_id', v_inc, 'deducted', v_deduct,
                            'warning', CASE WHEN v_deduct > 0 AND NOT p_record_deduction_as_income
                                            THEN 'ส่วนที่หักไม่ได้บันทึกเป็นรายได้: Net Worth เพิ่มขึ้นเท่าส่วนที่หัก' END);
END $$;

-- =====================================================================
-- Update Balance ระหว่างเดือน (Section 25C)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.update_bank_balance(
  p_asset_id uuid, p_valuation_date date, p_value numeric, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_calc numeric; v_id uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF NOT private.is_bank_asset(p_asset_id) THEN
    RAISE EXCEPTION 'INVALID: ไม่ใช่บัญชีธนาคาร' USING ERRCODE = '22023';
  END IF;
  v_calc := private.bank_calculated_balance(p_asset_id, p_valuation_date);   -- ณ วันที่ของยอด (ไม่ใช่วันนี้)
  INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source,
                                      unexplained_difference, notes)
  VALUES (p_asset_id, p_valuation_date, p_value, 'STATEMENT', 'BALANCE_UPDATE',
          CASE WHEN v_calc IS NOT NULL THEN p_value - v_calc END, p_notes)
  RETURNING id INTO v_id;                       -- ไม่สร้าง Expense / Movement อัตโนมัติ
  RETURN v_id;
END $$;

-- =====================================================================
-- Bank Reconciliation (Section 25D)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.prepare_bank_reconciliation(p_asset_id uuid, p_month date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m0 date := date_trunc('month', p_month)::date; d date := private.month_end(p_month);
  v_open public.asset_valuations; br public.bank_reconciliations; e record; v_ccy text; v_id uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF NOT private.is_bank_asset(p_asset_id) THEN RAISE EXCEPTION 'INVALID: ไม่ใช่บัญชีธนาคาร' USING ERRCODE = '22023'; END IF;
  SELECT currency INTO v_ccy FROM public.assets WHERE id = p_asset_id;

  -- ยอดต้นเดือน = ยอดยืนยันสิ้นเดือนก่อน → ยอดยืนยันล่าสุดก่อนเดือนนี้ → ยอดแรกของบัญชีในเดือนนี้
  SELECT v.* INTO v_open FROM public.bank_reconciliations p
    JOIN public.asset_valuations v ON v.id = p.closing_valuation_id
   WHERE p.bank_asset_id = p_asset_id AND p.year_month = (m0 - interval '1 month')::date
     AND p.deleted_at IS NULL AND p.status <> 'OPEN';
  IF v_open.id IS NULL THEN v_open := private.latest_asset_valuation(p_asset_id, m0 - 1); END IF;
  IF v_open.id IS NULL THEN
    SELECT v.* INTO v_open FROM public.asset_valuations v
     WHERE v.asset_id = p_asset_id AND v.deleted_at IS NULL AND v.valuation_date BETWEEN m0 AND d
     ORDER BY v.valuation_date, v.created_at LIMIT 1;
  END IF;
  IF v_open.id IS NULL THEN RAISE EXCEPTION 'INVALID: บัญชีนี้ยังไม่มียอดยืนยัน' USING ERRCODE = '22023'; END IF;
  SELECT * INTO e FROM private.bank_movement_effects(p_asset_id, v_open.valuation_date, d);

  SELECT * INTO br FROM public.bank_reconciliations
   WHERE bank_asset_id = p_asset_id AND year_month = m0 AND deleted_at IS NULL FOR UPDATE;
  IF br.id IS NULL THEN
    INSERT INTO public.bank_reconciliations(bank_asset_id, year_month, currency, opening_valuation_id, opening_balance,
                known_inflows, known_outflows, calculated_closing)
    VALUES (p_asset_id, m0, v_ccy, v_open.id, v_open.value, e.inflow, e.outflow, v_open.value + e.inflow - e.outflow)
    RETURNING id INTO v_id;
  ELSIF br.status = 'OPEN' THEN
    UPDATE public.bank_reconciliations SET opening_valuation_id = v_open.id, opening_balance = v_open.value,
           known_inflows = e.inflow, known_outflows = e.outflow,
           calculated_closing = v_open.value + e.inflow - e.outflow
     WHERE id = br.id;
    v_id := br.id;
  ELSE
    v_id := br.id;                               -- ยืนยันแล้ว: ไม่คำนวณใหม่
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_bank_reconciliation(
  p_reconciliation_id uuid, p_actual_closing numeric, p_actual_closing_date date DEFAULT NULL,
  p_rounding_adjustment numeric DEFAULT 0, p_difference_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid; br public.bank_reconciliations; v_diff numeric; v_val uuid; v_date date;
BEGIN
  v_uid := private.require_role('ADMIN','EDITOR');
  SELECT * INTO br FROM public.bank_reconciliations WHERE id = p_reconciliation_id AND deleted_at IS NULL;
  IF NOT FOUND OR br.status <> 'OPEN' THEN RAISE EXCEPTION 'INVALID: ไม่พบรายการกระทบยอดที่ OPEN' USING ERRCODE = '22023'; END IF;
  PERFORM public.prepare_bank_reconciliation(br.bank_asset_id, br.year_month);      -- รวม Movement ล่าสุด
  SELECT * INTO br FROM public.bank_reconciliations WHERE id = p_reconciliation_id;
  v_date := coalesce(p_actual_closing_date, private.month_end(br.year_month));
  v_diff := p_actual_closing - (br.calculated_closing + coalesce(p_rounding_adjustment, 0));
  IF v_diff <> 0 AND length(trim(coalesce(p_difference_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'RECON_DIFFERENCE: ผลต่าง % ต้องเพิ่มรายการที่ขาด หรือยืนยันพร้อมเหตุผล', v_diff USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source,
                                      unexplained_difference, notes)
  VALUES (br.bank_asset_id, v_date, p_actual_closing, 'STATEMENT', 'RECONCILIATION',
          nullif(v_diff, 0), 'กระทบยอด ' || to_char(br.year_month, 'YYYY-MM'))
  RETURNING id INTO v_val;
  UPDATE public.bank_reconciliations SET actual_closing = p_actual_closing, actual_closing_date = v_date,
         rounding_adjustment = coalesce(p_rounding_adjustment, 0), difference = v_diff,
         status = CASE WHEN v_diff = 0 THEN 'RECONCILED' ELSE 'CONFIRMED_WITH_DIFFERENCE' END,
         difference_reason = CASE WHEN v_diff = 0 THEN NULL ELSE p_difference_reason END,
         closing_valuation_id = v_val, confirmed_at = now(), confirmed_by = v_uid
   WHERE id = br.id;
  RETURN v_val;
END $$;

-- คำนวณผลต่างใหม่เมื่อ CONTRIBUTOR กรอก actual_closing เอง (ยังไม่ยืนยัน)
CREATE OR REPLACE FUNCTION private.tg_recon_difference() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.difference := CASE WHEN NEW.actual_closing IS NULL THEN NULL
                         ELSE NEW.actual_closing - (NEW.calculated_closing + NEW.rounding_adjustment) END;
  RETURN NEW;
END $$;
CREATE TRIGGER t50_difference BEFORE INSERT OR UPDATE ON public.bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION private.tg_recon_difference();

-- =====================================================================
-- Month Closing: Finalize / Reopen / PDF (Section 33–38)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.finalize_month(p_month date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid; v_family uuid := private.default_family_id();
  m0 date := date_trunc('month', p_month)::date; d date := private.month_end(p_month);
  s public.net_worth_snapshots; v_blocked jsonb; v_warnings jsonb; v_fx jsonb; t record; v_chk numeric;
BEGIN
  v_uid := private.require_role('ADMIN','EDITOR');
  SELECT jsonb_agg(c) FILTER (WHERE c.status = 'BLOCKED'),
         jsonb_agg(c) FILTER (WHERE c.status = 'REVIEW')
    INTO v_blocked, v_warnings FROM public.month_closing_checks(m0) c;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'CLOSING_BLOCKED: ยังมีหมวดที่ BLOCKED' USING ERRCODE = '22023', DETAIL = v_blocked::text;
  END IF;

  SELECT * INTO s FROM public.net_worth_snapshots
   WHERE family_id = v_family AND snapshot_month = m0 AND deleted_at IS NULL FOR UPDATE;
  IF s.id IS NULL THEN
    INSERT INTO public.net_worth_snapshots(family_id, snapshot_month, snapshot_date, status)
    VALUES (v_family, m0, d, 'DRAFT') RETURNING * INTO s;
  ELSIF s.status = 'FINAL' THEN
    RAISE EXCEPTION 'INVALID: เดือนนี้ FINAL แล้ว' USING ERRCODE = '22023';
  END IF;

  -- สร้าง Items ใหม่ทั้งหมดทุกครั้ง (Section 36 Rule: Finalize)
  DELETE FROM public.net_worth_snapshot_lines WHERE snapshot_id = s.id;
  DELETE FROM public.net_worth_snapshot_items WHERE snapshot_id = s.id;
  INSERT INTO public.net_worth_snapshot_items(snapshot_id, item_type, asset_id, liability_id, credit_card_id, lease_id,
              person_id, item_name, item_group, item_subtype, value, currency, value_date, is_carried_forward,
              fx_rate, base_value, ownership_percent, created_by)
  SELECT s.id, n.item_type, n.asset_id, n.liability_id, n.credit_card_id, n.lease_id, n.person_id, n.item_name,
         n.item_group, n.item_subtype, n.value, n.currency, n.value_date, n.is_carried_forward, n.fx_rate,
         n.base_value, n.ownership_percent, v_uid
    FROM private.net_worth_items(v_family, d, true) n;

  IF EXISTS (SELECT 1 FROM public.net_worth_snapshot_items WHERE snapshot_id = s.id AND base_value IS NULL) THEN
    RAISE EXCEPTION 'CLOSING_BLOCKED: มีรายการที่แปลงเป็น THB ไม่ได้ (ไม่มี FX)' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.net_worth_snapshot_lines(snapshot_id, person_id, total_assets, total_liabilities, net_worth, created_by)
  SELECT s.id, i.person_id,
         coalesce(sum(i.base_value) FILTER (WHERE i.item_type = 'ASSET'), 0),
         coalesce(sum(i.base_value) FILTER (WHERE i.item_type = 'LIABILITY'), 0),
         coalesce(sum(i.base_value) FILTER (WHERE i.item_type = 'ASSET'), 0)
           - coalesce(sum(i.base_value) FILTER (WHERE i.item_type = 'LIABILITY'), 0), v_uid
    FROM public.net_worth_snapshot_items i WHERE i.snapshot_id = s.id AND i.person_id IS NOT NULL
   GROUP BY i.person_id;

  SELECT
    coalesce(sum(base_value) FILTER (WHERE item_group = 'FINANCIAL'), 0)   AS fin,
    coalesce(sum(base_value) FILTER (WHERE item_group = 'INVESTMENT'), 0)  AS inv,
    coalesce(sum(base_value) FILTER (WHERE item_group = 'PROPERTY'), 0)    AS prop,
    coalesce(sum(base_value) FILTER (WHERE item_group = 'ALTERNATIVE'), 0) AS alt,
    coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET' AND person_id IS NULL), 0)     AS un_a,
    coalesce(sum(base_value) FILTER (WHERE item_type = 'LIABILITY'), 0)                       AS liab,
    coalesce(sum(base_value) FILTER (WHERE item_type = 'LIABILITY' AND person_id IS NULL), 0) AS un_l
    INTO t FROM public.net_worth_snapshot_items WHERE snapshot_id = s.id;

  -- Reconcile: SUM(Person Lines) + Unallocated = Family Total
  SELECT coalesce(sum(net_worth), 0) INTO v_chk FROM public.net_worth_snapshot_lines WHERE snapshot_id = s.id;
  IF v_chk + t.un_a - t.un_l <> t.fin + t.inv + t.prop + t.alt - t.liab THEN
    RAISE EXCEPTION 'RECONCILE_FAILED: ยอดรายบุคคล + Unallocated ไม่เท่ายอดครอบครัว' USING ERRCODE = 'XX000';
  END IF;

  SELECT jsonb_object_agg(x.currency, (private.fx_rate_row(x.currency, d)).rate_date) INTO v_fx
    FROM (SELECT DISTINCT currency FROM public.net_worth_snapshot_items WHERE snapshot_id = s.id AND currency <> 'THB') x;

  UPDATE public.net_worth_snapshots SET
    financial_assets = t.fin, investments = t.inv, property_assets = t.prop, alternative_assets = t.alt,
    total_assets = t.fin + t.inv + t.prop + t.alt, unallocated_assets = t.un_a,
    total_liabilities = t.liab, unallocated_liabilities = t.un_l,
    net_worth = t.fin + t.inv + t.prop + t.alt - t.liab,
    status = 'FINAL', finalized_at = now(), finalized_by = v_uid,
    version = CASE WHEN s.finalized_at IS NOT NULL THEN s.version + 1 ELSE s.version END,
    closing_warnings = v_warnings, fx_rate_dates = v_fx
  WHERE id = s.id;

  PERFORM private.write_audit('FINALIZE_MONTH', 'net_worth_snapshots', s.id::text,
    jsonb_build_object('month', m0, 'net_worth', t.fin + t.inv + t.prop + t.alt - t.liab,
                       'version', CASE WHEN s.finalized_at IS NOT NULL THEN s.version + 1 ELSE s.version END,
                       'warnings', coalesce(v_warnings, '[]'::jsonb)), v_family);
  RETURN s.id;
END $$;

CREATE OR REPLACE FUNCTION public.reopen_month(p_month date, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_family uuid := private.default_family_id(); m0 date := date_trunc('month', p_month)::date;
        s public.net_worth_snapshots;
BEGIN
  PERFORM private.require_role('ADMIN');
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: Reopen ต้องระบุเหตุผล' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.net_worth_snapshots
   WHERE family_id = v_family AND snapshot_month = m0 AND deleted_at IS NULL AND status = 'FINAL' FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'INVALID: เดือนนี้ไม่ได้ FINAL' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.net_worth_snapshots x WHERE x.family_id = v_family AND x.status = 'FINAL'
              AND x.deleted_at IS NULL AND x.snapshot_month > m0) THEN
    RAISE EXCEPTION 'INVALID: Reopen ได้เฉพาะ FINAL เดือนล่าสุด (ไล่ย้อนทีละเดือน)' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('fwv.reopening', 'on', true);
  UPDATE public.net_worth_snapshots SET status = 'DRAFT' WHERE id = s.id;
  PERFORM set_config('fwv.reopening', 'off', true);
  PERFORM private.write_audit('REOPEN_MONTH', 'net_worth_snapshots', s.id::text,
          jsonb_build_object('month', m0, 'version', s.version, 'reason', p_reason), v_family);
  RETURN s.id;
END $$;

-- หลัง Generate PDF + Upload Drive (Edge Function) → ผูกเอกสาร / ตั้ง SUPERSEDED ฉบับเดิม (Section 38)
CREATE OR REPLACE FUNCTION public.server_attach_month_pdf(p_snapshot_id uuid, p_document_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.net_worth_snapshots;
BEGIN
  SELECT * INTO s FROM public.net_worth_snapshots WHERE id = p_snapshot_id AND status = 'FINAL';
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: Snapshot ต้อง FINAL' USING ERRCODE = '22023'; END IF;
  IF s.pdf_document_id IS NOT NULL AND s.pdf_document_id <> p_document_id THEN
    UPDATE public.documents SET version_status = 'SUPERSEDED' WHERE id = s.pdf_document_id;
    UPDATE public.documents SET supersedes_document_id = s.pdf_document_id WHERE id = p_document_id;
  END IF;
  UPDATE public.net_worth_snapshots SET pdf_document_id = p_document_id WHERE id = s.id;
END $$;

-- =====================================================================
-- Users (Section 5)
-- =====================================================================
CREATE OR REPLACE FUNCTION private.active_admin_count(p_family uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*)::int FROM public.app_users WHERE family_id = p_family AND role = 'ADMIN' AND status = 'ACTIVE'
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_app_user_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.app_users;
BEGIN
  PERFORM private.require_role('ADMIN');
  SELECT * INTO u FROM public.app_users WHERE id = p_app_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF u.role = 'ADMIN' AND p_role <> 'ADMIN' AND u.status = 'ACTIVE' AND private.active_admin_count(u.family_id) <= 1 THEN
    RAISE EXCEPTION 'INVALID: ต้องมี ADMIN ที่ ACTIVE อย่างน้อย 1 คน' USING ERRCODE = '22023';
  END IF;
  UPDATE public.app_users SET role = p_role WHERE id = u.id;
  PERFORM private.write_audit('CHANGE_ROLE', 'app_users', u.id::text,
          jsonb_build_object('from', u.role, 'to', p_role), u.family_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_user_status(p_app_user_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid; u public.app_users;
BEGIN
  v_uid := private.require_role('ADMIN');
  IF p_status NOT IN ('ACTIVE','DISABLED') THEN RAISE EXCEPTION 'INVALID: status' USING ERRCODE = '22023'; END IF;
  SELECT * INTO u FROM public.app_users WHERE id = p_app_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF p_status = 'DISABLED' AND u.role = 'ADMIN' AND u.status = 'ACTIVE' AND private.active_admin_count(u.family_id) <= 1 THEN
    RAISE EXCEPTION 'INVALID: ปิด ADMIN คนสุดท้ายไม่ได้' USING ERRCODE = '22023';
  END IF;
  UPDATE public.app_users SET status = p_status,
         disabled_at = CASE WHEN p_status = 'DISABLED' THEN now() END,
         disabled_by = CASE WHEN p_status = 'DISABLED' THEN v_uid END
   WHERE id = u.id;
  PERFORM private.write_audit(CASE WHEN p_status = 'DISABLED' THEN 'DISABLE_USER' ELSE 'ENABLE_USER' END,
          'app_users', u.id::text, jsonb_build_object('from', u.status, 'to', p_status), u.family_id);
END $$;

-- เรียกหลัง Login สำเร็จ: INVITED → ACTIVE, บันทึก LOGIN; DISABLED ถูกปฏิเสธ
CREATE OR REPLACE FUNCTION public.record_login()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.app_users;
BEGIN
  SELECT * INTO u FROM public.app_users WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR u.status = 'DISABLED' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: บัญชีนี้ไม่มีสิทธิ์ใช้งาน' USING ERRCODE = '42501';
  END IF;
  UPDATE public.app_users SET status = 'ACTIVE', last_login_at = now() WHERE id = u.id;
  PERFORM private.write_audit('LOGIN', 'app_users', u.id::text, NULL, u.family_id, NULL, u.id);
  RETURN u.role;
END $$;

-- Edge Function (service_role) หลังส่ง Invite ผ่าน Supabase Auth Admin API
CREATE OR REPLACE FUNCTION public.server_register_invited_user(
  p_auth_user_id uuid, p_email text, p_role text, p_invited_by uuid, p_person_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_family uuid := private.default_family_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE id = p_invited_by AND role = 'ADMIN' AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: ผู้เชิญต้องเป็น ADMIN' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.app_users(auth_user_id, family_id, person_id, email, role, status, invited_by, invited_at, created_by)
  VALUES (p_auth_user_id, v_family, p_person_id, lower(trim(p_email)), p_role, 'INVITED', p_invited_by, now(), p_invited_by)
  RETURNING id INTO v_id;
  PERFORM private.write_audit('INVITE_USER', 'app_users', v_id::text,
          jsonb_build_object('email', lower(trim(p_email)), 'role', p_role), v_family, NULL, p_invited_by);
  RETURN v_id;
END $$;

-- ตั้งต้นระบบครั้งแรก (ครอบครัว + ADMIN คนแรก) — ใช้ได้ครั้งเดียว
CREATE OR REPLACE FUNCTION public.server_bootstrap_family(
  p_family_name text, p_go_live_date date, p_admin_auth_user_id uuid, p_admin_email text,
  p_admin_person_name text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_family uuid; v_person uuid; v_user uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.families) THEN
    RAISE EXCEPTION 'INVALID: มีครอบครัวในระบบแล้ว (V1 = ครอบครัวเดียว)' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.families(name, go_live_date) VALUES (p_family_name, p_go_live_date) RETURNING id INTO v_family;
  IF p_admin_person_name IS NOT NULL THEN
    INSERT INTO public.persons(family_id, name, relationship) VALUES (v_family, p_admin_person_name, 'SELF')
    RETURNING id INTO v_person;
  END IF;
  INSERT INTO public.app_users(auth_user_id, family_id, person_id, email, role, status, invited_at)
  VALUES (p_admin_auth_user_id, v_family, v_person, lower(trim(p_admin_email)), 'ADMIN', 'ACTIVE', now())
  RETURNING id INTO v_user;
  PERFORM private.write_audit('INVITE_USER', 'app_users', v_user::text,
          jsonb_build_object('bootstrap', true, 'role', 'ADMIN'), v_family);
  RETURN v_family;
END $$;

-- Server-side event (เปิด/ดาวน์โหลดเอกสาร, Export) — Section 31, 39
CREATE OR REPLACE FUNCTION public.server_log_event(
  p_app_user_id uuid, p_action text, p_entity_type text, p_entity_id text, p_metadata jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_action NOT IN ('VIEW_DOCUMENT','DOWNLOAD_DOCUMENT','EXPORT') THEN
    RAISE EXCEPTION 'INVALID: action' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE id = p_app_user_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: ผู้ใช้ไม่ ACTIVE' USING ERRCODE = '42501';
  END IF;
  PERFORM private.write_audit(p_action, p_entity_type, p_entity_id, p_metadata, NULL, NULL, p_app_user_id);
END $$;

-- FX Daily Job (Section 16): [{rate_date, currency, rate_to_thb, source_reference}]
--   ไม่ทับ Rate ที่ ADMIN Override ไว้
CREATE OR REPLACE FUNCTION public.server_upsert_fx_rates(p_rates jsonb, p_job_type text DEFAULT 'FX_FETCH')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; n int := 0; v_job bigint;
BEGIN
  INSERT INTO public.system_job_runs(job_type, result) VALUES (p_job_type, 'RUNNING') RETURNING id INTO v_job;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rates) LOOP
    INSERT INTO public.fx_rates(rate_date, currency, rate_to_thb, source, source_reference, fetched_at)
    VALUES ((r->>'rate_date')::date, upper(r->>'currency'), (r->>'rate_to_thb')::numeric, 'BOT_API',
            r->>'source_reference', now())
    ON CONFLICT (rate_date, currency, rate_type) WHERE deleted_at IS NULL
    DO UPDATE SET rate_to_thb = EXCLUDED.rate_to_thb, source_reference = EXCLUDED.source_reference,
                  fetched_at = EXCLUDED.fetched_at
          WHERE NOT public.fx_rates.is_override AND public.fx_rates.rate_to_thb IS DISTINCT FROM EXCLUDED.rate_to_thb;
    n := n + 1;
  END LOOP;
  UPDATE public.system_job_runs SET result = 'SUCCESS', finished_at = now(),
         details = jsonb_build_object('rows', n) WHERE id = v_job;
  RETURN n;
END $$;
