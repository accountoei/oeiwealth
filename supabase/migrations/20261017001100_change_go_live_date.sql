-- =====================================================================
-- เปลี่ยนวัน Go-live (ก่อนกด Confirm Go-live เท่านั้น)
--   public.change_go_live_date(p_new_date date) — ADMIN · ระบบยัง SETUP · ต้องเป็นวันที่ 1 ของเดือน
--   ยอดตั้งต้นทุกประเภทที่ลงวันที่ "วันก่อน Go-live เดิม" ย้ายไป "วันก่อน Go-live ใหม่" ให้ในคำสั่งเดียว:
--     ทรัพย์สิน / บัญชี (asset_valuations is_opening) · หนี้สิน (liability_valuations is_opening)
--     พอร์ต (investment_transactions OPENING_BALANCE + ราคา ณ วันตั้งต้น) · เงินให้กู้ (loan_details.opening_date)
--     บัตรเครดิต (balance_date + ประวัติยอด) · สัดส่วนเจ้าของที่เริ่มวันตั้งต้น (asset_ownerships.start_date)
--   ปฏิเสธ (ไม่แก้อะไรเลย) เมื่อ:
--     - ปิดเดือน / กระทบยอดไปแล้ว
--     - เลื่อนช้าลง แต่มีรายการลงวันที่ระหว่างวันเดิมกับวันใหม่ (จะกลายเป็นรายการก่อน Go-live)
--     - เลื่อนเร็วขึ้น แต่มียอดตั้งต้นที่ลงวันที่ระหว่างวันใหม่กับวันก่อน Go-live เดิม (ต้องแก้วันที่ของรายการนั้นเองก่อน)
--     - มีการเปลี่ยนเจ้าของระหว่างสองวัน
--     - วันตั้งต้นใหม่ยังไม่ถึง แต่มียอดตั้งต้นแล้ว (ยอดลงวันในอนาคตไม่ได้)
--   บันทึก Audit Log ทุกครั้ง (action EDIT_OPENING_POSITION · metadata.kind = CHANGE_GO_LIVE_DATE) · รันซ้ำได้
-- =====================================================================

