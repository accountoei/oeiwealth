-- =====================================================================
-- อัตราแลกเปลี่ยนตาม Statement ของพอร์ตต่างประเทศ (ตกลง 12 พ.ย. 2026)
--   ปัญหา: พอร์ต USD ที่มีเงินฝาก / หลักทรัพย์ AUD, NZD → มูลค่า USD ของระบบ (แปลงผ่านอัตรา ธปท.) ไม่ตรง Statement ของธนาคาร
--   statement_fx = อัตราของธนาคาร ต่อ 1 หน่วยสกุลอื่น เป็นสกุลพอร์ต เช่น {"AUD": 0.6953, "NZD": 0.5639} · statement_fx_date = วันที่ของ Statement
--   ใช้เฉพาะ "มูลค่าในสกุลพอร์ต" (v_portfolio_values.portfolio_value) — มูลค่าเป็นบาท / ความมั่งคั่งสุทธิ / Month Closing ยังใช้อัตรา ธปท. เหมือนเดิม
--   สกุลที่ไม่ได้ใส่อัตรา / พอร์ตเงินบาท → แปลงผ่านอัตรา ธปท. เหมือนเดิม
-- รันซ้ำได้ · ไม่แก้ข้อมูลเดิม
-- =====================================================================
ALTER TABLE public.investment_portfolios ADD COLUMN IF NOT EXISTS statement_fx jsonb;
ALTER TABLE public.investment_portfolios ADD COLUMN IF NOT EXISTS statement_fx_date date;

