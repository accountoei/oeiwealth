# ปุ่ม "คำนวณยอดสิ้นเดือนใหม่" บนกราฟ Dashboard

- วันที่: 9 พ.ย. 2026 · branch `feat/month-auto-refresh-button`
- SQL: `supabase/migrations/20261109100000_month_auto_refresh_button.sql` (ฟังก์ชันใหม่ `public.refresh_month_auto_now()` ฟังก์ชันเดียว · ไม่แก้ / ไม่ลบข้อมูล)
- ทดสอบ: ALL SCENARIO TESTS PASSED (1390 checks) · tsc / eslint / build ผ่าน

## เปลี่ยนอะไร
- ปุ่มเล็ก "คำนวณยอดสิ้นเดือนใหม่" มุมขวาล่างกล่องกราฟความมั่งคั่งสุทธิ (แถวคำอธิบายจุด) · เห็นเฉพาะ ADMIN / EDITOR
- กดแล้วทำงานเดียวกับงานเช้า 07:30 (`month-auto.yml`) ทันที: ลงมูลค่าเวนคืนประกันตามตาราง → คำนวณยอดสิ้นเดือนที่ยังไม่ปิดใหม่ · บันทึกผลใน system_job_runs → แคชล้างเอง · หน้า Dashboard รีเฟรชเอง
- `refresh_month_auto_now()` = SECURITY DEFINER + `require_role('ADMIN','EDITOR')` แล้วเรียก `server_sync_insurance_cash_values()` + `server_refresh_month_auto()` (สองตัวนี้ยังเป็น service_role เท่านั้น) · anon เรียกไม่ได้
- Server Action `refreshMonthAutoNow` ใน `src/app/(app)/dashboard-detail.ts` · ปุ่ม `src/app/(app)/MonthAutoRefreshButton.tsx`

## การตัดสินใจที่ตกลงแล้ว
| เรื่อง | ตกลง |
|---|---|
| บันทึกรายการย้อนหลังแล้วจุดสิ้นเดือนไม่เปลี่ยนจนถึงเช้า | เพิ่มปุ่มกดเอง (ไม่คำนวณอัตโนมัติทุกครั้งที่บันทึก) · ปุ่มเล็ก มุมขวาล่างของกล่อง (เจ้าของ 9 พ.ย. 2026) |
| เดือนที่ปิดแล้ว (FINAL) | ไม่แตะเหมือนงานเช้า |
