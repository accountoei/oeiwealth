-- =====================================================================
-- รับดอกเบี้ยหลายรายการพร้อมกัน (เหมือนรับค่าเช่า)
--   1) batch_record_bank_interest — หน้า Cash & Bank แท็บ "รับดอกเบี้ย": รายได้ "ดอกเบี้ย" เข้าบัญชีธนาคารหลายบัญชี
--   2) batch_record_investment_income — หน้า Investments แท็บ "รอรับเดือนนี้": ดอกเบี้ย / Coupon ของหลักทรัพย์ + ดอกเบี้ยเงินฝากในพอร์ต
--   ทั้งชุดเป็น transaction เดียว: รายการไหนผิด = ไม่บันทึกเลยสักรายการ
--   SECURITY INVOKER → สิทธิ์ (RLS) + กติกาเดิมทุกข้อ (ปิดงวด / Go-live / Derived Movement / ก้อนรอแยก) ทำงานเหมือนบันทึกทีละรายการ
--   ก้อน "รอแยกรายละเอียด" ของบัญชีที่อัปเดตยอดไปแล้ว → ลดลงเองตามดอกเบี้ยที่บันทึก (trigger เดิมของ cash_movements) · ไม่นับซ้ำ
--   ไม่แก้ / ลบข้อมูลเดิม · เพิ่มฟังก์ชันใหม่ 2 ตัว · รันซ้ำได้
-- =====================================================================

-- ---------------------------------------------------------------- 1) ดอกเบี้ยบัญชีธนาคาร
-- p_rows: [{ bank_asset_id, date, amount (ก่อนภาษี), tax?, notes? }]
CREATE OR REPLACE FUNCTION public.batch_record_bank_interest(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_bank uuid; v_date date; v_amount numeric; v_tax numeric; v_ccy text; v_name text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_bank   := nullif(r->>'bank_asset_id', '')::uuid;
    v_date   := nullif(r->>'date', '')::date;
    v_amount := nullif(r->>'amount', '')::numeric;
    v_tax    := coalesce(nullif(r->>'tax', '')::numeric, 0);
    v_name := NULL; v_ccy := NULL;
    SELECT a.name, a.currency INTO v_name, v_ccy FROM public.assets a WHERE a.id = v_bank AND a.deleted_at IS NULL;
    IF v_name IS NULL OR NOT private.is_bank_asset(v_bank) THEN
      RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัญชีธนาคาร' USING ERRCODE = '22023';
    END IF;
    IF v_date IS NULL THEN RAISE EXCEPTION 'INVALID: % · กรุณาใส่วันที่รับ', v_name USING ERRCODE = '22023'; END IF;
    IF v_date > current_date THEN RAISE EXCEPTION 'INVALID: % · วันที่รับเป็นวันในอนาคตไม่ได้', v_name USING ERRCODE = '22023'; END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID: % · กรุณาใส่ดอกเบี้ยก่อนภาษี', v_name USING ERRCODE = '22023'; END IF;
    IF v_tax < 0 OR v_tax >= v_amount THEN
      RAISE EXCEPTION 'INVALID: % · ภาษีต้องน้อยกว่าดอกเบี้ย', v_name USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.income_transactions(income_type, date, amount, tax, currency, received_to_asset_id, notes)
    VALUES ('INTEREST', v_date, v_amount, nullif(v_tax, 0), v_ccy, v_bank, nullif(trim(r->>'notes'), ''));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_record_bank_interest(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_record_bank_interest(jsonb) TO authenticated;

-- ---------------------------------------------------------------- 2) ดอกเบี้ย / Coupon ในพอร์ตลงทุน
-- p_rows: [{ portfolio_asset_id, tx: jsonb เดียวกับ record_investment_tx }] · รับเฉพาะ INTEREST / COUPON / DIVIDEND
CREATE OR REPLACE FUNCTION public.batch_record_investment_income(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_name text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    SELECT h.name INTO v_name FROM public.investment_holdings h WHERE h.id = nullif(r->'tx'->>'holding_id', '')::uuid;
    IF upper(coalesce(r->'tx'->>'type', '')) NOT IN ('INTEREST','COUPON','DIVIDEND') THEN
      RAISE EXCEPTION 'INVALID: % · รับได้เฉพาะดอกเบี้ย / Coupon / ปันผล', coalesce(v_name, 'รายการ') USING ERRCODE = '22023';
    END IF;
    IF coalesce(nullif(r->'tx'->>'amount', '')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'INVALID: % · กรุณาใส่ยอดก่อนภาษี', coalesce(v_name, 'รายการ') USING ERRCODE = '22023';
    END IF;
    IF coalesce(nullif(r->'tx'->>'tax', '')::numeric, 0) < 0
       OR coalesce(nullif(r->'tx'->>'tax', '')::numeric, 0) >= (r->'tx'->>'amount')::numeric THEN
      RAISE EXCEPTION 'INVALID: % · ภาษีต้องน้อยกว่ายอดที่ได้รับ', coalesce(v_name, 'รายการ') USING ERRCODE = '22023';
    END IF;
    BEGIN
      PERFORM public.record_investment_tx(nullif(r->>'portfolio_asset_id', '')::uuid, r->'tx');
    EXCEPTION WHEN sqlstate '22023' THEN
      -- บอกชื่อรายการที่ผิด (ข้อความเดิมของ record_investment_tx ต่อท้าย)
      RAISE EXCEPTION 'INVALID: % · %', coalesce(v_name, 'รายการ'), regexp_replace(SQLERRM, '^[A-Z_]+: ', '') USING ERRCODE = '22023';
    END;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_record_investment_income(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_record_investment_income(jsonb) TO authenticated;
