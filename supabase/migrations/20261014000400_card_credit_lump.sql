-- =====================================================================
-- บัตรเครดิต: ยอดตาม Statement ต่ำกว่าที่คำนวณ → รายได้ก้อน "รอแยกรายละเอียด" เข้าบัตร (ลดยอดบัตร)
--   แบบเดียวกับบัญชีธนาคาร (เงินเกิน → รายได้ก้อน) · ก้อนเดียวต่อบัตรต่อยอดหนึ่งครั้ง · กลับเครื่องหมายได้
--   income_transactions.received_to_credit_card_id: รายได้ / เงินคืนที่เข้าบัตร (ไม่ผ่านบัญชี) → ลดยอดบัตร
--   ผู้รับ = เจ้าของบัตร · แยกรายการได้ (แม้ปิดงวดแล้ว) เหมือนก้อนอื่น
-- รันซ้ำได้
-- =====================================================================

ALTER TABLE public.income_transactions ADD COLUMN IF NOT EXISTS received_to_credit_card_id uuid REFERENCES public.credit_cards(id);
ALTER TABLE public.income_transactions ADD COLUMN IF NOT EXISTS lump_from date;
ALTER TABLE public.income_transactions ADD COLUMN IF NOT EXISTS lump_base numeric;
ALTER TABLE public.income_transactions ADD COLUMN IF NOT EXISTS lump_target numeric;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inc_one_receiver') THEN
    ALTER TABLE public.income_transactions ADD CONSTRAINT inc_one_receiver
      CHECK (num_nonnulls(received_to_asset_id, received_to_credit_card_id) <= 1);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS income_lump_card_uq ON public.income_transactions(received_to_credit_card_id, date)
  WHERE pending_split AND deleted_at IS NULL;

-- รูด − จ่าย − เงินคืน − รายได้เข้าบัตร ในช่วง (p_from, p_to]
CREATE OR REPLACE FUNCTION private.card_activity(p_card uuid, p_from date, p_to date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT sum(amount) FROM public.expense_items WHERE paid_from_credit_card_id = p_card AND deleted_at IS NULL
                     AND date > p_from AND date <= p_to), 0)
       - coalesce((SELECT sum(amount) FROM public.cash_movements WHERE to_credit_card_id = p_card AND movement_type = 'CARD_PAYMENT'
                     AND deleted_at IS NULL AND movement_date > p_from AND movement_date <= p_to), 0)
       - coalesce((SELECT sum(amount) FROM public.expense_reimbursements WHERE received_to_credit_card_id = p_card AND deleted_at IS NULL
                     AND received_date > p_from AND received_date <= p_to), 0)
       - coalesce((SELECT sum(amount - coalesce(tax, 0)) FROM public.income_transactions WHERE received_to_credit_card_id = p_card
                     AND deleted_at IS NULL AND date > p_from AND date <= p_to), 0)
$$;

