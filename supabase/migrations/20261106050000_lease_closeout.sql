-- =====================================================================
-- ผู้เช่าออก / ปิดสัญญา (ตกลง 6 พ.ย. 2026 · ต่อจาก 20261106030000_lease_rent_cycles.sql)
--   1) ตาราง lease_closeouts = บันทึกผู้เช่าออก 1 ครั้งต่อสัญญา (ตัวเลขทั้งหมดสำหรับใบสรุป + id รายการที่สร้าง เพื่อยกเลิกได้ครบ)
--   2) lease_closeout_preview() = ตัวอย่างก่อนบันทึก: ค่าเช่าถึงวันออก (สูตรเดียวกับ v_expected_income) เทียบที่รับแล้ว
--        ค้างรับ → หักจากเงินประกัน · รับเกิน (จ่ายล่วงหน้า) → คืนผู้เช่า · ค่าน้ำไฟเรียกเก็บที่ยังไม่ได้รับ → หักจากเงินประกัน
--   3) close_lease() ในครั้งเดียว (ทำครบหรือไม่ทำเลย):
--        - ออกก่อนวันสิ้นสุด → เลิกสัญญา ณ วันที่ออก
--        - ค่าเช่าค้าง = รายได้ค่าเช่าของงวดนั้น (ไม่ผ่านบัญชี · หักจากเงินประกัน) → งวดนั้นขึ้น "ได้รับแล้ว"
--        - ค่าน้ำไฟค้าง = รายได้ "ค่าน้ำไฟเรียกเก็บจากผู้เช่า" (ไม่ผ่านบัญชี) → รายการเรียกเก็บขึ้น "รับแล้ว"
--        - ค่าเสียหาย / ริบเงินประกัน = รายได้อื่น "หักจากเงินประกัน: …"
--        - เงินประกันส่วนที่เหลือ → คืนผู้เช่า (เงินออกจากบัญชี) · ค่าเช่าที่จ่ายล่วงหน้าเกิน → ค่าใช้จ่ายทรัพย์สิน "คืนค่าเช่าล่วงหน้า"
--          (รายได้ติดลบไม่ได้) · ยอดโอนคืนรวม = สองยอดนี้
--      undo_close_lease() = ยกเลิกทั้งหมดกลับเหมือนก่อนบันทึก (ช่วงที่ปิดเดือนแล้วต้อง Reopen ก่อน)
--      รายการที่สร้างตอนผู้เช่าออก แก้ / ลบทีละรายการไม่ได้ (ยกเลิกทั้งชุดเท่านั้น)
--   4) วันเลิกสัญญา: แก้ / ยกเลิก (หลังเลิกไปแล้ว) ได้เฉพาะ ADMIN · ห้ามแก้หลังคืนเงินประกันหรือบันทึกผู้เช่าออกแล้ว
--      undo_security_deposit(): สัญญาที่บันทึกผู้เช่าออก ให้ใช้ undo_close_lease() แทน
--   ไม่แก้ / ไม่ลบข้อมูลเดิม · รันซ้ำได้
-- =====================================================================

