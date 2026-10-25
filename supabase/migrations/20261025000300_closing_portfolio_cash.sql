-- =====================================================================
-- Checklist ปิดเดือน · Investments: บัญชีเงินฝากในพอร์ตที่ยังไม่ได้อัปเดตยอดสิ้นเดือน (เหมือนบัญชีธนาคาร)
--   REVIEW (ไม่บล็อก) · code CASH_NOT_UPDATED · เฉพาะบัญชีที่มียอด ณ สิ้นเดือน ≠ 0 และไม่มียอด / Statement ลงวันสิ้นเดือน
--   ใช้ยอดตามระบบ (ยอดล่าสุด + รายการหลังจากนั้น) · หน้า Month Closing รวมเป็นบรรทัดเดียว → Investments แท็บอัปเดตยอด
-- รันซ้ำได้
-- =====================================================================
DO $mig$
DECLARE v_def text; v_anchor text; v_new text;
BEGIN
  v_def := replace(pg_get_functiondef('private.month_closing_issues(uuid,date)'::regprocedure), E'\r', '');
  IF position('CASH_NOT_UPDATED' IN v_def) > 0 THEN RETURN; END IF;
  v_anchor := $a$  RETURN QUERY
  SELECT 'INVESTMENTS', 'REVIEW', 'IN_TRANSIT',$a$;
  v_anchor := replace(v_anchor, E'\r', '');   -- วางใน SQL Editor แล้วบรรทัดมี \r
  IF position(v_anchor IN v_def) = 0 THEN RAISE EXCEPTION 'month_closing_issues: ไม่พบจุดที่จะแก้'; END IF;
  v_new := $n$  -- บัญชีเงินฝากในพอร์ต: ยังไม่ได้อัปเดตยอดสิ้นเดือน (มียอด) → ใช้ยอดตามระบบ
  RETURN QUERY
  SELECT 'INVESTMENTS', 'REVIEW', 'CASH_NOT_UPDATED',
         pa.name || ' · ' || h.name || ': ยังไม่ได้อัปเดตยอดสิ้นเดือน · ใช้ยอดตามระบบ'
           || coalesce(' (ยอดล่าสุด ' || to_char(lv.last_date, 'DD/MM/YYYY') || ' + รายการหลังจากนั้น)', ''),
         'HOLDING', h.id
    FROM public.investment_holdings h
    JOIN public.investment_portfolios p ON p.id = h.portfolio_id AND p.deleted_at IS NULL
    JOIN public.assets pa ON pa.id = p.asset_id AND pa.deleted_at IS NULL AND pa.family_id = p_family AND pa.status = 'ACTIVE'
    CROSS JOIN LATERAL (SELECT max(v.valuation_date) AS last_date FROM public.investment_valuations v
                         WHERE v.holding_id = h.id AND v.deleted_at IS NULL AND v.valuation_date <= d) lv
    CROSS JOIN LATERAL private.holding_value_at(h.id, d) hv
   WHERE h.deleted_at IS NULL AND h.status = 'ACTIVE' AND h.holding_type = 'CASH'
     AND (lv.last_date IS NULL OR lv.last_date < d)
     AND round(coalesce(hv.value, 0), 2) <> 0;
$n$;
  v_new := replace(v_new, E'\r', '');
  EXECUTE replace(v_def, v_anchor, v_new || v_anchor);
END $mig$;
