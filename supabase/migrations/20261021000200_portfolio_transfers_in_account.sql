-- =====================================================================
-- เงินโอนธนาคาร ↔ พอร์ต นับเข้าบัญชีเงินฝากในพอร์ตทันที (เหมือนบัญชีธนาคาร)
--   เดิม: เงินโอนหลัง Statement ล่าสุดของบัญชี = "เงินระหว่างทาง" (แยกรายการใน Net Worth จนกว่าจะบันทึก Statement)
--   ใหม่: ทราบยอดฝั่งพอร์ตแล้ว → นับในยอดบัญชีเงินฝากทันที · Statement ยังเป็นจุดตั้งต้นใหม่ (เงินโอนก่อน / วันเดียวกับ Statement อยู่ใน Statement แล้ว)
--         "เงินระหว่างทาง" เหลือเฉพาะ: โอนเข้าพอร์ตที่ยังไม่ทราบยอดที่เข้า · ถอนออกที่ยังไม่ทราบยอดเข้าธนาคาร
--   Net Worth รวมเท่าเดิมทุกวันที่ (ย้ายจากรายการ "เงินระหว่างทาง" เข้ายอดบัญชีเงินฝาก) · เดือน FINAL อ่านจาก Snapshot ไม่เปลี่ยน
--   ไม่แก้ / ลบข้อมูล · คำนวณ Cache ยอดบัญชีเงินฝาก / มูลค่าพอร์ตใหม่ · รันซ้ำได้
-- =====================================================================

