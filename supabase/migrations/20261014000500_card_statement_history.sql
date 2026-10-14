-- =====================================================================
-- ประวัติยอดบัตรเครดิตตาม Statement (แบบเดียวกับประวัติยอดเงินกู้)
--   - credit_card_statements: บันทึกทุกครั้งที่ยอดบัตรเปลี่ยน (เพิ่มบัตร / อัปเดตยอด) · Client อ่านอย่างเดียว
--   - update_card_statement: หาจุดตั้งต้นจากประวัติ (ยอดก่อนวันที่นี้) → ลืมติ๊ก "รอแยกรายละเอียด"
--     ก็อัปเดตยอดวันที่เดิมซ้ำแล้วติ๊กได้ · ยอดย้อนหลัง (ก่อนยอดล่าสุด) เก็บเป็นประวัติอย่างเดียว
--   - หมายเหตุของ Statement เก็บในประวัติ (ไม่ทับหมายเหตุของบัตรอีกต่อไป)
-- รันซ้ำได้
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.credit_card_statements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_card_id  uuid NOT NULL REFERENCES public.credit_cards(id),
  statement_date  date NOT NULL,
  balance         public.d_money NOT NULL CHECK (balance >= 0),
  notes           text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_card_statements_date_uq
  ON public.credit_card_statements(credit_card_id, statement_date) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS t10_meta ON public.credit_card_statements;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.credit_card_statements
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.credit_card_statements;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.credit_card_statements
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.credit_card_statements;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.credit_card_statements
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

-- อ่านได้ทุกบทบาท · เขียนผ่านระบบเท่านั้น (ไม่มีสิทธิ์ INSERT / UPDATE จาก Client)
ALTER TABLE public.credit_card_statements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_card_statements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.credit_card_statements TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.credit_card_statements TO service_role;
DROP POLICY IF EXISTS p_select ON public.credit_card_statements;
CREATE POLICY p_select ON public.credit_card_statements FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));

-- บันทึก / แก้ยอดของวันนั้น
CREATE OR REPLACE FUNCTION private.upsert_card_statement(p_card uuid, p_date date, p_balance numeric, p_notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_card IS NULL OR p_date IS NULL OR p_balance IS NULL THEN RETURN; END IF;
  IF pg_trigger_depth() = 0 THEN PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR'); END IF;   -- เรียกจาก RPC
  UPDATE public.credit_card_statements SET balance = p_balance, notes = coalesce(p_notes, notes)
   WHERE credit_card_id = p_card AND statement_date = p_date AND deleted_at IS NULL;
  IF NOT FOUND THEN
    INSERT INTO public.credit_card_statements(credit_card_id, statement_date, balance, notes)
    VALUES (p_card, p_date, p_balance, p_notes);
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.upsert_card_statement(uuid, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.upsert_card_statement(uuid, date, numeric, text) TO authenticated, service_role;

-- ยอดบัตรเปลี่ยน (เพิ่มบัตร / แก้ยอด) → เก็บประวัติให้อัตโนมัติ
CREATE OR REPLACE FUNCTION private.tg_card_statement_hist() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND NEW.balance_date IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.outstanding_balance IS DISTINCT FROM OLD.outstanding_balance
          OR NEW.balance_date IS DISTINCT FROM OLD.balance_date) THEN
    PERFORM private.upsert_card_statement(NEW.id, NEW.balance_date, NEW.outstanding_balance, NULL);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS a55_statement_hist ON public.credit_cards;
CREATE TRIGGER a55_statement_hist AFTER INSERT OR UPDATE ON public.credit_cards
  FOR EACH ROW EXECUTE FUNCTION private.tg_card_statement_hist();

-- ยอดที่มีอยู่แล้ว → ประวัติแถวแรก
INSERT INTO public.credit_card_statements(credit_card_id, statement_date, balance)
SELECT c.id, c.balance_date, c.outstanding_balance FROM public.credit_cards c
 WHERE c.deleted_at IS NULL AND c.balance_date IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.credit_card_statements s
                    WHERE s.credit_card_id = c.id AND s.statement_date = c.balance_date AND s.deleted_at IS NULL);

