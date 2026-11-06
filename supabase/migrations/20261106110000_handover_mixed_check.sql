-- รายการส่งมอบ: ผลตรวจ "ชำรุด + สูญหาย" ในแถวเดียว (ของหลายชิ้น · ตกลงกับเจ้าของ 6 พ.ย. 2026)
--   out_status = 'MIXED' · out_qty = จำนวนที่ชำรุด · out_missing_qty = จำนวนที่สูญหาย (ทั้ง 2 ช่องมากกว่า 0 · รวมกันไม่เกินจำนวนที่ส่งมอบ)
--   ค่าเสียหายเสนอ = จำนวนที่ชำรุด × มูลค่าชำรุดต่อชิ้น + จำนวนที่สูญหาย × มูลค่าต่อชิ้น (แก้ได้ · คำนวณที่หน้าจอ)
--   เพิ่มคอลัมน์ + ขยายเงื่อนไขผลตรวจอย่างเดียว ไม่แก้ข้อมูลเดิม · ไม่มีฟังก์ชันเปลี่ยน · รันซ้ำได้

ALTER TABLE public.lease_handover_items ADD COLUMN IF NOT EXISTS out_missing_qty numeric(10,2);
COMMENT ON COLUMN public.lease_handover_items.out_qty IS 'จำนวนที่ชำรุด / สูญหาย (ว่าง = ทั้งหมด) · ผลตรวจ ชำรุด + สูญหาย (MIXED) = จำนวนที่ชำรุด';
COMMENT ON COLUMN public.lease_handover_items.out_missing_qty IS 'จำนวนที่สูญหาย เฉพาะผลตรวจ ชำรุด + สูญหาย (MIXED)';

-- ผลตรวจ: เพิ่ม MIXED (ชำรุด + สูญหาย)
ALTER TABLE public.lease_handover_items DROP CONSTRAINT IF EXISTS lho_out_ck;
ALTER TABLE public.lease_handover_items ADD CONSTRAINT lho_out_ck
  CHECK (out_status IS NULL OR out_status IN ('OK','DAMAGED','MISSING','MIXED'));

-- MIXED ต้องมีทั้งจำนวนที่ชำรุดและสูญหาย รวมกันไม่เกินจำนวนที่ส่งมอบ · ผลตรวจอื่นไม่มีจำนวนที่สูญหายแยก
ALTER TABLE public.lease_handover_items DROP CONSTRAINT IF EXISTS lho_mixed_ck;
ALTER TABLE public.lease_handover_items ADD CONSTRAINT lho_mixed_ck CHECK (
  CASE WHEN out_status = 'MIXED'
       THEN out_qty IS NOT NULL AND out_missing_qty IS NOT NULL AND out_missing_qty > 0 AND out_qty + out_missing_qty <= qty
       ELSE out_missing_qty IS NULL END);
