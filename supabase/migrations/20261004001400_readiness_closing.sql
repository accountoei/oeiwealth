-- =====================================================================
-- 1400 Go-live Readiness (Section 14A) + Month Closing Checks (Section 36)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Go-live Readiness: READY / WARN / MISSING / NOT_REQUIRED
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.go_live_readiness(p_family uuid)
RETURNS TABLE (category text, entity_type text, entity_id uuid, name text, currency text,
               opening_value numeric, opening_date date, status text, message text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.families; v_open date; v_warn date;
BEGIN
  IF NOT private.can_read() THEN RETURN; END IF;
  SELECT * INTO f FROM public.families WHERE id = p_family;
  v_open := f.go_live_date - 1;               -- ยอดตั้งต้น = สิ้นวันก่อน Go-live
  v_warn := f.go_live_date - 90;

  -- สินทรัพย์ที่มีมูลค่าจาก asset_valuations (Bank / Property / Alternative / Business / Insurance CV)
  RETURN QUERY
  SELECT CASE WHEN private.is_bank_asset(a.id) THEN 'CASH' ELSE a.asset_group END, 'ASSET', a.id, a.name, a.currency::text,
         v.value::numeric, v.valuation_date,
         CASE WHEN a.acquisition_date >= f.go_live_date THEN 'NOT_REQUIRED'
              WHEN v.id IS NULL THEN 'MISSING'
              WHEN v.valuation_date < v_warn THEN 'WARN' ELSE 'READY' END,
         CASE WHEN a.acquisition_date >= f.go_live_date THEN 'ได้มาหลัง Go-live'
              WHEN v.id IS NULL THEN 'ยังไม่มียอดตั้งต้น'
              WHEN v.valuation_date < v_warn THEN 'มูลค่าตั้งต้นเก่ากว่า 90 วัน' END
    FROM public.assets a
    LEFT JOIN public.asset_valuations v ON v.asset_id = a.id AND v.is_opening AND v.deleted_at IS NULL
   WHERE a.family_id = p_family AND a.deleted_at IS NULL AND a.status = 'ACTIVE'
     AND a.asset_type NOT IN ('INVESTMENT_PORTFOLIO','LOAN_RECEIVABLE');

  -- กรมธรรม์ที่มีมูลค่าเวนคืนแต่ยังไม่ผูก Asset
  RETURN QUERY
  SELECT 'FINANCIAL', 'INSURANCE_POLICY', p.id, p.insurer || coalesce(' ' || p.policy_no, ''), NULL::text,
         NULL::numeric, NULL::date, 'MISSING', 'มีมูลค่าเวนคืนแต่ยังไม่มี Asset มูลค่าเวนคืน'
    FROM public.insurance_policies p
   WHERE p.family_id = p_family AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
     AND p.has_cash_value AND p.cash_value_asset_id IS NULL;

  -- Holding ในพอร์ต
  RETURN QUERY
  SELECT 'INVESTMENT', 'HOLDING', h.id, a.name || ' · ' || h.name, h.currency::text,
         ob.amount::numeric, ob.transaction_date,
         CASE WHEN ob.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.investment_valuations v
                    WHERE v.holding_id = h.id AND v.deleted_at IS NULL AND v.valuation_date <= v_open)
                   AND h.holding_type <> 'CASH' THEN 'WARN'
              WHEN ob.id IS NOT NULL THEN 'READY'
              WHEN first_tx.transaction_date >= f.go_live_date THEN 'NOT_REQUIRED'
              ELSE 'MISSING' END,
         CASE WHEN ob.id IS NOT NULL AND h.holding_type <> 'CASH' AND NOT EXISTS (SELECT 1 FROM public.investment_valuations v
                    WHERE v.holding_id = h.id AND v.deleted_at IS NULL AND v.valuation_date <= v_open)
                   THEN 'ยังไม่มีราคาตลาด ณ วันตั้งต้น (ใช้ราคาทุน)'
              WHEN ob.id IS NULL AND coalesce(first_tx.transaction_date, f.go_live_date - 1) < f.go_live_date
                   THEN 'ยังไม่มี OPENING_BALANCE' END
    FROM public.investment_holdings h
    JOIN public.investment_portfolios pf ON pf.id = h.portfolio_id AND pf.deleted_at IS NULL
    JOIN public.assets a ON a.id = pf.asset_id AND a.deleted_at IS NULL AND a.family_id = p_family
    LEFT JOIN LATERAL (SELECT t.* FROM public.investment_transactions t WHERE t.holding_id = h.id
                        AND t.transaction_type = 'OPENING_BALANCE' AND t.deleted_at IS NULL LIMIT 1) ob ON true
    LEFT JOIN LATERAL (SELECT min(t.transaction_date) AS transaction_date FROM public.investment_transactions t
                        WHERE t.holding_id = h.id AND t.deleted_at IS NULL) first_tx ON true
   WHERE h.deleted_at IS NULL AND h.status = 'ACTIVE';

  -- เงินให้กู้
  RETURN QUERY
  SELECT 'FINANCIAL', 'LOAN', a.id, a.name, a.currency::text, l.opening_outstanding_principal::numeric, l.opening_date,
         CASE WHEN l.opening_date < f.go_live_date THEN 'READY'
              WHEN l.opening_outstanding_principal = 0 THEN 'NOT_REQUIRED' ELSE 'MISSING' END,
         CASE WHEN l.opening_date >= f.go_live_date AND l.opening_outstanding_principal > 0
              THEN 'opening_date ต้องอยู่ก่อน Go-live' END
    FROM public.loan_details l JOIN public.assets a ON a.id = l.asset_id
   WHERE a.family_id = p_family AND a.deleted_at IS NULL AND l.deleted_at IS NULL
     AND a.status = 'ACTIVE' AND l.status IN ('ACTIVE','AT_RISK');

  -- หนี้สิน
  RETURN QUERY
  SELECT 'LIABILITY', 'LIABILITY', l.id, l.name, l.currency::text, v.balance::numeric, v.valuation_date,
         CASE WHEN v.id IS NOT NULL AND v.valuation_date < v_warn THEN 'WARN'
              WHEN v.id IS NOT NULL THEN 'READY'
              WHEN l.start_date >= f.go_live_date THEN 'NOT_REQUIRED' ELSE 'MISSING' END,
         CASE WHEN v.id IS NULL AND coalesce(l.start_date, v_open) < f.go_live_date THEN 'ยังไม่มียอดตั้งต้น'
              WHEN v.valuation_date < v_warn THEN 'ยอดตั้งต้นเก่ากว่า 90 วัน' END
    FROM public.liabilities l
    LEFT JOIN public.liability_valuations v ON v.liability_id = l.id AND v.is_opening AND v.deleted_at IS NULL
   WHERE l.family_id = p_family AND l.deleted_at IS NULL AND l.status = 'ACTIVE';

  -- บัตรเครดิต
  RETURN QUERY
  SELECT 'LIABILITY', 'CREDIT_CARD', c.id, concat_ws(' ', c.issuer, c.card_name, '••' || c.card_last4), c.currency::text,
         c.outstanding_balance::numeric, c.balance_date,
         CASE WHEN c.balance_date IS NULL THEN 'MISSING'
              WHEN c.balance_date < v_warn THEN 'WARN' ELSE 'READY' END,
         CASE WHEN c.balance_date IS NULL THEN 'ยังไม่มียอดค้าง + วันที่ของยอด' END
    FROM public.credit_cards c JOIN public.persons p ON p.id = c.person_id
   WHERE p.family_id = p_family AND c.deleted_at IS NULL AND c.status = 'ACTIVE';

  -- Ownership ไม่ครบ 100% ณ วันตั้งต้น
  RETURN QUERY
  SELECT 'OWNERSHIP', 'ASSET', a.id, a.name, NULL::text, (100 - s.pct)::numeric, v_open, 'MISSING',
         'ระบุเจ้าของไม่ครบ (ขาด ' || (100 - s.pct)::text || '%)'
    FROM public.assets a
    CROSS JOIN LATERAL (SELECT coalesce(sum(o.pct), 0) AS pct FROM private.asset_owner_shares(a.id, greatest(v_open, coalesce(a.acquisition_date, v_open))) o
                         WHERE o.person_id IS NOT NULL) s
   WHERE a.family_id = p_family AND a.deleted_at IS NULL AND a.status = 'ACTIVE' AND s.pct < 100;
  RETURN QUERY
  SELECT 'OWNERSHIP', 'LIABILITY', l.id, l.name, NULL::text, (100 - s.pct)::numeric, v_open, 'MISSING',
         'ระบุผู้รับผิดชอบหนี้ไม่ครบ (ขาด ' || (100 - s.pct)::text || '%)'
    FROM public.liabilities l
    CROSS JOIN LATERAL (SELECT coalesce(sum(o.pct), 0) AS pct FROM private.liability_owner_shares(l.id) o
                         WHERE o.person_id IS NOT NULL) s
   WHERE l.family_id = p_family AND l.deleted_at IS NULL AND l.status = 'ACTIVE' AND s.pct < 100;

  -- FX ของทุกสกุลที่ใช้ ณ วันตั้งต้น (Rate ก่อนวันตั้งต้น)
  RETURN QUERY
  SELECT 'FX', 'FX_RATE', NULL::uuid, u.currency, u.currency, r.rate_to_thb::numeric, r.rate_date,
         CASE WHEN r.id IS NULL THEN 'MISSING' WHEN v_open - r.rate_date > 5 THEN 'WARN' ELSE 'READY' END,
         CASE WHEN r.id IS NULL THEN 'ไม่มี FX ก่อนวันตั้งต้น' WHEN v_open - r.rate_date > 5 THEN 'Rate เก่ากว่า 5 วัน' END
    FROM (SELECT DISTINCT x.currency::text AS currency FROM (
            SELECT a.currency FROM public.assets a WHERE a.family_id = p_family AND a.deleted_at IS NULL AND a.status = 'ACTIVE'
            UNION SELECT h.currency FROM public.investment_holdings h WHERE h.deleted_at IS NULL AND h.status = 'ACTIVE'
            UNION SELECT l.currency FROM public.liabilities l WHERE l.family_id = p_family AND l.deleted_at IS NULL
            UNION SELECT c.currency FROM public.credit_cards c WHERE c.deleted_at IS NULL) x
          WHERE x.currency <> 'THB') u
    LEFT JOIN LATERAL (SELECT (private.fx_rate_row(u.currency, v_open)).*) r ON true;

  -- รายการที่ลงวันที่ก่อน Go-live (นับซ้ำกับยอดตั้งต้น)
  RETURN QUERY
  SELECT 'SYSTEM', x.t, x.id, x.t || ' ' || x.d::text, NULL::text, NULL::numeric, x.d, 'MISSING',
         'มีรายการลงวันที่ก่อน Go-live (ยอดตั้งต้นรวมไว้แล้ว จะนับซ้ำ)'
    FROM (SELECT 'CASH_MOVEMENT' AS t, m.id, m.movement_date AS d FROM public.cash_movements m
           WHERE m.family_id = p_family AND m.deleted_at IS NULL AND m.movement_date < f.go_live_date
          UNION ALL
          SELECT 'INCOME', i.id, i.date FROM public.income_transactions i
           WHERE i.family_id = p_family AND i.deleted_at IS NULL AND i.date < f.go_live_date
          UNION ALL
          SELECT 'EXPENSE', e.id, e.date FROM public.expense_items e
           WHERE e.deleted_at IS NULL AND e.date < f.go_live_date
          UNION ALL
          SELECT 'INVESTMENT_TX', t.id, t.transaction_date FROM public.investment_transactions t
           WHERE t.deleted_at IS NULL AND t.transaction_type <> 'OPENING_BALANCE' AND t.transaction_date < f.go_live_date) x;

  -- สมาชิก / ADMIN
  IF NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.family_id = p_family AND p.deleted_at IS NULL AND p.status = 'ACTIVE') THEN
    RETURN QUERY SELECT 'SYSTEM', 'PERSON', NULL::uuid, 'สมาชิกครอบครัว', NULL::text, NULL::numeric, NULL::date,
                        'MISSING', 'ยังไม่มีสมาชิกครอบครัว';
  END IF;
  IF (SELECT count(*) FROM public.app_users u WHERE u.family_id = p_family AND u.role = 'ADMIN' AND u.status = 'ACTIVE') = 0 THEN
    RETURN QUERY SELECT 'SYSTEM', 'APP_USER', NULL::uuid, 'ADMIN', NULL::text, NULL::numeric, NULL::date,
                        'MISSING', 'ยังไม่มี ADMIN ที่ ACTIVE';
  ELSIF (SELECT count(*) FROM public.app_users u WHERE u.family_id = p_family AND u.role = 'ADMIN' AND u.status = 'ACTIVE') = 1 THEN
    RETURN QUERY SELECT 'SYSTEM', 'APP_USER', NULL::uuid, 'ADMIN สำรอง', NULL::text, NULL::numeric, NULL::date,
                        'WARN', 'มี ADMIN คนเดียว ควรมี ADMIN สำรอง (Admin Recovery Plan)';
  END IF;
