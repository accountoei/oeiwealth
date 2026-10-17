-- =====================================================================
-- ธุรกิจ (Private Business): ขายหุ้นรายคน — ขายบางส่วนได้ · บันทึกตามคน (ไม่มีขายรวม)
--   sell_business_shares(): ผู้ขาย 1 คน · จำนวนหุ้น · ราคาขายรวม · ค่าใช้จ่าย · บัญชีที่รับเงิน
--     1) หุ้นของผู้ขายลดลงตั้งแต่วันขาย (ประวัติก่อนวันขายไม่เปลี่ยน) · คนที่ขายหมด = หลุดจากรายชื่อเจ้าของ
--     2) หุ้นที่ครอบครัวถือ / % ของบริษัท ลดลงตาม
--     3) มูลค่าส่วนของครอบครัว ณ วันขาย = มูลค่าเดิม × หุ้นที่เหลือ ÷ หุ้นเดิม (ราคาต่อหุ้นเท่าเดิม)
--     4) เงินขาย (ราคา − ค่าใช้จ่าย) เข้าบัญชีที่เลือก = ASSET_SALE (ไม่ใช่รายได้ประจำ)
--     5) ทุกคนขายหมด → ธุรกิจ "ขายหุ้นแล้ว" (ไม่นับเป็นทรัพย์สินหลังวันขาย)
--   undo_business_share_sale(): ยกเลิกได้เฉพาะครั้งล่าสุดของธุรกิจนั้น · คืนหุ้น / มูลค่า / ลบเงินเข้าบัญชีพร้อมกัน
--   ADMIN / EDITOR · ตารางใหม่ business_share_sales (อ่านได้ทุกบทบาท · เขียนผ่านฟังก์ชันเท่านั้น)
--   ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) ประวัติขายหุ้น ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_share_sales (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id            uuid NOT NULL REFERENCES public.assets(id),
  person_id           uuid NOT NULL REFERENCES public.persons(id),
  sale_date           date NOT NULL,
  shares              public.d_qty NOT NULL CHECK (shares > 0),
  price               public.d_money NOT NULL CHECK (price >= 0),
  fee                 public.d_money NOT NULL DEFAULT 0 CHECK (fee >= 0),
  currency            public.d_currency NOT NULL,
  bank_asset_id       uuid REFERENCES public.assets(id),
  movement_id         uuid REFERENCES public.cash_movements(id),
  family_shares_before public.d_qty NOT NULL,
  value_before        public.d_money,
  value_after         public.d_money,
  -- สิ่งที่ต้องย้อนตอนยกเลิก
  valuation_id        uuid REFERENCES public.asset_valuations(id),
  valuation_created   boolean NOT NULL DEFAULT false,
  prev_valuation_value numeric,
  ended_rows          uuid[] NOT NULL DEFAULT '{}',          -- แถวเจ้าของที่ปิด (end_date = วันก่อนขาย)
  inserted_rows       uuid[] NOT NULL DEFAULT '{}',          -- แถวเจ้าของที่สร้างใหม่ตั้งแต่วันขาย
  same_day_rows       jsonb NOT NULL DEFAULT '[]'::jsonb,    -- แถวที่เริ่มวันเดียวกัน: [{id, person_id, shares, removed}]
  prev_asset_status   text,
  prev_business_status text,
  undone_at           timestamptz,
  notes               text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE INDEX IF NOT EXISTS business_share_sales_asset_idx ON public.business_share_sales(asset_id);

DROP TRIGGER IF EXISTS t10_meta ON public.business_share_sales;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.business_share_sales
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.business_share_sales;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.business_share_sales
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.business_share_sales;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.business_share_sales
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

ALTER TABLE public.business_share_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_share_sales FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.business_share_sales TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.business_share_sales TO service_role;
DROP POLICY IF EXISTS p_select ON public.business_share_sales;
CREATE POLICY p_select ON public.business_share_sales FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));

