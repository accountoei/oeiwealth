-- =====================================================================
-- ตารางผ่อนชำระของเงินให้กู้ (Loans Receivable)
--   1) loan_schedule_lines: งวดที่ตกลงกับผู้กู้ (วันครบกำหนด · เงินต้น · ดอกเบี้ย)
--      เป็น "แผน" เท่านั้น ไม่กระทบยอดเงิน / Net Worth (ยอดจริงยังมาจากการบันทึกรับชำระ)
--   2) set_loan_schedule(): ตั้ง / แทนที่ตารางทั้งชุด (คำนวณจากสูตร หรือวางจาก Excel ที่หน้าจอ)
--   3) v_loan_schedule_status: เทียบตารางกับเงินที่รับจริง → รับแล้ว / รับบางส่วน / รอรับ / เลยกำหนด
--      เงินต้น: ยอดตามตารางทั้งหมด − เงินต้นคงเหลือจริง = ส่วนที่ได้คืนแล้ว → ตัดงวดตามลำดับ
--      ดอกเบี้ย: นับเฉพาะงวดหลังวันยอดตั้งต้น เทียบกับดอกเบี้ยที่บันทึกรับหลังวันนั้น
--               (งวดก่อนวันยอดตั้งต้นถือว่าดอกเบี้ยเรียบร้อยแล้ว เพราะระบบไม่มีข้อมูลก่อนหน้า)
-- รันซ้ำได้ (IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS)
-- =====================================================================

-- ---------------------------------------------------------------- 1) ตาราง
CREATE TABLE IF NOT EXISTS public.loan_schedule_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_asset_id   uuid NOT NULL REFERENCES public.assets(id),
  installment_no  integer NOT NULL CHECK (installment_no >= 1),
  due_date        date NOT NULL,
  principal_due   public.d_money NOT NULL DEFAULT 0 CHECK (principal_due >= 0),
  interest_due    public.d_money NOT NULL DEFAULT 0 CHECK (interest_due >= 0),
  notes           text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id),
  CONSTRAINT lsl_amount_positive CHECK (principal_due + interest_due > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS loan_schedule_lines_no_uq
  ON public.loan_schedule_lines (loan_asset_id, installment_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS loan_schedule_lines_due_idx
  ON public.loan_schedule_lines (loan_asset_id, due_date) WHERE deleted_at IS NULL;

-- Generic triggers (เหมือนทุกตาราง: META · ห้าม Hard Delete · Audit)
DROP TRIGGER IF EXISTS t10_meta ON public.loan_schedule_lines;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.loan_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.loan_schedule_lines;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.loan_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.loan_schedule_lines;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.loan_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

-- ต้องผูกกับเงินให้กู้เท่านั้น · ย้ายงวดไปสัญญาอื่นไม่ได้
CREATE OR REPLACE FUNCTION private.tg_loan_schedule_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.loan_asset_id IS DISTINCT FROM OLD.loan_asset_id THEN
    RAISE EXCEPTION 'IMMUTABLE: ย้ายงวดไปสัญญาอื่นไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.loan_details l JOIN public.assets a ON a.id = l.asset_id
                  WHERE l.asset_id = NEW.loan_asset_id AND a.asset_type = 'LOAN_RECEIVABLE'
                    AND a.deleted_at IS NULL AND l.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ไม่พบเงินให้กู้' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t50_loan_schedule_check ON public.loan_schedule_lines;
CREATE TRIGGER t50_loan_schedule_check BEFORE INSERT OR UPDATE ON public.loan_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_loan_schedule_check();

-- RLS: Permission Matrix มาตรฐาน (เหมือน 20261004001600_rls_grants.sql)
ALTER TABLE public.loan_schedule_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loan_schedule_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.loan_schedule_lines TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.loan_schedule_lines TO service_role;
DROP POLICY IF EXISTS p_select ON public.loan_schedule_lines;
DROP POLICY IF EXISTS p_insert ON public.loan_schedule_lines;
DROP POLICY IF EXISTS p_update ON public.loan_schedule_lines;
CREATE POLICY p_select ON public.loan_schedule_lines FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
CREATE POLICY p_insert ON public.loan_schedule_lines FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR')));
CREATE POLICY p_update ON public.loan_schedule_lines FOR UPDATE TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND created_at >= now() - interval '24 hours' AND deleted_at IS NULL))
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND deleted_at IS NULL));

