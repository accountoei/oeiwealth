-- =====================================================================
-- 1100 Domain calculation functions (ใช้ทั้ง Cache, View, Month Closing)
-- ทุกตัวเป็น SECURITY DEFINER + search_path = '' (Section 6.5)
-- =====================================================================

CREATE OR REPLACE FUNCTION private.is_bank_asset(p_asset uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.bank_accounts b
                  WHERE b.asset_id = p_asset AND b.deleted_at IS NULL)
$$;

CREATE OR REPLACE FUNCTION private.portfolio_of_asset(p_asset uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id FROM public.investment_portfolios p WHERE p.asset_id = p_asset AND p.deleted_at IS NULL
$$;

-- ---------------------------------------------------------------------
-- Net Cash ของ Investment Transaction (Section 13) ในสกุล p_currency
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.itx_net_cash(t public.investment_transactions, p_currency text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN t.transaction_type = 'FX_EXCHANGE' THEN
         (CASE WHEN t.currency = p_currency THEN -(t.amount + coalesce(t.fee,0)) ELSE 0 END)
       + (CASE WHEN t.counter_currency = p_currency THEN t.counter_amount ELSE 0 END)
    WHEN t.currency IS DISTINCT FROM p_currency THEN 0
    WHEN t.transaction_type = 'OPENING_BALANCE' THEN 0
    WHEN t.transaction_type = 'DEPOSIT'    THEN  t.amount
    WHEN t.transaction_type = 'WITHDRAWAL' THEN -t.amount
    WHEN t.transaction_type = 'BUY'        THEN -(t.amount + coalesce(t.fee,0))
    WHEN t.transaction_type IN ('SELL','REDEMPTION','MATURITY','DIVIDEND','INTEREST','COUPON')
                                           THEN  t.amount - coalesce(t.fee,0) - coalesce(t.tax,0)
    WHEN t.transaction_type IN ('FEE','TAX') THEN -t.amount
    WHEN t.transaction_type = 'ADJUSTMENT' THEN CASE t.direction WHEN 'IN' THEN t.amount ELSE -t.amount END
    ELSE 0 END
$$;

-- ---------------------------------------------------------------------
-- Holding position & value ณ วันที่ (NULL = ทุกรายการ / ปัจจุบัน)
--   Section 12 (มูลค่าระหว่าง Statement), 13 (Average Cost), 14 (Opening)
--   CASH Holding = ยอด Statement ล่าสุด + Net Cash ภายในพอร์ตหลังวัน Statement
--     (ไม่นับ DEPOSIT/WITHDRAWAL ที่มาจาก Cash Movement → เป็น In-transit แทน
--      และไม่นับรายการที่ชำระตรงกับบัญชีธนาคาร)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.holding_value_at(p_holding uuid, p_as_of date DEFAULT NULL)
RETURNS TABLE (quantity numeric, average_cost numeric, price numeric, value numeric,
               value_thb numeric, value_date date, has_valuation boolean, last_tx_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  h public.investment_holdings;
  t public.investment_transactions;
  v public.investment_valuations;
  v_qty numeric := 0; v_avg numeric; v_q numeric;
  v_base_date date; v_base numeric := 0; v_base_thb numeric := 0; v_adj numeric := 0;
  v_upto date := coalesce(p_as_of, 'infinity'::date);
  v_fx_date date := coalesce(p_as_of, current_date);
BEGIN
  IF NOT private.can_read() THEN RETURN; END IF;
  SELECT * INTO h FROM public.investment_holdings WHERE id = p_holding;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT max(x.transaction_date) INTO last_tx_date FROM public.investment_transactions x
   WHERE x.holding_id = p_holding AND x.deleted_at IS NULL AND x.transaction_date <= v_upto;

  SELECT * INTO v FROM public.investment_valuations x
   WHERE x.holding_id = p_holding AND x.deleted_at IS NULL AND x.valuation_date <= v_upto
   ORDER BY x.valuation_date DESC, x.created_at DESC LIMIT 1;
  has_valuation := FOUND;

  IF h.holding_type = 'CASH' THEN
    IF has_valuation THEN
      v_base := v.market_value; v_base_date := v.valuation_date;
      v_base_thb := coalesce(v.base_value, v.market_value * private.fx_rate(h.currency, v.valuation_date));
    ELSE
      SELECT x.amount, x.transaction_date, coalesce(x.cost_base_currency, x.amount * private.fx_rate(h.currency, x.transaction_date))
        INTO v_base, v_base_date, v_base_thb
        FROM public.investment_transactions x
       WHERE x.holding_id = p_holding AND x.transaction_type = 'OPENING_BALANCE'
         AND x.deleted_at IS NULL AND x.transaction_date <= v_upto
       ORDER BY x.transaction_date DESC LIMIT 1;
      v_base := coalesce(v_base, 0); v_base_thb := coalesce(v_base_thb, 0);
      v_base_date := coalesce(v_base_date, '-infinity'::date);
    END IF;

    SELECT coalesce(sum(private.itx_net_cash(x, h.currency)), 0) INTO v_adj
      FROM public.investment_transactions x
     WHERE x.portfolio_id = h.portfolio_id AND x.deleted_at IS NULL
       AND x.transaction_date > v_base_date AND x.transaction_date <= v_upto
       AND x.settle_from_asset_id IS NULL AND x.settle_to_asset_id IS NULL
       AND x.transaction_type <> 'OPENING_BALANCE'
       AND NOT (x.transaction_type IN ('DEPOSIT','WITHDRAWAL') AND x.cash_movement_id IS NOT NULL)
       AND (x.currency = h.currency OR x.counter_currency = h.currency);

    quantity := v_base + v_adj; average_cost := 1; price := 1;
    value := v_base + v_adj;
    value_thb := v_base_thb + v_adj * coalesce(private.fx_rate(h.currency, v_fx_date), 0);
    value_date := CASE WHEN has_valuation THEN v.valuation_date END;
    RETURN NEXT; RETURN;
  END IF;

  -- Security / Fund / FCN / Bond ...
  FOR t IN SELECT * FROM public.investment_transactions x
            WHERE x.holding_id = p_holding AND x.deleted_at IS NULL AND x.transaction_date <= v_upto
            ORDER BY x.transaction_date, x.created_at
  LOOP
    v_q := coalesce(t.quantity, 0);
    CASE t.transaction_type
      WHEN 'OPENING_BALANCE' THEN v_qty := v_q; v_avg := t.price;
      WHEN 'BUY' THEN
        IF v_qty + v_q > 0 THEN
          v_avg := (v_qty * coalesce(v_avg, 0) + t.amount + coalesce(t.fee, 0)) / (v_qty + v_q);
        END IF;
        v_qty := v_qty + v_q;
      WHEN 'SELL', 'REDEMPTION' THEN
        v_qty := greatest(v_qty - coalesce(t.quantity, v_qty), 0);
      WHEN 'MATURITY' THEN v_qty := 0;
      WHEN 'ADJUSTMENT' THEN
        IF t.quantity IS NOT NULL THEN
          v_qty := greatest(v_qty + CASE t.direction WHEN 'IN' THEN v_q ELSE -v_q END, 0);
        END IF;
      ELSE NULL;
    END CASE;
  END LOOP;

  quantity := v_qty; average_cost := v_avg;
  IF has_valuation THEN
    price := v.price;
    value := CASE WHEN v.price IS NOT NULL THEN v.price * v_qty
                  WHEN v.quantity > 0 THEN v.market_value * v_qty / v.quantity
                  ELSE v.market_value END;
    value_thb := value * coalesce(v.base_value / nullif(v.market_value, 0),
                                  private.fx_rate(h.currency, v.valuation_date));
    value_date := v.valuation_date;
  ELSE
    price := NULL;
    value := v_qty * coalesce(v_avg, 0);             -- ราคาทุน · รอ Statement
    value_thb := value * private.fx_rate(h.currency, v_fx_date);
    value_date := NULL;
  END IF;
  RETURN NEXT;
END $$;

-- ---------------------------------------------------------------------
-- In-transit ของพอร์ต ณ วันที่ (Section 25C) — ในสกุลของพอร์ต
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.portfolio_in_transit(p_portfolio uuid, p_as_of date DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_asset uuid; v_ccy text; v_since date; v_upto date := coalesce(p_as_of, 'infinity'::date);
  v_sum numeric;
BEGIN
  SELECT p.asset_id, a.currency INTO v_asset, v_ccy
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id WHERE p.id = p_portfolio;
  -- วัน Statement ล่าสุดของ CASH Holding สกุลพอร์ต (ไม่มี → วัน OPENING ของ CASH → วันก่อน Go-live)
  SELECT max(v.valuation_date) INTO v_since
    FROM public.investment_valuations v JOIN public.investment_holdings h ON h.id = v.holding_id
   WHERE h.portfolio_id = p_portfolio AND h.holding_type = 'CASH' AND h.currency = v_ccy
     AND v.deleted_at IS NULL AND h.deleted_at IS NULL AND v.valuation_date <= v_upto;
  IF v_since IS NULL THEN       -- ยังไม่มี Statement ของ CASH → นับจากวันตั้งต้นของ CASH Holding
    SELECT max(t.transaction_date) INTO v_since
      FROM public.investment_transactions t JOIN public.investment_holdings h ON h.id = t.holding_id
     WHERE h.portfolio_id = p_portfolio AND h.holding_type = 'CASH' AND h.currency = v_ccy
       AND t.transaction_type = 'OPENING_BALANCE' AND t.deleted_at IS NULL AND h.deleted_at IS NULL;
  END IF;
  IF v_since IS NULL THEN
    SELECT (f.go_live_date - 1) INTO v_since FROM public.assets a JOIN public.families f ON f.id = a.family_id
     WHERE a.id = v_asset;
  END IF;

  SELECT coalesce(sum(CASE WHEN m.movement_type = 'INVESTMENT_OUT' THEN m.amount ELSE -m.amount END), 0)
    INTO v_sum
    FROM public.cash_movements m
   WHERE m.deleted_at IS NULL AND NOT m.is_derived
     AND ((m.movement_type = 'INVESTMENT_OUT' AND m.to_asset_id = v_asset)
       OR (m.movement_type = 'INVESTMENT_IN'  AND m.from_asset_id = v_asset))
     AND m.movement_date > v_since AND m.movement_date <= v_upto;
  RETURN v_sum;
END $$;

-- ---------------------------------------------------------------------
-- Loan outstanding ณ วันที่ (Section 19)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.loan_outstanding_at(p_asset uuid, p_as_of date DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN l.status = 'WRITTEN_OFF' THEN 0 ELSE
         l.opening_outstanding_principal
         + coalesce((SELECT sum(m.amount) FROM public.cash_movements m
                      WHERE m.to_asset_id = p_asset AND m.movement_type = 'LOAN_DISBURSEMENT'
                        AND m.deleted_at IS NULL AND m.movement_date > l.opening_date
                        AND m.movement_date <= coalesce(p_as_of, 'infinity'::date)), 0)
         - coalesce((SELECT sum(m.amount) FROM public.cash_movements m
                      WHERE m.from_asset_id = p_asset AND m.movement_type = 'LOAN_PRINCIPAL_RECEIPT'
                        AND m.deleted_at IS NULL AND m.movement_date > l.opening_date
                        AND m.movement_date <= coalesce(p_as_of, 'infinity'::date)), 0) END
    FROM public.loan_details l WHERE l.asset_id = p_asset AND l.deleted_at IS NULL
$$;

-- ---------------------------------------------------------------------
-- ผลของ Movement ต่อยอดบัญชี (Section 25C) — 1 แถว Movement อาจกระทบ 2 บัญชี
--   ฝั่งออกจากบัญชีธนาคาร: −(amount + fee) ; ฝั่งเข้า: + amount (FX: + counter_amount)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.bank_movement_effects(p_asset uuid, p_from date, p_to date)
RETURNS TABLE (inflow numeric, outflow numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    coalesce(sum(CASE WHEN m.to_asset_id = p_asset
                      THEN CASE WHEN m.movement_type = 'FX_EXCHANGE' THEN m.counter_amount ELSE m.amount END END), 0),
    coalesce(sum(CASE WHEN m.from_asset_id = p_asset THEN m.amount + coalesce(m.fee, 0) END), 0)
  FROM public.cash_movements m
  WHERE m.deleted_at IS NULL
    AND (m.to_asset_id = p_asset OR m.from_asset_id = p_asset)
    AND m.movement_date > p_from AND m.movement_date <= p_to
$$;

-- Confirmed Balance ล่าสุด ≤ วันที่
CREATE OR REPLACE FUNCTION private.latest_asset_valuation(p_asset uuid, p_as_of date)
RETURNS public.asset_valuations
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT v.* FROM public.asset_valuations v
   WHERE v.asset_id = p_asset AND v.deleted_at IS NULL AND v.valuation_date <= p_as_of
   ORDER BY v.valuation_date DESC,
            (v.source = 'RECONCILIATION') DESC,   -- วันเดียวกัน: ยอดกระทบยอดสิ้นเดือนเป็นหลัก
            v.created_at DESC
   LIMIT 1
$$;

-- Calculated Balance ณ วันที่ = Confirmed ล่าสุด + Movement หลังวันนั้น (Section 25C)
CREATE OR REPLACE FUNCTION private.bank_calculated_balance(p_asset uuid, p_as_of date)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.asset_valuations; e record;
BEGIN
  v := private.latest_asset_valuation(p_asset, p_as_of);
  IF v.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO e FROM private.bank_movement_effects(p_asset, v.valuation_date, p_as_of);
  RETURN v.value + e.inflow - e.outflow;
END $$;

-- ---------------------------------------------------------------------
-- Cache refreshers (Section 42)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.refresh_holding(p_holding uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; h public.investment_holdings; v_status text; v_matured boolean;
BEGIN
  SELECT * INTO h FROM public.investment_holdings WHERE id = p_holding;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO r FROM private.holding_value_at(p_holding, NULL);

  v_status := h.status;
  IF h.holding_type <> 'CASH' THEN
    SELECT EXISTS (SELECT 1 FROM public.investment_transactions x WHERE x.holding_id = p_holding
                    AND x.transaction_type = 'MATURITY' AND x.deleted_at IS NULL) INTO v_matured;
    IF v_matured AND h.status = 'ACTIVE' THEN v_status := 'MATURED';
    ELSIF r.quantity = 0 AND h.status = 'ACTIVE' AND r.last_tx_date IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.investment_transactions x WHERE x.holding_id = p_holding
                       AND x.transaction_type IN ('SELL','REDEMPTION') AND x.deleted_at IS NULL) THEN
      v_status := 'SOLD';
    ELSIF r.quantity > 0 AND h.status IN ('SOLD','MATURED') AND NOT v_matured THEN
      v_status := 'ACTIVE';                       -- ลบรายการขาย/ครบกำหนดทิ้ง → กลับมาถืออยู่
    END IF;
  END IF;

  UPDATE public.investment_holdings SET
    quantity = round(coalesce(r.quantity, 0), 10),
    average_cost = round(r.average_cost, 10),
    current_price = round(r.price, 10),
    current_value = round(r.value, 4),
    current_value_date = coalesce(r.value_date, r.last_tx_date),
    status = v_status
  WHERE id = p_holding
    AND (quantity, average_cost, current_price, current_value, current_value_date, status)
        IS DISTINCT FROM (round(coalesce(r.quantity, 0), 10), round(r.average_cost, 10), round(r.price, 10),
                          round(r.value, 4), coalesce(r.value_date, r.last_tx_date), v_status);

  PERFORM private.refresh_portfolio_value(h.portfolio_id);
END $$;

-- Display Value ของพอร์ต (Section 11): แปลงทีละ Holding → สกุลพอร์ต (Cross ผ่าน THB)
CREATE OR REPLACE FUNCTION private.refresh_portfolio_value(p_portfolio uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_asset uuid; v_ccy text; v_value numeric; v_date date;
BEGIN
  SELECT p.asset_id, a.currency INTO v_asset, v_ccy
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id WHERE p.id = p_portfolio;
  IF v_asset IS NULL THEN RETURN; END IF;
  SELECT sum(CASE WHEN h.currency = v_ccy THEN h.current_value
                  ELSE h.current_value * private.fx_rate(h.currency, current_date)
                                       / private.fx_rate(v_ccy, current_date) END),
         max(h.current_value_date)
    INTO v_value, v_date
    FROM public.investment_holdings h
   WHERE h.portfolio_id = p_portfolio AND h.deleted_at IS NULL AND h.status = 'ACTIVE';
  UPDATE public.assets SET current_value = round(v_value, 4), current_value_date = v_date
   WHERE id = v_asset AND (current_value, current_value_date) IS DISTINCT FROM (round(v_value, 4), v_date);
END $$;

CREATE OR REPLACE FUNCTION private.refresh_loan(p_asset uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_out numeric; v_date date; l public.loan_details;
BEGIN
  SELECT * INTO l FROM public.loan_details WHERE asset_id = p_asset AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  v_out := private.loan_outstanding_at(p_asset, NULL);
  SELECT greatest(l.opening_date, max(m.movement_date)) INTO v_date FROM public.cash_movements m
   WHERE m.deleted_at IS NULL AND m.movement_date > l.opening_date
     AND ((m.to_asset_id = p_asset AND m.movement_type = 'LOAN_DISBURSEMENT')
       OR (m.from_asset_id = p_asset AND m.movement_type = 'LOAN_PRINCIPAL_RECEIPT'));
  v_date := coalesce(v_date, l.opening_date);
  UPDATE public.loan_details SET outstanding_principal =
           l.opening_outstanding_principal
           + coalesce((SELECT sum(m.amount) FROM public.cash_movements m WHERE m.to_asset_id = p_asset
                        AND m.movement_type = 'LOAN_DISBURSEMENT' AND m.deleted_at IS NULL
                        AND m.movement_date > l.opening_date), 0)
           - coalesce((SELECT sum(m.amount) FROM public.cash_movements m WHERE m.from_asset_id = p_asset
                        AND m.movement_type = 'LOAN_PRINCIPAL_RECEIPT' AND m.deleted_at IS NULL
                        AND m.movement_date > l.opening_date), 0)
   WHERE id = l.id;
  UPDATE public.assets SET current_value = v_out, current_value_date = v_date
   WHERE id = p_asset AND (current_value, current_value_date) IS DISTINCT FROM (v_out, v_date);
END $$;

CREATE OR REPLACE FUNCTION private.refresh_asset_value(p_asset uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.assets; v public.asset_valuations; v_pf uuid;
BEGIN
  SELECT * INTO a FROM public.assets WHERE id = p_asset;
  IF NOT FOUND THEN RETURN; END IF;
  IF a.asset_type = 'INVESTMENT_PORTFOLIO' THEN
    v_pf := private.portfolio_of_asset(p_asset);
    IF v_pf IS NOT NULL THEN PERFORM private.refresh_portfolio_value(v_pf); END IF;
    RETURN;
  ELSIF a.asset_type = 'LOAN_RECEIVABLE' THEN
    PERFORM private.refresh_loan(p_asset); RETURN;
  END IF;
  v := private.latest_asset_valuation(p_asset, 'infinity'::date);
  UPDATE public.assets SET current_value = v.value, current_value_date = v.valuation_date
   WHERE id = p_asset AND (current_value, current_value_date) IS DISTINCT FROM (v.value, v.valuation_date);
END $$;

CREATE OR REPLACE FUNCTION private.refresh_liability(p_liability uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.liability_valuations;
BEGIN
  SELECT * INTO v FROM public.liability_valuations x
   WHERE x.liability_id = p_liability AND x.deleted_at IS NULL
   ORDER BY x.valuation_date DESC, x.created_at DESC LIMIT 1;
  UPDATE public.liabilities SET outstanding_amount = v.balance, balance_date = v.valuation_date
   WHERE id = p_liability
     AND (outstanding_amount, balance_date) IS DISTINCT FROM (v.balance, v.valuation_date);
END $$;

CREATE OR REPLACE FUNCTION private.refresh_monthly_expense(p_monthly uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_total numeric;
BEGIN
  IF p_monthly IS NULL THEN RETURN; END IF;
  SELECT coalesce(sum(i.base_amount), 0) INTO v_total FROM public.expense_items i
   WHERE i.monthly_expense_id = p_monthly AND i.deleted_at IS NULL;
  UPDATE public.monthly_expenses SET total_amount = v_total
   WHERE id = p_monthly AND total_amount IS DISTINCT FROM v_total;
END $$;

CREATE OR REPLACE FUNCTION private.refresh_claim(p_claim uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_sum numeric; v_n int;
BEGIN
  IF p_claim IS NULL THEN RETURN; END IF;
  SELECT sum(r.amount), count(*) INTO v_sum, v_n FROM public.expense_reimbursements r
   WHERE r.insurance_claim_id = p_claim AND r.deleted_at IS NULL;
  IF v_n > 0 THEN
    UPDATE public.insurance_claims SET received_amount = v_sum
     WHERE id = p_claim AND received_amount IS DISTINCT FROM v_sum;
  END IF;
END $$;

-- เดือน monthly_expenses ของวันที่ (สร้างถ้ายังไม่มี — ใช้กับ Derived Expense เท่านั้น
-- จึงตั้ง NOT_TRACKED: ค่าธรรมเนียมโอนไม่เปลี่ยน tracking_status)
CREATE OR REPLACE FUNCTION private.ensure_monthly_expense(p_family uuid, p_date date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_month date := date_trunc('month', p_date)::date;
BEGIN
  SELECT id INTO v_id FROM public.monthly_expenses
   WHERE family_id = p_family AND year_month = v_month AND deleted_at IS NULL;
  IF v_id IS NULL THEN
    INSERT INTO public.monthly_expenses(family_id, year_month, tracking_status)
    VALUES (p_family, v_month, 'NOT_TRACKED') RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------
-- Upsert Derived Cash Movement แบบ Idempotent (Section 25B Derived Movement Lock)
--   1 Source = 1 แถว (unique source_entity_type, source_entity_id)
--   ไม่ต้องการแล้ว → Soft Delete ; ต้องการอีก → Restore + Update แถวเดิม
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.sync_derived_movement(
  p_source_type text, p_source_id uuid, p_need boolean,
  p_family uuid DEFAULT NULL, p_date date DEFAULT NULL, p_type text DEFAULT NULL,
  p_from uuid DEFAULT NULL, p_to uuid DEFAULT NULL, p_amount numeric DEFAULT NULL,
  p_currency text DEFAULT NULL, p_description text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.cash_movements;
BEGIN
  SELECT * INTO m FROM public.cash_movements
   WHERE is_derived AND source_entity_type = p_source_type AND source_entity_id = p_source_id;

  IF p_need AND coalesce(p_amount, 0) > 0 THEN
    IF m.id IS NULL THEN
      INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_asset_id,
                                        amount, currency, source_entity_type, source_entity_id, is_derived, description)
      VALUES (p_family, p_date, p_type, p_from, p_to, p_amount, p_currency, p_source_type, p_source_id, true, p_description)
      RETURNING id INTO m.id;
    ELSIF (m.family_id, m.movement_date, m.movement_type, m.from_asset_id, m.to_asset_id, m.amount, m.currency,
           m.description, m.deleted_at IS NULL)
          IS DISTINCT FROM (p_family, p_date, p_type, p_from, p_to, p_amount::numeric(20,4), p_currency, p_description, true) THEN
      UPDATE public.cash_movements SET family_id = p_family, movement_date = p_date, movement_type = p_type,
             from_asset_id = p_from, to_asset_id = p_to, amount = p_amount, currency = p_currency,
             description = p_description, deleted_at = NULL
       WHERE id = m.id;
    END IF;
    RETURN m.id;
  ELSIF m.id IS NOT NULL AND m.deleted_at IS NULL THEN
    UPDATE public.cash_movements SET deleted_at = now() WHERE id = m.id;
  END IF;
  RETURN NULL;
END $$;
