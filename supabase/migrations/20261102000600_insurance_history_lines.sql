-- =====================================================================
-- ประกัน: งวดก่อน Go-live = ประวัติ · ติ๊ก "ไม่ได้จ่าย / ไม่ได้รับ" รายงวด (ตกลง 2 พ.ย. 2026 · แนวเดียวกับเงินกู้)
--   1) insurance_schedule_lines.skipped — งวดที่ไม่ได้จ่าย / ไม่ได้รับจริง (เช่น เคยขาดอายุ) · ใช้กับงวดที่ยังไม่มีเงินเท่านั้น
--   2) v_insurance_schedule_status: สถานะใหม่
--        HISTORY = ครบกำหนดก่อน Go-live และยังไม่มีเงิน → นับเป็นจ่าย / รับแล้ว (ไม่สร้างเงินเข้า–ออก · ไม่ขึ้นในแท็บบันทึก · คงเหลือ 0)
--        SKIPPED = ติ๊ก "ไม่ได้จ่าย" → ไม่นับ · คงเหลือ 0 · เพิ่มคอลัมน์ skipped ท้าย View
--   3) set_insurance_schedule: ใส่งวดก่อน Go-live ย้อนหลังได้แม้มีงวดหลัง Go-live ที่จ่ายแล้ว · เรียงเลขงวดใหม่ตามวันครบกำหนด
--   4) sync_insurance_cash_value / server_sync_insurance_cash_values: งวดประวัติ / ไม่ได้จ่าย ไม่ถือว่าค้างเบี้ย
--   5) tg_insurance_schedule_check: ติ๊ก "ไม่ได้จ่าย" ไม่ได้ถ้างวดมีเงินแล้ว
--   ★ ไม่แก้ / ไม่ลบข้อมูลเดิม (เพิ่มคอลัมน์ค่าเริ่มต้น false) · รันซ้ำได้ · ต้องรันหลัง 20261102000300
-- =====================================================================

ALTER TABLE public.insurance_schedule_lines ADD COLUMN IF NOT EXISTS skipped boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW public.v_insurance_schedule_status WITH (security_invoker = true) AS
SELECT l.id, l.policy_id, l.kind, l.installment_no, l.due_date, l.amount, l.currency, l.benefit_type, l.notes,
       p.family_id, p.insurer, p.policy_no, p.insurance_type, p.person_id, coalesce(p.payer_person_id, p.person_id) AS payer_person_id,
       p.cash_value_asset_id, p.status AS policy_status,
       x.paid_amount, CASE WHEN x.paid_amount = 0 AND (l.skipped OR l.due_date < f.go_live_date) THEN 0
                           ELSE greatest(l.amount - x.paid_amount, 0) END AS remaining,
       CASE WHEN x.paid_amount >= l.amount - 0.005 THEN 'PAID'
            WHEN l.skipped AND x.paid_amount = 0 THEN 'SKIPPED'
            WHEN l.due_date < f.go_live_date AND x.paid_amount = 0 THEN 'HISTORY'
            WHEN p.status <> 'ACTIVE' THEN 'CLOSED'
            WHEN l.due_date < current_date THEN 'OVERDUE'
            WHEN x.paid_amount > 0 THEN 'PARTIAL'
            ELSE 'PENDING' END AS status,
       l.skipped
  FROM public.insurance_schedule_lines l
  JOIN public.insurance_policies p ON p.id = l.policy_id AND p.deleted_at IS NULL
  LEFT JOIN public.families f ON f.id = p.family_id
  CROSS JOIN LATERAL (SELECT
      coalesce((SELECT sum(e.amount) FROM public.expense_items e
                 WHERE e.insurance_schedule_line_id = l.id AND e.deleted_at IS NULL), 0)
    + coalesce((SELECT sum(i.amount) FROM public.income_transactions i
                 WHERE i.insurance_schedule_line_id = l.id AND i.deleted_at IS NULL), 0)
    + coalesce((SELECT sum(m.amount) FROM public.cash_movements m
                 WHERE m.movement_type = 'ASSET_SALE' AND m.deleted_at IS NULL
                   AND m.metadata ->> 'insurance_schedule_line_id' = l.id::text), 0) AS paid_amount) x
 WHERE l.deleted_at IS NULL;
