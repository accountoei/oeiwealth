-- =====================================================================
-- Alternative Assets: หน่วยนับ (ต่อรายการ + ค่าตั้งต้นต่อหมวด) · ความบริสุทธิ์ (ทองคำ)
--   alternative_asset_details.unit / purity_pct · asset_categories.default_unit
--   ใส่หน่วยตั้งต้นให้หมวดมาตรฐาน + หมวดชื่อ "ไวน์…" · รายการเดิมที่มีจำนวนแต่ยังไม่มีหน่วย = หน่วยตั้งต้นของหมวด
--     (เจ้าของตกลง 17 ต.ค. 2026: ทองคำ = บาททองคำ · รองเท้า = คู่ · ไวน์ = ขวด)
--   create_alternative_asset(): รับ unit / purity_pct (ไม่ส่ง unit = หน่วยตั้งต้นของหมวด) · signature เดิม
--   เพิ่มคอลัมน์ไม่บังคับ · แก้เฉพาะช่องหน่วยที่ยังว่าง · ไม่ลบข้อมูล · รันซ้ำได้
-- =====================================================================
ALTER TABLE public.asset_categories ADD COLUMN IF NOT EXISTS default_unit text;
ALTER TABLE public.alternative_asset_details
  ADD COLUMN IF NOT EXISTS unit       text,
  ADD COLUMN IF NOT EXISTS purity_pct numeric;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aad_purity_pct_ck') THEN
    ALTER TABLE public.alternative_asset_details ADD CONSTRAINT aad_purity_pct_ck CHECK (purity_pct IS NULL OR (purity_pct > 0 AND purity_pct <= 100));
  END IF;
END $$;

UPDATE public.asset_categories SET default_unit = CASE category_code
    WHEN 'GOLD' THEN 'บาททองคำ' WHEN 'JEWELRY' THEN 'ชิ้น' WHEN 'WATCH' THEN 'เรือน'
    WHEN 'SHOES' THEN 'คู่' WHEN 'CRYPTO' THEN 'เหรียญ' END
 WHERE family_id IS NULL AND default_unit IS NULL AND category_code IN ('GOLD','JEWELRY','WATCH','SHOES','CRYPTO');
UPDATE public.asset_categories SET default_unit = 'ขวด'
 WHERE family_id IS NOT NULL AND default_unit IS NULL AND category_name LIKE 'ไวน์%' AND deleted_at IS NULL;
UPDATE public.asset_categories SET default_unit = 'ชิ้น' WHERE default_unit IS NULL AND deleted_at IS NULL;

UPDATE public.alternative_asset_details d SET unit = c.default_unit
  FROM public.asset_categories c
 WHERE c.id = d.category_id AND d.unit IS NULL AND d.quantity IS NOT NULL AND d.deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.create_alternative_asset(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_family uuid; v_go_live date; v_asset uuid; v_code text; v_unit text; o jsonb; v_start date;
  v_opening boolean := coalesce((p->>'is_opening')::boolean, false);
  v_date date := nullif(p->>'value_date', '')::date; v_value numeric := nullif(p->>'value', '')::numeric;
  v_acq date := nullif(p->>'acquisition_date', '')::date;
BEGIN
  IF length(trim(coalesce(p->>'name', ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อ' USING ERRCODE = '22023'; END IF;
  IF v_value IS NULL OR v_date IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่มูลค่าและวันที่' USING ERRCODE = '22023'; END IF;
  SELECT id, go_live_date INTO v_family, v_go_live FROM public.families WHERE deleted_at IS NULL LIMIT 1;
  SELECT category_code, default_unit INTO v_code, v_unit FROM public.asset_categories
   WHERE id = (p->>'category_id')::uuid AND deleted_at IS NULL AND (family_id IS NULL OR family_id = v_family);
  IF v_code IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกหมวด' USING ERRCODE = '22023'; END IF;
  IF NOT v_opening AND (v_acq IS NULL OR v_acq < v_go_live) THEN
    RAISE EXCEPTION 'INVALID: สินทรัพย์ที่ได้มาหลัง Go-live ต้องระบุวันที่ได้มา (ตั้งแต่ %) — ถ้ามีอยู่ก่อน ให้ติ๊ก "มีอยู่ก่อน Go-live"', v_go_live
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency, acquisition_date, acquisition_cost, notes)
  VALUES (v_family, 'ALTERNATIVE', v_code, trim(p->>'name'), upper(coalesce(nullif(p->>'currency', ''), 'THB')),
          v_acq, nullif(p->>'acquisition_cost', '')::numeric, nullif(trim(p->>'notes'), ''))
  RETURNING id INTO v_asset;
  INSERT INTO public.alternative_asset_details(asset_id, category_id, brand, model, serial_no, quantity, unit, purity_pct,
              storage_location, condition, details)
  VALUES (v_asset, (p->>'category_id')::uuid, nullif(trim(p->>'brand'), ''), nullif(trim(p->>'model'), ''),
          nullif(trim(p->>'serial_no'), ''), nullif(p->>'quantity', '')::numeric,
          coalesce(nullif(trim(p->>'unit'), ''), v_unit), nullif(p->>'purity_pct', '')::numeric,
          nullif(trim(p->>'storage_location'), ''), nullif(trim(p->>'condition'), ''), nullif(trim(p->>'details'), ''));
  v_start := CASE WHEN v_opening THEN least(v_date, coalesce(v_acq, v_date)) ELSE v_acq END;
  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p->'owners', '[]'::jsonb)) LOOP
    INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, start_date)
    VALUES (v_asset, (o->>'person_id')::uuid, (o->>'percent')::numeric, v_start);
  END LOOP;
  INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening, notes)
  VALUES (v_asset, v_date, v_value, coalesce(nullif(p->>'valuation_method', ''), 'USER_ESTIMATE'),
          CASE WHEN v_opening THEN 'OPENING' WHEN p->>'valuation_method' = 'APPRAISAL' THEN 'APPRAISAL' ELSE 'USER' END,
          v_opening, nullif(trim(p->>'notes'), ''));
  RETURN v_asset;
END $$;
REVOKE ALL ON FUNCTION public.create_alternative_asset(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_alternative_asset(jsonb) TO authenticated;
