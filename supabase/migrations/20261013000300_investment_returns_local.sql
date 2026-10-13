-- =====================================================================
-- ผลตอบแทนในสกุลของหลักทรัพย์ (ไม่แปลงเป็นบาท) — ใช้กับปุ่ม "ดูเป็น USD / ดูเป็นบาท" ในหน้าพอร์ต
--   ตัวเลขทุกช่องอยู่ในสกุลของหลักทรัพย์ (Holding currency) · หน้าเว็บแปลงเป็นสกุลพอร์ตด้วยอัตราล่าสุด
--   วิธีคิดเหมือน investment_returns (ต้นทุนเฉลี่ย · นับตั้งแต่ยอดตั้งต้น / Go-live) แต่ไม่มีส่วนค่าเงิน
-- =====================================================================
DROP FUNCTION IF EXISTS public.investment_returns_local(uuid);
CREATE FUNCTION public.investment_returns_local(p_portfolio_asset_id uuid)
RETURNS TABLE (holding_id uuid, name text, holding_type text, currency text, status text,
               cost numeric, value numeric, unrealized numeric, realized numeric, income numeric, fees numeric, total numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  h public.investment_holdings; t public.investment_transactions; hv record;
  q numeric; c numeric; r numeric; inc numeric; f numeric; v_sold numeric; v_avg numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  FOR h IN SELECT x.* FROM public.investment_holdings x JOIN public.investment_portfolios p ON p.id = x.portfolio_id
            WHERE p.asset_id = p_portfolio_asset_id AND x.deleted_at IS NULL AND x.holding_type <> 'CASH'
            ORDER BY x.status, x.name
  LOOP
    q := 0; c := 0; r := 0; inc := 0; f := 0;
    FOR t IN SELECT * FROM public.investment_transactions x WHERE x.holding_id = h.id AND x.deleted_at IS NULL
              ORDER BY x.transaction_date, x.created_at
    LOOP
      CASE t.transaction_type
        WHEN 'OPENING_BALANCE' THEN q := coalesce(t.quantity, 0); c := t.amount;
        WHEN 'BUY' THEN q := q + coalesce(t.quantity, 0); c := c + t.amount + coalesce(t.fee, 0);
        WHEN 'SELL', 'REDEMPTION', 'MATURITY' THEN
          v_sold := CASE WHEN t.transaction_type = 'MATURITY' OR t.quantity IS NULL THEN q ELSE least(t.quantity, q) END;
          v_avg := CASE WHEN q > 0 THEN c / q ELSE 0 END;
          r := r + (t.amount - coalesce(t.fee, 0) - coalesce(t.tax, 0)) - v_avg * v_sold;
          q := q - v_sold; c := c - v_avg * v_sold;
        WHEN 'DIVIDEND', 'INTEREST', 'COUPON' THEN inc := inc + t.amount - coalesce(t.tax, 0) - coalesce(t.fee, 0);
        WHEN 'FEE', 'TAX' THEN f := f + t.amount;
        WHEN 'ADJUSTMENT' THEN
          IF t.quantity IS NOT NULL THEN q := greatest(q + CASE t.direction WHEN 'IN' THEN t.quantity ELSE -t.quantity END, 0); END IF;
        ELSE NULL;
      END CASE;
    END LOOP;
    SELECT * INTO hv FROM private.holding_value_at(h.id, NULL);
    holding_id := h.id; name := h.name; holding_type := h.holding_type; currency := h.currency; status := h.status;
    cost := round(CASE WHEN q > 0 THEN c ELSE 0 END, 2);
    value := round(CASE WHEN q > 0 THEN coalesce(hv.value, 0) ELSE 0 END, 2);
    unrealized := value - cost;
    realized := round(r, 2); income := round(inc, 2); fees := round(f, 2);
    total := unrealized + realized + income - fees;
    RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.investment_returns_local(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.investment_returns_local(uuid) TO authenticated;
