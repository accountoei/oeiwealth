-- =====================================================================
-- ส่วนต่างที่อธิบายไม่ได้ → ลงเป็นก้อน "รอแยกรายละเอียด" แล้วแยกทีหลัง (แม้ปิดงวดแล้ว)
--   * กระทบยอดธนาคาร: เงินหาย → ค่าใช้จ่ายก้อนจากบัญชี · เงินเกิน → รายได้ก้อนเข้าบัญชี (ลงวันสิ้นเดือน)
--   * บัตรเครดิต (อัปเดตยอดจาก Statement): ยอดเพิ่มเกินที่บันทึก → ค่าใช้จ่ายก้อน (จ่ายด้วยบัตร)
--   * เงินกู้ (อัปเดตยอดจาก Statement): ยอดหนี้สูงกว่าที่คำนวณ → ค่าใช้จ่ายก้อน (ดอกเบี้ย / ค่าธรรมเนียมที่ทบเข้าหนี้)
--   ก้อนเดียวต่อบัญชี / บัตร / หนี้ ต่อยอดหนึ่งครั้ง · ปรับยอดอัตโนมัติเมื่อมีรายการจริงเพิ่มเข้ามาในช่วงเดียวกัน
--   (ยอดก้อน = ยอดจริง − ยอดที่คำนวณจากรายการอื่นทั้งหมด) · ถึง 0 → ก้อนหายไปเอง
--   split_pending_item: แยกเป็นรายการจริงหลายบรรทัด (ยอดรวมเท่าเดิม · บัญชีเดิม) — ทำได้แม้ปิดงวดแล้ว
--   ก้อนแก้ / ลบตรง ๆ ไม่ได้ (ทำผ่านปุ่มเท่านั้น)
-- รันซ้ำได้
-- =====================================================================

