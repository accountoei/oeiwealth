-- =====================================================================
-- ธุรกิจ (Private Business): เก็บเจ้าของเป็น "จำนวนหุ้น" แทน %
--   * asset_ownerships.shares — จำนวนหุ้นที่สมาชิกถือ (เฉพาะธุรกิจ · ทรัพย์สินอื่นยังใช้ %)
--   * % เจ้าของ (ภายในส่วนของครอบครัว) คำนวณจากหุ้นอัตโนมัติ — ใช้แสดง / ตรวจผลรวม
--   * มูลค่ารายคน = หุ้นของคน ÷ หุ้นรวมของครอบครัว × มูลค่า (ไม่ปัดเศษ % → 4,000 ÷ 9,000 × 900,000 = 400,000.00 พอดี)
--   * Dashboard แสดง "4,000 หุ้น · 40% ของบริษัท" แทน % ภายในครอบครัว
--   รันซ้ำได้
-- =====================================================================

ALTER TABLE public.asset_ownerships ADD COLUMN IF NOT EXISTS shares public.d_qty;
ALTER TABLE public.asset_ownerships DROP CONSTRAINT IF EXISTS ao_shares_pos;
ALTER TABLE public.asset_ownerships ADD CONSTRAINT ao_shares_pos CHECK (shares IS NULL OR shares > 0);

-- 1) % จากจำนวนหุ้น (ปัดลง 4 ตำแหน่ง → ผลรวมไม่เกิน 100) -------------------------------
CREATE OR REPLACE FUNCTION private.tg_ownership_from_shares() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_total numeric;
BEGIN
  IF NEW.shares IS NULL THEN RETURN NEW; END IF;
  SELECT d.shares_owned INTO v_total
    FROM public.private_business_details d JOIN public.assets a ON a.id = d.asset_id
   WHERE d.asset_id = NEW.asset_id AND a.asset_type = 'PRIVATE_BUSINESS' AND d.deleted_at IS NULL;
  IF coalesce(v_total, 0) <= 0 THEN
    RAISE EXCEPTION 'INVALID: ระบุจำนวนหุ้นได้เฉพาะธุรกิจที่มี "จำนวนหุ้นที่ครอบครัวถือ"' USING ERRCODE = '22023';
  END IF;
  NEW.ownership_percent := trunc(NEW.shares * 100 / v_total, 4);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t08_shares ON public.asset_ownerships;
CREATE TRIGGER t08_shares BEFORE INSERT OR UPDATE ON public.asset_ownerships
  FOR EACH ROW EXECUTE FUNCTION private.tg_ownership_from_shares();
REVOKE ALL ON FUNCTION private.tg_ownership_from_shares() FROM PUBLIC, anon, authenticated;

