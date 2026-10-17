-- =====================================================================
-- แหล่งอัตราแลกเปลี่ยน: ธปท. (BOT) หรือ ธนาคารกรุงเทพ (BBL) — เลือกได้ที่ Settings → System (ADMIN)
--   - เปลี่ยนแหล่งแล้ว "อัตราที่บันทึกไว้แล้วไม่เปลี่ยน" · มีผลตั้งแต่อัตราของวันที่เปลี่ยนเป็นต้นไป
--   - อัตราของแหล่งหนึ่งไม่ทับอัตราของอีกแหล่ง (ทับได้เฉพาะแหล่งเดียวกัน · Override ของ ADMIN ไม่ถูกทับเสมอ)
--   - วันที่ตั้งแต่วันที่เปลี่ยน: รับเฉพาะอัตราจากแหล่งปัจจุบัน
--   - BBL: เลือกอัตราที่ใช้ได้ — กลาง (ซื้อ TT + ขาย) ÷ 2 · ซื้อ TT · ขาย
--   - BBL: อัตราที่ต่างจากอัตราก่อนหน้าเกิน 5% ไม่บันทึก (กันหน่วยผิด / อ่านช่องผิด) แล้วรายงานใน Job log
-- รันซ้ำได้
-- =====================================================================

ALTER TABLE public.families ADD COLUMN IF NOT EXISTS fx_source text NOT NULL DEFAULT 'BOT';
ALTER TABLE public.families ADD COLUMN IF NOT EXISTS fx_bbl_rate text NOT NULL DEFAULT 'MID';
ALTER TABLE public.families ADD COLUMN IF NOT EXISTS fx_source_since date;
ALTER TABLE public.families DROP CONSTRAINT IF EXISTS families_fx_source_ck;
ALTER TABLE public.families ADD CONSTRAINT families_fx_source_ck CHECK (fx_source IN ('BOT','BBL'));
ALTER TABLE public.families DROP CONSTRAINT IF EXISTS families_fx_bbl_rate_ck;
ALTER TABLE public.families ADD CONSTRAINT families_fx_bbl_rate_ck CHECK (fx_bbl_rate IN ('MID','BUYING_TT','SELLING'));

ALTER TABLE public.fx_rates DROP CONSTRAINT IF EXISTS fx_rates_source_check;
ALTER TABLE public.fx_rates ADD CONSTRAINT fx_rates_source_check CHECK (source IN ('BOT_API','BBL_API','ADMIN_OVERRIDE'));

-- ---------------------------------------------------------------------
-- ADMIN เลือกแหล่ง (บันทึก Audit)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_fx_source(p_source text, p_bbl_rate text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.families; v_rate text; v_since date;
BEGIN
  PERFORM private.require_role('ADMIN');
  IF p_source NOT IN ('BOT','BBL') THEN RAISE EXCEPTION 'INVALID: แหล่งอัตราต้องเป็น BOT หรือ BBL' USING ERRCODE = '22023'; END IF;
  SELECT * INTO f FROM public.families WHERE id = private.default_family_id() FOR UPDATE;
  v_rate := coalesce(nullif(p_bbl_rate, ''), f.fx_bbl_rate);
  IF v_rate NOT IN ('MID','BUYING_TT','SELLING') THEN RAISE EXCEPTION 'INVALID: ชนิดอัตรา BBL ไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF p_source = f.fx_source AND v_rate = f.fx_bbl_rate THEN
    RETURN jsonb_build_object('source', f.fx_source, 'bbl_rate', f.fx_bbl_rate, 'since', f.fx_source_since, 'changed', false);
  END IF;
  -- วันที่เริ่มใช้ = วันนี้ (เวลาไทย) · เปลี่ยนแค่ชนิดอัตรา BBL ก็นับวันใหม่
  v_since := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  UPDATE public.families SET fx_source = p_source, fx_bbl_rate = v_rate, fx_source_since = v_since WHERE id = f.id;
  PERFORM private.write_audit('UPDATE', 'families', f.id::text,
          jsonb_build_object('kind', 'FX_SOURCE', 'from', f.fx_source, 'to', p_source, 'bbl_rate', v_rate, 'since', v_since), f.id, 'fx_source');
  RETURN jsonb_build_object('source', p_source, 'bbl_rate', v_rate, 'since', v_since, 'changed', true);
END $$;
REVOKE ALL ON FUNCTION public.set_fx_source(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_fx_source(text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- FX Job อ่านการตั้งค่า (service_role เท่านั้น)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.server_fx_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('source', f.fx_source, 'bbl_rate', f.fx_bbl_rate, 'since', f.fx_source_since)
    FROM public.families f WHERE f.id = private.default_family_id()
$$;
REVOKE ALL ON FUNCTION public.server_fx_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_fx_settings() TO service_role;

-- ---------------------------------------------------------------------
-- บันทึกอัตรา: ระบุแหล่ง · ไม่ทับแหล่งอื่น · BBL ตรวจความผิดปกติ
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.server_upsert_fx_rates(jsonb, text);
CREATE OR REPLACE FUNCTION public.server_upsert_fx_rates(p_rates jsonb, p_job_type text DEFAULT 'FX_FETCH', p_source text DEFAULT 'BOT_API')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; n int := 0; v_job bigint; f public.families; v_cur text; v_date date; v_ccy text; v_rate numeric; v_prev numeric;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  IF p_source NOT IN ('BOT_API','BBL_API') THEN RAISE EXCEPTION 'INVALID: แหล่งอัตราไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  SELECT * INTO f FROM public.families WHERE id = private.default_family_id();
  v_cur := CASE coalesce(f.fx_source, 'BOT') WHEN 'BBL' THEN 'BBL_API' ELSE 'BOT_API' END;
  INSERT INTO public.system_job_runs(job_type, result) VALUES (p_job_type, 'RUNNING') RETURNING id INTO v_job;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rates) LOOP
    v_date := (r->>'rate_date')::date; v_ccy := upper(r->>'currency'); v_rate := (r->>'rate_to_thb')::numeric;
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