ALTER TABLE public.expense_items ADD COLUMN IF NOT EXISTS pending_split boolean NOT NULL DEFAULT false;
ALTER TABLE public.expense_items ADD COLUMN IF NOT EXISTS lump_kind text;
ALTER TABLE public.expense_items ADD COLUMN IF NOT EXISTS lump_from date;          -- ช่วงที่ก้อนนี้ครอบคลุม (ไม่รวมวันนี้)
ALTER TABLE public.expense_items ADD COLUMN IF NOT EXISTS lump_base numeric;       -- ยอดหนี้ / บัตร ณ lump_from
ALTER TABLE public.expense_items ADD COLUMN IF NOT EXISTS lump_target numeric;     -- ยอดตาม Statement ณ วันที่ของก้อน
ALTER TABLE public.expense_items ADD COLUMN IF NOT EXISTS split_from_id uuid REFERENCES public.expense_items(id);
ALTER TABLE public.income_transactions ADD COLUMN IF NOT EXISTS pending_split boolean NOT NULL DEFAULT false;
ALTER TABLE public.income_transactions ADD COLUMN IF NOT EXISTS split_from_id uuid REFERENCES public.income_transactions(id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exp_lump_kind') THEN
    ALTER TABLE public.expense_items ADD CONSTRAINT exp_lump_kind
      CHECK ((pending_split = (lump_kind IS NOT NULL)) AND (lump_kind IS NULL OR lump_kind IN ('BANK','CARD','LIABILITY')));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS expense_items_lump_bank_uq ON public.expense_items(paid_from_asset_id, date)
  WHERE pending_split AND lump_kind = 'BANK' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expense_items_lump_card_uq ON public.expense_items(paid_from_credit_card_id, date)
  WHERE pending_split AND lump_kind = 'CARD' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expense_items_lump_liab_uq ON public.expense_items(liability_id, date)
  WHERE pending_split AND lump_kind = 'LIABILITY' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS income_lump_bank_uq ON public.income_transactions(received_to_asset_id, date)
  WHERE pending_split AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION private.lump_busy() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT coalesce(current_setting('fwv.lump', true), '') = 'on' $$;

-- 1) ก้อนแก้ / ลบตรง ๆ ไม่ได้ ----------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_lump_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF private.lump_busy() THEN RETURN coalesce(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.pending_split THEN RAISE EXCEPTION 'INVALID: รายการรอแยกรายละเอียดสร้างได้จากปุ่มกระทบยอด / อัปเดตยอดเท่านั้น' USING ERRCODE = '22023'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.pending_split AND (TG_OP = 'DELETE' OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.date IS DISTINCT FROM OLD.date
       OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       OR NEW.pending_split IS DISTINCT FROM OLD.pending_split
       OR (TG_TABLE_NAME = 'expense_items' AND (to_jsonb(NEW)->>'paid_from_asset_id' IS DISTINCT FROM to_jsonb(OLD)->>'paid_from_asset_id'
             OR to_jsonb(NEW)->>'paid_from_credit_card_id' IS DISTINCT FROM to_jsonb(OLD)->>'paid_from_credit_card_id'
             OR to_jsonb(NEW)->>'liability_id' IS DISTINCT FROM to_jsonb(OLD)->>'liability_id'))
       OR (TG_TABLE_NAME = 'income_transactions' AND to_jsonb(NEW)->>'received_to_asset_id' IS DISTINCT FROM to_jsonb(OLD)->>'received_to_asset_id')) THEN
    RAISE EXCEPTION 'INVALID: รายการรอแยกรายละเอียดแก้ยอด / ลบตรง ๆ ไม่ได้ — ใช้ปุ่ม "แยกรายการ"' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t12_lump_guard ON public.expense_items;
CREATE TRIGGER t12_lump_guard BEFORE INSERT OR UPDATE OR DELETE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_lump_guard();
DROP TRIGGER IF EXISTS t12_lump_guard ON public.income_transactions;
CREATE TRIGGER t12_lump_guard BEFORE INSERT OR UPDATE OR DELETE ON public.income_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_lump_guard();

-- 2) คำนวณก้อน --------------------------------------------------------------------
-- ธนาคาร: ยอดที่ต้องลงก้อน (+ = รายได้เข้า · − = ค่าใช้จ่ายออก)
CREATE OR REPLACE FUNCTION private.bank_lump_needed(p_bank uuid, p_m0 date, p_actual numeric, p_open numeric, p_open_date date)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d date := private.month_end(p_m0); e record; v_out numeric; v_in numeric;
BEGIN
  SELECT * INTO e FROM private.bank_movement_effects(p_bank, p_open_date, d);
  SELECT coalesce(sum(amount), 0) INTO v_out FROM public.expense_items
   WHERE pending_split AND lump_kind = 'BANK' AND paid_from_asset_id = p_bank AND deleted_at IS NULL
     AND date > p_open_date AND date <= d;
  SELECT coalesce(sum(amount - coalesce(tax, 0)), 0) INTO v_in FROM public.income_transactions
   WHERE pending_split AND received_to_asset_id = p_bank AND deleted_at IS NULL AND date > p_open_date AND date <= d;
  RETURN p_actual - (p_open + e.inflow - e.outflow + v_out - v_in);
END $$;

