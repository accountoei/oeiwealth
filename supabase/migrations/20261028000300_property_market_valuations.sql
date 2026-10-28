-- =====================================================================
-- Property: ราคาตลาด (อ้างอิง) — ตกลง 28 ต.ค. 2026 (PR 1)
--   ตารางใหม่ property_market_valuations = ประวัติการประเมินราคาตลาด 1 แถวต่อ 1 ครั้ง (ไม่ทับของเดิม)
--   ★ ไม่นับเข้า Net Worth: ไม่อ่านโดย net_worth_items / snapshot / กำไรขาดทุนตอนขาย · ไม่ติดล็อกงวด
--   ราคา: ต่อ ตร.ว. (ที่ดิน) / ต่อ ตร.ม. (คอนโด) × เนื้อที่ → ระบบคำนวณยอดรวม · หรือใส่ยอดรวมตรง ๆ
--   ช่วงราคา ต่ำ / สูง (ไม่บังคับ) · วิธีประเมิน · ที่มา · ความเชื่อมั่น
--   ค่าใช้จ่ายขายโดยประมาณ: นายหน้า (% หรือบาท) · ภาษี / ค่าโอน · อื่น ๆ
--   view v_property_market_latest = ครั้งล่าสุดต่อทรัพย์สิน (วันที่ประเมินใหม่ที่สุด) + ค่าใช้จ่ายขาย + สุทธิก่อนปิดหนี้
--   เพิ่มอย่างเดียว ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.property_market_valuations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id              uuid NOT NULL REFERENCES public.assets(id),
  valuation_date        date NOT NULL,
  unit_basis            text NOT NULL DEFAULT 'TOTAL',          -- SQ_WA (ต่อ ตร.ว.) · SQ_M (ต่อ ตร.ม.) · TOTAL (ยอดรวม)
  unit_price            numeric(18,2),                          -- ราคาต่อหน่วย (เมื่อไม่ใช่ TOTAL)
  area                  numeric(14,2),                          -- เนื้อที่ที่ใช้คำนวณ ณ วันประเมิน (ตร.ว. / ตร.ม.)
  market_value          public.d_money NOT NULL,                -- ราคากลาง (ยอดรวม)
  value_low             public.d_money,
  value_high            public.d_money,
  currency              public.d_currency NOT NULL DEFAULT 'THB',
  method                text NOT NULL DEFAULT 'OWNER_ESTIMATE',
  price_type            text,                                   -- LISTING (ราคาประกาศขาย) · TRANSACTION (ราคาซื้อขายจริง) · APPRAISAL (ผู้ประเมิน)
  source                text,                                   -- เช่น "นายหน้า ก." · "ประกาศขายแถวนั้น"
  confidence            text,                                   -- HIGH · MEDIUM · LOW
  broker_fee_pct        numeric(6,3),                           -- ค่านายหน้า % ของราคากลาง
  broker_fee_amount     public.d_money,                         -- หรือเป็นบาท
  tax_transfer_estimate public.d_money,                         -- ภาษี + ค่าโอนโดยประมาณ (กรอกเอง)
  other_selling_cost    public.d_money,
  notes                 text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id),
  CONSTRAINT pmv_unit_basis_ck  CHECK (unit_basis IN ('SQ_WA','SQ_M','TOTAL')),
  CONSTRAINT pmv_unit_ck        CHECK (unit_basis = 'TOTAL' OR (unit_price > 0 AND area > 0)),
  CONSTRAINT pmv_value_ck       CHECK (market_value > 0),
  CONSTRAINT pmv_range_ck       CHECK ((value_low IS NULL OR value_low <= market_value) AND (value_high IS NULL OR value_high >= market_value)),
  CONSTRAINT pmv_method_ck      CHECK (method IN ('OWNER_ESTIMATE','BROKER','APPRAISER','COMPARABLE_SALES','OTHER')),
  CONSTRAINT pmv_price_type_ck  CHECK (price_type IS NULL OR price_type IN ('LISTING','TRANSACTION','APPRAISAL')),
  CONSTRAINT pmv_confidence_ck  CHECK (confidence IS NULL OR confidence IN ('HIGH','MEDIUM','LOW')),
  CONSTRAINT pmv_broker_ck      CHECK ((broker_fee_pct IS NULL OR broker_fee_pct BETWEEN 0 AND 100)
                                       AND (broker_fee_amount IS NULL OR broker_fee_amount >= 0)
                                       AND num_nonnulls(broker_fee_pct, broker_fee_amount) <= 1),
  CONSTRAINT pmv_costs_ck       CHECK ((tax_transfer_estimate IS NULL OR tax_transfer_estimate >= 0)
                                       AND (other_selling_cost IS NULL OR other_selling_cost >= 0))
);
CREATE INDEX IF NOT EXISTS pmv_asset_idx ON public.property_market_valuations(asset_id, valuation_date DESC);
-- 1 ทรัพย์สิน ประเมินได้ 1 ครั้งต่อวัน (กันกดบันทึกซ้ำ) · แก้ของวันนั้นแทน
CREATE UNIQUE INDEX IF NOT EXISTS pmv_asset_date_uq ON public.property_market_valuations(asset_id, valuation_date) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS t10_meta ON public.property_market_valuations;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.property_market_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.property_market_valuations;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.property_market_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.property_market_valuations;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.property_market_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

