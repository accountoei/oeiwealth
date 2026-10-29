-- =====================================================================
-- ประวัติการบริจาค (Family → แท็บ Donations)
--   donation_records: เก็บรายละเอียดการบริจาคทั้งหมด ทั้งที่ใช้ / ไม่ใช้สิทธิลดหย่อนภาษี
--   - ผู้บริจาค 3 แบบ: สมาชิก (PERSON) · กิจการใน Private Business (BUSINESS) · ไม่ระบุ / กลุ่ม (GROUP · ข้อมูลเก่า)
--   - ผูกกับรายจ่ายหมวด "บริจาค" เดิมได้ (expense_item_id · รายจ่าย 1 รายการผูกได้ 1 รายการบริจาค)
--     → ไม่สร้างเงินออกซ้ำ · ตารางนี้ไม่มีผลกับยอดบัญชี / Net Worth / Month Closing
--   - จึงบันทึกย้อนหลังก่อน Go-live ได้ (ไม่ติดวัน Go-live / งวดที่ปิดแล้ว)
--   - year_only = ข้อมูลเก่าที่มีแค่ยอดรวมทั้งปี (วันที่เก็บเป็น 31 ธ.ค. ของปีนั้น)
--   - หลักฐาน (ใบอนุโมทนา / สลิป / e-Donation) แนบผ่าน Documents (entity DONATION)
-- RLS ตามมาตรฐาน: ทุกบทบาทดูได้ · ADMIN / EDITOR / CONTRIBUTOR เพิ่ม · แก้ตามสิทธิ์ · ลบ = Soft Delete (ADMIN / EDITOR)
-- รันซ้ำได้ · ไม่แก้ตาราง / ข้อมูลเดิม
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.donation_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_date       date NOT NULL,
  year_only           boolean NOT NULL DEFAULT false,
  donor_kind          text NOT NULL CHECK (donor_kind IN ('PERSON','BUSINESS','GROUP')),
  donor_person_id     uuid REFERENCES public.persons(id),
  donor_asset_id      uuid REFERENCES public.assets(id),
  donor_name          text,                                   -- GROUP: ชื่อกลุ่ม / ผู้บริจาคตามเอกสารเดิม
  claimant_person_id  uuid REFERENCES public.persons(id),     -- ผู้ใช้สิทธิลดหย่อน (เฉพาะผู้บริจาคที่เป็นบุคคล)
  donee_name          text NOT NULL CHECK (length(trim(donee_name)) > 0),
  donee_type          text CHECK (donee_type IN ('TEMPLE','SCHOOL','HOSPITAL','FOUNDATION','GOVERNMENT','OTHER')),
  purpose             text,
  donation_form       text NOT NULL DEFAULT 'CASH' CHECK (donation_form IN ('CASH','IN_KIND')),
  amount              public.d_money NOT NULL CHECK (amount > 0),   -- บาท (สิ่งของ = มูลค่า)
  receipt_no          text,
  project_name        text,                                   -- โครงการ (รวมหลายรายการ / หลายผู้บริจาค)
  tax_status          text NOT NULL DEFAULT 'PENDING' CHECK (tax_status IN ('NONE','PENDING','ELIGIBLE')),
  tax_kind            text CHECK (tax_kind IN ('GENERAL','DOUBLE','POLITICAL')),
  e_donation          boolean NOT NULL DEFAULT false,
  expense_item_id     uuid REFERENCES public.expense_items(id),
  notes               text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id),
  CONSTRAINT don_donor CHECK (
       (donor_kind = 'PERSON'   AND donor_person_id IS NOT NULL AND donor_asset_id IS NULL)
    OR (donor_kind = 'BUSINESS' AND donor_asset_id IS NOT NULL AND donor_person_id IS NULL)
    OR (donor_kind = 'GROUP'    AND donor_person_id IS NULL AND donor_asset_id IS NULL)),
  CONSTRAINT don_claimant CHECK (claimant_person_id IS NULL OR donor_kind = 'PERSON'),
  CONSTRAINT don_year_only CHECK (NOT year_only OR (extract(month FROM donation_date) = 12 AND extract(day FROM donation_date) = 31))
);
CREATE INDEX IF NOT EXISTS donation_records_date_idx ON public.donation_records(donation_date);
CREATE UNIQUE INDEX IF NOT EXISTS donation_records_expense_uq ON public.donation_records(expense_item_id)
  WHERE expense_item_id IS NOT NULL AND deleted_at IS NULL;

-- ผู้บริจาคที่เป็นกิจการต้องเป็น Private Business · รายจ่ายที่ผูกต้องยังไม่ถูกลบ
CREATE OR REPLACE FUNCTION private.tg_donation_check()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  NEW.donee_name := trim(NEW.donee_name);
  IF NEW.donor_asset_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.assets a WHERE a.id = NEW.donor_asset_id AND a.asset_type = 'PRIVATE_BUSINESS' AND a.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ผู้บริจาคต้องเป็นกิจการในเมนู Private Business' USING ERRCODE = '22023';
  END IF;
  IF NEW.expense_item_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.expense_item_id IS DISTINCT FROM OLD.expense_item_id)
     AND NOT EXISTS (SELECT 1 FROM public.expense_items e WHERE e.id = NEW.expense_item_id AND e.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ไม่พบรายจ่ายที่ผูก' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_donation_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t20_donation_check ON public.donation_records;
CREATE TRIGGER t20_donation_check BEFORE INSERT OR UPDATE ON public.donation_records
  FOR EACH ROW EXECUTE FUNCTION private.tg_donation_check();
DROP TRIGGER IF EXISTS t10_meta ON public.donation_records;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.donation_records
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.donation_records;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.donation_records
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.donation_records;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.donation_records
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

ALTER TABLE public.donation_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.donation_records FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.donation_records TO authenticated, service_role;
DROP POLICY IF EXISTS p_select ON public.donation_records;
DROP POLICY IF EXISTS p_insert ON public.donation_records;
DROP POLICY IF EXISTS p_update ON public.donation_records;
CREATE POLICY p_select ON public.donation_records FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
CREATE POLICY p_insert ON public.donation_records FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR')));
CREATE POLICY p_update ON public.donation_records FOR UPDATE TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND created_at >= now() - interval '24 hours' AND deleted_at IS NULL))
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND deleted_at IS NULL));
