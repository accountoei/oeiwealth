-- =====================================================================
-- กล่อง "ความมั่งคั่งเปลี่ยนเพราะอะไร": แยกบรรทัด "± กำไร / ขาดทุนเงินลงทุน" ออกจาก "มูลค่าเปลี่ยน / อื่น ๆ" (ตกลง 27 ต.ค. 2026)
--   กำไร / ขาดทุนเงินลงทุนของงวด (ต่อพอร์ต) = มูลค่าพอร์ตสิ้นงวด − มูลค่าพอร์ตต้นงวด − เงินเข้า / ออกพอร์ตที่ไม่ใช่ผลการลงทุน
--     มูลค่าพอร์ต   = รายการกลุ่ม INVESTMENT ของ Net Worth (หลักทรัพย์ + เงินฝากในพอร์ต + เงินระหว่างทาง + รอ Settle)
--                    ต้นงวด / สิ้นงวดใช้ฐานเดียวกับกล่อง: Snapshot FINAL → ยอดสิ้นเดือนอัตโนมัติ (คำนวณสด ณ วันนั้น) → ยอดตั้งต้น
--     เงินเข้า / ออก (private.portfolio_flows): โอนธนาคาร ↔ พอร์ต (ยอดฝั่งพอร์ต) · ซื้อ / ขายที่ตัดจาก / เข้าบัญชีธนาคาร
--                    · ฝาก / ถอนจากภายนอก · จ่ายค่าใช้จ่าย / บัตรจากพอร์ต · ปันผล / ดอกเบี้ย / Coupon ที่เข้าพอร์ต
--                    (นับอยู่ในบรรทัด "รายได้ลงทุน" แล้ว จึงไม่นับซ้ำ)
--     → รวม: ราคาเปลี่ยน · กำไร / ขาดทุนจากการขายเทียบราคาล่าสุด · ค่าธรรมเนียม / ภาษีในพอร์ต · FX ของพอร์ต · ส่วนต่างยอดเงินฝากตาม Statement
--   ในนั้นจาก FX (ประมาณ) = มูลค่าหลักทรัพย์สกุลต่างประเทศ ณ ต้นงวด × (อัตราสิ้นงวด − อัตราต้นงวด)
--   FX ของบัญชีธนาคาร / หนี้ นอกพอร์ต ยังอยู่ใน "มูลค่าเปลี่ยน / อื่น ๆ" (แบบ A)
--   รายคน: มูลค่าพอร์ตตามสัดส่วน ณ วันนั้น · เงินเข้า / ออก × สัดส่วน ณ วันที่รายการ
--   ไม่แก้ / ไม่ลบข้อมูลเดิม (ฟังก์ชันใหม่ 2 ตัว) · รันซ้ำได้
-- =====================================================================

