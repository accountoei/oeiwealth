-- =====================================================================
-- ก้อน "รอแยกรายละเอียด": บัญชีละ 1 ก้อนต่อเดือน (บัญชีธนาคาร + บัตรเครดิต)
--   * บัญชีธนาคาร: บันทึกยอดจาก Statement ที่หน้า Cash ระหว่างเดือนได้เลย (update_bank_statement)
--       ติ๊ก "ลงส่วนต่างเป็นรอแยก" → เกิดก้อนของเดือนนั้นทันที ไม่ต้องรอ Month Closing
--       บันทึกยอดซ้ำในเดือนเดียวกัน (วันหลังกว่า) → ปรับก้อนเดิม + ย้ายวันที่ก้อนไปวันของยอดล่าสุด
--       กระทบยอดสิ้นเดือน (settle_bank_difference) → ใช้ก้อนเดียวกัน (ย้ายไปสิ้นเดือน) ไม่สร้างก้อนที่สอง
--       ก้อนเก็บจุดตั้งต้น (ยอดยืนยันก่อนต้นเดือน) + ยอดเป้าหมาย ไว้ในแถว → ปรับเองเมื่อมีรายการจริงเพิ่ม / ลบ / แก้
--   * บัตรเครดิต: อัปเดตยอด Statement ซ้ำในเดือนเดียวกัน → ปรับก้อนเดิม (จุดตั้งต้นเดิม) + ย้ายวันที่ก้อน
--       ก้อนลงวันที่ของยอด (วันตัดรอบ) เหมือนเดิม
--   * เงินกู้: เหมือนเดิม (ก้อนต่อยอดหนึ่งครั้ง)
--   ไม่ลบ / ไม่แก้ข้อมูลเดิม · ก้อนเดิมที่ไม่มีจุดตั้งต้นในแถว ยังคำนวณแบบเดิม (จากหน้ากระทบยอด) · รันซ้ำได้
-- =====================================================================

-- 1) จุดตั้งต้นของเดือน (บัญชีธนาคาร): ยอดยืนยันสิ้นเดือนก่อน → ยอดล่าสุดก่อนต้นเดือน --------------
CREATE OR REPLACE FUNCTION private.bank_month_anchor(p_bank uuid, p_m0 date)
RETURNS TABLE (anchor_date date, anchor_value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.asset_valuations;
BEGIN
  SELECT av.* INTO v FROM public.bank_reconciliations p
    JOIN public.asset_valuations av ON av.id = p.closing_valuation_id
   WHERE p.bank_asset_id = p_bank AND p.year_month = (p_m0 - interval '1 month')::date
     AND p.deleted_at IS NULL AND p.status <> 'OPEN' AND av.deleted_at IS NULL;
  IF v.id IS NULL THEN v := private.latest_asset_valuation(p_bank, p_m0 - 1); END IF;
  IF v.id IS NOT NULL THEN anchor_date := v.valuation_date; anchor_value := v.value; RETURN NEXT; END IF;
END $$;

-- 2) ยอดก้อนที่ต้องการในช่วง (p_from, p_to] (+ = รายได้เข้า · − = ค่าใช้จ่ายออก) · ไม่นับก้อนในช่วงนั้นเอง ---------
CREATE OR REPLACE FUNCTION private.bank_lump_needed_range(p_bank uuid, p_from date, p_to date, p_base numeric, p_target numeric)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e record; v_out numeric; v_in numeric;
BEGIN
  SELECT * INTO e FROM private.bank_movement_effects(p_bank, p_from, p_to);
  SELECT coalesce(sum(amount), 0) INTO v_out FROM public.expense_items
   WHERE pending_split AND lump_kind = 'BANK' AND paid_from_asset_id = p_bank AND deleted_at IS NULL
     AND date > p_from AND date <= p_to;
  SELECT coalesce(sum(amount - coalesce(tax, 0)), 0) INTO v_in FROM public.income_transactions
   WHERE pending_split AND received_to_asset_id = p_bank AND deleted_at IS NULL AND date > p_from AND date <= p_to;
  RETURN p_target - (p_base + e.inflow - e.outflow + v_out - v_in);
