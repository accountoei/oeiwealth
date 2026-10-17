-- =====================================================================
-- ขาย / ลงทุนเพิ่ม: กำไร-ขาดทุนเทียบมูลค่าล่าสุด (Net Worth) · ราคาทุนต่อหุ้นรายคน · ลงทุนเพิ่มเป็นหุ้น × ราคา
--   1) asset_ownerships.cost_per_share — ราคาทุนต่อหุ้นของแต่ละคน (ธุรกิจ · ไม่บังคับ · ว่าง = เฉลี่ย เงินลงทุน ÷ หุ้นที่ถือ)
--      set_asset_ownership รับ "cost_per_share" ต่อคน
--   2) ขายหุ้นรายคน (sell_business_shares — แทนตัวเดิม):
--      มูลค่าส่วนที่ขาย = มูลค่าล่าสุด × หุ้นที่ขาย ÷ หุ้นที่ครอบครัวถือ (ราคาหุ้นตามการประเมิน)
--      กำไร = เงินขายสุทธิ − มูลค่าส่วนที่ขาย → รายได้ "กำไรจากการขายหุ้น" ของผู้ขาย (เข้าบัญชีเดียวกัน)
--      ขาดทุน → ค่าใช้จ่าย "ขาดทุนจากการขายหุ้น" ของผู้ขาย (ไม่มีเงินออกจากบัญชี)
--      เงินเข้าบัญชีรวม = เงินขายสุทธิเสมอ (ทุนคืน ASSET_SALE + กำไร) · เงินลงทุนลดตามทุนของหุ้นที่ขาย
--   3) ลงทุนเพิ่ม (buy_business_shares): ผู้ลงทุน · หุ้นที่ได้ · ยอดจ่าย · บริษัทออกหุ้นใหม่หรือไม่
--      หุ้น / ราคาทุนเฉลี่ยของผู้ลงทุน · หุ้นครอบครัว (+ หุ้นทั้งหมดถ้าออกหุ้นใหม่) · มูลค่า + ยอดจ่าย · เงินลงทุน + ยอดจ่าย
--   4) ยกเลิก (undo_business_share_sale): ครั้งล่าสุดของธุรกิจนั้น ทั้งขายและลงทุนเพิ่ม
--   5) ขายทั้งก้อน (sell_asset: อสังหาฯ / สินทรัพย์อื่น): กำไร / ขาดทุนเทียบมูลค่าล่าสุดแบบเดียวกัน แบ่งตามเจ้าของ ณ วันขาย
--   ฟังก์ชัน + คอลัมน์ใหม่ (ไม่บังคับ) · ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

ALTER TABLE public.asset_ownerships ADD COLUMN IF NOT EXISTS cost_per_share numeric;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ao_cost_per_share_ck') THEN
    ALTER TABLE public.asset_ownerships ADD CONSTRAINT ao_cost_per_share_ck CHECK (cost_per_share IS NULL OR cost_per_share >= 0);
  END IF;
END $$;

ALTER TABLE public.business_share_sales ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'SELL';
ALTER TABLE public.business_share_sales ADD COLUMN IF NOT EXISTS book_value numeric;            -- มูลค่าส่วนที่ขาย (ตามการประเมิน)
ALTER TABLE public.business_share_sales ADD COLUMN IF NOT EXISTS gain numeric;                  -- กำไร (+) / ขาดทุน (−) ที่ลงบัญชี
ALTER TABLE public.business_share_sales ADD COLUMN IF NOT EXISTS cost_basis numeric;            -- ทุนของหุ้นที่ขาย (ดูเป็นข้อมูล)
ALTER TABLE public.business_share_sales ADD COLUMN IF NOT EXISTS income_id uuid REFERENCES public.income_transactions(id);
ALTER TABLE public.business_share_sales ADD COLUMN IF NOT EXISTS expense_id uuid REFERENCES public.expense_items(id);
ALTER TABLE public.business_share_sales ADD COLUMN IF NOT EXISTS prev_investment_cost numeric;
ALTER TABLE public.business_share_sales ADD COLUMN IF NOT EXISTS prev_total_shares numeric;
ALTER TABLE public.business_share_sales ADD COLUMN IF NOT EXISTS new_issue boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bss_kind_ck') THEN
    ALTER TABLE public.business_share_sales ADD CONSTRAINT bss_kind_ck CHECK (kind IN ('SELL','BUY'));
  END IF;
END $$;

