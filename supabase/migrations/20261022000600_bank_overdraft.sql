-- =====================================================================
-- เงินเบิกเกินบัญชี (O/D) แบบบัญชีกระแสรายวันที่ยอดติดลบได้ (เจ้าของเลือก 22 ต.ค.)
--   1) bank_accounts: ประเภทบัญชี "กระแสรายวัน" (CURRENT) + วงเงิน O/D (overdraft_limit) + ดอกเบี้ย O/D % ต่อปี (overdraft_rate)
--   2) v_bank_accounts_safe: เพิ่ม 2 คอลัมน์ (ต่อท้าย)
--   3) Net Worth: บัญชีธนาคารที่ยอดติดลบ → เป็น "หนี้สิน" (เงินกู้ · subtype OVERDRAFT · ยอดเป็นบวก) แทนสินทรัพย์ติดลบ
--        ยอด Net Worth เท่าเดิม แต่สินทรัพย์ / หนี้สินแยกถูกหมวด (Dashboard · Snapshot ปิดงวด)
--   4) ปิดเดือน: บัญชีที่มีวงเงิน O/D ติดลบได้ไม่เกินวงเงิน · เกินวงเงิน / ไม่มีวงเงิน → ปิดไม่ได้ (เหมือนเดิม)
--   ดอกเบี้ย O/D ที่ธนาคารตัด = ค่าใช้จ่าย "ดอกเบี้ยจ่าย" จากบัญชีนั้น (ใช้ระบบเดิม)
--   ไม่แก้ / ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) bank_accounts ---------------------------------------------------------------------------
ALTER TABLE public.bank_accounts DROP CONSTRAINT IF EXISTS bank_accounts_account_type_check;
ALTER TABLE public.bank_accounts ADD CONSTRAINT bank_accounts_account_type_check
  CHECK (account_type IN ('SAVING','CURRENT','FIXED','FOREIGN_CURRENCY','OTHER'));
ALTER TABLE public.bank_accounts ADD COLUMN IF NOT EXISTS overdraft_limit public.d_money;
ALTER TABLE public.bank_accounts ADD COLUMN IF NOT EXISTS overdraft_rate public.d_rate;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_overdraft_ck') THEN
    ALTER TABLE public.bank_accounts ADD CONSTRAINT bank_accounts_overdraft_ck
      CHECK ((overdraft_limit IS NULL OR overdraft_limit > 0) AND (overdraft_rate IS NULL OR overdraft_rate >= 0));
  END IF;
END $$;

-- 2) View ------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_bank_accounts_safe WITH (security_invoker = true) AS
 SELECT b.id,
    b.asset_id,
    a.name,
    a.currency,
    a.status,
    b.bank_name,
    b.account_name,
    b.account_type,
    b.account_no_last4,
        CASE
            WHEN b.account_no_last4 IS NOT NULL THEN '••••'::text || b.account_no_last4
            ELSE NULL::text
        END AS account_no_masked,
    b.interest_rate,
    b.maturity_date,
    b.branch,
    b.notes,
    a.current_value AS confirmed_balance,
    a.current_value_date AS confirmed_date,
    b.overdraft_limit,
    b.overdraft_rate
   FROM public.bank_accounts b
     JOIN public.assets a ON a.id = b.asset_id
  WHERE b.deleted_at IS NULL AND a.deleted_at IS NULL;

-- 3) Net Worth: บัญชีธนาคารติดลบ = หนี้สิน -------------------------------------------------------
DO $$
DECLARE d text;
  old_txt text := 'item_type := ''ASSET''; asset_id := a.id; liability_id := NULL; credit_card_id := NULL; lease_id := NULL;
      person_id := s.person_id; item_name := a.name; item_group := a.asset_group; item_subtype := a.asset_type;
      value := round(v_val * s.pct / 100, 4); currency := a.currency; value_date := v_date;
      is_carried_forward := v_carry; fx_rate := v_fx; base_value := round(v_val * v_fx * s.pct / 100, 4);';
  new_txt text := '-- บัญชีธนาคารยอดติดลบ (O/D) = หนี้สิน (ยอดเป็นบวก)
      item_type := CASE WHEN v_val < 0 AND private.is_bank_asset(a.id) THEN ''LIABILITY'' ELSE ''ASSET'' END;
      asset_id := a.id; liability_id := NULL; credit_card_id := NULL; lease_id := NULL;
      person_id := s.person_id;
      item_name := CASE WHEN item_type = ''LIABILITY'' THEN a.name || '' (เบิกเกินบัญชี O/D)'' ELSE a.name END;
      item_group := CASE WHEN item_type = ''LIABILITY'' THEN ''LIABILITY_LOAN'' ELSE a.asset_group END;
      item_subtype := CASE WHEN item_type = ''LIABILITY'' THEN ''OVERDRAFT'' ELSE a.asset_type END;
      value := round(CASE WHEN item_type = ''LIABILITY'' THEN -v_val ELSE v_val END * s.pct / 100, 4); currency := a.currency; value_date := v_date;
      is_carried_forward := v_carry; fx_rate := v_fx;
      base_value := round(CASE WHEN item_type = ''LIABILITY'' THEN -v_val ELSE v_val END * v_fx * s.pct / 100, 4);';
