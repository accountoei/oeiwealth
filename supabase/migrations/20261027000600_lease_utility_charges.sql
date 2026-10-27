-- =====================================================================
-- Property รอบ 2 ข้อ 7 (ตกลง 27 ต.ค. 2026): ค่าน้ำ / ค่าไฟที่เราจ่ายแล้ว เรียกเก็บผู้เช่า → เงินที่ได้คืนนับเป็น "รายได้"
--   1) สัญญาเช่า: utilities_billing = TENANT_PAYS (ผู้เช่าจ่ายเอง) / INCLUDED (รวมในค่าเช่า) / REBILL (เราจ่ายแล้วเรียกเก็บ)
--   2) ตารางใหม่ lease_utility_charges = ยอดที่เรียกเก็บผู้เช่า 1 รายการต่อค่าใช้จ่ายที่จ่ายไป
--      - ค่าใช้จ่ายยังบันทึกเต็มจำนวน (ตาราง "ประมาณ vs จ่ายจริง" ยังถูก)
--      - รับเงินคืน = รายได้ income_type OTHER · income_subtype "ค่าน้ำไฟเรียกเก็บจากผู้เช่า" · ผูกสัญญา + งวด
--        (ไม่นับเป็นค่าเช่า: v_expected_income นับเฉพาะ RENT) · แบ่งให้เจ้าของตามสัดส่วนเหมือนรายได้ทรัพย์สินอื่น
--      - ลบรายได้ที่รับคืน → กลับเป็น "รอรับ" · ลบค่าใช้จ่ายต้นทาง (ยังไม่ได้รับ) → รายการเรียกเก็บหายไปด้วย
--   3) add_utility_charge()            : ตั้งยอดเรียกเก็บจากค่าใช้จ่ายที่บันทึกแล้ว
--      batch_add_property_expenses()   : แถวที่มี rebill_lease_id → ตั้งยอดเรียกเก็บในชุดเดียวกัน
--      batch_record_rent()             : แถวที่มี charge_id → บันทึกรับค่าน้ำไฟเรียกเก็บ (รับพร้อมค่าเช่าได้ในชุดเดียว)
--   ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) สัญญาเช่า: วิธีคิดค่าน้ำไฟ ------------------------------------------------------------------------
ALTER TABLE public.property_leases ADD COLUMN IF NOT EXISTS utilities_billing text;
DO $$ BEGIN
  ALTER TABLE public.property_leases ADD CONSTRAINT pl_utilities_billing_ck
    CHECK (utilities_billing IS NULL OR utilities_billing IN ('TENANT_PAYS','INCLUDED','REBILL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.property_leases.utilities_billing IS
  'ค่าน้ำไฟ: TENANT_PAYS ผู้เช่าจ่ายเอง / INCLUDED รวมในค่าเช่า / REBILL เราจ่ายแล้วเรียกเก็บ (ติ๊ก "เรียกเก็บผู้เช่า" ให้ตอนบันทึกจ่าย)';

-- 2) ยอดเรียกเก็บผู้เช่า --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lease_utility_charges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id            uuid NOT NULL REFERENCES public.property_leases(id),
  expense_item_id     uuid REFERENCES public.expense_items(id),            -- ค่าใช้จ่ายที่เราจ่ายไป
  property_utility_id uuid REFERENCES public.property_utilities(id),
  cost_period         date NOT NULL,                                       -- งวด (วันที่ 1 ของเดือน)
  description         text NOT NULL,
  amount              public.d_money NOT NULL CHECK (amount > 0),
  currency            public.d_currency NOT NULL DEFAULT 'THB',
  income_id           uuid REFERENCES public.income_transactions(id),     -- รายได้ตอนรับคืน
  notes               text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE INDEX IF NOT EXISTS luc_lease_idx ON public.lease_utility_charges(lease_id);
CREATE UNIQUE INDEX IF NOT EXISTS luc_expense_uq ON public.lease_utility_charges(expense_item_id)
  WHERE expense_item_id IS NOT NULL AND deleted_at IS NULL;                 -- ค่าใช้จ่าย 1 รายการ เรียกเก็บได้ครั้งเดียว
CREATE INDEX IF NOT EXISTS luc_income_idx ON public.lease_utility_charges(income_id) WHERE income_id IS NOT NULL;

DROP TRIGGER IF EXISTS t10_meta ON public.lease_utility_charges;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.lease_utility_charges
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.lease_utility_charges;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.lease_utility_charges
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.lease_utility_charges;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.lease_utility_charges
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

-- รับคืนแล้ว = มีรายได้ที่ยังไม่ถูกลบ
CREATE OR REPLACE FUNCTION private.utility_charge_received(p_income uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p_income IS NOT NULL AND EXISTS (SELECT 1 FROM public.income_transactions i WHERE i.id = p_income AND i.deleted_at IS NULL)
$$;
REVOKE ALL ON FUNCTION private.utility_charge_received(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.utility_charge_received(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.tg_utility_charge_check() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_prop uuid; v_exp_prop uuid;
BEGIN
  SELECT l.property_id INTO v_prop FROM public.property_leases l WHERE l.id = NEW.lease_id AND l.deleted_at IS NULL;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบสัญญาเช่า' USING ERRCODE = '22023'; END IF;
  NEW.cost_period := date_trunc('month', NEW.cost_period)::date;
  -- ค่าใช้จ่ายต้นทางต้องเป็นของ Property เดียวกับสัญญา
  IF NEW.expense_item_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.expense_item_id IS DISTINCT FROM OLD.expense_item_id
                                         OR NEW.lease_id IS DISTINCT FROM OLD.lease_id) THEN
    SELECT pd.id INTO v_exp_prop FROM public.expense_items e JOIN public.property_details pd ON pd.asset_id = e.related_asset_id
     WHERE e.id = NEW.expense_item_id AND e.deleted_at IS NULL;
    IF v_exp_prop IS DISTINCT FROM v_prop THEN
      RAISE EXCEPTION 'INVALID: เรียกเก็บได้เฉพาะค่าใช้จ่ายของ Property เดียวกับสัญญาเช่า' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- ผูกรายได้: ต้องเป็นรายได้ของสัญญานี้ที่ยังไม่ถูกลบ
  IF NEW.income_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.income_id IS DISTINCT FROM OLD.income_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.income_transactions i WHERE i.id = NEW.income_id AND i.deleted_at IS NULL
                      AND i.lease_id = NEW.lease_id AND i.income_type = 'OTHER') THEN
      RAISE EXCEPTION 'INVALID: รายได้ที่ผูกต้องเป็นรายได้อื่นของสัญญาเช่านี้' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- รับคืนแล้ว → แก้ยอด / สัญญา / ลบ ไม่ได้ (ลบรายได้ที่รับคืนก่อน)
  IF TG_OP = 'UPDATE' AND private.utility_charge_received(OLD.income_id) AND NEW.income_id IS NOT DISTINCT FROM OLD.income_id
     AND (NEW.amount <> OLD.amount OR NEW.lease_id <> OLD.lease_id OR NEW.currency <> OLD.currency
          OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'INVALID: รับเงินคืนแล้ว — ลบรายการรับคืนในประวัติรับค่าเช่าก่อน' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_utility_charge_check() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t20_check ON public.lease_utility_charges;
CREATE TRIGGER t20_check BEFORE INSERT OR UPDATE ON public.lease_utility_charges
  FOR EACH ROW EXECUTE FUNCTION private.tg_utility_charge_check();

ALTER TABLE public.lease_utility_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lease_utility_charges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lease_utility_charges TO authenticated;
DROP POLICY IF EXISTS p_select ON public.lease_utility_charges;
CREATE POLICY p_select ON public.lease_utility_charges FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
DROP POLICY IF EXISTS p_insert ON public.lease_utility_charges;
CREATE POLICY p_insert ON public.lease_utility_charges FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR')));
DROP POLICY IF EXISTS p_update ON public.lease_utility_charges;
CREATE POLICY p_update ON public.lease_utility_charges FOR UPDATE TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND created_at >= now() - interval '24 hours' AND deleted_at IS NULL))
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND deleted_at IS NULL));

