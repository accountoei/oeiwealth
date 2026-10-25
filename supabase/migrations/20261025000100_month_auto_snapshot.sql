-- =====================================================================
-- ยอดสิ้นเดือนอัตโนมัติ (ไม่ล็อก) + ปิดเดือน: ไม่นับเงินกู้ที่ยอดแรกลงวันที่หลังสิ้นเดือน (ตกลง 25 ต.ค. 2026)
--   1) net_worth_month_auto: ยอด Net Worth ณ สิ้นเดือน ของทุกเดือนที่จบแล้วแต่ยังไม่ปิดเดือน (FINAL)
--        คำนวณใหม่ทุกคืน (GitHub Actions: month-auto.yml → server_refresh_month_auto) · ไม่ล็อกรายการ
--        บันทึกรายการย้อนหลัง → ยอดของเดือนนั้นอัปเดตในคืนถัดไป · เดือนที่ปิดแล้ว (FINAL) ใช้ Snapshot เหมือนเดิม
--   2) private.month_points(): จุดรายเดือน = Snapshot FINAL + ยอดอัตโนมัติของเดือนที่ยังไม่ปิด
--        ใช้ในกราฟ Net Worth (ครอบครัว / รายคน) และเป็น "ยอดงวดก่อน" ของกล่อง "ความมั่งคั่งเปลี่ยนเพราะอะไร"
--        (Dashboard · Dashboard รายคน · หน้า Month Closing)
--   3) month_closing_issues: เงินกู้ที่ยอดคงค้างแรกลงวันที่หลังสิ้นเดือน = เดือนนั้นยังไม่มีเงินกู้ → ไม่ BLOCKED / ไม่เตือน
--        (BLOCKED เฉพาะเงินกู้ที่ไม่มียอดคงค้างเลยสักรายการ)
--   ไม่แก้ / ไม่ลบข้อมูลเดิม (ตารางใหม่ + ฟังก์ชัน) · รันซ้ำได้
-- =====================================================================

