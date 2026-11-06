-- =====================================================================
-- สัญญาเช่า: แก้เงินประกันได้ · ต่อสัญญาเงินประกันใหม่น้อยกว่าเดิม · EDITOR แก้วันออกล่วงหน้า (ตกลงกับเจ้าของ 6 พ.ย. 2026)
--   1) set_lease_deposit(): แก้ยอดเงินประกัน / วันที่รับ / บัญชีที่รับ ในหน้าต่าง "แก้ไขสัญญา"
--      ใช้ได้จนกว่าจะคืนเงินประกัน ยกไปสัญญาใหม่ หรือบันทึกผู้เช่าออก
--      รายการเงินเข้า "รับเงินประกัน" ปรับตามให้ (มีอยู่แล้ว = แก้ยอด / วัน / บัญชี · ยังไม่มี = สร้างตอนเลือกบัญชี · เอาบัญชีออก = ลบ)
--      รับก่อน Go-live = อยู่ในยอดตั้งต้นแล้ว ไม่สร้างรายการเงินเข้า (เหมือนตอนสร้างสัญญา)
--   2) ต่อสัญญาแล้วเงินประกันใหม่น้อยกว่าเดิมได้: ยกมาเท่าเงินประกันใหม่ ส่วนต่างคืนผู้เช่าจากบัญชีที่เลือก ณ วันเริ่มสัญญาใหม่
--      (รายการเงินออก "คืนเงินประกัน" ผูกกับสัญญาเดิม · สัญญาเดิมปิดเงินประกันแบบยกไปสัญญาใหม่ + คืนส่วนต่าง)
--      มากกว่าเดิม = รับส่วนที่เพิ่มเข้าบัญชีเหมือนเดิม · แก้ยอดทีหลังที่ "แก้ไขสัญญา" ได้ (ระบบปรับรายการรับเพิ่ม / คืนส่วนต่างให้)
--   3) รายการเงินเข้า / ออกของเงินประกันแก้ / ลบตรงที่หน้าบัญชี / Income & Expenses ไม่ได้ (ต้องแก้ที่สัญญา เพื่อให้ยอดตรงกัน)
--   4) วันเลิกสัญญา (วันออก) ที่บันทึกไว้: EDITOR แก้ / ยกเลิกได้ก่อนถึงวันนั้น · ถึงวันแล้วเฉพาะ ADMIN (เดิม ADMIN เท่านั้น)
--   ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) ปรับรายการเงินเข้า / ออกของเงินประกันให้ตรงกับสัญญา ------------------------------------------------------
--   ไม่ได้ยกมา: รับ = เงินประกันทั้งก้อน ณ วันที่รับ (ไม่ระบุ = วันเริ่มสัญญา)
--   ยกมาจากสัญญาเดิม: ยกมา = min(เดิม, ใหม่) · รับเพิ่ม = ใหม่ − ยกมา · คืนส่วนต่าง = เดิม − ยกมา (ผูกกับสัญญาเดิม) · ณ วันเริ่มสัญญาใหม่
--   p_bank: บัญชีของส่วนที่มียอด (รับเพิ่ม หรือ คืนส่วนต่าง · มีได้อย่างเดียว) · ว่าง = ไม่ผ่านบัญชี (ลบรายการเดิมถ้ามี)
CREATE OR REPLACE FUNCTION private.lease_deposit_cash(p_lease_id uuid, p_bank uuid) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$          -- INVOKER: RLS + trigger ของบัญชี / งวดที่ปิด ทำงานตามปกติ
DECLARE
  l public.property_leases; o public.property_leases; m public.cash_movements;
  v_family uuid; v_go date; v_date date; v_in numeric; v_out numeric := 0; v_bank_ccy text;
  v_go_txt text;
