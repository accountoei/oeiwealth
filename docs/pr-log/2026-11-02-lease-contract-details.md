# #285 · สัญญาเช่า: รายละเอียดสำหรับพิมพ์สัญญา · อายุสัญญา · เงินประกันตามเดือน · ต่อสัญญา

- วันที่: 2 พ.ย. 2026 · branch `feat/lease-contract-details`
- SQL: `supabase/migrations/20261102000800_lease_contract_details.sql` (รันก่อน Merge)
- ทดสอบ: ALL SCENARIO TESTS PASSED (1010 checks) · tsc / eslint (0 errors) / build ผ่าน

## เปลี่ยนอะไร
- SQL
  - `property_leases`: tenant_type (PERSON / JURISTIC) · tenant_address / phone / signatory · tenant_id_last4 (ระบบตั้งเอง · cache guard) · deposit_months · contract_place_type (LESSOR / BUSINESS / TEXT) + person / business / text · notice_days · late_return_fee_per_day · witness1/2_name · trigger `t52_contract_check`
  - `lease_tenant_secrets` (เข้ารหัสด้วย key เดียวกับเลขบัญชี · ไม่มี GRANT) + `set_lease_tenant_id` / `reveal_lease_tenant_id` (SECURITY DEFINER · ADMIN / EDITOR · Audit)
  - `property_details`: house_no · unit_no · floor_no · building_name
- `src/lib/lease.ts`: termMonths / termEnd / nextDay / termText / LEASE_DETAIL_FIELDS
- `LeaseFields.tsx`: ต่อจากสัญญาเดิม (ดึงผู้เช่า ค่าเช่า บัญชี รายละเอียด · เริ่มวันถัดไป · อายุเท่าเดิม · ยกเงินประกันจากสัญญานั้น) · อายุสัญญา ปี/เดือน ↔ วันสิ้นสุด · จำนวนเดือนประกัน (ค่าเริ่ม 2) → ยอดอัตโนมัติ แก้ได้
- `LeaseContractFields.tsx` (ใหม่): ผู้เช่าบุคคล / นิติบุคคล · เลขบัตร / ทะเบียน (ADMIN / EDITOR) · ที่อยู่ · โทร · ผู้มีอำนาจลงนาม · ทำที่ (ค่าเริ่ม = ที่อยู่เจ้าของคนแรกตามสัดส่วน) · แจ้งล่วงหน้า (ค่าเริ่ม 30 วัน) · ค่าเสียหายต่อวัน · พยาน
- หน้าทรัพย์สิน: ปุ่ม "รายละเอียดสัญญา" (pop up) ที่การ์ดสัญญา · ฟอร์มแก้ทรัพย์สินมีบ้านเลขที่ / ห้องชุดเลขที่ ชั้น อาคาร
- หน้าพิมพ์สัญญา: ใช้ข้อมูลทั้งหมดข้างบน (เลขผู้เช่าเต็มเฉพาะ ADMIN / EDITOR) · ต่อสัญญาแล้วเว้นช่องเลขว่าง = ใช้เลขเดิม

## การตัดสินใจที่ตกลงแล้ว
| เรื่อง | ตกลง |
|---|---|
| ผู้เช่านิติบุคคล | รองรับ (มีผู้เช่าเป็นบริษัท) |
| เงินประกัน | เก็บจำนวนเดือน (ค่าเริ่ม 2) · ยอด = ค่าเช่า × เดือน แก้เองได้ |
| ทำที่ | เหมือนสัญญาเงินกู้ · ค่าเริ่ม = ที่อยู่เจ้าของคนแรก เลือกคนอื่น / กิจการ / พิมพ์เองได้ |

## งานค้าง / ต่อไป
- PR ถัดไป: ของในทรัพย์สิน (property inventory) + รายการส่งมอบต่อสัญญา
