-- =====================================================================
-- Insurance: บัญชี / บัตรจ่ายเบี้ยตั้งต้นของกรมธรรม์ (ตกลง 3 พ.ย. 2026 · แบบค่าใช้จ่ายประจำของทรัพย์สิน)
--   insurance_policies.paid_from_asset_id       = จ่ายเบี้ยจากบัญชีธนาคาร (สกุลเดียวกับเบี้ย)
--   insurance_policies.paid_from_credit_card_id = หรือจ่ายจากบัตรเครดิต (เลือกได้อย่างใดอย่างหนึ่ง)
--   ใช้เป็นค่าตั้งต้นของแท็บจ่ายชำระเบี้ย / ปุ่มจ่ายในหน้ากรมธรรม์เท่านั้น (เปลี่ยนในฟอร์ม = มีผลครั้งนั้นครั้งเดียว)
--   ตรวจบัญชี / บัตรเฉพาะตอนตั้ง / เปลี่ยนค่า (บัญชีที่ปิดหรือลบทีหลัง → หน้าเว็บกลับไปเลือกบัญชีแรกแบบเดิม)
--   v_insurance_status ใช้ p.* (ขยายคอลัมน์ตอนสร้าง) → สร้างใหม่ให้มีคอลัมน์ใหม่ (ไม่มี view อื่นอ้างถึง)
--   เพิ่มคอลัมน์อย่างเดียว ไม่แตะข้อมูลเดิม · สิทธิ์ / RLS / Audit ใช้ของตารางเดิม · รันซ้ำได้
-- =====================================================================

ALTER TABLE public.insurance_policies
  ADD COLUMN IF NOT EXISTS paid_from_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL;
ALTER TABLE public.insurance_policies
  ADD COLUMN IF NOT EXISTS paid_from_credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.insurance_policies ADD CONSTRAINT ip_paid_from_ck
    CHECK (paid_from_asset_id IS NULL OR paid_from_credit_card_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ip_paid_from_asset_idx ON public.insurance_policies(paid_from_asset_id) WHERE paid_from_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ip_paid_from_card_idx ON public.insurance_policies(paid_from_credit_card_id) WHERE paid_from_credit_card_id IS NOT NULL;

COMMENT ON COLUMN public.insurance_policies.paid_from_asset_id IS
  'บัญชีธนาคาร (BANK_ACCOUNT · สกุลเดียวกับเบี้ย) ที่จ่ายเบี้ย — ค่าตั้งต้นของฟอร์มจ่ายเบี้ย';
COMMENT ON COLUMN public.insurance_policies.paid_from_credit_card_id IS
  'บัตรเครดิต (สกุลเดียวกับเบี้ย) ที่จ่ายเบี้ย — ค่าตั้งต้นของฟอร์มจ่ายเบี้ย';

-- เลือกทั้งบัญชีและบัตร (เช่น แก้ทีละช่อง) → เก็บช่องที่เพิ่งเปลี่ยน ล้างอีกช่อง · สกุล = เบี้ย (ไม่มี = ทุนประกัน · THB)
CREATE OR REPLACE FUNCTION private.tg_insurance_pay_account() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ccy text := coalesce(NEW.premium_currency, NEW.insured_amount_currency, 'THB');
BEGIN
  IF NEW.paid_from_asset_id IS NOT NULL AND NEW.paid_from_credit_card_id IS NOT NULL THEN
    IF TG_OP = 'UPDATE' AND NEW.paid_from_credit_card_id IS DISTINCT FROM OLD.paid_from_credit_card_id
       AND NEW.paid_from_asset_id IS NOT DISTINCT FROM OLD.paid_from_asset_id THEN
      NEW.paid_from_asset_id := NULL;
    ELSE
      NEW.paid_from_credit_card_id := NULL;
    END IF;
  END IF;
  IF NEW.paid_from_asset_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.paid_from_asset_id IS DISTINCT FROM OLD.paid_from_asset_id) THEN
    PERFORM private.check_default_bank(NEW.paid_from_asset_id, v_ccy);
  END IF;
  IF NEW.paid_from_credit_card_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.paid_from_credit_card_id IS DISTINCT FROM OLD.paid_from_credit_card_id)
     AND NOT EXISTS (SELECT 1 FROM public.credit_cards c WHERE c.id = NEW.paid_from_credit_card_id
                        AND c.deleted_at IS NULL AND c.currency = v_ccy) THEN
    RAISE EXCEPTION 'INVALID: บัตรที่ตั้งเป็นค่าตั้งต้นต้องเป็นบัตรเครดิต สกุลเงิน %', v_ccy USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_insurance_pay_account() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS t18_pay_account ON public.insurance_policies;
CREATE TRIGGER t18_pay_account BEFORE INSERT OR UPDATE ON public.insurance_policies
  FOR EACH ROW EXECUTE FUNCTION private.tg_insurance_pay_account();

-- v_insurance_status: เหมือนเดิม (20261010000400) + คอลัมน์ที่เพิ่มหลังจากนั้น (sort_order · บัญชี / บัตรจ่ายเบี้ย)
DROP VIEW IF EXISTS public.v_insurance_status;
CREATE VIEW public.v_insurance_status WITH (security_invoker = true) AS
  SELECT p.*,
         CASE WHEN p.end_date IS NULL THEN NULL
              WHEN p.end_date < current_date THEN 'EXPIRED'
              WHEN p.end_date <= current_date + 60 THEN 'EXPIRING_SOON' END AS derived_status
    FROM public.insurance_policies p WHERE p.deleted_at IS NULL;
REVOKE ALL ON public.v_insurance_status FROM PUBLIC, anon;
GRANT SELECT ON public.v_insurance_status TO authenticated;
