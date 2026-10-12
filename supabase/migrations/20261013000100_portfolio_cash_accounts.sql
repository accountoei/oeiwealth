-- =====================================================================
-- พอร์ตลงทุน: เงินสดหลายบัญชีต่อสกุล (เช่น Interest Checking + Brokerage Cash เป็น USD ทั้งคู่)
--   * investment_holdings: is_default_cash (บัญชีหลักของสกุล · 1 บัญชีต่อสกุลต่อพอร์ต), interest_rate, purpose
--   * investment_transactions: cash_holding_id (บัญชีเงินสดที่เงินเข้า/ออก), counter_cash_holding_id (ปลายทางของแลกเงิน / โอนภายใน)
--   * ไม่ระบุบัญชี → ใช้บัญชีหลักของสกุลนั้น (ไม่มีบัญชีหลัก → บัญชีที่สร้างก่อน)
--   * ยอดเงินสดคิดรายบัญชี (เดิมรวมทุกรายการของสกุล → ถ้ามี 2 บัญชีสกุลเดียวกันจะนับซ้ำ)
--   * รายการใหม่ CASH_TRANSFER = โอนระหว่างบัญชีเงินสดในพอร์ต (สกุลเดียวกัน · ไม่ใช่รายได้ / ค่าใช้จ่าย)
--   * เงินโอนเข้าพอร์ตระหว่างทาง: เคลียร์เมื่อบัญชีที่รับเงินมี Statement หลังวันโอน
-- =====================================================================

-- 1) คอลัมน์ใหม่ ------------------------------------------------------------
ALTER TABLE public.investment_holdings
  ADD COLUMN IF NOT EXISTS is_default_cash boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS interest_rate   public.d_rate,
  ADD COLUMN IF NOT EXISTS purpose         text;
ALTER TABLE public.investment_holdings DROP CONSTRAINT IF EXISTS ih_default_cash_only;
ALTER TABLE public.investment_holdings ADD CONSTRAINT ih_default_cash_only
  CHECK (NOT is_default_cash OR holding_type = 'CASH');

ALTER TABLE public.investment_transactions
  ADD COLUMN IF NOT EXISTS cash_holding_id         uuid REFERENCES public.investment_holdings(id),
  ADD COLUMN IF NOT EXISTS counter_cash_holding_id uuid REFERENCES public.investment_holdings(id);
CREATE INDEX IF NOT EXISTS itx_cash_holding_idx ON public.investment_transactions(cash_holding_id)
  WHERE cash_holding_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS itx_counter_cash_holding_idx ON public.investment_transactions(counter_cash_holding_id)
  WHERE counter_cash_holding_id IS NOT NULL;

ALTER TABLE public.investment_transactions DROP CONSTRAINT IF EXISTS investment_transactions_transaction_type_check;
ALTER TABLE public.investment_transactions ADD CONSTRAINT investment_transactions_transaction_type_check
  CHECK (transaction_type IN ('OPENING_BALANCE','DEPOSIT','WITHDRAWAL','BUY','SELL','DIVIDEND',
                              'INTEREST','COUPON','FEE','TAX','MATURITY','REDEMPTION',
                              'FX_EXCHANGE','ADJUSTMENT','CASH_TRANSFER'));
ALTER TABLE public.investment_transactions DROP CONSTRAINT IF EXISTS itx_fx_required;
ALTER TABLE public.investment_transactions ADD CONSTRAINT itx_fx_required
  CHECK ((transaction_type IN ('FX_EXCHANGE','CASH_TRANSFER'))
         = (counter_amount IS NOT NULL AND counter_currency IS NOT NULL)
         AND (transaction_type <> 'FX_EXCHANGE' OR actual_fx_rate IS NOT NULL OR
              (currency <> 'THB' AND counter_currency <> 'THB')));
ALTER TABLE public.investment_transactions DROP CONSTRAINT IF EXISTS itx_cash_transfer_required;
ALTER TABLE public.investment_transactions ADD CONSTRAINT itx_cash_transfer_required
  CHECK (transaction_type <> 'CASH_TRANSFER' OR (
         holding_id IS NULL AND counter_currency = currency AND counter_amount = amount
         AND cash_holding_id IS NOT NULL AND counter_cash_holding_id IS NOT NULL
         AND cash_holding_id <> counter_cash_holding_id));

