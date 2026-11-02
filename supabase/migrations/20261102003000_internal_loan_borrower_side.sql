-- =====================================================================
-- เงินกู้ภายในครอบครัว: บันทึกฝั่งผู้กู้ให้อัตโนมัติ (ตกลง 2 พ.ย. 2026)
--   ผู้กู้เป็นสมาชิก + เลือก "บัญชีของผู้กู้" (loan_details.borrower_bank_asset_id) แล้ว ระบบสร้างรายการให้เอง:
--   1) จ่ายเงินกู้ (LOAN_DISBURSEMENT เข้าเงินให้กู้)  → เงินเข้าบัญชีผู้กู้ (OTHER_IN · "รับเงินกู้ภายในครอบครัว")
--   2) รับชำระเงินต้น (LOAN_PRINCIPAL_RECEIPT)         → เงินออกจากบัญชีผู้กู้ (OTHER_OUT · "ชำระเงินต้นเงินกู้ภายในครอบครัว")
--   3) รับดอกเบี้ย (income LOAN_INTEREST)               → ค่าใช้จ่ายของผู้กู้ หมวด "ดอกเบี้ยจ่าย" จ่ายจากบัญชีผู้กู้ (ยอดก่อนหักภาษี)
--   รายการฝั่งผู้กู้ผูกกับรายการต้นทาง: แก้ / ลบต้นทาง → ฝั่งผู้กู้เปลี่ยนตาม · ผู้ใช้แก้ฝั่งผู้กู้ตรง ๆ ไม่ได้
--   ยอดหนี้ของผู้กู้ไม่เปลี่ยนจากไฟล์นี้ (ยังดึงจากเงินต้นคงเหลือของสัญญาเหมือนเดิม · 20261102000500)
--   ตั้ง / เปลี่ยน / ล้างบัญชีของผู้กู้ภายหลัง → ทำรายการฝั่งผู้กู้ของสัญญานี้ใหม่ เฉพาะเดือนที่ยังไม่ปิด (และตั้งแต่ Go-live)
--     เดือนที่ปิดแล้วไม่ถูกแตะ (ยอดสิ้นเดือนของเดือนนั้นยืนยันไว้แล้ว)
-- =====================================================================

-- 1) บัญชีของผู้กู้ (เฉพาะผู้กู้ที่เป็นสมาชิก)
ALTER TABLE public.loan_details ADD COLUMN IF NOT EXISTS borrower_bank_asset_id uuid REFERENCES public.assets(id);
ALTER TABLE public.loan_details DROP CONSTRAINT IF EXISTS loan_details_borrower_bank;
ALTER TABLE public.loan_details ADD CONSTRAINT loan_details_borrower_bank
  CHECK (borrower_bank_asset_id IS NULL OR borrower_person_id IS NOT NULL);

-- 2) รายการเงินเข้า–ออกที่สร้างจากรายการเงินเข้า–ออกอีกรายการ (ฝั่งผู้กู้)
ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS cash_movements_source_entity_type_check;
ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_source_entity_type_check
  CHECK (source_entity_type = ANY (ARRAY['INCOME','EXPENSE','INVESTMENT_TX','REIMBURSEMENT','CASH_MOVEMENT']));

-- 3) ค่าใช้จ่ายดอกเบี้ยฝั่งผู้กู้ผูกกับรายได้ดอกเบี้ยของผู้ให้กู้ · ผู้ใช้สร้าง / แก้เองไม่ได้
ALTER TABLE public.expense_items ADD COLUMN IF NOT EXISTS internal_loan_income_id uuid REFERENCES public.income_transactions(id);
CREATE UNIQUE INDEX IF NOT EXISTS expense_items_internal_loan_uq ON public.expense_items(internal_loan_income_id)
  WHERE internal_loan_income_id IS NOT NULL;
DROP TRIGGER IF EXISTS t31_internal_loan ON public.expense_items;
CREATE TRIGGER t31_internal_loan BEFORE INSERT OR UPDATE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_derived_guard('internal_loan_income_id');

