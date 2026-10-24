-- แท็บ "รอรับเดือนนี้" (Investments): บันทึกเงินต้นครบกำหนดพร้อมดอกเบี้ย / Coupon ในคำสั่งเดียว (ตกลง 24 ต.ค. 2026)
--   batch_record_investment_income รับ type = MATURITY เพิ่ม → เรียก record_holding_maturity เดิม
--   (เงินต้นไม่ใช่รายได้ · เงินเข้าบัญชีที่เลือก · หลักทรัพย์ปิดเป็น "ครบกำหนด") · ผิดแถวเดียว = ไม่บันทึกเลยทั้งชุด
--   ดอกเบี้ย / Coupon บันทึกก่อนเงินต้นเสมอ (หลักทรัพย์ยังไม่ปิดตอนรับงวดสุดท้าย)
--   ไม่แก้ข้อมูลเดิม · ไม่เปลี่ยนชื่อ / signature ฟังก์ชัน

CREATE OR REPLACE FUNCTION public.batch_record_investment_income(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_name text; v_type text; v_pf uuid; v_hpf uuid; v_amount numeric; v_tax numeric;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT x.e FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(e, i)
            ORDER BY (upper(coalesce(x.e->'tx'->>'type', '')) = 'MATURITY'), x.i LOOP
    SELECT h.name, h.portfolio_id INTO v_name, v_hpf FROM public.investment_holdings h WHERE h.id = nullif(r->'tx'->>'holding_id', '')::uuid;
    v_type := upper(coalesce(r->'tx'->>'type', ''));
    IF v_type NOT IN ('INTEREST','COUPON','DIVIDEND','MATURITY') THEN
      RAISE EXCEPTION 'INVALID: % · รับได้เฉพาะดอกเบี้ย / Coupon / ปันผล / เงินต้นครบกำหนด', coalesce(v_name, 'รายการ') USING ERRCODE = '22023';
    END IF;
    v_amount := coalesce(nullif(r->'tx'->>'amount', '')::numeric, 0);
    v_tax := coalesce(nullif(r->'tx'->>'tax', '')::numeric, 0);
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'INVALID: % · กรุณาใส่ยอด%', coalesce(v_name, 'รายการ'),
        CASE WHEN v_type = 'MATURITY' THEN 'เงินต้นที่ได้คืน' ELSE 'ก่อนภาษี' END USING ERRCODE = '22023';
    END IF;
    IF v_tax < 0 OR v_tax >= v_amount THEN
      RAISE EXCEPTION 'INVALID: % · ภาษีต้องน้อยกว่ายอดที่ได้รับ', coalesce(v_name, 'รายการ') USING ERRCODE = '22023';
    END IF;
    BEGIN
      IF v_type = 'MATURITY' THEN
        SELECT p.id INTO v_pf FROM public.investment_portfolios p
         WHERE p.asset_id = nullif(r->>'portfolio_asset_id', '')::uuid AND p.deleted_at IS NULL;
        IF v_hpf IS NULL OR v_pf IS DISTINCT FROM v_hpf THEN
          RAISE EXCEPTION 'INVALID: ไม่พบหลักทรัพย์นี้ในพอร์ต' USING ERRCODE = '22023';
        END IF;
        IF nullif(r->'tx'->>'date', '')::date IS NULL OR (r->'tx'->>'date')::date > current_date THEN
          RAISE EXCEPTION 'INVALID: วันที่รับต้องไม่เกินวันนี้' USING ERRCODE = '22023';
        END IF;
        PERFORM public.record_holding_maturity(
          nullif(r->'tx'->>'holding_id', '')::uuid, (r->'tx'->>'date')::date, v_amount,
          nullif(r->'tx'->>'settle_bank_asset_id', '')::uuid, NULL, NULL, nullif(v_tax, 0),
          nullif(r->'tx'->>'notes', ''), nullif(r->'tx'->>'cash_holding_id', '')::uuid);
      ELSE
        PERFORM public.record_investment_tx(nullif(r->>'portfolio_asset_id', '')::uuid, r->'tx');
      END IF;
    EXCEPTION WHEN sqlstate '22023' THEN
      -- บอกชื่อรายการที่ผิด (ข้อความเดิมต่อท้าย)
      RAISE EXCEPTION 'INVALID: % · %', coalesce(v_name, 'รายการ'), regexp_replace(SQLERRM, '^[A-Z_]+: ', '') USING ERRCODE = '22023';
    END;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_record_investment_income(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_record_investment_income(jsonb) TO authenticated;
