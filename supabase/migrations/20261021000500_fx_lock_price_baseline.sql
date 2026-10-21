-- =====================================================================
-- ก. อัตราแลกเปลี่ยนในเดือนที่ปิดงวดแล้ว (FINAL) แก้ / เพิ่ม / ลบไม่ได้ (ตกลง 21 ต.ค. 2569)
--    - Trigger t20_period_lock บน fx_rates: ทุกการเขียน (ADMIN Override และงานระบบ) ที่ rate_date ≤ วันสุดท้ายของงวดที่ปิด → Block
--      (ไม่ใช้ tg_period_lock ทั่วไป เพราะมีกฎก่อน Go-live ด้วย — อัตราก่อน Go-live ต้องเพิ่มย้อนหลังได้)
--    - server_upsert_fx_rates: วันที่อยู่ในงวดที่ปิด → ข้าม (PERIOD_LOCKED) ไม่ให้ Job ทั้งชุดล้ม
-- ข. ราคาอัตโนมัติ: ราคาฐานที่ตรวจสอบได้ + กัน 20% เทียบราคาตลาดครั้งก่อน
--    - ราคาครั้งก่อน = ราคา / มูลค่าที่บันทึกแล้ว (Statement · ผู้ใช้ · ราคาตลาด) ภายใน 30 วันถึงวันของราคา (รวมราคาตลาดของวันเดียวกันที่ดึงรอบก่อน)
--      เลิกเทียบกับราคาทุนเฉลี่ย (หุ้น / กองทุน) และมูลค่าปัจจุบัน (ทองคำ)
--    - ไม่มีราคาครั้งก่อน (ครั้งแรก / เว้นไปเกิน 30 วัน) = NEEDS_BASELINE · ต่างเกิน 20% = DEVIATION_OVER_20PCT
--      → ไม่บันทึก เก็บเป็น "ราคารอยืนยัน" (price_pending) ให้ ADMIN / EDITOR กดยืนยัน หรือบันทึกราคาจาก Statement เอง
--    - confirm_pending_price / dismiss_pending_price (SECURITY INVOKER — RLS + Trigger งวดบัญชีมีผล)
-- ไม่แก้ข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- ---------------------------------------------------------------------
-- ก. ล็อกอัตราในงวดที่ปิด
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_fx_period_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_locked date := private.locked_through(private.default_family_id());
BEGIN
  IF v_locked IS NOT NULL AND (
       (TG_OP IN ('INSERT','UPDATE') AND NEW.rate_date <= v_locked) OR
       (TG_OP IN ('UPDATE','DELETE') AND OLD.rate_date <= v_locked)) THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: อัตราแลกเปลี่ยนวันที่ % อยู่ในงวดที่ปิดแล้ว (ถึง %) ต้อง Reopen ก่อน',
      CASE WHEN TG_OP = 'DELETE' THEN OLD.rate_date ELSE NEW.rate_date END, v_locked USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS t20_period_lock ON public.fx_rates;
CREATE TRIGGER t20_period_lock BEFORE INSERT OR UPDATE OR DELETE ON public.fx_rates
  FOR EACH ROW EXECUTE FUNCTION private.tg_fx_period_lock();

CREATE OR REPLACE FUNCTION public.server_upsert_fx_rates(p_rates jsonb, p_job_type text DEFAULT 'FX_FETCH', p_source text DEFAULT 'BOT_API')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; n int := 0; v_job bigint; f public.families; v_cur text; v_date date; v_ccy text; v_rate numeric; v_prev numeric;
  v_skipped jsonb := '[]'::jsonb; v_locked date := private.locked_through(private.default_family_id());
