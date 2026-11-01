-- =====================================================================
-- ยอดสิ้นเดือนอัตโนมัติ ทำตั้งแต่ช่วงตั้งค่า (SETUP) ด้วย (ตกลง 1 พ.ย. 2026)
--   เดิม: คำนวณเฉพาะหลัง Confirm Go-live → ช่วง SETUP เดือนใหม่ไม่มี "ยอดสิ้นเดือนก่อน" ให้เทียบ
--         (Dashboard ขึ้น "ยังไม่มียอดงวดก่อนให้เทียบ" · กราฟไม่มีจุดสิ้นเดือน)
--   ใหม่: คำนวณทุกเดือนที่จบแล้วตั้งแต่เดือน Go-live ไม่ว่าสถานะ SETUP / LIVE
--         (ยังคำนวณใหม่ทุกเช้า · เดือนที่ปิดแล้ว (FINAL) ไม่แตะ · เดือนก่อน Go-live ถูกลบ)
--   ท้ายไฟล์: คำนวณทันที 1 ครั้ง ไม่ต้องรอถึงเช้า · รันซ้ำได้
-- =====================================================================
CREATE OR REPLACE FUNCTION private.refresh_month_auto(p_family uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.families; m date; d date; n int := 0; t record;
BEGIN
  SELECT * INTO f FROM public.families WHERE id = p_family AND deleted_at IS NULL;
  IF f.id IS NULL OR f.go_live_date IS NULL THEN
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

-- คำนวณทันที (ทุกครอบครัว)
SELECT private.refresh_month_auto(id) FROM public.families WHERE deleted_at IS NULL;
