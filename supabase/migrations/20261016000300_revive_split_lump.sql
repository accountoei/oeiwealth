-- =====================================================================
-- แก้: แยกก้อน "รอแยกรายละเอียด" ครบ (ก้อนเหลือ 0 → ถูกปิด) แล้วลบ / ลดยอด / ย้ายรายการที่แยกออก
--      → ก้อนไม่กลับมา (ยอดหายไปจากค่าใช้จ่าย / รายได้)
--   สาเหตุ: การคำนวณก้อนใหม่หาเฉพาะก้อนที่ยังเปิดอยู่ ก้อนที่ปิดไปแล้วจึงไม่ถูกคำนวณอีก
--   แก้: รายการที่แยกออกจากก้อน (split_from_id) ถูกแก้ / ลบ → เปิดก้อนเดิมกลับมาแล้วคำนวณใหม่
--        (ถ้าคำนวณแล้วยังเป็น 0 ก้อนก็ปิดตามเดิม) · ทั้งก้อนบัญชีธนาคาร / บัตร / หนี้ · ทั้งค่าใช้จ่าย / รายได้
--   ไม่แก้ข้อมูลเดิม (ก้อนที่ปิดไปก่อนหน้านี้ยังปิดอยู่) · รันซ้ำได้
-- =====================================================================

CREATE OR REPLACE FUNCTION private.revive_split_parent(p_kind text, p_parent uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.expense_items; i public.income_transactions; v_bank uuid; v_card uuid;
BEGIN
  IF p_parent IS NULL OR private.lump_busy() THEN RETURN; END IF;
  IF p_kind = 'EXPENSE' THEN
    SELECT * INTO e FROM public.expense_items WHERE id = p_parent AND pending_split;
    IF e.id IS NULL THEN RETURN; END IF;
    IF e.deleted_at IS NOT NULL THEN
      -- มีก้อนที่เปิดอยู่ของช่วงเดียวกันแล้ว → ไม่เปิดก้อนเก่าซ้ำ (การคำนวณปกติดูแลก้อนนั้นอยู่แล้ว)
      IF EXISTS (SELECT 1 FROM public.expense_items x WHERE x.pending_split AND x.deleted_at IS NULL AND x.lump_kind = e.lump_kind
                   AND (CASE e.lump_kind WHEN 'BANK' THEN x.paid_from_asset_id = e.paid_from_asset_id
                          AND date_trunc('month', x.date) = date_trunc('month', e.date)
                        WHEN 'CARD' THEN x.paid_from_credit_card_id = e.paid_from_credit_card_id AND x.date = e.date
                        ELSE x.liability_id = e.liability_id AND x.date = e.date END))
         OR (e.lump_kind = 'BANK' AND EXISTS (SELECT 1 FROM public.income_transactions y WHERE y.pending_split AND y.deleted_at IS NULL
                   AND y.received_to_asset_id = e.paid_from_asset_id AND date_trunc('month', y.date) = date_trunc('month', e.date)))
         OR (e.lump_kind = 'CARD' AND EXISTS (SELECT 1 FROM public.income_transactions y WHERE y.pending_split AND y.deleted_at IS NULL
                   AND y.received_to_credit_card_id = e.paid_from_credit_card_id AND y.date = e.date)) THEN
        RETURN;
      END IF;
      PERFORM set_config('fwv.lump', 'on', true);
      UPDATE public.expense_items SET deleted_at = NULL, deleted_by = NULL WHERE id = e.id;
      PERFORM set_config('fwv.lump', 'off', true);
    END IF;
    IF e.lump_kind IN ('CARD', 'LIABILITY') THEN
      PERFORM private.set_debt_lump(e.lump_kind, coalesce(e.paid_from_credit_card_id, e.liability_id), e.date, e.lump_from, e.lump_base, e.lump_target);
    ELSIF e.lump_target IS NOT NULL AND e.lump_from IS NOT NULL THEN
      PERFORM private.set_bank_lump_at(e.paid_from_asset_id, e.date, e.lump_from, e.lump_base, e.lump_target);
    ELSE
      PERFORM private.recalc_bank_lump(e.paid_from_asset_id, date_trunc('month', e.date)::date);
    END IF;
  ELSIF p_kind = 'INCOME' THEN
    SELECT * INTO i FROM public.income_transactions WHERE id = p_parent AND pending_split;
    IF i.id IS NULL THEN RETURN; END IF;
    v_bank := i.received_to_asset_id; v_card := i.received_to_credit_card_id;
    IF i.deleted_at IS NOT NULL THEN
      IF (v_bank IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.income_transactions y WHERE y.pending_split AND y.deleted_at IS NULL
                      AND y.received_to_asset_id = v_bank AND date_trunc('month', y.date) = date_trunc('month', i.date))
         OR EXISTS (SELECT 1 FROM public.expense_items x WHERE x.pending_split AND x.deleted_at IS NULL AND x.lump_kind = 'BANK'
                      AND x.paid_from_asset_id = v_bank AND date_trunc('month', x.date) = date_trunc('month', i.date))))
         OR (v_card IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.income_transactions y WHERE y.pending_split AND y.deleted_at IS NULL
                      AND y.received_to_credit_card_id = v_card AND y.date = i.date)
         OR EXISTS (SELECT 1 FROM public.expense_items x WHERE x.pending_split AND x.deleted_at IS NULL AND x.lump_kind = 'CARD'
                      AND x.paid_from_credit_card_id = v_card AND x.date = i.date))) THEN
        RETURN;
      END IF;
      PERFORM set_config('fwv.lump', 'on', true);
      UPDATE public.income_transactions SET deleted_at = NULL, deleted_by = NULL WHERE id = i.id;
      PERFORM set_config('fwv.lump', 'off', true);
    END IF;
    IF v_card IS NOT NULL THEN
      PERFORM private.set_debt_lump('CARD', v_card, i.date, i.lump_from, i.lump_base, i.lump_target);
    ELSIF i.lump_target IS NOT NULL AND i.lump_from IS NOT NULL THEN
      PERFORM private.set_bank_lump_at(v_bank, i.date, i.lump_from, i.lump_base, i.lump_target);
    ELSE
      PERFORM private.recalc_bank_lump(v_bank, date_trunc('month', i.date)::date);
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.revive_split_parent(text, uuid) FROM PUBLIC, anon, authenticated;

