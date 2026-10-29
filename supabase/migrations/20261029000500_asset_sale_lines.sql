-- =====================================================================
-- ขาย / รื้อถอน: รับเงินหลายบัญชี + ค่าใช้จ่ายหลายรายการ (ตกลง 29 ต.ค. 2026 · ข้อ 12 / 12.1 ใน proposals/property-market-price.md)
--   p_receipts = [{bank_asset_id, amount, note?}]  เงินที่เข้าแต่ละบัญชีจริง (หลังหักค่าใช้จ่ายที่หักจากเงินขายแล้ว)
--   p_costs    = [{label, amount, pay: 'DEDUCT' | 'BANK' | 'CARD', bank_asset_id?, card_id?}]
--                DEDUCT = หักจากเงินที่ได้รับ (ไม่มีรายการเงินออก) · BANK / CARD = จ่ายจากบัญชี / บัตร → ค่าใช้จ่าย
--                หมวด "ค่าใช้จ่ายในการขาย / รื้อถอนทรัพย์สิน" ของเจ้าของตามสัดส่วน
--   ราคาขาย = เงินรับรวม + ค่าใช้จ่ายที่หักจากเงินที่ได้รับ · กำไร / ขาดทุน = เงินรับรวม − มูลค่าเดิม (เหมือนเดิม)
--   ทุกรายการลงวันเดียวกับวันขาย
--   1) private.disposal_post: ลงเงินเข้า (ทุนคืน ASSET_SALE + กำไร = รายได้) · ขาดทุน · ค่าใช้จ่ายที่จ่ายจากบัญชี / บัตร
--   2) end_property_components: รับ p_receipts / p_costs · ขายครบทุกแถว = ขายทั้งทรัพย์สิน (ทุกแถว "ขายแล้ว" + สถานะ SOLD)
--   3) undo_property_component_event: ลบทุกรายการที่สร้างพร้อมกัน · ยกเลิกขายทั้งทรัพย์สินได้ (สถานะกลับเป็นถืออยู่)
--   4) sell_asset: รับ p_receipts / p_costs · Property ที่มีส่วนประกอบ → ขายทุกแถวผ่านข้อ 2
--   5) ต้นทุนรายก้อน: เงินออกตอนเพิ่มทรัพย์สิน (metadata.acquisition) = ส่วนหนึ่งของราคาที่ได้มา ไม่นับซ้ำ (เช่น เงินดาวน์)
--   เปลี่ยน signature: DROP end_property_components / sell_asset แบบเดิม แล้วสร้างใหม่ + grant · ไม่แก้ข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 0) ช่องเพิ่มของรายการขาย / รื้อถอน -----------------------------------------------------------------------------
ALTER TABLE public.property_component_events ADD COLUMN IF NOT EXISTS whole boolean NOT NULL DEFAULT false;      -- ขายทั้งทรัพย์สิน
ALTER TABLE public.property_component_events ADD COLUMN IF NOT EXISTS movement_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.property_component_events ADD COLUMN IF NOT EXISTS income_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.property_component_events ADD COLUMN IF NOT EXISTS receipts jsonb;
ALTER TABLE public.property_component_events ADD COLUMN IF NOT EXISTS costs jsonb;

