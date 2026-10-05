-- =====================================================================
-- สร้างบัญชีธนาคารใน Action เดียว (Core Schema Section 10 Rule: หน้า Cash & Deposits)
--   assets + bank_accounts + asset_ownerships + asset_valuations (+ เลขบัญชีเข้ารหัส)
--   SECURITY INVOKER: ใช้สิทธิ์ของผู้เรียก → RLS / Guard / Period Lock / Go-live Lock ทำงานครบ
--   ทั้งหมดอยู่ใน Transaction เดียว ถ้าขั้นใดผิด ไม่มีอะไรถูกบันทึกเลย
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_bank_account(
  p_name           text,
  p_bank_name      text,
  p_currency       text,
  p_balance        numeric,
  p_balance_date   date,
  p_is_opening     boolean DEFAULT false,
  p_account_type   text    DEFAULT 'SAVING',
  p_account_name   text    DEFAULT NULL,
  p_branch         text    DEFAULT NULL,
  p_interest_rate  numeric DEFAULT NULL,
  p_maturity_date  date    DEFAULT NULL,
  p_owners         jsonb   DEFAULT '[]'::jsonb,   -- [{"person_id": "...", "percent": 60}, ...]
  p_account_no     text    DEFAULT NULL,
  p_notes          text    DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_family uuid; v_asset uuid; v_bank uuid; o jsonb;
BEGIN
  IF length(trim(coalesce(p_name, ''))) = 0 OR length(trim(coalesce(p_bank_name, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อบัญชีและธนาคาร' USING ERRCODE = '22023';
  END IF;
  IF p_balance IS NULL OR p_balance_date IS NULL THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดคงเหลือและวันที่ของยอด' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_family FROM public.families WHERE deleted_at IS NULL LIMIT 1;
  IF v_family IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED: ไม่พบข้อมูลครอบครัว' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency, notes)
  VALUES (v_family, 'FINANCIAL', 'BANK_ACCOUNT', trim(p_name), upper(p_currency), p_notes)
  RETURNING id INTO v_asset;

  INSERT INTO public.bank_accounts(asset_id, bank_name, account_name, account_type, branch, interest_rate, maturity_date)
  VALUES (v_asset, trim(p_bank_name), nullif(trim(p_account_name), ''), p_account_type, nullif(trim(p_branch), ''),
          p_interest_rate, p_maturity_date)
  RETURNING id INTO v_bank;

  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p_owners, '[]'::jsonb)) LOOP
    INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
    VALUES (v_asset, (o->>'person_id')::uuid, (o->>'percent')::numeric, p_balance_date);
  END LOOP;

  INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening, notes)
  VALUES (v_asset, p_balance_date, p_balance, 'STATEMENT',
          CASE WHEN p_is_opening THEN 'OPENING' ELSE 'ACCOUNT_SETUP' END, p_is_opening, p_notes);

  IF length(trim(coalesce(p_account_no, ''))) > 0 THEN
    PERFORM public.set_bank_account_no(v_bank, p_account_no);
  END IF;
  RETURN v_asset;
END $$;

REVOKE ALL ON FUNCTION public.create_bank_account(text,text,text,numeric,date,boolean,text,text,text,numeric,date,jsonb,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_bank_account(text,text,text,numeric,date,boolean,text,text,text,numeric,date,jsonb,text,text) TO authenticated;