-- อัปเดตยอดบัตรจาก Statement (เพิ่มหมายเหตุ · ใช้ประวัติหาจุดตั้งต้น)
DROP FUNCTION IF EXISTS public.update_card_statement(uuid, date, numeric, boolean);
CREATE OR REPLACE FUNCTION public.update_card_statement(p_card_id uuid, p_date date, p_balance numeric,
  p_settle boolean DEFAULT false, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c public.credit_cards; l public.expense_items; li public.income_transactions; s public.credit_card_statements;
  v_from date; v_base numeric; v_diff numeric; v_lump numeric := 0;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF p_settle THEN PERFORM private.require_role('ADMIN','EDITOR'); END IF;
  SELECT * INTO c FROM public.credit_cards WHERE id = p_card_id AND deleted_at IS NULL;
  IF c.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: ไม่พบบัตร' USING ERRCODE = '22023'; END IF;
  IF p_date IS NULL OR p_date > current_date OR p_balance IS NULL OR p_balance < 0 THEN
    RAISE EXCEPTION 'INVALID: กรุณาใส่ยอดและวันที่ให้ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  -- ยอดย้อนหลัง (ก่อนยอดล่าสุด) = เก็บเป็นประวัติอย่างเดียว ไม่เปลี่ยนยอดปัจจุบัน / ไม่คำนวณส่วนต่าง
  IF c.balance_date IS NOT NULL AND p_date < c.balance_date THEN
    PERFORM private.upsert_card_statement(c.id, p_date, p_balance, p_notes);
    RETURN jsonb_build_object('difference', NULL, 'lump', 0, 'history_only', true);
  END IF;
  -- จุดตั้งต้น: ก้อนเดิมของวันเดียวกัน → ประวัติยอดก่อนวันนี้ → ยอดบัตรปัจจุบัน (ถ้าก่อนวันนี้)
  SELECT * INTO l FROM public.expense_items WHERE pending_split AND lump_kind = 'CARD' AND paid_from_credit_card_id = c.id
     AND date = p_date AND deleted_at IS NULL;
  SELECT * INTO li FROM public.income_transactions WHERE pending_split AND received_to_credit_card_id = c.id
     AND date = p_date AND deleted_at IS NULL;
  IF l.id IS NOT NULL THEN v_from := l.lump_from; v_base := l.lump_base;
  ELSIF li.id IS NOT NULL THEN v_from := li.lump_from; v_base := li.lump_base;
  ELSE
    SELECT * INTO s FROM public.credit_card_statements WHERE credit_card_id = c.id AND deleted_at IS NULL
       AND statement_date < p_date ORDER BY statement_date DESC LIMIT 1;
    IF s.id IS NOT NULL THEN v_from := s.statement_date; v_base := s.balance;
    ELSIF c.balance_date < p_date THEN v_from := c.balance_date; v_base := c.outstanding_balance;
    END IF;
  END IF;
  UPDATE public.credit_cards SET outstanding_balance = p_balance, balance_date = p_date WHERE id = c.id;
  PERFORM private.upsert_card_statement(c.id, p_date, p_balance, p_notes);
  IF v_from IS NOT NULL AND p_date > v_from THEN
    v_diff := private.card_lump_needed(c.id, v_from, p_date, v_base, p_balance, coalesce(l.id, li.id));
    IF p_settle OR l.id IS NOT NULL OR li.id IS NOT NULL THEN
      v_lump := private.set_debt_lump('CARD', c.id, p_date, v_from, v_base, p_balance);
    END IF;
  END IF;
  RETURN jsonb_build_object('difference', v_diff, 'lump', v_lump);
END $$;
REVOKE ALL ON FUNCTION public.update_card_statement(uuid, date, numeric, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_card_statement(uuid, date, numeric, boolean, text) TO authenticated;
