-- =====================================================================
-- Donations: ผู้บริจาคแบบ "กลุ่ม" (GROUP · ข้อมูลเดิมที่ไม่ระบุผู้บริจาค) → ผู้บริจาคกิจการ (BUSINESS)
--   owner 5 พ.ย. 2026: ไม่มีการบริจาคที่ไม่ระบุชื่ออีก · รายการแบบกลุ่มทั้งหมดเป็นของกิจการหนึ่งเดียวในเมนู Private Business
--   - กิจการปลายทางระบุด้วย id (repo เป็นสาธารณะ · ไม่ใส่ชื่อจริง)
--   - ไม่พบกิจการนี้ (เช่น ฐานข้อมูลทดสอบ / หลังล้างข้อมูลแล้วนำเข้าใหม่) → ไม่แก้อะไร แจ้งเป็น NOTICE
--   - แก้เฉพาะแถวที่ยังไม่ถูกลบ · ไม่มีผลกับยอดบัญชี / ความมั่งคั่งสุทธิ / ภาษีบุคคล (กลุ่มและกิจการไม่นับในภาษีบุคคลอยู่แล้ว)
--   - ไม่แก้โครงสร้างตาราง · รันซ้ำได้ (รอบสองไม่เหลือแถว GROUP)
-- =====================================================================
DO $$
DECLARE
  v_target uuid := '022632bb-7f28-474b-ae7d-cec2224ecda1';
  v_n      int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.assets a
                  WHERE a.id = v_target AND a.asset_type = 'PRIVATE_BUSINESS' AND a.deleted_at IS NULL) THEN
    RAISE NOTICE 'donation_group_to_business: ไม่พบกิจการปลายทาง — ไม่ได้แก้ข้อมูล';
    RETURN;
  END IF;
  UPDATE public.donation_records
     SET donor_kind = 'BUSINESS', donor_asset_id = v_target, donor_name = NULL
   WHERE donor_kind = 'GROUP' AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'donation_group_to_business: ย้าย % รายการ', v_n;
END $$;
