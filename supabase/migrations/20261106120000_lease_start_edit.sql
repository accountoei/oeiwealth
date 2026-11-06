-- =====================================================================
-- สัญญาเช่า: แก้วันเริ่มสัญญาได้ (ตกลงกับเจ้าของ 6 พ.ย. 2026)
--   1) t46_start_guard (ก่อนตรวจสัญญาทับกัน t55):
--      - บันทึกผู้เช่าออกแล้ว → แก้ไม่ได้ (กด "ยกเลิกผู้เช่าออก" ก่อน)
--      - วันเริ่มเกินวันเลิกสัญญาไม่ได้
--      - ค่าเช่าที่รับแล้วต้องยังอยู่ในรอบค่าเช่าใหม่ (เลื่อนวันเริ่มเลยงวดที่รับแล้ว / รอบรายไตรมาส–รายปีเลื่อน → บอกงวด ให้ลบรายการรับนั้นก่อน)
--      รอบค่าเช่า / ยอดเฉลี่ยงวดแรก คำนวณใหม่เองจากวันเริ่ม (lease_cycles) · วันที่รับเงินประกันไม่เปลี่ยน
--   2) tg_lease_overlap: ตอนแก้สัญญาเดิม (UPDATE) บอกว่าทับสัญญาฉบับไหน และต้องแก้วันสิ้นสุด / วันเลิกของฉบับใด
--      ตอนสร้างสัญญาใหม่ (INSERT) ข้อความเหมือนเดิม
--   ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) วันเริ่มสัญญา ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_lease_start_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_step int := coalesce(CASE NEW.payment_frequency WHEN 'MONTHLY' THEN 1 WHEN 'QUARTERLY' THEN 3 WHEN 'YEARLY' THEN 12 END, 1);
  v_old_step int := coalesce(CASE OLD.payment_frequency WHEN 'MONTHLY' THEN 1 WHEN 'QUARTERLY' THEN 3 WHEN 'YEARLY' THEN 12 END, 1);
  v_new int := extract(year FROM NEW.start_date)::int * 12 + extract(month FROM NEW.start_date)::int;
  v_old int := extract(year FROM OLD.start_date)::int * 12 + extract(month FROM OLD.start_date)::int;
  v_p date;
BEGIN
  IF NEW.start_date IS NOT DISTINCT FROM OLD.start_date OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.lease_closeouts c WHERE c.lease_id = NEW.id AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: บันทึกผู้เช่าออกแล้ว — กด "ยกเลิกผู้เช่าออก" ก่อนแก้วันเริ่มสัญญา' USING ERRCODE = '22023';
  END IF;
  IF NEW.terminated_date IS NOT NULL AND NEW.start_date > NEW.terminated_date THEN
    RAISE EXCEPTION 'INVALID: วันเริ่มสัญญาต้องไม่เกินวันเลิกสัญญา (%)',
      to_char(NEW.terminated_date, 'DD/MM/') || (extract(year FROM NEW.terminated_date)::int + 543) USING ERRCODE = '22023';
  END IF;
  -- งวดค่าเช่าที่รับแล้ว (อยู่ในรอบเดิม) แต่ไม่อยู่ในรอบใหม่ · รอบ = เดือนเริ่ม + ทุก 1 / 3 / 12 เดือน
  SELECT min(i.income_period) INTO v_p
    FROM public.income_transactions i
    CROSS JOIN LATERAL (SELECT extract(year FROM i.income_period)::int * 12 + extract(month FROM i.income_period)::int AS m) x
   WHERE i.lease_id = NEW.id AND i.income_type = 'RENT' AND i.deleted_at IS NULL AND i.income_period IS NOT NULL
     AND x.m >= v_old AND mod(x.m - v_old, v_old_step) = 0
     AND (x.m < v_new OR mod(x.m - v_new, v_step) <> 0);
  IF v_p IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID: แก้วันเริ่มสัญญาเป็นวันที่ % ไม่ได้ — รับค่าเช่างวด % แล้ว ซึ่งจะไม่อยู่ในรอบค่าเช่าใหม่ · ลบรายการรับค่าเช่างวดนั้นก่อน (กล่องค่าเช่าในหน้าทรัพย์สิน) แล้วค่อยแก้วันเริ่ม',
      to_char(NEW.start_date, 'DD/MM/') || (extract(year FROM NEW.start_date)::int + 543),
      to_char(v_p, 'MM/') || (extract(year FROM v_p)::int + 543)
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_lease_start_guard() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t46_start_guard ON public.property_leases;
CREATE TRIGGER t46_start_guard BEFORE UPDATE OF start_date ON public.property_leases
  FOR EACH ROW EXECUTE FUNCTION private.tg_lease_start_guard();