BEGIN
  PERFORM set_config('fwv.lease_deposit', 'on', true);
  SELECT * INTO l FROM public.property_leases WHERE id = p_lease_id;
  SELECT a.family_id, f.go_live_date INTO v_family, v_go
    FROM public.property_details pd JOIN public.assets a ON a.id = pd.asset_id JOIN public.families f ON f.id = a.family_id
   WHERE pd.id = l.property_id;
  v_go_txt := to_char(v_go, 'DD/MM/') || (extract(year FROM v_go)::int + 543);
  IF l.deposit_carried_from_lease_id IS NOT NULL THEN
    SELECT * INTO o FROM public.property_leases WHERE id = l.deposit_carried_from_lease_id;
    v_in := coalesce(l.security_deposit, 0) - coalesce(l.deposit_carried_amount, 0);
    v_out := coalesce(o.security_deposit, 0) - coalesce(l.deposit_carried_amount, 0);
    v_date := l.start_date;
  ELSE
    v_in := coalesce(l.security_deposit, 0);
    v_date := coalesce(l.deposit_received_date, l.start_date);
  END IF;

  IF p_bank IS NOT NULL AND (v_in > 0 OR v_out > 0) THEN
    IF v_date < v_go THEN
      RAISE EXCEPTION 'INVALID: เงินประกัน%ก่อน Go-live (%) อยู่ในยอดบัญชีตั้งต้นแล้ว ไม่ต้องเลือกบัญชี',
        CASE WHEN v_out > 0 THEN 'ที่คืนส่วนต่าง' ELSE 'ที่รับ' END, v_go_txt USING ERRCODE = '22023';
    END IF;
    IF NOT private.is_bank_asset(p_bank) THEN
      RAISE EXCEPTION 'INVALID: บัญชีรับ / คืนเงินประกันต้องเป็นบัญชีธนาคาร' USING ERRCODE = '22023';
    END IF;
    SELECT a.currency INTO v_bank_ccy FROM public.assets a WHERE a.id = p_bank;
    IF v_bank_ccy IS DISTINCT FROM l.deposit_currency THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีรับ / คืนเงินประกันต้องสกุลเดียวกับเงินประกัน (%)', l.deposit_currency USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_out > 0 AND p_bank IS NULL AND v_date >= v_go THEN
    RAISE EXCEPTION 'INVALID: เงินประกันใหม่น้อยกว่าเดิม — เลือกบัญชีที่คืนส่วนต่าง % ให้ผู้เช่า',
      to_char(v_out, 'FM999,999,999,990.00') USING ERRCODE = '22023';
  END IF;

  -- ก) รับเงินประกัน (เงินเข้า · ผูกกับสัญญานี้)
  SELECT * INTO m FROM public.cash_movements
   WHERE related_lease_id = l.id AND movement_type = 'SECURITY_DEPOSIT_IN' AND deleted_at IS NULL AND NOT is_derived
   ORDER BY created_at, id LIMIT 1;
  UPDATE public.cash_movements SET deleted_at = now()
   WHERE related_lease_id = l.id AND movement_type = 'SECURITY_DEPOSIT_IN' AND deleted_at IS NULL AND NOT is_derived
     AND (v_in <= 0 OR p_bank IS NULL OR id <> m.id);
  IF v_in > 0 AND p_bank IS NOT NULL THEN
    IF m.id IS NULL THEN
      INSERT INTO public.cash_movements(family_id, movement_date, movement_type, to_asset_id, related_lease_id, amount, currency, description)
      VALUES (v_family, v_date, 'SECURITY_DEPOSIT_IN', p_bank, l.id, v_in, l.deposit_currency, 'รับเงินประกัน · ' || l.tenant_name);
    ELSIF (m.movement_date, m.to_asset_id, m.amount, m.currency) IS DISTINCT FROM (v_date, p_bank, v_in, l.deposit_currency) THEN
      UPDATE public.cash_movements SET movement_date = v_date, to_asset_id = p_bank, amount = v_in, currency = l.deposit_currency
       WHERE id = m.id;
    END IF;
  END IF;

  -- ข) คืนส่วนต่างเงินประกันเดิม (เงินออก · ผูกกับสัญญาเดิม)
  IF o.id IS NOT NULL THEN
    m := NULL;
    SELECT * INTO m FROM public.cash_movements
     WHERE related_lease_id = o.id AND movement_type = 'SECURITY_DEPOSIT_OUT' AND deleted_at IS NULL AND NOT is_derived
     ORDER BY created_at, id LIMIT 1;
    UPDATE public.cash_movements SET deleted_at = now()
     WHERE related_lease_id = o.id AND movement_type = 'SECURITY_DEPOSIT_OUT' AND deleted_at IS NULL AND NOT is_derived
       AND (v_out <= 0 OR p_bank IS NULL OR id <> m.id);
    IF v_out > 0 AND p_bank IS NOT NULL THEN
      IF m.id IS NULL THEN
        INSERT INTO public.cash_movements(family_id, movement_date, movement_type, from_asset_id, related_lease_id, amount, currency, description)
        VALUES (v_family, v_date, 'SECURITY_DEPOSIT_OUT', p_bank, o.id, v_out, o.deposit_currency,
                'คืนส่วนต่างเงินประกัน (ต่อสัญญา) · ' || o.tenant_name);
      ELSIF (m.movement_date, m.from_asset_id, m.amount, m.currency) IS DISTINCT FROM (v_date, p_bank, v_out, o.deposit_currency) THEN
        UPDATE public.cash_movements SET movement_date = v_date, from_asset_id = p_bank, amount = v_out, currency = o.deposit_currency
         WHERE id = m.id;
      END IF;
    END IF;
  END IF;
  PERFORM set_config('fwv.lease_deposit', 'off', true);
