-- =====================================================================
-- เงินประกันรอคืน 30 วัน + ผู้เช่าต้องจ่ายเพิ่มเมื่อหักเกินเงินประกัน (ตกลงกับเจ้าของ 6 พ.ย. 2026 · ต่อจาก 20261106050000_lease_closeout.sql)
--
--   1) v_lease_status.deposit_status: สัญญาจบ / เลิกแล้ว ยังไม่คืนเงินประกัน
--        ภายใน 30 วันนับจากวันสิ้นสุด / เลิกสัญญา = REFUND_PENDING "รอคืนเงินประกัน ภายใน …" (สีส้ม · ตามสัญญาที่พิมพ์: คืนภายใน 30 วัน)
--        เกิน 30 วัน = DEPOSIT_REFUND_OVERDUE (สีแดง เหมือนเดิม) · เพิ่มคอลัมน์ท้าย deposit_refund_by (= วันสิ้นสุด / เลิก + 30)
--      ปิดเดือน (month_closing_issues): "เงินประกันเลยกำหนดคืน" นับหลัง 30 วันเหมือนกัน
--   2) close_lease(…, p_collect): ยอดหักเกินเงินประกันได้ (เดิมบันทึกไม่ได้)
--        - หักตามลำดับ ค่าเช่าค้าง → ค่าน้ำไฟเรียกเก็บ → ค่าเสียหาย · ริบเงินประกันได้ไม่เกินเงินประกันที่เหลือหลังหัก 3 อย่างนี้
--        - ส่วนที่เกินเงินประกัน = ผู้เช่าต้องจ่ายเพิ่ม · หักกับค่าเช่าที่จ่ายล่วงหน้าเกิน (ที่ต้องคืน) ก่อน
--        - p_collect = 'NOW' (รับเงินแล้ว): ส่วนที่เกินเป็นรายได้เข้าบัญชีที่เลือก ณ วันที่คืน / รับเงิน
--          p_collect = 'LATER' (ยังไม่ได้รับ · ค่าเริ่มต้น): ค่าเสียหายส่วนที่เกิน → รายการเรียกเก็บผู้เช่า (kind DAMAGE)
--            ขึ้น "รอรับ" ในแท็บรับค่าเช่า · ค่าเช่า / ค่าน้ำไฟที่เกินเงินประกันต้องเลือก "รับเงินแล้ว" (หรือรับแยกก่อน)
--      undo_close_lease(): ลบรายการเรียกเก็บค่าเสียหายด้วย (ถ้าผู้เช่าจ่ายแล้ว ต้องลบรายการรับเงินนั้นก่อน)
--   3) lease_utility_charges.kind (+ ท้าย v_lease_utility_charges): UTILITY (ค่าน้ำไฟ · เดิม) / DAMAGE (ค่าเสียหายส่วนที่เกินเงินประกัน · สร้างได้เฉพาะ close_lease)
--      batch_record_rent: รับรายการ DAMAGE → รายได้อื่น "ค่าเสียหายจากผู้เช่า"
-- ไม่แก้ / ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) สถานะเงินประกัน ------------------------------------------------------------------------------------------
--    คอลัมน์เดิมทุกตัวตามลำดับเดิม (CREATE OR REPLACE ต้องเหมือนเดิม) + deposit_refund_by ท้ายตาราง
CREATE OR REPLACE VIEW public.v_lease_status WITH (security_invoker = true) AS
  SELECT l.id, l.property_id, l.unit_label, l.tenant_name, l.contract_no, l.start_date, l.end_date, l.terminated_date,
         l.rent_amount, l.rent_currency, l.payment_frequency, l.payment_due_day, l.security_deposit, l.deposit_currency,
         l.deposit_received_date, l.deposit_settled_date, l.deposit_refunded_amount, l.deposit_settlement_type,
         l.deposit_carried_from_lease_id, l.deposit_carried_amount, l.status, l.notes,
         l.created_at, l.created_by, l.updated_at, l.updated_by, l.deleted_at, l.deleted_by,
         pd.asset_id AS property_asset_id,
         coalesce(l.terminated_date, l.end_date) AS deposit_due_date,
         CASE WHEN l.status = 'TERMINATED' THEN 'TERMINATED'
              WHEN l.start_date > current_date THEN 'UPCOMING'
              WHEN l.end_date < current_date THEN 'EXPIRED'
              WHEN l.end_date <= current_date + 60 THEN 'EXPIRING_SOON'
              ELSE 'ACTIVE' END AS lease_status,
         CASE WHEN coalesce(l.security_deposit, 0) = 0 THEN 'NONE'
              WHEN l.deposit_settled_date <= current_date THEN 'SETTLED'
              WHEN coalesce(l.terminated_date, l.end_date) + 30 < current_date THEN 'DEPOSIT_REFUND_OVERDUE'
              WHEN coalesce(l.terminated_date, l.end_date) <= current_date THEN 'REFUND_PENDING'
              WHEN coalesce(l.terminated_date, l.end_date) <= current_date + 30 THEN 'DUE_SOON'
              ELSE 'HELD' END AS deposit_status,
         coalesce(l.terminated_date, l.end_date) + 30 AS deposit_refund_by
    FROM public.property_leases l JOIN public.property_details pd ON pd.id = l.property_id
   WHERE l.deleted_at IS NULL AND pd.deleted_at IS NULL;

