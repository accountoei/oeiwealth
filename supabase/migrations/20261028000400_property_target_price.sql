-- =====================================================================
-- Property: ราคาขายขั้นต่ำที่คุ้ม = ต้นทุน + ดอกเบี้ยตามระยะเวลาถือ − ค่าเสื่อมอาคาร (ตกลง 28 ต.ค. 2026)
--   ★ ข้อมูลอ้างอิงเท่านั้น ไม่นับเข้า Net Worth / snapshot / กำไรขาดทุนตอนขาย · ไม่ติดล็อกงวด
--   อัตราดอกเบี้ยเทียบ (ต้นทุนเสียโอกาส): families.opportunity_rate_pct (ADMIN ตั้งที่ Settings › FX & Prices)
--     แก้รายแปลงได้ที่ property_details.opportunity_rate_pct (ว่าง = ใช้อัตราครอบครัว)
--   ต้นทุนแต่ละก้อน (v_property_cost_lots):
--     ราคาที่ได้มา + วันที่ได้มา (assets) · "จ่ายซื้อ / จ่ายเพิ่ม" ที่บันทึกในระบบ (cash_movements ASSET_PURCHASE ·
--     ไม่นับก้อนที่ระบบสร้างจาก "จ่ายจากบัญชี" ตอนเพิ่มทรัพย์สิน ซึ่งซ้ำกับราคาที่ได้มา) · ต้นทุนเพิ่มที่กรอกเอง (property_cost_items
--     เช่น ค่าก่อสร้างก่อน go-live) · จ่ายเพิ่มในระบบตั้งเป็น "อาคาร" ได้ (property_cost_items.movement_id)
--   ดอกเบี้ยทบต้น = ยอด × ((1 + อัตรา)^(วันที่ถือ ÷ 365) − 1) · อาคาร / สิ่งปลูกสร้าง หักค่าเสื่อมเส้นตรง (ค่าตั้งต้น 20 ปี)
--   ราคาขายขั้นต่ำ = (ต้นทุน + ดอกเบี้ย − ค่าเสื่อม + ภาษี / ค่าโอน + อื่น ๆ) ÷ (1 − นายหน้า %) หรือ + นายหน้าเป็นบาท
--     ค่าใช้จ่ายขายจากการประเมินราคาตลาดครั้งล่าสุด · รายได้ − ค่าใช้จ่ายของทรัพย์สินที่บันทึกแล้ว แสดงประกอบ (ไม่หัก)
--   เพิ่มอย่างเดียว ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

ALTER TABLE public.families ADD COLUMN IF NOT EXISTS opportunity_rate_pct numeric(6,3);
ALTER TABLE public.property_details ADD COLUMN IF NOT EXISTS opportunity_rate_pct numeric(6,3);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'families_opportunity_rate_ck') THEN
    ALTER TABLE public.families ADD CONSTRAINT families_opportunity_rate_ck CHECK (opportunity_rate_pct IS NULL OR opportunity_rate_pct BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pd_opportunity_rate_ck') THEN
    ALTER TABLE public.property_details ADD CONSTRAINT pd_opportunity_rate_ck CHECK (opportunity_rate_pct IS NULL OR opportunity_rate_pct BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.property_cost_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id            uuid NOT NULL REFERENCES public.assets(id),
  movement_id         uuid REFERENCES public.cash_movements(id),   -- ตั้ง "จ่ายเพิ่ม" ที่บันทึกในระบบเป็นอาคาร (ยอด / วันที่ตามรายการเงินออก)
  cost_date           date NOT NULL,
  amount              public.d_money NOT NULL,
  description         text,
  is_building         boolean NOT NULL DEFAULT false,               -- อาคาร / สิ่งปลูกสร้าง → หักค่าเสื่อม
  depreciation_years  integer NOT NULL DEFAULT 20,
  notes               text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id),
  CONSTRAINT pci_amount_ck CHECK (amount > 0),
  CONSTRAINT pci_years_ck  CHECK (depreciation_years BETWEEN 1 AND 100)
);
CREATE INDEX IF NOT EXISTS pci_asset_idx ON public.property_cost_items(asset_id, cost_date);
CREATE UNIQUE INDEX IF NOT EXISTS pci_movement_uq ON public.property_cost_items(movement_id) WHERE movement_id IS NOT NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS t10_meta ON public.property_cost_items;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.property_cost_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.property_cost_items;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.property_cost_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.property_cost_items;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.property_cost_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

-- ต้องเป็น Property · ห้ามย้ายทรัพย์สิน · ห้ามวันในอนาคต · ผูกเงินออก → ต้องเป็น "จ่ายซื้อ / จ่ายเพิ่ม" ของทรัพย์สินนี้ และใช้ยอด / วันที่ตามเงินออก
CREATE OR REPLACE FUNCTION private.tg_property_cost_item_check() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE m record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.assets a JOIN public.property_details pd ON pd.asset_id = a.id AND pd.deleted_at IS NULL
                  WHERE a.id = NEW.asset_id AND a.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ต้นทุนเพิ่มใช้ได้เฉพาะทรัพย์สินประเภท Property' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.movement_id IS DISTINCT FROM OLD.movement_id) THEN
    RAISE EXCEPTION 'INVALID: ย้ายต้นทุนไปทรัพย์สิน / รายการอื่นไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_id IS NOT NULL THEN
    SELECT mv.movement_date, mv.amount INTO m FROM public.cash_movements mv
     WHERE mv.id = NEW.movement_id AND mv.to_asset_id = NEW.asset_id AND mv.movement_type = 'ASSET_PURCHASE' AND mv.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID: รายการเงินออกนี้ไม่ใช่การจ่ายซื้อ / จ่ายเพิ่มของทรัพย์สินนี้' USING ERRCODE = '22023';
    END IF;
    NEW.cost_date := m.movement_date;
    NEW.amount := m.amount;
  END IF;
  IF NEW.cost_date > current_date THEN
    RAISE EXCEPTION 'INVALID: วันที่จ่ายเป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_property_cost_item_check() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t20_check ON public.property_cost_items;
