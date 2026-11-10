-- =====================================================================
-- ค่าธรรมเนียมในพอร์ตลงทุน → รายจ่าย "ค่าธรรมเนียมธนาคาร" อัตโนมัติ (owner, 10 พ.ย. 2026)
--   เดิม: ค่าธรรมเนียมที่ติดมากับคูปอง / ปันผล / ดอกเบี้ยในพอร์ต ถูกหักจากเงินที่เข้าพอร์ต (ยอดสุทธิถูก)
--         แต่หน้า Income & Expenses เห็นแค่รายได้เต็ม ไม่มีรายจ่ายค่าธรรมเนียม → รายได้ในรายงานสูงกว่าเงินที่ได้จริง
--   ใหม่: ระบบสร้างรายจ่ายหมวด BANK_FEE ให้เอง 1 แถวต่อรายการในพอร์ต (แก้ / ลบที่รายการต้นทางในพอร์ต)
--     · คูปอง / ปันผล / ดอกเบี้ย (fee)          · แลกเงินในพอร์ต / โอนระหว่างบัญชีในพอร์ต (fee)
--     · รายการ "ค่าธรรมเนียม" ของพอร์ต (FEE · ยอดทั้งรายการ)
--     ไม่รวม: ซื้อ (ค่าธรรมเนียมเป็นต้นทุน) · ขาย / ไถ่ถอน / ครบกำหนด (หักจากเงินที่ได้ = กำไรขาดทุน) · ภาษี (TAX)
--   รายจ่ายนี้ไม่หักเงินซ้ำ (ไม่มีบัญชีที่จ่าย) เหมือนค่าธรรมเนียมจากรายการโอนเงิน (source_cash_movement_id)
--   แบ่งรายคนตามเจ้าของพอร์ต (related_asset_id = พอร์ต)
--   รายการเดิมที่มีค่าธรรมเนียมแล้ว: สร้างรายจ่ายย้อนหลังให้ท้ายไฟล์
-- =====================================================================

-- 1) คอลัมน์ต้นทาง + กันแก้จากหน้าเว็บ ------------------------------------------------------------
ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS source_investment_tx_id uuid REFERENCES public.investment_transactions(id);
CREATE UNIQUE INDEX IF NOT EXISTS expense_items_source_itx_uq ON public.expense_items(source_investment_tx_id)
  WHERE source_investment_tx_id IS NOT NULL;
ALTER TABLE public.expense_items DROP CONSTRAINT IF EXISTS exp_derived_itx;
ALTER TABLE public.expense_items ADD CONSTRAINT exp_derived_itx CHECK (source_investment_tx_id IS NULL OR (
  source_cash_movement_id IS NULL AND paid_from_asset_id IS NULL AND paid_from_credit_card_id IS NULL
  AND paid_from_cash_holding_id IS NULL AND person_id IS NULL AND liability_id IS NULL
  AND expense_category = 'BANK_FEE'));
DROP TRIGGER IF EXISTS t32_investment_fee ON public.expense_items;
CREATE TRIGGER t32_investment_fee BEFORE INSERT OR UPDATE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_derived_guard('source_investment_tx_id');

