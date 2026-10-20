-- =====================================================================
-- จ่ายออกจากบัญชีเงินฝากในพอร์ต: ค่าใช้จ่าย · จ่ายบัตรเครดิต · ตั้งบัตรตัดบัญชีอัตโนมัติจากพอร์ต
--   รายการลงทุนแบบใหม่ PAYMENT = เงินออกจากบัญชีเงินฝากในพอร์ตไปภายนอก (ไม่ใช่การถอนเข้าบัญชีธนาคาร · ไม่กระทบผลตอบแทนหลักทรัพย์)
--     · ค่าใช้จ่าย: expense_items.paid_from_cash_holding_id → ระบบสร้าง PAYMENT ให้เอง (source_expense_item_id · แก้ / ลบที่ค่าใช้จ่าย)
--     · จ่ายบัตร: pay_credit_card({cash_holding_id}) → PAYMENT (to_credit_card_id) · ยอดบัตรลดตาม card_activity
--   บัตร: autopay_cash_holding_id = ตัดจากบัญชีเงินฝากในพอร์ต (สกุลเดียวกับบัตร · ผูกได้ทางเดียว: ธนาคาร หรือ พอร์ต)
--   ไม่แก้ / ลบข้อมูลเดิม · Net Worth: ค่าใช้จ่ายจากพอร์ต = เงินในพอร์ตลด · จ่ายบัตรจากพอร์ต = เงินในพอร์ตลด + หนี้บัตรลด
--   รันซ้ำได้
-- =====================================================================

-- 1) investment_transactions: PAYMENT ------------------------------------------------------------
ALTER TABLE public.investment_transactions ADD COLUMN IF NOT EXISTS source_expense_item_id uuid REFERENCES public.expense_items(id);
ALTER TABLE public.investment_transactions ADD COLUMN IF NOT EXISTS to_credit_card_id uuid REFERENCES public.credit_cards(id);
CREATE UNIQUE INDEX IF NOT EXISTS itx_source_expense_uq ON public.investment_transactions(source_expense_item_id)
  WHERE source_expense_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS itx_to_card_idx ON public.investment_transactions(to_credit_card_id)
  WHERE to_credit_card_id IS NOT NULL;

ALTER TABLE public.investment_transactions DROP CONSTRAINT IF EXISTS investment_transactions_transaction_type_check;
ALTER TABLE public.investment_transactions ADD CONSTRAINT investment_transactions_transaction_type_check
  CHECK (transaction_type IN ('OPENING_BALANCE','DEPOSIT','WITHDRAWAL','BUY','SELL','DIVIDEND',
                              'INTEREST','COUPON','FEE','TAX','MATURITY','REDEMPTION',
                              'FX_EXCHANGE','ADJUSTMENT','CASH_TRANSFER','PAYMENT'));
-- PAYMENT: จ่ายให้ค่าใช้จ่าย หรือ บัตร อย่างใดอย่างหนึ่ง · ไม่ผูกหลักทรัพย์ / ธนาคาร / เงินโอน
ALTER TABLE public.investment_transactions DROP CONSTRAINT IF EXISTS itx_payment_required;
ALTER TABLE public.investment_transactions ADD CONSTRAINT itx_payment_required
  CHECK ((transaction_type = 'PAYMENT') = (num_nonnulls(source_expense_item_id, to_credit_card_id) = 1)
         AND (transaction_type <> 'PAYMENT' OR (holding_id IS NULL AND settle_from_asset_id IS NULL
              AND settle_to_asset_id IS NULL AND cash_movement_id IS NULL AND counter_amount IS NULL)));

-- รายการที่สร้างจากค่าใช้จ่าย: แก้ / ลบตรง ๆ ไม่ได้ (แก้ที่ค่าใช้จ่าย)
DROP TRIGGER IF EXISTS t31_derived_expense ON public.investment_transactions;
CREATE TRIGGER t31_derived_expense BEFORE INSERT OR UPDATE ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_derived_guard('source_expense_item_id');

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
    WHEN t.transaction_type = 'PAYMENT' THEN -t.amount                -- จ่ายออกจากพอร์ต (ค่าใช้จ่าย / จ่ายบัตร)
    WHEN t.transaction_type = 'ADJUSTMENT' THEN CASE t.direction WHEN 'IN' THEN t.amount ELSE -t.amount END
    ELSE 0 END
$$;

-- PAYMENT: ต้องมีบัญชีเงินฝากที่จ่าย (t50_check ตั้งบัญชีหลักของสกุลให้ถ้าไม่ระบุ) · บัตรต้องสกุลเดียวกับรายการ
CREATE OR REPLACE FUNCTION private.tg_itx_payment_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.transaction_type <> 'PAYMENT' THEN RETURN NEW; END IF;
  IF NEW.cash_holding_id IS NULL THEN
    RAISE EXCEPTION 'INVALID: ยังไม่มีบัญชีเงินฝากสกุล % ในพอร์ตนี้', NEW.currency USING ERRCODE = '22023';
  END IF;
  IF NEW.to_credit_card_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.credit_cards WHERE id = NEW.to_credit_card_id AND deleted_at IS NULL AND currency = NEW.currency) THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: บัตรต้องสกุลเดียวกับรายการ (%)', NEW.currency USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t52_payment ON public.investment_transactions;
