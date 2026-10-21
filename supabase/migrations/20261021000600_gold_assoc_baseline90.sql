-- =====================================================================
-- ทองคำ: ราคาสมาคมค้าทองคำ · ชนิดทอง (แท่ง / รูปพรรณ) · หักต่อบาททองคำ · ใส่ราคาต่อบาทเอง
-- ราคาอัตโนมัติ: ราคาครั้งก่อนเทียบได้ภายใน 90 วัน (เดิม 30 วัน) (ตกลง 21 ต.ค. 2569)
--   - alternative_asset_details.gold_form: BAR (ทองคำแท่ง · ค่าตั้งต้น) / ORNAMENT (ทองรูปพรรณ)
--   - alternative_asset_details.deduct_per_baht: ทองรูปพรรณ หัก (บาท ต่อ 1 บาททองคำ) จากราคารับซื้อ
--   - private.gold_value(): สูตรเดียวทั้งระบบ = จำนวน (บาททองคำ) × ราคา × ความบริสุทธิ์ ÷ 96.5 − จำนวน × ค่าหัก (รูปพรรณ) · ไม่ต่ำกว่า 0
--   - Job ราคา: ใช้ราคารับซื้อของสมาคมค้าทองคำ (แท่ง / รูปพรรณ ตามชนิด) · ราคาโลก × USD/THB เก็บไว้เทียบ
--   - add_gold_valuation(): ผู้ใช้ใส่ราคาต่อบาททองคำ → ระบบคำนวณมูลค่า (SECURITY INVOKER · RLS + Trigger งวดบัญชีมีผล)
-- ไม่แก้ข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

ALTER TABLE public.alternative_asset_details ADD COLUMN IF NOT EXISTS gold_form text;
ALTER TABLE public.alternative_asset_details ADD COLUMN IF NOT EXISTS deduct_per_baht numeric(14,2);
ALTER TABLE public.alternative_asset_details DROP CONSTRAINT IF EXISTS aad_gold_form_ck;
ALTER TABLE public.alternative_asset_details ADD CONSTRAINT aad_gold_form_ck CHECK (gold_form IS NULL OR gold_form IN ('BAR','ORNAMENT'));
ALTER TABLE public.alternative_asset_details DROP CONSTRAINT IF EXISTS aad_deduct_per_baht_ck;
ALTER TABLE public.alternative_asset_details ADD CONSTRAINT aad_deduct_per_baht_ck CHECK (deduct_per_baht IS NULL OR deduct_per_baht >= 0);
COMMENT ON COLUMN public.alternative_asset_details.gold_form IS 'ทองคำ: BAR = ทองคำแท่ง (ค่าตั้งต้น) · ORNAMENT = ทองรูปพรรณ — เลือกราคารับซื้อของสมาคมค้าทองคำ';
COMMENT ON COLUMN public.alternative_asset_details.deduct_per_baht IS 'ทองรูปพรรณ: หักจากราคารับซื้อ (บาท ต่อ 1 บาททองคำ)';

-- มูลค่าทองคำ (บาท) จากราคาต่อ 1 บาททองคำ 96.5% · NULL = หน่วยไม่ใช่ กรัม / บาททองคำ หรือไม่มีจำนวน
CREATE OR REPLACE FUNCTION private.gold_value(p_asset_id uuid, p_price_per_baht numeric) RETURNS numeric
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN q.qty_baht IS NULL OR p_price_per_baht IS NULL THEN NULL
              ELSE greatest(0, round(q.qty_baht * p_price_per_baht * coalesce(q.purity_pct, 96.5) / 96.5
                                     - CASE WHEN q.gold_form = 'ORNAMENT' THEN q.qty_baht * coalesce(q.deduct_per_baht, 0) ELSE 0 END, 2)) END
    FROM (SELECT d.purity_pct, d.gold_form, d.deduct_per_baht,
                 CASE coalesce(d.unit, c.default_unit) WHEN 'กรัม' THEN d.quantity / 15.244 WHEN 'บาททองคำ' THEN d.quantity END AS qty_baht
            FROM public.alternative_asset_details d
            JOIN public.asset_categories c ON c.id = d.category_id
           WHERE d.asset_id = p_asset_id AND d.deleted_at IS NULL) q
