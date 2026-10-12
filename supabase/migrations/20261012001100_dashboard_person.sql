-- Dashboard รายคน: กราฟ Net Worth + "ความมั่งคั่งเปลี่ยนเพราะอะไร" ของคนที่เลือก
-- ยอดของคนหนึ่งคน = รายการ Net Worth ที่ person_id ตรง (แบ่งตาม % ความเป็นเจ้าของแล้ว)
-- รายได้: มี person_id → ของคนนั้นเต็มจำนวน · ไม่มีแต่ผูกทรัพย์สิน → แบ่งตาม % เจ้าของทรัพย์สินนั้น ณ วันที่รับ
-- ค่าใช้จ่าย / เงินคืน: เฉพาะรายการที่ระบุ person_id ของคนนั้น · ส่วนที่ระบุไม่ได้ไปอยู่ใน "มูลค่าเปลี่ยน / อื่น ๆ"
-- ยอดปัจจุบันของคนนั้นใช้จาก dashboard_month (by_person) เหมือนการ์ดด้านบน

DROP FUNCTION IF EXISTS public.person_dashboard(date, uuid);
CREATE FUNCTION public.person_dashboard(p_month date, p_person uuid)
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

  -- รายได้หลังภาษี (แยกรายได้ลงทุน) ส่วนของคนนี้
  SELECT coalesce(sum(x.net * x.share) FILTER (WHERE NOT x.inv), 0), coalesce(sum(x.net * x.share) FILTER (WHERE x.inv), 0)
    INTO v_inc, v_inv
    FROM (SELECT i.base_amount * (1 - coalesce(i.tax, 0) / nullif(i.amount, 0)) AS net,
                 i.source_transaction_id IS NOT NULL AS inv,
                 CASE WHEN i.person_id IS NOT NULL THEN CASE WHEN i.person_id = p_person THEN 1 ELSE 0 END
                      WHEN i.asset_id IS NOT NULL THEN coalesce((
                        SELECT sum(o.ownership_percent) / 100 FROM public.asset_ownerships o
                         WHERE o.asset_id = i.asset_id AND o.person_id = p_person AND o.deleted_at IS NULL
                           AND i.date >= o.start_date AND (o.end_date IS NULL OR i.date <= o.end_date)), 0)
                      ELSE 0 END AS share
            FROM public.income_transactions i
           WHERE i.family_id = v_family AND i.deleted_at IS NULL AND i.date BETWEEN m0 AND v_as_of) x;

  SELECT coalesce(sum(e.base_amount), 0) INTO v_exp FROM public.expense_items e
    JOIN public.monthly_expenses me ON me.id = e.monthly_expense_id AND me.family_id = v_family
   WHERE e.deleted_at IS NULL AND e.person_id = p_person AND e.date BETWEEN m0 AND v_as_of;
  SELECT coalesce(sum(x.amount * coalesce(private.fx_rate(x.currency, x.received_date), 0)), 0) INTO v_reimb
    FROM public.expense_reimbursements x
    JOIN public.expense_items e ON e.id = x.expense_item_id AND e.person_id = p_person
    JOIN public.monthly_expenses me ON me.id = e.monthly_expense_id AND me.family_id = v_family
   WHERE x.deleted_at IS NULL AND x.received_date BETWEEN m0 AND v_as_of;

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

-- รายการทรัพย์สิน / หนี้สินทั้งครอบครัวของเดือน (รวมทุกเจ้าของเป็นรายการเดียว) — ใช้กดเปิดดูในแต่ละหมวดของ Dashboard
DROP FUNCTION IF EXISTS public.month_family_items(date);
CREATE FUNCTION public.month_family_items(p_month date)
RETURNS TABLE (item_type text, item_name text, item_group text, base_value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_family uuid := private.default_family_id(); m0 date := date_trunc('month', p_month)::date;
        d date := private.month_end(p_month); v_snap uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  SELECT id INTO v_snap FROM public.net_worth_snapshots
   WHERE family_id = v_family AND snapshot_month = m0 AND status = 'FINAL' AND deleted_at IS NULL;
  IF v_snap IS NOT NULL THEN
    RETURN QUERY SELECT i.item_type, min(i.item_name),
                        CASE i.item_subtype WHEN 'PRIVATE_BUSINESS' THEN 'BUSINESS' WHEN 'LOAN_RECEIVABLE' THEN 'LOANS'
                             WHEN 'INSURANCE_CASH_VALUE' THEN 'INSURANCE' ELSE i.item_group END,
                        sum(i.base_value)::numeric
      FROM public.net_worth_snapshot_items i WHERE i.snapshot_id = v_snap
     GROUP BY i.item_type, coalesce(i.asset_id, i.liability_id, i.credit_card_id, i.lease_id), 3;
  ELSE
    RETURN QUERY SELECT n.item_type, min(n.item_name),
                        CASE n.item_subtype WHEN 'PRIVATE_BUSINESS' THEN 'BUSINESS' WHEN 'LOAN_RECEIVABLE' THEN 'LOANS'
                             WHEN 'INSURANCE_CASH_VALUE' THEN 'INSURANCE' ELSE n.item_group END,
                        sum(n.base_value)
      FROM private.net_worth_items(v_family, least(d, current_date), d < current_date) n
     GROUP BY n.item_type, coalesce(n.asset_id, n.liability_id, n.credit_card_id, n.lease_id), 3;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.month_family_items(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.month_family_items(date) TO authenticated;
