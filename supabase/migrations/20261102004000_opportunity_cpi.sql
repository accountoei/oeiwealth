-- อัตราดอกเบี้ยเทียบ (ต้นทุนเสียโอกาส): เลือกวิธีคิดได้ 2 แบบ
--   FIXED    = อัตราคงที่ต่อปี (เหมือนเดิม)            ดอกเบี้ย = ยอด × ((1 + r)^ปี − 1)
--   CPI_PLUS = เงินเฟ้อจริงช่วงที่ถือ + ส่วนเพิ่มต่อปี   ดอกเบี้ย = ยอด × (CPI ปีล่าสุด ÷ CPI ปีที่จ่าย × (1 + m)^ปี − 1)
-- ตั้งที่ครอบครัว (ตั้งค่า › อัตราแลกเปลี่ยน & ราคา) หรือรายแปลง (แก้ไขข้อมูลทรัพย์สิน) · ค่าเสื่อม / ค่าเช่า คิดเหมือนเดิม
-- ดัชนีราคาผู้บริโภคไทย (ค่าเฉลี่ยทั้งปี) เก็บใน cpi_annual · ADMIN เพิ่มปีถัดไปจากอัตราเงินเฟ้อทั้งปีที่ สนค. ประกาศ
-- ไม่เปลี่ยนค่าของครอบครัวที่มีอยู่: ค่าเริ่มต้นยังเป็น "คงที่" — เจ้าของเปลี่ยนเองในหน้าตั้งค่า

-- 1) ตารางดัชนีราคาผู้บริโภค (รายปี) ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cpi_annual (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year           integer NOT NULL CHECK (year BETWEEN 1900 AND 2200),          -- ค.ศ.
  cpi_index      numeric(14,6) NOT NULL CHECK (cpi_index > 0),                 -- ฐาน 2010 = 100
  inflation_pct  numeric(8,4) CHECK (inflation_pct > -100),                    -- เทียบปีก่อน (%)
  source         text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 200),
  notes          text CHECK (length(notes) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS cpi_annual_year_uq ON public.cpi_annual(year) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS t10_meta ON public.cpi_annual;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.cpi_annual
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.cpi_annual;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.cpi_annual
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.cpi_annual;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.cpi_annual
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

-- ทุก Role อ่าน · ADMIN เพิ่ม / แก้ (แบบเดียวกับ fx_rates)
ALTER TABLE public.cpi_annual ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cpi_annual FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cpi_annual TO authenticated, service_role;
DROP POLICY IF EXISTS p_select ON public.cpi_annual;
DROP POLICY IF EXISTS p_insert ON public.cpi_annual;
DROP POLICY IF EXISTS p_update ON public.cpi_annual;
CREATE POLICY p_select ON public.cpi_annual FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
CREATE POLICY p_insert ON public.cpi_annual FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role('ADMIN')));
CREATE POLICY p_update ON public.cpi_annual FOR UPDATE TO authenticated
  USING ((SELECT private.has_role('ADMIN'))) WITH CHECK ((SELECT private.has_role('ADMIN')));

