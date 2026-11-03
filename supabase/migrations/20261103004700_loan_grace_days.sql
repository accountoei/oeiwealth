-- =====================================================================
-- วันผ่อนผันของสัญญาเงินให้กู้ (ตกลง 3 พ.ย. 2026)
--   ตารางผ่อนครบกำหนดวันที่ 28 แต่ผู้กู้จ่ายจริงวันที่ 5–10 ของเดือนถัดไป (ไม่คิดดอกเบี้ยเพิ่ม)
--   → loan_details.grace_days (0–60 วัน · ค่าเริ่มต้น 0 = เหมือนเดิม)
--   → v_loan_schedule_status: เลยวันครบกำหนดแต่ยังไม่เกินวันผ่อนผัน = 'DUE' ("ครบกำหนด")
--     เกินวันผ่อนผัน = 'OVERDUE' ("เลยกำหนด") · เพิ่มคอลัมน์ grace_until ท้ายวิว
--   สัญญาที่ไม่ได้ตั้งวันผ่อนผัน สถานะเท่าเดิมทุกงวด
-- ไม่แก้ / ลบข้อมูลเดิม · รันซ้ำได้ (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE)
-- =====================================================================

ALTER TABLE public.loan_details ADD COLUMN IF NOT EXISTS grace_days integer NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_details_grace_days_check') THEN
    ALTER TABLE public.loan_details ADD CONSTRAINT loan_details_grace_days_check CHECK (grace_days BETWEEN 0 AND 60);
  END IF;
END $$;
COMMENT ON COLUMN public.loan_details.grace_days IS 'วันผ่อนผันหลังวันครบกำหนดงวด ก่อนขึ้นสถานะเลยกำหนด (0–60)';

