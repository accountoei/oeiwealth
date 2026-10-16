-- =====================================================================
-- หน้าบัญชี (Cash): สถานะยอดล่าสุดแบบคำนวณสด แทน "ผลต่างที่ยังไม่อธิบาย" (ตัวเลขที่เก็บตอนบันทึก ไม่อัปเดตตาม)
--   bank_statement_status(): ยอดล่าสุดตาม Statement · ก้อนรอแยกของเดือนนั้น · ส่วนต่างที่ยังเหลือ (หลังนับก้อนแล้ว)
--   settle_bank_latest(): ลงส่วนต่างที่เหลือของยอดล่าสุดเป็นก้อนรอแยก (ADMIN / EDITOR) — ไม่บันทึกยอดซ้ำ
--   ใช้จุดตั้งต้นเดียวกับ update_bank_statement (ก้อนของเดือน → ยอดยืนยันก่อนต้นเดือน → ยอดก่อนหน้า)
--   ฟังก์ชันอย่างเดียว · ไม่แก้ตาราง / ข้อมูลเดิม (ช่อง unexplained_difference ยังเก็บอยู่ แค่หน้าจอเลิกแสดง) · รันซ้ำได้
-- =====================================================================

-- จุดตั้งต้นของยอดล่าสุด (ภายใน)
CREATE OR REPLACE FUNCTION private.bank_latest_anchor(p_bank uuid)
RETURNS TABLE (latest_date date, latest_value numeric, from_date date, base numeric, has_lump boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.asset_valuations; v_m0 date; v_from date; v_base numeric; v_prev public.asset_valuations; v_has boolean := false;
BEGIN
  v := private.latest_asset_valuation(p_bank, current_date);
  IF v.id IS NULL THEN RETURN; END IF;
  v_m0 := date_trunc('month', v.valuation_date)::date;
  SELECT lump_from, lump_base INTO v_from, v_base FROM public.expense_items
   WHERE pending_split AND lump_kind = 'BANK' AND paid_from_asset_id = p_bank AND deleted_at IS NULL
     AND date_trunc('month', date) = v_m0 AND lump_target IS NOT NULL;
  IF v_from IS NULL THEN
    SELECT lump_from, lump_base INTO v_from, v_base FROM public.income_transactions
     WHERE pending_split AND received_to_asset_id = p_bank AND deleted_at IS NULL
       AND date_trunc('month', date) = v_m0 AND lump_target IS NOT NULL;
  END IF;
  v_has := v_from IS NOT NULL;
  IF v_from IS NULL THEN
    SELECT a.anchor_date, a.anchor_value INTO v_from, v_base FROM private.bank_month_anchor(p_bank, v_m0) a;
  END IF;
  IF v_from IS NULL THEN
    SELECT * INTO v_prev FROM public.asset_valuations WHERE asset_id = p_bank AND deleted_at IS NULL AND valuation_date < v.valuation_date
     ORDER BY valuation_date DESC, created_at DESC LIMIT 1;
    v_from := v_prev.valuation_date; v_base := v_prev.value;
  END IF;
  latest_date := v.valuation_date; latest_value := v.value; from_date := v_from; base := v_base; has_lump := v_has;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION private.bank_latest_anchor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.bank_latest_anchor(uuid) TO authenticated;

-- สถานะสำหรับหน้าบัญชี
DROP FUNCTION IF EXISTS public.bank_statement_status(uuid);
CREATE FUNCTION public.bank_statement_status(p_asset_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE a record; e record; v_lump_exp numeric; v_lump_inc numeric; v_exp_date date; v_inc_date date; v_lump_date date; v_resid numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  IF NOT private.is_bank_asset(p_asset_id) THEN RETURN NULL; END IF;
  SELECT * INTO a FROM private.bank_latest_anchor(p_asset_id);
  IF a.latest_date IS NULL THEN RETURN NULL; END IF;
  -- ก้อนของเดือนของยอดล่าสุด (+ = ค่าใช้จ่ายรอแยก · − = รายได้รอแยก)
  SELECT amount, date INTO v_lump_exp, v_exp_date FROM public.expense_items
   WHERE pending_split AND lump_kind = 'BANK' AND paid_from_asset_id = p_asset_id AND deleted_at IS NULL
     AND date_trunc('month', date) = date_trunc('month', a.latest_date);
  SELECT amount, date INTO v_lump_inc, v_inc_date FROM public.income_transactions
   WHERE pending_split AND received_to_asset_id = p_asset_id AND deleted_at IS NULL
     AND date_trunc('month', date) = date_trunc('month', a.latest_date);
  v_lump_date := coalesce(v_exp_date, v_inc_date);
  -- ส่วนต่างที่ยังเหลือ = ยอดตาม Statement − (จุดตั้งต้น + เงินเข้า − เงินออก ที่บันทึกแล้ว รวมก้อน)
  IF a.from_date IS NOT NULL AND a.from_date < a.latest_date THEN
    SELECT * INTO e FROM private.bank_movement_effects(p_asset_id, a.from_date, a.latest_date);
    v_resid := round(a.latest_value - (a.base + e.inflow - e.outflow), 2);
  END IF;
  RETURN jsonb_build_object(
    'latest_date', a.latest_date, 'latest_value', a.latest_value,
    'lump', CASE WHEN v_lump_date IS NULL THEN NULL ELSE coalesce(v_lump_exp, 0) - coalesce(v_lump_inc, 0) END,
    'lump_date', v_lump_date,
    'difference', CASE WHEN abs(coalesce(v_resid, 0)) < 0.005 THEN 0 ELSE v_resid END);
END $$;
REVOKE ALL ON FUNCTION public.bank_statement_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bank_statement_status(uuid) TO authenticated;

-- ลงส่วนต่างของยอดล่าสุดเป็นก้อนรอแยก (ไม่สร้างยอดใหม่)
DROP FUNCTION IF EXISTS public.settle_bank_latest(uuid);
CREATE FUNCTION public.settle_bank_latest(p_asset_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a record; v_lump numeric;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF NOT private.is_bank_asset(p_asset_id) THEN RAISE EXCEPTION 'INVALID: ไม่ใช่บัญชีธนาคาร' USING ERRCODE = '22023'; END IF;
  SELECT * INTO a FROM private.bank_latest_anchor(p_asset_id);
  IF a.latest_date IS NULL OR a.from_date IS NULL OR a.from_date >= a.latest_date THEN
    RAISE EXCEPTION 'INVALID: ยังไม่มียอดก่อนหน้าให้เทียบ' USING ERRCODE = '22023';
  END IF;
  v_lump := private.set_bank_lump_at(p_asset_id, a.latest_date, a.from_date, a.base, a.latest_value);
  RETURN jsonb_build_object('lump', v_lump, 'date', a.latest_date);
END $$;
REVOKE ALL ON FUNCTION public.settle_bank_latest(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_bank_latest(uuid) TO authenticated;
