-- =====================================================================
-- Property: จ่ายซื้อ / จ่ายเพิ่ม ด้วยบัตรเครดิต หรือเงินสด (ตกลง 29 ต.ค. 2026)
--   เดิม: รายการจ่ายซื้อทรัพย์สิน (ASSET_PURCHASE) ต้องออกจากบัญชีธนาคารเท่านั้น
--   ใหม่: ต้นทาง = บัญชี 1 ใน 3 แบบ
--     · บัญชีธนาคาร (from_asset_id)                      → ยอดบัญชีลด
--     · บัตรเครดิต (from_credit_card_id · คอลัมน์ใหม่)     → ยอดบัตรค้างจ่ายเพิ่ม (Net Worth ไม่เปลี่ยน)
--     · เงินสด (metadata.paid_via = 'cash' + person_id)    → ไม่ผ่านบัญชีใด (เหมือนค่าใช้จ่ายเงินสด)
--   ไม่มีค่าธรรมเนียมเมื่อจ่ายด้วยบัตร / เงินสด · มูลค่า / ต้นทุน / ราคาขายขั้นต่ำ ทำงานเหมือนจ่ายจากบัญชี
--   ยอดบัตร (card_activity) นับรายการนี้ → Net Worth · หน้า Liabilities · ก้อนรอแยก ปรับตามเอง
-- รันซ้ำได้
-- =====================================================================

-- 1) คอลัมน์ + เงื่อนไขทิศทาง ------------------------------------------------------------------------------
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS from_credit_card_id uuid REFERENCES public.credit_cards(id);
CREATE INDEX IF NOT EXISTS cm_from_card_idx ON public.cash_movements(from_credit_card_id, movement_date) WHERE from_credit_card_id IS NOT NULL;

ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS cm_from_card;
ALTER TABLE public.cash_movements ADD CONSTRAINT cm_from_card CHECK (from_credit_card_id IS NULL OR movement_type = 'ASSET_PURCHASE');

ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS cm_direction;
ALTER TABLE public.cash_movements ADD CONSTRAINT cm_direction CHECK (CASE
    WHEN movement_type IN ('INCOME','OTHER_IN','REIMBURSEMENT_IN','SECURITY_DEPOSIT_IN')
      THEN from_asset_id IS NULL AND to_asset_id IS NOT NULL
    WHEN movement_type IN ('EXPENSE','OTHER_OUT','SECURITY_DEPOSIT_OUT','CARD_PAYMENT','LIABILITY_PAYMENT')
      THEN from_asset_id IS NOT NULL AND to_asset_id IS NULL
    -- ซื้อทรัพย์สิน: ต้นทางแบบเดียว (บัญชี / บัตร / เงินสด)
    WHEN movement_type = 'ASSET_PURCHASE'
      THEN to_asset_id IS NOT NULL
       AND (CASE WHEN from_asset_id IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN from_credit_card_id IS NOT NULL THEN 1 ELSE 0 END
            + CASE WHEN metadata->>'paid_via' = 'cash' THEN 1 ELSE 0 END) = 1
    ELSE from_asset_id IS NOT NULL AND to_asset_id IS NOT NULL END);

-- 2) ตรวจรายการเงิน: ซื้อทรัพย์สินด้วยบัตร / เงินสด ไม่ต้องมีบัญชีธนาคาร ---------------------------------------
CREATE OR REPLACE FUNCTION private.tg_cash_movement_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  fa public.assets; ta public.assets; c public.investment_holdings;
  v_from_bank boolean; v_to_bank boolean; v_ccy text; v_pf uuid; v_pf_ccy text; v_to_ccy text;
  v_inv boolean := NEW.movement_type IN ('INVESTMENT_OUT','INVESTMENT_IN');
  -- ซื้อ / จ่ายเพิ่มทรัพย์สินด้วยบัตรเครดิต หรือเงินสด (ไม่ผ่านบัญชี · ตกลง 29 ต.ค. 2026)
  v_off boolean := NEW.movement_type = 'ASSET_PURCHASE' AND NEW.from_asset_id IS NULL;