-- 2) บัญชีหลักของสกุล --------------------------------------------------------
CREATE OR REPLACE FUNCTION private.default_cash_holding(p_portfolio uuid, p_currency text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT h.id FROM public.investment_holdings h
   WHERE h.portfolio_id = p_portfolio AND h.holding_type = 'CASH' AND h.currency = p_currency
     AND h.deleted_at IS NULL
   ORDER BY h.is_default_cash DESC, h.created_at, h.id
   LIMIT 1
$$;

-- เงินสดที่รายการนี้ทำให้บัญชี p_holding เปลี่ยน (ในสกุลของบัญชีนั้น)
-- รายการเก่าที่ยังไม่ได้ผูกบัญชี (เช่น อยู่ในงวดที่ปิดแล้ว) → นับเข้าบัญชีหลักของสกุล
CREATE OR REPLACE FUNCTION private.itx_cash_for(t public.investment_transactions, p_holding uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN t.transaction_type IN ('FX_EXCHANGE','CASH_TRANSFER') THEN
         (CASE WHEN coalesce(t.cash_holding_id, private.default_cash_holding(t.portfolio_id, t.currency)) = p_holding
               THEN -(t.amount + coalesce(t.fee, 0)) ELSE 0 END)
       + (CASE WHEN coalesce(t.counter_cash_holding_id, private.default_cash_holding(t.portfolio_id, t.counter_currency)) = p_holding
               THEN t.counter_amount ELSE 0 END)
    WHEN coalesce(t.cash_holding_id, private.default_cash_holding(t.portfolio_id, t.currency)) = p_holding
      THEN private.itx_net_cash(t, t.currency)
    ELSE 0 END
$$;

-- บัญชีเงินสดแรกของสกุลในพอร์ต = บัญชีหลักอัตโนมัติ · ลบบัญชีหลัก → บัญชีถัดไปเป็นบัญชีหลัก
CREATE OR REPLACE FUNCTION private.tg_holding_default_cash() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.holding_type <> 'CASH' OR NEW.deleted_at IS NOT NULL THEN
    NEW.is_default_cash := false;
  ELSIF TG_OP = 'INSERT' AND NOT EXISTS (
          SELECT 1 FROM public.investment_holdings h
           WHERE h.portfolio_id = NEW.portfolio_id AND h.currency = NEW.currency AND h.holding_type = 'CASH'
             AND h.is_default_cash AND h.deleted_at IS NULL) THEN
    NEW.is_default_cash := true;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t15_default_cash ON public.investment_holdings;
CREATE TRIGGER t15_default_cash BEFORE INSERT OR UPDATE ON public.investment_holdings
  FOR EACH ROW EXECUTE FUNCTION private.tg_holding_default_cash();

CREATE OR REPLACE FUNCTION private.tg_holding_default_cash_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_next uuid;
BEGIN
  IF OLD.is_default_cash AND NOT NEW.is_default_cash AND OLD.holding_type = 'CASH'
     AND NOT EXISTS (SELECT 1 FROM public.investment_holdings h
                      WHERE h.portfolio_id = NEW.portfolio_id AND h.currency = NEW.currency AND h.holding_type = 'CASH'
                        AND h.is_default_cash AND h.deleted_at IS NULL) THEN
    SELECT h.id INTO v_next FROM public.investment_holdings h
     WHERE h.portfolio_id = NEW.portfolio_id AND h.currency = NEW.currency AND h.holding_type = 'CASH'
       AND h.deleted_at IS NULL AND h.id <> NEW.id
     ORDER BY h.created_at, h.id LIMIT 1;
    IF v_next IS NOT NULL AND NEW.deleted_at IS NOT NULL THEN
      UPDATE public.investment_holdings SET is_default_cash = true WHERE id = v_next;
    END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS a55_default_cash ON public.investment_holdings;
CREATE TRIGGER a55_default_cash AFTER UPDATE ON public.investment_holdings
  FOR EACH ROW EXECUTE FUNCTION private.tg_holding_default_cash_after();

DROP INDEX IF EXISTS public.ih_default_cash_uq;
-- ข้อมูลเดิม: บัญชีเงินสดแรกของแต่ละสกุลเป็นบัญชีหลัก
UPDATE public.investment_holdings h SET is_default_cash = true
 WHERE h.id IN (SELECT DISTINCT ON (x.portfolio_id, x.currency) x.id FROM public.investment_holdings x
                 WHERE x.holding_type = 'CASH' AND x.deleted_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM public.investment_holdings d
                                    WHERE d.portfolio_id = x.portfolio_id AND d.currency = x.currency
                                      AND d.holding_type = 'CASH' AND d.is_default_cash AND d.deleted_at IS NULL)
                 ORDER BY x.portfolio_id, x.currency, x.created_at, x.id);
CREATE UNIQUE INDEX ih_default_cash_uq ON public.investment_holdings(portfolio_id, currency)
  WHERE is_default_cash AND deleted_at IS NULL;

-- 3) Net Cash: CASH_TRANSFER ภายในพอร์ต สุทธิ = −ค่าธรรมเนียม --------------------
CREATE OR REPLACE FUNCTION private.itx_net_cash(t public.investment_transactions, p_currency text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN t.transaction_type IN ('FX_EXCHANGE','CASH_TRANSFER') THEN
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

-- 4) มูลค่าเงินสดรายบัญชี ----------------------------------------------------
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

    SELECT coalesce(sum(private.itx_cash_for(x, h.id)), 0) INTO v_adj
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

