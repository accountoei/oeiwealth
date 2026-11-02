-- =====================================================================
-- ของในทรัพย์สิน + รายการส่งมอบต่อสัญญาเช่า (ตกลง 2 พ.ย. 2026)
--   1) property_inventory_items: ของที่อยู่กับทรัพย์สิน (มิเตอร์ไฟ / น้ำ · กุญแจ · คีย์การ์ด · บัตรจอดรถ · รีโมท
--      · เฟอร์นิเจอร์ · เครื่องใช้ไฟฟ้า · อื่น ๆ) · จำนวน · ยี่ห้อ / รุ่น · เลขมิเตอร์ / Serial · มูลค่าทดแทน
--      · ห้อง (unit_label · ว่าง = ทั้งหลัง / ส่วนกลาง) · ไม่นับใน Net Worth (ข้อมูลอ้างอิงสำหรับส่งมอบ / หักเงินประกัน)
--   2) lease_handover_items: รายการส่งมอบของแต่ละสัญญา (คัดลอกจากของในทรัพย์สิน · แก้ / เพิ่มได้)
--      · สภาพวันรับมอบ / เลขมิเตอร์ · สภาพวันส่งคืน (ครบ / ชำรุด / สูญหาย) / เลขมิเตอร์ · ค่าเสียหายที่หัก
--   สิทธิ์ตามชุดมาตรฐาน (เหมือน property_deeds) · ลบ = Soft Delete (ADMIN / EDITOR) · รันซ้ำได้
-- =====================================================================

-- 1) ของในทรัพย์สิน -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.property_inventory_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES public.property_details(id),
  unit_label   text,                     -- ห้อง (ตรงกับ "ห้อง / ส่วนที่เช่า" ในสัญญา) · ว่าง = ทั้งหลัง / ส่วนกลาง
  item_type    text NOT NULL DEFAULT 'OTHER',
  name         text NOT NULL,
  qty          numeric(10,2) NOT NULL DEFAULT 1,
  brand        text,                     -- ยี่ห้อ / รุ่น
  serial_no    text,                     -- เลขมิเตอร์ / Serial
  value        public.d_money,           -- มูลค่าทดแทน (ใช้เสนอค่าเสียหายตอนหักเงินประกัน)
  notes        text,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id),
  CONSTRAINT pinv_type_ck CHECK (item_type IN ('ELECTRIC_METER','WATER_METER','KEY','KEYCARD','PARKING_CARD','REMOTE','FURNITURE','APPLIANCE','OTHER')),
  CONSTRAINT pinv_qty_ck CHECK (qty > 0),
  CONSTRAINT pinv_value_ck CHECK (value IS NULL OR value >= 0),
  CONSTRAINT pinv_len_ck CHECK (length(trim(name)) BETWEEN 1 AND 200 AND coalesce(length(unit_label), 0) <= 100
    AND coalesce(length(brand), 0) <= 200 AND coalesce(length(serial_no), 0) <= 100 AND coalesce(length(notes), 0) <= 500)
);
CREATE INDEX IF NOT EXISTS pinv_property_idx ON public.property_inventory_items(property_id);

-- 2) รายการส่งมอบต่อสัญญา ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lease_handover_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id          uuid NOT NULL REFERENCES public.property_leases(id),
  inventory_item_id uuid REFERENCES public.property_inventory_items(id),   -- คัดลอกมาจาก (ว่าง = เพิ่มเฉพาะสัญญานี้)
  item_type         text NOT NULL DEFAULT 'OTHER',
  name              text NOT NULL,
  qty               numeric(10,2) NOT NULL DEFAULT 1,
  brand             text,
  serial_no         text,
  value             public.d_money,
  in_condition      text,                -- สภาพวันรับมอบ
  in_reading        numeric(14,2),       -- เลขมิเตอร์วันรับมอบ
  out_status        text,                -- วันส่งคืน: ครบ / ชำรุด / สูญหาย
  out_condition     text,
  out_reading       numeric(14,2),       -- เลขมิเตอร์วันส่งคืน
  deduction         public.d_money,      -- ค่าเสียหายที่หักจากเงินประกัน
  notes             text,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id),
  CONSTRAINT lho_type_ck CHECK (item_type IN ('ELECTRIC_METER','WATER_METER','KEY','KEYCARD','PARKING_CARD','REMOTE','FURNITURE','APPLIANCE','OTHER')),
  CONSTRAINT lho_qty_ck CHECK (qty > 0),
  CONSTRAINT lho_out_ck CHECK (out_status IS NULL OR out_status IN ('OK','DAMAGED','MISSING')),
  CONSTRAINT lho_money_ck CHECK ((value IS NULL OR value >= 0) AND (deduction IS NULL OR deduction >= 0)),
  CONSTRAINT lho_reading_ck CHECK ((in_reading IS NULL OR in_reading >= 0) AND (out_reading IS NULL OR out_reading >= 0)),
  CONSTRAINT lho_len_ck CHECK (length(trim(name)) BETWEEN 1 AND 200 AND coalesce(length(brand), 0) <= 200
    AND coalesce(length(serial_no), 0) <= 100 AND coalesce(length(in_condition), 0) <= 500
    AND coalesce(length(out_condition), 0) <= 500 AND coalesce(length(notes), 0) <= 500)
);
CREATE INDEX IF NOT EXISTS lho_lease_idx ON public.lease_handover_items(lease_id);
CREATE INDEX IF NOT EXISTS lho_inventory_idx ON public.lease_handover_items(inventory_item_id) WHERE inventory_item_id IS NOT NULL;