CREATE TRIGGER t52_payment BEFORE INSERT OR UPDATE ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_itx_payment_check();

-- จ่ายบัตรจากพอร์ต: คำนวณก้อนรอแยกของบัตรใหม่ (เหมือนจ่ายบัตรจากธนาคาร)
CREATE OR REPLACE FUNCTION private.tg_itx_card_lump() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.investment_transactions;
BEGIN
  IF private.lump_busy() THEN RETURN NULL; END IF;
  FOREACH r IN ARRAY ARRAY[OLD, NEW] LOOP
    CONTINUE WHEN r.id IS NULL OR r.to_credit_card_id IS NULL;
    PERFORM private.recalc_debt_lumps('CARD', r.to_credit_card_id, r.transaction_date);
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS a61_card_lump ON public.investment_transactions;
CREATE TRIGGER a61_card_lump AFTER INSERT OR UPDATE OR DELETE ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_itx_card_lump();

-- 2) ค่าใช้จ่ายจ่ายจากบัญชีเงินฝากในพอร์ต --------------------------------------------------------
ALTER TABLE public.expense_items ADD COLUMN IF NOT EXISTS paid_from_cash_holding_id uuid REFERENCES public.investment_holdings(id);
CREATE INDEX IF NOT EXISTS exp_paid_from_holding_idx ON public.expense_items(paid_from_cash_holding_id)
  WHERE paid_from_cash_holding_id IS NOT NULL;
ALTER TABLE public.expense_items DROP CONSTRAINT IF EXISTS exp_one_payment;
ALTER TABLE public.expense_items ADD CONSTRAINT exp_one_payment
  CHECK (num_nonnulls(paid_from_asset_id, paid_from_credit_card_id, paid_from_cash_holding_id) <= 1);
ALTER TABLE public.expense_items DROP CONSTRAINT IF EXISTS exp_derived_clean;
ALTER TABLE public.expense_items ADD CONSTRAINT exp_derived_clean
  CHECK (source_cash_movement_id IS NULL OR (
         paid_from_asset_id IS NULL AND paid_from_credit_card_id IS NULL AND paid_from_cash_holding_id IS NULL
         AND person_id IS NULL AND expense_category = 'BANK_FEE'));