-- รายการที่แยกออกจากก้อน ถูกแก้ / ลบ → คำนวณก้อนเดิมใหม่ (เปิดกลับถ้าปิดไปแล้ว) · หลัง a50_sync / a60_lump
CREATE OR REPLACE FUNCTION private.tg_lump_revive() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_kind text := CASE TG_TABLE_NAME WHEN 'expense_items' THEN 'EXPENSE' ELSE 'INCOME' END;
  v_old uuid; v_new uuid;
BEGIN
  IF private.lump_busy() OR current_setting('fwv.split', true) = 'on' THEN RETURN NULL; END IF;
  v_old := to_jsonb(OLD)->>'split_from_id';
  v_new := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW)->>'split_from_id' END;
  IF TG_OP = 'UPDATE' AND v_old IS NOT NULL
     AND to_jsonb(NEW) - 'updated_at' - 'updated_by' - 'notes' - 'description' - 'expense_category' - 'income_subtype' - 'person_id'
       = to_jsonb(OLD) - 'updated_at' - 'updated_by' - 'notes' - 'description' - 'expense_category' - 'income_subtype' - 'person_id' THEN
    RETURN NULL;                                   -- แก้แค่ข้อความ / หมวด / ของใคร → ยอดไม่เปลี่ยน
  END IF;
  IF v_old IS NOT NULL THEN PERFORM private.revive_split_parent(v_kind, v_old); END IF;
  IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN PERFORM private.revive_split_parent(v_kind, v_new); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS a61_lump_revive ON public.expense_items;
CREATE TRIGGER a61_lump_revive AFTER UPDATE OR DELETE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_lump_revive();
DROP TRIGGER IF EXISTS a61_lump_revive ON public.income_transactions;
CREATE TRIGGER a61_lump_revive AFTER UPDATE OR DELETE ON public.income_transactions
  FOR EACH ROW EXECUTE FUNCTION private.tg_lump_revive();
