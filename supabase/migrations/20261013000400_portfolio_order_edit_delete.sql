-- =====================================================================
-- หน้าพอร์ต: จัดลำดับเงินสด / หลักทรัพย์ · แก้ไขพอร์ต · ลบพอร์ตเฉพาะ ADMIN
--   * investment_holdings.sort_order + move_holding(holding, ±1) (สลับภายในกลุ่มเดียวกัน: เงินสด / หลักทรัพย์)
--   * update_portfolio(asset, jsonb): ชื่อ / สถาบัน / ประเภท / สกุลพอร์ต / หมายเหตุ
--   * ลบ (soft delete) พอร์ตลงทุนได้เฉพาะ ADMIN — บังคับด้วย Trigger ที่ assets และ investment_portfolios
--   * ตารางผลตอบแทนเรียงตามลำดับเดียวกัน
-- =====================================================================

-- 1) ลำดับ ---------------------------------------------------------------------
ALTER TABLE public.investment_holdings ADD COLUMN IF NOT EXISTS sort_order integer;

-- ข้อมูลเดิม: เงินสดก่อน (ตามสกุล → ชื่อ) แล้วหลักทรัพย์ (ตามประเภท → ชื่อ) — ตรงกับที่เห็นอยู่
WITH base AS (
  SELECT portfolio_id, coalesce(max(sort_order), 0) AS mx FROM public.investment_holdings GROUP BY portfolio_id
), r AS (
  SELECT h.id, b.mx + row_number() OVER (PARTITION BY h.portfolio_id ORDER BY
           h.holding_type <> 'CASH', CASE WHEN h.holding_type = 'CASH' THEN h.currency ELSE h.holding_type END,
           h.name, h.created_at) AS n
    FROM public.investment_holdings h JOIN base b ON b.portfolio_id = h.portfolio_id
   WHERE h.sort_order IS NULL
)
UPDATE public.investment_holdings h SET sort_order = r.n FROM r WHERE h.id = r.id;

CREATE OR REPLACE FUNCTION private.tg_holding_sort_order() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.sort_order IS NULL THEN
    SELECT coalesce(max(sort_order), 0) + 1 INTO NEW.sort_order FROM public.investment_holdings WHERE portfolio_id = NEW.portfolio_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_holding_sort_order() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t16_sort_order ON public.investment_holdings;
CREATE TRIGGER t16_sort_order BEFORE INSERT ON public.investment_holdings
  FOR EACH ROW EXECUTE FUNCTION private.tg_holding_sort_order();

DROP FUNCTION IF EXISTS public.move_holding(uuid, integer);
CREATE FUNCTION public.move_holding(p_holding_id uuid, p_direction integer)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE h public.investment_holdings; v_target uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF p_direction NOT IN (-1, 1) THEN RAISE EXCEPTION 'INVALID: ทิศทางต้องเป็น -1 หรือ 1' USING ERRCODE = '22023'; END IF;
  SELECT * INTO h FROM public.investment_holdings WHERE id = p_holding_id AND deleted_at IS NULL;
  IF h.id IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบรายการนี้' USING ERRCODE = '22023'; END IF;

  -- เรียงเลขใหม่ 1..n ทั้งพอร์ต (เงินสดก่อน) ให้ต่อเนื่อง
  WITH o AS (
    SELECT id, row_number() OVER (ORDER BY holding_type <> 'CASH', sort_order NULLS LAST, created_at)::integer AS n
      FROM public.investment_holdings WHERE portfolio_id = h.portfolio_id AND deleted_at IS NULL
  )
  UPDATE public.investment_holdings x SET sort_order = o.n FROM o WHERE x.id = o.id AND x.sort_order IS DISTINCT FROM o.n;
  SELECT * INTO h FROM public.investment_holdings WHERE id = p_holding_id;

  -- ตัวข้าง ๆ ในกลุ่มเดียวกัน (เงินสด / หลักทรัพย์)
  SELECT x.id INTO v_target FROM public.investment_holdings x
   WHERE x.portfolio_id = h.portfolio_id AND x.deleted_at IS NULL
     AND (x.holding_type = 'CASH') = (h.holding_type = 'CASH')
     AND x.sort_order = h.sort_order + p_direction;
  IF v_target IS NULL THEN RETURN; END IF;     -- บนสุด / ล่างสุดของกลุ่มแล้ว
  UPDATE public.investment_holdings SET sort_order = h.sort_order WHERE id = v_target;
  UPDATE public.investment_holdings SET sort_order = h.sort_order + p_direction WHERE id = h.id;
