-- =====================================================================
-- เงินที่โอนเข้าพอร์ตลงทุนก่อน Go-live (ตกลง 2 พ.ย. 2026)
--   ใช้เทียบ "เงินลงทุนสุทธิ" กับมูลค่าล่าสุดของพอร์ต (หน้าพอร์ต + ตารางรวมทุกพอร์ต)
--   - หลัง Go-live ใช้รายการโอนเงิน (cash_movements INVESTMENT_OUT / INVESTMENT_IN) ที่มีอยู่แล้ว → ไม่บันทึกซ้ำที่นี่
--   - ตารางนี้เป็นข้อมูลอ้างอิงเท่านั้น ไม่มีผลกับยอดบัญชี / มูลค่าพอร์ต / Net Worth / Month Closing
--     จึงบันทึกย้อนหลังก่อน Go-live ได้ (และต้องเป็นวันที่ก่อน Go-live เท่านั้น)
--   - amount_thb = เงินบาทที่ออกจากบัญชี · amount_ccy = ยอดสกุลของพอร์ตที่ได้รับ (พอร์ตเงินบาทไม่ต้องใส่)
--   - เจ้าของ: ไม่เคยโอนเงินกลับจากพอร์ตก่อน Go-live → มีแต่เงินโอนเข้า
-- RLS ตามมาตรฐาน: ทุกบทบาทดูได้ · ADMIN / EDITOR / CONTRIBUTOR เพิ่ม · แก้ตามสิทธิ์ · ลบ = Soft Delete (ADMIN / EDITOR)
-- รันซ้ำได้ · ไม่แก้ตาราง / ข้อมูลเดิม
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.portfolio_capital_transfers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_asset_id  uuid NOT NULL REFERENCES public.assets(id),
  transfer_date       date NOT NULL,
  amount_thb          public.d_money NOT NULL CHECK (amount_thb > 0),
  amount_ccy          public.d_money CHECK (amount_ccy IS NULL OR amount_ccy > 0),
  notes               text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id)
);
CREATE INDEX IF NOT EXISTS portfolio_capital_transfers_pf_idx ON public.portfolio_capital_transfers(portfolio_asset_id, transfer_date);

-- ต้องเป็นพอร์ตลงทุน · วันที่ก่อน Go-live · พอร์ตเงินบาทไม่มียอดสกุลอื่น
-- (ตรวจเฉพาะตอนเพิ่ม / เปลี่ยนพอร์ตหรือวันที่ · เลื่อน Go-live ทีหลังไม่ทำให้แถวเดิมแก้ไม่ได้)
CREATE OR REPLACE FUNCTION private.tg_capital_transfer_check()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ccy text; v_go_live date;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT a.currency, f.go_live_date INTO v_ccy, v_go_live
    FROM public.assets a JOIN public.families f ON f.id = a.family_id
   WHERE a.id = NEW.portfolio_asset_id AND a.asset_type = 'INVESTMENT_PORTFOLIO' AND a.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID: ไม่พบพอร์ตลงทุน' USING ERRCODE = '22023';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.transfer_date IS DISTINCT FROM OLD.transfer_date OR NEW.portfolio_asset_id IS DISTINCT FROM OLD.portfolio_asset_id)
     AND v_go_live IS NOT NULL AND NEW.transfer_date >= v_go_live THEN
    RAISE EXCEPTION 'INVALID: เงินโอนตั้งแต่วัน Go-live ให้บันทึกด้วยปุ่ม "โอนเงิน" ของพอร์ต' USING ERRCODE = '22023';
  END IF;
  IF v_ccy = 'THB' THEN NEW.amount_ccy := NULL; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_capital_transfer_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS t20_capital_transfer_check ON public.portfolio_capital_transfers;
CREATE TRIGGER t20_capital_transfer_check BEFORE INSERT OR UPDATE ON public.portfolio_capital_transfers
  FOR EACH ROW EXECUTE FUNCTION private.tg_capital_transfer_check();
DROP TRIGGER IF EXISTS t10_meta ON public.portfolio_capital_transfers;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.portfolio_capital_transfers
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.portfolio_capital_transfers;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.portfolio_capital_transfers
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.portfolio_capital_transfers;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.portfolio_capital_transfers
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

ALTER TABLE public.portfolio_capital_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portfolio_capital_transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.portfolio_capital_transfers TO authenticated, service_role;
DROP POLICY IF EXISTS p_select ON public.portfolio_capital_transfers;
DROP POLICY IF EXISTS p_insert ON public.portfolio_capital_transfers;
DROP POLICY IF EXISTS p_update ON public.portfolio_capital_transfers;
CREATE POLICY p_select ON public.portfolio_capital_transfers FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
CREATE POLICY p_insert ON public.portfolio_capital_transfers FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR')));
CREATE POLICY p_update ON public.portfolio_capital_transfers FOR UPDATE TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND created_at >= now() - interval '24 hours' AND deleted_at IS NULL))
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND deleted_at IS NULL));

COMMENT ON TABLE public.portfolio_capital_transfers IS
  'เงินที่โอนเข้าพอร์ตลงทุนก่อน Go-live (อ้างอิงเท่านั้น ไม่กระทบยอดบัญชี / Net Worth) — เทียบเงินลงทุนสุทธิกับมูลค่าพอร์ต';
