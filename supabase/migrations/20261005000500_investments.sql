-- =====================================================================
-- Investments (Core Schema Section 11–15)
--   create_portfolio       : assets + investment_portfolios + ownerships + CASH Holding (+ เงินสดตั้งต้น)
--   add_holding            : Holding ใหม่ (+ OPENING_BALANCE + ราคาตลาด ณ วันตั้งต้น)
--   record_investment_tx   : BUY / SELL / DIVIDEND / INTEREST / COUPON / REDEMPTION / FEE / TAX / ADJUSTMENT
--                            (สร้าง Holding ใหม่ได้ในขั้นเดียว · ตรวจขายเกินที่ถือ)
--   SECURITY INVOKER: RLS / Guard / Period Lock / Go-live Lock ทำงานตามสิทธิ์ผู้เรียก
-- =====================================================================

-- ต้นทุน THB ของยอดตั้งต้น: cost_base_thb > fx_rate ที่ผู้ใช้ใส่ > Rate ของระบบ ณ วันตั้งต้น
CREATE OR REPLACE FUNCTION public.add_holding(
  p_portfolio_asset_id uuid,
  p_holding_type       text,
  p_name               text,
  p_symbol             text    DEFAULT NULL,
  p_currency           text    DEFAULT NULL,
  p_maturity_date      date    DEFAULT NULL,
  p_opening            jsonb   DEFAULT NULL,  -- {"quantity","price","cost_base_thb","fx_rate","market_price","market_value","notes"}
  p_notes              text    DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_pf uuid; v_pf_ccy text; v_go_live date; v_open date; v_ccy text; v_id uuid;
  v_qty numeric; v_price numeric; v_cost numeric; v_fx numeric; v_mp numeric; v_mv numeric;
BEGIN
  SELECT p.id, a.currency, f.go_live_date INTO v_pf, v_pf_ccy, v_go_live
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
    JOIN public.families f ON f.id = a.family_id
   WHERE p.asset_id = p_portfolio_asset_id AND p.deleted_at IS NULL AND a.deleted_at IS NULL;
  IF v_pf IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบพอร์ตนี้' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อหลักทรัพย์' USING ERRCODE = '22023';
  END IF;
  v_ccy := upper(coalesce(nullif(p_currency, ''), v_pf_ccy));
  v_open := v_go_live - 1;

  INSERT INTO public.investment_holdings(portfolio_id, holding_type, name, symbol, currency, maturity_date, notes)
  VALUES (v_pf, p_holding_type, trim(p_name), nullif(upper(trim(p_symbol)), ''), v_ccy, p_maturity_date, p_notes)
  RETURNING id INTO v_id;

  IF p_opening IS NOT NULL AND nullif(p_opening->>'quantity', '') IS NOT NULL THEN
    v_qty   := (p_opening->>'quantity')::numeric;
    v_price := CASE WHEN p_holding_type = 'CASH' THEN 1 ELSE nullif(p_opening->>'price', '')::numeric END;
    IF v_qty IS NULL OR v_qty < 0 OR v_price IS NULL OR v_price < 0 THEN
      RAISE EXCEPTION 'INVALID: ยอดตั้งต้นต้องมีจำนวนและต้นทุนเฉลี่ยต่อหน่วย' USING ERRCODE = '22023';
    END IF;
    v_cost := nullif(p_opening->>'cost_base_thb', '')::numeric;
    v_fx   := nullif(p_opening->>'fx_rate', '')::numeric;
    IF v_ccy <> 'THB' AND v_cost IS NULL AND v_fx IS NULL THEN
      v_fx := private.fx_rate(v_ccy, v_open);
      IF v_fx IS NULL THEN
        RAISE EXCEPTION 'INVALID: ยังไม่มีอัตราแลกเปลี่ยน % ณ วันตั้งต้น — ใส่ต้นทุนเป็นบาท หรือ FX ตอนซื้อ', v_ccy
          USING ERRCODE = '22023';
      END IF;
    END IF;
    INSERT INTO public.investment_transactions(portfolio_id, holding_id, transaction_date, transaction_type,
                quantity, price, amount, currency, cost_base_currency, actual_fx_rate, notes)
    VALUES (v_pf, v_id, v_open, 'OPENING_BALANCE', v_qty, v_price, round(v_qty * v_price, 4), v_ccy,
            v_cost, CASE WHEN v_ccy <> 'THB' THEN v_fx END,
            coalesce(nullif(trim(p_opening->>'notes'), ''), 'ยอดตั้งต้น'));

    -- ราคาตลาด ณ วันตั้งต้น (ไม่ใช่ CASH)
    v_mp := nullif(p_opening->>'market_price', '')::numeric;
    v_mv := nullif(p_opening->>'market_value', '')::numeric;
    IF p_holding_type <> 'CASH' AND (v_mp IS NOT NULL OR v_mv IS NOT NULL) THEN
      INSERT INTO public.investment_valuations(holding_id, valuation_date, price, quantity, market_value, source)
      VALUES (v_id, v_open, v_mp, v_qty, coalesce(v_mv, round(v_mp * v_qty, 4)), 'STATEMENT');
    END IF;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.create_portfolio(
  p_name            text,
  p_institution     text,
  p_currency        text,
  p_portfolio_type  text    DEFAULT 'BROKERAGE',
  p_start_date      date    DEFAULT NULL,
  p_is_opening      boolean DEFAULT false,
  p_opening_cash    numeric DEFAULT NULL,
  p_owners          jsonb   DEFAULT '[]'::jsonb,
  p_notes           text    DEFAULT NULL,
  p_opening_fx      numeric DEFAULT NULL)    -- FX ของเงินสดตั้งต้นสกุลต่างประเทศ (ไม่ใส่ = Rate ระบบ ณ วันตั้งต้น)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_family uuid; v_go_live date; v_asset uuid; o jsonb; v_ccy text := upper(coalesce(p_currency, 'THB'));
BEGIN
  IF length(trim(coalesce(p_name, ''))) = 0 OR length(trim(coalesce(p_institution, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อพอร์ตและสถาบัน' USING ERRCODE = '22023';
  END IF;
  SELECT id, go_live_date INTO v_family, v_go_live FROM public.families WHERE deleted_at IS NULL LIMIT 1;
  IF v_family IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED: ไม่พบข้อมูลครอบครัว' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency, acquisition_date, notes)
  VALUES (v_family, 'INVESTMENT', 'INVESTMENT_PORTFOLIO', trim(p_name), v_ccy,
          CASE WHEN NOT p_is_opening THEN coalesce(p_start_date, current_date) END, p_notes)
  RETURNING id INTO v_asset;

  INSERT INTO public.investment_portfolios(asset_id, institution, portfolio_type, start_date, notes)
  VALUES (v_asset, trim(p_institution), coalesce(p_portfolio_type, 'BROKERAGE'), p_start_date, p_notes);

  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p_owners, '[]'::jsonb)) LOOP
    INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
    VALUES (v_asset, (o->>'person_id')::uuid, (o->>'percent')::numeric,
            CASE WHEN p_is_opening THEN v_go_live - 1 ELSE coalesce(p_start_date, current_date) END);
  END LOOP;

  -- เงินสดในพอร์ต (สกุลพอร์ต) — รับเงินโอนเข้าจาก Transfer Money
  PERFORM public.add_holding(v_asset, 'CASH', 'เงินสด ' || v_ccy, NULL, v_ccy, NULL,
    CASE WHEN p_is_opening THEN jsonb_build_object('quantity', coalesce(p_opening_cash, 0), 'fx_rate', p_opening_fx, 'notes', p_notes) END);
  RETURN v_asset;
END $$;

-- p_tx: {"type","date","settlement_date","holding_id" | "new_holding":{"holding_type","name","symbol","maturity_date"},
--        "quantity","price","amount","fee","tax","settle_bank_asset_id","direction","notes"}
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
    quantity, price, amount, currency, direction, settle_from_asset_id, settle_to_asset_id, fee, tax, notes)
  VALUES (
    v_pf, v_holding, v_date, nullif(p_tx->>'settlement_date', '')::date, v_type,
    v_qty, v_price, v_amount, v_ccy, CASE WHEN v_type = 'ADJUSTMENT' THEN p_tx->>'direction' END,
    CASE WHEN v_type = 'BUY' THEN v_bank END,
    CASE WHEN v_type IN ('SELL','REDEMPTION','DIVIDEND','INTEREST','COUPON') THEN v_bank END,
    nullif(p_tx->>'fee', '')::numeric, nullif(p_tx->>'tax', '')::numeric, nullif(trim(p_tx->>'notes'), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.add_holding(uuid,text,text,text,text,date,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_holding(uuid,text,text,text,text,date,jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_portfolio(text,text,text,text,date,boolean,numeric,jsonb,text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_portfolio(text,text,text,text,date,boolean,numeric,jsonb,text,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.record_investment_tx(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_investment_tx(uuid, jsonb) TO authenticated;
