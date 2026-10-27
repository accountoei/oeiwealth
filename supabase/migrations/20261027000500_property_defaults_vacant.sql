-- =====================================================================
-- Property รอบ 2 (ตกลง 27 ต.ค. 2026) · ข้อ 1, 3, 4
--   1) บัญชีตั้งต้น (แบบเดียวกับ Investment: income_bank_asset_id)
--      - property_leases.rent_to_asset_id        = บัญชีรับค่าเช่า (บัญชีธนาคาร · สกุลเดียวกับค่าเช่า)
--      - property_utilities.paid_from_asset_id   = จ่ายจากบัญชีธนาคาร (สกุลเดียวกับรายการ)
--        property_utilities.paid_from_credit_card_id = หรือจ่ายจากบัตรเครดิต (เลือกได้อย่างใดอย่างหนึ่ง)
--      ใช้เป็นค่าตั้งต้นของฟอร์ม / แท็บบันทึกทั้งชุดเท่านั้น (เปลี่ยนในฟอร์ม = มีผลครั้งนั้นครั้งเดียว)
--      ตรวจบัญชีเฉพาะตอนตั้ง / เปลี่ยนค่า · บัญชีที่ปิดหรือลบทีหลัง → หน้าเว็บกลับไปเดาแบบเดิม
--   3) ที่ว่าง: vacant_since (ว่างตั้งแต่) · vacant_plan (แผน / โครงการ) · vacant_plan_date (กำหนดเริ่ม)
--      - เปลี่ยนการใช้งานเป็น "ว่าง" → vacant_since = วันนี้ (ถ้าไม่ได้ใส่เอง) · แก้ย้อนได้ (ห้ามวันในอนาคต)
--      - เปลี่ยนจาก "ว่าง" เป็นอย่างอื่น (รวมสร้างสัญญาเช่า) → เก็บช่วงที่ว่างไว้ใน vacancy_history แล้วล้างช่องทั้ง 3
--   4) ภาระผูกพัน: encumbrance_type (ไม่มี / ภาระจำยอม / สิทธิเก็บกิน / จำนอง / สิทธิการเช่า / อื่นๆ) + encumbrance_details
--      แสดงผลอย่างเดียว ไม่กระทบมูลค่า
--   เพิ่มคอลัมน์อย่างเดียว ไม่แตะข้อมูลเดิม · สิทธิ์ / RLS / Audit ใช้ของตารางเดิม · รันซ้ำได้
-- =====================================================================

-- 1) บัญชีตั้งต้น ---------------------------------------------------------------------------------
ALTER TABLE public.property_leases
  ADD COLUMN IF NOT EXISTS rent_to_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL;
ALTER TABLE public.property_utilities
  ADD COLUMN IF NOT EXISTS paid_from_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL;
ALTER TABLE public.property_utilities
  ADD COLUMN IF NOT EXISTS paid_from_credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.property_utilities ADD CONSTRAINT pu_paid_from_ck
    CHECK (paid_from_asset_id IS NULL OR paid_from_credit_card_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS pl_rent_to_idx ON public.property_leases(rent_to_asset_id) WHERE rent_to_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pu_paid_from_asset_idx ON public.property_utilities(paid_from_asset_id) WHERE paid_from_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pu_paid_from_card_idx ON public.property_utilities(paid_from_credit_card_id) WHERE paid_from_credit_card_id IS NOT NULL;

COMMENT ON COLUMN public.property_leases.rent_to_asset_id IS
  'บัญชีธนาคาร (BANK_ACCOUNT · สกุลเดียวกับค่าเช่า) ที่รับค่าเช่า — ค่าตั้งต้นของฟอร์มรับค่าเช่า';
COMMENT ON COLUMN public.property_utilities.paid_from_asset_id IS
  'บัญชีธนาคาร (BANK_ACCOUNT · สกุลเดียวกัน) ที่จ่ายรายการนี้ — ค่าตั้งต้นของฟอร์มบันทึกจ่าย';
COMMENT ON COLUMN public.property_utilities.paid_from_credit_card_id IS
  'บัตรเครดิต (สกุลเดียวกัน) ที่จ่ายรายการนี้ — ค่าตั้งต้นของฟอร์มบันทึกจ่าย';

CREATE OR REPLACE FUNCTION private.check_default_bank(p_asset uuid, p_currency text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.id = p_asset AND a.asset_type = 'BANK_ACCOUNT'
                    AND a.deleted_at IS NULL AND a.currency = p_currency) THEN
    RAISE EXCEPTION 'INVALID: บัญชีตั้งต้นต้องเป็นบัญชีธนาคาร สกุลเงิน %', p_currency USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.check_default_bank(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.check_default_bank(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION private.tg_lease_rent_account() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.rent_to_asset_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.rent_to_asset_id IS DISTINCT FROM OLD.rent_to_asset_id) THEN
    PERFORM private.check_default_bank(NEW.rent_to_asset_id, NEW.rent_currency);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_lease_rent_account() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS t18_rent_account ON public.property_leases;
CREATE TRIGGER t18_rent_account BEFORE INSERT OR UPDATE ON public.property_leases
  FOR EACH ROW EXECUTE FUNCTION private.tg_lease_rent_account();

-- เลือกทั้งบัญชีและบัตร (เช่น แก้ทีละช่อง) → เก็บช่องที่เพิ่งเปลี่ยน ล้างอีกช่อง
CREATE OR REPLACE FUNCTION private.tg_utility_pay_account() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
    PERFORM private.check_default_bank(NEW.paid_from_asset_id, NEW.currency);
  END IF;
  IF NEW.paid_from_credit_card_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.paid_from_credit_card_id IS DISTINCT FROM OLD.paid_from_credit_card_id)
     AND NOT EXISTS (SELECT 1 FROM public.credit_cards c WHERE c.id = NEW.paid_from_credit_card_id
                        AND c.deleted_at IS NULL AND c.currency = NEW.currency) THEN
    RAISE EXCEPTION 'INVALID: บัตรที่ตั้งเป็นค่าตั้งต้นต้องเป็นบัตรเครดิต สกุลเงิน %', NEW.currency USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_utility_pay_account() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS t18_pay_account ON public.property_utilities;
CREATE TRIGGER t18_pay_account BEFORE INSERT OR UPDATE ON public.property_utilities
  FOR EACH ROW EXECUTE FUNCTION private.tg_utility_pay_account();

-- 3) ที่ว่าง + 4) ภาระผูกพัน ------------------------------------------------------------------------
ALTER TABLE public.property_details
  ADD COLUMN IF NOT EXISTS vacant_since        date,
  ADD COLUMN IF NOT EXISTS vacant_plan         text,
  ADD COLUMN IF NOT EXISTS vacant_plan_date    date,
  ADD COLUMN IF NOT EXISTS vacancy_history     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS encumbrance_type    text,
  ADD COLUMN IF NOT EXISTS encumbrance_details text;