$$;

-- ---------------------------------------------------------------------
-- รายการที่ต้องดึงราคา (+ ชนิดทอง / ค่าหัก)
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
               'unit', coalesce(d.unit, c.default_unit), 'purity_pct', d.purity_pct, 'last_value', a.current_value,
               'gold_form', coalesce(d.gold_form, 'BAR'), 'deduct_per_baht', d.deduct_per_baht) ORDER BY a.name)
        FROM public.alternative_asset_details d
        JOIN public.assets a ON a.id = d.asset_id AND a.deleted_at IS NULL AND a.status = 'ACTIVE'
        JOIN public.asset_categories c ON c.id = d.category_id
       WHERE d.deleted_at IS NULL AND d.auto_price AND c.category_code = 'GOLD' AND coalesce(d.quantity, 0) > 0
         AND a.currency = 'THB'), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.server_price_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_price_targets() TO service_role;

-- ---------------------------------------------------------------------
-- บันทึกราคา: ราคาครั้งก่อน 90 วัน · ทองคำผ่าน private.gold_value · ไม่มีราคา = ข้ามพร้อมเหตุผล
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
        -- ราคาครั้งก่อน (ราคาตลาด / Statement / ผู้ใช้) ภายใน 90 วัน — ไม่ใช้ราคาทุน
        SELECT x.price, x.valuation_date INTO v_prev, v_prev_date FROM public.investment_valuations x
         WHERE x.holding_id = h.id AND x.deleted_at IS NULL AND x.price IS NOT NULL AND x.price > 0
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
-- ใส่ราคาทองเอง: ราคาต่อ 1 บาททองคำ (96.5%) → มูลค่า (สูตรเดียวกับ Job)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_gold_valuation(p_asset_id uuid, p_date date, p_price_per_baht numeric,
  p_method text DEFAULT 'LATEST_TRANSACTION', p_notes text DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_value numeric; d public.alternative_asset_details; v_note text;
BEGIN
  IF p_price_per_baht IS NULL OR p_price_per_baht <= 0 THEN
    RAISE EXCEPTION 'INVALID: ราคาต่อบาททองคำต้องมากกว่า 0' USING ERRCODE = '22023';
  END IF;
  IF p_method NOT IN ('LATEST_TRANSACTION','APPRAISAL','USER_ESTIMATE') THEN
    RAISE EXCEPTION 'INVALID: วิธีประเมินไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM public.alternative_asset_details WHERE asset_id = p_asset_id AND deleted_at IS NULL;
  IF d.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบทองคำรายการนี้' USING ERRCODE = 'P0002'; END IF;
  v_value := private.gold_value(p_asset_id, p_price_per_baht);
  IF v_value IS NULL THEN
    RAISE EXCEPTION 'INVALID: ต้องมีจำนวน และหน่วยเป็น กรัม หรือ บาททองคำ' USING ERRCODE = '22023';
  END IF;
  v_note := 'ราคาทอง ' || to_char(p_price_per_baht, 'FM999,999,990.00') || ' บาท/บาททองคำ (96.5%)'
         || CASE WHEN d.gold_form = 'ORNAMENT' AND coalesce(d.deduct_per_baht, 0) > 0
                 THEN ' · หัก ' || to_char(d.deduct_per_baht, 'FM999,999,990.00') || '/บาททองคำ' ELSE '' END
         || CASE WHEN nullif(trim(p_notes), '') IS NOT NULL THEN ' · ' || trim(p_notes) ELSE '' END;
  INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
  VALUES (p_asset_id, p_date, v_value, p_method, CASE WHEN p_method = 'APPRAISAL' THEN 'APPRAISAL' ELSE 'USER' END, left(v_note, 500));
  RETURN v_value;
END $$;
REVOKE ALL ON FUNCTION public.add_gold_valuation(uuid, date, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_gold_valuation(uuid, date, numeric, text, text) TO authenticated;