REVOKE ALL ON public.v_insurance_schedule_status FROM PUBLIC, anon;
GRANT SELECT ON public.v_insurance_schedule_status TO authenticated;

CREATE OR REPLACE FUNCTION private.tg_insurance_schedule_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.policy_id IS DISTINCT FROM OLD.policy_id OR NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION 'IMMUTABLE: ย้ายงวดไปกรมธรรม์อื่น / เปลี่ยนชนิดงวดไม่ได้' USING ERRCODE = '42501';
    END IF;
    -- งวดที่ชำระครบ: ห้ามแก้ข้อมูล / ลบ (เปลี่ยนเลขงวดอย่างเดียวได้ · ระบบเรียงเลขใหม่เมื่อใส่งวดประวัติย้อนหลัง)
    IF OLD.deleted_at IS NULL
       AND (NEW.due_date, NEW.amount, NEW.currency, NEW.benefit_type, NEW.notes, NEW.deleted_at, NEW.skipped)
           IS DISTINCT FROM (OLD.due_date, OLD.amount, OLD.currency, OLD.benefit_type, OLD.notes, OLD.deleted_at, OLD.skipped)
       AND EXISTS (SELECT 1 FROM public.v_insurance_schedule_status s WHERE s.id = OLD.id AND s.status = 'PAID') THEN
      RAISE EXCEPTION 'LOCKED: งวดที่ชำระ / รับครบแล้วแก้ไข / ลบไม่ได้ — ถ้าบันทึกผิด ให้แก้ / ลบรายการเงินแทน' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- "ไม่ได้จ่าย / ไม่ได้รับ" ใช้กับงวดที่ยังไม่มีเงินเท่านั้น
  IF NEW.skipped AND NEW.deleted_at IS NULL AND TG_OP = 'UPDATE' AND EXISTS (
       SELECT 1 FROM public.v_insurance_schedule_status s WHERE s.id = NEW.id AND s.paid_amount > 0) THEN
    RAISE EXCEPTION 'INVALID: งวดนี้มีการชำระ / รับเงินแล้ว ติ๊ก "ไม่ได้จ่าย" ไม่ได้ — ลบรายการเงินก่อน' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.insurance_policies p WHERE p.id = NEW.policy_id AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.set_insurance_schedule(p_policy_id uuid, p_kind text, p_lines jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ccy text; v_kept_max date; v_first date; v_count integer; v_go_live date;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF p_kind NOT IN ('PREMIUM','BENEFIT') THEN RAISE EXCEPTION 'INVALID: ชนิดตารางไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(p.premium_currency, p.insured_amount_currency, 'THB'), f.go_live_date INTO v_ccy, v_go_live
    FROM public.insurance_policies p JOIN public.families f ON f.id = p.family_id WHERE p.id = p_policy_id AND p.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'INVALID: ตารางต้องมีอย่างน้อย 1 งวด' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) > 600 THEN RAISE EXCEPTION 'INVALID: ตารางยาวเกิน 600 งวด' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
              WHERE nullif(x->>'due_date', '') IS NULL OR coalesce(nullif(x->>'amount', '')::numeric, 0) <= 0
                 OR (p_kind = 'BENEFIT' AND coalesce(nullif(x->>'benefit_type', ''), 'OTHER') NOT IN ('CASH_BACK','ANNUITY','MATURITY','OTHER'))) THEN
    RAISE EXCEPTION 'INVALID: ทุกงวดต้องมีวันที่ และยอดมากกว่า 0' USING ERRCODE = '22023';
  END IF;

  -- งวดที่ยังไม่มีการชำระ → แทนที่ · งวดที่มีการชำระแล้ว (ครบ / บางส่วน) เก็บไว้
  UPDATE public.insurance_schedule_lines l SET deleted_at = now()
   WHERE l.policy_id = p_policy_id AND l.kind = p_kind AND l.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.v_insurance_schedule_status s WHERE s.id = l.id AND s.paid_amount = 0);

  -- งวดก่อน Go-live = ประวัติ ใส่ย้อนหลังได้เสมอ (แม้มีการจ่ายหลัง Go-live แล้ว) · งวดหลัง Go-live ต้องอยู่หลังงวดที่มีการชำระแล้ว
  SELECT max(due_date) INTO v_kept_max
    FROM public.insurance_schedule_lines WHERE policy_id = p_policy_id AND kind = p_kind AND deleted_at IS NULL;
  SELECT min((x->>'due_date')::date) INTO v_first FROM jsonb_array_elements(p_lines) x
   WHERE v_go_live IS NULL OR (x->>'due_date')::date >= v_go_live;
  IF v_kept_max IS NOT NULL AND v_first <= v_kept_max THEN
    RAISE EXCEPTION 'INVALID: งวดแรกต้องอยู่หลังงวดที่มีการชำระแล้ว (%)', to_char(v_kept_max, 'DD/MM/YYYY') USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.insurance_schedule_lines(policy_id, kind, installment_no, due_date, amount, currency, benefit_type, notes)
  SELECT p_policy_id, p_kind, 1,
         (x->>'due_date')::date, round((x->>'amount')::numeric, 2), v_ccy,
         CASE WHEN p_kind = 'BENEFIT' THEN coalesce(nullif(x->>'benefit_type', ''), 'OTHER') END,
         nullif(trim(x->>'notes'), '')
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(x, ord);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- เลขงวดเรียงตามวันครบกำหนดใหม่ทั้งชุด (งวดประวัติที่ใส่ย้อนหลังอยู่ก่อน)
  UPDATE public.insurance_schedule_lines l SET installment_no = n.no
    FROM (SELECT id, row_number() OVER (ORDER BY due_date, installment_no, created_at) AS no
            FROM public.insurance_schedule_lines WHERE policy_id = p_policy_id AND kind = p_kind AND deleted_at IS NULL) n
   WHERE l.id = n.id AND l.installment_no IS DISTINCT FROM n.no;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.set_insurance_schedule(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_insurance_schedule(uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_insurance_cash_value(p_policy_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  pol public.insurance_policies; v_go_live date; v_lock date; v_last date;
  r record; v_added integer := 0; v_created boolean := false; v_val numeric; v_date date; v_year integer;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT * INTO pol FROM public.insurance_policies WHERE id = p_policy_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023'; END IF;
  IF pol.status <> 'ACTIVE' THEN RETURN jsonb_build_object('added', 0, 'created', false); END IF;
  SELECT go_live_date INTO v_go_live FROM public.families WHERE id = pol.family_id;
  v_lock := private.locked_through(pol.family_id);

  IF pol.cash_value_asset_id IS NULL THEN
    IF NOT private.has_role('ADMIN','EDITOR') THEN RETURN jsonb_build_object('added', 0, 'created', false); END IF;
    SELECT c.policy_year, c.value_date, c.value INTO v_year, v_date, v_val
      FROM public.insurance_cash_value_table c
     WHERE c.policy_id = p_policy_id AND c.deleted_at IS NULL AND c.value_date <= current_date
       AND (v_lock IS NULL OR c.value_date > v_lock)
       AND NOT EXISTS (SELECT 1 FROM public.v_insurance_schedule_status s
                        WHERE s.policy_id = p_policy_id AND s.kind = 'PREMIUM' AND s.due_date < c.value_date AND s.status NOT IN ('PAID','HISTORY','SKIPPED'))
     ORDER BY c.value_date DESC LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('added', 0, 'created', false); END IF;
    PERFORM public.add_insurance_cash_value(p_policy_id, jsonb_build_object(
      'value', v_val, 'valuation_date', v_date, 'notes', 'ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ' || v_year));
    RETURN jsonb_build_object('added', 1, 'created', true, 'value', v_val, 'date', v_date, 'policy_year', v_year);
  END IF;

  SELECT max(v.valuation_date) INTO v_last FROM public.asset_valuations v
   WHERE v.asset_id = pol.cash_value_asset_id AND v.deleted_at IS NULL;
  FOR r IN
    SELECT c.policy_year, c.value_date, c.value FROM public.insurance_cash_value_table c
     WHERE c.policy_id = p_policy_id AND c.deleted_at IS NULL AND c.value_date <= current_date
       AND c.value_date >= coalesce(v_go_live, '-infinity'::date) AND (v_lock IS NULL OR c.value_date > v_lock)
       AND (v_last IS NULL OR c.value_date > v_last)
       AND NOT EXISTS (SELECT 1 FROM public.v_insurance_schedule_status s
                        WHERE s.policy_id = p_policy_id AND s.kind = 'PREMIUM' AND s.due_date < c.value_date AND s.status NOT IN ('PAID','HISTORY','SKIPPED'))
     ORDER BY c.value_date
  LOOP
    INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
    VALUES (pol.cash_value_asset_id, r.value_date, r.value, 'STATEMENT', 'STATEMENT',
            'ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ' || r.policy_year);
    v_added := v_added + 1; v_val := r.value; v_date := r.value_date; v_year := r.policy_year;
  END LOOP;
  RETURN jsonb_build_object('added', v_added, 'created', v_created, 'value', v_val, 'date', v_date, 'policy_year', v_year);
END $$;
REVOKE ALL ON FUNCTION public.sync_insurance_cash_value(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_insurance_cash_value(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.server_sync_insurance_cash_values()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_job bigint; v_added integer := 0; v_policies integer := 0; pol record; r record;
  v_go_live date; v_lock date; v_last date; v_n integer;
BEGIN
  INSERT INTO public.system_job_runs(job_type, result) VALUES ('INSURANCE_CV', 'RUNNING') RETURNING id INTO v_job;
  FOR pol IN
    SELECT i.id, i.family_id, i.cash_value_asset_id
      FROM public.insurance_policies i
      JOIN public.assets a ON a.id = i.cash_value_asset_id AND a.deleted_at IS NULL AND a.status = 'ACTIVE'
     WHERE i.deleted_at IS NULL AND i.status = 'ACTIVE'
       AND EXISTS (SELECT 1 FROM public.insurance_cash_value_table c
                    WHERE c.policy_id = i.id AND c.deleted_at IS NULL AND c.value_date <= current_date)
  LOOP
    SELECT go_live_date INTO v_go_live FROM public.families WHERE id = pol.family_id;
    v_lock := private.locked_through(pol.family_id);
    SELECT max(v.valuation_date) INTO v_last FROM public.asset_valuations v
     WHERE v.asset_id = pol.cash_value_asset_id AND v.deleted_at IS NULL;
    v_n := 0;
    FOR r IN
      SELECT c.policy_year, c.value_date, c.value FROM public.insurance_cash_value_table c
       WHERE c.policy_id = pol.id AND c.deleted_at IS NULL AND c.value_date <= current_date
         AND c.value_date >= coalesce(v_go_live, '-infinity'::date) AND (v_lock IS NULL OR c.value_date > v_lock)
         AND (v_last IS NULL OR c.value_date > v_last)
         AND NOT EXISTS (SELECT 1 FROM public.v_insurance_schedule_status s
                          WHERE s.policy_id = pol.id AND s.kind = 'PREMIUM' AND s.due_date < c.value_date AND s.status NOT IN ('PAID','HISTORY','SKIPPED'))
       ORDER BY c.value_date
    LOOP
      INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
      VALUES (pol.cash_value_asset_id, r.value_date, r.value, 'STATEMENT', 'STATEMENT',
              'ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ' || r.policy_year);
      v_n := v_n + 1;
    END LOOP;
    IF v_n > 0 THEN v_added := v_added + v_n; v_policies := v_policies + 1; END IF;
  END LOOP;
  UPDATE public.system_job_runs SET result = 'SUCCESS', finished_at = now(),
         details = jsonb_build_object('added', v_added, 'policies', v_policies) WHERE id = v_job;
  RETURN v_added;
END $$;
REVOKE ALL ON FUNCTION public.server_sync_insurance_cash_values() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_sync_insurance_cash_values() TO service_role;