CREATE TRIGGER t20_check BEFORE INSERT OR UPDATE ON public.property_cost_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_property_cost_item_check();

ALTER TABLE public.property_cost_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_cost_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.property_cost_items TO authenticated;
DROP POLICY IF EXISTS p_select ON public.property_cost_items;
CREATE POLICY p_select ON public.property_cost_items FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
DROP POLICY IF EXISTS p_insert ON public.property_cost_items;
CREATE POLICY p_insert ON public.property_cost_items FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR')));
DROP POLICY IF EXISTS p_update ON public.property_cost_items;
CREATE POLICY p_update ON public.property_cost_items FOR UPDATE TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND created_at >= now() - interval '24 hours' AND deleted_at IS NULL))
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND deleted_at IS NULL));

-- ต้นทุนแต่ละก้อน + ดอกเบี้ย / ค่าเสื่อม ณ วันนี้ (เวลาไทย)
CREATE OR REPLACE VIEW public.v_property_cost_lots WITH (security_invoker = true) AS
WITH base AS (
  SELECT a.id AS asset_id, a.currency, a.acquisition_date, a.acquisition_cost,
         pd.opportunity_rate_pct AS own_rate, f.opportunity_rate_pct AS family_rate,
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
  SELECT b.asset_id, 'ACQUISITION'::text AS source, NULL::uuid AS item_id, NULL::uuid AS movement_id,
         b.acquisition_date AS lot_date, b.acquisition_cost AS amount, 'ราคาที่ได้มา'::text AS description,
         false AS is_building, NULL::integer AS depreciation_years, NULL::text AS notes
    FROM base b WHERE b.acquisition_cost > 0 AND b.acquisition_date IS NOT NULL
  UNION ALL
  SELECT b.asset_id, 'PAYMENT', NULL, m.id, m.movement_date, m.amount, coalesce(m.description, 'จ่ายเพิ่ม'), false, NULL, NULL
    FROM base b
    JOIN public.cash_movements m ON m.to_asset_id = b.asset_id AND m.movement_type = 'ASSET_PURCHASE' AND m.deleted_at IS NULL
                                AND m.currency = b.currency
   WHERE m.id IS DISTINCT FROM b.acq_movement_id
     AND NOT EXISTS (SELECT 1 FROM public.property_cost_items i WHERE i.movement_id = m.id AND i.deleted_at IS NULL)
  UNION ALL
  SELECT i.asset_id, CASE WHEN i.movement_id IS NULL THEN 'MANUAL' ELSE 'PAYMENT' END, i.id, i.movement_id,
         i.cost_date, i.amount, i.description, i.is_building, i.depreciation_years, i.notes
    FROM public.property_cost_items i
    JOIN base b ON b.asset_id = i.asset_id
   WHERE i.deleted_at IS NULL
     AND (i.movement_id IS NULL OR EXISTS (SELECT 1 FROM public.cash_movements m WHERE m.id = i.movement_id AND m.deleted_at IS NULL))
)
SELECT l.*, coalesce(b.own_rate, b.family_rate, 0) AS rate_pct,
       round(greatest((now() AT TIME ZONE 'Asia/Bangkok')::date - l.lot_date, 0) / 365.0, 4) AS years_held,
       round(l.amount * (power(1 + coalesce(b.own_rate, b.family_rate, 0) / 100.0,
                               greatest((now() AT TIME ZONE 'Asia/Bangkok')::date - l.lot_date, 0) / 365.0) - 1), 2) AS interest,
       CASE WHEN l.is_building THEN round(l.amount * least(greatest((now() AT TIME ZONE 'Asia/Bangkok')::date - l.lot_date, 0) / 365.0
                                                           / l.depreciation_years, 1), 2) ELSE 0 END AS depreciation
  FROM lots l JOIN base b ON b.asset_id = l.asset_id;
REVOKE ALL ON public.v_property_cost_lots FROM PUBLIC, anon;
GRANT SELECT ON public.v_property_cost_lots TO authenticated;

-- สรุปต่อทรัพย์สิน: ต้นทุน + ดอกเบี้ย − ค่าเสื่อม → ราคาขายขั้นต่ำที่คุ้ม (ค่าใช้จ่ายขายจากราคาตลาดครั้งล่าสุด)
CREATE OR REPLACE VIEW public.v_property_target_price WITH (security_invoker = true) AS
WITH s AS (
  SELECT l.asset_id, count(*) AS lot_count, count(*) FILTER (WHERE l.is_building) AS building_count,
         sum(l.amount) AS cost_total, sum(l.interest) AS interest_total, sum(l.depreciation) AS depreciation_total
    FROM public.v_property_cost_lots l GROUP BY l.asset_id
), r AS (
  SELECT a.id AS asset_id, a.currency, pd.opportunity_rate_pct AS own_rate, f.opportunity_rate_pct AS family_rate
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
       coalesce(inc.amt, 0) AS income_thb, coalesce(exp.amt, 0) AS expense_thb
  FROM r
  LEFT JOIN s ON s.asset_id = r.asset_id
  LEFT JOIN public.v_property_market_latest mk ON mk.asset_id = r.asset_id
  LEFT JOIN inc ON inc.asset_id = r.asset_id
  LEFT JOIN exp ON exp.asset_id = r.asset_id;
REVOKE ALL ON public.v_property_target_price FROM PUBLIC, anon;
GRANT SELECT ON public.v_property_target_price TO authenticated;