CREATE OR REPLACE FUNCTION private.write_component_event(r jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  INSERT INTO public.property_component_events(asset_id, event_type, event_date, component_ids, price, fee, currency, bank_asset_id,
              movement_id, income_id, expense_ids, value_before, book_value, gain, cost_removed, cost_before, valuation_id, notes,
              whole, movement_ids, income_ids, receipts, costs)
  VALUES ((r->>'asset_id')::uuid, r->>'event_type', (r->>'event_date')::date,
          (SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(r->'component_ids') x),
          coalesce((r->>'price')::numeric, 0), coalesce((r->>'fee')::numeric, 0), r->>'currency', nullif(r->>'bank_asset_id', '')::uuid,
          nullif(r->>'movement_id', '')::uuid, nullif(r->>'income_id', '')::uuid,
          coalesce((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(r->'expense_ids') x), '{}'),
          nullif(r->>'value_before', '')::numeric, nullif(r->>'book_value', '')::numeric, nullif(r->>'gain', '')::numeric,
          nullif(r->>'cost_removed', '')::numeric, nullif(r->>'cost_before', '')::numeric, nullif(r->>'valuation_id', '')::uuid,
          nullif(trim(r->>'notes'), ''), coalesce((r->>'whole')::boolean, false),
          coalesce((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(r->'movement_ids') x), '{}'),
          coalesce((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(r->'income_ids') x), '{}'),
          r->'receipts', r->'costs')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION private.write_component_event(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.write_component_event(jsonb) TO authenticated;

-- 1) ค่าใช้จ่ายของเจ้าของตามสัดส่วน (ไม่มีเจ้าของ = รายการเดียว) · คืน id ทุกรายการ -----------------------------------
CREATE OR REPLACE FUNCTION private.owner_expenses(p_asset uuid, p_date date, p_amount numeric, p_ccy text, p_cat text, p_desc text,
  p_notes text, p_bank uuid DEFAULT NULL, p_card uuid DEFAULT NULL)
RETURNS uuid[] LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE o record; v_n int; v_i int := 0; v_part numeric; v_rest numeric := p_amount; v_ids uuid[] := '{}'; v_pay jsonb;
BEGIN
  IF coalesce(p_amount, 0) <= 0 THEN RETURN v_ids; END IF;
  v_pay := jsonb_build_object('paid_from_asset_id', p_bank, 'paid_from_credit_card_id', p_card);
  SELECT count(*) INTO v_n FROM private.asset_owner_shares(p_asset, p_date) s WHERE s.person_id IS NOT NULL AND s.pct > 0;
  IF v_n = 0 THEN
    RETURN v_ids || public.add_expense(v_pay || jsonb_build_object('date', p_date, 'amount', p_amount, 'currency', p_ccy,
      'description', p_desc, 'expense_category', p_cat, 'related_asset_id', p_asset, 'notes', p_notes));
  END IF;
  FOR o IN SELECT s.person_id, s.pct FROM private.asset_owner_shares(p_asset, p_date) s
            WHERE s.person_id IS NOT NULL AND s.pct > 0 ORDER BY s.pct, s.person_id LOOP
    v_i := v_i + 1;
    v_part := CASE WHEN v_i = v_n THEN v_rest ELSE round(p_amount * o.pct / 100, 2) END;
    v_rest := v_rest - v_part;
    IF v_part > 0 THEN
      v_ids := v_ids || public.add_expense(v_pay || jsonb_build_object('date', p_date, 'amount', v_part, 'currency', p_ccy,
        'person_id', o.person_id, 'description', p_desc, 'expense_category', p_cat, 'related_asset_id', p_asset, 'notes', p_notes));
    END IF;
  END LOOP;
  RETURN v_ids;
END $$;
REVOKE ALL ON FUNCTION private.owner_expenses(uuid, date, numeric, text, text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.owner_expenses(uuid, date, numeric, text, text, text, text, uuid, uuid) TO authenticated;

-- ตรวจรายการรับเงิน / ค่าใช้จ่าย → {received, deducted, paid, receipts, costs} (รูปแบบมาตรฐาน)
CREATE OR REPLACE FUNCTION private.disposal_check(p_receipts jsonb, p_costs jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_rec jsonb := '[]'; v_cost jsonb := '[]'; v_received numeric := 0; v_deducted numeric := 0; v_paid numeric := 0;
  v_amt numeric; v_pay text; v_i int := 0;
BEGIN
  IF p_receipts IS NOT NULL AND jsonb_typeof(p_receipts) <> 'array' OR p_costs IS NOT NULL AND jsonb_typeof(p_costs) <> 'array' THEN
    RAISE EXCEPTION 'INVALID: รูปแบบรายการรับเงิน / ค่าใช้จ่ายไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT x FROM jsonb_array_elements(coalesce(p_receipts, '[]')) x LOOP
    v_i := v_i + 1;
    v_amt := nullif(r->>'amount', '')::numeric;
    IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'INVALID: รับเงินแถวที่ % ใส่จำนวนเงินมากกว่า 0', v_i USING ERRCODE = '22023'; END IF;
    IF nullif(r->>'bank_asset_id', '') IS NULL OR NOT private.is_bank_asset((r->>'bank_asset_id')::uuid) THEN
      RAISE EXCEPTION 'INVALID: รับเงินแถวที่ % เลือกบัญชีที่รับเงิน', v_i USING ERRCODE = '22023';
    END IF;
    v_received := v_received + v_amt;
    v_rec := v_rec || jsonb_build_array(jsonb_build_object('bank_asset_id', r->>'bank_asset_id', 'amount', round(v_amt, 2),
                                                           'note', nullif(trim(r->>'note'), '')));
  END LOOP;
  v_i := 0;
  FOR r IN SELECT x FROM jsonb_array_elements(coalesce(p_costs, '[]')) x LOOP
    v_i := v_i + 1;
    v_amt := nullif(r->>'amount', '')::numeric;
    v_pay := coalesce(nullif(r->>'pay', ''), 'DEDUCT');
    IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'INVALID: ค่าใช้จ่ายแถวที่ % ใส่จำนวนเงินมากกว่า 0', v_i USING ERRCODE = '22023'; END IF;
    IF length(trim(coalesce(r->>'label', ''))) = 0 THEN RAISE EXCEPTION 'INVALID: ค่าใช้จ่ายแถวที่ % ใส่รายการ', v_i USING ERRCODE = '22023'; END IF;
    IF v_pay NOT IN ('DEDUCT','BANK','CARD') THEN RAISE EXCEPTION 'INVALID: ค่าใช้จ่ายแถวที่ % วิธีจ่ายไม่ถูกต้อง', v_i USING ERRCODE = '22023'; END IF;
    IF v_pay = 'BANK' AND (nullif(r->>'bank_asset_id', '') IS NULL OR NOT private.is_bank_asset((r->>'bank_asset_id')::uuid)) THEN
      RAISE EXCEPTION 'INVALID: ค่าใช้จ่ายแถวที่ % เลือกบัญชีที่จ่าย', v_i USING ERRCODE = '22023';
    END IF;
    IF v_pay = 'CARD' AND NOT EXISTS (SELECT 1 FROM public.credit_cards c WHERE c.id = nullif(r->>'card_id', '')::uuid AND c.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'INVALID: ค่าใช้จ่ายแถวที่ % เลือกบัตรที่จ่าย', v_i USING ERRCODE = '22023';
    END IF;
    IF v_pay = 'DEDUCT' THEN v_deducted := v_deducted + v_amt; ELSE v_paid := v_paid + v_amt; END IF;
    v_cost := v_cost || jsonb_build_array(jsonb_build_object('label', trim(r->>'label'), 'amount', round(v_amt, 2), 'pay', v_pay,
      'bank_asset_id', CASE WHEN v_pay = 'BANK' THEN r->>'bank_asset_id' END, 'card_id', CASE WHEN v_pay = 'CARD' THEN r->>'card_id' END));
  END LOOP;
  RETURN jsonb_build_object('received', round(v_received, 2), 'deducted', round(v_deducted, 2), 'paid', round(v_paid, 2),
                            'receipts', v_rec, 'costs', v_cost);
END $$;
REVOKE ALL ON FUNCTION private.disposal_check(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.disposal_check(jsonb, jsonb) TO authenticated;

-- ลงรายการ: เงินเข้าแต่ละบัญชี (ทุนคืน ASSET_SALE · กำไรเป็นรายได้ ลงจากแถวท้ายขึ้นมา) · ขาดทุน · ค่าใช้จ่ายที่จ่ายจากบัญชี / บัตร
--   p_chk = ผลจาก disposal_check · p_book = มูลค่าเดิม (NULL = ไม่มีข้อมูล → ไม่ลงกำไร / ขาดทุน)
--   คืน {movement_ids, income_ids, expense_ids, gain}
CREATE OR REPLACE FUNCTION private.disposal_post(p_asset uuid, p_date date, p_chk jsonb, p_book numeric, p_desc text,
  p_gain_subtype text, p_loss_cat text, p_notes text, p_meta jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.assets; v_received numeric := (p_chk->>'received')::numeric; v_gain numeric; v_left numeric; r jsonb;
  v_n int; v_i int; v_g numeric; v_m numeric; v_id uuid; v_mvs uuid[] := '{}'; v_incs uuid[] := '{}'; v_exps uuid[] := '{}';
  v_meta jsonb;
BEGIN
  SELECT * INTO a FROM public.assets WHERE id = p_asset;
  v_gain := CASE WHEN p_book IS NULL THEN 0 ELSE v_received - p_book END;
  v_meta := coalesce(p_meta, '{}') || jsonb_build_object('sale_price', v_received + (p_chk->>'deducted')::numeric,
              'fee', (p_chk->>'deducted')::numeric + (p_chk->>'paid')::numeric, 'book_value', p_book, 'gain', v_gain);
  -- กำไรลงจากแถวท้ายขึ้นมา (แถวแรกเป็นเงินทุนคืนก่อน)
  v_left := greatest(v_gain, 0);
  v_n := jsonb_array_length(p_chk->'receipts');
  FOR v_i IN REVERSE v_n - 1 .. 0 LOOP
    r := p_chk->'receipts'->v_i;
    v_g := least(v_left, (r->>'amount')::numeric);
    v_m := (r->>'amount')::numeric - v_g;
    v_left := v_left - v_g;
    IF v_m > 0 THEN
      INSERT INTO public.cash_movements(movement_date, movement_type, from_asset_id, to_asset_id, amount, currency, description, notes, metadata)
      VALUES (p_date, 'ASSET_SALE', a.id, (r->>'bank_asset_id')::uuid, v_m, a.currency, p_desc,
              nullif(concat_ws(' · ', r->>'note', nullif(trim(p_notes), '')), ''), v_meta)
      RETURNING id INTO v_id;
      v_mvs := v_id || v_mvs;
    END IF;
    IF v_g > 0 THEN
      INSERT INTO public.income_transactions(asset_id, received_to_asset_id, date, income_type, income_subtype, amount, currency, notes)
      VALUES (a.id, (r->>'bank_asset_id')::uuid, p_date, 'OTHER', p_gain_subtype, v_g, a.currency, p_desc || ' (เทียบมูลค่าล่าสุด)')
      RETURNING id INTO v_id;
      v_incs := v_id || v_incs;
    END IF;
  END LOOP;
  IF v_left > 0 THEN   -- ไม่มีเงินรับ แต่มีกำไร (ไม่ควรเกิด: กำไร ≤ เงินรับ)
    RAISE EXCEPTION 'INVALID: กำไรมากกว่าเงินที่รับ' USING ERRCODE = '22023';
  END IF;
  -- ขาดทุน → ค่าใช้จ่ายของเจ้าของ (ไม่มีเงินออก)
  IF v_gain < 0 THEN
    v_exps := v_exps || private.owner_expenses(a.id, p_date, -v_gain, a.currency, p_loss_cat, p_loss_cat || ' · ' || a.name,
                                               p_desc || ' · เทียบมูลค่าล่าสุด · ไม่มีเงินออกจากบัญชี');
  END IF;
  -- ค่าใช้จ่ายที่จ่ายจากบัญชี / บัตร
  FOR r IN SELECT x FROM jsonb_array_elements(p_chk->'costs') x WHERE x->>'pay' IN ('BANK','CARD') LOOP
    v_exps := v_exps || private.owner_expenses(a.id, p_date, (r->>'amount')::numeric, a.currency,
      'ค่าใช้จ่ายในการขาย / รื้อถอนทรัพย์สิน', (r->>'label') || ' · ' || a.name, p_desc,
      nullif(r->>'bank_asset_id', '')::uuid, nullif(r->>'card_id', '')::uuid);
  END LOOP;
  RETURN jsonb_build_object('movement_ids', to_jsonb(v_mvs), 'income_ids', to_jsonb(v_incs), 'expense_ids', to_jsonb(v_exps), 'gain', v_gain);
END $$;
REVOKE ALL ON FUNCTION private.disposal_post(uuid, date, jsonb, numeric, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.disposal_post(uuid, date, jsonb, numeric, text, text, text, text, jsonb) TO authenticated;

-- 2) ขาย / รื้อถอนแถว (ขายครบทุกแถว = ขายทั้งทรัพย์สิน) ---------------------------------------------------------------
DROP FUNCTION IF EXISTS public.end_property_components(uuid, text, uuid[], date, numeric, numeric, uuid, numeric, text);
CREATE OR REPLACE FUNCTION public.end_property_components(p_asset_id uuid, p_kind text, p_component_ids uuid[], p_date date,
  p_receipts jsonb DEFAULT '[]', p_costs jsonb DEFAULT '[]', p_book_value numeric DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.assets; v_pid uuid; v_go_live date; v_ids uuid[]; v_n int; v_left int; v_whole boolean;
  v_val public.asset_valuations; v_has_parts boolean := false; v_before numeric; v_book numeric; v_after numeric; v_parts jsonb;
  v_chk jsonb; v_price numeric; v_post jsonb; v_rem numeric; v_area_base numeric; v_cost_out numeric := 0; c record;
  v_names text; v_what text; v_valid uuid; v_ev uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id AND deleted_at IS NULL;
  SELECT pd.id INTO v_pid FROM public.property_details pd WHERE pd.asset_id = p_asset_id AND pd.deleted_at IS NULL;
  IF a.id IS NULL OR v_pid IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบทรัพย์สินนี้' USING ERRCODE = '22023'; END IF;
  IF a.status <> 'ACTIVE' THEN RAISE EXCEPTION 'INVALID: ทรัพย์สินนี้ไม่ได้อยู่ในสถานะถืออยู่' USING ERRCODE = '22023'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('SELL','DEMOLISH') THEN RAISE EXCEPTION 'INVALID: ชนิดรายการไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  SELECT f.go_live_date INTO v_go_live FROM public.families f WHERE f.id = a.family_id;
  IF p_date IS NULL OR p_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF v_go_live IS NOT NULL AND p_date < v_go_live THEN
    RAISE EXCEPTION 'INVALID: วันที่ต้องไม่ก่อนวัน Go-live (%)', to_char(v_go_live, 'DD/MM/YYYY') USING ERRCODE = '22023';
  END IF;
  v_chk := private.disposal_check(p_receipts, p_costs);
  v_price := (v_chk->>'received')::numeric + (v_chk->>'deducted')::numeric;
  IF p_kind = 'SELL' AND v_price <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่เงินที่ได้รับจากการขาย' USING ERRCODE = '22023'; END IF;

  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_component_ids) x WHERE x IS NOT NULL;
  IF coalesce(array_length(v_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'INVALID: เลือกแถวอย่างน้อย 1 แถว' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO v_n FROM public.property_deeds d
   WHERE d.id = ANY (v_ids) AND d.property_id = v_pid AND d.deleted_at IS NULL AND d.ended_date IS NULL;
  IF v_n <> array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'INVALID: แถวที่เลือกไม่ใช่ของทรัพย์สินนี้ หรือขาย / รื้อถอนไปแล้ว' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'DEMOLISH' AND EXISTS (SELECT 1 FROM public.property_deeds d WHERE d.id = ANY (v_ids) AND d.component_type = 'LAND') THEN
    RAISE EXCEPTION 'INVALID: รื้อถอนได้เฉพาะอาคาร / สิ่งปลูกสร้าง (ที่ดินใช้ขาย)' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.property_deeds d WHERE d.id = ANY (v_ids) AND d.acquired_date > p_date) THEN
    RAISE EXCEPTION 'INVALID: มีแถวที่ได้มาหลังวันที่นี้' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_left FROM public.property_deeds d
   WHERE d.property_id = v_pid AND d.deleted_at IS NULL AND d.ended_date IS NULL AND NOT (d.id = ANY (v_ids));
  IF v_left = 0 AND p_kind = 'DEMOLISH' THEN
    RAISE EXCEPTION 'INVALID: ต้องเหลืออย่างน้อย 1 แถว (ถ้าไม่เหลืออะไรแล้ว ให้เปลี่ยนสถานะทรัพย์สิน)' USING ERRCODE = '22023';
  END IF;
  v_whole := v_left = 0;   -- ขายครบทุกแถว = ขายทั้งทรัพย์สิน (ตกลง 29 ต.ค. 2026)
  IF v_whole AND EXISTS (SELECT 1 FROM public.property_leases l WHERE l.property_id = v_pid AND l.deleted_at IS NULL
                          AND l.status = 'ACTIVE' AND l.end_date >= p_date) THEN
    RAISE EXCEPTION 'INVALID: ยังมีสัญญาเช่าที่มีผล — บันทึกเลิกสัญญา / คืนเงินประกันก่อน' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.asset_valuations v WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.valuation_date > p_date) THEN
    RAISE EXCEPTION 'INVALID: มีมูลค่าที่บันทึกหลังวันนี้ — ใช้วันที่ที่ไม่ก่อนมูลค่าล่าสุด' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.property_component_events e WHERE e.asset_id = a.id AND e.deleted_at IS NULL AND e.event_date > p_date) THEN
    RAISE EXCEPTION 'INVALID: มีการขาย / รื้อถอนหลังวันนี้แล้ว — บันทึกเรียงตามวันที่' USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(coalesce(d.label, nullif(concat_ws(' ', d.title_type, 'เลขที่ ' || d.title_deed_no), ''),
                             CASE WHEN d.land_no IS NOT NULL THEN 'ที่ดินเลขที่ ' || d.land_no END,
                             CASE d.component_type WHEN 'LAND' THEN 'ที่ดิน' WHEN 'BUILDING' THEN 'อาคาร' ELSE 'สิ่งปลูกสร้าง' END),
                    ', ' ORDER BY d.sort_order, d.created_at)
    INTO v_names FROM public.property_deeds d WHERE d.id = ANY (v_ids);
  v_what := CASE WHEN v_whole THEN 'ขาย' WHEN p_kind = 'SELL' THEN 'ขายบางส่วน' ELSE 'รื้อถอน' END;

  -- ต้นทุนที่ตัดออก (บางแถว): ต้นทุนของแถว · แถวที่ดินที่ไม่มีต้นทุนรายแถว → ส่วนที่ยังไม่แยก × เนื้อที่ ÷ เนื้อที่ที่ดินที่ไม่มีต้นทุนรายแถว
  v_rem := greatest(coalesce(a.acquisition_cost, 0) - coalesce((SELECT sum(d.acq_cost) FROM public.property_deeds d
             WHERE d.property_id = v_pid AND d.deleted_at IS NULL AND d.ended_date IS NULL), 0), 0);
  SELECT sum(d.land_area_sq_wa) INTO v_area_base FROM public.property_deeds d
   WHERE d.property_id = v_pid AND d.deleted_at IS NULL AND d.ended_date IS NULL AND d.component_type = 'LAND'
     AND d.acq_cost IS NULL AND d.land_area_sq_wa > 0;
  FOR c IN SELECT * FROM public.property_deeds WHERE id = ANY (v_ids) LOOP
    v_cost_out := v_cost_out + CASE
      WHEN c.acq_cost IS NOT NULL THEN c.acq_cost
      WHEN c.component_type = 'LAND' AND c.land_area_sq_wa > 0 AND v_area_base > 0 THEN round(v_rem * c.land_area_sq_wa / v_area_base, 2)
      ELSE 0 END;
  END LOOP;

  SELECT * INTO v_val FROM public.asset_valuations v WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.valuation_date <= p_date
   ORDER BY v.valuation_date DESC, v.created_at DESC LIMIT 1;
  v_before := v_val.value;
  IF v_whole THEN
    -- ขายทั้งทรัพย์สิน: มูลค่าเดิม = มูลค่าล่าสุด (ไม่มี → ราคาที่ได้มา) · มูลค่า ณ วันขาย = ราคาขาย (แบบเดียวกับ sell_asset)
    v_book := coalesce(v_before, a.acquisition_cost);
    IF NOT EXISTS (SELECT 1 FROM public.asset_valuations WHERE asset_id = a.id AND valuation_date = p_date AND deleted_at IS NULL) THEN
      INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
      VALUES (a.id, p_date, v_price, 'LATEST_TRANSACTION', 'USER', 'ราคาขาย')
      RETURNING id INTO v_valid;
    END IF;
  ELSE
    -- มูลค่าของแถวที่จบ: รายแถวของครั้งล่าสุด · ไม่มีรายแถว → ผู้ใช้ใส่ · ไม่มีมูลค่าเลย → ต้นทุนที่ตัดออก
    IF v_val.id IS NOT NULL THEN
      v_has_parts := EXISTS (SELECT 1 FROM public.asset_valuation_parts p WHERE p.valuation_id = v_val.id AND p.deleted_at IS NULL);
    END IF;
    IF v_has_parts THEN
      SELECT coalesce(sum(p.value), 0) INTO v_book FROM public.asset_valuation_parts p
       WHERE p.valuation_id = v_val.id AND p.deleted_at IS NULL AND p.deed_id = ANY (v_ids);
      SELECT coalesce(jsonb_agg(jsonb_build_object('type', p.part_type, 'deed_id', p.deed_id, 'label', p.label, 'value', p.value)
                                ORDER BY p.sort_order), '[]'::jsonb)
        INTO v_parts FROM public.asset_valuation_parts p
       WHERE p.valuation_id = v_val.id AND p.deleted_at IS NULL AND (p.deed_id IS NULL OR NOT (p.deed_id = ANY (v_ids)));
    ELSIF v_before IS NOT NULL THEN
      IF p_book_value IS NULL OR p_book_value < 0 OR p_book_value > v_before THEN
        RAISE EXCEPTION 'INVALID: มูลค่าครั้งล่าสุดยังไม่แยกรายแถว — ใส่มูลค่าเดิมของแถวที่เลือก (0 ถึง %)',
          trim(to_char(v_before, 'FM999,999,999,990.00')) USING ERRCODE = '22023';
      END IF;
      v_book := round(p_book_value, 2);
    ELSE
      v_book := v_cost_out;
    END IF;
    -- มูลค่าใหม่ ณ วันนั้น = มูลค่าเดิม − ส่วนที่จบ (รายแถวที่เหลือคงเดิม)
    IF v_before IS NOT NULL THEN
      v_after := v_before - v_book;
      v_valid := public.add_property_valuation(a.id, p_date, v_after, coalesce(v_val.valuation_method, 'USER_ESTIMATE'),
                                               'หลัง' || v_what || ' · ' || v_names, CASE WHEN v_has_parts THEN v_parts END);
    END IF;
    UPDATE public.assets SET acquisition_cost = greatest(acquisition_cost - v_cost_out, 0)
     WHERE id = a.id AND acquisition_cost IS NOT NULL AND v_cost_out > 0;
  END IF;

  v_post := private.disposal_post(a.id, p_date, v_chk, v_book,
    v_what || ' · ' || a.name || CASE WHEN v_whole THEN '' ELSE ' · ' || v_names END,
    'กำไรจากการขายทรัพย์สิน', CASE p_kind WHEN 'SELL' THEN 'ขาดทุนจากการขายทรัพย์สิน' ELSE 'ขาดทุนจากการรื้อถอน' END, p_notes,
    jsonb_build_object('component_sale', NOT v_whole, 'component_ids', to_jsonb(v_ids)));

  v_ev := private.write_component_event(jsonb_build_object(
    'asset_id', a.id, 'event_type', p_kind, 'event_date', p_date, 'component_ids', to_jsonb(v_ids), 'price', v_price,
    'fee', (v_chk->>'deducted')::numeric + (v_chk->>'paid')::numeric, 'currency', a.currency,
    'bank_asset_id', v_chk->'receipts'->0->>'bank_asset_id', 'expense_ids', v_post->'expense_ids',
    'movement_ids', v_post->'movement_ids', 'income_ids', v_post->'income_ids', 'receipts', v_chk->'receipts', 'costs', v_chk->'costs',
    'value_before', v_before, 'book_value', v_book, 'gain', v_post->'gain', 'cost_removed', CASE WHEN v_whole THEN 0 ELSE v_cost_out END,
    'cost_before', a.acquisition_cost, 'valuation_id', v_valid, 'notes', p_notes, 'whole', v_whole));
  UPDATE public.property_deeds SET ended_date = p_date, end_reason = CASE p_kind WHEN 'SELL' THEN 'SOLD' ELSE 'DEMOLISHED' END,
         end_event_id = v_ev
   WHERE id = ANY (v_ids);
  IF v_whole THEN
    UPDATE public.assets SET status = 'SOLD' WHERE id = a.id;
  END IF;
  RETURN v_ev;
END $$;
REVOKE ALL ON FUNCTION public.end_property_components(uuid, text, uuid[], date, jsonb, jsonb, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_property_components(uuid, text, uuid[], date, jsonb, jsonb, numeric, text) TO authenticated;

-- 3) ยกเลิกขาย / รื้อถอน (เฉพาะครั้งล่าสุด) · ลบทุกรายการที่สร้างพร้อมกัน · ขายทั้งทรัพย์สิน → สถานะกลับเป็นถืออยู่ ----------
CREATE OR REPLACE FUNCTION public.undo_property_component_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE e public.property_component_events; v_vcreated timestamptz; v_status text;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO e FROM public.property_component_events WHERE id = p_event_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบรายการนี้' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.property_component_events o WHERE o.asset_id = e.asset_id AND o.deleted_at IS NULL AND o.id <> e.id
              AND (o.event_date > e.event_date OR (o.event_date = e.event_date AND o.created_at > e.created_at))) THEN
    RAISE EXCEPTION 'INVALID: ยกเลิกได้เฉพาะรายการล่าสุด — ยกเลิกครั้งหลังกว่าก่อน' USING ERRCODE = '22023';
  END IF;
  SELECT status INTO v_status FROM public.assets WHERE id = e.asset_id;
  IF e.whole AND v_status <> 'SOLD' THEN
    RAISE EXCEPTION 'INVALID: สถานะทรัพย์สินไม่ใช่ "ขายแล้ว" — ยกเลิกการขายนี้ไม่ได้' USING ERRCODE = '22023';
  ELSIF NOT e.whole AND v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'INVALID: ทรัพย์สินนี้ไม่ได้อยู่ในสถานะถืออยู่แล้ว — เปลี่ยนสถานะกลับเป็นถืออยู่ก่อน' USING ERRCODE = '22023';
  END IF;
  SELECT v.created_at INTO v_vcreated FROM public.asset_valuations v WHERE v.id = e.valuation_id;
  IF EXISTS (SELECT 1 FROM public.asset_valuations v WHERE v.asset_id = e.asset_id AND v.deleted_at IS NULL
              AND v.id IS DISTINCT FROM e.valuation_id
              AND (v.valuation_date > e.event_date
                   OR (v.valuation_date = e.event_date AND v_vcreated IS NOT NULL AND v.created_at > v_vcreated))) THEN
    RAISE EXCEPTION 'INVALID: มีมูลค่าที่บันทึกหลังรายการนี้ — ลบมูลค่านั้นก่อนจึงยกเลิกได้' USING ERRCODE = '22023';
  END IF;

  IF e.whole THEN UPDATE public.assets SET status = 'ACTIVE' WHERE id = e.asset_id; END IF;
  IF e.valuation_id IS NOT NULL THEN
    UPDATE public.asset_valuations SET deleted_at = now() WHERE id = e.valuation_id AND deleted_at IS NULL;
  END IF;
  UPDATE public.assets SET acquisition_cost = e.cost_before
   WHERE id = e.asset_id AND e.cost_before IS NOT NULL AND acquisition_cost IS DISTINCT FROM e.cost_before;
  UPDATE public.cash_movements SET deleted_at = now()
   WHERE (id = e.movement_id OR id = ANY (e.movement_ids)) AND deleted_at IS NULL;
  UPDATE public.income_transactions SET deleted_at = now()
   WHERE (id = e.income_id OR id = ANY (e.income_ids)) AND deleted_at IS NULL;
  UPDATE public.expense_items SET deleted_at = now() WHERE id = ANY (e.expense_ids) AND deleted_at IS NULL;
  PERFORM private.close_component_event(e.id);
  UPDATE public.property_deeds SET ended_date = NULL, end_reason = NULL, end_event_id = NULL
   WHERE end_event_id = e.id;
END $$;
REVOKE ALL ON FUNCTION public.undo_property_component_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_property_component_event(uuid) TO authenticated;

-- 4) ขายทั้งรายการ (Property / Alternative / ธุรกิจ) ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sell_asset(uuid, date, numeric, uuid, numeric, text);
CREATE OR REPLACE FUNCTION public.sell_asset(p_asset_id uuid, p_date date, p_receipts jsonb, p_costs jsonb DEFAULT '[]',
  p_notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.assets; v_pid uuid; v_comps uuid[]; v_chk jsonb; v_price numeric; v_book numeric; v_label text;
BEGIN
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบทรัพย์สินนี้' USING ERRCODE = '22023'; END IF;
  IF a.status <> 'ACTIVE' THEN RAISE EXCEPTION 'INVALID: ทรัพย์สินนี้ไม่ได้อยู่ในสถานะถืออยู่' USING ERRCODE = '22023'; END IF;
  IF NOT (a.asset_group IN ('PROPERTY','ALTERNATIVE') OR a.asset_type = 'PRIVATE_BUSINESS') THEN
    RAISE EXCEPTION 'INVALID: ขายได้เฉพาะอสังหาฯ / สินทรัพย์อื่น / ธุรกิจ (หุ้นในพอร์ตใช้รายการขายในหน้า Investments)' USING ERRCODE = '22023';
  END IF;
  IF p_date IS NULL OR p_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ขายไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;

  -- Property ที่มีส่วนประกอบ → ขายทุกแถว (ยกเลิกได้ · ทุกแถว "ขายแล้ว")
  SELECT pd.id INTO v_pid FROM public.property_details pd WHERE pd.asset_id = a.id AND pd.deleted_at IS NULL;
  IF v_pid IS NOT NULL THEN
    SELECT array_agg(d.id) INTO v_comps FROM public.property_deeds d
     WHERE d.property_id = v_pid AND d.deleted_at IS NULL AND d.ended_date IS NULL;
    IF v_comps IS NOT NULL THEN
      PERFORM public.end_property_components(a.id, 'SELL', v_comps, p_date, p_receipts, p_costs, NULL, p_notes);
      RETURN;
    END IF;
  END IF;

  v_chk := private.disposal_check(p_receipts, p_costs);
  v_price := (v_chk->>'received')::numeric + (v_chk->>'deducted')::numeric;
  IF v_price <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่เงินที่ได้รับจากการขาย' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.property_leases l WHERE l.property_id = v_pid AND l.deleted_at IS NULL
              AND l.status = 'ACTIVE' AND l.end_date >= p_date) THEN
    RAISE EXCEPTION 'INVALID: ยังมีสัญญาเช่าที่มีผล — บันทึกเลิกสัญญา / คืนเงินประกันก่อน' USING ERRCODE = '22023';
  END IF;
  -- มูลค่าล่าสุดก่อนขาย (ประเมินล่าสุด) · ไม่มี → ราคาที่ได้มา
  SELECT v.value INTO v_book FROM public.asset_valuations v
   WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.valuation_date <= p_date
   ORDER BY v.valuation_date DESC, v.created_at DESC LIMIT 1;
  v_book := coalesce(v_book, a.acquisition_cost);
  v_label := CASE WHEN a.asset_type = 'PRIVATE_BUSINESS' THEN 'หุ้น' ELSE 'ทรัพย์สิน' END;
  PERFORM private.disposal_post(a.id, p_date, v_chk, v_book, 'ขาย · ' || a.name, 'กำไรจากการขาย' || v_label,
                                'ขาดทุนจากการขาย' || v_label, p_notes, '{}'::jsonb);
  -- มูลค่า ณ วันขาย = ราคาขาย (เดือนที่ขายใช้ยอดนี้)
  IF NOT EXISTS (SELECT 1 FROM public.asset_valuations WHERE asset_id = a.id AND valuation_date = p_date AND deleted_at IS NULL) THEN
    INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
    VALUES (a.id, p_date, v_price, 'LATEST_TRANSACTION', 'USER', 'ราคาขาย');
  END IF;
  UPDATE public.private_business_details SET status = 'SOLD' WHERE asset_id = a.id AND deleted_at IS NULL;
  UPDATE public.assets SET status = 'SOLD',
         notes = concat_ws(' · ', notes, 'ขาย ' || to_char(p_date, 'DD/MM/YYYY') || ' ราคา ' || v_price::text)
   WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION public.sell_asset(uuid, date, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sell_asset(uuid, date, jsonb, jsonb, text) TO authenticated;

-- 5) ต้นทุนรายก้อน: เงินออกตอนเพิ่มทรัพย์สิน (metadata.acquisition = true) อยู่ในราคาที่ได้มาแล้ว ไม่นับซ้ำ -------------------------
CREATE OR REPLACE VIEW public.v_property_cost_lots WITH (security_invoker = true) AS
WITH base AS (
  SELECT a.id AS asset_id, a.currency, a.acquisition_date, a.acquisition_cost,
         least(coalesce(pd.acq_building_cost, 0), coalesce(a.acquisition_cost, 0)) AS acq_building, pd.acq_building_years,
         pd.opportunity_rate_pct AS own_rate, f.opportunity_rate_pct AS family_rate, pd.id AS property_id,
         -- มีต้นทุนรายแถว (นับแถวที่จบแล้วด้วย) → ยอดของแถวที่ยังถืออยู่
         CASE WHEN EXISTS (SELECT 1 FROM public.property_deeds d WHERE d.property_id = pd.id AND d.deleted_at IS NULL AND d.acq_cost IS NOT NULL)
              THEN coalesce((SELECT sum(d.acq_cost) FROM public.property_deeds d
                              WHERE d.property_id = pd.id AND d.deleted_at IS NULL AND d.ended_date IS NULL), 0) END AS comp_cost,
         -- "จ่ายจากบัญชี" ตอนเพิ่มทรัพย์สิน = เงินออกวันเดียวกัน ยอดเท่าราคาที่ได้มา → ซ้ำกับราคาที่ได้มา ไม่นับอีก
         (SELECT m.id FROM public.cash_movements m
           WHERE m.to_asset_id = a.id AND m.movement_type = 'ASSET_PURCHASE' AND m.deleted_at IS NULL
             AND m.movement_date = a.acquisition_date AND m.amount = a.acquisition_cost
           ORDER BY m.created_at, m.id LIMIT 1) AS acq_movement_id
    FROM public.assets a
    JOIN public.property_details pd ON pd.asset_id = a.id AND pd.deleted_at IS NULL
    LEFT JOIN public.families f ON true
   WHERE a.deleted_at IS NULL
), lots AS (
  -- แบบเดิม (ยังไม่มีต้นทุนรายแถว)
  SELECT b.asset_id, 'ACQUISITION'::text AS source, NULL::uuid AS item_id, NULL::uuid AS movement_id,
         b.acquisition_date AS lot_date, (b.acquisition_cost - b.acq_building)::public.d_money AS amount,
         CASE WHEN b.acq_building > 0 THEN 'ราคาที่ได้มา (ที่ดิน)' ELSE 'ราคาที่ได้มา' END::text AS description,
         false AS is_building, NULL::integer AS depreciation_years, NULL::text AS notes
    FROM base b WHERE b.comp_cost IS NULL AND b.acquisition_cost > b.acq_building AND b.acquisition_date IS NOT NULL
  UNION ALL
  SELECT b.asset_id, 'ACQUISITION', NULL, NULL, b.acquisition_date, b.acq_building::public.d_money, 'ราคาที่ได้มา (อาคาร)',
         true, b.acq_building_years, NULL
    FROM base b WHERE b.comp_cost IS NULL AND b.acq_building > 0 AND b.acquisition_date IS NOT NULL
  UNION ALL
  -- ต้นทุนรายแถวของส่วนประกอบที่ยังถืออยู่
  SELECT b.asset_id, 'ACQUISITION', NULL, NULL, coalesce(d.acquired_date, b.acquisition_date), d.acq_cost,
         'ราคาที่ได้มา · ' || coalesce(d.label, nullif(concat_ws(' ', d.title_type, 'เลขที่ ' || d.title_deed_no), ''),
                                      CASE d.component_type WHEN 'LAND' THEN 'ที่ดิน' WHEN 'BUILDING' THEN 'อาคาร' ELSE 'อื่น ๆ' END),
         d.component_type <> 'LAND', CASE WHEN d.component_type <> 'LAND' THEN coalesce(d.useful_life_years, 20) END, NULL
    FROM base b JOIN public.property_deeds d ON d.property_id = b.property_id AND d.deleted_at IS NULL AND d.ended_date IS NULL
   WHERE b.comp_cost IS NOT NULL AND d.acq_cost > 0 AND coalesce(d.acquired_date, b.acquisition_date) IS NOT NULL
  UNION ALL
  SELECT b.asset_id, 'ACQUISITION', NULL, NULL, b.acquisition_date, (b.acquisition_cost - b.comp_cost)::public.d_money,
         'ราคาที่ได้มา (ส่วนที่ยังไม่แยก)', false, NULL, NULL
    FROM base b WHERE b.comp_cost IS NOT NULL AND b.acquisition_cost - b.comp_cost > 0.005 AND b.acquisition_date IS NOT NULL
  UNION ALL
  -- รายการจ่าย: ผูกกับอาคาร / สิ่งปลูกสร้าง → หักค่าเสื่อมตามอายุของแถวนั้น · แถวที่จบแล้ว → ไม่นับ
  SELECT b.asset_id, 'PAYMENT', NULL, m.id, m.movement_date, m.amount,
         coalesce(m.description, 'จ่ายเพิ่ม') || coalesce(' · ' || coalesce(d.label, nullif(concat_ws(' ', d.title_type, 'เลขที่ ' || d.title_deed_no), '')), ''),
         coalesce(d.component_type <> 'LAND', false), CASE WHEN d.component_type <> 'LAND' THEN coalesce(d.useful_life_years, 20) END, NULL
    FROM base b
    JOIN public.cash_movements m ON m.to_asset_id = b.asset_id AND m.movement_type = 'ASSET_PURCHASE' AND m.deleted_at IS NULL
                                AND m.currency = b.currency
    LEFT JOIN public.property_deeds d ON d.id::text = m.metadata->>'component_id' AND d.property_id = b.property_id AND d.deleted_at IS NULL
   WHERE m.id IS DISTINCT FROM b.acq_movement_id
     AND coalesce((m.metadata->>'acquisition')::boolean, false) = false   -- เงินออกตอนเพิ่มทรัพย์สิน (เช่น เงินดาวน์) อยู่ในราคาที่ได้มาแล้ว
     AND d.ended_date IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.property_cost_items i WHERE i.movement_id = m.id AND i.deleted_at IS NULL)
  UNION ALL
  SELECT i.asset_id, CASE WHEN i.movement_id IS NULL THEN 'MANUAL' ELSE 'PAYMENT' END, i.id, i.movement_id,
         i.cost_date, i.amount, i.description, i.is_building, i.depreciation_years, i.notes
    FROM public.property_cost_items i
    JOIN base b ON b.asset_id = i.asset_id
   WHERE i.deleted_at IS NULL
     AND (i.movement_id IS NULL OR EXISTS (SELECT 1 FROM public.cash_movements m WHERE m.id = i.movement_id AND m.deleted_at IS NULL))
)
SELECT l.*, coalesce(b.own_rate, b.family_rate, 0) AS rate_pct,
       round(greatest((now() AT TIME ZONE 'Asia/Bangkok')::date - l.lot_date, 0) / 365.0, 4) AS years_held,
       round(l.amount * (power(1 + coalesce(b.own_rate, b.family_rate, 0) / 100.0,
                               greatest((now() AT TIME ZONE 'Asia/Bangkok')::date - l.lot_date, 0) / 365.0) - 1), 2) AS interest,
       CASE WHEN l.is_building THEN round(l.amount * least(greatest((now() AT TIME ZONE 'Asia/Bangkok')::date - l.lot_date, 0) / 365.0
                                                           / l.depreciation_years, 1), 2) ELSE 0 END AS depreciation
  FROM lots l JOIN base b ON b.asset_id = l.asset_id;
REVOKE ALL ON public.v_property_cost_lots FROM PUBLIC, anon;
GRANT SELECT ON public.v_property_cost_lots TO authenticated;
