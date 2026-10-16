-- =====================================================================
-- ยอดหนี้ / ยอดบัตรตาม Statement "ต่ำกว่า" ที่คำนวณ
--   * หนี้สิน (เงินกู้): ส่วนที่ลดเกิน → รายได้ก้อน "รอแยกรายละเอียด" ผูกกับหนี้ (แบบเดียวกับบัตร)
--       income_transactions.received_to_liability_id = รายได้ที่ลดหนี้โดยตรง (ไม่ผ่านบัญชี เช่น ส่วนลด / ลดหนี้ให้)
--       มาจากก้อนเท่านั้น (ก้อนเอง / รายการที่แยกออกจากก้อน · วันที่อยู่ในช่วงของก้อน) → ไม่กระทบยอดหนี้หลัง Statement
--   * pay_from_statement_drop(): "ลงเป็นการจ่าย" — เปลี่ยนรายได้ก้อนของยอดนี้ (บัตร / หนี้) เป็นการจ่ายจากบัญชี
--       สร้างเงินออกจากบัญชีวันเดียวกับยอด → ก้อนรายได้ลดลง / หายเอง · ก้อนค่าใช้จ่ายของบัญชี (ถ้ามี) ก็ลดลงเอง
--   ไม่แก้ / ไม่ลบข้อมูลเดิม (เพิ่มคอลัมน์ว่าง 1 ช่อง) · รันซ้ำได้
-- =====================================================================

-- 1) คอลัมน์ + กติกาผู้รับ (ผู้รับได้ไม่เกิน 1: บัญชี / บัตร / หนี้) -----------------------------------
ALTER TABLE public.income_transactions ADD COLUMN IF NOT EXISTS received_to_liability_id uuid REFERENCES public.liabilities(id);
ALTER TABLE public.income_transactions DROP CONSTRAINT IF EXISTS inc_one_receiver;
ALTER TABLE public.income_transactions ADD CONSTRAINT inc_one_receiver
  CHECK (num_nonnulls(received_to_asset_id, received_to_credit_card_id, received_to_liability_id) <= 1);
CREATE UNIQUE INDEX IF NOT EXISTS income_lump_liab_uq ON public.income_transactions(received_to_liability_id, date)
  WHERE pending_split AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS income_liab_idx ON public.income_transactions(received_to_liability_id)
  WHERE received_to_liability_id IS NOT NULL;

-- 2) ตรวจรายได้ (เพิ่มส่วนหนี้) ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_income_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_prop_asset uuid; v_ccy text; v_pdate date; v_pfrom date;
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
  -- รายได้ที่ลดหนี้โดยตรง — สกุลตรงกับหนี้ · มาจากก้อน "รอแยกรายละเอียด" เท่านั้น · วันที่อยู่ในช่วงของก้อน
  IF NEW.received_to_liability_id IS NOT NULL THEN
    SELECT currency INTO v_ccy FROM public.liabilities WHERE id = NEW.received_to_liability_id;
    IF v_ccy IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: รายได้ที่ลดหนี้ต้องสกุลเดียวกับหนี้ (%)', v_ccy USING ERRCODE = '22023';
    END IF;
    IF NOT NEW.pending_split THEN
      SELECT date, lump_from INTO v_pdate, v_pfrom FROM public.income_transactions
       WHERE id = NEW.split_from_id AND received_to_liability_id = NEW.received_to_liability_id;
      IF v_pdate IS NULL THEN
        RAISE EXCEPTION 'INVALID: รายได้ที่ลดหนี้ต้องแยกมาจากรายการรอแยกรายละเอียดของหนี้นั้น' USING ERRCODE = '22023';
      END IF;
      IF NEW.date > v_pdate OR (v_pfrom IS NOT NULL AND NEW.date <= v_pfrom) THEN
        RAISE EXCEPTION 'INVALID: วันที่ % อยู่นอกช่วงของยอดหนี้ที่ลดลง', NEW.date USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;
  IF (NEW.lease_id IS NOT NULL OR NEW.recurring_template_id IS NOT NULL) AND NEW.income_period IS NULL THEN
    NEW.income_period := date_trunc('month', NEW.date)::date;
  END IF;
  NEW.base_amount := round(NEW.amount * private.fx_rate(NEW.currency, NEW.date), 4);
  RETURN NEW;
END $$;