CREATE OR REPLACE VIEW public.v_loan_schedule_status WITH (security_invoker = true) AS
WITH lines AS (
  SELECT s.id, s.loan_asset_id, a.family_id, a.name AS loan_name, a.currency, l.borrower_name,
         l.status AS loan_status, l.opening_date, coalesce(l.grace_days, 0) AS grace_days,
         s.installment_no, s.due_date, s.principal_due, s.interest_due, s.notes,
         CASE WHEN l.status = 'WRITTEN_OFF' THEN 0 ELSE coalesce(l.outstanding_principal, 0) END AS outstanding_principal,
         sum(s.principal_due) OVER (PARTITION BY s.loan_asset_id) AS total_principal_due,
         sum(s.principal_due) OVER w AS cum_principal_due,
         sum(CASE WHEN s.due_date > l.opening_date THEN s.interest_due ELSE 0 END) OVER w AS cum_interest_due,
         l.principal AS contract_principal, l.opening_outstanding_principal
    FROM public.loan_schedule_lines s
    JOIN public.assets a ON a.id = s.loan_asset_id
    JOIN public.loan_details l ON l.asset_id = s.loan_asset_id
   WHERE s.deleted_at IS NULL AND a.deleted_at IS NULL AND l.deleted_at IS NULL
  WINDOW w AS (PARTITION BY s.loan_asset_id ORDER BY s.due_date, s.installment_no ROWS UNBOUNDED PRECEDING)
), recv AS (
  SELECT i.asset_id, sum(i.amount) AS interest_received
    FROM public.income_transactions i
    JOIN public.loan_details l ON l.asset_id = i.asset_id AND l.deleted_at IS NULL
   WHERE i.deleted_at IS NULL AND i.income_type = 'LOAN_INTEREST' AND i.date > l.opening_date
   GROUP BY i.asset_id
), prin AS (
  -- เงินต้นที่รับชำระหลังวันยอดตั้งต้น + มีการจ่ายเงินให้กู้หลังวันยอดตั้งต้นไหม
  SELECT l.asset_id,
         coalesce(sum(m.amount) FILTER (WHERE m.movement_type = 'LOAN_PRINCIPAL_RECEIPT'), 0) AS principal_received,
         bool_or(m.movement_type = 'LOAN_DISBURSEMENT') IS TRUE AS disbursed_after_opening
    FROM public.loan_details l
    LEFT JOIN public.cash_movements m ON m.deleted_at IS NULL AND m.movement_date > l.opening_date
         AND ((m.movement_type = 'LOAN_PRINCIPAL_RECEIPT' AND m.from_asset_id = l.asset_id)
           OR (m.movement_type = 'LOAN_DISBURSEMENT' AND m.to_asset_id = l.asset_id))
   WHERE l.deleted_at IS NULL
   GROUP BY l.asset_id
), cov AS (
  -- เงินต้นที่ได้คืน (นับตามตาราง เรียงจากงวดเก่า):
  --   ส่วนที่ได้คืนก่อนยอดตั้งต้น = เงินต้นตามสัญญา − ยอดตั้งต้น (เฉพาะสัญญาที่ยกมา: มียอดตั้งต้น หรือไม่มีการจ่ายเงินให้กู้หลังวันตั้งต้น)
  --     ตารางที่ใส่ไว้ไม่ครบสัญญา (เงินต้นตามตาราง < ตามสัญญา) → ส่วนที่ขาดถือเป็นงวดเก่าที่ได้คืนแล้วก่อน
  --   + รับชำระเงินต้นจริงหลังวันยอดตั้งต้น · ไม่ขึ้นกับยอดคงเหลือ (ให้กู้เพิ่มไม่ทำให้งวดเก่ากลับมาค้าง)
  --   ตัดหนี้สูญ: ทุกงวดไม่ค้าง (สถานะ WRITTEN_OFF) เหมือนเดิม
  SELECT x.id,
         CASE WHEN x.loan_status = 'WRITTEN_OFF' THEN x.total_principal_due
              ELSE greatest(CASE WHEN x.opening_outstanding_principal > 0 OR NOT p.disbursed_after_opening
                                 THEN greatest(x.contract_principal - x.opening_outstanding_principal, 0) ELSE 0 END
                            - greatest(x.contract_principal - x.total_principal_due, 0), 0)
                   + p.principal_received END AS principal_covered
    FROM lines x JOIN prin p ON p.asset_id = x.loan_asset_id
), calc AS (
  SELECT x.*,
         c.principal_covered,
         coalesce(r.interest_received, 0) AS interest_covered,
         least(x.principal_due, greatest(x.cum_principal_due - c.principal_covered, 0)) AS principal_remaining,
         CASE WHEN x.due_date <= x.opening_date THEN 0
              ELSE least(x.interest_due, greatest(x.cum_interest_due - coalesce(r.interest_received, 0), 0)) END
           AS interest_remaining
    FROM lines x JOIN cov c ON c.id = x.id LEFT JOIN recv r ON r.asset_id = x.loan_asset_id
)
SELECT c.id, c.loan_asset_id, c.family_id, c.loan_name, c.currency, c.borrower_name, c.loan_status,
       c.installment_no, c.due_date, c.principal_due, c.interest_due, c.principal_due + c.interest_due AS total_due,
       c.notes, c.principal_remaining, c.interest_remaining, c.principal_remaining + c.interest_remaining AS total_remaining,
       c.principal_covered, c.interest_covered,
       CASE WHEN c.loan_status = 'CLOSED' THEN 'PAID'
            WHEN c.loan_status = 'WRITTEN_OFF' THEN 'WRITTEN_OFF'
            WHEN c.principal_remaining + c.interest_remaining <= 0.005 THEN 'PAID'
            WHEN c.due_date < current_date AND c.due_date + c.grace_days >= current_date THEN 'DUE'   -- ครบกำหนดแล้ว ยังอยู่ในช่วงผ่อนผัน
            WHEN c.due_date < current_date THEN 'OVERDUE'
            WHEN c.principal_remaining + c.interest_remaining < c.principal_due + c.interest_due THEN 'PARTIAL'
            ELSE 'PENDING' END AS status,
       c.due_date + c.grace_days AS grace_until
  FROM calc c;

REVOKE ALL ON public.v_loan_schedule_status FROM PUBLIC, anon;
GRANT SELECT ON public.v_loan_schedule_status TO authenticated;
