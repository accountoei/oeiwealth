-- =====================================================================
-- Month Closing preview (Core Schema Section 36)
--   month_net_worth_preview(p_month) : Net Worth ณ สิ้นเดือน (หรือวันนี้ถ้าเดือนยังไม่จบ) แยกหมวด / รายบุคคล
--                                     + Bridge "ความมั่งคั่งเปลี่ยนเพราะอะไร" + วันที่ของ FX ที่ใช้
--   อ่านอย่างเดียว · ใช้ Net Worth Engine เดียวกับ finalize_month
-- =====================================================================
CREATE OR REPLACE FUNCTION public.month_net_worth_preview(p_month date)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_family uuid := private.default_family_id();
  f public.families;
  m0 date := date_trunc('month', p_month)::date;
  d date := private.month_end(p_month);
  v_as_of date; v_confirmed boolean;
  v_prev numeric; v_prev_label text; v_prev_date date;
  r jsonb := '{}'::jsonb; t record;
  v_inc numeric; v_inv numeric; v_exp numeric; v_reimb numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  SELECT * INTO f FROM public.families WHERE id = v_family;
  v_confirmed := d < current_date;
  v_as_of := CASE WHEN v_confirmed THEN d ELSE current_date END;

  CREATE TEMP TABLE IF NOT EXISTS _nw ON COMMIT DROP AS
    SELECT * FROM private.net_worth_items(v_family, v_as_of, v_confirmed) WITH NO DATA;
  TRUNCATE _nw;
  INSERT INTO _nw SELECT * FROM private.net_worth_items(v_family, v_as_of, v_confirmed);

  SELECT coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET' AND item_group = 'FINANCIAL'), 0)   AS fin,
         coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET' AND item_group = 'INVESTMENT'), 0)  AS inv,
         coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET' AND item_group = 'PROPERTY'), 0)    AS prop,
         coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET' AND item_group = 'ALTERNATIVE'), 0) AS alt,
         coalesce(sum(base_value) FILTER (WHERE item_type = 'LIABILITY'), 0)                            AS liab,
         coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET' AND person_id IS NULL), 0)
           - coalesce(sum(base_value) FILTER (WHERE item_type = 'LIABILITY' AND person_id IS NULL), 0)  AS unalloc,
         count(*) FILTER (WHERE base_value IS NULL)                                                     AS no_fx,
         count(*) FILTER (WHERE is_carried_forward)                                                     AS carried
    INTO t FROM _nw;

  -- ยอดงวดก่อน: Snapshot FINAL เดือนก่อน → ไม่มีและเป็นเดือน Go-live = Opening Position
  SELECT s.net_worth, s.snapshot_date INTO v_prev, v_prev_date FROM public.net_worth_snapshots s
   WHERE s.family_id = v_family AND s.snapshot_month = (m0 - interval '1 month')::date
     AND s.status = 'FINAL' AND s.deleted_at IS NULL;
  IF v_prev IS NOT NULL THEN
    v_prev_label := 'ยอดปิดเดือนก่อน';
  ELSIF m0 = date_trunc('month', f.go_live_date)::date THEN
    v_prev_date := f.go_live_date - 1;
    v_prev_label := 'ยอดตั้งต้น (Opening Position)';
    SELECT coalesce(sum(CASE WHEN item_type = 'ASSET' THEN base_value ELSE -base_value END), 0) INTO v_prev
      FROM private.net_worth_items(v_family, v_prev_date, true);
  END IF;

  -- รายได้ (สุทธิหลังภาษี) แยกรายได้ลงทุนออก กันนับซ้ำกับผลตอบแทนลงทุน
  SELECT coalesce(sum(i.base_amount * (1 - coalesce(i.tax, 0) / nullif(i.amount, 0))) FILTER (WHERE i.source_transaction_id IS NULL), 0),
         coalesce(sum(i.base_amount * (1 - coalesce(i.tax, 0) / nullif(i.amount, 0))) FILTER (WHERE i.source_transaction_id IS NOT NULL), 0)
    INTO v_inc, v_inv
    FROM public.income_transactions i
   WHERE i.family_id = v_family AND i.deleted_at IS NULL AND i.date BETWEEN m0 AND v_as_of;
  SELECT coalesce(sum(e.base_amount), 0) INTO v_exp FROM public.expense_items e
    JOIN public.monthly_expenses me ON me.id = e.monthly_expense_id AND me.family_id = v_family
   WHERE e.deleted_at IS NULL AND e.date BETWEEN m0 AND v_as_of;
  SELECT coalesce(sum(x.amount * coalesce(private.fx_rate(x.currency, x.received_date), 0)), 0) INTO v_reimb
    FROM public.expense_reimbursements x
   WHERE x.deleted_at IS NULL AND x.received_date BETWEEN m0 AND v_as_of;

  r := jsonb_build_object(
    'month', m0, 'as_of', v_as_of, 'confirmed', v_confirmed,
    'financial', t.fin, 'investment', t.inv, 'property', t.prop, 'alternative', t.alt,
    'total_assets', t.fin + t.inv + t.prop + t.alt, 'total_liabilities', t.liab,
    'net_worth', t.fin + t.inv + t.prop + t.alt - t.liab, 'unallocated', t.unalloc,
    'missing_fx_items', t.no_fx, 'carried_forward_items', t.carried,
    'prev_net_worth', v_prev, 'prev_label', v_prev_label, 'prev_date', v_prev_date,
    'income', round(v_inc, 2), 'investment_income', round(v_inv, 2),
    'expenses', round(v_exp, 2), 'reimbursements', round(v_reimb, 2),
    'other_change', CASE WHEN v_prev IS NOT NULL THEN
        round((t.fin + t.inv + t.prop + t.alt - t.liab) - v_prev - v_inc - v_inv + (v_exp - v_reimb), 2) END,
    'snapshot', (SELECT to_jsonb(s) - 'created_by' - 'updated_by' - 'deleted_by' FROM public.net_worth_snapshots s
                  WHERE s.family_id = v_family AND s.snapshot_month = m0 AND s.deleted_at IS NULL),
    'by_person', coalesce((SELECT jsonb_agg(jsonb_build_object('person_id', x.person_id, 'name', coalesce(p.name, 'ยังไม่ระบุเจ้าของ'),
                    'assets', x.a, 'liabilities', x.l, 'net_worth', x.a - x.l) ORDER BY p.name NULLS LAST)
                  FROM (SELECT person_id, coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET'), 0) AS a,
                               coalesce(sum(base_value) FILTER (WHERE item_type = 'LIABILITY'), 0) AS l
                          FROM _nw GROUP BY person_id) x
                  LEFT JOIN public.persons p ON p.id = x.person_id), '[]'::jsonb),
    'fx', coalesce((SELECT jsonb_agg(jsonb_build_object('currency', c.currency, 'rate', fr.rate_to_thb, 'rate_date', fr.rate_date))
                  FROM (SELECT DISTINCT currency FROM _nw WHERE currency <> 'THB') c
                  LEFT JOIN LATERAL (SELECT (private.fx_rate_row(c.currency, v_as_of)).*) fr ON true), '[]'::jsonb));
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.month_net_worth_preview(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.month_net_worth_preview(date) TO authenticated;
