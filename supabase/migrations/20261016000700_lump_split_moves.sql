-- =====================================================================
-- ก้อน "รอแยกรายละเอียด": แยกเป็นการจ่าย / โอน · ก้อนกลับมาเมื่อรายการที่อธิบายถูกลบ · ส่วนแบ่งรายคนของหนี้
--   1) ส่วนแบ่งรายคน: รายได้ / ค่าใช้จ่ายของหนี้ที่ไม่ได้ระบุคน → ตามผู้รับผิดชอบหนี้ (เดิม = ส่วนกลาง)
--   2) ก้อนที่ปิดไปแล้ว (ยอด = 0 เพราะมีรายการจริงมาอธิบายครบ) → รายการนั้นถูกลบ / ลดยอด / ย้ายวัน → ก้อนกลับมาเอง
--      ใช้ยอดตาม Statement ปัจจุบันของวันนั้น (ไม่มี Statement แล้ว → ไม่สร้าง) · ทั้งบัญชีธนาคาร / บัตร / หนี้
--   3) split_lump(): แยกก้อนในคำสั่งเดียว (ทำทั้งหมด หรือไม่ทำเลย)
--        บรรทัดรายได้ / ค่าใช้จ่าย (เหมือนเดิม) +
--        ก้อนค่าใช้จ่ายของบัญชี: โอนไปบัญชีอื่น · จ่ายบัตร · จ่ายหนี้ (เงินต้น)
--        ก้อนรายได้ของบัญชี: โอนเข้าจากบัญชีอื่น
--        ก้อนรายได้ของบัตร / หนี้ (ยอดลดเกิน): จ่ายจากบัญชี
--   4) update_transfer(): แก้เงินโอนระหว่างบัญชี (บัญชีต้นทาง / ปลายทาง · วันที่ · ยอด · ค่าธรรมเนียม · รายละเอียด)
--   ฟังก์ชัน / View อย่างเดียว · ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) ส่วนแบ่งรายคน ---------------------------------------------------------------------------
-- ผู้รับผิดชอบหนี้: ใช้ private.liability_owner_shares() เดิม (ชุดเดียวกับ Net Worth รายคน · ส่วนที่ไม่ครบ 100% = ส่วนกลาง)

-- รายได้: ระบุคน → 100% · ทรัพย์สิน → เจ้าของ · เข้าบัญชี → เจ้าของบัญชี · ลดหนี้ → ผู้รับผิดชอบหนี้ · อื่น ๆ → ส่วนกลาง
CREATE OR REPLACE FUNCTION private.income_shares(p_person uuid, p_asset uuid, p_received uuid, p_date date, p_liab uuid)
RETURNS TABLE (person_id uuid, pct numeric)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p_person, 100::numeric WHERE p_person IS NOT NULL
  UNION ALL
  SELECT o.person_id, o.pct FROM private.asset_owner_shares(p_asset, p_date) o
   WHERE p_person IS NULL AND p_asset IS NOT NULL
  UNION ALL
  SELECT o.person_id, o.pct FROM private.asset_owner_shares(p_received, p_date) o
   WHERE p_person IS NULL AND p_asset IS NULL AND p_received IS NOT NULL
  UNION ALL
  SELECT o.person_id, o.pct FROM private.liability_owner_shares(p_liab) o
   WHERE p_person IS NULL AND p_asset IS NULL AND p_received IS NULL AND p_liab IS NOT NULL
  UNION ALL
  SELECT NULL::uuid, 100::numeric WHERE p_person IS NULL AND p_asset IS NULL AND p_received IS NULL AND p_liab IS NULL
$$;

-- ค่าใช้จ่าย: ระบุคน → 100% · ของหนี้ (ดอกเบี้ย / ก้อน) → ผู้รับผิดชอบหนี้ · บัตร → เจ้าของบัตร · บัญชี → เจ้าของบัญชี · อื่น ๆ → ส่วนกลาง
CREATE OR REPLACE FUNCTION private.expense_shares(p_person uuid, p_card uuid, p_asset uuid, p_date date, p_liab uuid)
RETURNS TABLE (person_id uuid, pct numeric)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p_person, 100::numeric WHERE p_person IS NOT NULL
  UNION ALL
  SELECT o.person_id, o.pct FROM private.liability_owner_shares(p_liab) o
   WHERE p_person IS NULL AND p_liab IS NOT NULL
  UNION ALL
  SELECT c.person_id, 100::numeric FROM public.credit_cards c WHERE p_person IS NULL AND p_liab IS NULL AND c.id = p_card
  UNION ALL
  SELECT o.person_id, o.pct FROM private.asset_owner_shares(p_asset, p_date) o
   WHERE p_person IS NULL AND p_liab IS NULL AND p_card IS NULL AND p_asset IS NOT NULL
  UNION ALL
  SELECT NULL::uuid, 100::numeric WHERE p_person IS NULL AND p_liab IS NULL AND p_card IS NULL AND p_asset IS NULL
