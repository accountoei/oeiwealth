-- =====================================================================
-- เลื่อน Go-live ไปช้าลง = ใช้ยอดตามระบบเป็นยอดตั้งต้นใหม่ + ปุ่มยกเลิก Go-live
--
-- 1) public.change_go_live_date(p_new_date) — เลื่อนช้าลง (ก่อน Confirm / หลังยกเลิก Go-live)
--    ยอดตั้งต้นใหม่ = ยอด ณ สิ้นวันก่อน Go-live ใหม่ ตามสูตรเดียวกับหน้า Net Worth:
--      บัญชีธนาคาร (ยอดล่าสุด + เข้า − ออก) · ทรัพย์สินอื่น (มูลค่าล่าสุด) · หนี้ (ยอดล่าสุด − เงินต้นที่จ่าย)
--      หลักทรัพย์ (หน่วย + ต้นทุนเฉลี่ย → OPENING_BALANCE) · เงินสดในพอร์ต · เงินให้กู้ (เงินต้นคงเหลือ) · บัตร (ยอด + รายการบัตร)
--    แถวยอดตั้งต้นเดิมย้ายวันที่ + ใส่ยอดใหม่ (ค่าเดิมอยู่ใน Audit Log) · รายการที่ลงไว้ก่อนวันใหม่ไม่เปลี่ยน = รายการก่อน Go-live
--    รายการที่ไม่มีอะไรเปลี่ยนตั้งแต่ยอดตั้งต้น (และไม่ได้ลงวันก่อน Go-live เดิม) ไม่แตะ
--    เลื่อนเร็วขึ้น: เหมือนเดิม (ย้ายวันที่ของยอดตั้งต้น ตัวเลขเท่าเดิม)
-- 2) public.cancel_go_live(p_reason) — ADMIN · ต้อง Reopen ทุกเดือนก่อน · สถานะกลับเป็น SETUP
--    Snapshot ที่ Reopen แล้ว (DRAFT) ลบแบบ soft delete · ล้างยอดสิ้นเดือนอัตโนมัติ · Audit CANCEL_GO_LIVE
-- 3) Readiness: รายการลงวันที่ก่อน Go-live = "ควรตรวจ" สรุปบรรทัดเดียวต่อประเภท (ไม่บล็อก Confirm)
--    ระบบนับยอดจากยอดตั้งต้นเสมอ (รายการก่อนยอดตั้งต้นไม่ถูกนับซ้ำ)
-- 4) แถวประวัติก่อน Go-live (มูลค่า / ยอดหนี้ / รายการพอร์ต) ลบหรือแก้หมายเหตุได้ระหว่าง SETUP (วันที่ต้องไม่เปลี่ยน)
-- รันซ้ำได้
-- =====================================================================

-- ---------- Audit action ใหม่ ----------
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (action = ANY (ARRAY[
  'CREATE','UPDATE','DELETE','RESTORE','VIEW_SENSITIVE','VIEW_DOCUMENT','DOWNLOAD_DOCUMENT','EXPORT','LOGIN',
  'INVITE_USER','DISABLE_USER','ENABLE_USER','CHANGE_ROLE','FX_OVERRIDE','FINALIZE_MONTH','REOPEN_MONTH',
  'CONFIRM_GO_LIVE','EDIT_OPENING_POSITION','SET_SENSITIVE','HARD_DELETE','CANCEL_GO_LIVE']));

-- ---------- แถวประวัติก่อน Go-live: แก้ / ลบได้ ถ้าวันที่ไม่เปลี่ยน ----------
CREATE OR REPLACE FUNCTION private.tg_asset_valuation_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.assets; v_go_live date;
BEGIN
  SELECT * INTO a FROM public.assets WHERE id = NEW.asset_id;
  SELECT go_live_date INTO v_go_live FROM public.families WHERE id = a.family_id;
  IF a.asset_type IN ('INVESTMENT_PORTFOLIO','LOAN_RECEIVABLE') THEN
    RAISE EXCEPTION 'INVALID: มูลค่า % คำนวณจาก Holding / Movement ไม่ใช้ asset_valuations', a.asset_type
      USING ERRCODE = '22023';
  END IF;
  IF NEW.valuation_date > current_date THEN
    RAISE EXCEPTION 'INVALID: วันที่ของยอดเป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF NEW.is_opening AND NEW.valuation_date >= v_go_live THEN
    RAISE EXCEPTION 'INVALID_OPENING: ยอดตั้งต้นต้องลงวันที่ก่อน Go-live (%)', v_go_live USING ERRCODE = '22023';
  END IF;
  IF NOT NEW.is_opening AND NEW.valuation_date < v_go_live
     AND NOT (TG_OP = 'UPDATE' AND NOT OLD.is_opening AND OLD.valuation_date = NEW.valuation_date) THEN   -- ประวัติก่อน Go-live (เลื่อน Go-live)
    RAISE EXCEPTION 'BEFORE_GO_LIVE: มูลค่าก่อน Go-live ต้องเป็นยอดตั้งต้น (is_opening)' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.tg_liability_valuation_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_go_live date;