BEGIN
  NEW.family_id := coalesce(NEW.family_id, private.default_family_id());
  IF NEW.from_asset_id IS NOT NULL THEN SELECT * INTO fa FROM public.assets WHERE id = NEW.from_asset_id; END IF;
  IF NEW.to_asset_id   IS NOT NULL THEN SELECT * INTO ta FROM public.assets WHERE id = NEW.to_asset_id;   END IF;
  v_from_bank := NEW.from_asset_id IS NOT NULL AND private.is_bank_asset(NEW.from_asset_id);
  v_to_bank   := NEW.to_asset_id   IS NOT NULL AND private.is_bank_asset(NEW.to_asset_id);

  -- อย่างน้อย 1 ฝั่งเป็นบัญชีธนาคาร; ฝั่งที่เป็นบัญชีตามประเภท
  IF NOT (v_from_bank OR v_to_bank OR v_off) THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: ต้องมีบัญชีธนาคารอย่างน้อย 1 ฝั่ง' USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type IN ('TRANSFER','FX_EXCHANGE') AND NOT (v_from_bank AND v_to_bank) THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: % ต้องเป็นบัญชีธนาคารทั้งสองฝั่ง', NEW.movement_type USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type IN ('EXPENSE','OTHER_OUT','SECURITY_DEPOSIT_OUT','CARD_PAYMENT','LIABILITY_PAYMENT',
                           'INVESTMENT_OUT','LOAN_DISBURSEMENT','ASSET_PURCHASE') AND NOT v_from_bank AND NOT v_off THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: % ต้องออกจากบัญชีธนาคาร', NEW.movement_type USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type IN ('INCOME','OTHER_IN','REIMBURSEMENT_IN','SECURITY_DEPOSIT_IN',
                           'INVESTMENT_IN','LOAN_PRINCIPAL_RECEIPT','ASSET_SALE') AND NOT v_to_bank THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: % ต้องเข้าบัญชีธนาคาร', NEW.movement_type USING ERRCODE = '22023';
  END IF;
  -- คู่สินทรัพย์ฝั่งตรงข้าม
  IF NEW.movement_type = 'INVESTMENT_OUT' AND ta.asset_group <> 'INVESTMENT' OR
     NEW.movement_type = 'INVESTMENT_IN'  AND fa.asset_group <> 'INVESTMENT' THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: INVESTMENT_OUT/IN ต้องคู่กับพอร์ตลงทุน' USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type = 'LOAN_DISBURSEMENT'      AND ta.asset_type <> 'LOAN_RECEIVABLE' OR
     NEW.movement_type = 'LOAN_PRINCIPAL_RECEIPT' AND fa.asset_type <> 'LOAN_RECEIVABLE' THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: เงินให้กู้ต้องคู่กับ Asset ประเภท LOAN_RECEIVABLE' USING ERRCODE = '22023';
  END IF;
  IF NEW.movement_type = 'ASSET_PURCHASE' AND (v_to_bank OR ta.asset_type IN ('INVESTMENT_PORTFOLIO','LOAN_RECEIVABLE')) OR
     NEW.movement_type = 'ASSET_SALE'     AND (v_from_bank OR fa.asset_type IN ('INVESTMENT_PORTFOLIO','LOAN_RECEIVABLE')) THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: ซื้อ/ขายสินทรัพย์ต้องคู่กับ Property / Alternative / Business' USING ERRCODE = '22023';
  END IF;

  -- บัญชีเงินฝากในพอร์ต (เฉพาะโอนพอร์ต): ต้องเป็นเงินฝากของพอร์ตนั้น · สกุลของฝั่งพอร์ต = สกุลบัญชีนั้น
  IF v_inv THEN
    v_pf := private.portfolio_of_asset(CASE NEW.movement_type WHEN 'INVESTMENT_OUT' THEN NEW.to_asset_id ELSE NEW.from_asset_id END);
    IF NEW.cash_holding_id IS NULL AND NEW.counter_currency IS NOT NULL THEN
      NEW.cash_holding_id := private.default_cash_holding(v_pf,
        CASE NEW.movement_type WHEN 'INVESTMENT_OUT' THEN NEW.counter_currency ELSE NEW.currency END);
    END IF;
    IF NEW.cash_holding_id IS NOT NULL THEN
      SELECT * INTO c FROM public.investment_holdings WHERE id = NEW.cash_holding_id;
      IF c.portfolio_id IS DISTINCT FROM v_pf OR c.holding_type <> 'CASH' OR c.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVALID: บัญชีเงินฝากไม่ได้อยู่ในพอร์ตนี้' USING ERRCODE = '22023';
      END IF;
      v_pf_ccy := c.currency;
    END IF;
  ELSIF NEW.cash_holding_id IS NOT NULL OR coalesce(NEW.counter_fee, 0) <> 0 THEN
    RAISE EXCEPTION 'INVALID: บัญชีเงินฝากในพอร์ต / ค่าธรรมเนียมปลายทาง ใช้กับการโอนพอร์ตเท่านั้น' USING ERRCODE = '22023';
  END IF;

  -- สกุลเงิน (Section 25A โครงสร้าง Movement)
  IF NEW.from_asset_id IS NOT NULL
     AND (CASE WHEN NEW.movement_type = 'INVESTMENT_IN' AND v_pf_ccy IS NOT NULL THEN v_pf_ccy ELSE fa.currency END) <> NEW.currency THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: สกุลต้นทาง (%) ต้องเท่ากับ currency (%)',
      CASE WHEN NEW.movement_type = 'INVESTMENT_IN' AND v_pf_ccy IS NOT NULL THEN v_pf_ccy ELSE fa.currency END, NEW.currency
      USING ERRCODE = '22023';
  END IF;
  v_to_ccy := CASE WHEN NEW.movement_type = 'FX_EXCHANGE' OR (v_inv AND NEW.counter_currency IS NOT NULL)
                   THEN NEW.counter_currency ELSE NEW.currency END;
  IF NEW.to_asset_id IS NOT NULL
     AND (CASE WHEN NEW.movement_type = 'INVESTMENT_OUT' AND v_pf_ccy IS NOT NULL THEN v_pf_ccy ELSE ta.currency END) <> v_to_ccy THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: สกุลปลายทาง (%) ไม่ตรงกับรายการ',
      CASE WHEN NEW.movement_type = 'INVESTMENT_OUT' AND v_pf_ccy IS NOT NULL THEN v_pf_ccy ELSE ta.currency END
      USING ERRCODE = '22023';
  END IF;
  IF coalesce(NEW.fee, 0) > 0 AND NEW.fee_currency <> NEW.currency THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: fee_currency ต้องเท่ากับสกุลบัญชีต้นทาง' USING ERRCODE = '22023';
  END IF;
  IF v_off THEN
    IF coalesce(NEW.fee, 0) <> 0 THEN
      RAISE EXCEPTION 'INVALID: ค่าธรรมเนียมใช้กับการจ่ายจากบัญชีเท่านั้น' USING ERRCODE = '22023';
    END IF;
    IF NEW.from_credit_card_id IS NOT NULL THEN
      SELECT currency INTO v_ccy FROM public.credit_cards WHERE id = NEW.from_credit_card_id AND deleted_at IS NULL;
      IF v_ccy IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัตรที่จ่าย' USING ERRCODE = '22023'; END IF;
      IF v_ccy <> NEW.currency THEN RAISE EXCEPTION 'INVALID_CURRENCY: สกุลบัตรไม่ตรงกับรายการ' USING ERRCODE = '22023'; END IF;
    END IF;
  END IF;
  IF NEW.movement_type = 'CARD_PAYMENT' THEN
    SELECT currency INTO v_ccy FROM public.credit_cards WHERE id = NEW.to_credit_card_id;
    IF v_ccy <> NEW.currency THEN RAISE EXCEPTION 'INVALID_CURRENCY: สกุลบัตรไม่ตรงกับรายการ' USING ERRCODE = '22023'; END IF;
  ELSIF NEW.movement_type = 'LIABILITY_PAYMENT' THEN
    SELECT currency INTO v_ccy FROM public.liabilities WHERE id = NEW.to_liability_id;
    IF v_ccy <> NEW.currency THEN RAISE EXCEPTION 'INVALID_CURRENCY: สกุลหนี้ไม่ตรงกับรายการ' USING ERRCODE = '22023'; END IF;
  END IF;

  -- อัตราจริงจากยอด 2 ฝั่ง (คู่ที่มี THB เท่านั้น)
  IF NEW.movement_type = 'FX_EXCHANGE' THEN
    IF NEW.currency <> 'THB' AND NEW.counter_currency <> 'THB' THEN
      NEW.actual_fx_rate := NULL;
    ELSIF NEW.actual_fx_rate IS NULL THEN
      NEW.actual_fx_rate := CASE WHEN NEW.currency = 'THB' THEN round(NEW.amount / NEW.counter_amount, 10)
                                 ELSE round(NEW.counter_amount / NEW.amount, 10) END;
    END IF;
  ELSIF v_inv AND NEW.counter_amount IS NOT NULL AND NEW.counter_currency <> NEW.currency
        AND 'THB' IN (NEW.currency, NEW.counter_currency) THEN
    -- โอนพอร์ตข้ามสกุล: คำนวณใหม่ทุกครั้ง (ยอดปลายทางแก้ทีหลังได้)
    NEW.actual_fx_rate := CASE WHEN NEW.currency = 'THB' THEN round(NEW.amount / NEW.counter_amount, 10)
                               ELSE round(NEW.counter_amount / NEW.amount, 10) END;
  ELSIF v_inv AND NEW.counter_currency IS NOT NULL THEN
    NEW.actual_fx_rate := NULL;
  ELSIF NEW.currency = 'THB' THEN
    NEW.actual_fx_rate := NULL;
  END IF;

  -- base_amount (THB): Rate จริง → Previous Available Rate
  NEW.base_amount := round(NEW.amount * CASE
      WHEN NEW.currency = 'THB' THEN 1
      WHEN NEW.actual_fx_rate IS NOT NULL THEN NEW.actual_fx_rate
      ELSE private.fx_rate(NEW.currency, NEW.movement_date) END, 4);
  RETURN NEW;