-- 1) ตารางยอดอัตโนมัติ ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.net_worth_month_auto (
  family_id          uuid NOT NULL REFERENCES public.families(id),
  snapshot_month     public.d_month NOT NULL,
  snapshot_date      date NOT NULL,
  total_assets       numeric NOT NULL DEFAULT 0,
  total_liabilities  numeric NOT NULL DEFAULT 0,
  net_worth          numeric NOT NULL DEFAULT 0,
  by_person          jsonb NOT NULL DEFAULT '{}'::jsonb,     -- { "<person_id>": net_worth } (ไม่รวม Unallocated)
  missing_fx_items   integer NOT NULL DEFAULT 0,               -- รายการที่แปลงเป็น THB ไม่ได้ (ไม่ถูกนับ)
  computed_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, snapshot_month),
  CHECK (snapshot_date = (snapshot_month + interval '1 month' - interval '1 day')::date)
);
ALTER TABLE public.net_worth_month_auto ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.net_worth_month_auto FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.net_worth_month_auto TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.net_worth_month_auto TO service_role;
DROP POLICY IF EXISTS p_select ON public.net_worth_month_auto;
CREATE POLICY p_select ON public.net_worth_month_auto FOR SELECT TO authenticated
  USING (private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER'));
-- เขียนได้เฉพาะ private.refresh_month_auto() (ไม่มี Policy เขียนสำหรับผู้ใช้)

ALTER TABLE public.system_job_runs DROP CONSTRAINT IF EXISTS system_job_runs_job_type_check;
ALTER TABLE public.system_job_runs ADD CONSTRAINT system_job_runs_job_type_check CHECK (job_type IN
  ('FX_FETCH','FX_BACKFILL','BACKUP','RESTORE_TEST','MONTHLY_PDF','PRICE_FETCH','MONTH_AUTO'));

-- คำนวณใหม่ทุกเดือนที่จบแล้ว (ตั้งแต่เดือน Go-live) และยังไม่ FINAL · ลบยอดของเดือนที่ FINAL / ก่อน Go-live
CREATE OR REPLACE FUNCTION private.refresh_month_auto(p_family uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.families; m date; d date; n int := 0; t record;
BEGIN
  SELECT * INTO f FROM public.families WHERE id = p_family AND deleted_at IS NULL;
  IF f.id IS NULL OR f.system_status <> 'LIVE' OR f.go_live_date IS NULL THEN
    DELETE FROM public.net_worth_month_auto WHERE family_id = p_family;
    RETURN 0;
  END IF;
  DELETE FROM public.net_worth_month_auto a
   WHERE a.family_id = p_family
     AND (a.snapshot_month < date_trunc('month', f.go_live_date)::date
          OR private.month_end(a.snapshot_month) >= current_date
          OR EXISTS (SELECT 1 FROM public.net_worth_snapshots s WHERE s.family_id = p_family
                      AND s.snapshot_month = a.snapshot_month AND s.status = 'FINAL' AND s.deleted_at IS NULL));

  m := date_trunc('month', f.go_live_date)::date;
  LOOP
    d := private.month_end(m);
    EXIT WHEN d >= current_date;
    IF NOT EXISTS (SELECT 1 FROM public.net_worth_snapshots s WHERE s.family_id = p_family
                    AND s.snapshot_month = m AND s.status = 'FINAL' AND s.deleted_at IS NULL) THEN
      SELECT coalesce(sum(x.base_value) FILTER (WHERE x.item_type = 'ASSET'), 0) AS a,
             coalesce(sum(x.base_value) FILTER (WHERE x.item_type = 'LIABILITY'), 0) AS l,
             count(*) FILTER (WHERE x.base_value IS NULL) AS no_fx
        INTO t FROM private.net_worth_items(p_family, d, true) x;
      INSERT INTO public.net_worth_month_auto AS a (family_id, snapshot_month, snapshot_date, total_assets,
                  total_liabilities, net_worth, by_person, missing_fx_items, computed_at)
      SELECT p_family, m, d, t.a, t.l, t.a - t.l,
             coalesce((SELECT jsonb_object_agg(y.person_id, y.nw) FROM (
                         SELECT x.person_id, sum(CASE WHEN x.item_type = 'ASSET' THEN x.base_value ELSE -x.base_value END) AS nw
                           FROM private.net_worth_items(p_family, d, true) x
                          WHERE x.person_id IS NOT NULL AND x.base_value IS NOT NULL GROUP BY x.person_id) y), '{}'::jsonb),
             t.no_fx, now()
      ON CONFLICT (family_id, snapshot_month) DO UPDATE SET
        total_assets = EXCLUDED.total_assets, total_liabilities = EXCLUDED.total_liabilities,
        net_worth = EXCLUDED.net_worth, by_person = EXCLUDED.by_person,
        missing_fx_items = EXCLUDED.missing_fx_items, computed_at = EXCLUDED.computed_at;
      n := n + 1;
    END IF;
    m := (m + interval '1 month')::date;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.refresh_month_auto(uuid) FROM PUBLIC, anon, authenticated;

-- งานประจำคืน (GitHub Actions ใช้ Secret Key) — service_role เท่านั้น
CREATE OR REPLACE FUNCTION public.server_refresh_month_auto()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job bigint; n int := 0; r record;
BEGIN
  INSERT INTO public.system_job_runs(job_type, result) VALUES ('MONTH_AUTO', 'RUNNING') RETURNING id INTO v_job;
  FOR r IN SELECT id FROM public.families WHERE deleted_at IS NULL LOOP
    n := n + private.refresh_month_auto(r.id);
  END LOOP;
  UPDATE public.system_job_runs SET result = 'SUCCESS', finished_at = now(),
         details = jsonb_build_object('months', n) WHERE id = v_job;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.server_refresh_month_auto() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_refresh_month_auto() TO service_role;

-- 2) จุดรายเดือน: FINAL (Snapshot) + AUTO (เดือนที่ยังไม่ปิด) ----------------------------------------
--    by_person: { "<person_id>": net_worth }
CREATE OR REPLACE FUNCTION private.month_points(p_family uuid)
RETURNS TABLE (snapshot_month date, snapshot_date date, status text, version integer,
               total_assets numeric, total_liabilities numeric, net_worth numeric, by_person jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.snapshot_month::date, s.snapshot_date, s.status, s.version, s.total_assets::numeric,
         s.total_liabilities::numeric, s.net_worth::numeric,
         coalesce((SELECT jsonb_object_agg(y.person_id, y.nw) FROM (
                     SELECT i.person_id, sum(CASE WHEN i.item_type = 'ASSET' THEN i.base_value ELSE -i.base_value END) AS nw
                       FROM public.net_worth_snapshot_items i WHERE i.snapshot_id = s.id AND i.person_id IS NOT NULL
                      GROUP BY i.person_id) y), '{}'::jsonb)
    FROM public.net_worth_snapshots s
   WHERE s.family_id = p_family AND s.status = 'FINAL' AND s.deleted_at IS NULL
  UNION ALL
  SELECT a.snapshot_month::date, a.snapshot_date, 'AUTO', NULL::integer, a.total_assets, a.total_liabilities,
         a.net_worth, a.by_person
    FROM public.net_worth_month_auto a
   WHERE a.family_id = p_family
     AND NOT EXISTS (SELECT 1 FROM public.net_worth_snapshots s WHERE s.family_id = p_family
                      AND s.snapshot_month = a.snapshot_month AND s.status = 'FINAL' AND s.deleted_at IS NULL)
$$;
REVOKE ALL ON FUNCTION private.month_points(uuid) FROM PUBLIC, anon, authenticated;

-- กราฟ Net Worth (ครอบครัว): ยอดตั้งต้น + จุดรายเดือน (FINAL = ปิดแล้ว · AUTO = ยอดอัตโนมัติ)
CREATE OR REPLACE FUNCTION public.net_worth_history()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_family uuid := private.default_family_id(); f public.families; t record;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  SELECT * INTO f FROM public.families WHERE id = v_family;
  SELECT coalesce(sum(base_value) FILTER (WHERE item_type = 'ASSET'), 0) AS a,
         coalesce(sum(base_value) FILTER (WHERE item_type = 'LIABILITY'), 0) AS l
    INTO t FROM private.net_worth_items(v_family, f.go_live_date - 1, true);
  RETURN jsonb_build_object(
    'opening', jsonb_build_object('date', f.go_live_date - 1, 'total_assets', t.a, 'total_liabilities', t.l, 'net_worth', t.a - t.l),
    'snapshots', coalesce((SELECT jsonb_agg(jsonb_build_object('month', p.snapshot_month, 'date', p.snapshot_date,
                     'status', p.status, 'version', p.version, 'total_assets', p.total_assets,
                     'total_liabilities', p.total_liabilities, 'net_worth', p.net_worth) ORDER BY p.snapshot_month)
                   FROM private.month_points(v_family) p), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.net_worth_history() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.net_worth_history() TO authenticated;

-- Dashboard: ฐานเทียบ = ปิดเดือนก่อน → ยอดสิ้นเดือนก่อน (อัตโนมัติ) → เดือนล่าสุดที่ปิดแล้ว → ยอดตั้งต้น
DO $$
DECLARE d text;
  old_txt text := '  IF ps.id IS NOT NULL THEN
    base := jsonb_build_object(''label'', CASE WHEN ps.snapshot_month = pm THEN ''ปิดเดือนก่อน''';
  new_txt text := '  IF ps.snapshot_month IS DISTINCT FROM pm AND EXISTS (SELECT 1 FROM private.month_points(v_family) x
                                                    WHERE x.snapshot_month = pm AND x.status = ''AUTO'') THEN
    SELECT ''สิ้นเดือนก่อน'' AS label, x.snapshot_date, x.total_assets, x.total_liabilities, x.net_worth INTO t
      FROM private.month_points(v_family) x WHERE x.snapshot_month = pm AND x.status = ''AUTO'';
    base := jsonb_build_object(''label'', t.label, ''date'', t.snapshot_date, ''total_assets'', t.total_assets,
                               ''total_liabilities'', t.total_liabilities, ''net_worth'', t.net_worth);
  ELSIF ps.id IS NOT NULL THEN
    base := jsonb_build_object(''label'', CASE WHEN ps.snapshot_month = pm THEN ''ปิดเดือนก่อน''';
BEGIN
  d := replace(pg_get_functiondef('public.dashboard_month(date)'::regprocedure), E'\r', '');
  IF position('private.month_points' IN d) > 0 THEN RETURN; END IF;                -- รันซ้ำ
  old_txt := replace(old_txt, E'\r', ''); new_txt := replace(new_txt, E'\r', '');   -- วาง SQL จาก Windows (CRLF)
  IF (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 THEN
    RAISE EXCEPTION 'dashboard_month: ไม่พบจุดที่ต้องแก้ (ฐานเทียบ)';
  END IF;
  EXECUTE replace(d, old_txt, new_txt);
END $$;

-- Month Closing: ยอดงวดก่อน = ปิดเดือนก่อน → ยอดสิ้นเดือนก่อน (อัตโนมัติ) → ยอดตั้งต้น (เดือน Go-live)
DO $$
DECLARE d text;
  old_txt text := '  IF v_prev IS NOT NULL THEN
    v_prev_label := ''ยอดปิดเดือนก่อน'';
  ELSIF m0 = date_trunc(''month'', f.go_live_date)::date THEN';
  new_txt text := '  IF v_prev IS NOT NULL THEN
    v_prev_label := ''ยอดปิดเดือนก่อน'';
  ELSIF EXISTS (SELECT 1 FROM private.month_points(v_family) x
                 WHERE x.snapshot_month = (m0 - interval ''1 month'')::date AND x.status = ''AUTO'') THEN
    SELECT x.net_worth, x.snapshot_date INTO v_prev, v_prev_date FROM private.month_points(v_family) x
     WHERE x.snapshot_month = (m0 - interval ''1 month'')::date AND x.status = ''AUTO'';
    v_prev_label := ''ยอดสิ้นเดือนก่อน (อัตโนมัติ)'';
  ELSIF m0 = date_trunc(''month'', f.go_live_date)::date THEN';
BEGIN
  d := replace(pg_get_functiondef('public.month_net_worth_preview(date)'::regprocedure), E'\r', '');
  IF position('private.month_points' IN d) > 0 THEN RETURN; END IF;                -- รันซ้ำ
  old_txt := replace(old_txt, E'\r', ''); new_txt := replace(new_txt, E'\r', '');
  IF (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 THEN
    RAISE EXCEPTION 'month_net_worth_preview: ไม่พบจุดที่ต้องแก้ (ยอดงวดก่อน)';
  END IF;
  EXECUTE replace(d, old_txt, new_txt);
END $$;

-- Dashboard รายคน: ยอดงวดก่อน + กราฟ ใช้จุดรายเดือนเดียวกัน
DO $$
DECLARE d text; i int; j int;
  old_prev text := '  IF v_prev_date IS NOT NULL THEN
    v_prev_label := ''ยอดปิดเดือนก่อน'';
  ELSIF m0 = date_trunc(''month'', f.go_live_date)::date THEN';
  new_prev text := '  IF v_prev_date IS NOT NULL THEN
    v_prev_label := ''ยอดปิดเดือนก่อน'';
  ELSIF EXISTS (SELECT 1 FROM private.month_points(v_family) x
                 WHERE x.snapshot_month = (m0 - interval ''1 month'')::date AND x.status = ''AUTO'') THEN
    SELECT coalesce((x.by_person ->> p_person::text)::numeric, 0), x.snapshot_date INTO v_prev, v_prev_date
      FROM private.month_points(v_family) x
     WHERE x.snapshot_month = (m0 - interval ''1 month'')::date AND x.status = ''AUTO'';
    v_prev_label := ''ยอดสิ้นเดือนก่อน (อัตโนมัติ)'';
  ELSIF m0 = date_trunc(''month'', f.go_live_date)::date THEN';
  s_mark text := '''snapshots'', coalesce((SELECT jsonb_agg(jsonb_build_object(''month'', s.snapshot_month';
  e_mark text := 's.finalized_at IS NOT NULL), ''[]''::jsonb),';
  new_snap text := '''snapshots'', coalesce((SELECT jsonb_agg(jsonb_build_object(''month'', x.snapshot_month, ''date'', x.snapshot_date,
                     ''status'', x.status, ''net_worth'', coalesce((x.by_person ->> p_person::text)::numeric, 0))
                     ORDER BY x.snapshot_month)
                   FROM private.month_points(v_family) x), ''[]''::jsonb),';
BEGIN
  d := replace(pg_get_functiondef('public.person_dashboard(date, uuid)'::regprocedure), E'\r', '');
  IF position('private.month_points' IN d) > 0 THEN RETURN; END IF;                -- รันซ้ำ
  old_prev := replace(old_prev, E'\r', ''); new_prev := replace(new_prev, E'\r', '');
  s_mark := replace(s_mark, E'\r', ''); e_mark := replace(e_mark, E'\r', ''); new_snap := replace(new_snap, E'\r', '');
  IF (length(d) - length(replace(d, old_prev, ''))) / length(old_prev) <> 1 THEN
    RAISE EXCEPTION 'person_dashboard: ไม่พบจุดที่ต้องแก้ (ยอดงวดก่อน)';
  END IF;
  d := replace(d, old_prev, new_prev);
  i := position(s_mark IN d); j := position(e_mark IN d);
  IF i = 0 OR j = 0 OR j < i THEN RAISE EXCEPTION 'person_dashboard: ไม่พบจุดที่ต้องแก้ (กราฟ)'; END IF;
  EXECUTE substr(d, 1, i - 1) || new_snap || substr(d, j + length(e_mark));
END $$;

-- 3) ปิดเดือน: เงินกู้ที่ยอดแรกลงวันที่หลังสิ้นเดือน → ข้าม ------------------------------------------
DO $$
DECLARE d text;
  old_txt text := '   WHERE l.family_id = p_family AND l.deleted_at IS NULL AND l.status = ''ACTIVE''
     AND (v.id IS NULL OR v.valuation_date < m0);';
  new_txt text := '   WHERE l.family_id = p_family AND l.deleted_at IS NULL AND l.status = ''ACTIVE''
     AND (v.valuation_date < m0
          OR (v.id IS NULL AND NOT EXISTS (SELECT 1 FROM public.liability_valuations y      -- ยอดแรกหลังสิ้นเดือน = ยังไม่มีเงินกู้
                                            WHERE y.liability_id = l.id AND y.deleted_at IS NULL)));';
BEGIN
  d := replace(pg_get_functiondef('private.month_closing_issues(uuid, date)'::regprocedure), E'\r', '');
  old_txt := replace(old_txt, E'\r', ''); new_txt := replace(new_txt, E'\r', '');
  IF position(new_txt IN d) > 0 THEN RETURN; END IF;                               -- รันซ้ำ
  IF (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 THEN
    RAISE EXCEPTION 'month_closing_issues: ไม่พบจุดที่ต้องแก้ (เงินกู้)';
  END IF;
  EXECUTE replace(d, old_txt, new_txt);
END $$;

-- คำนวณยอดอัตโนมัติครั้งแรกทันที (ไม่ต้องรอคืนนี้)
SELECT private.refresh_month_auto(id) FROM public.families WHERE deleted_at IS NULL;
