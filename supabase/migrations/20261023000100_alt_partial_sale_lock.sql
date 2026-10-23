-- =====================================================================
-- Alternative: ขายบางส่วน + ล็อกหน่วยนับ / ห้ามลบ เมื่อ "มีรายการแล้ว" (Alternative + Property) · ตกลง 23 ต.ค.
--   1) private.asset_has_history(asset) = มีการซื้อ / ขาย (เงินเข้า-ออก ASSET_PURCHASE / ASSET_SALE) · มีการขายบางส่วน
--      หรือมีมูลค่าบันทึกมากกว่า 1 ครั้ง (นับราคาทองอัตโนมัติด้วย)
--   2) ห้ามลบ (Alternative + Property ที่มีรายการแล้ว) → ให้เปลี่ยนสถานะเป็น ขายแล้ว / ยกให้แล้ว / สูญหาย แทน
--      trigger บน assets (เฉพาะผู้ใช้ · งานระบบไม่โดน) — delete_asset ลบมูลค่าก่อนลบทรัพย์สินในคำสั่งเดียวกัน
--      จึงนับมูลค่าที่ถูกลบในคำสั่งนี้ (deleted_at = now()) ด้วย
--   3) ห้ามแก้หน่วยนับ Alternative ที่มีรายการแล้ว (trigger บน alternative_asset_details)
--   4) ขายบางส่วน sell_alternative_part(): ขายตามสัดส่วนเจ้าของทุกคน (% เจ้าของไม่เปลี่ยน)
--      มูลค่าส่วนที่ขาย = มูลค่าล่าสุด × จำนวนที่ขาย ÷ จำนวนทั้งหมด · กำไร / ขาดทุน = เงินขายสุทธิ − มูลค่าส่วนที่ขาย
--      (แบบเดียวกับ sell_asset) · จำนวนลด · มูลค่า ณ วันขาย = มูลค่าเดิม − ส่วนที่ขาย · ราคาทุนลดตามสัดส่วน
--      มูลค่าที่บันทึกหลังวันขาย (เช่น ราคาทองอัตโนมัติ) ปรับตามจำนวนที่เหลือ · ขายครบทั้งจำนวน → ใช้ sell_asset (ขายทั้งรายการ)
--   5) undo_alternative_part_sale(): ยกเลิกได้เฉพาะครั้งล่าสุด · คืนจำนวน / มูลค่า / ราคาทุน / เงินเข้าบัญชี / กำไร-ขาดทุน
--   ตารางใหม่ alternative_part_sales (อ่านได้ทุกบทบาท · เขียนผ่านฟังก์ชันเท่านั้น) · ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) ประวัติขายบางส่วน -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alternative_part_sales (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          uuid NOT NULL REFERENCES public.assets(id),
  sale_date         date NOT NULL,
  quantity          public.d_qty NOT NULL CHECK (quantity > 0),          -- จำนวนที่ขาย
  quantity_before   public.d_qty NOT NULL,
  price             public.d_money NOT NULL CHECK (price >= 0),
  fee               public.d_money NOT NULL DEFAULT 0 CHECK (fee >= 0),
  currency          public.d_currency NOT NULL,
  bank_asset_id     uuid REFERENCES public.assets(id),
  movement_id       uuid REFERENCES public.cash_movements(id),
  income_id         uuid REFERENCES public.income_transactions(id),
  expense_ids       uuid[] NOT NULL DEFAULT '{}',
  value_before      numeric,                                             -- มูลค่าล่าสุดก่อนขาย
  book_value        numeric,                                             -- มูลค่าส่วนที่ขาย
  gain              numeric,                                             -- กำไร (+) / ขาดทุน (−) ที่ลงบัญชี
  cost_before       numeric,                                             -- ราคาทุนก่อนขาย
  -- สิ่งที่ต้องย้อนตอนยกเลิก
  valuation_id      uuid REFERENCES public.asset_valuations(id),
  valuation_created boolean NOT NULL DEFAULT false,
  prev_valuation_value numeric,
  later_valuations  jsonb NOT NULL DEFAULT '[]'::jsonb,                  -- [{id, value}] มูลค่าหลังวันขายที่ถูกปรับ (ค่าเดิม)
  undone_at         timestamptz,
  notes             text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE INDEX IF NOT EXISTS alternative_part_sales_asset_idx ON public.alternative_part_sales(asset_id);

DROP TRIGGER IF EXISTS t10_meta ON public.alternative_part_sales;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.alternative_part_sales
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.alternative_part_sales;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.alternative_part_sales
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.alternative_part_sales;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.alternative_part_sales
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

ALTER TABLE public.alternative_part_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alternative_part_sales FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.alternative_part_sales TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.alternative_part_sales TO service_role;
DROP POLICY IF EXISTS p_select ON public.alternative_part_sales;
CREATE POLICY p_select ON public.alternative_part_sales FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));

