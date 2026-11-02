-- =====================================================================
-- มิเตอร์ตามห้อง + ซื้อ / ขายของในทรัพย์สิน (ตกลง 2 พ.ย. 2026 · ต่อจาก 20261102000900_property_inventory.sql)
--   1) property_utilities.unit_label: ห้องของมิเตอร์ / ค่าใช้จ่ายประจำ (ว่าง = ส่วนกลาง / ทั้งหลัง)
--   2) copy_inventory_to_lease: ดึงมิเตอร์ไฟ / น้ำจากสาธารณูปโภค (ห้องของสัญญา + ส่วนกลาง) เข้ารายการส่งมอบด้วย
--      · มิเตอร์ไม่ต้องกรอกเป็นของในทรัพย์สินอีก · ไม่ดึงของที่ขาย / ทิ้งแล้ว
--   3) add_inventory_items: เพิ่มของหลายแถว + (เลือกได้) บันทึกเป็นค่าใช้จ่าย 1 รายการ ผูกกับของที่เพิ่ม — ทำในรายการเดียว
--   4) dispose_inventory_item: ขาย (→ รายได้อื่นของทรัพย์สิน) / ทิ้ง · undo_inventory_disposal: ยกเลิก (ลบรายได้ที่สร้าง)
--   ของในทรัพย์สินไม่นับใน Net Worth (ซื้อ = ค่าใช้จ่าย · ขาย = รายได้) · ไม่แก้ / ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) ห้องของสาธารณูปโภค --------------------------------------------------------------------------
ALTER TABLE public.property_utilities ADD COLUMN IF NOT EXISTS unit_label text;
ALTER TABLE public.property_utilities DROP CONSTRAINT IF EXISTS putil_unit_len_ck;
ALTER TABLE public.property_utilities ADD CONSTRAINT putil_unit_len_ck CHECK (coalesce(length(unit_label), 0) <= 100);

-- 2) รายการส่งมอบจำได้ว่ามาจากมิเตอร์ไหน (ดึงซ้ำไม่ซ้ำ) ------------------------------------------------
ALTER TABLE public.lease_handover_items ADD COLUMN IF NOT EXISTS utility_id uuid REFERENCES public.property_utilities(id);
CREATE INDEX IF NOT EXISTS lho_utility_idx ON public.lease_handover_items(utility_id) WHERE utility_id IS NOT NULL;

-- 3) ซื้อ / ขาย / ทิ้ง ของในทรัพย์สิน ------------------------------------------------------------------
ALTER TABLE public.property_inventory_items
  ADD COLUMN IF NOT EXISTS expense_item_id uuid REFERENCES public.expense_items(id),            -- ซื้อมา (ค่าใช้จ่าย)
  ADD COLUMN IF NOT EXISTS disposal_type text,                                                  -- SOLD / DISCARDED
  ADD COLUMN IF NOT EXISTS disposed_date date,
  ADD COLUMN IF NOT EXISTS disposal_amount public.d_money,                                       -- เงินที่ได้จากการขาย
  ADD COLUMN IF NOT EXISTS income_transaction_id uuid REFERENCES public.income_transactions(id); -- รายได้ที่สร้างตอนขาย
ALTER TABLE public.property_inventory_items DROP CONSTRAINT IF EXISTS pinv_disposal_ck;
ALTER TABLE public.property_inventory_items ADD CONSTRAINT pinv_disposal_ck CHECK (
  (disposal_type IS NULL AND disposed_date IS NULL AND disposal_amount IS NULL AND income_transaction_id IS NULL)
  OR (disposal_type IN ('SOLD','DISCARDED') AND disposed_date IS NOT NULL AND (disposal_amount IS NULL OR disposal_amount >= 0)));

