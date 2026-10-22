-- =====================================================================
-- Private Business: แท็บ "บันทึกปันผล / มูลค่า" ในหน้ารวม (หลายกิจการพร้อมกัน)
--   1) batch_record_business_dividends — ปันผลแยกตามผู้ถือหุ้น: 1 แถว = ผู้ถือหุ้น 1 คน → เข้าบัญชีของคนนั้น · รายได้เป็นของคนนั้น 100%
--   2) batch_record_business_values   — มูลค่าใหม่ของหลายกิจการ (asset_valuations · trigger เดิมอัปเดตมูลค่าปัจจุบัน)
--   ทั้งชุดเป็น transaction เดียว: รายการไหนผิด = ไม่บันทึกเลยสักรายการ
--   SECURITY INVOKER → สิทธิ์ (RLS) + กติกาเดิมทุกข้อ (ปิดงวด / Go-live / Derived Movement) ทำงานเหมือนบันทึกทีละรายการ
--   ไม่แก้ / ลบข้อมูลเดิม · เพิ่มฟังก์ชันใหม่ 2 ตัว · รันซ้ำได้
-- =====================================================================

-- ---------------------------------------------------------------- 1) ปันผลแยกตามผู้ถือหุ้น
-- p_rows: [{ asset_id, person_id, date, amount (ก่อนภาษี), tax?, bank_asset_id?, notes? }]
CREATE OR REPLACE FUNCTION public.batch_record_business_dividends(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_asset uuid; v_person uuid; v_date date; v_amount numeric; v_tax numeric; v_bank uuid;
  v_ccy text; v_name text; v_who text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_asset  := nullif(r->>'asset_id', '')::uuid;
    v_person := nullif(r->>'person_id', '')::uuid;
    v_date   := nullif(r->>'date', '')::date;
    v_amount := nullif(r->>'amount', '')::numeric;
    v_tax    := coalesce(nullif(r->>'tax', '')::numeric, 0);
    v_bank   := nullif(r->>'bank_asset_id', '')::uuid;
    v_name := NULL; v_ccy := NULL; v_who := NULL;
    SELECT a.name, a.currency INTO v_name, v_ccy FROM public.assets a
     WHERE a.id = v_asset AND a.asset_type = 'PRIVATE_BUSINESS' AND a.deleted_at IS NULL;
    IF v_name IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบกิจการ' USING ERRCODE = '22023'; END IF;
    SELECT p.name INTO v_who FROM public.persons p WHERE p.id = v_person AND p.deleted_at IS NULL;
    IF v_who IS NULL THEN RAISE EXCEPTION 'INVALID: % · กรุณาเลือกผู้ถือหุ้น', v_name USING ERRCODE = '22023'; END IF;
    v_name := v_name || ' · ' || v_who;
    IF v_date IS NULL THEN RAISE EXCEPTION 'INVALID: % · กรุณาใส่วันที่รับ', v_name USING ERRCODE = '22023'; END IF;
    IF v_date > current_date THEN RAISE EXCEPTION 'INVALID: % · วันที่รับเป็นวันในอนาคตไม่ได้', v_name USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.asset_ownerships o
                    WHERE o.asset_id = v_asset AND o.person_id = v_person AND o.deleted_at IS NULL
                      AND o.start_date <= v_date AND (o.end_date IS NULL OR o.end_date >= v_date)) THEN
      RAISE EXCEPTION 'INVALID: % · ไม่ได้ถือหุ้น ณ วันที่ %', v_name, v_date USING ERRCODE = '22023';
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID: % · กรุณาใส่ปันผลก่อนภาษี', v_name USING ERRCODE = '22023'; END IF;
    IF v_tax < 0 OR v_tax >= v_amount THEN RAISE EXCEPTION 'INVALID: % · ภาษีต้องน้อยกว่าปันผล', v_name USING ERRCODE = '22023'; END IF;
    IF v_bank IS NOT NULL THEN
      IF NOT private.is_bank_asset(v_bank) THEN RAISE EXCEPTION 'INVALID: % · บัญชีที่รับต้องเป็นบัญชีธนาคาร', v_name USING ERRCODE = '22023'; END IF;
      SELECT a.currency INTO v_ccy FROM public.assets a WHERE a.id = v_bank;
    END IF;
    INSERT INTO public.income_transactions(asset_id, person_id, income_type, date, amount, tax, currency, received_to_asset_id, notes)
    VALUES (v_asset, v_person, 'BUSINESS_DIVIDEND', v_date, v_amount, nullif(v_tax, 0), v_ccy, v_bank, nullif(trim(r->>'notes'), ''));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_record_business_dividends(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_record_business_dividends(jsonb) TO authenticated;

-- ---------------------------------------------------------------- 2) มูลค่าใหม่หลายกิจการ
-- p_rows: [{ asset_id, date, value, method? (USER_ESTIMATE / APPRAISAL / LATEST_TRANSACTION · ตั้งต้น USER_ESTIMATE), notes? }]
CREATE OR REPLACE FUNCTION public.batch_record_business_values(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_asset uuid; v_date date; v_value numeric; v_method text; v_name text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_asset  := nullif(r->>'asset_id', '')::uuid;
    v_date   := nullif(r->>'date', '')::date;
    v_value  := nullif(r->>'value', '')::numeric;
    v_method := coalesce(nullif(r->>'method', ''), 'USER_ESTIMATE');
    v_name := NULL;
    SELECT a.name INTO v_name FROM public.assets a
     WHERE a.id = v_asset AND a.asset_type = 'PRIVATE_BUSINESS' AND a.deleted_at IS NULL;
    IF v_name IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบกิจการ' USING ERRCODE = '22023'; END IF;
    IF v_date IS NULL THEN RAISE EXCEPTION 'INVALID: % · กรุณาใส่วันที่ประเมิน', v_name USING ERRCODE = '22023'; END IF;
    IF v_date > current_date THEN RAISE EXCEPTION 'INVALID: % · วันที่ประเมินเป็นวันในอนาคตไม่ได้', v_name USING ERRCODE = '22023'; END IF;
    IF v_value IS NULL OR v_value < 0 THEN RAISE EXCEPTION 'INVALID: % · กรุณาใส่มูลค่า', v_name USING ERRCODE = '22023'; END IF;
    IF v_method NOT IN ('USER_ESTIMATE','APPRAISAL','LATEST_TRANSACTION') THEN
      RAISE EXCEPTION 'INVALID: % · วิธีประเมินไม่ถูกต้อง', v_name USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
    VALUES (v_asset, v_date, v_value, v_method, CASE WHEN v_method = 'APPRAISAL' THEN 'APPRAISAL' ELSE 'USER' END, nullif(trim(r->>'notes'), ''));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_record_business_values(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_record_business_values(jsonb) TO authenticated;