END $$;

CREATE VIEW public.v_go_live_readiness WITH (security_invoker = true) AS
  SELECT f.id AS family_id, r.*
    FROM public.families f CROSS JOIN LATERAL private.go_live_readiness(f.id) r
   WHERE f.deleted_at IS NULL AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');

-- ---------------------------------------------------------------------
-- Month Closing Checks (Section 36): หมวดละ 1 บรรทัด READY / REVIEW / BLOCKED
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.month_closing_issues(p_family uuid, p_month date)
RETURNS TABLE (category text, severity text, code text, message text, entity_type text, entity_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m0 date := date_trunc('month', p_month)::date;
  d  date := private.month_end(p_month);
  f public.families;
  v_go_month date;
BEGIN
  IF NOT private.can_read() THEN RETURN; END IF;
  SELECT * INTO f FROM public.families WHERE id = p_family;
  v_go_month := date_trunc('month', f.go_live_date)::date;

  -- FX & ระบบ -----------------------------------------------------------
  IF f.system_status <> 'LIVE' THEN
    RETURN QUERY SELECT 'FX_SYSTEM', 'BLOCKED', 'NOT_LIVE', 'ระบบยังไม่ Confirm Go-live', NULL::text, NULL::uuid;
  END IF;
  IF m0 < v_go_month THEN
    RETURN QUERY SELECT 'FX_SYSTEM', 'BLOCKED', 'BEFORE_GO_LIVE', 'เดือนนี้อยู่ก่อน Go-live', NULL::text, NULL::uuid;
  END IF;
  IF d >= current_date THEN
    RETURN QUERY SELECT 'FX_SYSTEM', 'BLOCKED', 'MONTH_NOT_ENDED', 'เดือนนี้ยังไม่สิ้นสุด', NULL::text, NULL::uuid;
  END IF;
  IF m0 > v_go_month AND NOT EXISTS (SELECT 1 FROM public.net_worth_snapshots s WHERE s.family_id = p_family
        AND s.snapshot_month = (m0 - interval '1 month')::date AND s.status = 'FINAL' AND s.deleted_at IS NULL) THEN
    RETURN QUERY SELECT 'FX_SYSTEM', 'BLOCKED', 'PREVIOUS_NOT_FINAL', 'เดือนก่อนหน้ายังไม่ FINAL', NULL::text, NULL::uuid;
  END IF;
  RETURN QUERY
  SELECT 'FX_SYSTEM', 'BLOCKED', 'FX_STALE',
         'FX ' || s.currency || CASE WHEN r.id IS NULL THEN ' ไม่มี Rate' ELSE ' ล่าสุด ' || r.rate_date::text || ' (เก่ากว่า 5 วัน)' END,
         'FX_RATE', NULL::uuid
    FROM (SELECT DISTINCT n.currency FROM private.net_worth_items(p_family, d, true) n WHERE n.currency <> 'THB') s
    LEFT JOIN LATERAL (SELECT (private.fx_rate_row(s.currency, d)).*) r ON true
   WHERE r.id IS NULL OR d - r.rate_date > 5;
  RETURN QUERY
  SELECT 'FX_SYSTEM', 'BLOCKED', 'MISSING_BASE_AMOUNT', 'รายการ ' || x.t || ' ยังแปลงเป็น THB ไม่ได้ (ไม่มี FX)', x.t, x.id
    FROM (SELECT 'CASH_MOVEMENT' AS t, m.id FROM public.cash_movements m WHERE m.family_id = p_family
             AND m.deleted_at IS NULL AND m.base_amount IS NULL AND m.movement_date BETWEEN m0 AND d
          UNION ALL SELECT 'EXPENSE', e.id FROM public.expense_items e
           WHERE e.deleted_at IS NULL AND e.base_amount IS NULL AND e.date BETWEEN m0 AND d
          UNION ALL SELECT 'INCOME', i.id FROM public.income_transactions i WHERE i.family_id = p_family
             AND i.deleted_at IS NULL AND i.base_amount IS NULL AND i.date BETWEEN m0 AND d
          UNION ALL SELECT 'INVESTMENT_VALUATION', v.id FROM public.investment_valuations v
           WHERE v.deleted_at IS NULL AND v.base_value IS NULL AND v.valuation_date <= d) x;

  -- Cash & Deposits ------------------------------------------------------
  RETURN QUERY
  SELECT 'CASH', CASE WHEN br.status = 'CONFIRMED_WITH_DIFFERENCE' THEN 'REVIEW' ELSE 'BLOCKED' END,
         CASE WHEN br.id IS NULL THEN 'RECON_MISSING' WHEN br.status = 'OPEN' THEN 'RECON_OPEN' ELSE 'RECON_DIFFERENCE' END,
         a.name || CASE WHEN br.id IS NULL THEN ': ยังไม่กระทบยอดสิ้นเดือน'
                        WHEN br.status = 'OPEN' THEN ': กระทบยอดยังไม่ยืนยัน'
                        ELSE ': ยืนยันพร้อมผลต่าง ' || br.difference::text || ' (' || br.difference_reason || ')' END,
         'ASSET', a.id
    FROM public.assets a
    JOIN public.bank_accounts b ON b.asset_id = a.id AND b.deleted_at IS NULL
    LEFT JOIN public.bank_reconciliations br ON br.bank_asset_id = a.id AND br.year_month = m0 AND br.deleted_at IS NULL
   WHERE a.family_id = p_family AND a.deleted_at IS NULL AND a.status = 'ACTIVE'
     AND EXISTS (SELECT 1 FROM public.asset_valuations v WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.valuation_date <= d)
     AND (br.id IS NULL OR br.status <> 'RECONCILED');

  -- Investments ----------------------------------------------------------
  RETURN QUERY
  SELECT 'INVESTMENTS',
         CASE WHEN hv.has_valuation THEN 'REVIEW' WHEN hv.average_cost IS NULL THEN 'BLOCKED' ELSE 'REVIEW' END,
         CASE WHEN hv.has_valuation THEN 'PRICE_OLD' WHEN hv.average_cost IS NULL THEN 'NO_PRICE' ELSE 'COST_ONLY' END,
         pa.name || ' · ' || h.name || CASE WHEN hv.has_valuation THEN ': ราคาล่าสุด ' || hv.value_date::text || ' เก่ากว่า 30 วัน'
                                         WHEN hv.average_cost IS NULL THEN ': ไม่มีราคาเลย'
                                         ELSE ': ใช้ราคาทุน · รอ Statement' END,
         'HOLDING', h.id
    FROM public.investment_holdings h
    JOIN public.investment_portfolios p ON p.id = h.portfolio_id AND p.deleted_at IS NULL
    JOIN public.assets pa ON pa.id = p.asset_id AND pa.deleted_at IS NULL AND pa.family_id = p_family
    CROSS JOIN LATERAL private.holding_value_at(h.id, d) hv
   WHERE h.deleted_at IS NULL AND h.holding_type <> 'CASH' AND hv.quantity > 0
     AND (NOT hv.has_valuation OR hv.value_date < d - 30);
  RETURN QUERY
  SELECT 'INVESTMENTS', 'REVIEW', 'IN_TRANSIT', a.name || ': มีเงินระหว่างทาง ' || it.v::text || ' (รอ Statement)', 'ASSET', a.id
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
    CROSS JOIN LATERAL (SELECT private.portfolio_in_transit(p.id, d) AS v) it
   WHERE a.family_id = p_family AND p.deleted_at IS NULL AND a.deleted_at IS NULL AND it.v <> 0;
  RETURN QUERY
  SELECT 'INVESTMENTS', 'REVIEW', 'UNSETTLED', t.transaction_type || ' ' || t.transaction_date::text
         || ' settle ' || t.settlement_date::text || ' (ข้ามเดือน)', 'INVESTMENT_TX', t.id
    FROM public.investment_transactions t JOIN public.investment_portfolios p ON p.id = t.portfolio_id
    JOIN public.assets a ON a.id = p.asset_id AND a.family_id = p_family
   WHERE t.deleted_at IS NULL AND (t.settle_from_asset_id IS NOT NULL OR t.settle_to_asset_id IS NOT NULL)
     AND t.transaction_date <= d AND t.settlement_date > d;

  -- Property / Alternative / Business / Insurance CV ----------------------
  RETURN QUERY
  SELECT 'PROPERTY_OTHER', 'REVIEW', 'VALUE_OLD',
         a.name || coalesce(': มูลค่าล่าสุด ' || v.valuation_date::text || ' เก่ากว่า 90 วัน (Carry Forward)', ': ไม่มีมูลค่า'),
         'ASSET', a.id
    FROM public.assets a
    LEFT JOIN LATERAL (SELECT (private.latest_asset_valuation(a.id, d)).*) v ON true
   WHERE a.family_id = p_family AND a.deleted_at IS NULL AND a.status = 'ACTIVE'
     AND a.asset_type NOT IN ('INVESTMENT_PORTFOLIO','LOAN_RECEIVABLE') AND NOT private.is_bank_asset(a.id)
     AND (a.acquisition_date IS NULL OR a.acquisition_date <= d)
     AND (v.id IS NULL OR v.valuation_date < d - 90);
  RETURN QUERY
  SELECT 'PROPERTY_OTHER', 'REVIEW', 'DEPOSIT_REFUND_OVERDUE',
         concat_ws(' · ', a.name, l.unit_label, l.tenant_name) || ': เงินประกันเลยกำหนดคืน '
           || coalesce(l.terminated_date, l.end_date)::text, 'PROPERTY_LEASE', l.id
    FROM public.property_leases l JOIN public.property_details pd ON pd.id = l.property_id
    JOIN public.assets a ON a.id = pd.asset_id AND a.family_id = p_family
   WHERE l.deleted_at IS NULL AND coalesce(l.security_deposit, 0) > 0
     AND coalesce(l.terminated_date, l.end_date) < d
     AND (l.deposit_settled_date IS NULL OR l.deposit_settled_date > d);

  -- Liabilities / Credit Cards ------------------------------------------
  RETURN QUERY
  SELECT 'LIABILITIES', CASE WHEN v.id IS NULL THEN 'BLOCKED' ELSE 'REVIEW' END,
         CASE WHEN v.id IS NULL THEN 'NO_BALANCE' ELSE 'BALANCE_OLD' END,
         l.name || CASE WHEN v.id IS NULL THEN ': ยังไม่มียอดคงค้าง'
                        ELSE ': ยอดล่าสุด ' || v.valuation_date::text || ' (Carry Forward)' END,
         'LIABILITY', l.id
    FROM public.liabilities l
    LEFT JOIN LATERAL (SELECT x.* FROM public.liability_valuations x WHERE x.liability_id = l.id
                        AND x.deleted_at IS NULL AND x.valuation_date <= d
                        ORDER BY x.valuation_date DESC LIMIT 1) v ON true
   WHERE l.family_id = p_family AND l.deleted_at IS NULL AND l.status = 'ACTIVE'
     AND (v.id IS NULL OR v.valuation_date < m0);
  RETURN QUERY
  SELECT 'LIABILITIES', 'REVIEW',
         CASE WHEN c.balance_date IS NULL OR c.balance_date < m0 THEN 'CARD_BALANCE_OLD' ELSE 'CARD_PAID_NOT_UPDATED' END,
         concat_ws(' ', c.issuer, c.card_name, '••' || c.card_last4) ||
         CASE WHEN c.balance_date IS NULL OR c.balance_date < m0 THEN ': ยอดบัตรยังไม่อัปเดตในเดือนนี้'
              ELSE ': จ่ายบัตรหลังวันที่ของยอดแล้ว แต่ยังไม่อัปเดตยอด (หนี้สูงเกินจริง)' END,
         'CREDIT_CARD', c.id
    FROM public.credit_cards c JOIN public.persons p ON p.id = c.person_id AND p.family_id = p_family
   WHERE c.deleted_at IS NULL AND c.status = 'ACTIVE'
     AND (c.balance_date IS NULL OR c.balance_date < m0
          OR EXISTS (SELECT 1 FROM public.cash_movements m WHERE m.to_credit_card_id = c.id AND m.deleted_at IS NULL
                      AND m.movement_date > c.balance_date AND m.movement_date <= d));

  RETURN QUERY
  SELECT 'LIABILITIES', 'REVIEW', 'CARD_BALANCE_UNKNOWN',
         concat_ws(' ', c.issuer, c.card_name, '••' || c.card_last4) || ': ไม่มียอดบัตร ณ สิ้นเดือน (ยอดแรกที่บันทึกลงวันที่หลังสิ้นเดือน) — ไม่ถูกนับเป็นหนี้',
         'CREDIT_CARD', c.id
    FROM public.credit_cards c JOIN public.persons p ON p.id = c.person_id AND p.family_id = p_family
   WHERE c.deleted_at IS NULL AND c.outstanding_balance > 0
     AND NOT EXISTS (SELECT 1 FROM private.net_worth_items(p_family, d, true) n WHERE n.credit_card_id = c.id);

  -- Income & Expenses ----------------------------------------------------
  RETURN QUERY
  SELECT 'INCOME_EXPENSES', 'REVIEW', 'EXPECTED_OVERDUE',
         e.name || ' งวด ' || to_char(e.income_period, 'YYYY-MM') || ': ยังไม่ได้รับ', e.source_type, e.source_id
    FROM public.v_expected_income e
   WHERE e.family_id = p_family AND e.status = 'OVERDUE' AND e.due_date <= d;
  RETURN QUERY
  SELECT 'INCOME_EXPENSES', 'REVIEW', 'EXPENSE_' || coalesce(me.tracking_status, 'NOT_TRACKED'),
         'ค่าใช้จ่ายเดือนนี้: ' || CASE coalesce(me.tracking_status, 'NOT_TRACKED')
                                   WHEN 'NOT_TRACKED' THEN 'ไม่ได้บันทึก' ELSE 'บันทึกไม่ครบ (PARTIAL)' END,
         'MONTHLY_EXPENSE', me.id
    FROM (SELECT 1) one
    LEFT JOIN public.monthly_expenses me ON me.family_id = p_family AND me.year_month = m0 AND me.deleted_at IS NULL
   WHERE coalesce(me.tracking_status, 'NOT_TRACKED') <> 'COMPLETE';

  -- Ownership --------------------------------------------------------------
  RETURN QUERY
  SELECT 'OWNERSHIP', 'REVIEW', 'UNALLOCATED',
         n.item_name || ': ยังไม่ระบุเจ้าของ ' || n.ownership_percent::text || '%',
         CASE WHEN n.asset_id IS NOT NULL THEN 'ASSET' ELSE 'LIABILITY' END, coalesce(n.asset_id, n.liability_id, n.lease_id)
    FROM private.net_worth_items(p_family, d, true) n
   WHERE n.person_id IS NULL AND n.item_subtype NOT IN ('IN_TRANSIT','UNSETTLED_PAYABLE','UNSETTLED_RECEIVABLE');
END $$;

-- สรุปต่อหมวด (หน้า Month Closing)
CREATE OR REPLACE FUNCTION public.month_closing_checks(p_month date)
RETURNS TABLE (category text, status text, issue_count integer, issues jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_family uuid := private.default_family_id();
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  RETURN QUERY
  WITH cats(category, ord) AS (VALUES ('CASH',1),('INVESTMENTS',2),('PROPERTY_OTHER',3),('LIABILITIES',4),
                                      ('INCOME_EXPENSES',5),('OWNERSHIP',6),('FX_SYSTEM',7)),
       iss AS (SELECT * FROM private.month_closing_issues(v_family, p_month))
  SELECT c.category,
         CASE WHEN bool_or(i.severity = 'BLOCKED') THEN 'BLOCKED'
              WHEN bool_or(i.severity = 'REVIEW') THEN 'REVIEW' ELSE 'READY' END,
         count(i.code)::int,
         coalesce(jsonb_agg(jsonb_build_object('severity', i.severity, 'code', i.code, 'message', i.message,
                                               'entity_type', i.entity_type, 'entity_id', i.entity_id))
                  FILTER (WHERE i.code IS NOT NULL), '[]'::jsonb)
    FROM cats c LEFT JOIN iss i ON i.category = c.category
   GROUP BY c.category, c.ord ORDER BY c.ord;
END $$;