-- 3) ก้อนแก้ / ลบตรง ๆ ไม่ได้ (เพิ่มผู้รับที่เป็นหนี้) ------------------------------------------------
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
             OR to_jsonb(NEW)->>'received_to_credit_card_id' IS DISTINCT FROM to_jsonb(OLD)->>'received_to_credit_card_id'
             OR to_jsonb(NEW)->>'received_to_liability_id' IS DISTINCT FROM to_jsonb(OLD)->>'received_to_liability_id'))) THEN
    RAISE EXCEPTION 'INVALID: รายการรอแยกรายละเอียดแก้ยอด / ลบตรง ๆ ไม่ได้ — ใช้ปุ่ม "แยกรายการ"' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- 4) ยอดก้อนหนี้ที่ต้องการ (+ = ค่าใช้จ่าย · − = รายได้ลดหนี้) · ไม่นับก้อนของยอดนี้เอง -------------------------
CREATE OR REPLACE FUNCTION private.liability_lump_needed(p_liab uuid, p_from date, p_to date, p_base numeric, p_target numeric, p_exclude uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_target - (p_base - private.liability_principal_paid(p_liab, p_from, p_to)
    + coalesce((SELECT sum(amount) FROM public.expense_items WHERE liability_id = p_liab AND deleted_at IS NULL
                 AND paid_from_asset_id IS NULL AND paid_from_credit_card_id IS NULL
                 AND id IS DISTINCT FROM p_exclude AND date > p_from AND date <= p_to), 0)
    - coalesce((SELECT sum(amount - coalesce(tax, 0)) FROM public.income_transactions WHERE received_to_liability_id = p_liab
                 AND deleted_at IS NULL AND id IS DISTINCT FROM p_exclude AND date > p_from AND date <= p_to), 0))
$$;

-- 5) ตั้งก้อนบัตร / หนี้ (บวก = ค่าใช้จ่าย · ลบ = รายได้เข้าบัตร / ลดหนี้) · คืนค่าแบบมีเครื่องหมาย ----------------
CREATE OR REPLACE FUNCTION private.set_debt_lump(p_kind text, p_entity uuid, p_date date, p_from date, p_base numeric, p_target numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_inc uuid; v_need numeric; v_ccy text; v_name text; v_owner uuid; v_family uuid;
BEGIN
  IF p_kind = 'CARD' THEN
    -- ก้อนของเดือนนี้ที่วันที่ไม่เกินยอดนี้
    SELECT id INTO v_id FROM public.expense_items WHERE pending_split AND lump_kind = 'CARD' AND paid_from_credit_card_id = p_entity
       AND date_trunc('month', date) = date_trunc('month', p_date) AND date <= p_date AND deleted_at IS NULL
     ORDER BY date DESC LIMIT 1;
    SELECT id INTO v_inc FROM public.income_transactions WHERE pending_split AND received_to_credit_card_id = p_entity
       AND date_trunc('month', date) = date_trunc('month', p_date) AND date <= p_date AND deleted_at IS NULL
     ORDER BY date DESC LIMIT 1;
    v_need := private.card_lump_needed(p_entity, p_from, p_date, p_base, p_target, coalesce(v_id, v_inc));
    -- ก้อนอีกด้านของเดือนเดียวกัน (ถ้ามี) ต้องไม่ถูกนับซ้ำ
    IF v_id IS NOT NULL AND v_inc IS NOT NULL THEN
      v_need := v_need - coalesce((SELECT amount - coalesce(tax, 0) FROM public.income_transactions
                                    WHERE id = v_inc AND date > p_from AND date <= p_date), 0);
    END IF;
    SELECT c.currency, concat_ws(' ', c.issuer, c.card_name), c.person_id, p.family_id INTO v_ccy, v_name, v_owner, v_family
      FROM public.credit_cards c JOIN public.persons p ON p.id = c.person_id WHERE c.id = p_entity;
  ELSE
    SELECT id INTO v_id FROM public.expense_items WHERE pending_split AND lump_kind = 'LIABILITY' AND liability_id = p_entity
       AND date = p_date AND deleted_at IS NULL;
    SELECT id INTO v_inc FROM public.income_transactions WHERE pending_split AND received_to_liability_id = p_entity
       AND date = p_date AND deleted_at IS NULL;
    v_need := private.liability_lump_needed(p_entity, p_from, p_date, p_base, p_target, coalesce(v_id, v_inc));
    IF v_id IS NOT NULL AND v_inc IS NOT NULL THEN
      v_need := v_need - coalesce((SELECT amount - coalesce(tax, 0) FROM public.income_transactions WHERE id = v_inc), 0);
    END IF;
    SELECT currency, name, family_id INTO v_ccy, v_name, v_family FROM public.liabilities WHERE id = p_entity;
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
      UPDATE public.expense_items SET amount = v_need, date = p_date, lump_from = p_from, lump_base = p_base, lump_target = p_target
       WHERE id = v_id;
    END IF;
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = v_inc;
  ELSIF v_need < -0.005 THEN
    IF v_inc IS NULL THEN
      INSERT INTO public.income_transactions(family_id, received_to_credit_card_id, received_to_liability_id, person_id, date, income_type,
                                             amount, currency, notes, pending_split, lump_from, lump_base, lump_target)
      VALUES (v_family, CASE WHEN p_kind = 'CARD' THEN p_entity END, CASE WHEN p_kind = 'LIABILITY' THEN p_entity END, v_owner,
              p_date, 'OTHER', -v_need, v_ccy,
              'รอแยกรายละเอียด · ' || CASE WHEN p_kind = 'CARD' THEN 'ยอดบัตรลดเกินที่บันทึก (เงินคืน / เครดิต) · '
                                           ELSE 'ยอดหนี้ลดเกินที่คำนวณ (ส่วนลด / ลดหนี้ / จ่ายที่ยังไม่ได้บันทึก) · ' END || v_name,
              true, p_from, p_base, p_target);
    ELSE
      UPDATE public.income_transactions SET amount = -v_need, date = p_date, lump_from = p_from, lump_base = p_base, lump_target = p_target
       WHERE id = v_inc;
    END IF;
    UPDATE public.expense_items SET deleted_at = now() WHERE id = v_id;
  ELSE
    UPDATE public.expense_items SET deleted_at = now() WHERE id = v_id;
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = v_inc;
  END IF;
  PERFORM set_config('fwv.lump', 'off', true);
  RETURN v_need;
END $$;

-- 6) คำนวณก้อนบัตร / หนี้ใหม่ (ทั้งก้อนค่าใช้จ่ายและก้อนรายได้) --------------------------------------
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
            WHERE pending_split AND deleted_at IS NULL
              AND (CASE WHEN p_kind = 'CARD' THEN received_to_credit_card_id ELSE received_to_liability_id END) = p_entity
              AND p_date > lump_from AND p_date <= date LOOP
    PERFORM private.set_debt_lump(p_kind, p_entity, l.date, l.lump_from, l.lump_base, l.lump_target);
  END LOOP;
