-- =====================================================================
-- ก้อน "รอแยกรายละเอียด" ของบัญชีเงินฝากในพอร์ตลงทุน (owner, 12 พ.ย. 2026)
--   อัปเดตยอดเงินฝากในพอร์ตตาม Statement แล้วไม่ตรงกับที่คำนวณจากรายการ → ระบบสร้างก้อนให้เอง (เหมือนบัญชีธนาคาร / บัตร)
--     ยอดจริงสูงกว่า → รายได้รอแยก · ต่ำกว่า → ค่าใช้จ่ายรอแยก
--     บัญชีละ 1 ก้อนต่อเดือน · ลงวันที่ของยอดล่าสุดในเดือน · ยอดก่อนหน้านั้นในเดือนเดียวกัน = เก็บประวัติอย่างเดียว
--     ก้อน = ยอด Statement ล่าสุดของเดือน − (ยอดตั้งต้น + รายการในพอร์ต / เงินโอนหลังยอดตั้งต้น)
--       ยอดตั้งต้น = ยอด Statement ล่าสุดก่อนต้นเดือน → ยอดยกมา (OPENING_BALANCE) → ยอดก่อนหน้าในเดือน (บัญชีใหม่) · ไม่มี = ไม่มีก้อน
--     บันทึกรายการจริงเพิ่ม / แก้ / ลบ → ก้อนเล็กลง / หาย / กลับด้าน / กลับมาเอง (คำนวณใหม่ทุกครั้ง ไม่ต้องผูกกับก้อน)
--     ไม่สร้างก้อนก่อนวัน Go-live
--   ก้อนไม่มีเงินเข้า–ออกบัญชีใด (ยอดเงินในพอร์ตมาจาก Statement อยู่แล้ว) → ไม่อยู่ในกล่อง "เงินเข้า–ออกบัญชีเดือนนี้"
--   แบ่งรายคนตามเจ้าของพอร์ต (รายได้: asset_id = พอร์ต · ค่าใช้จ่าย: related_asset_id = พอร์ต)
--   แยกก้อน (split_pf_lump): ดอกเบี้ย / คูปอง / ปันผล · ค่าธรรมเนียม · โอนเข้า / โอนออก กับบัญชีธนาคาร
--   กำไร / ขาดทุนเงินลงทุน (Dashboard): ก้อน + ค่าธรรมเนียมในพอร์ตที่เป็นรายจ่ายแล้ว (#426) นับเป็นเงินเข้า–ออกพอร์ต
--     ไม่นับซ้ำในบรรทัดกำไร / ขาดทุน (เดิมค่าธรรมเนียม #426 ถูกนับทั้งค่าใช้จ่ายและกำไร / ขาดทุน → "อื่น ๆ" บวกกลับ)
--   ไม่แก้ / ไม่ลบข้อมูลเดิม (ก้อนเกิดเมื่อมีการอัปเดตยอด / บันทึกรายการหลังรันไฟล์นี้) · รันซ้ำได้
-- =====================================================================

-- 1) คอลัมน์ผูกบัญชีเงินฝากในพอร์ต + ชนิดก้อน PF_CASH ---------------------------------------------------
ALTER TABLE public.expense_items ADD COLUMN IF NOT EXISTS lump_cash_holding_id uuid REFERENCES public.investment_holdings(id);
ALTER TABLE public.income_transactions ADD COLUMN IF NOT EXISTS lump_cash_holding_id uuid REFERENCES public.investment_holdings(id);
CREATE INDEX IF NOT EXISTS expense_items_lump_cash_holding_idx ON public.expense_items(lump_cash_holding_id)
  WHERE lump_cash_holding_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS income_transactions_lump_cash_holding_idx ON public.income_transactions(lump_cash_holding_id)
  WHERE lump_cash_holding_id IS NOT NULL;
ALTER TABLE public.expense_items DROP CONSTRAINT IF EXISTS exp_lump_kind;
ALTER TABLE public.expense_items ADD CONSTRAINT exp_lump_kind
  CHECK ((pending_split = (lump_kind IS NOT NULL)) AND (lump_kind IS NULL OR lump_kind IN ('BANK','CARD','LIABILITY','PF_CASH')));
ALTER TABLE public.expense_items DROP CONSTRAINT IF EXISTS exp_lump_cash_holding;
ALTER TABLE public.expense_items ADD CONSTRAINT exp_lump_cash_holding
  CHECK ((lump_cash_holding_id IS NULL) = (lump_kind IS DISTINCT FROM 'PF_CASH'));
ALTER TABLE public.income_transactions DROP CONSTRAINT IF EXISTS inc_lump_cash_holding;
ALTER TABLE public.income_transactions ADD CONSTRAINT inc_lump_cash_holding
  CHECK (lump_cash_holding_id IS NULL OR (pending_split AND received_to_asset_id IS NULL
         AND received_to_credit_card_id IS NULL AND received_to_liability_id IS NULL));

-- 2) เงินเข้า (+) / ออก (−) บัญชีเงินฝากในพอร์ต ช่วง (p_from, p_to] · กติกาเดียวกับ holding_value_at -------------
CREATE OR REPLACE FUNCTION private.pf_cash_flows(p_holding uuid, p_from date, p_to date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT sum(private.itx_cash_for(x, h.id)) FROM public.investment_transactions x
                    WHERE x.portfolio_id = h.portfolio_id AND x.deleted_at IS NULL
                      AND x.transaction_date > p_from AND x.transaction_date <= p_to
                      AND x.settle_from_asset_id IS NULL AND x.settle_to_asset_id IS NULL
                      AND x.transaction_type <> 'OPENING_BALANCE'
                      AND NOT (x.transaction_type IN ('DEPOSIT','WITHDRAWAL') AND x.cash_movement_id IS NOT NULL)
                      AND (x.currency = h.currency OR x.counter_currency = h.currency)), 0)
       + coalesce((SELECT sum(r.pf_amt) FROM private.pf_transfers(h.portfolio_id, p_to) r
                    WHERE r.ch = h.id AND r.in_holding AND r.movement_date > p_from), 0)
    FROM public.investment_holdings h WHERE h.id = p_holding
