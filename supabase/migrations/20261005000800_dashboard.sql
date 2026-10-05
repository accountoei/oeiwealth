-- =====================================================================
-- Dashboard (Wireframe 3.1)
--   net_worth_history()   : ยอดตั้งต้น (Opening Position) + Snapshot ทุกเดือน (FINAL / DRAFT)
--   asset_completeness()  : Data Completeness ต่อสินทรัพย์ (คิดจากกติกา RECOMMENDED · Section 41)
--   อ่านอย่างเดียว
-- =====================================================================
CREATE OR REPLACE FUNCTION public.net_worth_history()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_family uuid := private.default_family_id(); f public.families; t record;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  SELECT * INTO f FROM public.families WHERE id = v_family;
  SELECT coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET'), 0) AS a,
         coalesce(sum(base_value) FILTER (WHERE item_type = 'LIABILITY'), 0) AS l
    INTO t FROM private.net_worth_items(v_family, f.go_live_date - 1, true);
  RETURN jsonb_build_object(
    'opening', jsonb_build_object('date', f.go_live_date - 1, 'total_assets', t.a, 'total_liabilities', t.l, 'net_worth', t.a - t.l),
    'snapshots', coalesce((SELECT jsonb_agg(jsonb_build_object('month', s.snapshot_month, 'date', s.snapshot_date,
                     'status', s.status, 'version', s.version, 'total_assets', s.total_assets,
                     'total_liabilities', s.total_liabilities, 'net_worth', s.net_worth) ORDER BY s.snapshot_month)
                   FROM public.net_worth_snapshots s
                  WHERE s.family_id = v_family AND s.deleted_at IS NULL AND s.finalized_at IS NOT NULL), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.asset_completeness()
RETURNS TABLE (asset_id uuid, name text, asset_group text, asset_type text, score numeric, missing text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_family uuid := private.default_family_id();
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  RETURN QUERY
  WITH a AS (
    SELECT x.* FROM public.assets x WHERE x.family_id = v_family AND x.deleted_at IS NULL AND x.status = 'ACTIVE'),
  chk AS (
    SELECT a.id, r.field_key, r.weight,
           CASE r.field_key
             WHEN 'acquisition_date' THEN a.acquisition_date IS NOT NULL
             WHEN 'acquisition_cost' THEN a.acquisition_cost IS NOT NULL
             WHEN 'ownership' THEN coalesce((SELECT sum(o.ownership_percent) FROM public.asset_ownerships o
                                   WHERE o.asset_id = a.id AND o.deleted_at IS NULL AND o.end_date IS NULL), 0) >= 100
             WHEN 'valuation' THEN a.current_value IS NOT NULL
             WHEN 'document' THEN EXISTS (SELECT 1 FROM public.document_links dl WHERE dl.entity_type = 'ASSET'
                                   AND dl.entity_id = a.id AND dl.deleted_at IS NULL)
             WHEN 'account_no' THEN EXISTS (SELECT 1 FROM public.bank_accounts b WHERE b.asset_id = a.id
                                   AND b.account_no_last4 IS NOT NULL)
             WHEN 'title_deed_no' THEN EXISTS (SELECT 1 FROM public.property_details p WHERE p.asset_id = a.id
                                   AND nullif(trim(p.title_deed_no), '') IS NOT NULL)
             WHEN 'land_area_sq_wa' THEN EXISTS (SELECT 1 FROM public.property_details p WHERE p.asset_id = a.id
                                   AND (p.land_area_sq_wa IS NOT NULL OR p.property_type = 'CONDO'))
             ELSE true END AS ok
      FROM a JOIN public.data_completeness_rules r
        ON r.entity_type = 'ASSET' AND r.active AND r.deleted_at IS NULL AND r.importance = 'RECOMMENDED'
       AND (r.entity_subtype IS NULL OR r.entity_subtype = a.asset_type OR r.entity_subtype = a.asset_group)
       -- ยอดเงินสด / พอร์ต / เงินให้กู้ ไม่ต้องมีราคาที่ได้มา
       AND NOT (r.field_key IN ('acquisition_date','acquisition_cost')
                AND a.asset_type IN ('BANK_ACCOUNT','INVESTMENT_PORTFOLIO','LOAN_RECEIVABLE','INSURANCE_CASH_VALUE')))
  SELECT a.id, a.name, a.asset_group, a.asset_type,
         round(100 * coalesce(sum(c.weight) FILTER (WHERE c.ok), 0) / nullif(sum(c.weight), 0), 0),
         coalesce(array_agg(c.field_key ORDER BY c.weight DESC) FILTER (WHERE NOT c.ok), '{}')
    FROM a JOIN chk c ON c.id = a.id
   GROUP BY a.id, a.name, a.asset_group, a.asset_type;
END $$;

REVOKE ALL ON FUNCTION public.net_worth_history() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.net_worth_history() TO authenticated;
REVOKE ALL ON FUNCTION public.asset_completeness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asset_completeness() TO authenticated;