-- 2) สัญญาทับกัน: ข้อความตอนแก้สัญญาเดิม บอกฉบับที่ต้องแก้ ----------------------------------------------
--   ทรัพย์สินเดียวกัน + ช่วงวันทับ + (ห้องเดียวกัน หรือฉบับใดไม่ระบุห้อง = เช่าทั้งหลัง) → บันทึกไม่ได้
--   แก้แบบไม่ขยายช่วงวัน / ไม่เปลี่ยนห้อง (เลิกสัญญา · ยกเงินประกัน · แก้ค่าเช่า) → ไม่ตรวจ
CREATE OR REPLACE FUNCTION private.tg_lease_overlap() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  o record;
  v_end date := coalesce(NEW.terminated_date, NEW.end_date);
  v_unit text := lower(nullif(trim(NEW.unit_label), ''));
  v_name text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.property_id = OLD.property_id
     AND NEW.start_date >= OLD.start_date AND v_end <= coalesce(OLD.terminated_date, OLD.end_date)
     AND v_unit IS NOT DISTINCT FROM lower(nullif(trim(OLD.unit_label), '')) THEN
    RETURN NEW;
  END IF;
  SELECT l.unit_label, l.tenant_name, l.start_date, coalesce(l.terminated_date, l.end_date) AS e INTO o
    FROM public.property_leases l
   WHERE l.property_id = NEW.property_id AND l.id <> NEW.id AND l.deleted_at IS NULL
     AND l.start_date <= v_end AND coalesce(l.terminated_date, l.end_date) >= NEW.start_date
     AND (v_unit IS NULL OR nullif(trim(l.unit_label), '') IS NULL OR lower(trim(l.unit_label)) = v_unit)
   ORDER BY l.start_date
   LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_name := concat_ws(' · ', o.unit_label, o.tenant_name);
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'INVALID: ช่วงวันที่ทับกับสัญญา % (% – %) ของห้อง / ทรัพย์สินเดียวกัน — สัญญาใหม่ต้องเริ่มหลังวันที่ %',
      v_name,
      to_char(o.start_date, 'DD/MM/') || (extract(year FROM o.start_date)::int + 543),
      to_char(o.e, 'DD/MM/') || (extract(year FROM o.e)::int + 543),
      to_char(o.e, 'DD/MM/') || (extract(year FROM o.e)::int + 543)
      USING ERRCODE = '22023';
  END IF;
  -- แก้สัญญาเดิม: ฉบับที่เริ่มก่อนต้องจบก่อนอีกฉบับเริ่ม
  RAISE EXCEPTION 'INVALID: ช่วงวันที่ของสัญญานี้ (% – %) จะทับกับสัญญา % (% – %) ของห้อง / ทรัพย์สินเดียวกัน — %',
    to_char(NEW.start_date, 'DD/MM/') || (extract(year FROM NEW.start_date)::int + 543),
    to_char(v_end, 'DD/MM/') || (extract(year FROM v_end)::int + 543),
    v_name,
    to_char(o.start_date, 'DD/MM/') || (extract(year FROM o.start_date)::int + 543),
    to_char(o.e, 'DD/MM/') || (extract(year FROM o.e)::int + 543),
    CASE WHEN o.start_date <= NEW.start_date
         THEN 'แก้วันสิ้นสุด / วันเลิกสัญญาของสัญญา ' || v_name || ' ให้ไม่เกินวันที่ '
              || to_char(NEW.start_date - 1, 'DD/MM/') || (extract(year FROM NEW.start_date - 1)::int + 543) || ' ก่อน'
         ELSE 'สัญญานี้ต้องสิ้นสุด / เลิกไม่เกินวันที่ '
              || to_char(o.start_date - 1, 'DD/MM/') || (extract(year FROM o.start_date - 1)::int + 543)
              || ' หรือแก้วันเริ่มของสัญญา ' || v_name || ' ก่อน' END
    USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION private.tg_lease_overlap() FROM PUBLIC, anon;
