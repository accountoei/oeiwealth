-- =====================================================================
-- ฟีเจอร์เสริม
--   1) sell_asset            : ขายทรัพย์สิน (Property / Alternative / Business) → ASSET_SALE + สถานะ SOLD
--   2) record_investment_tx  : เพิ่ม FX_EXCHANGE (แลกเงินภายในพอร์ต · สร้าง CASH Holding สกุลปลายทางให้)
--   3) investment_returns    : ผลตอบแทนต่อ Holding (THB) แยก Realized / Unrealized / Income / ส่วนจาก FX
--   4) record_reimbursement  : ผูกเงินคืนกับเคลมประกันได้ (ยอดได้รับ + สถานะเคลมอัปเดตเอง)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) ขายทรัพย์สิน
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sell_asset(
  p_asset_id uuid, p_date date, p_price numeric, p_bank_asset_id uuid DEFAULT NULL,
  p_fee numeric DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.assets; v_net numeric;
BEGIN
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบทรัพย์สินนี้' USING ERRCODE = '22023'; END IF;
  IF a.status <> 'ACTIVE' THEN RAISE EXCEPTION 'INVALID: ทรัพย์สินนี้ไม่ได้อยู่ในสถานะถืออยู่' USING ERRCODE = '22023'; END IF;
  IF NOT (a.asset_group IN ('PROPERTY','ALTERNATIVE') OR a.asset_type = 'PRIVATE_BUSINESS') THEN
    RAISE EXCEPTION 'INVALID: ขายได้เฉพาะอสังหาฯ / สินทรัพย์อื่น / ธุรกิจ (หุ้นในพอร์ตใช้รายการขายในหน้า Investments)' USING ERRCODE = '22023';
  END IF;
  IF p_date IS NULL OR p_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ขายไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ราคาขาย' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.property_leases l JOIN public.property_details pd ON pd.id = l.property_id
              WHERE pd.asset_id = a.id AND l.deleted_at IS NULL AND l.status = 'ACTIVE' AND l.end_date >= p_date) THEN
    RAISE EXCEPTION 'INVALID: ยังมีสัญญาเช่าที่มีผล — บันทึกเลิกสัญญา / คืนเงินประกันก่อน' USING ERRCODE = '22023';
  END IF;

  v_net := p_price - coalesce(p_fee, 0);
  IF p_bank_asset_id IS NOT NULL AND v_net > 0 THEN
    INSERT INTO public.cash_movements(movement_date, movement_type, from_asset_id, to_asset_id, amount, currency, description, notes, metadata)
    VALUES (p_date, 'ASSET_SALE', a.id, p_bank_asset_id, v_net, a.currency, 'ขาย · ' || a.name, nullif(trim(p_notes), ''),
            jsonb_build_object('sale_price', p_price, 'fee', coalesce(p_fee, 0)));
  END IF;
  -- มูลค่า ณ วันขาย = ราคาขาย (ให้กำไร/ขาดทุนเทียบได้ และเดือนที่ขายใช้ยอดนี้)
  IF NOT EXISTS (SELECT 1 FROM public.asset_valuations WHERE asset_id = a.id AND valuation_date = p_date AND deleted_at IS NULL) THEN
    INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
    VALUES (a.id, p_date, p_price, 'LATEST_TRANSACTION', 'USER', 'ราคาขาย');
  END IF;
  UPDATE public.private_business_details SET status = 'SOLD' WHERE asset_id = a.id AND deleted_at IS NULL;
  UPDATE public.assets SET status = 'SOLD',
         notes = concat_ws(' · ', notes, 'ขาย ' || to_char(p_date, 'DD/MM/YYYY') || ' ราคา ' || p_price::text)
   WHERE id = a.id;
END $$;