CREATE OR REPLACE FUNCTION public.change_go_live_date(p_new_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid; f public.families;
  v_old date; v_old_open date; v_new_open date; v_lo date; v_hi date;
  v_later boolean; v_n int; v_moved jsonb; v_issues text[] := '{}';
  c_av int; c_lv int; c_ob int; c_iv int; c_loan int; c_card int; c_stmt int; c_own int;
BEGIN
  v_uid := private.require_role('ADMIN');
  SELECT * INTO f FROM public.families WHERE id = private.default_family_id() FOR UPDATE;
  IF f.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบข้อมูลครอบครัว' USING ERRCODE = 'P0002'; END IF;
  IF f.system_status = 'LIVE' THEN
    RAISE EXCEPTION 'GO_LIVE_LOCKED: ระบบ LIVE แล้ว เปลี่ยนวัน Go-live ไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF p_new_date IS NULL OR extract(day FROM p_new_date) <> 1 THEN
    RAISE EXCEPTION 'INVALID: วัน Go-live ต้องเป็นวันที่ 1 ของเดือน' USING ERRCODE = '22023';
  END IF;
  v_old := f.go_live_date;
  IF p_new_date = v_old THEN
    RETURN jsonb_build_object('go_live_date', v_old, 'changed', false);
  END IF;
  v_old_open := v_old - 1;
  v_new_open := p_new_date - 1;
  v_later := p_new_date > v_old;
  v_lo := least(v_old, p_new_date);
  v_hi := greatest(v_old, p_new_date);

  -- ---------- ตรวจก่อน (ไม่แก้อะไรถ้าไม่ผ่าน) ----------
  IF EXISTS (SELECT 1 FROM public.net_worth_snapshots s WHERE s.family_id = f.id AND s.deleted_at IS NULL) THEN
    v_issues := v_issues || 'ปิดเดือนไปแล้ว';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bank_reconciliations r JOIN public.assets a ON a.id = r.bank_asset_id
              WHERE a.family_id = f.id AND r.deleted_at IS NULL) THEN
    v_issues := v_issues || 'มีการกระทบยอดบัญชีธนาคารแล้ว';
  END IF;

  IF v_later THEN
    -- รายการหลัง Go-live เดิม ที่จะกลายเป็น "ก่อน Go-live"
    SELECT count(*) INTO v_n FROM (
      SELECT 1 FROM public.cash_movements m WHERE m.family_id = f.id AND m.deleted_at IS NULL AND m.movement_date >= v_old AND m.movement_date < p_new_date
      UNION ALL SELECT 1 FROM public.income_transactions i WHERE i.family_id = f.id AND i.deleted_at IS NULL AND i.date >= v_old AND i.date < p_new_date
      UNION ALL SELECT 1 FROM public.expense_items e WHERE e.deleted_at IS NULL AND e.date >= v_old AND e.date < p_new_date
      UNION ALL SELECT 1 FROM public.investment_transactions t WHERE t.deleted_at IS NULL AND t.transaction_type <> 'OPENING_BALANCE'
                  AND t.transaction_date >= v_old AND t.transaction_date < p_new_date
      UNION ALL SELECT 1 FROM public.asset_valuations v JOIN public.assets a ON a.id = v.asset_id
                 WHERE a.family_id = f.id AND v.deleted_at IS NULL AND NOT v.is_opening AND v.valuation_date >= v_old AND v.valuation_date < p_new_date
      UNION ALL SELECT 1 FROM public.liability_valuations v JOIN public.liabilities l ON l.id = v.liability_id
                 WHERE l.family_id = f.id AND v.deleted_at IS NULL AND NOT v.is_opening AND v.valuation_date >= v_old AND v.valuation_date < p_new_date
      UNION ALL SELECT 1 FROM public.credit_card_statements s WHERE s.deleted_at IS NULL AND s.statement_date >= v_old AND s.statement_date < p_new_date
      UNION ALL SELECT 1 FROM public.business_share_sales b WHERE b.deleted_at IS NULL AND b.sale_date >= v_old AND b.sale_date < p_new_date
    ) x;
    IF v_n > 0 THEN
      v_issues := v_issues || format('มีรายการลงวันที่ %s ถึง %s อยู่ %s รายการ (จะกลายเป็นรายการก่อน Go-live) — ลบหรือแก้วันที่ก่อน',
                                     to_char(v_old, 'DD/MM/YYYY'), to_char(v_new_open, 'DD/MM/YYYY'), v_n);
    END IF;
  ELSE
    -- ยอดตั้งต้นที่ลงวันที่หลังวัน Go-live ใหม่ (ไม่ใช่วันก่อน Go-live เดิม) — ไม่เดาให้ ต้องแก้เอง
    SELECT count(*) INTO v_n FROM (
      SELECT 1 FROM public.asset_valuations v JOIN public.assets a ON a.id = v.asset_id
       WHERE a.family_id = f.id AND v.deleted_at IS NULL AND v.is_opening AND v.valuation_date >= p_new_date AND v.valuation_date <> v_old_open
      UNION ALL SELECT 1 FROM public.liability_valuations v JOIN public.liabilities l ON l.id = v.liability_id
       WHERE l.family_id = f.id AND v.deleted_at IS NULL AND v.is_opening AND v.valuation_date >= p_new_date AND v.valuation_date <> v_old_open
      UNION ALL SELECT 1 FROM public.investment_transactions t WHERE t.deleted_at IS NULL AND t.transaction_type = 'OPENING_BALANCE'
                  AND t.transaction_date >= p_new_date AND t.transaction_date <> v_old_open
      UNION ALL SELECT 1 FROM public.loan_details d JOIN public.assets a ON a.id = d.asset_id
       WHERE a.family_id = f.id AND d.deleted_at IS NULL AND d.opening_date >= p_new_date AND d.opening_date < v_old AND d.opening_date <> v_old_open
      UNION ALL SELECT 1 FROM public.credit_card_statements s WHERE s.deleted_at IS NULL
                  AND s.statement_date >= p_new_date AND s.statement_date < v_old AND s.statement_date <> v_old_open
    ) x;
    IF v_n > 0 THEN
      v_issues := v_issues || format('มียอดตั้งต้นที่ลงวันที่ระหว่าง %s ถึง %s อยู่ %s รายการ — แก้วันที่ของยอดนั้นให้อยู่ก่อน %s ก่อน',
                                     to_char(p_new_date, 'DD/MM/YYYY'), to_char(v_old_open - 1, 'DD/MM/YYYY'), v_n, to_char(p_new_date, 'DD/MM/YYYY'));
    END IF;
  END IF;

  -- เปลี่ยนเจ้าของระหว่างสองวัน (นอกจากแถวที่เริ่มวันตั้งต้นเดิม ซึ่งย้ายให้)
  IF EXISTS (SELECT 1 FROM public.asset_ownerships o JOIN public.assets a ON a.id = o.asset_id
              WHERE a.family_id = f.id AND o.deleted_at IS NULL
                AND ((o.start_date > v_lo - 1 AND o.start_date <= v_hi - 1 AND o.start_date <> v_old_open)
                  OR (o.end_date >= v_lo - 1 AND o.end_date < v_hi - 1))) THEN
    v_issues := v_issues || format('มีการเปลี่ยนเจ้าของทรัพย์สินระหว่าง %s ถึง %s — แก้ประวัติเจ้าของก่อน',
                                   to_char(v_lo - 1, 'DD/MM/YYYY'), to_char(v_hi - 1, 'DD/MM/YYYY'));
  END IF;

  -- วันตั้งต้นใหม่อยู่ในอนาคต แต่มียอดตั้งต้นแล้ว (ระบบไม่รับยอดลงวันในอนาคต)
  IF v_new_open > current_date AND (
       EXISTS (SELECT 1 FROM public.asset_valuations v JOIN public.assets a ON a.id = v.asset_id
                WHERE a.family_id = f.id AND v.deleted_at IS NULL AND v.is_opening AND v.valuation_date = v_old_open)
    OR EXISTS (SELECT 1 FROM public.liability_valuations v JOIN public.liabilities l ON l.id = v.liability_id
                WHERE l.family_id = f.id AND v.deleted_at IS NULL AND v.is_opening AND v.valuation_date = v_old_open)
    OR EXISTS (SELECT 1 FROM public.investment_transactions t WHERE t.deleted_at IS NULL AND t.transaction_type = 'OPENING_BALANCE'
                AND t.transaction_date = v_old_open)) THEN
    v_issues := v_issues || format('ยอดตั้งต้นต้องลงวันที่ %s ซึ่งยังไม่ถึง — เปลี่ยนเป็นวันนี้ได้ตั้งแต่วันที่ %s หรือกำหนดวันนี้ตอนตั้งระบบใหม่ (Bootstrap)',
                                   to_char(v_new_open, 'DD/MM/YYYY'), to_char(v_new_open, 'DD/MM/YYYY'));
  END IF;

  IF array_length(v_issues, 1) > 0 THEN
    RAISE EXCEPTION 'GO_LIVE_CHANGE_BLOCKED: %', array_to_string(v_issues, ' · ') USING ERRCODE = '22023';
  END IF;

  -- ---------- เปลี่ยน ----------
  -- ไม่ให้ระบบสร้าง "ก้อนรอแยกรายละเอียด" จากการย้ายวันที่ของยอดตั้งต้น (ไม่ใช่การอัปเดตยอดจริง)
  PERFORM set_config('fwv.restate', 'on', true);

  UPDATE public.families SET go_live_date = p_new_date WHERE id = f.id;

  UPDATE public.asset_valuations v SET valuation_date = v_new_open
    FROM public.assets a
   WHERE a.id = v.asset_id AND a.family_id = f.id AND v.deleted_at IS NULL AND v.is_opening
     AND (v.valuation_date = v_old_open OR v.valuation_date >= p_new_date);
  GET DIAGNOSTICS c_av = ROW_COUNT;

  UPDATE public.liability_valuations v SET valuation_date = v_new_open
    FROM public.liabilities l
   WHERE l.id = v.liability_id AND l.family_id = f.id AND v.deleted_at IS NULL AND v.is_opening
     AND (v.valuation_date = v_old_open OR v.valuation_date >= p_new_date);
  GET DIAGNOSTICS c_lv = ROW_COUNT;

  -- ราคา ณ วันตั้งต้นของหลักทรัพย์ที่มียอดตั้งต้นวันเดิม (ย้ายก่อน OPENING_BALANCE → ต้นทุน / มูลค่าคำนวณครั้งเดียวด้วยชุดใหม่)
  UPDATE public.investment_valuations iv SET valuation_date = v_new_open
   WHERE iv.deleted_at IS NULL AND iv.valuation_date = v_old_open
     AND EXISTS (SELECT 1 FROM public.investment_transactions t WHERE t.holding_id = iv.holding_id AND t.deleted_at IS NULL
                  AND t.transaction_type = 'OPENING_BALANCE' AND t.transaction_date = v_old_open)
     AND NOT EXISTS (SELECT 1 FROM public.investment_valuations x WHERE x.holding_id = iv.holding_id AND x.deleted_at IS NULL
                      AND x.valuation_date = v_new_open);
  GET DIAGNOSTICS c_iv = ROW_COUNT;

  UPDATE public.investment_transactions t SET transaction_date = v_new_open
   WHERE t.deleted_at IS NULL AND t.transaction_type = 'OPENING_BALANCE'
     AND (t.transaction_date = v_old_open OR t.transaction_date >= p_new_date);
  GET DIAGNOSTICS c_ob = ROW_COUNT;

  UPDATE public.loan_details d SET opening_date = v_new_open
    FROM public.assets a
   WHERE a.id = d.asset_id AND a.family_id = f.id AND d.deleted_at IS NULL
     AND (d.opening_date = v_old_open OR (d.opening_date >= p_new_date AND d.opening_date < v_old));
  GET DIAGNOSTICS c_loan = ROW_COUNT;

  -- บัตร: ประวัติยอดก่อน แล้วค่อยยอดของบัตร (trigger ประวัติจะเจอแถววันใหม่อยู่แล้ว → ไม่สร้างซ้ำ)
  UPDATE public.credit_card_statements s SET statement_date = v_new_open
   WHERE s.deleted_at IS NULL AND s.statement_date = v_old_open
     AND NOT EXISTS (SELECT 1 FROM public.credit_card_statements x WHERE x.credit_card_id = s.credit_card_id
                      AND x.deleted_at IS NULL AND x.statement_date = v_new_open);
  GET DIAGNOSTICS c_stmt = ROW_COUNT;
  UPDATE public.credit_cards c SET balance_date = v_new_open
    FROM public.persons p
   WHERE p.id = c.person_id AND p.family_id = f.id AND c.deleted_at IS NULL AND c.balance_date = v_old_open;
  GET DIAGNOSTICS c_card = ROW_COUNT;

  UPDATE public.asset_ownerships o SET start_date = v_new_open
    FROM public.assets a
   WHERE a.id = o.asset_id AND a.family_id = f.id AND o.deleted_at IS NULL AND o.start_date = v_old_open
     AND (o.end_date IS NULL OR o.end_date >= v_new_open);
  GET DIAGNOSTICS c_own = ROW_COUNT;

  PERFORM set_config('fwv.restate', 'off', true);

  v_moved := jsonb_build_object('asset_valuations', c_av, 'liability_valuations', c_lv, 'investment_opening', c_ob,
    'investment_prices', c_iv, 'loans', c_loan, 'card_statements', c_stmt, 'cards', c_card, 'ownerships', c_own);
  PERFORM private.write_audit('EDIT_OPENING_POSITION', 'families', f.id::text,
          jsonb_build_object('kind', 'CHANGE_GO_LIVE_DATE', 'from', v_old, 'to', p_new_date, 'moved', v_moved), f.id, 'go_live_date');
  RETURN jsonb_build_object('go_live_date', p_new_date, 'changed', true, 'from', v_old, 'moved', v_moved);
END $$;

REVOKE ALL ON FUNCTION public.change_go_live_date(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_go_live_date(date) TO authenticated, service_role;
