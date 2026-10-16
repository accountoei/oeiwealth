-- =====================================================================
-- หน้า Cash & Bank Accounts: อัปเดตยอดคงเหลือหลายบัญชีพร้อมกัน · ปิดงวดได้โดยใช้ยอดตามระบบ
--   1) batch_update_bank_statements(): บันทึกยอดจริงหลายบัญชี ณ วันเดียวกันในคำสั่งเดียว (ทั้งหมด หรือไม่บันทึกเลย)
--        แต่ละบัญชีใช้ update_bank_statement() เดิม → ส่วนต่างลงก้อน "รอแยกรายละเอียด" อัตโนมัติ
--   2) bank_balances_at() / bank_month_summary(): ยอดตามระบบ ณ วันที่ · สรุปเงินเข้า–ออกรายบัญชีของเดือน (หน้าภาพรวม)
--   3) ปิดงวด: บัญชีที่ยังไม่ได้อัปเดตยอดสิ้นเดือน → เตือน (REVIEW) แทน BLOCKED · ใช้ยอดตามระบบ
--        (ยอดล่าสุด + เงินเข้า − เงินออก ถึงสิ้นเดือน) ทั้งใน Checklist และ Snapshot ตอนปิดงวด
--      การกระทบยอดแบบเดิม (bank_reconciliations ที่ยืนยันแล้ว) ยังใช้ได้เหมือนเดิม
--   ฟังก์ชันอย่างเดียว · ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) บันทึกยอดหลายบัญชีพร้อมกัน ------------------------------------------------------------------
-- p_rows: [{ asset_id, value, notes? }]
DROP FUNCTION IF EXISTS public.batch_update_bank_statements(date, jsonb);
CREATE FUNCTION public.batch_update_bank_statements(p_date date, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE x jsonb; v_id uuid; v_val numeric; v_name text; v_res jsonb; v_out jsonb := '[]'::jsonb;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF p_date IS NULL OR p_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาเลือกอย่างน้อย 1 บัญชี' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT e->>'asset_id') FROM jsonb_array_elements(p_rows) e) <> jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'INVALID: มีบัญชีซ้ำในรายการ' USING ERRCODE = '22023';
  END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_id := nullif(x->>'asset_id', '')::uuid;
    v_val := nullif(replace(x->>'value', ',', ''), '')::numeric;
    SELECT name INTO v_name FROM public.assets WHERE id = v_id AND deleted_at IS NULL;
    IF v_name IS NULL OR NOT private.is_bank_asset(v_id) THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัญชี' USING ERRCODE = '22023'; END IF;
    IF v_val IS NULL THEN RAISE EXCEPTION 'INVALID: % — กรุณาใส่ยอด', v_name USING ERRCODE = '22023'; END IF;
    BEGIN
      v_res := public.update_bank_statement(v_id, p_date, v_val, nullif(trim(x->>'notes'), ''), true);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '% — %', v_name, SQLERRM USING ERRCODE = SQLSTATE;          -- บอกว่าบัญชีไหนผิด · ยกเลิกทั้งชุด
    END;
    v_out := v_out || jsonb_build_array(jsonb_build_object('asset_id', v_id, 'name', v_name) || coalesce(v_res, '{}'::jsonb));
  END LOOP;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.batch_update_bank_statements(date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_update_bank_statements(date, jsonb) TO authenticated;

-- 2) ยอดตามระบบ ณ วันที่ (ทุกบัญชีธนาคารที่เห็นได้) --------------------------------------------------
DROP FUNCTION IF EXISTS public.bank_balances_at(date);
CREATE FUNCTION public.bank_balances_at(p_date date)
RETURNS TABLE (asset_id uuid, calculated numeric, last_date date, last_value numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT a.id, private.bank_calculated_balance(a.id, p_date), lv.valuation_date, lv.value
    FROM public.assets a
    JOIN public.bank_accounts b ON b.asset_id = a.id AND b.deleted_at IS NULL
    LEFT JOIN LATERAL (SELECT v.valuation_date, v.value FROM public.asset_valuations v
                        WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.valuation_date <= p_date
                        ORDER BY v.valuation_date DESC, v.created_at DESC LIMIT 1) lv ON true
   WHERE a.deleted_at IS NULL AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')
$$;
REVOKE ALL ON FUNCTION public.bank_balances_at(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bank_balances_at(date) TO authenticated;

-- สรุปรายบัญชีของเดือน: ยอดสิ้นเดือน (หรือวันนี้) · ยอดสิ้นเดือนก่อน · เงินเข้า / ออก (แยกส่วนที่โอนระหว่างบัญชีของครอบครัว)
DROP FUNCTION IF EXISTS public.bank_month_summary(date);
CREATE FUNCTION public.bank_month_summary(p_month date)
RETURNS TABLE (asset_id uuid, balance numeric, prev_balance numeric, inflow numeric, outflow numeric,
               internal_in numeric, internal_out numeric, n_in integer, n_out integer)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE m0 date := date_trunc('month', p_month)::date; d date; p date; r record; e record;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  d := least(private.month_end(m0), current_date); p := m0 - 1;
  FOR r IN SELECT a.id FROM public.assets a JOIN public.bank_accounts b ON b.asset_id = a.id AND b.deleted_at IS NULL
            WHERE a.deleted_at IS NULL LOOP
    asset_id := r.id;
    balance := private.bank_calculated_balance(r.id, d);
    prev_balance := private.bank_calculated_balance(r.id, p);
    SELECT * INTO e FROM private.bank_movement_effects(r.id, p, d);
    inflow := coalesce(e.inflow, 0); outflow := coalesce(e.outflow, 0);
    SELECT coalesce(sum(coalesce(m.counter_amount, m.amount)) FILTER (WHERE m.to_asset_id = r.id), 0),
           coalesce(sum(m.amount) FILTER (WHERE m.from_asset_id = r.id), 0)
      INTO internal_in, internal_out
      FROM public.cash_movements m
     WHERE m.deleted_at IS NULL AND m.movement_type = 'TRANSFER' AND m.movement_date > p AND m.movement_date <= d
       AND (m.from_asset_id = r.id OR m.to_asset_id = r.id)
       AND private.is_bank_asset(m.from_asset_id) AND private.is_bank_asset(m.to_asset_id);
    SELECT count(*) FILTER (WHERE m.to_asset_id = r.id), count(*) FILTER (WHERE m.from_asset_id = r.id)
      INTO n_in, n_out
      FROM public.cash_movements m
     WHERE m.deleted_at IS NULL AND m.movement_date > p AND m.movement_date <= d
       AND (m.from_asset_id = r.id OR m.to_asset_id = r.id)
       AND NOT (m.movement_type = 'TRANSFER' AND private.is_bank_asset(m.from_asset_id) AND private.is_bank_asset(m.to_asset_id));
    RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.bank_month_summary(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bank_month_summary(date) TO authenticated;

-- 3) ปิดงวด: ไม่ได้อัปเดตยอดสิ้นเดือน → เตือน + ใช้ยอดตามระบบ ------------------------------------------
DO $$
DECLARE d text; i int; j int;
  s_mark text := 'SELECT ''CASH'', CASE WHEN br.status';
  e_mark text := 'AND (br.id IS NULL OR br.status <> ''RECONCILED'');';
  new_txt text := 'SELECT ''CASH'', ''REVIEW'', ''BALANCE_NOT_UPDATED'',
         a.name || '': ยังไม่ได้อัปเดตยอดสิ้นเดือน · ใช้ยอดตามระบบ (ยอดล่าสุด '' || to_char(lv.last_date, ''DD/MM/YYYY'') || '' + เงินเข้า − เงินออก)'',
         ''ASSET'', a.id
    FROM public.assets a
    JOIN public.bank_accounts b ON b.asset_id = a.id AND b.deleted_at IS NULL
    CROSS JOIN LATERAL (SELECT max(v.valuation_date) AS last_date FROM public.asset_valuations v
                         WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.valuation_date <= d) lv
   WHERE a.family_id = p_family AND a.deleted_at IS NULL AND a.status = ''ACTIVE''
     AND lv.last_date IS NOT NULL AND lv.last_date < d
     AND NOT EXISTS (SELECT 1 FROM public.bank_reconciliations br WHERE br.bank_asset_id = a.id AND br.year_month = m0
                       AND br.deleted_at IS NULL AND br.status <> ''OPEN'');';
BEGIN
  d := replace(pg_get_functiondef('private.month_closing_issues(uuid, date)'::regprocedure), E'\r', '');
  IF position('BALANCE_NOT_UPDATED' IN d) > 0 THEN RETURN; END IF;               -- รันซ้ำ
  i := position(s_mark IN d); j := position(e_mark IN d);
  IF i = 0 OR j = 0 OR j < i THEN RAISE EXCEPTION 'month_closing_issues: ไม่พบส่วน Cash ที่ต้องแก้'; END IF;
  EXECUTE substr(d, 1, i - 1) || new_txt || substr(d, j + length(e_mark));
END $$;

DO $$
DECLARE d text;
  old_txt text := 'IF v.id IS NULL THEN v := private.latest_asset_valuation(a.id, p_date); END IF;';
  new_txt text := 'IF v.id IS NULL THEN
          v := private.latest_asset_valuation(a.id, p_date);
          -- ไม่ได้อัปเดตยอดสิ้นเดือน → ยอดตามระบบ (ยอดล่าสุด + เงินเข้า − เงินออก ถึงวันนั้น)
          IF v.id IS NOT NULL AND v.valuation_date < p_date THEN v.value := private.bank_calculated_balance(a.id, p_date); END IF;
        END IF;';
BEGIN
  d := replace(pg_get_functiondef('private.net_worth_items(uuid, date, boolean)'::regprocedure), E'\r', '');
  IF position('ไม่ได้อัปเดตยอดสิ้นเดือน → ยอดตามระบบ' IN d) > 0 THEN RETURN; END IF;   -- รันซ้ำ
  IF (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 THEN
    RAISE EXCEPTION 'net_worth_items: ไม่พบจุดที่ต้องแก้ (ยอดบัญชีธนาคารตอนปิดงวด)';
  END IF;
  EXECUTE replace(d, old_txt, new_txt);
END $$;
