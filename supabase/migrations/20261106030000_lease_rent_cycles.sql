-- =====================================================================
-- ค่าเช่าตามรอบวันจ่าย + คิดวันเศษ + กันสัญญาทับกัน (ตกลงกับเจ้าของ 6 พ.ย. 2026)
--
--   1) รอบค่าเช่า (สัญญารายเดือน / ไตรมาส / ปี) เริ่มนับที่ "วันจ่าย" (payment_due_day · ว่าง = วันที่ของวันเริ่มสัญญา)
--      · วันจ่ายตรงกับวันเริ่มสัญญา → ทุกงวดเต็ม (เช่น เริ่ม 16 ต.ค. → 16 ต.ค.–15 พ.ย. …)
--      · ไม่ตรง → งวดแรก = วันเริ่มสัญญา ถึงก่อนวันจ่ายของเดือนถัดไป คิดตามจำนวนวัน
--        (เริ่ม 16 ต.ค. จ่ายทุกวันที่ 5 → งวดแรก 16 ต.ค.–4 พ.ย. = 20 วัน · เริ่ม 1 ก.ย. จ่ายทุกวันที่ 5 → 1 ก.ย.–4 ต.ค. = 1 รอบ + 4 วัน)
--      · งวดแรกครบกำหนดภายใน 5 วันนับจากวันเริ่มสัญญา · งวดต่อไปจ่ายล่วงหน้าในวันจ่ายของรอบนั้น
--      · งวดสุดท้าย (ครบสัญญา / เลิกสัญญากลางรอบ) คิดถึงวันสุดท้ายตามจำนวนวัน
--      · วิธีคิดวันเศษ (prorate_basis): ACTUAL = ÷ จำนวนวันจริงของรอบ (28–31) · DAYS30 = ÷ 30 (ไม่เกินค่าเช่าเต็มรอบ)
--      งวดหนึ่งยังผูกกับเดือน (income_period = วันที่ 1 ของเดือนที่รอบเริ่ม) → หน้ารับค่าเช่า / รายรับรายจ่ายใช้ได้เหมือนเดิม
--   2) private.lease_cycles() = สูตรเดียวที่ใช้ทั้ง v_expected_income และ lease_rent_schedule() (ตารางค่าเช่าในสัญญาที่พิมพ์)
--   3) สัญญาของทรัพย์สินเดียวกันที่ช่วงวันทับกัน (ห้องเดียวกัน หรือฉบับใดไม่ระบุห้อง = เช่าทั้งหลัง) → บันทึกไม่ได้
--      (ผู้เช่าคนเดียวกันเช่า 2 ห้องพร้อมกันยังทำได้ · ข้อมูลเดิมที่ทับอยู่แล้วไม่ถูกบล็อกจนกว่าจะแก้วันที่ / ห้อง)
-- ไม่แก้ / ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

ALTER TABLE public.property_leases
  ADD COLUMN IF NOT EXISTS prorate_basis text NOT NULL DEFAULT 'ACTUAL';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pl_prorate_basis_ck') THEN
    ALTER TABLE public.property_leases
      ADD CONSTRAINT pl_prorate_basis_ck CHECK (prorate_basis IN ('ACTUAL', 'DAYS30'));
  END IF;
END $$;
COMMENT ON COLUMN public.property_leases.prorate_basis IS
  'คิดค่าเช่าวันเศษ: ACTUAL = ÷ จำนวนวันจริงของรอบ · DAYS30 = ÷ 30 วัน';

-- วันจ่ายของเดือน m (วันที่ 1 ของเดือน) · วันที่ 29–31 ในเดือนสั้น → วันสุดท้ายของเดือน
CREATE OR REPLACE FUNCTION private.pay_anchor(p_month date, p_day int)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT make_date(extract(year FROM p_month)::int, extract(month FROM p_month)::int,
                   least(p_day, extract(day FROM (date_trunc('month', p_month) + interval '1 month' - interval '1 day'))::int))
$$;

-- งวดค่าเช่าของสัญญา: รอบละ p_step เดือนนับจากวันจ่าย · คิดเฉพาะวันที่อยู่ในช่วง [p_start, p_end]
--   ชิ้นส่วนก่อนรอบแรก (วันเริ่มก่อนวันจ่ายของเดือนนั้น) รวมเข้างวดแรก → 1 งวดต่อเดือน
CREATE OR REPLACE FUNCTION private.lease_cycles(
  p_start date, p_end date, p_due_day int, p_step int, p_rent numeric, p_basis text DEFAULT 'ACTUAL')