-- เขียนรายการ (ขาย / ลงทุนเพิ่ม) — เรียกจากฟังก์ชันเท่านั้น
CREATE OR REPLACE FUNCTION private.write_share_sale(r jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  INSERT INTO public.business_share_sales(kind, asset_id, person_id, sale_date, shares, price, fee, currency, bank_asset_id, movement_id,
              family_shares_before, value_before, value_after, valuation_id, valuation_created, prev_valuation_value,
              ended_rows, inserted_rows, same_day_rows, prev_asset_status, prev_business_status, notes,
              book_value, gain, cost_basis, income_id, expense_id, prev_investment_cost, prev_total_shares, new_issue)
  VALUES (coalesce(r->>'kind', 'SELL'), (r->>'asset_id')::uuid, (r->>'person_id')::uuid, (r->>'sale_date')::date, (r->>'shares')::numeric,
          (r->>'price')::numeric, coalesce((r->>'fee')::numeric, 0), r->>'currency', nullif(r->>'bank_asset_id', '')::uuid,
          nullif(r->>'movement_id', '')::uuid, (r->>'family_shares_before')::numeric, nullif(r->>'value_before', '')::numeric,
          nullif(r->>'value_after', '')::numeric, nullif(r->>'valuation_id', '')::uuid, coalesce((r->>'valuation_created')::boolean, false),
          nullif(r->>'prev_valuation_value', '')::numeric,
          coalesce((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(r->'ended_rows') x), '{}'),
          coalesce((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(r->'inserted_rows') x), '{}'),
          coalesce(r->'same_day_rows', '[]'::jsonb), r->>'prev_asset_status', r->>'prev_business_status', nullif(trim(r->>'notes'), ''),
          nullif(r->>'book_value', '')::numeric, nullif(r->>'gain', '')::numeric, nullif(r->>'cost_basis', '')::numeric,
          nullif(r->>'income_id', '')::uuid, nullif(r->>'expense_id', '')::uuid, nullif(r->>'prev_investment_cost', '')::numeric,
          nullif(r->>'prev_total_shares', '')::numeric, coalesce((r->>'new_issue')::boolean, false))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION private.write_share_sale(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.write_share_sale(jsonb) TO authenticated;

-- 1) set_asset_ownership: เก็บราคาทุนต่อหุ้นรายคน ---------------------------------------------------
DO $$
DECLARE d text;
  old_txt text := 'INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, shares, start_date)';
  new_txt text := 'INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, shares, start_date, cost_per_share)';
  old_val text := 'CASE WHEN v_by_shares THEN (o->>''shares'')::numeric END, v_start);';
  new_val text := 'CASE WHEN v_by_shares THEN (o->>''shares'')::numeric END, v_start,
            CASE WHEN v_by_shares THEN nullif(replace(o->>''cost_per_share'', '','', ''''), '''')::numeric END);';
BEGIN
  d := replace(pg_get_functiondef('public.set_asset_ownership(uuid, jsonb, text, date)'::regprocedure), E'\r', '');
  IF position('cost_per_share' IN d) > 0 THEN RETURN; END IF;                -- รันซ้ำ
  IF position(old_txt IN d) = 0 OR position(old_val IN d) = 0 THEN
    RAISE EXCEPTION 'set_asset_ownership: ไม่พบจุดที่ต้องแก้';
  END IF;
  EXECUTE replace(replace(d, old_txt, new_txt), old_val, new_val);
END $$;

-- 2) ปรับแถวเจ้าของตั้งแต่วันที่ (ใช้ทั้งขายและลงทุนเพิ่ม) ------------------------------------------------
--   แถวที่เริ่มก่อนวันนั้น → ปิด (วันก่อน) แล้วสร้างใหม่ · แถวที่เริ่มวันเดียวกัน → แก้ในแถว · คืนรายการที่ใช้ย้อนตอนยกเลิก
CREATE OR REPLACE FUNCTION private.biz_reshape_owners(p_asset uuid, p_date date, p_person uuid, p_delta numeric,
  p_family_after numeric, p_cps numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r record; v_ended uuid[] := '{}'; v_inserted uuid[] := '{}'; v_same jsonb := '[]'::jsonb; v_new uuid; v_sh numeric; v_has boolean := false;
BEGIN
  -- ปิดแถวเดิมก่อนเปลี่ยนหุ้นรวม (ให้ % ของแถวเดิมคงเดิม)
  FOR r IN SELECT o.id FROM public.asset_ownerships o
            WHERE o.asset_id = p_asset AND o.deleted_at IS NULL AND o.end_date IS NULL AND o.start_date < p_date LOOP
    UPDATE public.asset_ownerships SET end_date = p_date - 1 WHERE id = r.id;
    v_ended := v_ended || r.id;
  END LOOP;
  -- แถววันเดียวกัน: เก็บค่าเดิม · ผู้ขายที่ขายหมด → ลบ (ก่อนเปลี่ยนหุ้นรวม)
  FOR r IN SELECT o.id, o.person_id, o.shares, o.cost_per_share FROM public.asset_ownerships o
            WHERE o.asset_id = p_asset AND o.deleted_at IS NULL AND o.end_date IS NULL AND o.start_date = p_date LOOP
    IF r.person_id = p_person AND r.shares + p_delta <= 0 THEN
      UPDATE public.asset_ownerships SET deleted_at = now() WHERE id = r.id;
      v_same := v_same || jsonb_build_array(jsonb_build_object('id', r.id, 'person_id', r.person_id, 'shares', r.shares, 'cps', r.cost_per_share, 'removed', true));
    ELSE
      v_same := v_same || jsonb_build_array(jsonb_build_object('id', r.id, 'person_id', r.person_id, 'shares', r.shares, 'cps', r.cost_per_share, 'removed', false));
    END IF;
  END LOOP;
  -- หุ้นที่ครอบครัวถือ / % ของบริษัท
  IF p_family_after > 0 THEN
    UPDATE public.private_business_details
       SET shares_owned = p_family_after,
           company_ownership_percent = CASE WHEN total_shares > 0 THEN round(p_family_after * 100 / total_shares, 4) ELSE company_ownership_percent END
     WHERE asset_id = p_asset AND deleted_at IS NULL;
  END IF;
  -- แถววันเดียวกันที่ยังเหลือ: คำนวณ % ใหม่ (ขาย: ผู้ขายก่อน · ลงทุนเพิ่ม: คนอื่นก่อน — รวมไม่เกิน 100% ระหว่างทาง)
  FOR r IN SELECT (x->>'id')::uuid AS id, (x->>'person_id')::uuid AS person_id, (x->>'shares')::numeric AS shares
             FROM jsonb_array_elements(v_same) x WHERE NOT (x->>'removed')::boolean
            ORDER BY CASE WHEN ((x->>'person_id')::uuid = p_person) = (p_delta < 0) THEN 0 ELSE 1 END LOOP
    IF r.person_id = p_person THEN
      v_has := true;
      UPDATE public.asset_ownerships SET shares = r.shares + p_delta, cost_per_share = coalesce(p_cps, cost_per_share) WHERE id = r.id;
    ELSE
      UPDATE public.asset_ownerships SET shares = r.shares WHERE id = r.id;
    END IF;
  END LOOP;
  -- แถวใหม่ตั้งแต่วันนั้น
  FOR r IN SELECT o.person_id, o.shares, o.cost_per_share FROM public.asset_ownerships o WHERE o.id = ANY (v_ended)
            ORDER BY CASE WHEN (o.person_id = p_person) = (p_delta < 0) THEN 0 ELSE 1 END LOOP
    v_sh := CASE WHEN r.person_id = p_person THEN r.shares + p_delta ELSE r.shares END;
    IF r.person_id = p_person THEN v_has := true; END IF;
    IF v_sh > 0 THEN
      INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, shares, start_date, cost_per_share)
      VALUES (p_asset, r.person_id, 0.0001, v_sh, p_date, CASE WHEN r.person_id = p_person THEN coalesce(p_cps, r.cost_per_share) ELSE r.cost_per_share END)
      RETURNING id INTO v_new;
      v_inserted := v_inserted || v_new;
    END IF;
  END LOOP;
  -- ผู้ลงทุนที่ยังไม่เคยถือ → แถวใหม่
  IF NOT v_has AND p_delta > 0 THEN
    INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, shares, start_date, cost_per_share)
    VALUES (p_asset, p_person, 0.0001, p_delta, p_date, p_cps)
    RETURNING id INTO v_new;
    v_inserted := v_inserted || v_new;
  END IF;
  RETURN jsonb_build_object('ended', to_jsonb(v_ended), 'inserted', to_jsonb(v_inserted), 'same', v_same);
END $$;
REVOKE ALL ON FUNCTION private.biz_reshape_owners(uuid, date, uuid, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.biz_reshape_owners(uuid, date, uuid, numeric, numeric, numeric) TO authenticated;

-- มูลค่า ณ วันที่ (แก้แถววันเดียวกัน หรือสร้างใหม่) — คืน {id, created, prev}
CREATE OR REPLACE FUNCTION private.biz_set_value(p_asset uuid, p_date date, p_value numeric, p_method text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v public.asset_valuations; v_id uuid;
BEGIN
  SELECT * INTO v FROM public.asset_valuations WHERE asset_id = p_asset AND deleted_at IS NULL AND valuation_date = p_date
   ORDER BY created_at DESC LIMIT 1;
  IF v.id IS NOT NULL THEN
    UPDATE public.asset_valuations SET value = p_value WHERE id = v.id;
    RETURN jsonb_build_object('id', v.id, 'created', false, 'prev', v.value);
  END IF;
  INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
  VALUES (p_asset, p_date, p_value, coalesce(p_method, 'BOOK_VALUE'), 'USER', p_note)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'created', true, 'prev', NULL);
END $$;
REVOKE ALL ON FUNCTION private.biz_set_value(uuid, date, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.biz_set_value(uuid, date, numeric, text, text) TO authenticated;

-- ตรวจร่วม (ขาย / ลงทุนเพิ่ม)
CREATE OR REPLACE FUNCTION private.biz_trade_checks(p_asset uuid, p_date date)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_go_live date;
BEGIN
  SELECT f.go_live_date INTO v_go_live FROM public.assets a JOIN public.families f ON f.id = a.family_id WHERE a.id = p_asset;
  IF p_date IS NULL OR p_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_go_live IS NOT NULL AND p_date < v_go_live THEN
    RAISE EXCEPTION 'INVALID: วันที่ต้องไม่ก่อนวัน Go-live (%)', to_char(v_go_live, 'DD/MM/YYYY') USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.asset_ownerships o WHERE o.asset_id = p_asset AND o.deleted_at IS NULL AND o.end_date IS NULL AND o.shares IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ต้องระบุเจ้าของเป็นจำนวนหุ้นก่อน (แก้ที่ "แก้ไขข้อมูล" → สมาชิกที่เป็นเจ้าของ)' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.asset_ownerships o WHERE o.asset_id = p_asset AND o.deleted_at IS NULL AND o.end_date IS NULL AND o.start_date > p_date) THEN
    RAISE EXCEPTION 'INVALID: มีการเปลี่ยนเจ้าของหลังวันนี้ — ใช้วันที่ที่ไม่ก่อนวันเปลี่ยนเจ้าของล่าสุด' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.asset_valuations v WHERE v.asset_id = p_asset AND v.deleted_at IS NULL AND v.valuation_date > p_date) THEN
    RAISE EXCEPTION 'INVALID: มีมูลค่าที่บันทึกหลังวันนี้ — ใช้วันที่ที่ไม่ก่อนมูลค่าล่าสุด' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_share_sales s WHERE s.asset_id = p_asset AND s.deleted_at IS NULL AND s.sale_date > p_date) THEN
    RAISE EXCEPTION 'INVALID: มีการขาย / ลงทุนเพิ่มหลังวันนี้แล้ว — บันทึกเรียงตามวันที่' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.biz_trade_checks(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.biz_trade_checks(uuid, date) TO authenticated;

-- 3) ขายหุ้นรายคน (กำไร / ขาดทุนเทียบราคาประเมิน) -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sell_business_shares(p_asset_id uuid, p_person_id uuid, p_date date, p_shares numeric,
  p_price numeric, p_fee numeric DEFAULT NULL, p_bank_asset_id uuid DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.assets; d public.private_business_details; v_person text;
  v_mine numeric; v_total numeric; v_left numeric; v_net numeric; v_cps numeric; v_cost numeric;
  v_val public.asset_valuations; v_before numeric; v_after numeric; v_book numeric; v_gain numeric;
  v_shape jsonb; v_vres jsonb; v_mv uuid; v_inc uuid; v_exp uuid; v_sale numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id AND deleted_at IS NULL;
  IF NOT FOUND OR a.asset_type <> 'PRIVATE_BUSINESS' THEN RAISE EXCEPTION 'INVALID: ไม่พบธุรกิจนี้' USING ERRCODE = '22023'; END IF;
  IF a.status <> 'ACTIVE' THEN RAISE EXCEPTION 'INVALID: ธุรกิจนี้ไม่ได้อยู่ในสถานะถืออยู่' USING ERRCODE = '22023'; END IF;
  SELECT * INTO d FROM public.private_business_details WHERE asset_id = a.id AND deleted_at IS NULL;
  PERFORM private.biz_trade_checks(a.id, p_date);
  IF p_shares IS NULL OR p_shares <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่จำนวนหุ้นที่ขาย' USING ERRCODE = '22023'; END IF;
  IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ราคาขาย' USING ERRCODE = '22023'; END IF;
  IF coalesce(p_fee, 0) < 0 THEN RAISE EXCEPTION 'INVALID: ค่าใช้จ่ายต้องไม่ติดลบ' USING ERRCODE = '22023'; END IF;
  IF p_bank_asset_id IS NOT NULL AND NOT private.is_bank_asset(p_bank_asset_id) THEN
    RAISE EXCEPTION 'INVALID: ไม่พบบัญชีที่รับเงิน' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(sum(o.shares), 0) INTO v_total FROM public.asset_ownerships o
   WHERE o.asset_id = a.id AND o.deleted_at IS NULL AND o.end_date IS NULL;
  SELECT coalesce(sum(o.shares), 0), max(o.cost_per_share) INTO v_mine, v_cps FROM public.asset_ownerships o
   WHERE o.asset_id = a.id AND o.person_id = p_person_id AND o.deleted_at IS NULL AND o.end_date IS NULL;
  SELECT name INTO v_person FROM public.persons WHERE id = p_person_id;
  IF v_mine <= 0 THEN RAISE EXCEPTION 'INVALID: % ไม่ได้ถือหุ้นของธุรกิจนี้', coalesce(v_person, 'ผู้ขาย') USING ERRCODE = '22023'; END IF;
  IF p_shares > v_mine THEN
    RAISE EXCEPTION 'INVALID: % ถืออยู่ % หุ้น — ขายเกินที่ถือไม่ได้', v_person, trim(to_char(v_mine, 'FM999,999,999,990.##########')) USING ERRCODE = '22023';
  END IF;

  v_left := v_total - p_shares;
  v_net := p_price - coalesce(p_fee, 0);
  -- ราคาทุนต่อหุ้นของผู้ขาย (ว่าง = เฉลี่ย เงินลงทุน ÷ หุ้นที่ครอบครัวถือ) — ดูเป็นข้อมูล + ลดเงินลงทุน
  v_cps := coalesce(v_cps, CASE WHEN d.investment_cost IS NOT NULL AND v_total > 0 THEN d.investment_cost / v_total END);
  v_cost := CASE WHEN v_cps IS NULL THEN NULL ELSE round(v_cps * p_shares, 2) END;
  -- มูลค่าส่วนที่ขาย (ราคาหุ้นตามการประเมินล่าสุด) · ไม่มีมูลค่าเลย → ใช้ทุน
  SELECT * INTO v_val FROM public.asset_valuations v WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.valuation_date <= p_date
   ORDER BY v.valuation_date DESC, v.created_at DESC LIMIT 1;
  v_before := v_val.value;
  v_book := CASE WHEN v_before IS NOT NULL THEN round(v_before * p_shares / v_total, 2) ELSE coalesce(v_cost, 0) END;
  v_after := CASE WHEN v_before IS NULL THEN NULL ELSE v_before - v_book END;
  v_gain := v_net - v_book;

  v_shape := private.biz_reshape_owners(a.id, p_date, p_person_id, -p_shares, v_left, NULL);
  IF v_before IS NOT NULL THEN
    v_vres := private.biz_set_value(a.id, p_date, v_after, v_val.valuation_method,
      'หลังขายหุ้น ' || coalesce(v_person, '') || ' ' || trim(to_char(p_shares, 'FM999,999,999,990.##########')) || ' หุ้น');
  END IF;
  UPDATE public.private_business_details
     SET investment_cost = CASE WHEN investment_cost IS NULL OR v_cost IS NULL THEN investment_cost ELSE greatest(investment_cost - v_cost, 0) END
   WHERE id = d.id;

  -- เงินเข้าบัญชี: ทุนคืน (ASSET_SALE) + กำไร (รายได้) = เงินขายสุทธิ · ขาดทุน: ทุนคืน = เงินขายสุทธิ
  v_sale := CASE WHEN v_gain > 0 THEN v_net - v_gain ELSE v_net END;
  IF p_bank_asset_id IS NOT NULL AND v_sale > 0 THEN
    INSERT INTO public.cash_movements(movement_date, movement_type, from_asset_id, to_asset_id, amount, currency, description, notes, metadata)
    VALUES (p_date, 'ASSET_SALE', a.id, p_bank_asset_id, v_sale, a.currency,
            'ขายหุ้น · ' || a.name || ' · ' || coalesce(v_person, ''), nullif(trim(p_notes), ''),
            jsonb_build_object('share_sale', true, 'person_id', p_person_id, 'shares', p_shares, 'sale_price', p_price, 'fee', coalesce(p_fee, 0)))
    RETURNING id INTO v_mv;
  END IF;
  IF v_gain > 0 THEN
    INSERT INTO public.income_transactions(asset_id, person_id, received_to_asset_id, date, income_type, income_subtype, amount, currency, notes)
    VALUES (a.id, p_person_id, p_bank_asset_id, p_date, 'OTHER', 'กำไรจากการขายหุ้น', v_gain, a.currency,
            'ขาย ' || a.name || ' ' || trim(to_char(p_shares, 'FM999,999,999,990.##########')) || ' หุ้น (เทียบราคาประเมินล่าสุด)')
    RETURNING id INTO v_inc;
  ELSIF v_gain < 0 THEN
    v_exp := public.add_expense(jsonb_build_object('date', p_date, 'amount', -v_gain, 'currency', a.currency, 'person_id', p_person_id,
      'description', 'ขาดทุนจากการขายหุ้น · ' || a.name, 'expense_category', 'ขาดทุนจากการขายหุ้น', 'related_asset_id', a.id,
      'notes', 'ขาย ' || trim(to_char(p_shares, 'FM999,999,999,990.##########')) || ' หุ้น (เทียบราคาประเมินล่าสุด · ไม่มีเงินออกจากบัญชี)'));
  END IF;

  IF v_left <= 0 THEN
    UPDATE public.private_business_details SET status = 'SOLD' WHERE id = d.id;
    UPDATE public.assets SET status = 'SOLD' WHERE id = a.id;
  END IF;

  RETURN private.write_share_sale(jsonb_build_object(
    'kind', 'SELL', 'asset_id', a.id, 'person_id', p_person_id, 'sale_date', p_date, 'shares', p_shares, 'price', p_price, 'fee', coalesce(p_fee, 0),
    'currency', a.currency, 'bank_asset_id', p_bank_asset_id, 'movement_id', v_mv, 'family_shares_before', v_total,
    'value_before', v_before, 'value_after', v_after, 'valuation_id', v_vres->>'id', 'valuation_created', coalesce((v_vres->>'created')::boolean, false),
    'prev_valuation_value', v_vres->>'prev', 'ended_rows', v_shape->'ended', 'inserted_rows', v_shape->'inserted',
    'same_day_rows', v_shape->'same', 'prev_asset_status', a.status, 'prev_business_status', d.status, 'notes', p_notes,
    'book_value', v_book, 'gain', v_gain, 'cost_basis', v_cost, 'income_id', v_inc, 'expense_id', v_exp,
    'prev_investment_cost', d.investment_cost, 'prev_total_shares', d.total_shares));
END $$;
REVOKE ALL ON FUNCTION public.sell_business_shares(uuid, uuid, date, numeric, numeric, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sell_business_shares(uuid, uuid, date, numeric, numeric, numeric, uuid, text) TO authenticated;

-- 4) ลงทุนเพิ่ม (ได้หุ้นเพิ่ม) -----------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.buy_business_shares(uuid, uuid, date, numeric, numeric, uuid, boolean, text);
CREATE FUNCTION public.buy_business_shares(p_asset_id uuid, p_person_id uuid, p_date date, p_shares numeric,
  p_amount numeric, p_bank_asset_id uuid, p_new_issue boolean DEFAULT true, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.assets; d public.private_business_details; v_person text; v_total numeric; v_mine numeric; v_old_cps numeric; v_cps numeric;
  v_val public.asset_valuations; v_before numeric; v_after numeric; v_shape jsonb; v_vres jsonb; v_mv uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id AND deleted_at IS NULL;
  IF NOT FOUND OR a.asset_type <> 'PRIVATE_BUSINESS' THEN RAISE EXCEPTION 'INVALID: ไม่พบธุรกิจนี้' USING ERRCODE = '22023'; END IF;
  IF a.status <> 'ACTIVE' THEN RAISE EXCEPTION 'INVALID: ธุรกิจนี้ไม่ได้อยู่ในสถานะถืออยู่' USING ERRCODE = '22023'; END IF;
  SELECT * INTO d FROM public.private_business_details WHERE asset_id = a.id AND deleted_at IS NULL;
  PERFORM private.biz_trade_checks(a.id, p_date);
  IF p_person_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.persons WHERE id = p_person_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: กรุณาเลือกผู้ลงทุน' USING ERRCODE = '22023';
  END IF;
  IF p_shares IS NULL OR p_shares <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่จำนวนหุ้นที่ได้' USING ERRCODE = '22023'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดจ่าย' USING ERRCODE = '22023'; END IF;
  IF p_bank_asset_id IS NULL OR NOT private.is_bank_asset(p_bank_asset_id) THEN
    RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่จ่าย' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(sum(o.shares), 0) INTO v_total FROM public.asset_ownerships o
   WHERE o.asset_id = a.id AND o.deleted_at IS NULL AND o.end_date IS NULL;
  SELECT coalesce(sum(o.shares), 0), max(o.cost_per_share) INTO v_mine, v_old_cps FROM public.asset_ownerships o
   WHERE o.asset_id = a.id AND o.person_id = p_person_id AND o.deleted_at IS NULL AND o.end_date IS NULL;
  SELECT name INTO v_person FROM public.persons WHERE id = p_person_id;
  IF p_new_issue THEN
    IF d.total_shares IS NULL THEN RAISE EXCEPTION 'INVALID: ระบุหุ้นทั้งหมดของบริษัทก่อน (แก้ไขข้อมูล)' USING ERRCODE = '22023'; END IF;
    UPDATE public.private_business_details SET total_shares = total_shares + p_shares WHERE id = d.id;
  ELSIF d.total_shares IS NOT NULL AND v_total + p_shares > d.total_shares THEN
    RAISE EXCEPTION 'INVALID: หุ้นที่ครอบครัวถือจะเกินหุ้นทั้งหมดของบริษัท — ถ้าบริษัทออกหุ้นใหม่ ให้ติ๊ก "บริษัทออกหุ้นใหม่"' USING ERRCODE = '22023';
  END IF;
  -- ราคาทุนเฉลี่ยใหม่ของผู้ลงทุน
  v_old_cps := coalesce(v_old_cps, CASE WHEN d.investment_cost IS NOT NULL AND v_total > 0 THEN d.investment_cost / v_total END);
  v_cps := CASE WHEN v_mine > 0 AND v_old_cps IS NOT NULL THEN (v_mine * v_old_cps + p_amount) / (v_mine + p_shares)
                WHEN v_mine > 0 THEN NULL ELSE p_amount / p_shares END;
  v_shape := private.biz_reshape_owners(a.id, p_date, p_person_id, p_shares, v_total + p_shares, v_cps);
  -- มูลค่า + ยอดจ่าย
  SELECT * INTO v_val FROM public.asset_valuations v WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.valuation_date <= p_date
   ORDER BY v.valuation_date DESC, v.created_at DESC LIMIT 1;
  v_before := v_val.value;
  v_after := coalesce(v_before, 0) + p_amount;
  v_vres := private.biz_set_value(a.id, p_date, v_after, coalesce(v_val.valuation_method, 'BOOK_VALUE'),
    'หลังลงทุนเพิ่ม ' || coalesce(v_person, '') || ' ' || trim(to_char(p_shares, 'FM999,999,999,990.##########')) || ' หุ้น');
  UPDATE public.private_business_details SET investment_cost = coalesce(investment_cost, 0) + p_amount WHERE id = d.id;
  INSERT INTO public.cash_movements(movement_date, movement_type, from_asset_id, to_asset_id, amount, currency, description, notes, metadata)
  VALUES (p_date, 'ASSET_PURCHASE', p_bank_asset_id, a.id, p_amount, a.currency,
          'ลงทุนเพิ่ม · ' || a.name || ' · ' || coalesce(v_person, ''), nullif(trim(p_notes), ''),
          jsonb_build_object('share_buy', true, 'person_id', p_person_id, 'shares', p_shares, 'new_issue', p_new_issue))
  RETURNING id INTO v_mv;

  RETURN private.write_share_sale(jsonb_build_object(
    'kind', 'BUY', 'asset_id', a.id, 'person_id', p_person_id, 'sale_date', p_date, 'shares', p_shares, 'price', p_amount, 'fee', 0,
    'currency', a.currency, 'bank_asset_id', p_bank_asset_id, 'movement_id', v_mv, 'family_shares_before', v_total,
    'value_before', v_before, 'value_after', v_after, 'valuation_id', v_vres->>'id', 'valuation_created', (v_vres->>'created')::boolean,
    'prev_valuation_value', v_vres->>'prev', 'ended_rows', v_shape->'ended', 'inserted_rows', v_shape->'inserted',
    'same_day_rows', v_shape->'same', 'prev_asset_status', a.status, 'prev_business_status', d.status, 'notes', p_notes,
    'cost_basis', p_amount, 'prev_investment_cost', d.investment_cost, 'prev_total_shares', d.total_shares, 'new_issue', p_new_issue));
END $$;
REVOKE ALL ON FUNCTION public.buy_business_shares(uuid, uuid, date, numeric, numeric, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buy_business_shares(uuid, uuid, date, numeric, numeric, uuid, boolean, text) TO authenticated;

-- 5) ยกเลิก (ขาย / ลงทุนเพิ่ม · เฉพาะครั้งล่าสุด) -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_business_share_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE s public.business_share_sales; x jsonb;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO s FROM public.business_share_sales WHERE id = p_sale_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบรายการนี้' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.business_share_sales o WHERE o.asset_id = s.asset_id AND o.deleted_at IS NULL AND o.id <> s.id
              AND (o.sale_date > s.sale_date OR (o.sale_date = s.sale_date AND o.created_at > s.created_at))) THEN
    RAISE EXCEPTION 'INVALID: ยกเลิกได้เฉพาะรายการล่าสุด — ยกเลิกครั้งหลังกว่าก่อน' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.asset_valuations v WHERE v.asset_id = s.asset_id AND v.deleted_at IS NULL AND v.valuation_date > s.sale_date) THEN
    RAISE EXCEPTION 'INVALID: มีมูลค่าที่บันทึกหลังวันนั้น — ลบมูลค่านั้นก่อน' USING ERRCODE = '22023';
  END IF;

  -- สถานะ / หุ้นทั้งหมด / หุ้นครอบครัว / เงินลงทุน กลับเป็นก่อนหน้า (ก่อนแก้แถวเจ้าของ เพื่อให้ % คำนวณจากหุ้นรวมเดิม)
  UPDATE public.assets SET status = coalesce(s.prev_asset_status, 'ACTIVE') WHERE id = s.asset_id AND status <> coalesce(s.prev_asset_status, 'ACTIVE');
  IF s.kind = 'BUY' THEN
    -- ลบแถวใหม่ก่อนลดหุ้นรวม (ไม่ให้ % เกิน 100 ระหว่างทาง)
    UPDATE public.asset_ownerships SET deleted_at = now() WHERE id = ANY (s.inserted_rows) AND deleted_at IS NULL;
  END IF;
  UPDATE public.private_business_details
     SET status = coalesce(s.prev_business_status, status),
         total_shares = CASE WHEN s.kind = 'BUY' AND s.new_issue THEN s.prev_total_shares ELSE total_shares END,
         shares_owned = s.family_shares_before,
         investment_cost = CASE WHEN s.prev_investment_cost IS NOT NULL OR s.kind = 'BUY' THEN s.prev_investment_cost ELSE investment_cost END,
         company_ownership_percent = CASE WHEN coalesce(CASE WHEN s.kind = 'BUY' AND s.new_issue THEN s.prev_total_shares ELSE total_shares END, 0) > 0
           THEN round(s.family_shares_before * 100 / CASE WHEN s.kind = 'BUY' AND s.new_issue THEN s.prev_total_shares ELSE total_shares END, 4)
           ELSE company_ownership_percent END
   WHERE asset_id = s.asset_id AND deleted_at IS NULL;
  -- เจ้าของ: ลบแถวใหม่ · แถววันเดียวกันคืนค่าเดิม (แถวที่ถูกลบ → สร้างกลับ) · แล้วจึงเปิดแถวเดิมต่อ
  --   (ลำดับนี้ทำให้ผลรวม % ไม่เกิน 100 ระหว่างทาง: ลงทุนเพิ่ม = คืนหุ้นผู้ลงทุนก่อน)
  UPDATE public.asset_ownerships SET deleted_at = now() WHERE id = ANY (s.inserted_rows) AND deleted_at IS NULL;
  FOR x IN SELECT * FROM jsonb_array_elements(s.same_day_rows)
            ORDER BY CASE WHEN ((value->>'person_id')::uuid = s.person_id) = (s.kind = 'BUY') THEN 0 ELSE 1 END LOOP
    IF (x->>'removed')::boolean THEN
      INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, shares, start_date, cost_per_share)
      VALUES (s.asset_id, (x->>'person_id')::uuid, 0.0001, (x->>'shares')::numeric, s.sale_date, nullif(x->>'cps', '')::numeric);
    ELSE
      UPDATE public.asset_ownerships SET shares = (x->>'shares')::numeric, cost_per_share = nullif(x->>'cps', '')::numeric
       WHERE id = (x->>'id')::uuid AND deleted_at IS NULL;
    END IF;
  END LOOP;
  UPDATE public.asset_ownerships SET end_date = NULL WHERE id = ANY (s.ended_rows) AND deleted_at IS NULL;
  -- มูลค่า
  IF s.valuation_id IS NOT NULL THEN
    IF s.valuation_created THEN
      UPDATE public.asset_valuations SET deleted_at = now() WHERE id = s.valuation_id AND deleted_at IS NULL;
    ELSE
      UPDATE public.asset_valuations SET value = s.prev_valuation_value WHERE id = s.valuation_id AND deleted_at IS NULL;
    END IF;
  END IF;
  -- เงินเข้า / ออกบัญชี · กำไร / ขาดทุน
  IF s.movement_id IS NOT NULL THEN
    UPDATE public.cash_movements SET deleted_at = now() WHERE id = s.movement_id AND deleted_at IS NULL;
  END IF;
  IF s.income_id IS NOT NULL THEN
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = s.income_id AND deleted_at IS NULL;
  END IF;
  IF s.expense_id IS NOT NULL THEN
    UPDATE public.expense_items SET deleted_at = now() WHERE id = s.expense_id AND deleted_at IS NULL;
  END IF;
  PERFORM private.close_share_sale(s.id);