-- 2) สัดส่วนรายคนสำหรับคิดมูลค่า: ถ้าเจ้าของ ณ วันนั้นระบุหุ้นครบทุกคน → หุ้น ÷ หุ้นรวม (ไม่ปัดเศษ) --------
CREATE OR REPLACE FUNCTION private.asset_owner_shares(p_asset uuid, p_date date)
RETURNS TABLE (person_id uuid, pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH r AS (
    SELECT x.person_id, x.ownership_percent, x.shares
      FROM public.asset_ownerships x JOIN public.persons p ON p.id = x.person_id
     WHERE x.asset_id = p_asset AND x.deleted_at IS NULL AND p.deleted_at IS NULL
       AND x.start_date <= p_date AND (x.end_date IS NULL OR x.end_date >= p_date)),
  m AS (SELECT bool_and(r.shares IS NOT NULL) AS by_shares, sum(r.shares) AS total FROM r),
  o AS (
    SELECT r.person_id,
           sum(CASE WHEN m.by_shares AND m.total > 0 THEN r.shares * 100 / m.total ELSE r.ownership_percent END) AS pct
      FROM r CROSS JOIN m
     GROUP BY r.person_id)
  SELECT o.person_id, o.pct FROM o
  UNION ALL
  SELECT NULL::uuid, 100 - coalesce((SELECT sum(o.pct) FROM o), 0)
   WHERE coalesce((SELECT sum(o.pct) FROM o), 0) < 99.99999
$$;

-- 3) แก้เจ้าของ: รับ {"person_id","shares"} (ธุรกิจ) หรือ {"person_id","percent"} (ทั่วไป) -------------
CREATE OR REPLACE FUNCTION public.set_asset_ownership(p_asset_id uuid, p_owners jsonb, p_mode text DEFAULT 'CORRECT', p_effective_date date DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_start date; v_go_live date; o jsonb; v_total numeric := 0; v_shares numeric; v_by_shares boolean;
BEGIN
  SELECT f.go_live_date INTO v_go_live FROM public.assets a JOIN public.families f ON f.id = a.family_id
   WHERE a.id = p_asset_id AND a.deleted_at IS NULL;
  IF v_go_live IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบรายการนี้' USING ERRCODE = '22023'; END IF;
  SELECT bool_or(nullif(x->>'shares', '') IS NOT NULL), sum(nullif(x->>'shares', '')::numeric)
    INTO v_by_shares, v_shares FROM jsonb_array_elements(coalesce(p_owners, '[]'::jsonb)) x;
  v_by_shares := coalesce(v_by_shares, false);

  IF v_by_shares THEN
    IF NOT EXISTS (SELECT 1 FROM public.assets WHERE id = p_asset_id AND asset_type = 'PRIVATE_BUSINESS') THEN
      RAISE EXCEPTION 'INVALID: ระบุจำนวนหุ้นได้เฉพาะธุรกิจ' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_owners) x WHERE nullif(x->>'shares', '') IS NULL) THEN
      RAISE EXCEPTION 'INVALID: ใส่จำนวนหุ้นให้ครบทุกคน' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.private_business_details WHERE asset_id = p_asset_id AND total_shares IS NOT NULL AND v_shares > total_shares) THEN
      RAISE EXCEPTION 'INVALID: หุ้นรวม (%) เกินจำนวนหุ้นทั้งหมดของบริษัท', v_shares USING ERRCODE = '22023';
    END IF;
    -- หุ้นที่ครอบครัวถือ = ผลรวม · % ของบริษัท คำนวณใหม่
    UPDATE public.private_business_details
       SET shares_owned = v_shares,
           company_ownership_percent = CASE WHEN total_shares > 0 THEN round(v_shares * 100 / total_shares, 4) ELSE company_ownership_percent END
     WHERE asset_id = p_asset_id AND deleted_at IS NULL;
  ELSE
    FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p_owners, '[]'::jsonb)) LOOP
      v_total := v_total + (o->>'percent')::numeric;
    END LOOP;
    IF v_total > 100 THEN RAISE EXCEPTION 'INVALID: สัดส่วนรวม % %% เกิน 100%%', v_total USING ERRCODE = '22023'; END IF;
  END IF;

  IF p_mode = 'CHANGE' THEN
    IF p_effective_date IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่วันที่เริ่มมีผล' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.asset_ownerships WHERE asset_id = p_asset_id AND deleted_at IS NULL
                AND end_date IS NULL AND start_date >= p_effective_date) THEN
      RAISE EXCEPTION 'INVALID: วันที่เริ่มมีผลต้องอยู่หลังวันเริ่มของเจ้าของปัจจุบัน (ถ้ากรอกผิดให้เลือก "แก้ข้อมูลที่กรอกผิด")'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.asset_ownerships SET end_date = p_effective_date - 1
     WHERE asset_id = p_asset_id AND deleted_at IS NULL AND end_date IS NULL;
    v_start := p_effective_date;
  ELSE
    SELECT min(start_date) INTO v_start FROM public.asset_ownerships
     WHERE asset_id = p_asset_id AND deleted_at IS NULL AND end_date IS NULL;
    v_start := coalesce(v_start, (SELECT coalesce(a.acquisition_date, v_go_live - 1) FROM public.assets a WHERE a.id = p_asset_id));
    UPDATE public.asset_ownerships SET deleted_at = now()
     WHERE asset_id = p_asset_id AND deleted_at IS NULL AND end_date IS NULL;
  END IF;

  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p_owners, '[]'::jsonb)) LOOP
    INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, shares, start_date)
    VALUES (p_asset_id, (o->>'person_id')::uuid, coalesce(nullif(o->>'percent', '')::numeric, 0),
            CASE WHEN v_by_shares THEN (o->>'shares')::numeric END, v_start);
  END LOOP;