BEGIN
  SELECT f.go_live_date INTO v_go_live FROM public.liabilities l JOIN public.families f ON f.id = l.family_id
   WHERE l.id = NEW.liability_id;
  IF NEW.valuation_date > current_date THEN
    RAISE EXCEPTION 'INVALID: วันที่ของยอดเป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF NEW.is_opening AND NEW.valuation_date >= v_go_live THEN
    RAISE EXCEPTION 'INVALID_OPENING: ยอดตั้งต้นต้องลงวันที่ก่อน Go-live (%)', v_go_live USING ERRCODE = '22023';
  END IF;
  IF NOT NEW.is_opening AND NEW.valuation_date < v_go_live
     AND NOT (TG_OP = 'UPDATE' AND NOT OLD.is_opening AND OLD.valuation_date = NEW.valuation_date) THEN   -- ประวัติก่อน Go-live (เลื่อน Go-live)
    RAISE EXCEPTION 'BEFORE_GO_LIVE: ยอดก่อน Go-live ต้องเป็นยอดตั้งต้น (is_opening)' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

DO $mig$
DECLARE v_def text; v_old text; v_new text;
BEGIN
  v_def := replace(pg_get_functiondef('private.tg_itx_check()'::regprocedure), E'\r', '');
  v_old := replace($o$  ELSIF NEW.transaction_date < v_go_live THEN
    RAISE EXCEPTION 'BEFORE_GO_LIVE: รายการก่อน Go-live ต้องเป็น OPENING_BALANCE' USING ERRCODE = '22023';$o$, E'\r', '');
  v_new := replace($n$  ELSIF NEW.transaction_date < v_go_live
        AND NOT (TG_OP = 'UPDATE' AND OLD.transaction_type <> 'OPENING_BALANCE'                 -- ประวัติก่อน Go-live (เลื่อน Go-live)
                 AND OLD.transaction_date = NEW.transaction_date AND OLD.transaction_type = NEW.transaction_type) THEN
    RAISE EXCEPTION 'BEFORE_GO_LIVE: รายการก่อน Go-live ต้องเป็น OPENING_BALANCE' USING ERRCODE = '22023';$n$, E'\r', '');
  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'tg_itx_check: ไม่พบจุดที่จะแก้'; END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END IF;
END $mig$;

-- ---------- LIVE → SETUP ได้เฉพาะผ่าน cancel_go_live ----------
CREATE OR REPLACE FUNCTION private.tg_families_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.system_status = 'LIVE' AND (NEW.go_live_date IS DISTINCT FROM OLD.go_live_date
                                     OR NEW.base_currency IS DISTINCT FROM OLD.base_currency) THEN
    RAISE EXCEPTION 'GO_LIVE_LOCKED: หลัง LIVE แก้ Go-live Date / Base Currency ไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF OLD.system_status = 'LIVE' AND NEW.system_status = 'SETUP'
     AND current_setting('fwv.cancel_go_live', true) IS DISTINCT FROM 'on' THEN   -- ตั้งเฉพาะใน cancel_go_live
    RAISE EXCEPTION 'GO_LIVE_LOCKED: ย้อนสถานะเป็น SETUP ไม่ได้ (ใช้ปุ่มยกเลิก Go-live)' USING ERRCODE = '42501';
  END IF;
  IF private.is_client() AND NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: แก้ข้อมูลครอบครัวได้เฉพาะ ADMIN' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- ---------- Readiness: รายการก่อน Go-live = ควรตรวจ (บรรทัดเดียวต่อประเภท) ----------
