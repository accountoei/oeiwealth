-- 2 พ.ย. 2026 · การ์ด 3 ใบบน Dashboard มีเส้นเล็ก (ย้อนหลังรายเดือน) ทั้งภาพรวมครอบครัวและรายคน
--   ครอบครัว: net_worth_history มีสินทรัพย์ / หนี้สินรายเดือนอยู่แล้ว
--   รายคน: person_dashboard เดิมให้แค่ Net Worth → เพิ่ม total_assets / total_liabilities ของคนนั้น
--     · ยอดตั้งต้น: แยกจาก net_worth_items ณ วันก่อน Go-live (Net Worth เท่าเดิม)
--     · เดือนที่ปิดแล้ว (FINAL): จากรายการใน Snapshot ของคนนั้น
--     · เดือนที่ยังไม่ปิด (AUTO): คอลัมน์ใหม่ net_worth_month_auto.by_person_al (งานประจำคืนคำนวณ)
--   Net Worth รายเดือนของแต่ละคนยังมาจากที่เดิม (by_person / รายการใน Snapshot) → ตัวเลขเดิมไม่เปลี่ยน
--   ท้ายไฟล์คำนวณยอดอัตโนมัติใหม่ทันที (ข้อมูลที่ระบบคำนวณเอง งานประจำคืนทำแบบเดียวกันทุกวัน · ไม่แตะข้อมูลที่กรอก)
-- รันซ้ำได้

