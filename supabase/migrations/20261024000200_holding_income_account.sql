-- =====================================================================
-- บัญชีรับดอกเบี้ย / ปันผล / เงินคืน ของหลักทรัพย์แต่ละตัว (ตกลง 24 ต.ค. 2026)
--   ตั้งตอน + รายการ → ซื้อ → หลักทรัพย์ตัวใหม่ (ค่าตั้งต้น = บัญชีหลักในพอร์ต ★) หรือ "แก้ไขข้อมูล" ของหลักทรัพย์
--   ใช้เป็นค่าตั้งต้นของคอลัมน์ "เข้าบัญชี" ในแท็บ "รอรับเดือนนี้" และปุ่ม "+ รับปันผล / ดอกเบี้ย"
--   (เปลี่ยนในแท็บ / ในฟอร์ม = มีผลกับการรับครั้งนั้นครั้งเดียว ไม่แก้ค่าที่ผูกไว้)
--   เลือกได้อย่างใดอย่างหนึ่ง: บัญชีเงินฝากในพอร์ตเดียวกัน หรือบัญชีธนาคาร (Cash & Bank) · สกุลเงินเดียวกับหลักทรัพย์
--   ไม่ใส่ = ใช้บัญชีหลักในพอร์ต (★) เหมือนเดิม
--   เพิ่มคอลัมน์อย่างเดียว ไม่แตะข้อมูลเดิม · สิทธิ์ / RLS / Audit ใช้ของ investment_holdings เดิม
-- =====================================================================

ALTER TABLE public.investment_holdings
  ADD COLUMN IF NOT EXISTS income_cash_holding_id uuid REFERENCES public.investment_holdings(id) ON DELETE SET NULL;
ALTER TABLE public.investment_holdings
  ADD COLUMN IF NOT EXISTS income_bank_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.investment_holdings ADD CONSTRAINT ih_income_account_ck
    CHECK (income_cash_holding_id IS NULL OR income_bank_asset_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ih_income_cash_idx ON public.investment_holdings(income_cash_holding_id) WHERE income_cash_holding_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ih_income_bank_idx ON public.investment_holdings(income_bank_asset_id) WHERE income_bank_asset_id IS NOT NULL;

COMMENT ON COLUMN public.investment_holdings.income_cash_holding_id IS
  'บัญชีเงินฝากในพอร์ต (holding_type CASH · พอร์ตเดียวกัน · สกุลเดียวกัน) ที่รับดอกเบี้ย / ปันผล / เงินคืน — ค่าตั้งต้นของฟอร์มรับเงิน';
COMMENT ON COLUMN public.investment_holdings.income_bank_asset_id IS
  'บัญชีธนาคาร (BANK_ACCOUNT · สกุลเดียวกัน) ที่รับดอกเบี้ย / ปันผล / เงินคืน — ค่าตั้งต้นของฟอร์มรับเงิน';

-- ตรวจบัญชีที่ผูก: ตรวจเฉพาะตอนตั้ง / เปลี่ยนค่า (บัญชีที่ปิดหรือลบทีหลัง → หน้าเว็บกลับไปใช้บัญชีหลัก ★)
CREATE OR REPLACE FUNCTION private.tg_holding_income_account() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.income_cash_holding_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.income_cash_holding_id IS DISTINCT FROM OLD.income_cash_holding_id) THEN
    IF NEW.holding_type = 'CASH' OR NOT EXISTS (
         SELECT 1 FROM public.investment_holdings c
          WHERE c.id = NEW.income_cash_holding_id AND c.holding_type = 'CASH' AND c.deleted_at IS NULL
            AND c.portfolio_id = NEW.portfolio_id AND c.currency = NEW.currency) THEN
      RAISE EXCEPTION 'INVALID: บัญชีรับเงินต้องเป็นบัญชีเงินฝากในพอร์ตเดียวกัน สกุลเงินเดียวกับหลักทรัพย์' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.income_bank_asset_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.income_bank_asset_id IS DISTINCT FROM OLD.income_bank_asset_id) THEN
    IF NEW.holding_type = 'CASH' OR NOT EXISTS (
         SELECT 1 FROM public.assets a
          WHERE a.id = NEW.income_bank_asset_id AND a.asset_type = 'BANK_ACCOUNT' AND a.deleted_at IS NULL
            AND a.currency = NEW.currency) THEN
      RAISE EXCEPTION 'INVALID: บัญชีรับเงินต้องเป็นบัญชีธนาคาร สกุลเงินเดียวกับหลักทรัพย์' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.tg_holding_income_account() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS t18_income_account ON public.investment_holdings;
CREATE TRIGGER t18_income_account BEFORE INSERT OR UPDATE ON public.investment_holdings
  FOR EACH ROW EXECUTE FUNCTION private.tg_holding_income_account();