END $$;

-- รายได้เข้าบัตร / ลดหนี้ เพิ่ม / แก้ / ลบ → ปรับก้อนในช่วงเดียวกัน
CREATE OR REPLACE FUNCTION private.tg_lump_recalc_inc() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.income_transactions;
BEGIN
  IF private.lump_busy() THEN RETURN NULL; END IF;
  FOREACH r IN ARRAY ARRAY[OLD, NEW] LOOP
    CONTINUE WHEN r.id IS NULL OR r.pending_split;
    IF r.received_to_credit_card_id IS NOT NULL THEN PERFORM private.recalc_debt_lumps('CARD', r.received_to_credit_card_id, r.date); END IF;
    IF r.received_to_liability_id IS NOT NULL THEN PERFORM private.recalc_debt_lumps('LIABILITY', r.received_to_liability_id, r.date); END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- 7) แยกรายการ: รองรับก้อนรายได้ลดหนี้ ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.split_pending_item(p_kind text, p_id uuid, p_lines jsonb)
RETURNS numeric
LANGUAGE plpgsql SET search_path = '' AS $$
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
      INSERT INTO public.income_transactions(family_id, received_to_asset_id, received_to_credit_card_id, received_to_liability_id, person_id,
                                             date, income_type, amount, currency, notes, split_from_id)
      VALUES (li.family_id, li.received_to_asset_id, li.received_to_credit_card_id, li.received_to_liability_id,
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
  ELSIF p_kind = 'INCOME' AND li.received_to_liability_id IS NOT NULL THEN
    PERFORM private.recalc_debt_lumps('LIABILITY', li.received_to_liability_id, li.date);
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

-- 8) รายการที่แยกออกจากก้อนถูกแก้ / ลบ → เปิดก้อนเดิมกลับ (เพิ่มก้อนรายได้ลดหนี้) ----------------------------
CREATE OR REPLACE FUNCTION private.revive_split_parent(p_kind text, p_parent uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.expense_items; i public.income_transactions; v_bank uuid; v_card uuid; v_liab uuid;
BEGIN
  IF p_parent IS NULL OR private.lump_busy() THEN RETURN; END IF;
  IF p_kind = 'EXPENSE' THEN
    SELECT * INTO e FROM public.expense_items WHERE id = p_parent AND pending_split;
    IF e.id IS NULL THEN RETURN; END IF;
    IF e.deleted_at IS NOT NULL THEN
      -- มีก้อนที่เปิดอยู่ของช่วงเดียวกันแล้ว → ไม่เปิดก้อนเก่าซ้ำ (การคำนวณปกติดูแลก้อนนั้นอยู่แล้ว)
      IF EXISTS (SELECT 1 FROM public.expense_items x WHERE x.pending_split AND x.deleted_at IS NULL AND x.lump_kind = e.lump_kind
                   AND (CASE e.lump_kind WHEN 'BANK' THEN x.paid_from_asset_id = e.paid_from_asset_id
                          AND date_trunc('month', x.date) = date_trunc('month', e.date)
                        WHEN 'CARD' THEN x.paid_from_credit_card_id = e.paid_from_credit_card_id AND x.date = e.date
                        ELSE x.liability_id = e.liability_id AND x.date = e.date END))
         OR (e.lump_kind = 'BANK' AND EXISTS (SELECT 1 FROM public.income_transactions y WHERE y.pending_split AND y.deleted_at IS NULL
                   AND y.received_to_asset_id = e.paid_from_asset_id AND date_trunc('month', y.date) = date_trunc('month', e.date)))
         OR (e.lump_kind = 'CARD' AND EXISTS (SELECT 1 FROM public.income_transactions y WHERE y.pending_split AND y.deleted_at IS NULL
                   AND y.received_to_credit_card_id = e.paid_from_credit_card_id AND y.date = e.date))
         OR (e.lump_kind = 'LIABILITY' AND EXISTS (SELECT 1 FROM public.income_transactions y WHERE y.pending_split AND y.deleted_at IS NULL
                   AND y.received_to_liability_id = e.liability_id AND y.date = e.date)) THEN
        RETURN;
      END IF;
      PERFORM set_config('fwv.lump', 'on', true);
      UPDATE public.expense_items SET deleted_at = NULL, deleted_by = NULL WHERE id = e.id;
      PERFORM set_config('fwv.lump', 'off', true);
    END IF;
    IF e.lump_kind IN ('CARD', 'LIABILITY') THEN
      PERFORM private.set_debt_lump(e.lump_kind, coalesce(e.paid_from_credit_card_id, e.liability_id), e.date, e.lump_from, e.lump_base, e.lump_target);
    ELSIF e.lump_target IS NOT NULL AND e.lump_from IS NOT NULL THEN
      PERFORM private.set_bank_lump_at(e.paid_from_asset_id, e.date, e.lump_from, e.lump_base, e.lump_target);
    ELSE
      PERFORM private.recalc_bank_lump(e.paid_from_asset_id, date_trunc('month', e.date)::date);
    END IF;
  ELSIF p_kind = 'INCOME' THEN
    SELECT * INTO i FROM public.income_transactions WHERE id = p_parent AND pending_split;
    IF i.id IS NULL THEN RETURN; END IF;
    v_bank := i.received_to_asset_id; v_card := i.received_to_credit_card_id; v_liab := i.received_to_liability_id;
    IF i.deleted_at IS NOT NULL THEN
      IF (v_bank IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.income_transactions y WHERE y.pending_split AND y.deleted_at IS NULL
                      AND y.received_to_asset_id = v_bank AND date_trunc('month', y.date) = date_trunc('month', i.date))
         OR EXISTS (SELECT 1 FROM public.expense_items x WHERE x.pending_split AND x.deleted_at IS NULL AND x.lump_kind = 'BANK'
                      AND x.paid_from_asset_id = v_bank AND date_trunc('month', x.date) = date_trunc('month', i.date))))
         OR (v_card IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.income_transactions y WHERE y.pending_split AND y.deleted_at IS NULL
                      AND y.received_to_credit_card_id = v_card AND y.date = i.date)
         OR EXISTS (SELECT 1 FROM public.expense_items x WHERE x.pending_split AND x.deleted_at IS NULL AND x.lump_kind = 'CARD'
                      AND x.paid_from_credit_card_id = v_card AND x.date = i.date)))
         OR (v_liab IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.income_transactions y WHERE y.pending_split AND y.deleted_at IS NULL
                      AND y.received_to_liability_id = v_liab AND y.date = i.date)
         OR EXISTS (SELECT 1 FROM public.expense_items x WHERE x.pending_split AND x.deleted_at IS NULL AND x.lump_kind = 'LIABILITY'
                      AND x.liability_id = v_liab AND x.date = i.date))) THEN
        RETURN;
      END IF;
      PERFORM set_config('fwv.lump', 'on', true);
      UPDATE public.income_transactions SET deleted_at = NULL, deleted_by = NULL WHERE id = i.id;
      PERFORM set_config('fwv.lump', 'off', true);
    END IF;
    IF v_card IS NOT NULL THEN
      PERFORM private.set_debt_lump('CARD', v_card, i.date, i.lump_from, i.lump_base, i.lump_target);
    ELSIF v_liab IS NOT NULL THEN
      PERFORM private.set_debt_lump('LIABILITY', v_liab, i.date, i.lump_from, i.lump_base, i.lump_target);
    ELSIF i.lump_target IS NOT NULL AND i.lump_from IS NOT NULL THEN
      PERFORM private.set_bank_lump_at(v_bank, i.date, i.lump_from, i.lump_base, i.lump_target);
    ELSE
      PERFORM private.recalc_bank_lump(v_bank, date_trunc('month', i.date)::date);
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.revive_split_parent(text, uuid) FROM PUBLIC, anon, authenticated;