-- ปิดเดือน: เงินประกันเลยกำหนดคืน = เกิน 30 วันนับจากวันสิ้นสุด / เลิกสัญญา (แก้เฉพาะส่วนนี้ · ส่วนอื่นไม่เปลี่ยน)
DO $$
DECLARE
  d text;
  old1 text := E'     AND coalesce(l.terminated_date, l.end_date) < d\n     AND (l.deposit_settled_date IS NULL OR l.deposit_settled_date > d);';
  new1 text := E'     AND coalesce(l.terminated_date, l.end_date) + 30 < d\n     AND (l.deposit_settled_date IS NULL OR l.deposit_settled_date > d);';
  old2 text := E'เงินประกันเลยกำหนดคืน ''\n           || coalesce(l.terminated_date, l.end_date)::text';
  new2 text := E'เงินประกันเลยกำหนดคืน (ภายใน ''\n           || (coalesce(l.terminated_date, l.end_date) + 30)::text || '')''';
BEGIN
  d := replace(pg_get_functiondef('private.month_closing_issues(uuid, date)'::regprocedure), E'\r', '');
  IF position(new1 IN d) > 0 THEN RETURN; END IF;                                   -- รันซ้ำ
  IF (length(d) - length(replace(d, old1, ''))) / length(old1) <> 1
     OR (length(d) - length(replace(d, old2, ''))) / length(old2) <> 1 THEN
    RAISE EXCEPTION 'month_closing_issues: ไม่พบจุดที่ต้องแก้ (DEPOSIT_REFUND_OVERDUE)';
  END IF;
  EXECUTE replace(replace(d, old1, new1), old2, new2);
END $$;

-- 2) รายการเรียกเก็บผู้เช่า: ค่าน้ำไฟ (เดิม) / ค่าเสียหายส่วนที่เกินเงินประกัน --------------------------------------
ALTER TABLE public.lease_utility_charges ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'UTILITY';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'luc_kind_ck') THEN
    ALTER TABLE public.lease_utility_charges ADD CONSTRAINT luc_kind_ck CHECK (kind IN ('UTILITY', 'DAMAGE'));
  END IF;
END $$;