END $$;
REVOKE ALL ON FUNCTION public.move_holding(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_holding(uuid, integer) TO authenticated;

-- 2) แก้ไขพอร์ต -----------------------------------------------------------------
DROP FUNCTION IF EXISTS public.update_portfolio(uuid, jsonb);
CREATE FUNCTION public.update_portfolio(p_asset_id uuid, p jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.assets; v_name text; v_ccy text; v_type text; v_n int;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id AND asset_type = 'INVESTMENT_PORTFOLIO' AND deleted_at IS NULL;
  IF a.id IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบพอร์ตนี้' USING ERRCODE = '22023'; END IF;
  v_name := nullif(trim(coalesce(p->>'name', '')), '');
  IF v_name IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อพอร์ต' USING ERRCODE = '22023'; END IF;
  v_ccy := upper(coalesce(nullif(trim(p->>'currency'), ''), a.currency));
  IF v_ccy !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'INVALID: สกุลเงินไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_ccy <> 'THB' AND private.fx_rate(v_ccy, current_date) IS NULL THEN
    RAISE EXCEPTION 'INVALID: ยังไม่มีอัตราแลกเปลี่ยน % ในระบบ', v_ccy USING ERRCODE = '22023';
  END IF;
  v_type := coalesce(nullif(p->>'portfolio_type', ''), (SELECT portfolio_type FROM public.investment_portfolios WHERE asset_id = a.id));

  UPDATE public.assets SET name = v_name, currency = v_ccy, notes = nullif(trim(coalesce(p->>'notes', '')), '')
   WHERE id = a.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'PERMISSION_DENIED: ไม่มีสิทธิ์แก้ไขพอร์ตนี้' USING ERRCODE = '42501'; END IF;
  UPDATE public.investment_portfolios
     SET institution = coalesce(nullif(trim(coalesce(p->>'institution', '')), ''), institution), portfolio_type = v_type
   WHERE asset_id = a.id AND deleted_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.update_portfolio(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_portfolio(uuid, jsonb) TO authenticated;

-- 3) ลบพอร์ตลงทุนได้เฉพาะ ADMIN ----------------------------------------------------
-- SECURITY INVOKER: ต้องเห็น current_user จริง (authenticated) จึงแยกผู้ใช้กับงานระบบได้
CREATE OR REPLACE FUNCTION private.tg_portfolio_delete_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_is_pf boolean;
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND private.is_client() AND NOT private.has_role('ADMIN') THEN
    IF TG_TABLE_NAME = 'investment_portfolios' THEN
      v_is_pf := true;
    ELSE
      v_is_pf := (to_jsonb(NEW) ->> 'asset_type') = 'INVESTMENT_PORTFOLIO';
    END IF;
    IF v_is_pf THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: ลบพอร์ตลงทุนได้เฉพาะผู้ดูแลระบบ (ADMIN)' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_portfolio_delete_admin() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t26_delete_admin ON public.assets;
CREATE TRIGGER t26_delete_admin BEFORE UPDATE OF deleted_at ON public.assets
  FOR EACH ROW EXECUTE FUNCTION private.tg_portfolio_delete_admin();
DROP TRIGGER IF EXISTS t26_delete_admin ON public.investment_portfolios;
CREATE TRIGGER t26_delete_admin BEFORE UPDATE OF deleted_at ON public.investment_portfolios
  FOR EACH ROW EXECUTE FUNCTION private.tg_portfolio_delete_admin();

-- 4) View: เพิ่ม sort_order (h.* ถูกขยายตอนสร้าง → สร้างใหม่) ---------------------------
DROP VIEW IF EXISTS public.v_holdings_active;
CREATE VIEW public.v_holdings_active WITH (security_invoker = true) AS
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
GRANT SELECT ON public.v_holdings_active TO authenticated, service_role;

