-- =====================================================================
-- วิธีนับมูลค่าของหลักทรัพย์ (ตกลง 21 ต.ค. 2026)
--   UNITS    = นับเป็นหน่วย: มูลค่า = จำนวนหน่วย × ราคาต่อหน่วย (1 หน่วยจริงได้ — ฟอร์มให้ยืนยัน)
--   LUMP_SUM = มูลค่าก้อนเดียว: รู้แค่มูลค่า · เก็บภายในเป็น 1 × มูลค่า (ไม่เปลี่ยนสูตรเงิน) · ราคาในประวัติ = ว่าง
--             ดึงราคาอัตโนมัติไม่ได้ · แปลงเป็นหน่วยทีหลังด้วย restate_opening_units
-- กัน: เปิดราคาอัตโนมัติไม่ได้ถ้าเป็นมูลค่าก้อนเดียว / กองทุนที่มี 1 หน่วย (มักเป็นมูลค่ารวมใส่แทนจำนวน)
-- ข้อมูลเดิม: ทุกรายการเป็น UNITS (ทำงานเหมือนเดิมทุกอย่าง · ไม่แก้ข้อมูลเดิม)
-- =====================================================================

ALTER TABLE public.investment_holdings ADD COLUMN IF NOT EXISTS valuation_mode text NOT NULL DEFAULT 'UNITS';
DO $$ BEGIN
  ALTER TABLE public.investment_holdings ADD CONSTRAINT investment_holdings_valuation_mode_chk
    CHECK (valuation_mode IN ('UNITS','LUMP_SUM'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.investment_holdings.valuation_mode IS
  'UNITS = จำนวนหน่วย × ราคา · LUMP_SUM = มูลค่าก้อนเดียว (เก็บเป็น 1 × มูลค่า · ราคาอัตโนมัติไม่ได้)';

-- ---------------------------------------------------------------------
-- กันบน investment_holdings: วิธีนับ + ราคาอัตโนมัติ
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_holding_mode_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.holding_type = 'CASH' THEN NEW.valuation_mode := 'UNITS'; END IF;

  -- เปลี่ยนเป็นมูลค่าก้อนเดียว: เฉพาะรายการที่เก็บเป็น 1 หน่วย (หรือยังไม่มีรายการ) — มีจำนวนหน่วยจริงแล้วเปลี่ยนไม่ได้
  IF NEW.valuation_mode = 'LUMP_SUM' AND (TG_OP = 'INSERT' OR OLD.valuation_mode <> 'LUMP_SUM')
     AND coalesce(NEW.quantity, 0) NOT IN (0, 1) THEN
    RAISE EXCEPTION 'INVALID: รายการนี้มีจำนวนหน่วยแล้ว (%) — เปลี่ยนเป็นมูลค่าก้อนเดียวไม่ได้', NEW.quantity
      USING ERRCODE = '22023';
  END IF;

  -- ราคาอัตโนมัติ (ตรวจตอนเปิด หรือตอนเปลี่ยนวิธีนับขณะเปิดอยู่)
  IF NEW.auto_price AND (TG_OP = 'INSERT' OR NOT OLD.auto_price OR NEW.valuation_mode IS DISTINCT FROM OLD.valuation_mode) THEN
    IF NEW.valuation_mode <> 'UNITS' THEN
      RAISE EXCEPTION 'INVALID: ราคาอัตโนมัติใช้ได้เฉพาะรายการที่นับเป็นหน่วย — แปลงเป็นจำนวนหน่วยก่อน' USING ERRCODE = '22023';
    END IF;
    IF NEW.holding_type = 'FUND' AND NEW.quantity = 1 THEN
      RAISE EXCEPTION 'INVALID: กองทุนนี้มีจำนวน 1 หน่วย (มักเป็นมูลค่ารวมที่ใส่แทนจำนวน) — แปลงเป็นจำนวนหน่วยก่อนเปิดราคาอัตโนมัติ'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS t17_valuation_mode ON public.investment_holdings;
CREATE TRIGGER t17_valuation_mode BEFORE INSERT OR UPDATE ON public.investment_holdings
  FOR EACH ROW EXECUTE FUNCTION private.tg_holding_mode_guard();

-- ---------------------------------------------------------------------
-- ราคา / มูลค่าของรายการมูลค่าก้อนเดียว: เก็บแค่มูลค่า (ราคาว่าง · จำนวน 1) → สูตรเดิมใช้มูลค่านั้นตรง ๆ
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_valuation_lump_sum() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (SELECT h.valuation_mode FROM public.investment_holdings h WHERE h.id = NEW.holding_id) = 'LUMP_SUM' THEN
    NEW.market_value := coalesce(NEW.market_value, round(NEW.price * NEW.quantity, 4));
    NEW.price := NULL; NEW.quantity := 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS t45_lump_sum ON public.investment_valuations;
CREATE TRIGGER t45_lump_sum BEFORE INSERT OR UPDATE ON public.investment_valuations
  FOR EACH ROW EXECUTE FUNCTION private.tg_valuation_lump_sum();

-- ---------------------------------------------------------------------
-- add_holding: รับวิธีนับใน p_opening.valuation_mode (ไม่ใส่ = UNITS)
--   LUMP_SUM: จำนวน = 1 · price = ต้นทุนรวม · market_value / market_price = มูลค่า ณ วันตั้งต้น
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_holding(
  p_portfolio_asset_id uuid,
  p_holding_type       text,
  p_name               text,
  p_symbol             text    DEFAULT NULL,
  p_currency           text    DEFAULT NULL,
  p_maturity_date      date    DEFAULT NULL,
  p_opening            jsonb   DEFAULT NULL,  -- {"quantity","price","cost_base_thb","fx_rate","market_price","market_value","notes","valuation_mode"}
  p_notes              text    DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_pf uuid; v_pf_ccy text; v_go_live date; v_open date; v_ccy text; v_id uuid; v_mode text;
  v_qty numeric; v_price numeric; v_cost numeric; v_fx numeric; v_mp numeric; v_mv numeric;
BEGIN
  SELECT p.id, a.currency, f.go_live_date INTO v_pf, v_pf_ccy, v_go_live
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
    JOIN public.families f ON f.id = a.family_id
   WHERE p.asset_id = p_portfolio_asset_id AND p.deleted_at IS NULL AND a.deleted_at IS NULL;
  IF v_pf IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบพอร์ตนี้' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อหลักทรัพย์' USING ERRCODE = '22023';
  END IF;
  v_ccy := upper(coalesce(nullif(p_currency, ''), v_pf_ccy));
  v_open := v_go_live - 1;
  v_mode := CASE WHEN p_holding_type = 'CASH' THEN 'UNITS'
                 ELSE upper(coalesce(nullif(p_opening->>'valuation_mode', ''), 'UNITS')) END;
  IF v_mode NOT IN ('UNITS','LUMP_SUM') THEN
    RAISE EXCEPTION 'INVALID: วิธีนับต้องเป็น UNITS หรือ LUMP_SUM' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.investment_holdings(portfolio_id, holding_type, name, symbol, currency, maturity_date, notes, valuation_mode)
  VALUES (v_pf, p_holding_type, trim(p_name), nullif(upper(trim(p_symbol)), ''), v_ccy, p_maturity_date, p_notes, v_mode)
  RETURNING id INTO v_id;

  IF p_opening IS NOT NULL AND (nullif(p_opening->>'quantity', '') IS NOT NULL OR v_mode = 'LUMP_SUM') THEN
    v_qty   := CASE WHEN v_mode = 'LUMP_SUM' THEN 1 ELSE (p_opening->>'quantity')::numeric END;
    v_price := CASE WHEN p_holding_type = 'CASH' THEN 1 ELSE nullif(p_opening->>'price', '')::numeric END;
    IF v_qty IS NULL OR v_qty < 0 OR v_price IS NULL OR v_price < 0 THEN
      RAISE EXCEPTION 'INVALID: %', CASE WHEN v_mode = 'LUMP_SUM' THEN 'ยอดตั้งต้นแบบมูลค่าก้อนเดียวต้องมีต้นทุนรวม'
                                         ELSE 'ยอดตั้งต้นต้องมีจำนวนและต้นทุนเฉลี่ยต่อหน่วย' END USING ERRCODE = '22023';
    END IF;
    v_cost := nullif(p_opening->>'cost_base_thb', '')::numeric;
    v_fx   := nullif(p_opening->>'fx_rate', '')::numeric;
    IF v_ccy <> 'THB' AND v_cost IS NULL AND v_fx IS NULL THEN
      v_fx := private.fx_rate(v_ccy, v_open);
      IF v_fx IS NULL THEN
        RAISE EXCEPTION 'INVALID: ยังไม่มีอัตราแลกเปลี่ยน % ณ วันตั้งต้น — ใส่ต้นทุนเป็นบาท หรือ FX ตอนซื้อ', v_ccy
          USING ERRCODE = '22023';
      END IF;
    END IF;
    INSERT INTO public.investment_transactions(portfolio_id, holding_id, transaction_date, transaction_type,
                quantity, price, amount, currency, cost_base_currency, actual_fx_rate, notes)
    VALUES (v_pf, v_id, v_open, 'OPENING_BALANCE', v_qty, v_price, round(v_qty * v_price, 4), v_ccy,
            v_cost, CASE WHEN v_ccy <> 'THB' THEN v_fx END,
            coalesce(nullif(trim(p_opening->>'notes'), ''), 'ยอดตั้งต้น'));

    -- ราคาตลาด ณ วันตั้งต้น (ไม่ใช่ CASH) · มูลค่าก้อนเดียว: market_price = มูลค่ารวม
    v_mp := nullif(p_opening->>'market_price', '')::numeric;
    v_mv := nullif(p_opening->>'market_value', '')::numeric;
    IF p_holding_type <> 'CASH' AND (v_mp IS NOT NULL OR v_mv IS NOT NULL) THEN
      INSERT INTO public.investment_valuations(holding_id, valuation_date, price, quantity, market_value, source)
      VALUES (v_id, v_open, v_mp, v_qty, coalesce(v_mv, round(v_mp * v_qty, 4)), 'STATEMENT');
    END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.add_holding(uuid,text,text,text,text,date,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_holding(uuid,text,text,text,text,date,jsonb,text) TO authenticated;

-- ---------------------------------------------------------------------
-- แปลงยอดตั้งต้นเป็นจำนวนหน่วยจริง (ใช้กับรายการที่ใส่ 1 หน่วยแทนมูลค่ารวม / มูลค่าก้อนเดียว)
--   เงื่อนไข: มีแค่รายการยอดตั้งต้น (ยังไม่มีซื้อ / ขาย / ปันผล) · มูลค่าทุกวันเท่าเดิม (ราคาต่อหน่วย = มูลค่า ÷ จำนวนหน่วยใหม่)
--   ต้นทุนรวมเท่าเดิม · วิธีนับ → UNITS · กติกาเดิมยังใช้: หลัง Go-live เฉพาะ ADMIN · งวดที่ปิดแล้วแก้ไม่ได้
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restate_opening_units(p_holding_id uuid, p_units numeric, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  h public.investment_holdings; o public.investment_transactions; v_old numeric; v_n int; v_vals int;
BEGIN
  PERFORM private.require_role('ADMIN', 'EDITOR');
  IF p_units IS NULL OR p_units <= 0 THEN
    RAISE EXCEPTION 'INVALID: จำนวนหน่วยต้องมากกว่า 0' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO h FROM public.investment_holdings WHERE id = p_holding_id AND deleted_at IS NULL;
  IF h.id IS NULL OR h.holding_type = 'CASH' THEN
    RAISE EXCEPTION 'INVALID: ไม่พบหลักทรัพย์นี้' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_n FROM public.investment_transactions
   WHERE holding_id = h.id AND deleted_at IS NULL AND transaction_type <> 'OPENING_BALANCE';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'INVALID: มีรายการซื้อขาย / ปันผลแล้ว — แปลงยอดตั้งต้นไม่ได้ ใช้รายการ "ปรับปรุงจำนวน" แทน' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.investment_transactions
   WHERE holding_id = h.id AND deleted_at IS NULL AND transaction_type = 'OPENING_BALANCE'
   ORDER BY transaction_date DESC, created_at DESC LIMIT 1;
  IF o.id IS NULL THEN
    RAISE EXCEPTION 'INVALID: รายการนี้ไม่มียอดตั้งต้น' USING ERRCODE = '22023';
  END IF;
  v_old := o.quantity;
  IF v_old IS NULL OR v_old <= 0 THEN
    RAISE EXCEPTION 'INVALID: ยอดตั้งต้นไม่มีจำนวนหน่วย' USING ERRCODE = '22023';
  END IF;

  -- 1) วิธีนับ → UNITS ก่อน (ให้ราคาในประวัติเก็บได้)
  UPDATE public.investment_holdings SET valuation_mode = 'UNITS' WHERE id = h.id AND valuation_mode <> 'UNITS';

  -- 2) ยอดตั้งต้น: จำนวนใหม่ · ต้นทุนรวมเท่าเดิม (cost_base_currency คงเดิม)
  UPDATE public.investment_transactions
     SET quantity = p_units, price = round(o.amount / p_units, 10),
         notes = left(coalesce(nullif(trim(o.notes), ''), 'ยอดตั้งต้น') || ' · แปลงเป็น ' || p_units::text || ' หน่วย'
                      || coalesce(' (' || nullif(trim(p_notes), '') || ')', ''), 500)
   WHERE id = o.id;

  -- 3) ประวัติราคา: มูลค่าแต่ละวันเท่าเดิม → ราคาต่อหน่วยใหม่
  WITH v AS (
    SELECT x.id, CASE WHEN x.price IS NOT NULL THEN x.price * v_old
                      WHEN x.quantity > 0 THEN x.market_value * v_old / x.quantity
                      ELSE x.market_value END AS val
      FROM public.investment_valuations x WHERE x.holding_id = h.id AND x.deleted_at IS NULL)
  UPDATE public.investment_valuations x
     SET price = round(v.val / p_units, 10), quantity = p_units, market_value = round(v.val, 4)
    FROM v WHERE x.id = v.id;
  GET DIAGNOSTICS v_vals = ROW_COUNT;

  RETURN jsonb_build_object('holding_id', h.id, 'old_quantity', v_old, 'quantity', p_units, 'valuations', v_vals);
END $$;
REVOKE ALL ON FUNCTION public.restate_opening_units(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restate_opening_units(uuid, numeric, text) TO authenticated;
