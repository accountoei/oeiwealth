-- 1) แยกรายได้ / ค่าใช้จ่ายรายคน — กติกาเดียวกันทุกหน้า (Dashboard รายคน · ตัวกรองรายคนในหน้า Income & Expenses)
--    ค่าใช้จ่าย: ระบุคนเอง → บัตรเครดิต (เจ้าของบัตร) → บัญชีที่จ่าย (สัดส่วนเจ้าของบัญชี) → ส่วนกลาง
--    รายได้:    ระบุคนเอง → ทรัพย์สินที่ทำให้เกิดรายได้ (สัดส่วนเจ้าของ) → บัญชีที่รับเงิน (สัดส่วนเจ้าของบัญชี) → ส่วนกลาง
-- 2) จ่ายหนี้ แยกเงินต้น / ดอกเบี้ย (pay_liability): เงินต้นลดยอดหนี้ · ดอกเบี้ยเป็นค่าใช้จ่าย "ดอกเบี้ยจ่าย"
--    ยอดหนี้ = ยอดล่าสุดที่บันทึก (Statement / ยอดตั้งต้น) − เงินต้นที่จ่ายหลังวันที่ของยอดนั้น
-- 3) บัตรเครดิตตัดบัญชีอัตโนมัติ: ตั้งค่าบัญชีที่ตัด + เต็มจำนวน / ขั้นต่ำ · ถึงวันครบกำหนดหน้าจอแสดง "รอยืนยัน"
--    กดยืนยัน → pay_credit_card บันทึกจ่ายบัตร (และหักยอดบัตรตามที่จ่าย)

-- =====================================================================
-- 1) ส่วนแบ่งรายคน
-- =====================================================================
-- ระบุคนเองได้แม้จ่ายจากบัญชี / บัตร (เช่น จ่ายจากบัญชีพ่อ เป็นค่าเรียนของลูก)
ALTER TABLE public.expense_items DROP CONSTRAINT IF EXISTS exp_owner_source;

