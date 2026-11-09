-- =====================================================================
-- อัปเดตยอดซ้ำวันเดิม = แทนแถวเดิม (เจ้าของตอบ "ทำเลย" 9 พ.ย. 2026)
--   เดิม: อัปเดตยอดบัญชีธนาคาร / มูลค่าทรัพย์สิน ซ้ำวันเดียวกันได้หลายแถว → คำนวณใช้แถวที่บันทึกหลังสุดอยู่แล้ว
--         แต่แถวเก่ายังค้างในประวัติ ดูแล้วงงว่าแถวไหนคือยอดจริง
--   ใหม่: หลังบันทึกยอดจากหน้าเว็บ เรียก replace_same_day_valuation(asset, วันที่)
--         → แถวเก่าของวันเดียวกันถูกลบแบบ soft delete (กู้คืนได้ · มีบันทึก audit) เหลือแถวล่าสุดแถวเดียว
--   แตะเฉพาะ "ยอดอัปเดตธรรมดา": ไม่แตะยอดตั้งต้น, ยอดกระทบยอด / เปิดบัญชี, แถวที่ผูกกับรายการจ่ายเพิ่ม (source_movement_id),
--         ราคาขาย และแถวที่รายการอื่นอ้างถึง (ขายหุ้น / ขายบางส่วน / รับผลประโยชน์ประกัน / ส่วนประกอบทรัพย์สิน / กระทบยอด)
--   ตัวเลขที่ระบบใช้ไม่เปลี่ยน (เดิมใช้แถวหลังสุดอยู่แล้ว) · ก้อนรอแยกของบัญชีธนาคารคำนวณใหม่เองตาม Trigger เดิม
--   ล้างรายการซ้ำที่มีอยู่แล้วครั้งเดียวท้ายไฟล์ (เก็บแถวธรรมดาที่บันทึกหลังสุด) · รันซ้ำได้
-- =====================================================================

-- แถวนี้เป็น "ยอดอัปเดตธรรมดา" ที่แทนกันได้หรือไม่
CREATE OR REPLACE FUNCTION private.is_plain_valuation(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.asset_valuations v
     WHERE v.id = p_id AND v.deleted_at IS NULL
       AND NOT v.is_opening AND v.source_movement_id IS NULL
       AND v.source NOT IN ('OPENING', 'RECONCILIATION', 'ACCOUNT_SETUP')
       AND coalesce(v.notes, '') <> 'ราคาขาย'
       AND NOT EXISTS (SELECT 1 FROM public.insurance_benefit_receipts r WHERE v.id = ANY (r.valuation_ids))
       AND NOT EXISTS (SELECT 1 FROM public.business_share_sales s WHERE s.valuation_id = v.id)
       AND NOT EXISTS (SELECT 1 FROM public.alternative_part_sales s WHERE s.valuation_id = v.id)
       AND NOT EXISTS (SELECT 1 FROM public.property_component_events e WHERE e.valuation_id = v.id)
       AND NOT EXISTS (SELECT 1 FROM public.bank_reconciliations b WHERE v.id IN (b.opening_valuation_id, b.closing_valuation_id)))
$$;
REVOKE ALL ON FUNCTION private.is_plain_valuation(uuid) FROM PUBLIC, anon, authenticated;

-- ลบแถวธรรมดาที่บันทึกก่อน p_keep ในวันเดียวกันของทรัพย์สินเดียวกัน (soft delete) · คืนจำนวนแถวที่ลบ
CREATE OR REPLACE FUNCTION private.drop_same_day_before(p_keep uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k public.asset_valuations; n integer;
BEGIN
  SELECT * INTO k FROM public.asset_valuations WHERE id = p_keep AND deleted_at IS NULL;
  IF k.id IS NULL OR NOT private.is_plain_valuation(k.id) THEN RETURN 0; END IF;
  UPDATE public.asset_valuations v SET deleted_at = now()
   WHERE v.asset_id = k.asset_id AND v.valuation_date = k.valuation_date AND v.deleted_at IS NULL
     AND v.id <> k.id AND v.created_at < k.created_at AND private.is_plain_valuation(v.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.drop_same_day_before(uuid) FROM PUBLIC, anon, authenticated;

-- เรียกจากหน้าเว็บหลังบันทึกยอดสำเร็จ: แถวล่าสุดของวันนั้นต้องเป็นของผู้เรียกเอง และเพิ่งบันทึก (10 นาที)
--   → ลบแถวเก่าของวันเดียวกันไม่ได้ถ้าไม่ได้เพิ่งบันทึกยอดใหม่เอง
CREATE OR REPLACE FUNCTION public.replace_same_day_valuation(p_asset_id uuid, p_date date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k public.asset_valuations;
BEGIN
  PERFORM private.require_role('ADMIN', 'EDITOR', 'CONTRIBUTOR');
  SELECT * INTO k FROM public.asset_valuations
   WHERE asset_id = p_asset_id AND valuation_date = p_date AND deleted_at IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF k.id IS NULL OR k.created_by IS DISTINCT FROM private.app_user_id()
     OR k.created_at < now() - interval '10 minutes' THEN
    RETURN 0;
  END IF;
  RETURN private.drop_same_day_before(k.id);
END $$;
REVOKE ALL ON FUNCTION public.replace_same_day_valuation(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_same_day_valuation(uuid, date) TO authenticated;

-- ล้างรายการซ้ำที่มีอยู่แล้ว: แต่ละทรัพย์สิน + วันที่ เก็บแถวธรรมดาที่บันทึกหลังสุด
DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (v.asset_id, v.valuation_date) v.id
      FROM public.asset_valuations v
     WHERE v.deleted_at IS NULL AND private.is_plain_valuation(v.id)
       AND (v.asset_id, v.valuation_date) IN (
             SELECT x.asset_id, x.valuation_date FROM public.asset_valuations x
              WHERE x.deleted_at IS NULL AND private.is_plain_valuation(x.id)
              GROUP BY 1, 2 HAVING count(*) > 1)
     ORDER BY v.asset_id, v.valuation_date, v.created_at DESC
  LOOP
    n := n + private.drop_same_day_before(r.id);
  END LOOP;
  RAISE NOTICE 'same-day valuations replaced: %', n;
END $$;