-- ค่าใช้จ่าย → รายการ PAYMENT ในพอร์ต (สร้าง / แก้ / ลบตาม · 1 ค่าใช้จ่าย = 1 รายการ)
CREATE OR REPLACE FUNCTION private.sync_expense_payment(p_item uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.expense_items; t public.investment_transactions; h public.investment_holdings; v_need boolean;
BEGIN
  SELECT * INTO i FROM public.expense_items WHERE id = p_item;
  SELECT * INTO t FROM public.investment_transactions WHERE source_expense_item_id = p_item;
  v_need := i.id IS NOT NULL AND i.deleted_at IS NULL AND i.paid_from_cash_holding_id IS NOT NULL;
  IF v_need THEN
    SELECT * INTO h FROM public.investment_holdings WHERE id = i.paid_from_cash_holding_id;
    IF t.id IS NULL THEN
      INSERT INTO public.investment_transactions(portfolio_id, transaction_date, transaction_type, amount, currency,
                                                 cash_holding_id, source_expense_item_id, notes)
      VALUES (h.portfolio_id, i.date, 'PAYMENT', i.amount, i.currency, h.id, i.id, i.description);
    ELSIF (t.portfolio_id, t.transaction_date, t.amount, t.currency, t.cash_holding_id, t.notes, t.deleted_at IS NULL)
          IS DISTINCT FROM (h.portfolio_id, i.date, i.amount, i.currency, h.id, i.description, true) THEN
      UPDATE public.investment_transactions SET portfolio_id = h.portfolio_id, transaction_date = i.date, amount = i.amount,
             currency = i.currency, cash_holding_id = h.id, notes = i.description, deleted_at = NULL
       WHERE id = t.id;
    END IF;
  ELSIF t.id IS NOT NULL AND t.deleted_at IS NULL THEN
    UPDATE public.investment_transactions SET deleted_at = now() WHERE id = t.id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.sync_expense_payment(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.tg_expense_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE me public.monthly_expenses; r public.fx_rates; v_ccy text; c public.investment_holdings;
BEGIN
  SELECT * INTO me FROM public.monthly_expenses WHERE id = NEW.monthly_expense_id;
  IF me.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'INVALID: เดือนค่าใช้จ่ายนี้ถูกลบแล้ว' USING ERRCODE = '22023';
  END IF;
  IF date_trunc('month', NEW.date)::date <> me.year_month THEN
    RAISE EXCEPTION 'INVALID: วันที่ % ไม่อยู่ในเดือน %', NEW.date, me.year_month USING ERRCODE = '22023';
  END IF;
  IF NEW.paid_from_asset_id IS NOT NULL THEN
    IF NOT private.is_bank_asset(NEW.paid_from_asset_id) THEN
      RAISE EXCEPTION 'INVALID: paid_from_asset_id ต้องเป็นบัญชีธนาคาร' USING ERRCODE = '22023';
    END IF;
    SELECT currency INTO v_ccy FROM public.assets WHERE id = NEW.paid_from_asset_id;
    IF v_ccy <> NEW.currency THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: จ่ายจากบัญชีต้องสกุลเดียวกับบัญชี (%)', v_ccy USING ERRCODE = '22023';
    END IF;
  END IF;
  -- จ่ายจากบัญชีเงินฝากในพอร์ต: ต้องเป็นบัญชีเงินฝาก (CASH) ที่ยังใช้งาน · สกุลเดียวกับรายการ
  IF NEW.paid_from_cash_holding_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.paid_from_cash_holding_id IS DISTINCT FROM OLD.paid_from_cash_holding_id
          OR NEW.currency IS DISTINCT FROM OLD.currency) THEN
    SELECT * INTO c FROM public.investment_holdings WHERE id = NEW.paid_from_cash_holding_id;
    IF c.id IS NULL OR c.holding_type <> 'CASH' OR c.deleted_at IS NOT NULL OR c.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'INVALID: จ่ายจากต้องเป็นบัญชีเงินฝากในพอร์ตที่ยังใช้งาน' USING ERRCODE = '22023';
    END IF;
    IF c.currency <> NEW.currency THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: จ่ายจากบัญชีต้องสกุลเดียวกับบัญชี (%)', c.currency USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.currency = 'THB' THEN
    NEW.fx_rate_id := NULL; NEW.base_amount := NEW.amount;
  ELSE
    r := private.fx_rate_row(NEW.currency, NEW.date);
    NEW.fx_rate_id := r.id; NEW.base_amount := round(NEW.amount * r.rate_to_thb, 4);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.tg_expense_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.expense_items := coalesce(NEW, OLD); v_family uuid;
BEGIN
  SELECT family_id INTO v_family FROM public.monthly_expenses WHERE id = i.monthly_expense_id;
  IF i.source_cash_movement_id IS NULL THEN
    PERFORM private.sync_derived_movement('EXPENSE', i.id,
      TG_OP <> 'DELETE' AND NEW.deleted_at IS NULL AND i.paid_from_asset_id IS NOT NULL,
      v_family, i.date, 'EXPENSE', i.paid_from_asset_id, NULL, i.amount, i.currency, i.description);
    -- Item แรกที่ผู้ใช้บันทึกเอง: NOT_TRACKED → PARTIAL (Section 25 Expense Optional)
    IF TG_OP = 'INSERT' THEN
      UPDATE public.monthly_expenses SET tracking_status = 'PARTIAL'
       WHERE id = i.monthly_expense_id AND tracking_status = 'NOT_TRACKED';
    END IF;
  END IF;
  PERFORM private.sync_expense_payment(i.id);              -- จ่ายจากบัญชีเงินฝากในพอร์ต → รายการ PAYMENT ในพอร์ต
  PERFORM private.refresh_monthly_expense(i.monthly_expense_id);
  IF TG_OP = 'UPDATE' AND OLD.monthly_expense_id <> NEW.monthly_expense_id THEN
    PERFORM private.refresh_monthly_expense(OLD.monthly_expense_id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.add_expense(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_date date := nullif(p->>'date', '')::date; v_id uuid; v_ccy text; v_bank uuid; v_card uuid; v_hold uuid;
        v_util uuid := nullif(p->>'property_utility_id', '')::uuid; v_period date; v_related uuid;
        v_ins uuid := nullif(p->>'insurance_schedule_line_id', '')::uuid; v_cat text := nullif(trim(p->>'expense_category'), '');
        v_rexp uuid := nullif(p->>'recurring_expense_id', '')::uuid; v_rcat text;
BEGIN
  IF v_date IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่วันที่' USING ERRCODE = '22023'; END IF;
  IF v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่เป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p->>'description', ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่รายละเอียด' USING ERRCODE = '22023';
  END IF;
  IF (v_util IS NOT NULL)::int + (v_ins IS NOT NULL)::int + (v_rexp IS NOT NULL)::int > 1 THEN
    RAISE EXCEPTION 'INVALID: ผูกได้ทีละอย่าง (ค่าใช้จ่ายประจำ หรือ เบี้ยประกัน)' USING ERRCODE = '22023';
  END IF;
  v_bank := nullif(p->>'paid_from_asset_id', '')::uuid;
  v_card := nullif(p->>'paid_from_credit_card_id', '')::uuid;
  v_ccy := upper(coalesce(nullif(p->>'currency', ''), 'THB'));
  IF v_bank IS NOT NULL THEN SELECT currency INTO v_ccy FROM public.assets WHERE id = v_bank; END IF;
  IF v_card IS NOT NULL THEN SELECT currency INTO v_ccy FROM public.credit_cards WHERE id = v_card; END IF;
  v_hold := nullif(p->>'paid_from_cash_holding_id', '')::uuid;
  IF v_hold IS NOT NULL THEN
    IF v_bank IS NOT NULL OR v_card IS NOT NULL THEN RAISE EXCEPTION 'INVALID: เลือกจ่ายจากได้ทางเดียว' USING ERRCODE = '22023'; END IF;
    SELECT currency INTO v_ccy FROM public.investment_holdings WHERE id = v_hold AND holding_type = 'CASH' AND deleted_at IS NULL;
    IF v_ccy IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัญชีเงินฝากในพอร์ต' USING ERRCODE = '22023'; END IF;
  END IF;
  v_related := nullif(p->>'related_asset_id', '')::uuid;

  -- เบี้ยประกันตามตาราง: ต้องเป็นงวดเบี้ย (PREMIUM) ของกรมธรรม์ที่ยังไม่ถูกลบ · หมวดตั้งต้น "ประกัน"
  IF v_ins IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.insurance_schedule_lines l JOIN public.insurance_policies ip ON ip.id = l.policy_id
                    WHERE l.id = v_ins AND l.kind = 'PREMIUM' AND l.deleted_at IS NULL AND ip.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'NOT_FOUND: ไม่พบงวดเบี้ยประกัน' USING ERRCODE = '22023';
    END IF;
    v_cat := coalesce(v_cat, 'ประกัน');
  END IF;

  -- ค่าใช้จ่ายประจำของอสังหาฯ: ต้องระบุงวด · ผูกทรัพย์สินให้เองถ้าไม่ได้ส่งมา
  IF v_util IS NOT NULL THEN
    v_period := date_trunc('month', coalesce(nullif(p->>'cost_period', '')::date, v_date))::date;
    SELECT pd.asset_id INTO v_related
      FROM public.property_utilities u JOIN public.property_details pd ON pd.id = u.property_id
     WHERE u.id = v_util AND u.deleted_at IS NULL;
    IF v_related IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการค่าใช้จ่ายประจำ' USING ERRCODE = '22023'; END IF;
  END IF;

  -- ค่าใช้จ่ายประจำทั่วไป: ต้องระบุงวด · หมวดตั้งต้นจากรายการประจำ
  IF v_rexp IS NOT NULL THEN
    v_period := date_trunc('month', coalesce(nullif(p->>'cost_period', '')::date, v_date))::date;
    SELECT t.expense_category INTO v_rcat FROM public.recurring_expense_templates t WHERE t.id = v_rexp AND t.deleted_at IS NULL;
    IF v_rcat IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการค่าใช้จ่ายประจำ' USING ERRCODE = '22023'; END IF;
    v_cat := coalesce(v_cat, v_rcat);
  END IF;

  INSERT INTO public.expense_items(monthly_expense_id, related_asset_id, paid_from_asset_id, paid_from_credit_card_id, paid_from_cash_holding_id,
              person_id, date, description, amount, currency, expense_category, is_reimbursable,
              expected_reimbursement_amount, notes, property_utility_id, cost_period, insurance_schedule_line_id, recurring_expense_id)
  VALUES (private.expense_month_id(v_date), v_related, v_bank, v_card, v_hold,
          nullif(p->>'person_id', '')::uuid,   -- ระบุคนเองได้เสมอ (ใช้ก่อนเจ้าของบัญชี / บัตร)
          v_date, trim(p->>'description'), (p->>'amount')::numeric, v_ccy, v_cat,
          coalesce((p->>'is_reimbursable')::boolean, false),
          CASE WHEN coalesce((p->>'is_reimbursable')::boolean, false)
               THEN coalesce(nullif(p->>'expected_reimbursement_amount', '')::numeric, (p->>'amount')::numeric) END,
          nullif(trim(p->>'notes'), ''), v_util, v_period, v_ins, v_rexp)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.add_expense(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_expense(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.change_entry_account(p_kind text, p_id uuid, p_account text, p_income_type text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE i public.income_transactions; e public.expense_items; v_asset uuid; v_card uuid; v_hold uuid; v_old uuid; v_date date; v_n int;
  v_acc text := coalesce(trim(p_account), '');
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF v_acc LIKE 'a:%' THEN v_asset := substr(v_acc, 3)::uuid;
  ELSIF v_acc LIKE 'c:%' THEN v_card := substr(v_acc, 3)::uuid;
  ELSIF v_acc LIKE 'h:%' THEN v_hold := substr(v_acc, 3)::uuid;           -- บัญชีเงินฝากในพอร์ต (ค่าใช้จ่ายเท่านั้น)
  ELSIF v_acc <> '' THEN RAISE EXCEPTION 'INVALID: บัญชีไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'INCOME' THEN
    SELECT * INTO i FROM public.income_transactions WHERE id = p_id AND deleted_at IS NULL;
    IF i.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการ' USING ERRCODE = '22023'; END IF;
    IF i.pending_split OR i.source_transaction_id IS NOT NULL OR i.lease_id IS NOT NULL OR i.asset_id IS NOT NULL
       OR i.insurance_schedule_line_id IS NOT NULL OR i.received_to_credit_card_id IS NOT NULL THEN
      RAISE EXCEPTION 'LINKED: รายการนี้ผูกกับหน้าอื่น แก้บัญชี / ประเภทที่หน้าต้นทาง' USING ERRCODE = '22023';
    END IF;
    IF v_card IS NOT NULL OR v_hold IS NOT NULL THEN RAISE EXCEPTION 'INVALID: รายได้เลือกได้เฉพาะบัญชีธนาคาร' USING ERRCODE = '22023'; END IF;
    IF p_income_type IS NOT NULL AND p_income_type IN ('DIVIDEND','COUPON','RENT') AND p_income_type <> i.income_type THEN
      RAISE EXCEPTION 'INVALID: ปันผล / Coupon / ค่าเช่า บันทึกจากหน้าลงทุน / ทรัพย์สิน' USING ERRCODE = '22023';
    END IF;
    v_old := i.received_to_asset_id; v_date := i.date;
    UPDATE public.income_transactions SET received_to_asset_id = v_asset, income_type = coalesce(nullif(p_income_type, ''), income_type),
           income_subtype = CASE WHEN coalesce(nullif(p_income_type, ''), income_type) = 'OTHER' THEN income_subtype END
     WHERE id = i.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSIF p_kind = 'EXPENSE' THEN
    SELECT * INTO e FROM public.expense_items WHERE id = p_id AND deleted_at IS NULL;
    IF e.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการ' USING ERRCODE = '22023'; END IF;
    IF e.pending_split OR e.source_cash_movement_id IS NOT NULL OR e.liability_id IS NOT NULL OR e.insurance_schedule_line_id IS NOT NULL
       OR e.property_utility_id IS NOT NULL OR e.source_fee_side IS NOT NULL THEN
      RAISE EXCEPTION 'LINKED: รายการนี้ผูกกับหน้าอื่น แก้บัญชีที่หน้าต้นทาง' USING ERRCODE = '22023';
    END IF;
    IF v_card IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.credit_cards WHERE id = v_card AND deleted_at IS NULL AND currency = e.currency) THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: บัตรต้องสกุลเดียวกับรายการ (%)', e.currency USING ERRCODE = '22023';
    END IF;
    IF v_hold IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.investment_holdings WHERE id = v_hold AND holding_type = 'CASH'
                                            AND deleted_at IS NULL AND currency = e.currency) THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีเงินฝากในพอร์ตต้องสกุลเดียวกับรายการ (%)', e.currency USING ERRCODE = '22023';
    END IF;
    v_old := e.paid_from_asset_id; v_date := e.date;
    UPDATE public.expense_items SET paid_from_asset_id = v_asset, paid_from_credit_card_id = v_card, paid_from_cash_holding_id = v_hold
     WHERE id = e.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'INVALID: ประเภทรายการไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF v_n = 0 THEN RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้รายการนี้' USING ERRCODE = '42501'; END IF;

  RETURN jsonb_build_object('recon_warning', EXISTS (
    SELECT 1 FROM public.bank_reconciliations br
     WHERE br.deleted_at IS NULL AND br.status <> 'OPEN' AND br.year_month = date_trunc('month', v_date)::date
       AND br.bank_asset_id IN (v_old, v_asset)));
END $$;

REVOKE ALL ON FUNCTION public.change_entry_account(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_entry_account(text, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_entry(p_kind text, p_id uuid, p_fields jsonb DEFAULT '{}'::jsonb,
  p_account text DEFAULT NULL, p_income_type text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE i public.income_transactions; e public.expense_items; f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_cur text; v_acc text := nullif(trim(coalesce(p_account, '')), ''); v_type text := nullif(trim(coalesce(p_income_type, '')), '');
  v_change boolean; v_n int; v_banks uuid[]; v_dates date[];
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');

  IF p_kind = 'INCOME' THEN
    SELECT * INTO i FROM public.income_transactions WHERE id = p_id AND deleted_at IS NULL;
    IF i.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการ' USING ERRCODE = '22023'; END IF;
    v_cur := CASE WHEN i.received_to_asset_id IS NOT NULL THEN 'a:' || i.received_to_asset_id ELSE '' END;
    v_change := (p_account IS NOT NULL AND coalesce(v_acc, '') <> v_cur) OR (v_type IS NOT NULL AND v_type <> i.income_type);
    v_banks := ARRAY[i.received_to_asset_id]; v_dates := ARRAY[i.date];
    -- 1) บัญชี / ประเภท (ผ่านฟังก์ชันเดิม: ตรวจรายการผูกหน้าอื่น · งวดปิด · สิทธิ์)
    IF v_change THEN
      PERFORM public.change_entry_account('INCOME', i.id, CASE WHEN p_account IS NULL THEN v_cur ELSE coalesce(v_acc, '') END, v_type);
      SELECT * INTO i FROM public.income_transactions WHERE id = p_id;
    END IF;
    -- 2) ช่องทั่วไป
    UPDATE public.income_transactions SET
      date           = CASE WHEN f ? 'date'      THEN (f->>'date')::date ELSE date END,
      amount         = CASE WHEN f ? 'amount'    THEN (f->>'amount')::numeric ELSE amount END,
      tax            = CASE WHEN f ? 'tax'       THEN nullif(f->>'tax', '')::numeric ELSE tax END,
      notes          = CASE WHEN f ? 'notes'     THEN nullif(trim(f->>'notes'), '') ELSE notes END,
      person_id      = CASE WHEN f ? 'person_id' THEN nullif(f->>'person_id', '')::uuid ELSE person_id END,
      income_subtype = CASE WHEN income_type <> 'OTHER' THEN NULL
                            WHEN f ? 'income_subtype' THEN nullif(trim(f->>'income_subtype'), '') ELSE income_subtype END
     WHERE id = i.id AND deleted_at IS NULL
     RETURNING received_to_asset_id, date INTO i.received_to_asset_id, i.date;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_banks := v_banks || i.received_to_asset_id; v_dates := v_dates || i.date;

  ELSIF p_kind = 'EXPENSE' THEN
    SELECT * INTO e FROM public.expense_items WHERE id = p_id AND deleted_at IS NULL;
    IF e.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการ' USING ERRCODE = '22023'; END IF;
    IF v_type IS NOT NULL THEN RAISE EXCEPTION 'INVALID: ค่าใช้จ่ายไม่มีประเภทรายได้' USING ERRCODE = '22023'; END IF;
    v_cur := CASE WHEN e.paid_from_asset_id IS NOT NULL THEN 'a:' || e.paid_from_asset_id
                  WHEN e.paid_from_credit_card_id IS NOT NULL THEN 'c:' || e.paid_from_credit_card_id
                  WHEN e.paid_from_cash_holding_id IS NOT NULL THEN 'h:' || e.paid_from_cash_holding_id ELSE '' END;
    v_change := p_account IS NOT NULL AND coalesce(v_acc, '') <> v_cur;
    v_banks := ARRAY[e.paid_from_asset_id]; v_dates := ARRAY[e.date];
    IF v_change THEN
      PERFORM public.change_entry_account('EXPENSE', e.id, coalesce(v_acc, ''), NULL);
    END IF;
    UPDATE public.expense_items SET
      date            = CASE WHEN f ? 'date'             THEN (f->>'date')::date ELSE date END,
      description     = CASE WHEN f ? 'description'      THEN nullif(trim(f->>'description'), '') ELSE description END,
      amount          = CASE WHEN f ? 'amount'           THEN (f->>'amount')::numeric ELSE amount END,
      expense_category = CASE WHEN f ? 'expense_category' THEN nullif(trim(f->>'expense_category'), '') ELSE expense_category END,
      notes           = CASE WHEN f ? 'notes'            THEN nullif(trim(f->>'notes'), '') ELSE notes END,
      person_id       = CASE WHEN f ? 'person_id'        THEN nullif(f->>'person_id', '')::uuid ELSE person_id END,
      expected_reimbursement_amount = CASE WHEN f ? 'expected_reimbursement_amount'
                                           THEN nullif(f->>'expected_reimbursement_amount', '')::numeric
                                           ELSE expected_reimbursement_amount END
     WHERE id = e.id AND deleted_at IS NULL
     RETURNING paid_from_asset_id, date INTO e.paid_from_asset_id, e.date;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_banks := v_banks || e.paid_from_asset_id; v_dates := v_dates || e.date;

  ELSE
    RAISE EXCEPTION 'INVALID: ประเภทรายการไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้รายการนี้ (ผู้บันทึกแก้ได้เฉพาะรายการของตัวเองภายใน 24 ชม.)' USING ERRCODE = '42501';
  END IF;

  -- เตือนถ้าบัญชีเดิม / ใหม่ กระทบยอดเดือนนั้น (เดิม / ใหม่) ไปแล้ว
  RETURN jsonb_build_object('recon_warning', EXISTS (
    SELECT 1 FROM public.bank_reconciliations br
     WHERE br.deleted_at IS NULL AND br.status <> 'OPEN'
       AND br.bank_asset_id = ANY (v_banks)
       AND br.year_month IN (SELECT date_trunc('month', d)::date FROM unnest(v_dates) d)));
END $$;

REVOKE ALL ON FUNCTION public.update_entry(text, uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_entry(text, uuid, jsonb, text, text) TO authenticated;

-- ค่าใช้จ่ายรายบุคคล: จ่ายจากพอร์ต → ตามเจ้าของพอร์ต (เหมือนจ่ายจากบัญชี = ตามเจ้าของบัญชี)
CREATE OR REPLACE VIEW public.v_expense_by_person WITH (security_invoker = true) AS
  SELECT i.id AS expense_item_id, me.family_id, me.year_month, i.date, i.expense_category, i.currency,
         (i.source_cash_movement_id IS NOT NULL) AS is_derived_fee,
         sh.person_id, sh.pct AS share_percent,
         round(i.amount * sh.pct / 100, 4) AS amount_share,
         round(i.base_amount * sh.pct / 100, 4) AS base_amount_share
    FROM public.expense_items i
    JOIN public.monthly_expenses me ON me.id = i.monthly_expense_id
    LEFT JOIN public.cash_movements src ON src.id = i.source_cash_movement_id
    LEFT JOIN public.investment_holdings ph ON ph.id = i.paid_from_cash_holding_id
    LEFT JOIN public.investment_portfolios pp ON pp.id = ph.portfolio_id
    CROSS JOIN LATERAL private.expense_shares(i.person_id, i.paid_from_credit_card_id, coalesce(i.paid_from_asset_id, src.from_asset_id, pp.asset_id), i.date, i.liability_id) sh
   WHERE i.deleted_at IS NULL AND me.deleted_at IS NULL AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');

-- 3) บัตรเครดิต: จ่าย / ตัดบัญชีอัตโนมัติจากบัญชีเงินฝากในพอร์ต ---------------------------------------
CREATE OR REPLACE FUNCTION private.card_activity(p_card uuid, p_from date, p_to date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT sum(amount) FROM public.expense_items WHERE paid_from_credit_card_id = p_card AND deleted_at IS NULL
                     AND date > p_from AND date <= p_to), 0)
       - coalesce((SELECT sum(amount) FROM public.cash_movements WHERE to_credit_card_id = p_card AND movement_type = 'CARD_PAYMENT'
                     AND deleted_at IS NULL AND movement_date > p_from AND movement_date <= p_to), 0)
       - coalesce((SELECT sum(amount) FROM public.investment_transactions WHERE to_credit_card_id = p_card AND transaction_type = 'PAYMENT'
                     AND deleted_at IS NULL AND transaction_date > p_from AND transaction_date <= p_to), 0)
       - coalesce((SELECT sum(amount) FROM public.expense_reimbursements WHERE received_to_credit_card_id = p_card AND deleted_at IS NULL
                     AND received_date > p_from AND received_date <= p_to), 0)
       - coalesce((SELECT sum(amount - coalesce(tax, 0)) FROM public.income_transactions WHERE received_to_credit_card_id = p_card
                     AND deleted_at IS NULL AND date > p_from AND date <= p_to), 0)
$$;

CREATE OR REPLACE FUNCTION public.pay_credit_card(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c public.credit_cards; v_bank uuid := nullif(p->>'bank_asset_id', '')::uuid; v_date date := nullif(p->>'date', '')::date;
  v_amount numeric := nullif(p->>'amount', '')::numeric; v_auto boolean := coalesce((p->>'autopay')::boolean, false);
  v_ccy text; v_id uuid; v_hold uuid := nullif(p->>'cash_holding_id', '')::uuid; h public.investment_holdings;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT * INTO c FROM public.credit_cards WHERE id = nullif(p->>'card_id', '')::uuid AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัตร' USING ERRCODE = '22023'; END IF;
  IF v_date IS NULL OR v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่จ่ายไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดที่จ่าย' USING ERRCODE = '22023'; END IF;
  IF v_hold IS NOT NULL THEN
    -- จ่ายจากบัญชีเงินฝากในพอร์ต → รายการ PAYMENT ในพอร์ต (ยอดบัตรลดตาม card_activity)
    IF v_bank IS NOT NULL THEN RAISE EXCEPTION 'INVALID: เลือกบัญชีที่จ่ายได้ทางเดียว' USING ERRCODE = '22023'; END IF;
    SELECT * INTO h FROM public.investment_holdings WHERE id = v_hold AND holding_type = 'CASH' AND deleted_at IS NULL AND status = 'ACTIVE';
    IF h.id IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่จ่าย' USING ERRCODE = '22023'; END IF;
    IF h.currency <> c.currency THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีที่จ่ายต้องสกุลเดียวกับบัตร (%)', c.currency USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.investment_transactions(portfolio_id, transaction_date, transaction_type, amount, currency,
                                               cash_holding_id, to_credit_card_id, notes)
    VALUES (h.portfolio_id, v_date, 'PAYMENT', v_amount, c.currency, h.id, c.id,
            concat_ws(' · ', CASE WHEN v_auto THEN 'ตัดบัญชีอัตโนมัติ' ELSE 'จ่ายบัตร' END,
                      nullif(concat_ws(' ', c.issuer, c.card_name), ''), nullif(trim(p->>'notes'), '')))
    RETURNING id INTO v_id;
  ELSE
  IF v_bank IS NULL OR NOT private.is_bank_asset(v_bank) THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่จ่าย' USING ERRCODE = '22023'; END IF;
  SELECT currency INTO v_ccy FROM public.assets WHERE id = v_bank;
  IF v_ccy <> c.currency THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีที่จ่ายต้องสกุลเดียวกับบัตร (%)', c.currency USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_credit_card_id, amount, currency,
                                    description, notes, metadata)
  SELECT f.id, v_date, 'CARD_PAYMENT', v_bank, c.id, v_amount, c.currency,
         CASE WHEN v_auto THEN 'ตัดบัญชีอัตโนมัติ · ' ELSE 'จ่ายบัตร · ' END || concat_ws(' ', c.issuer, c.card_name),
         nullif(trim(p->>'notes'), ''), jsonb_build_object('autopay', v_auto)
    FROM public.families f WHERE f.id = private.default_family_id()
  RETURNING id INTO v_id;
  END IF;
  -- หักยอดบัตรตามที่จ่าย (ถ้ายอดบัตรล่าสุดไม่ใหม่กว่าวันที่จ่าย)
  IF false AND (c.balance_date IS NULL OR c.balance_date <= v_date) THEN
    UPDATE public.credit_cards SET outstanding_balance = greatest(outstanding_balance - v_amount, 0), balance_date = v_date
     WHERE id = c.id;
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.pay_credit_card(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_credit_card(jsonb) TO authenticated;

ALTER TABLE public.credit_cards ADD COLUMN IF NOT EXISTS autopay_cash_holding_id uuid REFERENCES public.investment_holdings(id);
ALTER TABLE public.credit_cards DROP CONSTRAINT IF EXISTS cc_autopay;
ALTER TABLE public.credit_cards ADD CONSTRAINT cc_autopay
  CHECK ((autopay_mode IS NULL) = (num_nonnulls(autopay_asset_id, autopay_cash_holding_id) = 0)
         AND num_nonnulls(autopay_asset_id, autopay_cash_holding_id) <= 1
         AND (autopay_mode IS NULL OR autopay_mode IN ('FULL','MINIMUM')));
CREATE OR REPLACE FUNCTION private.tg_card_autopay_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.autopay_asset_id IS NOT NULL THEN
    IF NOT private.is_bank_asset(NEW.autopay_asset_id) THEN
      RAISE EXCEPTION 'INVALID: บัญชีที่ตัดต้องเป็นบัญชีธนาคาร' USING ERRCODE = '22023';
    END IF;
    IF (SELECT currency FROM public.assets WHERE id = NEW.autopay_asset_id) <> NEW.currency THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีที่ตัดต้องสกุลเดียวกับบัตร (%)', NEW.currency USING ERRCODE = '22023';
    END IF;
  END IF;
  -- ตัดจากบัญชีเงินฝากในพอร์ต: บัญชีเงินฝาก (CASH) ที่ยังใช้งาน · สกุลเดียวกับบัตร · ผูกได้บัญชีเดียว
  IF NEW.autopay_cash_holding_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.investment_holdings WHERE id = NEW.autopay_cash_holding_id AND holding_type = 'CASH'
                     AND deleted_at IS NULL AND status = 'ACTIVE') THEN
      RAISE EXCEPTION 'INVALID: บัญชีที่ตัดต้องเป็นบัญชีธนาคาร หรือบัญชีเงินฝากในพอร์ต' USING ERRCODE = '22023';
    END IF;
    IF (SELECT currency FROM public.investment_holdings WHERE id = NEW.autopay_cash_holding_id) <> NEW.currency THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีที่ตัดต้องสกุลเดียวกับบัตร (%)', NEW.currency USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS t55_autopay ON public.credit_cards;
CREATE TRIGGER t55_autopay BEFORE INSERT OR UPDATE OF autopay_asset_id, autopay_cash_holding_id, autopay_mode, currency ON public.credit_cards
  FOR EACH ROW EXECUTE FUNCTION private.tg_card_autopay_check();

-- 4) View รายการลงทุน: t.* ถูกขยายตอนสร้าง → สร้างใหม่ให้มีคอลัมน์ใหม่ (source_expense_item_id · to_credit_card_id) ----
DROP VIEW IF EXISTS public.v_investment_transactions_net;
CREATE VIEW public.v_investment_transactions_net WITH (security_invoker = true) AS
  SELECT t.*, private.itx_net_cash(t, t.currency) AS net_cash,
         CASE WHEN coalesce(t.settlement_date, t.transaction_date) > current_date THEN 'UNSETTLED'
              ELSE 'SETTLED' END AS settlement_status
    FROM public.investment_transactions t
   WHERE t.deleted_at IS NULL;
GRANT SELECT ON public.v_investment_transactions_net TO authenticated, service_role;

-- 5) สิทธิ์ (ฟังก์ชัน Trigger เรียกตรงไม่ได้) -----------------------------------------------------
REVOKE ALL ON FUNCTION private.tg_itx_payment_check(), private.tg_itx_card_lump() FROM PUBLIC, anon, authenticated;
