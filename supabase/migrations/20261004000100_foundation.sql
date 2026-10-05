-- =====================================================================
-- Family Wealth Vault — Physical Schema V1.1
-- 0100 Foundation: extensions, schemas, domains
-- อ้างอิง: Core Schema V1.1 (FROZEN) Section 2.4, 2.5, 6.5
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- วันที่ทั้งระบบ (current_date / วันในอนาคต / สิ้นเดือน) ต้องเป็นเวลาไทย ไม่ใช่ UTC
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Bangkok');
END $$;
SET timezone TO 'Asia/Bangkok';

-- schema "private" = ไม่เปิดผ่าน API (ห้ามใส่ใน Exposed schemas ของ Supabase)
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
-- authenticated ต้องเรียก helper ที่ใช้ใน RLS ได้ (เฉพาะ function ที่ GRANT ให้เท่านั้น)
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Domains — กำหนด Precision/Scale ของตัวเลขทั้งระบบ (Section 2.4: NUMERIC เท่านั้น)
-- ---------------------------------------------------------------------
-- เงิน (ทุกสกุล, รวม *_base_* ที่เป็น THB) : 16 หลักหน้าจุด, 4 หลักหลังจุด
CREATE DOMAIN public.d_money    AS numeric(20,4);
-- จำนวนหน่วย (หุ้น / หน่วยกองทุน / Crypto / Points)
CREATE DOMAIN public.d_qty      AS numeric(30,10);
-- ราคาต่อหน่วย / ต้นทุนเฉลี่ยต่อหน่วย
CREATE DOMAIN public.d_price    AS numeric(30,10);
-- อัตราแลกเปลี่ยน (1 หน่วยต่างประเทศ = X THB)
CREATE DOMAIN public.d_fx       AS numeric(20,10) CHECK (VALUE > 0);
-- เปอร์เซ็นต์ 0–100 (Ownership / Beneficiary / Responsibility)
CREATE DOMAIN public.d_pct      AS numeric(7,4)  CHECK (VALUE >= 0 AND VALUE <= 100);
-- อัตราดอกเบี้ย / Coupon / Level (%) — อนุญาตเกิน 100 ได้ (เช่น Strike 105%)
CREATE DOMAIN public.d_rate     AS numeric(12,6);
-- รหัสสกุลเงิน ISO 4217
CREATE DOMAIN public.d_currency AS text CHECK (VALUE ~ '^[A-Z]{3}$');
-- เดือน (เก็บเป็นวันที่ 1 ของเดือน) ใช้แทน "YYYY-MM"
CREATE DOMAIN public.d_month    AS date CHECK (extract(day FROM VALUE) = 1);