DO $mig$
DECLARE v_def text; i int; j int; v_end text; v_new text;
BEGIN
  v_def := replace(pg_get_functiondef('private.go_live_readiness(uuid)'::regprocedure), E'\r', '');
  IF position('BEFORE_GO_LIVE' IN v_def) > 0 THEN RETURN; END IF;
  i := position('  -- รายการที่ลงวันที่ก่อน Go-live (นับซ้ำกับยอดตั้งต้น)' IN v_def);
  v_end := 'AND t.transaction_date < f.go_live_date) x;';
  j := position(v_end IN v_def);
  IF i = 0 OR j = 0 OR j < i THEN RAISE EXCEPTION 'go_live_readiness: ไม่พบจุดที่จะแก้'; END IF;
  v_new := $n$  -- รายการที่ลงวันที่ก่อน Go-live = ประวัติ: ระบบนับยอดจากยอดตั้งต้นเสมอ (รายการก่อนหน้านั้นไม่ถูกนับซ้ำ) → ควรตรวจ ไม่บล็อก
  RETURN QUERY
  SELECT 'SYSTEM', 'BEFORE_GO_LIVE', NULL::uuid, x.t || ' ก่อน Go-live ' || count(*)::text || ' รายการ', NULL::text, NULL::numeric, max(x.d), 'WARN',
         'เป็นประวัติ ไม่รวมในยอดหลัง Go-live (ยอดตั้งต้นรวมไว้แล้ว) · หลัง Confirm แก้ / ลบไม่ได้'
    FROM (SELECT 'รายการเงินเข้า–ออก' AS t, m.movement_date AS d FROM public.cash_movements m
           WHERE m.family_id = p_family AND m.deleted_at IS NULL AND m.movement_date < f.go_live_date
          UNION ALL
          SELECT 'รายได้', i.date FROM public.income_transactions i
           WHERE i.family_id = p_family AND i.deleted_at IS NULL AND i.date < f.go_live_date
          UNION ALL
          SELECT 'ค่าใช้จ่าย', e.date FROM public.expense_items e
           WHERE e.deleted_at IS NULL AND e.date < f.go_live_date
          UNION ALL
          SELECT 'รายการพอร์ต', t.transaction_date FROM public.investment_transactions t
           WHERE t.deleted_at IS NULL AND t.transaction_type <> 'OPENING_BALANCE' AND t.transaction_date < f.go_live_date) x
   GROUP BY x.t;$n$;
  v_def := substr(v_def, 1, i - 1) || v_new || substr(v_def, j + length(v_end));
  -- Holding ที่ยังไม่มีรายการเลย (เช่น บัญชีเงินฝากในพอร์ตที่สร้างหลัง Go-live) = ไม่ต้องมียอดตั้งต้น
  v_def := replace(v_def, $o$WHEN first_tx.transaction_date >= f.go_live_date THEN 'NOT_REQUIRED'$o$,
                          $n$WHEN coalesce(first_tx.transaction_date, f.go_live_date) >= f.go_live_date THEN 'NOT_REQUIRED'$n$);
  v_def := replace(v_def, $o$WHEN ob.id IS NULL AND coalesce(first_tx.transaction_date, f.go_live_date - 1) < f.go_live_date$o$,
                          $n$WHEN ob.id IS NULL AND coalesce(first_tx.transaction_date, f.go_live_date) < f.go_live_date$n$);
  EXECUTE v_def;
END $mig$;

-- ---------- สัดส่วนต้นทุนบาท / ต้นทุนสกุล Holding ณ วันที่ (สูตรเดียวกับ investment_returns) ----------
CREATE OR REPLACE FUNCTION private.holding_cost_thb_ratio(p_holding uuid, p_upto date)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.investment_transactions; q numeric := 0; c_loc numeric := 0; c_thb numeric := 0; v_rate numeric; v_sold numeric;
BEGIN
  FOR t IN SELECT * FROM public.investment_transactions x WHERE x.holding_id = p_holding AND x.deleted_at IS NULL
              AND x.transaction_date <= p_upto ORDER BY x.transaction_date, x.created_at
  LOOP
    v_rate := CASE WHEN t.currency = 'THB' THEN 1
                   ELSE coalesce(t.amount_base_currency / nullif(t.amount, 0), private.fx_rate(t.currency, t.transaction_date), 0) END;
    CASE t.transaction_type
      WHEN 'OPENING_BALANCE' THEN
        q := coalesce(t.quantity, 0); c_loc := t.amount; c_thb := coalesce(t.cost_base_currency, t.amount * v_rate);
      WHEN 'BUY' THEN
        q := q + coalesce(t.quantity, 0); c_loc := c_loc + t.amount + coalesce(t.fee, 0);
        c_thb := c_thb + coalesce(t.cost_base_currency, (t.amount + coalesce(t.fee, 0)) * v_rate);
      WHEN 'SELL', 'REDEMPTION', 'MATURITY' THEN
        v_sold := CASE WHEN t.transaction_type = 'MATURITY' OR t.quantity IS NULL THEN q ELSE least(t.quantity, q) END;
        IF q > 0 THEN c_loc := c_loc - c_loc / q * v_sold; c_thb := c_thb - c_thb / q * v_sold; END IF;
        q := q - v_sold;
      ELSE NULL;
    END CASE;
  END LOOP;
  RETURN CASE WHEN c_loc > 0 AND c_thb > 0 THEN c_thb / c_loc END;
END $$;
REVOKE ALL ON FUNCTION private.holding_cost_thb_ratio(uuid, date) FROM PUBLIC, anon, authenticated;

