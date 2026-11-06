-- รายการส่งมอบ: มูลค่าชำรุดต่อชิ้น + จำนวนที่ชำรุด / สูญหาย (ตกลงกับเจ้าของ 6 พ.ย. 2026)
--   1) property_inventory_items.damage_value = มูลค่าชำรุดต่อชิ้น (value = มูลค่าต่อชิ้น · มูลค่าทดแทน = จำนวน × มูลค่าต่อชิ้น คำนวณที่หน้าจอ)
--   2) lease_handover_items.damage_value (คัดลอกจากของในทรัพย์สิน · แก้ได้ต่อสัญญา) + out_qty = จำนวนที่ชำรุด / สูญหาย (ไม่เกินจำนวนที่ส่งมอบ)
--      ค่าเสียหายเสนอ = จำนวนที่ชำรุด × มูลค่าชำรุดต่อชิ้น · จำนวนที่สูญหาย × มูลค่าต่อชิ้น (แก้ได้ · คำนวณที่หน้าจอ)
--   3) copy_inventory_to_lease คัดลอก damage_value · add_inventory_items รับ damage_value
--   เพิ่มคอลัมน์อย่างเดียว ไม่แก้ข้อมูลเดิม · รันซ้ำได้

ALTER TABLE public.property_inventory_items ADD COLUMN IF NOT EXISTS damage_value public.d_money;
ALTER TABLE public.lease_handover_items ADD COLUMN IF NOT EXISTS damage_value public.d_money;
ALTER TABLE public.lease_handover_items ADD COLUMN IF NOT EXISTS out_qty numeric(10,2);
COMMENT ON COLUMN public.property_inventory_items.value IS 'มูลค่าต่อชิ้น (สูญหาย → ค่าเสียหาย = จำนวนที่สูญหาย × มูลค่าต่อชิ้น)';
COMMENT ON COLUMN public.property_inventory_items.damage_value IS 'มูลค่าชำรุดต่อชิ้น (ชำรุด → ค่าเสียหาย = จำนวนที่ชำรุด × มูลค่าชำรุดต่อชิ้น)';
COMMENT ON COLUMN public.lease_handover_items.out_qty IS 'จำนวนที่ชำรุด / สูญหาย (ว่าง = ทั้งหมด)';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pinv_damage_value_ck') THEN
    ALTER TABLE public.property_inventory_items ADD CONSTRAINT pinv_damage_value_ck CHECK (damage_value IS NULL OR damage_value >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lho_damage_value_ck') THEN
    ALTER TABLE public.lease_handover_items ADD CONSTRAINT lho_damage_value_ck CHECK (damage_value IS NULL OR damage_value >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lho_out_qty_ck') THEN
    ALTER TABLE public.lease_handover_items ADD CONSTRAINT lho_out_qty_ck CHECK (out_qty IS NULL OR (out_qty > 0 AND out_qty <= qty));
  END IF;
END $$;

-- ดึงของ + มิเตอร์เข้ารายการส่งมอบ: คัดลอกมูลค่าชำรุดต่อชิ้นด้วย (นอกนั้นเหมือนเดิม)
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
  INSERT INTO public.lease_handover_items(lease_id, inventory_item_id, item_type, name, qty, brand, serial_no, value, damage_value, sort_order)
  SELECT l.id, i.id, i.item_type, i.name, i.qty, i.brand, i.serial_no, i.value, i.damage_value,
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

-- เพิ่มของหลายแถว: รับมูลค่าชำรุดต่อชิ้น (damage_value) ด้วย (นอกนั้นเหมือนเดิม)
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
  INSERT INTO public.property_inventory_items(property_id, unit_label, item_type, name, qty, brand, serial_no, value, damage_value, notes, sort_order, expense_item_id)
  SELECT v_prop, nullif(trim(r->>'unit_label'), ''), coalesce(nullif(r->>'item_type', ''), 'OTHER'), trim(r->>'name'),
         coalesce(nullif(replace(r->>'qty', ',', ''), '')::numeric, 1), nullif(trim(r->>'brand'), ''), nullif(trim(r->>'serial_no'), ''),
         nullif(replace(r->>'value', ',', ''), '')::numeric, nullif(replace(r->>'damage_value', ',', ''), '')::numeric,
         nullif(trim(r->>'notes'), ''), v_base + o, v_exp
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(r, o)
   WHERE length(trim(coalesce(r->>'name', ''))) > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.add_inventory_items(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_inventory_items(uuid, jsonb, jsonb) TO authenticated;
