-- =====================================================================
-- 1300 Net Worth Engine + Views
--   ทุก View: WITH (security_invoker = true) (Section 6.4)
--   View ที่เรียก SECURITY DEFINER function ต้องกรอง private.has_role(...) เพิ่ม
--   เพื่อกันผู้ใช้ DISABLED ที่ยังถือ JWT อยู่
-- =====================================================================

-- ---------------------------------------------------------------------
-- สัดส่วนเจ้าของ ณ วันที่ (+ แถว Unallocated เมื่อไม่ครบ 100) — Section 8, 34
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.asset_owner_shares(p_asset uuid, p_date date)
RETURNS TABLE (person_id uuid, pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH o AS (
    SELECT x.person_id, sum(x.ownership_percent) AS pct
      FROM public.asset_ownerships x JOIN public.persons p ON p.id = x.person_id
     WHERE x.asset_id = p_asset AND x.deleted_at IS NULL AND p.deleted_at IS NULL
       AND x.start_date <= p_date AND (x.end_date IS NULL OR x.end_date >= p_date)
     GROUP BY x.person_id)
  SELECT o.person_id, o.pct FROM o
  UNION ALL
  SELECT NULL::uuid, 100 - coalesce((SELECT sum(o.pct) FROM o), 0)
   WHERE coalesce((SELECT sum(o.pct) FROM o), 0) < 100
$$;

CREATE OR REPLACE FUNCTION private.liability_owner_shares(p_liability uuid)
RETURNS TABLE (person_id uuid, pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH o AS (
    SELECT x.person_id, x.responsibility_percent AS pct
      FROM public.liability_ownerships x JOIN public.persons p ON p.id = x.person_id
     WHERE x.liability_id = p_liability AND x.deleted_at IS NULL AND p.deleted_at IS NULL)
  SELECT o.person_id, o.pct FROM o
  UNION ALL
  SELECT NULL::uuid, 100 - coalesce((SELECT sum(o.pct) FROM o), 0)
   WHERE coalesce((SELECT sum(o.pct) FROM o), 0) < 100
$$;

-- ---------------------------------------------------------------------
-- สถานะของแถว ณ เวลาในอดีต: ย้อน Audit Log (Immutable) จากค่าปัจจุบัน
--   ใช้ตอนปิดเดือนย้อนหลัง เช่น ยอดบัตร / สถานะสินทรัพย์ที่ถูกแก้หลังสิ้นเดือน
--   แถวที่สร้างหลังเวลานั้น (บันทึกย้อนหลัง) → ใช้สถานะตอนสร้าง; การมีอยู่ตัดสินจากวันที่ทางธุรกิจ
--   (valuation_date / balance_date) ไม่ใช่เวลาที่กรอก
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.row_state_at(p_table text, p_id uuid, p_current jsonb, p_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb := p_current; a record;
BEGIN
  FOR a IN SELECT l.action, l.metadata FROM public.audit_logs l
            WHERE l.entity_type = p_table AND l.entity_id = p_id::text AND l.event_at > p_at
              AND l.action IN ('CREATE','UPDATE','DELETE','RESTORE','EDIT_OPENING_POSITION')
            ORDER BY l.event_at DESC, l.id DESC
  LOOP
    IF a.action = 'CREATE' OR a.metadata #>> '{after,_op}' = 'CREATE' THEN RETURN r; END IF;
    IF a.metadata ? 'before' THEN r := r || (a.metadata -> 'before'); END IF;
  END LOOP;
  RETURN r;
END $$;

-- ยอดบัตร ณ วันที่ (ตามวันที่ของยอด ไม่ใช่เวลาที่กรอก):
--   สร้างประวัติ (balance, balance_date) ทุกเวอร์ชันจาก Audit (CREATE → UPDATE ...) แล้วเลือก
--   เวอร์ชันที่ balance_date ล่าสุดที่ ≤ p_date
CREATE OR REPLACE FUNCTION private.card_balance_at(p_card uuid, p_date date)
RETURNS TABLE (balance numeric, balance_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE st jsonb; a record; v_bal numeric; v_bd date; b_bal numeric; b_bd date; v_any boolean := false;
BEGIN
  FOR a IN SELECT l.action, l.metadata FROM public.audit_logs l
            WHERE l.entity_type = 'credit_cards' AND l.entity_id = p_card::text
            ORDER BY l.event_at, l.id
  LOOP
    IF a.action = 'CREATE' OR a.metadata #>> '{after,_op}' = 'CREATE' THEN
      st := a.metadata -> 'after';
    ELSIF st IS NOT NULL AND a.metadata ? 'after' THEN
      st := st || (a.metadata -> 'after');
    END IF;
    CONTINUE WHEN st IS NULL;
    v_any := true;
    v_bal := (st ->> 'outstanding_balance')::numeric; v_bd := (st ->> 'balance_date')::date;
    IF st ->> 'deleted_at' IS NULL AND v_bd <= p_date AND (b_bd IS NULL OR v_bd >= b_bd) THEN
      b_bal := v_bal; b_bd := v_bd;                    -- เวอร์ชันหลังสุดของ balance_date ที่มากที่สุด ≤ p_date
    END IF;
  END LOOP;
  IF NOT v_any THEN                                   -- ไม่มีประวัติ → ใช้ค่าปัจจุบัน
    SELECT c.outstanding_balance, c.balance_date INTO b_bal, b_bd FROM public.credit_cards c
     WHERE c.id = p_card AND c.balance_date <= p_date;
  END IF;
  IF b_bd IS NOT NULL THEN balance := b_bal; balance_date := b_bd; RETURN NEXT; END IF;
END $$;

-- ---------------------------------------------------------------------
-- รายการ Net Worth ณ วันที่ (1 แถว = 1 รายการ × 1 เจ้าของ/Unallocated)
--   p_confirmed = true  → โหมดปิดเดือน: บัญชีธนาคารใช้ยอดกระทบยอด (Confirmed)
--   p_confirmed = false → โหมด Dashboard: บัญชีธนาคารใช้ Calculated Balance
--   FX: Previous Available Rate ของวันที่ประเมิน (rate_date < p_date) ทุกรายการ
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.net_worth_items(p_family uuid, p_date date, p_confirmed boolean)
RETURNS TABLE (
  item_type text, asset_id uuid, liability_id uuid, credit_card_id uuid, lease_id uuid,
  person_id uuid, item_name text, item_group text, item_subtype text,
  value numeric, currency text, value_date date, is_carried_forward boolean,
  fx_rate numeric, base_value numeric, ownership_percent numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m0 date := date_trunc('month', p_date)::date;
  v_hist boolean := p_date < current_date;                                  -- ปิดงวดย้อนหลัง → ใช้สถานะ ณ สิ้นวัน p_date
  v_at timestamptz := ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok');
  st jsonb; v_bal numeric; v_bdate date;
  a record; v public.asset_valuations; s record; r record;
  v_val numeric; v_thb numeric; v_date date; v_fx numeric; v_carry boolean; v_ccy text;
  v_pf uuid; v_multi boolean; lv public.liability_valuations;
BEGIN
  IF NOT private.can_read() THEN RETURN; END IF;
  -- A) สินทรัพย์ทั่วไป + บัญชีธนาคาร + เงินให้กู้ ----------------------
  FOR a IN SELECT x.* FROM public.assets x
            WHERE x.family_id = p_family AND x.deleted_at IS NULL
              AND x.asset_type <> 'INVESTMENT_PORTFOLIO'
  LOOP
    st := CASE WHEN v_hist THEN private.row_state_at('assets', a.id, to_jsonb(a), v_at) ELSE to_jsonb(a) END;
    CONTINUE WHEN st IS NULL OR st ->> 'status' <> 'ACTIVE';
    -- ขายแล้วตามวันที่ของ ASSET_SALE (กรณีบันทึกสถานะย้อนหลัง)
    CONTINUE WHEN a.status <> 'ACTIVE' AND EXISTS (SELECT 1 FROM public.cash_movements m WHERE m.from_asset_id = a.id
                    AND m.movement_type = 'ASSET_SALE' AND m.deleted_at IS NULL AND m.movement_date <= p_date);
    v_val := NULL; v_date := NULL; v_carry := false;
    IF a.asset_type = 'LOAN_RECEIVABLE' THEN
      v_val := private.loan_outstanding_at(a.id, p_date); v_date := p_date;
    ELSIF private.is_bank_asset(a.id) THEN
      IF p_confirmed THEN
        SELECT bv.* INTO v FROM public.bank_reconciliations br
          JOIN public.asset_valuations bv ON bv.id = br.closing_valuation_id
         WHERE br.bank_asset_id = a.id AND br.year_month = m0 AND br.deleted_at IS NULL AND br.status <> 'OPEN';
        IF v.id IS NULL THEN v := private.latest_asset_valuation(a.id, p_date); END IF;
        v_val := v.value; v_date := v.valuation_date; v_carry := v.valuation_date < m0;
      ELSE
        v := private.latest_asset_valuation(a.id, p_date);
        v_val := private.bank_calculated_balance(a.id, p_date);
        v_date := CASE WHEN v.id IS NULL THEN NULL ELSE p_date END;
      END IF;
    ELSE
      v := private.latest_asset_valuation(a.id, p_date);
      v_val := v.value; v_date := v.valuation_date; v_carry := v.valuation_date < m0;
    END IF;
    CONTINUE WHEN v_val IS NULL OR v_val = 0;
    v_fx := private.fx_rate(a.currency, p_date);
    FOR s IN SELECT * FROM private.asset_owner_shares(a.id, p_date) LOOP
      item_type := 'ASSET'; asset_id := a.id; liability_id := NULL; credit_card_id := NULL; lease_id := NULL;
      person_id := s.person_id; item_name := a.name; item_group := a.asset_group; item_subtype := a.asset_type;
      value := round(v_val * s.pct / 100, 4); currency := a.currency; value_date := v_date;
      is_carried_forward := v_carry; fx_rate := v_fx; base_value := round(v_val * v_fx * s.pct / 100, 4);
      ownership_percent := s.pct;
      RETURN NEXT;
    END LOOP;
  END LOOP;

  -- B) Portfolio: SUM Holding (THB = SUM base_value) + In-transit + Unsettled -----
  FOR a IN SELECT x.*, p.id AS portfolio_id FROM public.assets x
             JOIN public.investment_portfolios p ON p.asset_id = x.id AND p.deleted_at IS NULL
            WHERE x.family_id = p_family AND x.deleted_at IS NULL
  LOOP
    st := CASE WHEN v_hist THEN private.row_state_at('assets', a.id, to_jsonb(a) - 'portfolio_id', v_at) ELSE to_jsonb(a) END;
    CONTINUE WHEN st IS NULL OR st ->> 'status' <> 'ACTIVE';
    SELECT sum(CASE WHEN h.currency = a.currency THEN hv.value
                    ELSE hv.value * private.fx_rate(h.currency, p_date) / private.fx_rate(a.currency, p_date) END),
           sum(hv.value_thb), max(hv.value_date), bool_or(h.currency <> a.currency),
           bool_or(hv.value <> 0 AND hv.value_date < m0)          -- ราคาทุน (ไม่มี Statement) ไม่ใช่ Carry Forward
      INTO v_val, v_thb, v_date, v_multi, v_carry
      FROM public.investment_holdings h
      CROSS JOIN LATERAL private.holding_value_at(h.id, p_date) hv
     WHERE h.portfolio_id = a.portfolio_id AND h.deleted_at IS NULL;
    IF coalesce(v_thb, 0) <> 0 OR coalesce(v_val, 0) <> 0 THEN
      v_fx := CASE WHEN v_multi THEN NULL ELSE private.fx_rate(a.currency, p_date) END;
      FOR s IN SELECT * FROM private.asset_owner_shares(a.id, p_date) LOOP
        item_type := 'ASSET'; asset_id := a.id; liability_id := NULL; credit_card_id := NULL; lease_id := NULL;
        person_id := s.person_id; item_name := a.name; item_group := 'INVESTMENT'; item_subtype := 'INVESTMENT_PORTFOLIO';
        value := round(v_val * s.pct / 100, 4); currency := a.currency; value_date := coalesce(v_date, p_date);
        is_carried_forward := coalesce(v_carry, false); fx_rate := v_fx;
        base_value := round(v_thb * s.pct / 100, 4); ownership_percent := s.pct;
        RETURN NEXT;
      END LOOP;
    END IF;

    -- In-transit (รอ Statement)
    v_val := private.portfolio_in_transit(a.portfolio_id, p_date);
    IF v_val <> 0 THEN
      v_fx := private.fx_rate(a.currency, p_date);
      FOR s IN SELECT * FROM private.asset_owner_shares(a.id, p_date) LOOP
        item_type := 'ASSET'; asset_id := a.id; liability_id := NULL; credit_card_id := NULL; lease_id := NULL;
        person_id := s.person_id; item_name := a.name || ' · เงินระหว่างทาง (รอ Statement)';
        item_group := 'INVESTMENT'; item_subtype := 'IN_TRANSIT';
        value := round(v_val * s.pct / 100, 4); currency := a.currency; value_date := p_date;
        is_carried_forward := false; fx_rate := v_fx; base_value := round(v_val * v_fx * s.pct / 100, 4);
        ownership_percent := s.pct;
        RETURN NEXT;
      END LOOP;
    END IF;

    -- Unsettled (Trade แล้ว ยังไม่ Settle กับบัญชีธนาคาร)
    FOR r IN SELECT CASE WHEN t.transaction_type = 'BUY' THEN 'UNSETTLED_PAYABLE' ELSE 'UNSETTLED_RECEIVABLE' END AS subtype,
                    t.currency AS ccy,
                    sum(CASE WHEN t.transaction_type = 'BUY' THEN -(t.amount + coalesce(t.fee,0))
                             ELSE t.amount - coalesce(t.fee,0) - coalesce(t.tax,0) END) AS amt
               FROM public.investment_transactions t
              WHERE t.portfolio_id = a.portfolio_id AND t.deleted_at IS NULL
                AND t.transaction_type IN ('BUY','SELL','REDEMPTION','MATURITY')
                AND (t.settle_from_asset_id IS NOT NULL OR t.settle_to_asset_id IS NOT NULL)
                AND t.transaction_date <= p_date AND t.settlement_date > p_date
              GROUP BY 1, 2
    LOOP
      v_fx := private.fx_rate(r.ccy, p_date);
      FOR s IN SELECT * FROM private.asset_owner_shares(a.id, p_date) LOOP
        item_type := 'ASSET'; asset_id := a.id; liability_id := NULL; credit_card_id := NULL; lease_id := NULL;
        person_id := s.person_id;
        item_name := a.name || CASE WHEN r.subtype = 'UNSETTLED_PAYABLE' THEN ' · รอจ่ายชำระ' ELSE ' · รอรับชำระ' END;
        item_group := 'INVESTMENT'; item_subtype := r.subtype;
        value := round(r.amt * s.pct / 100, 4); currency := r.ccy; value_date := p_date;
        is_carried_forward := false; fx_rate := v_fx; base_value := round(r.amt * v_fx * s.pct / 100, 4);
        ownership_percent := s.pct;
        RETURN NEXT;
      END LOOP;
    END LOOP;
  END LOOP;

  -- C) หนี้สิน (liabilities) ------------------------------------------------
  FOR a IN SELECT l.* FROM public.liabilities l
            WHERE l.family_id = p_family AND l.deleted_at IS NULL
  LOOP
    st := CASE WHEN v_hist THEN private.row_state_at('liabilities', a.id, to_jsonb(a), v_at) ELSE to_jsonb(a) END;
    CONTINUE WHEN st IS NULL OR st ->> 'status' <> 'ACTIVE';
    SELECT * INTO lv FROM public.liability_valuations x
     WHERE x.liability_id = a.id AND x.deleted_at IS NULL AND x.valuation_date <= p_date
     ORDER BY x.valuation_date DESC, x.created_at DESC LIMIT 1;
    CONTINUE WHEN lv.id IS NULL OR lv.balance = 0;
    v_fx := private.fx_rate(a.currency, p_date);
    FOR s IN SELECT * FROM private.liability_owner_shares(a.id) LOOP
      item_type := 'LIABILITY'; asset_id := NULL; liability_id := a.id; credit_card_id := NULL; lease_id := NULL;
      person_id := s.person_id; item_name := a.name; item_group := 'LIABILITY_LOAN'; item_subtype := a.liability_type;
      value := round(lv.balance * s.pct / 100, 4); currency := a.currency; value_date := lv.valuation_date;
      is_carried_forward := lv.valuation_date < m0; fx_rate := v_fx;
      base_value := round(lv.balance * v_fx * s.pct / 100, 4); ownership_percent := s.pct;
      RETURN NEXT;
    END LOOP;
  END LOOP;

  -- D) บัตรเครดิต (Owner 100%) — ยอดที่ balance_date ล่าสุด ≤ p_date (จากประวัติใน Audit)
  --    FX = Previous Available Rate ของ balance_date (Section 34 Credit Card Mapping)
  FOR a IN SELECT c.* FROM public.credit_cards c JOIN public.persons p ON p.id = c.person_id
            WHERE p.family_id = p_family AND c.deleted_at IS NULL
  LOOP
    IF v_hist THEN
      SELECT cb.balance, cb.balance_date INTO v_bal, v_bdate FROM private.card_balance_at(a.id, p_date) cb;
    ELSE
      v_bal := a.outstanding_balance; v_bdate := a.balance_date;
    END IF;
    CONTINUE WHEN coalesce(v_bal, 0) <= 0 OR v_bdate IS NULL OR v_bdate > p_date;   -- ไม่รู้ยอด ณ วันนั้น → Closing Check
    v_fx := private.fx_rate(a.currency, v_bdate);
    item_type := 'LIABILITY'; asset_id := NULL; liability_id := NULL; credit_card_id := a.id; lease_id := NULL;
    person_id := a.person_id; item_name := concat_ws(' ', a.issuer, a.card_name, '••' || a.card_last4);
    item_group := 'LIABILITY_CARD'; item_subtype := 'CREDIT_CARD';
    value := v_bal; currency := a.currency; value_date := v_bdate;
    is_carried_forward := v_bdate < m0; fx_rate := v_fx;
    base_value := round(v_bal * v_fx, 4); ownership_percent := 100;
    RETURN NEXT;
  END LOOP;

  -- E) เงินประกันการเช่า (หนี้ของเจ้าของ Property) -----------------------------
  FOR a IN SELECT l.*, pd.asset_id AS prop_asset, pa.name AS prop_name
             FROM public.property_leases l
             JOIN public.property_details pd ON pd.id = l.property_id
             JOIN public.assets pa ON pa.id = pd.asset_id
            WHERE pa.family_id = p_family AND l.deleted_at IS NULL AND pd.deleted_at IS NULL AND pa.deleted_at IS NULL
              AND coalesce(l.security_deposit, 0) > 0
              AND coalesce(l.deposit_received_date, l.start_date) <= p_date
              AND (l.deposit_settled_date IS NULL OR l.deposit_settled_date > p_date)
  LOOP
    v_fx := private.fx_rate(a.deposit_currency, p_date);
    FOR s IN SELECT * FROM private.asset_owner_shares(a.prop_asset, p_date) LOOP
      item_type := 'LIABILITY'; asset_id := NULL; liability_id := NULL; credit_card_id := NULL; lease_id := a.id;
      person_id := s.person_id; item_name := concat_ws(' · ', a.prop_name, a.unit_label, a.tenant_name);
      item_group := 'LIABILITY_DEPOSIT'; item_subtype := 'SECURITY_DEPOSIT';
      value := round(a.security_deposit * s.pct / 100, 4); currency := a.deposit_currency; value_date := p_date;
      is_carried_forward := false; fx_rate := v_fx;
      base_value := round(a.security_deposit * v_fx * s.pct / 100, 4); ownership_percent := s.pct;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END $$;

