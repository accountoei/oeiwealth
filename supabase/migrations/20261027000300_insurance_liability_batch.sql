-- =====================================================================
-- แท็บบันทึกทั้งชุด (ตกลง 27 ต.ค. 2026): Insurance "จ่ายชำระเบี้ยประกัน" / "บันทึกรับผลประโยชน์"
--                                     Liabilities "จ่ายชำระเงินกู้/บัตรเครดิต"
-- ทุกฟังก์ชันเรียกคำสั่งเดิมทีละแถวภายในคำสั่งเดียว → ผิดแถวเดียว = ไม่บันทึกเลยทั้งชุด
-- ข้อความผิดพลาดขึ้นต้นด้วยชื่อแถว (label) เพื่อให้รู้ว่าแถวไหน
-- SECURITY INVOKER: สิทธิ์ / RLS / trigger ของคำสั่งเดิมใช้ครบ
-- =====================================================================

-- ข้อความผิดพลาดของแถว: คงรหัสเดิม (INVALID / PERMISSION_DENIED / …) แล้วต่อชื่อแถวไว้หน้าข้อความ
CREATE OR REPLACE FUNCTION private.batch_row_error(p_label text, p_msg text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_msg ~ '^[A-Z_]+: '
              THEN substring(p_msg FROM '^[A-Z_]+') || ': ' || p_label || ' · ' || regexp_replace(p_msg, '^[A-Z_]+: ', '')
              ELSE p_label || ' · ' || p_msg END
$$;

-- ---------------------------------------------------------------- 1) จ่ายเบี้ยหลายงวด (หลายกรมธรรม์)
-- p_rows: [ { policy_id, label, + jsonb เดียวกับ add_expense: date, description, amount, currency, expense_category,
--             paid_from_asset_id | paid_from_credit_card_id, insurance_schedule_line_id, notes } ]
-- หลังลงค่าใช้จ่ายครบ → ลงมูลค่าเวนคืนตามตารางในสัญญาต่อ (ต่อกรมธรรม์ · เหมือนปุ่มจ่ายเบี้ยในหน้ากรมธรรม์)
CREATE OR REPLACE FUNCTION public.batch_pay_insurance_premiums(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_label text; v_policy uuid; v_line uuid; v_policies uuid[] := '{}';
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_label  := coalesce(nullif(trim(r->>'label'), ''), 'รายการ');
    v_policy := nullif(r->>'policy_id', '')::uuid;
    v_line   := nullif(r->>'insurance_schedule_line_id', '')::uuid;
    IF v_line IS NULL OR NOT EXISTS (SELECT 1 FROM public.insurance_schedule_lines
                                      WHERE id = v_line AND policy_id = v_policy AND kind = 'PREMIUM' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'INVALID: % · ไม่พบงวดเบี้ยของกรมธรรม์นี้', v_label USING ERRCODE = '22023';
    END IF;
    IF num_nonnulls(nullif(r->>'paid_from_asset_id', ''), nullif(r->>'paid_from_credit_card_id', '')) = 0 THEN
      RAISE EXCEPTION 'INVALID: % · กรุณาเลือกบัญชี / บัตรที่จ่าย', v_label USING ERRCODE = '22023';
    END IF;
    BEGIN
      PERFORM public.add_expense((r - 'policy_id' - 'label') || jsonb_build_object('expense_category', 'ประกัน'));
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '%', private.batch_row_error(v_label, SQLERRM) USING ERRCODE = SQLSTATE;
    END;
    IF NOT v_policy = ANY (v_policies) THEN v_policies := v_policies || v_policy; END IF;
    v_n := v_n + 1;
  END LOOP;
  FOREACH v_policy IN ARRAY v_policies LOOP
    PERFORM public.sync_insurance_cash_value(v_policy);
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_pay_insurance_premiums(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_pay_insurance_premiums(jsonb) TO authenticated;

-- ---------------------------------------------------------------- 2) รับผลประโยชน์หลายงวด (หลายกรมธรรม์)
-- p_rows: [ { label, + jsonb เดียวกับ receive_insurance_benefit: policy_id, line_id, date, amount, bank_asset_id, notes } ]
-- ถอนจากมูลค่าเวนคืนก่อน ส่วนเกินเป็นรายได้ (กติกาเดิม) · ปิดกรมธรรม์ (outcome) ทำที่หน้ากรมธรรม์เท่านั้น
CREATE OR REPLACE FUNCTION public.batch_receive_insurance_benefits(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_label text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
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

-- ---------------------------------------------------------------- 3) จ่ายเงินกู้ / บัตรเครดิต หลายรายการ
-- p_rows: [ { kind: 'LOAN', label, + jsonb เดียวกับ pay_liability: liability_id, bank_asset_id, date, principal, interest, notes }
--         | { kind: 'CARD', label, + jsonb เดียวกับ pay_credit_card: card_id, bank_asset_id | cash_holding_id, date, amount, autopay, notes } ]
CREATE OR REPLACE FUNCTION public.batch_pay_debts(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_label text; v_kind text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_label := coalesce(nullif(trim(r->>'label'), ''), 'รายการ');
    v_kind  := r->>'kind';
    IF v_kind IS NULL OR v_kind NOT IN ('LOAN','CARD') THEN
      RAISE EXCEPTION 'INVALID: % · ประเภทรายการไม่ถูกต้อง', v_label USING ERRCODE = '22023';
    END IF;
    BEGIN
      IF v_kind = 'LOAN' THEN
        PERFORM public.pay_liability(r - 'kind' - 'label' - 'statement_balance');
      ELSE
        PERFORM public.pay_credit_card((r - 'kind' - 'label') || jsonb_build_object('reduce_balance', false));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '%', private.batch_row_error(v_label, SQLERRM) USING ERRCODE = SQLSTATE;
    END;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_pay_debts(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_pay_debts(jsonb) TO authenticated;
