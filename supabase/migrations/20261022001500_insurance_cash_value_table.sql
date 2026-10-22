-- =====================================================================
-- ประกัน: ตารางมูลค่าเวนคืนตามสัญญา (รายปีกรมธรรม์) + อัปเดตมูลค่าเวนคืนอัตโนมัติ
--   1) insurance_cash_value_table — มูลค่าเวนคืน ณ สิ้นปีกรมธรรม์ที่ N (ตามตารางในเล่มกรมธรรม์)
--   2) set_insurance_cash_value_table(policy, lines) — ตั้ง / แทนทั้งตาราง (ส่ง [] = ล้างตาราง) แล้วอัปเดตมูลค่าเวนคืนต่อทันที
--   3) sync_insurance_cash_value(policy) — ลงมูลค่าเวนคืนตามตารางให้เอง (เรียกหลังบันทึกจ่ายเบี้ย / ตั้งตาราง / กดปุ่ม)
--      · เฉพาะกรมธรรม์ที่มีผล · ปีที่ถึงวันแล้ว (ไม่ลงวันในอนาคต) · เบี้ยทุกงวดก่อนวันนั้นจ่ายครบแล้ว
--      · ไม่ทับยอดที่มีอยู่: ลงเฉพาะปีที่ใหม่กว่ายอดล่าสุด · ข้ามเดือนที่ปิดงวดแล้ว
--      · ยังไม่มีมูลค่าเวนคืน (ADMIN / EDITOR): สร้างให้ด้วยปีล่าสุดที่เข้าเงื่อนไข (ก่อน Go-live = ยอดตั้งต้น ถ้ายังไม่ปิดงวด)
-- ไม่แก้ / ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.insurance_cash_value_table (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id    uuid NOT NULL REFERENCES public.insurance_policies(id),
  policy_year  integer NOT NULL CHECK (policy_year BETWEEN 1 AND 120),
  value_date   date NOT NULL,
  value        public.d_money NOT NULL CHECK (value >= 0),
  currency     public.d_currency NOT NULL DEFAULT 'THB',
  notes        text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS insurance_cash_value_table_uq
  ON public.insurance_cash_value_table (policy_id, policy_year) WHERE deleted_at IS NULL;

-- Generic triggers + RLS มาตรฐาน (เหมือน 20261010000400)
DO $$
DECLARE t text := 'insurance_cash_value_table';
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS t10_meta ON public.%I', t);
  EXECUTE format('CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.tg_meta(%L)', t, 'soft');
  EXECUTE format('DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.%I', t);
  EXECUTE format('CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete()', t);
  EXECUTE format('DROP TRIGGER IF EXISTS z90_audit ON public.%I', t);
  EXECUTE format('CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.tg_audit()', t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated, service_role', t);
  EXECUTE format('DROP POLICY IF EXISTS p_select ON public.%I', t);
  EXECUTE format('DROP POLICY IF EXISTS p_insert ON public.%I', t);
  EXECUTE format('DROP POLICY IF EXISTS p_update ON public.%I', t);
  EXECUTE format($p$CREATE POLICY p_select ON public.%I FOR SELECT TO authenticated
                    USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')))$p$, t);
  -- ตารางตามสัญญาเป็นข้อมูลอ้างอิงของกรมธรรม์: ADMIN / EDITOR เท่านั้น (ตั้งผ่าน set_insurance_cash_value_table)
  EXECUTE format($p$CREATE POLICY p_insert ON public.%I FOR INSERT TO authenticated
                    WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR')))$p$, t);
  EXECUTE format($p$CREATE POLICY p_update ON public.%I FOR UPDATE TO authenticated
                    USING ((SELECT private.has_role('ADMIN','EDITOR')))
                    WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR')))$p$, t);
END $$;

-- ---------------------------------------------------------------- 3) ลงมูลค่าเวนคืนตามตาราง
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
                        WHERE s.policy_id = p_policy_id AND s.kind = 'PREMIUM' AND s.due_date < c.value_date AND s.status <> 'PAID')
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
                        WHERE s.policy_id = p_policy_id AND s.kind = 'PREMIUM' AND s.due_date < c.value_date AND s.status <> 'PAID')
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

-- ---------------------------------------------------------------- 2) ตั้ง / แทนตาราง
--   lines: [{policy_year, value, value_date?}] · ไม่ส่ง value_date = วันเริ่มสัญญา + N ปี
CREATE OR REPLACE FUNCTION public.set_insurance_cash_value_table(p_policy_id uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE pol public.insurance_policies; v_ccy text; v_count integer;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO pol FROM public.insurance_policies WHERE id = p_policy_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID: รูปแบบตารางไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(p_lines) > 120 THEN RAISE EXCEPTION 'INVALID: ตารางยาวเกิน 120 ปี' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
              WHERE coalesce(nullif(x->>'policy_year', '')::integer, 0) NOT BETWEEN 1 AND 120
                 OR nullif(x->>'value', '') IS NULL OR (x->>'value')::numeric < 0) THEN
    RAISE EXCEPTION 'INVALID: ทุกแถวต้องมีปีกรมธรรม์ (1–120) และมูลค่าไม่ติดลบ' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT (x->>'policy_year')::integer) <> count(*) FROM jsonb_array_elements(p_lines) x) THEN
    RAISE EXCEPTION 'INVALID: ปีกรมธรรม์ซ้ำกัน' USING ERRCODE = '22023';
  END IF;
  IF pol.start_date IS NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x WHERE nullif(x->>'value_date', '') IS NULL) THEN
    RAISE EXCEPTION 'INVALID: กรมธรรม์ยังไม่มีวันเริ่มสัญญา — ใส่วันเริ่มที่ "แก้ไขข้อมูล" หรือใส่วันที่ทุกแถว' USING ERRCODE = '22023';
  END IF;
  v_ccy := coalesce(pol.insured_amount_currency, pol.premium_currency, 'THB');

  UPDATE public.insurance_cash_value_table SET deleted_at = now() WHERE policy_id = p_policy_id AND deleted_at IS NULL;
  INSERT INTO public.insurance_cash_value_table(policy_id, policy_year, value_date, value, currency, notes)
  SELECT p_policy_id, (x->>'policy_year')::integer,
         coalesce(nullif(x->>'value_date', '')::date, (pol.start_date + make_interval(years => (x->>'policy_year')::integer))::date),
         round((x->>'value')::numeric, 2), v_ccy, nullif(trim(x->>'notes'), '')
    FROM jsonb_array_elements(p_lines) x;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('count', v_count, 'sync', public.sync_insurance_cash_value(p_policy_id));
END $$;
REVOKE ALL ON FUNCTION public.set_insurance_cash_value_table(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_insurance_cash_value_table(uuid, jsonb) TO authenticated;