END $$;
REVOKE ALL ON FUNCTION private.lease_deposit_cash(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.lease_deposit_cash(uuid, uuid) TO authenticated;

-- 2) แก้เงินประกันในหน้าต่าง "แก้ไขสัญญา" -------------------------------------------------------------------
--   สิทธิ์ = เหมือนแก้สัญญา (RLS) · p_received_date ใช้เฉพาะสัญญาที่ไม่ได้ยกเงินประกันมา (ยกมา = วันเริ่มสัญญาเสมอ)
CREATE OR REPLACE FUNCTION public.set_lease_deposit(p_lease_id uuid, p_amount numeric, p_received_date date DEFAULT NULL,
                                                    p_bank_asset_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE l public.property_leases; o public.property_leases; v_amt numeric := round(coalesce(p_amount, 0), 2); v_carry numeric;
BEGIN
  SELECT * INTO l FROM public.property_leases WHERE id = p_lease_id AND deleted_at IS NULL;
  IF l.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบสัญญานี้' USING ERRCODE = '22023'; END IF;
  IF l.deposit_settlement_type IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID: เงินประกันของสัญญานี้%แล้ว — แก้ยอดไม่ได้',
      CASE l.deposit_settlement_type WHEN 'REFUNDED' THEN 'คืน' ELSE 'ยกไปสัญญาใหม่' END USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lease_closeouts c WHERE c.lease_id = l.id AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: บันทึกผู้เช่าออกแล้ว — กด "ยกเลิกผู้เช่าออก" ก่อนแก้เงินประกัน' USING ERRCODE = '22023';
  END IF;
  IF v_amt < 0 THEN RAISE EXCEPTION 'INVALID: เงินประกันต้องไม่ติดลบ' USING ERRCODE = '22023'; END IF;
  IF l.deposit_carried_from_lease_id IS NOT NULL THEN
    SELECT * INTO o FROM public.property_leases WHERE id = l.deposit_carried_from_lease_id;
    IF v_amt <= 0 THEN
      RAISE EXCEPTION 'INVALID: สัญญานี้ยกเงินประกันจากสัญญาเดิมมา ต้องมีเงินประกัน — ถ้าไม่เก็บแล้ว ให้ลบสัญญานี้แล้วคืนเงินประกันของสัญญาเดิม'
        USING ERRCODE = '22023';
    END IF;
    v_carry := least(o.security_deposit, v_amt);
  END IF;
  PERFORM set_config('fwv.lease_deposit', 'on', true);
  UPDATE public.property_leases
     SET security_deposit = nullif(v_amt, 0), deposit_carried_amount = v_carry,
         deposit_received_date = CASE WHEN l.deposit_carried_from_lease_id IS NULL THEN p_received_date ELSE deposit_received_date END
   WHERE id = l.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_DENIED: ไม่มีสิทธิ์แก้ไขสัญญานี้' USING ERRCODE = '42501'; END IF;
  PERFORM private.lease_deposit_cash(l.id, p_bank_asset_id);
END $$;
REVOKE ALL ON FUNCTION public.set_lease_deposit(uuid, numeric, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lease_deposit(uuid, numeric, date, uuid) TO authenticated;

-- 3) สร้างสัญญา / ต่อสัญญา: เงินประกันใหม่น้อยกว่าเดิมได้ (คืนส่วนต่าง) ---------------------------------------
CREATE OR REPLACE FUNCTION public.create_lease(p_property_asset_id uuid, p_lease jsonb)
RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_prop uuid; v_family uuid; v_id uuid;
  v_dep numeric; v_ccy text; v_start date; v_recv date;
  o public.property_leases; v_carried numeric;
BEGIN
  SELECT pd.id, a.family_id, upper(coalesce(nullif(p_lease->>'rent_currency', ''), a.currency))
    INTO v_prop, v_family, v_ccy
    FROM public.property_details pd JOIN public.assets a ON a.id = pd.asset_id
   WHERE pd.asset_id = p_property_asset_id AND pd.deleted_at IS NULL AND a.deleted_at IS NULL;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'INVALID: ไม่พบทรัพย์สินนี้' USING ERRCODE = '22023'; END IF;

  IF length(trim(coalesce(p_lease->>'tenant_name', ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อผู้เช่า' USING ERRCODE = '22023';
  END IF;
  IF nullif(p_lease->>'start_date', '') IS NULL OR nullif(p_lease->>'end_date', '') IS NULL
     OR nullif(p_lease->>'rent_amount', '') IS NULL THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่วันเริ่ม วันสิ้นสุด และค่าเช่า' USING ERRCODE = '22023';
  END IF;

  v_start := (p_lease->>'start_date')::date;
  v_dep   := nullif(p_lease->>'security_deposit', '')::numeric;
  v_recv  := nullif(p_lease->>'deposit_received_date', '')::date;

  IF nullif(p_lease->>'carried_from_lease_id', '') IS NOT NULL THEN
    SELECT * INTO o FROM public.property_leases
     WHERE id = (p_lease->>'carried_from_lease_id')::uuid AND deleted_at IS NULL;
    IF NOT FOUND OR coalesce(o.security_deposit, 0) = 0 THEN
      RAISE EXCEPTION 'INVALID: สัญญาเดิมไม่มีเงินประกันให้ยกมา' USING ERRCODE = '22023';
    END IF;
    IF o.deposit_settled_date IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID: เงินประกันของสัญญาเดิมถูกคืน / ยกไปแล้ว' USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_dep, 0) <= 0 THEN
      RAISE EXCEPTION 'INVALID: ยกเงินประกันมาแล้วสัญญาใหม่ต้องมีเงินประกัน — ถ้าไม่เก็บเงินประกันแล้ว ไม่ต้องติ๊กยกเงินประกัน ให้คืนเงินประกันของสัญญาเดิมแทน'
        USING ERRCODE = '22023';
    END IF;
    v_carried := least(o.security_deposit, v_dep);      -- น้อยกว่าเดิม = ยกมาเท่าที่เก็บ ส่วนต่างคืนผู้เช่า
    v_recv := v_start;
  END IF;

  INSERT INTO public.property_leases(
    property_id, unit_label, tenant_name, contract_no, start_date, end_date,
    rent_amount, rent_currency, payment_frequency, payment_due_day,
    security_deposit, deposit_currency, deposit_received_date,
    deposit_carried_from_lease_id, deposit_carried_amount, notes)
  VALUES (
    v_prop, nullif(trim(p_lease->>'unit_label'), ''), trim(p_lease->>'tenant_name'),
    nullif(trim(p_lease->>'contract_no'), ''), v_start, (p_lease->>'end_date')::date,
    (p_lease->>'rent_amount')::numeric, v_ccy, coalesce(nullif(p_lease->>'payment_frequency', ''), 'MONTHLY'),
    nullif(p_lease->>'payment_due_day', '')::smallint,
    v_dep, CASE WHEN coalesce(v_dep, 0) > 0 THEN coalesce(o.deposit_currency, v_ccy) END, v_recv,
    o.id, v_carried, nullif(trim(p_lease->>'notes'), ''))
  RETURNING id INTO v_id;

  -- เงินประกันเข้า / ออกบัญชี (รับก่อน Go-live อยู่ในยอดตั้งต้นแล้ว ไม่สร้างรายการ)
  --   รับใหม่ / รับส่วนที่เพิ่ม → deposit_to_asset_id · ต่อสัญญาแล้วน้อยกว่าเดิม → คืนส่วนต่างจาก deposit_refund_from_asset_id
  PERFORM private.lease_deposit_cash(v_id,
    CASE WHEN o.id IS NOT NULL AND v_dep < o.security_deposit THEN nullif(p_lease->>'deposit_refund_from_asset_id', '')::uuid
         ELSE nullif(p_lease->>'deposit_to_asset_id', '')::uuid END);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_lease(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_lease(uuid, jsonb) TO authenticated;

-- 4) ตรวจสัญญา: ยอดยกมา = เงินประกันเดิม หรือเงินประกันใหม่ถ้าน้อยกว่า ---------------------------------------
CREATE OR REPLACE FUNCTION private.tg_lease_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$          -- INVOKER: ต้องเห็น current_user จริงใน is_client()
DECLARE o public.property_leases;
BEGIN
  IF coalesce(NEW.security_deposit, 0) > 0 THEN
    NEW.deposit_currency := coalesce(NEW.deposit_currency, NEW.rent_currency);
  END IF;
  IF NEW.deposit_carried_from_lease_id IS NOT NULL THEN
    SELECT * INTO o FROM public.property_leases WHERE id = NEW.deposit_carried_from_lease_id;
    IF o.property_id <> NEW.property_id THEN
      RAISE EXCEPTION 'INVALID: ยกเงินประกันได้เฉพาะสัญญาของ Property เดียวกัน' USING ERRCODE = '22023';
    END IF;
    IF coalesce(NEW.security_deposit, 0) <= 0 THEN
      RAISE EXCEPTION 'INVALID: สัญญาที่ยกเงินประกันมาต้องมีเงินประกัน' USING ERRCODE = '22023';
    END IF;
    IF NEW.deposit_carried_amount IS DISTINCT FROM least(o.security_deposit, NEW.security_deposit)
       OR NEW.deposit_currency <> o.deposit_currency THEN
      RAISE EXCEPTION 'INVALID: ยอดยกมาต้องเท่ากับเงินประกันของสัญญาเดิม (% %) หรือเท่าเงินประกันใหม่ถ้าน้อยกว่า',
        o.security_deposit, o.deposit_currency USING ERRCODE = '22023';
    END IF;
    IF o.deposit_settlement_type = 'REFUNDED' THEN
      RAISE EXCEPTION 'INVALID: สัญญาเดิมคืนเงินประกันไปแล้ว' USING ERRCODE = '22023';
    END IF;
    NEW.deposit_received_date := NEW.start_date;
  END IF;
  IF NEW.deposit_settlement_type = 'REFUNDED' THEN
    IF NEW.deposit_settled_date < coalesce(NEW.terminated_date, NEW.end_date) THEN
      RAISE EXCEPTION 'INVALID: คืนเงินประกันได้ตั้งแต่วันสิ้นสุดสัญญา (%)', coalesce(NEW.terminated_date, NEW.end_date)
        USING ERRCODE = '22023';
    END IF;
    IF NEW.deposit_settled_date > current_date THEN
      RAISE EXCEPTION 'INVALID: วันคืนเงินประกันเป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.deposit_settlement_type = 'CARRIED_TO_NEW_LEASE' AND private.is_client()
     AND (TG_OP = 'INSERT' OR OLD.deposit_settlement_type IS DISTINCT FROM 'CARRIED_TO_NEW_LEASE') THEN
    RAISE EXCEPTION 'INVALID: ยกเงินประกันทำโดยสร้างสัญญาใหม่ที่อ้าง deposit_carried_from_lease_id' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_lease_check() FROM PUBLIC, anon;

-- 5) สัญญาใหม่ยกเงินประกัน → ปิดเงินประกันสัญญาเดิม (+ ยอดคืนส่วนต่าง) · เลื่อนวันเริ่ม → รายการรับเพิ่ม / คืนส่วนต่างเลื่อนตาม
CREATE OR REPLACE FUNCTION private.tg_lease_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  -- สัญญาใหม่ยกเงินประกัน → ปิดหนี้ของสัญญาเดิมในวันเดียวกับที่สัญญาใหม่เริ่มนับ (ส่วนที่ไม่ได้ยกมา = คืนส่วนต่าง)
  IF NEW.deposit_carried_from_lease_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
    UPDATE public.property_leases o SET deposit_settled_date = NEW.start_date,
           deposit_settlement_type = 'CARRIED_TO_NEW_LEASE',
           deposit_refunded_amount = o.security_deposit - coalesce(NEW.deposit_carried_amount, o.security_deposit)
     WHERE o.id = NEW.deposit_carried_from_lease_id
       AND (o.deposit_settled_date, o.deposit_settlement_type, o.deposit_refunded_amount)
           IS DISTINCT FROM (NEW.start_date, 'CARRIED_TO_NEW_LEASE', o.security_deposit - coalesce(NEW.deposit_carried_amount, o.security_deposit));
    IF TG_OP = 'UPDATE' AND NEW.start_date IS DISTINCT FROM OLD.start_date THEN
      UPDATE public.cash_movements SET movement_date = NEW.start_date
       WHERE deleted_at IS NULL AND NOT is_derived AND movement_date <> NEW.start_date
         AND ((related_lease_id = NEW.id AND movement_type = 'SECURITY_DEPOSIT_IN')
              OR (related_lease_id = NEW.deposit_carried_from_lease_id AND movement_type = 'SECURITY_DEPOSIT_OUT'));
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
        AND NEW.deposit_carried_from_lease_id IS NOT NULL THEN
    -- ลบสัญญาใหม่ → สัญญาเดิมกลับมาถือเงินประกันต่อ (รายการคืนส่วนต่างลบใน delete_lease)
    UPDATE public.property_leases SET deposit_settled_date = NULL, deposit_settlement_type = NULL,
           deposit_refunded_amount = NULL
     WHERE id = NEW.deposit_carried_from_lease_id AND deposit_settlement_type = 'CARRIED_TO_NEW_LEASE';
  END IF;
  -- สร้าง Lease ใหม่ → Property เป็น RENTAL (Section 22 Usage Type)
  IF TG_OP = 'INSERT' THEN
    UPDATE public.property_details SET usage_type = 'RENTAL'
     WHERE id = NEW.property_id AND usage_type <> 'RENTAL';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.tg_lease_sync() FROM PUBLIC, anon;

-- 6) ลบสัญญา: ลบรายการรับเงินประกัน + คืนส่วนต่างที่ทำตอนต่อสัญญา ----------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_lease(p_lease_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.income_transactions WHERE lease_id = p_lease_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: มีค่าเช่าที่บันทึกรับแล้ว — ลบรายการค่าเช่าที่หน้า Income & Expenses ก่อน' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.property_leases WHERE id = p_lease_id AND deposit_settlement_type = 'REFUNDED') THEN
    RAISE EXCEPTION 'INVALID: สัญญานี้คืนเงินประกันแล้ว ลบไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.property_leases WHERE deposit_carried_from_lease_id = p_lease_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: เงินประกันของสัญญานี้ถูกยกไปสัญญาใหม่แล้ว — ลบสัญญาใหม่ก่อน' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('fwv.lease_deposit', 'on', true);
  UPDATE public.cash_movements SET deleted_at = now()
   WHERE related_lease_id = p_lease_id AND movement_type = 'SECURITY_DEPOSIT_IN' AND deleted_at IS NULL AND NOT is_derived;
  -- สัญญาที่ยกเงินประกันมา (เงินประกันใหม่น้อยกว่าเดิม): รายการคืนส่วนต่างของสัญญาเดิม → สัญญาเดิมถือเงินประกันเต็มเหมือนเดิม
  UPDATE public.cash_movements m SET deleted_at = now()
    FROM public.property_leases l
   WHERE l.id = p_lease_id AND l.deposit_carried_from_lease_id IS NOT NULL
     AND m.related_lease_id = l.deposit_carried_from_lease_id AND m.movement_type = 'SECURITY_DEPOSIT_OUT'
     AND m.deleted_at IS NULL AND NOT m.is_derived;
  PERFORM set_config('fwv.lease_deposit', 'off', true);
  UPDATE public.expected_income_dismissals SET deleted_at = now()
   WHERE source_type = 'LEASE' AND source_id = p_lease_id AND deleted_at IS NULL;
  UPDATE public.property_leases SET deleted_at = now() WHERE id = p_lease_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID: ไม่พบสัญญานี้ หรือไม่มีสิทธิ์ลบ' USING ERRCODE = '22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.delete_lease(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_lease(uuid) TO authenticated;

-- 7) กันแก้เงินประกันทางอื่น (ต้องผ่าน set_lease_deposit เพื่อให้รายการเงินเข้า / ออกตรงกัน) ----------------------
CREATE OR REPLACE FUNCTION private.tg_lease_deposit_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$          -- INVOKER: ต้องเห็น current_user จริงใน is_client()
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NOT private.is_client()
     OR (NEW.security_deposit, NEW.deposit_received_date, NEW.deposit_carried_amount)
        IS NOT DISTINCT FROM (OLD.security_deposit, OLD.deposit_received_date, OLD.deposit_carried_amount) THEN
    RETURN NEW;
  END IF;
  IF OLD.deposit_settlement_type IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID: เงินประกันของสัญญานี้คืน / ยกไปสัญญาใหม่แล้ว — แก้ยอดไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lease_closeouts c WHERE c.lease_id = NEW.id AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: บันทึกผู้เช่าออกแล้ว — กด "ยกเลิกผู้เช่าออก" ก่อนแก้เงินประกัน' USING ERRCODE = '22023';
  END IF;
  IF coalesce(current_setting('fwv.lease_deposit', true), '') <> 'on' THEN
    RAISE EXCEPTION 'INVALID: แก้เงินประกันที่หน้าต่าง "แก้ไขสัญญา" (ระบบปรับรายการรับ / คืนเงินประกันให้ตรงกัน)' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_lease_deposit_guard() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t47_deposit_guard ON public.property_leases;
CREATE TRIGGER t47_deposit_guard BEFORE UPDATE OF security_deposit, deposit_received_date, deposit_carried_amount
  ON public.property_leases FOR EACH ROW EXECUTE FUNCTION private.tg_lease_deposit_guard();

-- รายการเงินเข้า / ออกของเงินประกัน: แก้ยอด / วัน / บัญชี / ลบ ได้ผ่านสัญญาเท่านั้น (คืนเงินประกัน / ผู้เช่าออก ใช้ปุ่มยกเลิกของตัวเอง)
CREATE OR REPLACE FUNCTION private.tg_deposit_movement_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$          -- INVOKER: ต้องเห็น current_user จริงใน is_client()
BEGIN
  IF NOT private.is_client() OR OLD.related_lease_id IS NULL
     OR OLD.movement_type NOT IN ('SECURITY_DEPOSIT_IN', 'SECURITY_DEPOSIT_OUT')
     OR coalesce(current_setting('fwv.lease_deposit', true), '') = 'on'
     OR (NEW.movement_type, NEW.movement_date, NEW.amount, NEW.currency, NEW.from_asset_id, NEW.to_asset_id, NEW.related_lease_id, NEW.deleted_at)
        IS NOT DISTINCT FROM
        (OLD.movement_type, OLD.movement_date, OLD.amount, OLD.currency, OLD.from_asset_id, OLD.to_asset_id, OLD.related_lease_id, OLD.deleted_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'INVALID: รายการนี้เป็นเงินประกันของสัญญาเช่า — แก้ยอด / วันที่ / บัญชีที่ "แก้ไขสัญญา" ในหน้าทรัพย์สิน (ลบ = ลบสัญญา หรือปุ่มยกเลิกการคืนเงินประกัน)'
    USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION private.tg_deposit_movement_lock() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t16_deposit_lock ON public.cash_movements;
CREATE TRIGGER t16_deposit_lock BEFORE UPDATE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.tg_deposit_movement_lock();

-- 8) วันเลิกสัญญาที่บันทึกไว้: EDITOR แก้ / ยกเลิกได้ก่อนถึงวันนั้น · ถึงวันแล้วเฉพาะ ADMIN --------------------------
CREATE OR REPLACE FUNCTION private.tg_lease_termination_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$          -- INVOKER: ต้องเห็น current_user จริงใน is_client()
BEGIN
  IF NEW.terminated_date IS NOT DISTINCT FROM OLD.terminated_date OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.lease_closeouts c WHERE c.lease_id = NEW.id AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: บันทึกผู้เช่าออกแล้ว — กด "ยกเลิกผู้เช่าออก" ก่อนแก้วันเลิกสัญญา' USING ERRCODE = '22023';
  END IF;
  IF OLD.deposit_settlement_type = 'REFUNDED' THEN
    RAISE EXCEPTION 'INVALID: คืนเงินประกันแล้ว — ยกเลิกการคืนเงินประกันก่อนแก้วันเลิกสัญญา' USING ERRCODE = '22023';
  END IF;
  IF OLD.terminated_date IS NOT NULL AND private.is_client() AND NOT private.has_role('ADMIN')
     AND (OLD.terminated_date <= current_date OR NOT private.has_role('EDITOR')) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: วันออกที่บันทึกไว้ EDITOR แก้ / ยกเลิกได้ก่อนถึงวันนั้น · ถึงวันแล้วแก้ได้เฉพาะ ADMIN'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_lease_termination_guard() FROM PUBLIC, anon;