-- ข้อมูลย้อนหลัง พ.ศ. 2503–2568 (ค.ศ. 1960–2025): World Bank FP.CPI.TOTL (Thailand, 2010 = 100, ปรับปรุง 8 ต.ค. 2026)
-- ซึ่งมาจากดัชนีราคาผู้บริโภคทั่วไปของไทย (สนค. กระทรวงพาณิชย์) — ใช้ "อัตราส่วน" ระหว่างปี ฐานไม่มีผลต่อผลลัพธ์
INSERT INTO public.cpi_annual (year, cpi_index, inflation_pct, source)
SELECT v.y, v.c, v.p, 'World Bank FP.CPI.TOTL (2010=100) · จาก สนค.'
  FROM (VALUES
  (1960,10.21121,NULL), (1961,10.965511,7.387), (1962,11.370807,3.6961), (1963,11.370807,0.0), (1964,11.280742,-0.7921), (1965,11.299505,0.1663),
  (1966,11.755463,4.0352), (1967,12.262084,4.3097), (1968,12.481619,1.7904), (1969,12.787467,2.4504), (1970,12.776209,-0.088), (1971,12.838129,0.4847),
  (1972,13.459208,4.8378), (1973,15.546671,15.5095), (1974,19.32662,24.3136), (1975,20.356747,5.3301), (1976,21.201411,4.1493), (1977,22.812987,7.6013),
  (1978,24.620709,7.9241), (1979,27.05751,9.8974), (1980,32.388787,19.7035), (1981,36.490177,12.663), (1982,38.409224,5.2591), (1983,39.840558,3.7265),
  (1984,40.185138,0.8649), (1985,41.162333,2.4317), (1986,41.92041,1.8417), (1987,42.95436,2.4665), (1988,44.613572,3.8627), (1989,47.002836,5.3555),
  (1990,49.75908,5.864), (1991,52.60025,5.7099), (1992,54.777451,4.1391), (1993,56.591785,3.3122), (1994,59.448396,5.0477), (1995,62.907212,5.8182),
  (1996,66.559042,5.8051), (1997,70.303519,5.6258), (1998,75.924095,7.9947), (1999,76.140271,0.2847), (2000,77.3524,1.592), (2001,78.610853,1.6269),
  (2002,79.159014,0.6973), (2003,80.587319,1.8043), (2004,82.810844,2.7591), (2005,86.570762,4.5404), (2006,90.585459,4.6375), (2007,92.615969,2.2415),
  (2008,97.680664,5.4685), (2009,96.854562,-0.8457), (2010,100.0,3.2476), (2011,103.811917,3.8119), (2012,106.936122,3.0095), (2013,109.273935,2.1862),
  (2014,111.344192,1.8946), (2015,110.344161,-0.8981), (2016,110.549661,0.1862), (2017,111.284169,0.6644), (2018,112.471388,1.0668), (2019,113.264901,0.7055),
  (2020,112.306581,-0.8461), (2021,113.689126,1.231), (2022,120.596763,6.0759), (2023,122.079005,1.2291), (2024,122.565287,0.3983), (2025,122.401498,-0.1336)
  ) AS v(y, c, p)
 WHERE NOT EXISTS (SELECT 1 FROM public.cpi_annual c WHERE c.year = v.y AND c.deleted_at IS NULL);

