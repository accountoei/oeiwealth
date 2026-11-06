-- =====================================================================
-- กรมธรรม์เล่มเดียวกัน (สัญญาหลัก + สัญญาเพิ่มเติม · ตกลง 6 พ.ย. 2026)
--   สัญญาเพิ่มเติมบันทึกเป็นอีกรายการ (บริษัท + เลขกรมธรรม์เดียวกัน) เพื่อให้ IRR / ภาษีแยกถูก
--   จ่ายเบี้ยทั้งเล่มในครั้งเดียว (บัญชี / บัตรเดียวกัน · วันเดียวกัน) = ค่าใช้จ่ายหลายรายการ
--   → ผูกเป็นชุดเดียว เพื่อให้หน้าบัญชีธนาคาร / บัตรเครดิต แสดงยอดรวมแถวเดียวตรงกับ Statement
--   ภาษี / IRR / งวดเบี้ย ยังนับแยกทีละรายการเหมือนเดิม (ชุดใช้แสดงผลเท่านั้น)
-- =====================================================================

-- 1) ชุดการจ่าย (ค่าใช้จ่ายหลายรายการที่จ่ายพร้อมกัน) · ไม่มีชุด = NULL
ALTER TABLE public.expense_items ADD COLUMN IF NOT EXISTS payment_group_id uuid;
COMMENT ON COLUMN public.expense_items.payment_group_id IS
  'ชุดการจ่ายเบี้ยประกันเล่มเดียวกันที่จ่ายพร้อมกัน (บัญชี / บัตร / วันเดียวกัน) · ใช้แสดงยอดรวมแถวเดียวในหน้าบัญชี / บัตร';