-- =====================================================================
-- Views
-- =====================================================================

-- Normal Views (Section 40: Child เห็นเมื่อ Parent ยังไม่ถูกลบ)
CREATE VIEW public.v_assets_active WITH (security_invoker = true) AS
  SELECT a.* FROM public.assets a WHERE a.deleted_at IS NULL;

CREATE VIEW public.v_asset_ownerships_active WITH (security_invoker = true) AS
  SELECT o.*, p.name AS person_name FROM public.asset_ownerships o
    JOIN public.assets a ON a.id = o.asset_id JOIN public.persons p ON p.id = o.person_id
   WHERE o.deleted_at IS NULL AND a.deleted_at IS NULL AND p.deleted_at IS NULL;

CREATE VIEW public.v_asset_valuations_active WITH (security_invoker = true) AS
  SELECT v.* FROM public.asset_valuations v JOIN public.assets a ON a.id = v.asset_id
   WHERE v.deleted_at IS NULL AND a.deleted_at IS NULL;

CREATE VIEW public.v_holdings_active WITH (security_invoker = true) AS
  SELECT h.*, p.asset_id AS portfolio_asset_id,
         CASE WHEN h.status = 'ACTIVE' AND h.maturity_date IS NOT NULL
                   AND h.maturity_date BETWEEN current_date AND current_date + 30 THEN 'MATURITY_SOON' END AS derived_status,
         (h.holding_type <> 'CASH' AND NOT EXISTS (SELECT 1 FROM public.investment_valuations v
            WHERE v.holding_id = h.id AND v.deleted_at IS NULL)) AS valued_at_cost       -- ป้าย "ราคาทุน · รอ Statement"
    FROM public.investment_holdings h
    JOIN public.investment_portfolios p ON p.id = h.portfolio_id
    JOIN public.assets a ON a.id = p.asset_id
   WHERE h.deleted_at IS NULL AND p.deleted_at IS NULL AND a.deleted_at IS NULL;

