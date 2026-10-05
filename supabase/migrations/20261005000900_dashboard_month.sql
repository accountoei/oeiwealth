-- =====================================================================
-- Dashboard รายเดือน
--   dashboard_month(p_month)          : ยอด ณ สิ้นเดือน (เดือนปัจจุบัน = วันนี้)
--        เดือนที่ปิดแล้ว (FINAL) → อ่านจาก Snapshot เท่านั้น (Section 34: Historical Report ใช้ Snapshot)
--        เดือนที่ยังไม่ปิด → คำนวณสดจาก Net Worth Engine
--        + ฐานเทียบ: ปิดเดือนก่อน / ยอดตั้งต้น
--   month_person_items(p_month, p_person) : รายการทรัพย์สิน/หนี้ของสมาชิก ณ เดือนนั้น
-- =====================================================================
CREATE OR REPLACE FUNCTION private.month_totals(p_family uuid, p_month date, OUT src text, OUT as_of date,
  OUT fin numeric, OUT inv numeric, OUT prop numeric, OUT alt numeric, OUT liab numeric, OUT by_person jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m0 date := date_trunc('month', p_month)::date; d date := private.month_end(p_month); s public.net_worth_snapshots;
BEGIN
  SELECT * INTO s FROM public.net_worth_snapshots
   WHERE family_id = p_family AND snapshot_month = m0 AND status = 'FINAL' AND deleted_at IS NULL;
  IF s.id IS NOT NULL THEN
    src := 'SNAPSHOT'; as_of := s.snapshot_date;
    fin := s.financial_assets; inv := s.investments; prop := s.property_assets; alt := s.alternative_assets;
    liab := s.total_liabilities;
    SELECT coalesce(jsonb_agg(jsonb_build_object('person_id', x.person_id, 'name', coalesce(p.name, 'ยังไม่ระบุเจ้าของ'),
             'assets', x.a, 'liabilities', x.l, 'net_worth', x.a - x.l) ORDER BY p.name NULLS LAST), '[]'::jsonb)
      INTO by_person
      FROM (SELECT person_id, coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET'), 0) a,
                   coalesce(sum(base_value) FILTER (WHERE item_type = 'LIABILITY'), 0) l
              FROM public.net_worth_snapshot_items WHERE snapshot_id = s.id GROUP BY person_id) x
      LEFT JOIN public.persons p ON p.id = x.person_id;
    RETURN;
  END IF;
  src := 'LIVE'; as_of := least(d, current_date);
  WITH n AS (SELECT * FROM private.net_worth_items(p_family, as_of, d < current_date))
  SELECT coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET' AND item_group = 'FINANCIAL'), 0),
         coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET' AND item_group = 'INVESTMENT'), 0),
         coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET' AND item_group = 'PROPERTY'), 0),
         coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET' AND item_group = 'ALTERNATIVE'), 0),
         coalesce(sum(base_value) FILTER (WHERE item_type = 'LIABILITY'), 0),
         (SELECT coalesce(jsonb_agg(jsonb_build_object('person_id', x.person_id, 'name', coalesce(p.name, 'ยังไม่ระบุเจ้าของ'),
                   'assets', x.a, 'liabilities', x.l, 'net_worth', x.a - x.l) ORDER BY p.name NULLS LAST), '[]'::jsonb)
            FROM (SELECT person_id, coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET'), 0) a,
                         coalesce(sum(base_value) FILTER (WHERE item_type = 'LIABILITY'), 0) l
                    FROM n GROUP BY person_id) x LEFT JOIN public.persons p ON p.id = x.person_id)
    INTO fin, inv, prop, alt, liab, by_person FROM n;
END $$;

CREATE OR REPLACE FUNCTION public.dashboard_month(p_month date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_family uuid := private.default_family_id(); f public.families;
  m0 date := date_trunc('month', p_month)::date; cur record; pm date; base jsonb; ps public.net_worth_snapshots; t record;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  SELECT * INTO f FROM public.families WHERE id = v_family;
  SELECT * INTO cur FROM private.month_totals(v_family, m0);

  pm := (m0 - interval '1 month')::date;
  -- ฐานเทียบ: ปิดเดือนก่อน → (ถ้ายังไม่ปิด) เดือนล่าสุดที่ปิดแล้ว → ยอดตั้งต้น
  SELECT * INTO ps FROM public.net_worth_snapshots
   WHERE family_id = v_family AND snapshot_month <= pm AND status = 'FINAL' AND deleted_at IS NULL
   ORDER BY snapshot_month DESC LIMIT 1;
  IF ps.id IS NOT NULL THEN
    base := jsonb_build_object('label', CASE WHEN ps.snapshot_month = pm THEN 'ปิดเดือนก่อน'
                                             ELSE 'ปิดเดือน ' || to_char(ps.snapshot_month, 'MM/YYYY') END, 'date', ps.snapshot_date, 'total_assets', ps.total_assets,
                               'total_liabilities', ps.total_liabilities, 'net_worth', ps.net_worth);
  ELSIF m0 <= date_trunc('month', f.go_live_date)::date THEN
    SELECT coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET'), 0) a,
           coalesce(sum(base_value) FILTER (WHERE item_type = 'LIABILITY'), 0) l
      INTO t FROM private.net_worth_items(v_family, f.go_live_date - 1, true);
    base := jsonb_build_object('label', 'ยอดตั้งต้น', 'date', f.go_live_date - 1, 'total_assets', t.a,
                               'total_liabilities', t.l, 'net_worth', t.a - t.l);
  END IF;

  RETURN jsonb_build_object('month', m0, 'source', cur.src, 'as_of', cur.as_of,
    'financial', cur.fin, 'investment', cur.inv, 'property', cur.prop, 'alternative', cur.alt,
    'total_assets', cur.fin + cur.inv + cur.prop + cur.alt, 'total_liabilities', cur.liab,
    'net_worth', cur.fin + cur.inv + cur.prop + cur.alt - cur.liab, 'by_person', cur.by_person, 'base', base);
END $$;

CREATE OR REPLACE FUNCTION public.month_person_items(p_month date, p_person uuid)
RETURNS TABLE (item_type text, item_name text, item_group text, base_value numeric, ownership_percent numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_family uuid := private.default_family_id(); m0 date := date_trunc('month', p_month)::date;
        d date := private.month_end(p_month); v_snap uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  SELECT id INTO v_snap FROM public.net_worth_snapshots
   WHERE family_id = v_family AND snapshot_month = m0 AND status = 'FINAL' AND deleted_at IS NULL;
  IF v_snap IS NOT NULL THEN
    RETURN QUERY SELECT i.item_type, i.item_name, i.item_group, i.base_value::numeric, i.ownership_percent::numeric
      FROM public.net_worth_snapshot_items i WHERE i.snapshot_id = v_snap AND i.person_id IS NOT DISTINCT FROM p_person;
  ELSE
    RETURN QUERY SELECT n.item_type, n.item_name, n.item_group, n.base_value, n.ownership_percent
      FROM private.net_worth_items(v_family, least(d, current_date), d < current_date) n
     WHERE n.person_id IS NOT DISTINCT FROM p_person;
  END IF;
END $$;

REVOKE ALL ON FUNCTION private.month_totals(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_month(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_month(date) TO authenticated;
REVOKE ALL ON FUNCTION public.month_person_items(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.month_person_items(date, uuid) TO authenticated;
