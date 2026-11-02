-- =====================================================================
-- สัญญาเงินให้กู้: รายละเอียดคู่สัญญา (ตกลง 2 พ.ย. 2026)
--   1) loan_details: ที่อยู่ผู้กู้ · ผู้ค้ำประกัน (ชื่อ / โทร / ที่อยู่) · พยาน 2 คน
--      · สถานที่ทำสัญญา (ที่อยู่ผู้ให้กู้ / ที่อยู่กิจการ / พิมพ์เอง) · บัญชีรับชำระ (บัญชีธนาคารในระบบ)
--      ไม่บังคับกรอก · สิทธิ์ตาม RLS เดิมของตาราง
--   2) เลขบัตรประชาชนผู้กู้ / ผู้ค้ำ: เก็บแบบเข้ารหัส (เหมือนเลขบัญชีธนาคาร) ในตาราง loan_party_secrets
--      ไม่มี GRANT / Policy = ปิดสนิท · ตั้งผ่าน set_loan_party_id · อ่านเลขเต็มผ่าน reveal_loan_party_ids (ADMIN / EDITOR · บันทึก Audit)
--      loan_details เก็บแค่ 4 ตัวท้าย (ระบบตั้งเอง แก้ตรงไม่ได้)
--   3) private_business_details: ที่อยู่ + เบอร์โทรของกิจการ
--   รันซ้ำได้
-- =====================================================================

-- 1) ข้อมูลคู่สัญญา -----------------------------------------------------------------------------
ALTER TABLE public.loan_details
  ADD COLUMN IF NOT EXISTS borrower_address           text,
  ADD COLUMN IF NOT EXISTS borrower_id_last4          text,
  ADD COLUMN IF NOT EXISTS guarantor_name             text,
  ADD COLUMN IF NOT EXISTS guarantor_phone            text,
  ADD COLUMN IF NOT EXISTS guarantor_address          text,
  ADD COLUMN IF NOT EXISTS guarantor_id_last4         text,
  ADD COLUMN IF NOT EXISTS witness1_name              text,
  ADD COLUMN IF NOT EXISTS witness2_name              text,
  ADD COLUMN IF NOT EXISTS contract_place_type        text,
  ADD COLUMN IF NOT EXISTS contract_place_business_id uuid REFERENCES public.assets(id),
  ADD COLUMN IF NOT EXISTS contract_place_text        text,
  ADD COLUMN IF NOT EXISTS repay_bank_asset_id        uuid REFERENCES public.assets(id);

ALTER TABLE public.loan_details DROP CONSTRAINT IF EXISTS loan_details_party_len;
ALTER TABLE public.loan_details ADD CONSTRAINT loan_details_party_len CHECK (
  coalesce(length(borrower_address), 0) <= 500 AND coalesce(length(guarantor_name), 0) <= 200
  AND coalesce(length(guarantor_phone), 0) <= 50 AND coalesce(length(guarantor_address), 0) <= 500
  AND coalesce(length(witness1_name), 0) <= 200 AND coalesce(length(witness2_name), 0) <= 200
  AND coalesce(length(contract_place_text), 0) <= 500);
ALTER TABLE public.loan_details DROP CONSTRAINT IF EXISTS loan_details_place_type;
ALTER TABLE public.loan_details ADD CONSTRAINT loan_details_place_type
  CHECK (contract_place_type IS NULL OR contract_place_type IN ('LENDER','BUSINESS','TEXT'));
ALTER TABLE public.loan_details DROP CONSTRAINT IF EXISTS loan_details_id_last4;
ALTER TABLE public.loan_details ADD CONSTRAINT loan_details_id_last4
  CHECK ((borrower_id_last4 IS NULL OR borrower_id_last4 ~ '^[0-9A-Z]{1,4}$')
     AND (guarantor_id_last4 IS NULL OR guarantor_id_last4 ~ '^[0-9A-Z]{1,4}$'));

-- สถานที่ = กิจการ ต้องเป็น Private Business · บัญชีรับชำระ ต้องเป็นบัญชีธนาคาร
CREATE OR REPLACE FUNCTION private.tg_loan_party_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.contract_place_business_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.private_business_details b
        WHERE b.asset_id = NEW.contract_place_business_id AND b.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: สถานที่ทำสัญญาต้องเป็นกิจการ (Private Business)' USING ERRCODE = '22023';
  END IF;
  IF NEW.repay_bank_asset_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.bank_accounts b
        WHERE b.asset_id = NEW.repay_bank_asset_id AND b.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: บัญชีรับชำระต้องเป็นบัญชีธนาคาร' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.tg_loan_party_check() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t56_loan_party_check ON public.loan_details;
CREATE TRIGGER t56_loan_party_check BEFORE INSERT OR UPDATE OF contract_place_business_id, repay_bank_asset_id ON public.loan_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_loan_party_check();

-- 4 ตัวท้ายของเลขบัตร = ระบบตั้งเอง (เหมือน account_no_last4 ของบัญชีธนาคาร)
DROP TRIGGER IF EXISTS t20_cache ON public.loan_details;
CREATE TRIGGER t20_cache BEFORE INSERT OR UPDATE ON public.loan_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_cache_guard('outstanding_principal','borrower_id_last4','guarantor_id_last4');

