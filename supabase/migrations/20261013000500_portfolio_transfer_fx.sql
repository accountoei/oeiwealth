-- =====================================================================
-- โอนเงิน ธนาคาร ↔ พอร์ตลงทุน แบบข้ามสกุล (เช่น บัญชีบาท → Citibank USD) + ยอดปลายทางใส่ทีหลังได้
--
--   รายการโอนแบบใหม่ (สร้างจาก public.transfer_portfolio_money) เก็บ 2 ฝั่ง:
--     amount / currency / fee           = ฝั่งต้นทาง (เงินที่ออก + ค่าธรรมเนียมฝั่งต้นทาง)
--     counter_amount / counter_currency = ฝั่งปลายทาง (ยอดที่เข้าจริงหลังหักค่าธรรมเนียม · ว่าง = "รอยอด")
--     counter_fee                       = ค่าธรรมเนียมฝั่งปลายทาง (สกุลปลายทาง · ข้อมูล + ค่าใช้จ่าย)
--     cash_holding_id                   = บัญชีเงินสดในพอร์ตที่เงินเข้า / ออก
--   ค่าธรรมเนียมทั้ง 2 ฝั่ง = ค่าใช้จ่าย "ค่าธรรมเนียมธนาคาร" (ไม่ลดผลตอบแทนพอร์ต)
--   ส่วนต่างอัตราแลกเปลี่ยน = มูลค่าเปลี่ยน (ไม่ใช่ค่าใช้จ่าย)
--   ระหว่างรอยอด: ไม่หายจาก Net Worth (นับเป็นเงินระหว่างทาง)
--   รายการโอนแบบเดิม (counter_currency ว่าง) ทำงานเหมือนเดิมทุกอย่าง
-- =====================================================================

-- 1) คอลัมน์ใหม่ ----------------------------------------------------------------
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS cash_holding_id uuid REFERENCES public.investment_holdings(id);
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS counter_fee public.d_money;
ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS cm_counter_fee_nonneg;
ALTER TABLE public.cash_movements ADD CONSTRAINT cm_counter_fee_nonneg CHECK (counter_fee IS NULL OR counter_fee >= 0);

-- FX_EXCHANGE ต้องมียอดปลายทาง · โอนพอร์ตแบบใหม่มีสกุลปลายทาง (ยอดว่างได้ = รอยอด) · ประเภทอื่นไม่มี
ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS cm_counter;
ALTER TABLE public.cash_movements ADD CONSTRAINT cm_counter CHECK (CASE
  WHEN movement_type = 'FX_EXCHANGE' THEN counter_amount IS NOT NULL AND counter_currency IS NOT NULL
  WHEN movement_type IN ('INVESTMENT_OUT','INVESTMENT_IN') THEN counter_amount IS NULL OR counter_currency IS NOT NULL
  ELSE counter_amount IS NULL AND counter_currency IS NULL END);
ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS cm_counter_extra;
ALTER TABLE public.cash_movements ADD CONSTRAINT cm_counter_extra CHECK (
  (cash_holding_id IS NULL OR movement_type IN ('INVESTMENT_OUT','INVESTMENT_IN'))
  AND (coalesce(counter_fee, 0) = 0 OR (movement_type IN ('INVESTMENT_OUT','INVESTMENT_IN') AND counter_currency IS NOT NULL)));
CREATE INDEX IF NOT EXISTS cm_cash_holding_idx ON public.cash_movements(cash_holding_id) WHERE cash_holding_id IS NOT NULL;

-- ค่าธรรมเนียมจากรายการโอน 1 รายการ มีได้ 2 ฝั่ง (FROM = ต้นทาง · TO = ปลายทาง)
ALTER TABLE public.expense_items ADD COLUMN IF NOT EXISTS source_fee_side text;
ALTER TABLE public.expense_items DROP CONSTRAINT IF EXISTS exp_fee_side;
ALTER TABLE public.expense_items ADD CONSTRAINT exp_fee_side CHECK (source_fee_side IS NULL
  OR (source_fee_side IN ('FROM','TO') AND source_cash_movement_id IS NOT NULL));
DROP INDEX IF EXISTS public.expense_items_source_cm_uq;
CREATE UNIQUE INDEX IF NOT EXISTS expense_items_source_cm_side_uq
  ON public.expense_items(source_cash_movement_id, coalesce(source_fee_side, 'FROM'))
  WHERE source_cash_movement_id IS NOT NULL;

