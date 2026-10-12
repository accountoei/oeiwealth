-- =====================================================================
-- พอร์ตลงทุน: แปลงเป็นบาทด้วยอัตรา ณ วันที่ดูยอด (เหมือนบัญชีเงินฝากสกุลต่างประเทศ)
--   เดิม: หลักทรัพย์ใช้อัตราของวัน Statement (ล็อกไว้จนมี Statement ใหม่) · เงินสดใช้อัตราวันตั้งต้น + อัตราปัจจุบันส่วนที่เปลี่ยน
--   ใหม่: มูลค่าในสกุลเดิม (ตาม Statement / ราคาทุน / เงินสดคำนวณ) × fx_rate(สกุล, วันที่ดูยอด)
--   เดือนที่ปิดงวดแล้วไม่เปลี่ยน (อ่านจาก Snapshot)
--   View: v_holdings_active + value_thb / fx_rate / fx_rate_date · v_portfolio_values + portfolio_value / portfolio_fx_rate
-- =====================================================================

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

-- เพิ่มคอลัมน์ท้าย View (คอลัมน์เดิมไม่เปลี่ยน)
CREATE OR REPLACE VIEW public.v_holdings_active WITH (security_invoker = true) AS
  SELECT h.*, p.asset_id AS portfolio_asset_id,
         CASE WHEN h.status = 'ACTIVE' AND h.maturity_date IS NOT NULL
                   AND h.maturity_date BETWEEN current_date AND current_date + 30 THEN 'MATURITY_SOON' END AS derived_status,
         (h.holding_type <> 'CASH' AND NOT EXISTS (SELECT 1 FROM public.investment_valuations v
            WHERE v.holding_id = h.id AND v.deleted_at IS NULL)) AS valued_at_cost,      -- ป้าย "ราคาทุน · รอ Statement"
         hv.value_thb,                                                              -- บาท ณ วันนี้ (ชุดเดียวกับ Net Worth)
         private.fx_rate(h.currency, current_date) AS fx_rate,
         CASE WHEN h.currency <> 'THB' THEN (private.fx_rate_row(h.currency, current_date)).rate_date END AS fx_rate_date
    FROM public.investment_holdings h
    JOIN public.investment_portfolios p ON p.id = h.portfolio_id
    JOIN public.assets a ON a.id = p.asset_id
    LEFT JOIN LATERAL private.holding_value_at(h.id, NULL) hv ON true
   WHERE h.deleted_at IS NULL AND p.deleted_at IS NULL AND a.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.v_portfolio_values WITH (security_invoker = true) AS
  SELECT p.id AS portfolio_id, p.asset_id, a.name, a.currency AS portfolio_currency,
         a.current_value AS display_value, a.current_value_date AS display_value_date,
         (SELECT sum(hv.value_thb) FROM public.investment_holdings h
            CROSS JOIN LATERAL private.holding_value_at(h.id, current_date) hv
           WHERE h.portfolio_id = p.id AND h.deleted_at IS NULL) AS thb_value,
         private.portfolio_in_transit(p.id, current_date) AS in_transit,
         private.portfolio_in_transit(p.id, current_date) * private.fx_rate(a.currency, current_date) AS in_transit_thb,
         -- มูลค่าพอร์ตในสกุลพอร์ต ณ วันนี้ (ไม่รวมเงินระหว่างทาง) = บาท ÷ อัตราสกุลพอร์ต
         (SELECT sum(hv.value_thb) FROM public.investment_holdings h
            CROSS JOIN LATERAL private.holding_value_at(h.id, current_date) hv
           WHERE h.portfolio_id = p.id AND h.deleted_at IS NULL)
           / nullif(private.fx_rate(a.currency, current_date), 0) AS portfolio_value,
         private.fx_rate(a.currency, current_date) AS portfolio_fx_rate
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
   WHERE p.deleted_at IS NULL AND a.deleted_at IS NULL
     AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');

GRANT SELECT ON public.v_holdings_active, public.v_portfolio_values TO authenticated, service_role;

-- Cache มูลค่าพอร์ต (assets.current_value) ใช้อัตราล่าสุดตอนคำนวณ → คำนวณใหม่ทุกพอร์ต
SELECT private.refresh_portfolio_value(p.id) FROM public.investment_portfolios p WHERE p.deleted_at IS NULL;