-- Safe View: เลขบัญชีแบบ Mask (Section 10) — ไม่แตะ bank_account_secrets
CREATE VIEW public.v_bank_accounts_safe WITH (security_invoker = true) AS
  SELECT b.id, b.asset_id, a.name, a.currency, a.status, b.bank_name, b.account_name, b.account_type,
         b.account_no_last4,
         CASE WHEN b.account_no_last4 IS NOT NULL THEN '••••' || b.account_no_last4 END AS account_no_masked,
         b.interest_rate, b.maturity_date, b.branch, b.notes, a.current_value AS confirmed_balance,
         a.current_value_date AS confirmed_date
    FROM public.bank_accounts b JOIN public.assets a ON a.id = b.asset_id
   WHERE b.deleted_at IS NULL AND a.deleted_at IS NULL;

-- Confirmed vs Calculated Balance (Section 25C)
CREATE VIEW public.v_bank_balance_current WITH (security_invoker = true) AS
  SELECT b.asset_id, a.name, a.currency,
         lv.value AS confirmed_balance, lv.valuation_date AS confirmed_date,
         private.bank_calculated_balance(b.asset_id, current_date) AS calculated_balance,
         CASE WHEN EXISTS (SELECT 1 FROM public.cash_movements m
                            WHERE m.deleted_at IS NULL AND m.movement_date > lv.valuation_date
                              AND m.movement_date <= current_date
                              AND (m.from_asset_id = b.asset_id OR m.to_asset_id = b.asset_id))
              THEN 'CALCULATED' ELSE 'CONFIRMED' END AS balance_label,
         lv.unexplained_difference AS last_unexplained_difference
    FROM public.bank_accounts b
    JOIN public.assets a ON a.id = b.asset_id
    LEFT JOIN LATERAL (SELECT (private.latest_asset_valuation(b.asset_id, current_date)).*) lv ON true
   WHERE b.deleted_at IS NULL AND a.deleted_at IS NULL
     AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');