-- 1) เงินโอนของพอร์ต (ฝั่งพอร์ต) — ใช้ร่วมกันระหว่างยอดบัญชีเงินฝาก และเงินระหว่างทาง ---------------
--   pf_amt: ธนาคาร → พอร์ต = +ยอดที่เข้า (รอยอด = ยอดที่ส่ง สกุลธนาคาร) · พอร์ต → ธนาคาร = −(ยอดที่ออก + ค่าธรรมเนียมแบบใหม่)
--   in_holding: นับในบัญชีเงินฝาก (ทราบยอดฝั่งพอร์ต · บัญชียังอยู่ · สกุลตรงกับบัญชี) · ไม่ใช่ = เงินระหว่างทาง
CREATE OR REPLACE FUNCTION private.pf_transfers(p_portfolio uuid, p_upto date DEFAULT NULL)
RETURNS TABLE (movement_id uuid, movement_date date, movement_type text, ch uuid, pf_amt numeric, pf_ccy text,
               in_holding boolean, wait_bank numeric, currency text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH mv AS (
    SELECT m.*,
           CASE WHEN m.movement_type = 'INVESTMENT_OUT' THEN
                  CASE WHEN m.counter_currency IS NOT NULL AND m.counter_amount IS NOT NULL THEN m.counter_amount ELSE m.amount END
                ELSE -(m.amount + CASE WHEN m.counter_currency IS NOT NULL THEN coalesce(m.fee, 0) ELSE 0 END) END AS x_amt,
           CASE WHEN m.movement_type = 'INVESTMENT_OUT' AND m.counter_currency IS NOT NULL AND m.counter_amount IS NOT NULL
                THEN m.counter_currency ELSE m.currency END AS x_ccy,
           (m.movement_type = 'INVESTMENT_OUT' AND m.counter_currency IS NOT NULL AND m.counter_amount IS NULL) AS x_pending,
           coalesce(m.cash_holding_id,
                    (SELECT x.cash_holding_id FROM public.investment_transactions x
                      WHERE x.cash_movement_id = m.id AND x.transaction_type IN ('DEPOSIT','WITHDRAWAL')
                        AND x.deleted_at IS NULL LIMIT 1),
                    private.default_cash_holding(p_portfolio, coalesce(m.counter_currency, m.currency))) AS x_ch
      FROM public.cash_movements m
      JOIN public.investment_portfolios p ON p.id = p_portfolio
     WHERE m.deleted_at IS NULL AND NOT m.is_derived
       AND ((m.movement_type = 'INVESTMENT_OUT' AND m.to_asset_id = p.asset_id)
         OR (m.movement_type = 'INVESTMENT_IN'  AND m.from_asset_id = p.asset_id))
       AND m.movement_date <= coalesce(p_upto, 'infinity'::date))
  SELECT mv.id, mv.movement_date, mv.movement_type, mv.x_ch, mv.x_amt, mv.x_ccy,
         (NOT mv.x_pending AND h.id IS NOT NULL AND h.deleted_at IS NULL AND h.holding_type = 'CASH' AND h.currency = mv.x_ccy),
         CASE WHEN mv.movement_type = 'INVESTMENT_IN' AND mv.counter_currency IS NOT NULL AND mv.counter_amount IS NULL
              THEN mv.amount ELSE 0 END,
         mv.currency
    FROM mv LEFT JOIN public.investment_holdings h ON h.id = mv.x_ch
$$;
REVOKE ALL ON FUNCTION private.pf_transfers(uuid, date) FROM PUBLIC, anon, authenticated;

-- 2) ยอดบัญชีเงินฝากในพอร์ต: + เงินโอนที่ทราบยอดแล้ว หลังจุดตั้งต้น ----------------------------------
CREATE OR REPLACE FUNCTION private.holding_value_at(p_holding uuid, p_as_of date DEFAULT NULL)
RETURNS TABLE (quantity numeric, average_cost numeric, price numeric, value numeric,
               value_thb numeric, value_date date, has_valuation boolean, last_tx_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  h public.investment_holdings;
  t public.investment_transactions;
  v public.investment_valuations;
  v_qty numeric := 0; v_avg numeric; v_q numeric;
  v_base_date date; v_base numeric := 0; v_base_thb numeric := 0; v_adj numeric := 0; v_tr numeric := 0;
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

    -- เงินโอนธนาคาร ↔ พอร์ต ที่ทราบยอดฝั่งพอร์ตแล้ว: นับเข้าบัญชีทันที (เหมือนบัญชีธนาคาร) · ก่อน / วันเดียวกับ Statement = อยู่ใน Statement แล้ว
    SELECT coalesce(sum(r.pf_amt), 0) INTO v_tr
      FROM private.pf_transfers(h.portfolio_id, v_upto) r
     WHERE r.ch = h.id AND r.in_holding AND r.movement_date > v_base_date;
    v_adj := v_adj + v_tr;

    quantity := v_base + v_adj; average_cost := 1; price := 1;
    value := v_base + v_adj;
    value_thb := (v_base + v_adj) * private.fx_rate(h.currency, v_fx_date);
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
    value_thb := value * private.fx_rate(h.currency, v_fx_date);
    value_date := v.valuation_date;
  ELSE
    price := NULL;
    value := v_qty * coalesce(v_avg, 0);             -- ราคาทุน · รอ Statement
    value_thb := value * private.fx_rate(h.currency, v_fx_date);
    value_date := NULL;
  END IF;
  RETURN NEXT;
END $$;

-- 3) เงินระหว่างทาง: เหลือเฉพาะรายการที่ยังไม่นับในบัญชีเงินฝาก (รอยอด / บัญชีไม่ตรง) -----------------
--   เงื่อนไขวันที่เหมือนเดิม: นับจนกว่าบัญชีที่รับ / จ่ายมี Statement หลังวันโอน
--   ถอนออกที่ยังไม่ใส่ยอดฝั่งธนาคาร: เงินยังไม่ถึงธนาคาร → นับยอดที่ออกไว้ที่พอร์ตจนกว่าจะใส่ยอด (เหมือนเดิม)
CREATE OR REPLACE FUNCTION private.portfolio_in_transit(p_portfolio uuid, p_as_of date DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ccy text; v_go_live date; v_upto date := coalesce(p_as_of, 'infinity'::date);
  v_fx_date date := coalesce(p_as_of, current_date); v_sum numeric; v_pending numeric;
BEGIN
  SELECT a.currency, f.go_live_date INTO v_ccy, v_go_live
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
    JOIN public.families f ON f.id = a.family_id WHERE p.id = p_portfolio;

  SELECT
    coalesce(sum(r.pf_amt * private.fx_cross(r.pf_ccy, v_ccy, v_fx_date)) FILTER (WHERE NOT r.in_holding
      AND r.movement_date > coalesce(
           (SELECT max(v.valuation_date) FROM public.investment_valuations v
             WHERE v.holding_id = r.ch AND v.deleted_at IS NULL AND v.valuation_date <= v_upto),
           (SELECT max(t.transaction_date) FROM public.investment_transactions t
             WHERE t.holding_id = r.ch AND t.transaction_type = 'OPENING_BALANCE' AND t.deleted_at IS NULL),
           v_go_live - 1)), 0),
    coalesce(sum(r.wait_bank * private.fx_cross(r.currency, v_ccy, v_fx_date)), 0)
    INTO v_sum, v_pending
    FROM private.pf_transfers(p_portfolio, v_upto) r;
  RETURN v_sum + v_pending;
END $$;

-- 4) แก้ / ลบเงินโอนของพอร์ต → คำนวณยอดบัญชีเงินฝาก + มูลค่าพอร์ตใหม่ (เช่น แก้เฉพาะค่าธรรมเนียม) ------------
CREATE OR REPLACE FUNCTION private.tg_pf_transfer_refresh() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cash_movements; v_pf uuid;
BEGIN
  FOREACH r IN ARRAY ARRAY[OLD, NEW] LOOP
    CONTINUE WHEN r.id IS NULL OR r.movement_type NOT IN ('INVESTMENT_OUT','INVESTMENT_IN') OR r.is_derived;
    v_pf := private.portfolio_of_asset(CASE r.movement_type WHEN 'INVESTMENT_OUT' THEN r.to_asset_id ELSE r.from_asset_id END);
    CONTINUE WHEN v_pf IS NULL;
    PERFORM private.refresh_holding(h.id) FROM public.investment_holdings h
     WHERE h.portfolio_id = v_pf AND h.holding_type = 'CASH' AND h.deleted_at IS NULL;
    PERFORM private.refresh_portfolio_value(v_pf);
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS a62_pf_transfer_refresh ON public.cash_movements;
CREATE TRIGGER a62_pf_transfer_refresh AFTER INSERT OR UPDATE OR DELETE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.tg_pf_transfer_refresh();
REVOKE ALL ON FUNCTION private.tg_pf_transfer_refresh() FROM PUBLIC, anon, authenticated;

-- 5) Cache: ยอดบัญชีเงินฝากในพอร์ต + มูลค่าพอร์ต คำนวณใหม่ตามวิธีใหม่ (ค่าที่ระบบคำนวณเอง ไม่ใช่ข้อมูลที่บันทึก) ----
SELECT private.refresh_holding(h.id) FROM public.investment_holdings h WHERE h.holding_type = 'CASH' AND h.deleted_at IS NULL;
SELECT private.refresh_portfolio_value(p.id) FROM public.investment_portfolios p WHERE p.deleted_at IS NULL;