-- 2) ผูกเบี้ยที่จ่ายแล้วเป็นชุดเดียว (ตั้ง payment_group_id + movement_group_id ของเงินออกจากบัญชีที่ระบบสร้าง)
--    เงื่อนไข: ทุกรายการเป็นการจ่ายเบี้ยประกัน · กรมธรรม์เล่มเดียวกัน (บริษัท + เลขกรมธรรม์) · วัน / สกุล / บัญชีหรือบัตรเดียวกัน
--    SECURITY DEFINER: เงินออกจากบัญชีเป็นรายการที่ระบบสร้าง (ผู้ใช้แก้ตรงไม่ได้) · ตรวจสิทธิ์เองก่อนเสมอ
CREATE OR REPLACE FUNCTION private.link_premium_payments(p_expense_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ids uuid[]; v_found integer; v_keys integer; v_group uuid := gen_random_uuid();
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(coalesce(p_expense_ids, '{}'::uuid[])) x WHERE x IS NOT NULL;
  IF coalesce(array_length(v_ids, 1), 0) < 2 THEN RETURN NULL; END IF;

  SELECT count(*),
         count(DISTINCT (e.date, e.currency, coalesce(e.paid_from_asset_id::text, ''), coalesce(e.paid_from_credit_card_id::text, ''),
                         lower(btrim(p.insurer)), upper(regexp_replace(p.policy_no, '\s', '', 'g'))))
    INTO v_found, v_keys
    FROM public.expense_items e
    JOIN public.insurance_schedule_lines l ON l.id = e.insurance_schedule_line_id AND l.kind = 'PREMIUM'
    JOIN public.insurance_policies p ON p.id = l.policy_id AND p.deleted_at IS NULL
   WHERE e.id = ANY (v_ids) AND e.deleted_at IS NULL
     AND nullif(btrim(p.policy_no), '') IS NOT NULL
     AND (e.paid_from_asset_id IS NOT NULL OR e.paid_from_credit_card_id IS NOT NULL);
  IF v_found <> array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'INVALID: ผูกชุดได้เฉพาะการจ่ายเบี้ยประกันที่มีเลขกรมธรรม์ และจ่ายจากบัญชีหรือบัตร' USING ERRCODE = '22023';
  END IF;
  IF v_keys <> 1 THEN
    RAISE EXCEPTION 'INVALID: ผูกชุดได้เฉพาะเบี้ยของกรมธรรม์เล่มเดียวกัน ที่จ่ายวันเดียวกันจากบัญชี / บัตรเดียวกัน' USING ERRCODE = '22023';
  END IF;

  UPDATE public.expense_items SET payment_group_id = v_group WHERE id = ANY (v_ids);
  UPDATE public.cash_movements SET movement_group_id = v_group
   WHERE is_derived AND source_entity_type = 'EXPENSE' AND source_entity_id = ANY (v_ids) AND deleted_at IS NULL;
  RETURN v_group;
END $$;
REVOKE ALL ON FUNCTION private.link_premium_payments(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.link_premium_payments(uuid[]) TO authenticated;

-- 3) จ่ายเบี้ยหลายงวด (หลายกรมธรรม์) · เพิ่ม "group" ต่อแถว (ไม่บังคับ)
--    แถวที่ group เดียวกัน + วัน / สกุล / บัญชีหรือบัตรเดียวกัน (ตั้งแต่ 2 แถว) → ผูกเป็นชุดเดียวหลังบันทึกครบ
-- p_rows: [ { policy_id, label, group?, + jsonb เดียวกับ add_expense: date, description, amount, currency, expense_category,
--             paid_from_asset_id | paid_from_credit_card_id, insurance_schedule_line_id, notes } ]
CREATE OR REPLACE FUNCTION public.batch_pay_insurance_premiums(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_label text; v_policy uuid; v_line uuid; v_policies uuid[] := '{}';
        v_exp uuid; v_key text; v_sets jsonb := '{}'::jsonb; v_set text; v_ids uuid[];
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_label  := coalesce(nullif(trim(r->>'label'), ''), 'รายการ');
    v_policy := nullif(r->>'policy_id', '')::uuid;
    v_line   := nullif(r->>'insurance_schedule_line_id', '')::uuid;
    IF v_line IS NULL OR NOT EXISTS (SELECT 1 FROM public.insurance_schedule_lines
                                      WHERE id = v_line AND policy_id = v_policy AND kind = 'PREMIUM' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'INVALID: % · ไม่พบงวดเบี้ยของกรมธรรม์นี้', v_label USING ERRCODE = '22023';
    END IF;
    IF num_nonnulls(nullif(r->>'paid_from_asset_id', ''), nullif(r->>'paid_from_credit_card_id', '')) = 0 THEN
      RAISE EXCEPTION 'INVALID: % · กรุณาเลือกบัญชี / บัตรที่จ่าย', v_label USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_exp := public.add_expense((r - 'policy_id' - 'label' - 'group') || jsonb_build_object('expense_category', 'ประกัน'));
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '%', private.batch_row_error(v_label, SQLERRM) USING ERRCODE = SQLSTATE;
    END;
    IF nullif(trim(r->>'group'), '') IS NOT NULL THEN
      v_key := concat_ws('|', trim(r->>'group'), r->>'date', upper(coalesce(r->>'currency', '')),
                         coalesce(nullif(r->>'paid_from_asset_id', ''), '-'), coalesce(nullif(r->>'paid_from_credit_card_id', ''), '-'));
      v_sets := jsonb_set(v_sets, ARRAY[v_key], coalesce(v_sets->v_key, '[]'::jsonb) || to_jsonb(v_exp::text));
    END IF;
    IF NOT v_policy = ANY (v_policies) THEN v_policies := v_policies || v_policy; END IF;
    v_n := v_n + 1;
  END LOOP;
  -- ผูกชุด (ตั้งแต่ 2 รายการ) · ผิดเงื่อนไข = ไม่บันทึกเลยทั้งชุด
  FOR v_set IN SELECT k FROM jsonb_object_keys(v_sets) k LOOP
    SELECT array_agg(x::uuid) INTO v_ids FROM jsonb_array_elements_text(v_sets->v_set) x;
    IF array_length(v_ids, 1) >= 2 THEN PERFORM private.link_premium_payments(v_ids); END IF;
  END LOOP;
  FOREACH v_policy IN ARRAY v_policies LOOP
    PERFORM public.sync_insurance_cash_value(v_policy);
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_pay_insurance_premiums(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_pay_insurance_premiums(jsonb) TO authenticated;