-- ยอดก้อนที่ต้องการ (+ = ค่าใช้จ่าย · − = รายได้เข้าบัตร) · ไม่นับก้อนของยอดนี้เอง
CREATE OR REPLACE FUNCTION private.card_lump_needed(p_card uuid, p_from date, p_to date, p_base numeric, p_target numeric, p_exclude uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_target - (p_base + private.card_activity(p_card, p_from, p_to)
    - coalesce((SELECT sum(amount) FROM public.expense_items WHERE id = p_exclude AND deleted_at IS NULL
                 AND paid_from_credit_card_id = p_card AND date > p_from AND date <= p_to), 0)
    + coalesce((SELECT sum(amount - coalesce(tax, 0)) FROM public.income_transactions WHERE id = p_exclude AND deleted_at IS NULL
                 AND received_to_credit_card_id = p_card AND date > p_from AND date <= p_to), 0))
$$;

-- บัตร / เงินกู้: ตั้งก้อน (บัตร: บวก = ค่าใช้จ่าย · ลบ = รายได้เข้าบัตร · เงินกู้: บวกเท่านั้น) · คืนค่าแบบมีเครื่องหมาย
CREATE OR REPLACE FUNCTION private.set_debt_lump(p_kind text, p_entity uuid, p_date date, p_from date, p_base numeric, p_target numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_inc uuid; v_need numeric; v_ccy text; v_name text; v_owner uuid; v_family uuid;
BEGIN
  IF p_kind = 'CARD' THEN
    SELECT id INTO v_id FROM public.expense_items WHERE pending_split AND lump_kind = 'CARD' AND paid_from_credit_card_id = p_entity
       AND date = p_date AND deleted_at IS NULL;
    SELECT id INTO v_inc FROM public.income_transactions WHERE pending_split AND received_to_credit_card_id = p_entity
       AND date = p_date AND deleted_at IS NULL;
    v_need := private.card_lump_needed(p_entity, p_from, p_date, p_base, p_target, coalesce(v_id, v_inc));
    SELECT c.currency, concat_ws(' ', c.issuer, c.card_name), c.person_id, p.family_id INTO v_ccy, v_name, v_owner, v_family
      FROM public.credit_cards c JOIN public.persons p ON p.id = c.person_id WHERE c.id = p_entity;
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
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = v_inc;
  ELSIF v_need < -0.005 AND p_kind = 'CARD' THEN
    IF v_inc IS NULL THEN
      INSERT INTO public.income_transactions(family_id, received_to_credit_card_id, person_id, date, income_type, amount, currency, notes,
                                             pending_split, lump_from, lump_base, lump_target)
      VALUES (v_family, p_entity, v_owner, p_date, 'OTHER', -v_need, v_ccy,
              'รอแยกรายละเอียด · ยอดบัตรลดเกินที่บันทึก (เงินคืน / เครดิต) · ' || v_name, true, p_from, p_base, p_target);
    ELSE
      UPDATE public.income_transactions SET amount = -v_need, lump_from = p_from, lump_base = p_base, lump_target = p_target WHERE id = v_inc;
    END IF;
    UPDATE public.expense_items SET deleted_at = now() WHERE id = v_id;
  ELSE
    UPDATE public.expense_items SET deleted_at = now() WHERE id = v_id;
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = v_inc;
  END IF;
  PERFORM set_config('fwv.lump', 'off', true);
  RETURN CASE WHEN p_kind = 'CARD' OR v_need > 0 THEN v_need ELSE 0 END;
END $$;

-- คำนวณก้อนบัตร / หนี้ใหม่ (ทั้งก้อนค่าใช้จ่ายและก้อนรายได้เข้าบัตร)
CREATE OR REPLACE FUNCTION private.recalc_debt_lumps(p_kind text, p_entity uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l record;
BEGIN
  IF private.lump_busy() OR p_entity IS NULL OR p_date IS NULL THEN RETURN; END IF;
  FOR l IN SELECT date, lump_from, lump_base, lump_target FROM public.expense_items
            WHERE pending_split AND lump_kind = p_kind AND deleted_at IS NULL
              AND (CASE WHEN p_kind = 'CARD' THEN paid_from_credit_card_id ELSE liability_id END) = p_entity
              AND p_date > lump_from AND p_date <= date
           UNION
           SELECT date, lump_from, lump_base, lump_target FROM public.income_transactions
            WHERE p_kind = 'CARD' AND pending_split AND deleted_at IS NULL AND received_to_credit_card_id = p_entity
              AND p_date > lump_from AND p_date <= date LOOP
    PERFORM private.set_debt_lump(p_kind, p_entity, l.date, l.lump_from, l.lump_base, l.lump_target);
  END LOOP;
END $$;

-- รายได้เข้าบัตรเพิ่ม / แก้ / ลบ → ปรับก้อนบัตรในช่วงเดียวกัน
CREATE OR REPLACE FUNCTION private.tg_lump_recalc_inc() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.income_transactions;
BEGIN
  IF private.lump_busy() THEN RETURN NULL; END IF;
  FOREACH r IN ARRAY ARRAY[OLD, NEW] LOOP
    CONTINUE WHEN r.id IS NULL OR r.pending_split OR r.received_to_credit_card_id IS NULL;
    PERFORM private.recalc_debt_lumps('CARD', r.received_to_credit_card_id, r.date);
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS a60_lump ON public.income_transactions;
CREATE TRIGGER a60_lump AFTER INSERT OR UPDATE OR DELETE ON public.income_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_lump_recalc_inc();

-- เงินคืนเข้าบัตร (expense_reimbursements) ก็ปรับก้อนบัตรด้วย
CREATE OR REPLACE FUNCTION private.tg_lump_recalc_reimb() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.expense_reimbursements;
BEGIN
  IF private.lump_busy() THEN RETURN NULL; END IF;
  FOREACH r IN ARRAY ARRAY[OLD, NEW] LOOP
    CONTINUE WHEN r.id IS NULL OR r.received_to_credit_card_id IS NULL;
    PERFORM private.recalc_debt_lumps('CARD', r.received_to_credit_card_id, r.received_date);
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS a60_lump ON public.expense_reimbursements;
CREATE TRIGGER a60_lump AFTER INSERT OR UPDATE OR DELETE ON public.expense_reimbursements
  FOR EACH ROW EXECUTE FUNCTION private.tg_lump_recalc_reimb();

-- ก้อนแก้ / ลบตรง ๆ ไม่ได้ (เพิ่มบัตร)
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
       OR (TG_TABLE_NAME = 'income_transactions' AND (to_jsonb(NEW)->>'received_to_asset_id' IS DISTINCT FROM to_jsonb(OLD)->>'received_to_asset_id'
             OR to_jsonb(NEW)->>'received_to_credit_card_id' IS DISTINCT FROM to_jsonb(OLD)->>'received_to_credit_card_id'))) THEN
    RAISE EXCEPTION 'INVALID: รายการรอแยกรายละเอียดแก้ยอด / ลบตรง ๆ ไม่ได้ — ใช้ปุ่ม "แยกรายการ"' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- ตรวจสกุลเงินของรายได้ที่เข้าบัตร
CREATE OR REPLACE FUNCTION private.tg_income_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_prop_asset uuid; v_ccy text;
BEGIN
  NEW.family_id := coalesce(NEW.family_id, private.default_family_id());
  IF NEW.lease_id IS NOT NULL THEN
    SELECT pd.asset_id INTO v_prop_asset FROM public.property_leases l
      JOIN public.property_details pd ON pd.id = l.property_id WHERE l.id = NEW.lease_id;
    IF NEW.asset_id IS NOT NULL AND NEW.asset_id <> v_prop_asset THEN
      RAISE EXCEPTION 'INVALID: asset_id ต้องเป็น Property ของสัญญาเช่า' USING ERRCODE = '22023';
    END IF;
    NEW.asset_id := v_prop_asset;
    NEW.person_id := NULL;                       -- แบ่งตาม Ownership ของ Property
  END IF;
  IF NEW.received_to_asset_id IS NOT NULL THEN
    IF NOT private.is_bank_asset(NEW.received_to_asset_id) THEN
      RAISE EXCEPTION 'INVALID: received_to_asset_id ต้องเป็นบัญชีธนาคาร' USING ERRCODE = '22023';
    END IF;
    SELECT currency INTO v_ccy FROM public.assets WHERE id = NEW.received_to_asset_id;
    IF v_ccy <> NEW.currency THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: รายได้ที่เข้าบัญชีต้องสกุลเดียวกับบัญชี (%) — บันทึกตามยอดที่เข้าบัญชีจริง', v_ccy
        USING ERRCODE = '22023';
    END IF;
  END IF;
  -- เงินเข้าบัตรเครดิต (ลดยอดบัตร) — สกุลต้องตรงกับบัตร
  IF NEW.received_to_credit_card_id IS NOT NULL THEN
    SELECT currency INTO v_ccy FROM public.credit_cards WHERE id = NEW.received_to_credit_card_id;
    IF v_ccy IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: รายได้ที่เข้าบัตรต้องสกุลเดียวกับบัตร (%)', v_ccy USING ERRCODE = '22023';
    END IF;
  END IF;
  IF (NEW.lease_id IS NOT NULL OR NEW.recurring_template_id IS NOT NULL) AND NEW.income_period IS NULL THEN
    NEW.income_period := date_trunc('month', NEW.date)::date;
  END IF;
  NEW.base_amount := round(NEW.amount * private.fx_rate(NEW.currency, NEW.date), 4);
  RETURN NEW;
END $$;

-- อัปเดตยอดบัตรจาก Statement: ใช้จุดตั้งต้นของก้อนรายได้เข้าบัตรด้วย
CREATE OR REPLACE FUNCTION public.update_card_statement(p_card_id uuid, p_date date, p_balance numeric, p_settle boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c public.credit_cards; l public.expense_items; li public.income_transactions; v_from date; v_base numeric; v_diff numeric; v_lump numeric := 0;
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
  SELECT * INTO li FROM public.income_transactions WHERE pending_split AND received_to_credit_card_id = c.id
     AND date = p_date AND deleted_at IS NULL;
  IF l.id IS NOT NULL THEN v_from := l.lump_from; v_base := l.lump_base;
  ELSIF li.id IS NOT NULL THEN v_from := li.lump_from; v_base := li.lump_base;
  ELSE v_from := c.balance_date; v_base := c.outstanding_balance; END IF;
  UPDATE public.credit_cards SET outstanding_balance = p_balance, balance_date = p_date WHERE id = c.id;
  -- แก้ยอดย้อนหลัง (วันที่ก่อนยอดล่าสุด) = แก้ข้อมูล ไม่คำนวณส่วนต่าง
  IF v_from IS NOT NULL AND p_date > v_from THEN
    v_diff := private.card_lump_needed(c.id, v_from, p_date, v_base, p_balance, coalesce(l.id, li.id));
    IF p_settle OR l.id IS NOT NULL OR li.id IS NOT NULL THEN
      v_lump := private.set_debt_lump('CARD', c.id, p_date, v_from, v_base, p_balance);
    END IF;
  END IF;
  RETURN jsonb_build_object('difference', v_diff, 'lump', v_lump);
END $$;
REVOKE ALL ON FUNCTION public.update_card_statement(uuid, date, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_card_statement(uuid, date, numeric, boolean) TO authenticated;

-- แยกรายการ: รองรับก้อนรายได้เข้าบัตร
CREATE OR REPLACE FUNCTION public.split_pending_item(p_kind text, p_id uuid, p_lines jsonb)
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
    v_old := li.amount; v_lump_date := li.date; v_bank := li.received_to_asset_id; v_from := li.lump_from;
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
      INSERT INTO public.income_transactions(family_id, received_to_asset_id, received_to_credit_card_id, person_id, date, income_type, amount, currency, notes, split_from_id)
      VALUES (li.family_id, li.received_to_asset_id, li.received_to_credit_card_id,
              coalesce(nullif(x->>'person_id', '')::uuid, CASE WHEN li.received_to_credit_card_id IS NOT NULL THEN li.person_id END), v_date,
              coalesce(nullif(x->>'income_type', ''), 'OTHER'), v_amt, li.currency, trim(x->>'description'), li.id);
    END IF;
  END LOOP;
  IF v_sum > v_old + 0.005 THEN
    RAISE EXCEPTION 'INVALID: ยอดที่แยก (%) มากกว่ายอดรอแยก (%)', v_sum, v_old USING ERRCODE = '22023';
  END IF;

  -- ก้อนที่เหลือ = คำนวณใหม่จากยอดจริง
  IF p_kind = 'INCOME' AND li.received_to_credit_card_id IS NOT NULL THEN
    PERFORM private.recalc_debt_lumps('CARD', li.received_to_credit_card_id, li.date);
  ELSIF p_kind = 'INCOME' OR le.lump_kind = 'BANK' THEN PERFORM private.recalc_bank_lump(v_bank, v_m0);
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
