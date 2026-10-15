-- =====================================================================
-- หมวดค่าใช้จ่าย / ประเภทย่อยของ "รายได้อื่น" ที่ตั้งเองได้ (แท็บ "ตั้งค่า" ใน Income & Expenses)
--   - ie_categories(kind = EXPENSE | INCOME_OTHER, name, sort_order, active) · อ่านได้ทุกบทบาท · เพิ่ม / แก้ ADMIN / EDITOR
--   - income_transactions.income_subtype: ประเภทย่อยของรายได้อื่น (ไม่บังคับ)
--   - rename_ie_category: เปลี่ยนชื่อ → เปลี่ยนในรายการที่ใช้ชื่อนั้นทุกเดือนด้วย
--     (แก้เฉพาะชื่อหมวด ยอดเงินไม่เปลี่ยน จึงทำได้แม้งวดที่ปิดแล้ว — ใช้ช่องทางเดียวกับ "แยกรายการ")
--   - move_ie_category: เลื่อนลำดับขึ้น / ลง
--   หมวดที่ระบบใช้เอง (รอแยกรายละเอียด · ค่าธรรมเนียมธนาคาร) ไม่อยู่ในตารางนี้
--   หมวด ประกัน / ดอกเบี้ยจ่าย / บ้าน / สาธารณูปโภค ระบบใช้บันทึกอัตโนมัติ → เปลี่ยนชื่อไม่ได้
-- รันซ้ำได้
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.ie_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('EXPENSE','INCOME_OTHER')),
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ie_categories_name_uq ON public.ie_categories(kind, lower(trim(name))) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS t10_meta ON public.ie_categories;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.ie_categories FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.ie_categories;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.ie_categories FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.ie_categories;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.ie_categories FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

ALTER TABLE public.ie_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ie_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ie_categories TO authenticated, service_role;
DROP POLICY IF EXISTS p_select ON public.ie_categories;
DROP POLICY IF EXISTS p_insert ON public.ie_categories;
DROP POLICY IF EXISTS p_update ON public.ie_categories;
CREATE POLICY p_select ON public.ie_categories FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
CREATE POLICY p_insert ON public.ie_categories FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR')));
CREATE POLICY p_update ON public.ie_categories FOR UPDATE TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR'))) WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR')));

-- ตั้งต้น: หมวดเดิมของระบบ + หมวดที่เคยพิมพ์เองในรายการที่มีอยู่
INSERT INTO public.ie_categories(kind, name, sort_order)
SELECT 'EXPENSE', x.name, x.ord FROM (VALUES
  ('ทั่วไป', 1), ('อาหาร', 2), ('บ้าน / สาธารณูปโภค', 3), ('เดินทาง / รถ', 4), ('การศึกษา', 5), ('สุขภาพ', 6),
  ('ประกัน', 7), ('ภาษี', 8), ('ดอกเบี้ยจ่าย', 9), ('ท่องเที่ยว', 10), ('ช้อปปิ้ง', 11), ('ครอบครัว / ของขวัญ', 12),
  ('บริจาค', 13), ('อื่น ๆ', 14)) AS x(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.ie_categories c WHERE c.kind = 'EXPENSE' AND lower(trim(c.name)) = lower(x.name) AND c.deleted_at IS NULL);
INSERT INTO public.ie_categories(kind, name, sort_order)
SELECT 'EXPENSE', e.cat, 100 + row_number() OVER (ORDER BY e.cat)
  FROM (SELECT DISTINCT trim(expense_category) AS cat FROM public.expense_items
         WHERE deleted_at IS NULL AND expense_category IS NOT NULL AND trim(expense_category) <> ''
           AND expense_category NOT IN ('BANK_FEE', 'รอแยกรายละเอียด')) e
 WHERE NOT EXISTS (SELECT 1 FROM public.ie_categories c WHERE c.kind = 'EXPENSE' AND lower(trim(c.name)) = lower(e.cat) AND c.deleted_at IS NULL);

-- ประเภทย่อยของรายได้อื่น
ALTER TABLE public.income_transactions ADD COLUMN IF NOT EXISTS income_subtype text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inc_subtype_other') THEN
    ALTER TABLE public.income_transactions ADD CONSTRAINT inc_subtype_other
      CHECK (income_subtype IS NULL OR income_type = 'OTHER');
  END IF;
