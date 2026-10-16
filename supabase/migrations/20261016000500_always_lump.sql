-- =====================================================================
-- เลิกช่องติ๊ก "ลงส่วนต่างเป็นก้อนรอแยกรายละเอียด" — บันทึกยอดจาก Statement แล้วลงก้อนให้เสมอ
--   บัญชีธนาคาร (update_bank_statement) · บัตรเครดิต (update_card_statement) · เงินกู้ / หนี้ (update_liability_statement)
--   ทุกบทบาทที่บันทึกยอดได้ (ADMIN / EDITOR / CONTRIBUTOR) → ก้อนเกิดอัตโนมัติ (ก้อน = รายการที่ระบบคำนวณ)
--   การแยกก้อนยังจำกัด ADMIN / EDITOR เหมือนเดิม · ยอดตรง = ไม่มีก้อน
--   พารามิเตอร์ p_settle ยังรับไว้ (หน้าเว็บเดิมไม่พังระหว่าง deploy) แต่ไม่มีผลแล้ว
--   ฟังก์ชันอย่างเดียว · ไม่แก้ตาราง / ข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

CREATE OR REPLACE FUNCTION public.update_bank_statement(p_asset_id uuid, p_date date, p_value numeric,
  p_notes text DEFAULT NULL, p_settle boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_m0 date; v_ld date; v_from date; v_base numeric; v_need numeric; v_lump numeric; v_has boolean;
  v_last public.asset_valuations;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
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
  -- ลงส่วนต่างเป็นก้อนเสมอ (เลิกช่องติ๊ก · p_settle ยังรับไว้แต่ไม่ใช้)
  IF true THEN
    v_lump := private.set_bank_lump_at(p_asset_id, p_date, v_from, v_base, p_value);
  END IF;
  RETURN jsonb_build_object('difference', v_need, 'lump', v_lump, 'merged', v_has);
END $$;
REVOKE ALL ON FUNCTION public.update_bank_statement(uuid, date, numeric, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_bank_statement(uuid, date, numeric, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_card_statement(p_card_id uuid, p_date date, p_balance numeric,
  p_settle boolean DEFAULT false, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c public.credit_cards; l public.expense_items; li public.income_transactions; s public.credit_card_statements;
  v_from date; v_base numeric; v_diff numeric; v_lump numeric := 0;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
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
    -- ลงส่วนต่างเป็นก้อนเสมอ (เลิกช่องติ๊ก · p_settle ยังรับไว้แต่ไม่ใช้)
    IF true THEN
      v_lump := private.set_debt_lump('CARD', c.id, p_date, v_from, v_base, p_balance);
    END IF;
  END IF;
  RETURN jsonb_build_object('difference', v_diff, 'lump', v_lump, 'merged', l.id IS NOT NULL OR li.id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.update_card_statement(uuid, date, numeric, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_card_statement(uuid, date, numeric, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_liability_statement(p_liability_id uuid, p_date date, p_balance numeric,
  p_source text DEFAULT 'STATEMENT', p_notes text DEFAULT NULL, p_settle boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE lb public.liabilities; l public.expense_items; v_prev public.liability_valuations; v_from date; v_base numeric;
        v_diff numeric; v_lump numeric := 0;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
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
    -- ลงส่วนต่างเป็นก้อนเสมอ (เลิกช่องติ๊ก · p_settle ยังรับไว้แต่ไม่ใช้)
    IF true THEN
      v_lump := private.set_debt_lump('LIABILITY', lb.id, p_date, v_from, v_base, p_balance);
    END IF;
  END IF;
  RETURN jsonb_build_object('difference', v_diff, 'lump', v_lump);
END $$;
REVOKE ALL ON FUNCTION public.update_liability_statement(uuid, date, numeric, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_liability_statement(uuid, date, numeric, text, text, boolean) TO authenticated;

-- ปุ่มสำรอง "ลงเป็นก้อนรอแยก" ในหน้าบัญชี: ทุกบทบาทที่บันทึกยอดได้
CREATE OR REPLACE FUNCTION public.settle_bank_latest(p_asset_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a record; v_lump numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');   -- ทุกบทบาทที่บันทึกยอดได้ (ก้อนเกิดอัตโนมัติอยู่แล้ว)
  IF NOT private.is_bank_asset(p_asset_id) THEN RAISE EXCEPTION 'INVALID: ไม่ใช่บัญชีธนาคาร' USING ERRCODE = '22023'; END IF;
  SELECT * INTO a FROM private.bank_latest_anchor(p_asset_id);
  IF a.latest_date IS NULL OR a.from_date IS NULL OR a.from_date >= a.latest_date THEN
    RAISE EXCEPTION 'INVALID: ยังไม่มียอดก่อนหน้าให้เทียบ' USING ERRCODE = '22023';
  END IF;
  v_lump := private.set_bank_lump_at(p_asset_id, a.latest_date, a.from_date, a.base, a.latest_value);
  RETURN jsonb_build_object('lump', v_lump, 'date', a.latest_date);
END $$;
REVOKE ALL ON FUNCTION public.settle_bank_latest(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_bank_latest(uuid) TO authenticated;