ALTER TABLE public.lease_closeouts
  ADD COLUMN IF NOT EXISTS collect_mode   text,                                         -- NOW / LATER (เฉพาะเมื่อหักเกินเงินประกัน)
  ADD COLUMN IF NOT EXISTS shortfall      public.d_money NOT NULL DEFAULT 0,            -- ยอดหักที่เกินเงินประกัน
  ADD COLUMN IF NOT EXISTS collected      public.d_money NOT NULL DEFAULT 0,            -- ส่วนที่เกินที่รับแล้ว (รวมส่วนที่หักกับค่าเช่าล่วงหน้า)
  ADD COLUMN IF NOT EXISTS tenant_paid    public.d_money NOT NULL DEFAULT 0,            -- ผู้เช่าโอนเพิ่มให้ (หลังหักค่าเช่าล่วงหน้า)
  ADD COLUMN IF NOT EXISTS owed_pending   public.d_money NOT NULL DEFAULT 0,            -- ค่าเสียหายที่ยังค้างรับ
  ADD COLUMN IF NOT EXISTS owed_charge_id uuid REFERENCES public.lease_utility_charges(id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lco_collect_ck') THEN
    ALTER TABLE public.lease_closeouts ADD CONSTRAINT lco_collect_ck CHECK (collect_mode IS NULL OR collect_mode IN ('NOW', 'LATER'));
  END IF;
END $$;

-- รายการเรียกเก็บ: คอลัมน์เดิม + kind ท้ายตาราง (แท็บรับค่าเช่า / หน้าทรัพย์สินแยกชื่อรายการ)
CREATE OR REPLACE VIEW public.v_lease_utility_charges WITH (security_invoker = true) AS
  SELECT c.id, c.lease_id, c.expense_item_id, c.property_utility_id, c.cost_period, c.description, c.amount, c.currency,
         c.notes, c.created_at, pd.asset_id AS property_asset_id,
         concat_ws(' · ', a.name, l.unit_label, l.tenant_name) AS name,
         e.date AS paid_date, e.amount AS paid_amount,
         CASE WHEN i.id IS NOT NULL THEN 'RECEIVED' ELSE 'PENDING' END AS status,
         i.id AS income_id, i.date AS received_date, i.amount AS received_amount, i.received_to_asset_id,
         c.kind
    FROM public.lease_utility_charges c
    JOIN public.property_leases l ON l.id = c.lease_id
    JOIN public.property_details pd ON pd.id = l.property_id
    JOIN public.assets a ON a.id = pd.asset_id
    LEFT JOIN public.expense_items e ON e.id = c.expense_item_id
    LEFT JOIN public.income_transactions i ON i.id = c.income_id AND i.deleted_at IS NULL
   WHERE c.deleted_at IS NULL AND l.deleted_at IS NULL
     AND (c.expense_item_id IS NULL OR e.deleted_at IS NULL OR i.id IS NOT NULL);

-- รายการค่าเสียหาย (DAMAGE) สร้าง / แก้ยอด / ลบได้เฉพาะผ่านผู้เช่าออก · รับเงิน (ผูก income_id) และแก้หมายเหตุได้ตามปกติ
CREATE OR REPLACE FUNCTION private.tg_closeout_charge_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$          -- INVOKER: ต้องเห็น current_user จริงใน is_client()
BEGIN
  IF NOT private.is_client() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind <> 'UTILITY' THEN
      RAISE EXCEPTION 'INVALID: รายการค่าเสียหายสร้างได้จากปุ่ม "ผู้เช่าออก" เท่านั้น' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'INVALID: เปลี่ยนประเภทรายการเรียกเก็บไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF OLD.kind = 'DAMAGE' AND (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.lease_id IS DISTINCT FROM OLD.lease_id OR NEW.cost_period IS DISTINCT FROM OLD.cost_period
      OR NEW.description IS DISTINCT FROM OLD.description OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    RAISE EXCEPTION 'INVALID: ค่าเสียหายส่วนที่เกินเงินประกันมาจากการบันทึกผู้เช่าออก — แก้ / ลบได้ด้วยปุ่ม "ยกเลิกผู้เช่าออก" ในสัญญาเช่า'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_closeout_charge_lock() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t15_closeout_charge_lock ON public.lease_utility_charges;
CREATE TRIGGER t15_closeout_charge_lock BEFORE INSERT OR UPDATE ON public.lease_utility_charges
  FOR EACH ROW EXECUTE FUNCTION private.tg_closeout_charge_lock();

-- 3) บันทึกผู้เช่าออก (เพิ่ม p_collect ท้ายสุด · ผู้เรียกเดิมที่ไม่ส่ง = ยังไม่ได้รับ) --------------------------------------
DROP FUNCTION IF EXISTS public.close_lease(uuid, date, date, uuid, numeric, text, numeric, text, text);
CREATE OR REPLACE FUNCTION public.close_lease(
  p_lease_id uuid, p_move_out date, p_settled_date date, p_bank_asset_id uuid DEFAULT NULL,
  p_damage numeric DEFAULT 0, p_damage_reason text DEFAULT NULL,
  p_forfeit numeric DEFAULT 0, p_forfeit_reason text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_collect text DEFAULT 'LATER')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l public.property_leases; pv jsonb; x jsonb; v_ccy text; v_bank_ccy text; v_asset uuid; v_name text;
  v_dep numeric := 0; v_unpaid numeric; v_util numeric; v_over numeric;
  v_damage numeric := round(coalesce(p_damage, 0), 2); v_forfeit numeric := round(coalesce(p_forfeit, 0), 2);
  v_collect text := upper(coalesce(nullif(trim(p_collect), ''), 'LATER'));
  v_room numeric; v_ded numeric; v_refund numeric; v_short numeric; v_cash numeric; v_pending numeric := 0;
  v_pool numeric; v_cpool numeric; v_amt numeric; c1 numeric; c2 numeric; v_term boolean := false;
  v_inc uuid; v_incs uuid[] := '{}'; v_mv uuid; v_exp uuid; v_id uuid; v_charge uuid;
  v_dep_note text := 'หักจากเงินประกันตอนผู้เช่าออก';
  v_cash_note text := 'ผู้เช่าจ่ายเพิ่มตอนออก (ส่วนที่เกินเงินประกัน)';
  v_out text := to_char(p_move_out, 'DD/MM/') || (extract(year FROM p_move_out)::int + 543);
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO l FROM public.property_leases WHERE id = p_lease_id AND deleted_at IS NULL FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบสัญญา' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.lease_closeouts WHERE lease_id = l.id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: บันทึกผู้เช่าออกของสัญญานี้แล้ว' USING ERRCODE = '22023';
  END IF;
  IF l.deposit_settlement_type IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID: เงินประกันของสัญญานี้ปิดไปแล้ว (คืน / ยกไปสัญญาใหม่) — ยกเลิกก่อนจึงบันทึกผู้เช่าออกได้' USING ERRCODE = '22023';
  END IF;
  IF p_move_out IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาใส่วันที่ผู้เช่าออก' USING ERRCODE = '22023'; END IF;
  IF l.terminated_date IS NOT NULL AND p_move_out <> l.terminated_date THEN
    RAISE EXCEPTION 'INVALID: สัญญานี้เลิกไว้แล้ววันที่ % — วันที่ออกต้องตรงกัน (แก้วันเลิกสัญญาได้เฉพาะ ADMIN)',
      to_char(l.terminated_date, 'DD/MM/') || (extract(year FROM l.terminated_date)::int + 543) USING ERRCODE = '22023';
  END IF;
  IF p_move_out < l.start_date OR p_move_out > l.end_date THEN
    RAISE EXCEPTION 'INVALID: วันที่ออกต้องอยู่ระหว่างวันเริ่มถึงวันสิ้นสุดสัญญา' USING ERRCODE = '22023';
  END IF;
  IF p_move_out > current_date THEN
    RAISE EXCEPTION 'INVALID: วันที่ออกเป็นวันในอนาคต — ติ๊ก "คืนเงินทีหลัง" เพื่อบันทึกวันออกไว้ก่อน แล้วค่อยคืนเงินเมื่อถึงวันนั้น' USING ERRCODE = '22023';
  END IF;
  IF p_settled_date IS NULL OR p_settled_date < p_move_out OR p_settled_date > current_date THEN
    RAISE EXCEPTION 'INVALID: วันที่คืนเงิน / รับเงินต้องตั้งแต่วันที่ออกถึงวันนี้' USING ERRCODE = '22023';
  END IF;
  IF v_damage < 0 OR v_forfeit < 0 THEN RAISE EXCEPTION 'INVALID: ยอดหักต้องไม่ติดลบ' USING ERRCODE = '22023'; END IF;
  IF v_damage > 0 AND length(trim(coalesce(p_damage_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาระบุรายการค่าเสียหาย' USING ERRCODE = '22023';
  END IF;
  IF v_forfeit > 0 AND length(trim(coalesce(p_forfeit_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาระบุเหตุผลที่ริบเงินประกัน' USING ERRCODE = '22023';
  END IF;
  IF v_collect NOT IN ('NOW', 'LATER') THEN
    RAISE EXCEPTION 'INVALID: เลือก "รับเงินแล้ว" หรือ "ยังไม่ได้รับ"' USING ERRCODE = '22023';
  END IF;
  v_ccy := l.rent_currency;
  IF coalesce(l.security_deposit, 0) > 0 THEN
    v_dep := l.security_deposit;
    IF l.deposit_currency IS DISTINCT FROM v_ccy THEN
      RAISE EXCEPTION 'INVALID: เงินประกันคนละสกุลกับค่าเช่า — ใช้ "คืน / หักเงินประกัน" แยก' USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT pd.asset_id INTO v_asset FROM public.property_details pd WHERE pd.id = l.property_id;
  v_name := concat_ws(' · ', nullif(trim(l.unit_label), ''), l.tenant_name);

  -- ยอดถึงวันออก (สูตรเดียวกับตัวอย่างในหน้าต่าง)
  pv := public.lease_closeout_preview(l.id, p_move_out);
  v_unpaid := (pv->>'unpaid_rent')::numeric;
  v_util := (pv->>'utilities')::numeric;
  v_over := (pv->>'advance_rent')::numeric;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(pv->'charges') c WHERE c->>'currency' <> v_ccy) THEN
    RAISE EXCEPTION 'INVALID: มีค่าน้ำไฟเรียกเก็บคนละสกุลกับค่าเช่า — บันทึกรับแยกก่อน' USING ERRCODE = '22023';
  END IF;
  -- ริบได้ไม่เกินเงินประกันที่เหลือหลังหักค่าเช่า → ค่าน้ำไฟ → ค่าเสียหาย
  v_room := greatest(v_dep - v_unpaid - v_util - v_damage, 0);
  IF v_forfeit > v_room THEN
    RAISE EXCEPTION 'INVALID: ริบเงินประกันได้ไม่เกิน % (เงินประกันที่เหลือหลังหักค่าเช่า ค่าน้ำไฟ และค่าเสียหาย)',
      to_char(v_room, 'FM999,999,999,990.00') USING ERRCODE = '22023';
  END IF;
  v_ded := v_unpaid + v_util + v_damage + v_forfeit;
  v_refund := greatest(v_dep - v_ded, 0);
  v_short := greatest(v_ded - v_dep, 0);                                  -- ผู้เช่าต้องจ่ายเพิ่ม (ก่อนหักค่าเช่าล่วงหน้า)
  -- ส่วนที่เกิน: หักกับค่าเช่าล่วงหน้าที่ต้องคืนก่อน · รับเงินแล้ว = รับครบ · ยังไม่ได้รับ = ที่เหลือค้างรับ
  v_cash := CASE WHEN v_collect = 'NOW' THEN v_short ELSE least(v_over, v_short) END;
  IF v_short - v_cash > least(v_damage, v_short) THEN                      -- ค้างรับได้เฉพาะค่าเสียหาย
    RAISE EXCEPTION 'INVALID: ค่าเช่า / ค่าน้ำไฟที่ค้างเกินเงินประกัน — เลือก "รับเงินแล้ว" หรือรับค่าเช่า / ค่าน้ำไฟที่ค้างแยกก่อน (แท็บรับค่าเช่า)'
      USING ERRCODE = '22023';
  END IF;
  IF v_refund + v_over + v_cash > 0 THEN
    IF p_bank_asset_id IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่โอนคืน / รับเงิน' USING ERRCODE = '22023'; END IF;
    IF NOT private.is_bank_asset(p_bank_asset_id) THEN RAISE EXCEPTION 'INVALID: บัญชีที่โอนคืน / รับเงินต้องเป็นบัญชีธนาคาร' USING ERRCODE = '22023'; END IF;
    SELECT a.currency INTO v_bank_ccy FROM public.assets a WHERE a.id = p_bank_asset_id;
    IF v_bank_ccy IS DISTINCT FROM v_ccy THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีที่โอนคืน / รับเงินต้องสกุลเดียวกับสัญญา (%)', v_ccy USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ก) ออกก่อนวันสิ้นสุด → เลิกสัญญา ณ วันที่ออก
  IF l.terminated_date IS NULL AND p_move_out < l.end_date THEN
    UPDATE public.property_leases SET status = 'TERMINATED', terminated_date = p_move_out WHERE id = l.id;
    v_term := true;
  END IF;

  -- หักทีละรายการตามลำดับ: เงินประกัน (v_pool · ไม่ผ่านบัญชี) ก่อน แล้วเงินที่รับเพิ่ม (v_cpool · เข้าบัญชีที่เลือก)
  v_pool := v_dep; v_cpool := v_cash;
  -- ข) ค่าเช่าค้าง → รายได้ค่าเช่าของงวดนั้น
  FOR x IN SELECT * FROM jsonb_array_elements(pv->'rent') LOOP
    v_amt := (x->>'unpaid')::numeric;
    CONTINUE WHEN v_amt <= 0;
    c1 := least(v_amt, v_pool); v_pool := v_pool - c1;
    c2 := v_amt - c1; v_cpool := v_cpool - c2;
    IF c1 > 0 THEN
      INSERT INTO public.income_transactions(lease_id, income_type, date, income_period, amount, currency, notes)
      VALUES (l.id, 'RENT', p_settled_date, (x->>'period')::date, c1, v_ccy, v_dep_note) RETURNING id INTO v_inc;
      v_incs := v_incs || v_inc;
    END IF;
    IF c2 > 0 THEN
      INSERT INTO public.income_transactions(lease_id, income_type, date, income_period, amount, currency, received_to_asset_id, notes)
      VALUES (l.id, 'RENT', p_settled_date, (x->>'period')::date, c2, v_ccy, p_bank_asset_id, v_cash_note) RETURNING id INTO v_inc;
      v_incs := v_incs || v_inc;
    END IF;
  END LOOP;
  -- ค) ค่าน้ำไฟเรียกเก็บที่ค้าง → รายได้ค่าน้ำไฟ + ผูกกับรายการเรียกเก็บ (ส่วนที่เกินเงินประกัน = รับเข้าบัญชี)
  FOR x IN SELECT * FROM jsonb_array_elements(pv->'charges') LOOP
    v_amt := (x->>'amount')::numeric;
    c1 := least(v_amt, v_pool); v_pool := v_pool - c1;
    c2 := v_amt - c1; v_cpool := v_cpool - c2;
    IF c1 > 0 THEN
      INSERT INTO public.income_transactions(lease_id, income_type, income_subtype, date, income_period, amount, currency, notes)
      VALUES (l.id, 'OTHER', 'ค่าน้ำไฟเรียกเก็บจากผู้เช่า', p_settled_date, (x->>'period')::date, c1, v_ccy,
              concat_ws(' · ', x->>'description', v_dep_note)) RETURNING id INTO v_inc;
      v_incs := v_incs || v_inc;
    END IF;
    IF c2 > 0 THEN
      INSERT INTO public.income_transactions(lease_id, income_type, income_subtype, date, income_period, amount, currency, received_to_asset_id, notes)
      VALUES (l.id, 'OTHER', 'ค่าน้ำไฟเรียกเก็บจากผู้เช่า', p_settled_date, (x->>'period')::date, c2, v_ccy, p_bank_asset_id,
              concat_ws(' · ', x->>'description', v_cash_note)) RETURNING id INTO v_inc;
      v_incs := v_incs || v_inc;
    END IF;
    UPDATE public.lease_utility_charges SET income_id = v_inc WHERE id = (x->>'id')::uuid;
  END LOOP;
  -- ง) ค่าเสียหาย: หักจากเงินประกัน → รับเพิ่ม → ที่เหลือค้างรับ (รายการเรียกเก็บผู้เช่า)
  IF v_damage > 0 THEN
    c1 := least(v_damage, v_pool); v_pool := v_pool - c1;
    c2 := least(v_damage - c1, v_cpool); v_cpool := v_cpool - c2;
    v_pending := v_damage - c1 - c2;
    IF c1 > 0 THEN
      INSERT INTO public.income_transactions(lease_id, income_type, income_subtype, date, amount, currency, notes)
      VALUES (l.id, 'OTHER', 'ค่าเสียหายจากผู้เช่า', p_settled_date, c1, v_ccy, 'หักจากเงินประกัน: ' || trim(p_damage_reason))
      RETURNING id INTO v_inc;
      v_incs := v_incs || v_inc;
    END IF;
    IF c2 > 0 THEN
      INSERT INTO public.income_transactions(lease_id, income_type, income_subtype, date, amount, currency, received_to_asset_id, notes)
      VALUES (l.id, 'OTHER', 'ค่าเสียหายจากผู้เช่า', p_settled_date, c2, v_ccy, p_bank_asset_id,
              'ค่าเสียหายส่วนที่เกินเงินประกัน: ' || trim(p_damage_reason))
      RETURNING id INTO v_inc;
      v_incs := v_incs || v_inc;
    END IF;
    IF v_pending > 0 THEN
      INSERT INTO public.lease_utility_charges(lease_id, kind, cost_period, description, amount, currency, notes)
      VALUES (l.id, 'DAMAGE', date_trunc('month', p_settled_date)::date,
              'ค่าเสียหายส่วนที่เกินเงินประกัน: ' || trim(p_damage_reason), v_pending, v_ccy, 'ผู้เช่าออก ' || v_out)
      RETURNING id INTO v_charge;
    END IF;
  END IF;
  -- จ) ริบเงินประกัน (ไม่เกินเงินประกันที่เหลือ) → รายได้อื่น
  IF v_forfeit > 0 THEN
    v_pool := v_pool - v_forfeit;
    INSERT INTO public.income_transactions(lease_id, income_type, date, amount, currency, notes)
    VALUES (l.id, 'OTHER', p_settled_date, v_forfeit, v_ccy, 'หักจากเงินประกัน: ริบเงินประกัน · ' || trim(p_forfeit_reason))
    RETURNING id INTO v_inc;
    v_incs := v_incs || v_inc;
  END IF;
  IF v_pool <> v_refund OR v_cpool <> 0 THEN                              -- ตรวจซ้ำ: ทุกบาทถูกจัดสรรครบ
    RAISE EXCEPTION 'INVALID: คำนวณยอดหักไม่ลงตัว (เหลือ % / %) — แจ้งผู้ดูแลระบบ', v_pool, v_cpool USING ERRCODE = '22023';
  END IF;
  -- ฉ) เงินประกัน: คืนส่วนที่เหลือ → ปิดหนี้เงินประกัน
  IF v_dep > 0 THEN
    IF v_refund > 0 THEN
      INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, related_lease_id, amount, currency, description)
      VALUES (private.default_family_id(), p_settled_date, 'SECURITY_DEPOSIT_OUT', p_bank_asset_id, l.id, v_refund, v_ccy,
              'คืนเงินประกัน · ' || l.tenant_name)
      RETURNING id INTO v_mv;
    END IF;
    UPDATE public.property_leases SET deposit_settled_date = p_settled_date, deposit_settlement_type = 'REFUNDED',
           deposit_refunded_amount = v_refund
     WHERE id = l.id;
  END IF;
  -- ช) ค่าเช่าที่จ่ายล่วงหน้าเกิน → คืนผู้เช่า = ค่าใช้จ่ายของทรัพย์สิน (รายได้ติดลบไม่ได้) · ส่วนที่ผู้เช่าต้องจ่ายเพิ่มหักกันในบัญชีเดียวกัน
  IF v_over > 0 THEN
    v_exp := public.add_expense(jsonb_build_object(
      'date', p_settled_date, 'description', 'คืนค่าเช่าล่วงหน้า · ' || v_name, 'amount', v_over, 'currency', v_ccy,
      'paid_from_asset_id', p_bank_asset_id, 'related_asset_id', v_asset,
      'expense_category', 'บ้าน / สาธารณูปโภค', 'property_cost_type', 'OTHER',
      'notes', 'ผู้เช่าออก ' || v_out || ' · ค่าเช่าที่รับเกินวันที่อยู่จริง'));
  END IF;

  INSERT INTO public.lease_closeouts(lease_id, move_out_date, settled_date, bank_asset_id, currency, deposit_held,
              unpaid_rent, utilities, damage, damage_reason, forfeit, forfeit_reason, deposit_refund, advance_refund, net_transfer,
              terminated_by_closeout, lines, income_ids, expense_id, movement_id, notes,
              collect_mode, shortfall, collected, tenant_paid, owed_pending, owed_charge_id)
  VALUES (l.id, p_move_out, p_settled_date, CASE WHEN v_refund + v_over + v_cash > 0 THEN p_bank_asset_id END, v_ccy, v_dep,
          v_unpaid, v_util, v_damage, nullif(trim(p_damage_reason), ''), v_forfeit, nullif(trim(p_forfeit_reason), ''),
          v_refund, v_over, greatest(v_refund + v_over - v_cash, 0), v_term, jsonb_build_object('rent', pv->'rent', 'charges', pv->'charges'),
          v_incs, v_exp, v_mv, nullif(trim(p_notes), ''),
          CASE WHEN v_short > 0 THEN v_collect END, v_short, v_cash, greatest(v_cash - v_refund - v_over, 0), v_pending, v_charge)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('closeout_id', v_id, 'deducted', v_ded, 'deposit_refund', v_refund, 'advance_refund', v_over,
                            'net_transfer', greatest(v_refund + v_over - v_cash, 0), 'terminated', v_term,
                            'shortfall', v_short, 'tenant_paid', greatest(v_cash - v_refund - v_over, 0), 'owed_pending', v_pending);
