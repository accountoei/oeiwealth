-- =====================================================================
-- ตารางรับดอกเบี้ย / เงินต้นของหุ้นกู้ (ตกลง 22 ต.ค. 2026)
--   ใส่ข้อมูลหลักใน "แก้ไขข้อมูล" ของหลักทรัพย์: เงินต้น (มูลค่าหน้าตั๋ว) · อัตรา % ต่อปี (interest_rate เดิม) ·
--   จ่ายทุก 1 / 3 / 6 / 12 เดือน หรือครั้งเดียวตอนครบกำหนด · วันครบกำหนด (maturity_date เดิม)
--   ตารางรับคำนวณที่หน้าเว็บทุกครั้ง (ไม่เก็บเป็นตาราง) → แก้ข้อมูลหลักแล้วรายการในแท็บ "รอรับเดือนนี้" เปลี่ยนตาม
--   FCN / Structured ใช้ข้อมูลใน fcn_details เดิม (principal · coupon_rate · coupon_frequency)
--   เพิ่มคอลัมน์อย่างเดียว ไม่แตะข้อมูลเดิม · สิทธิ์ / RLS / Audit ใช้ของ investment_holdings เดิม
-- =====================================================================

ALTER TABLE public.investment_holdings ADD COLUMN IF NOT EXISTS face_value public.d_money;
ALTER TABLE public.investment_holdings ADD COLUMN IF NOT EXISTS coupon_frequency text;

DO $$ BEGIN
  ALTER TABLE public.investment_holdings ADD CONSTRAINT ih_face_value_ck CHECK (face_value IS NULL OR face_value > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.investment_holdings ADD CONSTRAINT ih_coupon_frequency_ck
    CHECK (coupon_frequency IS NULL OR coupon_frequency IN ('MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL','AT_MATURITY'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.investment_holdings ADD CONSTRAINT ih_interest_rate_ck CHECK (interest_rate IS NULL OR interest_rate >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.investment_holdings.face_value IS 'เงินต้น / มูลค่าหน้าตั๋ว (สกุลของหลักทรัพย์) — ใช้คำนวณดอกเบี้ยต่องวด';
COMMENT ON COLUMN public.investment_holdings.coupon_frequency IS
  'จ่ายดอกเบี้ยทุก: MONTHLY / QUARTERLY / SEMI_ANNUAL / ANNUAL / AT_MATURITY · วันรับนับย้อนจาก maturity_date';