-- 1) เงินเข้า (+) / ออก (−) พอร์ต ที่ไม่ใช่ผลการลงทุน เป็นบาท · วันที่ในช่วง (p_from, p_to] ---------------------
CREATE OR REPLACE FUNCTION private.portfolio_flows(p_family uuid, p_from date, p_to date)
RETURNS TABLE (asset_id uuid, flow_date date, thb numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH pf AS (
    SELECT p.id, p.asset_id FROM public.investment_portfolios p JOIN public.assets a ON a.id = p.asset_id
     WHERE a.family_id = p_family AND p.deleted_at IS NULL AND a.deleted_at IS NULL)
  -- โอนธนาคาร ↔ พอร์ต (รายการโอนที่บันทึกเอง) · ยอดฝั่งพอร์ต (ค่าธรรมเนียมเป็นค่าใช้จ่ายแล้ว · ส่วนต่างอัตรา = มูลค่าเปลี่ยน)
  SELECT pf.asset_id, r.movement_date, r.pf_amt * private.fx_rate(r.pf_ccy, r.movement_date)
    FROM pf CROSS JOIN LATERAL private.pf_transfers(pf.id, p_to) r
   WHERE r.movement_date > p_from
  UNION ALL
  -- ซื้อที่ตัดจากบัญชีธนาคาร (+) / ขาย ไถ่ถอน ครบกำหนด ที่เข้าบัญชีธนาคาร (−) · ตามวันที่เงินออก / เข้าจริง
  SELECT pf.asset_id, m.movement_date,
         CASE WHEN m.to_asset_id = pf.asset_id THEN 1 ELSE -1 END * m.amount * private.fx_rate(m.currency, m.movement_date)
    FROM pf JOIN public.cash_movements m ON (m.to_asset_id = pf.asset_id OR m.from_asset_id = pf.asset_id)
   WHERE m.deleted_at IS NULL AND m.is_derived AND m.source_entity_type = 'INVESTMENT_TX'
     AND m.movement_type IN ('INVESTMENT_OUT','INVESTMENT_IN')
     AND m.movement_date > p_from AND m.movement_date <= p_to
  UNION ALL
  -- ฝาก / ถอน กับภายนอก (ไม่ผ่านบัญชีธนาคารในระบบ) · จ่ายค่าใช้จ่าย / บัตรจากพอร์ต
  SELECT pf.asset_id, t.transaction_date,
         CASE WHEN t.transaction_type = 'DEPOSIT' THEN 1 ELSE -1 END * t.amount * private.fx_rate(t.currency, t.transaction_date)
    FROM pf JOIN public.investment_transactions t ON t.portfolio_id = pf.id
   WHERE t.deleted_at IS NULL AND t.transaction_date > p_from AND t.transaction_date <= p_to
     AND (t.transaction_type = 'PAYMENT'
          OR (t.transaction_type IN ('DEPOSIT','WITHDRAWAL') AND t.cash_movement_id IS NULL))
  UNION ALL
  -- ปันผล / ดอกเบี้ย / Coupon ที่เข้าพอร์ต: ยอดเดียวกับบรรทัด "รายได้ลงทุน" (สุทธิหลังภาษี)
  SELECT pf.asset_id, i.date, i.base_amount * (1 - coalesce(i.tax, 0) / nullif(i.amount, 0))
    FROM pf JOIN public.investment_transactions t ON t.portfolio_id = pf.id
    JOIN public.income_transactions i ON i.source_transaction_id = t.id AND i.deleted_at IS NULL
   WHERE t.deleted_at IS NULL AND t.settle_to_asset_id IS NULL
     AND t.transaction_type IN ('DIVIDEND','INTEREST','COUPON')
     AND i.date > p_from AND i.date <= p_to
$$;
REVOKE ALL ON FUNCTION private.portfolio_flows(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- 2) กำไร / ขาดทุนเงินลงทุนของเดือน (ครอบครัว หรือ รายคน) ---------------------------------------------------
--    คืน NULL เมื่อยังไม่มียอดงวดก่อนให้เทียบ (เหมือนกล่อง)
CREATE OR REPLACE FUNCTION public.month_investment_gain(p_month date, p_person uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_family uuid := private.default_family_id();
  f public.families;
  m0 date := date_trunc('month', p_month)::date;
  pm date := (date_trunc('month', p_month) - interval '1 month')::date;
  d date := private.month_end(p_month);
  v_prev_date date; v_prev_snap uuid; v_cur_date date; v_cur_snap uuid;
  r jsonb;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  SELECT * INTO f FROM public.families WHERE id = v_family;

  -- ต้นงวด: ปิดเดือนก่อน (FINAL) → ยอดสิ้นเดือนก่อนอัตโนมัติ → ยอดตั้งต้น (เดือน Go-live)
  SELECT s.id, s.snapshot_date INTO v_prev_snap, v_prev_date FROM public.net_worth_snapshots s
   WHERE s.family_id = v_family AND s.snapshot_month = pm AND s.status = 'FINAL' AND s.deleted_at IS NULL;
  IF v_prev_snap IS NULL THEN
    SELECT x.snapshot_date INTO v_prev_date FROM private.month_points(v_family) x
     WHERE x.snapshot_month = pm AND x.status = 'AUTO';
    IF v_prev_date IS NULL AND m0 = date_trunc('month', f.go_live_date)::date THEN
      v_prev_date := f.go_live_date - 1;
    END IF;
  END IF;
  IF v_prev_date IS NULL THEN RETURN NULL; END IF;

  -- สิ้นงวด: ปิดเดือนนี้แล้ว (FINAL) → Snapshot · ยังไม่ปิด → คำนวณสด (สิ้นเดือน หรือ วันนี้)
  SELECT s.id, s.snapshot_date INTO v_cur_snap, v_cur_date FROM public.net_worth_snapshots s
   WHERE s.family_id = v_family AND s.snapshot_month = m0 AND s.status = 'FINAL' AND s.deleted_at IS NULL;
  IF v_cur_snap IS NULL THEN v_cur_date := least(d, current_date); END IF;

  WITH
  v0 AS (
    SELECT i.asset_id, sum(i.base_value) AS v FROM public.net_worth_snapshot_items i
     WHERE v_prev_snap IS NOT NULL AND i.snapshot_id = v_prev_snap AND i.item_group = 'INVESTMENT'
       AND (p_person IS NULL OR i.person_id = p_person)
     GROUP BY i.asset_id
    UNION ALL
    SELECT n.asset_id, sum(n.base_value) FROM private.net_worth_items(v_family, v_prev_date, true) n
     WHERE v_prev_snap IS NULL AND n.item_group = 'INVESTMENT' AND (p_person IS NULL OR n.person_id = p_person)
     GROUP BY n.asset_id),
  v1 AS (
    SELECT i.asset_id, sum(i.base_value) AS v FROM public.net_worth_snapshot_items i
     WHERE v_cur_snap IS NOT NULL AND i.snapshot_id = v_cur_snap AND i.item_group = 'INVESTMENT'
       AND (p_person IS NULL OR i.person_id = p_person)
     GROUP BY i.asset_id
    UNION ALL
    SELECT n.asset_id, sum(n.base_value) FROM private.net_worth_items(v_family, v_cur_date, d < current_date) n
     WHERE v_cur_snap IS NULL AND n.item_group = 'INVESTMENT' AND (p_person IS NULL OR n.person_id = p_person)
     GROUP BY n.asset_id),
  fl AS (
    SELECT x.asset_id, sum(x.thb * CASE WHEN p_person IS NULL THEN 1 ELSE coalesce((
             SELECT s.pct FROM private.asset_owner_shares(x.asset_id, x.flow_date) s WHERE s.person_id = p_person), 0) / 100 END) AS v
      FROM private.portfolio_flows(v_family, v_prev_date, v_cur_date) x
     GROUP BY x.asset_id),
  fx AS (
    SELECT p.asset_id, sum(hv.value * (private.fx_rate(h.currency, v_cur_date) - private.fx_rate(h.currency, v_prev_date))
             * CASE WHEN p_person IS NULL THEN 1 ELSE coalesce((
                 SELECT s.pct FROM private.asset_owner_shares(p.asset_id, v_prev_date) s WHERE s.person_id = p_person), 0) / 100 END) AS v
      FROM public.investment_portfolios p
      JOIN public.assets a ON a.id = p.asset_id AND a.family_id = v_family AND a.deleted_at IS NULL
      JOIN public.investment_holdings h ON h.portfolio_id = p.id AND h.deleted_at IS NULL AND h.currency <> 'THB'
      CROSS JOIN LATERAL private.holding_value_at(h.id, v_prev_date) hv
     WHERE p.deleted_at IS NULL AND hv.value <> 0
     GROUP BY p.asset_id),
  k AS (SELECT asset_id FROM v0 UNION SELECT asset_id FROM v1 UNION SELECT asset_id FROM fl),
  rows AS (
    SELECT k.asset_id, a.name,
           coalesce((SELECT sum(v) FROM v0 WHERE v0.asset_id = k.asset_id), 0) AS s,
           coalesce((SELECT sum(v) FROM v1 WHERE v1.asset_id = k.asset_id), 0) AS e,
           coalesce((SELECT v FROM fl WHERE fl.asset_id = k.asset_id), 0) AS flow,
           coalesce((SELECT v FROM fx WHERE fx.asset_id = k.asset_id), 0) AS fxv
      FROM k JOIN public.assets a ON a.id = k.asset_id)
  SELECT jsonb_build_object(
           'month', m0, 'prev_date', v_prev_date, 'as_of', v_cur_date,
           'gain', round(coalesce(sum(e - s - flow), 0), 2),
           'fx', round(coalesce(sum(fxv), 0), 2),
           'by_portfolio', coalesce(jsonb_agg(jsonb_build_object(
               'asset_id', asset_id, 'name', name, 'start', round(s, 2), 'end', round(e, 2), 'flows', round(flow, 2),
               'gain', round(e - s - flow, 2), 'fx', round(fxv, 2)) ORDER BY abs(e - s - flow) DESC)
             FILTER (WHERE round(e - s - flow, 2) <> 0 OR round(fxv, 2) <> 0), '[]'::jsonb))
    INTO r FROM rows;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.month_investment_gain(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.month_investment_gain(date, uuid) TO authenticated;
