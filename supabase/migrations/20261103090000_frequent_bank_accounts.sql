-- =====================================================================
-- บัญชีที่ใช้บ่อยขึ้นบนสุดของ dropdown (เจ้าของตกลง 3 พ.ย. 2026)
--   v_bank_accounts_safe เพิ่ม 3 คอลัมน์ (ต่อท้าย · คอลัมน์เดิมเหมือนเดิมทุกตัว):
--     use_count  = จำนวนรายการเงินเข้า–ออก (cash_movements ที่ยังไม่ลบ) ของบัญชีนี้ใน 90 วันล่าสุด (นับทั้งรายการที่ระบบสร้าง)
--     frequent   = 5 บัญชีที่ยังใช้งาน (ACTIVE) และใช้บ่อยที่สุด (use_count > 0)
--     pick_order = ลำดับใน dropdown: บัญชีใช้บ่อย (มาก → น้อย) ก่อน แล้วตามลำดับที่จัดไว้ (assets.sort_order) แล้วตามชื่อ
--   View เป็น security_invoker เหมือนเดิม → นับเฉพาะรายการที่ผู้ใช้คนนั้นมีสิทธิ์อ่าน (RLS)
--   อ่านอย่างเดียว · ไม่แก้ตาราง / ข้อมูลเดิม · สิทธิ์ (GRANT) เดิมของ View คงอยู่ · รันซ้ำได้
-- =====================================================================
CREATE OR REPLACE VIEW public.v_bank_accounts_safe WITH (security_invoker = true) AS
WITH base AS (
  SELECT b.id,
    b.asset_id,
    a.name,
    a.currency,
    a.status,
    b.bank_name,
    b.account_name,
    b.account_type,
    b.account_no_last4,
        CASE
            WHEN b.account_no_last4 IS NOT NULL THEN '••••'::text || b.account_no_last4
            ELSE NULL::text
        END AS account_no_masked,
    b.interest_rate,
    b.maturity_date,
    b.branch,
    b.notes,
    a.current_value AS confirmed_balance,
    a.current_value_date AS confirmed_date,
    b.overdraft_limit,
    b.overdraft_rate,
    a.sort_order,
    (SELECT count(*) FROM public.cash_movements m
      WHERE m.deleted_at IS NULL AND m.movement_date > current_date - 90
        AND (m.from_asset_id = b.asset_id OR m.to_asset_id = b.asset_id))::integer AS use_count
   FROM public.bank_accounts b
     JOIN public.assets a ON a.id = b.asset_id
  WHERE b.deleted_at IS NULL AND a.deleted_at IS NULL
), ranked AS (
  SELECT base.*,
    (base.status = 'ACTIVE' AND base.use_count > 0
      AND row_number() OVER (ORDER BY (base.status = 'ACTIVE' AND base.use_count > 0) DESC, base.use_count DESC, base.name) <= 5) AS frequent
  FROM base
)
SELECT r.id, r.asset_id, r.name, r.currency, r.status, r.bank_name, r.account_name, r.account_type, r.account_no_last4,
  r.account_no_masked, r.interest_rate, r.maturity_date, r.branch, r.notes, r.confirmed_balance, r.confirmed_date,
  r.overdraft_limit, r.overdraft_rate,
  r.use_count,
  r.frequent,
  (row_number() OVER (ORDER BY r.frequent DESC, CASE WHEN r.frequent THEN r.use_count END DESC NULLS LAST,
     r.sort_order NULLS LAST, r.name))::integer AS pick_order
FROM ranked r;

COMMENT ON VIEW public.v_bank_accounts_safe IS
  'บัญชีเงินฝาก (ไม่มีเลขบัญชีเต็ม) · use_count = รายการ 90 วัน · frequent = 5 บัญชีใช้บ่อย · pick_order = ลำดับใน dropdown';