END $function$
;
;

-- 3) ยอดบัตร: รูด − จ่าย − เงินคืน − รายได้เข้าบัตร + ซื้อทรัพย์สินด้วยบัตร --------------------------------------
CREATE OR REPLACE FUNCTION private.card_activity(p_card uuid, p_from date, p_to date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT sum(amount) FROM public.expense_items WHERE paid_from_credit_card_id = p_card AND deleted_at IS NULL
                     AND date > p_from AND date <= p_to), 0)
       + coalesce((SELECT sum(amount) FROM public.cash_movements WHERE from_credit_card_id = p_card AND movement_type = 'ASSET_PURCHASE'
                     AND deleted_at IS NULL AND movement_date > p_from AND movement_date <= p_to), 0)
       - coalesce((SELECT sum(amount) FROM public.cash_movements WHERE to_credit_card_id = p_card AND movement_type = 'CARD_PAYMENT'
                     AND deleted_at IS NULL AND movement_date > p_from AND movement_date <= p_to), 0)
       - coalesce((SELECT sum(amount) FROM public.investment_transactions WHERE to_credit_card_id = p_card AND transaction_type = 'PAYMENT'
                     AND deleted_at IS NULL AND transaction_date > p_from AND transaction_date <= p_to), 0)
       - coalesce((SELECT sum(amount) FROM public.expense_reimbursements WHERE received_to_credit_card_id = p_card AND deleted_at IS NULL
                     AND received_date > p_from AND received_date <= p_to), 0)
       - coalesce((SELECT sum(amount - coalesce(tax, 0)) FROM public.income_transactions WHERE received_to_credit_card_id = p_card
                     AND deleted_at IS NULL AND date > p_from AND date <= p_to), 0)