CREATE OR REPLACE FUNCTION private.expense_shares(p_person uuid, p_card uuid, p_asset uuid, p_date date)
RETURNS TABLE (person_id uuid, pct numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p_person, 100::numeric WHERE p_person IS NOT NULL
  UNION ALL
  SELECT c.person_id, 100::numeric FROM public.credit_cards c WHERE p_person IS NULL AND c.id = p_card
  UNION ALL
  SELECT o.person_id, o.pct FROM private.asset_owner_shares(p_asset, p_date) o
   WHERE p_person IS NULL AND p_card IS NULL AND p_asset IS NOT NULL
  UNION ALL
  SELECT NULL::uuid, 100::numeric WHERE p_person IS NULL AND p_card IS NULL AND p_asset IS NULL
$$;

CREATE OR REPLACE FUNCTION private.income_shares(p_person uuid, p_asset uuid, p_received uuid, p_date date)
RETURNS TABLE (person_id uuid, pct numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p_person, 100::numeric WHERE p_person IS NOT NULL
  UNION ALL
  SELECT o.person_id, o.pct FROM private.asset_owner_shares(p_asset, p_date) o
   WHERE p_person IS NULL AND p_asset IS NOT NULL
  UNION ALL
  SELECT o.person_id, o.pct FROM private.asset_owner_shares(p_received, p_date) o
   WHERE p_person IS NULL AND p_asset IS NULL AND p_received IS NOT NULL
  UNION ALL
  SELECT NULL::uuid, 100::numeric WHERE p_person IS NULL AND p_asset IS NULL AND p_received IS NULL
$$;

CREATE OR REPLACE VIEW public.v_income_by_person WITH (security_invoker = true) AS
  SELECT i.id AS income_id, i.family_id, i.date, i.income_type, i.currency,
         (i.source_transaction_id IS NOT NULL) AS is_investment_income,
         sh.person_id, sh.pct AS share_percent,
         round(i.amount * sh.pct / 100, 4) AS amount_share,
         round(coalesce(i.tax, 0) * sh.pct / 100, 4) AS tax_share,
         round(i.base_amount * sh.pct / 100, 4) AS base_amount_share
    FROM public.income_transactions i
    CROSS JOIN LATERAL private.income_shares(i.person_id, i.asset_id, i.received_to_asset_id, i.date) sh
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
    CROSS JOIN LATERAL private.expense_shares(i.person_id, i.paid_from_credit_card_id,
                                              coalesce(i.paid_from_asset_id, src.from_asset_id), i.date) sh
   WHERE i.deleted_at IS NULL AND me.deleted_at IS NULL
     AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');

CREATE OR REPLACE FUNCTION public.person_dashboard(p_month date, p_person uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_family uuid := private.default_family_id();
  f public.families;
  m0 date := date_trunc('month', p_month)::date;
  d date := private.month_end(p_month);
  v_as_of date;
  v_open numeric; v_prev numeric; v_prev_label text; v_prev_date date;
  v_inc numeric; v_inv numeric; v_exp numeric; v_reimb numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  SELECT * INTO f FROM public.families WHERE id = v_family;
  v_as_of := CASE WHEN d < current_date THEN d ELSE current_date END;

  -- ยอดตั้งต้นของคนนี้
  SELECT coalesce(sum(CASE WHEN n.item_type = 'ASSET' THEN n.base_value ELSE -n.base_value END), 0) INTO v_open
    FROM private.net_worth_items(v_family, f.go_live_date - 1, true) n
   WHERE n.person_id = p_person;

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
            CROSS JOIN LATERAL private.income_shares(i.person_id, i.asset_id, i.received_to_asset_id, i.date) sh
           WHERE i.family_id = v_family AND i.deleted_at IS NULL AND i.date BETWEEN m0 AND v_as_of
             AND sh.person_id = p_person) x;

  -- ค่าใช้จ่าย / เงินคืน ส่วนของคนนี้ — กติกาเดียวกับ v_expense_by_person
  SELECT coalesce(sum(e.base_amount * sh.pct / 100), 0) INTO v_exp
    FROM public.expense_items e
    JOIN public.monthly_expenses me ON me.id = e.monthly_expense_id AND me.family_id = v_family
    LEFT JOIN public.cash_movements src ON src.id = e.source_cash_movement_id
    CROSS JOIN LATERAL private.expense_shares(e.person_id, e.paid_from_credit_card_id, coalesce(e.paid_from_asset_id, src.from_asset_id), e.date) sh
   WHERE e.deleted_at IS NULL AND e.date BETWEEN m0 AND v_as_of AND sh.person_id = p_person;
  SELECT coalesce(sum(x.amount * coalesce(private.fx_rate(x.currency, x.received_date), 0) * sh.pct / 100), 0) INTO v_reimb
    FROM public.expense_reimbursements x
    JOIN public.expense_items e ON e.id = x.expense_item_id
    JOIN public.monthly_expenses me ON me.id = e.monthly_expense_id AND me.family_id = v_family
    LEFT JOIN public.cash_movements src ON src.id = e.source_cash_movement_id
    CROSS JOIN LATERAL private.expense_shares(e.person_id, e.paid_from_credit_card_id, coalesce(e.paid_from_asset_id, src.from_asset_id), e.date) sh
   WHERE x.deleted_at IS NULL AND x.received_date BETWEEN m0 AND v_as_of AND sh.person_id = p_person;

  RETURN jsonb_build_object(
    'opening', jsonb_build_object('date', f.go_live_date - 1, 'net_worth', v_open),
    'snapshots', coalesce((SELECT jsonb_agg(jsonb_build_object('month', s.snapshot_month, 'date', s.snapshot_date, 'status', s.status,
                     'net_worth', coalesce((SELECT sum(CASE WHEN i.item_type = 'ASSET' THEN i.base_value ELSE -i.base_value END)
                                              FROM public.net_worth_snapshot_items i WHERE i.snapshot_id = s.id AND i.person_id = p_person), 0))
                     ORDER BY s.snapshot_month)
                   FROM public.net_worth_snapshots s
                  WHERE s.family_id = v_family AND s.deleted_at IS NULL AND s.finalized_at IS NOT NULL), '[]'::jsonb),
    'prev_net_worth', v_prev, 'prev_label', v_prev_label, 'prev_date', v_prev_date,
    'income', round(v_inc, 2), 'investment_income', round(v_inv, 2),
    'expenses', round(v_exp, 2), 'reimbursements', round(v_reimb, 2));
END $$;
REVOKE ALL ON FUNCTION public.person_dashboard(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.person_dashboard(date, uuid) TO authenticated;

-- บันทึกค่าใช้จ่าย: ระบุ "ของใคร" ได้ทุกวิธีจ่าย
CREATE OR REPLACE FUNCTION public.add_expense(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_date date := nullif(p->>'date', '')::date; v_id uuid; v_ccy text; v_bank uuid; v_card uuid;
        v_util uuid := nullif(p->>'property_utility_id', '')::uuid; v_period date; v_related uuid;
        v_ins uuid := nullif(p->>'insurance_schedule_line_id', '')::uuid; v_cat text := nullif(trim(p->>'expense_category'), '');
BEGIN
  IF v_date IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่วันที่' USING ERRCODE = '22023'; END IF;
  IF v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่เป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p->>'description', ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่รายละเอียด' USING ERRCODE = '22023';
  END IF;
  v_bank := nullif(p->>'paid_from_asset_id', '')::uuid;
  v_card := nullif(p->>'paid_from_credit_card_id', '')::uuid;
  v_ccy := upper(coalesce(nullif(p->>'currency', ''), 'THB'));
  IF v_bank IS NOT NULL THEN SELECT currency INTO v_ccy FROM public.assets WHERE id = v_bank; END IF;
  IF v_card IS NOT NULL THEN SELECT currency INTO v_ccy FROM public.credit_cards WHERE id = v_card; END IF;
  v_related := nullif(p->>'related_asset_id', '')::uuid;

  -- เบี้ยประกันตามตาราง: ต้องเป็นงวดเบี้ย (PREMIUM) ของกรมธรรม์ที่ยังไม่ถูกลบ · หมวดตั้งต้น "ประกัน"
  IF v_ins IS NOT NULL THEN
    IF v_util IS NOT NULL THEN RAISE EXCEPTION 'INVALID: ผูกได้ทีละอย่าง (ค่าใช้จ่ายประจำ หรือ เบี้ยประกัน)' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.insurance_schedule_lines l JOIN public.insurance_policies ip ON ip.id = l.policy_id
                    WHERE l.id = v_ins AND l.kind = 'PREMIUM' AND l.deleted_at IS NULL AND ip.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'NOT_FOUND: ไม่พบงวดเบี้ยประกัน' USING ERRCODE = '22023';
    END IF;
    v_cat := coalesce(v_cat, 'ประกัน');
  END IF;

  -- ค่าใช้จ่ายประจำของอสังหาฯ: ต้องระบุงวด · ผูกทรัพย์สินให้เองถ้าไม่ได้ส่งมา
  IF v_util IS NOT NULL THEN
    v_period := date_trunc('month', coalesce(nullif(p->>'cost_period', '')::date, v_date))::date;
    SELECT pd.asset_id INTO v_related
      FROM public.property_utilities u JOIN public.property_details pd ON pd.id = u.property_id
     WHERE u.id = v_util AND u.deleted_at IS NULL;
    IF v_related IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการค่าใช้จ่ายประจำ' USING ERRCODE = '22023'; END IF;
  END IF;

  INSERT INTO public.expense_items(monthly_expense_id, related_asset_id, paid_from_asset_id, paid_from_credit_card_id,
              person_id, date, description, amount, currency, expense_category, is_reimbursable,
              expected_reimbursement_amount, notes, property_utility_id, cost_period, insurance_schedule_line_id)
  VALUES (private.expense_month_id(v_date), v_related, v_bank, v_card,
          nullif(p->>'person_id', '')::uuid,   -- ระบุคนเองได้เสมอ (ใช้ก่อนเจ้าของบัญชี / บัตร)
          v_date, trim(p->>'description'), (p->>'amount')::numeric, v_ccy, v_cat,
          coalesce((p->>'is_reimbursable')::boolean, false),
          CASE WHEN coalesce((p->>'is_reimbursable')::boolean, false)
               THEN coalesce(nullif(p->>'expected_reimbursement_amount', '')::numeric, (p->>'amount')::numeric) END,
          nullif(trim(p->>'notes'), ''), v_util, v_period, v_ins)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.add_expense(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_expense(jsonb) TO authenticated;

-- =====================================================================
-- 2) จ่ายหนี้ แยกเงินต้น / ดอกเบี้ย
-- =====================================================================
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS reduces_liability boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cm_reduces_liability') THEN
    ALTER TABLE public.cash_movements ADD CONSTRAINT cm_reduces_liability
      CHECK (NOT reduces_liability OR movement_type = 'LIABILITY_PAYMENT');
  END IF;
END $$;
-- ดอกเบี้ยจ่ายผูกกับหนี้ (แสดงในประวัติการจ่ายของหนี้)
ALTER TABLE public.expense_items ADD COLUMN IF NOT EXISTS liability_id uuid REFERENCES public.liabilities(id);

-- เงินต้นที่จ่ายหลังวันที่ของยอด (p_after) ถึง p_upto
CREATE OR REPLACE FUNCTION private.liability_principal_paid(p_liability uuid, p_after date, p_upto date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(sum(m.amount), 0) FROM public.cash_movements m
   WHERE m.to_liability_id = p_liability AND m.movement_type = 'LIABILITY_PAYMENT' AND m.reduces_liability
     AND m.deleted_at IS NULL AND m.movement_date > p_after AND m.movement_date <= p_upto
$$;

-- ยอดหนี้ ณ วันที่ = ยอดล่าสุดที่บันทึก − เงินต้นที่จ่ายหลังจากนั้น
CREATE OR REPLACE FUNCTION private.liability_balance_at(p_liability uuid, p_date date)
RETURNS TABLE (balance numeric, as_of date, recorded_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT greatest(v.balance - private.liability_principal_paid(p_liability, v.valuation_date, p_date), 0),
         greatest(v.valuation_date, coalesce((SELECT max(m.movement_date) FROM public.cash_movements m
                   WHERE m.to_liability_id = p_liability AND m.movement_type = 'LIABILITY_PAYMENT' AND m.reduces_liability
                     AND m.deleted_at IS NULL AND m.movement_date > v.valuation_date AND m.movement_date <= p_date), v.valuation_date)),
         v.valuation_date
    FROM (SELECT x.balance, x.valuation_date FROM public.liability_valuations x
           WHERE x.liability_id = p_liability AND x.deleted_at IS NULL AND x.valuation_date <= p_date
           ORDER BY x.valuation_date DESC, x.created_at DESC LIMIT 1) v
$$;

CREATE OR REPLACE FUNCTION private.refresh_liability(p_liability uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_bal numeric; v_date date;
BEGIN
  SELECT b.balance, b.as_of INTO v_bal, v_date FROM private.liability_balance_at(p_liability, 'infinity'::date) b;
  UPDATE public.liabilities SET outstanding_amount = v_bal, balance_date = v_date
   WHERE id = p_liability
     AND (outstanding_amount, balance_date) IS DISTINCT FROM (v_bal, v_date);
END $$;

-- จ่ายเงินต้น / แก้ / ลบ → อัปเดตยอดหนี้ (Cache)
CREATE OR REPLACE FUNCTION private.tg_cash_movement_liability() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.to_liability_id IS NOT NULL THEN PERFORM private.refresh_liability(OLD.to_liability_id); END IF;
  IF TG_OP <> 'DELETE' AND NEW.to_liability_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.to_liability_id IS DISTINCT FROM OLD.to_liability_id OR NEW.reduces_liability) THEN
    PERFORM private.refresh_liability(NEW.to_liability_id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS a55_liability ON public.cash_movements;
CREATE TRIGGER a55_liability AFTER INSERT OR UPDATE OR DELETE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.tg_cash_movement_liability();

-- Net Worth: ยอดหนี้หักเงินต้นที่จ่ายหลังยอดล่าสุด (แก้เฉพาะส่วนหนี้สินของ net_worth_items)
DO $$
DECLARE d text;
  old_txt text := 'CONTINUE WHEN lv.id IS NULL OR lv.balance = 0;';
  new_txt text := 'IF lv.id IS NOT NULL THEN   -- หักเงินต้นที่จ่ายหลังวันที่ของยอดนี้
      lv.balance := greatest(lv.balance - private.liability_principal_paid(a.id, lv.valuation_date, p_date), 0);
    END IF;
    CONTINUE WHEN lv.id IS NULL OR lv.balance = 0;';
BEGIN
  d := pg_get_functiondef('private.net_worth_items(uuid, date, boolean)'::regprocedure);
  IF position('liability_principal_paid' IN d) > 0 THEN RETURN; END IF;   -- รันซ้ำ
  IF (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 THEN
    RAISE EXCEPTION 'net_worth_items: ไม่พบจุดที่ต้องแก้ (ส่วนหนี้สิน)';
  END IF;
  EXECUTE replace(d, old_txt, new_txt);
END $$;

-- p: { liability_id, bank_asset_id, date, principal, interest, notes?, statement_balance? }
DROP FUNCTION IF EXISTS public.pay_liability(jsonb);
CREATE FUNCTION public.pay_liability(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  l public.liabilities; v_bank uuid := nullif(p->>'bank_asset_id', '')::uuid; v_date date := nullif(p->>'date', '')::date;
  v_pr numeric := coalesce(nullif(p->>'principal', '')::numeric, 0); v_int numeric := coalesce(nullif(p->>'interest', '')::numeric, 0);
  v_notes text := nullif(trim(p->>'notes'), ''); v_stmt numeric := nullif(p->>'statement_balance', '')::numeric;
  v_ccy text; v_bal numeric; v_group uuid := gen_random_uuid(); v_exp uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT * INTO l FROM public.liabilities WHERE id = nullif(p->>'liability_id', '')::uuid AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบหนี้' USING ERRCODE = '22023'; END IF;
  IF l.status <> 'ACTIVE' THEN RAISE EXCEPTION 'INVALID: หนี้นี้ปิดแล้ว' USING ERRCODE = '22023'; END IF;
  IF v_date IS NULL OR v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่จ่ายไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_pr < 0 OR v_int < 0 OR (v_pr = 0 AND v_int = 0) THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่เงินต้นหรือดอกเบี้ย' USING ERRCODE = '22023';
  END IF;
  IF v_bank IS NULL OR NOT private.is_bank_asset(v_bank) THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่จ่าย' USING ERRCODE = '22023'; END IF;
  SELECT currency INTO v_ccy FROM public.assets WHERE id = v_bank;
  IF v_ccy <> l.currency THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีที่จ่ายต้องสกุลเดียวกับหนี้ (%)', l.currency USING ERRCODE = '22023';
  END IF;
  SELECT b.balance INTO v_bal FROM private.liability_balance_at(l.id, v_date) b;
  IF v_pr > 0 AND v_bal IS NOT NULL AND v_pr > v_bal + 0.005 THEN
    RAISE EXCEPTION 'INVALID: เงินต้นที่จ่าย (%) มากกว่ายอดหนี้คงค้าง (%)', v_pr, round(v_bal, 2) USING ERRCODE = '22023';
  END IF;

  IF v_pr > 0 THEN
    INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_liability_id, amount, currency,
                                      reduces_liability, movement_group_id, description, notes)
    VALUES (l.family_id, v_date, 'LIABILITY_PAYMENT', v_bank, l.id, v_pr, l.currency, true, v_group, 'จ่ายเงินต้น · ' || l.name, v_notes);
  END IF;
  IF v_int > 0 THEN
    INSERT INTO public.expense_items(monthly_expense_id, paid_from_asset_id, liability_id, date, description, amount, currency,
                                     expense_category, notes)
    VALUES (private.expense_month_id(v_date), v_bank, l.id, v_date, 'ดอกเบี้ย · ' || l.name, v_int, l.currency, 'ดอกเบี้ยจ่าย', v_notes)
    RETURNING id INTO v_exp;
  END IF;
  -- ยอดคงค้างตาม Statement หลังจ่าย (ไม่บังคับ) → ใช้แทนยอดที่ระบบหักให้
  IF v_stmt IS NOT NULL THEN
    IF v_stmt < 0 THEN RAISE EXCEPTION 'INVALID: ยอดคงค้างติดลบไม่ได้' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.liability_valuations(liability_id, valuation_date, balance, source, notes)
    VALUES (l.id, v_date, v_stmt, 'STATEMENT', 'ยอดหลังจ่าย')
    ON CONFLICT (liability_id, valuation_date) WHERE deleted_at IS NULL
    DO UPDATE SET balance = EXCLUDED.balance, source = 'STATEMENT', notes = EXCLUDED.notes;
  END IF;
  RETURN jsonb_build_object('group_id', v_group, 'expense_item_id', v_exp);
END $$;
REVOKE ALL ON FUNCTION public.pay_liability(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_liability(jsonb) TO authenticated;

-- =====================================================================
-- 3) บัตรเครดิตตัดบัญชีอัตโนมัติ
-- =====================================================================
ALTER TABLE public.credit_cards ADD COLUMN IF NOT EXISTS autopay_asset_id uuid REFERENCES public.assets(id);
ALTER TABLE public.credit_cards ADD COLUMN IF NOT EXISTS autopay_mode text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cc_autopay') THEN
    ALTER TABLE public.credit_cards ADD CONSTRAINT cc_autopay
      CHECK ((autopay_mode IS NULL) = (autopay_asset_id IS NULL) AND (autopay_mode IS NULL OR autopay_mode IN ('FULL','MINIMUM')));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.tg_card_autopay_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.autopay_asset_id IS NOT NULL THEN
    IF NOT private.is_bank_asset(NEW.autopay_asset_id) THEN
      RAISE EXCEPTION 'INVALID: บัญชีที่ตัดต้องเป็นบัญชีธนาคาร' USING ERRCODE = '22023';
    END IF;
    IF (SELECT currency FROM public.assets WHERE id = NEW.autopay_asset_id) <> NEW.currency THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีที่ตัดต้องสกุลเดียวกับบัตร (%)', NEW.currency USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t55_autopay ON public.credit_cards;
CREATE TRIGGER t55_autopay BEFORE INSERT OR UPDATE OF autopay_asset_id, autopay_mode, currency ON public.credit_cards
  FOR EACH ROW EXECUTE FUNCTION private.tg_card_autopay_check();

-- จ่ายบัตร (ใช้ตอนยืนยันตัดบัญชีอัตโนมัติ)
-- p: { card_id, bank_asset_id, date, amount, reduce_balance? (ตั้งต้น true), autopay? , notes? }
DROP FUNCTION IF EXISTS public.pay_credit_card(jsonb);
CREATE FUNCTION public.pay_credit_card(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c public.credit_cards; v_bank uuid := nullif(p->>'bank_asset_id', '')::uuid; v_date date := nullif(p->>'date', '')::date;
  v_amount numeric := nullif(p->>'amount', '')::numeric; v_auto boolean := coalesce((p->>'autopay')::boolean, false);
  v_ccy text; v_id uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT * INTO c FROM public.credit_cards WHERE id = nullif(p->>'card_id', '')::uuid AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัตร' USING ERRCODE = '22023'; END IF;
  IF v_date IS NULL OR v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่จ่ายไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดที่จ่าย' USING ERRCODE = '22023'; END IF;
  IF v_bank IS NULL OR NOT private.is_bank_asset(v_bank) THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่จ่าย' USING ERRCODE = '22023'; END IF;
  SELECT currency INTO v_ccy FROM public.assets WHERE id = v_bank;
  IF v_ccy <> c.currency THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีที่จ่ายต้องสกุลเดียวกับบัตร (%)', c.currency USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_credit_card_id, amount, currency,
                                    description, notes, metadata)
  SELECT f.id, v_date, 'CARD_PAYMENT', v_bank, c.id, v_amount, c.currency,
         CASE WHEN v_auto THEN 'ตัดบัญชีอัตโนมัติ · ' ELSE 'จ่ายบัตร · ' END || concat_ws(' ', c.issuer, c.card_name),
         nullif(trim(p->>'notes'), ''), jsonb_build_object('autopay', v_auto)
    FROM public.families f WHERE f.id = private.default_family_id()
  RETURNING id INTO v_id;
  -- หักยอดบัตรตามที่จ่าย (ถ้ายอดบัตรล่าสุดไม่ใหม่กว่าวันที่จ่าย)
  IF coalesce((p->>'reduce_balance')::boolean, true) AND (c.balance_date IS NULL OR c.balance_date <= v_date) THEN
    UPDATE public.credit_cards SET outstanding_balance = greatest(outstanding_balance - v_amount, 0), balance_date = v_date
     WHERE id = c.id;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pay_credit_card(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_credit_card(jsonb) TO authenticated;