DO $$ BEGIN
  ALTER TABLE public.property_details ADD CONSTRAINT pd_encumbrance_type_ck
    CHECK (encumbrance_type IS NULL OR encumbrance_type IN ('NONE','SERVITUDE','USUFRUCT','MORTGAGE','LEASEHOLD','OTHER'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.property_details.vacant_since IS 'ว่างตั้งแต่ (ใช้เมื่อ usage_type = VACANT) — ระบบเติมวันที่เปลี่ยนเป็น "ว่าง" ให้ แก้ย้อนได้';
COMMENT ON COLUMN public.property_details.vacant_plan IS 'แผน / โครงการของที่ว่าง (ข้อความ)';
COMMENT ON COLUMN public.property_details.vacant_plan_date IS 'กำหนดเริ่มโครงการ (ไม่บังคับ)';
COMMENT ON COLUMN public.property_details.vacancy_history IS 'ช่วงที่เคยว่าง [{from, to, plan}] — ระบบเพิ่มให้เมื่อเปลี่ยนจาก "ว่าง" เป็นการใช้งานอื่น';
COMMENT ON COLUMN public.property_details.encumbrance_type IS 'ภาระผูกพัน: NONE / SERVITUDE (ภาระจำยอม) / USUFRUCT (สิทธิเก็บกิน) / MORTGAGE (จำนอง) / LEASEHOLD (สิทธิการเช่า) / OTHER — แสดงผลอย่างเดียว';

CREATE OR REPLACE FUNCTION private.tg_property_vacancy() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.usage_type = 'VACANT' THEN
    IF NEW.vacant_since IS NULL AND (TG_OP = 'INSERT' OR OLD.usage_type IS DISTINCT FROM 'VACANT') THEN
      NEW.vacant_since := current_date;
    END IF;
    IF NEW.vacant_since > current_date THEN
      RAISE EXCEPTION 'INVALID: วันที่เริ่มว่างเป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023';
    END IF;
  ELSE
    -- ออกจาก "ว่าง" → เก็บช่วงที่ว่างเป็นประวัติ แล้วล้างช่อง
    IF TG_OP = 'UPDATE' AND OLD.usage_type = 'VACANT' AND OLD.vacant_since IS NOT NULL THEN
      NEW.vacancy_history := coalesce(NEW.vacancy_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'from', OLD.vacant_since, 'to', greatest(current_date, OLD.vacant_since), 'plan', OLD.vacant_plan,
        'plan_date', OLD.vacant_plan_date, 'next_usage', NEW.usage_type));
    END IF;
    NEW.vacant_since := NULL; NEW.vacant_plan := NULL; NEW.vacant_plan_date := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_property_vacancy() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS t18_vacancy ON public.property_details;
CREATE TRIGGER t18_vacancy BEFORE INSERT OR UPDATE ON public.property_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_property_vacancy();

-- ที่ว่างอยู่แล้วก่อน migration นี้: ยังไม่รู้วันเริ่มว่าง → เว้นไว้ให้ใส่เอง (ไม่เดาวันที่ / ไม่แก้ข้อมูลเดิม)