-- 4) ตรวจคู่สัญญา: เพิ่มบัญชีของผู้กู้ (บัญชีธนาคาร · ผู้กู้เป็นเจ้าของ · สกุลเดียวกับเงินกู้)
CREATE OR REPLACE FUNCTION private.tg_internal_loan_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_ccy text;
BEGIN
  IF TG_TABLE_NAME = 'loan_details' THEN
    IF NEW.borrower_business_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.private_business_details b WHERE b.asset_id = NEW.borrower_business_id AND b.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'INVALID: ผู้กู้ต้องเป็นกิจการ (Private Business)' USING ERRCODE = '22023';
    END IF;
    IF NEW.borrower_person_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = NEW.borrower_person_id AND p.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'INVALID: ไม่พบสมาชิกที่เป็นผู้กู้' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.asset_ownerships o WHERE o.asset_id = NEW.asset_id AND o.person_id = NEW.borrower_person_id
                    AND o.deleted_at IS NULL AND o.end_date IS NULL) THEN
        RAISE EXCEPTION 'INVALID: ผู้กู้เป็นผู้ให้กู้ของสัญญาเดียวกันไม่ได้' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF NEW.borrower_bank_asset_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.borrower_bank_asset_id IS DISTINCT FROM OLD.borrower_bank_asset_id
            OR NEW.borrower_person_id IS DISTINCT FROM OLD.borrower_person_id) THEN
      IF NOT private.is_bank_asset(NEW.borrower_bank_asset_id)
         OR EXISTS (SELECT 1 FROM public.assets a WHERE a.id = NEW.borrower_bank_asset_id AND a.deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'INVALID: บัญชีของผู้กู้ต้องเป็นบัญชีธนาคาร' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.asset_ownerships o WHERE o.asset_id = NEW.borrower_bank_asset_id
                        AND o.person_id = NEW.borrower_person_id AND o.deleted_at IS NULL AND o.end_date IS NULL) THEN
        RAISE EXCEPTION 'INVALID: บัญชีของผู้กู้ต้องเป็นบัญชีที่ผู้กู้เป็นเจ้าของ' USING ERRCODE = '22023';
      END IF;
      SELECT currency INTO v_ccy FROM public.assets WHERE id = NEW.asset_id;
      IF EXISTS (SELECT 1 FROM public.assets a WHERE a.id = NEW.borrower_bank_asset_id AND a.currency IS DISTINCT FROM v_ccy) THEN
        RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีของผู้กู้ต้องเป็นสกุลเดียวกับเงินกู้ (%)', v_ccy USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSE
    IF NEW.lender_business_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.private_business_details b WHERE b.asset_id = NEW.lender_business_id AND b.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'INVALID: ผู้ให้กู้ต้องเป็นกิจการ (Private Business)' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS t57_internal_loan ON public.loan_details;
CREATE TRIGGER t57_internal_loan BEFORE INSERT OR UPDATE OF borrower_person_id, borrower_business_id, borrower_bank_asset_id
  ON public.loan_details FOR EACH ROW EXECUTE FUNCTION private.tg_internal_loan_check();