$$;

CREATE OR REPLACE VIEW public.v_income_by_person WITH (security_invoker = true) AS
  SELECT i.id AS income_id, i.family_id, i.date, i.income_type, i.currency,
         (i.source_transaction_id IS NOT NULL) AS is_investment_income,
         sh.person_id, sh.pct AS share_percent,
         round(i.amount * sh.pct / 100, 4) AS amount_share,
         round(coalesce(i.tax, 0) * sh.pct / 100, 4) AS tax_share,
         round(i.base_amount * sh.pct / 100, 4) AS base_amount_share
    FROM public.income_transactions i
    CROSS JOIN LATERAL private.income_shares(i.person_id, i.asset_id, i.received_to_asset_id, i.date, i.received_to_liability_id) sh
   WHERE i.deleted_at IS NULL AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');

CREATE OR REPLACE VIEW public.v_expense_by_person WITH (security_invoker = true) AS
  SELECT i.id AS expense_item_id, me.family_id, me.year_month, i.date, i.expense_category, i.currency,
         (i.source_cash_movement_id IS NOT NULL) AS is_derived_fee,
         sh.person_id, sh.pct AS share_percent,
         round(i.amount * sh.pct / 100, 4) AS amount_share,
         round(i.base_amount * sh.pct / 100, 4) AS base_amount_share
    FROM public.expense_items i
    JOIN public.monthly_expenses me ON me.id = i.monthly_expense_id
    LEFT JOIN public.cash_movements src ON src.id = i.source_cash_movement_id
    CROSS JOIN LATERAL private.expense_shares(i.person_id, i.paid_from_credit_card_id, coalesce(i.paid_from_asset_id, src.from_asset_id), i.date, i.liability_id) sh
   WHERE i.deleted_at IS NULL AND me.deleted_at IS NULL AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');

-- Dashboard รายคน: ใช้กติกาเดียวกับ View
DO $$
DECLARE d text;
  i_old text := 'private.income_shares(i.person_id, i.asset_id, i.received_to_asset_id, i.date) sh';
  i_new text := 'private.income_shares(i.person_id, i.asset_id, i.received_to_asset_id, i.date, i.received_to_liability_id) sh';
  e_old text := 'coalesce(e.paid_from_asset_id, src.from_asset_id), e.date) sh';
  e_new text := 'coalesce(e.paid_from_asset_id, src.from_asset_id), e.date, e.liability_id) sh';
BEGIN
  d := pg_get_functiondef('public.person_dashboard(date, uuid)'::regprocedure);
  IF position(i_new IN d) > 0 THEN RETURN; END IF;                       -- รันซ้ำ
  IF (length(d) - length(replace(d, i_old, ''))) / length(i_old) <> 1
     OR (length(d) - length(replace(d, e_old, ''))) / length(e_old) <> 2 THEN
    RAISE EXCEPTION 'person_dashboard: ไม่พบจุดที่ต้องแก้ (ส่วนแบ่งรายคน)';
  END IF;
  EXECUTE replace(replace(d, i_old, i_new), e_old, e_new);
END $$;

