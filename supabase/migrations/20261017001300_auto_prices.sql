-- =====================================================================
-- ราคาอัตโนมัติ (GitHub Action รายวัน → server_upsert_prices)
--   - เปิดทีละรายการ: หลักทรัพย์ (หุ้น / กองทุน) และทองคำใน Alternative Assets
--   - หุ้นไทย / ต่างประเทศ: Yahoo Finance (แหล่งฟรี ไม่เป็นทางการ) · กองทุนไทย: ก.ล.ต. (SEC Open API ต้องมี Key)
--   - ทองคำ: ประมาณจากราคาทองตลาดโลก × อัตราแลกเปลี่ยน (ต่อบาททองคำ 96.5%) · ปรับตามความบริสุทธิ์
--   - บันทึกเป็นราคา source = MARKET · ไม่ทับราคาจาก Statement / ที่ผู้ใช้บันทึกในวันเดียวกัน
--   - ราคาที่ต่างจากราคาก่อนหน้าเกิน 20% ไม่บันทึก (แจ้งใน Job log) กันอ่านราคาผิดตัว / ผิดหน่วย
-- รันซ้ำได้
-- =====================================================================

ALTER TABLE public.investment_holdings ADD COLUMN IF NOT EXISTS auto_price boolean NOT NULL DEFAULT false;
ALTER TABLE public.investment_holdings ADD COLUMN IF NOT EXISTS price_ref text;
COMMENT ON COLUMN public.investment_holdings.auto_price IS 'ดึงราคาอัตโนมัติรายวัน (หุ้น / กองทุน)';
COMMENT ON COLUMN public.investment_holdings.price_ref IS 'รหัสที่ใช้ดึงราคา: หุ้น = สัญลักษณ์ Yahoo (เช่น PTT.BK) · กองทุน = proj_id ของ ก.ล.ต. (ระบบหาให้จากชื่อย่อ)';
ALTER TABLE public.alternative_asset_details ADD COLUMN IF NOT EXISTS auto_price boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.alternative_asset_details.auto_price IS 'ทองคำ: ประเมินมูลค่าอัตโนมัติจากราคาทองตลาดโลก';

ALTER TABLE public.asset_valuations DROP CONSTRAINT IF EXISTS asset_valuations_source_check;
ALTER TABLE public.asset_valuations ADD CONSTRAINT asset_valuations_source_check CHECK (source IN
  ('STATEMENT','APPRAISAL','USER','ACCOUNT_SETUP','BALANCE_UPDATE','RECONCILIATION','OPENING','MARKET'));

ALTER TABLE public.system_job_runs DROP CONSTRAINT IF EXISTS system_job_runs_job_type_check;
ALTER TABLE public.system_job_runs ADD CONSTRAINT system_job_runs_job_type_check CHECK (job_type IN
  ('FX_FETCH','FX_BACKFILL','BACKUP','RESTORE_TEST','MONTHLY_PDF','PRICE_FETCH'));