-- 2) ตรวจรายการเงิน: สกุลของฝั่งพอร์ต = สกุลบัญชีเงินสดที่เลือก · อัตราจริงจากยอด 2 ฝั่ง -----------------
CREATE OR REPLACE FUNCTION private.tg_cash_movement_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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

  -- บัญชีเงินสดในพอร์ต (เฉพาะโอนพอร์ต): ต้องเป็นเงินสดของพอร์ตนั้น · สกุลของฝั่งพอร์ต = สกุลบัญชีนั้น
  IF v_inv THEN
    v_pf := private.portfolio_of_asset(CASE NEW.movement_type WHEN 'INVESTMENT_OUT' THEN NEW.to_asset_id ELSE NEW.from_asset_id END);
    IF NEW.cash_holding_id IS NULL AND NEW.counter_currency IS NOT NULL THEN
      NEW.cash_holding_id := private.default_cash_holding(v_pf,
        CASE NEW.movement_type WHEN 'INVESTMENT_OUT' THEN NEW.counter_currency ELSE NEW.currency END);
    END IF;
    IF NEW.cash_holding_id IS NOT NULL THEN
      SELECT * INTO c FROM public.investment_holdings WHERE id = NEW.cash_holding_id;
      IF c.portfolio_id IS DISTINCT FROM v_pf OR c.holding_type <> 'CASH' OR c.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVALID: บัญชีเงินสดไม่ได้อยู่ในพอร์ตนี้' USING ERRCODE = '22023';
      END IF;
      v_pf_ccy := c.currency;
    END IF;
  ELSIF NEW.cash_holding_id IS NOT NULL OR coalesce(NEW.counter_fee, 0) <> 0 THEN
    RAISE EXCEPTION 'INVALID: บัญชีเงินสดในพอร์ต / ค่าธรรมเนียมปลายทาง ใช้กับการโอนพอร์ตเท่านั้น' USING ERRCODE = '22023';
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
END $$;

