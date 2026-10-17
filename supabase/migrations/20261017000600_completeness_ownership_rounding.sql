-- =====================================================================
-- Dashboard "ความครบถ้วนของข้อมูล": ธุรกิจที่ระบุเจ้าของเป็นจำนวนหุ้น ขึ้น "ขาด เจ้าของครบ 100%" ทั้งที่ระบุครบ
--   สาเหตุ: % ที่เก็บไว้ = หุ้น ÷ หุ้นรวม ตัดเหลือ 4 ตำแหน่ง → หารไม่ลงตัว รวมได้ 99.9999% ไม่ถึง 100 พอดี
--   แก้: ใช้ private.asset_owner_shares (คิด % จากจำนวนหุ้นโดยตรง · ยอมคลาดเคลื่อนไม่เกิน 0.00001%)
--        แบบเดียวกับหน้า Opening (20261017000100) และการแบ่งมูลค่ารายคน
--   ฟังก์ชันอย่างเดียว · signature เดิม · ไม่แก้ / ไม่ลบข้อมูล · รันซ้ำได้
-- =====================================================================
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
             WHEN 'ownership' THEN coalesce((SELECT sum(s.pct) FROM private.asset_owner_shares(a.id, current_date) s
                                   WHERE s.person_id IS NOT NULL), 0) >= 99.99999
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
REVOKE ALL ON FUNCTION public.asset_completeness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asset_completeness() TO authenticated;
