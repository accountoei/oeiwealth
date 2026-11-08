-- =====================================================================
-- ประกัน: ตารางเบี้ยและผลประโยชน์ในหน้ากรมธรรม์ (ตกลง 8 พ.ย. 2026 · แบบเงินกู้)
--   1) receive_insurance_benefits(p) — ปุ่ม "บันทึกรับ" → รับผลประโยชน์ตามงวด
--        หลายงวดในครั้งเดียว · วัน / บัญชี / ผู้รับเงิน / หมายเหตุเดียวกัน · ผิดงวดเดียว = ไม่บันทึกเลย
--        ปิดกรมธรรม์ (outcome) = ตอนรับงวดสุดท้ายในรายการ
--   2) edit_insurance_benefit_receipt(id, p) — กดแถวรับล่าสุด → แก้วันที่ / ยอด / บัญชี / หมายเหตุ
--        = ยกเลิกของเดิม + บันทึกใหม่ในคำสั่งเดียว (งวด · ผลของการรับ · ผู้รับเงิน คงเดิม) · แก้ได้เฉพาะรายการรับล่าสุดของกรมธรรม์
--   3) batch_receive_insurance_benefits — กันถอนจากมูลค่าเวนคืน 2 งวดของกรมธรรม์เดียวกันในคำสั่งเดียว (ดูข้อ 0)
--
--   0) ทำไมถอนจากมูลค่าเวนคืนได้ครั้งละ 1 งวดต่อกรมธรรม์:
--        ทุกครั้งที่ถอน ระบบลงมูลค่าเวนคืนใหม่ (asset_valuations) วันที่รับ · ยอดล่าสุดเลือกจาก วันที่ → เวลาบันทึก
--        2 งวดในคำสั่งเดียว = 2 ยอดวันเดียวกัน เวลาบันทึกเท่ากัน → ระบบเลือกยอดล่าสุดไม่ได้แน่นอน (มูลค่าเวนคืนอาจผิด)
--        ไม่ถอนจากมูลค่าเวนคืน / มูลค่าเวนคืนเป็น 0 / คนละกรมธรรม์ = หลายงวดได้
-- ไม่แก้ / ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- กรมธรรม์ที่มีมากกว่า 1 งวดในรายการ และจะถอนจากมูลค่าเวนคืน (มูลค่าเวนคืน ณ วันที่รับ > 0) · ไม่มี = NULL
CREATE OR REPLACE FUNCTION private.benefit_rows_cv_clash(p_rows jsonb, p_date date)
RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT pol.insurer || coalesce(' ' || pol.policy_no, '')
    FROM (SELECT nullif(e->>'policy_id', '')::uuid AS pid, count(*) AS n
            FROM jsonb_array_elements(p_rows) e
           WHERE coalesce((e->>'use_cash_value')::boolean, true)
           GROUP BY 1) x
    JOIN public.insurance_policies pol ON pol.id = x.pid AND pol.cash_value_asset_id IS NOT NULL
   WHERE x.n > 1 AND coalesce((private.latest_asset_valuation(pol.cash_value_asset_id, p_date)).value, 0) > 0
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.benefit_rows_cv_clash(jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.benefit_rows_cv_clash(jsonb, date) TO authenticated;

-- ---------------------------------------------------------------- 1) รับผลประโยชน์ตามงวด หลายงวดในครั้งเดียว
-- p: { date, bank_asset_id, use_cash_value, outcome, person_id, notes, rows: [ { policy_id, line_id, label, amount } ] }
CREATE OR REPLACE FUNCTION public.receive_insurance_benefits(p jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_rows jsonb := p->'rows'; r jsonb; v_i integer := 0; v_n integer; v_label text; v_clash text;
  v_use_cv boolean := coalesce((p->>'use_cash_value')::boolean, true);
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF v_rows IS NULL OR jsonb_typeof(v_rows) <> 'array' OR jsonb_array_length(v_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดอย่างน้อย 1 งวด' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(v_rows);
  IF v_use_cv THEN
    v_clash := private.benefit_rows_cv_clash(v_rows, coalesce(nullif(p->>'date', '')::date, current_date));
    IF v_clash IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID: % มีมูลค่าเวนคืน — ถอนจากมูลค่าเวนคืนได้ครั้งละ 1 งวด (บันทึกทีละงวด)', v_clash USING ERRCODE = '22023';
    END IF;
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(v_rows) LOOP
    v_i := v_i + 1;
    v_label := coalesce(nullif(trim(r->>'label'), ''), 'งวดที่ ' || v_i);
    IF nullif(r->>'line_id', '') IS NULL THEN
      RAISE EXCEPTION 'INVALID: % · ไม่พบงวดผลประโยชน์', v_label USING ERRCODE = '22023';
    END IF;
    BEGIN
      PERFORM public.receive_insurance_benefit(jsonb_build_object(
        'policy_id', r->>'policy_id', 'line_id', r->>'line_id', 'amount', r->>'amount',
        'date', p->>'date', 'bank_asset_id', p->>'bank_asset_id', 'use_cash_value', v_use_cv,
        'outcome', CASE WHEN v_i = v_n THEN nullif(p->>'outcome', '') END,
        'person_id', p->>'person_id', 'notes', p->>'notes'));
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '%', private.batch_row_error(v_label, SQLERRM) USING ERRCODE = SQLSTATE;
    END;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.receive_insurance_benefits(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_insurance_benefits(jsonb) TO authenticated;

-- ---------------------------------------------------------------- 2) แก้รายการรับผลประโยชน์ล่าสุด
-- p: { date, amount, bank_asset_id, use_cash_value, notes } · ช่องที่ไม่ส่ง = ค่าเดิม
CREATE OR REPLACE FUNCTION public.edit_insurance_benefit_receipt(p_receipt_id uuid, p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.insurance_benefit_receipts; v_person uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO r FROM public.insurance_benefit_receipts WHERE id = p_receipt_id AND deleted_at IS NULL;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการรับผลประโยชน์' USING ERRCODE = '22023'; END IF;
  IF r.undone_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID: รายการนี้ยกเลิกไปแล้ว' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.insurance_benefit_receipts x
              WHERE x.policy_id = r.policy_id AND x.undone_at IS NULL AND x.deleted_at IS NULL AND x.id <> r.id
                AND (x.receipt_date, x.created_at) > (r.receipt_date, r.created_at)) THEN
    RAISE EXCEPTION 'INVALID: แก้ได้เฉพาะรายการรับล่าสุด — ลบรายการที่ใหม่กว่าก่อน' USING ERRCODE = '22023';
  END IF;
  -- ผู้รับเงินเดิม (รายได้ส่วนเกินมูลค่าเวนคืน · ไม่มี = ตามเจ้าของมูลค่าเวนคืน / ผู้จ่ายเบี้ย เหมือนเดิม)
  SELECT person_id INTO v_person FROM public.income_transactions WHERE id = r.income_id;
  PERFORM public.undo_insurance_benefit(r.id);
  RETURN public.receive_insurance_benefit(jsonb_build_object(
    'policy_id', r.policy_id, 'line_id', r.line_id, 'outcome', r.outcome, 'person_id', v_person,
    'date', coalesce(nullif(p->>'date', ''), r.receipt_date::text),
    'amount', coalesce(nullif(p->>'amount', ''), r.amount::text),
    'bank_asset_id', coalesce(nullif(p->>'bank_asset_id', ''), r.bank_asset_id::text),
    'use_cash_value', coalesce((p->>'use_cash_value')::boolean, true),
    'notes', CASE WHEN p ? 'notes' THEN p->>'notes' ELSE r.notes END));
END $$;
REVOKE ALL ON FUNCTION public.edit_insurance_benefit_receipt(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_insurance_benefit_receipt(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------- 3) แท็บบันทึกรับผลประโยชน์ (หลายกรมธรรม์): กติกาเดิม + กันถอนมูลค่าเวนคืน 2 งวดในคำสั่งเดียว
-- p_rows: [ { label, + jsonb เดียวกับ receive_insurance_benefit: policy_id, line_id, date, amount, bank_asset_id, notes } ]
CREATE OR REPLACE FUNCTION public.batch_receive_insurance_benefits(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_label text; v_clash text; v_date text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR v_date IN SELECT DISTINCT coalesce(nullif(e->>'date', ''), current_date::text) FROM jsonb_array_elements(p_rows) e LOOP
    v_clash := private.benefit_rows_cv_clash(
      (SELECT jsonb_agg(e) FROM jsonb_array_elements(p_rows) e WHERE coalesce(nullif(e->>'date', ''), current_date::text) = v_date), v_date::date);
    IF v_clash IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID: % มีมูลค่าเวนคืน — ถอนจากมูลค่าเวนคืนได้ครั้งละ 1 งวด (บันทึกทีละงวด)', v_clash USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_label := coalesce(nullif(trim(r->>'label'), ''), 'รายการ');
    IF nullif(r->>'line_id', '') IS NULL THEN
      RAISE EXCEPTION 'INVALID: % · ไม่พบงวดผลประโยชน์', v_label USING ERRCODE = '22023';
    END IF;
    BEGIN
      PERFORM public.receive_insurance_benefit((r - 'label' - 'outcome') || jsonb_build_object('use_cash_value', true));
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '%', private.batch_row_error(v_label, SQLERRM) USING ERRCODE = SQLSTATE;
    END;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_receive_insurance_benefits(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_receive_insurance_benefits(jsonb) TO authenticated;
