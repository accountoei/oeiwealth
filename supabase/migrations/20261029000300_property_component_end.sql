-- =====================================================================
-- Property ส่วนประกอบ รอบ 3 (ตกลง 29 ต.ค. 2026): ขายบางแถว / รื้อถอน
--   1) property_deeds: ended_date · end_reason (SOLD / DEMOLISHED) · end_event_id
--      แถวที่จบแล้วยังอยู่ในประวัติ ลบไม่ได้ · ไม่นับในเนื้อที่ / เลขโฉนดสรุป / ต้นทุนรายก้อน
--      ตั้ง / ล้างค่าเหล่านี้ได้ผ่าน end_property_components / undo_property_component_event เท่านั้น (trigger ตรวจกับรายการ)
--   2) end_property_components(asset, 'SELL' | 'DEMOLISH', แถว, วันที่, ราคา, ค่าใช้จ่าย, บัญชี, มูลค่าเดิม?, หมายเหตุ)
--      มูลค่าส่วนที่จบ = มูลค่ารายแถวของครั้งล่าสุด (ไม่มีรายแถว → ผู้ใช้ใส่ · ไม่มีมูลค่าเลย → ต้นทุนของแถว)
--      กำไร / ขาดทุน = เงินขายสุทธิ − มูลค่าส่วนที่จบ (แบบเดียวกับ sell_asset) · รื้อถอน = ขาดทุนเท่ามูลค่าเดิม (ขายเศษวัสดุได้)
--      มูลค่าใหม่ ณ วันนั้น = มูลค่าเดิม − ส่วนที่จบ (รายแถวที่เหลือคงเดิม) · ราคาที่ได้มาลดตามต้นทุนของแถว
--      ต้องเหลืออย่างน้อย 1 แถว (ขายทุกแถว = ขายทั้งทรัพย์สิน ใช้ sell_asset)
--   3) undo_property_component_event(): ยกเลิกได้เฉพาะครั้งล่าสุด และยังไม่มีมูลค่าบันทึกหลังจากนั้น
--   4) มูลค่ารายแถวของแถวที่จบแล้ว (วันที่ตั้งแต่วันจบ) บันทึกไม่ได้
--   ตารางใหม่ property_component_events (อ่านได้ทุกบทบาท · เขียนผ่านฟังก์ชันเท่านั้น) · ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) รายการขาย / รื้อถอน ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.property_component_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          uuid NOT NULL REFERENCES public.assets(id),
  event_type        text NOT NULL CHECK (event_type IN ('SELL','DEMOLISH')),
  event_date        date NOT NULL,
  component_ids     uuid[] NOT NULL,
  price             public.d_money NOT NULL DEFAULT 0 CHECK (price >= 0),   -- ราคาขาย (รื้อถอน = ขายเศษวัสดุ ถ้ามี)
  fee               public.d_money NOT NULL DEFAULT 0 CHECK (fee >= 0),
  currency          public.d_currency NOT NULL,
  bank_asset_id     uuid REFERENCES public.assets(id),
  movement_id       uuid REFERENCES public.cash_movements(id),
  income_id         uuid REFERENCES public.income_transactions(id),
  expense_ids       uuid[] NOT NULL DEFAULT '{}',
  value_before      numeric,                                               -- มูลค่าล่าสุดก่อนรายการ
  book_value        numeric,                                               -- มูลค่าของแถวที่จบ
  gain              numeric,                                               -- กำไร (+) / ขาดทุน (−) ที่ลงบัญชี
  cost_removed      numeric,                                               -- ต้นทุนที่ตัดออกจากราคาที่ได้มา
  cost_before       numeric,                                               -- ราคาที่ได้มาก่อนรายการ
  valuation_id      uuid REFERENCES public.asset_valuations(id),           -- มูลค่าใหม่ที่สร้าง
  undone_at         timestamptz,
  notes             text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE INDEX IF NOT EXISTS property_component_events_asset_idx ON public.property_component_events(asset_id);

DROP TRIGGER IF EXISTS t10_meta ON public.property_component_events;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.property_component_events
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.property_component_events;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.property_component_events
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.property_component_events;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.property_component_events
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

