-- =====================================================================
-- 1700 Seed: ข้อมูลอ้างอิงมาตรฐาน (ไม่มีข้อมูลส่วนตัว)
-- =====================================================================

-- Section 23: หมวด Alternative มาตรฐาน (family_id NULL)
INSERT INTO public.asset_categories(family_id, category_code, category_name) VALUES
  (NULL, 'GOLD',    'ทองคำ'),
  (NULL, 'JEWELRY', 'เครื่องประดับ'),
  (NULL, 'WATCH',   'นาฬิกา'),
  (NULL, 'SHOES',   'รองเท้า'),
  (NULL, 'CRYPTO',  'คริปโต');

-- Section 41: กติกา Data Completeness เริ่มต้น (ปรับได้ภายหลังโดย ADMIN)
INSERT INTO public.data_completeness_rules(entity_type, entity_subtype, field_key, importance, weight) VALUES
  ('ASSET', NULL, 'name',             'REQUIRED',    0),
  ('ASSET', NULL, 'currency',         'REQUIRED',    0),
  ('ASSET', NULL, 'acquisition_date', 'RECOMMENDED', 10),
  ('ASSET', NULL, 'acquisition_cost', 'RECOMMENDED', 10),
  ('ASSET', NULL, 'ownership',        'RECOMMENDED', 30),
  ('ASSET', NULL, 'valuation',        'RECOMMENDED', 30),
  ('ASSET', NULL, 'document',         'RECOMMENDED', 20),
  ('ASSET', 'BANK_ACCOUNT', 'account_no',     'RECOMMENDED', 20),
  ('ASSET', 'PROPERTY',     'title_deed_no',  'RECOMMENDED', 20),
  ('ASSET', 'PROPERTY',     'land_area_sq_wa','RECOMMENDED', 10),
  ('INSURANCE_POLICY', NULL, 'policy_no',     'RECOMMENDED', 20),
  ('INSURANCE_POLICY', NULL, 'beneficiaries', 'RECOMMENDED', 30),
  ('INSURANCE_POLICY', NULL, 'document',      'RECOMMENDED', 20);
