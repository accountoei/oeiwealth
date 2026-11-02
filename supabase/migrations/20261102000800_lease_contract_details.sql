-- =====================================================================
-- สัญญาเช่า: รายละเอียดสำหรับพิมพ์สัญญา (ตกลง 2 พ.ย. 2026)
--   1) property_leases: ผู้เช่าบุคคล / นิติบุคคล (ที่อยู่ · โทร · ผู้มีอำนาจลงนาม) · จำนวนเดือนเงินประกัน
--      · สถานที่ทำสัญญา (ที่อยู่ผู้ให้เช่า = เจ้าของที่เลือก / ที่อยู่กิจการ / พิมพ์เอง)
--      · แจ้งเลิกสัญญาล่วงหน้า (วัน) · ค่าเสียหายส่งมอบคืนล่าช้า (ต่อวัน) · พยาน 2 คน
--      ไม่บังคับกรอก · สิทธิ์ตาม RLS เดิมของตาราง
--   2) เลขบัตรประชาชน / เลขทะเบียนนิติบุคคลของผู้เช่า: เก็บแบบเข้ารหัส (เหมือนเลขบัญชีธนาคาร)
--      ในตาราง lease_tenant_secrets (ไม่มี GRANT / Policy = ปิดสนิท) · ตั้งผ่าน set_lease_tenant_id
--      · อ่านเลขเต็มผ่าน reveal_lease_tenant_id (ADMIN / EDITOR · บันทึก Audit) · สัญญาเก็บแค่ 4 ตัวท้าย
--   3) property_details: บ้านเลขที่ · ห้องชุดเลขที่ / ชั้น / อาคาร (ใช้ในข้อทรัพย์สินที่เช่า)
--   รันซ้ำได้
-- =====================================================================

-- 1) รายละเอียดสัญญาเช่า ----------------------------------------------------------------------
ALTER TABLE public.property_leases
  ADD COLUMN IF NOT EXISTS tenant_type                text,
  ADD COLUMN IF NOT EXISTS tenant_address             text,
  ADD COLUMN IF NOT EXISTS tenant_phone               text,
  ADD COLUMN IF NOT EXISTS tenant_signatory           text,
  ADD COLUMN IF NOT EXISTS tenant_id_last4            text,
  ADD COLUMN IF NOT EXISTS deposit_months             numeric(4,1),
  ADD COLUMN IF NOT EXISTS contract_place_type        text,
  ADD COLUMN IF NOT EXISTS contract_place_person_id   uuid REFERENCES public.persons(id),
  ADD COLUMN IF NOT EXISTS contract_place_business_id uuid REFERENCES public.assets(id),
  ADD COLUMN IF NOT EXISTS contract_place_text        text,
  ADD COLUMN IF NOT EXISTS notice_days                smallint,
  ADD COLUMN IF NOT EXISTS late_return_fee_per_day    public.d_money,
  ADD COLUMN IF NOT EXISTS witness1_name              text,
  ADD COLUMN IF NOT EXISTS witness2_name              text;

ALTER TABLE public.property_leases DROP CONSTRAINT IF EXISTS pl_tenant_type_ck;
ALTER TABLE public.property_leases ADD CONSTRAINT pl_tenant_type_ck
  CHECK (tenant_type IS NULL OR tenant_type IN ('PERSON','JURISTIC'));
ALTER TABLE public.property_leases DROP CONSTRAINT IF EXISTS pl_place_type_ck;
ALTER TABLE public.property_leases ADD CONSTRAINT pl_place_type_ck
  CHECK (contract_place_type IS NULL OR contract_place_type IN ('LESSOR','BUSINESS','TEXT'));
ALTER TABLE public.property_leases DROP CONSTRAINT IF EXISTS pl_contract_detail_ck;
ALTER TABLE public.property_leases ADD CONSTRAINT pl_contract_detail_ck CHECK (
  coalesce(length(tenant_address), 0) <= 500 AND coalesce(length(tenant_phone), 0) <= 50
  AND coalesce(length(tenant_signatory), 0) <= 200 AND coalesce(length(contract_place_text), 0) <= 500
  AND coalesce(length(witness1_name), 0) <= 200 AND coalesce(length(witness2_name), 0) <= 200
  AND (tenant_id_last4 IS NULL OR tenant_id_last4 ~ '^[0-9A-Z]{1,4}$')
  AND (deposit_months IS NULL OR (deposit_months >= 0 AND deposit_months <= 36))
  AND (notice_days IS NULL OR (notice_days >= 0 AND notice_days <= 365))
  AND (late_return_fee_per_day IS NULL OR late_return_fee_per_day >= 0));

-- สถานที่ = กิจการ ต้องเป็น Private Business · สถานที่ = ผู้ให้เช่า ต้องเป็นสมาชิกครอบครัว (persons)
CREATE OR REPLACE FUNCTION private.tg_lease_contract_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.contract_place_business_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.private_business_details b
        WHERE b.asset_id = NEW.contract_place_business_id AND b.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: สถานที่ทำสัญญาต้องเป็นกิจการ (Private Business)' USING ERRCODE = '22023';
  END IF;
  IF NEW.contract_place_person_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.persons p WHERE p.id = NEW.contract_place_person_id AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ไม่พบสมาชิกที่เลือกเป็นสถานที่ทำสัญญา' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.tg_lease_contract_check() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t52_contract_check ON public.property_leases;
CREATE TRIGGER t52_contract_check BEFORE INSERT OR UPDATE OF contract_place_business_id, contract_place_person_id ON public.property_leases
  FOR EACH ROW EXECUTE FUNCTION private.tg_lease_contract_check();

