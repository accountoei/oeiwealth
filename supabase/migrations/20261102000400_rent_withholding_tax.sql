-- ============================================================================
-- 20261102000400_rent_withholding_tax.sql
-- รับค่าเช่าหลายรายการ: บันทึกภาษีหัก ณ ที่จ่ายได้ (ผู้เช่านิติบุคคลหัก 5% · ตกลง 2 พ.ย. 2026)
--   income_transactions มีคอลัมน์ tax อยู่แล้ว (เงินเข้าบัญชี = amount − tax · ยอดรับของงวดนับจาก amount ก่อนหักภาษี)
--   เปลี่ยนเฉพาะ batch_record_rent: อ่าน r->>'tax' ของแถวค่าเช่า (0 ≤ ภาษี < ยอด) · แถวค่าน้ำไฟเรียกเก็บผู้เช่าไม่มีภาษี
--   ไม่แก้ / ลบข้อมูลเดิม · รันซ้ำได้
-- ============================================================================
CREATE OR REPLACE FUNCTION public.batch_record_rent(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_lease uuid; v_date date; v_amount numeric; v_tax numeric; v_bank uuid; v_ccy text; v_name text;
        c public.lease_utility_charges; v_inc uuid;
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
    IF v_bank IS NOT NULL THEN SELECT a.currency INTO v_ccy FROM public.assets a WHERE a.id = v_bank; END IF;
    IF c.id IS NULL THEN
      INSERT INTO public.income_transactions(lease_id, income_type, date, income_period, amount, tax, currency, received_to_asset_id, notes)
      VALUES (v_lease, 'RENT', v_date, nullif(r->>'income_period', '')::date, v_amount, nullif(v_tax, 0), v_ccy, v_bank, nullif(trim(r->>'notes'), ''));
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