-- สถานะ: รอรับ / รับแล้ว · ค่าใช้จ่ายต้นทางถูกลบ (และยังไม่ได้รับ) → ไม่แสดง
CREATE OR REPLACE VIEW public.v_lease_utility_charges WITH (security_invoker = true) AS
  SELECT c.id, c.lease_id, c.expense_item_id, c.property_utility_id, c.cost_period, c.description, c.amount, c.currency,
         c.notes, c.created_at, pd.asset_id AS property_asset_id,
         concat_ws(' · ', a.name, l.unit_label, l.tenant_name) AS name,
         e.date AS paid_date, e.amount AS paid_amount,
         CASE WHEN i.id IS NOT NULL THEN 'RECEIVED' ELSE 'PENDING' END AS status,
         i.id AS income_id, i.date AS received_date, i.amount AS received_amount, i.received_to_asset_id
    FROM public.lease_utility_charges c
    JOIN public.property_leases l ON l.id = c.lease_id
    JOIN public.property_details pd ON pd.id = l.property_id
    JOIN public.assets a ON a.id = pd.asset_id
    LEFT JOIN public.expense_items e ON e.id = c.expense_item_id
    LEFT JOIN public.income_transactions i ON i.id = c.income_id AND i.deleted_at IS NULL
   WHERE c.deleted_at IS NULL AND l.deleted_at IS NULL
     AND (c.expense_item_id IS NULL OR e.deleted_at IS NULL OR i.id IS NOT NULL);