END $$;

-- 4) สร้างธุรกิจ: เจ้าของระบุเป็นจำนวนหุ้นได้ ----------------------------------------------
CREATE OR REPLACE FUNCTION public.create_private_business(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_family uuid; v_go_live date; v_asset uuid; o jsonb; v_start date;
  v_opening boolean := coalesce((p->>'is_opening')::boolean, false);
  v_date date := nullif(p->>'value_date', '')::date; v_value numeric := nullif(p->>'value', '')::numeric;
  v_acq date := nullif(p->>'acquisition_date', '')::date; v_shares numeric;
BEGIN
  IF length(trim(coalesce(p->>'company_name', ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อบริษัท' USING ERRCODE = '22023'; END IF;
  IF v_value IS NULL OR v_date IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่มูลค่าและวันที่' USING ERRCODE = '22023'; END IF;
  SELECT id, go_live_date INTO v_family, v_go_live FROM public.families WHERE deleted_at IS NULL LIMIT 1;
  IF NOT v_opening AND (v_acq IS NULL OR v_acq < v_go_live) THEN
    RAISE EXCEPTION 'INVALID: ที่ได้มาหลัง Go-live ต้องระบุวันที่ได้มา (ตั้งแต่ %) — ถ้ามีอยู่ก่อน ให้ติ๊ก "มีอยู่ก่อน Go-live"', v_go_live
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.assets(family_id, asset_group, asset_type, name, currency, acquisition_date, acquisition_cost, notes)
  VALUES (v_family, 'FINANCIAL', 'PRIVATE_BUSINESS', coalesce(nullif(trim(p->>'name'), ''), trim(p->>'company_name')),
          upper(coalesce(nullif(p->>'currency', ''), 'THB')), v_acq, nullif(p->>'investment_cost', '')::numeric, nullif(trim(p->>'notes'), ''))
  RETURNING id INTO v_asset;
  -- เจ้าของระบุเป็นจำนวนหุ้น → หุ้นที่ครอบครัวถือ = ผลรวม · % ของบริษัท = ผลรวม ÷ หุ้นทั้งหมด
  SELECT sum(nullif(x->>'shares', '')::numeric) INTO v_shares FROM jsonb_array_elements(coalesce(p->'owners', '[]'::jsonb)) x;
  INSERT INTO public.private_business_details(asset_id, company_name, registration_no, business_type, total_shares,
              shares_owned, company_ownership_percent, investment_cost, notes)
  VALUES (v_asset, trim(p->>'company_name'), nullif(trim(p->>'registration_no'), ''), nullif(trim(p->>'business_type'), ''),
          nullif(p->>'total_shares', '')::numeric, coalesce(v_shares, nullif(p->>'shares_owned', '')::numeric),
          coalesce(nullif(p->>'company_ownership_percent', '')::numeric,
                   round(v_shares * 100 / nullif(nullif(p->>'total_shares', '')::numeric, 0), 4)),
          nullif(p->>'investment_cost', '')::numeric, nullif(trim(p->>'notes'), ''));
  v_start := CASE WHEN v_opening THEN least(v_date, coalesce(v_acq, v_date)) ELSE v_acq END;
  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p->'owners', '[]'::jsonb)) LOOP
    INSERT INTO public.asset_ownerships(asset_id, person_id, ownership_percent, shares, start_date)
    VALUES (v_asset, (o->>'person_id')::uuid, coalesce(nullif(o->>'percent', '')::numeric, 0), nullif(o->>'shares', '')::numeric, v_start);
  END LOOP;
  INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, is_opening, notes)
  VALUES (v_asset, v_date, v_value, coalesce(nullif(p->>'valuation_method', ''), 'BOOK_VALUE'),
          CASE WHEN v_opening THEN 'OPENING' WHEN p->>'valuation_method' = 'APPRAISAL' THEN 'APPRAISAL' ELSE 'USER' END,
          v_opening, nullif(trim(p->>'notes'), ''));
  RETURN v_asset;
END $function$;

-- 5) รายการทรัพย์สินรายคน (Dashboard): เพิ่มคำอธิบายการถือหุ้นของธุรกิจ ----------------------------
DROP FUNCTION IF EXISTS public.month_person_items(date, uuid);
CREATE FUNCTION public.month_person_items(p_month date, p_person uuid)
RETURNS TABLE (item_type text, item_name text, item_group text, base_value numeric, ownership_percent numeric, share_note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_family uuid := private.default_family_id(); m0 date := date_trunc('month', p_month)::date;
        d date := private.month_end(p_month); v_snap uuid; v_at date := least(private.month_end(p_month), current_date);
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  SELECT id INTO v_snap FROM public.net_worth_snapshots
   WHERE family_id = v_family AND snapshot_month = m0 AND status = 'FINAL' AND deleted_at IS NULL;
  IF v_snap IS NOT NULL THEN
    RETURN QUERY SELECT i.item_type, i.item_name,
                        CASE i.item_subtype WHEN 'PRIVATE_BUSINESS' THEN 'BUSINESS' WHEN 'LOAN_RECEIVABLE' THEN 'LOANS'
                             WHEN 'INSURANCE_CASH_VALUE' THEN 'INSURANCE' ELSE i.item_group END,
                        i.base_value::numeric, i.ownership_percent::numeric,
                        private.business_share_note(i.asset_id, p_person, v_at)
      FROM public.net_worth_snapshot_items i WHERE i.snapshot_id = v_snap AND i.person_id IS NOT DISTINCT FROM p_person;
  ELSE
    RETURN QUERY SELECT n.item_type, n.item_name,
                        CASE n.item_subtype WHEN 'PRIVATE_BUSINESS' THEN 'BUSINESS' WHEN 'LOAN_RECEIVABLE' THEN 'LOANS'
                             WHEN 'INSURANCE_CASH_VALUE' THEN 'INSURANCE' ELSE n.item_group END,
                        n.base_value, n.ownership_percent,
                        CASE WHEN n.item_subtype = 'PRIVATE_BUSINESS' THEN private.business_share_note(n.asset_id, p_person, v_at) END
      FROM private.net_worth_items(v_family, least(d, current_date), d < current_date) n
     WHERE n.person_id IS NOT DISTINCT FROM p_person;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.month_person_items(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.month_person_items(date, uuid) TO authenticated;

-- "4,000 หุ้น · 40% ของบริษัท" (เฉพาะธุรกิจที่เก็บเจ้าของเป็นจำนวนหุ้น · ไม่ใช่ธุรกิจ = NULL)
CREATE OR REPLACE FUNCTION private.business_share_note(p_asset uuid, p_person uuid, p_date date) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_char(sum(o.shares), 'FM999,999,999,990') || ' หุ้น'
         || CASE WHEN max(d.total_shares) > 0
                 THEN ' · ' || rtrim(rtrim(to_char(round(sum(o.shares) * 100 / max(d.total_shares), 2), 'FM9990.99'), '0'), '.') || '% ของบริษัท'
                 ELSE '' END
    FROM public.asset_ownerships o
    JOIN public.private_business_details d ON d.asset_id = o.asset_id AND d.deleted_at IS NULL
   WHERE p_asset IS NOT NULL AND o.asset_id = p_asset AND o.person_id = p_person AND o.deleted_at IS NULL AND o.shares IS NOT NULL
     AND o.start_date <= p_date AND (o.end_date IS NULL OR o.end_date >= p_date)
  HAVING sum(o.shares) IS NOT NULL
$$;
REVOKE ALL ON FUNCTION private.business_share_note(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.business_share_note(uuid, uuid, date) TO authenticated, service_role;
