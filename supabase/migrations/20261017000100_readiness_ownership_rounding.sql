-- =====================================================================
-- หน้า Opening (go_live_readiness): "ระบุเจ้าของไม่ครบ (ขาด 0.0000000000000001%)" ทั้งที่ระบุครบ
--   สาเหตุ: ธุรกิจที่ระบุเป็นจำนวนหุ้น → % = หุ้น ÷ หุ้นรวม (ไม่ปัดเศษ) · หารไม่ลงตัว รวมได้ 99.99999…% ไม่ถึง 100 พอดี
--   แก้: ยอมคลาดเคลื่อนเล็กน้อยแบบเดียวกับ private.asset_owner_shares (ขาดเกิน 0.00001% จึงเตือน)
--        + แสดงส่วนที่ขาดปัด 4 ตำแหน่ง · ใช้กับทรัพย์สินและหนี้
--   ฟังก์ชันอย่างเดียว · ไม่แก้ / ไม่ลบข้อมูล · รันซ้ำได้
-- =====================================================================
DO $$
DECLARE d text; n int;
BEGIN
  d := replace(pg_get_functiondef('private.go_live_readiness(uuid)'::regprocedure), E'\r', '');
  IF position('s.pct < 99.99999' IN d) > 0 THEN RETURN; END IF;                -- รันซ้ำ
  n := (length(d) - length(replace(d, 'AND s.pct < 100;', ''))) / length('AND s.pct < 100;');
  IF n <> 2 THEN RAISE EXCEPTION 'go_live_readiness: ไม่พบจุดที่ต้องแก้ (พบ % จุด)', n; END IF;
  d := replace(d, 'AND s.pct < 100;', 'AND s.pct < 99.99999;');
  d := replace(d, '(100 - s.pct)::numeric', 'round(100 - s.pct, 4)::numeric');
  d := replace(d, '(100 - s.pct)::text', 'round(100 - s.pct, 4)::text');
  EXECUTE d;
END $$;