-- Net Cash ของรายการลงทุน (Section 13) + Derived Status SETTLED / UNSETTLED
CREATE VIEW public.v_investment_transactions_net WITH (security_invoker = true) AS
  SELECT t.*, private.itx_net_cash(t, t.currency) AS net_cash,
         CASE WHEN coalesce(t.settlement_date, t.transaction_date) > current_date THEN 'UNSETTLED'
              ELSE 'SETTLED' END AS settlement_status
    FROM public.investment_transactions t
   WHERE t.deleted_at IS NULL;

-- รายการรอรับ / รอจ่ายชำระ (Section 13)
CREATE VIEW public.v_unsettled_trades WITH (security_invoker = true) AS
  SELECT t.id AS transaction_id, t.portfolio_id, p.asset_id AS portfolio_asset_id, t.holding_id,
         t.transaction_type, t.transaction_date, t.settlement_date,
         coalesce(t.settle_from_asset_id, t.settle_to_asset_id) AS bank_asset_id,
         CASE WHEN t.transaction_type = 'BUY' THEN 'PAYABLE' ELSE 'RECEIVABLE' END AS direction,
         CASE WHEN t.transaction_type = 'BUY' THEN t.amount + coalesce(t.fee,0)
              ELSE t.amount - coalesce(t.fee,0) - coalesce(t.tax,0) END AS net_amount,
         t.currency
    FROM public.investment_transactions t JOIN public.investment_portfolios p ON p.id = t.portfolio_id
   WHERE t.deleted_at IS NULL AND t.transaction_type IN ('BUY','SELL','REDEMPTION','MATURITY')
     AND (t.settle_from_asset_id IS NOT NULL OR t.settle_to_asset_id IS NOT NULL)
     AND t.transaction_date <= current_date AND t.settlement_date > current_date;