-- 3) ยอดบัญชีธนาคาร: ฝั่งเข้า = ยอดปลายทาง (รอยอด = ยังไม่เข้า) -----------------------------------
CREATE OR REPLACE FUNCTION private.bank_movement_effects(p_asset uuid, p_from date, p_to date)
RETURNS TABLE (inflow numeric, outflow numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    coalesce(sum(CASE WHEN m.to_asset_id = p_asset
                      THEN CASE WHEN m.counter_currency IS NOT NULL THEN coalesce(m.counter_amount, 0) ELSE m.amount END END), 0),
    coalesce(sum(CASE WHEN m.from_asset_id = p_asset THEN m.amount + coalesce(m.fee, 0) END), 0)
  FROM public.cash_movements m
  WHERE m.deleted_at IS NULL
    AND (m.to_asset_id = p_asset OR m.from_asset_id = p_asset)
    AND m.movement_date > p_from AND m.movement_date <= p_to
$$;

-- 4) เงินระหว่างทางของพอร์ต ---------------------------------------------------------------
--   ฝั่งพอร์ตของรายการ: ธนาคาร → พอร์ต = +ยอดที่เข้า (รอยอด = ยอดที่ส่ง แปลงสกุล)
--                      พอร์ต → ธนาคาร = −(ยอดที่ออก + ค่าธรรมเนียมแบบใหม่)
--   นับจนกว่าบัญชีเงินสดที่รับ / จ่ายมี Statement หลังวันโอน (เหมือนเดิม)
--   พอร์ต → ธนาคาร ที่ยังรอยอดฝั่งธนาคาร: เงินยังไม่ถึงธนาคาร → นับ +ยอดที่ออกไว้ที่พอร์ตจนกว่าจะใส่ยอด
CREATE OR REPLACE FUNCTION private.portfolio_in_transit(p_portfolio uuid, p_as_of date DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_asset uuid; v_ccy text; v_go_live date; v_upto date := coalesce(p_as_of, 'infinity'::date);
  v_fx_date date := coalesce(p_as_of, current_date); v_sum numeric; v_pending numeric;
BEGIN
  SELECT p.asset_id, a.currency, f.go_live_date INTO v_asset, v_ccy, v_go_live
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
    JOIN public.families f ON f.id = a.family_id WHERE p.id = p_portfolio;

  WITH mv AS (
    SELECT m.*,
           CASE WHEN m.movement_type = 'INVESTMENT_OUT' THEN
                  CASE WHEN m.counter_currency IS NOT NULL AND m.counter_amount IS NOT NULL THEN m.counter_amount ELSE m.amount END
                ELSE -(m.amount + CASE WHEN m.counter_currency IS NOT NULL THEN coalesce(m.fee, 0) ELSE 0 END) END AS pf_amt,
           CASE WHEN m.movement_type = 'INVESTMENT_OUT' AND m.counter_currency IS NOT NULL AND m.counter_amount IS NOT NULL
                THEN m.counter_currency ELSE m.currency END AS pf_ccy,
           coalesce(m.cash_holding_id,
                    (SELECT x.cash_holding_id FROM public.investment_transactions x
                      WHERE x.cash_movement_id = m.id AND x.transaction_type IN ('DEPOSIT','WITHDRAWAL')
                        AND x.deleted_at IS NULL LIMIT 1),
                    private.default_cash_holding(p_portfolio, coalesce(m.counter_currency, m.currency))) AS ch
      FROM public.cash_movements m
     WHERE m.deleted_at IS NULL AND NOT m.is_derived
       AND ((m.movement_type = 'INVESTMENT_OUT' AND m.to_asset_id = v_asset)
         OR (m.movement_type = 'INVESTMENT_IN'  AND m.from_asset_id = v_asset))
       AND m.movement_date <= v_upto)
  SELECT
    coalesce(sum(mv.pf_amt * private.fx_cross(mv.pf_ccy, v_ccy, v_fx_date)) FILTER (WHERE
      mv.movement_date > coalesce(
           (SELECT max(v.valuation_date) FROM public.investment_valuations v
             WHERE v.holding_id = mv.ch AND v.deleted_at IS NULL AND v.valuation_date <= v_upto),
           (SELECT max(t.transaction_date) FROM public.investment_transactions t
             WHERE t.holding_id = mv.ch AND t.transaction_type = 'OPENING_BALANCE' AND t.deleted_at IS NULL),
           v_go_live - 1)), 0),
    coalesce(sum(mv.amount * private.fx_cross(mv.currency, v_ccy, v_fx_date)) FILTER (WHERE
      mv.movement_type = 'INVESTMENT_IN' AND mv.counter_currency IS NOT NULL AND mv.counter_amount IS NULL), 0)
    INTO v_sum, v_pending
    FROM mv;
  RETURN v_sum + v_pending;
END $$;

-- แปลงยอดสกุล A → สกุล B ด้วยอัตรา ณ วันที่ (ไม่มีอัตรา = 0)
CREATE OR REPLACE FUNCTION private.fx_cross(p_from text, p_to text, p_date date) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p_from = p_to THEN 1
              ELSE coalesce(private.fx_rate(p_from, p_date) / nullif(private.fx_rate(p_to, p_date), 0), 0) END
$$;
REVOKE ALL ON FUNCTION private.fx_cross(text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fx_cross(text, text, date) TO authenticated, service_role;

-- 5) รายการที่ตามมาจากการโอน: ฝาก / ถอนในพอร์ต + ค่าธรรมเนียมเป็นค่าใช้จ่าย -------------------------
CREATE OR REPLACE FUNCTION private.tg_cash_movement_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.cash_movements := coalesce(NEW, OLD);
  v_active boolean := TG_OP <> 'DELETE' AND NEW.deleted_at IS NULL;
  v_new boolean := m.movement_type IN ('INVESTMENT_OUT','INVESTMENT_IN') AND m.counter_currency IS NOT NULL;
  v_pf uuid; v_cash_holding uuid; x public.investment_transactions; e public.expense_items;
  v_kind text; v_need boolean; v_type text; v_amount numeric; v_ccy text; v_monthly uuid;
  v_asset uuid; v_side text; v_fee numeric; v_fee_ccy text; v_desc text;
BEGIN
  IF NOT m.is_derived THEN
    -- 1) Transfer Money: INVESTMENT_OUT/IN (Source) → DEPOSIT / WITHDRAWAL ในพอร์ต (+ FEE เฉพาะแบบเดิม)
    v_pf := CASE m.movement_type WHEN 'INVESTMENT_OUT' THEN private.portfolio_of_asset(m.to_asset_id)
                                 WHEN 'INVESTMENT_IN'  THEN private.portfolio_of_asset(m.from_asset_id) END;
    FOREACH v_kind IN ARRAY ARRAY['MAIN','FEE'] LOOP
      IF v_kind = 'MAIN' THEN
        v_type := CASE m.movement_type WHEN 'INVESTMENT_OUT' THEN 'DEPOSIT' ELSE 'WITHDRAWAL' END;
        IF v_new AND m.movement_type = 'INVESTMENT_OUT' THEN
          v_amount := m.counter_amount; v_ccy := m.counter_currency;      -- รอยอด → ยังไม่มีรายการฝาก
        ELSE
          v_amount := m.amount; v_ccy := m.currency;
        END IF;
        v_need := v_active AND v_pf IS NOT NULL AND v_amount IS NOT NULL;
      ELSE
        v_type := 'FEE';                                   -- แบบเดิม: พอร์ต → ธนาคาร fee เป็น Investment FEE
        v_amount := m.fee; v_ccy := m.currency;
        v_need := v_active AND NOT v_new AND v_pf IS NOT NULL AND m.movement_type = 'INVESTMENT_IN' AND coalesce(m.fee, 0) > 0;
      END IF;
      SELECT * INTO x FROM public.investment_transactions
       WHERE cash_movement_id = m.id AND transaction_type IN (v_type, CASE v_kind WHEN 'MAIN' THEN 'DEPOSIT' END,
                                                             CASE v_kind WHEN 'MAIN' THEN 'WITHDRAWAL' END)
       ORDER BY created_at DESC LIMIT 1;
      IF v_need THEN
        v_cash_holding := coalesce(m.cash_holding_id, private.default_cash_holding(v_pf, v_ccy));
        IF x.id IS NULL THEN
          INSERT INTO public.investment_transactions(portfolio_id, holding_id, transaction_date, transaction_type,
                                                     amount, currency, cash_movement_id, notes)
          VALUES (v_pf, v_cash_holding, m.movement_date, v_type, v_amount, v_ccy, m.id,
                  'Auto: Transfer Money');
        ELSIF (x.portfolio_id, x.holding_id, x.transaction_date, x.transaction_type, x.amount, x.currency, x.deleted_at IS NULL)
              IS DISTINCT FROM (v_pf, v_cash_holding, m.movement_date, v_type, v_amount::numeric(20,4), v_ccy, true) THEN
          UPDATE public.investment_transactions SET portfolio_id = v_pf, holding_id = v_cash_holding,
                 transaction_date = m.movement_date, transaction_type = v_type, amount = v_amount,
                 currency = v_ccy, deleted_at = NULL
           WHERE id = x.id;
        END IF;
      ELSIF x.id IS NOT NULL AND x.deleted_at IS NULL THEN
        UPDATE public.investment_transactions SET deleted_at = now() WHERE id = x.id;
      END IF;
    END LOOP;

    -- 2) ค่าธรรมเนียม → Derived Expense BANK_FEE (Section 11, 25)
    --    แบบเดิม: เฉพาะค่าธรรมเนียมที่ออกจากบัญชีธนาคาร · แบบใหม่: ทั้งฝั่งต้นทาง (FROM) และปลายทาง (TO)
    FOREACH v_side IN ARRAY ARRAY['FROM','TO'] LOOP
      IF v_side = 'FROM' THEN
        v_fee := m.fee; v_fee_ccy := m.fee_currency;
        v_need := v_active AND coalesce(m.fee, 0) > 0
                  AND (v_new OR (private.is_bank_asset(m.from_asset_id)
                                 AND coalesce((m.metadata ->> 'fee_as_expense')::boolean, true)));
        v_desc := CASE WHEN v_new THEN 'ค่าธรรมเนียมโอนเงิน (ต้นทาง ' || m.currency || ')'
                       ELSE 'ค่าธรรมเนียม ' || m.movement_type END;
      ELSE
        v_fee := m.counter_fee; v_fee_ccy := m.counter_currency;
        v_need := v_active AND v_new AND coalesce(m.counter_fee, 0) > 0;
        v_desc := 'ค่าธรรมเนียมโอนเงิน (ปลายทาง ' || coalesce(m.counter_currency, '') || ')';
      END IF;
      v_desc := v_desc || coalesce(' · ' || m.description, '');
      e := NULL;
      SELECT * INTO e FROM public.expense_items
       WHERE source_cash_movement_id = m.id AND coalesce(source_fee_side, 'FROM') = v_side;
      IF v_need THEN
        v_monthly := private.ensure_monthly_expense(m.family_id, m.movement_date);
        IF e.id IS NULL THEN
          INSERT INTO public.expense_items(monthly_expense_id, date, description, amount, currency,
                                           expense_category, source_cash_movement_id, source_fee_side)
          VALUES (v_monthly, m.movement_date, v_desc, v_fee, v_fee_ccy, 'BANK_FEE', m.id,
                  CASE v_side WHEN 'TO' THEN 'TO' END);
        ELSIF (e.monthly_expense_id, e.date, e.amount, e.currency, e.deleted_at IS NULL)
              IS DISTINCT FROM (v_monthly, m.movement_date, v_fee::numeric(20,4), v_fee_ccy, true) THEN
          UPDATE public.expense_items SET monthly_expense_id = v_monthly, date = m.movement_date,
                 amount = v_fee, currency = v_fee_ccy, description = v_desc, deleted_at = NULL
           WHERE id = e.id;
        END IF;
      ELSIF e.id IS NOT NULL AND e.deleted_at IS NULL THEN
        UPDATE public.expense_items SET deleted_at = now() WHERE id = e.id;
      END IF;
    END LOOP;

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

