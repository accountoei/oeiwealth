-- =====================================================================
-- Private Business: ผลประกอบการรายปี + สินทรัพย์ถาวร + บริษัทที่ปิดแล้ว (ตกลง 9 พ.ย. 2026)
--   private_business_details.established_date : วันที่จัดตั้งบริษัท (ไม่บังคับ)
--   past_businesses            : บริษัทในประวัติ (ปิดไปแล้ว · ไม่ใช่ทรัพย์สิน → ไม่นับในความมั่งคั่งสุทธิ)
--   business_financial_years   : ผลประกอบการ 1 แถวต่อบริษัทต่อปีบัญชี (ตัวเลขของทั้งบริษัท 100%)
--                                ผูกกับกิจการ (asset_id) หรือบริษัทในประวัติ (past_business_id) อย่างใดอย่างหนึ่ง
--                                ข้อมูลดูอย่างเดียว: ไม่สร้างรายได้ / เงินเข้าออก · ไม่ล็อกตามงวด · ใส่ปีก่อน Go-live ได้
--   RLS มาตรฐาน + trigger META / soft delete / audit เหมือนตารางข้อมูลอื่น
--   เพิ่มคอลัมน์ / ตารางใหม่อย่างเดียว · ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

ALTER TABLE public.private_business_details ADD COLUMN IF NOT EXISTS established_date date;

-- ---------------------------------------------------------------- บริษัทในประวัติ
CREATE TABLE IF NOT EXISTS public.past_businesses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),   -- ชื่อย่อ เช่น KIP
  company_name     text CHECK (company_name IS NULL OR length(company_name) <= 200),
  established_date date,
  closed_date      date,
  notes            text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id),
  CONSTRAINT past_businesses_dates_ck CHECK (closed_date IS NULL OR established_date IS NULL OR closed_date >= established_date)
);

-- ---------------------------------------------------------------- ผลประกอบการรายปี
CREATE TABLE IF NOT EXISTS public.business_financial_years (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id               uuid REFERENCES public.assets(id),
  past_business_id       uuid REFERENCES public.past_businesses(id),
  fiscal_year            integer NOT NULL CHECK (fiscal_year BETWEEN 1900 AND 2200),   -- ค.ศ. (แสดงเป็น พ.ศ.) · สิ้นงวด 31 ธ.ค.
  revenue_domestic       numeric CHECK (revenue_domestic IS NULL OR revenue_domestic >= 0),
  revenue_foreign        numeric CHECK (revenue_foreign IS NULL OR revenue_foreign >= 0),
  employees              integer CHECK (employees IS NULL OR employees >= 0),          -- รวมผู้บริหาร
  executives             integer CHECK (executives IS NULL OR executives >= 0),
  corporate_tax          numeric,
  net_profit             numeric,                                                        -- ติดลบ = ขาดทุน
  dividends_paid         numeric CHECK (dividends_paid IS NULL OR dividends_paid >= 0),  -- ที่บริษัทจ่ายทั้งบริษัท
  equity                 numeric,                                                        -- ส่วนของผู้ถือหุ้น ณ สิ้นปี
  land_value             numeric CHECK (land_value IS NULL OR land_value >= 0),
  building_cost          numeric CHECK (building_cost IS NULL OR building_cost >= 0),
  building_depreciation  numeric CHECK (building_depreciation IS NULL OR building_depreciation >= 0),
  equipment_cost         numeric CHECK (equipment_cost IS NULL OR equipment_cost >= 0),      -- ยานพาหนะ / เครื่องจักร / อุปกรณ์
  equipment_depreciation numeric CHECK (equipment_depreciation IS NULL OR equipment_depreciation >= 0),
  audit_status           text NOT NULL DEFAULT 'AUDITED' CHECK (audit_status IN ('AUDITED', 'PRE_AUDIT', 'ESTIMATE')),
  notes                  text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id),
  CONSTRAINT bfy_one_company_ck CHECK ((asset_id IS NULL) <> (past_business_id IS NULL)),
  CONSTRAINT bfy_executives_ck CHECK (executives IS NULL OR employees IS NULL OR executives <= employees)
);
-- ปีละ 1 แถวต่อบริษัท (ไม่นับแถวที่ลบแล้ว)
CREATE UNIQUE INDEX IF NOT EXISTS bfy_asset_year_uq ON public.business_financial_years(asset_id, fiscal_year)
  WHERE deleted_at IS NULL AND asset_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bfy_past_year_uq ON public.business_financial_years(past_business_id, fiscal_year)
  WHERE deleted_at IS NULL AND past_business_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bfy_past_idx ON public.business_financial_years(past_business_id) WHERE past_business_id IS NOT NULL;

-- กิจการต้องเป็น Private Business
CREATE OR REPLACE FUNCTION private.tg_business_financial_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.asset_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.private_business_details d WHERE d.asset_id = NEW.asset_id AND d.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ผลประกอบการบันทึกได้เฉพาะกิจการ (Private Business)' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t20_check ON public.business_financial_years;
CREATE TRIGGER t20_check BEFORE INSERT OR UPDATE OF asset_id ON public.business_financial_years
  FOR EACH ROW EXECUTE FUNCTION private.tg_business_financial_check();

-- ---------------------------------------------------------------- trigger มาตรฐาน + RLS (2 ตาราง)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['past_businesses', 'business_financial_years'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS t10_meta ON public.%I', t);
    EXECUTE format($f$CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft')$f$, t);
    EXECUTE format('DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS z90_audit ON public.%I', t);
    EXECUTE format('CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.tg_audit()', t);

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS p_select ON public.%I', t);
    EXECUTE format($f$CREATE POLICY p_select ON public.%I FOR SELECT TO authenticated
      USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')))$f$, t);
    EXECUTE format('DROP POLICY IF EXISTS p_insert ON public.%I', t);
    EXECUTE format($f$CREATE POLICY p_insert ON public.%I FOR INSERT TO authenticated
      WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR')))$f$, t);
    EXECUTE format('DROP POLICY IF EXISTS p_update ON public.%I', t);
    EXECUTE format($f$CREATE POLICY p_update ON public.%I FOR UPDATE TO authenticated
      USING ((SELECT private.has_role('ADMIN','EDITOR'))
             OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
                 AND created_at >= now() - interval '24 hours' AND deleted_at IS NULL))
      WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR'))
             OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
                 AND deleted_at IS NULL))$f$, t);
  END LOOP;
END $$;
