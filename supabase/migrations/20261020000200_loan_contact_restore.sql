-- =====================================================================
-- เงินให้กู้: ข้อมูลสัญญาเพิ่ม + กู้คืนงวดผ่อนที่ถูกลบโดยไม่ตั้งใจ
--   1) loan_details: borrower_phone (เบอร์ติดต่อผู้กู้) · contract_no (เลขที่สัญญา) · purpose (วัตถุประสงค์)
--      ไม่บังคับกรอก · ไม่แก้ข้อมูลเดิม · สิทธิ์ตาม RLS เดิมของตาราง
--   2) กู้คืนงวดที่ 6 ของเงินให้กู้ 1 สัญญา ที่ถูกลบจากหน้าต่างแก้งวด (20 ต.ค. 2569 14:49) — เจ้าของอนุญาตแล้ว
--      ยกเลิกการลบแถวเดียว (deleted_at = NULL) · ยอด / วันที่เหมือนเดิมทุกอย่าง · ไม่มีแถวนี้ (ฐานข้อมูลทดสอบ) = ไม่ทำอะไร
--   รันซ้ำได้
-- =====================================================================

-- 1) ข้อมูลสัญญาเพิ่ม --------------------------------------------------------------------------
ALTER TABLE public.loan_details ADD COLUMN IF NOT EXISTS borrower_phone text;
ALTER TABLE public.loan_details ADD COLUMN IF NOT EXISTS contract_no text;
ALTER TABLE public.loan_details ADD COLUMN IF NOT EXISTS purpose text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_details_extra_len') THEN
    ALTER TABLE public.loan_details ADD CONSTRAINT loan_details_extra_len
      CHECK (coalesce(length(borrower_phone), 0) <= 50 AND coalesce(length(contract_no), 0) <= 100 AND coalesce(length(purpose), 0) <= 500);
  END IF;
END $$;

-- 2) กู้คืนงวดที่ถูกลบ --------------------------------------------------------------------------
UPDATE public.loan_schedule_lines
   SET deleted_at = NULL, deleted_by = NULL
 WHERE id = 'eaa87ed0-7f51-46a7-8628-a05aad8507d9'
   AND deleted_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.loan_schedule_lines x
                    WHERE x.loan_asset_id = public.loan_schedule_lines.loan_asset_id
                      AND x.installment_no = public.loan_schedule_lines.installment_no AND x.deleted_at IS NULL);