-- เขียน / ปิดรายการขาย (เรียกจากฟังก์ชันขาย / ยกเลิกเท่านั้น)
CREATE OR REPLACE FUNCTION private.write_share_sale(r jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  INSERT INTO public.business_share_sales(asset_id, person_id, sale_date, shares, price, fee, currency, bank_asset_id, movement_id,
              family_shares_before, value_before, value_after, valuation_id, valuation_created, prev_valuation_value,
              ended_rows, inserted_rows, same_day_rows, prev_asset_status, prev_business_status, notes)
  VALUES ((r->>'asset_id')::uuid, (r->>'person_id')::uuid, (r->>'sale_date')::date, (r->>'shares')::numeric,
          (r->>'price')::numeric, coalesce((r->>'fee')::numeric, 0), r->>'currency', nullif(r->>'bank_asset_id', '')::uuid,
          nullif(r->>'movement_id', '')::uuid, (r->>'family_shares_before')::numeric, nullif(r->>'value_before', '')::numeric,
          nullif(r->>'value_after', '')::numeric, nullif(r->>'valuation_id', '')::uuid, coalesce((r->>'valuation_created')::boolean, false),
          nullif(r->>'prev_valuation_value', '')::numeric,
          coalesce((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(r->'ended_rows') x), '{}'),
          coalesce((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(r->'inserted_rows') x), '{}'),
          coalesce(r->'same_day_rows', '[]'::jsonb), r->>'prev_asset_status', r->>'prev_business_status', nullif(trim(r->>'notes'), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION private.write_share_sale(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.write_share_sale(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION private.close_share_sale(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  UPDATE public.business_share_sales SET undone_at = now(), deleted_at = now() WHERE id = p_id AND deleted_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION private.close_share_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.close_share_sale(uuid) TO authenticated;

-- 2) ขายหุ้น ---------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sell_business_shares(uuid, uuid, date, numeric, numeric, numeric, uuid, text);
CREATE FUNCTION public.sell_business_shares(p_asset_id uuid, p_person_id uuid, p_date date, p_shares numeric,
  p_price numeric, p_fee numeric DEFAULT NULL, p_bank_asset_id uuid DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.assets; d public.private_business_details; v_go_live date; v_person text;
  r record; v_mine numeric; v_total numeric; v_left numeric; v_net numeric;
  v_val public.asset_valuations; v_before numeric; v_after numeric; v_val_id uuid; v_val_created boolean := false; v_prev_val numeric;
  v_ended uuid[] := '{}'; v_inserted uuid[] := '{}'; v_same jsonb := '[]'::jsonb; v_new uuid; v_mv uuid; v_sh numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id AND deleted_at IS NULL;
  IF NOT FOUND OR a.asset_type <> 'PRIVATE_BUSINESS' THEN RAISE EXCEPTION 'INVALID: ไม่พบธุรกิจนี้' USING ERRCODE = '22023'; END IF;
  IF a.status <> 'ACTIVE' THEN RAISE EXCEPTION 'INVALID: ธุรกิจนี้ไม่ได้อยู่ในสถานะถืออยู่' USING ERRCODE = '22023'; END IF;
  SELECT * INTO d FROM public.private_business_details WHERE asset_id = a.id AND deleted_at IS NULL;
  SELECT f.go_live_date INTO v_go_live FROM public.families f WHERE f.id = a.family_id;
  IF p_date IS NULL OR p_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ขายไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_go_live IS NOT NULL AND p_date < v_go_live THEN
    RAISE EXCEPTION 'INVALID: วันที่ขายต้องไม่ก่อนวัน Go-live (%)', to_char(v_go_live, 'DD/MM/YYYY') USING ERRCODE = '22023';
  END IF;
  IF p_shares IS NULL OR p_shares <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่จำนวนหุ้นที่ขาย' USING ERRCODE = '22023'; END IF;
  IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ราคาขาย' USING ERRCODE = '22023'; END IF;
  IF coalesce(p_fee, 0) < 0 THEN RAISE EXCEPTION 'INVALID: ค่าใช้จ่ายต้องไม่ติดลบ' USING ERRCODE = '22023'; END IF;
  IF p_bank_asset_id IS NOT NULL AND NOT private.is_bank_asset(p_bank_asset_id) THEN
    RAISE EXCEPTION 'INVALID: ไม่พบบัญชีที่รับเงิน' USING ERRCODE = '22023';
  END IF;

  -- เจ้าของปัจจุบันต้องระบุเป็นจำนวนหุ้นครบทุกคน
  IF EXISTS (SELECT 1 FROM public.asset_ownerships o WHERE o.asset_id = a.id AND o.deleted_at IS NULL AND o.end_date IS NULL AND o.shares IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.asset_ownerships o WHERE o.asset_id = a.id AND o.deleted_at IS NULL AND o.end_date IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ต้องระบุเจ้าของเป็นจำนวนหุ้นก่อน (แก้ที่ "แก้ไขข้อมูล" → สมาชิกที่เป็นเจ้าของ)' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(sum(o.shares), 0) INTO v_total FROM public.asset_ownerships o
   WHERE o.asset_id = a.id AND o.deleted_at IS NULL AND o.end_date IS NULL;
  SELECT coalesce(sum(o.shares), 0) INTO v_mine FROM public.asset_ownerships o
   WHERE o.asset_id = a.id AND o.person_id = p_person_id AND o.deleted_at IS NULL AND o.end_date IS NULL;
  SELECT name INTO v_person FROM public.persons WHERE id = p_person_id;
  IF v_mine <= 0 THEN RAISE EXCEPTION 'INVALID: % ไม่ได้ถือหุ้นของธุรกิจนี้', coalesce(v_person, 'ผู้ขาย') USING ERRCODE = '22023'; END IF;
  IF p_shares > v_mine THEN
    RAISE EXCEPTION 'INVALID: % ถืออยู่ % หุ้น — ขายเกินที่ถือไม่ได้', v_person, trim(to_char(v_mine, 'FM999,999,999,990.##########')) USING ERRCODE = '22023';
  END IF;
  -- ลำดับเวลา: ไม่มีการเปลี่ยนเจ้าของ / มูลค่า / การขายหุ้น หลังวันขาย
  IF EXISTS (SELECT 1 FROM public.asset_ownerships o WHERE o.asset_id = a.id AND o.deleted_at IS NULL AND o.end_date IS NULL AND o.start_date > p_date) THEN
    RAISE EXCEPTION 'INVALID: มีการเปลี่ยนเจ้าของหลังวันขาย — ใช้วันขายที่ไม่ก่อนวันเปลี่ยนเจ้าของล่าสุด' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.asset_valuations v WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.valuation_date > p_date) THEN
    RAISE EXCEPTION 'INVALID: มีมูลค่าที่บันทึกหลังวันขาย — ใช้วันขายที่ไม่ก่อนมูลค่าล่าสุด' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_share_sales s WHERE s.asset_id = a.id AND s.deleted_at IS NULL AND s.sale_date > p_date) THEN
    RAISE EXCEPTION 'INVALID: มีการขายหุ้นหลังวันนี้แล้ว — บันทึกเรียงตามวันที่' USING ERRCODE = '22023';
  END IF;

  v_left := v_total - p_shares;
  -- มูลค่า ณ วันขาย (ราคาต่อหุ้นเท่าเดิม)
  SELECT * INTO v_val FROM public.asset_valuations v WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.valuation_date <= p_date
   ORDER BY v.valuation_date DESC, v.created_at DESC LIMIT 1;
  v_before := v_val.value;
  v_after := CASE WHEN v_before IS NULL THEN NULL ELSE round(v_before * v_left / v_total, 2) END;

  -- เจ้าของ: แถวที่เริ่มก่อนวันขาย → ปิด (วันก่อนขาย) แล้วสร้างใหม่ตั้งแต่วันขาย · แถวที่เริ่มวันเดียวกัน → แก้ในแถว
  --   (ปิดแถวเดิมก่อนเปลี่ยนหุ้นรวม เพื่อให้ % ของแถวเดิมคงเดิม)
  FOR r IN SELECT o.id, o.person_id, o.shares, o.start_date FROM public.asset_ownerships o
            WHERE o.asset_id = a.id AND o.deleted_at IS NULL AND o.end_date IS NULL AND o.start_date < p_date LOOP
    UPDATE public.asset_ownerships SET end_date = p_date - 1 WHERE id = r.id;
    v_ended := v_ended || r.id;
  END LOOP;
  -- แถววันเดียวกันของผู้ขายที่ขายหมด → ลบ (ก่อนเปลี่ยนหุ้นรวม)
  FOR r IN SELECT o.id, o.person_id, o.shares FROM public.asset_ownerships o
            WHERE o.asset_id = a.id AND o.deleted_at IS NULL AND o.end_date IS NULL AND o.start_date = p_date LOOP
    IF r.person_id = p_person_id AND r.shares - p_shares <= 0 THEN
      UPDATE public.asset_ownerships SET deleted_at = now() WHERE id = r.id;
      v_same := v_same || jsonb_build_array(jsonb_build_object('id', r.id, 'person_id', r.person_id, 'shares', r.shares, 'removed', true));
    ELSE
      v_same := v_same || jsonb_build_array(jsonb_build_object('id', r.id, 'person_id', r.person_id, 'shares', r.shares, 'removed', false));
    END IF;
  END LOOP;
  -- หุ้นที่ครอบครัวถือ / % ของบริษัท
  IF v_left > 0 THEN
    UPDATE public.private_business_details
       SET shares_owned = v_left,
           company_ownership_percent = CASE WHEN total_shares > 0 THEN round(v_left * 100 / total_shares, 4) ELSE company_ownership_percent END
     WHERE id = d.id;
  END IF;
  -- แถววันเดียวกันที่ยังเหลือ: ปรับหุ้น (และคำนวณ % ใหม่)
  FOR r IN SELECT (x->>'id')::uuid AS id, (x->>'person_id')::uuid AS person_id, (x->>'shares')::numeric AS shares
             FROM jsonb_array_elements(v_same) x WHERE NOT (x->>'removed')::boolean LOOP
    UPDATE public.asset_ownerships SET shares = CASE WHEN r.person_id = p_person_id THEN r.shares - p_shares ELSE r.shares END
     WHERE id = r.id;
  END LOOP;
  -- แถวใหม่ตั้งแต่วันขาย
  FOR r IN SELECT o.person_id, o.shares FROM public.asset_ownerships o WHERE o.id = ANY (v_ended) LOOP
    v_sh := CASE WHEN r.person_id = p_person_id THEN r.shares - p_shares ELSE r.shares END;
    IF v_sh > 0 THEN
      INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, shares, start_date, notes)
      VALUES (a.id, r.person_id, 0.0001, v_sh, p_date, CASE WHEN r.person_id = p_person_id THEN 'หลังขายหุ้น ' || to_char(p_date, 'DD/MM/YYYY') END)
      RETURNING id INTO v_new;
      v_inserted := v_inserted || v_new;
    END IF;
  END LOOP;

  -- มูลค่า ณ วันขาย
  IF v_before IS NOT NULL THEN
    IF v_val.valuation_date = p_date THEN
      v_val_id := v_val.id; v_prev_val := v_val.value;
      UPDATE public.asset_valuations SET value = v_after WHERE id = v_val.id;
    ELSE
      INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
      VALUES (a.id, p_date, v_after, v_val.valuation_method, 'USER',
              'หลังขายหุ้น ' || coalesce(v_person, '') || ' ' || trim(to_char(p_shares, 'FM999,999,999,990.##########')) || ' หุ้น')
      RETURNING id INTO v_val_id;
      v_val_created := true;
    END IF;
  END IF;

  -- เงินขายเข้าบัญชี
  v_net := p_price - coalesce(p_fee, 0);
  IF p_bank_asset_id IS NOT NULL AND v_net > 0 THEN
    INSERT INTO public.cash_movements(movement_date, movement_type, from_asset_id, to_asset_id, amount, currency, description, notes, metadata)
    VALUES (p_date, 'ASSET_SALE', a.id, p_bank_asset_id, v_net, a.currency,
            'ขายหุ้น · ' || a.name || ' · ' || coalesce(v_person, ''), nullif(trim(p_notes), ''),
            jsonb_build_object('share_sale', true, 'person_id', p_person_id, 'shares', p_shares, 'sale_price', p_price, 'fee', coalesce(p_fee, 0)))
    RETURNING id INTO v_mv;
  END IF;

  -- ทุกคนขายหมด → ขายหุ้นแล้ว
  IF v_left <= 0 THEN
    UPDATE public.private_business_details SET status = 'SOLD' WHERE id = d.id;
    UPDATE public.assets SET status = 'SOLD' WHERE id = a.id;
  END IF;

  RETURN private.write_share_sale(jsonb_build_object(
    'asset_id', a.id, 'person_id', p_person_id, 'sale_date', p_date, 'shares', p_shares, 'price', p_price, 'fee', coalesce(p_fee, 0),
    'currency', a.currency, 'bank_asset_id', p_bank_asset_id, 'movement_id', v_mv, 'family_shares_before', v_total,
    'value_before', v_before, 'value_after', v_after, 'valuation_id', v_val_id, 'valuation_created', v_val_created,
    'prev_valuation_value', v_prev_val, 'ended_rows', to_jsonb(v_ended), 'inserted_rows', to_jsonb(v_inserted),
    'same_day_rows', v_same, 'prev_asset_status', a.status, 'prev_business_status', d.status, 'notes', p_notes));
END $$;
REVOKE ALL ON FUNCTION public.sell_business_shares(uuid, uuid, date, numeric, numeric, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sell_business_shares(uuid, uuid, date, numeric, numeric, numeric, uuid, text) TO authenticated;

-- 3) ยกเลิกการขาย (เฉพาะครั้งล่าสุด) ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.undo_business_share_sale(uuid);
CREATE FUNCTION public.undo_business_share_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE s public.business_share_sales; x jsonb;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO s FROM public.business_share_sales WHERE id = p_sale_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบรายการขายนี้' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.business_share_sales o WHERE o.asset_id = s.asset_id AND o.deleted_at IS NULL AND o.id <> s.id
              AND (o.sale_date > s.sale_date OR (o.sale_date = s.sale_date AND o.created_at > s.created_at))) THEN
    RAISE EXCEPTION 'INVALID: ยกเลิกได้เฉพาะการขายครั้งล่าสุด — ยกเลิกครั้งหลังกว่าก่อน' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.asset_valuations v WHERE v.asset_id = s.asset_id AND v.deleted_at IS NULL AND v.valuation_date > s.sale_date) THEN
    RAISE EXCEPTION 'INVALID: มีมูลค่าที่บันทึกหลังวันขาย — ลบมูลค่านั้นก่อน' USING ERRCODE = '22023';
  END IF;

  -- สถานะ / หุ้นที่ครอบครัวถือ กลับเป็นก่อนขาย (ก่อนแก้แถวเจ้าของ เพื่อให้ % คำนวณจากหุ้นรวมเดิม)
  UPDATE public.assets SET status = coalesce(s.prev_asset_status, 'ACTIVE') WHERE id = s.asset_id AND status <> coalesce(s.prev_asset_status, 'ACTIVE');
  UPDATE public.private_business_details
     SET status = coalesce(s.prev_business_status, status),
         shares_owned = s.family_shares_before,
         company_ownership_percent = CASE WHEN total_shares > 0 THEN round(s.family_shares_before * 100 / total_shares, 4) ELSE company_ownership_percent END
   WHERE asset_id = s.asset_id AND deleted_at IS NULL;
  -- เจ้าของ: ลบแถวใหม่ · เปิดแถวเดิมต่อ · แถววันเดียวกันคืนหุ้นเดิม (แถวที่ถูกลบ → สร้างกลับ)
  UPDATE public.asset_ownerships SET deleted_at = now() WHERE id = ANY (s.inserted_rows) AND deleted_at IS NULL;
  UPDATE public.asset_ownerships SET end_date = NULL WHERE id = ANY (s.ended_rows) AND deleted_at IS NULL;
  FOR x IN SELECT * FROM jsonb_array_elements(s.same_day_rows) LOOP
    IF (x->>'removed')::boolean THEN
      INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, shares, start_date)
      VALUES (s.asset_id, (x->>'person_id')::uuid, 0.0001, (x->>'shares')::numeric, s.sale_date);
    ELSE
      UPDATE public.asset_ownerships SET shares = (x->>'shares')::numeric WHERE id = (x->>'id')::uuid AND deleted_at IS NULL;
    END IF;
  END LOOP;
  -- มูลค่า
  IF s.valuation_id IS NOT NULL THEN
    IF s.valuation_created THEN
      UPDATE public.asset_valuations SET deleted_at = now() WHERE id = s.valuation_id AND deleted_at IS NULL;
    ELSE
      UPDATE public.asset_valuations SET value = s.prev_valuation_value WHERE id = s.valuation_id AND deleted_at IS NULL;
    END IF;
  END IF;
  -- เงินเข้าบัญชี
  IF s.movement_id IS NOT NULL THEN
    UPDATE public.cash_movements SET deleted_at = now() WHERE id = s.movement_id AND deleted_at IS NULL;
  END IF;
  PERFORM private.close_share_sale(s.id);
END $$;
REVOKE ALL ON FUNCTION public.undo_business_share_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_business_share_sale(uuid) TO authenticated;