-- 4 ตัวท้ายเลขผู้เช่า = ระบบตั้งเอง (เพิ่มในรายการช่องที่ Client แก้ตรงไม่ได้)
DROP TRIGGER IF EXISTS t20_cache ON public.property_leases;
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.property_leases
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('deposit_settled_date', 'deposit_settlement_type', 'deposit_refunded_amount', 'tenant_id_last4');

-- 2) เลขผู้เช่าเข้ารหัส -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lease_tenant_secrets (
  lease_id        uuid PRIMARY KEY REFERENCES public.property_leases(id),
  id_no_encrypted bytea NOT NULL,     -- pgp_sym_encrypt ด้วย Key จาก Supabase Vault (ตัวเดียวกับเลขบัญชี)
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
ALTER TABLE public.lease_tenant_secrets ENABLE ROW LEVEL SECURITY;   -- ไม่มี GRANT / Policy = ปิดสนิท
REVOKE ALL ON public.lease_tenant_secrets FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t10_meta ON public.lease_tenant_secrets;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.lease_tenant_secrets
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.lease_tenant_secrets;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.lease_tenant_secrets
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();

-- ตั้ง / ล้าง เลขบัตรประชาชน (บุคคล) หรือเลขทะเบียนนิติบุคคล / เลขผู้เสียภาษี · ว่าง = ล้าง · คืนค่า 4 ตัวท้าย (หรือ NULL)
CREATE OR REPLACE FUNCTION public.set_lease_tenant_id(p_lease_id uuid, p_id_no text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid; v_no text; v_last4 text;
BEGIN
  v_uid := private.require_role('ADMIN','EDITOR');
  IF NOT EXISTS (SELECT 1 FROM public.property_leases WHERE id = p_lease_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'NOT_FOUND: ไม่พบสัญญาเช่า' USING ERRCODE = 'P0002';
  END IF;
  v_no := upper(regexp_replace(coalesce(p_id_no, ''), '[\s-]', '', 'g'));
  IF v_no = '' THEN
    UPDATE public.lease_tenant_secrets SET deleted_at = now(), deleted_by = v_uid
     WHERE lease_id = p_lease_id AND deleted_at IS NULL;
    v_last4 := NULL;
  ELSE
    IF v_no !~ '^[0-9A-Z]{5,20}$' THEN
      RAISE EXCEPTION 'INVALID: เลขบัตรประชาชน / หนังสือเดินทาง / ทะเบียนนิติบุคคล ต้องเป็นตัวเลขหรือตัวอักษร 5–20 ตัว' USING ERRCODE = '22023';
    END IF;
    IF v_no ~ '^[0-9]+$' AND length(v_no) <> 13 THEN
      RAISE EXCEPTION 'INVALID: เลขบัตรประชาชน / เลขทะเบียนนิติบุคคลต้องมี 13 หลัก' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.lease_tenant_secrets(lease_id, id_no_encrypted)
    VALUES (p_lease_id, extensions.pgp_sym_encrypt(v_no, private.bank_key()))
    ON CONFLICT (lease_id) DO UPDATE
      SET id_no_encrypted = EXCLUDED.id_no_encrypted, deleted_at = NULL, deleted_by = NULL;
    v_last4 := right(v_no, 4);
  END IF;
  UPDATE public.property_leases SET tenant_id_last4 = v_last4 WHERE id = p_lease_id AND deleted_at IS NULL;
  PERFORM private.write_audit('SET_SENSITIVE', 'property_leases', p_lease_id::text,
          jsonb_build_object('field', 'tenant_id', 'last4', v_last4), NULL, 'tenant_id');
  RETURN v_last4;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_lease_tenant_id(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lease_tenant_id(uuid, text) TO authenticated;

-- เลขเต็มสำหรับพิมพ์สัญญา (ไม่มี = NULL) · ADMIN / EDITOR · บันทึก Audit
CREATE OR REPLACE FUNCTION public.reveal_lease_tenant_id(p_lease_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT extensions.pgp_sym_decrypt(s.id_no_encrypted, private.bank_key()) INTO v
    FROM public.lease_tenant_secrets s JOIN public.property_leases l ON l.id = s.lease_id
   WHERE s.lease_id = p_lease_id AND s.deleted_at IS NULL AND l.deleted_at IS NULL;
  IF v IS NOT NULL THEN
    PERFORM private.write_audit('VIEW_SENSITIVE', 'property_leases', p_lease_id::text,
            jsonb_build_object('field', 'tenant_id'), NULL, 'tenant_id');
  END IF;
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION public.reveal_lease_tenant_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_lease_tenant_id(uuid) TO authenticated;

-- 3) บ้านเลขที่ / ห้องชุด ------------------------------------------------------------------------
ALTER TABLE public.property_details
  ADD COLUMN IF NOT EXISTS house_no      text,
  ADD COLUMN IF NOT EXISTS unit_no       text,
  ADD COLUMN IF NOT EXISTS floor_no      text,
  ADD COLUMN IF NOT EXISTS building_name text;
ALTER TABLE public.property_details DROP CONSTRAINT IF EXISTS pd_house_unit_len;
ALTER TABLE public.property_details ADD CONSTRAINT pd_house_unit_len CHECK (
  coalesce(length(house_no), 0) <= 50 AND coalesce(length(unit_no), 0) <= 50
  AND coalesce(length(floor_no), 0) <= 20 AND coalesce(length(building_name), 0) <= 200);
