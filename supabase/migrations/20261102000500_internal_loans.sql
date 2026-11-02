-- =====================================================================
-- เงินกู้ภายในครอบครัว (ตกลง 2 พ.ย. 2026)
--   ผู้กู้ของเงินให้กู้เป็น "บุคคลภายนอก" (เดิม) / "สมาชิก" / "กิจการ (Private Business)" ได้
--   1) loan_details.borrower_person_id: ผู้กู้เป็นสมาชิก → Net Worth นับหนี้สินให้ผู้กู้ = เงินต้นคงเหลือของสัญญา
--      (ผู้ให้กู้ยังนับลูกหนี้ตามเดิม · ยอดรวมครอบครัวหักกันเป็น 0) · ผู้กู้ต้องไม่ใช่ผู้ให้กู้ของสัญญาเดียวกัน
--   2) loan_details.borrower_business_id: ผู้กู้เป็นกิจการ → ไม่ตั้งรายการฝั่งกิจการ (มูลค่ากิจการ = ส่วนของผู้ถือหุ้น รวมหนี้ไว้แล้ว)
--      ใช้ชื่อ / ที่อยู่กิจการในสัญญา และแสดงในหน้ากิจการ (อ้างอิง)
--   3) liabilities.lender_business_id: สมาชิกกู้จากกิจการ → หนี้สินของสมาชิก (หน้า Liabilities เดิม) ระบุกิจการที่ให้กู้
--      ฝั่งกิจการไม่ตั้งรายการแยก (เหตุผลเดียวกับข้อ 2)
--   รันซ้ำได้
-- =====================================================================

ALTER TABLE public.loan_details
  ADD COLUMN IF NOT EXISTS borrower_person_id   uuid REFERENCES public.persons(id),
  ADD COLUMN IF NOT EXISTS borrower_business_id uuid REFERENCES public.assets(id);
ALTER TABLE public.loan_details DROP CONSTRAINT IF EXISTS loan_details_borrower_kind;
ALTER TABLE public.loan_details ADD CONSTRAINT loan_details_borrower_kind
  CHECK (borrower_person_id IS NULL OR borrower_business_id IS NULL);
ALTER TABLE public.liabilities ADD COLUMN IF NOT EXISTS lender_business_id uuid REFERENCES public.assets(id);

CREATE OR REPLACE FUNCTION private.tg_internal_loan_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'loan_details' THEN
    IF NEW.borrower_business_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.private_business_details b WHERE b.asset_id = NEW.borrower_business_id AND b.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'INVALID: ผู้กู้ต้องเป็นกิจการ (Private Business)' USING ERRCODE = '22023';
    END IF;
    IF NEW.borrower_person_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = NEW.borrower_person_id AND p.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'INVALID: ไม่พบสมาชิกที่เป็นผู้กู้' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.asset_ownerships o WHERE o.asset_id = NEW.asset_id AND o.person_id = NEW.borrower_person_id
                    AND o.deleted_at IS NULL AND o.end_date IS NULL) THEN
        RAISE EXCEPTION 'INVALID: ผู้กู้เป็นผู้ให้กู้ของสัญญาเดียวกันไม่ได้' USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSE
    IF NEW.lender_business_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.private_business_details b WHERE b.asset_id = NEW.lender_business_id AND b.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'INVALID: ผู้ให้กู้ต้องเป็นกิจการ (Private Business)' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.tg_internal_loan_check() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t57_internal_loan ON public.loan_details;
CREATE TRIGGER t57_internal_loan BEFORE INSERT OR UPDATE OF borrower_person_id, borrower_business_id ON public.loan_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_internal_loan_check();
DROP TRIGGER IF EXISTS t57_internal_loan ON public.liabilities;
CREATE TRIGGER t57_internal_loan BEFORE INSERT OR UPDATE OF lender_business_id ON public.liabilities
  FOR EACH ROW EXECUTE FUNCTION private.tg_internal_loan_check();

-- ผู้กู้เป็นผู้ให้กู้ของสัญญาเดียวกันไม่ได้ (ตรวจตอนแก้เจ้าของด้วย)
CREATE OR REPLACE FUNCTION private.tg_internal_loan_owner_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND NEW.end_date IS NULL AND EXISTS (
       SELECT 1 FROM public.loan_details d WHERE d.asset_id = NEW.asset_id AND d.deleted_at IS NULL AND d.borrower_person_id = NEW.person_id) THEN
    RAISE EXCEPTION 'INVALID: ผู้กู้เป็นผู้ให้กู้ของสัญญาเดียวกันไม่ได้' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.tg_internal_loan_owner_check() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t57_internal_loan ON public.asset_ownerships;
