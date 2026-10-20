-- =====================================================================
-- ปิดเดือน: บัญชีธนาคารติดลบ ณ สิ้นเดือน → ปิดไม่ได้ · แยกก้อนรอแยก: เงินโอนเกินยอดก้อนได้
--   1) private.month_closing_issues(): เพิ่มเงื่อนไข CASH / BLOCKED / NEGATIVE_BALANCE
--      ยอดสิ้นเดือนของบัญชีธนาคาร (ยอดตามระบบ = ยอดล่าสุด + เงินเข้า − เงินออก ถึงสิ้นเดือน) ติดลบ → ปิดเดือนไม่ได้
--      บัญชีเบิกเกินบัญชี (OD) ให้บันทึกเป็นหนี้สินแบบวงเงิน จึงไม่มีข้อยกเว้น
--   2) public.split_lump(): บรรทัด "เงินโอน" รวมแล้วเกินยอดก้อนได้ (บรรทัดอื่นรวมกันยังต้องไม่เกินก้อน)
--      ส่วนที่เกิน → ระบบคำนวณก้อนของบัญชีใหม่ตามยอด Statement เป็นก้อนรอแยกฝั่งตรงข้าม (ค่าใช้จ่าย ↔ รายได้) ในบัญชีเดียวกัน
--      ค่าที่คืน: ≥ 0 = ยอดที่ยังรอแยก (เหมือนเดิม) · < 0 = ยอดก้อนฝั่งตรงข้ามที่เกิดจากการโอนเกิน
--   ฟังก์ชันอย่างเดียว · ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) ปิดเดือน: บัญชีติดลบ ----------------------------------------------------------------------
DO $$
DECLARE d text;
  anchor text := 'AND br.deleted_at IS NULL AND br.status <> ''OPEN'');';
  add_txt text := '
  -- บัญชีธนาคารติดลบ ณ สิ้นเดือน → ปิดเดือนไม่ได้ (บัญชี OD ให้บันทึกเป็นหนี้สินแบบวงเงิน)
  RETURN QUERY
  SELECT ''CASH'', ''BLOCKED'', ''NEGATIVE_BALANCE'',
         a.name || '': ยอดสิ้นเดือนติดลบ '' || to_char(nb.v, ''FM999,999,999,990.00'') || '' '' || a.currency
                || '' · ตรวจรายการเงินออก / วันที่ / บัญชีที่เลือก (บัญชี OD ให้บันทึกเป็นหนี้สินแบบวงเงิน)'',
         ''ASSET'', a.id
    FROM public.assets a
    JOIN public.bank_accounts b ON b.asset_id = a.id AND b.deleted_at IS NULL
    CROSS JOIN LATERAL (SELECT private.bank_calculated_balance(a.id, d) AS v) nb
   WHERE a.family_id = p_family AND a.deleted_at IS NULL AND nb.v < -0.005;';
