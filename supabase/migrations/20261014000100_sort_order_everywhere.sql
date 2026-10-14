-- =====================================================================
-- จัดลำดับรายการในทุกหน้า (ปุ่ม "จัดลำดับ" → ↑ ↓ → "เสร็จ")
--   sort_order: assets (แยกกลุ่มตามหน้า: บัญชี / เงินให้กู้ / ธุรกิจ / มูลค่าเวนคืน / พอร์ต / อสังหาฯ / Alternative)
--               insurance_policies · liabilities · credit_cards · memberships · points_accounts · health_results
--   ค่าเริ่มต้น = ลำดับที่หน้าจอแสดงอยู่เดิม · รายการใหม่ต่อท้ายกลุ่ม
--   swap_sort_order(table, a, b): สลับลำดับสองรายการในกลุ่มเดียวกัน (หน้าจอส่งรายการที่อยู่ติดกันที่มองเห็น)
--   move_health_metric(person, metric, neighbor): ลำดับรายการผลตรวจ (เช่น น้ำตาล / ไขมัน) ของสมาชิกคนนั้น
-- รันซ้ำได้
-- =====================================================================

ALTER TABLE public.assets             ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE public.liabilities        ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE public.credit_cards       ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE public.memberships        ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE public.points_accounts    ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE public.health_results     ADD COLUMN IF NOT EXISTS sort_order integer;

-- กลุ่มของทรัพย์สิน = หน้าที่แสดง
CREATE OR REPLACE FUNCTION private.asset_sort_group(p_group text, p_type text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_group = 'FINANCIAL' THEN p_type ELSE p_group END
$$;

-- 1) ค่าเริ่มต้น (เฉพาะแถวที่ยังไม่มีลำดับ) --------------------------------------
WITH r AS (
  SELECT id, row_number() OVER (PARTITION BY family_id, private.asset_sort_group(asset_group, asset_type)
           ORDER BY CASE WHEN asset_group IN ('PROPERTY','ALTERNATIVE') OR asset_type = 'PRIVATE_BUSINESS' THEN NULL ELSE status END,
                    CASE WHEN asset_group IN ('PROPERTY','ALTERNATIVE') OR asset_type = 'PRIVATE_BUSINESS' THEN NULL ELSE name END,
                    created_at) AS n
    FROM public.assets WHERE sort_order IS NULL)
UPDATE public.assets a SET sort_order = r.n FROM r WHERE a.id = r.id;

WITH r AS (SELECT id, row_number() OVER (ORDER BY status, insurer, created_at) AS n FROM public.insurance_policies WHERE sort_order IS NULL)
UPDATE public.insurance_policies x SET sort_order = r.n FROM r WHERE x.id = r.id;
WITH r AS (SELECT id, row_number() OVER (ORDER BY name, created_at) AS n FROM public.liabilities WHERE sort_order IS NULL)
UPDATE public.liabilities x SET sort_order = r.n FROM r WHERE x.id = r.id;
WITH r AS (SELECT id, row_number() OVER (ORDER BY status, issuer, created_at) AS n FROM public.credit_cards WHERE sort_order IS NULL)
UPDATE public.credit_cards x SET sort_order = r.n FROM r WHERE x.id = r.id;
WITH r AS (SELECT id, row_number() OVER (ORDER BY status, program_name, created_at) AS n FROM public.memberships WHERE sort_order IS NULL)
UPDATE public.memberships x SET sort_order = r.n FROM r WHERE x.id = r.id;
WITH r AS (SELECT id, row_number() OVER (ORDER BY program_name, created_at) AS n FROM public.points_accounts WHERE sort_order IS NULL)
UPDATE public.points_accounts x SET sort_order = r.n FROM r WHERE x.id = r.id;
-- ผลตรวจ: ตามลำดับที่บันทึก (แต่ละ metric ใช้ลำดับครั้งแรกที่พบของสมาชิกคนนั้น)
WITH m AS (
  SELECT c.person_id, r.metric, min(r.created_at) AS first_at
    FROM public.health_results r JOIN public.health_checkups c ON c.id = r.checkup_id
   GROUP BY c.person_id, r.metric),