-- ธนาคาร: ตั้งก้อนให้เท่ากับยอดที่ต้องการ (ก้อนเดียว · กลับเครื่องหมายได้ · 0 = ลบ)
CREATE OR REPLACE FUNCTION private.set_bank_lump(p_bank uuid, p_date date, p_needed numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ccy text; v_name text; v_exp uuid; v_inc uuid; v_label text;
BEGIN
  SELECT currency, name INTO v_ccy, v_name FROM public.assets WHERE id = p_bank;
  v_label := 'รอแยกรายละเอียด · ส่วนต่างกระทบยอด ' || v_name || ' ' || to_char(p_date, 'MM/YYYY');
  SELECT id INTO v_exp FROM public.expense_items WHERE pending_split AND lump_kind = 'BANK' AND paid_from_asset_id = p_bank
     AND date_trunc('month', date) = date_trunc('month', p_date) AND deleted_at IS NULL;
  SELECT id INTO v_inc FROM public.income_transactions WHERE pending_split AND received_to_asset_id = p_bank
     AND date_trunc('month', date) = date_trunc('month', p_date) AND deleted_at IS NULL;
  PERFORM set_config('fwv.lump', 'on', true);
  IF p_needed < -0.005 THEN
    IF v_exp IS NULL THEN
      INSERT INTO public.expense_items(monthly_expense_id, paid_from_asset_id, date, description, amount, currency,
                                       expense_category, pending_split, lump_kind)
      VALUES (private.expense_month_id(p_date), p_bank, p_date, v_label, -p_needed, v_ccy, 'รอแยกรายละเอียด', true, 'BANK');
    ELSE
      UPDATE public.expense_items SET amount = -p_needed WHERE id = v_exp AND amount <> -p_needed;
    END IF;
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = v_inc;
  ELSIF p_needed > 0.005 THEN
    IF v_inc IS NULL THEN
      INSERT INTO public.income_transactions(family_id, received_to_asset_id, date, income_type, amount, currency, notes, pending_split)
      SELECT a.family_id, p_bank, p_date, 'OTHER', p_needed, v_ccy, v_label, true FROM public.assets a WHERE a.id = p_bank;
    ELSE
      UPDATE public.income_transactions SET amount = p_needed WHERE id = v_inc AND amount <> p_needed;
    END IF;
    UPDATE public.expense_items SET deleted_at = now() WHERE id = v_exp;
  ELSE
    UPDATE public.expense_items SET deleted_at = now() WHERE id = v_exp;
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = v_inc;
  END IF;
  PERFORM set_config('fwv.lump', 'off', true);
END $$;

-- ธนาคาร: คำนวณก้อนใหม่ (เฉพาะเดือนที่กระทบยอดแล้วและมีก้อนอยู่)
CREATE OR REPLACE FUNCTION private.recalc_bank_lump(p_bank uuid, p_m0 date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE br public.bank_reconciliations; v_open_date date; v_date date;
BEGIN
  IF private.lump_busy() THEN RETURN; END IF;
  SELECT date INTO v_date FROM public.expense_items WHERE pending_split AND lump_kind = 'BANK' AND paid_from_asset_id = p_bank
     AND date_trunc('month', date) = p_m0 AND deleted_at IS NULL;
  IF v_date IS NULL THEN
    SELECT date INTO v_date FROM public.income_transactions WHERE pending_split AND received_to_asset_id = p_bank
       AND date_trunc('month', date) = p_m0 AND deleted_at IS NULL;
  END IF;
  IF v_date IS NULL THEN RETURN; END IF;
  SELECT * INTO br FROM public.bank_reconciliations WHERE bank_asset_id = p_bank AND year_month = p_m0
     AND deleted_at IS NULL AND status <> 'OPEN' AND actual_closing IS NOT NULL;
  IF br.id IS NULL THEN RETURN; END IF;
  SELECT valuation_date INTO v_open_date FROM public.asset_valuations WHERE id = br.opening_valuation_id;
  PERFORM private.set_bank_lump(p_bank, v_date,
            private.bank_lump_needed(p_bank, p_m0, br.actual_closing - br.rounding_adjustment, br.opening_balance, v_open_date));
END $$;

-- บัตร / เงินกู้: ยอดก้อนที่ต้องการ (บวกเท่านั้น)
CREATE OR REPLACE FUNCTION private.card_lump_needed(p_card uuid, p_from date, p_to date, p_base numeric, p_target numeric, p_exclude uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_target - (p_base
    + coalesce((SELECT sum(amount) FROM public.expense_items WHERE paid_from_credit_card_id = p_card AND deleted_at IS NULL
                 AND id IS DISTINCT FROM p_exclude AND date > p_from AND date <= p_to), 0)
    - coalesce((SELECT sum(amount) FROM public.cash_movements WHERE to_credit_card_id = p_card AND movement_type = 'CARD_PAYMENT'
                 AND deleted_at IS NULL AND movement_date > p_from AND movement_date <= p_to), 0)
    - coalesce((SELECT sum(amount) FROM public.expense_reimbursements WHERE received_to_credit_card_id = p_card AND deleted_at IS NULL
                 AND received_date > p_from AND received_date <= p_to), 0))
$$;
CREATE OR REPLACE FUNCTION private.liability_lump_needed(p_liab uuid, p_from date, p_to date, p_base numeric, p_target numeric, p_exclude uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_target - (p_base - private.liability_principal_paid(p_liab, p_from, p_to)
    + coalesce((SELECT sum(amount) FROM public.expense_items WHERE liability_id = p_liab AND deleted_at IS NULL
                 AND paid_from_asset_id IS NULL AND paid_from_credit_card_id IS NULL
                 AND id IS DISTINCT FROM p_exclude AND date > p_from AND date <= p_to), 0))
$$;

-- บัตร / เงินกู้: ตั้งก้อน (สร้าง / ปรับ / ลบ)
CREATE OR REPLACE FUNCTION private.set_debt_lump(p_kind text, p_entity uuid, p_date date, p_from date, p_base numeric, p_target numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_need numeric; v_ccy text; v_name text;
BEGIN
  IF p_kind = 'CARD' THEN
    SELECT id INTO v_id FROM public.expense_items WHERE pending_split AND lump_kind = 'CARD' AND paid_from_credit_card_id = p_entity
       AND date = p_date AND deleted_at IS NULL;
    v_need := private.card_lump_needed(p_entity, p_from, p_date, p_base, p_target, v_id);
    SELECT currency, concat_ws(' ', issuer, card_name) INTO v_ccy, v_name FROM public.credit_cards WHERE id = p_entity;
  ELSE
    SELECT id INTO v_id FROM public.expense_items WHERE pending_split AND lump_kind = 'LIABILITY' AND liability_id = p_entity
       AND date = p_date AND deleted_at IS NULL;
    v_need := private.liability_lump_needed(p_entity, p_from, p_date, p_base, p_target, v_id);
    SELECT currency, name INTO v_ccy, v_name FROM public.liabilities WHERE id = p_entity;
  END IF;
  PERFORM set_config('fwv.lump', 'on', true);
  IF v_need > 0.005 THEN
    IF v_id IS NULL THEN
      INSERT INTO public.expense_items(monthly_expense_id, paid_from_credit_card_id, liability_id, date, description, amount, currency,
                                       expense_category, pending_split, lump_kind, lump_from, lump_base, lump_target)
      VALUES (private.expense_month_id(p_date), CASE WHEN p_kind = 'CARD' THEN p_entity END, CASE WHEN p_kind = 'LIABILITY' THEN p_entity END,
              p_date, 'รอแยกรายละเอียด · ' || CASE WHEN p_kind = 'CARD' THEN 'ยอดบัตรเพิ่มเกินที่บันทึก · ' ELSE 'ยอดหนี้เพิ่มจาก Statement · ' END || v_name,
              v_need, v_ccy, 'รอแยกรายละเอียด', true, p_kind, p_from, p_base, p_target);
    ELSE
      UPDATE public.expense_items SET amount = v_need, lump_from = p_from, lump_base = p_base, lump_target = p_target WHERE id = v_id;
    END IF;
  ELSE
    UPDATE public.expense_items SET deleted_at = now() WHERE id = v_id;
  END IF;
  PERFORM set_config('fwv.lump', 'off', true);
  RETURN greatest(v_need, 0);
END $$;

CREATE OR REPLACE FUNCTION private.recalc_debt_lumps(p_kind text, p_entity uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l record;
BEGIN
  IF private.lump_busy() OR p_entity IS NULL OR p_date IS NULL THEN RETURN; END IF;
  FOR l IN SELECT * FROM public.expense_items
            WHERE pending_split AND lump_kind = p_kind AND deleted_at IS NULL
              AND (CASE WHEN p_kind = 'CARD' THEN paid_from_credit_card_id ELSE liability_id END) = p_entity
              AND p_date > lump_from AND p_date <= date LOOP
    PERFORM private.set_debt_lump(p_kind, p_entity, l.date, l.lump_from, l.lump_base, l.lump_target);
  END LOOP;
END $$;

-- 3) ปรับก้อนอัตโนมัติเมื่อมีรายการจริงเพิ่ม / แก้ / ลบ ในช่วงเดียวกัน --------------------
CREATE OR REPLACE FUNCTION private.tg_lump_recalc_cm() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cash_movements; a uuid;
BEGIN
  IF private.lump_busy() THEN RETURN NULL; END IF;
  FOREACH r IN ARRAY ARRAY[OLD, NEW] LOOP
    CONTINUE WHEN r.id IS NULL;
    FOREACH a IN ARRAY ARRAY[r.from_asset_id, r.to_asset_id] LOOP
      IF a IS NOT NULL THEN PERFORM private.recalc_bank_lump(a, date_trunc('month', r.movement_date)::date); END IF;
    END LOOP;
    IF r.movement_type = 'CARD_PAYMENT' THEN PERFORM private.recalc_debt_lumps('CARD', r.to_credit_card_id, r.movement_date); END IF;
    IF r.movement_type = 'LIABILITY_PAYMENT' THEN PERFORM private.recalc_debt_lumps('LIABILITY', r.to_liability_id, r.movement_date); END IF;
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS a60_lump ON public.cash_movements;
CREATE TRIGGER a60_lump AFTER INSERT OR UPDATE OR DELETE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.tg_lump_recalc_cm();

CREATE OR REPLACE FUNCTION private.tg_lump_recalc_exp() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.expense_items;
BEGIN
  IF private.lump_busy() THEN RETURN NULL; END IF;
  FOREACH r IN ARRAY ARRAY[OLD, NEW] LOOP
    CONTINUE WHEN r.id IS NULL OR r.pending_split;
    IF r.paid_from_credit_card_id IS NOT NULL THEN PERFORM private.recalc_debt_lumps('CARD', r.paid_from_credit_card_id, r.date); END IF;
    IF r.liability_id IS NOT NULL AND r.paid_from_asset_id IS NULL AND r.paid_from_credit_card_id IS NULL THEN
      PERFORM private.recalc_debt_lumps('LIABILITY', r.liability_id, r.date);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS a60_lump ON public.expense_items;
CREATE TRIGGER a60_lump AFTER INSERT OR UPDATE OR DELETE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_lump_recalc_exp();

-- 4) ปุ่ม: กระทบยอดธนาคาร → ลงส่วนต่างเป็นก้อน -------------------------------------
DROP FUNCTION IF EXISTS public.settle_bank_difference(uuid, numeric);
CREATE FUNCTION public.settle_bank_difference(p_reconciliation_id uuid, p_actual_closing numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE br public.bank_reconciliations; v_actual numeric; v_open_date date; v_need numeric; v_date date; e record;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO br FROM public.bank_reconciliations WHERE id = p_reconciliation_id AND deleted_at IS NULL;
  IF br.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการกระทบยอด' USING ERRCODE = '22023'; END IF;
  v_date := least(private.month_end(br.year_month), current_date);
  IF br.status = 'OPEN' THEN
    v_actual := p_actual_closing;
    IF v_actual IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดจริงตาม Statement' USING ERRCODE = '22023'; END IF;
    PERFORM public.prepare_bank_reconciliation(br.bank_asset_id, br.year_month);
    SELECT * INTO br FROM public.bank_reconciliations WHERE id = p_reconciliation_id;
  ELSE
    v_actual := br.actual_closing - br.rounding_adjustment;
  END IF;
  SELECT valuation_date INTO v_open_date FROM public.asset_valuations WHERE id = br.opening_valuation_id;
  v_need := private.bank_lump_needed(br.bank_asset_id, br.year_month, v_actual, br.opening_balance, v_open_date);
  PERFORM private.set_bank_lump(br.bank_asset_id, v_date, v_need);

  IF br.status = 'OPEN' THEN
    PERFORM public.confirm_bank_reconciliation(br.id, v_actual, NULL, 0, NULL);
  ELSE
    -- ยืนยันพร้อมผลต่างไปแล้ว → คำนวณใหม่ให้ผลต่างเป็น 0
    SELECT * INTO e FROM private.bank_movement_effects(br.bank_asset_id, v_open_date, private.month_end(br.year_month));
    UPDATE public.bank_reconciliations
       SET known_inflows = e.inflow, known_outflows = e.outflow, calculated_closing = opening_balance + e.inflow - e.outflow,
           actual_closing = v_actual, rounding_adjustment = 0, status = 'RECONCILED', difference_reason = NULL
     WHERE id = br.id;
    UPDATE public.asset_valuations SET unexplained_difference = NULL WHERE id = br.closing_valuation_id;
  END IF;
  RETURN jsonb_build_object('kind', CASE WHEN v_need < -0.005 THEN 'EXPENSE' WHEN v_need > 0.005 THEN 'INCOME' END, 'amount', abs(v_need));
END $$;
REVOKE ALL ON FUNCTION public.settle_bank_difference(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_bank_difference(uuid, numeric) TO authenticated;

-- 5) อัปเดตยอดบัตรจาก Statement (+ ลงส่วนต่างเป็นก้อน) --------------------------------
DROP FUNCTION IF EXISTS public.update_card_statement(uuid, date, numeric, boolean);
CREATE FUNCTION public.update_card_statement(p_card_id uuid, p_date date, p_balance numeric, p_settle boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c public.credit_cards; l public.expense_items; v_from date; v_base numeric; v_diff numeric; v_lump numeric := 0;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF p_settle THEN PERFORM private.require_role('ADMIN','EDITOR'); END IF;
  SELECT * INTO c FROM public.credit_cards WHERE id = p_card_id AND deleted_at IS NULL;
  IF c.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัตร' USING ERRCODE = '22023'; END IF;
  IF p_date IS NULL OR p_date > current_date OR p_balance IS NULL OR p_balance < 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดและวันที่ให้ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  -- ก้อนเดิมของยอดวันเดียวกัน → ใช้จุดตั้งต้นเดิม
  SELECT * INTO l FROM public.expense_items WHERE pending_split AND lump_kind = 'CARD' AND paid_from_credit_card_id = c.id
     AND date = p_date AND deleted_at IS NULL;
  IF l.id IS NOT NULL THEN v_from := l.lump_from; v_base := l.lump_base;
  ELSE v_from := c.balance_date; v_base := c.outstanding_balance; END IF;
  UPDATE public.credit_cards SET outstanding_balance = p_balance, balance_date = p_date WHERE id = c.id;
  -- แก้ยอดย้อนหลัง (วันที่ก่อนยอดล่าสุด) = แก้ข้อมูล ไม่คำนวณส่วนต่าง
  IF v_from IS NOT NULL AND p_date > v_from THEN
    v_diff := private.card_lump_needed(c.id, v_from, p_date, v_base, p_balance, l.id);
    IF p_settle OR l.id IS NOT NULL THEN
      v_lump := private.set_debt_lump('CARD', c.id, p_date, v_from, v_base, p_balance);
    END IF;
  END IF;
  RETURN jsonb_build_object('difference', v_diff, 'lump', v_lump);
END $$;
REVOKE ALL ON FUNCTION public.update_card_statement(uuid, date, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_card_statement(uuid, date, numeric, boolean) TO authenticated;

-- 6) อัปเดตยอดเงินกู้จาก Statement (+ ลงส่วนต่างเป็นก้อน) -----------------------------
DROP FUNCTION IF EXISTS public.update_liability_statement(uuid, date, numeric, text, text, boolean);
CREATE FUNCTION public.update_liability_statement(p_liability_id uuid, p_date date, p_balance numeric,
  p_source text DEFAULT 'STATEMENT', p_notes text DEFAULT NULL, p_settle boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE lb public.liabilities; l public.expense_items; v_prev public.liability_valuations; v_from date; v_base numeric;
        v_diff numeric; v_lump numeric := 0;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF p_settle THEN PERFORM private.require_role('ADMIN','EDITOR'); END IF;
  SELECT * INTO lb FROM public.liabilities WHERE id = p_liability_id AND deleted_at IS NULL;
  IF lb.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบหนี้' USING ERRCODE = '22023'; END IF;
  IF p_date IS NULL OR p_balance IS NULL OR p_balance < 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดและวันที่' USING ERRCODE = '22023'; END IF;
  SELECT * INTO l FROM public.expense_items WHERE pending_split AND lump_kind = 'LIABILITY' AND liability_id = lb.id
     AND date = p_date AND deleted_at IS NULL;
  IF l.id IS NOT NULL THEN v_from := l.lump_from; v_base := l.lump_base;
  ELSE
    SELECT * INTO v_prev FROM public.liability_valuations WHERE liability_id = lb.id AND deleted_at IS NULL AND valuation_date < p_date
     ORDER BY valuation_date DESC, created_at DESC LIMIT 1;
    v_from := v_prev.valuation_date; v_base := v_prev.balance;
  END IF;
  INSERT INTO public.liability_valuations(liability_id, valuation_date, balance, source, notes)
  VALUES (lb.id, p_date, p_balance, coalesce(nullif(p_source, ''), 'STATEMENT'), nullif(trim(p_notes), ''))
  ON CONFLICT (liability_id, valuation_date) WHERE deleted_at IS NULL
  DO UPDATE SET balance = EXCLUDED.balance, source = EXCLUDED.source, notes = coalesce(EXCLUDED.notes, public.liability_valuations.notes);
  IF v_from IS NOT NULL THEN
    v_diff := private.liability_lump_needed(lb.id, v_from, p_date, v_base, p_balance, l.id);
    IF p_settle OR l.id IS NOT NULL THEN
      v_lump := private.set_debt_lump('LIABILITY', lb.id, p_date, v_from, v_base, p_balance);
    END IF;
  END IF;
  RETURN jsonb_build_object('difference', v_diff, 'lump', v_lump);
END $$;
REVOKE ALL ON FUNCTION public.update_liability_statement(uuid, date, numeric, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_liability_statement(uuid, date, numeric, text, text, boolean) TO authenticated;

-- 7) แยกรายการ (ทำได้แม้ปิดงวดแล้ว: ยอดรวม / บัญชีเท่าเดิม) -----------------------------
-- p_lines: [{ description, amount, date?, expense_category? | income_type?, person_id?, notes? }]
DROP FUNCTION IF EXISTS public.split_pending_item(text, uuid, jsonb);
CREATE FUNCTION public.split_pending_item(p_kind text, p_id uuid, p_lines jsonb)
RETURNS numeric
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE le public.expense_items; li public.income_transactions; x jsonb; v_old numeric; v_sum numeric := 0; v_left numeric;
        v_amt numeric; v_date date; v_lump_date date; v_m0 date; v_bank uuid; v_from date;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่รายการอย่างน้อย 1 บรรทัด' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'EXPENSE' THEN
    SELECT * INTO le FROM public.expense_items WHERE id = p_id AND pending_split AND deleted_at IS NULL;
    IF le.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการรอแยก' USING ERRCODE = '22023'; END IF;
    v_old := le.amount; v_lump_date := le.date; v_bank := le.paid_from_asset_id; v_from := le.lump_from;
  ELSIF p_kind = 'INCOME' THEN
    SELECT * INTO li FROM public.income_transactions WHERE id = p_id AND pending_split AND deleted_at IS NULL;
    IF li.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการรอแยก' USING ERRCODE = '22023'; END IF;
    v_old := li.amount; v_lump_date := li.date; v_bank := li.received_to_asset_id;
  ELSE
    RAISE EXCEPTION 'INVALID: ประเภทไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  v_m0 := date_trunc('month', v_lump_date)::date;

  PERFORM set_config('fwv.split', 'on', true);
  FOR x IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_amt := nullif(x->>'amount', '')::numeric;
    IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'INVALID: ยอดแต่ละบรรทัดต้องมากกว่า 0' USING ERRCODE = '22023'; END IF;
    IF length(trim(coalesce(x->>'description', ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่รายละเอียดทุกบรรทัด' USING ERRCODE = '22023'; END IF;
    v_date := coalesce(nullif(x->>'date', '')::date, v_lump_date);
    -- วันที่ต้องอยู่ในช่วงของก้อน (ธนาคาร = เดือนเดียวกัน · บัตร / หนี้ = หลังยอดก่อนหน้า ถึงวันที่ของก้อน)
    IF (v_from IS NULL AND date_trunc('month', v_date)::date <> v_m0) OR (v_from IS NOT NULL AND (v_date <= v_from OR v_date > v_lump_date))
       OR v_date > v_lump_date THEN
      RAISE EXCEPTION 'INVALID: วันที่ % อยู่นอกช่วงของรายการรอแยก', v_date USING ERRCODE = '22023';
    END IF;
    v_sum := v_sum + v_amt;
    IF p_kind = 'EXPENSE' THEN
      INSERT INTO public.expense_items(monthly_expense_id, paid_from_asset_id, paid_from_credit_card_id, liability_id, person_id, date,
                                       description, amount, currency, expense_category, notes, split_from_id)
      VALUES (private.expense_month_id(v_date), le.paid_from_asset_id, le.paid_from_credit_card_id, le.liability_id,
              nullif(x->>'person_id', '')::uuid, v_date, trim(x->>'description'), v_amt, le.currency,
              coalesce(nullif(trim(x->>'expense_category'), ''), 'ทั่วไป'), nullif(trim(x->>'notes'), ''), le.id);
    ELSE
      INSERT INTO public.income_transactions(family_id, received_to_asset_id, person_id, date, income_type, amount, currency, notes, split_from_id)
      VALUES (li.family_id, li.received_to_asset_id, nullif(x->>'person_id', '')::uuid, v_date,
              coalesce(nullif(x->>'income_type', ''), 'OTHER'), v_amt, li.currency, trim(x->>'description'), li.id);
    END IF;
  END LOOP;
  IF v_sum > v_old + 0.005 THEN
    RAISE EXCEPTION 'INVALID: ยอดที่แยก (%) มากกว่ายอดรอแยก (%)', v_sum, v_old USING ERRCODE = '22023';
  END IF;

  -- ก้อนที่เหลือ = คำนวณใหม่จากยอดจริง
  IF p_kind = 'INCOME' OR le.lump_kind = 'BANK' THEN PERFORM private.recalc_bank_lump(v_bank, v_m0);
  ELSE PERFORM private.recalc_debt_lumps(le.lump_kind, coalesce(le.paid_from_credit_card_id, le.liability_id), le.date);
  END IF;
  IF p_kind = 'EXPENSE' THEN
    SELECT coalesce(sum(amount), 0) INTO v_left FROM public.expense_items WHERE id = le.id AND deleted_at IS NULL;
  ELSE
    SELECT coalesce(sum(amount), 0) INTO v_left FROM public.income_transactions WHERE id = li.id AND deleted_at IS NULL;
  END IF;
  IF abs(v_left + v_sum - v_old) > 0.01 THEN
    RAISE EXCEPTION 'INVALID: ยอดหลังแยกไม่ตรงกับยอดเดิม (เหลือ % + แยก % ≠ %)', v_left, v_sum, v_old USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('fwv.split', 'off', true);
  RETURN v_left;
END $$;
REVOKE ALL ON FUNCTION public.split_pending_item(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_pending_item(text, uuid, jsonb) TO authenticated;

-- 8) งวดที่ปิดแล้ว: ยอมเฉพาะการแยกรายการ (flag fwv.split) --------------------------------
CREATE OR REPLACE FUNCTION private.tg_period_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_rows jsonb[] := ARRAY[]::jsonb[];
  v_row jsonb; v_col text; v_d date;
  v_family uuid; v_locked date; v_go_live date; v_status text;
  v_client boolean := private.is_client();
BEGIN
  -- แยกรายการ "รอแยกรายละเอียด" (split_pending_item): ยอดรวม / บัญชีเท่าเดิม → ยอมในงวดที่ปิดแล้ว
  --   flag ตั้งได้เฉพาะในฟังก์ชันฝั่งฐานข้อมูล (ผู้ใช้เรียก set_config ผ่าน API ไม่ได้)
  IF current_setting('fwv.split', true) = 'on'
     AND TG_TABLE_NAME IN ('expense_items','income_transactions','cash_movements','monthly_expenses') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN v_rows := v_rows || to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN v_rows := v_rows || to_jsonb(NEW); END IF;

  v_family := private.family_of(v_rows[array_length(v_rows,1)]);
  v_locked := private.locked_through(v_family);
  SELECT f.go_live_date, f.system_status INTO v_go_live, v_status
    FROM public.families f WHERE f.id = v_family;

  FOREACH v_row IN ARRAY v_rows LOOP
    FOREACH v_col IN ARRAY TG_ARGV LOOP
      v_d := (v_row ->> v_col)::date;
      CONTINUE WHEN v_d IS NULL;
      IF v_locked IS NOT NULL AND v_d <= v_locked THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: %.% = % อยู่ในงวดที่ปิดแล้ว (ถึง %) ต้อง Reopen ก่อน',
          TG_TABLE_NAME, v_col, v_d, v_locked USING ERRCODE = '42501';
      END IF;
      IF v_status = 'LIVE' AND v_d < v_go_live THEN
        IF NOT private.is_opening_row(TG_TABLE_NAME, v_row, v_go_live) THEN
          RAISE EXCEPTION 'BEFORE_GO_LIVE: %.% = % อยู่ก่อน Go-live (%) ยอดก่อนหน้านี้รวมใน Opening Position แล้ว',
            TG_TABLE_NAME, v_col, v_d, v_go_live USING ERRCODE = '42501';
        END IF;
        IF v_client AND NOT private.has_role('ADMIN') THEN
          RAISE EXCEPTION 'OPENING_LOCKED: ยอดตั้งต้นหลัง Go-live แก้ได้เฉพาะ ADMIN' USING ERRCODE = '42501';
        END IF;
        IF v_client AND TG_OP <> 'DELETE' AND to_jsonb(NEW) ? 'notes'
           AND length(trim(coalesce(to_jsonb(NEW)->>'notes',''))) = 0 THEN
          RAISE EXCEPTION 'OPENING_REASON_REQUIRED: แก้ยอดตั้งต้นหลัง Go-live ต้องระบุเหตุผลใน notes'
            USING ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