BEGIN
  IF p_source NOT IN ('BOT_API','BBL_API') THEN RAISE EXCEPTION 'INVALID: แหล่งอัตราไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  SELECT * INTO f FROM public.families WHERE id = private.default_family_id();
  v_cur := CASE coalesce(f.fx_source, 'BOT') WHEN 'BBL' THEN 'BBL_API' ELSE 'BOT_API' END;
  INSERT INTO public.system_job_runs(job_type, result) VALUES (p_job_type, 'RUNNING') RETURNING id INTO v_job;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rates) LOOP
    v_date := (r->>'rate_date')::date; v_ccy := upper(r->>'currency'); v_rate := (r->>'rate_to_thb')::numeric;
    -- งวดที่ปิดแล้ว: ไม่แตะ (ไม่ให้ทั้ง Job ล้ม)
    IF v_locked IS NOT NULL AND v_date <= v_locked THEN
      IF NOT EXISTS (SELECT 1 FROM public.fx_rates x WHERE x.currency = v_ccy AND x.rate_date = v_date AND x.deleted_at IS NULL
                       AND x.rate_type = 'MID_AVERAGE' AND x.rate_to_thb = v_rate) THEN
        v_skipped := v_skipped || jsonb_build_object('date', v_date, 'currency', v_ccy, 'reason', 'PERIOD_LOCKED');
      END IF;
      CONTINUE;
    END IF;
    -- ตั้งแต่วันที่เปลี่ยนแหล่ง: รับเฉพาะแหล่งปัจจุบัน
    IF f.fx_source_since IS NOT NULL AND v_date >= f.fx_source_since AND p_source <> v_cur THEN
      v_skipped := v_skipped || jsonb_build_object('date', v_date, 'currency', v_ccy, 'reason', 'NOT_CURRENT_SOURCE');
      CONTINUE;
    END IF;
    IF p_source = 'BBL_API' THEN
      SELECT x.rate_to_thb INTO v_prev FROM public.fx_rates x
       WHERE x.currency = v_ccy AND x.deleted_at IS NULL AND x.rate_date < v_date AND x.rate_date >= v_date - 30
       ORDER BY x.rate_date DESC LIMIT 1;
      IF v_prev IS NOT NULL AND abs(v_rate / v_prev - 1) > 0.05 THEN
        v_skipped := v_skipped || jsonb_build_object('date', v_date, 'currency', v_ccy, 'rate', v_rate, 'previous', v_prev, 'reason', 'DEVIATION_OVER_5PCT');
        CONTINUE;
      END IF;
    END IF;
    INSERT INTO public.fx_rates(rate_date, currency, rate_to_thb, source, source_reference, fetched_at)
    VALUES (v_date, v_ccy, v_rate, p_source, r->>'source_reference', now())
    ON CONFLICT (rate_date, currency, rate_type) WHERE deleted_at IS NULL
    DO UPDATE SET rate_to_thb = EXCLUDED.rate_to_thb, source_reference = EXCLUDED.source_reference,
                  fetched_at = EXCLUDED.fetched_at
          WHERE NOT public.fx_rates.is_override AND public.fx_rates.source = EXCLUDED.source
            AND public.fx_rates.rate_to_thb IS DISTINCT FROM EXCLUDED.rate_to_thb;
    n := n + 1;
  END LOOP;
  UPDATE public.system_job_runs SET result = CASE WHEN jsonb_array_length(v_skipped) > 0 THEN 'PARTIAL' ELSE 'SUCCESS' END,
         finished_at = now(), details = jsonb_build_object('rows', n, 'source', p_source, 'skipped', v_skipped) WHERE id = v_job;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.server_upsert_fx_rates(jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_upsert_fx_rates(jsonb, text, text) TO service_role;

-- ---------------------------------------------------------------------
-- ข. ราคารอยืนยัน
-- ---------------------------------------------------------------------
ALTER TABLE public.investment_holdings ADD COLUMN IF NOT EXISTS price_pending jsonb;
ALTER TABLE public.alternative_asset_details ADD COLUMN IF NOT EXISTS price_pending jsonb;
COMMENT ON COLUMN public.investment_holdings.price_pending IS
  'ราคาอัตโนมัติที่รอยืนยัน {date, price, previous, previous_date, reason (NEEDS_BASELINE / DEVIATION_OVER_20PCT), source_reference, quantity, at} · เขียนโดย Job เท่านั้น';
COMMENT ON COLUMN public.alternative_asset_details.price_pending IS
  'มูลค่าทองคำอัตโนมัติที่รอยืนยัน {date, value, price_per_baht_965, previous, previous_date, reason, source_reference, quantity, at} · เขียนโดย Job เท่านั้น';

-- ผู้ใช้แก้ price_pending ตรงไม่ได้ (เขียนได้เฉพาะ Job / ล้างผ่าน confirm / dismiss)
CREATE OR REPLACE FUNCTION private.tg_price_pending_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF private.is_client() AND NEW.price_pending IS DISTINCT FROM OLD.price_pending
     AND NOT (NEW.price_pending IS NULL AND current_setting('fwv.price_pending_clear', true) = 'on') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: ราคารอยืนยันแก้ตรงไม่ได้ (ใช้ปุ่มยืนยัน / ไม่ใช้ราคานี้)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t55_price_pending ON public.investment_holdings;
CREATE TRIGGER t55_price_pending BEFORE UPDATE ON public.investment_holdings
  FOR EACH ROW EXECUTE FUNCTION private.tg_price_pending_guard();
DROP TRIGGER IF EXISTS t55_price_pending ON public.alternative_asset_details;
CREATE TRIGGER t55_price_pending BEFORE UPDATE ON public.alternative_asset_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_price_pending_guard();

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
        -- ราคาครั้งก่อน (ราคาตลาด / Statement / ผู้ใช้) ภายใน 30 วัน — ไม่ใช้ราคาทุน
        SELECT x.price, x.valuation_date INTO v_prev, v_prev_date FROM public.investment_valuations x
         WHERE x.holding_id = h.id AND x.deleted_at IS NULL AND x.price IS NOT NULL AND x.price > 0
           AND x.valuation_date <= v_date AND x.valuation_date >= v_date - 30
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
        v_price := (r->>'price_per_baht_965')::numeric;               -- บาท ต่อ 1 บาททองคำ ความบริสุทธิ์ 96.5%
        SELECT * INTO d FROM public.alternative_asset_details WHERE asset_id = (r->>'asset_id')::uuid AND deleted_at IS NULL;
        SELECT * INTO a FROM public.assets WHERE id = d.asset_id AND deleted_at IS NULL;
        IF d.id IS NULL OR a.id IS NULL OR NOT d.auto_price OR a.status <> 'ACTIVE' OR v_price IS NULL OR v_price <= 0 THEN
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', r->>'asset_id', 'reason', 'NO_HOLDING'); CONTINUE;
        END IF;
        SELECT coalesce(d.unit, c.default_unit) INTO v_unit FROM public.asset_categories c WHERE c.id = d.category_id;
        v_qty_baht := CASE WHEN v_unit = 'กรัม' THEN d.quantity / 15.244 WHEN v_unit = 'บาททองคำ' THEN d.quantity END;
        IF v_qty_baht IS NULL THEN
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', a.name, 'reason', 'UNIT'); CONTINUE;
        END IF;
        v_value := round(v_qty_baht * v_price * coalesce(d.purity_pct, 96.5) / 96.5, 2);
        SELECT * INTO v_aex FROM public.asset_valuations x
         WHERE x.asset_id = a.id AND x.deleted_at IS NULL AND x.valuation_date = v_date AND NOT x.is_opening
         ORDER BY (x.source = 'MARKET') DESC LIMIT 1;
        v_found := FOUND;
        IF v_found AND v_aex.source <> 'MARKET' THEN
          UPDATE public.alternative_asset_details SET price_pending = NULL WHERE id = d.id AND price_pending IS NOT NULL;
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', a.name, 'reason', 'HAS_STATEMENT'); CONTINUE;
        END IF;
        -- มูลค่าครั้งก่อน (ราคาตลาด / ประเมิน / ผู้ใช้ / ยอดตั้งต้น) ภายใน 30 วัน — ไม่ใช้มูลค่าปัจจุบัน / ราคาซื้อ
        SELECT x.value, x.valuation_date INTO v_prev, v_prev_date FROM public.asset_valuations x
         WHERE x.asset_id = a.id AND x.deleted_at IS NULL AND x.source <> 'ACCOUNT_SETUP' AND x.value > 0
           AND x.valuation_date <= v_date AND x.valuation_date >= v_date - 30
         ORDER BY x.valuation_date DESC, x.created_at DESC LIMIT 1;
        v_reason := CASE WHEN v_prev IS NULL THEN 'NEEDS_BASELINE' WHEN abs(v_value / v_prev - 1) > 0.2 THEN 'DEVIATION_OVER_20PCT' END;
        IF v_reason IS NOT NULL THEN
          UPDATE public.alternative_asset_details SET price_pending = jsonb_build_object('date', v_date, 'value', v_value,
                   'price_per_baht_965', v_price, 'previous', v_prev, 'previous_date', v_prev_date, 'reason', v_reason,
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
-- ยืนยันราคารอยืนยัน → บันทึกเป็นราคาตลาด (ราคาฐาน) · ไม่ใช้ราคานี้ → ล้าง
--   ระบุอย่างใดอย่างหนึ่ง: p_holding_id (หุ้น / กองทุน) หรือ p_asset_id (ทองคำ)
--   SECURITY INVOKER: RLS + Trigger งวดบัญชี / Go-live ของตารางราคามีผลตามปกติ
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_pending_price(p_holding_id uuid DEFAULT NULL, p_asset_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE h public.investment_holdings; d public.alternative_asset_details; p jsonb; v_date date;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF (p_holding_id IS NULL) = (p_asset_id IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ระบุหลักทรัพย์หรือทองคำอย่างใดอย่างหนึ่ง' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('fwv.price_pending_clear', 'on', true);
  IF p_holding_id IS NOT NULL THEN
    SELECT * INTO h FROM public.investment_holdings WHERE id = p_holding_id AND deleted_at IS NULL;
    p := h.price_pending;
    IF p IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่มีราคารอยืนยัน' USING ERRCODE = 'P0002'; END IF;
    v_date := (p->>'date')::date;
    IF h.quantity IS DISTINCT FROM (p->>'quantity')::numeric THEN
      UPDATE public.investment_holdings SET price_pending = NULL WHERE id = h.id;
      RAISE EXCEPTION 'STALE: จำนวนหน่วยเปลี่ยนหลังดึงราคา — รอราคารอบถัดไป หรือบันทึกราคาจาก Statement' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.investment_valuations x WHERE x.holding_id = h.id AND x.deleted_at IS NULL AND x.valuation_date = v_date) THEN
      UPDATE public.investment_holdings SET price_pending = NULL WHERE id = h.id;
      RETURN jsonb_build_object('confirmed', false, 'reason', 'HAS_VALUATION');
    END IF;
    INSERT INTO public.investment_valuations(holding_id, valuation_date, price, quantity, market_value, source)
    VALUES (h.id, v_date, (p->>'price')::numeric, h.quantity, round(h.quantity * (p->>'price')::numeric, 4), 'MARKET');
    UPDATE public.investment_holdings SET price_pending = NULL WHERE id = h.id;
  ELSE
    SELECT * INTO d FROM public.alternative_asset_details WHERE asset_id = p_asset_id AND deleted_at IS NULL;
    p := d.price_pending;
    IF p IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่มีราคารอยืนยัน' USING ERRCODE = 'P0002'; END IF;
    v_date := (p->>'date')::date;
    IF d.quantity IS DISTINCT FROM (p->>'quantity')::numeric THEN
      UPDATE public.alternative_asset_details SET price_pending = NULL WHERE id = d.id;
      RAISE EXCEPTION 'STALE: จำนวนเปลี่ยนหลังดึงราคา — รอราคารอบถัดไป หรือบันทึกมูลค่าเอง' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.asset_valuations x WHERE x.asset_id = d.asset_id AND x.deleted_at IS NULL
                 AND x.valuation_date = v_date AND NOT x.is_opening) THEN
      UPDATE public.alternative_asset_details SET price_pending = NULL WHERE id = d.id;
      RETURN jsonb_build_object('confirmed', false, 'reason', 'HAS_VALUATION');
    END IF;
    INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
    VALUES (d.asset_id, v_date, (p->>'value')::numeric, 'LATEST_TRANSACTION', 'MARKET',
            left('ยืนยันราคาฐาน · ' || coalesce(p->>'source_reference', ''), 500));
    UPDATE public.alternative_asset_details SET price_pending = NULL WHERE id = d.id;
  END IF;
  RETURN jsonb_build_object('confirmed', true, 'date', v_date);
END $$;
REVOKE ALL ON FUNCTION public.confirm_pending_price(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_pending_price(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.dismiss_pending_price(p_holding_id uuid DEFAULT NULL, p_asset_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  PERFORM set_config('fwv.price_pending_clear', 'on', true);
  IF p_holding_id IS NOT NULL THEN
    UPDATE public.investment_holdings SET price_pending = NULL WHERE id = p_holding_id AND price_pending IS NOT NULL;
  END IF;
  IF p_asset_id IS NOT NULL THEN
    UPDATE public.alternative_asset_details SET price_pending = NULL WHERE asset_id = p_asset_id AND price_pending IS NOT NULL;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.dismiss_pending_price(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_pending_price(uuid, uuid) TO authenticated;