-- ---------------------------------------------------------------------
-- 2) record_investment_tx + FX_EXCHANGE
--    p_tx (FX): {"type":"FX_EXCHANGE","date","amount","currency","counter_amount","counter_currency","fee","notes"}
-- ---------------------------------------------------------------------
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
  IF NOT EXISTS (SELECT 1 FROM public.investment_holdings WHERE portfolio_id = v_pf AND holding_type = 'CASH'
                  AND currency = v_to AND deleted_at IS NULL) THEN
    PERFORM public.add_holding(p_portfolio_asset_id, 'CASH', 'เงินสด ' || v_to, NULL, v_to, NULL, NULL, NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.investment_holdings WHERE portfolio_id = v_pf AND holding_type = 'CASH'
                  AND currency = v_from AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: พอร์ตนี้ไม่มีเงินสดสกุล %', v_from USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.investment_transactions(portfolio_id, transaction_date, transaction_type, amount, currency,
              counter_amount, counter_currency, actual_fx_rate, fee, notes)
  VALUES (v_pf, v_date, 'FX_EXCHANGE', (p_tx->>'amount')::numeric, v_from, (p_tx->>'counter_amount')::numeric, v_to,
          nullif(p_tx->>'actual_fx_rate', '')::numeric, nullif(p_tx->>'fee', '')::numeric, nullif(trim(p_tx->>'notes'), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------
-- 3) ผลตอบแทนต่อ Holding (Average Cost · ฐาน THB · นับตั้งแต่ยอดตั้งต้น / Go-live)
--    realized   = เงินขาย − ต้นทุนเฉลี่ยของส่วนที่ขาย
--    unrealized = มูลค่าปัจจุบัน − ต้นทุนส่วนที่ยังถือ
--    *_fx       = ส่วนของกำไร/ขาดทุนที่มาจากค่าเงิน (Holding สกุลต่างประเทศ)
-- ---------------------------------------------------------------------
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
            ORDER BY x.status, x.name
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

-- ---------------------------------------------------------------------
-- 4) เงินคืน + ผูกเคลมประกัน
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_reimbursement(uuid, date, numeric, uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.record_reimbursement(
  p_expense_item_id uuid, p_received_date date, p_amount numeric,
  p_received_to_asset_id uuid DEFAULT NULL, p_received_to_credit_card_id uuid DEFAULT NULL, p_notes text DEFAULT NULL,
  p_insurance_claim_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE i public.expense_items; v_got numeric; v_cap numeric; v_id uuid;
BEGIN
  SELECT * INTO i FROM public.expense_items WHERE id = p_expense_item_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบค่าใช้จ่ายนี้' USING ERRCODE = '22023'; END IF;
  IF NOT i.is_reimbursable THEN RAISE EXCEPTION 'INVALID: ค่าใช้จ่ายนี้ไม่ได้ตั้งว่าจะได้เงินคืน' USING ERRCODE = '22023'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดเงินคืน' USING ERRCODE = '22023'; END IF;
  IF p_received_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่เป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(sum(amount), 0) INTO v_got FROM public.expense_reimbursements WHERE expense_item_id = i.id AND deleted_at IS NULL;
  v_cap := coalesce(i.expected_reimbursement_amount, i.amount);
  IF v_got + p_amount > v_cap THEN
    RAISE EXCEPTION 'INVALID: เงินคืนเกินยอดค้างรับ (ค้างอีก % %)', round(v_cap - v_got, 2), i.currency USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.expense_reimbursements(expense_item_id, insurance_claim_id, received_date, amount, currency,
              received_to_asset_id, received_to_credit_card_id, notes)
  VALUES (i.id, p_insurance_claim_id, p_received_date, p_amount, i.currency, p_received_to_asset_id, p_received_to_credit_card_id,
          nullif(trim(p_notes), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ยอดได้รับของเคลม = ผลรวมเงินคืนที่ผูก + ปรับสถานะเคลมให้ (จ่ายบางส่วน / จ่ายครบ)
CREATE OR REPLACE FUNCTION private.refresh_claim(p_claim uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_sum numeric; v_n int;
BEGIN
  IF p_claim IS NULL THEN RETURN; END IF;
  SELECT sum(r.amount), count(*) INTO v_sum, v_n FROM public.expense_reimbursements r
   WHERE r.insurance_claim_id = p_claim AND r.deleted_at IS NULL;
  IF v_n > 0 THEN
    UPDATE public.insurance_claims c SET received_amount = v_sum,
           status = CASE WHEN c.status NOT IN ('DRAFT','SUBMITTED','APPROVED','PARTIALLY_PAID','PAID') THEN c.status
                         WHEN c.claimed_amount IS NULL OR v_sum >= c.claimed_amount THEN 'PAID'
                         ELSE 'PARTIALLY_PAID' END
     WHERE c.id = p_claim;
  END IF;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.sell_asset(uuid,date,numeric,uuid,numeric,text)', 'public.record_investment_fx(uuid,jsonb)',
    'public.investment_returns(uuid)', 'public.record_reimbursement(uuid,date,numeric,uuid,uuid,text,uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