BEGIN
  d := replace(pg_get_functiondef('private.month_closing_issues(uuid, date)'::regprocedure), E'\r', '');
  IF position('NEGATIVE_BALANCE' IN d) > 0 THEN RETURN; END IF;                 -- รันซ้ำ
  IF (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'month_closing_issues: ไม่พบจุดที่ต้องแก้ (บัญชีติดลบ)';
  END IF;
  EXECUTE replace(d, anchor, anchor || add_txt);
END $$;

-- 2) แยกก้อน: เงินโอนเกินยอดก้อนได้ -----------------------------------------------------------------
-- p_lines: [{ description, amount, expense_category | income_type, person_id?, date? }        ← รายได้ / ค่าใช้จ่าย
--           { move: 'TRANSFER' | 'CARD_PAYMENT' | 'LIABILITY_PAYMENT' | 'PAY_FROM', target, amount, description? }]
CREATE OR REPLACE FUNCTION public.split_lump(p_kind text, p_id uuid, p_lines jsonb)
RETURNS numeric
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE le public.expense_items; li public.income_transactions; x jsonb;
  v_items jsonb := '[]'::jsonb; v_moves jsonb := '[]'::jsonb; v_total numeric := 0; v_amt numeric; v_lump_amt numeric;
  v_bank uuid; v_card uuid; v_liab uuid; v_date date; v_ccy text; v_family uuid; v_move text; v_target uuid; v_desc text;
  v_tccy text; v_tname text; v_left numeric; v_xfer numeric := 0; v_over numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่รายการอย่างน้อย 1 บรรทัด' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'EXPENSE' THEN
    SELECT * INTO le FROM public.expense_items WHERE id = p_id AND pending_split AND deleted_at IS NULL;
    IF le.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการรอแยก' USING ERRCODE = '22023'; END IF;
    v_bank := le.paid_from_asset_id; v_card := le.paid_from_credit_card_id; v_liab := le.liability_id;
    v_date := le.date; v_ccy := le.currency; v_lump_amt := le.amount;
    SELECT me.family_id INTO v_family FROM public.monthly_expenses me WHERE me.id = le.monthly_expense_id;
  ELSIF p_kind = 'INCOME' THEN
    SELECT * INTO li FROM public.income_transactions WHERE id = p_id AND pending_split AND deleted_at IS NULL;
    IF li.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการรอแยก' USING ERRCODE = '22023'; END IF;
    v_bank := li.received_to_asset_id; v_card := li.received_to_credit_card_id; v_liab := li.received_to_liability_id;
    v_date := li.date; v_ccy := li.currency; v_lump_amt := li.amount; v_family := li.family_id;
  ELSE
    RAISE EXCEPTION 'INVALID: ประเภทไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_amt := round(nullif(replace(x->>'amount', ',', ''), '')::numeric, 2);
    IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'INVALID: ยอดแต่ละบรรทัดต้องมากกว่า 0' USING ERRCODE = '22023'; END IF;
    v_total := v_total + v_amt;
    v_move := upper(coalesce(nullif(trim(x->>'move'), ''), ''));
    IF v_move = '' THEN
      v_items := v_items || jsonb_build_array(x || jsonb_build_object('amount', v_amt));
    ELSE
      -- ก้อนแต่ละแบบแยกเป็นการเคลื่อนเงินได้เฉพาะแบบที่ตรงกับก้อน
      IF NOT ((p_kind = 'EXPENSE' AND v_bank IS NOT NULL AND v_move IN ('TRANSFER', 'CARD_PAYMENT', 'LIABILITY_PAYMENT'))
              OR (p_kind = 'INCOME' AND v_bank IS NOT NULL AND v_move = 'TRANSFER')
              OR (p_kind = 'INCOME' AND (v_card IS NOT NULL OR v_liab IS NOT NULL) AND v_move = 'PAY_FROM')) THEN
        RAISE EXCEPTION 'INVALID: รายการรอแยกนี้แยกเป็น "%" ไม่ได้', v_move USING ERRCODE = '22023';
      END IF;
      IF nullif(x->>'target', '') IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชี / บัตร / หนี้ ของทุกบรรทัด' USING ERRCODE = '22023'; END IF;
      v_moves := v_moves || jsonb_build_array(x || jsonb_build_object('amount', v_amt, 'move', v_move));
      IF v_move = 'TRANSFER' THEN v_xfer := v_xfer + v_amt; END IF;
    END IF;
  END LOOP;
  -- เกินยอดก้อนได้เฉพาะส่วนที่เป็นเงินโอน (ก้อนของบัญชีธนาคาร) → ส่วนเกินกลายเป็นก้อนรอแยกฝั่งตรงข้ามในบัญชีเดียวกัน
  --   (ระบบคำนวณก้อนของบัญชีใหม่จากยอด Statement เอง · ก้อนเดือนเดียวกันมีได้ฝั่งเดียว จึงรวมกับก้อนเดิมของเดือนนั้นอยู่แล้ว)
  IF v_total - v_xfer > v_lump_amt + 0.005 THEN
    RAISE EXCEPTION 'INVALID: ยอดที่แยก (%) มากกว่ายอดรอแยก (%)%', v_total, v_lump_amt,
      CASE WHEN v_xfer > 0 THEN ' · ส่วนที่เกินได้เฉพาะเงินโอน' ELSE '' END USING ERRCODE = '22023';
  END IF;
  v_over := greatest(v_total - v_lump_amt, 0);

  -- รายได้ / ค่าใช้จ่าย ก่อน (ก้อนยังอยู่) → แล้วค่อยลงการเคลื่อนเงิน (ก้อนลดเองจากการคำนวณ)
  IF jsonb_array_length(v_items) > 0 THEN PERFORM public.split_pending_item(p_kind, p_id, v_items); END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(v_moves) LOOP
    v_move := x->>'move'; v_target := (x->>'target')::uuid; v_amt := (x->>'amount')::numeric;
    v_desc := nullif(trim(x->>'description'), '');
    IF v_move = 'PAY_FROM' THEN
      PERFORM public.pay_from_statement_drop(jsonb_build_object('kind', CASE WHEN v_card IS NOT NULL THEN 'CARD' ELSE 'LIABILITY' END,
        'id', coalesce(v_card, v_liab), 'bank_asset_id', v_target, 'date', v_date, 'amount', v_amt));
      CONTINUE;
    END IF;
    IF v_move = 'TRANSFER' THEN
      IF NOT private.is_bank_asset(v_target) OR v_target = v_bank THEN
        RAISE EXCEPTION 'INVALID: เงินโอนต้องเป็นบัญชีธนาคารอื่น' USING ERRCODE = '22023';
      END IF;
      SELECT currency, name INTO v_tccy, v_tname FROM public.assets WHERE id = v_target;
    ELSIF v_move = 'CARD_PAYMENT' THEN
      SELECT currency, concat_ws(' ', issuer, card_name) INTO v_tccy, v_tname FROM public.credit_cards WHERE id = v_target AND deleted_at IS NULL;
    ELSE
      SELECT currency, name INTO v_tccy, v_tname FROM public.liabilities WHERE id = v_target AND deleted_at IS NULL;
    END IF;
    IF v_tname IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัญชี / บัตร / หนี้ ที่เลือก' USING ERRCODE = '22023'; END IF;
    IF v_tccy IS DISTINCT FROM v_ccy THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: % ต้องสกุลเดียวกับก้อน (%)', v_tname, v_ccy USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_asset_id, to_credit_card_id, to_liability_id,
                                      amount, currency, reduces_liability, movement_group_id, description, metadata)
    VALUES (v_family, v_date, v_move,
            CASE WHEN v_move = 'TRANSFER' AND p_kind = 'INCOME' THEN v_target ELSE v_bank END,
            CASE WHEN v_move = 'TRANSFER' THEN CASE WHEN p_kind = 'INCOME' THEN v_bank ELSE v_target END END,
            CASE WHEN v_move = 'CARD_PAYMENT' THEN v_target END,
            CASE WHEN v_move = 'LIABILITY_PAYMENT' THEN v_target END,
            v_amt, v_ccy, v_move = 'LIABILITY_PAYMENT', CASE WHEN v_move = 'LIABILITY_PAYMENT' THEN gen_random_uuid() END,
            coalesce(v_desc, CASE v_move WHEN 'TRANSFER' THEN 'เงินโอน (แยกจากก้อนรอแยก)' WHEN 'CARD_PAYMENT' THEN 'จ่ายบัตร · ' || v_tname
                                         ELSE 'จ่ายเงินต้น · ' || v_tname END),
            jsonb_build_object('via', 'split_pending', 'lump_id', p_id));
  END LOOP;

  IF p_kind = 'EXPENSE' THEN
    SELECT coalesce(sum(amount), 0) INTO v_left FROM public.expense_items WHERE id = p_id AND deleted_at IS NULL;
  ELSE
    SELECT coalesce(sum(amount), 0) INTO v_left FROM public.income_transactions WHERE id = p_id AND deleted_at IS NULL;
  END IF;
  -- โอนเกิน → คืนค่าติดลบ = ยอดก้อนฝั่งตรงข้ามของบัญชีนี้ในเดือนนั้น (หน้าจอแจ้งผู้ใช้)
  IF v_over > 0.005 THEN
    IF p_kind = 'EXPENSE' THEN
      SELECT coalesce(sum(amount), 0) INTO v_over FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL
         AND received_to_asset_id = v_bank AND date_trunc('month', date) = date_trunc('month', v_date);
    ELSE
      SELECT coalesce(sum(amount), 0) INTO v_over FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND lump_kind = 'BANK'
         AND paid_from_asset_id = v_bank AND date_trunc('month', date) = date_trunc('month', v_date);
    END IF;
    RETURN -v_over;
  END IF;
  RETURN v_left;
END $$;
REVOKE ALL ON FUNCTION public.split_lump(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_lump(text, uuid, jsonb) TO authenticated;