-- 2) ก้อนที่ปิดไปแล้วกลับมาเอง ------------------------------------------------------------------
-- ยอดตาม Statement ปัจจุบันของวันนั้น (ไม่มี → NULL)
CREATE OR REPLACE FUNCTION private.lump_statement_target(p_kind text, p_entity uuid, p_date date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_kind
    WHEN 'BANK' THEN coalesce(
      (SELECT v.value FROM public.asset_valuations v WHERE v.asset_id = p_entity AND v.valuation_date = p_date AND v.deleted_at IS NULL
        ORDER BY v.created_at DESC LIMIT 1),
      (SELECT r.actual_closing - r.rounding_adjustment FROM public.bank_reconciliations r
        WHERE r.bank_asset_id = p_entity AND r.year_month = date_trunc('month', p_date)::date AND r.deleted_at IS NULL
          AND r.status <> 'OPEN' AND r.actual_closing IS NOT NULL LIMIT 1))
    WHEN 'CARD' THEN (SELECT s.balance FROM public.credit_card_statements s WHERE s.credit_card_id = p_entity AND s.statement_date = p_date
                        AND s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 1)
    ELSE (SELECT v.balance FROM public.liability_valuations v WHERE v.liability_id = p_entity AND v.valuation_date = p_date
            AND v.deleted_at IS NULL ORDER BY v.created_at DESC LIMIT 1)
  END
$$;

-- รายการวันที่ p_date เปลี่ยน → ก้อนที่ปิดไปแล้วซึ่งครอบคลุมวันนั้น (และไม่มีก้อนเปิดของรอบเดียวกัน) คำนวณใหม่
CREATE OR REPLACE FUNCTION private.revive_closed_lumps(p_kind text, p_entity uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l record; v_target numeric;
BEGIN
  IF private.lump_busy() OR p_entity IS NULL OR p_date IS NULL THEN RETURN; END IF;
  FOR l IN
    WITH c AS (
      SELECT x.date, x.lump_from, x.lump_base, x.deleted_at FROM public.expense_items x
       WHERE x.pending_split AND x.deleted_at IS NOT NULL AND x.lump_kind = p_kind AND x.lump_from IS NOT NULL
         AND (CASE p_kind WHEN 'BANK' THEN x.paid_from_asset_id WHEN 'CARD' THEN x.paid_from_credit_card_id ELSE x.liability_id END) = p_entity
         AND p_date > x.lump_from AND p_date <= x.date
      UNION ALL
      SELECT y.date, y.lump_from, y.lump_base, y.deleted_at FROM public.income_transactions y
       WHERE y.pending_split AND y.deleted_at IS NOT NULL AND y.lump_from IS NOT NULL
         AND (CASE p_kind WHEN 'BANK' THEN y.received_to_asset_id WHEN 'CARD' THEN y.received_to_credit_card_id ELSE y.received_to_liability_id END) = p_entity
         AND p_date > y.lump_from AND p_date <= y.date)
    SELECT DISTINCT ON (CASE WHEN p_kind = 'LIABILITY' THEN c.date ELSE date_trunc('month', c.date)::date END)
           c.date, c.lump_from, c.lump_base
      FROM c ORDER BY (CASE WHEN p_kind = 'LIABILITY' THEN c.date ELSE date_trunc('month', c.date)::date END), c.deleted_at DESC
  LOOP
    -- มีก้อนที่เปิดอยู่ของรอบเดียวกันแล้ว → การคำนวณปกติดูแลอยู่
    IF p_kind = 'LIABILITY' THEN
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.expense_items x WHERE x.pending_split AND x.deleted_at IS NULL AND x.lump_kind = 'LIABILITY'
                              AND x.liability_id = p_entity AND x.date = l.date)
                 OR EXISTS (SELECT 1 FROM public.income_transactions y WHERE y.pending_split AND y.deleted_at IS NULL
                              AND y.received_to_liability_id = p_entity AND y.date = l.date);
    ELSE
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.expense_items x WHERE x.pending_split AND x.deleted_at IS NULL AND x.lump_kind = p_kind
                              AND (CASE p_kind WHEN 'BANK' THEN x.paid_from_asset_id ELSE x.paid_from_credit_card_id END) = p_entity
                              AND date_trunc('month', x.date) = date_trunc('month', l.date))
                 OR EXISTS (SELECT 1 FROM public.income_transactions y WHERE y.pending_split AND y.deleted_at IS NULL
                              AND (CASE p_kind WHEN 'BANK' THEN y.received_to_asset_id ELSE y.received_to_credit_card_id END) = p_entity
                              AND date_trunc('month', y.date) = date_trunc('month', l.date));
      -- มียอดที่ใหม่กว่าในเดือนเดียวกัน → ก้อนนี้ไม่ใช่ของยอดล่าสุดแล้ว
      CONTINUE WHEN p_kind = 'BANK' AND EXISTS (SELECT 1 FROM public.asset_valuations v WHERE v.asset_id = p_entity AND v.deleted_at IS NULL
                              AND v.valuation_date > l.date AND date_trunc('month', v.valuation_date) = date_trunc('month', l.date));
      CONTINUE WHEN p_kind = 'CARD' AND EXISTS (SELECT 1 FROM public.credit_card_statements s WHERE s.credit_card_id = p_entity AND s.deleted_at IS NULL
                              AND s.statement_date > l.date AND date_trunc('month', s.statement_date) = date_trunc('month', l.date));
    END IF;
    v_target := private.lump_statement_target(p_kind, p_entity, l.date);
    CONTINUE WHEN v_target IS NULL;
    IF p_kind = 'BANK' THEN
      PERFORM private.set_bank_lump_at(p_entity, l.date, l.lump_from, l.lump_base, v_target);
    ELSE
      PERFORM private.set_debt_lump(p_kind, p_entity, l.date, l.lump_from, l.lump_base, v_target);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.revive_closed_lumps(text, uuid, date) FROM PUBLIC, anon, authenticated;

