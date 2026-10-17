-- =====================================================================
-- Property: บันทึกค่าเช่า / ค่าใช้จ่ายของทรัพย์สินหลายรายการพร้อมกัน (แท็บ "รายได้และสัญญาเช่า" / "ค่าใช้จ่าย")
--   ทั้งชุดเป็น transaction เดียว: รายการไหนผิด = ไม่บันทึกเลยสักรายการ
--   SECURITY INVOKER → สิทธิ์ (RLS) + กติกาเดิมทุกข้อ (ปิดงวด / Go-live / Derived Movement) ทำงานเหมือนบันทึกทีละรายการ
--   ไม่แก้ / ลบข้อมูลเดิม · เพิ่มฟังก์ชันใหม่ 2 ตัว
-- =====================================================================

-- ---------------------------------------------------------------- 1) รับค่าเช่าหลายสัญญา
-- p_rows: [{ lease_id, date, amount, received_to_asset_id?, income_period?, notes? }]
CREATE OR REPLACE FUNCTION public.batch_record_rent(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_lease uuid; v_date date; v_amount numeric; v_bank uuid; v_ccy text; v_name text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_lease  := nullif(r->>'lease_id', '')::uuid;
    v_date   := nullif(r->>'date', '')::date;
    v_amount := nullif(r->>'amount', '')::numeric;
    v_bank   := nullif(r->>'received_to_asset_id', '')::uuid;
    SELECT coalesce(nullif(concat_ws(' · ', l.unit_label, l.tenant_name), ''), 'สัญญาเช่า'), l.rent_currency INTO v_name, v_ccy
      FROM public.property_leases l WHERE l.id = v_lease AND l.deleted_at IS NULL;
    IF v_name IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบสัญญาเช่า' USING ERRCODE = '22023'; END IF;
    IF v_date IS NULL THEN RAISE EXCEPTION 'INVALID: % · กรุณาใส่วันที่รับ', v_name USING ERRCODE = '22023'; END IF;
    IF v_date > current_date THEN RAISE EXCEPTION 'INVALID: % · วันที่รับเป็นวันในอนาคตไม่ได้', v_name USING ERRCODE = '22023'; END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID: % · กรุณาใส่ยอดที่ได้รับ', v_name USING ERRCODE = '22023'; END IF;
    IF v_bank IS NOT NULL THEN SELECT a.currency INTO v_ccy FROM public.assets a WHERE a.id = v_bank; END IF;
    INSERT INTO public.income_transactions(lease_id, income_type, date, income_period, amount, currency, received_to_asset_id, notes)
    VALUES (v_lease, 'RENT', v_date, nullif(r->>'income_period', '')::date, v_amount, v_ccy, v_bank, nullif(trim(r->>'notes'), ''));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_record_rent(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_record_rent(jsonb) TO authenticated;

-- ---------------------------------------------------------------- 2) ค่าใช้จ่ายของทรัพย์สินหลายรายการ
-- p_rows: [ jsonb เดียวกับ add_expense ] · ทุกรายการต้องผูกทรัพย์สิน (related_asset_id ที่เป็นอสังหาฯ หรือ property_utility_id)
CREATE OR REPLACE FUNCTION public.batch_add_property_expenses(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF nullif(r->>'property_utility_id', '') IS NULL AND NOT EXISTS (
         SELECT 1 FROM public.property_details pd
          WHERE pd.asset_id = nullif(r->>'related_asset_id', '')::uuid AND pd.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'INVALID: % · กรุณาเลือกทรัพย์สิน', coalesce(nullif(trim(r->>'description'), ''), 'รายการ') USING ERRCODE = '22023';
    END IF;
    IF num_nonnulls(nullif(r->>'paid_from_asset_id', ''), nullif(r->>'paid_from_credit_card_id', '')) = 0 THEN
      RAISE EXCEPTION 'INVALID: % · กรุณาเลือกบัญชี / บัตรที่จ่าย', coalesce(nullif(trim(r->>'description'), ''), 'รายการ') USING ERRCODE = '22023';
    END IF;
    PERFORM public.add_expense(r);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_add_property_expenses(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_add_property_expenses(jsonb) TO authenticated;