-- 2) เลขบัตรเข้ารหัส ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loan_party_secrets (
  loan_asset_id   uuid NOT NULL REFERENCES public.assets(id),
  party           text NOT NULL CHECK (party IN ('BORROWER','GUARANTOR')),
  id_no_encrypted bytea NOT NULL,     -- pgp_sym_encrypt ด้วย Key จาก Supabase Vault (ตัวเดียวกับเลขบัญชี)
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id),
  PRIMARY KEY (loan_asset_id, party)
);
ALTER TABLE public.loan_party_secrets ENABLE ROW LEVEL SECURITY;   -- ไม่มี GRANT / Policy = ปิดสนิท
REVOKE ALL ON public.loan_party_secrets FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t10_meta ON public.loan_party_secrets;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.loan_party_secrets
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.loan_party_secrets;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.loan_party_secrets
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();

-- ตั้ง / ล้าง เลขบัตรของผู้กู้ หรือผู้ค้ำ · ว่าง = ล้าง · คืนค่า 4 ตัวท้าย (หรือ NULL)
CREATE OR REPLACE FUNCTION public.set_loan_party_id(p_loan_asset_id uuid, p_party text, p_id_no text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid; v_no text; v_last4 text;
BEGIN
  v_uid := private.require_role('ADMIN','EDITOR');
  IF p_party NOT IN ('BORROWER','GUARANTOR') THEN
    RAISE EXCEPTION 'INVALID: ฝ่ายในสัญญาไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.loan_details WHERE asset_id = p_loan_asset_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'NOT_FOUND: ไม่พบสัญญาเงินให้กู้' USING ERRCODE = 'P0002';
  END IF;
  v_no := upper(regexp_replace(coalesce(p_id_no, ''), '[\s-]', '', 'g'));
  IF v_no = '' THEN
    UPDATE public.loan_party_secrets SET deleted_at = now(), deleted_by = v_uid
     WHERE loan_asset_id = p_loan_asset_id AND party = p_party AND deleted_at IS NULL;
    v_last4 := NULL;
  ELSE
    IF v_no !~ '^[0-9A-Z]{5,20}$' THEN
      RAISE EXCEPTION 'INVALID: เลขบัตรประชาชน / หนังสือเดินทาง ต้องเป็นตัวเลขหรือตัวอักษร 5–20 ตัว' USING ERRCODE = '22023';
    END IF;
    IF v_no ~ '^[0-9]+$' AND length(v_no) <> 13 THEN
      RAISE EXCEPTION 'INVALID: เลขบัตรประชาชนต้องมี 13 หลัก' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.loan_party_secrets(loan_asset_id, party, id_no_encrypted)
    VALUES (p_loan_asset_id, p_party, extensions.pgp_sym_encrypt(v_no, private.bank_key()))
    ON CONFLICT (loan_asset_id, party) DO UPDATE
      SET id_no_encrypted = EXCLUDED.id_no_encrypted, deleted_at = NULL, deleted_by = NULL;
    v_last4 := right(v_no, 4);
  END IF;
  IF p_party = 'BORROWER' THEN
    UPDATE public.loan_details SET borrower_id_last4 = v_last4 WHERE asset_id = p_loan_asset_id AND deleted_at IS NULL;
  ELSE
    UPDATE public.loan_details SET guarantor_id_last4 = v_last4 WHERE asset_id = p_loan_asset_id AND deleted_at IS NULL;
  END IF;
  PERFORM private.write_audit('SET_SENSITIVE', 'loan_details', p_loan_asset_id::text,
          jsonb_build_object('field', lower(p_party) || '_id', 'last4', v_last4), NULL, lower(p_party) || '_id');
  RETURN v_last4;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_loan_party_id(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_loan_party_id(uuid, text, text) TO authenticated;

-- เลขเต็มสำหรับพิมพ์สัญญา: {"borrower": "...", "guarantor": "..."} (ไม่มี = ไม่มี key) · ADMIN / EDITOR · บันทึก Audit
CREATE OR REPLACE FUNCTION public.reveal_loan_party_ids(p_loan_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT coalesce(jsonb_object_agg(lower(s.party), extensions.pgp_sym_decrypt(s.id_no_encrypted, private.bank_key())), '{}'::jsonb)
    INTO v
    FROM public.loan_party_secrets s JOIN public.loan_details d ON d.asset_id = s.loan_asset_id
   WHERE s.loan_asset_id = p_loan_asset_id AND s.deleted_at IS NULL AND d.deleted_at IS NULL;
  IF v <> '{}'::jsonb THEN
    PERFORM private.write_audit('VIEW_SENSITIVE', 'loan_details', p_loan_asset_id::text,
            jsonb_build_object('field', 'party_id'), NULL, 'party_id');
  END IF;
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION public.reveal_loan_party_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_loan_party_ids(uuid) TO authenticated;

-- 3) ที่อยู่ + เบอร์โทรกิจการ ---------------------------------------------------------------------
ALTER TABLE public.private_business_details
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone   text;
ALTER TABLE public.private_business_details DROP CONSTRAINT IF EXISTS private_business_contact_len;
ALTER TABLE public.private_business_details ADD CONSTRAINT private_business_contact_len
  CHECK (coalesce(length(address), 0) <= 500 AND coalesce(length(phone), 0) <= 50);