-- 5) เงินโอนเข้าพอร์ตระหว่างทาง: เคลียร์ตาม Statement ของบัญชีที่รับเงิน --------------
CREATE OR REPLACE FUNCTION private.portfolio_in_transit(p_portfolio uuid, p_as_of date DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_asset uuid; v_ccy text; v_go_live date; v_upto date := coalesce(p_as_of, 'infinity'::date);
  v_fx_date date := coalesce(p_as_of, current_date); v_sum numeric;
BEGIN
  SELECT p.asset_id, a.currency, f.go_live_date INTO v_asset, v_ccy, v_go_live
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
    JOIN public.families f ON f.id = a.family_id WHERE p.id = p_portfolio;

  SELECT coalesce(sum(CASE WHEN m.movement_type = 'INVESTMENT_OUT' THEN m.amount ELSE -m.amount END
                      * CASE WHEN m.currency = v_ccy THEN 1
                             ELSE coalesce(private.fx_rate(m.currency, v_fx_date)
                                           / nullif(private.fx_rate(v_ccy, v_fx_date), 0), 0) END), 0)
    INTO v_sum
    FROM public.cash_movements m
    LEFT JOIN LATERAL (
      SELECT coalesce((SELECT x.cash_holding_id FROM public.investment_transactions x
                        WHERE x.cash_movement_id = m.id AND x.transaction_type IN ('DEPOSIT','WITHDRAWAL')
                          AND x.deleted_at IS NULL LIMIT 1),
                      private.default_cash_holding(p_portfolio, m.currency)) AS ch) d ON true
   WHERE m.deleted_at IS NULL AND NOT m.is_derived
     AND ((m.movement_type = 'INVESTMENT_OUT' AND m.to_asset_id = v_asset)
       OR (m.movement_type = 'INVESTMENT_IN'  AND m.from_asset_id = v_asset))
     AND m.movement_date <= v_upto
     -- Statement ล่าสุดของบัญชีที่รับเงิน (ไม่มี → วันตั้งต้นของบัญชีนั้น → วันก่อน Go-live)
     AND m.movement_date > coalesce(
           (SELECT max(v.valuation_date) FROM public.investment_valuations v
             WHERE v.holding_id = d.ch AND v.deleted_at IS NULL AND v.valuation_date <= v_upto),
           (SELECT max(t.transaction_date) FROM public.investment_transactions t
             WHERE t.holding_id = d.ch AND t.transaction_type = 'OPENING_BALANCE' AND t.deleted_at IS NULL),
           v_go_live - 1);
  RETURN v_sum;
END $$;

-- 6) ตรวจรายการ: เลือกบัญชีเงินสด (ไม่ระบุ = บัญชีหลักของสกุล) ------------------------
CREATE OR REPLACE FUNCTION private.tg_itx_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.investment_holdings; c public.investment_holdings; v_go_live date; v_bank uuid; v_bank_ccy text; v_rate numeric;
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

  -- บัญชีเงินสดในพอร์ตที่เงินเข้า / ออก
  IF NEW.transaction_type = 'OPENING_BALANCE' OR v_bank IS NOT NULL THEN
    NEW.cash_holding_id := NULL; NEW.counter_cash_holding_id := NULL;
  ELSE
    IF h.id IS NOT NULL AND h.holding_type = 'CASH' THEN
      NEW.cash_holding_id := h.id;                          -- รายการของบัญชีเงินสดเอง (ดอกเบี้ย / ค่าธรรมเนียม / โอนเข้า)
    ELSIF NEW.cash_holding_id IS NULL THEN
      NEW.cash_holding_id := private.default_cash_holding(NEW.portfolio_id, NEW.currency);
    END IF;
    IF NEW.transaction_type IN ('FX_EXCHANGE','CASH_TRANSFER') THEN
      IF NEW.counter_cash_holding_id IS NULL THEN
        NEW.counter_cash_holding_id := private.default_cash_holding(NEW.portfolio_id, NEW.counter_currency);
      END IF;
    ELSE
      NEW.counter_cash_holding_id := NULL;
    END IF;
    IF NEW.cash_holding_id IS NOT NULL THEN
      SELECT * INTO c FROM public.investment_holdings WHERE id = NEW.cash_holding_id;
      IF c.portfolio_id IS DISTINCT FROM NEW.portfolio_id OR c.holding_type <> 'CASH' OR c.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVALID: บัญชีเงินสดไม่ได้อยู่ในพอร์ตนี้' USING ERRCODE = '22023';
      END IF;
      IF c.currency <> NEW.currency THEN
        RAISE EXCEPTION 'INVALID: บัญชีเงินสด (%) ต้องสกุลเดียวกับรายการ (%)', c.currency, NEW.currency USING ERRCODE = '22023';
      END IF;
    END IF;
    IF NEW.counter_cash_holding_id IS NOT NULL THEN
      SELECT * INTO c FROM public.investment_holdings WHERE id = NEW.counter_cash_holding_id;
      IF c.portfolio_id IS DISTINCT FROM NEW.portfolio_id OR c.holding_type <> 'CASH' OR c.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVALID: บัญชีเงินสดปลายทางไม่ได้อยู่ในพอร์ตนี้' USING ERRCODE = '22023';
      END IF;
      IF c.currency <> NEW.counter_currency THEN
        RAISE EXCEPTION 'INVALID: บัญชีเงินสดปลายทาง (%) ต้องสกุลเดียวกับยอดที่ได้รับ (%)', c.currency, NEW.counter_currency
          USING ERRCODE = '22023';
      END IF;
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

