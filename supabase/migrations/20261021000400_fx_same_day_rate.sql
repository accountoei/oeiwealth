-- =====================================================================
-- อัตราแลกเปลี่ยน: ใช้อัตรา "ของวันเดียวกัน" (ตกลง 21 ต.ค. 2569)
--   เดิม (Core Schema Section 16): รายการ / ยอด ณ วันที่ D ใช้อัตราล่าสุด "ก่อน" D (rate_date < D)
--   ใหม่: ใช้อัตราล่าสุด "ถึง" D (rate_date <= D) — วันที่ D มีอัตราแล้วใช้ของวันนั้น · ยังไม่มี (ระหว่างวัน / วันหยุด) ใช้อัตราล่าสุดก่อนหน้า
--   ทุกจุดที่แปลงเป็นบาทเรียกผ่าน private.fx_rate_row / private.fx_rate → เปลี่ยนที่เดียวมีผลทั้งระบบ
--     (ยอดบาทของรายการ · Net Worth · พอร์ต · บัตรเครดิต · ตรวจก่อนปิดเดือน · ความพร้อม Go-live)
--   ข้อมูลเดิม: ไม่แก้ (ยอดบาทที่คำนวณแล้วคงเดิมจนกว่าจะแก้รายการ · เดือน FINAL อ่านจาก Snapshot)
--   Job ดึงอัตรา 3 รอบ/วัน (09:30 · 14:30 · 19:30) — .github/workflows/fx-rates.yml
-- รันซ้ำได้
-- =====================================================================

CREATE OR REPLACE FUNCTION private.fx_rate_row(p_currency text, p_date date)
RETURNS public.fx_rates
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.* FROM public.fx_rates r
   WHERE r.currency = p_currency AND r.rate_type = 'MID_AVERAGE'
     AND r.deleted_at IS NULL AND r.rate_date <= p_date
   ORDER BY r.rate_date DESC LIMIT 1
$$;
COMMENT ON FUNCTION private.fx_rate_row(text, date) IS 'อัตราล่าสุด ณ วันที่ (rate_date <= วันที่) — ใช้อัตราของวันเดียวกันถ้ามี';

-- ข้อความในหน้าความพร้อม Go-live: "ก่อนวันตั้งต้น" → "ถึงวันตั้งต้น"
DO $do$
DECLARE d text;
BEGIN
  d := replace(pg_get_functiondef('private.go_live_readiness(uuid)'::regprocedure), E'\r', '');
  IF position('ไม่มี FX ก่อนวันตั้งต้น' IN d) > 0 THEN
    EXECUTE replace(d, 'ไม่มี FX ก่อนวันตั้งต้น', 'ไม่มี FX ถึงวันตั้งต้น');
  END IF;
END $do$;
