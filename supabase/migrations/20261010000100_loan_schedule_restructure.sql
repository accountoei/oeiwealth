-- =====================================================================
-- ปรับตารางผ่อน (คำนวณงวดที่เหลือใหม่) — ชำระเกิน / ผู้กู้ขอเปลี่ยนจำนวนงวด / ค่างวด / ดอกเบี้ย / พักชำระ
--   restructure_loan_schedule(): ทำในครั้งเดียว (atomic)
--     1) งวดที่รับครบแล้ว → เก็บไว้เหมือนเดิม
--     2) งวดที่รับบางส่วน → ตัดให้เหลือเฉพาะส่วนที่รับแล้ว (จะกลายเป็น "รับแล้ว")
--        ส่วนที่ยังค้าง: เงินต้นอยู่ในเงินต้นคงเหลือ · ดอกเบี้ยค้าง หน้าจอรวมเข้างวดแรกของตารางใหม่ (เลือกได้)
--     3) งวดที่ยังไม่ได้รับเลย → ลบ (soft delete)
--     4) ใส่งวดใหม่ต่อเลขงวดเดิม
--   ผล: ยอดเงินต้นตามตาราง (งวดเดิมที่เก็บ + งวดใหม่) ยังสอดคล้องกับเงินต้นคงเหลือจริง
--       ดอกเบี้ยที่รับไปแล้วไม่ถูกนำไปหักกับงวดใหม่ (ต่างจาก set_loan_schedule ที่แทนที่ทั้งชุด)
-- รันซ้ำได้ (DROP FUNCTION IF EXISTS / CREATE)
-- =====================================================================

DROP FUNCTION IF EXISTS public.restructure_loan_schedule(uuid, jsonb, text);
CREATE FUNCTION public.restructure_loan_schedule(p_loan_asset_id uuid, p_lines jsonb, p_note text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  r record; v_open jsonb; v_cut uuid[] := '{}'; v_paid_max date; v_next_no integer; v_count integer; v_first date;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'INVALID: ตารางใหม่ต้องมีอย่างน้อย 1 งวด' USING ERRCODE = '22023';
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
  IF NOT EXISTS (SELECT 1 FROM public.loan_schedule_lines WHERE loan_asset_id = p_loan_asset_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: สัญญานี้ยังไม่มีตารางผ่อน — ใช้ "ตั้งตารางผ่อน" แทน' USING ERRCODE = '22023';
  END IF;

  -- ล็อกงวดของสัญญานี้ระหว่างปรับ (กันกดซ้อนกัน)
  PERFORM 1 FROM public.loan_schedule_lines WHERE loan_asset_id = p_loan_asset_id AND deleted_at IS NULL FOR UPDATE;

  -- 1–3) งวดที่ยังไม่ครบ: ตัดเหลือส่วนที่รับแล้ว หรือ ลบถ้ายังไม่ได้รับเลย
  --    (อ่านสถานะทั้งหมดก่อน แล้วค่อยแก้ — สถานะคำนวณสะสม ถ้าแก้ไปอ่านไปจะเพี้ยน)
  SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO v_open
    FROM (SELECT id, principal_due, interest_due, principal_remaining, interest_remaining
            FROM public.v_loan_schedule_status
           WHERE loan_asset_id = p_loan_asset_id AND total_remaining > 0.005) s;
  FOR r IN SELECT (e->>'id')::uuid AS id, (e->>'principal_due')::numeric AS principal_due, (e->>'interest_due')::numeric AS interest_due,
                  (e->>'principal_remaining')::numeric AS principal_remaining, (e->>'interest_remaining')::numeric AS interest_remaining
             FROM jsonb_array_elements(v_open) e
  LOOP
    IF r.principal_due - r.principal_remaining + r.interest_due - r.interest_remaining > 0.005 THEN
      UPDATE public.loan_schedule_lines
         SET principal_due = round(r.principal_due - r.principal_remaining, 2),
             interest_due  = round(r.interest_due - r.interest_remaining, 2),
             notes = concat_ws(' · ', nullif(notes, ''), 'ปรับตาราง: เหลือเฉพาะส่วนที่รับแล้ว')
       WHERE id = r.id;
      v_cut := v_cut || r.id;
    ELSE
      UPDATE public.loan_schedule_lines SET deleted_at = now() WHERE id = r.id;
    END IF;
  END LOOP;

  SELECT coalesce(max(installment_no), 0) + 1 INTO v_next_no
    FROM public.loan_schedule_lines WHERE loan_asset_id = p_loan_asset_id AND deleted_at IS NULL;
  -- งวดใหม่ต้องอยู่หลังงวดที่รับครบแล้ว (งวดที่ถูกตัดเหลือส่วนที่รับแล้ว อยู่ก่อนวันเริ่มตารางใหม่ได้)
  SELECT max(due_date) INTO v_paid_max FROM public.loan_schedule_lines
   WHERE loan_asset_id = p_loan_asset_id AND deleted_at IS NULL AND NOT (id = ANY (v_cut));
  SELECT min((x->>'due_date')::date) INTO v_first FROM jsonb_array_elements(p_lines) x;
  IF v_paid_max IS NOT NULL AND v_first <= v_paid_max THEN
    RAISE EXCEPTION 'INVALID: งวดแรกของตารางใหม่ต้องอยู่หลังงวดที่รับครบแล้ว (%)', to_char(v_paid_max, 'DD/MM/YYYY')
      USING ERRCODE = '22023';
  END IF;

  -- 4) งวดใหม่ ต่อเลขงวดเดิม · หมายเหตุการปรับอยู่ที่งวดแรก
  INSERT INTO public.loan_schedule_lines(loan_asset_id, installment_no, due_date, principal_due, interest_due, notes)
  SELECT p_loan_asset_id,
         v_next_no - 1 + row_number() OVER (ORDER BY (x->>'due_date')::date, ord),
         (x->>'due_date')::date,
         round(coalesce(nullif(x->>'principal', '')::numeric, 0), 2),
         round(coalesce(nullif(x->>'interest', '')::numeric, 0), 2),
         CASE WHEN row_number() OVER (ORDER BY (x->>'due_date')::date, ord) = 1
              THEN concat_ws(' · ', 'ปรับตาราง ' || to_char(current_date, 'DD/MM/YYYY'), v_note, nullif(trim(x->>'notes'), ''))
              ELSE nullif(trim(x->>'notes'), '') END
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(x, ord);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.restructure_loan_schedule(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restructure_loan_schedule(uuid, jsonb, text) TO authenticated;
