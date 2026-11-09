# อัปเดตยอดซ้ำวันเดิม = แทนแถวเดิม

- วันที่: 9 พ.ย. 2026 · branch `fix/same-day-valuation`
- SQL: `supabase/migrations/20261109230000_same_day_valuation_replace.sql` (ฟังก์ชันใหม่ 3 ตัว + ล้างรายการซ้ำที่มีอยู่ครั้งเดียว · รันซ้ำได้)
- ทดสอบ: ALL SCENARIO TESTS PASSED (1398 checks) · tsc / eslint / build ผ่าน

## เปลี่ยนอะไร
- อัปเดตยอดบัญชีธนาคาร / มูลค่าทรัพย์สินซ้ำวันเดียวกัน → แถวเดิมของวันนั้นถูกลบแบบ soft delete (กู้คืนได้ · มี audit) เหลือแถวล่าสุดแถวเดียว
  - ตัวเลขที่ระบบใช้ไม่เปลี่ยน (เดิมใช้แถวที่บันทึกหลังสุดอยู่แล้ว) · ก้อนรอแยกของบัญชีธนาคารคำนวณตาม Trigger เดิม
- จุดที่เรียก (`src/lib/same-day.ts` → `replace_same_day_valuation`): อัปเดตยอดธนาคาร (cash/actions `updateBalance`), มูลค่าทั่วไป (`records.ts addAssetValuation`), Property (`savePropertyValuation` / `addValuation`), ธุรกิจหลายกิจการ (`batchValues`), ทางเลือก (`addGoldValuation` / `batchAltValues`), มูลค่าเวนคืนที่เพิ่มเอง (`saveCashValue` เฉพาะเพิ่มใหม่)
- ไม่แตะ: ยอดตั้งต้น, ยอดกระทบยอด / เปิดบัญชี, แถวจ่ายเพิ่มที่ผูกกับรายการ (`source_movement_id`), ราคาขาย, แถวที่รายการอื่นอ้างถึง (ขายหุ้น / ขายบางส่วน / รับผลประโยชน์ประกัน / ส่วนประกอบ Property / กระทบยอด) · หนี้สิน (liability_valuations) ไม่อยู่ในรอบนี้
- ความปลอดภัย: `public.replace_same_day_valuation` = SECURITY DEFINER + `require_role('ADMIN','EDITOR','CONTRIBUTOR')` · ลบได้เฉพาะเมื่อแถวล่าสุดของวันนั้นเป็นของผู้เรียกเองที่เพิ่งบันทึก (10 นาที) · `private.is_plain_valuation` / `private.drop_same_day_before` เรียกตรงไม่ได้ · anon เรียกไม่ได้
- ล้างข้อมูลเดิม: แต่ละทรัพย์สิน + วันที่ เก็บแถวธรรมดาที่บันทึกหลังสุด (ตอนเปิด PR มี 8 แถวใน 4 รายการ) · ประวัติที่แคชไว้อาจแสดงแถวเก่าได้ไม่เกิน 1 ชม.

## การตัดสินใจที่ตกลงแล้ว
| เรื่อง | ตกลง |
|---|---|
| บันทึกยอดวันเดิมซ้ำ | แทนแถวเดิมเลย ไม่ต้องเตือน (เจ้าของ 9 พ.ย. 2026) |