-- 5) สร้าง / แก้ / ลบ เงินเข้า–ออกฝั่งผู้กู้ ตามรายการจ่ายเงินกู้ / รับชำระเงินต้น 1 รายการ
CREATE OR REPLACE FUNCTION private.sync_internal_loan_move(p_move_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.cash_movements; x public.cash_movements; ld public.loan_details;
        v_loan uuid; v_need boolean; v_type text; v_desc text; v_bank uuid;
BEGIN
  SELECT * INTO m FROM public.cash_movements WHERE id = p_move_id;
  IF m.id IS NULL OR m.is_derived THEN RETURN; END IF;
  v_loan := CASE m.movement_type WHEN 'LOAN_DISBURSEMENT' THEN m.to_asset_id
                                 WHEN 'LOAN_PRINCIPAL_RECEIPT' THEN m.from_asset_id END;
  IF v_loan IS NOT NULL THEN SELECT * INTO ld FROM public.loan_details WHERE asset_id = v_loan; END IF;
  v_bank := ld.borrower_bank_asset_id;
  v_need := m.deleted_at IS NULL AND ld.asset_id IS NOT NULL AND ld.deleted_at IS NULL
            AND ld.borrower_person_id IS NOT NULL AND v_bank IS NOT NULL;
  SELECT * INTO x FROM public.cash_movements
   WHERE is_derived AND source_entity_type = 'CASH_MOVEMENT' AND source_entity_id = p_move_id;

  IF v_need THEN
    IF EXISTS (SELECT 1 FROM public.assets a WHERE a.id = v_bank AND a.currency IS DISTINCT FROM m.currency) THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีของผู้กู้ต้องเป็นสกุลเดียวกับรายการ (%)', m.currency USING ERRCODE = '22023';
    END IF;
    v_type := CASE m.movement_type WHEN 'LOAN_DISBURSEMENT' THEN 'OTHER_IN' ELSE 'OTHER_OUT' END;
    v_desc := CASE m.movement_type WHEN 'LOAN_DISBURSEMENT' THEN 'รับเงินกู้ภายในครอบครัว' ELSE 'ชำระเงินต้นเงินกู้ภายในครอบครัว' END
              || coalesce(' · ' || (SELECT a.name FROM public.assets a WHERE a.id = v_loan), '');
    IF x.id IS NULL THEN
      INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, to_asset_id, amount, currency,
                                        source_entity_type, source_entity_id, is_derived, description, metadata)
      VALUES (m.family_id, m.movement_date, v_type,
              CASE WHEN v_type = 'OTHER_OUT' THEN v_bank END, CASE WHEN v_type = 'OTHER_IN' THEN v_bank END,
              m.amount, m.currency, 'CASH_MOVEMENT', m.id, true, v_desc,
              jsonb_build_object('internal_loan_asset_id', v_loan));
    ELSIF (x.family_id, x.movement_date, x.movement_type, x.from_asset_id, x.to_asset_id, x.amount, x.currency,
           x.description, x.deleted_at IS NULL)
          IS DISTINCT FROM (m.family_id, m.movement_date, v_type,
                            CASE WHEN v_type = 'OTHER_OUT' THEN v_bank END, CASE WHEN v_type = 'OTHER_IN' THEN v_bank END,
                            m.amount, m.currency, v_desc, true) THEN
      UPDATE public.cash_movements
         SET family_id = m.family_id, movement_date = m.movement_date, movement_type = v_type,
             from_asset_id = CASE WHEN v_type = 'OTHER_OUT' THEN v_bank END,
             to_asset_id = CASE WHEN v_type = 'OTHER_IN' THEN v_bank END,
             amount = m.amount, currency = m.currency, description = v_desc,
             metadata = x.metadata || jsonb_build_object('internal_loan_asset_id', v_loan), deleted_at = NULL
       WHERE id = x.id;
    END IF;
  ELSIF x.id IS NOT NULL AND x.deleted_at IS NULL THEN
    UPDATE public.cash_movements SET deleted_at = now() WHERE id = x.id;
  END IF;
END $$;