END $$;
REVOKE ALL ON FUNCTION public.undo_business_share_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_business_share_sale(uuid) TO authenticated;

-- 6) ขายทั้งก้อน (อสังหาฯ / สินทรัพย์อื่น / ธุรกิจที่ระบุเป็น %): กำไร / ขาดทุนเทียบมูลค่าล่าสุด -------------------------
CREATE OR REPLACE FUNCTION public.sell_asset(
  p_asset_id uuid, p_date date, p_price numeric, p_bank_asset_id uuid DEFAULT NULL,
  p_fee numeric DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.assets; v_net numeric; v_book numeric; v_gain numeric; v_sale numeric; o record; v_left numeric; v_n int; v_i int := 0; v_part numeric;
  v_label text;
BEGIN
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบทรัพย์สินนี้' USING ERRCODE = '22023'; END IF;
  IF a.status <> 'ACTIVE' THEN RAISE EXCEPTION 'INVALID: ทรัพย์สินนี้ไม่ได้อยู่ในสถานะถืออยู่' USING ERRCODE = '22023'; END IF;
  IF NOT (a.asset_group IN ('PROPERTY','ALTERNATIVE') OR a.asset_type = 'PRIVATE_BUSINESS') THEN
    RAISE EXCEPTION 'INVALID: ขายได้เฉพาะอสังหาฯ / สินทรัพย์อื่น / ธุรกิจ (หุ้นในพอร์ตใช้รายการขายในหน้า Investments)' USING ERRCODE = '22023';
  END IF;
  IF p_date IS NULL OR p_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ขายไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ราคาขาย' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.property_leases l JOIN public.property_details pd ON pd.id = l.property_id
              WHERE pd.asset_id = a.id AND l.deleted_at IS NULL AND l.status = 'ACTIVE' AND l.end_date >= p_date) THEN
    RAISE EXCEPTION 'INVALID: ยังมีสัญญาเช่าที่มีผล — บันทึกเลิกสัญญา / คืนเงินประกันก่อน' USING ERRCODE = '22023';
  END IF;

  v_net := p_price - coalesce(p_fee, 0);
  -- มูลค่าล่าสุดก่อนขาย (ประเมินล่าสุด) · ไม่มี → ราคาที่ได้มา
  SELECT v.value INTO v_book FROM public.asset_valuations v
   WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.valuation_date <= p_date
   ORDER BY v.valuation_date DESC, v.created_at DESC LIMIT 1;
  v_book := coalesce(v_book, a.acquisition_cost);
  v_gain := CASE WHEN v_book IS NULL THEN 0 ELSE v_net - v_book END;
  v_label := CASE WHEN a.asset_type = 'PRIVATE_BUSINESS' THEN 'หุ้น' ELSE 'ทรัพย์สิน' END;

  v_sale := CASE WHEN v_gain > 0 THEN v_net - v_gain ELSE v_net END;
  IF p_bank_asset_id IS NOT NULL AND v_sale > 0 THEN
    INSERT INTO public.cash_movements(movement_date, movement_type, from_asset_id, to_asset_id, amount, currency, description, notes, metadata)
    VALUES (p_date, 'ASSET_SALE', a.id, p_bank_asset_id, v_sale, a.currency, 'ขาย · ' || a.name, nullif(trim(p_notes), ''),
            jsonb_build_object('sale_price', p_price, 'fee', coalesce(p_fee, 0), 'book_value', v_book, 'gain', v_gain));
  END IF;
  -- กำไร → รายได้ (แบ่งตามเจ้าของทรัพย์สิน) · ขาดทุน → ค่าใช้จ่ายของเจ้าของแต่ละคน ณ วันขาย (ไม่มีเงินออกจากบัญชี)
  IF v_gain > 0 THEN
    INSERT INTO public.income_transactions(asset_id, received_to_asset_id, date, income_type, income_subtype, amount, currency, notes)
    VALUES (a.id, p_bank_asset_id, p_date, 'OTHER', 'กำไรจากการขาย' || v_label, v_gain, a.currency,
            'ขาย ' || a.name || ' (เทียบมูลค่าล่าสุด)');
  ELSIF v_gain < 0 THEN
    SELECT count(*) INTO v_n FROM private.asset_owner_shares(a.id, p_date) s WHERE s.person_id IS NOT NULL AND s.pct > 0;
    v_left := -v_gain;
    IF v_n = 0 THEN
      PERFORM public.add_expense(jsonb_build_object('date', p_date, 'amount', -v_gain, 'currency', a.currency,
        'description', 'ขาดทุนจากการขาย' || v_label || ' · ' || a.name, 'expense_category', 'ขาดทุนจากการขาย' || v_label,
        'related_asset_id', a.id, 'notes', 'เทียบมูลค่าล่าสุด · ไม่มีเงินออกจากบัญชี'));
    ELSE
      FOR o IN SELECT s.person_id, s.pct FROM private.asset_owner_shares(a.id, p_date) s
                WHERE s.person_id IS NOT NULL AND s.pct > 0 ORDER BY s.pct, s.person_id LOOP
        v_i := v_i + 1;
        v_part := CASE WHEN v_i = v_n THEN v_left ELSE round(-v_gain * o.pct / 100, 2) END;
        v_left := v_left - v_part;
        IF v_part > 0 THEN
          PERFORM public.add_expense(jsonb_build_object('date', p_date, 'amount', v_part, 'currency', a.currency, 'person_id', o.person_id,
            'description', 'ขาดทุนจากการขาย' || v_label || ' · ' || a.name, 'expense_category', 'ขาดทุนจากการขาย' || v_label,
            'related_asset_id', a.id, 'notes', 'เทียบมูลค่าล่าสุด · ไม่มีเงินออกจากบัญชี'));
        END IF;
      END LOOP;
    END IF;
  END IF;
  -- มูลค่า ณ วันขาย = ราคาขาย (เดือนที่ขายใช้ยอดนี้)
  IF NOT EXISTS (SELECT 1 FROM public.asset_valuations WHERE asset_id = a.id AND valuation_date = p_date AND deleted_at IS NULL) THEN
    INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
    VALUES (a.id, p_date, p_price, 'LATEST_TRANSACTION', 'USER', 'ราคาขาย');
  END IF;
  UPDATE public.private_business_details SET status = 'SOLD' WHERE asset_id = a.id AND deleted_at IS NULL;
  UPDATE public.assets SET status = 'SOLD',
         notes = concat_ws(' · ', notes, 'ขาย ' || to_char(p_date, 'DD/MM/YYYY') || ' ราคา ' || p_price::text)
   WHERE id = a.id;
END $$;