RETURNS TABLE(income_period date, due_date date, cycle_start date, cycle_end date, expected_amount numeric)
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  WITH b AS (
    SELECT date_trunc('month', p_start)::date AS m0,
           (extract(year FROM p_end)::int * 12 + extract(month FROM p_end)::int)
         - (extract(year FROM p_start)::int * 12 + extract(month FROM p_start)::int) AS n
  ), c AS (
    SELECT g AS k,
           private.pay_anchor((b.m0 + make_interval(months => g))::date, p_due_day) AS cs,
           private.pay_anchor((b.m0 + make_interval(months => g + p_step))::date, p_due_day) - 1 AS ce
      FROM b CROSS JOIN LATERAL generate_series(-p_step, b.n, p_step) g
     WHERE p_step > 0 AND p_end >= p_start AND p_due_day BETWEEN 1 AND 31
  ), piece AS (
    SELECT greatest(c.k, 0) AS key, greatest(c.cs, p_start) AS os, least(c.ce, p_end) AS oe, c.ce - c.cs + 1 AS len
      FROM c
  ), amt AS (
    SELECT p.key, p.os, p.oe,
           CASE WHEN p.oe - p.os + 1 >= p.len THEN p_rent
                WHEN p_basis = 'DAYS30' THEN least(p_rent, p_rent * (p.oe - p.os + 1) / (30 * p_step))
                ELSE p_rent * (p.oe - p.os + 1) / p.len END AS a
      FROM piece p WHERE p.oe >= p.os
  )
  SELECT (b.m0 + make_interval(months => amt.key))::date,
         CASE WHEN amt.key = 0 THEN p_start + 5
              ELSE private.pay_anchor((b.m0 + make_interval(months => amt.key))::date, p_due_day) END,
         min(amt.os), max(amt.oe), round(sum(amt.a), 2)
    FROM amt CROSS JOIN b
   GROUP BY amt.key, b.m0
   ORDER BY amt.key
$$;

GRANT EXECUTE ON FUNCTION private.pay_anchor(date, int),
  private.lease_cycles(date, date, int, int, numeric, text) TO authenticated;

-- รายได้ที่ควรได้รับ (Section 25E): Recurring (เหมือนเดิม) + Lease (ตามรอบวันจ่าย) · เพิ่ม cycle_start / cycle_end ท้ายตาราง
CREATE OR REPLACE VIEW public.v_expected_income WITH (security_invoker = true) AS
WITH fam AS (SELECT f.id, date_trunc('month', f.go_live_date)::date AS go_live_month
               FROM public.families f WHERE f.deleted_at IS NULL),
rec_src AS (
  SELECT t.id, t.family_id, t.person_id, t.name, t.income_type, t.expected_amount, t.currency, t.receive_to_asset_id,
         t.start_date, coalesce(t.end_date, 'infinity'::date) AS end_date,
         CASE t.frequency WHEN 'MONTHLY' THEN 1 WHEN 'QUARTERLY' THEN 3 WHEN 'YEARLY' THEN 12 END AS step,
         coalesce(t.due_day, extract(day FROM t.start_date)::int) AS due_day
    FROM public.recurring_income_templates t WHERE t.deleted_at IS NULL AND t.active),
lease_src AS (
  SELECT l.id, a.family_id, a.id AS asset_id, concat_ws(' · ', a.name, l.unit_label, l.tenant_name) AS name,
         l.rent_amount, l.rent_currency, l.start_date, coalesce(l.terminated_date, l.end_date) AS end_date,
         CASE l.payment_frequency WHEN 'MONTHLY' THEN 1 WHEN 'QUARTERLY' THEN 3 WHEN 'YEARLY' THEN 12 END AS step,
         coalesce(l.payment_due_day, extract(day FROM l.start_date)::int) AS due_day, l.prorate_basis
    FROM public.property_leases l JOIN public.property_details pd ON pd.id = l.property_id
    JOIN public.assets a ON a.id = pd.asset_id
   WHERE l.deleted_at IS NULL AND pd.deleted_at IS NULL AND a.deleted_at IS NULL),
periods AS (
  SELECT 'RECURRING'::text AS source_type, s.id AS source_id, s.family_id, s.person_id, NULL::uuid AS asset_id,
         s.name, s.income_type, s.currency, s.receive_to_asset_id,
         g::date AS income_period,
         make_date(extract(year FROM g)::int, extract(month FROM g)::int,
                   least(s.due_day, extract(day FROM (g + interval '1 month' - interval '1 day'))::int)) AS due_date,
         s.expected_amount::numeric AS expected_amount, NULL::date AS cycle_start, NULL::date AS cycle_end
    FROM rec_src s JOIN fam ON fam.id = s.family_id
    CROSS JOIN LATERAL generate_series(date_trunc('month', s.start_date),
                                       least(date_trunc('month', s.end_date), date_trunc('month', current_date)),
                                       make_interval(months => s.step)) g
   WHERE s.step IS NOT NULL AND g >= fam.go_live_month
  UNION ALL
  SELECT 'LEASE', l.id, l.family_id, NULL::uuid, l.asset_id, l.name, 'RENT', l.rent_currency, NULL::uuid,
         c.income_period, c.due_date, c.expected_amount, c.cycle_start, c.cycle_end
    FROM lease_src l JOIN fam ON fam.id = l.family_id
    CROSS JOIN LATERAL private.lease_cycles(l.start_date, l.end_date, l.due_day, l.step, l.rent_amount, l.prorate_basis) c
   WHERE l.step IS NOT NULL AND c.income_period >= fam.go_live_month
     AND c.income_period <= date_trunc('month', current_date))