-- ก้อนธนาคาร: คำนวณก้อนที่เปิดอยู่ + เปิดก้อนที่ปิดไปแล้วกลับ (ถ้ายังมีส่วนต่าง)
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
  PERFORM private.revive_closed_lumps('BANK', p_bank, p_date);
END $$;

-- ก้อนบัตร / หนี้: คำนวณก้อนที่เปิดอยู่ + เปิดก้อนที่ปิดไปแล้วกลับ (ถ้ายังมีส่วนต่าง)
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
  PERFORM private.revive_closed_lumps(p_kind, p_entity, p_date);
END $$;

-- 3) แยกก้อนในคำสั่งเดียว ----------------------------------------------------------------------
-- p_lines: [{ description, amount, expense_category | income_type, person_id?, date? }        ← รายได้ / ค่าใช้จ่าย
--           { move: 'TRANSFER' | 'CARD_PAYMENT' | 'LIABILITY_PAYMENT' | 'PAY_FROM', target, amount, description? }]
DROP FUNCTION IF EXISTS public.split_lump(text, uuid, jsonb);
CREATE FUNCTION public.split_lump(p_kind text, p_id uuid, p_lines jsonb)
RETURNS numeric
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE le public.expense_items; li public.income_transactions; x jsonb;
  v_items jsonb := '[]'::jsonb; v_moves jsonb := '[]'::jsonb; v_total numeric := 0; v_amt numeric; v_lump_amt numeric;
  v_bank uuid; v_card uuid; v_liab uuid; v_date date; v_ccy text; v_family uuid; v_move text; v_target uuid; v_desc text;
  v_tccy text; v_tname text; v_left numeric;
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
    END IF;
  END LOOP;
  IF v_total > v_lump_amt + 0.005 THEN
    RAISE EXCEPTION 'INVALID: ยอดที่แยก (%) มากกว่ายอดรอแยก (%)', v_total, v_lump_amt USING ERRCODE = '22023';
  END IF;

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
  RETURN v_left;
END $$;
REVOKE ALL ON FUNCTION public.split_lump(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_lump(text, uuid, jsonb) TO authenticated;

-- 4) แก้เงินโอนระหว่างบัญชี ------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.update_transfer(uuid, uuid, uuid, date, numeric, numeric, text);
CREATE FUNCTION public.update_transfer(p_id uuid, p_from uuid, p_to uuid, p_date date, p_amount numeric,
  p_fee numeric DEFAULT NULL, p_description text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE m public.cash_movements; v_fc text; v_tc text;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT * INTO m FROM public.cash_movements WHERE id = p_id AND deleted_at IS NULL;
  IF m.id IS NULL OR m.movement_type <> 'TRANSFER' OR m.is_derived THEN
    RAISE EXCEPTION 'NOT_FOUND: ไม่พบเงินโอนที่แก้ได้' USING ERRCODE = '22023';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to OR NOT private.is_bank_asset(p_from) OR NOT private.is_bank_asset(p_to) THEN
    RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีต้นทาง / ปลายทาง (คนละบัญชี)' USING ERRCODE = '22023';
  END IF;
  SELECT currency INTO v_fc FROM public.assets WHERE id = p_from;
  SELECT currency INTO v_tc FROM public.assets WHERE id = p_to;
  IF v_fc IS DISTINCT FROM m.currency OR v_tc IS DISTINCT FROM coalesce(m.counter_currency, m.currency) THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีต้องสกุลเดียวกับเงินโอนเดิม (%)', m.currency USING ERRCODE = '22023';
  END IF;
  IF p_date IS NULL OR p_amount IS NULL OR p_amount <= 0 OR coalesce(p_fee, 0) < 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่วันที่และยอดให้ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  UPDATE public.cash_movements
     SET from_asset_id = p_from, to_asset_id = p_to, movement_date = p_date, amount = p_amount,
         fee = p_fee, description = nullif(trim(p_description), '')
   WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้รายการนี้' USING ERRCODE = '42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.update_transfer(uuid, uuid, uuid, date, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_transfer(uuid, uuid, uuid, date, numeric, numeric, text) TO authenticated;
