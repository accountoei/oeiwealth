-- =====================================================================
-- ประกัน: ลงมูลค่าเวนคืนตามตารางในสัญญาให้เองทุกวัน (ตกลง 2 พ.ย. 2026)
--   เดิมระบบลงให้เฉพาะตอนจ่ายเบี้ย / ตั้งตาราง / กดปุ่ม → กรมธรรม์ที่จ่ายเบี้ยครบแล้ว (ไม่มีงวดใหม่) ไม่เคยถูกอัปเดตเมื่อถึงวันครบปี
--   server_sync_insurance_cash_values() — งานประจำวัน (GitHub Actions month-auto.yml · Secret Key) เงื่อนไขเดียวกับ sync_insurance_cash_value:
--     · กรมธรรม์ที่มีผล + มีมูลค่าเวนคืนแล้ว · ปีที่ถึงวันแล้ว · เบี้ยทุกงวดก่อนวันนั้นจ่ายครบ
--     · ไม่ทับยอดที่มีอยู่ (เฉพาะปีที่ใหม่กว่ายอดล่าสุด) · ไม่ก่อน Go-live · ข้ามเดือนที่ปิดงวดแล้ว
--     · ยังไม่มีมูลค่าเวนคืน → ไม่สร้างให้ (สร้างได้ที่หน้ากรมธรรม์ / แท็บ "อัปเดตมูลค่าเวนคืน" โดย ADMIN / EDITOR)
--   บันทึกผลใน system_job_runs (INSURANCE_CV) ในธุรกรรมเดียวกัน → ข้อมูลที่แคชไว้ (Dashboard) อัปเดตตาม
--   ★ ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

ALTER TABLE public.system_job_runs DROP CONSTRAINT IF EXISTS system_job_runs_job_type_check;
ALTER TABLE public.system_job_runs ADD CONSTRAINT system_job_runs_job_type_check CHECK (job_type IN
  ('FX_FETCH','FX_BACKFILL','BACKUP','RESTORE_TEST','MONTHLY_PDF','PRICE_FETCH','MONTH_AUTO','INSURANCE_CV'));

CREATE OR REPLACE FUNCTION public.server_sync_insurance_cash_values()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_job bigint; v_added integer := 0; v_policies integer := 0; pol record; r record;
  v_go_live date; v_lock date; v_last date; v_n integer;
BEGIN
  INSERT INTO public.system_job_runs(job_type, result) VALUES ('INSURANCE_CV', 'RUNNING') RETURNING id INTO v_job;
  FOR pol IN
    SELECT i.id, i.family_id, i.cash_value_asset_id
      FROM public.insurance_policies i
      JOIN public.assets a ON a.id = i.cash_value_asset_id AND a.deleted_at IS NULL AND a.status = 'ACTIVE'
     WHERE i.deleted_at IS NULL AND i.status = 'ACTIVE'
       AND EXISTS (SELECT 1 FROM public.insurance_cash_value_table c
                    WHERE c.policy_id = i.id AND c.deleted_at IS NULL AND c.value_date <= current_date)
  LOOP
    SELECT go_live_date INTO v_go_live FROM public.families WHERE id = pol.family_id;
    v_lock := private.locked_through(pol.family_id);
    SELECT max(v.valuation_date) INTO v_last FROM public.asset_valuations v
     WHERE v.asset_id = pol.cash_value_asset_id AND v.deleted_at IS NULL;
    v_n := 0;
    FOR r IN
      SELECT c.policy_year, c.value_date, c.value FROM public.insurance_cash_value_table c
       WHERE c.policy_id = pol.id AND c.deleted_at IS NULL AND c.value_date <= current_date
         AND c.value_date >= coalesce(v_go_live, '-infinity'::date) AND (v_lock IS NULL OR c.value_date > v_lock)
         AND (v_last IS NULL OR c.value_date > v_last)
         AND NOT EXISTS (SELECT 1 FROM public.v_insurance_schedule_status s
                          WHERE s.policy_id = pol.id AND s.kind = 'PREMIUM' AND s.due_date < c.value_date AND s.status <> 'PAID')
       ORDER BY c.value_date
    LOOP
      INSERT INTO public.asset_valuations(asset_id, valuation_date, value, valuation_method, source, notes)
      VALUES (pol.cash_value_asset_id, r.value_date, r.value, 'STATEMENT', 'STATEMENT',
              'ตามตารางมูลค่าเวนคืนในสัญญา · สิ้นปีกรมธรรม์ที่ ' || r.policy_year);
      v_n := v_n + 1;
    END LOOP;
    IF v_n > 0 THEN v_added := v_added + v_n; v_policies := v_policies + 1; END IF;
  END LOOP;
  UPDATE public.system_job_runs SET result = 'SUCCESS', finished_at = now(),
         details = jsonb_build_object('added', v_added, 'policies', v_policies) WHERE id = v_job;
  RETURN v_added;
END $$;
REVOKE ALL ON FUNCTION public.server_sync_insurance_cash_values() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_sync_insurance_cash_values() TO service_role;