END $$;

-- เปลี่ยนชื่อ → เปลี่ยนในรายการที่ใช้ชื่อเดิมด้วย (ทุกเดือน · แก้เฉพาะชื่อหมวด)
CREATE OR REPLACE FUNCTION public.rename_ie_category(p_id uuid, p_name text)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c public.ie_categories; v_new text := trim(coalesce(p_name, '')); v_n int := 0;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO c FROM public.ie_categories WHERE id = p_id AND deleted_at IS NULL;
  IF c.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบหมวดนี้' USING ERRCODE = '22023'; END IF;
  IF v_new = '' THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อ' USING ERRCODE = '22023'; END IF;
  IF v_new IN ('BANK_FEE', 'รอแยกรายละเอียด') THEN RAISE EXCEPTION 'INVALID: ชื่อนี้ระบบใช้อยู่' USING ERRCODE = '22023'; END IF;
  IF v_new = c.name THEN RETURN 0; END IF;
  -- หมวดที่ระบบบันทึกให้อัตโนมัติ (เบี้ยประกัน · ดอกเบี้ยจ่ายหนี้ · ค่าใช้จ่ายประจำอสังหาฯ) เปลี่ยนชื่อไม่ได้
  IF c.kind = 'EXPENSE' AND c.name IN ('ประกัน', 'ดอกเบี้ยจ่าย', 'บ้าน / สาธารณูปโภค') THEN
    RAISE EXCEPTION 'INVALID: หมวดนี้ระบบใช้บันทึกอัตโนมัติ เปลี่ยนชื่อไม่ได้ (ซ่อนได้)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ie_categories SET name = v_new WHERE id = c.id;
  PERFORM set_config('fwv.split', 'on', true);          -- แก้เฉพาะชื่อหมวด (ยอดไม่เปลี่ยน) ได้แม้งวดที่ปิดแล้ว
  IF c.kind = 'EXPENSE' THEN
    UPDATE public.expense_items SET expense_category = v_new WHERE expense_category = c.name AND deleted_at IS NULL;
  ELSE
    UPDATE public.income_transactions SET income_subtype = v_new WHERE income_subtype = c.name AND deleted_at IS NULL;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('fwv.split', 'off', true);
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.rename_ie_category(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_ie_category(uuid, text) TO authenticated;

-- เลื่อนลำดับ (p_dir = -1 ขึ้น / 1 ลง)
CREATE OR REPLACE FUNCTION public.move_ie_category(p_id uuid, p_dir integer)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c public.ie_categories; o public.ie_categories; v_i int := 0; r record;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO c FROM public.ie_categories WHERE id = p_id AND deleted_at IS NULL;
  IF c.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบหมวดนี้' USING ERRCODE = '22023'; END IF;
  -- จัดเลขลำดับให้ต่อเนื่องก่อน แล้วสลับกับรายการติดกัน
  FOR r IN SELECT id FROM public.ie_categories WHERE kind = c.kind AND deleted_at IS NULL ORDER BY sort_order, name LOOP
    v_i := v_i + 1;
    UPDATE public.ie_categories SET sort_order = v_i WHERE id = r.id AND sort_order <> v_i;
  END LOOP;
  SELECT * INTO c FROM public.ie_categories WHERE id = p_id;
  SELECT * INTO o FROM public.ie_categories WHERE kind = c.kind AND deleted_at IS NULL
     AND sort_order = c.sort_order + sign(p_dir)::int;
  IF o.id IS NULL THEN RETURN; END IF;
  UPDATE public.ie_categories SET sort_order = o.sort_order WHERE id = c.id;
  UPDATE public.ie_categories SET sort_order = c.sort_order WHERE id = o.id;
END $$;
REVOKE ALL ON FUNCTION public.move_ie_category(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_ie_category(uuid, integer) TO authenticated;

-- เปลี่ยนประเภทรายได้ออกจาก "รายได้อื่น" → ล้างประเภทย่อย (เหมือนเดิมทุกอย่าง นอกจากบรรทัดนี้)
CREATE OR REPLACE FUNCTION public.change_entry_account(p_kind text, p_id uuid, p_account text, p_income_type text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE i public.income_transactions; e public.expense_items; v_asset uuid; v_card uuid; v_old uuid; v_date date; v_n int;
  v_acc text := coalesce(trim(p_account), '');
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF v_acc LIKE 'a:%' THEN v_asset := substr(v_acc, 3)::uuid;
  ELSIF v_acc LIKE 'c:%' THEN v_card := substr(v_acc, 3)::uuid;
  ELSIF v_acc <> '' THEN RAISE EXCEPTION 'INVALID: บัญชีไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'INCOME' THEN
    SELECT * INTO i FROM public.income_transactions WHERE id = p_id AND deleted_at IS NULL;
    IF i.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการ' USING ERRCODE = '22023'; END IF;
    IF i.pending_split OR i.source_transaction_id IS NOT NULL OR i.lease_id IS NOT NULL OR i.asset_id IS NOT NULL
       OR i.insurance_schedule_line_id IS NOT NULL OR i.received_to_credit_card_id IS NOT NULL THEN
      RAISE EXCEPTION 'LINKED: รายการนี้ผูกกับหน้าอื่น แก้บัญชี / ประเภทที่หน้าต้นทาง' USING ERRCODE = '22023';
    END IF;
    IF v_card IS NOT NULL THEN RAISE EXCEPTION 'INVALID: รายได้เลือกได้เฉพาะบัญชีธนาคาร' USING ERRCODE = '22023'; END IF;
    IF p_income_type IS NOT NULL AND p_income_type IN ('DIVIDEND','COUPON','RENT') AND p_income_type <> i.income_type THEN
      RAISE EXCEPTION 'INVALID: ปันผล / Coupon / ค่าเช่า บันทึกจากหน้าลงทุน / ทรัพย์สิน' USING ERRCODE = '22023';
    END IF;
    v_old := i.received_to_asset_id; v_date := i.date;
    UPDATE public.income_transactions SET received_to_asset_id = v_asset, income_type = coalesce(nullif(p_income_type, ''), income_type),
           income_subtype = CASE WHEN coalesce(nullif(p_income_type, ''), income_type) = 'OTHER' THEN income_subtype END
     WHERE id = i.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSIF p_kind = 'EXPENSE' THEN
    SELECT * INTO e FROM public.expense_items WHERE id = p_id AND deleted_at IS NULL;
    IF e.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการ' USING ERRCODE = '22023'; END IF;
    IF e.pending_split OR e.source_cash_movement_id IS NOT NULL OR e.liability_id IS NOT NULL OR e.insurance_schedule_line_id IS NOT NULL
       OR e.property_utility_id IS NOT NULL OR e.source_fee_side IS NOT NULL THEN
      RAISE EXCEPTION 'LINKED: รายการนี้ผูกกับหน้าอื่น แก้บัญชีที่หน้าต้นทาง' USING ERRCODE = '22023';
    END IF;
    IF v_card IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.credit_cards WHERE id = v_card AND deleted_at IS NULL AND currency = e.currency) THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: บัตรต้องสกุลเดียวกับรายการ (%)', e.currency USING ERRCODE = '22023';
    END IF;
    v_old := e.paid_from_asset_id; v_date := e.date;
    UPDATE public.expense_items SET paid_from_asset_id = v_asset, paid_from_credit_card_id = v_card WHERE id = e.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'INVALID: ประเภทรายการไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF v_n = 0 THEN RAISE EXCEPTION 'PERMISSION_DENIED: คุณไม่มีสิทธิ์แก้รายการนี้' USING ERRCODE = '42501'; END IF;

  RETURN jsonb_build_object('recon_warning', EXISTS (
    SELECT 1 FROM public.bank_reconciliations br
     WHERE br.deleted_at IS NULL AND br.status <> 'OPEN' AND br.year_month = date_trunc('month', v_date)::date
       AND br.bank_asset_id IN (v_old, v_asset)));
END $$;
REVOKE ALL ON FUNCTION public.change_entry_account(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_entry_account(text, uuid, text, text) TO authenticated;
