-- =====================================================================
-- ค้นหารายการเงิน (30 ต.ค. 2026) — ช่องค้นหาด้านบน กลุ่ม "รายการเงิน"
-- ค้นจาก รายได้ · ค่าใช้จ่าย · เงินเข้า–ออกที่บันทึกเอง (โอน / จ่ายบัตร / จ่ายหนี้ ฯลฯ) · รายการในพอร์ตลงทุน
--   ข้อความ: คำอธิบาย / หมายเหตุ / หมวด / ชื่อรายได้ประจำ / ชื่อ–ชื่อย่อหลักทรัพย์ (ไม่สนตัวพิมพ์เล็ก–ใหญ่)
--   ตัวเลข: พิมพ์ 1500 หรือ 1,500 → ยอดเท่ากับ 1,500 (ยอดในสกุลเดิม หรือยอดเป็นบาท)
-- SECURITY INVOKER → RLS ของผู้ใช้ใช้ตามเดิม · ไม่แสดงรายการที่ลบแล้ว
-- ไม่แสดงซ้ำ: เงินเข้า–ออกที่ระบบสร้างต่อจากรายการอื่น (is_derived) และรายการพอร์ตที่เป็นเงินโอนเข้า–ออกพอร์ต (แสดงจากเงินเข้า–ออกแล้ว)
-- ผลไม่เกิน p_limit (สูงสุด 50) เรียงล่าสุดก่อน · รันซ้ำได้
-- =====================================================================
DROP FUNCTION IF EXISTS public.search_money(text, int);
CREATE FUNCTION public.search_money(p_q text, p_limit int DEFAULT 20)
RETURNS TABLE (kind text, id uuid, d date, title text, type text, amount numeric, currency text, account text,
               portfolio_asset_id uuid, holding_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH q AS (
    SELECT '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat,
           CASE WHEN replace(btrim(p_q), ',', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN abs(replace(btrim(p_q), ',', '')::numeric) END AS num
     WHERE length(btrim(coalesce(p_q, ''))) >= 2
  ), hits AS (
    -- รายได้
    SELECT 'INCOME'::text AS kind, i.id, i.date AS d, i.created_at,
           coalesce(nullif(t.name, ''), nullif(i.notes, ''), i.income_subtype) AS title, i.income_type AS type,
           i.amount::numeric AS amount, i.currency::text AS currency, a.name AS account,
           NULL::uuid AS portfolio_asset_id, NULL::uuid AS holding_id
      FROM q, public.income_transactions i
      LEFT JOIN public.recurring_income_templates t ON t.id = i.recurring_template_id
      LEFT JOIN public.assets a ON a.id = i.received_to_asset_id
     WHERE i.deleted_at IS NULL
       AND (i.notes ILIKE q.pat OR t.name ILIKE q.pat OR i.income_subtype ILIKE q.pat
            OR i.amount = q.num OR i.base_amount = q.num)
    UNION ALL
    -- ค่าใช้จ่าย
    SELECT 'EXPENSE', e.id, e.date, e.created_at,
           coalesce(nullif(e.description, ''), e.expense_category), e.expense_category,
           e.amount, e.currency, coalesce(a.name, nullif(btrim(concat_ws(' ', c.issuer, c.card_name)), '')),
           NULL, NULL
      FROM q, public.expense_items e
      LEFT JOIN public.assets a ON a.id = e.paid_from_asset_id
      LEFT JOIN public.credit_cards c ON c.id = e.paid_from_credit_card_id
     WHERE e.deleted_at IS NULL
       AND (e.description ILIKE q.pat OR e.notes ILIKE q.pat OR e.expense_category ILIKE q.pat
            OR e.amount = q.num OR e.base_amount = q.num)
    UNION ALL
    -- เงินเข้า–ออกที่บันทึกเอง
    SELECT 'MOVE', m.id, m.movement_date, m.created_at,
           coalesce(nullif(m.description, ''), nullif(m.notes, ''), m.movement_type), m.movement_type,
           m.amount, m.currency, concat_ws(' → ', fa.name, ta.name),
           NULL, NULL
      FROM q, public.cash_movements m
      LEFT JOIN public.assets fa ON fa.id = m.from_asset_id
      LEFT JOIN public.assets ta ON ta.id = m.to_asset_id
     WHERE m.deleted_at IS NULL AND NOT m.is_derived
       AND (m.description ILIKE q.pat OR m.notes ILIKE q.pat
            OR m.amount = q.num OR m.counter_amount = q.num OR m.base_amount = q.num)
    UNION ALL
    -- รายการในพอร์ตลงทุน
    SELECT 'INVEST', x.id, x.transaction_date, x.created_at,
           coalesce(nullif(concat_ws(' · ', h.symbol, h.name), ''), pa.name), x.transaction_type,
           x.amount, x.currency, pa.name,
           p.asset_id, x.holding_id
      FROM q, public.investment_transactions x
      JOIN public.investment_portfolios p ON p.id = x.portfolio_id
      LEFT JOIN public.assets pa ON pa.id = p.asset_id
      LEFT JOIN public.investment_holdings h ON h.id = x.holding_id
     WHERE x.deleted_at IS NULL
       AND NOT (x.transaction_type IN ('DEPOSIT', 'WITHDRAWAL') AND x.cash_movement_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM public.cash_movements cm
                             WHERE cm.id = x.cash_movement_id AND NOT cm.is_derived AND cm.deleted_at IS NULL))
       AND (x.notes ILIKE q.pat OR h.name ILIKE q.pat OR h.symbol ILIKE q.pat
            OR x.amount = q.num OR x.amount_base_currency = q.num)
  )
  SELECT kind, id, d, title, type, amount, currency, account, portfolio_asset_id, holding_id
    FROM hits
   ORDER BY d DESC, created_at DESC
   LIMIT least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

REVOKE ALL ON FUNCTION public.search_money(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_money(text, int) TO authenticated;
