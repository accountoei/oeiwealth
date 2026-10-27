-- =====================================================================
-- Loans Receivable (ตกลง 27 ต.ค. 2026 · thread "ปรับหน้า Loans Receivable")
--   1) สถานะงวดผ่อน: "เงินต้นที่ได้คืน" = ยอดรับชำระเงินต้นจริง (+ ส่วนที่ได้คืนก่อนยอดตั้งต้น)
--      เดิมคำนวณย้อนจาก "เงินต้นรวมตามตาราง − เงินต้นคงเหลือ" → ให้กู้เพิ่มแล้วงวดที่รับแล้วกลับเป็น "เลยกำหนด"
--      สัญญาที่ไม่เคยให้กู้เพิ่ม ผลเท่าเดิม
--   2) ส่วนที่มีความเสี่ยงไม่ได้คืน (สัญญา "มีความเสี่ยง"): เก็บยอด + วันที่ประเมิน + หมายเหตุ
--      แสดงอย่างเดียว · Net Worth ยังนับเต็มจนกว่าจะ "ตัดหนี้สูญ" (เจ้าของเลือก)
--   3) ฐานข้อมูลตรวจ: เปลี่ยนเป็น "ปิดแล้ว" ได้เมื่อเงินต้นคงเหลือ = 0 · สัญญาปิดแล้ว ห้ามมีรายการที่ทำให้เงินต้นกลับมาค้าง
--      วันครบกำหนดสัญญาต้องไม่ก่อนงวดสุดท้ายในตารางผ่อน
--   4) batch_receive_loan_payments: บันทึกรับชำระหลายสัญญาในคำสั่งเดียว (ผิดแถวเดียว = ไม่บันทึกเลย)
-- ไม่แก้ / ลบข้อมูลเดิม · รันซ้ำได้ (CREATE OR REPLACE / IF NOT EXISTS / DROP TRIGGER IF EXISTS)
-- =====================================================================

-- ---------------------------------------------------------------- 1) สถานะงวดผ่อน (คอลัมน์เดิมทุกตัว ลำดับเดิม)
CREATE OR REPLACE VIEW public.v_loan_schedule_status WITH (security_invoker = true) AS
WITH lines AS (
  SELECT s.id, s.loan_asset_id, a.family_id, a.name AS loan_name, a.currency, l.borrower_name,
         l.status AS loan_status, l.opening_date,
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
            WHEN c.due_date < current_date THEN 'OVERDUE'
            WHEN c.principal_remaining + c.interest_remaining < c.principal_due + c.interest_due THEN 'PARTIAL'
            ELSE 'PENDING' END AS status
  FROM calc c;
REVOKE ALL ON public.v_loan_schedule_status FROM PUBLIC, anon;
GRANT SELECT ON public.v_loan_schedule_status TO authenticated;

-- ---------------------------------------------------------------- 2) ส่วนที่มีความเสี่ยงไม่ได้คืน (แสดงอย่างเดียว · ไม่กระทบ Net Worth)
--   at_risk_amount = เงินต้นคงเหลือ − มูลค่าคาดว่าจะได้รับคืน ณ วันที่ประเมิน
--   เก็บเป็น "ส่วนเสี่ยง" (ไม่ใช่ยอดคาดได้คืน) → รับชำระต่อ ยอดคาดได้คืนลดลงตามเงินที่ได้จริง
ALTER TABLE public.loan_details ADD COLUMN IF NOT EXISTS at_risk_amount numeric(18,2);
ALTER TABLE public.loan_details ADD COLUMN IF NOT EXISTS risk_assessed_date date;
ALTER TABLE public.loan_details ADD COLUMN IF NOT EXISTS risk_note text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_details_at_risk_amount_check') THEN
    ALTER TABLE public.loan_details ADD CONSTRAINT loan_details_at_risk_amount_check CHECK (at_risk_amount IS NULL OR at_risk_amount >= 0);
  END IF;
END $$;

