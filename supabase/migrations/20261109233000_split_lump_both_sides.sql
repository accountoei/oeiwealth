-- =====================================================================
-- แยกก้อน "รอแยกรายละเอียด" เป็นฝั่งตรงข้ามได้ (ตกลง 9 พ.ย. 2026 · หน้า Income & Expenses)
--   ก้อนรายได้ → บรรทัด "ค่าใช้จ่าย" / "โอนออกบัญชี" ได้ · ก้อนค่าใช้จ่าย → บรรทัด "รายได้" / "โอนเข้าบัญชี" ได้
--   บรรทัดฝั่งตรงข้ามเพิ่มยอดที่ต้องแยก เช่น ก้อนรายได้ 10,000 = รายได้ 12,000 + ค่าใช้จ่าย 2,000 (ยอดบัญชีเท่าเดิม)
--   p_lines: [{ kind?: 'INCOME' | 'EXPENSE' (ไม่ใส่ = ฝั่งเดียวกับก้อน), description, amount, expense_category | income_type, person_id?, date? }
--             { move: 'TRANSFER_IN' | 'TRANSFER_OUT' | 'TRANSFER' (= ทิศเดียวกับก้อน แบบเดิม) | 'CARD_PAYMENT' | 'LIABILITY_PAYMENT' | 'PAY_FROM',
--               target, amount, description? }]
--   ฝั่งตรงข้ามได้เฉพาะก้อนของบัญชีธนาคาร (รายได้ / ค่าใช้จ่าย / เงินโอน) และก้อนของบัตรเครดิต (รายได้ / ค่าใช้จ่าย) · ก้อนของหนี้ไม่ได้
--   หน้าจอเหลือ 4 ตัวเลือก (รายได้ · ค่าใช้จ่าย · โอนเข้าบัญชี · โอนออกบัญชี) · จ่ายบัตร / จ่ายหนี้ / จ่ายจากบัญชี ยังรับได้ (ไม่ทำให้ของเดิมเสีย)
--   ฟังก์ชันอย่างเดียว · ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