-- ตรวจ + คำนวณ: ต้องเป็น Property · ห้ามวันในอนาคต · ราคาต่อหน่วย × เนื้อที่ = ราคากลาง · สกุลเงินตามทรัพย์สิน
CREATE OR REPLACE FUNCTION private.tg_market_valuation_check() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ccy text;
BEGIN
  SELECT a.currency INTO v_ccy FROM public.assets a
   WHERE a.id = NEW.asset_id AND a.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.property_details pd WHERE pd.asset_id = a.id AND pd.deleted_at IS NULL);
  IF v_ccy IS NULL THEN
    RAISE EXCEPTION 'INVALID: ประเมินราคาตลาดได้เฉพาะทรัพย์สินประเภท Property' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.asset_id IS DISTINCT FROM OLD.asset_id THEN
    RAISE EXCEPTION 'INVALID: ย้ายการประเมินไปทรัพย์สินอื่นไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF NEW.valuation_date > current_date THEN
    RAISE EXCEPTION 'INVALID: วันที่ประเมินเป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023';
  END IF;
  NEW.currency := v_ccy;
  IF NEW.unit_basis = 'TOTAL' THEN
    NEW.unit_price := NULL;
    NEW.area := NULL;
  ELSIF NEW.unit_price > 0 AND NEW.area > 0 THEN
    NEW.market_value := round(NEW.unit_price * NEW.area, 2);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_market_valuation_check() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t20_check ON public.property_market_valuations;
CREATE TRIGGER t20_check BEFORE INSERT OR UPDATE ON public.property_market_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_market_valuation_check();

ALTER TABLE public.property_market_valuations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_market_valuations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.property_market_valuations TO authenticated;
DROP POLICY IF EXISTS p_select ON public.property_market_valuations;
CREATE POLICY p_select ON public.property_market_valuations FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
DROP POLICY IF EXISTS p_insert ON public.property_market_valuations;
CREATE POLICY p_insert ON public.property_market_valuations FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR')));
DROP POLICY IF EXISTS p_update ON public.property_market_valuations;
CREATE POLICY p_update ON public.property_market_valuations FOR UPDATE TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND created_at >= now() - interval '24 hours' AND deleted_at IS NULL))
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND deleted_at IS NULL));

-- ค่าใช้จ่ายขาย + สุทธิก่อนปิดหนี้ (ทุกแถว) · ครั้งล่าสุดต่อทรัพย์สิน = วันที่ประเมินใหม่ที่สุด
CREATE OR REPLACE VIEW public.v_property_market_valuations WITH (security_invoker = true) AS
  SELECT v.*,
         round(coalesce(v.broker_fee_amount, v.market_value * v.broker_fee_pct / 100, 0)
               + coalesce(v.tax_transfer_estimate, 0) + coalesce(v.other_selling_cost, 0), 2) AS selling_cost,
         round(v.market_value - coalesce(v.broker_fee_amount, v.market_value * v.broker_fee_pct / 100, 0)
               - coalesce(v.tax_transfer_estimate, 0) - coalesce(v.other_selling_cost, 0), 2) AS net_before_debt
    FROM public.property_market_valuations v
   WHERE v.deleted_at IS NULL;
REVOKE ALL ON public.v_property_market_valuations FROM PUBLIC, anon;
GRANT SELECT ON public.v_property_market_valuations TO authenticated;

CREATE OR REPLACE VIEW public.v_property_market_latest WITH (security_invoker = true) AS
  SELECT DISTINCT ON (v.asset_id) v.*,
         (SELECT count(*) FROM public.property_market_valuations x WHERE x.asset_id = v.asset_id AND x.deleted_at IS NULL) AS valuation_count
    FROM public.v_property_market_valuations v
   ORDER BY v.asset_id, v.valuation_date DESC, v.created_at DESC;
REVOKE ALL ON public.v_property_market_latest FROM PUBLIC, anon;
GRANT SELECT ON public.v_property_market_latest TO authenticated;