-- มูลค่าพอร์ต: THB (Net Worth) / Display / In-transit (Section 11, 25C)
CREATE VIEW public.v_portfolio_values WITH (security_invoker = true) AS
  SELECT p.id AS portfolio_id, p.asset_id, a.name, a.currency AS portfolio_currency,
         a.current_value AS display_value, a.current_value_date AS display_value_date,
         (SELECT sum(hv.value_thb) FROM public.investment_holdings h
            CROSS JOIN LATERAL private.holding_value_at(h.id, current_date) hv
           WHERE h.portfolio_id = p.id AND h.deleted_at IS NULL) AS thb_value,
         private.portfolio_in_transit(p.id, current_date) AS in_transit,
         private.portfolio_in_transit(p.id, current_date) * private.fx_rate(a.currency, current_date) AS in_transit_thb
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
   WHERE p.deleted_at IS NULL AND a.deleted_at IS NULL
     AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');

-- สัญญาเช่า + Derived Status (Section 22, 43)
CREATE VIEW public.v_lease_status WITH (security_invoker = true) AS
  SELECT l.*, pd.asset_id AS property_asset_id,
         coalesce(l.terminated_date, l.end_date) AS deposit_due_date,
         CASE WHEN l.status = 'TERMINATED' THEN 'TERMINATED'
              WHEN l.start_date > current_date THEN 'UPCOMING'
              WHEN l.end_date < current_date THEN 'EXPIRED'
              WHEN l.end_date <= current_date + 60 THEN 'EXPIRING_SOON'
              ELSE 'ACTIVE' END AS lease_status,
         CASE WHEN coalesce(l.security_deposit, 0) = 0 THEN 'NONE'
              WHEN l.deposit_settled_date <= current_date THEN 'SETTLED'
              WHEN coalesce(l.terminated_date, l.end_date) < current_date THEN 'DEPOSIT_REFUND_OVERDUE'
              WHEN coalesce(l.terminated_date, l.end_date) <= current_date + 30 THEN 'DUE_SOON'
              ELSE 'HELD' END AS deposit_status
    FROM public.property_leases l JOIN public.property_details pd ON pd.id = l.property_id
   WHERE l.deleted_at IS NULL AND pd.deleted_at IS NULL;