-- ---------------------------------------------------------------------
-- รายการที่ต้องดึงราคา (service_role เท่านั้น)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.server_price_targets()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'today', (now() AT TIME ZONE 'Asia/Bangkok')::date,
    'go_live_date', (SELECT f.go_live_date FROM public.families f WHERE f.id = private.default_family_id()),
    'holdings', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', h.id, 'holding_type', h.holding_type, 'name', h.name, 'symbol', h.symbol,
               'price_ref', h.price_ref, 'currency', h.currency, 'last_price', h.current_price) ORDER BY h.name)
        FROM public.investment_holdings h
        JOIN public.investment_portfolios p ON p.id = h.portfolio_id AND p.deleted_at IS NULL
        JOIN public.assets a ON a.id = p.asset_id AND a.deleted_at IS NULL AND a.status = 'ACTIVE'
       WHERE h.deleted_at IS NULL AND h.status = 'ACTIVE' AND h.auto_price AND h.holding_type IN ('EQUITY','FUND')
         AND coalesce(h.quantity, 0) > 0), '[]'::jsonb),
    'gold', coalesce((
      SELECT jsonb_agg(jsonb_build_object('asset_id', a.id, 'name', a.name, 'quantity', d.quantity,
               'unit', coalesce(d.unit, c.default_unit), 'purity_pct', d.purity_pct, 'last_value', a.current_value) ORDER BY a.name)
        FROM public.alternative_asset_details d
        JOIN public.assets a ON a.id = d.asset_id AND a.deleted_at IS NULL AND a.status = 'ACTIVE'
        JOIN public.asset_categories c ON c.id = d.category_id
       WHERE d.deleted_at IS NULL AND d.auto_price AND c.category_code = 'GOLD' AND coalesce(d.quantity, 0) > 0
         AND a.currency = 'THB'), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.server_price_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_price_targets() TO service_role;

-- ---------------------------------------------------------------------
-- บันทึกราคา
--   p_prices: [{kind:'HOLDING', id, date, price, source_reference, price_ref?, reason? (เมื่อหาราคาไม่ได้: price = null)}
--              {kind:'GOLD', asset_id, date, price_per_baht_965, source_reference}]
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.server_upsert_prices(p_prices jsonb, p_job_type text DEFAULT 'PRICE_FETCH')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; n int := 0; v_job bigint; v_skipped jsonb := '[]'::jsonb; v_date date; v_price numeric; v_prev numeric;
  h public.investment_holdings; v_ex public.investment_valuations; v_aex public.asset_valuations;
  d public.alternative_asset_details; a public.assets; v_unit text; v_qty_baht numeric; v_value numeric; v_go_live date;
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
      IF r->>'kind' = 'HOLDING' THEN
        v_price := (r->>'price')::numeric;
        SELECT * INTO h FROM public.investment_holdings WHERE id = (r->>'id')::uuid AND deleted_at IS NULL;
        IF NOT FOUND OR NOT h.auto_price OR h.status <> 'ACTIVE' OR h.holding_type NOT IN ('EQUITY','FUND') THEN
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', r->>'id', 'reason', 'NO_HOLDING'); CONTINUE;
        END IF;
        IF v_price IS NULL OR v_price <= 0 THEN
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', coalesce(h.symbol, h.name), 'reason', coalesce(nullif(r->>'reason', ''), 'NOT_FOUND')); CONTINUE;
        END IF;
        SELECT x.price INTO v_prev FROM public.investment_valuations x
         WHERE x.holding_id = h.id AND x.deleted_at IS NULL AND x.price IS NOT NULL AND x.valuation_date < v_date
         ORDER BY x.valuation_date DESC, x.created_at DESC LIMIT 1;
        v_prev := coalesce(v_prev, h.average_cost);
        IF v_prev IS NOT NULL AND v_prev > 0 AND abs(v_price / v_prev - 1) > 0.2 THEN
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', coalesce(h.symbol, h.name), 'price', v_price, 'previous', v_prev, 'reason', 'DEVIATION_OVER_20PCT');
          CONTINUE;
        END IF;
        IF nullif(r->>'price_ref', '') IS NOT NULL AND h.price_ref IS DISTINCT FROM r->>'price_ref' THEN
          UPDATE public.investment_holdings SET price_ref = r->>'price_ref' WHERE id = h.id;
        END IF;
        SELECT * INTO v_ex FROM public.investment_valuations x
         WHERE x.holding_id = h.id AND x.deleted_at IS NULL AND x.valuation_date = v_date
         ORDER BY (x.source = 'MARKET') DESC LIMIT 1;
        IF FOUND AND v_ex.source <> 'MARKET' THEN
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', coalesce(h.symbol, h.name), 'reason', 'HAS_STATEMENT'); CONTINUE;
        ELSIF FOUND THEN
          UPDATE public.investment_valuations SET price = v_price, quantity = h.quantity, market_value = round(h.quantity * v_price, 4)
           WHERE id = v_ex.id AND (price, quantity) IS DISTINCT FROM (v_price, h.quantity);
        ELSE
          INSERT INTO public.investment_valuations(holding_id, valuation_date, price, quantity, market_value, source)
          VALUES (h.id, v_date, v_price, h.quantity, round(h.quantity * v_price, 4), 'MARKET');
        END IF;
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
        v_prev := a.current_value;
        IF v_prev IS NOT NULL AND v_prev > 0 AND abs(v_value / v_prev - 1) > 0.2 THEN
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', a.name, 'price', v_value, 'previous', v_prev, 'reason', 'DEVIATION_OVER_20PCT');
          CONTINUE;
        END IF;
        SELECT * INTO v_aex FROM public.asset_valuations x
         WHERE x.asset_id = a.id AND x.deleted_at IS NULL AND x.valuation_date = v_date AND NOT x.is_opening
         ORDER BY (x.source = 'MARKET') DESC LIMIT 1;
        IF FOUND AND v_aex.source <> 'MARKET' THEN
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'symbol', a.name, 'reason', 'HAS_STATEMENT'); CONTINUE;
        ELSIF FOUND THEN
          UPDATE public.asset_valuations SET value = v_value, notes = r->>'source_reference' WHERE id = v_aex.id AND value IS DISTINCT FROM v_value;
        ELSE
          INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
          VALUES (a.id, v_date, v_value, 'LATEST_TRANSACTION', 'MARKET', r->>'source_reference');
        END IF;
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