REVOKE ALL ON public.v_lease_utility_charges FROM PUBLIC, anon;
GRANT SELECT ON public.v_lease_utility_charges TO authenticated;

-- 3) ตั้งยอดเรียกเก็บจากค่าใช้จ่ายที่บันทึกแล้ว --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_utility_charge(p_expense_item_id uuid, p_lease_id uuid, p_amount numeric DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE e public.expense_items; v_id uuid;
BEGIN
  SELECT * INTO e FROM public.expense_items WHERE id = p_expense_item_id AND deleted_at IS NULL;
  IF e.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบค่าใช้จ่าย' USING ERRCODE = '22023'; END IF;
  IF coalesce(p_amount, e.amount) <= 0 THEN RAISE EXCEPTION 'INVALID: ยอดเรียกเก็บต้องมากกว่า 0' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.lease_utility_charges(lease_id, expense_item_id, property_utility_id, cost_period, description, amount, currency, notes)
  VALUES (p_lease_id, e.id, e.property_utility_id, coalesce(e.cost_period, e.date), e.description, coalesce(p_amount, e.amount),
          e.currency, nullif(trim(p_notes), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.add_utility_charge(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_utility_charge(uuid, uuid, numeric, text) TO authenticated;

-- ค่าใช้จ่ายของทรัพย์สินหลายรายการ (เดิม 20261017000500) + แถวที่มี rebill_lease_id → ตั้งยอดเรียกเก็บผู้เช่า
CREATE OR REPLACE FUNCTION public.batch_add_property_expenses(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_id uuid;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF nullif(r->>'property_utility_id', '') IS NULL AND NOT EXISTS (
         SELECT 1 FROM public.property_details pd
          WHERE pd.asset_id = nullif(r->>'related_asset_id', '')::uuid AND pd.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'INVALID: % · กรุณาเลือกทรัพย์สิน', coalesce(nullif(trim(r->>'description'), ''), 'รายการ') USING ERRCODE = '22023';
    END IF;
    IF num_nonnulls(nullif(r->>'paid_from_asset_id', ''), nullif(r->>'paid_from_credit_card_id', '')) = 0 THEN
      RAISE EXCEPTION 'INVALID: % · กรุณาเลือกบัญชี / บัตรที่จ่าย', coalesce(nullif(trim(r->>'description'), ''), 'รายการ') USING ERRCODE = '22023';
    END IF;
    v_id := public.add_expense(r - 'rebill_lease_id' - 'rebill_amount');
    IF nullif(r->>'rebill_lease_id', '') IS NOT NULL THEN
      PERFORM public.add_utility_charge(v_id, (r->>'rebill_lease_id')::uuid, nullif(r->>'rebill_amount', '')::numeric);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_add_property_expenses(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_add_property_expenses(jsonb) TO authenticated;

-- รับค่าเช่าหลายสัญญา (เดิม 20261017000500) + แถวที่มี charge_id → รับค่าน้ำไฟเรียกเก็บ (รายได้อื่นของสัญญา)
-- p_rows: [{ lease_id | charge_id, date, amount, received_to_asset_id?, income_period?, notes? }]
CREATE OR REPLACE FUNCTION public.batch_record_rent(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_lease uuid; v_date date; v_amount numeric; v_bank uuid; v_ccy text; v_name text;
        c public.lease_utility_charges; v_inc uuid;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    c := NULL;
    IF nullif(r->>'charge_id', '') IS NOT NULL THEN
      SELECT * INTO c FROM public.lease_utility_charges WHERE id = (r->>'charge_id')::uuid AND deleted_at IS NULL FOR UPDATE;
      IF c.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการเรียกเก็บค่าน้ำไฟ' USING ERRCODE = '22023'; END IF;
      v_lease := c.lease_id;
    ELSE
      v_lease := nullif(r->>'lease_id', '')::uuid;
    END IF;
    v_date   := nullif(r->>'date', '')::date;
    v_amount := nullif(r->>'amount', '')::numeric;
    v_bank   := nullif(r->>'received_to_asset_id', '')::uuid;
    SELECT coalesce(nullif(concat_ws(' · ', l.unit_label, l.tenant_name), ''), 'สัญญาเช่า'), l.rent_currency INTO v_name, v_ccy
      FROM public.property_leases l WHERE l.id = v_lease AND l.deleted_at IS NULL;
    IF v_name IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบสัญญาเช่า' USING ERRCODE = '22023'; END IF;
    IF c.id IS NOT NULL THEN
      v_name := v_name || ' · ' || c.description;
      v_ccy := c.currency;
      IF private.utility_charge_received(c.income_id) THEN
        RAISE EXCEPTION 'INVALID: % · รับเงินคืนไปแล้ว', v_name USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_date IS NULL THEN RAISE EXCEPTION 'INVALID: % · กรุณาใส่วันที่รับ', v_name USING ERRCODE = '22023'; END IF;
    IF v_date > current_date THEN RAISE EXCEPTION 'INVALID: % · วันที่รับเป็นวันในอนาคตไม่ได้', v_name USING ERRCODE = '22023'; END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID: % · กรุณาใส่ยอดที่ได้รับ', v_name USING ERRCODE = '22023'; END IF;
    IF v_bank IS NOT NULL THEN SELECT a.currency INTO v_ccy FROM public.assets a WHERE a.id = v_bank; END IF;
    IF c.id IS NULL THEN
      INSERT INTO public.income_transactions(lease_id, income_type, date, income_period, amount, currency, received_to_asset_id, notes)
      VALUES (v_lease, 'RENT', v_date, nullif(r->>'income_period', '')::date, v_amount, v_ccy, v_bank, nullif(trim(r->>'notes'), ''));
    ELSE
      INSERT INTO public.income_transactions(lease_id, income_type, income_subtype, date, income_period, amount, currency, received_to_asset_id, notes)
      VALUES (v_lease, 'OTHER', 'ค่าน้ำไฟเรียกเก็บจากผู้เช่า', v_date, c.cost_period, v_amount, v_ccy, v_bank,
              coalesce(nullif(trim(r->>'notes'), ''), c.description))
      RETURNING id INTO v_inc;
      UPDATE public.lease_utility_charges SET income_id = v_inc WHERE id = c.id;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.batch_record_rent(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_record_rent(jsonb) TO authenticated;