-- 2) วิธีคิด: ครอบครัว (ค่าเริ่มต้น = คงที่ เหมือนเดิม) · รายแปลง (ว่าง = ใช้ของครอบครัว) ------------------------------------
ALTER TABLE public.families ADD COLUMN IF NOT EXISTS opportunity_method text NOT NULL DEFAULT 'FIXED';
ALTER TABLE public.property_details ADD COLUMN IF NOT EXISTS opportunity_method text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'families_opportunity_method_ck') THEN
    ALTER TABLE public.families ADD CONSTRAINT families_opportunity_method_ck
      CHECK (opportunity_method IN ('FIXED', 'CPI_PLUS'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pd_opportunity_method_ck') THEN
    -- ตั้งวิธีรายแปลงต้องมีตัวเลขของแปลงด้วย
    ALTER TABLE public.property_details ADD CONSTRAINT pd_opportunity_method_ck
      CHECK (opportunity_method IS NULL OR (opportunity_method IN ('FIXED', 'CPI_PLUS') AND opportunity_rate_pct IS NOT NULL));
  END IF;
END $$;

-- 3) ADMIN เพิ่ม / แก้ปีล่าสุด จากอัตราเงินเฟ้อทั้งปี → ดัชนี = ดัชนีปีก่อน × (1 + % ÷ 100) ------------------------------------
CREATE OR REPLACE FUNCTION public.set_cpi_year(p_year integer, p_inflation_pct numeric, p_source text, p_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_last integer; v_prev numeric; v_this_year integer := extract(year FROM (now() AT TIME ZONE 'Asia/Bangkok'))::int;
BEGIN
  IF NOT private.has_role('ADMIN') THEN RAISE EXCEPTION 'เฉพาะ ADMIN เพิ่มดัชนีเงินเฟ้อได้'; END IF;
  IF p_year IS NULL OR p_inflation_pct IS NULL THEN RAISE EXCEPTION 'กรอกปีและอัตราเงินเฟ้อ'; END IF;
  IF p_inflation_pct <= -50 OR p_inflation_pct >= 100 THEN RAISE EXCEPTION 'อัตราเงินเฟ้อไม่สมเหตุสมผล'; END IF;
  IF p_year >= v_this_year THEN RAISE EXCEPTION 'ใส่ได้เฉพาะปีที่จบแล้ว (ใช้ค่าเฉลี่ยทั้งปี)'; END IF;
  IF length(trim(coalesce(p_source, ''))) = 0 THEN RAISE EXCEPTION 'ระบุแหล่งที่มา'; END IF;
  SELECT max(year) INTO v_last FROM public.cpi_annual WHERE deleted_at IS NULL;
  IF v_last IS NULL THEN RAISE EXCEPTION 'ยังไม่มีข้อมูลดัชนีตั้งต้น'; END IF;
  IF p_year NOT IN (v_last, v_last + 1) THEN
    RAISE EXCEPTION 'เพิ่มได้เฉพาะปีถัดไป (พ.ศ. %) หรือแก้ปีล่าสุด (พ.ศ. %)', v_last + 1 + 543, v_last + 543;
  END IF;
  SELECT cpi_index INTO v_prev FROM public.cpi_annual WHERE year = p_year - 1 AND deleted_at IS NULL;
  IF v_prev IS NULL THEN RAISE EXCEPTION 'ไม่มีดัชนีของปีก่อนหน้า'; END IF;
  IF p_year = v_last THEN
    UPDATE public.cpi_annual
       SET cpi_index = round(v_prev * (1 + p_inflation_pct / 100.0), 6), inflation_pct = p_inflation_pct,
           source = trim(p_source), notes = nullif(trim(coalesce(p_notes, '')), '')
     WHERE year = p_year AND deleted_at IS NULL;
  ELSE
    INSERT INTO public.cpi_annual (year, cpi_index, inflation_pct, source, notes)
    VALUES (p_year, round(v_prev * (1 + p_inflation_pct / 100.0), 6), p_inflation_pct, trim(p_source),
            nullif(trim(coalesce(p_notes, '')), ''));
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_cpi_year(integer, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_cpi_year(integer, numeric, text, text) TO authenticated;

-- ลบได้เฉพาะปีล่าสุด (ไม่ให้ดัชนีขาดช่วง) · ข้อมูลตั้งต้นต้องเหลืออย่างน้อย 2 ปี
CREATE OR REPLACE FUNCTION public.delete_cpi_year(p_year integer)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_last integer;
BEGIN
  IF NOT private.has_role('ADMIN') THEN RAISE EXCEPTION 'เฉพาะ ADMIN ลบดัชนีเงินเฟ้อได้'; END IF;
  SELECT max(year) INTO v_last FROM public.cpi_annual WHERE deleted_at IS NULL;
  IF p_year IS DISTINCT FROM v_last THEN RAISE EXCEPTION 'ลบได้เฉพาะปีล่าสุด'; END IF;
  IF (SELECT count(*) FROM public.cpi_annual WHERE deleted_at IS NULL) <= 2 THEN RAISE EXCEPTION 'ต้องเหลือข้อมูลอย่างน้อย 2 ปี'; END IF;
  UPDATE public.cpi_annual SET deleted_at = now() WHERE year = p_year AND deleted_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.delete_cpi_year(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_cpi_year(integer) TO authenticated;

-- 4) ต้นทุนรายก้อน: ดอกเบี้ยตามวิธีคิด (คอลัมน์เดิมเหมือนเดิม + method / cpi_factor / cpi_to_year ต่อท้าย) ---------------------------
CREATE OR REPLACE VIEW public.v_property_cost_lots WITH (security_invoker = true) AS
WITH base AS (
  SELECT a.id AS asset_id, a.currency, a.acquisition_date, a.acquisition_cost,
         least(coalesce(pd.acq_building_cost, 0), coalesce(a.acquisition_cost, 0)) AS acq_building, pd.acq_building_years,
         pd.opportunity_rate_pct AS own_rate, f.opportunity_rate_pct AS family_rate, pd.id AS property_id,
         -- วิธีคิด: แปลงที่ตั้งอัตราเอง → วิธีของแปลง (ไม่ระบุ = คงที่ เหมือนเดิม) · ไม่ได้ตั้ง → ของครอบครัว
         CASE WHEN pd.opportunity_rate_pct IS NOT NULL THEN coalesce(pd.opportunity_method, 'FIXED')
              ELSE coalesce(f.opportunity_method, 'FIXED') END AS method,
         -- มีต้นทุนรายแถว (นับแถวที่จบแล้วด้วย) → ยอดของแถวที่ยังถืออยู่
         CASE WHEN EXISTS (SELECT 1 FROM public.property_deeds d WHERE d.property_id = pd.id AND d.deleted_at IS NULL AND d.acq_cost IS NOT NULL)
              THEN coalesce((SELECT sum(d.acq_cost) FROM public.property_deeds d
                              WHERE d.property_id = pd.id AND d.deleted_at IS NULL AND d.ended_date IS NULL), 0) END AS comp_cost,
         -- "จ่ายจากบัญชี" ตอนเพิ่มทรัพย์สิน = เงินออกวันเดียวกัน ยอดเท่าราคาที่ได้มา → ซ้ำกับราคาที่ได้มา ไม่นับอีก
         (SELECT m.id FROM public.cash_movements m
           WHERE m.to_asset_id = a.id AND m.movement_type = 'ASSET_PURCHASE' AND m.deleted_at IS NULL
             AND m.movement_date = a.acquisition_date AND m.amount = a.acquisition_cost
           ORDER BY m.created_at, m.id LIMIT 1) AS acq_movement_id
    FROM public.assets a
    JOIN public.property_details pd ON pd.asset_id = a.id AND pd.deleted_at IS NULL
    LEFT JOIN public.families f ON true
   WHERE a.deleted_at IS NULL
), lots AS (
  -- แบบเดิม (ยังไม่มีต้นทุนรายแถว)
  SELECT b.asset_id, 'ACQUISITION'::text AS source, NULL::uuid AS item_id, NULL::uuid AS movement_id,
         b.acquisition_date AS lot_date, (b.acquisition_cost - b.acq_building)::public.d_money AS amount,
         CASE WHEN b.acq_building > 0 THEN 'ราคาที่ได้มา (ที่ดิน)' ELSE 'ราคาที่ได้มา' END::text AS description,
         false AS is_building, NULL::integer AS depreciation_years, NULL::text AS notes
    FROM base b WHERE b.comp_cost IS NULL AND b.acquisition_cost > b.acq_building AND b.acquisition_date IS NOT NULL
  UNION ALL
  SELECT b.asset_id, 'ACQUISITION', NULL, NULL, b.acquisition_date, b.acq_building::public.d_money, 'ราคาที่ได้มา (อาคาร)',
         true, b.acq_building_years, NULL
    FROM base b WHERE b.comp_cost IS NULL AND b.acq_building > 0 AND b.acquisition_date IS NOT NULL
  UNION ALL
  -- ต้นทุนรายแถวของส่วนประกอบที่ยังถืออยู่
  SELECT b.asset_id, 'ACQUISITION', NULL, NULL, coalesce(d.acquired_date, b.acquisition_date), d.acq_cost,
         'ราคาที่ได้มา · ' || coalesce(d.label, nullif(concat_ws(' ', d.title_type, 'เลขที่ ' || d.title_deed_no), ''),
                                      CASE d.component_type WHEN 'LAND' THEN 'ที่ดิน' WHEN 'BUILDING' THEN 'อาคาร' ELSE 'อื่น ๆ' END),
         d.component_type <> 'LAND', CASE WHEN d.component_type <> 'LAND' THEN coalesce(d.useful_life_years, 20) END, NULL
    FROM base b JOIN public.property_deeds d ON d.property_id = b.property_id AND d.deleted_at IS NULL AND d.ended_date IS NULL
   WHERE b.comp_cost IS NOT NULL AND d.acq_cost > 0 AND coalesce(d.acquired_date, b.acquisition_date) IS NOT NULL
  UNION ALL
  SELECT b.asset_id, 'ACQUISITION', NULL, NULL, b.acquisition_date, (b.acquisition_cost - b.comp_cost)::public.d_money,
         'ราคาที่ได้มา (ส่วนที่ยังไม่แยก)', false, NULL, NULL
    FROM base b WHERE b.comp_cost IS NOT NULL AND b.acquisition_cost - b.comp_cost > 0.005 AND b.acquisition_date IS NOT NULL
  UNION ALL
  -- รายการจ่าย: ผูกกับอาคาร / สิ่งปลูกสร้าง → หักค่าเสื่อมตามอายุของแถวนั้น · แถวที่จบแล้ว → ไม่นับ
  SELECT b.asset_id, 'PAYMENT', NULL, m.id, m.movement_date, m.amount,
         coalesce(m.description, 'จ่ายเพิ่ม') || coalesce(' · ' || coalesce(d.label, nullif(concat_ws(' ', d.title_type, 'เลขที่ ' || d.title_deed_no), '')), ''),
         coalesce(d.component_type <> 'LAND', false), CASE WHEN d.component_type <> 'LAND' THEN coalesce(d.useful_life_years, 20) END, NULL
    FROM base b
    JOIN public.cash_movements m ON m.to_asset_id = b.asset_id AND m.movement_type = 'ASSET_PURCHASE' AND m.deleted_at IS NULL
                                AND m.currency = b.currency
    LEFT JOIN public.property_deeds d ON d.id::text = m.metadata->>'component_id' AND d.property_id = b.property_id AND d.deleted_at IS NULL
   WHERE m.id IS DISTINCT FROM b.acq_movement_id
     AND coalesce((m.metadata->>'acquisition')::boolean, false) = false   -- เงินออกตอนเพิ่มทรัพย์สิน (เช่น เงินดาวน์) อยู่ในราคาที่ได้มาแล้ว
     AND d.ended_date IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.property_cost_items i WHERE i.movement_id = m.id AND i.deleted_at IS NULL)
  UNION ALL
  SELECT i.asset_id, CASE WHEN i.movement_id IS NULL THEN 'MANUAL' ELSE 'PAYMENT' END, i.id, i.movement_id,
         i.cost_date, i.amount, i.description, i.is_building, i.depreciation_years, i.notes
    FROM public.property_cost_items i
    JOIN base b ON b.asset_id = i.asset_id
   WHERE i.deleted_at IS NULL
     AND (i.movement_id IS NULL OR EXISTS (SELECT 1 FROM public.cash_movements m WHERE m.id = i.movement_id AND m.deleted_at IS NULL))
), cpi_last AS (
  -- ปีล่าสุดที่มีดัชนีทั้งปี (ไม่ใช้ข้อมูลบางเดือน)
  SELECT c.year, c.cpi_index FROM public.cpi_annual c WHERE c.deleted_at IS NULL ORDER BY c.year DESC LIMIT 1
), x AS (
  SELECT l.*, b.method, coalesce(b.own_rate, b.family_rate, 0) AS rate_pct,
         greatest((now() AT TIME ZONE 'Asia/Bangkok')::date - l.lot_date, 0) / 365.0 AS yrs,
         -- เงินเฟ้อ + ส่วนเพิ่ม: ดัชนีปีล่าสุด ÷ ดัชนีปีที่จ่าย · จ่ายหลังปีล่าสุด (หรือไม่มีดัชนีปีนั้น) → 1
         CASE WHEN b.method = 'CPI_PLUS' THEN
              CASE WHEN cl.year IS NULL OR extract(year FROM l.lot_date)::int >= cl.year THEN 1::numeric
                   ELSE coalesce(cl.cpi_index / nullif(c0.cpi_index, 0), 1) END END AS cpi_factor,
         cl.year AS cpi_to_year
    FROM lots l
    JOIN base b ON b.asset_id = l.asset_id
    LEFT JOIN cpi_last cl ON true
    LEFT JOIN public.cpi_annual c0 ON c0.year = extract(year FROM l.lot_date)::int AND c0.deleted_at IS NULL
)
SELECT x.asset_id, x.source, x.item_id, x.movement_id, x.lot_date, x.amount, x.description, x.is_building, x.depreciation_years, x.notes,
       x.rate_pct, round(x.yrs, 4) AS years_held,
       round(x.amount * (coalesce(x.cpi_factor, 1) * power(1 + x.rate_pct / 100.0, x.yrs) - 1), 2) AS interest,
       CASE WHEN x.is_building THEN round(x.amount * least(x.yrs / x.depreciation_years, 1), 2) ELSE 0 END AS depreciation,
       x.method, round(x.cpi_factor, 6) AS cpi_factor, x.cpi_to_year
  FROM x;
REVOKE ALL ON public.v_property_cost_lots FROM PUBLIC, anon;
GRANT SELECT ON public.v_property_cost_lots TO authenticated;

-- 5) สรุปต่อทรัพย์สิน (คอลัมน์เดิมเหมือนเดิม + วิธีคิด และเงินเฟ้อเฉลี่ยช่วงที่ถือ ไว้แสดงเทียบ) -----------------------------------
CREATE OR REPLACE VIEW public.v_property_target_price WITH (security_invoker = true) AS
WITH s AS (
  SELECT l.asset_id, count(*) AS lot_count, count(*) FILTER (WHERE l.is_building) AS building_count,
         sum(l.amount) AS cost_total, sum(l.interest) AS interest_total, sum(l.depreciation) AS depreciation_total,
         min(extract(year FROM l.lot_date))::int AS first_year
    FROM public.v_property_cost_lots l GROUP BY l.asset_id
), r AS (
  SELECT a.id AS asset_id, a.currency, pd.opportunity_rate_pct AS own_rate, f.opportunity_rate_pct AS family_rate,
         CASE WHEN pd.opportunity_rate_pct IS NOT NULL THEN coalesce(pd.opportunity_method, 'FIXED')
              ELSE coalesce(f.opportunity_method, 'FIXED') END AS method
    FROM public.assets a
    JOIN public.property_details pd ON pd.asset_id = a.id AND pd.deleted_at IS NULL
    LEFT JOIN public.families f ON true
   WHERE a.deleted_at IS NULL
), inc AS (
  SELECT x.asset_id, sum(x.base_amount) AS amt FROM public.income_transactions x
   WHERE x.deleted_at IS NULL AND x.asset_id IS NOT NULL GROUP BY x.asset_id
), exp AS (
  SELECT coalesce(e.related_asset_id, pd.asset_id) AS asset_id, sum(e.base_amount) AS amt
    FROM public.expense_items e
    LEFT JOIN public.property_utilities u ON u.id = e.property_utility_id
    LEFT JOIN public.property_details pd ON pd.id = u.property_id
   WHERE e.deleted_at IS NULL AND (e.related_asset_id IS NOT NULL OR e.property_utility_id IS NOT NULL)
   GROUP BY 1
), cl AS (
  SELECT c.year, c.cpi_index FROM public.cpi_annual c WHERE c.deleted_at IS NULL ORDER BY c.year DESC LIMIT 1
)
SELECT r.asset_id, r.currency,
       coalesce(r.own_rate, r.family_rate) AS rate_pct,
       CASE WHEN r.own_rate IS NOT NULL THEN 'ASSET' WHEN r.family_rate IS NOT NULL THEN 'FAMILY' END AS rate_source,
       coalesce(s.lot_count, 0) AS lot_count, coalesce(s.building_count, 0) AS building_count,
       s.cost_total, s.interest_total, s.depreciation_total,
       s.cost_total + s.interest_total - s.depreciation_total AS carrying_value,
       mk.id AS market_id, mk.market_value, mk.valuation_date AS market_date,
       round(coalesce(mk.tax_transfer_estimate, 0) + coalesce(mk.other_selling_cost, 0) + coalesce(mk.broker_fee_amount, 0), 2) AS fixed_selling_cost,
       mk.broker_fee_pct,
       CASE WHEN s.cost_total IS NULL THEN NULL
            ELSE round((s.cost_total + s.interest_total - s.depreciation_total
                        + coalesce(mk.tax_transfer_estimate, 0) + coalesce(mk.other_selling_cost, 0) + coalesce(mk.broker_fee_amount, 0))
                       / nullif(1 - coalesce(mk.broker_fee_pct, 0) / 100.0, 0), 2) END AS min_price,
       round(coalesce(inc.amt, 0) - coalesce(exp.amt, 0), 2) AS net_income_thb,
       coalesce(inc.amt, 0) AS income_thb, coalesce(exp.amt, 0) AS expense_thb,
       r.method,
       -- เงินเฟ้อเฉลี่ยต่อปี ตั้งแต่ปีที่จ่ายก้อนแรก ถึงปีล่าสุดที่มีดัชนี (ไว้แสดงเทียบ)
       CASE WHEN s.first_year < cl.year THEN s.first_year END AS cpi_from_year,
       CASE WHEN s.first_year < cl.year THEN cl.year END AS cpi_to_year,
       CASE WHEN s.first_year < cl.year AND c0.cpi_index > 0
            THEN round((power(cl.cpi_index / c0.cpi_index, 1.0 / (cl.year - s.first_year)) - 1) * 100, 2) END AS cpi_avg_pct
  FROM r
  LEFT JOIN s ON s.asset_id = r.asset_id
  LEFT JOIN public.v_property_market_latest mk ON mk.asset_id = r.asset_id
  LEFT JOIN inc ON inc.asset_id = r.asset_id
  LEFT JOIN exp ON exp.asset_id = r.asset_id
  LEFT JOIN cl ON true
  LEFT JOIN public.cpi_annual c0 ON c0.year = s.first_year AND c0.deleted_at IS NULL;
REVOKE ALL ON public.v_property_target_price FROM PUBLIC, anon;
GRANT SELECT ON public.v_property_target_price TO authenticated;