-- เขียน / ปิดรายการ (เรียกจากฟังก์ชันขาย / ยกเลิกเท่านั้น)
CREATE OR REPLACE FUNCTION private.write_alt_part_sale(r jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  INSERT INTO public.alternative_part_sales(asset_id, sale_date, quantity, quantity_before, price, fee, currency, bank_asset_id,
              movement_id, income_id, expense_ids, value_before, book_value, gain, cost_before,
              valuation_id, valuation_created, prev_valuation_value, later_valuations, notes)
  VALUES ((r->>'asset_id')::uuid, (r->>'sale_date')::date, (r->>'quantity')::numeric, (r->>'quantity_before')::numeric,
          (r->>'price')::numeric, coalesce((r->>'fee')::numeric, 0), r->>'currency', nullif(r->>'bank_asset_id', '')::uuid,
          nullif(r->>'movement_id', '')::uuid, nullif(r->>'income_id', '')::uuid,
          coalesce((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(r->'expense_ids') x), '{}'),
          nullif(r->>'value_before', '')::numeric, nullif(r->>'book_value', '')::numeric, nullif(r->>'gain', '')::numeric,
          nullif(r->>'cost_before', '')::numeric, nullif(r->>'valuation_id', '')::uuid,
          coalesce((r->>'valuation_created')::boolean, false), nullif(r->>'prev_valuation_value', '')::numeric,
          coalesce(r->'later_valuations', '[]'::jsonb), nullif(trim(r->>'notes'), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION private.write_alt_part_sale(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.write_alt_part_sale(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION private.close_alt_part_sale(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  UPDATE public.alternative_part_sales SET undone_at = now(), deleted_at = now() WHERE id = p_id AND deleted_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION private.close_alt_part_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.close_alt_part_sale(uuid) TO authenticated;

-- 2) "มีรายการแล้ว" ------------------------------------------------------------------------------
--   มูลค่าที่ถูกลบในคำสั่งเดียวกัน (deleted_at = now()) ยังนับ — delete_asset ลบมูลค่าก่อนลบทรัพย์สิน
CREATE OR REPLACE FUNCTION private.asset_has_history(p_asset uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.cash_movements m
                  WHERE m.deleted_at IS NULL AND m.movement_type IN ('ASSET_PURCHASE','ASSET_SALE')
                    AND (m.from_asset_id = p_asset OR m.to_asset_id = p_asset))
      OR EXISTS (SELECT 1 FROM public.alternative_part_sales s WHERE s.asset_id = p_asset AND s.deleted_at IS NULL)
      OR (SELECT count(*) FROM public.asset_valuations v
           WHERE v.asset_id = p_asset AND (v.deleted_at IS NULL OR v.deleted_at = now())) > 1
$$;
REVOKE ALL ON FUNCTION private.asset_has_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.asset_has_history(uuid) TO authenticated;

-- ให้หน้าจอรู้ว่าจะซ่อนปุ่มลบ / ล็อกหน่วย
CREATE OR REPLACE FUNCTION public.asset_has_history(p_asset_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.asset_has_history(p_asset_id)
$$;
REVOKE ALL ON FUNCTION public.asset_has_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asset_has_history(uuid) TO authenticated;

-- 3) ห้ามลบ Alternative / Property ที่มีรายการแล้ว ------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_asset_delete_history() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND private.is_client()
     AND NEW.asset_group IN ('ALTERNATIVE','PROPERTY') AND private.asset_has_history(NEW.id) THEN
    RAISE EXCEPTION 'INVALID: รายการนี้มีประวัติแล้ว (ซื้อ / ขาย หรือมูลค่ามากกว่า 1 ครั้ง) — ลบไม่ได้ ให้เปลี่ยนสถานะเป็น ขายแล้ว / ยกให้แล้ว / สูญหาย แทน'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_asset_delete_history() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t27_delete_history ON public.assets;
CREATE TRIGGER t27_delete_history BEFORE UPDATE OF deleted_at ON public.assets
  FOR EACH ROW EXECUTE FUNCTION private.tg_asset_delete_history();

-- 4) ห้ามแก้หน่วยนับ Alternative ที่มีรายการแล้ว ------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_alt_unit_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.unit IS DISTINCT FROM OLD.unit AND NEW.deleted_at IS NULL AND private.is_client() AND private.asset_has_history(NEW.asset_id) THEN
    RAISE EXCEPTION 'INVALID: รายการนี้มีประวัติแล้ว (ซื้อ / ขาย หรือมูลค่ามากกว่า 1 ครั้ง) — เปลี่ยนหน่วยนับไม่ได้'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_alt_unit_lock() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t27_unit_lock ON public.alternative_asset_details;
CREATE TRIGGER t27_unit_lock BEFORE UPDATE OF unit ON public.alternative_asset_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_alt_unit_lock();

-- 5) ขายบางส่วน --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sell_alternative_part(p_asset_id uuid, p_date date, p_quantity numeric, p_price numeric,
  p_fee numeric DEFAULT NULL, p_bank_asset_id uuid DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.assets; d public.alternative_asset_details; v_go_live date;
  v_val public.asset_valuations; v_before numeric; v_book numeric; v_after numeric; v_net numeric; v_gain numeric; v_sale numeric;
  v_ratio numeric; v_left numeric; v_vres jsonb; v_later jsonb; v_mv uuid; v_inc uuid; v_exps uuid[] := '{}'; v_exp uuid;
  o record; v_n int; v_i int := 0; v_part numeric; v_rest numeric; v_qty_txt text;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id AND deleted_at IS NULL;
  IF NOT FOUND OR a.asset_group <> 'ALTERNATIVE' THEN RAISE EXCEPTION 'INVALID: ไม่พบสินทรัพย์นี้' USING ERRCODE = '22023'; END IF;
  IF a.status <> 'ACTIVE' THEN RAISE EXCEPTION 'INVALID: สินทรัพย์นี้ไม่ได้อยู่ในสถานะถืออยู่' USING ERRCODE = '22023'; END IF;
  SELECT * INTO d FROM public.alternative_asset_details WHERE asset_id = a.id AND deleted_at IS NULL;
  IF coalesce(d.quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'INVALID: ใส่ "จำนวน" ของรายการนี้ก่อน (แก้ไขข้อมูล) จึงจะขายบางส่วนได้' USING ERRCODE = '22023';
  END IF;
  SELECT f.go_live_date INTO v_go_live FROM public.families f WHERE f.id = a.family_id;
  IF p_date IS NULL OR p_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ขายไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_go_live IS NOT NULL AND p_date < v_go_live THEN
    RAISE EXCEPTION 'INVALID: วันที่ต้องไม่ก่อนวัน Go-live (%)', to_char(v_go_live, 'DD/MM/YYYY') USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่จำนวนที่ขาย' USING ERRCODE = '22023'; END IF;
  IF p_quantity >= d.quantity THEN
    RAISE EXCEPTION 'INVALID: ขายครบทั้งจำนวน ให้บันทึกเป็นการขายทั้งรายการ' USING ERRCODE = '22023';
  END IF;
  IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ราคาขาย' USING ERRCODE = '22023'; END IF;
  IF coalesce(p_fee, 0) < 0 OR coalesce(p_fee, 0) > p_price THEN RAISE EXCEPTION 'INVALID: ค่าใช้จ่ายในการขายไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF p_bank_asset_id IS NOT NULL AND NOT private.is_bank_asset(p_bank_asset_id) THEN
    RAISE EXCEPTION 'INVALID: ไม่พบบัญชีที่รับเงิน' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.alternative_part_sales s WHERE s.asset_id = a.id AND s.deleted_at IS NULL AND s.sale_date > p_date) THEN
    RAISE EXCEPTION 'INVALID: มีการขายบางส่วนหลังวันนี้แล้ว — บันทึกเรียงตามวันที่' USING ERRCODE = '22023';
  END IF;

  v_left := d.quantity - p_quantity;
  v_ratio := v_left / d.quantity;
  v_net := p_price - coalesce(p_fee, 0);
  v_qty_txt := trim(to_char(p_quantity, 'FM999,999,999,990.##########')) || coalesce(' ' || d.unit, '');
  -- มูลค่าส่วนที่ขาย (มูลค่าล่าสุด ณ วันขาย × สัดส่วน) · ไม่มีมูลค่า → ราคาทุนตามสัดส่วน
  SELECT * INTO v_val FROM public.asset_valuations v WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.valuation_date <= p_date
   ORDER BY v.valuation_date DESC, v.created_at DESC LIMIT 1;
  v_before := v_val.value;
  v_book := CASE WHEN v_before IS NOT NULL THEN round(v_before * p_quantity / d.quantity, 2)
                 WHEN a.acquisition_cost IS NOT NULL THEN round(a.acquisition_cost * p_quantity / d.quantity, 2) END;
  v_after := CASE WHEN v_before IS NULL THEN NULL ELSE v_before - v_book END;
  v_gain := CASE WHEN v_book IS NULL THEN 0 ELSE v_net - v_book END;

  -- มูลค่าหลังวันขาย (เช่น ราคาทองอัตโนมัติที่คิดจากจำนวนเดิม) → ปรับตามจำนวนที่เหลือ · เก็บค่าเดิมไว้ยกเลิก
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'value', v.value)), '[]'::jsonb) INTO v_later
    FROM public.asset_valuations v WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.valuation_date > p_date;
  UPDATE public.asset_valuations SET value = round(value * v_ratio, 2)
   WHERE asset_id = a.id AND deleted_at IS NULL AND valuation_date > p_date;
  -- มูลค่า ณ วันขาย = มูลค่าเดิม − ส่วนที่ขาย
  IF v_after IS NOT NULL THEN
    v_vres := private.biz_set_value(a.id, p_date, v_after, coalesce(v_val.valuation_method, 'USER_ESTIMATE'), 'หลังขายบางส่วน ' || v_qty_txt);
  END IF;
  UPDATE public.alternative_asset_details SET quantity = v_left, price_pending = NULL WHERE id = d.id;
  UPDATE public.assets SET acquisition_cost = round(acquisition_cost * v_ratio, 2) WHERE id = a.id AND acquisition_cost IS NOT NULL;

  -- เงินเข้าบัญชี: ทุนคืน (ASSET_SALE) + กำไร (รายได้) = เงินขายสุทธิ · ขาดทุน: ทุนคืน = เงินขายสุทธิ
  v_sale := CASE WHEN v_gain > 0 THEN v_net - v_gain ELSE v_net END;
  IF p_bank_asset_id IS NOT NULL AND v_sale > 0 THEN
    INSERT INTO public.cash_movements(movement_date, movement_type, from_asset_id, to_asset_id, amount, currency, description, notes, metadata)
    VALUES (p_date, 'ASSET_SALE', a.id, p_bank_asset_id, v_sale, a.currency, 'ขายบางส่วน · ' || a.name || ' · ' || v_qty_txt,
            nullif(trim(p_notes), ''),
            jsonb_build_object('part_sale', true, 'quantity', p_quantity, 'sale_price', p_price, 'fee', coalesce(p_fee, 0),
                               'book_value', v_book, 'gain', v_gain))
    RETURNING id INTO v_mv;
  END IF;
  -- กำไร → รายได้ (แบ่งตามเจ้าของ) · ขาดทุน → ค่าใช้จ่ายของเจ้าของแต่ละคน ณ วันขาย (ไม่มีเงินออกจากบัญชี)
  IF v_gain > 0 THEN
    INSERT INTO public.income_transactions(asset_id, received_to_asset_id, date, income_type, income_subtype, amount, currency, notes)
    VALUES (a.id, p_bank_asset_id, p_date, 'OTHER', 'กำไรจากการขายทรัพย์สิน', v_gain, a.currency,
            'ขายบางส่วน ' || a.name || ' ' || v_qty_txt || ' (เทียบมูลค่าล่าสุด)')
    RETURNING id INTO v_inc;
  ELSIF v_gain < 0 THEN
    SELECT count(*) INTO v_n FROM private.asset_owner_shares(a.id, p_date) s WHERE s.person_id IS NOT NULL AND s.pct > 0;
    v_rest := -v_gain;
    IF v_n = 0 THEN
      v_exp := public.add_expense(jsonb_build_object('date', p_date, 'amount', -v_gain, 'currency', a.currency,
        'description', 'ขาดทุนจากการขายทรัพย์สิน · ' || a.name, 'expense_category', 'ขาดทุนจากการขายทรัพย์สิน',
        'related_asset_id', a.id, 'notes', 'ขายบางส่วน ' || v_qty_txt || ' · เทียบมูลค่าล่าสุด · ไม่มีเงินออกจากบัญชี'));
      v_exps := v_exps || v_exp;
    ELSE
      FOR o IN SELECT s.person_id, s.pct FROM private.asset_owner_shares(a.id, p_date) s
                WHERE s.person_id IS NOT NULL AND s.pct > 0 ORDER BY s.pct, s.person_id LOOP
        v_i := v_i + 1;
        v_part := CASE WHEN v_i = v_n THEN v_rest ELSE round(-v_gain * o.pct / 100, 2) END;
        v_rest := v_rest - v_part;
        IF v_part > 0 THEN
          v_exp := public.add_expense(jsonb_build_object('date', p_date, 'amount', v_part, 'currency', a.currency, 'person_id', o.person_id,
            'description', 'ขาดทุนจากการขายทรัพย์สิน · ' || a.name, 'expense_category', 'ขาดทุนจากการขายทรัพย์สิน',
            'related_asset_id', a.id, 'notes', 'ขายบางส่วน ' || v_qty_txt || ' · เทียบมูลค่าล่าสุด · ไม่มีเงินออกจากบัญชี'));
          v_exps := v_exps || v_exp;
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN private.write_alt_part_sale(jsonb_build_object(
    'asset_id', a.id, 'sale_date', p_date, 'quantity', p_quantity, 'quantity_before', d.quantity, 'price', p_price,
    'fee', coalesce(p_fee, 0), 'currency', a.currency, 'bank_asset_id', p_bank_asset_id, 'movement_id', v_mv,
    'income_id', v_inc, 'expense_ids', to_jsonb(v_exps), 'value_before', v_before, 'book_value', v_book, 'gain', v_gain,
    'cost_before', a.acquisition_cost, 'valuation_id', v_vres->>'id', 'valuation_created', coalesce((v_vres->>'created')::boolean, false),
    'prev_valuation_value', v_vres->>'prev', 'later_valuations', v_later, 'notes', p_notes));
END $$;
REVOKE ALL ON FUNCTION public.sell_alternative_part(uuid, date, numeric, numeric, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sell_alternative_part(uuid, date, numeric, numeric, numeric, uuid, text) TO authenticated;

-- 6) ยกเลิกขายบางส่วน (เฉพาะครั้งล่าสุด) ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_alternative_part_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE s public.alternative_part_sales; v_ratio numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO s FROM public.alternative_part_sales WHERE id = p_sale_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบรายการนี้' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.alternative_part_sales o WHERE o.asset_id = s.asset_id AND o.deleted_at IS NULL AND o.id <> s.id
              AND (o.sale_date > s.sale_date OR (o.sale_date = s.sale_date AND o.created_at > s.created_at))) THEN
    RAISE EXCEPTION 'INVALID: ยกเลิกได้เฉพาะรายการล่าสุด — ยกเลิกครั้งหลังกว่าก่อน' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.assets WHERE id = s.asset_id AND status <> 'ACTIVE') THEN
    RAISE EXCEPTION 'INVALID: สินทรัพย์นี้ไม่ได้อยู่ในสถานะถืออยู่แล้ว — เปลี่ยนสถานะกลับเป็นถืออยู่ก่อน' USING ERRCODE = '22023';
  END IF;

  v_ratio := s.quantity_before / (s.quantity_before - s.quantity);
  -- มูลค่าหลังวันขาย: แถวที่ปรับตอนขาย → ค่าเดิม · แถวที่บันทึกทีหลัง (คิดจากจำนวนที่เหลือ) → ปรับกลับเป็นจำนวนเดิม
  UPDATE public.asset_valuations v SET value = (x->>'value')::numeric
    FROM jsonb_array_elements(s.later_valuations) x
   WHERE v.id = (x->>'id')::uuid AND v.deleted_at IS NULL;
  UPDATE public.asset_valuations v SET value = round(v.value * v_ratio, 2)
   WHERE v.asset_id = s.asset_id AND v.deleted_at IS NULL AND v.valuation_date > s.sale_date
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s.later_valuations) x WHERE (x->>'id')::uuid = v.id);
  -- มูลค่า ณ วันขาย
  IF s.valuation_id IS NOT NULL THEN
    IF s.valuation_created THEN
      UPDATE public.asset_valuations SET deleted_at = now() WHERE id = s.valuation_id AND deleted_at IS NULL;
    ELSE
      UPDATE public.asset_valuations SET value = s.prev_valuation_value WHERE id = s.valuation_id AND deleted_at IS NULL;
    END IF;
  END IF;
  UPDATE public.alternative_asset_details SET quantity = quantity + s.quantity WHERE asset_id = s.asset_id AND deleted_at IS NULL;
  UPDATE public.assets SET acquisition_cost = s.cost_before WHERE id = s.asset_id AND acquisition_cost IS DISTINCT FROM s.cost_before;
  -- เงินเข้าบัญชี · กำไร / ขาดทุน
  IF s.movement_id IS NOT NULL THEN
    UPDATE public.cash_movements SET deleted_at = now() WHERE id = s.movement_id AND deleted_at IS NULL;
  END IF;
  IF s.income_id IS NOT NULL THEN
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = s.income_id AND deleted_at IS NULL;
  END IF;
  UPDATE public.expense_items SET deleted_at = now() WHERE id = ANY (s.expense_ids) AND deleted_at IS NULL;
  PERFORM private.close_alt_part_sale(s.id);
END $$;
REVOKE ALL ON FUNCTION public.undo_alternative_part_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_alternative_part_sale(uuid) TO authenticated;
