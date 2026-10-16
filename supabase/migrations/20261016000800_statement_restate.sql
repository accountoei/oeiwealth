-- =====================================================================
-- ยอดตาม Statement ที่แก้ / ลบในตารางประวัติ → ก้อน "รอแยกรายละเอียด" คำนวณตามเอง · ล็อกงวดยอดบัตร · เตือนก้อนตอนปิดงวด
--   1) แก้ยอด / วันที่ / ลบ ยอดบัญชีธนาคาร (asset_valuations ของบัญชีธนาคาร) หรือยอดหนี้ (liability_valuations) ตรง ๆ
--        → ก้อนของยอดนั้นคำนวณใหม่ (ลบยอด = ก้อนของยอดนั้นหายตาม · บัญชี: ก้อนย้ายไปยอดล่าสุดที่เหลือของเดือน)
--        → ก้อนหลังจากนั้นที่ใช้ยอดนี้เป็นจุดตั้งต้น ปรับจุดตั้งต้นตาม (ลบยอด = ใช้ยอดก่อนหน้าแทน)
--   2) ยอดบัตรตาม Statement (credit_card_statements) ในงวดที่ปิดแล้ว เพิ่ม / แก้ / ลบไม่ได้ (เหมือนยอดบัญชี / ยอดหนี้)
--   3) Month Closing → Checklist "Income & Expenses": แสดงก้อนรอแยกของเดือน (REVIEW · ไม่บังคับ)
--   ฟังก์ชัน / Trigger อย่างเดียว · ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- ยอดก่อนวันที่ (บัญชี / หนี้)
CREATE OR REPLACE FUNCTION private.statement_before(p_kind text, p_entity uuid, p_date date)
RETURNS TABLE (stmt_date date, stmt_value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT x.d, x.v FROM (
    SELECT v.valuation_date AS d, v.value AS v, v.created_at FROM public.asset_valuations v
     WHERE p_kind = 'BANK' AND v.asset_id = p_entity AND v.deleted_at IS NULL AND v.valuation_date < p_date
    UNION ALL
    SELECT v.valuation_date, v.balance, v.created_at FROM public.liability_valuations v
     WHERE p_kind = 'LIABILITY' AND v.liability_id = p_entity AND v.deleted_at IS NULL AND v.valuation_date < p_date) x
  ORDER BY x.d DESC, x.created_at DESC LIMIT 1
$$;

-- ลบก้อนที่เปิดอยู่ (ภายใน · ตามวันที่ หรือ ตามเดือน)
CREATE OR REPLACE FUNCTION private.close_lumps(p_kind text, p_entity uuid, p_date date, p_whole_month boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM set_config('fwv.lump', 'on', true);
  UPDATE public.expense_items SET deleted_at = now()
   WHERE pending_split AND deleted_at IS NULL AND lump_kind = p_kind
     AND (CASE p_kind WHEN 'BANK' THEN paid_from_asset_id ELSE liability_id END) = p_entity
     AND (CASE WHEN p_whole_month THEN date_trunc('month', date) = date_trunc('month', p_date) ELSE date = p_date END);
  UPDATE public.income_transactions SET deleted_at = now()
   WHERE pending_split AND deleted_at IS NULL
     AND (CASE p_kind WHEN 'BANK' THEN received_to_asset_id ELSE received_to_liability_id END) = p_entity
     AND (CASE WHEN p_whole_month THEN date_trunc('month', date) = date_trunc('month', p_date) ELSE date = p_date END);
  PERFORM set_config('fwv.lump', 'off', true);
END $$;
REVOKE ALL ON FUNCTION private.close_lumps(text, uuid, date, boolean) FROM PUBLIC, anon, authenticated;

-- ก้อนหลังจากวันที่ p_date ที่ใช้ยอดนี้เป็นจุดตั้งต้น → จุดตั้งต้นใหม่ (ยอดนี้ / ยอดก่อนหน้า ถ้ายอดนี้ถูกลบ)
CREATE OR REPLACE FUNCTION private.restate_followers(p_kind text, p_entity uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l record; v_t numeric; v_pd date; v_pv numeric;
BEGIN
  v_t := private.lump_statement_target(p_kind, p_entity, p_date);
  FOR l IN SELECT x.date, x.lump_target FROM public.expense_items x
            WHERE x.pending_split AND x.deleted_at IS NULL AND x.lump_kind = p_kind AND x.lump_from = p_date AND x.date > p_date
              AND (CASE p_kind WHEN 'BANK' THEN x.paid_from_asset_id ELSE x.liability_id END) = p_entity
           UNION
           SELECT y.date, y.lump_target FROM public.income_transactions y
            WHERE y.pending_split AND y.deleted_at IS NULL AND y.lump_from = p_date AND y.date > p_date
              AND (CASE p_kind WHEN 'BANK' THEN y.received_to_asset_id ELSE y.received_to_liability_id END) = p_entity LOOP
    IF v_t IS NOT NULL THEN v_pd := p_date; v_pv := v_t;
    ELSE SELECT stmt_date, stmt_value INTO v_pd, v_pv FROM private.statement_before(p_kind, p_entity, p_date);
    END IF;
    IF v_pd IS NULL THEN
      PERFORM private.close_lumps(p_kind, p_entity, l.date, false);
    ELSIF p_kind = 'BANK' THEN
      PERFORM private.set_bank_lump_at(p_entity, l.date, v_pd, v_pv, coalesce(private.lump_statement_target('BANK', p_entity, l.date), l.lump_target));
    ELSE
      PERFORM private.set_debt_lump('LIABILITY', p_entity, l.date, v_pd, v_pv, coalesce(private.lump_statement_target('LIABILITY', p_entity, l.date), l.lump_target));
    END IF;
  END LOOP;

END $$;
REVOKE ALL ON FUNCTION private.restate_followers(text, uuid, date) FROM PUBLIC, anon, authenticated;

-- ยอดวันที่ p_date เปลี่ยน (แก้ / ลบ / ย้ายวัน) → คำนวณก้อนที่เกี่ยวข้องใหม่
CREATE OR REPLACE FUNCTION private.restate_statement(p_kind text, p_entity uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_t numeric; v_latest date; v_ld date; v_from date; v_base numeric;
BEGIN
  IF p_entity IS NULL OR p_date IS NULL OR private.lump_busy() OR p_kind NOT IN ('BANK', 'LIABILITY') THEN RETURN; END IF;
  v_t := private.lump_statement_target(p_kind, p_entity, p_date);

  -- ก้อนของยอดนี้เองก่อน แล้วค่อยก้อนหลังจากนั้น (ก้อนนี้นับอยู่ในช่วงของก้อนถัดไปเมื่อจุดตั้งต้นย้ายไปก่อนหน้า)
  IF p_kind = 'LIABILITY' THEN
    SELECT lump_from, lump_base INTO v_from, v_base FROM public.expense_items
     WHERE pending_split AND deleted_at IS NULL AND lump_kind = 'LIABILITY' AND liability_id = p_entity AND date = p_date;
    IF v_from IS NULL THEN
      SELECT lump_from, lump_base INTO v_from, v_base FROM public.income_transactions
       WHERE pending_split AND deleted_at IS NULL AND received_to_liability_id = p_entity AND date = p_date;
    END IF;
    IF v_t IS NULL THEN
      PERFORM private.close_lumps('LIABILITY', p_entity, p_date, false);              -- ยอดถูกลบ → ก้อนของยอดนั้นหาย
    ELSE
      IF v_from IS NULL THEN SELECT stmt_date, stmt_value INTO v_from, v_base FROM private.statement_before('LIABILITY', p_entity, p_date); END IF;
      IF v_from IS NOT NULL THEN PERFORM private.set_debt_lump('LIABILITY', p_entity, p_date, v_from, v_base, v_t); END IF;
    END IF;
    PERFORM private.restate_followers('LIABILITY', p_entity, p_date);
    RETURN;
  END IF;

  -- บัญชีธนาคาร: ก้อนของเดือน ผูกกับยอดล่าสุดของเดือน
  IF EXISTS (SELECT 1 FROM public.expense_items WHERE pending_split AND deleted_at IS NULL AND lump_kind = 'BANK' AND paid_from_asset_id = p_entity
               AND date_trunc('month', date) = date_trunc('month', p_date) AND lump_from IS NULL)
     OR EXISTS (SELECT 1 FROM public.income_transactions WHERE pending_split AND deleted_at IS NULL AND received_to_asset_id = p_entity
               AND date_trunc('month', date) = date_trunc('month', p_date) AND lump_from IS NULL) THEN
    PERFORM private.restate_followers('BANK', p_entity, p_date);
    RETURN;                                                                           -- ก้อนแบบเดิม (จากหน้ากระทบยอด) ไม่แตะ
  END IF;
  SELECT max(valuation_date) INTO v_latest FROM public.asset_valuations
   WHERE asset_id = p_entity AND deleted_at IS NULL AND date_trunc('month', valuation_date) = date_trunc('month', p_date);
  SELECT date, lump_from, lump_base INTO v_ld, v_from, v_base FROM public.expense_items
   WHERE pending_split AND deleted_at IS NULL AND lump_kind = 'BANK' AND paid_from_asset_id = p_entity
     AND date_trunc('month', date) = date_trunc('month', p_date);
  IF v_ld IS NULL THEN
    SELECT date, lump_from, lump_base INTO v_ld, v_from, v_base FROM public.income_transactions
     WHERE pending_split AND deleted_at IS NULL AND received_to_asset_id = p_entity AND date_trunc('month', date) = date_trunc('month', p_date);
  END IF;
  IF v_latest IS NULL THEN
    IF v_ld IS NOT NULL THEN PERFORM private.close_lumps('BANK', p_entity, p_date, true); END IF;   -- ไม่มียอดในเดือนแล้ว
    PERFORM private.restate_followers('BANK', p_entity, p_date);
    RETURN;
  END IF;
  IF v_ld IS NULL THEN
    SELECT anchor_date, anchor_value INTO v_from, v_base FROM private.bank_month_anchor(p_entity, date_trunc('month', p_date)::date);
    IF v_from IS NULL THEN SELECT stmt_date, stmt_value INTO v_from, v_base FROM private.statement_before('BANK', p_entity, v_latest); END IF;
  END IF;
  IF v_from IS NOT NULL AND v_from < v_latest THEN
    PERFORM private.set_bank_lump_at(p_entity, v_latest, v_from, v_base, private.lump_statement_target('BANK', p_entity, v_latest));
  END IF;
  PERFORM private.restate_followers('BANK', p_entity, p_date);
END $$;
REVOKE ALL ON FUNCTION private.restate_statement(text, uuid, date) FROM PUBLIC, anon, authenticated;

-- Trigger: แก้ยอด / วันที่ / ลบ ในตารางประวัติ (ทุกช่องทาง รวมฟอร์มบันทึกยอดวันที่เดิมซ้ำ)
CREATE OR REPLACE FUNCTION private.tg_statement_restate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_kind text := CASE TG_TABLE_NAME WHEN 'asset_valuations' THEN 'BANK' ELSE 'LIABILITY' END;
  v_e uuid; v_col text := CASE TG_TABLE_NAME WHEN 'asset_valuations' THEN 'value' ELSE 'balance' END;
BEGIN
  IF private.lump_busy() OR current_setting('fwv.restate', true) = 'on' THEN RETURN NULL; END IF;
  v_e := (to_jsonb(NEW)->>CASE v_kind WHEN 'BANK' THEN 'asset_id' ELSE 'liability_id' END)::uuid;
  IF v_kind = 'BANK' AND NOT private.is_bank_asset(v_e) THEN RETURN NULL; END IF;
  IF (to_jsonb(NEW)->>v_col) IS NOT DISTINCT FROM (to_jsonb(OLD)->>v_col) AND NEW.valuation_date = OLD.valuation_date
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
    RETURN NULL;                                                                     -- แก้แค่หมายเหตุ
  END IF;
  PERFORM set_config('fwv.restate', 'on', true);
  PERFORM private.restate_statement(v_kind, v_e, OLD.valuation_date);
  IF NEW.valuation_date <> OLD.valuation_date AND NEW.deleted_at IS NULL THEN
    PERFORM private.restate_statement(v_kind, v_e, NEW.valuation_date);
  END IF;
  PERFORM set_config('fwv.restate', 'off', true);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS a65_lump_restate ON public.asset_valuations;
CREATE TRIGGER a65_lump_restate AFTER UPDATE ON public.asset_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_statement_restate();
DROP TRIGGER IF EXISTS a65_lump_restate ON public.liability_valuations;
CREATE TRIGGER a65_lump_restate AFTER UPDATE ON public.liability_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_statement_restate();

-- 2) ยอดบัตรตาม Statement: ล็อกงวด (เหมือนยอดบัญชี / ยอดหนี้) -------------------------------------
DROP TRIGGER IF EXISTS t90_period_lock ON public.credit_card_statements;
CREATE TRIGGER t90_period_lock BEFORE INSERT OR UPDATE OR DELETE ON public.credit_card_statements
  FOR EACH ROW EXECUTE FUNCTION private.tg_period_lock('statement_date');

-- 3) Month Closing → Income & Expenses: ก้อนรอแยกของเดือน -----------------------------------------
DO $$
DECLARE d text;
  old_txt text := '''NOT_TRACKED'') <> ''COMPLETE'';';
  new_txt text := '''NOT_TRACKED'') <> ''COMPLETE'';
  -- ก้อนรอแยกรายละเอียดของเดือน (แยกได้แม้ปิดงวดแล้ว · เตือนเท่านั้น)
  RETURN QUERY
  SELECT ''INCOME_EXPENSES'', ''REVIEW'', ''PENDING_SPLIT'',
         ''ค่าใช้จ่ายรอแยกรายละเอียด '' || coalesce(a.name, concat_ws('' '', c.issuer, c.card_name), lb.name, '''') || '': ''
           || to_char(x.amount, ''FM999,999,999,990.00'') || '' '' || x.currency,
         ''PENDING_EXPENSE'', x.id
    FROM public.expense_items x
    JOIN public.monthly_expenses me2 ON me2.id = x.monthly_expense_id AND me2.family_id = p_family
    LEFT JOIN public.assets a ON a.id = x.paid_from_asset_id
    LEFT JOIN public.credit_cards c ON c.id = x.paid_from_credit_card_id
    LEFT JOIN public.liabilities lb ON lb.id = x.liability_id
   WHERE x.pending_split AND x.deleted_at IS NULL AND x.date BETWEEN m0 AND d;
  RETURN QUERY
  SELECT ''INCOME_EXPENSES'', ''REVIEW'', ''PENDING_SPLIT'',
         ''รายได้รอแยกรายละเอียด '' || coalesce(a.name, concat_ws('' '', c.issuer, c.card_name), lb.name, '''') || '': ''
           || to_char(y.amount, ''FM999,999,999,990.00'') || '' '' || y.currency,
         ''PENDING_INCOME'', y.id
    FROM public.income_transactions y
    LEFT JOIN public.assets a ON a.id = y.received_to_asset_id
    LEFT JOIN public.credit_cards c ON c.id = y.received_to_credit_card_id
    LEFT JOIN public.liabilities lb ON lb.id = y.received_to_liability_id
   WHERE y.family_id = p_family AND y.pending_split AND y.deleted_at IS NULL AND y.date BETWEEN m0 AND d;';
BEGIN
  d := pg_get_functiondef('private.month_closing_issues(uuid, date)'::regprocedure);
  IF position('PENDING_SPLIT' IN d) > 0 THEN RETURN; END IF;                   -- รันซ้ำ
  IF (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 THEN
    RAISE EXCEPTION 'month_closing_issues: ไม่พบจุดที่ต้องแก้ (ค่าใช้จ่ายเดือนนี้)';
  END IF;
  EXECUTE replace(d, old_txt, new_txt);
END $$;
