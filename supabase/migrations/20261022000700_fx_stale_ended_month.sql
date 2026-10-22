-- ตรวจ FX เก่า (FX_STALE) เฉพาะเดือนที่สิ้นสุดแล้ว (ตกลง 22 ต.ค. 2026)
--   เดิม: ระหว่างเดือน เทียบ Rate ล่าสุดกับวันสิ้นเดือน (อนาคต) → ขึ้น "เก่ากว่า 5 วัน" ทั้งที่ Rate เป็นของวันนี้ (ชวนสับสน)
--   ใหม่: เดือนที่ยังไม่สิ้นสุดแสดงแค่ MONTH_NOT_ENDED (ยัง BLOCKED เหมือนเดิม) · เดือนที่จบแล้วตรวจ FX ตามเดิม
--   แก้เฉพาะเงื่อนไข WHERE ของ FX_STALE ใน private.month_closing_issues (ส่วนอื่นไม่เปลี่ยน) · รันซ้ำได้
DO $$
DECLARE
  d text;
  old_txt text := '   WHERE r.id IS NULL OR d - r.rate_date > 5;';
  new_txt text := '   WHERE d < current_date AND (r.id IS NULL OR d - r.rate_date > 5);';
BEGIN
  old_txt := replace(old_txt, E'\r', ''); new_txt := replace(new_txt, E'\r', '');   -- วาง SQL จาก Windows (CRLF)
  d := replace(pg_get_functiondef('private.month_closing_issues(uuid, date)'::regprocedure), E'\r', '');
  IF position(new_txt IN d) > 0 THEN RETURN; END IF;                               -- รันซ้ำ
  IF (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 THEN
    RAISE EXCEPTION 'month_closing_issues: ไม่พบจุดที่ต้องแก้ (FX_STALE)';
  END IF;
  EXECUTE replace(d, old_txt, new_txt);
END $$;