-- 1) บันทึกผู้เช่าออก ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lease_closeouts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id               uuid NOT NULL REFERENCES public.property_leases(id),
  move_out_date          date NOT NULL,
  settled_date           date NOT NULL,
  bank_asset_id          uuid REFERENCES public.assets(id),             -- บัญชีที่โอนคืนผู้เช่า
  currency               public.d_currency NOT NULL,
  deposit_held           public.d_money NOT NULL DEFAULT 0,             -- เงินประกันที่ถืออยู่
  unpaid_rent            public.d_money NOT NULL DEFAULT 0,             -- ค่าเช่าค้างถึงวันออก (หักจากเงินประกัน)
  utilities              public.d_money NOT NULL DEFAULT 0,             -- ค่าน้ำไฟเรียกเก็บที่ค้าง (หักจากเงินประกัน)
  damage                 public.d_money NOT NULL DEFAULT 0,
  damage_reason          text,
  forfeit                public.d_money NOT NULL DEFAULT 0,             -- ริบเงินประกัน (ออกก่อนครบสัญญา)
  forfeit_reason         text,
  deposit_refund         public.d_money NOT NULL DEFAULT 0,             -- เงินประกันที่คืน
  advance_refund         public.d_money NOT NULL DEFAULT 0,             -- ค่าเช่าที่จ่ายล่วงหน้าเกิน → คืน
  net_transfer           public.d_money NOT NULL DEFAULT 0,             -- โอนคืนรวม
  terminated_by_closeout boolean NOT NULL DEFAULT false,                -- เลิกสัญญาตอนบันทึกนี้ (ยกเลิก → กลับเป็นไม่เลิก)
  lines                  jsonb NOT NULL DEFAULT '{}'::jsonb,            -- รายงวด / รายการค่าน้ำไฟ ณ วันบันทึก (ใบสรุป)
  income_ids             uuid[] NOT NULL DEFAULT '{}',                  -- รายได้ที่สร้าง
  expense_id             uuid REFERENCES public.expense_items(id),      -- คืนค่าเช่าล่วงหน้า
  movement_id            uuid REFERENCES public.cash_movements(id),     -- คืนเงินประกัน
  notes                  text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS lco_lease_uq ON public.lease_closeouts(lease_id) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS t10_meta ON public.lease_closeouts;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.lease_closeouts
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.lease_closeouts;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.lease_closeouts
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.lease_closeouts;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.lease_closeouts
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();
-- อ่านได้ทุกบทบาท · เขียนได้เฉพาะผ่าน close_lease() / undo_close_lease()
ALTER TABLE public.lease_closeouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lease_closeouts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lease_closeouts TO authenticated;
DROP POLICY IF EXISTS p_select ON public.lease_closeouts;
CREATE POLICY p_select ON public.lease_closeouts FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));