$$;

-- 4) ก้อนรอแยกของบัตร: ปรับเมื่อมีรายการซื้อทรัพย์สินด้วยบัตรเพิ่ม / แก้ / ลบ -----------------------------------------
CREATE OR REPLACE FUNCTION private.tg_lump_recalc_cm() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cash_movements; a uuid;
BEGIN
  IF private.lump_busy() THEN RETURN NULL; END IF;
  FOREACH r IN ARRAY ARRAY[OLD, NEW] LOOP
    CONTINUE WHEN r.id IS NULL;
    FOREACH a IN ARRAY ARRAY[r.from_asset_id, r.to_asset_id] LOOP
      IF a IS NOT NULL THEN PERFORM private.recalc_bank_lumps_at(a, r.movement_date); END IF;
    END LOOP;
    IF r.movement_type = 'CARD_PAYMENT' THEN PERFORM private.recalc_debt_lumps('CARD', r.to_credit_card_id, r.movement_date); END IF;
    IF r.from_credit_card_id IS NOT NULL THEN PERFORM private.recalc_debt_lumps('CARD', r.from_credit_card_id, r.movement_date); END IF;
    IF r.movement_type = 'LIABILITY_PAYMENT' THEN PERFORM private.recalc_debt_lumps('LIABILITY', r.to_liability_id, r.movement_date); END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- 5) ลบบัตร: มีรายการซื้อทรัพย์สินด้วยบัตรนี้ → ลบไม่ได้ ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_credit_card(p_card_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาระบุเหตุผลที่ลบ' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_movements WHERE (to_credit_card_id = p_card_id OR from_credit_card_id = p_card_id) AND deleted_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.expense_items WHERE paid_from_credit_card_id = p_card_id AND deleted_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.expense_reimbursements WHERE received_to_credit_card_id = p_card_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: มีค่าใช้จ่ายหรือรายการจ่ายบัตรผูกอยู่ — เปลี่ยนสถานะเป็น "ยกเลิกบัตรแล้ว" แทนการลบ' USING ERRCODE = '22023';
  END IF;
  UPDATE public.credit_cards SET notes = concat_ws(' · ', notes, 'ลบ: ' || trim(p_reason)), deleted_at = now()
   WHERE id = p_card_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบบัตรนี้ หรือไม่มีสิทธิ์ลบ' USING ERRCODE = '22023'; END IF;
END $$;

-- 6) pay_property: ต้นทาง บัญชี / บัตร / เงินสด (พารามิเตอร์ใหม่มีค่าตั้งต้น → โค้ดเดิมเรียกได้) --------------------------
DROP FUNCTION IF EXISTS public.pay_property(uuid, uuid, date, numeric, numeric, text, boolean, uuid, jsonb);
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
                                      building_area_sqm, useful_life_years, acquired_date)
    VALUES (v_pid, coalesce((SELECT max(d.sort_order) FROM public.property_deeds d WHERE d.property_id = v_pid AND d.deleted_at IS NULL), 0) + 1,
            v_type, v_label,
            CASE WHEN v_type = 'LAND' THEN coalesce(nullif(trim(p_new_component->>'title_type'), ''), 'โฉนด') END,
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'title_deed_no'), '') END,
            CASE WHEN v_type = 'LAND' THEN nullif(trim(p_new_component->>'land_no'), '') END,
            CASE WHEN v_type = 'LAND' THEN nullif(p_new_component->>'land_area_sq_wa', '')::numeric END,
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