ALTER TABLE public.property_component_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_component_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.property_component_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.property_component_events TO service_role;
DROP POLICY IF EXISTS p_select ON public.property_component_events;
CREATE POLICY p_select ON public.property_component_events FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));

-- เขียน / ปิดรายการ (เรียกจากฟังก์ชันขาย / ยกเลิกเท่านั้น)
CREATE OR REPLACE FUNCTION private.write_component_event(r jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  INSERT INTO public.property_component_events(asset_id, event_type, event_date, component_ids, price, fee, currency, bank_asset_id,
              movement_id, income_id, expense_ids, value_before, book_value, gain, cost_removed, cost_before, valuation_id, notes)
  VALUES ((r->>'asset_id')::uuid, r->>'event_type', (r->>'event_date')::date,
          (SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(r->'component_ids') x),
          coalesce((r->>'price')::numeric, 0), coalesce((r->>'fee')::numeric, 0), r->>'currency', nullif(r->>'bank_asset_id', '')::uuid,
          nullif(r->>'movement_id', '')::uuid, nullif(r->>'income_id', '')::uuid,
          coalesce((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(r->'expense_ids') x), '{}'),
          nullif(r->>'value_before', '')::numeric, nullif(r->>'book_value', '')::numeric, nullif(r->>'gain', '')::numeric,
          nullif(r->>'cost_removed', '')::numeric, nullif(r->>'cost_before', '')::numeric, nullif(r->>'valuation_id', '')::uuid,
          nullif(trim(r->>'notes'), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION private.write_component_event(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.write_component_event(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION private.close_component_event(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  UPDATE public.property_component_events SET undone_at = now(), deleted_at = now() WHERE id = p_id AND deleted_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION private.close_component_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.close_component_event(uuid) TO authenticated;

-- 2) สถานะของแถว ------------------------------------------------------------------------------------------
ALTER TABLE public.property_deeds ADD COLUMN IF NOT EXISTS ended_date date;
ALTER TABLE public.property_deeds ADD COLUMN IF NOT EXISTS end_reason text;
ALTER TABLE public.property_deeds ADD COLUMN IF NOT EXISTS end_event_id uuid REFERENCES public.property_component_events(id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pdeed_end_ck') THEN
    ALTER TABLE public.property_deeds ADD CONSTRAINT pdeed_end_ck CHECK (
      (ended_date IS NULL AND end_reason IS NULL AND end_event_id IS NULL)
      OR (ended_date IS NOT NULL AND end_reason IN ('SOLD','DEMOLISHED') AND end_event_id IS NOT NULL));
  END IF;
END $$;

-- ตั้ง / ล้างสถานะได้เมื่อตรงกับรายการขาย / รื้อถอนเท่านั้น · แถวที่จบแล้วลบไม่ได้
CREATE OR REPLACE FUNCTION private.tg_component_end_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE e record;
BEGIN
  IF (NEW.ended_date, NEW.end_reason, NEW.end_event_id) IS DISTINCT FROM (OLD.ended_date, OLD.end_reason, OLD.end_event_id) THEN
    IF NEW.end_event_id IS NOT NULL THEN
      SELECT ev.event_type, ev.event_date, ev.component_ids INTO e
        FROM public.property_component_events ev WHERE ev.id = NEW.end_event_id AND ev.deleted_at IS NULL;
      IF NOT FOUND OR NOT (NEW.id = ANY (e.component_ids)) OR NEW.ended_date IS DISTINCT FROM e.event_date
         OR NEW.end_reason IS DISTINCT FROM (CASE e.event_type WHEN 'SELL' THEN 'SOLD' ELSE 'DEMOLISHED' END) THEN
        RAISE EXCEPTION 'INVALID: เปลี่ยนสถานะส่วนประกอบได้ผ่านการขาย / รื้อถอนเท่านั้น' USING ERRCODE = '22023';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM public.property_component_events ev WHERE ev.id = OLD.end_event_id AND ev.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'INVALID: ล้างสถานะขาย / รื้อถอนได้ด้วยการยกเลิกรายการนั้นเท่านั้น' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND NEW.ended_date IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID: แถวนี้ขาย / รื้อถอนแล้ว ลบไม่ได้ (ยกเลิกรายการขาย / รื้อถอนก่อน)' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_component_end_guard() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t20_end_guard ON public.property_deeds;
CREATE TRIGGER t20_end_guard BEFORE UPDATE ON public.property_deeds
  FOR EACH ROW EXECUTE FUNCTION private.tg_component_end_guard();

-- ค่าสรุปที่ทรัพย์สิน = แถวที่ดินที่ยังถืออยู่ (ขายที่ดินหมดแล้ว → ว่าง)
CREATE OR REPLACE FUNCTION private.tg_property_deed_summary() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_n integer; v_area numeric; v_nos text; v_ended integer;
BEGIN
  SELECT count(*) FILTER (WHERE d.ended_date IS NULL), sum(d.land_area_sq_wa) FILTER (WHERE d.ended_date IS NULL),
         string_agg(nullif(trim(d.title_deed_no), ''), ', ' ORDER BY d.sort_order, d.created_at, d.id) FILTER (WHERE d.ended_date IS NULL),
         count(*) FILTER (WHERE d.ended_date IS NOT NULL)
    INTO v_n, v_area, v_nos, v_ended
    FROM public.property_deeds d WHERE d.property_id = NEW.id AND d.deleted_at IS NULL AND d.component_type = 'LAND';
  IF v_n > 0 OR v_ended > 0 THEN
    NEW.land_area_sq_wa := v_area;
    NEW.title_deed_no   := v_nos;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_property_deed_summary() FROM PUBLIC, anon;

-- 3) มูลค่ารายแถว: แถวที่จบแล้ว (วันที่ตั้งแต่วันจบ) ใส่ไม่ได้ ---------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_valuation_part_check() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v record; v_locked date; v_type text; v_ended date;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.valuation_id IS DISTINCT FROM OLD.valuation_id THEN
    RAISE EXCEPTION 'INVALID: ย้ายรายละเอียดไปมูลค่าครั้งอื่นไม่ได้' USING ERRCODE = '22023';
  END IF;
  SELECT av.asset_id, av.valuation_date, av.deleted_at, a.family_id INTO v
    FROM public.asset_valuations av JOIN public.assets a ON a.id = av.asset_id
   WHERE av.id = NEW.valuation_id;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.property_details pd WHERE pd.asset_id = v.asset_id AND pd.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: รายละเอียดมูลค่าใช้ได้เฉพาะทรัพย์สินประเภท Property' USING ERRCODE = '22023';
  END IF;
  IF v.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'INVALID: มูลค่าครั้งนี้ถูกลบแล้ว' USING ERRCODE = '22023';
  END IF;
  NEW.asset_id := v.asset_id;
  IF NEW.deed_id IS NOT NULL THEN
    SELECT d.component_type, d.ended_date INTO v_type, v_ended
      FROM public.property_deeds d JOIN public.property_details pd ON pd.id = d.property_id
     WHERE d.id = NEW.deed_id AND pd.asset_id = v.asset_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID: ส่วนประกอบนี้ไม่ใช่ของทรัพย์สินนี้' USING ERRCODE = '22023';
    END IF;
    IF NEW.deleted_at IS NULL AND v_ended IS NOT NULL AND v.valuation_date >= v_ended THEN
      RAISE EXCEPTION 'INVALID: ส่วนประกอบนี้ขาย / รื้อถอนแล้วตั้งแต่ % — ใส่มูลค่าหลังจากนั้นไม่ได้', to_char(v_ended, 'DD/MM/YYYY')
        USING ERRCODE = '22023';
    END IF;
    NEW.part_type := CASE v_type WHEN 'LAND' THEN 'DEED' ELSE v_type END;
  END IF;
  v_locked := private.locked_through(v.family_id);
  IF v_locked IS NOT NULL AND v.valuation_date <= v_locked THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: มูลค่าวันที่ % อยู่ในงวดที่ปิดแล้ว (ถึง %) ต้อง Reopen ก่อน', v.valuation_date, v_locked
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_valuation_part_check() FROM PUBLIC, anon;

-- 4) ขาย / รื้อถอนบางแถว -------------------------------------------------------------------------------------
--   p_book_value ใช้เฉพาะเมื่อมูลค่าครั้งล่าสุดไม่มีรายแถว (ผู้ใช้บอกว่าแถวที่จบมีมูลค่าเท่าไรในยอดรวม)
CREATE OR REPLACE FUNCTION public.end_property_components(p_asset_id uuid, p_kind text, p_component_ids uuid[], p_date date,
  p_price numeric DEFAULT 0, p_fee numeric DEFAULT NULL, p_bank_asset_id uuid DEFAULT NULL, p_book_value numeric DEFAULT NULL,
  p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.assets; v_pid uuid; v_go_live date; v_ids uuid[]; v_n int; v_left int;
  v_val public.asset_valuations; v_has_parts boolean := false; v_before numeric; v_book numeric; v_after numeric; v_parts jsonb;
  v_price numeric := coalesce(p_price, 0); v_fee numeric := coalesce(p_fee, 0); v_net numeric; v_gain numeric; v_sale numeric;
  v_rem numeric; v_area_base numeric; v_cost_out numeric := 0; c record; v_names text; v_what text; v_valid uuid; v_ev uuid;
  v_mv uuid; v_inc uuid; v_exps uuid[] := '{}'; v_exp uuid; o record; v_on int; v_i int := 0; v_part numeric; v_rest numeric;
  v_cat text;
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
  IF v_price < 0 THEN RAISE EXCEPTION 'INVALID: ราคาขายต้องไม่ติดลบ' USING ERRCODE = '22023'; END IF;
  IF v_fee < 0 OR v_fee > v_price THEN RAISE EXCEPTION 'INVALID: ค่าใช้จ่ายในการขายไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF p_kind = 'SELL' AND v_price <= 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ราคาขาย' USING ERRCODE = '22023'; END IF;
  IF p_bank_asset_id IS NOT NULL AND NOT private.is_bank_asset(p_bank_asset_id) THEN
    RAISE EXCEPTION 'INVALID: ไม่พบบัญชีที่รับเงิน' USING ERRCODE = '22023';
  END IF;
  IF v_price - v_fee > 0 AND p_bank_asset_id IS NULL THEN
    RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่รับเงิน' USING ERRCODE = '22023';
  END IF;

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
  IF v_left = 0 THEN
    RAISE EXCEPTION 'INVALID: เลือกครบทุกแถวแล้ว — %', CASE p_kind WHEN 'SELL' THEN 'ใช้ "ขายทั้งทรัพย์สิน" แทน'
      ELSE 'ต้องเหลืออย่างน้อย 1 แถว (ถ้าไม่เหลืออะไรแล้ว ให้เปลี่ยนสถานะทรัพย์สิน)' END USING ERRCODE = '22023';
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
  v_what := CASE p_kind WHEN 'SELL' THEN 'ขายบางส่วน' ELSE 'รื้อถอน' END;

  -- ต้นทุนที่ตัดออก: ต้นทุนของแถว · แถวที่ดินที่ไม่มีต้นทุนรายแถว → ส่วนที่ยังไม่แยก × เนื้อที่ ÷ เนื้อที่ที่ดินที่ไม่มีต้นทุนรายแถว
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

  -- มูลค่าของแถวที่จบ: รายแถวของครั้งล่าสุด · ไม่มีรายแถว → ผู้ใช้ใส่ · ไม่มีมูลค่าเลย → ต้นทุนที่ตัดออก
  SELECT * INTO v_val FROM public.asset_valuations v WHERE v.asset_id = a.id AND v.deleted_at IS NULL AND v.valuation_date <= p_date
   ORDER BY v.valuation_date DESC, v.created_at DESC LIMIT 1;
  v_before := v_val.value;
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
  v_net := v_price - v_fee;
  v_gain := v_net - v_book;

  -- มูลค่าใหม่ ณ วันนั้น = มูลค่าเดิม − ส่วนที่จบ (รายแถวที่เหลือคงเดิม)
  IF v_before IS NOT NULL THEN
    v_after := v_before - v_book;
    v_valid := public.add_property_valuation(a.id, p_date, v_after, coalesce(v_val.valuation_method, 'USER_ESTIMATE'),
                                             'หลัง' || v_what || ' · ' || v_names, CASE WHEN v_has_parts THEN v_parts END);
  END IF;
  UPDATE public.assets SET acquisition_cost = greatest(acquisition_cost - v_cost_out, 0)
   WHERE id = a.id AND acquisition_cost IS NOT NULL AND v_cost_out > 0;

  -- เงินเข้าบัญชี: ทุนคืน (ASSET_SALE) + กำไร (รายได้) = เงินขายสุทธิ · ขาดทุน: ทุนคืน = เงินขายสุทธิ
  v_sale := CASE WHEN v_gain > 0 THEN v_net - v_gain ELSE v_net END;
  IF p_bank_asset_id IS NOT NULL AND v_sale > 0 THEN
    INSERT INTO public.cash_movements(movement_date, movement_type, from_asset_id, to_asset_id, amount, currency, description, notes, metadata)
    VALUES (p_date, 'ASSET_SALE', a.id, p_bank_asset_id, v_sale, a.currency, v_what || ' · ' || a.name || ' · ' || v_names,
            nullif(trim(p_notes), ''),
            jsonb_build_object('component_sale', true, 'component_ids', to_jsonb(v_ids), 'sale_price', v_price, 'fee', v_fee,
                               'book_value', v_book, 'gain', v_gain))
    RETURNING id INTO v_mv;
  END IF;
  -- กำไร → รายได้ · ขาดทุน → ค่าใช้จ่ายของเจ้าของแต่ละคน ณ วันนั้น (ไม่มีเงินออกจากบัญชี)
  v_cat := CASE p_kind WHEN 'SELL' THEN 'ขาดทุนจากการขายทรัพย์สิน' ELSE 'ขาดทุนจากการรื้อถอน' END;
  IF v_gain > 0 THEN
    INSERT INTO public.income_transactions(asset_id, received_to_asset_id, date, income_type, income_subtype, amount, currency, notes)
    VALUES (a.id, p_bank_asset_id, p_date, 'OTHER', 'กำไรจากการขายทรัพย์สิน', v_gain, a.currency,
            v_what || ' ' || a.name || ' · ' || v_names || ' (เทียบมูลค่าล่าสุด)')
    RETURNING id INTO v_inc;
  ELSIF v_gain < 0 THEN
    SELECT count(*) INTO v_on FROM private.asset_owner_shares(a.id, p_date) s WHERE s.person_id IS NOT NULL AND s.pct > 0;
    v_rest := -v_gain;
    IF v_on = 0 THEN
      v_exp := public.add_expense(jsonb_build_object('date', p_date, 'amount', -v_gain, 'currency', a.currency,
        'description', v_cat || ' · ' || a.name, 'expense_category', v_cat, 'related_asset_id', a.id,
        'notes', v_what || ' ' || v_names || ' · เทียบมูลค่าล่าสุด · ไม่มีเงินออกจากบัญชี'));
      v_exps := v_exps || v_exp;
    ELSE
      FOR o IN SELECT s.person_id, s.pct FROM private.asset_owner_shares(a.id, p_date) s
                WHERE s.person_id IS NOT NULL AND s.pct > 0 ORDER BY s.pct, s.person_id LOOP
        v_i := v_i + 1;
        v_part := CASE WHEN v_i = v_on THEN v_rest ELSE round(-v_gain * o.pct / 100, 2) END;
        v_rest := v_rest - v_part;
        IF v_part > 0 THEN
          v_exp := public.add_expense(jsonb_build_object('date', p_date, 'amount', v_part, 'currency', a.currency, 'person_id', o.person_id,
            'description', v_cat || ' · ' || a.name, 'expense_category', v_cat, 'related_asset_id', a.id,
            'notes', v_what || ' ' || v_names || ' · เทียบมูลค่าล่าสุด · ไม่มีเงินออกจากบัญชี'));
          v_exps := v_exps || v_exp;
        END IF;
      END LOOP;
    END IF;
  END IF;

  v_ev := private.write_component_event(jsonb_build_object(
    'asset_id', a.id, 'event_type', p_kind, 'event_date', p_date, 'component_ids', to_jsonb(v_ids), 'price', v_price, 'fee', v_fee,
    'currency', a.currency, 'bank_asset_id', p_bank_asset_id, 'movement_id', v_mv, 'income_id', v_inc, 'expense_ids', to_jsonb(v_exps),
    'value_before', v_before, 'book_value', v_book, 'gain', v_gain, 'cost_removed', v_cost_out, 'cost_before', a.acquisition_cost,
    'valuation_id', v_valid, 'notes', p_notes));
  UPDATE public.property_deeds SET ended_date = p_date, end_reason = CASE p_kind WHEN 'SELL' THEN 'SOLD' ELSE 'DEMOLISHED' END,
         end_event_id = v_ev
   WHERE id = ANY (v_ids);
  RETURN v_ev;
END $$;
REVOKE ALL ON FUNCTION public.end_property_components(uuid, text, uuid[], date, numeric, numeric, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_property_components(uuid, text, uuid[], date, numeric, numeric, uuid, numeric, text) TO authenticated;

-- 5) ยกเลิกขาย / รื้อถอน (เฉพาะครั้งล่าสุด) ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_property_component_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE e public.property_component_events; v_vcreated timestamptz;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO e FROM public.property_component_events WHERE id = p_event_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบรายการนี้' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.property_component_events o WHERE o.asset_id = e.asset_id AND o.deleted_at IS NULL AND o.id <> e.id
              AND (o.event_date > e.event_date OR (o.event_date = e.event_date AND o.created_at > e.created_at))) THEN
    RAISE EXCEPTION 'INVALID: ยกเลิกได้เฉพาะรายการล่าสุด — ยกเลิกครั้งหลังกว่าก่อน' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.assets WHERE id = e.asset_id AND status <> 'ACTIVE') THEN
    RAISE EXCEPTION 'INVALID: ทรัพย์สินนี้ไม่ได้อยู่ในสถานะถืออยู่แล้ว — เปลี่ยนสถานะกลับเป็นถืออยู่ก่อน' USING ERRCODE = '22023';
  END IF;
  SELECT v.created_at INTO v_vcreated FROM public.asset_valuations v WHERE v.id = e.valuation_id;
  IF EXISTS (SELECT 1 FROM public.asset_valuations v WHERE v.asset_id = e.asset_id AND v.deleted_at IS NULL
              AND v.id IS DISTINCT FROM e.valuation_id
              AND (v.valuation_date > e.event_date
                   OR (v.valuation_date = e.event_date AND v_vcreated IS NOT NULL AND v.created_at > v_vcreated))) THEN
    RAISE EXCEPTION 'INVALID: มีมูลค่าที่บันทึกหลังรายการนี้ — ลบมูลค่านั้นก่อนจึงยกเลิกได้' USING ERRCODE = '22023';
  END IF;

  IF e.valuation_id IS NOT NULL THEN
    UPDATE public.asset_valuations SET deleted_at = now() WHERE id = e.valuation_id AND deleted_at IS NULL;
  END IF;
  UPDATE public.assets SET acquisition_cost = e.cost_before
   WHERE id = e.asset_id AND e.cost_before IS NOT NULL AND acquisition_cost IS DISTINCT FROM e.cost_before;
  IF e.movement_id IS NOT NULL THEN
    UPDATE public.cash_movements SET deleted_at = now() WHERE id = e.movement_id AND deleted_at IS NULL;
  END IF;
  IF e.income_id IS NOT NULL THEN
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = e.income_id AND deleted_at IS NULL;
  END IF;
  UPDATE public.expense_items SET deleted_at = now() WHERE id = ANY (e.expense_ids) AND deleted_at IS NULL;
  PERFORM private.close_component_event(e.id);
  UPDATE public.property_deeds SET ended_date = NULL, end_reason = NULL, end_event_id = NULL
   WHERE end_event_id = e.id;
END $$;
REVOKE ALL ON FUNCTION public.undo_property_component_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_property_component_event(uuid) TO authenticated;

-- 6) ต้นทุนรายก้อน: ไม่นับแถวที่ขาย / รื้อถอนแล้ว (ทั้งราคาที่ได้มาและรายการจ่ายของแถวนั้น) -------------------------------
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
