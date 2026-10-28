-- =====================================================================
-- ราคาหุ้นไทยอัตโนมัติ (ขอ 28 ต.ค. 2026): ใช้ Price Job เดิม (prices.yml · Yahoo Finance SYMBOL.BK · วันละ 3 รอบ จ.–ศ.)
--   1) รายการหุ้นไทยที่ถืออยู่ (EQUITY · THB · นับเป็นหน่วย · ACTIVE · มีจำนวน) → เปิด "ดึงราคาอัตโนมัติ"
--   2) หุ้นไทยที่สร้างใหม่ → เปิดราคาอัตโนมัติให้เอง (ปิดได้ที่หน้ารายการ)
--   3) ราคาครั้งก่อน: Statement ที่มีแค่มูลค่า + จำนวน (ไม่มีราคาต่อหน่วย) → ใช้ มูลค่า ÷ จำนวน เป็นราคาฐาน
--      → ราคาแรกจาก Yahoo ไม่ต้องกด "ยืนยันเป็นราคาฐาน" ถ้าต่างจาก Statement ไม่เกิน 20%
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2) ตัวตรวจวิธีนับ + เปิดราคาอัตโนมัติให้หุ้นไทยที่สร้างใหม่
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_holding_mode_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.holding_type = 'CASH' THEN NEW.valuation_mode := 'UNITS'; END IF;

  -- หุ้นไทยที่สร้างใหม่ (นับเป็นหน่วย) → ดึงราคาอัตโนมัติเป็นค่าเริ่มต้น
  IF TG_OP = 'INSERT' AND NEW.holding_type = 'EQUITY' AND NEW.currency = 'THB' AND coalesce(NEW.valuation_mode, 'UNITS') = 'UNITS' THEN
    NEW.auto_price := true;
  END IF;

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

-- ---------------------------------------------------------------------
-- 3) บันทึกราคา: ราคาครั้งก่อนใช้ มูลค่า ÷ จำนวน ได้ เมื่อแถวนั้นไม่มีราคาต่อหน่วย (เช่น Statement ยอดยกมา)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.server_upsert_prices(p_prices jsonb, p_job_type text DEFAULT 'PRICE_FETCH')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; n int := 0; v_job bigint; v_skipped jsonb := '[]'::jsonb; v_date date; v_price numeric; v_prev numeric; v_prev_date date;
  h public.investment_holdings; v_ex public.investment_valuations; v_aex public.asset_valuations;
  d public.alternative_asset_details; a public.assets; v_unit text; v_qty_baht numeric; v_value numeric; v_go_live date; v_reason text; v_found boolean;