n AS (SELECT person_id, metric, row_number() OVER (PARTITION BY person_id ORDER BY first_at, metric) AS n FROM m)
UPDATE public.health_results r SET sort_order = n.n
  FROM public.health_checkups c, n
 WHERE c.id = r.checkup_id AND n.person_id = c.person_id AND n.metric = r.metric AND r.sort_order IS NULL;

-- 2) รายการใหม่ → ต่อท้ายกลุ่ม -------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_sort_order_append() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v integer;
BEGIN
  IF NEW.sort_order IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'assets' THEN
    SELECT max(sort_order) INTO v FROM public.assets
     WHERE family_id = NEW.family_id AND private.asset_sort_group(asset_group, asset_type) = private.asset_sort_group(NEW.asset_group, NEW.asset_type);
  ELSIF TG_TABLE_NAME = 'health_results' THEN
    -- metric เดิมของสมาชิกคนนี้ → ใช้ลำดับเดิม · metric ใหม่ → ต่อท้าย
    SELECT min(r.sort_order) INTO v FROM public.health_results r JOIN public.health_checkups c ON c.id = r.checkup_id
     WHERE r.metric = NEW.metric AND c.person_id = (SELECT person_id FROM public.health_checkups WHERE id = NEW.checkup_id);
    IF v IS NOT NULL THEN NEW.sort_order := v; RETURN NEW; END IF;
    SELECT max(r.sort_order) INTO v FROM public.health_results r JOIN public.health_checkups c ON c.id = r.checkup_id
     WHERE c.person_id = (SELECT person_id FROM public.health_checkups WHERE id = NEW.checkup_id);
  ELSE
    EXECUTE format('SELECT max(sort_order) FROM public.%I', TG_TABLE_NAME) INTO v;
  END IF;
  NEW.sort_order := coalesce(v, 0) + 1;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_sort_order_append() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['assets','insurance_policies','liabilities','credit_cards','memberships','points_accounts','health_results'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS t14_sort_order ON public.%I', t);
    EXECUTE format('CREATE TRIGGER t14_sort_order BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION private.tg_sort_order_append()', t);
  END LOOP;
END $$;

-- 3) สลับลำดับสองรายการ (ADMIN / EDITOR) ----------------------------------------
DROP FUNCTION IF EXISTS public.swap_sort_order(text, uuid, uuid);
CREATE FUNCTION public.swap_sort_order(p_table text, p_a uuid, p_b uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ga text; v_gb text; v_oa integer; v_ob integer; v_where text;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF p_table NOT IN ('assets','insurance_policies','liabilities','credit_cards','memberships','points_accounts') THEN
    RAISE EXCEPTION 'INVALID: จัดลำดับรายการประเภทนี้ไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN RETURN; END IF;

  -- กลุ่มต้องเดียวกัน (ทรัพย์สิน = หน้าเดียวกัน)
  IF p_table = 'assets' THEN
    SELECT family_id || ':' || private.asset_sort_group(asset_group, asset_type) INTO v_ga FROM public.assets WHERE id = p_a AND deleted_at IS NULL;
    SELECT family_id || ':' || private.asset_sort_group(asset_group, asset_type) INTO v_gb FROM public.assets WHERE id = p_b AND deleted_at IS NULL;
    v_where := format('family_id || %L || private.asset_sort_group(asset_group, asset_type) = %L', ':', v_ga);
  ELSE
    EXECUTE format('SELECT %L FROM public.%I WHERE id = $1 AND deleted_at IS NULL', 'all', p_table) INTO v_ga USING p_a;
    EXECUTE format('SELECT %L FROM public.%I WHERE id = $1 AND deleted_at IS NULL', 'all', p_table) INTO v_gb USING p_b;
    v_where := 'true';
  END IF;
  IF v_ga IS NULL OR v_gb IS NULL OR v_ga <> v_gb THEN
    RAISE EXCEPTION 'INVALID: ไม่พบรายการ หรืออยู่คนละกลุ่ม' USING ERRCODE = '22023';
  END IF;

  EXECUTE format('SELECT sort_order FROM public.%I WHERE id = $1', p_table) INTO v_oa USING p_a;
  EXECUTE format('SELECT sort_order FROM public.%I WHERE id = $1', p_table) INTO v_ob USING p_b;
  -- เลขซ้ำ / ว่าง → เรียงเลขใหม่ทั้งกลุ่มก่อน
  IF v_oa IS NULL OR v_ob IS NULL OR v_oa = v_ob THEN
    EXECUTE format('WITH o AS (SELECT id, row_number() OVER (ORDER BY sort_order NULLS LAST, created_at)::integer AS n
                                 FROM public.%I WHERE %s)
                    UPDATE public.%I x SET sort_order = o.n FROM o WHERE x.id = o.id AND x.sort_order IS DISTINCT FROM o.n',
                   p_table, v_where, p_table);
    EXECUTE format('SELECT sort_order FROM public.%I WHERE id = $1', p_table) INTO v_oa USING p_a;
    EXECUTE format('SELECT sort_order FROM public.%I WHERE id = $1', p_table) INTO v_ob USING p_b;
  END IF;
  EXECUTE format('UPDATE public.%I SET sort_order = $1 WHERE id = $2', p_table) USING v_ob, p_a;
  EXECUTE format('UPDATE public.%I SET sort_order = $1 WHERE id = $2', p_table) USING v_oa, p_b;
