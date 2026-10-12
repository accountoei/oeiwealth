-- =====================================================================
-- รายการติดตามกรมธรรม์ เมื่อสมาชิกเปลี่ยนสถานะไป-กลับ Archived (DECEASED)
--   Archived → Active / Inactive : รายการที่ยัง "ยังไม่เริ่ม" (OPEN) ปิดเป็น "ไม่ต้องทำ" ให้เอง (auto_closed)
--                                   รายการที่กำลังดำเนินการ / เสร็จแล้ว / ปิดเอง → ไม่แตะ
--   ตั้งเป็น Archived อีกครั้ง     : รายการที่ระบบเคยปิดเอง → เปิดกลับเป็น "ยังไม่เริ่ม" · แล้วสร้างรายการใหม่ตามเดิม (ซ้ำไม่ได้)
--   ผู้ใช้แก้สถานะรายการเอง → ไม่ถือว่าระบบปิดอีกต่อไป (auto_closed = false)
-- รันซ้ำได้ (ADD COLUMN IF NOT EXISTS · CREATE OR REPLACE · DROP TRIGGER IF EXISTS)
-- =====================================================================

ALTER TABLE public.insurance_followups ADD COLUMN IF NOT EXISTS auto_closed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION private.tg_person_deceased_followups() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- กลับจาก Archived → ปิดรายการที่ยังไม่เริ่ม
  IF OLD.status = 'DECEASED' AND NEW.status IS DISTINCT FROM 'DECEASED' THEN
    UPDATE public.insurance_followups SET status = 'NOT_APPLICABLE', auto_closed = true
     WHERE person_id = NEW.id AND status = 'OPEN' AND deleted_at IS NULL;
  END IF;

  IF NEW.status = 'DECEASED' AND OLD.status IS DISTINCT FROM 'DECEASED' AND NEW.deleted_at IS NULL THEN
    -- เคยถูกระบบปิดไว้ → เปิดกลับ
    UPDATE public.insurance_followups SET status = 'OPEN', auto_closed = false
     WHERE person_id = NEW.id AND auto_closed AND deleted_at IS NULL;
    INSERT INTO public.insurance_followups(person_id, policy_id, role, action)
    SELECT NEW.id, p.id, 'INSURED',
           CASE WHEN p.insurance_type IN ('LIFE','ACCIDENT') THEN 'ยื่นเคลมสินไหมมรณกรรม ติดตามจนได้รับเงิน'
                ELSE 'แจ้งบริษัทประกัน ยกเลิกกรมธรรม์ / ขอคืนเบี้ยส่วนที่เหลือ' END
      FROM public.insurance_policies p
     WHERE p.person_id = NEW.id AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
    ON CONFLICT DO NOTHING;
    INSERT INTO public.insurance_followups(person_id, policy_id, role, action)
    SELECT NEW.id, p.id, 'PAYER', 'ตัดสินใจ: เวนคืนกรมธรรม์ หรือ ให้สมาชิกคนอื่นจ่ายเบี้ยต่อ (เปลี่ยนผู้จ่ายเบี้ย)'
      FROM public.insurance_policies p
     WHERE p.payer_person_id = NEW.id AND p.person_id IS DISTINCT FROM NEW.id AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
    ON CONFLICT DO NOTHING;
    INSERT INTO public.insurance_followups(person_id, policy_id, role, action)
    SELECT DISTINCT NEW.id, b.policy_id, 'BENEFICIARY', 'เปลี่ยนผู้รับผลประโยชน์ (แจ้งบริษัทประกัน + แก้ในระบบ)'
      FROM public.insurance_beneficiaries b JOIN public.insurance_policies p ON p.id = b.policy_id
     WHERE b.person_id = NEW.id AND b.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
       AND p.person_id IS DISTINCT FROM NEW.id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION private.tg_person_deceased_followups() FROM PUBLIC, anon, authenticated;

-- ผู้ใช้แก้สถานะรายการเอง (ไม่ใช่ระบบ) → ไม่ถือว่าระบบปิด
CREATE OR REPLACE FUNCTION private.tg_followup_manual() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.auto_closed := false;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.tg_followup_manual() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t55_followup_manual ON public.insurance_followups;
CREATE TRIGGER t55_followup_manual BEFORE UPDATE ON public.insurance_followups
  FOR EACH ROW EXECUTE FUNCTION private.tg_followup_manual();