SELECT p.source_type, p.source_id, p.family_id, p.person_id, p.asset_id, p.name, p.income_type,
       p.income_period, p.due_date, p.expected_amount::public.d_money AS expected_amount, p.currency, p.receive_to_asset_id,
       rec.received_amount, rec.received_count,
       CASE WHEN rec.received_count > 0 THEN 'RECEIVED'
            WHEN d.id IS NOT NULL THEN 'DISMISSED'
            WHEN p.due_date >= current_date THEN 'PENDING'
            ELSE 'OVERDUE' END AS status,
       p.cycle_start, p.cycle_end
  FROM periods p
  LEFT JOIN LATERAL (SELECT sum(i.amount) AS received_amount, count(*) AS received_count
                       FROM public.income_transactions i
                      WHERE i.deleted_at IS NULL AND i.income_period = p.income_period
                        AND ((p.source_type = 'RECURRING' AND i.recurring_template_id = p.source_id)
                          OR (p.source_type = 'LEASE' AND i.lease_id = p.source_id AND i.income_type = 'RENT'))) rec ON true
  LEFT JOIN public.expected_income_dismissals d
    ON d.source_type = p.source_type AND d.source_id = p.source_id AND d.income_period = p.income_period
   AND d.deleted_at IS NULL;

-- ค่าเช่าตามสัญญา vs ได้รับจริง (Section 24) · เพิ่มช่วงวันของรอบ
CREATE OR REPLACE VIEW public.v_lease_rent_tracking WITH (security_invoker = true) AS
  SELECT e.source_id AS lease_id, e.asset_id AS property_asset_id, e.name, e.income_period, e.due_date,
         e.expected_amount, coalesce(e.received_amount, 0) AS received_amount,
         e.expected_amount - coalesce(e.received_amount, 0) AS gap, e.currency, e.status,
         e.cycle_start, e.cycle_end
    FROM public.v_expected_income e WHERE e.source_type = 'LEASE';

-- ตารางค่าเช่าทั้งสัญญา (สัญญาที่พิมพ์ · หน้าต่างผู้เช่าออก) · p_end = คิดถึงวันนี้แทนวันสิ้นสุด / วันเลิกสัญญา
CREATE OR REPLACE FUNCTION public.lease_rent_schedule(p_lease_id uuid, p_end date DEFAULT NULL)
RETURNS TABLE(no int, income_period date, due_date date, cycle_start date, cycle_end date, expected_amount numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT (row_number() OVER (ORDER BY c.income_period))::int, c.income_period, c.due_date, c.cycle_start, c.cycle_end, c.expected_amount
    FROM public.property_leases l
    CROSS JOIN LATERAL private.lease_cycles(
      l.start_date, coalesce(p_end, l.terminated_date, l.end_date),
      coalesce(l.payment_due_day, extract(day FROM l.start_date)::int),
      CASE l.payment_frequency WHEN 'MONTHLY' THEN 1 WHEN 'QUARTERLY' THEN 3 WHEN 'YEARLY' THEN 12 END,
      l.rent_amount, l.prorate_basis) c
   WHERE l.id = p_lease_id AND l.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.lease_rent_schedule(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lease_rent_schedule(uuid, date) TO authenticated;

-- สัญญาทับกัน: ทรัพย์สินเดียวกัน + ช่วงวันทับ + (ห้องเดียวกัน หรือฉบับใดไม่ระบุห้อง = เช่าทั้งหลัง) → บันทึกไม่ได้
--   แก้แบบไม่ขยายช่วงวัน / ไม่เปลี่ยนห้อง (เลิกสัญญา · ยกเงินประกัน · แก้ค่าเช่า) → ไม่ตรวจ
CREATE OR REPLACE FUNCTION private.tg_lease_overlap() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  o record;
  v_end date := coalesce(NEW.terminated_date, NEW.end_date);
  v_unit text := lower(nullif(trim(NEW.unit_label), ''));
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
  IF FOUND THEN
    RAISE EXCEPTION 'INVALID: ช่วงวันที่ทับกับสัญญา % (% – %) ของห้อง / ทรัพย์สินเดียวกัน — สัญญาใหม่ต้องเริ่มหลังวันที่ %',
      concat_ws(' · ', o.unit_label, o.tenant_name),
      to_char(o.start_date, 'DD/MM/') || (extract(year FROM o.start_date)::int + 543),
      to_char(o.e, 'DD/MM/') || (extract(year FROM o.e)::int + 543),
      to_char(o.e, 'DD/MM/') || (extract(year FROM o.e)::int + 543)
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t55_overlap ON public.property_leases;
CREATE TRIGGER t55_overlap BEFORE INSERT OR UPDATE ON public.property_leases
  FOR EACH ROW EXECUTE FUNCTION private.tg_lease_overlap();