-- หนี้สินทั้งหมด (Section 21): liabilities + Credit Card + Security Deposit
CREATE VIEW public.v_liabilities_all WITH (security_invoker = true) AS
  SELECT 'LOAN'::text AS liability_source, l.id AS source_id, l.family_id, l.name, l.liability_type AS subtype,
         l.currency, l.outstanding_amount AS amount, l.balance_date, l.due_date,
         l.monthly_payment, l.payment_due_day, l.status, NULL::text AS derived_status
    FROM public.liabilities l
   WHERE l.deleted_at IS NULL AND l.status = 'ACTIVE'
  UNION ALL
  SELECT 'CREDIT_CARD', c.id, p.family_id, concat_ws(' ', c.issuer, c.card_name, '••' || c.card_last4), 'CREDIT_CARD',
         c.currency, c.outstanding_balance, c.balance_date, NULL, NULL, c.due_day, c.status,
         CASE WHEN EXISTS (SELECT 1 FROM public.cash_movements m WHERE m.to_credit_card_id = c.id
                            AND m.deleted_at IS NULL AND m.movement_date > c.balance_date)
              THEN 'PAID_AFTER_BALANCE_DATE' END
    FROM public.credit_cards c JOIN public.persons p ON p.id = c.person_id
   WHERE c.deleted_at IS NULL AND c.status <> 'CLOSED'
  UNION ALL
  SELECT 'SECURITY_DEPOSIT', ls.id, a.family_id, concat_ws(' · ', a.name, ls.unit_label, ls.tenant_name),
         'SECURITY_DEPOSIT', ls.deposit_currency, ls.security_deposit,
         coalesce(ls.deposit_received_date, ls.start_date), ls.deposit_due_date, NULL, NULL, ls.status,
         ls.deposit_status
    FROM public.v_lease_status ls JOIN public.assets a ON a.id = ls.property_asset_id
   WHERE coalesce(ls.security_deposit, 0) > 0
     AND coalesce(ls.deposit_received_date, ls.start_date) <= current_date
     AND (ls.deposit_settled_date IS NULL OR ls.deposit_settled_date > current_date) AND a.deleted_at IS NULL;

-- รายได้ที่ควรได้รับ (Section 25E): Recurring + Lease
CREATE VIEW public.v_expected_income WITH (security_invoker = true) AS
WITH fam AS (SELECT f.id, date_trunc('month', f.go_live_date)::date AS go_live_month
               FROM public.families f WHERE f.deleted_at IS NULL),
src AS (
  SELECT 'RECURRING'::text AS source_type, t.id AS source_id, t.family_id, t.person_id, NULL::uuid AS asset_id,
         t.name, t.income_type, t.expected_amount, t.currency, t.receive_to_asset_id,
         t.start_date, coalesce(t.end_date, 'infinity'::date) AS end_date,
         CASE t.frequency WHEN 'MONTHLY' THEN 1 WHEN 'QUARTERLY' THEN 3 WHEN 'YEARLY' THEN 12 END AS step,
         coalesce(t.due_day, extract(day FROM t.start_date)::int) AS due_day
    FROM public.recurring_income_templates t WHERE t.deleted_at IS NULL AND t.active
  UNION ALL
  SELECT 'LEASE', l.id, a.family_id, NULL, a.id, concat_ws(' · ', a.name, l.unit_label, l.tenant_name), 'RENT',
         l.rent_amount, l.rent_currency, NULL, l.start_date, coalesce(l.terminated_date, l.end_date),
         CASE l.payment_frequency WHEN 'MONTHLY' THEN 1 WHEN 'QUARTERLY' THEN 3 WHEN 'YEARLY' THEN 12 END,
         coalesce(l.payment_due_day, extract(day FROM l.start_date)::int)
    FROM public.property_leases l JOIN public.property_details pd ON pd.id = l.property_id
    JOIN public.assets a ON a.id = pd.asset_id
   WHERE l.deleted_at IS NULL AND pd.deleted_at IS NULL AND a.deleted_at IS NULL),
