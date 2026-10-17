-- =====================================================================
-- ปิดสิทธิ์เรียกใช้ฟังก์ชัน trigger ของภาษีที่ดิน (private.tg_property_tax_line_check) จากผู้ใช้ทั่วไป
--   ให้เหมือนฟังก์ชัน trigger ตัวอื่น (tg_meta / tg_audit) · trigger ยังทำงานตามปกติ
--   สิทธิ์อย่างเดียว · ไม่แก้ / ไม่ลบข้อมูล · รันซ้ำได้
-- =====================================================================
REVOKE ALL ON FUNCTION private.tg_property_tax_line_check() FROM PUBLIC, anon, authenticated;