-- 7) โอนเงินธนาคาร → พอร์ต: เข้าบัญชีหลักของสกุล -------------------------------------
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
        v_cash_holding := private.default_cash_holding(v_pf, m.currency);
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

-- 8) RPC: บันทึกรายการ (เลือกบัญชีเงินสดได้) ----------------------------------------
CREATE OR REPLACE FUNCTION public.record_investment_tx(p_portfolio_asset_id uuid, p_tx jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_pf uuid; v_pf_ccy text; v_type text := upper(p_tx->>'type'); v_date date; v_holding uuid;
  h public.investment_holdings; v_qty numeric; v_price numeric; v_amount numeric; v_held numeric;
  v_bank uuid; v_ccy text; v_id uuid; nh jsonb;
BEGIN
  SELECT p.id, a.currency INTO v_pf, v_pf_ccy
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
   WHERE p.asset_id = p_portfolio_asset_id AND p.deleted_at IS NULL AND a.deleted_at IS NULL;
  IF v_pf IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบพอร์ตนี้' USING ERRCODE = '22023'; END IF;
  IF v_type NOT IN ('BUY','SELL','DIVIDEND','INTEREST','COUPON','REDEMPTION','FEE','TAX','ADJUSTMENT') THEN
    RAISE EXCEPTION 'INVALID: ประเภทรายการไม่รองรับในฟอร์มนี้ (%)', v_type USING ERRCODE = '22023';
  END IF;
  v_date := nullif(p_tx->>'date', '')::date;
  IF v_date IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่วันที่' USING ERRCODE = '22023'; END IF;
  IF v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่รายการเป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023'; END IF;

  -- Holding: เลือกตัวเดิม หรือสร้างใหม่ (BUY หุ้นตัวใหม่)
  v_holding := nullif(p_tx->>'holding_id', '')::uuid;
  nh := p_tx->'new_holding';
  IF v_holding IS NULL AND nh IS NOT NULL AND length(trim(coalesce(nh->>'name', ''))) > 0 THEN
    IF v_type <> 'BUY' THEN
      RAISE EXCEPTION 'INVALID: สร้างหลักทรัพย์ใหม่ได้เฉพาะรายการซื้อ' USING ERRCODE = '22023';
    END IF;
    v_holding := public.add_holding(p_portfolio_asset_id, coalesce(nullif(nh->>'holding_type', ''), 'EQUITY'),
      nh->>'name', nh->>'symbol', coalesce(nullif(nh->>'currency', ''), v_pf_ccy),
      nullif(nh->>'maturity_date', '')::date, NULL, NULL);
  END IF;
  IF v_holding IS NOT NULL THEN
    SELECT * INTO h FROM public.investment_holdings WHERE id = v_holding AND portfolio_id = v_pf AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบหลักทรัพย์นี้ในพอร์ต' USING ERRCODE = '22023'; END IF;
    IF h.holding_type = 'CASH' AND v_type NOT IN ('INTEREST','FEE','TAX','ADJUSTMENT') THEN
      RAISE EXCEPTION 'INVALID: เงินสดในพอร์ตใช้ได้กับดอกเบี้ย / ค่าธรรมเนียม / ภาษี / ปรับปรุงเท่านั้น' USING ERRCODE = '22023';
    END IF;
  ELSIF v_type IN ('BUY','SELL','REDEMPTION','DIVIDEND','COUPON') THEN
    RAISE EXCEPTION 'INVALID: กรุณาเลือกหลักทรัพย์' USING ERRCODE = '22023';
  END IF;
  v_ccy := coalesce(h.currency, upper(nullif(p_tx->>'currency', '')), v_pf_ccy);

  v_qty   := nullif(p_tx->>'quantity', '')::numeric;
  v_price := nullif(p_tx->>'price', '')::numeric;
  v_amount := nullif(p_tx->>'amount', '')::numeric;
  IF v_type IN ('BUY','SELL') THEN
    IF v_qty IS NULL OR v_qty <= 0 OR v_price IS NULL OR v_price < 0 THEN
      RAISE EXCEPTION 'INVALID: ซื้อ / ขาย ต้องมีจำนวนและราคาต่อหน่วย' USING ERRCODE = '22023';
    END IF;
    v_amount := coalesce(v_amount, round(v_qty * v_price, 4));
  END IF;
  IF v_type = 'ADJUSTMENT' THEN
    IF coalesce(p_tx->>'direction', '') NOT IN ('IN','OUT') THEN
      RAISE EXCEPTION 'INVALID: ปรับปรุงต้องระบุเพิ่ม / ลด' USING ERRCODE = '22023';
    END IF;
    v_amount := coalesce(v_amount, 0);
  END IF;
  IF v_amount IS NULL OR v_amount < 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่จำนวนเงิน' USING ERRCODE = '22023';
  END IF;

  -- ขาย / ไถ่ถอนเกินที่ถือ ณ วันที่รายการ
  IF v_type IN ('SELL','REDEMPTION') OR (v_type = 'ADJUSTMENT' AND p_tx->>'direction' = 'OUT' AND v_qty IS NOT NULL) THEN
    SELECT hv.quantity INTO v_held FROM private.holding_value_at(v_holding, v_date) hv;
    IF v_type = 'REDEMPTION' AND v_qty IS NULL THEN v_qty := v_held; END IF;
    IF coalesce(v_qty, 0) > coalesce(v_held, 0) + 0.0000001 THEN
      RAISE EXCEPTION 'INVALID: จำนวนเกินที่ถืออยู่ ณ วันที่ % (ถือ %)', v_date, round(coalesce(v_held, 0), 6)
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_bank := nullif(p_tx->>'settle_bank_asset_id', '')::uuid;
  INSERT INTO public.investment_transactions(
    portfolio_id, holding_id, transaction_date, settlement_date, transaction_type,
    quantity, price, amount, currency, direction, settle_from_asset_id, settle_to_asset_id, fee, tax, notes,
    cash_holding_id)
  VALUES (
    v_pf, v_holding, v_date, nullif(p_tx->>'settlement_date', '')::date, v_type,
    v_qty, v_price, v_amount, v_ccy, CASE WHEN v_type = 'ADJUSTMENT' THEN p_tx->>'direction' END,
    CASE WHEN v_type = 'BUY' THEN v_bank END,
    CASE WHEN v_type IN ('SELL','REDEMPTION','DIVIDEND','INTEREST','COUPON') THEN v_bank END,
    nullif(p_tx->>'fee', '')::numeric, nullif(p_tx->>'tax', '')::numeric, nullif(trim(p_tx->>'notes'), ''),
    CASE WHEN v_bank IS NULL THEN nullif(p_tx->>'cash_holding_id', '')::uuid END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.record_investment_fx(p_portfolio_asset_id uuid, p_tx jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_pf uuid; v_from text; v_to text; v_id uuid; v_date date := nullif(p_tx->>'date', '')::date;
BEGIN
  SELECT p.id INTO v_pf FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
   WHERE p.asset_id = p_portfolio_asset_id AND p.deleted_at IS NULL AND a.deleted_at IS NULL;
  IF v_pf IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบพอร์ตนี้' USING ERRCODE = '22023'; END IF;
  v_from := upper(p_tx->>'currency'); v_to := upper(p_tx->>'counter_currency');
  IF v_from IS NULL OR v_to IS NULL OR v_from = v_to THEN RAISE EXCEPTION 'INVALID: เลือกสกุลต้นทางและปลายทางที่ต่างกัน' USING ERRCODE = '22023'; END IF;
  IF v_date IS NULL OR v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF coalesce(nullif(p_tx->>'amount', '')::numeric, 0) <= 0 OR coalesce(nullif(p_tx->>'counter_amount', '')::numeric, 0) <= 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดที่แลกออกและยอดที่ได้รับ' USING ERRCODE = '22023';
  END IF;
  -- เงินสดสกุลปลายทาง (สร้างให้ถ้ายังไม่มี)
  IF nullif(p_tx->>'counter_cash_holding_id', '') IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.investment_holdings WHERE portfolio_id = v_pf AND holding_type = 'CASH'
                  AND currency = v_to AND deleted_at IS NULL) THEN
    PERFORM public.add_holding(p_portfolio_asset_id, 'CASH', 'เงินสด ' || v_to, NULL, v_to, NULL, NULL, NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.investment_holdings WHERE portfolio_id = v_pf AND holding_type = 'CASH'
                  AND currency = v_from AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: พอร์ตนี้ไม่มีเงินสดสกุล %', v_from USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.investment_transactions(portfolio_id, transaction_date, transaction_type, amount, currency,
              counter_amount, counter_currency, actual_fx_rate, fee, notes, cash_holding_id, counter_cash_holding_id)
  VALUES (v_pf, v_date, 'FX_EXCHANGE', (p_tx->>'amount')::numeric, v_from, (p_tx->>'counter_amount')::numeric, v_to,
          nullif(p_tx->>'actual_fx_rate', '')::numeric, nullif(p_tx->>'fee', '')::numeric, nullif(trim(p_tx->>'notes'), ''),
          nullif(p_tx->>'cash_holding_id', '')::uuid, nullif(p_tx->>'counter_cash_holding_id', '')::uuid)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ครบกำหนด: เลือกบัญชีเงินสดที่รับเงินต้นคืน (เพิ่มพารามิเตอร์ท้ายสุด)
DROP FUNCTION IF EXISTS public.record_holding_maturity(uuid, date, numeric, uuid, date, numeric, numeric, text);
CREATE OR REPLACE FUNCTION public.record_holding_maturity(
  p_holding_id uuid, p_date date, p_amount numeric, p_settle_to_asset_id uuid DEFAULT NULL,
  p_settlement_date date DEFAULT NULL, p_fee numeric DEFAULT NULL, p_tax numeric DEFAULT NULL,
  p_notes text DEFAULT NULL, p_cash_holding_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.investment_holdings; v_id uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT * INTO h FROM public.investment_holdings WHERE id = p_holding_id AND deleted_at IS NULL;
  IF NOT FOUND OR h.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'INVALID: Holding ไม่ได้อยู่ในสถานะ ACTIVE' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.investment_transactions(portfolio_id, holding_id, transaction_date, settlement_date,
              transaction_type, quantity, amount, currency, settle_to_asset_id, fee, tax, notes, cash_holding_id)
  VALUES (h.portfolio_id, h.id, p_date, p_settlement_date, 'MATURITY', h.quantity, p_amount, h.currency,
          p_settle_to_asset_id, p_fee, p_tax, p_notes,
          CASE WHEN p_settle_to_asset_id IS NULL THEN p_cash_holding_id END)
  RETURNING id INTO v_id;                       -- Trigger: status = MATURED + INVESTMENT_IN (ถ้าเข้าบัญชี)
  RETURN v_id;
END $$;

-- โอนระหว่างบัญชีเงินสดในพอร์ต (สกุลเดียวกัน)
CREATE OR REPLACE FUNCTION public.transfer_portfolio_cash(p_portfolio_asset_id uuid, p_tx jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_pf uuid; f public.investment_holdings; t public.investment_holdings; v_amount numeric; v_date date; v_id uuid;
BEGIN
  SELECT p.id INTO v_pf FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
   WHERE p.asset_id = p_portfolio_asset_id AND p.deleted_at IS NULL AND a.deleted_at IS NULL;
  IF v_pf IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบพอร์ตนี้' USING ERRCODE = '22023'; END IF;
  SELECT * INTO f FROM public.investment_holdings WHERE id = nullif(p_tx->>'from_holding_id', '')::uuid
     AND portfolio_id = v_pf AND holding_type = 'CASH' AND deleted_at IS NULL;
  SELECT * INTO t FROM public.investment_holdings WHERE id = nullif(p_tx->>'to_holding_id', '')::uuid
     AND portfolio_id = v_pf AND holding_type = 'CASH' AND deleted_at IS NULL;
  IF f.id IS NULL OR t.id IS NULL THEN
    RAISE EXCEPTION 'INVALID: เลือกบัญชีเงินสดต้นทางและปลายทางในพอร์ตนี้' USING ERRCODE = '22023';
  END IF;
  IF f.id = t.id THEN RAISE EXCEPTION 'INVALID: บัญชีต้นทางและปลายทางต้องต่างกัน' USING ERRCODE = '22023'; END IF;
  IF f.currency <> t.currency THEN
    RAISE EXCEPTION 'INVALID: คนละสกุลเงิน — ใช้ "แลกเงินในพอร์ต" แทน' USING ERRCODE = '22023';
  END IF;
  v_amount := nullif(p_tx->>'amount', '')::numeric;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่จำนวนเงิน' USING ERRCODE = '22023'; END IF;
  v_date := nullif(p_tx->>'date', '')::date;
  IF v_date IS NULL OR v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.investment_transactions(portfolio_id, transaction_date, transaction_type, amount, currency,
              counter_amount, counter_currency, cash_holding_id, counter_cash_holding_id, fee, notes)
  VALUES (v_pf, v_date, 'CASH_TRANSFER', v_amount, f.currency, v_amount, f.currency, f.id, t.id,
          nullif(p_tx->>'fee', '')::numeric, nullif(trim(p_tx->>'notes'), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ตั้งบัญชีหลักของสกุล (ADMIN / EDITOR)
CREATE OR REPLACE FUNCTION public.set_default_cash_account(p_holding_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE h public.investment_holdings;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO h FROM public.investment_holdings WHERE id = p_holding_id AND holding_type = 'CASH' AND deleted_at IS NULL;
  IF h.id IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบบัญชีเงินสดนี้' USING ERRCODE = '22023'; END IF;
  UPDATE public.investment_holdings SET is_default_cash = false
   WHERE portfolio_id = h.portfolio_id AND currency = h.currency AND holding_type = 'CASH' AND is_default_cash AND id <> h.id;
  UPDATE public.investment_holdings SET is_default_cash = true WHERE id = h.id AND NOT is_default_cash;
END $$;

-- 9) ข้อมูลเดิม: รายการที่มีผลกับเงินสดในพอร์ต → ผูกบัญชีหลักของสกุล (ยอดเดิมไม่เปลี่ยน) ----------
UPDATE public.investment_transactions x
   SET cash_holding_id = coalesce(CASE WHEN h.holding_type = 'CASH' THEN h.id END,
                                  private.default_cash_holding(x.portfolio_id, x.currency)),
       counter_cash_holding_id = CASE WHEN x.transaction_type = 'FX_EXCHANGE'
                                      THEN private.default_cash_holding(x.portfolio_id, x.counter_currency) END
  FROM public.investment_transactions x2
  LEFT JOIN public.investment_holdings h ON h.id = x2.holding_id
 WHERE x2.id = x.id AND x.cash_holding_id IS NULL
   AND x.transaction_type <> 'OPENING_BALANCE'
   AND x.settle_from_asset_id IS NULL AND x.settle_to_asset_id IS NULL
   -- งวดที่ปิดแล้วแก้ไม่ได้ → ปล่อยว่าง (ระบบนับเข้าบัญชีหลักให้เอง)
   AND x.transaction_date > coalesce((SELECT private.locked_through(a.family_id) FROM public.investment_portfolios p
                                        JOIN public.assets a ON a.id = p.asset_id WHERE p.id = x.portfolio_id), '-infinity'::date);

-- 10) View: เพิ่มคอลัมน์ใหม่ (h.* / t.* ถูกขยายตอนสร้าง View → ต้องสร้างใหม่) ------------------
DROP VIEW IF EXISTS public.v_holdings_active;
CREATE VIEW public.v_holdings_active WITH (security_invoker = true) AS
  SELECT h.*, p.asset_id AS portfolio_asset_id,
         CASE WHEN h.status = 'ACTIVE' AND h.maturity_date IS NOT NULL
                   AND h.maturity_date BETWEEN current_date AND current_date + 30 THEN 'MATURITY_SOON' END AS derived_status,
         (h.holding_type <> 'CASH' AND NOT EXISTS (SELECT 1 FROM public.investment_valuations v
            WHERE v.holding_id = h.id AND v.deleted_at IS NULL)) AS valued_at_cost       -- ป้าย "ราคาทุน · รอ Statement"
    FROM public.investment_holdings h
    JOIN public.investment_portfolios p ON p.id = h.portfolio_id
    JOIN public.assets a ON a.id = p.asset_id
   WHERE h.deleted_at IS NULL AND p.deleted_at IS NULL AND a.deleted_at IS NULL;
DROP VIEW IF EXISTS public.v_investment_transactions_net;
CREATE VIEW public.v_investment_transactions_net WITH (security_invoker = true) AS
  SELECT t.*, private.itx_net_cash(t, t.currency) AS net_cash,
         CASE WHEN coalesce(t.settlement_date, t.transaction_date) > current_date THEN 'UNSETTLED'
              ELSE 'SETTLED' END AS settlement_status
    FROM public.investment_transactions t
   WHERE t.deleted_at IS NULL;
GRANT SELECT ON public.v_holdings_active, public.v_investment_transactions_net TO authenticated, service_role;

-- 11) สิทธิ์ -----------------------------------------------------------------------
REVOKE ALL ON FUNCTION private.default_cash_holding(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.itx_cash_for(public.investment_transactions, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.default_cash_holding(uuid, text), private.itx_cash_for(public.investment_transactions, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.tg_holding_default_cash(), private.tg_holding_default_cash_after() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_holding_maturity(uuid, date, numeric, uuid, date, numeric, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_holding_maturity(uuid, date, numeric, uuid, date, numeric, numeric, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.transfer_portfolio_cash(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_portfolio_cash(uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.set_default_cash_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_default_cash_account(uuid) TO authenticated;