-- 1) ตรวจรูปแบบ: {"AUD": ตัวเลข > 0, ...} · ไม่มีสกุลพอร์ตเอง · มีอัตรา = ต้องมีวันที่ ------------------------
CREATE OR REPLACE FUNCTION private.tg_statement_fx_check()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ccy text;
BEGIN
  IF NEW.statement_fx = '{}'::jsonb THEN NEW.statement_fx := NULL; END IF;
  IF NEW.statement_fx IS NULL THEN NEW.statement_fx_date := NULL; RETURN NEW; END IF;
  SELECT currency INTO v_ccy FROM public.assets WHERE id = NEW.asset_id;
  IF jsonb_typeof(NEW.statement_fx) <> 'object' OR EXISTS (
       SELECT 1 FROM jsonb_each(NEW.statement_fx) e
        WHERE e.key !~ '^[A-Z]{3}$' OR e.key = v_ccy OR jsonb_typeof(e.value) <> 'number' OR (e.value #>> '{}')::numeric <= 0) THEN
    RAISE EXCEPTION 'INVALID: อัตราตาม Statement ต้องเป็นตัวเลขมากกว่า 0 ของสกุลอื่นที่ไม่ใช่สกุลพอร์ต' USING ERRCODE = '22023';
  END IF;
  IF NEW.statement_fx_date IS NULL THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่วันที่ของอัตราตาม Statement' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_statement_fx_check() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t22_statement_fx_check ON public.investment_portfolios;
CREATE TRIGGER t22_statement_fx_check BEFORE INSERT OR UPDATE OF statement_fx, statement_fx_date ON public.investment_portfolios
  FOR EACH ROW EXECUTE FUNCTION private.tg_statement_fx_check();

-- 2) แก้รายละเอียดพอร์ต: รับ statement_fx / statement_fx_date (แก้เฉพาะเมื่อส่ง key มา) --------------------
CREATE OR REPLACE FUNCTION public.update_portfolio(p_asset_id uuid, p jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.assets; v_name text; v_ccy text; v_type text; v_n int;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id AND asset_type = 'INVESTMENT_PORTFOLIO' AND deleted_at IS NULL;
  IF a.id IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบพอร์ตนี้' USING ERRCODE = '22023'; END IF;
  v_name := nullif(trim(coalesce(p->>'name', '')), '');
  IF v_name IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อพอร์ต' USING ERRCODE = '22023'; END IF;
  v_ccy := upper(coalesce(nullif(trim(p->>'currency'), ''), a.currency));
  IF v_ccy !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'INVALID: สกุลเงินไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_ccy <> 'THB' AND private.fx_rate(v_ccy, current_date) IS NULL THEN
    RAISE EXCEPTION 'INVALID: ยังไม่มีอัตราแลกเปลี่ยน % ในระบบ', v_ccy USING ERRCODE = '22023';
  END IF;
  v_type := coalesce(nullif(p->>'portfolio_type', ''), (SELECT portfolio_type FROM public.investment_portfolios WHERE asset_id = a.id));

  UPDATE public.assets SET name = v_name, currency = v_ccy, notes = nullif(trim(coalesce(p->>'notes', '')), '')
   WHERE id = a.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'PERMISSION_DENIED: ไม่มีสิทธิ์แก้ไขพอร์ตนี้' USING ERRCODE = '42501'; END IF;
  UPDATE public.investment_portfolios
     SET institution = coalesce(nullif(trim(coalesce(p->>'institution', '')), ''), institution), portfolio_type = v_type
   WHERE asset_id = a.id AND deleted_at IS NULL;
  -- เปลี่ยนสกุลพอร์ต → อัตราเดิมใช้ไม่ได้ ล้างทิ้ง · ส่ง statement_fx มา → แทนที่ทั้งชุด
  IF v_ccy <> a.currency OR v_ccy = 'THB' THEN
    UPDATE public.investment_portfolios SET statement_fx = NULL, statement_fx_date = NULL WHERE asset_id = a.id AND deleted_at IS NULL;
  ELSIF p ? 'statement_fx' THEN
    UPDATE public.investment_portfolios
       SET statement_fx = CASE WHEN jsonb_typeof(p->'statement_fx') = 'object' THEN p->'statement_fx' END,
           statement_fx_date = nullif(p->>'statement_fx_date', '')::date
     WHERE asset_id = a.id AND deleted_at IS NULL;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.update_portfolio(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_portfolio(uuid, jsonb) TO authenticated;

-- 3) มูลค่าในสกุลพอร์ต: สกุลที่มีอัตราตาม Statement → มูลค่าสกุลเดิม × อัตรานั้น · อื่น ๆ → บาท ÷ อัตราสกุลพอร์ต (เหมือนเดิม) ----
CREATE OR REPLACE VIEW public.v_portfolio_values WITH (security_invoker = true) AS
  SELECT p.id AS portfolio_id, p.asset_id, a.name, a.currency AS portfolio_currency,
         a.current_value AS display_value, a.current_value_date AS display_value_date,
         (SELECT sum(hv.value_thb) FROM public.investment_holdings h
            CROSS JOIN LATERAL private.holding_value_at(h.id, current_date) hv
           WHERE h.portfolio_id = p.id AND h.deleted_at IS NULL) AS thb_value,
         private.portfolio_in_transit(p.id, current_date) AS in_transit,
         private.portfolio_in_transit(p.id, current_date) * private.fx_rate(a.currency, current_date) AS in_transit_thb,
         -- มูลค่าพอร์ตในสกุลพอร์ต ณ วันนี้ (ไม่รวมเงินระหว่างทาง)
         (SELECT sum(CASE WHEN a.currency <> 'THB' AND h.currency <> a.currency AND p.statement_fx ->> h.currency IS NOT NULL
                          THEN hv.value * (p.statement_fx ->> h.currency)::numeric
                          ELSE hv.value_thb / nullif(private.fx_rate(a.currency, current_date), 0) END)
            FROM public.investment_holdings h
            CROSS JOIN LATERAL private.holding_value_at(h.id, current_date) hv
           WHERE h.portfolio_id = p.id AND h.deleted_at IS NULL) AS portfolio_value,
         private.fx_rate(a.currency, current_date) AS portfolio_fx_rate,
         p.statement_fx, p.statement_fx_date
    FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
   WHERE p.deleted_at IS NULL AND a.deleted_at IS NULL
     AND private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');

GRANT SELECT ON public.v_portfolio_values TO authenticated, service_role;

COMMENT ON COLUMN public.investment_portfolios.statement_fx IS
  'อัตราของธนาคารตาม Statement: 1 หน่วยสกุลอื่น = ? สกุลพอร์ต เช่น {"AUD":0.6953} — ใช้คิดมูลค่าในสกุลพอร์ตให้ตรง Statement (บาทยังใช้อัตรา ธปท.)';