BEGIN
  INSERT INTO public.system_job_runs(job_type, result) VALUES (p_job_type, 'RUNNING') RETURNING id INTO v_job;
  SELECT f.go_live_date INTO v_go_live FROM public.families f WHERE f.id = private.default_family_id();
  FOR r IN SELECT * FROM jsonb_array_elements(p_prices) LOOP
    v_date := (r->>'date')::date;
    IF v_date IS NULL OR v_date > (now() AT TIME ZONE 'Asia/Bangkok')::date OR v_date < v_go_live THEN
      v_skipped := v_skipped || jsonb_build_object('date', r->>'date', 'symbol', coalesce(r->>'id', r->>'asset_id'), 'reason', 'BAD_DATE');
      CONTINUE;
    END IF;
    BEGIN
      v_prev := NULL; v_prev_date := NULL; v_reason := NULL;
      IF r->>'kind' = 'HOLDING' THEN
        v_price := (r->>'price')::numeric;
        SELECT * INTO h FROM public.investment_holdings WHERE id = (r->>'id')::uuid AND deleted_at IS NULL;
        IF NOT FOUND OR NOT h.auto_price OR h.status <> 'ACTIVE' OR h.holding_type NOT IN ('EQUITY','FUND') THEN
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', r->>'id', 'reason', 'NO_HOLDING'); CONTINUE;
        END IF;
        IF v_price IS NULL OR v_price <= 0 THEN
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', coalesce(h.symbol, h.name), 'reason', coalesce(nullif(r->>'reason', ''), 'NOT_FOUND')); CONTINUE;
        END IF;
        IF nullif(r->>'price_ref', '') IS NOT NULL AND h.price_ref IS DISTINCT FROM r->>'price_ref' THEN
          UPDATE public.investment_holdings SET price_ref = r->>'price_ref' WHERE id = h.id;
        END IF;
        SELECT * INTO v_ex FROM public.investment_valuations x
         WHERE x.holding_id = h.id AND x.deleted_at IS NULL AND x.valuation_date = v_date
         ORDER BY (x.source = 'MARKET') DESC LIMIT 1;
        v_found := FOUND;
        IF v_found AND v_ex.source <> 'MARKET' THEN
          UPDATE public.investment_holdings SET price_pending = NULL WHERE id = h.id AND price_pending IS NOT NULL;
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', coalesce(h.symbol, h.name), 'reason', 'HAS_STATEMENT'); CONTINUE;
        END IF;
        -- ราคาครั้งก่อน (ราคาตลาด / Statement / ผู้ใช้) ภายใน 90 วัน — ไม่ใช้ราคาทุน · ไม่มีราคาต่อหน่วย = มูลค่า ÷ จำนวน
        SELECT coalesce(x.price, round(x.market_value / x.quantity, 10)), x.valuation_date INTO v_prev, v_prev_date FROM public.investment_valuations x
         WHERE x.holding_id = h.id AND x.deleted_at IS NULL AND (x.price > 0 OR (x.price IS NULL AND x.market_value > 0 AND x.quantity > 0))
           AND x.valuation_date <= v_date AND x.valuation_date >= v_date - 90
         ORDER BY x.valuation_date DESC, x.created_at DESC LIMIT 1;
        v_reason := CASE WHEN v_prev IS NULL THEN 'NEEDS_BASELINE' WHEN abs(v_price / v_prev - 1) > 0.2 THEN 'DEVIATION_OVER_20PCT' END;
        IF v_reason IS NOT NULL THEN
          UPDATE public.investment_holdings SET price_pending = jsonb_build_object('date', v_date, 'price', v_price,
                   'previous', v_prev, 'previous_date', v_prev_date, 'reason', v_reason,
                   'source_reference', r->>'source_reference', 'quantity', h.quantity, 'at', now())
           WHERE id = h.id;
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', coalesce(h.symbol, h.name), 'price', v_price, 'previous', v_prev, 'reason', v_reason);
          CONTINUE;
        END IF;
        IF v_found THEN
          UPDATE public.investment_valuations SET price = v_price, quantity = h.quantity, market_value = round(h.quantity * v_price, 4)
           WHERE id = v_ex.id AND (price, quantity) IS DISTINCT FROM (v_price, h.quantity);
        ELSE
          INSERT INTO public.investment_valuations(holding_id, valuation_date, price, quantity, market_value, source)
          VALUES (h.id, v_date, v_price, h.quantity, round(h.quantity * v_price, 4), 'MARKET');
        END IF;
        UPDATE public.investment_holdings SET price_pending = NULL WHERE id = h.id AND price_pending IS NOT NULL;
        n := n + 1;

      ELSIF r->>'kind' = 'GOLD' THEN
        v_price := (r->>'price_per_baht_965')::numeric;               -- บาท ต่อ 1 บาททองคำ 96.5% (ราคารับซื้อของสมาคมค้าทองคำ ตามชนิดทอง)
        SELECT * INTO d FROM public.alternative_asset_details WHERE asset_id = (r->>'asset_id')::uuid AND deleted_at IS NULL;
        SELECT * INTO a FROM public.assets WHERE id = d.asset_id AND deleted_at IS NULL;
        IF d.id IS NULL OR a.id IS NULL OR NOT d.auto_price OR a.status <> 'ACTIVE' THEN
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', r->>'asset_id', 'reason', 'NO_HOLDING'); CONTINUE;
        END IF;
        IF v_price IS NULL OR v_price <= 0 THEN
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', a.name, 'reason', coalesce(nullif(r->>'reason', ''), 'NOT_FOUND')); CONTINUE;
        END IF;
        v_value := private.gold_value(d.asset_id, v_price);
        IF v_value IS NULL THEN
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', a.name, 'reason', 'UNIT'); CONTINUE;
        END IF;
        SELECT * INTO v_aex FROM public.asset_valuations x
         WHERE x.asset_id = a.id AND x.deleted_at IS NULL AND x.valuation_date = v_date AND NOT x.is_opening
         ORDER BY (x.source = 'MARKET') DESC LIMIT 1;
        v_found := FOUND;
        IF v_found AND v_aex.source <> 'MARKET' THEN
          UPDATE public.alternative_asset_details SET price_pending = NULL WHERE id = d.id AND price_pending IS NOT NULL;
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', a.name, 'reason', 'HAS_STATEMENT'); CONTINUE;
        END IF;
        -- มูลค่าครั้งก่อน (ราคาตลาด / ประเมิน / ผู้ใช้ / ยอดตั้งต้น) ภายใน 90 วัน — ไม่ใช้มูลค่าปัจจุบัน / ราคาซื้อ
        SELECT x.value, x.valuation_date INTO v_prev, v_prev_date FROM public.asset_valuations x
         WHERE x.asset_id = a.id AND x.deleted_at IS NULL AND x.source <> 'ACCOUNT_SETUP' AND x.value > 0
           AND x.valuation_date <= v_date AND x.valuation_date >= v_date - 90
         ORDER BY x.valuation_date DESC, x.created_at DESC LIMIT 1;
        v_reason := CASE WHEN v_prev IS NULL THEN 'NEEDS_BASELINE' WHEN abs(v_value / v_prev - 1) > 0.2 THEN 'DEVIATION_OVER_20PCT' END;
        IF v_reason IS NOT NULL THEN
          UPDATE public.alternative_asset_details SET price_pending = jsonb_build_object('date', v_date, 'value', v_value,
                   'price_per_baht_965', v_price, 'world_per_baht_965', (r->>'world_per_baht_965')::numeric, 'previous', v_prev, 'previous_date', v_prev_date, 'reason', v_reason,
                   'source_reference', r->>'source_reference', 'quantity', d.quantity, 'at', now())
           WHERE id = d.id;
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', a.name, 'price', v_value, 'previous', v_prev, 'reason', v_reason);
          CONTINUE;
        END IF;
        IF v_found THEN
          UPDATE public.asset_valuations SET value = v_value, notes = r->>'source_reference' WHERE id = v_aex.id AND value IS DISTINCT FROM v_value;
        ELSE
          INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
          VALUES (a.id, v_date, v_value, 'LATEST_TRANSACTION', 'MARKET', r->>'source_reference');
        END IF;
        UPDATE public.alternative_asset_details SET price_pending = NULL WHERE id = d.id AND price_pending IS NOT NULL;
        n := n + 1;
      END IF;
    EXCEPTION WHEN others THEN
      -- เช่น เดือนนั้นปิดงวดแล้ว → ข้ามรายการนี้ ทำรายการอื่นต่อ
      v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', coalesce(r->>'id', r->>'asset_id'), 'reason', left(SQLERRM, 120));
    END;
  END LOOP;
  UPDATE public.system_job_runs SET result = CASE WHEN jsonb_array_length(v_skipped) > 0 THEN 'PARTIAL' ELSE 'SUCCESS' END,
         finished_at = now(), details = jsonb_build_object('rows', n, 'skipped', v_skipped) WHERE id = v_job;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.server_upsert_prices(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_upsert_prices(jsonb, text) TO service_role;

-- ---------------------------------------------------------------------
-- 1) เปิดราคาอัตโนมัติให้หุ้นไทยที่ถืออยู่ (รันซ้ำได้ · ปิดทีละรายการได้ที่หน้ารายการ)
-- ---------------------------------------------------------------------
UPDATE public.investment_holdings h SET auto_price = true
 WHERE h.deleted_at IS NULL AND h.status = 'ACTIVE' AND NOT h.auto_price
   AND h.holding_type = 'EQUITY' AND h.currency = 'THB' AND h.valuation_mode = 'UNITS' AND coalesce(h.quantity, 0) > 0;