-- 6) RPC: บันทึกการโอน ธนาคาร ↔ พอร์ต (สกุลเดียวกันหรือข้ามสกุล) ---------------------------------
--   p: {"direction":"IN"(ธนาคาร→พอร์ต)|"OUT"(พอร์ต→ธนาคาร), "bank_asset_id", "cash_holding_id",
--       "date", "amount"(ต้นทาง), "fee"(ต้นทาง), "counter_amount"(ปลายทาง · ว่าง = รอยอด), "counter_fee"(ปลายทาง),
--       "description"}
DROP FUNCTION IF EXISTS public.transfer_portfolio_money(uuid, jsonb);
CREATE FUNCTION public.transfer_portfolio_money(p_portfolio_asset_id uuid, p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
    RAISE EXCEPTION 'INVALID: บัญชีเงินสดไม่ได้อยู่ในพอร์ตนี้' USING ERRCODE = '22023';
  END IF;
  IF c.id IS NULL THEN RAISE EXCEPTION 'INVALID: ยังไม่มีบัญชีเงินสดในพอร์ต — เพิ่มบัญชีเงินสดก่อน' USING ERRCODE = '22023'; END IF;
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
END $$;

-- 7) RPC: แก้รายการโอน / ใส่ยอดปลายทางทีหลัง (รายการแบบเดิมจะถูกปรับเป็นแบบใหม่ — ค่าธรรมเนียมเป็นค่าใช้จ่าย)
--   p: {"date","amount","fee","counter_amount"(ว่าง = รอยอด),"counter_fee","cash_holding_id","description"} — ส่งเฉพาะช่องที่แก้
DROP FUNCTION IF EXISTS public.update_portfolio_transfer(uuid, jsonb);
CREATE FUNCTION public.update_portfolio_transfer(p_movement_id uuid, p jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
  IF c.id IS NULL THEN RAISE EXCEPTION 'INVALID: บัญชีเงินสดไม่ได้อยู่ในพอร์ตนี้' USING ERRCODE = '22023'; END IF;
  IF m.movement_type = 'INVESTMENT_IN' AND c.currency <> m.currency THEN
    RAISE EXCEPTION 'INVALID: บัญชีเงินสดต้องเป็นสกุล % (สกุลเงินที่ออก) — สกุลต่างกันให้ลบแล้วบันทึกใหม่', m.currency USING ERRCODE = '22023';
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
END $$;

REVOKE ALL ON FUNCTION public.transfer_portfolio_money(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_portfolio_money(uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.update_portfolio_transfer(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_portfolio_transfer(uuid, jsonb) TO authenticated;