periods AS (
  SELECT s.*, g::date AS income_period,
         make_date(extract(year FROM g)::int, extract(month FROM g)::int,
                   least(s.due_day, extract(day FROM (g + interval '1 month' - interval '1 day'))::int)) AS due_date
    FROM src s JOIN fam ON fam.id = s.family_id
    CROSS JOIN LATERAL generate_series(date_trunc('month', s.start_date),
                                       least(date_trunc('month', s.end_date), date_trunc('month', current_date)),
                                       make_interval(months => s.step)) g
   WHERE s.step IS NOT NULL AND g >= fam.go_live_month)
SELECT p.source_type, p.source_id, p.family_id, p.person_id, p.asset_id, p.name, p.income_type,
       p.income_period, p.due_date, p.expected_amount, p.currency, p.receive_to_asset_id,
       rec.received_amount, rec.received_count,
       CASE WHEN rec.received_count > 0 THEN 'RECEIVED'
            WHEN d.id IS NOT NULL THEN 'DISMISSED'
            WHEN p.due_date >= current_date THEN 'PENDING'
            ELSE 'OVERDUE' END AS status
  FROM periods p
  LEFT JOIN LATERAL (SELECT sum(i.amount) AS received_amount, count(*) AS received_count
                       FROM public.income_transactions i
                      WHERE i.deleted_at IS NULL AND i.income_period = p.income_period
                        AND ((p.source_type = 'RECURRING' AND i.recurring_template_id = p.source_id)
                          OR (p.source_type = 'LEASE' AND i.lease_id = p.source_id AND i.income_type = 'RENT'))) rec ON true
  LEFT JOIN public.expected_income_dismissals d
    ON d.source_type = p.source_type AND d.source_id = p.source_id AND d.income_period = p.income_period
   AND d.deleted_at IS NULL;

-- ค่าเช่าตามสัญญา vs ได้รับจริง (Section 24)
CREATE VIEW public.v_lease_rent_tracking WITH (security_invoker = true) AS
  SELECT e.source_id AS lease_id, e.asset_id AS property_asset_id, e.name, e.income_period, e.due_date,
         e.expected_amount, coalesce(e.received_amount, 0) AS received_amount,
         e.expected_amount - coalesce(e.received_amount, 0) AS gap, e.currency, e.status
    FROM public.v_expected_income e WHERE e.source_type = 'LEASE';

-- รายได้รายบุคคล (Section 24): person → 100% ; asset → Ownership ณ วันที่รับ ; อื่น = Unallocated
CREATE VIEW public.v_income_by_person WITH (security_invoker = true) AS
  SELECT i.id AS income_id, i.family_id, i.date, i.income_type, i.currency,
         (i.source_transaction_id IS NOT NULL) AS is_investment_income,
         sh.person_id, sh.pct AS share_percent,
         round(i.amount * sh.pct / 100, 4) AS amount_share,
         round(coalesce(i.tax, 0) * sh.pct / 100, 4) AS tax_share,
         round(i.base_amount * sh.pct / 100, 4) AS base_amount_share
    FROM public.income_transactions i
    CROSS JOIN LATERAL (
      SELECT i.person_id AS person_id, 100::numeric AS pct WHERE i.person_id IS NOT NULL
      UNION ALL
      SELECT o.person_id, o.pct FROM private.asset_owner_shares(i.asset_id, i.date) o
       WHERE i.person_id IS NULL AND i.asset_id IS NOT NULL
      UNION ALL
      SELECT NULL, 100 WHERE i.person_id IS NULL AND i.asset_id IS NULL) sh
   WHERE i.deleted_at IS NULL AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');

-- ค่าใช้จ่ายรายบุคคล (Section 25): บัตร → เจ้าของบัตร ; บัญชี → Ownership ; person ; อื่น = Unallocated
CREATE VIEW public.v_expense_by_person WITH (security_invoker = true) AS
  SELECT i.id AS expense_item_id, me.family_id, me.year_month, i.date, i.expense_category, i.currency,
         (i.source_cash_movement_id IS NOT NULL) AS is_derived_fee,
         sh.person_id, sh.pct AS share_percent,
         round(i.amount * sh.pct / 100, 4) AS amount_share,
         round(i.base_amount * sh.pct / 100, 4) AS base_amount_share
    FROM public.expense_items i
    JOIN public.monthly_expenses me ON me.id = i.monthly_expense_id
    LEFT JOIN public.cash_movements src ON src.id = i.source_cash_movement_id
    CROSS JOIN LATERAL (
      SELECT c.person_id, 100::numeric AS pct FROM public.credit_cards c WHERE c.id = i.paid_from_credit_card_id
      UNION ALL
      SELECT o.person_id, o.pct FROM private.asset_owner_shares(coalesce(i.paid_from_asset_id, src.from_asset_id), i.date) o
       WHERE coalesce(i.paid_from_asset_id, src.from_asset_id) IS NOT NULL
      UNION ALL
      SELECT i.person_id, 100 WHERE i.person_id IS NOT NULL
      UNION ALL
      SELECT NULL, 100 WHERE i.person_id IS NULL AND i.paid_from_credit_card_id IS NULL
                         AND coalesce(i.paid_from_asset_id, src.from_asset_id) IS NULL) sh
   WHERE i.deleted_at IS NULL AND me.deleted_at IS NULL
     AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');