$$;
REVOKE ALL ON FUNCTION private.pf_cash_flows(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- 3) ตั้งก้อนของเดือน (คำนวณใหม่ทั้งก้อน · ย้ายวันที่ · กลับด้าน · 0 = ลบ) ---------------------------------------
CREATE OR REPLACE FUNCTION private.sync_pf_cash_lump(p_holding uuid, p_m0 date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.investment_holdings; v public.investment_valuations; v_asset uuid; v_family uuid; v_pf text; v_go_live date;
  v_exp uuid; v_inc uuid; v_from date; v_base numeric; v_d2 date; v_b2 numeric; v_need numeric := 0; v_label text;
BEGIN
  IF private.lump_busy() OR p_holding IS NULL OR p_m0 IS NULL THEN RETURN; END IF;
  SELECT * INTO h FROM public.investment_holdings WHERE id = p_holding;
  IF h.id IS NULL OR h.holding_type <> 'CASH' THEN RETURN; END IF;
  SELECT a.id, a.family_id, a.name, f.go_live_date INTO v_asset, v_family, v_pf, v_go_live
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id JOIN public.families f ON f.id = a.family_id
   WHERE p.id = h.portfolio_id;
  SELECT id INTO v_exp FROM public.expense_items WHERE lump_cash_holding_id = p_holding AND pending_split AND deleted_at IS NULL
     AND date >= p_m0 AND date < (p_m0 + interval '1 month')::date;
  SELECT id INTO v_inc FROM public.income_transactions WHERE lump_cash_holding_id = p_holding AND pending_split AND deleted_at IS NULL
     AND date >= p_m0 AND date < (p_m0 + interval '1 month')::date;

  -- ยอด Statement ล่าสุดของเดือน
  SELECT * INTO v FROM public.investment_valuations WHERE holding_id = p_holding AND deleted_at IS NULL
     AND valuation_date >= p_m0 AND valuation_date < (p_m0 + interval '1 month')::date
   ORDER BY valuation_date DESC, created_at DESC LIMIT 1;
  IF v.id IS NOT NULL AND h.deleted_at IS NULL AND v.valuation_date >= v_go_live THEN
    -- ยอดตั้งต้น: Statement ล่าสุดก่อนต้นเดือน → ยอดยกมา / ยอดก่อนหน้าในเดือน (ที่หลังกว่า)
    SELECT valuation_date, market_value INTO v_from, v_base FROM public.investment_valuations
     WHERE holding_id = p_holding AND deleted_at IS NULL AND valuation_date < p_m0
     ORDER BY valuation_date DESC, created_at DESC LIMIT 1;
    IF v_from IS NULL THEN
      SELECT transaction_date, amount INTO v_from, v_base FROM public.investment_transactions
       WHERE holding_id = p_holding AND transaction_type = 'OPENING_BALANCE' AND deleted_at IS NULL
         AND transaction_date < v.valuation_date
       ORDER BY transaction_date DESC LIMIT 1;
      SELECT valuation_date, market_value INTO v_d2, v_b2 FROM public.investment_valuations
       WHERE holding_id = p_holding AND deleted_at IS NULL AND valuation_date < v.valuation_date
       ORDER BY valuation_date DESC, created_at DESC LIMIT 1;
      IF v_d2 IS NOT NULL AND (v_from IS NULL OR v_d2 >= v_from) THEN v_from := v_d2; v_base := v_b2; END IF;
    END IF;
    IF v_from IS NOT NULL THEN
      v_need := v.market_value - (v_base + private.pf_cash_flows(p_holding, v_from, v.valuation_date));
    END IF;
  END IF;

  v_label := 'รอแยกรายละเอียด · ส่วนต่างยอด ' || h.name || ' · ' || v_pf || ' ' || to_char(p_m0, 'MM/YYYY');
  PERFORM set_config('fwv.lump', 'on', true);
  IF v_need < -0.005 THEN
    IF v_exp IS NULL THEN
      INSERT INTO public.expense_items(monthly_expense_id, related_asset_id, date, description, amount, currency, expense_category,
                                       pending_split, lump_kind, lump_cash_holding_id, lump_from, lump_base, lump_target)
      VALUES (private.expense_month_id(v.valuation_date), v_asset, v.valuation_date, v_label, -v_need, h.currency, 'รอแยกรายละเอียด',
              true, 'PF_CASH', p_holding, v_from, v_base, v.market_value);
    ELSE
      UPDATE public.expense_items SET amount = -v_need, date = v.valuation_date, description = v_label,
             lump_from = v_from, lump_base = v_base, lump_target = v.market_value
       WHERE id = v_exp AND (amount, date, description, lump_from, lump_base, lump_target)
             IS DISTINCT FROM (-v_need, v.valuation_date, v_label, v_from, v_base, v.market_value);
    END IF;
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = v_inc;
  ELSIF v_need > 0.005 THEN
    IF v_inc IS NULL THEN
      INSERT INTO public.income_transactions(family_id, asset_id, date, income_type, amount, currency, notes,
                                             pending_split, lump_cash_holding_id, lump_from, lump_base, lump_target)
      VALUES (v_family, v_asset, v.valuation_date, 'OTHER', v_need, h.currency, v_label,
              true, p_holding, v_from, v_base, v.market_value);
    ELSE
      UPDATE public.income_transactions SET amount = v_need, date = v.valuation_date, notes = v_label,
             lump_from = v_from, lump_base = v_base, lump_target = v.market_value
       WHERE id = v_inc AND (amount, date, notes, lump_from, lump_base, lump_target)
             IS DISTINCT FROM (v_need, v.valuation_date, v_label, v_from, v_base, v.market_value);
    END IF;
    UPDATE public.expense_items SET deleted_at = now() WHERE id = v_exp;
  ELSE
    UPDATE public.expense_items SET deleted_at = now() WHERE id = v_exp;
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = v_inc;
  END IF;
  PERFORM set_config('fwv.lump', 'off', true);
END $$;
REVOKE ALL ON FUNCTION private.sync_pf_cash_lump(uuid, date) FROM PUBLIC, anon, authenticated;

-- ข้อมูลวันที่ p_date เปลี่ยน → ก้อนเดือนนั้น + ก้อนของเดือนถัดไปที่มี Statement (ยอดตั้งต้นของเดือนนั้นอาจเปลี่ยน)
CREATE OR REPLACE FUNCTION private.recalc_pf_cash_lumps(p_holding uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_m0 date := date_trunc('month', p_date)::date; v_m2 date;
BEGIN
  IF private.lump_busy() OR p_holding IS NULL OR p_date IS NULL THEN RETURN; END IF;
  PERFORM private.sync_pf_cash_lump(p_holding, v_m0);
  SELECT date_trunc('month', min(valuation_date))::date INTO v_m2 FROM public.investment_valuations
   WHERE holding_id = p_holding AND deleted_at IS NULL AND valuation_date >= (v_m0 + interval '1 month')::date;
  PERFORM private.sync_pf_cash_lump(p_holding, v_m2);
END $$;
REVOKE ALL ON FUNCTION private.recalc_pf_cash_lumps(uuid, date) FROM PUBLIC, anon, authenticated;

-- 4) ทริกเกอร์: ยอด Statement / รายการในพอร์ต / เงินโอนธนาคาร ↔ พอร์ต เปลี่ยน → คำนวณก้อนใหม่ ----------------------
CREATE OR REPLACE FUNCTION private.tg_pf_lump_valuation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.investment_valuations;
BEGIN
  IF private.lump_busy() THEN RETURN NULL; END IF;
  FOREACH r IN ARRAY ARRAY[OLD, NEW] LOOP
    CONTINUE WHEN r.id IS NULL;
    IF EXISTS (SELECT 1 FROM public.investment_holdings h WHERE h.id = r.holding_id AND h.holding_type = 'CASH') THEN
      PERFORM private.recalc_pf_cash_lumps(r.holding_id, r.valuation_date);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS a70_pf_cash_lump ON public.investment_valuations;
CREATE TRIGGER a70_pf_cash_lump AFTER INSERT OR UPDATE OR DELETE ON public.investment_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_pf_lump_valuation();

CREATE OR REPLACE FUNCTION private.tg_pf_lump_itx() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.investment_transactions; c uuid;
BEGIN
  IF private.lump_busy() THEN RETURN NULL; END IF;
  FOREACH r IN ARRAY ARRAY[OLD, NEW] LOOP
    CONTINUE WHEN r.id IS NULL;
    FOR c IN SELECT h.id FROM public.investment_holdings h
              WHERE h.portfolio_id = r.portfolio_id AND h.holding_type = 'CASH' AND h.deleted_at IS NULL
                AND (h.currency = r.currency OR h.currency = r.counter_currency) LOOP
      PERFORM private.recalc_pf_cash_lumps(c, r.transaction_date);
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS a70_pf_cash_lump ON public.investment_transactions;
CREATE TRIGGER a70_pf_cash_lump AFTER INSERT OR UPDATE OR DELETE ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_pf_lump_itx();

CREATE OR REPLACE FUNCTION private.tg_pf_lump_cm() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cash_movements; c uuid;
BEGIN
  IF private.lump_busy() THEN RETURN NULL; END IF;
  FOREACH r IN ARRAY ARRAY[OLD, NEW] LOOP
    CONTINUE WHEN r.id IS NULL OR r.is_derived OR r.movement_type NOT IN ('INVESTMENT_OUT','INVESTMENT_IN');
    FOR c IN SELECT h.id FROM public.investment_portfolios p
               JOIN public.investment_holdings h ON h.portfolio_id = p.id AND h.holding_type = 'CASH' AND h.deleted_at IS NULL
              WHERE p.asset_id = CASE r.movement_type WHEN 'INVESTMENT_OUT' THEN r.to_asset_id ELSE r.from_asset_id END LOOP
      PERFORM private.recalc_pf_cash_lumps(c, r.movement_date);
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS a70_pf_cash_lump ON public.cash_movements;
CREATE TRIGGER a70_pf_cash_lump AFTER INSERT OR UPDATE OR DELETE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.tg_pf_lump_cm();
REVOKE ALL ON FUNCTION private.tg_pf_lump_valuation(), private.tg_pf_lump_itx(), private.tg_pf_lump_cm()
  FROM PUBLIC, anon, authenticated;

-- 5) แยกก้อน: บันทึกรายการจริงในพอร์ต → ก้อนเล็กลงเอง ----------------------------------------------------------
--   p_lines: [{ type: 'INTEREST' | 'COUPON' | 'DIVIDEND', amount, tax?, holding_id? (คูปอง / ปันผล ต้องเลือก), date?, notes? }
--             { type: 'FEE', amount, date?, notes? }
--             { type: 'TRANSFER_IN' | 'TRANSFER_OUT', amount (ยอดฝั่งพอร์ต), bank_asset_id, bank_amount? (สกุลต่างกัน), date?, notes? }]
--   date ไม่ใส่ = วันที่ของก้อน · ต้องอยู่ในช่วงของก้อน · แยกเกินยอดก้อนไม่ได้ (ฝั่งตรงข้ามได้ เช่น ก้อนรายได้ = ดอกเบี้ย + ค่าธรรมเนียม)
CREATE OR REPLACE FUNCTION public.split_pf_lump(p_kind text, p_id uuid, p_lines jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_h uuid; v_date date; v_from date; v_lump numeric; v_ccy text; v_pf_asset uuid; x jsonb;
  v_type text; v_amt numeric; v_tax numeric; v_d date; v_net numeric := 0; b public.assets; v_bamt numeric; v_notes text;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่รายการอย่างน้อย 1 บรรทัด' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'EXPENSE' THEN
    SELECT lump_cash_holding_id, date, lump_from, -amount, currency INTO v_h, v_date, v_from, v_lump, v_ccy
      FROM public.expense_items WHERE id = p_id AND pending_split AND lump_kind = 'PF_CASH' AND deleted_at IS NULL;
  ELSIF p_kind = 'INCOME' THEN
    SELECT lump_cash_holding_id, date, lump_from, amount, currency INTO v_h, v_date, v_from, v_lump, v_ccy
      FROM public.income_transactions WHERE id = p_id AND pending_split AND lump_cash_holding_id IS NOT NULL AND deleted_at IS NULL;
  END IF;
  IF v_h IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการรอแยก' USING ERRCODE = '22023'; END IF;
  SELECT p.asset_id INTO v_pf_asset FROM public.investment_holdings h JOIN public.investment_portfolios p ON p.id = h.portfolio_id
   WHERE h.id = v_h;

  -- ตรวจทุกบรรทัดก่อน (ยอดสุทธิ + = เงินเข้าพอร์ต)
  FOR x IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_type := upper(coalesce(x->>'type', ''));
    v_amt := nullif(replace(x->>'amount', ',', ''), '')::numeric;
    v_tax := coalesce(nullif(replace(x->>'tax', ',', ''), '')::numeric, 0);
    v_d := coalesce(nullif(x->>'date', '')::date, v_date);
    IF v_type NOT IN ('INTEREST','COUPON','DIVIDEND','FEE','TRANSFER_IN','TRANSFER_OUT') THEN
      RAISE EXCEPTION 'INVALID: ประเภทบรรทัดไม่ถูกต้อง' USING ERRCODE = '22023';
    END IF;
    IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'INVALID: ยอดแต่ละบรรทัดต้องมากกว่า 0' USING ERRCODE = '22023'; END IF;
    IF v_tax < 0 OR v_tax >= v_amt THEN RAISE EXCEPTION 'INVALID: ภาษีหัก ณ ที่จ่ายต้องน้อยกว่ายอด' USING ERRCODE = '22023'; END IF;
    IF v_d > v_date OR v_d <= v_from THEN
      RAISE EXCEPTION 'INVALID: วันที่ % อยู่นอกช่วงของรายการรอแยก (หลัง % ถึง %)', v_d, v_from, v_date USING ERRCODE = '22023';
    END IF;
    v_net := v_net + CASE WHEN v_type IN ('INTEREST','COUPON','DIVIDEND') THEN v_amt - v_tax
                          WHEN v_type = 'TRANSFER_IN' THEN v_amt ELSE -v_amt END;
  END LOOP;
  IF (v_lump > 0 AND v_net > v_lump + 0.005) OR (v_lump < 0 AND v_net < v_lump - 0.005) THEN
    RAISE EXCEPTION 'INVALID: ยอดที่แยก (%) มากกว่ายอดรอแยก (%)', abs(v_net), abs(v_lump) USING ERRCODE = '22023';
  END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_type := upper(x->>'type');
    v_amt := nullif(replace(x->>'amount', ',', ''), '')::numeric;
    v_d := coalesce(nullif(x->>'date', '')::date, v_date);
    v_notes := nullif(trim(coalesce(x->>'notes', '')), '');
    IF v_type IN ('TRANSFER_IN','TRANSFER_OUT') THEN
      SELECT * INTO b FROM public.assets WHERE id = nullif(x->>'bank_asset_id', '')::uuid;
      IF b.id IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีธนาคารของทุกบรรทัดเงินโอน' USING ERRCODE = '22023'; END IF;
      v_bamt := CASE WHEN b.currency = v_ccy THEN v_amt ELSE nullif(replace(x->>'bank_amount', ',', ''), '')::numeric END;
      IF v_bamt IS NULL OR v_bamt <= 0 THEN
        RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดฝั่งบัญชีธนาคาร (%)', b.currency USING ERRCODE = '22023';
      END IF;
      PERFORM public.transfer_portfolio_money(v_pf_asset, jsonb_build_object(
        'direction', CASE v_type WHEN 'TRANSFER_IN' THEN 'IN' ELSE 'OUT' END, 'bank_asset_id', b.id, 'cash_holding_id', v_h,
        'date', v_d, 'amount', CASE v_type WHEN 'TRANSFER_IN' THEN v_bamt ELSE v_amt END,
        'counter_amount', CASE v_type WHEN 'TRANSFER_IN' THEN v_amt ELSE v_bamt END, 'description', v_notes));
    ELSE
      PERFORM public.record_investment_tx(v_pf_asset, jsonb_build_object(
        'type', v_type, 'date', v_d, 'amount', v_amt, 'tax', nullif(x->>'tax', ''), 'cash_holding_id', v_h, 'notes', v_notes,
        'holding_id', coalesce(nullif(x->>'holding_id', ''), CASE WHEN v_type IN ('INTEREST','FEE') THEN v_h::text END)));
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.split_pf_lump(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_pf_lump(text, uuid, jsonb) TO authenticated;

-- 6) กำไร / ขาดทุนเงินลงทุน: ก้อน + ค่าธรรมเนียมในพอร์ต (รายจ่ายจาก #426) = เงินเข้า–ออกพอร์ต (อยู่ในรายได้ / ค่าใช้จ่ายแล้ว) ------
CREATE OR REPLACE FUNCTION private.portfolio_flows(p_family uuid, p_from date, p_to date)
RETURNS TABLE (asset_id uuid, flow_date date, thb numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH pf AS (
    SELECT p.id, p.asset_id FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
     WHERE a.family_id = p_family AND p.deleted_at IS NULL AND a.deleted_at IS NULL)
  -- โอนธนาคาร ↔ พอร์ต (รายการโอนที่บันทึกเอง) · ยอดฝั่งพอร์ต (ค่าธรรมเนียมเป็นค่าใช้จ่ายแล้ว · ส่วนต่างอัตรา = มูลค่าเปลี่ยน)
  SELECT pf.asset_id, r.movement_date, r.pf_amt * private.fx_rate(r.pf_ccy, r.movement_date)
    FROM pf CROSS JOIN LATERAL private.pf_transfers(pf.id, p_to) r
   WHERE r.movement_date > p_from
  UNION ALL
  -- ซื้อที่ตัดจากบัญชีธนาคาร (+) / ขาย ไถ่ถอน ครบกำหนด ที่เข้าบัญชีธนาคาร (−) · ตามวันที่เงินออก / เข้าจริง
  SELECT pf.asset_id, m.movement_date,
         CASE WHEN m.to_asset_id = pf.asset_id THEN 1 ELSE -1 END * m.amount * private.fx_rate(m.currency, m.movement_date)
    FROM pf JOIN public.cash_movements m ON (m.to_asset_id = pf.asset_id OR m.from_asset_id = pf.asset_id)
   WHERE m.deleted_at IS NULL AND m.is_derived AND m.source_entity_type = 'INVESTMENT_TX'
     AND m.movement_type IN ('INVESTMENT_OUT','INVESTMENT_IN')
     AND m.movement_date > p_from AND m.movement_date <= p_to
  UNION ALL
  -- ฝาก / ถอน กับภายนอก (ไม่ผ่านบัญชีธนาคารในระบบ) · จ่ายค่าใช้จ่าย / บัตรจากพอร์ต
  SELECT pf.asset_id, t.transaction_date,
         CASE WHEN t.transaction_type = 'DEPOSIT' THEN 1 ELSE -1 END * t.amount * private.fx_rate(t.currency, t.transaction_date)
    FROM pf JOIN public.investment_transactions t ON t.portfolio_id = pf.id
   WHERE t.deleted_at IS NULL AND t.transaction_date > p_from AND t.transaction_date <= p_to
     AND (t.transaction_type = 'PAYMENT'
          OR (t.transaction_type IN ('DEPOSIT','WITHDRAWAL') AND t.cash_movement_id IS NULL))
  UNION ALL
  -- ปันผล / ดอกเบี้ย / Coupon ที่เข้าพอร์ต: ยอดเดียวกับบรรทัด "รายได้ลงทุน" (สุทธิหลังภาษี)
  SELECT pf.asset_id, i.date, i.base_amount * (1 - coalesce(i.tax, 0) / nullif(i.amount, 0))
    FROM pf JOIN public.investment_transactions t ON t.portfolio_id = pf.id
    JOIN public.income_transactions i ON i.source_transaction_id = t.id AND i.deleted_at IS NULL
   WHERE t.deleted_at IS NULL AND t.settle_to_asset_id IS NULL
     AND t.transaction_type IN ('DIVIDEND','INTEREST','COUPON')
     AND i.date > p_from AND i.date <= p_to
  UNION ALL
  -- ค่าธรรมเนียมที่หักในพอร์ต (รายจ่ายค่าธรรมเนียมอัตโนมัติ) · เข้าบัญชีธนาคารโดยตรง = ไม่กระทบพอร์ต
  SELECT pf.asset_id, e.date, -e.base_amount
    FROM pf JOIN public.investment_transactions t ON t.portfolio_id = pf.id
    JOIN public.expense_items e ON e.source_investment_tx_id = t.id AND e.deleted_at IS NULL
   WHERE t.deleted_at IS NULL AND t.settle_to_asset_id IS NULL AND t.settle_from_asset_id IS NULL
     AND e.date > p_from AND e.date <= p_to
  UNION ALL
  -- ก้อนรอแยกของบัญชีเงินฝากในพอร์ต: รายได้ (+) / ค่าใช้จ่าย (−)
  SELECT pf.asset_id, i.date, i.base_amount
    FROM pf JOIN public.investment_holdings h ON h.portfolio_id = pf.id
    JOIN public.income_transactions i ON i.lump_cash_holding_id = h.id AND i.pending_split AND i.deleted_at IS NULL
   WHERE i.date > p_from AND i.date <= p_to
  UNION ALL
  SELECT pf.asset_id, e.date, -e.base_amount
    FROM pf JOIN public.investment_holdings h ON h.portfolio_id = pf.id
    JOIN public.expense_items e ON e.lump_cash_holding_id = h.id AND e.pending_split AND e.deleted_at IS NULL
   WHERE e.date > p_from AND e.date <= p_to
$$;
REVOKE ALL ON FUNCTION private.portfolio_flows(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- 7) ค่าใช้จ่ายรายบุคคล: ก้อนค่าใช้จ่ายของพอร์ต → ตามเจ้าของพอร์ต (เหมือนค่าธรรมเนียมในพอร์ต) -------------------------
CREATE OR REPLACE VIEW public.v_expense_by_person WITH (security_invoker = true) AS
  SELECT i.id AS expense_item_id, me.family_id, me.year_month, i.date, i.expense_category, i.currency,
         (i.source_cash_movement_id IS NOT NULL OR i.source_investment_tx_id IS NOT NULL) AS is_derived_fee,
         sh.person_id, sh.pct AS share_percent,
         round(i.amount * sh.pct / 100, 4) AS amount_share,
         round(i.base_amount * sh.pct / 100, 4) AS base_amount_share
    FROM public.expense_items i
    JOIN public.monthly_expenses me ON me.id = i.monthly_expense_id
    LEFT JOIN public.cash_movements src ON src.id = i.source_cash_movement_id
    LEFT JOIN public.investment_holdings ph ON ph.id = i.paid_from_cash_holding_id
    LEFT JOIN public.investment_portfolios pp ON pp.id = ph.portfolio_id
    CROSS JOIN LATERAL private.expense_shares(i.person_id, i.paid_from_credit_card_id,
      coalesce(i.paid_from_asset_id, src.from_asset_id, pp.asset_id,
               CASE WHEN i.source_investment_tx_id IS NOT NULL OR i.lump_kind = 'PF_CASH' THEN i.related_asset_id END), i.date, i.liability_id) sh
   WHERE i.deleted_at IS NULL AND me.deleted_at IS NULL AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');

-- 8) Dashboard รายคน: กติกาเดียวกับ v_expense_by_person ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.person_dashboard(p_month date, p_person uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_family uuid := private.default_family_id();
  f public.families;
  m0 date := date_trunc('month', p_month)::date;
  d date := private.month_end(p_month);
  v_as_of date;
  v_open numeric; v_open_a numeric; v_open_l numeric; v_prev numeric; v_prev_label text; v_prev_date date;
  v_inc numeric; v_inv numeric; v_exp numeric; v_reimb numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  SELECT * INTO f FROM public.families WHERE id = v_family;
  v_as_of := CASE WHEN d < current_date THEN d ELSE current_date END;

  -- ยอดตั้งต้นของคนนี้ (แยกสินทรัพย์ / หนี้สิน → เส้นเล็กในการ์ด · 2 พ.ย. 2026)
  SELECT coalesce(sum(n.base_value) FILTER (WHERE n.item_type = 'ASSET'), 0),
         coalesce(sum(n.base_value) FILTER (WHERE n.item_type <> 'ASSET'), 0)
    INTO v_open_a, v_open_l
    FROM private.net_worth_items(v_family, f.go_live_date - 1, true) n
   WHERE n.person_id = p_person;
  v_open := v_open_a - v_open_l;

  -- ยอดงวดก่อน: Snapshot FINAL เดือนก่อน → ไม่มีและเป็นเดือน Go-live = ยอดตั้งต้น
  SELECT s.snapshot_date,
         coalesce((SELECT sum(CASE WHEN i.item_type = 'ASSET' THEN i.base_value ELSE -i.base_value END)
                     FROM public.net_worth_snapshot_items i WHERE i.snapshot_id = s.id AND i.person_id = p_person), 0)
    INTO v_prev_date, v_prev
    FROM public.net_worth_snapshots s
   WHERE s.family_id = v_family AND s.snapshot_month = (m0 - interval '1 month')::date
     AND s.status = 'FINAL' AND s.deleted_at IS NULL;
  IF v_prev_date IS NOT NULL THEN
    v_prev_label := 'ยอดปิดเดือนก่อน';
  ELSIF EXISTS (SELECT 1 FROM private.month_points(v_family) x
                 WHERE x.snapshot_month = (m0 - interval '1 month')::date AND x.status = 'AUTO') THEN
    SELECT coalesce((x.by_person ->> p_person::text)::numeric, 0), x.snapshot_date INTO v_prev, v_prev_date
      FROM private.month_points(v_family) x
     WHERE x.snapshot_month = (m0 - interval '1 month')::date AND x.status = 'AUTO';
    v_prev_label := 'ยอดสิ้นเดือนก่อน (อัตโนมัติ)';
  ELSIF m0 = date_trunc('month', f.go_live_date)::date THEN
    v_prev := v_open; v_prev_date := f.go_live_date - 1;
    v_prev_label := 'ยอดตั้งต้น (Opening Position)';
  ELSE
    v_prev := NULL;
  END IF;

  -- รายได้หลังภาษี (แยกรายได้ลงทุน) ส่วนของคนนี้ — กติกาเดียวกับ v_income_by_person
  SELECT coalesce(sum(x.net * x.pct / 100) FILTER (WHERE NOT x.inv), 0), coalesce(sum(x.net * x.pct / 100) FILTER (WHERE x.inv), 0)
    INTO v_inc, v_inv
    FROM (SELECT i.base_amount * (1 - coalesce(i.tax, 0) / nullif(i.amount, 0)) AS net,
                 i.source_transaction_id IS NOT NULL AS inv, sh.pct
            FROM public.income_transactions i
            CROSS JOIN LATERAL private.income_shares(i.person_id, i.asset_id, i.received_to_asset_id, i.date, i.received_to_liability_id) sh
           WHERE i.family_id = v_family AND i.deleted_at IS NULL AND i.date BETWEEN m0 AND v_as_of
             AND sh.person_id = p_person) x;

  -- ค่าใช้จ่าย / เงินคืน ส่วนของคนนี้ — กติกาเดียวกับ v_expense_by_person
  SELECT coalesce(sum(e.base_amount * sh.pct / 100), 0) INTO v_exp
    FROM public.expense_items e
    JOIN public.monthly_expenses me ON me.id = e.monthly_expense_id AND me.family_id = v_family
    LEFT JOIN public.cash_movements src ON src.id = e.source_cash_movement_id
    CROSS JOIN LATERAL private.expense_shares(e.person_id, e.paid_from_credit_card_id, coalesce(e.paid_from_asset_id, src.from_asset_id,
                                                      CASE WHEN e.source_investment_tx_id IS NOT NULL OR e.lump_kind = 'PF_CASH' THEN e.related_asset_id END), e.date, e.liability_id) sh
   WHERE e.deleted_at IS NULL AND e.date BETWEEN m0 AND v_as_of AND sh.person_id = p_person;
  SELECT coalesce(sum(x.amount * coalesce(private.fx_rate(x.currency, x.received_date), 0) * sh.pct / 100), 0) INTO v_reimb
    FROM public.expense_reimbursements x
    JOIN public.expense_items e ON e.id = x.expense_item_id
    JOIN public.monthly_expenses me ON me.id = e.monthly_expense_id AND me.family_id = v_family
    LEFT JOIN public.cash_movements src ON src.id = e.source_cash_movement_id
    CROSS JOIN LATERAL private.expense_shares(e.person_id, e.paid_from_credit_card_id, coalesce(e.paid_from_asset_id, src.from_asset_id,
                                                      CASE WHEN e.source_investment_tx_id IS NOT NULL OR e.lump_kind = 'PF_CASH' THEN e.related_asset_id END), e.date, e.liability_id) sh
   WHERE x.deleted_at IS NULL AND x.received_date BETWEEN m0 AND v_as_of AND sh.person_id = p_person;

  RETURN jsonb_build_object(
    'opening', jsonb_build_object('date', f.go_live_date - 1, 'total_assets', v_open_a, 'total_liabilities', v_open_l,
                                  'net_worth', v_open),
    'snapshots', coalesce((SELECT jsonb_agg(jsonb_build_object('month', x.snapshot_month, 'date', x.snapshot_date,
                     'status', x.status, 'total_assets', x.total_assets, 'total_liabilities', x.total_liabilities,
                     'net_worth', x.net_worth)
                     ORDER BY x.snapshot_month)
                   FROM private.month_points_person(v_family, p_person) x), '[]'::jsonb),
    'prev_net_worth', v_prev, 'prev_label', v_prev_label, 'prev_date', v_prev_date,
    'income', round(v_inc, 2), 'investment_income', round(v_inv, 2),
    'expenses', round(v_exp, 2), 'reimbursements', round(v_reimb, 2));
END $$;
REVOKE ALL ON FUNCTION public.person_dashboard(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.person_dashboard(date, uuid) TO authenticated;
