-- =====================================================================
-- Property: จ่ายเพิ่ม + อาคาร + เพิ่มมูลค่าอัตโนมัติ (ตกลง 28 ต.ค. 2026)
--   1) property_details.acq_building_cost / acq_building_years = ส่วนของ "ราคาที่ได้มา" ที่เป็นอาคาร
--      (บ้าน / คอนโดที่ซื้อพร้อมอาคาร) → ราคาที่ได้มาแยกเป็นที่ดิน + อาคาร (หักค่าเสื่อมเฉพาะส่วนอาคาร) ใน v_property_cost_lots
--   2) "จ่ายซื้อ / จ่ายเพิ่ม" ของ Property ติ๊ก "เพิ่มมูลค่าตามยอดนี้" (cash_movements.metadata.add_value = true)
--      → ระบบบันทึกมูลค่าใหม่ = มูลค่าล่าสุด ณ วันที่จ่าย + ยอดจ่าย (asset_valuations.source_movement_id ผูกไว้)
--      แก้ยอด / วันที่ของรายการจ่าย → มูลค่าที่ระบบเพิ่มให้ปรับตามส่วนต่าง · ลบรายการจ่าย → ลบมูลค่านั้นด้วย
--      (เดือนที่ปิดงวดแล้ว แก้ / ลบไม่ได้เหมือนเดิม)
--   ★ ไม่แก้ / ไม่ลบข้อมูลเดิม · รายการจ่ายเดิมไม่มี add_value → ไม่กระทบ · รันซ้ำได้
-- =====================================================================

ALTER TABLE public.property_details ADD COLUMN IF NOT EXISTS acq_building_cost public.d_money;
ALTER TABLE public.property_details ADD COLUMN IF NOT EXISTS acq_building_years integer NOT NULL DEFAULT 20;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pd_acq_building_ck') THEN
    ALTER TABLE public.property_details ADD CONSTRAINT pd_acq_building_ck
      CHECK ((acq_building_cost IS NULL OR acq_building_cost >= 0) AND acq_building_years BETWEEN 1 AND 100);
  END IF;
END $$;

ALTER TABLE public.asset_valuations ADD COLUMN IF NOT EXISTS source_movement_id uuid REFERENCES public.cash_movements(id);
CREATE INDEX IF NOT EXISTS asset_valuations_source_movement_idx ON public.asset_valuations(source_movement_id) WHERE source_movement_id IS NOT NULL;

-- จ่ายเพิ่มที่ติ๊ก "เพิ่มมูลค่า" → มูลค่าใหม่ / ปรับตาม / ลบตาม
CREATE OR REPLACE FUNCTION private.tg_property_pay_value() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_prev numeric; v_ccy text;
BEGIN
  IF NEW.movement_type <> 'ASSET_PURCHASE' OR coalesce(NEW.metadata->>'add_value', '') <> 'true' THEN RETURN NULL; END IF;
  SELECT a.currency INTO v_ccy FROM public.assets a
   WHERE a.id = NEW.to_asset_id AND EXISTS (SELECT 1 FROM public.property_details pd WHERE pd.asset_id = a.id AND pd.deleted_at IS NULL);
  IF v_ccy IS NULL OR v_ccy <> NEW.currency THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
    SELECT v.value INTO v_prev FROM public.asset_valuations v
     WHERE v.asset_id = NEW.to_asset_id AND v.deleted_at IS NULL AND v.valuation_date <= NEW.movement_date
     ORDER BY v.valuation_date DESC, v.created_at DESC LIMIT 1;
    INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes, source_movement_id)
    VALUES (NEW.to_asset_id, NEW.movement_date, coalesce(v_prev, 0) + NEW.amount, 'BOOK_VALUE', 'USER',
            'จ่ายเพิ่ม' || coalesce(' · ' || nullif(trim(NEW.description), ''), ''), NEW.id);
  ELSIF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.asset_valuations SET deleted_at = now() WHERE source_movement_id = NEW.id AND deleted_at IS NULL;
  ELSIF NEW.deleted_at IS NULL AND (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.movement_date IS DISTINCT FROM OLD.movement_date) THEN
    UPDATE public.asset_valuations SET value = value + (NEW.amount - OLD.amount), valuation_date = NEW.movement_date
     WHERE source_movement_id = NEW.id AND deleted_at IS NULL;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.tg_property_pay_value() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS a70_property_pay_value ON public.cash_movements;
CREATE TRIGGER a70_property_pay_value AFTER INSERT OR UPDATE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.tg_property_pay_value();

-- ต้นทุนแต่ละก้อน: ราคาที่ได้มาแยกที่ดิน + อาคาร (ถ้าระบุค่าอาคาร)
CREATE OR REPLACE VIEW public.v_property_cost_lots WITH (security_invoker = true) AS
WITH base AS (
  SELECT a.id AS asset_id, a.currency, a.acquisition_date, a.acquisition_cost,
         least(coalesce(pd.acq_building_cost, 0), coalesce(a.acquisition_cost, 0)) AS acq_building, pd.acq_building_years,
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
         b.acquisition_date AS lot_date, (b.acquisition_cost - b.acq_building)::public.d_money AS amount,
         CASE WHEN b.acq_building > 0 THEN 'ราคาที่ได้มา (ที่ดิน)' ELSE 'ราคาที่ได้มา' END::text AS description,
         false AS is_building, NULL::integer AS depreciation_years, NULL::text AS notes
    FROM base b WHERE b.acquisition_cost > b.acq_building AND b.acquisition_date IS NOT NULL
  UNION ALL
  SELECT b.asset_id, 'ACQUISITION', NULL, NULL, b.acquisition_date, b.acq_building::public.d_money, 'ราคาที่ได้มา (อาคาร)',
         true, b.acq_building_years, NULL
    FROM base b WHERE b.acq_building > 0 AND b.acquisition_date IS NOT NULL
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