CREATE TRIGGER t57_internal_loan BEFORE INSERT OR UPDATE ON public.asset_ownerships
  FOR EACH ROW EXECUTE FUNCTION private.tg_internal_loan_owner_check();

-- Net Worth Engine: เพิ่มส่วน F (หนี้สินของสมาชิกที่เป็นผู้กู้) · ส่วนอื่นเหมือนเดิมทุกตัวอักษร
CREATE OR REPLACE FUNCTION private.net_worth_items(p_family uuid, p_date date, p_confirmed boolean)
 RETURNS TABLE(item_type text, asset_id uuid, liability_id uuid, credit_card_id uuid, lease_id uuid, person_id uuid, item_name text, item_group text, item_subtype text, value numeric, currency text, value_date date, is_carried_forward boolean, fx_rate numeric, base_value numeric, ownership_percent numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  m0 date := date_trunc('month', p_date)::date;
  v_hist boolean := p_date < current_date;                                  -- ปิดงวดย้อนหลัง → ใช้สถานะ ณ สิ้นวัน p_date
  v_at timestamptz := ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok');
  st jsonb; v_bal numeric; v_bdate date;
  a record; v public.asset_valuations; s record; r record;
  v_val numeric; v_thb numeric; v_date date; v_fx numeric; v_carry boolean; v_ccy text;
  v_pf uuid; v_multi boolean; lv public.liability_valuations;
BEGIN
  IF NOT private.can_read() THEN RETURN; END IF;
  -- A) สินทรัพย์ทั่วไป + บัญชีธนาคาร + เงินให้กู้ ----------------------
  FOR a IN SELECT x.* FROM public.assets x
            WHERE x.family_id = p_family AND x.deleted_at IS NULL
              AND x.asset_type <> 'INVESTMENT_PORTFOLIO'
  LOOP
    st := CASE WHEN v_hist THEN private.row_state_at('assets', a.id, to_jsonb(a), v_at) ELSE to_jsonb(a) END;
    CONTINUE WHEN st IS NULL OR st ->> 'status' <> 'ACTIVE';
    -- ขายแล้วตามวันที่ของ ASSET_SALE (กรณีบันทึกสถานะย้อนหลัง)
    CONTINUE WHEN a.status <> 'ACTIVE' AND EXISTS (SELECT 1 FROM public.cash_movements m WHERE m.from_asset_id = a.id
                    AND m.movement_type = 'ASSET_SALE' AND m.deleted_at IS NULL AND m.movement_date <= p_date);
    v_val := NULL; v_date := NULL; v_carry := false;
    IF a.asset_type = 'LOAN_RECEIVABLE' THEN
      v_val := private.loan_outstanding_at(a.id, p_date); v_date := p_date;
    ELSIF private.is_bank_asset(a.id) THEN
      IF p_confirmed THEN
        SELECT bv.* INTO v FROM public.bank_reconciliations br
          JOIN public.asset_valuations bv ON bv.id = br.closing_valuation_id
         WHERE br.bank_asset_id = a.id AND br.year_month = m0 AND br.deleted_at IS NULL AND br.status <> 'OPEN';
        IF v.id IS NULL THEN
          v := private.latest_asset_valuation(a.id, p_date);
          -- ไม่ได้อัปเดตยอดสิ้นเดือน → ยอดตามระบบ (ยอดล่าสุด + เงินเข้า − เงินออก ถึงวันนั้น)
          IF v.id IS NOT NULL AND v.valuation_date < p_date THEN v.value := private.bank_calculated_balance(a.id, p_date); END IF;
        END IF;
        v_val := v.value; v_date := v.valuation_date; v_carry := v.valuation_date < m0;
      ELSE
        v := private.latest_asset_valuation(a.id, p_date);
        v_val := private.bank_calculated_balance(a.id, p_date);
        v_date := CASE WHEN v.id IS NULL THEN NULL ELSE p_date END;
      END IF;
    ELSE
      v := private.latest_asset_valuation(a.id, p_date);
      v_val := v.value; v_date := v.valuation_date; v_carry := v.valuation_date < m0;
    END IF;
    CONTINUE WHEN v_val IS NULL OR v_val = 0;
    v_fx := private.fx_rate(a.currency, p_date);
    FOR s IN SELECT * FROM private.asset_owner_shares(a.id, p_date) LOOP
      -- บัญชีธนาคารยอดติดลบ (O/D) = หนี้สิน (ยอดเป็นบวก)
      item_type := CASE WHEN v_val < 0 AND private.is_bank_asset(a.id) THEN 'LIABILITY' ELSE 'ASSET' END;
      asset_id := a.id; liability_id := NULL; credit_card_id := NULL; lease_id := NULL;
      person_id := s.person_id;
      item_name := CASE WHEN item_type = 'LIABILITY' THEN a.name || ' (เบิกเกินบัญชี O/D)' ELSE a.name END;
      item_group := CASE WHEN item_type = 'LIABILITY' THEN 'LIABILITY_LOAN' ELSE a.asset_group END;
      item_subtype := CASE WHEN item_type = 'LIABILITY' THEN 'OVERDRAFT' ELSE a.asset_type END;
      value := round(CASE WHEN item_type = 'LIABILITY' THEN -v_val ELSE v_val END * s.pct / 100, 4); currency := a.currency; value_date := v_date;
      is_carried_forward := v_carry; fx_rate := v_fx;
      base_value := round(CASE WHEN item_type = 'LIABILITY' THEN -v_val ELSE v_val END * v_fx * s.pct / 100, 4);
      ownership_percent := s.pct;
      RETURN NEXT;
    END LOOP;
  END LOOP;

  -- B) Portfolio: SUM Holding (THB = SUM base_value) + In-transit + Unsettled -----
  FOR a IN SELECT x.*, p.id AS portfolio_id FROM public.assets x
             JOIN public.investment_portfolios p ON p.asset_id = x.id AND p.deleted_at IS NULL
            WHERE x.family_id = p_family AND x.deleted_at IS NULL
  LOOP
    st := CASE WHEN v_hist THEN private.row_state_at('assets', a.id, to_jsonb(a) - 'portfolio_id', v_at) ELSE to_jsonb(a) END;
    CONTINUE WHEN st IS NULL OR st ->> 'status' <> 'ACTIVE';
    SELECT sum(CASE WHEN h.currency = a.currency THEN hv.value
                    ELSE hv.value * private.fx_rate(h.currency, p_date) / private.fx_rate(a.currency, p_date) END),
           sum(hv.value_thb), max(hv.value_date), bool_or(h.currency <> a.currency),
           bool_or(hv.value <> 0 AND hv.value_date < m0)          -- ราคาทุน (ไม่มี Statement) ไม่ใช่ Carry Forward
      INTO v_val, v_thb, v_date, v_multi, v_carry
      FROM public.investment_holdings h
      CROSS JOIN LATERAL private.holding_value_at(h.id, p_date) hv
     WHERE h.portfolio_id = a.portfolio_id AND h.deleted_at IS NULL;
    IF coalesce(v_thb, 0) <> 0 OR coalesce(v_val, 0) <> 0 THEN
      v_fx := CASE WHEN v_multi THEN NULL ELSE private.fx_rate(a.currency, p_date) END;
      FOR s IN SELECT * FROM private.asset_owner_shares(a.id, p_date) LOOP
        item_type := 'ASSET'; asset_id := a.id; liability_id := NULL; credit_card_id := NULL; lease_id := NULL;
        person_id := s.person_id; item_name := a.name; item_group := 'INVESTMENT'; item_subtype := 'INVESTMENT_PORTFOLIO';
        value := round(v_val * s.pct / 100, 4); currency := a.currency; value_date := coalesce(v_date, p_date);
        is_carried_forward := coalesce(v_carry, false); fx_rate := v_fx;
        base_value := round(v_thb * s.pct / 100, 4); ownership_percent := s.pct;
        RETURN NEXT;
      END LOOP;
    END IF;

    -- In-transit (รอ Statement)
    v_val := private.portfolio_in_transit(a.portfolio_id, p_date);
    IF v_val <> 0 THEN
      v_fx := private.fx_rate(a.currency, p_date);
      FOR s IN SELECT * FROM private.asset_owner_shares(a.id, p_date) LOOP
        item_type := 'ASSET'; asset_id := a.id; liability_id := NULL; credit_card_id := NULL; lease_id := NULL;
        person_id := s.person_id; item_name := a.name || ' · เงินระหว่างทาง (รอ Statement)';
        item_group := 'INVESTMENT'; item_subtype := 'IN_TRANSIT';
        value := round(v_val * s.pct / 100, 4); currency := a.currency; value_date := p_date;
        is_carried_forward := false; fx_rate := v_fx; base_value := round(v_val * v_fx * s.pct / 100, 4);
        ownership_percent := s.pct;
        RETURN NEXT;
      END LOOP;
    END IF;

    -- Unsettled (Trade แล้ว ยังไม่ Settle กับบัญชีธนาคาร)
    FOR r IN SELECT CASE WHEN t.transaction_type = 'BUY' THEN 'UNSETTLED_PAYABLE' ELSE 'UNSETTLED_RECEIVABLE' END AS subtype,
                    t.currency AS ccy,
                    sum(CASE WHEN t.transaction_type = 'BUY' THEN -(t.amount + coalesce(t.fee,0))
                             ELSE t.amount - coalesce(t.fee,0) - coalesce(t.tax,0) END) AS amt
               FROM public.investment_transactions t
              WHERE t.portfolio_id = a.portfolio_id AND t.deleted_at IS NULL
                AND t.transaction_type IN ('BUY','SELL','REDEMPTION','MATURITY')
                AND (t.settle_from_asset_id IS NOT NULL OR t.settle_to_asset_id IS NOT NULL)
                AND t.transaction_date <= p_date AND t.settlement_date > p_date
              GROUP BY 1, 2
    LOOP
      v_fx := private.fx_rate(r.ccy, p_date);
      FOR s IN SELECT * FROM private.asset_owner_shares(a.id, p_date) LOOP
        item_type := 'ASSET'; asset_id := a.id; liability_id := NULL; credit_card_id := NULL; lease_id := NULL;
        person_id := s.person_id;
        item_name := a.name || CASE WHEN r.subtype = 'UNSETTLED_PAYABLE' THEN ' · รอจ่ายชำระ' ELSE ' · รอรับชำระ' END;
        item_group := 'INVESTMENT'; item_subtype := r.subtype;
        value := round(r.amt * s.pct / 100, 4); currency := r.ccy; value_date := p_date;
        is_carried_forward := false; fx_rate := v_fx; base_value := round(r.amt * v_fx * s.pct / 100, 4);
        ownership_percent := s.pct;
        RETURN NEXT;
      END LOOP;
    END LOOP;
  END LOOP;

  -- C) หนี้สิน (liabilities) ------------------------------------------------
  FOR a IN SELECT l.* FROM public.liabilities l
            WHERE l.family_id = p_family AND l.deleted_at IS NULL
  LOOP
    st := CASE WHEN v_hist THEN private.row_state_at('liabilities', a.id, to_jsonb(a), v_at) ELSE to_jsonb(a) END;
    CONTINUE WHEN st IS NULL OR st ->> 'status' <> 'ACTIVE';
    SELECT * INTO lv FROM public.liability_valuations x
     WHERE x.liability_id = a.id AND x.deleted_at IS NULL AND x.valuation_date <= p_date
     ORDER BY x.valuation_date DESC, x.created_at DESC LIMIT 1;
    IF lv.id IS NOT NULL THEN   -- หักเงินต้นที่จ่ายหลังวันที่ของยอดนี้
      lv.balance := greatest(lv.balance - private.liability_principal_paid(a.id, lv.valuation_date, p_date), 0);
    END IF;
    CONTINUE WHEN lv.id IS NULL OR lv.balance = 0;
    v_fx := private.fx_rate(a.currency, p_date);
    FOR s IN SELECT * FROM private.liability_owner_shares(a.id) LOOP
      item_type := 'LIABILITY'; asset_id := NULL; liability_id := a.id; credit_card_id := NULL; lease_id := NULL;
      person_id := s.person_id; item_name := a.name; item_group := 'LIABILITY_LOAN'; item_subtype := a.liability_type;
      value := round(lv.balance * s.pct / 100, 4); currency := a.currency; value_date := lv.valuation_date;
      is_carried_forward := lv.valuation_date < m0; fx_rate := v_fx;
      base_value := round(lv.balance * v_fx * s.pct / 100, 4); ownership_percent := s.pct;
      RETURN NEXT;
    END LOOP;
  END LOOP;

  -- D) บัตรเครดิต (Owner 100%) — ยอดที่ balance_date ล่าสุด ≤ p_date (จากประวัติใน Audit)
  --    FX = Previous Available Rate ของ balance_date (Section 34 Credit Card Mapping)
  FOR a IN SELECT c.* FROM public.credit_cards c JOIN public.persons p ON p.id = c.person_id
            WHERE p.family_id = p_family AND c.deleted_at IS NULL
  LOOP
    IF v_hist THEN
      SELECT cb.balance, cb.balance_date INTO v_bal, v_bdate FROM private.card_balance_at(a.id, p_date) cb;
    ELSE
      v_bal := a.outstanding_balance; v_bdate := a.balance_date;
    END IF;
    IF v_bdate IS NOT NULL AND v_bdate <= p_date THEN   -- บวกรายการบัตรหลังวันที่ของยอด
      v_bal := greatest(coalesce(v_bal, 0) + private.card_activity(a.id, v_bdate, p_date), 0);
    END IF;
    CONTINUE WHEN coalesce(v_bal, 0) <= 0 OR v_bdate IS NULL OR v_bdate > p_date;   -- ไม่รู้ยอด ณ วันนั้น → Closing Check
    v_fx := private.fx_rate(a.currency, v_bdate);
    item_type := 'LIABILITY'; asset_id := NULL; liability_id := NULL; credit_card_id := a.id; lease_id := NULL;
    person_id := a.person_id; item_name := concat_ws(' ', a.issuer, a.card_name, '••' || a.card_last4);
    item_group := 'LIABILITY_CARD'; item_subtype := 'CREDIT_CARD';
    value := v_bal; currency := a.currency; value_date := v_bdate;
    is_carried_forward := v_bdate < m0; fx_rate := v_fx;
    base_value := round(v_bal * v_fx, 4); ownership_percent := 100;
    RETURN NEXT;
  END LOOP;

  -- E) เงินประกันการเช่า (หนี้ของเจ้าของ Property) -----------------------------
  FOR a IN SELECT l.*, pd.asset_id AS prop_asset, pa.name AS prop_name
             FROM public.property_leases l
             JOIN public.property_details pd ON pd.id = l.property_id
             JOIN public.assets pa ON pa.id = pd.asset_id
            WHERE pa.family_id = p_family AND l.deleted_at IS NULL AND pd.deleted_at IS NULL AND pa.deleted_at IS NULL
              AND coalesce(l.security_deposit, 0) > 0
              AND coalesce(l.deposit_received_date, l.start_date) <= p_date
              AND (l.deposit_settled_date IS NULL OR l.deposit_settled_date > p_date)
  LOOP
    v_fx := private.fx_rate(a.deposit_currency, p_date);
    FOR s IN SELECT * FROM private.asset_owner_shares(a.prop_asset, p_date) LOOP
      item_type := 'LIABILITY'; asset_id := NULL; liability_id := NULL; credit_card_id := NULL; lease_id := a.id;
      person_id := s.person_id; item_name := concat_ws(' · ', a.prop_name, a.unit_label, a.tenant_name);
      item_group := 'LIABILITY_DEPOSIT'; item_subtype := 'SECURITY_DEPOSIT';
      value := round(a.security_deposit * s.pct / 100, 4); currency := a.deposit_currency; value_date := p_date;
      is_carried_forward := false; fx_rate := v_fx;
      base_value := round(a.security_deposit * v_fx * s.pct / 100, 4); ownership_percent := s.pct;
      RETURN NEXT;
    END LOOP;
  END LOOP;
  -- F) เงินกู้ภายในครอบครัว: ผู้กู้เป็นสมาชิก → หนี้สินของผู้กู้ (100%) = เงินต้นคงเหลือของสัญญา (ตกลง 2 พ.ย. 2026)
  --    ฝั่งผู้ให้กู้ยังเป็นสินทรัพย์ตามเจ้าของ (ส่วน A) → ยอดรวมครอบครัวหักกันเป็น 0 · ยอดรายคนถูกต้อง
  FOR a IN SELECT x.*, d.borrower_person_id AS bp FROM public.assets x
             JOIN public.loan_details d ON d.asset_id = x.id AND d.deleted_at IS NULL
            WHERE x.family_id = p_family AND x.deleted_at IS NULL AND d.borrower_person_id IS NOT NULL
  LOOP
    st := CASE WHEN v_hist THEN private.row_state_at('assets', a.id, to_jsonb(a) - 'bp', v_at) ELSE to_jsonb(a) - 'bp' END;
    CONTINUE WHEN st IS NULL OR st ->> 'status' <> 'ACTIVE';
    v_val := private.loan_outstanding_at(a.id, p_date);
    CONTINUE WHEN v_val IS NULL OR v_val = 0;
    v_fx := private.fx_rate(a.currency, p_date);
    item_type := 'LIABILITY'; asset_id := a.id; liability_id := NULL; credit_card_id := NULL; lease_id := NULL;
    person_id := a.bp; item_name := 'เงินกู้ภายในครอบครัว · ' || a.name;
    item_group := 'LIABILITY_LOAN'; item_subtype := 'INTERNAL_LOAN';
    value := v_val; currency := a.currency; value_date := p_date;
    is_carried_forward := false; fx_rate := v_fx; base_value := round(v_val * v_fx, 4); ownership_percent := 100;
    RETURN NEXT;
  END LOOP;
END $function$;