END $$;
REVOKE ALL ON FUNCTION public.close_lease(uuid, date, date, uuid, numeric, text, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_lease(uuid, date, date, uuid, numeric, text, numeric, text, text, text) TO authenticated;

-- ยกเลิกผู้เช่าออก: ลบรายการที่สร้างทั้งหมด (รวมค่าเสียหายค้างรับ) · เงินประกันกลับเป็นหนี้ · วันเลิกสัญญากลับเหมือนเดิม
CREATE OR REPLACE FUNCTION public.undo_close_lease(p_lease_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE co public.lease_closeouts;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO co FROM public.lease_closeouts WHERE lease_id = p_lease_id AND deleted_at IS NULL FOR UPDATE;
  IF co.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบันทึกผู้เช่าออกของสัญญานี้' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.property_leases WHERE id = p_lease_id FOR UPDATE;
  IF co.owed_charge_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.lease_utility_charges c JOIN public.income_transactions i ON i.id = c.income_id AND i.deleted_at IS NULL
        WHERE c.id = co.owed_charge_id) THEN
    RAISE EXCEPTION 'INVALID: ผู้เช่าจ่ายค่าเสียหายส่วนที่ค้างแล้ว — ลบรายการรับเงินนั้นก่อน (แท็บรับค่าเช่า) แล้วจึงยกเลิกผู้เช่าออก'
      USING ERRCODE = '22023';
  END IF;
  -- รายได้ (ค่าเช่าค้าง / ค่าน้ำไฟ / ค่าเสียหาย / ริบ / ส่วนที่รับเพิ่ม) → รายการเรียกเก็บค่าน้ำไฟกลับเป็น "รอรับ" เอง
  UPDATE public.income_transactions SET deleted_at = now() WHERE id = ANY (co.income_ids) AND deleted_at IS NULL;
  IF co.expense_id IS NOT NULL THEN
    UPDATE public.expense_items SET deleted_at = now() WHERE id = co.expense_id AND deleted_at IS NULL;
  END IF;
  IF co.movement_id IS NOT NULL THEN
    UPDATE public.cash_movements SET deleted_at = now() WHERE id = co.movement_id AND deleted_at IS NULL;
  END IF;
  IF co.owed_charge_id IS NOT NULL THEN
    UPDATE public.lease_utility_charges SET deleted_at = now() WHERE id = co.owed_charge_id AND deleted_at IS NULL;
  END IF;
  IF co.deposit_held > 0 THEN
    UPDATE public.property_leases SET deposit_settled_date = NULL, deposit_settlement_type = NULL, deposit_refunded_amount = NULL
     WHERE id = p_lease_id AND deposit_settlement_type = 'REFUNDED';
  END IF;
  UPDATE public.lease_closeouts SET deleted_at = now() WHERE id = co.id;
  IF co.terminated_by_closeout THEN
    UPDATE public.property_leases SET status = 'ACTIVE', terminated_date = NULL
     WHERE id = p_lease_id AND terminated_date = co.move_out_date;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.undo_close_lease(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_close_lease(uuid) TO authenticated;

-- 4) รับค่าเช่าหลายรายการ (เหมือน 20261106070000) · รายการเรียกเก็บ DAMAGE → รายได้อื่น "ค่าเสียหายจากผู้เช่า"
CREATE OR REPLACE FUNCTION public.batch_record_rent(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_n integer := 0; v_lease uuid; v_date date; v_amount numeric; v_tax numeric; v_bank uuid; v_ccy text; v_name text;
        c public.lease_utility_charges; v_inc uuid; v_fee numeric;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID: ไม่มีรายการที่จะบันทึก' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    c := NULL;
    IF nullif(r->>'charge_id', '') IS NOT NULL THEN
      SELECT * INTO c FROM public.lease_utility_charges WHERE id = (r->>'charge_id')::uuid AND deleted_at IS NULL FOR UPDATE;
      IF c.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบรายการเรียกเก็บผู้เช่า' USING ERRCODE = '22023'; END IF;
      v_lease := c.lease_id;
    ELSE
      v_lease := nullif(r->>'lease_id', '')::uuid;
    END IF;
    v_date   := nullif(r->>'date', '')::date;
    v_amount := nullif(r->>'amount', '')::numeric;
    v_tax    := coalesce(nullif(r->>'tax', '')::numeric, 0);
    v_fee    := coalesce(nullif(r->>'late_fee', '')::numeric, 0);
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
    IF v_tax < 0 OR v_tax >= v_amount THEN
      RAISE EXCEPTION 'INVALID: % · ภาษีหัก ณ ที่จ่ายต้องน้อยกว่ายอดก่อนภาษี', v_name USING ERRCODE = '22023';
    END IF;
    IF c.id IS NOT NULL AND v_tax > 0 THEN
      RAISE EXCEPTION 'INVALID: % · รายการเรียกเก็บผู้เช่าไม่มีภาษีหัก ณ ที่จ่าย', v_name USING ERRCODE = '22023';
    END IF;
    IF v_fee < 0 THEN RAISE EXCEPTION 'INVALID: % · ค่าปรับต้องไม่ติดลบ', v_name USING ERRCODE = '22023'; END IF;
    IF c.id IS NOT NULL AND v_fee > 0 THEN
      RAISE EXCEPTION 'INVALID: % · รายการเรียกเก็บผู้เช่าไม่มีค่าปรับ', v_name USING ERRCODE = '22023';
    END IF;
    IF v_bank IS NOT NULL THEN SELECT a.currency INTO v_ccy FROM public.assets a WHERE a.id = v_bank; END IF;
    IF c.id IS NULL THEN
      INSERT INTO public.income_transactions(lease_id, income_type, date, income_period, amount, tax, currency, received_to_asset_id, notes)
      VALUES (v_lease, 'RENT', v_date, nullif(r->>'income_period', '')::date, v_amount, nullif(v_tax, 0), v_ccy, v_bank, nullif(trim(r->>'notes'), ''));
      IF v_fee > 0 THEN
        INSERT INTO public.income_transactions(lease_id, income_type, income_subtype, date, income_period, amount, currency, received_to_asset_id, notes)
        VALUES (v_lease, 'OTHER', 'ค่าปรับชำระค่าเช่าล่าช้า', v_date, nullif(r->>'income_period', '')::date, v_fee, v_ccy, v_bank,
                'ค่าปรับชำระค่าเช่าล่าช้า' || coalesce(' · งวด ' || to_char(nullif(r->>'income_period', '')::date, 'MM/') ||
                  (extract(year FROM nullif(r->>'income_period', '')::date)::int + 543), ''));
      END IF;
    ELSE
      INSERT INTO public.income_transactions(lease_id, income_type, income_subtype, date, income_period, amount, currency, received_to_asset_id, notes)
      VALUES (v_lease, 'OTHER', CASE c.kind WHEN 'DAMAGE' THEN 'ค่าเสียหายจากผู้เช่า' ELSE 'ค่าน้ำไฟเรียกเก็บจากผู้เช่า' END,
              v_date, c.cost_period, v_amount, v_ccy, v_bank,
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
