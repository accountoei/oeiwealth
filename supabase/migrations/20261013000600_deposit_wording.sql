-- =====================================================================
-- เปลี่ยนคำในพอร์ตลงทุน: "บัญชีเงินสด" → "บัญชีเงินฝาก" · "เงินสดในพอร์ต" → "เงินฝากในพอร์ต"
--   1) ข้อความแจ้งเตือน / ชื่อบัญชีที่ระบบสร้างให้อัตโนมัติ (เช่น "เงินฝาก NZD") ในฟังก์ชันเดิม — ตรรกะไม่เปลี่ยน
--   2) เปลี่ยนชื่อบัญชีที่ระบบเคยสร้างไว้ (ชื่อตรงรูปแบบ "เงินสด XXX" เท่านั้น) เป็น "เงินฝาก XXX"
--   รันซ้ำได้
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_portfolio(p_name text, p_institution text, p_currency text, p_portfolio_type text DEFAULT 'BROKERAGE'::text, p_start_date date DEFAULT NULL::date, p_is_opening boolean DEFAULT false, p_opening_cash numeric DEFAULT NULL::numeric, p_owners jsonb DEFAULT '[]'::jsonb, p_notes text DEFAULT NULL::text, p_opening_fx numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  -- เงินฝากในพอร์ต (สกุลพอร์ต) — รับเงินโอนเข้าจาก Transfer Money
  PERFORM public.add_holding(v_asset, 'CASH', 'เงินฝาก ' || v_ccy, NULL, v_ccy, NULL,
    CASE WHEN p_is_opening THEN jsonb_build_object('quantity', coalesce(p_opening_cash, 0), 'fx_rate', p_opening_fx, 'notes', p_notes) END);
  RETURN v_asset;
END $function$
;

CREATE OR REPLACE FUNCTION public.record_investment_fx(p_portfolio_asset_id uuid, p_tx jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  -- เงินฝากสกุลปลายทาง (สร้างให้ถ้ายังไม่มี)
  IF nullif(p_tx->>'counter_cash_holding_id', '') IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.investment_holdings WHERE portfolio_id = v_pf AND holding_type = 'CASH'
                  AND currency = v_to AND deleted_at IS NULL) THEN
    PERFORM public.add_holding(p_portfolio_asset_id, 'CASH', 'เงินฝาก ' || v_to, NULL, v_to, NULL, NULL, NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.investment_holdings WHERE portfolio_id = v_pf AND holding_type = 'CASH'
                  AND currency = v_from AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: พอร์ตนี้ไม่มีเงินฝากสกุล %', v_from USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.investment_transactions(portfolio_id, transaction_date, transaction_type, amount, currency,
              counter_amount, counter_currency, actual_fx_rate, fee, notes, cash_holding_id, counter_cash_holding_id)
  VALUES (v_pf, v_date, 'FX_EXCHANGE', (p_tx->>'amount')::numeric, v_from, (p_tx->>'counter_amount')::numeric, v_to,
          nullif(p_tx->>'actual_fx_rate', '')::numeric, nullif(p_tx->>'fee', '')::numeric, nullif(trim(p_tx->>'notes'), ''),
          nullif(p_tx->>'cash_holding_id', '')::uuid, nullif(p_tx->>'counter_cash_holding_id', '')::uuid)
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.record_investment_tx(p_portfolio_asset_id uuid, p_tx jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      RAISE EXCEPTION 'INVALID: เงินฝากในพอร์ตใช้ได้กับดอกเบี้ย / ค่าธรรมเนียม / ภาษี / ปรับปรุงเท่านั้น' USING ERRCODE = '22023';
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
END $function$
;

CREATE OR REPLACE FUNCTION public.set_default_cash_account(p_holding_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE h public.investment_holdings;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO h FROM public.investment_holdings WHERE id = p_holding_id AND holding_type = 'CASH' AND deleted_at IS NULL;
  IF h.id IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบบัญชีเงินฝากนี้' USING ERRCODE = '22023'; END IF;
  UPDATE public.investment_holdings SET is_default_cash = false
   WHERE portfolio_id = h.portfolio_id AND currency = h.currency AND holding_type = 'CASH' AND is_default_cash AND id <> h.id;
  UPDATE public.investment_holdings SET is_default_cash = true WHERE id = h.id AND NOT is_default_cash;
END $function$
;

CREATE OR REPLACE FUNCTION private.tg_cash_movement_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  fa public.assets; ta public.assets; c public.investment_holdings;
  v_from_bank boolean; v_to_bank boolean; v_ccy text; v_pf uuid; v_pf_ccy text; v_to_ccy text;
  v_inv boolean := NEW.movement_type IN ('INVESTMENT_OUT','INVESTMENT_IN');
BEGIN
  NEW.family_id := coalesce(NEW.family_id, private.default_family_id());
  IF NEW.from_asset_id IS NOT NULL THEN SELECT * INTO fa FROM public.assets WHERE id = NEW.from_asset_id; END IF;
  IF NEW.to_asset_id   IS NOT NULL THEN SELECT * INTO ta FROM public.assets WHERE id = NEW.to_asset_id;   END IF;
  v_from_bank := NEW.from_asset_id IS NOT NULL AND private.is_bank_asset(NEW.from_asset_id);
  v_to_bank   := NEW.to_asset_id   IS NOT NULL AND private.is_bank_asset(NEW.to_asset_id);

  -- อย่างน้อย 1 ฝั่งเป็นบัญชีธนาคาร; ฝั่งที่เป็นบัญชีตามประเภท
  IF NOT (v_from_bank OR v_to_bank) THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: ต้องมีบัญชีธนาคารอย่างน้อย 1 ฝั่ง' USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type IN ('TRANSFER','FX_EXCHANGE') AND NOT (v_from_bank AND v_to_bank) THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: % ต้องเป็นบัญชีธนาคารทั้งสองฝั่ง', NEW.movement_type USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type IN ('EXPENSE','OTHER_OUT','SECURITY_DEPOSIT_OUT','CARD_PAYMENT','LIABILITY_PAYMENT',
                           'INVESTMENT_OUT','LOAN_DISBURSEMENT','ASSET_PURCHASE') AND NOT v_from_bank THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: % ต้องออกจากบัญชีธนาคาร', NEW.movement_type USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type IN ('INCOME','OTHER_IN','REIMBURSEMENT_IN','SECURITY_DEPOSIT_IN',
                           'INVESTMENT_IN','LOAN_PRINCIPAL_RECEIPT','ASSET_SALE') AND NOT v_to_bank THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: % ต้องเข้าบัญชีธนาคาร', NEW.movement_type USING ERRCODE = '22023';
  END IF;
  -- คู่สินทรัพย์ฝั่งตรงข้าม
  IF NEW.movement_type = 'INVESTMENT_OUT' AND ta.asset_group <> 'INVESTMENT' OR
     NEW.movement_type = 'INVESTMENT_IN'  AND fa.asset_group <> 'INVESTMENT' THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: INVESTMENT_OUT/IN ต้องคู่กับพอร์ตลงทุน' USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type = 'LOAN_DISBURSEMENT'      AND ta.asset_type <> 'LOAN_RECEIVABLE' OR
     NEW.movement_type = 'LOAN_PRINCIPAL_RECEIPT' AND fa.asset_type <> 'LOAN_RECEIVABLE' THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: เงินให้กู้ต้องคู่กับ Asset ประเภท LOAN_RECEIVABLE' USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type = 'ASSET_PURCHASE' AND (v_to_bank OR ta.asset_type IN ('INVESTMENT_PORTFOLIO','LOAN_RECEIVABLE')) OR
     NEW.movement_type = 'ASSET_SALE'     AND (v_from_bank OR fa.asset_type IN ('INVESTMENT_PORTFOLIO','LOAN_RECEIVABLE')) THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: ซื้อ/ขายสินทรัพย์ต้องคู่กับ Property / Alternative / Business' USING ERRCODE = '22023';
  END IF;

  -- บัญชีเงินฝากในพอร์ต (เฉพาะโอนพอร์ต): ต้องเป็นเงินฝากของพอร์ตนั้น · สกุลของฝั่งพอร์ต = สกุลบัญชีนั้น
  IF v_inv THEN
    v_pf := private.portfolio_of_asset(CASE NEW.movement_type WHEN 'INVESTMENT_OUT' THEN NEW.to_asset_id ELSE NEW.from_asset_id END);
    IF NEW.cash_holding_id IS NULL AND NEW.counter_currency IS NOT NULL THEN
      NEW.cash_holding_id := private.default_cash_holding(v_pf,
        CASE NEW.movement_type WHEN 'INVESTMENT_OUT' THEN NEW.counter_currency ELSE NEW.currency END);
    END IF;
    IF NEW.cash_holding_id IS NOT NULL THEN
      SELECT * INTO c FROM public.investment_holdings WHERE id = NEW.cash_holding_id;
      IF c.portfolio_id IS DISTINCT FROM v_pf OR c.holding_type <> 'CASH' OR c.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVALID: บัญชีเงินฝากไม่ได้อยู่ในพอร์ตนี้' USING ERRCODE = '22023';
      END IF;
      v_pf_ccy := c.currency;
    END IF;
  ELSIF NEW.cash_holding_id IS NOT NULL OR coalesce(NEW.counter_fee, 0) <> 0 THEN
    RAISE EXCEPTION 'INVALID: บัญชีเงินฝากในพอร์ต / ค่าธรรมเนียมปลายทาง ใช้กับการโอนพอร์ตเท่านั้น' USING ERRCODE = '22023';
  END IF;

  -- สกุลเงิน (Section 25A โครงสร้าง Movement)
  IF NEW.from_asset_id IS NOT NULL
     AND (CASE WHEN NEW.movement_type = 'INVESTMENT_IN' AND v_pf_ccy IS NOT NULL THEN v_pf_ccy ELSE fa.currency END) <> NEW.currency THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: สกุลต้นทาง (%) ต้องเท่ากับ currency (%)',
      CASE WHEN NEW.movement_type = 'INVESTMENT_IN' AND v_pf_ccy IS NOT NULL THEN v_pf_ccy ELSE fa.currency END, NEW.currency
      USING ERRCODE = '22023';
  END IF;
  v_to_ccy := CASE WHEN NEW.movement_type = 'FX_EXCHANGE' OR (v_inv AND NEW.counter_currency IS NOT NULL)
                   THEN NEW.counter_currency ELSE NEW.currency END;
  IF NEW.to_asset_id IS NOT NULL
     AND (CASE WHEN NEW.movement_type = 'INVESTMENT_OUT' AND v_pf_ccy IS NOT NULL THEN v_pf_ccy ELSE ta.currency END) <> v_to_ccy THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: สกุลปลายทาง (%) ไม่ตรงกับรายการ',
      CASE WHEN NEW.movement_type = 'INVESTMENT_OUT' AND v_pf_ccy IS NOT NULL THEN v_pf_ccy ELSE ta.currency END
      USING ERRCODE = '22023';
  END IF;
  IF coalesce(NEW.fee, 0) > 0 AND NEW.fee_currency <> NEW.currency THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: fee_currency ต้องเท่ากับสกุลบัญชีต้นทาง' USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type = 'CARD_PAYMENT' THEN
    SELECT currency INTO v_ccy FROM public.credit_cards WHERE id = NEW.to_credit_card_id;
    IF v_ccy <> NEW.currency THEN RAISE EXCEPTION 'INVALID_CURRENCY: สกุลบัตรไม่ตรงกับรายการ' USING ERRCODE = '22023'; END IF;
  ELSIF NEW.movement_type = 'LIABILITY_PAYMENT' THEN
    SELECT currency INTO v_ccy FROM public.liabilities WHERE id = NEW.to_liability_id;
    IF v_ccy <> NEW.currency THEN RAISE EXCEPTION 'INVALID_CURRENCY: สกุลหนี้ไม่ตรงกับรายการ' USING ERRCODE = '22023'; END IF;
  END IF;

  -- อัตราจริงจากยอด 2 ฝั่ง (คู่ที่มี THB เท่านั้น)
  IF NEW.movement_type = 'FX_EXCHANGE' THEN
    IF NEW.currency <> 'THB' AND NEW.counter_currency <> 'THB' THEN
      NEW.actual_fx_rate := NULL;
    ELSIF NEW.actual_fx_rate IS NULL THEN
      NEW.actual_fx_rate := CASE WHEN NEW.currency = 'THB' THEN round(NEW.amount / NEW.counter_amount, 10)
                                 ELSE round(NEW.counter_amount / NEW.amount, 10) END;
    END IF;
  ELSIF v_inv AND NEW.counter_amount IS NOT NULL AND NEW.counter_currency <> NEW.currency
        AND 'THB' IN (NEW.currency, NEW.counter_currency) THEN
    -- โอนพอร์ตข้ามสกุล: คำนวณใหม่ทุกครั้ง (ยอดปลายทางแก้ทีหลังได้)
    NEW.actual_fx_rate := CASE WHEN NEW.currency = 'THB' THEN round(NEW.amount / NEW.counter_amount, 10)
                               ELSE round(NEW.counter_amount / NEW.amount, 10) END;
  ELSIF v_inv AND NEW.counter_currency IS NOT NULL THEN
    NEW.actual_fx_rate := NULL;
  ELSIF NEW.currency = 'THB' THEN
    NEW.actual_fx_rate := NULL;
  END IF;

  -- base_amount (THB): Rate จริง → Previous Available Rate
  NEW.base_amount := round(NEW.amount * CASE
      WHEN NEW.currency = 'THB' THEN 1
      WHEN NEW.actual_fx_rate IS NOT NULL THEN NEW.actual_fx_rate
      ELSE private.fx_rate(NEW.currency, NEW.movement_date) END, 4);
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION private.tg_itx_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- บัญชีเงินฝากในพอร์ตที่เงินเข้า / ออก
  IF NEW.transaction_type = 'OPENING_BALANCE' OR v_bank IS NOT NULL THEN
    NEW.cash_holding_id := NULL; NEW.counter_cash_holding_id := NULL;
  ELSE
    IF h.id IS NOT NULL AND h.holding_type = 'CASH' THEN
      NEW.cash_holding_id := h.id;                          -- รายการของบัญชีเงินฝากเอง (ดอกเบี้ย / ค่าธรรมเนียม / โอนเข้า)
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
        RAISE EXCEPTION 'INVALID: บัญชีเงินฝากไม่ได้อยู่ในพอร์ตนี้' USING ERRCODE = '22023';
      END IF;
      IF c.currency <> NEW.currency THEN
        RAISE EXCEPTION 'INVALID: บัญชีเงินฝาก (%) ต้องสกุลเดียวกับรายการ (%)', c.currency, NEW.currency USING ERRCODE = '22023';
      END IF;
    END IF;
    IF NEW.counter_cash_holding_id IS NOT NULL THEN
      SELECT * INTO c FROM public.investment_holdings WHERE id = NEW.counter_cash_holding_id;
      IF c.portfolio_id IS DISTINCT FROM NEW.portfolio_id OR c.holding_type <> 'CASH' OR c.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVALID: บัญชีเงินฝากปลายทางไม่ได้อยู่ในพอร์ตนี้' USING ERRCODE = '22023';
      END IF;
      IF c.currency <> NEW.counter_currency THEN
        RAISE EXCEPTION 'INVALID: บัญชีเงินฝากปลายทาง (%) ต้องสกุลเดียวกับยอดที่ได้รับ (%)', c.currency, NEW.counter_currency
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
END $function$
;

CREATE OR REPLACE FUNCTION public.transfer_portfolio_cash(p_portfolio_asset_id uuid, p_tx jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    RAISE EXCEPTION 'INVALID: เลือกบัญชีเงินฝากต้นทางและปลายทางในพอร์ตนี้' USING ERRCODE = '22023';
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
END $function$
;

CREATE OR REPLACE FUNCTION public.transfer_portfolio_money(p_portfolio_asset_id uuid, p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_pf uuid; v_pf_ccy text; b public.assets; c public.investment_holdings; v_in boolean; v_id uuid;
  v_amount numeric := nullif(replace(p->>'amount', ',', ''), '')::numeric;
  v_fee numeric := nullif(replace(p->>'fee', ',', ''), '')::numeric;
  v_counter numeric := nullif(replace(p->>'counter_amount', ',', ''), '')::numeric;
  v_cfee numeric := nullif(replace(p->>'counter_fee', ',', ''), '')::numeric;
  v_date date := nullif(p->>'date', '')::date;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT pf.id, a.currency INTO v_pf, v_pf_ccy FROM public.investment_portfolios pf JOIN public.assets a ON a.id = pf.asset_id
   WHERE pf.asset_id = p_portfolio_asset_id AND pf.deleted_at IS NULL AND a.deleted_at IS NULL;
  IF v_pf IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบพอร์ตนี้' USING ERRCODE = '22023'; END IF;
  v_in := coalesce(p->>'direction', 'IN') = 'IN';
  SELECT * INTO b FROM public.assets WHERE id = nullif(p->>'bank_asset_id', '')::uuid
     AND asset_type = 'BANK_ACCOUNT' AND deleted_at IS NULL;
  IF b.id IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีธนาคาร' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.investment_holdings WHERE id = coalesce(nullif(p->>'cash_holding_id', '')::uuid,
                     private.default_cash_holding(v_pf, b.currency), private.default_cash_holding(v_pf, v_pf_ccy))
     AND portfolio_id = v_pf AND holding_type = 'CASH' AND deleted_at IS NULL;
  IF c.id IS NULL AND nullif(p->>'cash_holding_id', '') IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID: บัญชีเงินฝากไม่ได้อยู่ในพอร์ตนี้' USING ERRCODE = '22023';
  END IF;
  IF c.id IS NULL THEN RAISE EXCEPTION 'INVALID: ยังไม่มีบัญชีเงินฝากในพอร์ต — เพิ่มบัญชีเงินฝากก่อน' USING ERRCODE = '22023'; END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่จำนวนเงินที่ออก' USING ERRCODE = '22023'; END IF;
  IF v_counter IS NOT NULL AND v_counter <= 0 THEN RAISE EXCEPTION 'INVALID: ยอดที่เข้าต้องมากกว่า 0 (ยังไม่ทราบ = เว้นว่าง)' USING ERRCODE = '22023'; END IF;
  IF coalesce(v_fee, 0) < 0 OR coalesce(v_cfee, 0) < 0 THEN RAISE EXCEPTION 'INVALID: ค่าธรรมเนียมติดลบไม่ได้' USING ERRCODE = '22023'; END IF;
  IF v_date IS NULL OR v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_asset_id,
              amount, currency, fee, fee_currency, counter_amount, counter_currency, counter_fee,
              cash_holding_id, description, metadata)
  VALUES (private.default_family_id(), v_date,
          CASE WHEN v_in THEN 'INVESTMENT_OUT' ELSE 'INVESTMENT_IN' END,
          CASE WHEN v_in THEN b.id ELSE p_portfolio_asset_id END,
          CASE WHEN v_in THEN p_portfolio_asset_id ELSE b.id END,
          v_amount, CASE WHEN v_in THEN b.currency ELSE c.currency END,
          nullif(v_fee, 0), CASE WHEN coalesce(v_fee, 0) > 0 THEN CASE WHEN v_in THEN b.currency ELSE c.currency END END,
          v_counter, CASE WHEN v_in THEN c.currency ELSE b.currency END, nullif(v_cfee, 0),
          c.id, nullif(trim(p->>'description'), ''), jsonb_build_object('via', 'transfer_portfolio_money'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.update_portfolio_transfer(p_movement_id uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  m public.cash_movements; v_pf uuid; v_ch uuid; c public.investment_holdings;
  v_date date; v_amount numeric; v_fee numeric; v_counter numeric; v_cfee numeric; v_desc text; v_dest text;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT * INTO m FROM public.cash_movements WHERE id = p_movement_id AND deleted_at IS NULL AND NOT is_derived
     AND movement_type IN ('INVESTMENT_OUT','INVESTMENT_IN');
  IF m.id IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบรายการโอนนี้' USING ERRCODE = '22023'; END IF;
  v_pf := private.portfolio_of_asset(CASE m.movement_type WHEN 'INVESTMENT_OUT' THEN m.to_asset_id ELSE m.from_asset_id END);

  v_ch := coalesce(nullif(p->>'cash_holding_id', '')::uuid, m.cash_holding_id,
                   (SELECT x.holding_id FROM public.investment_transactions x
                     WHERE x.cash_movement_id = m.id AND x.transaction_type IN ('DEPOSIT','WITHDRAWAL') LIMIT 1),
                   private.default_cash_holding(v_pf, m.currency));
  SELECT * INTO c FROM public.investment_holdings WHERE id = v_ch AND portfolio_id = v_pf AND holding_type = 'CASH' AND deleted_at IS NULL;
  IF c.id IS NULL THEN RAISE EXCEPTION 'INVALID: บัญชีเงินฝากไม่ได้อยู่ในพอร์ตนี้' USING ERRCODE = '22023'; END IF;
  IF m.movement_type = 'INVESTMENT_IN' AND c.currency <> m.currency THEN
    RAISE EXCEPTION 'INVALID: บัญชีเงินฝากต้องเป็นสกุล % (สกุลเงินที่ออก) — สกุลต่างกันให้ลบแล้วบันทึกใหม่', m.currency USING ERRCODE = '22023';
  END IF;
  v_dest := CASE m.movement_type WHEN 'INVESTMENT_OUT' THEN c.currency ELSE coalesce(m.counter_currency, m.currency) END;

  v_date   := CASE WHEN p ? 'date' THEN nullif(p->>'date', '')::date ELSE m.movement_date END;
  v_amount := CASE WHEN p ? 'amount' THEN nullif(replace(p->>'amount', ',', ''), '')::numeric ELSE m.amount END;
  v_fee    := CASE WHEN p ? 'fee' THEN nullif(replace(p->>'fee', ',', ''), '')::numeric ELSE m.fee END;
  v_counter := CASE WHEN p ? 'counter_amount' THEN nullif(replace(p->>'counter_amount', ',', ''), '')::numeric
                    WHEN m.counter_currency IS NULL THEN v_amount       -- รายการแบบเดิม (สกุลเดียวกัน) = ยอดเต็ม
                    ELSE m.counter_amount END;
  v_cfee   := CASE WHEN p ? 'counter_fee' THEN nullif(replace(p->>'counter_fee', ',', ''), '')::numeric ELSE m.counter_fee END;
  v_desc   := CASE WHEN p ? 'description' THEN nullif(trim(p->>'description'), '') ELSE m.description END;
  IF v_date IS NULL OR v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่จำนวนเงินที่ออก' USING ERRCODE = '22023'; END IF;
  IF v_counter IS NOT NULL AND v_counter <= 0 THEN RAISE EXCEPTION 'INVALID: ยอดที่เข้าต้องมากกว่า 0 (ยังไม่ทราบ = เว้นว่าง)' USING ERRCODE = '22023'; END IF;
  IF coalesce(v_fee, 0) < 0 OR coalesce(v_cfee, 0) < 0 THEN RAISE EXCEPTION 'INVALID: ค่าธรรมเนียมติดลบไม่ได้' USING ERRCODE = '22023'; END IF;

  UPDATE public.cash_movements SET
    movement_date = v_date, amount = v_amount,
    fee = nullif(v_fee, 0), fee_currency = CASE WHEN coalesce(v_fee, 0) > 0 THEN m.currency END,
    counter_currency = v_dest, counter_amount = v_counter, counter_fee = nullif(v_cfee, 0),
    cash_holding_id = c.id, description = v_desc
   WHERE id = m.id;
END $function$;


-- 2) ชื่อบัญชีเดิมที่ระบบสร้าง ("เงินสด USD" → "เงินฝาก USD") — ชื่อที่ผู้ใช้ตั้งเองไม่เปลี่ยน
UPDATE public.investment_holdings
   SET name = 'เงินฝาก ' || substr(name, length('เงินสด ') + 1)
 WHERE holding_type = 'CASH' AND name ~ '^เงินสด [A-Z]{3}$';