-- 2) สร้าง / แก้ / ลบ รายจ่ายค่าธรรมเนียมตามรายการในพอร์ต ---------------------------------------------
CREATE OR REPLACE FUNCTION private.sync_itx_fee_expense(p_tx uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.investment_transactions; e public.expense_items;
  v_asset uuid; v_family uuid; v_pf text; v_h text; v_fee numeric; v_desc text; v_monthly uuid;
BEGIN
  SELECT * INTO t FROM public.investment_transactions WHERE id = p_tx;
  SELECT * INTO e FROM public.expense_items WHERE source_investment_tx_id = p_tx;
  IF t.id IS NOT NULL AND t.deleted_at IS NULL THEN
    v_fee := CASE WHEN t.transaction_type IN ('DIVIDEND','INTEREST','COUPON','FX_EXCHANGE','CASH_TRANSFER') THEN t.fee
                  WHEN t.transaction_type = 'FEE' THEN t.amount END;
  END IF;

  IF coalesce(v_fee, 0) > 0 THEN
    SELECT p.asset_id, a.family_id, a.name INTO v_asset, v_family, v_pf
      FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id WHERE p.id = t.portfolio_id;
    SELECT h.name INTO v_h FROM public.investment_holdings h WHERE h.id = t.holding_id AND h.holding_type <> 'CASH';
    v_desc := CASE t.transaction_type
                WHEN 'COUPON'        THEN 'ค่าธรรมเนียมรับคูปอง'
                WHEN 'DIVIDEND'      THEN 'ค่าธรรมเนียมรับปันผล'
                WHEN 'INTEREST'      THEN 'ค่าธรรมเนียมรับดอกเบี้ย'
                WHEN 'FX_EXCHANGE'   THEN 'ค่าธรรมเนียมแลกเงินในพอร์ต'
                WHEN 'CASH_TRANSFER' THEN 'ค่าธรรมเนียมโอนระหว่างบัญชีในพอร์ต'
                ELSE 'ค่าธรรมเนียมพอร์ตลงทุน' END
              || coalesce(' · ' || v_h, '') || ' · ' || v_pf;
    v_monthly := private.ensure_monthly_expense(v_family, t.transaction_date);
    IF e.id IS NULL THEN
      INSERT INTO public.expense_items(monthly_expense_id, related_asset_id, date, description, amount, currency,
                                       expense_category, source_investment_tx_id)
      VALUES (v_monthly, v_asset, t.transaction_date, v_desc, v_fee, t.currency, 'BANK_FEE', t.id);
    ELSIF (e.monthly_expense_id, e.related_asset_id, e.date, e.description, e.amount, e.currency, e.deleted_at IS NULL)
          IS DISTINCT FROM (v_monthly, v_asset, t.transaction_date, v_desc, v_fee::numeric(20,4), t.currency, true) THEN
      UPDATE public.expense_items SET monthly_expense_id = v_monthly, related_asset_id = v_asset, date = t.transaction_date,
             description = v_desc, amount = v_fee, currency = t.currency, deleted_at = NULL
       WHERE id = e.id;
    END IF;
  ELSIF e.id IS NOT NULL AND e.deleted_at IS NULL THEN
    UPDATE public.expense_items SET deleted_at = now() WHERE id = e.id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.sync_itx_fee_expense(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.tg_itx_fee_expense() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.sync_itx_fee_expense(OLD.id);
  ELSIF TG_OP = 'INSERT'
     OR (OLD.transaction_type, OLD.transaction_date, OLD.fee, OLD.amount, OLD.currency, OLD.holding_id, OLD.portfolio_id, OLD.deleted_at)
        IS DISTINCT FROM (NEW.transaction_type, NEW.transaction_date, NEW.fee, NEW.amount, NEW.currency, NEW.holding_id, NEW.portfolio_id, NEW.deleted_at) THEN
    PERFORM private.sync_itx_fee_expense(NEW.id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.tg_itx_fee_expense() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a55_fee_expense ON public.investment_transactions;
CREATE TRIGGER a55_fee_expense AFTER INSERT OR UPDATE OR DELETE ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_itx_fee_expense();

-- 3) รายจ่ายจากระบบ: ไม่สร้างรายการเงินออกจากบัญชี · ไม่นับเป็น "บันทึกเอง" -------------------------------
CREATE OR REPLACE FUNCTION private.tg_expense_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.expense_items := coalesce(NEW, OLD); v_family uuid;
BEGIN
  SELECT family_id INTO v_family FROM public.monthly_expenses WHERE id = i.monthly_expense_id;
  IF i.source_cash_movement_id IS NULL AND i.source_investment_tx_id IS NULL THEN
    PERFORM private.sync_derived_movement('EXPENSE', i.id,
      TG_OP <> 'DELETE' AND NEW.deleted_at IS NULL AND i.paid_from_asset_id IS NOT NULL,
      v_family, i.date, 'EXPENSE', i.paid_from_asset_id, NULL, i.amount, i.currency, i.description);
    -- Item แรกที่ผู้ใช้บันทึกเอง: NOT_TRACKED → PARTIAL (Section 25 Expense Optional)
    IF TG_OP = 'INSERT' THEN
      UPDATE public.monthly_expenses SET tracking_status = 'PARTIAL'
       WHERE id = i.monthly_expense_id AND tracking_status = 'NOT_TRACKED';
    END IF;
  END IF;
  PERFORM private.sync_expense_payment(i.id);              -- จ่ายจากบัญชีเงินฝากในพอร์ต → รายการ PAYMENT ในพอร์ต
  PERFORM private.refresh_monthly_expense(i.monthly_expense_id);
  IF TG_OP = 'UPDATE' AND OLD.monthly_expense_id <> NEW.monthly_expense_id THEN
    PERFORM private.refresh_monthly_expense(OLD.monthly_expense_id);
  END IF;
  RETURN NULL;
END $$;

-- 4) ค่าใช้จ่ายรายบุคคล: ค่าธรรมเนียมในพอร์ต → ตามเจ้าของพอร์ต -----------------------------------------------
CREATE OR REPLACE VIEW public.v_expense_by_person WITH (security_invoker = true) AS
  SELECT i.id AS expense_item_id, me.family_id, me.year_month, i.date, i.expense_category, i.currency,
         (i.source_cash_movement_id IS NOT NULL OR i.source_investment_tx_id IS NOT NULL) AS is_derived_fee,
         sh.person_id, sh.pct AS share_percent,
         round(i.amount * sh.pct / 100, 4) AS amount_share,
         round(i.base_amount * sh.pct / 100, 4) AS base_amount_share
    FROM public.expense_items i
    JOIN public.monthly_expenses me ON me.id = i.monthly_expense_id
    LEFT JOIN public.cash_movements src ON src.id = i.source_cash_movement_id
    LEFT JOIN public.investment_holdings ph ON ph.id = i.paid_from_cash_holding_id
    LEFT JOIN public.investment_portfolios pp ON pp.id = ph.portfolio_id
    CROSS JOIN LATERAL private.expense_shares(i.person_id, i.paid_from_credit_card_id,
      coalesce(i.paid_from_asset_id, src.from_asset_id, pp.asset_id,
               CASE WHEN i.source_investment_tx_id IS NOT NULL THEN i.related_asset_id END), i.date, i.liability_id) sh
   WHERE i.deleted_at IS NULL AND me.deleted_at IS NULL AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');

-- 5) Dashboard รายคน: กติกาเดียวกับ v_expense_by_person ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.person_dashboard(p_month date, p_person uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_family uuid := private.default_family_id();
  f public.families;
  m0 date := date_trunc('month', p_month)::date;
  d date := private.month_end(p_month);
  v_as_of date;
  v_open numeric; v_open_a numeric; v_open_l numeric; v_prev numeric; v_prev_label text; v_prev_date date;
  v_inc numeric; v_inv numeric; v_exp numeric; v_reimb numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  SELECT * INTO f FROM public.families WHERE id = v_family;
  v_as_of := CASE WHEN d < current_date THEN d ELSE current_date END;

  -- ยอดตั้งต้นของคนนี้ (แยกสินทรัพย์ / หนี้สิน → เส้นเล็กในการ์ด · 2 พ.ย. 2026)
  SELECT coalesce(sum(n.base_value) FILTER (WHERE n.item_type = 'ASSET'), 0),
         coalesce(sum(n.base_value) FILTER (WHERE n.item_type <> 'ASSET'), 0)
    INTO v_open_a, v_open_l
    FROM private.net_worth_items(v_family, f.go_live_date - 1, true) n
   WHERE n.person_id = p_person;
  v_open := v_open_a - v_open_l;

  -- ยอดงวดก่อน: Snapshot FINAL เดือนก่อน → ไม่มีและเป็นเดือน Go-live = ยอดตั้งต้น
  SELECT s.snapshot_date,
         coalesce((SELECT sum(CASE WHEN i.item_type = 'ASSET' THEN i.base_value ELSE -i.base_value END)
                     FROM public.net_worth_snapshot_items i WHERE i.snapshot_id = s.id AND i.person_id = p_person), 0)
    INTO v_prev_date, v_prev
    FROM public.net_worth_snapshots s
   WHERE s.family_id = v_family AND s.snapshot_month = (m0 - interval '1 month')::date
     AND s.status = 'FINAL' AND s.deleted_at IS NULL;
  IF v_prev_date IS NOT NULL THEN
    v_prev_label := 'ยอดปิดเดือนก่อน';
  ELSIF EXISTS (SELECT 1 FROM private.month_points(v_family) x
                 WHERE x.snapshot_month = (m0 - interval '1 month')::date AND x.status = 'AUTO') THEN
    SELECT coalesce((x.by_person ->> p_person::text)::numeric, 0), x.snapshot_date INTO v_prev, v_prev_date
      FROM private.month_points(v_family) x
     WHERE x.snapshot_month = (m0 - interval '1 month')::date AND x.status = 'AUTO';
    v_prev_label := 'ยอดสิ้นเดือนก่อน (อัตโนมัติ)';
  ELSIF m0 = date_trunc('month', f.go_live_date)::date THEN
    v_prev := v_open; v_prev_date := f.go_live_date - 1;
    v_prev_label := 'ยอดตั้งต้น (Opening Position)';
  ELSE
    v_prev := NULL;
  END IF;

  -- รายได้หลังภาษี (แยกรายได้ลงทุน) ส่วนของคนนี้ — กติกาเดียวกับ v_income_by_person
  SELECT coalesce(sum(x.net * x.pct / 100) FILTER (WHERE NOT x.inv), 0), coalesce(sum(x.net * x.pct / 100) FILTER (WHERE x.inv), 0)
    INTO v_inc, v_inv
    FROM (SELECT i.base_amount * (1 - coalesce(i.tax, 0) / nullif(i.amount, 0)) AS net,
                 i.source_transaction_id IS NOT NULL AS inv, sh.pct
            FROM public.income_transactions i
            CROSS JOIN LATERAL private.income_shares(i.person_id, i.asset_id, i.received_to_asset_id, i.date, i.received_to_liability_id) sh
           WHERE i.family_id = v_family AND i.deleted_at IS NULL AND i.date BETWEEN m0 AND v_as_of
             AND sh.person_id = p_person) x;

  -- ค่าใช้จ่าย / เงินคืน ส่วนของคนนี้ — กติกาเดียวกับ v_expense_by_person
  SELECT coalesce(sum(e.base_amount * sh.pct / 100), 0) INTO v_exp
    FROM public.expense_items e
    JOIN public.monthly_expenses me ON me.id = e.monthly_expense_id AND me.family_id = v_family
    LEFT JOIN public.cash_movements src ON src.id = e.source_cash_movement_id
    CROSS JOIN LATERAL private.expense_shares(e.person_id, e.paid_from_credit_card_id, coalesce(e.paid_from_asset_id, src.from_asset_id,
                                                      CASE WHEN e.source_investment_tx_id IS NOT NULL THEN e.related_asset_id END), e.date, e.liability_id) sh
   WHERE e.deleted_at IS NULL AND e.date BETWEEN m0 AND v_as_of AND sh.person_id = p_person;
  SELECT coalesce(sum(x.amount * coalesce(private.fx_rate(x.currency, x.received_date), 0) * sh.pct / 100), 0) INTO v_reimb
    FROM public.expense_reimbursements x
    JOIN public.expense_items e ON e.id = x.expense_item_id
    JOIN public.monthly_expenses me ON me.id = e.monthly_expense_id AND me.family_id = v_family
    LEFT JOIN public.cash_movements src ON src.id = e.source_cash_movement_id
    CROSS JOIN LATERAL private.expense_shares(e.person_id, e.paid_from_credit_card_id, coalesce(e.paid_from_asset_id, src.from_asset_id,
                                                      CASE WHEN e.source_investment_tx_id IS NOT NULL THEN e.related_asset_id END), e.date, e.liability_id) sh
   WHERE x.deleted_at IS NULL AND x.received_date BETWEEN m0 AND v_as_of AND sh.person_id = p_person;

  RETURN jsonb_build_object(
    'opening', jsonb_build_object('date', f.go_live_date - 1, 'total_assets', v_open_a, 'total_liabilities', v_open_l,
                                  'net_worth', v_open),
    'snapshots', coalesce((SELECT jsonb_agg(jsonb_build_object('month', x.snapshot_month, 'date', x.snapshot_date,
                     'status', x.status, 'total_assets', x.total_assets, 'total_liabilities', x.total_liabilities,
                     'net_worth', x.net_worth)
                     ORDER BY x.snapshot_month)
                   FROM private.month_points_person(v_family, p_person) x), '[]'::jsonb),
    'prev_net_worth', v_prev, 'prev_label', v_prev_label, 'prev_date', v_prev_date,
    'income', round(v_inc, 2), 'investment_income', round(v_inv, 2),
    'expenses', round(v_exp, 2), 'reimbursements', round(v_reimb, 2));
END $$;
REVOKE ALL ON FUNCTION public.person_dashboard(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.person_dashboard(date, uuid) TO authenticated;


-- 6) รายการเดิมที่มีค่าธรรมเนียมแล้ว → สร้างรายจ่ายย้อนหลัง (รันซ้ำได้ ไม่สร้างซ้ำ) -----------------------------
DO $$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN SELECT id FROM public.investment_transactions
            WHERE deleted_at IS NULL
              AND ((transaction_type IN ('DIVIDEND','INTEREST','COUPON','FX_EXCHANGE','CASH_TRANSFER') AND coalesce(fee, 0) > 0)
                OR (transaction_type = 'FEE' AND coalesce(amount, 0) > 0))
              AND NOT EXISTS (SELECT 1 FROM public.expense_items e WHERE e.source_investment_tx_id = investment_transactions.id
                                 AND e.deleted_at IS NULL)
  LOOP
    PERFORM private.sync_itx_fee_expense(r.id);
    v_n := v_n + 1;
  END LOOP;
  IF v_n > 0 THEN   -- ให้หน้าที่จำผลไว้ (Dashboard / Income & Expenses) คำนวณใหม่
    INSERT INTO public.system_job_runs(job_type, result, finished_at, details)
    VALUES ('MONTH_AUTO', 'SUCCESS', now(), jsonb_build_object('investment_fee_expenses', v_n));
  END IF;
END $$;