-- 3) Trigger + RLS ชุดมาตรฐาน --------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['property_inventory_items', 'lease_handover_items'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS t10_meta ON public.%I', t);
    EXECUTE format('CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.tg_meta(''soft'')', t);
    EXECUTE format('DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS z90_audit ON public.%I', t);
    EXECUTE format('CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.tg_audit()', t);

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS p_select ON public.%I', t);
    EXECUTE format('CREATE POLICY p_select ON public.%I FOR SELECT TO authenticated
      USING ((SELECT private.has_role(''ADMIN'',''EDITOR'',''CONTRIBUTOR'',''VIEWER'')))', t);
    EXECUTE format('DROP POLICY IF EXISTS p_insert ON public.%I', t);
    EXECUTE format('CREATE POLICY p_insert ON public.%I FOR INSERT TO authenticated
      WITH CHECK ((SELECT private.has_role(''ADMIN'',''EDITOR'',''CONTRIBUTOR'')))', t);
    EXECUTE format('DROP POLICY IF EXISTS p_update ON public.%I', t);
    EXECUTE format('CREATE POLICY p_update ON public.%I FOR UPDATE TO authenticated
      USING ((SELECT private.has_role(''ADMIN'',''EDITOR''))
             OR ((SELECT private.has_role(''CONTRIBUTOR'')) AND created_by = (SELECT private.app_user_id())
                 AND created_at >= now() - interval ''24 hours'' AND deleted_at IS NULL))
      WITH CHECK ((SELECT private.has_role(''ADMIN'',''EDITOR''))
             OR ((SELECT private.has_role(''CONTRIBUTOR'')) AND created_by = (SELECT private.app_user_id())
                 AND created_at >= now() - interval ''24 hours'' AND deleted_at IS NULL))', t);
  END LOOP;
END $$;

-- 4) คัดลอกของในทรัพย์สินเข้ารายการส่งมอบของสัญญา (ห้องเดียวกับสัญญา + ส่วนกลาง) ------------------------
--    ข้ามของที่คัดลอกแล้ว (กดซ้ำได้ เพิ่มเฉพาะของใหม่) · SECURITY INVOKER = สิทธิ์ตาม RLS ของผู้กด
CREATE OR REPLACE FUNCTION public.copy_inventory_to_lease(p_lease_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE l public.property_leases; n integer;
BEGIN
  SELECT * INTO l FROM public.property_leases WHERE id = p_lease_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: ไม่พบสัญญาเช่า' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.lease_handover_items(lease_id, inventory_item_id, item_type, name, qty, brand, serial_no, value, sort_order)
  SELECT l.id, i.id, i.item_type, i.name, i.qty, i.brand, i.serial_no, i.value,
         row_number() OVER (ORDER BY i.unit_label NULLS FIRST, i.sort_order, i.created_at)
         + coalesce((SELECT max(h.sort_order) FROM public.lease_handover_items h WHERE h.lease_id = l.id AND h.deleted_at IS NULL), 0)
    FROM public.property_inventory_items i
   WHERE i.property_id = l.property_id AND i.deleted_at IS NULL
     AND (i.unit_label IS NULL OR lower(trim(i.unit_label)) = lower(trim(coalesce(l.unit_label, ''))))
     AND NOT EXISTS (SELECT 1 FROM public.lease_handover_items h
                      WHERE h.lease_id = l.id AND h.inventory_item_id = i.id AND h.deleted_at IS NULL);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.copy_inventory_to_lease(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_inventory_to_lease(uuid) TO authenticated;
