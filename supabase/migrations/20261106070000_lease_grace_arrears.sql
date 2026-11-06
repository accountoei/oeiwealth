-- =====================================================================
-- ผ่อนผันค่าเช่า + ค่าปรับชำระล่าช้า + ชำระค่าเช่าหลังสิ้นรอบ (ตกลงกับเจ้าของ 6 พ.ย. 2026)
--
--   1) property_leases เพิ่ม 3 ช่อง (ตั้งต่อสัญญา · ต่อสัญญาใช้ค่าเดิม)
--      · rent_timing: ADVANCE = จ่ายล่วงหน้าต้นรอบ (เหมือนเดิม · ค่าเริ่มต้น) · ARREARS = จ่ายหลังสิ้นรอบ
--        (เช่น วางประกัน 1 เดือน + ล่วงหน้า 1 เดือน · รอบ 16 ต.ค.–4 พ.ย. ครบกำหนด 5 พ.ย. · งวดสุดท้ายครบกำหนดวันถัดจากวันออก → หักจากเงินประกัน)
--      · grace_days: ผ่อนผันหลังวันครบกำหนด (ค่าเริ่มต้น 15 วัน) · ในช่วงนี้ = "ครบกำหนด" (สีส้ม) ยังไม่ถือว่าล่าช้า
--      · late_fee_per_day: ค่าปรับต่อวัน (ว่าง = ไม่คิด) · คิดเฉพาะวันที่เกินช่วงผ่อนผัน (ช้า 16 วัน ผ่อนผัน 15 = 1 วัน)
--   2) private.lease_cycles(…, p_timing) = สูตรเดิม + วันครบกำหนดแบบหลังสิ้นรอบ · ฉบับ 6 ช่องเดิม = ADVANCE
--   3) v_expected_income / v_lease_rent_tracking: สถานะเดิมไม่เปลี่ยน (OVERDUE = เลยวันครบกำหนด)
--      เพิ่มท้ายตาราง: grace_days · late_fee_per_day · rent_timing · days_past_due · in_grace · late_fee (ค่าปรับ ณ วันนี้)
--   4) batch_record_rent: แถวค่าเช่ารับ late_fee ได้ → รายได้อื่น "ค่าปรับชำระค่าเช่าล่าช้า" (วันที่ / บัญชี / งวดเดียวกัน)
-- ไม่แก้ / ลบข้อมูลเดิม (สัญญาเดิม = จ่ายล่วงหน้า · ผ่อนผัน 15 วัน · ไม่มีค่าปรับ) · รันซ้ำได้
-- =====================================================================