-- 2) ค่าเช่าถึงวันออก เทียบที่รับแล้ว (นับตั้งแต่เดือน Go-live เหมือน v_expected_income · ความถี่ "อื่น ๆ" = ไม่คิด) ----
CREATE OR REPLACE FUNCTION private.lease_closeout_rent(p_lease_id uuid, p_move_out date)
RETURNS TABLE(income_period date, cycle_start date, cycle_end date, expected numeric, received numeric, dismissed boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH l AS (
    SELECT x.id, x.start_date, x.rent_amount, x.prorate_basis,
           coalesce(x.payment_due_day, extract(day FROM x.start_date)::int) AS due_day,
           CASE x.payment_frequency WHEN 'MONTHLY' THEN 1 WHEN 'QUARTERLY' THEN 3 WHEN 'YEARLY' THEN 12 END AS step,
           date_trunc('month', coalesce(f.go_live_date, x.start_date))::date AS gl
      FROM public.property_leases x
      JOIN public.property_details pd ON pd.id = x.property_id
      JOIN public.assets a ON a.id = pd.asset_id
      JOIN public.families f ON f.id = a.family_id
     WHERE x.id = p_lease_id AND x.deleted_at IS NULL),
  s AS (
    SELECT c.income_period, c.cycle_start, c.cycle_end, c.expected_amount
      FROM l CROSS JOIN LATERAL private.lease_cycles(l.start_date, p_move_out, l.due_day, l.step, l.rent_amount, l.prorate_basis) c
     WHERE c.income_period >= l.gl),
  r AS (
    SELECT i.income_period::date AS income_period, sum(i.amount) AS amt
      FROM public.income_transactions i JOIN l ON l.id = i.lease_id
     WHERE i.deleted_at IS NULL AND i.income_type = 'RENT' AND i.income_period >= l.gl AND l.step IS NOT NULL
     GROUP BY i.income_period)
  SELECT coalesce(s.income_period, r.income_period), s.cycle_start, s.cycle_end,
         coalesce(s.expected_amount, 0), coalesce(r.amt, 0),
         EXISTS (SELECT 1 FROM public.expected_income_dismissals d
                  WHERE d.source_type = 'LEASE' AND d.source_id = p_lease_id AND d.deleted_at IS NULL
                    AND d.income_period = coalesce(s.income_period, r.income_period))
    FROM s FULL JOIN r ON r.income_period = s.income_period
   ORDER BY 1
$$;
REVOKE ALL ON FUNCTION private.lease_closeout_rent(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.lease_closeout_rent(uuid, date) TO authenticated;

-- ตัวอย่างก่อนบันทึกผู้เช่าออก (อ่านอย่างเดียว · หน้าต่าง "ผู้เช่าออก" เรียกทุกครั้งที่เปลี่ยนวันที่ออก)
CREATE OR REPLACE FUNCTION public.lease_closeout_preview(p_lease_id uuid, p_move_out date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH l AS (SELECT * FROM public.property_leases WHERE id = p_lease_id AND deleted_at IS NULL),
  r AS (SELECT x.*, CASE WHEN x.dismissed THEN 0 ELSE greatest(x.expected - x.received, 0) END AS unpaid,
               greatest(x.received - x.expected, 0) AS over
          FROM private.lease_closeout_rent(p_lease_id, p_move_out) x),
  ch AS (SELECT c.id, c.description, c.cost_period, c.amount, c.currency
           FROM public.v_lease_utility_charges c WHERE c.lease_id = p_lease_id AND c.status = 'PENDING')
  SELECT jsonb_build_object(
    'move_out', p_move_out,
    'currency', l.rent_currency,
    'deposit', CASE WHEN l.deposit_settlement_type IS NULL THEN coalesce(l.security_deposit, 0) ELSE 0 END,
    'deposit_currency', l.deposit_currency,
    'rent', coalesce((SELECT jsonb_agg(jsonb_build_object('period', r.income_period, 'from', r.cycle_start, 'to', r.cycle_end,
                        'expected', r.expected, 'received', r.received, 'dismissed', r.dismissed,
                        'unpaid', r.unpaid, 'over', r.over) ORDER BY r.income_period) FROM r), '[]'::jsonb),
    'expected_rent', (SELECT coalesce(sum(r.expected), 0) FROM r),
    'received_rent', (SELECT coalesce(sum(r.received), 0) FROM r),
    'unpaid_rent', (SELECT coalesce(sum(r.unpaid), 0) FROM r),
    'advance_rent', (SELECT coalesce(sum(r.over), 0) FROM r),
    'charges', coalesce((SELECT jsonb_agg(jsonb_build_object('id', ch.id, 'description', ch.description, 'period', ch.cost_period,
                           'amount', ch.amount, 'currency', ch.currency) ORDER BY ch.cost_period, ch.description) FROM ch), '[]'::jsonb),
    'utilities', (SELECT coalesce(sum(ch.amount), 0) FROM ch))
  FROM l
$$;
REVOKE ALL ON FUNCTION public.lease_closeout_preview(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lease_closeout_preview(uuid, date) TO authenticated;

-- 3) บันทึกผู้เช่าออก --------------------------------------------------------------------------------------
--    DEFINER: ฟิลด์เงินประกันเป็น Cache (Client แก้ตรงไม่ได้) · ตรวจสิทธิ์ ADMIN / EDITOR เอง · Period Lock ตรวจที่ Trigger
CREATE OR REPLACE FUNCTION public.close_lease(
  p_lease_id uuid, p_move_out date, p_settled_date date, p_bank_asset_id uuid DEFAULT NULL,
  p_damage numeric DEFAULT 0, p_damage_reason text DEFAULT NULL,
  p_forfeit numeric DEFAULT 0, p_forfeit_reason text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l public.property_leases; pv jsonb; x jsonb; v_ccy text; v_bank_ccy text; v_asset uuid; v_name text;
  v_dep numeric := 0; v_unpaid numeric; v_util numeric; v_over numeric;
  v_damage numeric := round(coalesce(p_damage, 0), 2); v_forfeit numeric := round(coalesce(p_forfeit, 0), 2);
  v_ded numeric; v_refund numeric; v_term boolean := false;
  v_inc uuid; v_incs uuid[] := '{}'; v_mv uuid; v_exp uuid; v_id uuid;
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
    RAISE EXCEPTION 'INVALID: วันที่ออกเป็นวันในอนาคตไม่ได้ — ผู้เช่าแจ้งล่วงหน้า ให้กด "เลิกสัญญาก่อนกำหนด" ไว้ก่อน' USING ERRCODE = '22023';
  END IF;
  IF p_settled_date IS NULL OR p_settled_date < p_move_out OR p_settled_date > current_date THEN
    RAISE EXCEPTION 'INVALID: วันที่คืนเงินต้องตั้งแต่วันที่ออกถึงวันนี้' USING ERRCODE = '22023';
  END IF;
  IF v_damage < 0 OR v_forfeit < 0 THEN RAISE EXCEPTION 'INVALID: ยอดหักต้องไม่ติดลบ' USING ERRCODE = '22023'; END IF;
  IF v_damage > 0 AND length(trim(coalesce(p_damage_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาระบุรายการค่าเสียหาย' USING ERRCODE = '22023';
  END IF;
  IF v_forfeit > 0 AND length(trim(coalesce(p_forfeit_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาระบุเหตุผลที่ริบเงินประกัน' USING ERRCODE = '22023';
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
  v_ded := v_unpaid + v_util + v_damage + v_forfeit;
  IF v_ded > v_dep THEN
    RAISE EXCEPTION 'INVALID: ยอดหักรวม % เกินเงินประกันที่ถืออยู่ % — รับค่าเช่า / ค่าน้ำไฟที่ค้างจากผู้เช่าแยกก่อน (แท็บรับค่าเช่า) หรือลดยอดหัก',
      to_char(v_ded, 'FM999,999,999,990.00'), to_char(v_dep, 'FM999,999,999,990.00') USING ERRCODE = '22023';
  END IF;
  v_refund := v_dep - v_ded;
  IF v_refund + v_over > 0 THEN
    IF p_bank_asset_id IS NULL THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกบัญชีที่โอนคืนผู้เช่า' USING ERRCODE = '22023'; END IF;
    IF NOT private.is_bank_asset(p_bank_asset_id) THEN RAISE EXCEPTION 'INVALID: บัญชีที่โอนคืนต้องเป็นบัญชีธนาคาร' USING ERRCODE = '22023'; END IF;
    SELECT a.currency INTO v_bank_ccy FROM public.assets a WHERE a.id = p_bank_asset_id;
    IF v_bank_ccy IS DISTINCT FROM v_ccy THEN
      RAISE EXCEPTION 'INVALID_CURRENCY: บัญชีที่โอนคืนต้องสกุลเดียวกับสัญญา (%)', v_ccy USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ก) ออกก่อนวันสิ้นสุด → เลิกสัญญา ณ วันที่ออก
  IF l.terminated_date IS NULL AND p_move_out < l.end_date THEN
    UPDATE public.property_leases SET status = 'TERMINATED', terminated_date = p_move_out WHERE id = l.id;
    v_term := true;
  END IF;

  -- ข) ค่าเช่าค้าง → รายได้ค่าเช่าของงวดนั้น (หักจากเงินประกัน ไม่ผ่านบัญชี)
  FOR x IN SELECT * FROM jsonb_array_elements(pv->'rent') LOOP
    IF (x->>'unpaid')::numeric > 0 THEN
      INSERT INTO public.income_transactions(lease_id, income_type, date, income_period, amount, currency, notes)
      VALUES (l.id, 'RENT', p_settled_date, (x->>'period')::date, (x->>'unpaid')::numeric, v_ccy, 'หักจากเงินประกันตอนผู้เช่าออก')
      RETURNING id INTO v_inc;
      v_incs := v_incs || v_inc;
    END IF;
  END LOOP;
  -- ค) ค่าน้ำไฟเรียกเก็บที่ค้าง → รายได้ค่าน้ำไฟ (หักจากเงินประกัน) + ผูกกับรายการเรียกเก็บ
  FOR x IN SELECT * FROM jsonb_array_elements(pv->'charges') LOOP
    INSERT INTO public.income_transactions(lease_id, income_type, income_subtype, date, income_period, amount, currency, notes)
    VALUES (l.id, 'OTHER', 'ค่าน้ำไฟเรียกเก็บจากผู้เช่า', p_settled_date, (x->>'period')::date, (x->>'amount')::numeric, v_ccy,
            concat_ws(' · ', x->>'description', 'หักจากเงินประกันตอนผู้เช่าออก'))
    RETURNING id INTO v_inc;
    UPDATE public.lease_utility_charges SET income_id = v_inc WHERE id = (x->>'id')::uuid;
    v_incs := v_incs || v_inc;
  END LOOP;
  -- ง) ค่าเสียหาย / ริบเงินประกัน → รายได้อื่น
  IF v_damage > 0 THEN
    INSERT INTO public.income_transactions(lease_id, income_type, date, amount, currency, notes)
    VALUES (l.id, 'OTHER', p_settled_date, v_damage, v_ccy, 'หักจากเงินประกัน: ' || trim(p_damage_reason))
    RETURNING id INTO v_inc;
    v_incs := v_incs || v_inc;
  END IF;
  IF v_forfeit > 0 THEN
    INSERT INTO public.income_transactions(lease_id, income_type, date, amount, currency, notes)
    VALUES (l.id, 'OTHER', p_settled_date, v_forfeit, v_ccy, 'หักจากเงินประกัน: ริบเงินประกัน · ' || trim(p_forfeit_reason))
    RETURNING id INTO v_inc;
    v_incs := v_incs || v_inc;
  END IF;
  -- จ) เงินประกัน: คืนส่วนที่เหลือ → ปิดหนี้เงินประกัน
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
  -- ฉ) ค่าเช่าที่จ่ายล่วงหน้าเกิน → คืนผู้เช่า = ค่าใช้จ่ายของทรัพย์สิน (รายได้ติดลบไม่ได้)
  IF v_over > 0 THEN
    v_exp := public.add_expense(jsonb_build_object(
      'date', p_settled_date, 'description', 'คืนค่าเช่าล่วงหน้า · ' || v_name, 'amount', v_over, 'currency', v_ccy,
      'paid_from_asset_id', p_bank_asset_id, 'related_asset_id', v_asset,
      'expense_category', 'บ้าน / สาธารณูปโภค', 'property_cost_type', 'OTHER',
      'notes', 'ผู้เช่าออก ' || to_char(p_move_out, 'DD/MM/') || (extract(year FROM p_move_out)::int + 543) || ' · ค่าเช่าที่รับเกินวันที่อยู่จริง'));
  END IF;

  INSERT INTO public.lease_closeouts(lease_id, move_out_date, settled_date, bank_asset_id, currency, deposit_held,
              unpaid_rent, utilities, damage, damage_reason, forfeit, forfeit_reason, deposit_refund, advance_refund, net_transfer,
              terminated_by_closeout, lines, income_ids, expense_id, movement_id, notes)
  VALUES (l.id, p_move_out, p_settled_date, CASE WHEN v_refund + v_over > 0 THEN p_bank_asset_id END, v_ccy, v_dep,
          v_unpaid, v_util, v_damage, nullif(trim(p_damage_reason), ''), v_forfeit, nullif(trim(p_forfeit_reason), ''),
          v_refund, v_over, v_refund + v_over, v_term, jsonb_build_object('rent', pv->'rent', 'charges', pv->'charges'),
          v_incs, v_exp, v_mv, nullif(trim(p_notes), ''))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('closeout_id', v_id, 'deducted', v_ded, 'deposit_refund', v_refund, 'advance_refund', v_over,
                            'net_transfer', v_refund + v_over, 'terminated', v_term);
END $$;
REVOKE ALL ON FUNCTION public.close_lease(uuid, date, date, uuid, numeric, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_lease(uuid, date, date, uuid, numeric, text, numeric, text, text) TO authenticated;

-- ยกเลิกผู้เช่าออก: ลบรายการที่สร้างทั้งหมด · เงินประกันกลับเป็นหนี้ · วันเลิกสัญญากลับเหมือนเดิม
CREATE OR REPLACE FUNCTION public.undo_close_lease(p_lease_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE co public.lease_closeouts;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO co FROM public.lease_closeouts WHERE lease_id = p_lease_id AND deleted_at IS NULL FOR UPDATE;
  IF co.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบันทึกผู้เช่าออกของสัญญานี้' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.property_leases WHERE id = p_lease_id FOR UPDATE;
  -- รายได้ (ค่าเช่าค้าง / ค่าน้ำไฟ / ค่าเสียหาย / ริบ) → รายการเรียกเก็บค่าน้ำไฟกลับเป็น "รอรับ" เอง
  UPDATE public.income_transactions SET deleted_at = now() WHERE id = ANY (co.income_ids) AND deleted_at IS NULL;
  IF co.expense_id IS NOT NULL THEN
    UPDATE public.expense_items SET deleted_at = now() WHERE id = co.expense_id AND deleted_at IS NULL;
  END IF;
  IF co.movement_id IS NOT NULL THEN
    UPDATE public.cash_movements SET deleted_at = now() WHERE id = co.movement_id AND deleted_at IS NULL;
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

-- รายการที่สร้างตอนผู้เช่าออก (รายได้ / คืนค่าเช่าล่วงหน้า / คืนเงินประกัน) → แก้ / ลบทีละรายการไม่ได้ (ยกเลิกทั้งชุดเท่านั้น)
CREATE OR REPLACE FUNCTION private.tg_closeout_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$          -- INVOKER: ต้องเห็น current_user จริงใน is_client()
BEGIN
  IF NOT private.is_client() THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.lease_closeouts c
              WHERE c.deleted_at IS NULL AND (OLD.id = ANY (c.income_ids) OR c.expense_id = OLD.id OR c.movement_id = OLD.id)) THEN
    RAISE EXCEPTION 'INVALID: รายการนี้มาจากการบันทึกผู้เช่าออก — แก้ / ลบได้ด้วยปุ่ม "ยกเลิกผู้เช่าออก" ในสัญญาเช่า' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_closeout_lock() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t15_closeout_lock ON public.income_transactions;
CREATE TRIGGER t15_closeout_lock BEFORE UPDATE ON public.income_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_closeout_lock();
DROP TRIGGER IF EXISTS t15_closeout_lock ON public.expense_items;
CREATE TRIGGER t15_closeout_lock BEFORE UPDATE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_closeout_lock();
DROP TRIGGER IF EXISTS t15_closeout_lock ON public.cash_movements;
CREATE TRIGGER t15_closeout_lock BEFORE UPDATE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.tg_closeout_lock();

-- 4) วันเลิกสัญญา: แก้ / ยกเลิกหลังเลิกไปแล้ว = ADMIN · หลังคืนเงินประกัน / บันทึกผู้เช่าออก = แก้ไม่ได้ ----------------
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
  IF OLD.terminated_date IS NOT NULL AND private.is_client() AND NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: แก้ / ยกเลิกวันเลิกสัญญาได้เฉพาะ ADMIN' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_lease_termination_guard() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS t45_termination ON public.property_leases;
CREATE TRIGGER t45_termination BEFORE UPDATE ON public.property_leases
  FOR EACH ROW EXECUTE FUNCTION private.tg_lease_termination_guard();

-- ยกเลิกการคืนเงินประกัน: สัญญาที่บันทึกผู้เช่าออก ต้องยกเลิกทั้งชุด (ไม่งั้นค่าเช่า / ค่าน้ำไฟที่หักไว้จะค้าง)
CREATE OR REPLACE FUNCTION public.undo_security_deposit(p_lease_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$     -- DEFINER: ฟิลด์ Settle เป็น Cache (Client แก้ตรงไม่ได้)
DECLARE l public.property_leases;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  SELECT * INTO l FROM public.property_leases WHERE id = p_lease_id AND deleted_at IS NULL FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบสัญญา' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.lease_closeouts c WHERE c.lease_id = l.id AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: สัญญานี้บันทึกผู้เช่าออกไว้ — กด "ยกเลิกผู้เช่าออก" แทน' USING ERRCODE = '22023';
  END IF;
  IF l.deposit_settlement_type IS DISTINCT FROM 'REFUNDED' THEN
    RAISE EXCEPTION 'INVALID: สัญญานี้ยังไม่ได้คืนเงินประกัน (หรือยกไปสัญญาใหม่ — ให้ลบสัญญาใหม่แทน)' USING ERRCODE = '22023';
  END IF;
  -- เงินคืนผู้เช่า + รายได้ส่วนที่หัก (Period Lock ตรวจที่ Trigger)
  UPDATE public.cash_movements SET deleted_at = now()
   WHERE related_lease_id = l.id AND movement_type = 'SECURITY_DEPOSIT_OUT' AND NOT is_derived AND deleted_at IS NULL;
  UPDATE public.income_transactions SET deleted_at = now()
   WHERE lease_id = l.id AND income_type = 'OTHER' AND date = l.deposit_settled_date AND notes LIKE 'หักจากเงินประกัน:%' AND deleted_at IS NULL;
  UPDATE public.property_leases SET deposit_settled_date = NULL, deposit_settlement_type = NULL, deposit_refunded_amount = NULL
   WHERE id = l.id;
  -- Audit Log บันทึกการเปลี่ยนแปลงทุกตารางให้อยู่แล้ว (z90_audit)
END $$;
REVOKE ALL ON FUNCTION public.undo_security_deposit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_security_deposit(uuid) TO authenticated;