-- 6) สร้าง / แก้ / ลบ ค่าใช้จ่ายดอกเบี้ยฝั่งผู้กู้ ตามรายได้ดอกเบี้ยเงินให้กู้ 1 รายการ
CREATE OR REPLACE FUNCTION private.sync_internal_loan_interest(p_income_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.income_transactions; e public.expense_items; ld public.loan_details;
        v_need boolean; v_desc text; v_bank uuid; v_month uuid;
BEGIN
  SELECT * INTO i FROM public.income_transactions WHERE id = p_income_id;
  IF i.id IS NULL THEN RETURN; END IF;
  IF i.income_type = 'LOAN_INTEREST' AND i.asset_id IS NOT NULL THEN
    SELECT * INTO ld FROM public.loan_details WHERE asset_id = i.asset_id;
  END IF;
  v_bank := ld.borrower_bank_asset_id;
  v_need := i.deleted_at IS NULL AND coalesce(i.amount, 0) > 0 AND ld.asset_id IS NOT NULL AND ld.deleted_at IS NULL
            AND ld.borrower_person_id IS NOT NULL AND v_bank IS NOT NULL;
  SELECT * INTO e FROM public.expense_items WHERE internal_loan_income_id = p_income_id;

  IF v_need THEN
    v_desc := 'ดอกเบี้ยจ่าย · ' || coalesce((SELECT a.name FROM public.assets a WHERE a.id = i.asset_id), 'เงินกู้ภายในครอบครัว');
    v_month := private.expense_month_id(i.date);
    IF e.id IS NULL THEN
      INSERT INTO public.expense_items(monthly_expense_id, paid_from_asset_id, person_id, date, description, amount, currency,
                                       expense_category, internal_loan_income_id)
      VALUES (v_month, v_bank, ld.borrower_person_id, i.date, v_desc, i.amount, i.currency, 'ดอกเบี้ยจ่าย', i.id);
    ELSIF (e.monthly_expense_id, e.paid_from_asset_id, e.person_id, e.date, e.description, e.amount, e.currency, e.deleted_at IS NULL)
          IS DISTINCT FROM (v_month, v_bank, ld.borrower_person_id, i.date, v_desc, i.amount, i.currency, true) THEN
      UPDATE public.expense_items
         SET monthly_expense_id = v_month, paid_from_asset_id = v_bank, person_id = ld.borrower_person_id, date = i.date,
             description = v_desc, amount = i.amount, currency = i.currency, deleted_at = NULL
       WHERE id = e.id;
    END IF;
  ELSIF e.id IS NOT NULL AND e.deleted_at IS NULL THEN
    UPDATE public.expense_items SET deleted_at = now() WHERE id = e.id;
  END IF;
END $$;

-- 7) ทริกเกอร์: ต้นทางเปลี่ยน → ฝั่งผู้กู้เปลี่ยนตาม
CREATE OR REPLACE FUNCTION private.tg_internal_loan_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; v_from date;
BEGIN
  IF TG_TABLE_NAME = 'cash_movements' THEN
    IF NOT NEW.is_derived AND (NEW.movement_type IN ('LOAN_DISBURSEMENT','LOAN_PRINCIPAL_RECEIPT')
       OR (TG_OP = 'UPDATE' AND OLD.movement_type IN ('LOAN_DISBURSEMENT','LOAN_PRINCIPAL_RECEIPT'))) THEN
      PERFORM private.sync_internal_loan_move(NEW.id);
    END IF;
  ELSIF TG_TABLE_NAME = 'income_transactions' THEN
    IF NEW.income_type = 'LOAN_INTEREST' OR (TG_OP = 'UPDATE' AND OLD.income_type = 'LOAN_INTEREST') THEN
      PERFORM private.sync_internal_loan_interest(NEW.id);
    END IF;
  ELSE  -- loan_details: เปลี่ยนผู้กู้ / บัญชีของผู้กู้ / ลบสัญญา → ทำรายการของสัญญาใหม่
    -- เฉพาะรายการหลังงวดที่ปิดแล้ว และตั้งแต่ Go-live (ระบบ LIVE) · ก่อนหน้านั้นยอดรวมอยู่ในงวดที่ปิด / ยอดตั้งต้นแล้ว
    SELECT greatest(private.locked_through(f.id) + 1, CASE WHEN f.system_status = 'LIVE' THEN f.go_live_date END)
      INTO v_from FROM public.families f WHERE f.id = private.default_family_id();
    v_from := coalesce(v_from, '-infinity'::date);
    FOR r IN SELECT m.id FROM public.cash_movements m
              WHERE NOT m.is_derived AND m.movement_date >= v_from
                AND ((m.movement_type = 'LOAN_DISBURSEMENT' AND m.to_asset_id = NEW.asset_id)
                  OR (m.movement_type = 'LOAN_PRINCIPAL_RECEIPT' AND m.from_asset_id = NEW.asset_id))
              ORDER BY m.movement_date LOOP
      PERFORM private.sync_internal_loan_move(r.id);
    END LOOP;
    FOR r IN SELECT t.id FROM public.income_transactions t
              WHERE t.asset_id = NEW.asset_id AND t.income_type = 'LOAN_INTEREST' AND t.date >= v_from ORDER BY t.date LOOP
      PERFORM private.sync_internal_loan_interest(r.id);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS a58_internal_loan ON public.cash_movements;
CREATE TRIGGER a58_internal_loan AFTER INSERT OR UPDATE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.tg_internal_loan_sync();
DROP TRIGGER IF EXISTS a58_internal_loan ON public.income_transactions;
CREATE TRIGGER a58_internal_loan AFTER INSERT OR UPDATE ON public.income_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_internal_loan_sync();
DROP TRIGGER IF EXISTS a58_internal_loan ON public.loan_details;
CREATE TRIGGER a58_internal_loan AFTER UPDATE OF borrower_person_id, borrower_bank_asset_id, deleted_at ON public.loan_details
  FOR EACH ROW WHEN (OLD.borrower_person_id IS DISTINCT FROM NEW.borrower_person_id
                  OR OLD.borrower_bank_asset_id IS DISTINCT FROM NEW.borrower_bank_asset_id
                  OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION private.tg_internal_loan_sync();

REVOKE ALL ON FUNCTION private.sync_internal_loan_move(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.sync_internal_loan_interest(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.tg_internal_loan_sync() FROM PUBLIC;