-- ---------- เปลี่ยนวัน Go-live ----------
CREATE OR REPLACE FUNCTION public.change_go_live_date(p_new_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid; f public.families;
  v_old date; v_old_open date; v_new_open date; v_lo date; v_hi date;
  v_later boolean; v_n int; v_moved jsonb; v_issues text[] := '{}'; v_has_open boolean;
  c_av int := 0; c_lv int := 0; c_ob int := 0; c_iv int := 0; c_loan int := 0; c_card int := 0; c_stmt int := 0; c_own int := 0;
  -- เลื่อนช้าลง
  v_note text; v_val numeric; v_qty numeric; v_price numeric; v_cost numeric; v_ratio numeric; v_fx numeric; v_id uuid; v_roll boolean;
  ra record; rl record; rh record; rd record; rc record; hv record;
  va public.asset_valuations; vo public.asset_valuations;
  la public.liability_valuations; lo public.liability_valuations;
  ob public.investment_transactions;
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
  v_has_open := EXISTS (SELECT 1 FROM public.asset_valuations v JOIN public.assets a ON a.id = v.asset_id
                         WHERE a.family_id = f.id AND v.deleted_at IS NULL AND v.is_opening)
             OR EXISTS (SELECT 1 FROM public.liability_valuations v JOIN public.liabilities l ON l.id = v.liability_id
                         WHERE l.family_id = f.id AND v.deleted_at IS NULL AND v.is_opening)
             OR EXISTS (SELECT 1 FROM public.investment_transactions t WHERE t.deleted_at IS NULL AND t.transaction_type = 'OPENING_BALANCE');

  IF v_later THEN
    -- วันตั้งต้นใหม่ยังไม่ถึง → คำนวณยอด ณ วันนั้นไม่ได้
    IF v_new_open > current_date AND v_has_open THEN
      v_issues := v_issues || format('ยอดตั้งต้นต้องลงวันที่ %s ซึ่งยังไม่ถึง — เปลี่ยนเป็นวันนี้ได้ตั้งแต่วันที่ %s หรือกำหนดวันนี้ตอนตั้งระบบใหม่ (Bootstrap)',
                                     to_char(v_new_open, 'DD/MM/YYYY'), to_char(v_new_open, 'DD/MM/YYYY'));
    END IF;
    -- เงินสดในพอร์ตติดลบ ณ วันตั้งต้นใหม่ (ยอดตั้งต้นติดลบไม่ได้)
    IF v_new_open <= current_date THEN
      FOR rh IN SELECT x.id, a.name || ' · ' || x.name AS nm FROM public.investment_holdings x
                 JOIN public.investment_portfolios p ON p.id = x.portfolio_id AND p.deleted_at IS NULL
                 JOIN public.assets a ON a.id = p.asset_id AND a.deleted_at IS NULL AND a.family_id = f.id
                WHERE x.deleted_at IS NULL AND x.status = 'ACTIVE' AND x.holding_type = 'CASH'
      LOOP
        SELECT * INTO hv FROM private.holding_value_at(rh.id, v_new_open);
        IF hv.value < 0 THEN
          v_issues := v_issues || format('เงินสดในพอร์ต %s ติดลบ ณ วันที่ %s — แก้รายการให้ยอดไม่ติดลบก่อน', rh.nm, to_char(v_new_open, 'DD/MM/YYYY'));
        END IF;
      END LOOP;
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.bank_reconciliations r JOIN public.assets a ON a.id = r.bank_asset_id
                WHERE a.family_id = f.id AND r.deleted_at IS NULL) THEN
      v_issues := v_issues || 'มีการกระทบยอดบัญชีธนาคารแล้ว';
    END IF;
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
    -- เปลี่ยนเจ้าของระหว่างสองวัน (นอกจากแถวที่เริ่มวันตั้งต้นเดิม ซึ่งย้ายให้)
    IF EXISTS (SELECT 1 FROM public.asset_ownerships o JOIN public.assets a ON a.id = o.asset_id
                WHERE a.family_id = f.id AND o.deleted_at IS NULL
                  AND ((o.start_date > v_lo - 1 AND o.start_date <= v_hi - 1 AND o.start_date <> v_old_open)
                    OR (o.end_date >= v_lo - 1 AND o.end_date < v_hi - 1))) THEN
      v_issues := v_issues || format('มีการเปลี่ยนเจ้าของทรัพย์สินระหว่าง %s ถึง %s — แก้ประวัติเจ้าของก่อน',
                                     to_char(v_lo - 1, 'DD/MM/YYYY'), to_char(v_hi - 1, 'DD/MM/YYYY'));
    END IF;
    -- วันตั้งต้นใหม่อยู่ในอนาคต แต่มียอดตั้งต้นแล้ว (ระบบไม่รับยอดลงวันในอนาคต)
    IF v_new_open > current_date AND v_has_open THEN
      v_issues := v_issues || format('ยอดตั้งต้นต้องลงวันที่ %s ซึ่งยังไม่ถึง — เปลี่ยนเป็นวันนี้ได้ตั้งแต่วันที่ %s หรือกำหนดวันนี้ตอนตั้งระบบใหม่ (Bootstrap)',
                                     to_char(v_new_open, 'DD/MM/YYYY'), to_char(v_new_open, 'DD/MM/YYYY'));
    END IF;
  END IF;

  IF array_length(v_issues, 1) > 0 THEN
    RAISE EXCEPTION 'GO_LIVE_CHANGE_BLOCKED: %', array_to_string(v_issues, ' · ') USING ERRCODE = '22023';
  END IF;

  -- ---------- เปลี่ยน ----------
  -- ไม่ให้ระบบสร้าง "ก้อนรอแยกรายละเอียด" จากการตั้งยอดตั้งต้นใหม่ (ไม่ใช่การอัปเดตยอดจริง)
  PERFORM set_config('fwv.restate', 'on', true);
  UPDATE public.families SET go_live_date = p_new_date WHERE id = f.id;

  IF v_later AND v_new_open <= current_date THEN
    -- ===== เลื่อนช้าลง: ยอดตั้งต้นใหม่ = ยอดตามระบบ ณ สิ้นวันก่อน Go-live ใหม่ =====
    v_note := format('ยอดตั้งต้นจากยอดตามระบบ ณ สิ้นวัน %s (เลื่อน Go-live)', to_char(v_new_open, 'DD/MM/YYYY'));

    -- A) บัญชีธนาคาร / ทรัพย์สินที่มีมูลค่า
    FOR ra IN SELECT x.id, private.is_bank_asset(x.id) AS bank FROM public.assets x
              WHERE x.family_id = f.id AND x.deleted_at IS NULL AND x.status = 'ACTIVE'
                AND x.asset_type NOT IN ('INVESTMENT_PORTFOLIO','LOAN_RECEIVABLE')
                AND (x.acquisition_date IS NULL OR x.acquisition_date < p_new_date)
    LOOP
      va := private.latest_asset_valuation(ra.id, v_new_open);
      CONTINUE WHEN va.id IS NULL;
      v_val := CASE WHEN ra.bank THEN private.bank_calculated_balance(ra.id, v_new_open) ELSE va.value END;
      SELECT * INTO vo FROM public.asset_valuations x WHERE x.asset_id = ra.id AND x.is_opening AND x.deleted_at IS NULL;
      IF vo.id IS NULL THEN
        INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening, notes)
        VALUES (ra.id, v_new_open, v_val, CASE WHEN ra.bank THEN 'STATEMENT' ELSE va.valuation_method END, 'OPENING', true, v_note);
        c_av := c_av + 1;
      ELSIF vo.valuation_date >= v_old_open OR v_val IS DISTINCT FROM vo.value OR va.id <> vo.id
         OR (ra.bank AND EXISTS (SELECT 1 FROM private.bank_movement_effects(ra.id, vo.valuation_date, v_new_open) e
                                 WHERE e.inflow <> 0 OR e.outflow <> 0)) THEN
        UPDATE public.asset_valuations SET valuation_date = v_new_open, value = v_val,
               notes = CASE WHEN v_val IS DISTINCT FROM vo.value THEN concat_ws(' · ', nullif(vo.notes, ''), v_note) ELSE vo.notes END
         WHERE id = vo.id;
        c_av := c_av + 1;
      END IF;
    END LOOP;

    -- B) หนี้สิน
    FOR rl IN SELECT x.id FROM public.liabilities x
              WHERE x.family_id = f.id AND x.deleted_at IS NULL AND x.status = 'ACTIVE'
                AND (x.start_date IS NULL OR x.start_date < p_new_date)
    LOOP
      SELECT * INTO la FROM public.liability_valuations x
       WHERE x.liability_id = rl.id AND x.deleted_at IS NULL AND x.valuation_date <= v_new_open
       ORDER BY x.valuation_date DESC, x.created_at DESC LIMIT 1;
      CONTINUE WHEN la.id IS NULL;
      v_val := greatest(la.balance - private.liability_principal_paid(rl.id, la.valuation_date, v_new_open), 0);
      SELECT * INTO lo FROM public.liability_valuations x WHERE x.liability_id = rl.id AND x.is_opening AND x.deleted_at IS NULL;
      CONTINUE WHEN lo.id IS NOT NULL AND lo.valuation_date < v_old_open AND v_val = lo.balance AND la.id = lo.id;
      CONTINUE WHEN lo.id IS NOT NULL AND lo.valuation_date = v_new_open AND v_val = lo.balance;
      SELECT x.id INTO v_id FROM public.liability_valuations x
       WHERE x.liability_id = rl.id AND x.deleted_at IS NULL AND x.valuation_date = v_new_open AND NOT x.is_opening;
      IF v_id IS NOT NULL THEN                       -- มียอดของวันนั้นอยู่แล้ว → ใช้แถวนั้นเป็นยอดตั้งต้น
        IF lo.id IS NOT NULL THEN UPDATE public.liability_valuations SET deleted_at = now() WHERE id = lo.id; END IF;
        UPDATE public.liability_valuations SET is_opening = true, source = 'OPENING', balance = v_val WHERE id = v_id;
      ELSIF lo.id IS NOT NULL THEN
        UPDATE public.liability_valuations SET valuation_date = v_new_open, balance = v_val,
               notes = CASE WHEN v_val IS DISTINCT FROM lo.balance THEN concat_ws(' · ', nullif(lo.notes, ''), v_note) ELSE lo.notes END
         WHERE id = lo.id;
      ELSE
        INSERT INTO public.liability_valuations(liability_id, valuation_date, balance, source, is_opening, notes)
        VALUES (rl.id, v_new_open, v_val, 'OPENING', true, v_note);
      END IF;
      c_lv := c_lv + 1;
    END LOOP;

    -- C) พอร์ต: หลักทรัพย์ (หน่วย + ต้นทุนเฉลี่ย) · เงินสดในพอร์ต
    FOR rh IN SELECT x.* FROM public.investment_holdings x
               JOIN public.investment_portfolios p ON p.id = x.portfolio_id AND p.deleted_at IS NULL
               JOIN public.assets a ON a.id = p.asset_id AND a.deleted_at IS NULL AND a.family_id = f.id
              WHERE x.deleted_at IS NULL AND x.status = 'ACTIVE'
    LOOP
      SELECT * INTO hv FROM private.holding_value_at(rh.id, v_new_open);
      SELECT * INTO ob FROM public.investment_transactions t
       WHERE t.holding_id = rh.id AND t.transaction_type = 'OPENING_BALANCE' AND t.deleted_at IS NULL
       ORDER BY t.transaction_date DESC, t.created_at DESC LIMIT 1;
      IF rh.holding_type = 'CASH' THEN
        v_qty := coalesce(hv.value, 0); v_price := 1;
        CONTINUE WHEN ob.id IS NULL AND v_qty = 0 AND NOT EXISTS (SELECT 1 FROM public.investment_transactions t
                                                                   WHERE t.holding_id = rh.id AND t.deleted_at IS NULL AND t.transaction_date <= v_new_open);
        v_roll := ob.id IS NULL OR ob.transaction_date >= v_old_open OR v_qty IS DISTINCT FROM ob.quantity::numeric
               OR EXISTS (SELECT 1 FROM public.investment_valuations x WHERE x.holding_id = rh.id AND x.deleted_at IS NULL
                           AND x.valuation_date > ob.transaction_date AND x.valuation_date <= v_new_open);
      ELSE
        CONTINUE WHEN ob.id IS NULL AND NOT EXISTS (SELECT 1 FROM public.investment_transactions t WHERE t.holding_id = rh.id
                                                     AND t.deleted_at IS NULL AND t.transaction_date <= v_new_open);
        v_qty := coalesce(hv.quantity, 0); v_price := coalesce(hv.average_cost, 0);
        v_roll := ob.id IS NULL OR ob.transaction_date >= v_old_open
               OR EXISTS (SELECT 1 FROM public.investment_transactions t WHERE t.holding_id = rh.id AND t.deleted_at IS NULL
                           AND t.transaction_type <> 'OPENING_BALANCE'
                           AND t.transaction_date >= ob.transaction_date AND t.transaction_date <= v_new_open);
      END IF;
      CONTINUE WHEN NOT v_roll;

      -- ต้นทุนบาท (สกุลต่างประเทศ): หลักทรัพย์ใช้สัดส่วนต้นทุนเดิม · เงินสดใช้อัตรา ณ วันตั้งต้น
      v_cost := NULL; v_fx := NULL;
      IF rh.currency <> 'THB' THEN
        v_ratio := CASE WHEN rh.holding_type = 'CASH' THEN NULL ELSE private.holding_cost_thb_ratio(rh.id, v_new_open) END;
        v_ratio := coalesce(v_ratio, private.fx_rate(rh.currency, v_new_open));
        IF v_ratio IS NULL THEN
          RAISE EXCEPTION 'GO_LIVE_CHANGE_BLOCKED: ไม่มีอัตราแลกเปลี่ยน % ถึงวันที่ % (ต้องใช้คิดต้นทุนบาทของ %)',
            rh.currency, to_char(v_new_open, 'DD/MM/YYYY'), rh.name USING ERRCODE = '22023';
        END IF;
        v_cost := round(round(v_qty * v_price, 4) * v_ratio, 4);
        v_fx := CASE WHEN round(v_qty * v_price, 4) > 0 THEN round(v_ratio, 10) END;
      END IF;

      -- ราคา / Statement ณ วันตั้งต้นเดิม → ย้ายมาวันตั้งต้นใหม่ (ถ้าไม่มีราคาที่ใหม่กว่า)
      IF ob.id IS NOT NULL THEN
        UPDATE public.investment_valuations iv SET valuation_date = v_new_open,
               quantity = CASE WHEN rh.holding_type = 'CASH' THEN v_qty ELSE iv.quantity END,
               market_value = CASE WHEN rh.holding_type = 'CASH' THEN v_qty ELSE iv.market_value END
         WHERE iv.holding_id = rh.id AND iv.deleted_at IS NULL AND iv.valuation_date = ob.transaction_date
           AND iv.valuation_date < v_new_open
           AND NOT EXISTS (SELECT 1 FROM public.investment_valuations x WHERE x.holding_id = rh.id AND x.deleted_at IS NULL
                            AND x.valuation_date > ob.transaction_date AND x.valuation_date <= v_new_open);
        GET DIAGNOSTICS v_n = ROW_COUNT; c_iv := c_iv + v_n;
      END IF;
      -- เงินสดที่มี Statement ก่อนหน้า: ใส่ยอด ณ วันตั้งต้นใหม่ (ไม่งั้น Statement เก่าจะเป็นฐานแทนยอดตั้งต้น)
      IF rh.holding_type = 'CASH'
         AND EXISTS (SELECT 1 FROM public.investment_valuations x WHERE x.holding_id = rh.id AND x.deleted_at IS NULL AND x.valuation_date < v_new_open)
         AND NOT EXISTS (SELECT 1 FROM public.investment_valuations x WHERE x.holding_id = rh.id AND x.deleted_at IS NULL AND x.valuation_date = v_new_open) THEN
        INSERT INTO public.investment_valuations(holding_id, valuation_date, price, quantity, market_value, source)
        VALUES (rh.id, v_new_open, 1, v_qty, v_qty, 'USER');
        c_iv := c_iv + 1;
      END IF;

      IF ob.id IS NOT NULL THEN
        UPDATE public.investment_transactions SET transaction_date = v_new_open, quantity = v_qty, price = v_price,
               cost_base_currency = v_cost, actual_fx_rate = v_fx,
               notes = CASE WHEN v_qty IS DISTINCT FROM ob.quantity::numeric OR v_price IS DISTINCT FROM ob.price::numeric
                            THEN concat_ws(' · ', nullif(ob.notes, ''), v_note) ELSE ob.notes END
         WHERE id = ob.id;
      ELSE
        INSERT INTO public.investment_transactions(portfolio_id, holding_id, transaction_date, transaction_type, quantity, price,
                                                   currency, cost_base_currency, actual_fx_rate, notes)
        VALUES (rh.portfolio_id, rh.id, v_new_open, 'OPENING_BALANCE', v_qty, v_price, rh.currency, v_cost, v_fx, v_note);
      END IF;
      c_ob := c_ob + 1;
    END LOOP;

    -- D) เงินให้กู้: เงินต้นคงเหลือ ณ วันตั้งต้นใหม่
    FOR rd IN SELECT ld.id, ld.asset_id, ld.opening_date, ld.opening_outstanding_principal AS opening FROM public.loan_details ld
               JOIN public.assets a ON a.id = ld.asset_id AND a.family_id = f.id AND a.deleted_at IS NULL
              WHERE ld.deleted_at IS NULL AND ld.status IN ('ACTIVE','AT_RISK') AND ld.opening_date < v_new_open
    LOOP
      v_val := greatest(private.loan_outstanding_at(rd.asset_id, v_new_open), 0);
      CONTINUE WHEN rd.opening_date < v_old_open AND v_val = rd.opening;
      UPDATE public.loan_details SET opening_date = v_new_open, opening_outstanding_principal = v_val WHERE id = rd.id;
      c_loan := c_loan + 1;
    END LOOP;

    -- E) บัตรเครดิต: ยอด + รายการบัตรถึงวันตั้งต้นใหม่
    FOR rc IN SELECT x.id, x.outstanding_balance, x.balance_date FROM public.credit_cards x
               JOIN public.persons p ON p.id = x.person_id AND p.family_id = f.id
              WHERE x.deleted_at IS NULL AND x.balance_date IS NOT NULL AND x.balance_date < v_new_open
    LOOP
      v_val := private.card_activity(rc.id, rc.balance_date, v_new_open);
      CONTINUE WHEN rc.balance_date < v_old_open AND v_val = 0;
      IF v_val = 0 THEN                              -- ยอดเท่าเดิม: ย้ายประวัติยอดวันนั้นไปด้วย (ไม่สร้างแถวซ้ำ)
        UPDATE public.credit_card_statements s SET statement_date = v_new_open
         WHERE s.credit_card_id = rc.id AND s.deleted_at IS NULL AND s.statement_date = rc.balance_date
           AND NOT EXISTS (SELECT 1 FROM public.credit_card_statements x WHERE x.credit_card_id = rc.id
                            AND x.deleted_at IS NULL AND x.statement_date = v_new_open);
        GET DIAGNOSTICS v_n = ROW_COUNT; c_stmt := c_stmt + v_n;
      END IF;
      UPDATE public.credit_cards SET outstanding_balance = greatest(coalesce(rc.outstanding_balance, 0) + v_val, 0),
             balance_date = v_new_open WHERE id = rc.id;
      c_card := c_card + 1;
    END LOOP;
    -- เจ้าของ: ไม่ต้องย้าย (คำนวณสัดส่วน ณ วันตั้งต้นใหม่จากประวัติอยู่แล้ว)

  ELSE
    -- ===== เลื่อนเร็วขึ้น (หรือวันตั้งต้นใหม่ยังไม่ถึงและยังไม่มียอดตั้งต้น): ย้ายวันที่ ตัวเลขเท่าเดิม =====
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
  END IF;

  PERFORM set_config('fwv.restate', 'off', true);

  v_moved := jsonb_build_object('asset_valuations', c_av, 'liability_valuations', c_lv, 'investment_opening', c_ob,
    'investment_prices', c_iv, 'loans', c_loan, 'card_statements', c_stmt, 'cards', c_card, 'ownerships', c_own);
  PERFORM private.write_audit('EDIT_OPENING_POSITION', 'families', f.id::text,
          jsonb_build_object('kind', 'CHANGE_GO_LIVE_DATE', 'from', v_old, 'to', p_new_date, 'moved', v_moved,
                             'mode', CASE WHEN v_later AND v_new_open <= current_date THEN 'ROLL_FORWARD' ELSE 'MOVE' END),
          f.id, 'go_live_date');
  RETURN jsonb_build_object('go_live_date', p_new_date, 'changed', true, 'from', v_old, 'moved', v_moved,
                            'mode', CASE WHEN v_later AND v_new_open <= current_date THEN 'ROLL_FORWARD' ELSE 'MOVE' END);