-- 9) อัปเดตยอดหนี้จาก Statement: ใช้จุดตั้งต้นของก้อนรายได้ลดหนี้ด้วย -------------------------------------
CREATE OR REPLACE FUNCTION public.update_liability_statement(p_liability_id uuid, p_date date, p_balance numeric,
  p_source text DEFAULT 'STATEMENT', p_notes text DEFAULT NULL, p_settle boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE lb public.liabilities; l public.expense_items; li public.income_transactions; v_prev public.liability_valuations;
        v_from date; v_base numeric; v_diff numeric; v_lump numeric := 0;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT * INTO lb FROM public.liabilities WHERE id = p_liability_id AND deleted_at IS NULL;
  IF lb.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบหนี้' USING ERRCODE = '22023'; END IF;
  IF p_date IS NULL OR p_balance IS NULL OR p_balance < 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดและวันที่' USING ERRCODE = '22023'; END IF;
  SELECT * INTO l FROM public.expense_items WHERE pending_split AND lump_kind = 'LIABILITY' AND liability_id = lb.id
     AND date = p_date AND deleted_at IS NULL;
  SELECT * INTO li FROM public.income_transactions WHERE pending_split AND received_to_liability_id = lb.id
     AND date = p_date AND deleted_at IS NULL;
  IF l.id IS NOT NULL THEN v_from := l.lump_from; v_base := l.lump_base;
  ELSIF li.id IS NOT NULL THEN v_from := li.lump_from; v_base := li.lump_base;
  ELSE
    SELECT * INTO v_prev FROM public.liability_valuations WHERE liability_id = lb.id AND deleted_at IS NULL AND valuation_date < p_date
     ORDER BY valuation_date DESC, created_at DESC LIMIT 1;
    v_from := v_prev.valuation_date; v_base := v_prev.balance;
  END IF;
  INSERT INTO public.liability_valuations(liability_id, valuation_date, balance, source, notes)
  VALUES (lb.id, p_date, p_balance, coalesce(nullif(p_source, ''), 'STATEMENT'), nullif(trim(p_notes), ''))
  ON CONFLICT (liability_id, valuation_date) WHERE deleted_at IS NULL
  DO UPDATE SET balance = EXCLUDED.balance, source = EXCLUDED.source, notes = coalesce(EXCLUDED.notes, public.liability_valuations.notes);
  -- ลงส่วนต่างเป็นก้อนเสมอ (สูงกว่า → ค่าใช้จ่ายก้อน · ต่ำกว่า → รายได้ก้อนลดหนี้) · p_settle ยังรับไว้แต่ไม่ใช้
  IF v_from IS NOT NULL THEN
    v_diff := private.liability_lump_needed(lb.id, v_from, p_date, v_base, p_balance, coalesce(l.id, li.id));
    v_lump := private.set_debt_lump('LIABILITY', lb.id, p_date, v_from, v_base, p_balance);
  END IF;
  RETURN jsonb_build_object('difference', v_diff, 'lump', v_lump);
END $$;
REVOKE ALL ON FUNCTION public.update_liability_statement(uuid, date, numeric, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_liability_statement(uuid, date, numeric, text, text, boolean) TO authenticated;

-- 10) "ลงเป็นการจ่าย": เปลี่ยนรายได้ก้อนของยอดบัตร / หนี้ เป็นการจ่ายจากบัญชี ----------------------------------
-- p: { kind: 'CARD' | 'LIABILITY', id, bank_asset_id, date (วันที่ของยอด), amount (ไม่เกินก้อน) }
DROP FUNCTION IF EXISTS public.pay_from_statement_drop(jsonb);
CREATE FUNCTION public.pay_from_statement_drop(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_kind text := upper(coalesce(p->>'kind', '')); v_id uuid := nullif(p->>'id', '')::uuid;
  v_bank uuid := nullif(p->>'bank_asset_id', '')::uuid; v_date date := nullif(p->>'date', '')::date;
  v_amt numeric := round(nullif(p->>'amount', '')::numeric, 2);
  v_lump public.income_transactions; v_ccy text; v_name text; v_left numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF v_kind NOT IN ('CARD', 'LIABILITY') OR v_id IS NULL THEN RAISE EXCEPTION 'INVALID: ประเภทไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_date IS NULL OR v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดที่จ่าย' USING ERRCODE = '22023'; END IF;
  IF v_bank IS NULL OR NOT private.is_bank_asset(v_bank) THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่จ่าย' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_lump FROM public.income_transactions
   WHERE pending_split AND deleted_at IS NULL AND date = v_date
     AND CASE WHEN v_kind = 'CARD' THEN received_to_credit_card_id = v_id ELSE received_to_liability_id = v_id END;
  IF v_lump.id IS NULL THEN
    RAISE EXCEPTION 'INVALID: ไม่พบรายได้ก้อนรอแยกของยอดวันที่ % (อาจแยกรายการ / ลงไปแล้ว)', v_date USING ERRCODE = '22023';
  END IF;
  IF v_amt > v_lump.amount + 0.005 THEN
    RAISE EXCEPTION 'INVALID: ยอดที่จ่าย (%) มากกว่าส่วนที่ลดลง (%)', v_amt, v_lump.amount USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'CARD' THEN
    SELECT currency, concat_ws(' ', issuer, card_name) INTO v_ccy, v_name FROM public.credit_cards WHERE id = v_id;
  ELSE
    SELECT currency, name INTO v_ccy, v_name FROM public.liabilities WHERE id = v_id;
  END IF;
  IF (SELECT currency FROM public.assets WHERE id = v_bank) IS DISTINCT FROM v_ccy THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีที่จ่ายต้องสกุลเดียวกับ% (%)', CASE WHEN v_kind = 'CARD' THEN 'บัตร' ELSE 'หนี้' END, v_ccy
      USING ERRCODE = '22023';
  END IF;
  -- เงินออกจากบัญชีวันเดียวกับยอด (นับก่อนยอดนั้น) → trigger ปรับก้อนบัตร / หนี้ / บัญชีให้เอง
  IF v_kind = 'CARD' THEN
    INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_credit_card_id, amount, currency,
                                      description, metadata)
    VALUES (v_lump.family_id, v_date, 'CARD_PAYMENT', v_bank, v_id, v_amt, v_ccy,
            'จ่ายบัตร · ' || v_name, jsonb_build_object('from_statement', true));
  ELSE
    INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_liability_id, amount, currency,
                                      reduces_liability, movement_group_id, description, metadata)
    VALUES (v_lump.family_id, v_date, 'LIABILITY_PAYMENT', v_bank, v_id, v_amt, v_ccy, true, gen_random_uuid(),
            'จ่ายเงินต้น · ' || v_name, jsonb_build_object('from_statement', true));
  END IF;
  SELECT coalesce(sum(amount), 0) INTO v_left FROM public.income_transactions WHERE id = v_lump.id AND deleted_at IS NULL;
  RETURN jsonb_build_object('lump_left', v_left);
END $$;
REVOKE ALL ON FUNCTION public.pay_from_statement_drop(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_from_statement_drop(jsonb) TO authenticated;