END $$;
REVOKE ALL ON FUNCTION public.swap_sort_order(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.swap_sort_order(text, uuid, uuid) TO authenticated;

-- 4) ลำดับรายการผลตรวจของสมาชิก (สลับ metric กับ metric ข้าง ๆ) ----------------------
DROP FUNCTION IF EXISTS public.move_health_metric(uuid, text, text);
CREATE FUNCTION public.move_health_metric(p_person_id uuid, p_metric text, p_neighbor text)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_a integer; v_b integer;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF p_metric IS NULL OR p_neighbor IS NULL OR p_metric = p_neighbor THEN RETURN; END IF;
  -- ให้ทุก metric ของคนนี้มีเลขเดียวต่อ metric และไม่ซ้ำกัน (1..n)
  WITH m AS (
    SELECT r.metric, min(r.sort_order) AS so, min(r.created_at) AS first_at
      FROM public.health_results r JOIN public.health_checkups c ON c.id = r.checkup_id
     WHERE c.person_id = p_person_id AND r.deleted_at IS NULL AND c.deleted_at IS NULL
     GROUP BY r.metric),
  n AS (SELECT metric, row_number() OVER (ORDER BY so NULLS LAST, first_at, metric)::integer AS n FROM m)
  UPDATE public.health_results r SET sort_order = n.n
    FROM public.health_checkups c, n
   WHERE c.id = r.checkup_id AND c.person_id = p_person_id AND n.metric = r.metric AND r.sort_order IS DISTINCT FROM n.n;

  SELECT min(r.sort_order) INTO v_a FROM public.health_results r JOIN public.health_checkups c ON c.id = r.checkup_id
   WHERE c.person_id = p_person_id AND r.metric = p_metric AND r.deleted_at IS NULL;
  SELECT min(r.sort_order) INTO v_b FROM public.health_results r JOIN public.health_checkups c ON c.id = r.checkup_id
   WHERE c.person_id = p_person_id AND r.metric = p_neighbor AND r.deleted_at IS NULL;
  IF v_a IS NULL OR v_b IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบรายการผลตรวจ' USING ERRCODE = '22023'; END IF;
  UPDATE public.health_results r SET sort_order = CASE r.metric WHEN p_metric THEN v_b ELSE v_a END
    FROM public.health_checkups c
   WHERE c.id = r.checkup_id AND c.person_id = p_person_id AND r.metric IN (p_metric, p_neighbor);
END $$;
REVOKE ALL ON FUNCTION public.move_health_metric(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_health_metric(uuid, text, text) TO authenticated;