BEGIN
  old_txt := replace(old_txt, E'\r', ''); new_txt := replace(new_txt, E'\r', '');   -- วาง SQL จาก Windows (CRLF)
  d := replace(pg_get_functiondef('private.net_worth_items(uuid, date, boolean)'::regprocedure), E'\r', '');
  IF position('OVERDRAFT' IN d) > 0 THEN RETURN; END IF;                         -- รันซ้ำ
  IF (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 THEN
    RAISE EXCEPTION 'net_worth_items: ไม่พบจุดที่ต้องแก้ (บัญชีติดลบ = หนี้สิน)';
  END IF;
  EXECUTE replace(d, old_txt, new_txt);
END $$;

-- 4) ปิดเดือน: ติดลบได้ไม่เกินวงเงิน O/D --------------------------------------------------------
DO $$
DECLARE d text;
  old_txt text := '         a.name || '': ยอดสิ้นเดือนติดลบ '' || to_char(nb.v, ''FM999,999,999,990.00'') || '' '' || a.currency
                || '' · ตรวจรายการเงินออก / วันที่ / บัญชีที่เลือก (บัญชี OD ให้บันทึกเป็นหนี้สินแบบวงเงิน)'',
         ''ASSET'', a.id
    FROM public.assets a
    JOIN public.bank_accounts b ON b.asset_id = a.id AND b.deleted_at IS NULL
    CROSS JOIN LATERAL (SELECT private.bank_calculated_balance(a.id, d) AS v) nb
   WHERE a.family_id = p_family AND a.deleted_at IS NULL AND nb.v < -0.005;';
  new_txt text := '         a.name || '': ยอดสิ้นเดือนติดลบ '' || to_char(nb.v, ''FM999,999,999,990.00'') || '' '' || a.currency
                || CASE WHEN b.overdraft_limit IS NULL
                        THEN '' · ตรวจรายการเงินออก / วันที่ / บัญชีที่เลือก (บัญชีกระแสรายวันที่มี O/D ให้ใส่วงเงิน O/D ที่หน้าบัญชี)''
                        ELSE '' · เกินวงเงิน O/D '' || to_char(b.overdraft_limit, ''FM999,999,999,990.00'') || '' · ตรวจรายการเงินออก / วงเงิน'' END,
         ''ASSET'', a.id
    FROM public.assets a
    JOIN public.bank_accounts b ON b.asset_id = a.id AND b.deleted_at IS NULL
    CROSS JOIN LATERAL (SELECT private.bank_calculated_balance(a.id, d) AS v) nb
   WHERE a.family_id = p_family AND a.deleted_at IS NULL AND nb.v < -coalesce(b.overdraft_limit, 0) - 0.005;';
BEGIN
  old_txt := replace(old_txt, E'\r', ''); new_txt := replace(new_txt, E'\r', '');   -- วาง SQL จาก Windows (CRLF)
  d := replace(pg_get_functiondef('private.month_closing_issues(uuid, date)'::regprocedure), E'\r', '');
  IF position('เกินวงเงิน O/D' IN d) > 0 THEN RETURN; END IF;                     -- รันซ้ำ
  IF (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 THEN
    RAISE EXCEPTION 'month_closing_issues: ไม่พบจุดที่ต้องแก้ (วงเงิน O/D)';
  END IF;
  EXECUTE replace(d, old_txt, new_txt);
END $$;