-- ---------------------------------------------------------------- 2) ตั้ง / แทนที่ตารางทั้งชุด
-- p_lines: [{ "due_date": "2026-11-05", "principal": 10000, "interest": 500, "notes": "…" }, …]
-- เรียงตามวันที่ แล้วใส่เลขงวด 1..n ให้เอง · งวดเดิมทั้งหมดถูกลบ (soft delete) → ADMIN / EDITOR เท่านั้น
DROP FUNCTION IF EXISTS public.set_loan_schedule(uuid, jsonb);
CREATE FUNCTION public.set_loan_schedule(p_loan_asset_id uuid, p_lines jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'INVALID: ตารางผ่อนต้องมีอย่างน้อย 1 งวด' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) > 600 THEN
    RAISE EXCEPTION 'INVALID: ตารางผ่อนยาวเกิน 600 งวด' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
              WHERE nullif(x->>'due_date', '') IS NULL
                 OR coalesce(nullif(x->>'principal', '')::numeric, 0) < 0
                 OR coalesce(nullif(x->>'interest', '')::numeric, 0) < 0
                 OR coalesce(nullif(x->>'principal', '')::numeric, 0) + coalesce(nullif(x->>'interest', '')::numeric, 0) <= 0) THEN
    RAISE EXCEPTION 'INVALID: ทุกงวดต้องมีวันที่ และยอดเงินต้นหรือดอกเบี้ยมากกว่า 0' USING ERRCODE = '22023';
  END IF;

  UPDATE public.loan_schedule_lines SET deleted_at = now()
   WHERE loan_asset_id = p_loan_asset_id AND deleted_at IS NULL;

  INSERT INTO public.loan_schedule_lines(loan_asset_id, installment_no, due_date, principal_due, interest_due, notes)
  SELECT p_loan_asset_id,
         row_number() OVER (ORDER BY (x->>'due_date')::date, ord),
         (x->>'due_date')::date,
         round(coalesce(nullif(x->>'principal', '')::numeric, 0), 2),
         round(coalesce(nullif(x->>'interest', '')::numeric, 0), 2),
         nullif(trim(x->>'notes'), '')
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(x, ord);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.set_loan_schedule(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_loan_schedule(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------- 3) สถานะแต่ละงวด
CREATE OR REPLACE VIEW public.v_loan_schedule_status WITH (security_invoker = true) AS
WITH lines AS (
  SELECT s.id, s.loan_asset_id, a.family_id, a.name AS loan_name, a.currency, l.borrower_name,
         l.status AS loan_status, l.opening_date,
         s.installment_no, s.due_date, s.principal_due, s.interest_due, s.notes,
         CASE WHEN l.status = 'WRITTEN_OFF' THEN 0 ELSE coalesce(l.outstanding_principal, 0) END AS outstanding_principal,
         sum(s.principal_due) OVER (PARTITION BY s.loan_asset_id) AS total_principal_due,
         sum(s.principal_due) OVER w AS cum_principal_due,
         sum(CASE WHEN s.due_date > l.opening_date THEN s.interest_due ELSE 0 END) OVER w AS cum_interest_due
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
), calc AS (
  SELECT x.*,
         greatest(x.total_principal_due - x.outstanding_principal, 0) AS principal_covered,
         coalesce(r.interest_received, 0) AS interest_covered,
         least(x.principal_due, greatest(x.cum_principal_due - greatest(x.total_principal_due - x.outstanding_principal, 0), 0))
           AS principal_remaining,
         CASE WHEN x.due_date <= x.opening_date THEN 0
              ELSE least(x.interest_due, greatest(x.cum_interest_due - coalesce(r.interest_received, 0), 0)) END
           AS interest_remaining
    FROM lines x LEFT JOIN recv r ON r.asset_id = x.loan_asset_id
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