-- สถานะเงินคืน (Section 25 Reimbursement: Derived)
CREATE VIEW public.v_expense_reimbursement_status WITH (security_invoker = true) AS
  SELECT i.id AS expense_item_id, i.date, i.description, i.amount, i.currency,
         i.is_reimbursable, i.expected_reimbursement_amount,
         coalesce(r.received, 0) AS reimbursed_amount,
         i.amount - coalesce(r.received, 0) AS net_expense,
         CASE WHEN NOT i.is_reimbursable THEN 'NONE'
              WHEN coalesce(r.received, 0) = 0 THEN 'PENDING'
              WHEN coalesce(r.received, 0) < coalesce(i.expected_reimbursement_amount, i.amount) THEN 'PARTIAL'
              ELSE 'FULL' END AS reimbursement_status
    FROM public.expense_items i
    LEFT JOIN LATERAL (SELECT sum(x.amount) AS received FROM public.expense_reimbursements x
                        WHERE x.expense_item_id = i.id AND x.deleted_at IS NULL) r ON true
   WHERE i.deleted_at IS NULL;

-- Net Worth ปัจจุบัน (Dashboard เดือน DRAFT ใช้ Calculated Balance)
CREATE VIEW public.v_net_worth_items_current WITH (security_invoker = true) AS
  SELECT f.id AS family_id, n.*
    FROM public.families f
    CROSS JOIN LATERAL private.net_worth_items(f.id, current_date, false) n
   WHERE f.deleted_at IS NULL AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');

CREATE VIEW public.v_net_worth_by_person WITH (security_invoker = true) AS
  SELECT n.family_id, n.person_id, p.name AS person_name,
         sum(CASE WHEN n.item_type = 'ASSET' THEN n.base_value ELSE 0 END) AS total_assets,
         sum(CASE WHEN n.item_type = 'LIABILITY' THEN n.base_value ELSE 0 END) AS total_liabilities,
         sum(CASE WHEN n.item_type = 'ASSET' THEN n.base_value ELSE -n.base_value END) AS net_worth
    FROM public.v_net_worth_items_current n LEFT JOIN public.persons p ON p.id = n.person_id
   GROUP BY n.family_id, n.person_id, p.name;

-- Derived Status อื่น (Section 43)
CREATE VIEW public.v_loans_status WITH (security_invoker = true) AS
  SELECT l.*, a.name, a.currency,
         CASE WHEN l.status IN ('CLOSED','WRITTEN_OFF') OR l.due_date IS NULL THEN NULL
              WHEN l.due_date < current_date THEN 'OVERDUE'
              WHEN l.due_date <= current_date + 30 THEN 'DUE_SOON' END AS derived_status
    FROM public.loan_details l JOIN public.assets a ON a.id = l.asset_id
   WHERE l.deleted_at IS NULL AND a.deleted_at IS NULL;

CREATE VIEW public.v_insurance_status WITH (security_invoker = true) AS
  SELECT p.*,
         CASE WHEN p.end_date IS NULL THEN NULL
              WHEN p.end_date < current_date THEN 'EXPIRED'
              WHEN p.end_date <= current_date + 60 THEN 'EXPIRING_SOON' END AS derived_status
    FROM public.insurance_policies p WHERE p.deleted_at IS NULL;

CREATE VIEW public.v_documents_status WITH (security_invoker = true) AS
  SELECT d.*,
         CASE WHEN d.expiry_date IS NULL THEN NULL
              WHEN d.expiry_date < current_date THEN 'EXPIRED'
              WHEN d.expiry_date <= current_date + 60 THEN 'EXPIRING_SOON' END AS derived_status
    FROM public.documents d WHERE d.deleted_at IS NULL;

-- สถานะ FX ต่อสกุลที่ใช้งาน (Section 16 Staleness)
CREATE VIEW public.v_fx_status WITH (security_invoker = true) AS
  WITH used AS (
    SELECT currency FROM public.assets WHERE deleted_at IS NULL AND status = 'ACTIVE'
    UNION SELECT currency FROM public.investment_holdings WHERE deleted_at IS NULL AND status = 'ACTIVE'
    UNION SELECT currency FROM public.liabilities WHERE deleted_at IS NULL AND status = 'ACTIVE'
    UNION SELECT currency FROM public.credit_cards WHERE deleted_at IS NULL
    UNION SELECT deposit_currency FROM public.property_leases WHERE deleted_at IS NULL AND deposit_currency IS NOT NULL)
  SELECT u.currency, r.rate_date AS latest_rate_date, r.rate_to_thb, r.source, r.is_override,
         current_date - r.rate_date AS age_days,
         (r.rate_date IS NULL OR current_date - r.rate_date > 5) AS is_stale
    FROM used u
    LEFT JOIN LATERAL (SELECT x.* FROM public.fx_rates x WHERE x.currency = u.currency AND x.deleted_at IS NULL
                        ORDER BY x.rate_date DESC LIMIT 1) r ON true
   WHERE u.currency <> 'THB';