-- 5) ผลตอบแทนเรียงตามลำดับกล่องหลักทรัพย์ -------------------------------------------
CREATE OR REPLACE FUNCTION public.investment_returns(p_portfolio_asset_id uuid)
RETURNS TABLE (holding_id uuid, name text, holding_type text, currency text, status text,
               cost_thb numeric, value_thb numeric, unrealized_thb numeric, unrealized_fx_thb numeric,
               realized_thb numeric, realized_fx_thb numeric, income_thb numeric, fees_thb numeric, total_thb numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  h public.investment_holdings; t public.investment_transactions; hv record;
  q numeric; c_loc numeric; c_thb numeric; r_loc numeric; r_thb numeric; r_fx numeric; inc numeric; fees numeric;
  v_rate numeric; v_sold numeric; v_proc numeric; v_now numeric; avg_l numeric; avg_t numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  FOR h IN SELECT x.* FROM public.investment_holdings x JOIN public.investment_portfolios p ON p.id = x.portfolio_id
            WHERE p.asset_id = p_portfolio_asset_id AND x.deleted_at IS NULL AND x.holding_type <> 'CASH'
            ORDER BY x.sort_order NULLS LAST, x.name
  LOOP
    q := 0; c_loc := 0; c_thb := 0; r_loc := 0; r_thb := 0; r_fx := 0; inc := 0; fees := 0;
    FOR t IN SELECT * FROM public.investment_transactions x WHERE x.holding_id = h.id AND x.deleted_at IS NULL
              ORDER BY x.transaction_date, x.created_at
    LOOP
      v_rate := CASE WHEN t.currency = 'THB' THEN 1
                     ELSE coalesce(t.amount_base_currency / nullif(t.amount, 0), private.fx_rate(t.currency, t.transaction_date), 0) END;
      CASE t.transaction_type
        WHEN 'OPENING_BALANCE' THEN
          q := coalesce(t.quantity, 0); c_loc := t.amount; c_thb := coalesce(t.cost_base_currency, t.amount * v_rate);
        WHEN 'BUY' THEN
          q := q + coalesce(t.quantity, 0); c_loc := c_loc + t.amount + coalesce(t.fee, 0);
          c_thb := c_thb + coalesce(t.cost_base_currency, (t.amount + coalesce(t.fee, 0)) * v_rate);
        WHEN 'SELL', 'REDEMPTION', 'MATURITY' THEN
          v_sold := CASE WHEN t.transaction_type = 'MATURITY' OR t.quantity IS NULL THEN q ELSE least(t.quantity, q) END;
          avg_l := CASE WHEN q > 0 THEN c_loc / q ELSE 0 END; avg_t := CASE WHEN q > 0 THEN c_thb / q ELSE 0 END;
          v_proc := t.amount - coalesce(t.fee, 0) - coalesce(t.tax, 0);
          r_loc := v_proc - avg_l * v_sold;
          r_thb := r_thb + v_proc * v_rate - avg_t * v_sold;
          r_fx := r_fx + (v_proc * v_rate - avg_t * v_sold) - r_loc * v_rate;
          q := q - v_sold; c_loc := c_loc - avg_l * v_sold; c_thb := c_thb - avg_t * v_sold;
        WHEN 'DIVIDEND', 'INTEREST', 'COUPON' THEN
          inc := inc + (t.amount - coalesce(t.tax, 0) - coalesce(t.fee, 0)) * v_rate;
        WHEN 'FEE', 'TAX' THEN fees := fees + t.amount * v_rate;
        WHEN 'ADJUSTMENT' THEN
          IF t.quantity IS NOT NULL THEN q := greatest(q + CASE t.direction WHEN 'IN' THEN t.quantity ELSE -t.quantity END, 0); END IF;
        ELSE NULL;
      END CASE;
    END LOOP;
    SELECT * INTO hv FROM private.holding_value_at(h.id, NULL);
    v_now := CASE WHEN h.currency = 'THB' THEN 1 ELSE coalesce(private.fx_rate(h.currency, current_date), 0) END;
    holding_id := h.id; name := h.name; holding_type := h.holding_type; currency := h.currency; status := h.status;
    cost_thb := round(CASE WHEN q > 0 THEN c_thb ELSE 0 END, 2);
    value_thb := round(CASE WHEN q > 0 THEN coalesce(hv.value_thb, 0) ELSE 0 END, 2);
    unrealized_thb := value_thb - cost_thb;
    -- ส่วน FX ของ Unrealized = กำไรรวม THB − (กำไรในสกุล Holding × Rate วันนี้)
    unrealized_fx_thb := CASE WHEN h.currency = 'THB' OR q <= 0 THEN 0
                              ELSE round(unrealized_thb - (coalesce(hv.value, 0) - c_loc) * v_now, 2) END;
    realized_thb := round(r_thb, 2); realized_fx_thb := round(CASE WHEN h.currency = 'THB' THEN 0 ELSE r_fx END, 2);
    income_thb := round(inc, 2); fees_thb := round(fees, 2);
    total_thb := unrealized_thb + realized_thb + income_thb - fees_thb;
    RETURN NEXT;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.investment_returns_local(p_portfolio_asset_id uuid)
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
            ORDER BY x.sort_order NULLS LAST, x.name
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