-- ---------------------------------------------------------------- 3) ตรวจสถานะ "ปิดแล้ว" + วันครบกำหนดสัญญา
--   ทำงานหลัง t20_cache (เงินต้นคงเหลือในแถวเป็นยอดจริงที่ระบบคำนวณ)
--   รายการรับชำระ / ให้กู้ที่ถูกแก้ / ลบ → refresh_loan อัปเดตแถวนี้ → ถ้าสัญญาปิดแล้วและเงินต้นกลับมาค้าง ไม่ให้ทำ
CREATE OR REPLACE FUNCTION private.tg_loan_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_last date;
BEGIN
  IF NEW.deleted_at IS NULL AND NEW.status = 'CLOSED' AND coalesce(NEW.outstanding_principal, 0) > 0.005 THEN
    IF OLD.status IS DISTINCT FROM 'CLOSED' THEN
      RAISE EXCEPTION 'INVALID: ยังมีเงินต้นคงเหลือ % — บันทึกรับชำระให้ครบก่อนเปลี่ยนเป็น "ปิดแล้ว" (ถ้าไม่ได้คืน ให้เลือก "ตัดหนี้สูญ")',
        to_char(NEW.outstanding_principal, 'FM999,999,999,990.00') USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'INVALID: สัญญานี้ปิดแล้ว — รายการนี้ทำให้มีเงินต้นคงเหลือ % · เปลี่ยนสถานะกลับเป็น "ปกติ" ก่อน',
      to_char(NEW.outstanding_principal, 'FM999,999,999,990.00') USING ERRCODE = '22023';
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    SELECT max(due_date) INTO v_last FROM public.loan_schedule_lines WHERE loan_asset_id = NEW.asset_id AND deleted_at IS NULL;
    IF v_last IS NOT NULL AND (NEW.due_date IS NULL OR NEW.due_date < v_last) THEN
      RAISE EXCEPTION 'INVALID: วันครบกำหนดสัญญาต้องไม่ก่อนงวดสุดท้ายในตารางผ่อน (%)', to_char(v_last, 'DD/MM/YYYY') USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.tg_loan_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS t55_loan_guard ON public.loan_details;
CREATE TRIGGER t55_loan_guard BEFORE UPDATE ON public.loan_details
  FOR EACH ROW EXECUTE FUNCTION private.tg_loan_guard();

-- ---------------------------------------------------------------- 4) รับชำระหลายสัญญา (แท็บ "บันทึกรับชำระคืนเงินกู้")
-- p_rows: [ { loan_asset_id, label, bank_asset_id, date, principal, interest, interest_tax, notes } ]
--   เรียก receive_loan_payment เดิมทีละแถว · สัญญาที่ปิดแล้ว / ตัดหนี้สูญ รับไม่ได้
CREATE OR REPLACE FUNCTION public.batch_receive_loan_payments(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_label text; v_loan uuid; v_status text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_label := coalesce(nullif(trim(r->>'label'), ''), 'รายการ');
    BEGIN
      v_loan := nullif(r->>'loan_asset_id', '')::uuid;
      SELECT status INTO v_status FROM public.loan_details WHERE asset_id = v_loan AND deleted_at IS NULL;
      IF v_status IN ('CLOSED','WRITTEN_OFF') THEN
        RAISE EXCEPTION 'INVALID: สัญญาปิดแล้ว / ตัดหนี้สูญ — รับชำระไม่ได้' USING ERRCODE = '22023';
      END IF;
      IF nullif(r->>'bank_asset_id', '') IS NULL THEN
        RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่รับเงิน' USING ERRCODE = '22023';
      END IF;
      PERFORM public.receive_loan_payment(v_loan, (r->>'bank_asset_id')::uuid, (r->>'date')::date,
        coalesce(nullif(r->>'principal', '')::numeric, 0), coalesce(nullif(r->>'interest', '')::numeric, 0),
        nullif(r->>'interest_tax', '')::numeric, nullif(trim(r->>'notes'), ''));
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '%', private.batch_row_error(v_label, SQLERRM) USING ERRCODE = SQLSTATE;
    END;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_receive_loan_payments(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_receive_loan_payments(jsonb) TO authenticated;
