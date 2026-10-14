-- =====================================================================
-- ยอดบัตรเครดิตคำนวณอัตโนมัติ
--   ยอดค้างปัจจุบัน = ยอดตาม Statement ล่าสุด (outstanding_balance / balance_date)
--                    + รูดบัตรที่บันทึกหลังวันนั้น − จ่ายบัตร − เงินคืนเข้าบัตร
--   ใช้ทั้ง Net Worth · หน้า Liabilities · หน้า Cards (v_card_balances)
--   อัปเดตยอดจาก Statement = จุดเริ่มใหม่ (ส่วนที่ไม่ตรงลงก้อนรอแยกได้ — update_card_statement)
--   จ่ายบัตรไม่แก้ยอด Statement อีกต่อไป (ยอดลดเองจากการคำนวณ)
-- รันซ้ำได้
-- =====================================================================

-- รูด − จ่าย − เงินคืน ในช่วง (p_from, p_to]
CREATE OR REPLACE FUNCTION private.card_activity(p_card uuid, p_from date, p_to date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT sum(amount) FROM public.expense_items WHERE paid_from_credit_card_id = p_card AND deleted_at IS NULL
                     AND date > p_from AND date <= p_to), 0)
       - coalesce((SELECT sum(amount) FROM public.cash_movements WHERE to_credit_card_id = p_card AND movement_type = 'CARD_PAYMENT'
                     AND deleted_at IS NULL AND movement_date > p_from AND movement_date <= p_to), 0)
       - coalesce((SELECT sum(amount) FROM public.expense_reimbursements WHERE received_to_credit_card_id = p_card AND deleted_at IS NULL
                     AND received_date > p_from AND received_date <= p_to), 0)
$$;

-- ยอดบัตรแต่ละใบ: ตาม Statement + ปัจจุบัน (คำนวณ)
CREATE OR REPLACE VIEW public.v_card_balances WITH (security_invoker = true) AS
  SELECT c.id AS card_id, c.outstanding_balance AS statement_balance, c.balance_date AS statement_date,
         CASE WHEN c.balance_date IS NULL THEN c.outstanding_balance
              ELSE greatest(c.outstanding_balance + private.card_activity(c.id, c.balance_date, current_date), 0) END AS current_balance
    FROM public.credit_cards c
   WHERE c.deleted_at IS NULL AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
GRANT SELECT ON public.v_card_balances TO authenticated;

-- หน้า Liabilities: บัตรใช้ยอดปัจจุบัน (คำนวณ) · ไม่ต้องเตือน "จ่ายแล้วยังไม่อัปเดตยอด" อีกต่อไป
CREATE OR REPLACE VIEW public.v_liabilities_all WITH (security_invoker = true) AS
  SELECT 'LOAN'::text AS liability_source, l.id AS source_id, l.family_id, l.name, l.liability_type AS subtype,
         l.currency, l.outstanding_amount AS amount, l.balance_date, l.due_date,
         l.monthly_payment, l.payment_due_day, l.status, NULL::text AS derived_status
    FROM public.liabilities l
   WHERE l.deleted_at IS NULL AND l.status = 'ACTIVE'
  UNION ALL
  SELECT 'CREDIT_CARD', c.id, p.family_id, concat_ws(' ', c.issuer, c.card_name, '••' || c.card_last4), 'CREDIT_CARD',
         c.currency,
         (CASE WHEN c.balance_date IS NULL THEN c.outstanding_balance
              ELSE greatest(c.outstanding_balance + private.card_activity(c.id, c.balance_date, current_date), 0) END)::public.d_money,
         c.balance_date, NULL, NULL, c.due_day, c.status, NULL::text
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

-- Net Worth: ยอดบัตร = ยอด Statement ณ วันนั้น + รูด − จ่าย − เงินคืน หลังจากนั้น
DO $$
DECLARE d text;
  old_txt text := 'CONTINUE WHEN coalesce(v_bal, 0) <= 0 OR v_bdate IS NULL OR v_bdate > p_date;';
  new_txt text := 'IF v_bdate IS NOT NULL AND v_bdate <= p_date THEN   -- บวกรายการบัตรหลังวันที่ของยอด
      v_bal := greatest(coalesce(v_bal, 0) + private.card_activity(a.id, v_bdate, p_date), 0);
    END IF;
    CONTINUE WHEN coalesce(v_bal, 0) <= 0 OR v_bdate IS NULL OR v_bdate > p_date;';
BEGIN
  d := pg_get_functiondef('private.net_worth_items(uuid, date, boolean)'::regprocedure);
  IF position('private.card_activity' IN d) > 0 THEN RETURN; END IF;   -- รันซ้ำ
  IF (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 THEN
    RAISE EXCEPTION 'net_worth_items: ไม่พบจุดที่ต้องแก้ (ส่วนบัตรเครดิต)';
  END IF;
  EXECUTE replace(d, old_txt, new_txt);
END $$;

-- ปิดงวด: เตือนเฉพาะยอดบัตรไม่ได้อัปเดตจาก Statement ในเดือนนี้ (จ่ายบัตรแล้วยอดลดเอง)
DO $$
DECLARE d text;
  old_txt text := '     AND (c.balance_date IS NULL OR c.balance_date < m0
          OR EXISTS (SELECT 1 FROM public.cash_movements m WHERE m.to_credit_card_id = c.id AND m.deleted_at IS NULL
                      AND m.movement_date > c.balance_date AND m.movement_date <= d));';
  new_txt text := '     AND (c.balance_date IS NULL OR c.balance_date < m0);';
BEGIN
  d := pg_get_functiondef('private.month_closing_issues(uuid, date)'::regprocedure);
  IF position(old_txt IN d) = 0 THEN
    IF position(new_txt IN d) > 0 THEN RETURN; END IF;                  -- รันซ้ำ
    RAISE EXCEPTION 'month_closing_issues: ไม่พบจุดที่ต้องแก้ (ยอดบัตร)';
  END IF;
  EXECUTE replace(d, old_txt, new_txt);
END $$;

-- จ่ายบัตร: ไม่หักยอด Statement แล้ว (ยอดปัจจุบันคำนวณจากการจ่ายเอง)
DO $$
DECLARE d text; old_txt text := 'IF coalesce((p->>''reduce_balance'')::boolean, true) AND';
BEGIN
  d := pg_get_functiondef('public.pay_credit_card(jsonb)'::regprocedure);
  IF position(old_txt IN d) = 0 THEN RETURN; END IF;                    -- รันซ้ำ / แก้แล้ว
  EXECUTE replace(d, old_txt, 'IF false AND');
END $$;