END $$;

REVOKE ALL ON FUNCTION public.change_go_live_date(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_go_live_date(date) TO authenticated, service_role;

-- ---------- ยกเลิก Go-live ----------
CREATE OR REPLACE FUNCTION public.cancel_go_live(p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid; f public.families; v_final int; v_draft int; v_auto int;
BEGIN
  v_uid := private.require_role('ADMIN');
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: ยกเลิก Go-live ต้องระบุเหตุผล' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO f FROM public.families WHERE id = private.default_family_id() FOR UPDATE;
  IF f.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบข้อมูลครอบครัว' USING ERRCODE = 'P0002'; END IF;
  IF f.system_status <> 'LIVE' THEN
    RAISE EXCEPTION 'INVALID: ระบบยังไม่ได้ Go-live' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_final FROM public.net_worth_snapshots s
   WHERE s.family_id = f.id AND s.deleted_at IS NULL AND s.status = 'FINAL';
  IF v_final > 0 THEN
    RAISE EXCEPTION 'GO_LIVE_CANCEL_BLOCKED: ยังมีเดือนที่ปิดอยู่ % เดือน — Reopen ทุกเดือนก่อน (ไล่จากเดือนล่าสุด)', v_final
      USING ERRCODE = '22023';
  END IF;

  -- Snapshot ที่ Reopen แล้ว (DRAFT) ไม่ใช้อีก → soft delete (ปิดเดือนใหม่หลัง Confirm ครั้งถัดไป)
  UPDATE public.net_worth_snapshots SET deleted_at = now()
   WHERE family_id = f.id AND deleted_at IS NULL AND status = 'DRAFT';
  GET DIAGNOSTICS v_draft = ROW_COUNT;
  DELETE FROM public.net_worth_month_auto WHERE family_id = f.id;
  GET DIAGNOSTICS v_auto = ROW_COUNT;

  PERFORM set_config('fwv.cancel_go_live', 'on', true);
  UPDATE public.families SET system_status = 'SETUP', go_live_confirmed_at = NULL, go_live_confirmed_by = NULL WHERE id = f.id;
  PERFORM set_config('fwv.cancel_go_live', 'off', true);

  PERFORM private.write_audit('CANCEL_GO_LIVE', 'families', f.id::text,
          jsonb_build_object('go_live_date', f.go_live_date, 'reason', p_reason, 'confirmed_at', f.go_live_confirmed_at,
                             'confirmed_by', f.go_live_confirmed_by, 'drafts_removed', v_draft, 'auto_months_removed', v_auto), f.id);
  RETURN jsonb_build_object('status', 'SETUP', 'go_live_date', f.go_live_date, 'drafts_removed', v_draft);
END $$;

REVOKE ALL ON FUNCTION public.cancel_go_live(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_go_live(text) TO authenticated, service_role;
