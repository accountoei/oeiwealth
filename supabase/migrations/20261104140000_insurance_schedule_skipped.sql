-- =====================================================================
-- ประกัน: ตั้ง / แก้ตารางเบี้ย / ผลประโยชน์แบบแก้ทีละช่อง (ตกลง 4 พ.ย. 2026 · แบบตารางผ่อนของสินเชื่อ)
--   set_insurance_schedule (เดิม 20261102000600) เพิ่ม 2 อย่าง:
--     1) เก็บ "ไม่ได้จ่าย / ไม่ได้รับ" (skipped) ของแต่ละงวดที่ส่งมา (เดิมบันทึกทั้งชุดแล้วค่านี้หาย)
--     2) ส่งตารางว่างได้ = ลบงวดที่ยังไม่มีการชำระทั้งหมด (งวดที่ชำระ / รับแล้วเก็บไว้เหมือนเดิม)
--   ชนิดผลประโยชน์ต่องวด (benefit_type) รับอยู่แล้ว · หน้าเว็บส่งต่อแถวแทนชนิดเดียวทั้งชุด
--   กติกาเดิมทั้งหมด: ADMIN / EDITOR · งวดหลัง Go-live ต้องอยู่หลังงวดที่ชำระแล้ว · งวดก่อน Go-live ใส่ย้อนหลังได้ · เลขงวดเรียงใหม่
--   ★ แก้ฟังก์ชันอย่างเดียว ไม่แตะข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

CREATE OR REPLACE FUNCTION public.set_insurance_schedule(p_policy_id uuid, p_kind text, p_lines jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ccy text; v_kept_max date; v_first date; v_count integer; v_go_live date;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF p_kind NOT IN ('PREMIUM','BENEFIT') THEN RAISE EXCEPTION 'INVALID: ชนิดตารางไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(p.premium_currency, p.insured_amount_currency, 'THB'), f.go_live_date INTO v_ccy, v_go_live
    FROM public.insurance_policies p JOIN public.families f ON f.id = p.family_id WHERE p.id = p_policy_id AND p.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบกรมธรรม์' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID: อ่านตารางไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) > 600 THEN RAISE EXCEPTION 'INVALID: ตารางยาวเกิน 600 งวด' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
              WHERE nullif(x->>'due_date', '') IS NULL OR coalesce(nullif(x->>'amount', '')::numeric, 0) <= 0
                 OR (p_kind = 'BENEFIT' AND coalesce(nullif(x->>'benefit_type', ''), 'OTHER') NOT IN ('CASH_BACK','ANNUITY','MATURITY','OTHER'))) THEN
    RAISE EXCEPTION 'INVALID: ทุกงวดต้องมีวันที่ และยอดมากกว่า 0' USING ERRCODE = '22023';
  END IF;

  -- งวดที่ยังไม่มีการชำระ → แทนที่ · งวดที่มีการชำระแล้ว (ครบ / บางส่วน) เก็บไว้
  UPDATE public.insurance_schedule_lines l SET deleted_at = now()
   WHERE l.policy_id = p_policy_id AND l.kind = p_kind AND l.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.v_insurance_schedule_status s WHERE s.id = l.id AND s.paid_amount = 0);

  -- งวดก่อน Go-live = ประวัติ ใส่ย้อนหลังได้เสมอ (แม้มีการจ่ายหลัง Go-live แล้ว) · งวดหลัง Go-live ต้องอยู่หลังงวดที่มีการชำระแล้ว
  SELECT max(due_date) INTO v_kept_max
    FROM public.insurance_schedule_lines WHERE policy_id = p_policy_id AND kind = p_kind AND deleted_at IS NULL;
  SELECT min((x->>'due_date')::date) INTO v_first FROM jsonb_array_elements(p_lines) x
   WHERE v_go_live IS NULL OR (x->>'due_date')::date >= v_go_live;
  IF v_kept_max IS NOT NULL AND v_first <= v_kept_max THEN
    RAISE EXCEPTION 'INVALID: งวดแรกต้องอยู่หลังงวดที่มีการชำระแล้ว (%)', to_char(v_kept_max, 'DD/MM/YYYY') USING ERRCODE = '22023';
  END IF;

  -- skipped = ติ๊ก "ไม่ได้จ่าย / ไม่ได้รับ" (งวดใหม่ยังไม่มีเงิน จึงติ๊กได้เสมอ)
  INSERT INTO public.insurance_schedule_lines(policy_id, kind, installment_no, due_date, amount, currency, benefit_type, notes, skipped)
  SELECT p_policy_id, p_kind, 1,
         (x->>'due_date')::date, round((x->>'amount')::numeric, 2), v_ccy,
         CASE WHEN p_kind = 'BENEFIT' THEN coalesce(nullif(x->>'benefit_type', ''), 'OTHER') END,
         nullif(trim(x->>'notes'), ''),
         coalesce(x->>'skipped', 'false') = 'true'
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(x, ord);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- เลขงวดเรียงตามวันครบกำหนดใหม่ทั้งชุด (งวดประวัติที่ใส่ย้อนหลังอยู่ก่อน)
  UPDATE public.insurance_schedule_lines l SET installment_no = n.no
    FROM (SELECT id, row_number() OVER (ORDER BY due_date, installment_no, created_at) AS no
            FROM public.insurance_schedule_lines WHERE policy_id = p_policy_id AND kind = p_kind AND deleted_at IS NULL) n
   WHERE l.id = n.id AND l.installment_no IS DISTINCT FROM n.no;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.set_insurance_schedule(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_insurance_schedule(uuid, text, jsonb) TO authenticated;