ALTER TABLE public.property_leases
  ADD COLUMN IF NOT EXISTS rent_timing text NOT NULL DEFAULT 'ADVANCE',
  ADD COLUMN IF NOT EXISTS grace_days integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS late_fee_per_day numeric;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pl_rent_timing_ck') THEN
    ALTER TABLE public.property_leases ADD CONSTRAINT pl_rent_timing_ck CHECK (rent_timing IN ('ADVANCE', 'ARREARS'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pl_grace_days_ck') THEN
    ALTER TABLE public.property_leases ADD CONSTRAINT pl_grace_days_ck CHECK (grace_days BETWEEN 0 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pl_late_fee_ck') THEN
    ALTER TABLE public.property_leases ADD CONSTRAINT pl_late_fee_ck CHECK (late_fee_per_day IS NULL OR late_fee_per_day >= 0);
  END IF;
END $$;
COMMENT ON COLUMN public.property_leases.rent_timing IS 'ชำระค่าเช่า: ADVANCE = ล่วงหน้าต้นรอบ · ARREARS = หลังสิ้นรอบ';
COMMENT ON COLUMN public.property_leases.grace_days IS 'ผ่อนผันหลังวันครบกำหนด (วัน) · ในช่วงนี้ยังไม่ถือว่าล่าช้า';
COMMENT ON COLUMN public.property_leases.late_fee_per_day IS 'ค่าปรับชำระล่าช้าต่อวัน (ว่าง = ไม่คิด) · คิดเฉพาะวันที่เกินช่วงผ่อนผัน';

-- รอบค่าเช่า + วันครบกำหนดตามวิธีชำระ
--   ADVANCE: งวดแรกภายใน 5 วันนับจากวันเริ่มสัญญา · งวดต่อไปวันจ่ายต้นรอบ (เหมือนเดิม)
--   ARREARS: วันถัดจากวันสุดท้ายของงวด (= วันจ่ายของรอบถัดไป · งวดสุดท้าย = วันถัดจากวันออก / สิ้นสุด)
CREATE OR REPLACE FUNCTION private.lease_cycles(
  p_start date, p_end date, p_due_day int, p_step int, p_rent numeric, p_basis text, p_timing text)
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
         CASE WHEN p_timing = 'ARREARS' THEN max(amt.oe) + 1
              WHEN amt.key = 0 THEN p_start + 5
              ELSE private.pay_anchor((b.m0 + make_interval(months => amt.key))::date, p_due_day) END,
         min(amt.os), max(amt.oe), round(sum(amt.a), 2)
    FROM amt CROSS JOIN b
   GROUP BY amt.key, b.m0
   ORDER BY amt.key
$$;

-- ฉบับ 6 ช่องเดิม (ผู้เรียกเดิม เช่น ผู้เช่าออก) = จ่ายล่วงหน้า
CREATE OR REPLACE FUNCTION private.lease_cycles(
  p_start date, p_end date, p_due_day int, p_step int, p_rent numeric, p_basis text DEFAULT 'ACTUAL')
RETURNS TABLE(income_period date, due_date date, cycle_start date, cycle_end date, expected_amount numeric)
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT * FROM private.lease_cycles(p_start, p_end, p_due_day, p_step, p_rent, p_basis, 'ADVANCE')
$$;

GRANT EXECUTE ON FUNCTION private.lease_cycles(date, date, int, int, numeric, text, text) TO authenticated;

-- รายได้ที่ควรได้รับ (Section 25E) · คอลัมน์เดิมเหมือนเดิม + ผ่อนผัน / ค่าปรับ / วิธีชำระ ท้ายตาราง
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
         coalesce(l.payment_due_day, extract(day FROM l.start_date)::int) AS due_day, l.prorate_basis,
         l.rent_timing, l.grace_days, l.late_fee_per_day
    FROM public.property_leases l JOIN public.property_details pd ON pd.id = l.property_id
    JOIN public.assets a ON a.id = pd.asset_id
   WHERE l.deleted_at IS NULL AND pd.deleted_at IS NULL AND a.deleted_at IS NULL),
periods AS (
  SELECT 'RECURRING'::text AS source_type, s.id AS source_id, s.family_id, s.person_id, NULL::uuid AS asset_id,
         s.name, s.income_type, s.currency, s.receive_to_asset_id,
         g::date AS income_period,
         make_date(extract(year FROM g)::int, extract(month FROM g)::int,
                   least(s.due_day, extract(day FROM (g + interval '1 month' - interval '1 day'))::int)) AS due_date,
         s.expected_amount::numeric AS expected_amount, NULL::date AS cycle_start, NULL::date AS cycle_end,
         NULL::integer AS grace_days, NULL::numeric AS late_fee_per_day, NULL::text AS rent_timing
    FROM rec_src s JOIN fam ON fam.id = s.family_id
    CROSS JOIN LATERAL generate_series(date_trunc('month', s.start_date),
                                       least(date_trunc('month', s.end_date), date_trunc('month', current_date)),
                                       make_interval(months => s.step)) g
   WHERE s.step IS NOT NULL AND g >= fam.go_live_month
  UNION ALL
  SELECT 'LEASE', l.id, l.family_id, NULL::uuid, l.asset_id, l.name, 'RENT', l.rent_currency, NULL::uuid,
         c.income_period, c.due_date, c.expected_amount, c.cycle_start, c.cycle_end,
         l.grace_days, l.late_fee_per_day, l.rent_timing
    FROM lease_src l JOIN fam ON fam.id = l.family_id
    CROSS JOIN LATERAL private.lease_cycles(l.start_date, l.end_date, l.due_day, l.step, l.rent_amount, l.prorate_basis, l.rent_timing) c
   WHERE l.step IS NOT NULL AND c.income_period >= fam.go_live_month
     AND c.income_period <= date_trunc('month', current_date))
SELECT p.source_type, p.source_id, p.family_id, p.person_id, p.asset_id, p.name, p.income_type,
       p.income_period, p.due_date, p.expected_amount::public.d_money AS expected_amount, p.currency, p.receive_to_asset_id,
       rec.received_amount, rec.received_count,
       CASE WHEN rec.received_count > 0 THEN 'RECEIVED'
            WHEN d.id IS NOT NULL THEN 'DISMISSED'
            WHEN p.due_date >= current_date THEN 'PENDING'
            ELSE 'OVERDUE' END AS status,
       p.cycle_start, p.cycle_end,
       p.grace_days, p.late_fee_per_day, p.rent_timing,
       CASE WHEN od.late THEN current_date - p.due_date END AS days_past_due,
       coalesce(od.late AND current_date - p.due_date <= p.grace_days, false) AS in_grace,
       CASE WHEN od.late AND p.late_fee_per_day > 0 AND current_date - p.due_date > p.grace_days
            THEN round((current_date - p.due_date - p.grace_days) * p.late_fee_per_day, 2) END AS late_fee
  FROM periods p
  LEFT JOIN LATERAL (SELECT sum(i.amount) AS received_amount, count(*) AS received_count
                       FROM public.income_transactions i
                      WHERE i.deleted_at IS NULL AND i.income_period = p.income_period
                        AND ((p.source_type = 'RECURRING' AND i.recurring_template_id = p.source_id)
                          OR (p.source_type = 'LEASE' AND i.lease_id = p.source_id AND i.income_type = 'RENT'))) rec ON true
  LEFT JOIN public.expected_income_dismissals d
    ON d.source_type = p.source_type AND d.source_id = p.source_id AND d.income_period = p.income_period
   AND d.deleted_at IS NULL
  CROSS JOIN LATERAL (SELECT coalesce(rec.received_count, 0) = 0 AND d.id IS NULL AND p.due_date < current_date AS late) od;

-- ค่าเช่าตามสัญญา vs ได้รับจริง (Section 24) · + ผ่อนผัน / ค่าปรับ / วิธีชำระ
CREATE OR REPLACE VIEW public.v_lease_rent_tracking WITH (security_invoker = true) AS
  SELECT e.source_id AS lease_id, e.asset_id AS property_asset_id, e.name, e.income_period, e.due_date,
         e.expected_amount, coalesce(e.received_amount, 0) AS received_amount,
         e.expected_amount - coalesce(e.received_amount, 0) AS gap, e.currency, e.status,
         e.cycle_start, e.cycle_end,
         e.grace_days, e.late_fee_per_day, e.rent_timing, e.days_past_due, e.in_grace, e.late_fee
    FROM public.v_expected_income e WHERE e.source_type = 'LEASE';

-- ตารางค่าเช่าทั้งสัญญา (สัญญาที่พิมพ์) · วันครบกำหนดตามวิธีชำระ
CREATE OR REPLACE FUNCTION public.lease_rent_schedule(p_lease_id uuid, p_end date DEFAULT NULL)
RETURNS TABLE(no int, income_period date, due_date date, cycle_start date, cycle_end date, expected_amount numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT (row_number() OVER (ORDER BY c.income_period))::int, c.income_period, c.due_date, c.cycle_start, c.cycle_end, c.expected_amount
    FROM public.property_leases l
    CROSS JOIN LATERAL private.lease_cycles(
      l.start_date, coalesce(p_end, l.terminated_date, l.end_date),
      coalesce(l.payment_due_day, extract(day FROM l.start_date)::int),
      CASE l.payment_frequency WHEN 'MONTHLY' THEN 1 WHEN 'QUARTERLY' THEN 3 WHEN 'YEARLY' THEN 12 END,
      l.rent_amount, l.prorate_basis, l.rent_timing) c
   WHERE l.id = p_lease_id AND l.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.lease_rent_schedule(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lease_rent_schedule(uuid, date) TO authenticated;

-- รับค่าเช่าหลายรายการ (เดิม) + ค่าปรับชำระล่าช้าต่อแถว (r->>'late_fee' · ≥ 0 · เฉพาะแถวค่าเช่า)
CREATE OR REPLACE FUNCTION public.batch_record_rent(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_lease uuid; v_date date; v_amount numeric; v_tax numeric; v_bank uuid; v_ccy text; v_name text;
        c public.lease_utility_charges; v_inc uuid; v_fee numeric;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    c := NULL;
    IF nullif(r->>'charge_id', '') IS NOT NULL THEN
      SELECT * INTO c FROM public.lease_utility_charges WHERE id = (r->>'charge_id')::uuid AND deleted_at IS NULL FOR UPDATE;
      IF c.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการเรียกเก็บค่าน้ำไฟ' USING ERRCODE = '22023'; END IF;
      v_lease := c.lease_id;
    ELSE
      v_lease := nullif(r->>'lease_id', '')::uuid;
    END IF;
    v_date   := nullif(r->>'date', '')::date;
    v_amount := nullif(r->>'amount', '')::numeric;
    v_tax    := coalesce(nullif(r->>'tax', '')::numeric, 0);
    v_fee    := coalesce(nullif(r->>'late_fee', '')::numeric, 0);
    v_bank   := nullif(r->>'received_to_asset_id', '')::uuid;
    SELECT coalesce(nullif(concat_ws(' · ', l.unit_label, l.tenant_name), ''), 'สัญญาเช่า'), l.rent_currency INTO v_name, v_ccy
      FROM public.property_leases l WHERE l.id = v_lease AND l.deleted_at IS NULL;
    IF v_name IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบสัญญาเช่า' USING ERRCODE = '22023'; END IF;
    IF c.id IS NOT NULL THEN
      v_name := v_name || ' · ' || c.description;
      v_ccy := c.currency;
      IF private.utility_charge_received(c.income_id) THEN
        RAISE EXCEPTION 'INVALID: % · รับเงินคืนไปแล้ว', v_name USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_date IS NULL THEN RAISE EXCEPTION 'INVALID: % · กรุณาใส่วันที่รับ', v_name USING ERRCODE = '22023'; END IF;
    IF v_date > current_date THEN RAISE EXCEPTION 'INVALID: % · วันที่รับเป็นวันในอนาคตไม่ได้', v_name USING ERRCODE = '22023'; END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID: % · กรุณาใส่ยอดที่ได้รับ', v_name USING ERRCODE = '22023'; END IF;
    IF v_tax < 0 OR v_tax >= v_amount THEN
      RAISE EXCEPTION 'INVALID: % · ภาษีหัก ณ ที่จ่ายต้องน้อยกว่ายอดก่อนภาษี', v_name USING ERRCODE = '22023';
    END IF;
    IF c.id IS NOT NULL AND v_tax > 0 THEN
      RAISE EXCEPTION 'INVALID: % · ค่าน้ำไฟเรียกเก็บผู้เช่าไม่มีภาษีหัก ณ ที่จ่าย', v_name USING ERRCODE = '22023';
    END IF;
    IF v_fee < 0 THEN RAISE EXCEPTION 'INVALID: % · ค่าปรับต้องไม่ติดลบ', v_name USING ERRCODE = '22023'; END IF;
    IF c.id IS NOT NULL AND v_fee > 0 THEN
      RAISE EXCEPTION 'INVALID: % · ค่าน้ำไฟเรียกเก็บผู้เช่าไม่มีค่าปรับ', v_name USING ERRCODE = '22023';
    END IF;
    IF v_bank IS NOT NULL THEN SELECT a.currency INTO v_ccy FROM public.assets a WHERE a.id = v_bank; END IF;
    IF c.id IS NULL THEN
      INSERT INTO public.income_transactions(lease_id, income_type, date, income_period, amount, tax, currency, received_to_asset_id, notes)
      VALUES (v_lease, 'RENT', v_date, nullif(r->>'income_period', '')::date, v_amount, nullif(v_tax, 0), v_ccy, v_bank, nullif(trim(r->>'notes'), ''));
      IF v_fee > 0 THEN
        INSERT INTO public.income_transactions(lease_id, income_type, income_subtype, date, income_period, amount, currency, received_to_asset_id, notes)
        VALUES (v_lease, 'OTHER', 'ค่าปรับชำระค่าเช่าล่าช้า', v_date, nullif(r->>'income_period', '')::date, v_fee, v_ccy, v_bank,
                'ค่าปรับชำระค่าเช่าล่าช้า' || coalesce(' · งวด ' || to_char(nullif(r->>'income_period', '')::date, 'MM/') ||
                  (extract(year FROM nullif(r->>'income_period', '')::date)::int + 543), ''));
      END IF;
    ELSE
      INSERT INTO public.income_transactions(lease_id, income_type, income_subtype, date, income_period, amount, currency, received_to_asset_id, notes)
      VALUES (v_lease, 'OTHER', 'ค่าน้ำไฟเรียกเก็บจากผู้เช่า', v_date, c.cost_period, v_amount, v_ccy, v_bank,
              coalesce(nullif(trim(r->>'notes'), ''), c.description))
      RETURNING id INTO v_inc;
      UPDATE public.lease_utility_charges SET income_id = v_inc WHERE id = c.id;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_record_rent(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_record_rent(jsonb) TO authenticated;
