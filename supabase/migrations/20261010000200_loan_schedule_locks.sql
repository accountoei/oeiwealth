-- =====================================================================
-- ล็อกตารางผ่อนเงินให้กู้ เมื่อเริ่มรับชำระแล้ว
--   1) แก้ตารางทั้งชุด (set_loan_schedule) ได้เฉพาะก่อนบันทึกรับชำระครั้งแรก
--      (ยกเว้นสัญญาที่ยังไม่มีตารางเลย — ตั้งครั้งแรกได้เสมอ โดยใส่ตารางทั้งสัญญาตั้งแต่งวดแรก)
--      หลังจากนั้นเปลี่ยนตารางได้ทางเดียว: คำนวณงวดที่เหลือใหม่ (restructure_loan_schedule)
--   2) งวดที่ "รับแล้ว" แก้ไข / ลบไม่ได้ (เมื่อสัญญามีการบันทึกรับชำระแล้ว)
--      กดรับผิด → แก้ / ลบ "รายการรับชำระ" แทน (ทำได้จนกว่าจะปิดเดือน — Period Lock เดิม) แล้วงวดจะกลับมาแก้ได้เอง
--   "มีการบันทึกรับชำระ" = มีรายการรับเงินต้น หรือ ดอกเบี้ยรับ ของสัญญานี้ในระบบ (ไม่ดูสถานะงวด เพราะสัญญาเก่า
--   ที่นำเข้าพร้อมยอดยกมา มีงวด "รับแล้ว" ตั้งแต่แรก แต่ยังต้องแก้ตารางที่นำเข้าได้)
-- รันซ้ำได้ (CREATE OR REPLACE / DROP TRIGGER IF EXISTS)
-- =====================================================================

-- ---------------------------------------------------------------- สัญญานี้มีการบันทึกรับชำระแล้วหรือยัง
CREATE OR REPLACE FUNCTION private.loan_has_payments(p_loan_asset_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.cash_movements m
                  WHERE m.from_asset_id = p_loan_asset_id AND m.movement_type = 'LOAN_PRINCIPAL_RECEIPT' AND m.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.income_transactions i
                  WHERE i.asset_id = p_loan_asset_id AND i.income_type = 'LOAN_INTEREST' AND i.deleted_at IS NULL)
$$;
REVOKE ALL ON FUNCTION private.loan_has_payments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.loan_has_payments(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- 1) set_loan_schedule: เฉพาะก่อนรับชำระครั้งแรก (signature เดิม)
CREATE OR REPLACE FUNCTION public.set_loan_schedule(p_loan_asset_id uuid, p_lines jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF private.loan_has_payments(p_loan_asset_id)
     AND EXISTS (SELECT 1 FROM public.loan_schedule_lines WHERE loan_asset_id = p_loan_asset_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: สัญญานี้บันทึกรับชำระแล้ว — แก้ตารางทั้งชุดไม่ได้ ใช้ "คำนวณงวดที่เหลือใหม่" แทน'
      USING ERRCODE = '22023';
  END IF;
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

-- ---------------------------------------------------------------- 2) งวดที่รับแล้ว แก้ไข / ลบไม่ได้
-- (ลบจริงถูกกันด้วย t05_block_hard_delete อยู่แล้ว · การลบในระบบ = UPDATE deleted_at → ตรวจที่นี่)
CREATE OR REPLACE FUNCTION private.tg_loan_schedule_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.deleted_at IS NULL
     AND private.loan_has_payments(OLD.loan_asset_id)
     AND EXISTS (SELECT 1 FROM public.v_loan_schedule_status s WHERE s.id = OLD.id AND s.status = 'PAID') THEN
    RAISE EXCEPTION 'LOCKED: งวดที่รับครบแล้วแก้ไข / ลบไม่ได้ — ถ้าบันทึกรับผิด ให้แก้ / ลบรายการรับชำระในประวัติแทน'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t60_loan_schedule_lock ON public.loan_schedule_lines;
CREATE TRIGGER t60_loan_schedule_lock BEFORE UPDATE ON public.loan_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_loan_schedule_lock();
