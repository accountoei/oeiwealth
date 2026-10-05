-- =====================================================================
-- สร้างหนี้สิน (เงินกู้) ใน Action เดียว (Core Schema Section 21 Rule: Liabilities Screen)
--   liabilities + liability_valuations (ยอดคงค้างแรก · บังคับ) + liability_ownerships
--   SECURITY INVOKER: RLS / Guard / Period Lock / Go-live Lock ทำงานตามสิทธิ์ผู้เรียก
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_liability(
  p_liability_type   text,
  p_name             text,
  p_currency         text,
  p_balance          numeric,
  p_balance_date     date,
  p_is_opening       boolean DEFAULT false,
  p_lender           text    DEFAULT NULL,
  p_original_amount  numeric DEFAULT NULL,
  p_interest_rate    numeric DEFAULT NULL,
  p_monthly_payment  numeric DEFAULT NULL,
  p_payment_due_day  integer DEFAULT NULL,
  p_start_date       date    DEFAULT NULL,
  p_due_date         date    DEFAULT NULL,
  p_linked_asset_id  uuid    DEFAULT NULL,
  p_owners           jsonb   DEFAULT '[]'::jsonb,   -- [{"person_id": "...", "percent": 100}]
  p_notes            text    DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_family uuid; v_id uuid; o jsonb;
BEGIN
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อหนี้สิน' USING ERRCODE = '22023';
  END IF;
  IF p_balance IS NULL OR p_balance_date IS NULL THEN
    RAISE EXCEPTION 'INVALID: ต้องมียอดคงค้างและวันที่ของยอดตอนสร้าง' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_family FROM public.families WHERE deleted_at IS NULL LIMIT 1;
  IF v_family IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED: ไม่พบข้อมูลครอบครัว' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.liabilities(family_id, liability_type, name, lender, currency, original_amount, interest_rate,
                                 monthly_payment, payment_due_day, start_date, due_date, linked_asset_id, notes)
  VALUES (v_family, p_liability_type, trim(p_name), nullif(trim(p_lender), ''), upper(p_currency), p_original_amount,
          p_interest_rate, p_monthly_payment, p_payment_due_day, p_start_date, p_due_date, p_linked_asset_id, p_notes)
  RETURNING id INTO v_id;

  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p_owners, '[]'::jsonb)) LOOP
    INSERT INTO public.liability_ownerships(liability_id, person_id, responsibility_percent)
    VALUES (v_id, (o->>'person_id')::uuid, (o->>'percent')::numeric);
  END LOOP;

  INSERT INTO public.liability_valuations(liability_id, valuation_date, balance, source, is_opening, notes)
  VALUES (v_id, p_balance_date, p_balance, CASE WHEN p_is_opening THEN 'OPENING' ELSE 'STATEMENT' END, p_is_opening, p_notes);
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.create_liability(text,text,text,numeric,date,boolean,text,numeric,numeric,numeric,integer,date,date,uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_liability(text,text,text,numeric,date,boolean,text,numeric,numeric,numeric,integer,date,date,uuid,jsonb,text) TO authenticated;
