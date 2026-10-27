-- =====================================================================
-- Dashboard รายคน: ยอดฐานเทียบของ 3 การ์ด (สินทรัพย์รวม · หนี้สินรวม · Net Worth) ของคนที่เลือก (ตกลง 27 ต.ค. 2026)
--   เดิม dashboard_month คืนยอดฐาน (base) เป็นยอดรวมครอบครัวอย่างเดียว → เลือกรายคนแล้วการ์ดไม่มีบรรทัด "เทียบ…"
--   ฐานเลือกแบบเดียวกับโหมดครอบครัว (dashboard_month):
--     ปิดเดือนก่อน (FINAL) → สิ้นเดือนก่อน (อัตโนมัติ · AUTO) → ปิดเดือนล่าสุดก่อนหน้า (FINAL) → ยอดตั้งต้น (เฉพาะเดือน Go-live)
--   FINAL อ่านจาก Snapshot (เร็ว) · AUTO / ยอดตั้งต้น คำนวณจาก private.net_worth_items ณ วันนั้น (เรียกเฉพาะตอนเลือกรายคน)
--   ฟังก์ชันใหม่อย่างเดียว (อ่านอย่างเดียว) · ไม่แก้ตาราง / ข้อมูลเดิม · รันซ้ำได้
-- =====================================================================
CREATE OR REPLACE FUNCTION public.dashboard_person_base(p_month date, p_person uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_family uuid := private.default_family_id(); f public.families;
  m0 date := date_trunc('month', p_month)::date; pm date; ps public.net_worth_snapshots;
  v_label text; v_date date; v_src text; t record;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  IF p_person IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO f FROM public.families WHERE id = v_family;
  pm := (m0 - interval '1 month')::date;

  SELECT * INTO ps FROM public.net_worth_snapshots
   WHERE family_id = v_family AND snapshot_month <= pm AND status = 'FINAL' AND deleted_at IS NULL
   ORDER BY snapshot_month DESC LIMIT 1;
  IF ps.snapshot_month IS DISTINCT FROM pm AND EXISTS (SELECT 1 FROM private.month_points(v_family) x
                                                        WHERE x.snapshot_month = pm AND x.status = 'AUTO') THEN
    v_label := 'สิ้นเดือนก่อน'; v_src := 'AUTO';
    SELECT x.snapshot_date INTO v_date FROM private.month_points(v_family) x WHERE x.snapshot_month = pm AND x.status = 'AUTO';
  ELSIF ps.id IS NOT NULL THEN
    v_label := CASE WHEN ps.snapshot_month = pm THEN 'ปิดเดือนก่อน' ELSE 'ปิดเดือน ' || to_char(ps.snapshot_month, 'MM/YYYY') END;
    v_src := 'FINAL'; v_date := ps.snapshot_date;
  ELSIF m0 <= date_trunc('month', f.go_live_date)::date THEN
    v_label := 'ยอดตั้งต้น'; v_src := 'OPENING'; v_date := f.go_live_date - 1;
  ELSE
    RETURN NULL;
  END IF;

  IF v_src = 'FINAL' THEN
    SELECT coalesce(sum(i.base_value) FILTER (WHERE i.item_type = 'ASSET'), 0) AS a,
           coalesce(sum(i.base_value) FILTER (WHERE i.item_type = 'LIABILITY'), 0) AS l
      INTO t FROM public.net_worth_snapshot_items i WHERE i.snapshot_id = ps.id AND i.person_id = p_person;
  ELSE
    SELECT coalesce(sum(x.base_value) FILTER (WHERE x.item_type = 'ASSET'), 0) AS a,
           coalesce(sum(x.base_value) FILTER (WHERE x.item_type = 'LIABILITY'), 0) AS l
      INTO t FROM private.net_worth_items(v_family, v_date, true) x WHERE x.person_id = p_person;
  END IF;
  RETURN jsonb_build_object('label', v_label, 'date', v_date, 'source', v_src,
                            'total_assets', t.a, 'total_liabilities', t.l, 'net_worth', t.a - t.l);
END $$;
REVOKE ALL ON FUNCTION public.dashboard_person_base(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_person_base(date, uuid) TO authenticated;