-- 4) ดึงของ + มิเตอร์เข้ารายการส่งมอบ --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copy_inventory_to_lease(p_lease_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE l public.property_leases; n integer; m integer; v_max integer;
BEGIN
  SELECT * INTO l FROM public.property_leases WHERE id = p_lease_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: ไม่พบสัญญาเช่า' USING ERRCODE = 'P0002';
  END IF;
  SELECT coalesce(max(h.sort_order), 0) INTO v_max FROM public.lease_handover_items h WHERE h.lease_id = l.id AND h.deleted_at IS NULL;
  -- มิเตอร์ไฟ / น้ำ จากสาธารณูปโภค (ขึ้นก่อน)
  INSERT INTO public.lease_handover_items(lease_id, utility_id, item_type, name, qty, serial_no, sort_order)
  SELECT l.id, u.id, CASE u.utility_type WHEN 'ELECTRICITY' THEN 'ELECTRIC_METER' ELSE 'WATER_METER' END,
         CASE u.utility_type WHEN 'ELECTRICITY' THEN 'มิเตอร์ไฟฟ้า' ELSE 'มิเตอร์น้ำ' END
           || coalesce(' ' || nullif(trim(u.unit_label), ''), '') || coalesce(' (' || nullif(trim(u.provider), '') || ')', ''),
         1, u.meter_no,
         v_max + row_number() OVER (ORDER BY u.utility_type, u.unit_label NULLS FIRST, u.created_at)
    FROM public.property_utilities u
   WHERE u.property_id = l.property_id AND u.deleted_at IS NULL AND u.utility_type IN ('ELECTRICITY','WATER')
     AND (u.unit_label IS NULL OR lower(trim(u.unit_label)) = lower(trim(coalesce(l.unit_label, ''))))
     AND NOT EXISTS (SELECT 1 FROM public.lease_handover_items h
                      WHERE h.lease_id = l.id AND h.utility_id = u.id AND h.deleted_at IS NULL);
  GET DIAGNOSTICS m = ROW_COUNT;
  -- ของในทรัพย์สิน (ห้องของสัญญา + ส่วนกลาง · ไม่เอาของที่ขาย / ทิ้งแล้ว)
  INSERT INTO public.lease_handover_items(lease_id, inventory_item_id, item_type, name, qty, brand, serial_no, value, sort_order)
  SELECT l.id, i.id, i.item_type, i.name, i.qty, i.brand, i.serial_no, i.value,
         row_number() OVER (ORDER BY i.unit_label NULLS FIRST, i.sort_order, i.created_at) + v_max + m
    FROM public.property_inventory_items i
   WHERE i.property_id = l.property_id AND i.deleted_at IS NULL AND i.disposal_type IS NULL
     AND (i.unit_label IS NULL OR lower(trim(i.unit_label)) = lower(trim(coalesce(l.unit_label, ''))))
     AND NOT EXISTS (SELECT 1 FROM public.lease_handover_items h
                      WHERE h.lease_id = l.id AND h.inventory_item_id = i.id AND h.deleted_at IS NULL);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n + m;
END $$;
REVOKE EXECUTE ON FUNCTION public.copy_inventory_to_lease(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_inventory_to_lease(uuid) TO authenticated;

-- 5) เพิ่มของหลายแถว + บันทึกเป็นค่าใช้จ่าย (ถ้าส่ง p_expense) ในรายการเดียว --------------------------------------
--    p_rows: [{unit_label, item_type, name, qty, brand, serial_no, value, notes}] (แถวไม่มีชื่อ = ข้าม)
--    p_expense: พารามิเตอร์ของ add_expense (วันที่ · รายการ · ยอด · จ่ายจาก · หมวด) — ผูก related_asset_id ให้เอง
CREATE OR REPLACE FUNCTION public.add_inventory_items(p_asset_id uuid, p_rows jsonb, p_expense jsonb DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_prop uuid; v_exp uuid; v_base integer; n integer;
BEGIN
  SELECT pd.id INTO v_prop FROM public.property_details pd WHERE pd.asset_id = p_asset_id AND pd.deleted_at IS NULL;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบทรัพย์สิน' USING ERRCODE = 'P0002'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE length(trim(coalesce(r->>'name', ''))) > 0) THEN
    RAISE EXCEPTION 'INVALID: ยังไม่ได้กรอกชื่อรายการ' USING ERRCODE = '22023';
  END IF;
  IF p_expense IS NOT NULL THEN
    v_exp := public.add_expense(p_expense || jsonb_build_object('related_asset_id', p_asset_id, 'property_utility_id', NULL));
  END IF;
  SELECT coalesce(max(i.sort_order), 0) INTO v_base FROM public.property_inventory_items i WHERE i.property_id = v_prop AND i.deleted_at IS NULL;
  INSERT INTO public.property_inventory_items(property_id, unit_label, item_type, name, qty, brand, serial_no, value, notes, sort_order, expense_item_id)
  SELECT v_prop, nullif(trim(r->>'unit_label'), ''), coalesce(nullif(r->>'item_type', ''), 'OTHER'), trim(r->>'name'),
         coalesce(nullif(replace(r->>'qty', ',', ''), '')::numeric, 1), nullif(trim(r->>'brand'), ''), nullif(trim(r->>'serial_no'), ''),
         nullif(replace(r->>'value', ',', ''), '')::numeric, nullif(trim(r->>'notes'), ''), v_base + o, v_exp
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(r, o)
   WHERE length(trim(coalesce(r->>'name', ''))) > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.add_inventory_items(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_inventory_items(uuid, jsonb, jsonb) TO authenticated;

-- 6) ขาย / ทิ้ง ของในทรัพย์สิน · ขายได้เงิน → รายได้อื่นของทรัพย์สิน (หน้า Income & Expenses + "รายการรับอื่น") ----------
CREATE OR REPLACE FUNCTION public.dispose_inventory_item(p_item_id uuid, p_type text, p_date date, p_amount numeric DEFAULT NULL,
                                                          p_to_asset_id uuid DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE i public.property_inventory_items; v_asset uuid; v_ccy text; v_inc uuid; v_type text := upper(trim(coalesce(p_type, '')));
BEGIN
  SELECT * INTO i FROM public.property_inventory_items WHERE id = p_item_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการ' USING ERRCODE = 'P0002'; END IF;
  IF i.disposal_type IS NOT NULL THEN RAISE EXCEPTION 'INVALID: รายการนี้ขาย / ทิ้งไปแล้ว' USING ERRCODE = '22023'; END IF;
  IF v_type NOT IN ('SOLD','DISCARDED') THEN RAISE EXCEPTION 'INVALID: เลือก ขาย หรือ ทิ้ง' USING ERRCODE = '22023'; END IF;
  IF p_date IS NULL OR p_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่ไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  IF p_amount IS NOT NULL AND p_amount < 0 THEN RAISE EXCEPTION 'INVALID: จำนวนเงินต้องไม่ติดลบ' USING ERRCODE = '22023'; END IF;
  IF v_type = 'DISCARDED' AND coalesce(p_amount, 0) > 0 THEN
    RAISE EXCEPTION 'INVALID: ทิ้งไม่มีเงินรับ · ถ้าได้เงินให้เลือก "ขาย"' USING ERRCODE = '22023';
  END IF;
  IF v_type = 'SOLD' AND coalesce(p_amount, 0) > 0 AND p_to_asset_id IS NULL THEN
    RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่รับเงิน' USING ERRCODE = '22023';
  END IF;
  SELECT pd.asset_id INTO v_asset FROM public.property_details pd WHERE pd.id = i.property_id;
  UPDATE public.property_inventory_items
     SET disposal_type = v_type, disposed_date = p_date, disposal_amount = CASE WHEN coalesce(p_amount, 0) > 0 THEN p_amount END,
         notes = coalesce(nullif(trim(p_notes), ''), notes)
   WHERE id = i.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_DENIED: ไม่มีสิทธิ์แก้รายการนี้' USING ERRCODE = '42501'; END IF;
  IF v_type = 'SOLD' AND coalesce(p_amount, 0) > 0 THEN
    SELECT a.currency INTO v_ccy FROM public.assets a WHERE a.id = p_to_asset_id;
    INSERT INTO public.income_transactions(income_type, income_subtype, asset_id, amount, currency, date, received_to_asset_id, notes)
    VALUES ('OTHER', 'ขายของในทรัพย์สิน', v_asset, p_amount, coalesce(v_ccy, 'THB'), p_date, p_to_asset_id,
            left(i.name || coalesce(' · ' || nullif(trim(p_notes), ''), ''), 500))
    RETURNING id INTO v_inc;
    UPDATE public.property_inventory_items SET income_transaction_id = v_inc WHERE id = i.id;
  END IF;
  RETURN v_inc;
END $$;
REVOKE EXECUTE ON FUNCTION public.dispose_inventory_item(uuid, text, date, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispose_inventory_item(uuid, text, date, numeric, uuid, text) TO authenticated;

-- 7) ยกเลิกการขาย / ทิ้ง: ลบรายได้ที่สร้าง (Soft Delete · สิทธิ์ตาม RLS / ล็อกงวด) แล้วคืนของเข้ารายการ ----------------
CREATE OR REPLACE FUNCTION public.undo_inventory_disposal(p_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE i public.property_inventory_items;
BEGIN
  SELECT * INTO i FROM public.property_inventory_items WHERE id = p_item_id AND deleted_at IS NULL;
  IF NOT FOUND OR i.disposal_type IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการที่ขาย / ทิ้ง' USING ERRCODE = 'P0002'; END IF;
  IF i.income_transaction_id IS NOT NULL THEN
    UPDATE public.income_transactions SET deleted_at = now() WHERE id = i.income_transaction_id AND deleted_at IS NULL;
    IF NOT FOUND AND EXISTS (SELECT 1 FROM public.income_transactions WHERE id = i.income_transaction_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: ไม่มีสิทธิ์ลบรายได้ที่บันทึกไว้' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE public.property_inventory_items
     SET disposal_type = NULL, disposed_date = NULL, disposal_amount = NULL, income_transaction_id = NULL
   WHERE id = i.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_DENIED: ไม่มีสิทธิ์แก้รายการนี้' USING ERRCODE = '42501'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.undo_inventory_disposal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_inventory_disposal(uuid) TO authenticated;