END $$;

-- 3) ตั้งก้อนของเดือน (ก้อนเดียว · ย้ายวันที่ได้ · กลับเครื่องหมายได้ · 0 = ลบ) · คืนค่าแบบมีเครื่องหมาย -------------
CREATE OR REPLACE FUNCTION private.set_bank_lump_at(p_bank uuid, p_date date, p_from date, p_base numeric, p_target numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ccy text; v_name text; v_exp uuid; v_inc uuid; v_label text; v_need numeric;
BEGIN
  SELECT currency, name INTO v_ccy, v_name FROM public.assets WHERE id = p_bank;
  v_label := 'รอแยกรายละเอียด · ส่วนต่างยอด ' || v_name || ' ' || to_char(p_date, 'MM/YYYY');
  SELECT id INTO v_exp FROM public.expense_items WHERE pending_split AND lump_kind = 'BANK' AND paid_from_asset_id = p_bank
     AND date_trunc('month', date) = date_trunc('month', p_date) AND deleted_at IS NULL;
  SELECT id INTO v_inc FROM public.income_transactions WHERE pending_split AND received_to_asset_id = p_bank
     AND date_trunc('month', date) = date_trunc('month', p_date) AND deleted_at IS NULL;
  v_need := private.bank_lump_needed_range(p_bank, p_from, p_date, p_base, p_target);
  PERFORM set_config('fwv.lump', 'on', true);
  IF v_need < -0.005 THEN
    IF v_exp IS NULL THEN
      INSERT INTO public.expense_items(monthly_expense_id, paid_from_asset_id, date, description, amount, currency,
                                       expense_category, pending_split, lump_kind, lump_from, lump_base, lump_target)
      VALUES (private.expense_month_id(p_date), p_bank, p_date, v_label, -v_need, v_ccy, 'รอแยกรายละเอียด', true, 'BANK',
              p_from, p_base, p_target);
    ELSE
      UPDATE public.expense_items SET amount = -v_need, date = p_date, description = v_label,
             lump_from = p_from, lump_base = p_base, lump_target = p_target
       WHERE id = v_exp;
    END IF;
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = v_inc;
  ELSIF v_need > 0.005 THEN
    IF v_inc IS NULL THEN
      INSERT INTO public.income_transactions(family_id, received_to_asset_id, date, income_type, amount, currency, notes, pending_split,
                                             lump_from, lump_base, lump_target)
      SELECT a.family_id, p_bank, p_date, 'OTHER', v_need, v_ccy, v_label, true, p_from, p_base, p_target
        FROM public.assets a WHERE a.id = p_bank;
    ELSE
      UPDATE public.income_transactions SET amount = v_need, date = p_date, notes = v_label,
             lump_from = p_from, lump_base = p_base, lump_target = p_target
       WHERE id = v_inc;
    END IF;
    UPDATE public.expense_items SET deleted_at = now() WHERE id = v_exp;
  ELSE
    UPDATE public.expense_items SET deleted_at = now() WHERE id = v_exp;
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = v_inc;
  END IF;
  PERFORM set_config('fwv.lump', 'off', true);
  RETURN v_need;
END $$;

-- 4) คำนวณก้อนธนาคารใหม่ -----------------------------------------------------------------
-- ตามเดือน (ใช้ตอนแยกรายการ): ก้อนที่มีจุดตั้งต้นในแถว → คำนวณจากแถว · ก้อนเดิม (ไม่มี) → แบบเดิมจากหน้ากระทบยอด
CREATE OR REPLACE FUNCTION private.recalc_bank_lump(p_bank uuid, p_m0 date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE br public.bank_reconciliations; v_open_date date; v_date date; v_from date; v_base numeric; v_target numeric;
BEGIN
  IF private.lump_busy() THEN RETURN; END IF;
  SELECT date, lump_from, lump_base, lump_target INTO v_date, v_from, v_base, v_target FROM public.expense_items
   WHERE pending_split AND lump_kind = 'BANK' AND paid_from_asset_id = p_bank
     AND date_trunc('month', date) = p_m0 AND deleted_at IS NULL;
  IF v_date IS NULL THEN
    SELECT date, lump_from, lump_base, lump_target INTO v_date, v_from, v_base, v_target FROM public.income_transactions
     WHERE pending_split AND received_to_asset_id = p_bank AND date_trunc('month', date) = p_m0 AND deleted_at IS NULL;
  END IF;
  IF v_date IS NULL THEN RETURN; END IF;
  IF v_target IS NOT NULL AND v_from IS NOT NULL THEN
    PERFORM private.set_bank_lump_at(p_bank, v_date, v_from, v_base, v_target);
    RETURN;
  END IF;
  -- ก้อนแบบเดิม (สร้างก่อน migration นี้)
  SELECT * INTO br FROM public.bank_reconciliations WHERE bank_asset_id = p_bank AND year_month = p_m0
     AND deleted_at IS NULL AND status <> 'OPEN' AND actual_closing IS NOT NULL;
  IF br.id IS NULL THEN RETURN; END IF;
  SELECT valuation_date INTO v_open_date FROM public.asset_valuations WHERE id = br.opening_valuation_id;
  PERFORM private.set_bank_lump(p_bank, v_date,
            private.bank_lump_needed(p_bank, p_m0, br.actual_closing - br.rounding_adjustment, br.opening_balance, v_open_date));
END $$;

-- ตามวันที่ของรายการที่เปลี่ยน: ทุกก้อนของบัญชีที่ครอบคลุมวันนั้น (ข้ามเดือนได้ ถ้าจุดตั้งต้นอยู่เดือนก่อน)
CREATE OR REPLACE FUNCTION private.recalc_bank_lumps_at(p_bank uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l record;
BEGIN
  IF private.lump_busy() OR p_bank IS NULL OR p_date IS NULL THEN RETURN; END IF;
  FOR l IN SELECT date, lump_from, lump_base, lump_target FROM public.expense_items
            WHERE pending_split AND lump_kind = 'BANK' AND paid_from_asset_id = p_bank AND deleted_at IS NULL
              AND lump_target IS NOT NULL AND p_date > lump_from AND p_date <= date
           UNION
           SELECT date, lump_from, lump_base, lump_target FROM public.income_transactions
            WHERE pending_split AND received_to_asset_id = p_bank AND deleted_at IS NULL
              AND lump_target IS NOT NULL AND p_date > lump_from AND p_date <= date LOOP
    PERFORM private.set_bank_lump_at(p_bank, l.date, l.lump_from, l.lump_base, l.lump_target);
  END LOOP;
  -- ก้อนแบบเดิมของเดือนนั้น
  IF EXISTS (SELECT 1 FROM public.expense_items WHERE pending_split AND lump_kind = 'BANK' AND paid_from_asset_id = p_bank
               AND lump_target IS NULL AND deleted_at IS NULL AND date_trunc('month', date) = date_trunc('month', p_date))
     OR EXISTS (SELECT 1 FROM public.income_transactions WHERE pending_split AND received_to_asset_id = p_bank
               AND lump_target IS NULL AND deleted_at IS NULL AND date_trunc('month', date) = date_trunc('month', p_date)) THEN
    PERFORM private.recalc_bank_lump(p_bank, date_trunc('month', p_date)::date);
  END IF;
END $$;

-- รายการเงินเข้า–ออกเปลี่ยน → ปรับก้อนธนาคาร / บัตร / หนี้ ที่ครอบคลุมวันนั้น
CREATE OR REPLACE FUNCTION private.tg_lump_recalc_cm() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cash_movements; a uuid;
BEGIN
  IF private.lump_busy() THEN RETURN NULL; END IF;
  FOREACH r IN ARRAY ARRAY[OLD, NEW] LOOP
    CONTINUE WHEN r.id IS NULL;
    FOREACH a IN ARRAY ARRAY[r.from_asset_id, r.to_asset_id] LOOP
      IF a IS NOT NULL THEN PERFORM private.recalc_bank_lumps_at(a, r.movement_date); END IF;
    END LOOP;
    IF r.movement_type = 'CARD_PAYMENT' THEN PERFORM private.recalc_debt_lumps('CARD', r.to_credit_card_id, r.movement_date); END IF;
    IF r.movement_type = 'LIABILITY_PAYMENT' THEN PERFORM private.recalc_debt_lumps('LIABILITY', r.to_liability_id, r.movement_date); END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- 5) บันทึกยอดบัญชีธนาคารจาก Statement (หน้า Cash) + ลงส่วนต่างเป็นก้อนของเดือน ------------------------
DROP FUNCTION IF EXISTS public.update_bank_statement(uuid, date, numeric, text, boolean);
CREATE FUNCTION public.update_bank_statement(p_asset_id uuid, p_date date, p_value numeric,
  p_notes text DEFAULT NULL, p_settle boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_m0 date; v_ld date; v_from date; v_base numeric; v_need numeric; v_lump numeric; v_has boolean;
  v_last public.asset_valuations;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF p_settle THEN PERFORM private.require_role('ADMIN','EDITOR'); END IF;
  IF p_date IS NULL OR p_date > current_date OR p_value IS NULL THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดและวันที่ให้ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  v_m0 := date_trunc('month', p_date)::date;
  -- ก้อนของเดือนนี้ (ถ้ามี)
  SELECT date, lump_from, lump_base INTO v_ld, v_from, v_base FROM public.expense_items
   WHERE pending_split AND lump_kind = 'BANK' AND paid_from_asset_id = p_asset_id
     AND date_trunc('month', date) = v_m0 AND deleted_at IS NULL;
  IF v_ld IS NULL THEN
    SELECT date, lump_from, lump_base INTO v_ld, v_from, v_base FROM public.income_transactions
     WHERE pending_split AND received_to_asset_id = p_asset_id AND date_trunc('month', date) = v_m0 AND deleted_at IS NULL;
  END IF;
  v_has := v_ld IS NOT NULL;

  PERFORM public.update_bank_balance(p_asset_id, p_date, p_value, p_notes);   -- ตรวจสิทธิ์ / บัญชี / งวดปิด

  -- ยอดก่อนวันที่ของก้อน = เก็บเป็นยอดอย่างเดียว (ก้อนผูกกับยอดล่าสุดของเดือน)
  IF v_has AND v_ld > p_date THEN
    RETURN jsonb_build_object('difference', NULL, 'lump', NULL, 'history_only', true);
  END IF;
  -- จุดตั้งต้น: ของก้อนเดิม → ยอดยืนยันก่อนต้นเดือน → ยอดล่าสุดก่อนวันนี้ (บัญชีใหม่)
  IF v_from IS NULL THEN
    SELECT anchor_date, anchor_value INTO v_from, v_base FROM private.bank_month_anchor(p_asset_id, v_m0);
  END IF;
  IF v_from IS NULL THEN
    SELECT * INTO v_last FROM public.asset_valuations WHERE asset_id = p_asset_id AND deleted_at IS NULL AND valuation_date < p_date
     ORDER BY valuation_date DESC, created_at DESC LIMIT 1;
    v_from := v_last.valuation_date; v_base := v_last.value;
  END IF;
  IF v_from IS NULL OR v_from >= p_date THEN
    RETURN jsonb_build_object('difference', NULL, 'lump', NULL);
  END IF;
  v_need := private.bank_lump_needed_range(p_asset_id, v_from, p_date, v_base, p_value);
  IF p_settle OR v_has THEN
    v_lump := private.set_bank_lump_at(p_asset_id, p_date, v_from, v_base, p_value);
  END IF;
  RETURN jsonb_build_object('difference', v_need, 'lump', v_lump, 'merged', v_has);
END $$;
REVOKE ALL ON FUNCTION public.update_bank_statement(uuid, date, numeric, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_bank_statement(uuid, date, numeric, text, boolean) TO authenticated;

-- 6) กระทบยอดสิ้นเดือน → ใช้ก้อนเดียวกันของเดือนนั้น (ย้ายไปวันสิ้นเดือน) ------------------------------
CREATE OR REPLACE FUNCTION public.settle_bank_difference(p_reconciliation_id uuid, p_actual_closing numeric DEFAULT NULL)
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
  v_need := private.set_bank_lump_at(br.bank_asset_id, v_date, v_open_date, br.opening_balance, v_actual);

  IF br.status = 'OPEN' THEN
    PERFORM public.confirm_bank_reconciliation(br.id, v_actual, NULL, 0, NULL);
  ELSE
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

-- 7) บัตรเครดิต: ก้อนเดียวต่อเดือน (หาก้อนจากเดือน · ย้ายวันที่ได้) · เงินกู้เหมือนเดิม -------------------------
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
      UPDATE public.expense_items SET amount = v_need, date = p_date, lump_from = p_from, lump_base = p_base, lump_target = p_target
       WHERE id = v_id;
    END IF;
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = v_inc;
  ELSIF v_need < -0.005 AND p_kind = 'CARD' THEN
    IF v_inc IS NULL THEN
      INSERT INTO public.income_transactions(family_id, received_to_credit_card_id, person_id, date, income_type, amount, currency, notes,
                                             pending_split, lump_from, lump_base, lump_target)
      VALUES (v_family, p_entity, v_owner, p_date, 'OTHER', -v_need, v_ccy,
              'รอแยกรายละเอียด · ยอดบัตรลดเกินที่บันทึก (เงินคืน / เครดิต) · ' || v_name, true, p_from, p_base, p_target);
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
  RETURN CASE WHEN p_kind = 'CARD' OR v_need > 0 THEN v_need ELSE 0 END;
END $$;

-- อัปเดตยอดบัตรจาก Statement: ก้อนของเดือนเดียวกัน (วันก่อนหน้า) → ใช้จุดตั้งต้นเดิม แล้วย้ายก้อนมาวันนี้
CREATE OR REPLACE FUNCTION public.update_card_statement(p_card_id uuid, p_date date, p_balance numeric,
  p_settle boolean DEFAULT false, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c public.credit_cards; l public.expense_items; li public.income_transactions; s public.credit_card_statements;
  v_from date; v_base numeric; v_diff numeric; v_lump numeric := 0;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF p_settle THEN PERFORM private.require_role('ADMIN','EDITOR'); END IF;
  SELECT * INTO c FROM public.credit_cards WHERE id = p_card_id AND deleted_at IS NULL;
  IF c.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัตร' USING ERRCODE = '22023'; END IF;
  IF p_date IS NULL OR p_date > current_date OR p_balance IS NULL OR p_balance < 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดและวันที่ให้ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  -- ยอดย้อนหลัง (ก่อนยอดล่าสุด) = เก็บเป็นประวัติอย่างเดียว
  IF c.balance_date IS NOT NULL AND p_date < c.balance_date THEN
    PERFORM private.upsert_card_statement(c.id, p_date, p_balance, p_notes);
    RETURN jsonb_build_object('difference', NULL, 'lump', 0, 'history_only', true);
  END IF;
  -- จุดตั้งต้น: ก้อนของเดือนนี้ (วันที่ไม่เกินยอดนี้) → ประวัติยอดก่อนวันนี้ → ยอดบัตรปัจจุบัน (ถ้าก่อนวันนี้)
  SELECT * INTO l FROM public.expense_items WHERE pending_split AND lump_kind = 'CARD' AND paid_from_credit_card_id = c.id
     AND date_trunc('month', date) = date_trunc('month', p_date) AND date <= p_date AND deleted_at IS NULL
   ORDER BY date DESC LIMIT 1;
  SELECT * INTO li FROM public.income_transactions WHERE pending_split AND received_to_credit_card_id = c.id
     AND date_trunc('month', date) = date_trunc('month', p_date) AND date <= p_date AND deleted_at IS NULL
   ORDER BY date DESC LIMIT 1;
  IF l.id IS NOT NULL THEN v_from := l.lump_from; v_base := l.lump_base;
  ELSIF li.id IS NOT NULL THEN v_from := li.lump_from; v_base := li.lump_base;
  ELSE
    SELECT * INTO s FROM public.credit_card_statements WHERE credit_card_id = c.id AND deleted_at IS NULL
       AND statement_date < p_date ORDER BY statement_date DESC LIMIT 1;
    IF s.id IS NOT NULL THEN v_from := s.statement_date; v_base := s.balance;
    ELSIF c.balance_date < p_date THEN v_from := c.balance_date; v_base := c.outstanding_balance;
    END IF;
  END IF;
  UPDATE public.credit_cards SET outstanding_balance = p_balance, balance_date = p_date WHERE id = c.id;
  PERFORM private.upsert_card_statement(c.id, p_date, p_balance, p_notes);
  IF v_from IS NOT NULL AND p_date > v_from THEN
    v_diff := private.card_lump_needed(c.id, v_from, p_date, v_base, p_balance, coalesce(l.id, li.id));
    IF p_settle OR l.id IS NOT NULL OR li.id IS NOT NULL THEN
      v_lump := private.set_debt_lump('CARD', c.id, p_date, v_from, v_base, p_balance);
    END IF;
  END IF;
  RETURN jsonb_build_object('difference', v_diff, 'lump', v_lump, 'merged', l.id IS NOT NULL OR li.id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.update_card_statement(uuid, date, numeric, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_card_statement(uuid, date, numeric, boolean, text) TO authenticated;

-- 8) สถานะก้อนของบัญชี / บัตร ในเดือนหนึ่ง (ใช้แสดงข้อความหลังบันทึก) -------------------------------------
--    คืน: ยอดก้อน (+ = ค่าใช้จ่ายรอแยก · − = รายได้รอแยก) · วันที่ก้อน · ช่วงที่ครอบคลุม
DROP FUNCTION IF EXISTS public.lump_status(text, uuid, date);
CREATE FUNCTION public.lump_status(p_kind text, p_id uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE e record; i record; m0 date := date_trunc('month', p_date)::date;
BEGIN
  IF p_kind = 'BANK' THEN
    SELECT amount, date, lump_from INTO e FROM public.expense_items
     WHERE pending_split AND lump_kind = 'BANK' AND paid_from_asset_id = p_id AND deleted_at IS NULL
       AND date_trunc('month', date) = m0;
    SELECT amount, date, lump_from INTO i FROM public.income_transactions
     WHERE pending_split AND received_to_asset_id = p_id AND deleted_at IS NULL AND date_trunc('month', date) = m0;
  ELSIF p_kind = 'CARD' THEN
    SELECT amount, date, lump_from INTO e FROM public.expense_items
     WHERE pending_split AND lump_kind = 'CARD' AND paid_from_credit_card_id = p_id AND deleted_at IS NULL
       AND date_trunc('month', date) = m0 ORDER BY date DESC LIMIT 1;
    SELECT amount, date, lump_from INTO i FROM public.income_transactions
     WHERE pending_split AND received_to_credit_card_id = p_id AND deleted_at IS NULL
       AND date_trunc('month', date) = m0 ORDER BY date DESC LIMIT 1;
  ELSE
    RETURN NULL;
  END IF;
  IF e.date IS NULL AND i.date IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('amount', coalesce(e.amount, 0) - coalesce(i.amount, 0),
                            'date', coalesce(e.date, i.date), 'from', coalesce(e.lump_from, i.lump_from));
END $$;
REVOKE ALL ON FUNCTION public.lump_status(text, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lump_status(text, uuid, date) TO authenticated;