CREATE OR REPLACE FUNCTION public.split_lump(p_kind text, p_id uuid, p_lines jsonb)
RETURNS numeric
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE le public.expense_items; li public.income_transactions; x jsonb;
  v_items jsonb := '[]'::jsonb; v_moves jsonb := '[]'::jsonb; v_total numeric := 0; v_amt numeric; v_lump_amt numeric;
  v_bank uuid; v_card uuid; v_liab uuid; v_date date; v_ccy text; v_family uuid; v_move text; v_target uuid; v_desc text;
  v_tccy text; v_tname text; v_left numeric; v_xfer numeric := 0; v_over numeric;
  v_opp_kind text; v_line_kind text; v_opp_items jsonb := '[]'::jsonb; v_opp numeric := 0; v_same numeric := 0;
  v_desc_line text; v_d date; v_person uuid;
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
    v_move := upper(coalesce(nullif(trim(x->>'move'), ''), ''));
    -- เงินโอนเข้า / ออก ตามทิศของเงิน → ทิศเดียวกับก้อน = 'TRANSFER' (แบบเดิม) · ทิศตรงข้าม = 'TRANSFER_OPP'
    IF v_move = 'TRANSFER_IN' THEN v_move := CASE WHEN p_kind = 'INCOME' THEN 'TRANSFER' ELSE 'TRANSFER_OPP' END;
    ELSIF v_move = 'TRANSFER_OUT' THEN v_move := CASE WHEN p_kind = 'EXPENSE' THEN 'TRANSFER' ELSE 'TRANSFER_OPP' END;
    END IF;
    v_line_kind := upper(coalesce(nullif(trim(x->>'kind'), ''), p_kind));
    IF v_move = '' AND v_line_kind NOT IN ('INCOME', 'EXPENSE') THEN
      RAISE EXCEPTION 'INVALID: ประเภทบรรทัดไม่ถูกต้อง' USING ERRCODE = '22023';
    END IF;
    IF v_move = 'TRANSFER_OPP' OR (v_move = '' AND v_line_kind <> p_kind) THEN
      -- ฝั่งตรงข้ามของก้อน (ก้อนรายได้ → ค่าใช้จ่าย / โอนออก · ก้อนค่าใช้จ่าย → รายได้ / โอนเข้า) = เพิ่มยอดที่ต้องแยก
      --   ได้เฉพาะก้อนของบัญชีธนาคาร (+ รายได้ / ค่าใช้จ่ายของก้อนบัตรเครดิต) · ก้อนของหนี้ไม่ได้
      IF NOT (v_bank IS NOT NULL OR (v_card IS NOT NULL AND v_move = '')) THEN
        RAISE EXCEPTION 'INVALID: รายการรอแยกนี้แยกเป็นฝั่งตรงข้าม (%) ไม่ได้',
          CASE WHEN v_move = '' THEN CASE v_line_kind WHEN 'INCOME' THEN 'รายได้' ELSE 'ค่าใช้จ่าย' END ELSE 'เงินโอน' END USING ERRCODE = '22023';
      END IF;
      v_opp := v_opp + v_amt;
      IF v_move = '' THEN
        IF length(trim(coalesce(x->>'description', ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่รายละเอียดทุกบรรทัด' USING ERRCODE = '22023'; END IF;
        v_opp_items := v_opp_items || jsonb_build_array(x || jsonb_build_object('amount', v_amt));
      ELSE
        IF nullif(x->>'target', '') IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีของทุกบรรทัดเงินโอน' USING ERRCODE = '22023'; END IF;
        v_moves := v_moves || jsonb_build_array(x || jsonb_build_object('amount', v_amt, 'move', v_move));
      END IF;
      CONTINUE;
    END IF;
    v_total := v_total + v_amt;
    IF v_move = '' THEN
      v_items := v_items || jsonb_build_array(x - 'kind' || jsonb_build_object('amount', v_amt));
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
  --   บรรทัดฝั่งตรงข้าม (v_opp) เพิ่มยอดที่ต้องแยก: ก้อนรายได้ 10,000 = รายได้ 12,000 − ค่าใช้จ่าย 2,000 (ตกลง 9 พ.ย. 2026)
  IF v_total - v_xfer > v_lump_amt + v_opp + 0.005 THEN
    RAISE EXCEPTION 'INVALID: ยอดที่แยก (%) มากกว่ายอดรอแยก (%)%', v_total - v_opp, v_lump_amt,
      CASE WHEN v_xfer > 0 THEN ' · ส่วนที่เกินได้เฉพาะเงินโอน' ELSE '' END USING ERRCODE = '22023';
  END IF;
  IF v_total <= 0 AND v_opp <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดอย่างน้อย 1 บรรทัด' USING ERRCODE = '22023'; END IF;
  v_over := greatest(v_total - v_opp - v_lump_amt, 0);

  -- 1) ฝั่งตรงข้ามก่อน → ระบบคำนวณก้อนใหม่ (ก้อนเพิ่มเท่ายอดฝั่งตรงข้าม) แล้วค่อยแยกฝั่งเดียวกับก้อน
  --    รายได้ / ค่าใช้จ่าย: บัญชี / บัตรเดียวกับก้อน · วันเดียวกับก้อน · ทำได้แม้ปิดงวดแล้ว (ยอดรวมของบัญชีไม่เปลี่ยน เหมือนการแยกเดิม)
  v_opp_kind := CASE p_kind WHEN 'INCOME' THEN 'EXPENSE' ELSE 'INCOME' END;
  IF jsonb_array_length(v_opp_items) > 0 THEN
    PERFORM set_config('fwv.split', 'on', true);
    FOR x IN SELECT * FROM jsonb_array_elements(v_opp_items) LOOP
      v_amt := (x->>'amount')::numeric; v_desc_line := trim(x->>'description');
      v_d := coalesce(nullif(x->>'date', '')::date, v_date);
      IF date_trunc('month', v_d) <> date_trunc('month', v_date) OR v_d > v_date THEN
        RAISE EXCEPTION 'INVALID: วันที่ % อยู่นอกช่วงของรายการรอแยก', v_d USING ERRCODE = '22023';
      END IF;
      v_person := nullif(x->>'person_id', '')::uuid;
      IF v_opp_kind = 'EXPENSE' THEN
        INSERT INTO public.expense_items(monthly_expense_id, paid_from_asset_id, paid_from_credit_card_id, person_id, date,
                                         description, amount, currency, expense_category, notes)
        VALUES (private.expense_month_id(v_d), li.received_to_asset_id, li.received_to_credit_card_id, v_person, v_d,
                v_desc_line, v_amt, v_ccy, coalesce(nullif(trim(x->>'expense_category'), ''), 'ทั่วไป'), nullif(trim(x->>'notes'), ''));
      ELSE
        INSERT INTO public.income_transactions(family_id, received_to_asset_id, received_to_credit_card_id, person_id,
                                               date, income_type, amount, currency, notes)
        VALUES (v_family, le.paid_from_asset_id, le.paid_from_credit_card_id,
                coalesce(v_person, CASE WHEN le.paid_from_credit_card_id IS NOT NULL THEN le.person_id END), v_d,
                coalesce(nullif(x->>'income_type', ''), 'OTHER'), v_amt, v_ccy, v_desc_line);
      END IF;
    END LOOP;
    PERFORM set_config('fwv.split', 'off', true);
  END IF;
  -- เงินโอนฝั่งตรงข้าม (ก้อนรายได้ → โอนออก · ก้อนค่าใช้จ่าย → โอนเข้า)
  FOR x IN SELECT * FROM jsonb_array_elements(v_moves) WHERE value->>'move' = 'TRANSFER_OPP' LOOP
    v_target := (x->>'target')::uuid; v_amt := (x->>'amount')::numeric; v_desc := nullif(trim(x->>'description'), '');
    IF NOT private.is_bank_asset(v_target) OR v_target = v_bank THEN
      RAISE EXCEPTION 'INVALID: เงินโอนต้องเป็นบัญชีธนาคารอื่น' USING ERRCODE = '22023';
    END IF;
    SELECT currency, name INTO v_tccy, v_tname FROM public.assets WHERE id = v_target;
    IF v_tccy IS DISTINCT FROM v_ccy THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: % ต้องสกุลเดียวกับก้อน (%)', v_tname, v_ccy USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_asset_id, amount, currency, description, metadata)
    VALUES (v_family, v_date, 'TRANSFER',
            CASE WHEN p_kind = 'INCOME' THEN v_bank ELSE v_target END, CASE WHEN p_kind = 'INCOME' THEN v_target ELSE v_bank END,
            v_amt, v_ccy, coalesce(v_desc, 'เงินโอน (แยกจากก้อนรอแยก)'), jsonb_build_object('via', 'split_pending', 'lump_id', p_id));
  END LOOP;
  v_moves := coalesce((SELECT jsonb_agg(e) FROM jsonb_array_elements(v_moves) e WHERE e->>'move' <> 'TRANSFER_OPP'), '[]'::jsonb);

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