-- 1) ยอดอัตโนมัติรายคน แยกสินทรัพย์ / หนี้สิน: { "<person_id>": { "a": สินทรัพย์, "l": หนี้สิน } }
ALTER TABLE public.net_worth_month_auto ADD COLUMN IF NOT EXISTS by_person_al jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION private.refresh_month_auto(p_family uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.families; m date; d date; n int := 0; t record;
BEGIN
  SELECT * INTO f FROM public.families WHERE id = p_family AND deleted_at IS NULL;
  IF f.id IS NULL OR f.go_live_date IS NULL THEN
    DELETE FROM public.net_worth_month_auto WHERE family_id = p_family;
    RETURN 0;
  END IF;
  DELETE FROM public.net_worth_month_auto a
   WHERE a.family_id = p_family
     AND (a.snapshot_month < date_trunc('month', f.go_live_date)::date
          OR private.month_end(a.snapshot_month) >= current_date
          OR EXISTS (SELECT 1 FROM public.net_worth_snapshots s WHERE s.family_id = p_family
                      AND s.snapshot_month = a.snapshot_month AND s.status = 'FINAL' AND s.deleted_at IS NULL));

  m := date_trunc('month', f.go_live_date)::date;
  LOOP
    d := private.month_end(m);
    EXIT WHEN d >= current_date;
    IF NOT EXISTS (SELECT 1 FROM public.net_worth_snapshots s WHERE s.family_id = p_family
                    AND s.snapshot_month = m AND s.status = 'FINAL' AND s.deleted_at IS NULL) THEN
      SELECT coalesce(sum(x.base_value) FILTER (WHERE x.item_type = 'ASSET'), 0) AS a,
             coalesce(sum(x.base_value) FILTER (WHERE x.item_type = 'LIABILITY'), 0) AS l,
             count(*) FILTER (WHERE x.base_value IS NULL) AS no_fx
        INTO t FROM private.net_worth_items(p_family, d, true) x;
      INSERT INTO public.net_worth_month_auto AS a (family_id, snapshot_month, snapshot_date, total_assets,
                  total_liabilities, net_worth, by_person, by_person_al, missing_fx_items, computed_at)
      SELECT p_family, m, d, t.a, t.l, t.a - t.l,
             coalesce((SELECT jsonb_object_agg(y.person_id, y.nw) FROM (
                         SELECT x.person_id, sum(CASE WHEN x.item_type = 'ASSET' THEN x.base_value ELSE -x.base_value END) AS nw
                           FROM private.net_worth_items(p_family, d, true) x
                          WHERE x.person_id IS NOT NULL AND x.base_value IS NOT NULL GROUP BY x.person_id) y), '{}'::jsonb),
             -- รายคนแยกสินทรัพย์ (a) / หนี้สิน (l) → เส้นเล็กในการ์ด Dashboard รายคน (2 พ.ย. 2026)
             coalesce((SELECT jsonb_object_agg(y.person_id, jsonb_build_object('a', y.a, 'l', y.l)) FROM (
                         SELECT x.person_id, coalesce(sum(x.base_value) FILTER (WHERE x.item_type = 'ASSET'), 0) AS a,
                                coalesce(sum(x.base_value) FILTER (WHERE x.item_type <> 'ASSET'), 0) AS l
                           FROM private.net_worth_items(p_family, d, true) x
                          WHERE x.person_id IS NOT NULL AND x.base_value IS NOT NULL GROUP BY x.person_id) y), '{}'::jsonb),
             t.no_fx, now()
      ON CONFLICT (family_id, snapshot_month) DO UPDATE SET
        total_assets = EXCLUDED.total_assets, total_liabilities = EXCLUDED.total_liabilities,
        net_worth = EXCLUDED.net_worth, by_person = EXCLUDED.by_person, by_person_al = EXCLUDED.by_person_al,
        missing_fx_items = EXCLUDED.missing_fx_items, computed_at = EXCLUDED.computed_at;
      n := n + 1;
    END IF;
    m := (m + interval '1 month')::date;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.refresh_month_auto(uuid) FROM PUBLIC, anon, authenticated;

-- 2) จุดรายเดือนของคนหนึ่งคน: FINAL (Snapshot) + AUTO (เดือนที่ยังไม่ปิด) · กติกาเดียวกับ private.month_points
--    สินทรัพย์ / หนี้สิน ของ AUTO = NULL ถ้ายังไม่เคยคำนวณ by_person_al (หน้าเว็บข้ามจุดนั้นในเส้นเล็ก)
CREATE OR REPLACE FUNCTION private.month_points_person(p_family uuid, p_person uuid)
RETURNS TABLE (snapshot_month date, snapshot_date date, status text,
               total_assets numeric, total_liabilities numeric, net_worth numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.snapshot_month::date, s.snapshot_date, s.status,
         coalesce(sum(i.base_value) FILTER (WHERE i.item_type = 'ASSET'), 0)::numeric,
         coalesce(sum(i.base_value) FILTER (WHERE i.item_type <> 'ASSET'), 0)::numeric,
         coalesce(sum(CASE WHEN i.item_type = 'ASSET' THEN i.base_value ELSE -i.base_value END), 0)::numeric
    FROM public.net_worth_snapshots s
    LEFT JOIN public.net_worth_snapshot_items i ON i.snapshot_id = s.id AND i.person_id = p_person
   WHERE s.family_id = p_family AND s.status = 'FINAL' AND s.deleted_at IS NULL
   GROUP BY s.id, s.snapshot_month, s.snapshot_date, s.status
  UNION ALL
  SELECT a.snapshot_month::date, a.snapshot_date, 'AUTO',
         CASE WHEN a.by_person_al = '{}'::jsonb THEN NULL ELSE coalesce((a.by_person_al -> p_person::text ->> 'a')::numeric, 0) END,
         CASE WHEN a.by_person_al = '{}'::jsonb THEN NULL ELSE coalesce((a.by_person_al -> p_person::text ->> 'l')::numeric, 0) END,
         coalesce((a.by_person ->> p_person::text)::numeric, 0)
    FROM public.net_worth_month_auto a
   WHERE a.family_id = p_family
     AND NOT EXISTS (SELECT 1 FROM public.net_worth_snapshots s WHERE s.family_id = p_family
                      AND s.snapshot_month = a.snapshot_month AND s.status = 'FINAL' AND s.deleted_at IS NULL)
$$;
REVOKE ALL ON FUNCTION private.month_points_person(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 3) Dashboard รายคน: ยอดตั้งต้น + จุดรายเดือน มีสินทรัพย์ / หนี้สินด้วย (ส่วนอื่นเหมือนเดิมทุกบรรทัด)
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
    CROSS JOIN LATERAL private.expense_shares(e.person_id, e.paid_from_credit_card_id, coalesce(e.paid_from_asset_id, src.from_asset_id), e.date, e.liability_id) sh
   WHERE e.deleted_at IS NULL AND e.date BETWEEN m0 AND v_as_of AND sh.person_id = p_person;
  SELECT coalesce(sum(x.amount * coalesce(private.fx_rate(x.currency, x.received_date), 0) * sh.pct / 100), 0) INTO v_reimb
    FROM public.expense_reimbursements x
    JOIN public.expense_items e ON e.id = x.expense_item_id
    JOIN public.monthly_expenses me ON me.id = e.monthly_expense_id AND me.family_id = v_family
    LEFT JOIN public.cash_movements src ON src.id = e.source_cash_movement_id
    CROSS JOIN LATERAL private.expense_shares(e.person_id, e.paid_from_credit_card_id, coalesce(e.paid_from_asset_id, src.from_asset_id), e.date, e.liability_id) sh
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

-- 4) คำนวณยอดอัตโนมัติใหม่ทันที → by_person_al มีค่า (ไม่ต้องรอคืนนี้)
SELECT private.refresh_month_auto(id) FROM public.families WHERE deleted_at IS NULL;
