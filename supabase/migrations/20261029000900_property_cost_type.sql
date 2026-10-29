-- =====================================================================
-- Property รอบ 9 (ตกลง 29 ต.ค. 2026)
--   1) ประเภทค่าใช้จ่ายของทรัพย์สิน (expense_items.property_cost_type)
--        ไฟฟ้า · ประปา · ค่าส่วนกลาง · ภาษีที่ดิน · ซ่อมแซม / ปรับปรุง · ค่าธรรมเนียม / ภาษีโอน · อื่น ๆ
--        หมวดหลักยังเป็น "บ้าน / สาธารณูปโภค" (รายงานรวมตามหมวดเหมือนเดิม · แยกย่อยตามประเภท)
--        บันทึกจ่ายค่าใช้จ่ายประจำ → ประเภทตามรายการประจำให้เอง · รายการเดิมไม่แก้ (ว่าง = ไม่ระบุ)
--   2) จ่ายซื้อที่ดินเพิ่ม (โฉนดใหม่): เก็บ เล่ม · หน้า · ระวาง · หน้าสำรวจ ด้วย (pay_property · พารามิเตอร์เดิม)
-- รันซ้ำได้
-- =====================================================================

-- 1) คอลัมน์ ------------------------------------------------------------------------------------------------
ALTER TABLE public.expense_items ADD COLUMN IF NOT EXISTS property_cost_type text;
ALTER TABLE public.expense_items DROP CONSTRAINT IF EXISTS expense_items_property_cost_type_check;
ALTER TABLE public.expense_items ADD CONSTRAINT expense_items_property_cost_type_check
  CHECK (property_cost_type IN ('ELECTRICITY','WATER','COMMON_FEE','LAND_TAX','REPAIR','TRANSFER_FEE','OTHER'));

-- 2) add_expense: รับ property_cost_type (batch_add_property_expenses ส่งต่อทั้งแถวอยู่แล้ว) --------------------------
CREATE OR REPLACE FUNCTION public.add_expense(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_date date := nullif(p->>'date', '')::date; v_id uuid; v_ccy text; v_bank uuid; v_card uuid; v_hold uuid;
        v_util uuid := nullif(p->>'property_utility_id', '')::uuid; v_period date; v_related uuid;
        v_ins uuid := nullif(p->>'insurance_schedule_line_id', '')::uuid; v_cat text := nullif(trim(p->>'expense_category'), '');
        v_rexp uuid := nullif(p->>'recurring_expense_id', '')::uuid; v_rcat text;
        v_ptype text := upper(nullif(trim(p->>'property_cost_type'), ''));
BEGIN
  IF v_date IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่วันที่' USING ERRCODE = '22023'; END IF;
  IF v_date > current_date THEN RAISE EXCEPTION 'INVALID: วันที่เป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p->>'description', ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่รายละเอียด' USING ERRCODE = '22023';
  END IF;
  IF (v_util IS NOT NULL)::int + (v_ins IS NOT NULL)::int + (v_rexp IS NOT NULL)::int > 1 THEN
    RAISE EXCEPTION 'INVALID: ผูกได้ทีละอย่าง (ค่าใช้จ่ายประจำ หรือ เบี้ยประกัน)' USING ERRCODE = '22023';
  END IF;
  v_bank := nullif(p->>'paid_from_asset_id', '')::uuid;
  v_card := nullif(p->>'paid_from_credit_card_id', '')::uuid;
  v_ccy := upper(coalesce(nullif(p->>'currency', ''), 'THB'));
  IF v_bank IS NOT NULL THEN SELECT currency INTO v_ccy FROM public.assets WHERE id = v_bank; END IF;
  IF v_card IS NOT NULL THEN SELECT currency INTO v_ccy FROM public.credit_cards WHERE id = v_card; END IF;
  v_hold := nullif(p->>'paid_from_cash_holding_id', '')::uuid;
  IF v_hold IS NOT NULL THEN
    IF v_bank IS NOT NULL OR v_card IS NOT NULL THEN RAISE EXCEPTION 'INVALID: เลือกจ่ายจากได้ทางเดียว' USING ERRCODE = '22023'; END IF;
    SELECT currency INTO v_ccy FROM public.investment_holdings WHERE id = v_hold AND holding_type = 'CASH' AND deleted_at IS NULL;
    IF v_ccy IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัญชีเงินฝากในพอร์ต' USING ERRCODE = '22023'; END IF;
  END IF;
  v_related := nullif(p->>'related_asset_id', '')::uuid;

  -- เบี้ยประกันตามตาราง: ต้องเป็นงวดเบี้ย (PREMIUM) ของกรมธรรม์ที่ยังไม่ถูกลบ · หมวดตั้งต้น "ประกัน"
  IF v_ins IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.insurance_schedule_lines l JOIN public.insurance_policies ip ON ip.id = l.policy_id
                    WHERE l.id = v_ins AND l.kind = 'PREMIUM' AND l.deleted_at IS NULL AND ip.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'NOT_FOUND: ไม่พบงวดเบี้ยประกัน' USING ERRCODE = '22023';
    END IF;
    v_cat := coalesce(v_cat, 'ประกัน');
  END IF;

  -- ค่าใช้จ่ายประจำของอสังหาฯ: ต้องระบุงวด · ผูกทรัพย์สินให้เองถ้าไม่ได้ส่งมา
  IF v_util IS NOT NULL THEN
    v_period := date_trunc('month', coalesce(nullif(p->>'cost_period', '')::date, v_date))::date;
    SELECT pd.asset_id INTO v_related
      FROM public.property_utilities u JOIN public.property_details pd ON pd.id = u.property_id
     WHERE u.id = v_util AND u.deleted_at IS NULL;
    IF v_related IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการค่าใช้จ่ายประจำ' USING ERRCODE = '22023'; END IF;
    -- ประเภทตามรายการประจำ (ไฟฟ้า / ประปา / ส่วนกลาง / ภาษีที่ดิน / อื่น ๆ) เมื่อไม่ได้ส่งมา
    SELECT coalesce(v_ptype, u.utility_type) INTO v_ptype FROM public.property_utilities u WHERE u.id = v_util;
  END IF;
  IF v_ptype IS NOT NULL AND v_ptype NOT IN ('ELECTRICITY','WATER','COMMON_FEE','LAND_TAX','REPAIR','TRANSFER_FEE','OTHER') THEN
    RAISE EXCEPTION 'INVALID: ประเภทค่าใช้จ่ายไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  -- ค่าใช้จ่ายประจำทั่วไป: ต้องระบุงวด · หมวดตั้งต้นจากรายการประจำ
  IF v_rexp IS NOT NULL THEN
    v_period := date_trunc('month', coalesce(nullif(p->>'cost_period', '')::date, v_date))::date;
    SELECT t.expense_category INTO v_rcat FROM public.recurring_expense_templates t WHERE t.id = v_rexp AND t.deleted_at IS NULL;
    IF v_rcat IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการค่าใช้จ่ายประจำ' USING ERRCODE = '22023'; END IF;
    v_cat := coalesce(v_cat, v_rcat);
  END IF;

  INSERT INTO public.expense_items(monthly_expense_id, related_asset_id, paid_from_asset_id, paid_from_credit_card_id, paid_from_cash_holding_id,
              person_id, date, description, amount, currency, expense_category, is_reimbursable,
              expected_reimbursement_amount, notes, property_utility_id, cost_period, insurance_schedule_line_id, recurring_expense_id,
              property_cost_type)
  VALUES (private.expense_month_id(v_date), v_related, v_bank, v_card, v_hold,
          nullif(p->>'person_id', '')::uuid,   -- ระบุคนเองได้เสมอ (ใช้ก่อนเจ้าของบัญชี / บัตร)
          v_date, trim(p->>'description'), (p->>'amount')::numeric, v_ccy, v_cat,
          coalesce((p->>'is_reimbursable')::boolean, false),
          CASE WHEN coalesce((p->>'is_reimbursable')::boolean, false)
               THEN coalesce(nullif(p->>'expected_reimbursement_amount', '')::numeric, (p->>'amount')::numeric) END,
          nullif(trim(p->>'notes'), ''), v_util, v_period, v_ins, v_rexp, v_ptype)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.add_expense(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_expense(jsonb) TO authenticated;

-- 3) pay_property: ที่ดินแถวใหม่เก็บรายละเอียดโฉนดครบ ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_property(p_asset_id uuid, p_bank_asset_id uuid, p_date date, p_amount numeric, p_fee numeric,
  p_description text, p_add_value boolean, p_component_id uuid, p_new_component jsonb,
  p_card_id uuid DEFAULT NULL, p_cash_person_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_pid uuid; v_ccy text; v_comp uuid; v_type text; v_label text; v_mv uuid; v_meta jsonb := '{}';
BEGIN
  SELECT pd.id INTO v_pid FROM public.property_details pd WHERE pd.asset_id = p_asset_id AND pd.deleted_at IS NULL;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบทรัพย์สิน' USING ERRCODE = '22023'; END IF;
  IF num_nonnulls(p_bank_asset_id, p_card_id, p_cash_person_id) <> 1 THEN
    RAISE EXCEPTION 'INVALID: เลือกจ่ายจากบัญชี บัตรเครดิต หรือเงินสด อย่างใดอย่างหนึ่ง' USING ERRCODE = '22023';
  END IF;
  IF p_bank_asset_id IS NOT NULL THEN
    SELECT a.currency INTO v_ccy FROM public.assets a WHERE a.id = p_bank_asset_id AND a.deleted_at IS NULL;
    IF v_ccy IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัญชีที่จ่าย' USING ERRCODE = '22023'; END IF;
  ELSIF p_card_id IS NOT NULL THEN
    SELECT c.currency INTO v_ccy FROM public.credit_cards c WHERE c.id = p_card_id AND c.deleted_at IS NULL;
    IF v_ccy IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัตรที่จ่าย' USING ERRCODE = '22023'; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = p_cash_person_id AND p.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'NOT_FOUND: ไม่พบผู้จ่าย' USING ERRCODE = '22023';
    END IF;
    SELECT a.currency INTO v_ccy FROM public.assets a WHERE a.id = p_asset_id;
    v_meta := jsonb_build_object('paid_via', 'cash', 'person_id', p_cash_person_id);
  END IF;
  IF p_bank_asset_id IS NULL AND coalesce(p_fee, 0) <> 0 THEN
    RAISE EXCEPTION 'INVALID: ค่าธรรมเนียมใช้กับการจ่ายจากบัญชีเท่านั้น' USING ERRCODE = '22023';
  END IF;
  IF p_component_id IS NULL AND p_new_component IS NULL THEN
    RAISE EXCEPTION 'INVALID: กรุณาเลือกแถวของรายการจ่าย (ที่ดิน / อาคาร / แถวใหม่)' USING ERRCODE = '22023';
  END IF;
  IF p_component_id IS NOT NULL THEN
    SELECT d.id INTO v_comp FROM public.property_deeds d WHERE d.id = p_component_id AND d.property_id = v_pid AND d.deleted_at IS NULL AND d.ended_date IS NULL;
    IF v_comp IS NULL THEN RAISE EXCEPTION 'INVALID: ส่วนประกอบนี้ไม่ใช่ของทรัพย์สินนี้ หรือขาย / รื้อถอนแล้ว' USING ERRCODE = '22023'; END IF;
  ELSIF p_new_component IS NOT NULL THEN
    v_type := coalesce(nullif(p_new_component->>'type', ''), 'LAND');
    IF v_type NOT IN ('LAND','BUILDING','OTHER') THEN RAISE EXCEPTION 'INVALID: ชนิดส่วนประกอบไม่ถูกต้อง' USING ERRCODE = '22023'; END IF;
    v_label := nullif(trim(p_new_component->>'label'), '');
    IF v_type = 'LAND' AND num_nonnulls(nullif(trim(p_new_component->>'title_deed_no'), ''), nullif(trim(p_new_component->>'land_no'), ''),
                                       nullif(p_new_component->>'land_area_sq_wa', ''), v_label) = 0 THEN
      RAISE EXCEPTION 'INVALID: ที่ดินที่ซื้อเพิ่ม ใส่เลขที่โฉนด เลขที่ดิน หรือเนื้อที่ อย่างน้อย 1 ช่อง' USING ERRCODE = '22023';
    END IF;
    IF v_type <> 'LAND' AND v_label IS NULL THEN RAISE EXCEPTION 'INVALID: ใส่ชื่ออาคาร / สิ่งปลูกสร้าง' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.property_deeds(property_id, sort_order, component_type, label, title_type, title_deed_no, land_no, land_area_sq_wa,
                                      deed_book, deed_page, map_sheet, survey_page, building_area_sqm, useful_life_years, acquired_date)
    VALUES (v_pid, coalesce((SELECT max(d.sort_order) FROM public.property_deeds d WHERE d.property_id = v_pid AND d.deleted_at IS NULL), 0) + 1,
            v_type, v_label,
            CASE WHEN v_type = 'LAND' THEN coalesce(nullif(trim(p_new_component->>'title_type'), ''), 'โฉนด') END,
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'title_deed_no'), '') END,
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'land_no'), '') END,
            CASE WHEN v_type = 'LAND' THEN nullif(p_new_component->>'land_area_sq_wa', '')::numeric END,
            -- เล่ม · หน้า · ระวาง · หน้าสำรวจ (ตกลง 29 ต.ค. 2026)
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'deed_book'), '') END,
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'deed_page'), '') END,
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'map_sheet'), '') END,
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'survey_page'), '') END,
            CASE WHEN v_type <> 'LAND' THEN nullif(p_new_component->>'building_area_sqm', '')::numeric END,
            CASE WHEN v_type <> 'LAND' THEN coalesce(nullif(p_new_component->>'useful_life_years', '')::integer, 20) END,
            p_date)
    RETURNING id INTO v_comp;
  END IF;
  IF p_add_value THEN v_meta := v_meta || '{"add_value": true}'; END IF;
  IF v_comp IS NOT NULL THEN v_meta := v_meta || jsonb_build_object('component_id', v_comp); END IF;
  INSERT INTO public.cash_movements(movement_date, movement_type, from_asset_id, from_credit_card_id, to_asset_id, amount, fee, currency, description, metadata)
  VALUES (p_date, 'ASSET_PURCHASE', p_bank_asset_id, p_card_id, p_asset_id, p_amount, CASE WHEN p_bank_asset_id IS NOT NULL THEN p_fee END, v_ccy,
          coalesce(nullif(trim(p_description), ''), 'จ่ายซื้อทรัพย์สิน'), CASE WHEN v_meta = '{}' THEN NULL ELSE v_meta END)
  RETURNING id INTO v_mv;
  IF p_new_component IS NOT NULL AND p_component_id IS NULL THEN
    UPDATE public.property_deeds SET source_movement_id = v_mv WHERE id = v_comp;
  END IF;
  RETURN v_mv;
END $$;
REVOKE ALL ON FUNCTION public.pay_property(uuid, uuid, date, numeric, numeric, text, boolean, uuid, jsonb, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_property(uuid, uuid, date, numeric, numeric, text, boolean, uuid, jsonb, uuid, uuid) TO authenticated;
