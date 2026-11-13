-- =====================================================================
-- ตารางรับดอกเบี้ย / เงินต้นของหุ้นกู้ · FCN · Structured แบบตั้งเองรายงวด (ตกลง 13 พ.ย. 2026 · แบบตารางผ่อนเงินกู้)
--   1) investment_coupon_lines: งวดที่ตั้งไว้ (วันรับ · ดอกเบี้ย · เงินต้น · หมายเหตุ)
--      เป็น "แผน" เท่านั้น ไม่กระทบยอดเงิน / Net Worth (เงินจริงยังมาจากรายการรับ Coupon / ดอกเบี้ย / ครบกำหนด)
--      งวดก่อน Go-live ใส่ได้ = ข้อมูลเท่านั้น (หน้าเว็บแสดง "ก่อน Go-live")
--      ไม่มีงวดที่ตั้งไว้ = หน้าเว็บคำนวณตารางจากข้อมูลหลักเหมือนเดิม (เงินต้น · อัตรา · จ่ายทุก · วันครบกำหนด)
--   2) set_holding_coupon_schedule(): ตั้ง / แทนที่ตารางทั้งชุด · ส่งตารางว่าง = ลบ (กลับไปใช้ตารางคำนวณ)
--      สถานะ "รับแล้ว" คำนวณที่หน้าเว็บจากรายการรับจริงทุกครั้ง → แทนที่ทั้งชุดได้แม้รับไปบางงวดแล้ว
-- รันซ้ำได้ (IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS)
-- =====================================================================

-- ---------------------------------------------------------------- 1) ตาราง
CREATE TABLE IF NOT EXISTS public.investment_coupon_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holding_id      uuid NOT NULL REFERENCES public.investment_holdings(id),
  line_no         integer NOT NULL CHECK (line_no >= 1),
  due_date        date NOT NULL,
  interest_due    public.d_money NOT NULL DEFAULT 0 CHECK (interest_due >= 0),
  principal_due   public.d_money NOT NULL DEFAULT 0 CHECK (principal_due >= 0),
  notes           text CHECK (notes IS NULL OR length(notes) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.app_users(id),
  deleted_at timestamptz, deleted_by uuid REFERENCES public.app_users(id),
  CONSTRAINT icl_amount_positive CHECK (interest_due + principal_due > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS investment_coupon_lines_no_uq
  ON public.investment_coupon_lines (holding_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS investment_coupon_lines_due_idx
  ON public.investment_coupon_lines (holding_id, due_date) WHERE deleted_at IS NULL;

-- Generic triggers (เหมือนทุกตาราง: META · ห้าม Hard Delete · Audit)
DROP TRIGGER IF EXISTS t10_meta ON public.investment_coupon_lines;
CREATE TRIGGER t10_meta BEFORE INSERT OR UPDATE ON public.investment_coupon_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_meta('soft');
DROP TRIGGER IF EXISTS t05_block_hard_delete ON public.investment_coupon_lines;
CREATE TRIGGER t05_block_hard_delete BEFORE DELETE ON public.investment_coupon_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_block_hard_delete();
DROP TRIGGER IF EXISTS z90_audit ON public.investment_coupon_lines;
CREATE TRIGGER z90_audit AFTER INSERT OR UPDATE OR DELETE ON public.investment_coupon_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_audit();

-- ต้องผูกกับหุ้นกู้ / FCN / Structured / อื่น ๆ ที่ยังไม่ถูกลบ · ย้ายงวดไปหลักทรัพย์อื่นไม่ได้
CREATE OR REPLACE FUNCTION private.tg_coupon_line_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.holding_id IS DISTINCT FROM OLD.holding_id THEN
    RAISE EXCEPTION 'IMMUTABLE: ย้ายงวดไปหลักทรัพย์อื่นไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.investment_holdings h
                  WHERE h.id = NEW.holding_id AND h.deleted_at IS NULL
                    AND h.holding_type IN ('BOND','FCN','STRUCTURED_PRODUCT','OTHER')) THEN
    RAISE EXCEPTION 'INVALID: ตารางรับใช้ได้กับหุ้นกู้ / พันธบัตร · FCN · Structured · อื่น ๆ เท่านั้น' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t50_coupon_line_check ON public.investment_coupon_lines;
CREATE TRIGGER t50_coupon_line_check BEFORE INSERT OR UPDATE ON public.investment_coupon_lines
  FOR EACH ROW EXECUTE FUNCTION private.tg_coupon_line_check();

-- RLS: Permission Matrix มาตรฐาน (เหมือน 20261004001600_rls_grants.sql)
ALTER TABLE public.investment_coupon_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investment_coupon_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.investment_coupon_lines TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.investment_coupon_lines TO service_role;
DROP POLICY IF EXISTS p_select ON public.investment_coupon_lines;
DROP POLICY IF EXISTS p_insert ON public.investment_coupon_lines;
DROP POLICY IF EXISTS p_update ON public.investment_coupon_lines;
CREATE POLICY p_select ON public.investment_coupon_lines FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER')));
CREATE POLICY p_insert ON public.investment_coupon_lines FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR','CONTRIBUTOR')));
CREATE POLICY p_update ON public.investment_coupon_lines FOR UPDATE TO authenticated
  USING ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND created_at >= now() - interval '24 hours' AND deleted_at IS NULL))
  WITH CHECK ((SELECT private.has_role('ADMIN','EDITOR'))
         OR ((SELECT private.has_role('CONTRIBUTOR')) AND created_by = (SELECT private.app_user_id())
             AND deleted_at IS NULL));

-- ---------------------------------------------------------------- 2) ตั้ง / แทนที่ตารางทั้งชุด
CREATE OR REPLACE FUNCTION public.set_holding_coupon_schedule(p_holding_id uuid, p_lines jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_count integer := 0;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR');
  IF NOT EXISTS (SELECT 1 FROM public.investment_holdings h
                  WHERE h.id = p_holding_id AND h.deleted_at IS NULL
                    AND h.holding_type IN ('BOND','FCN','STRUCTURED_PRODUCT','OTHER')) THEN
    RAISE EXCEPTION 'INVALID: ตารางรับใช้ได้กับหุ้นกู้ / พันธบัตร · FCN · Structured · อื่น ๆ เท่านั้น' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID: อ่านตารางรับไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) > 600 THEN
    RAISE EXCEPTION 'INVALID: ตารางรับยาวเกิน 600 งวด' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
              WHERE nullif(x->>'due_date', '') IS NULL
                 OR coalesce(nullif(x->>'principal', '')::numeric, 0) < 0
                 OR coalesce(nullif(x->>'interest', '')::numeric, 0) < 0
                 OR coalesce(nullif(x->>'principal', '')::numeric, 0) + coalesce(nullif(x->>'interest', '')::numeric, 0) <= 0) THEN
    RAISE EXCEPTION 'INVALID: ทุกงวดต้องมีวันที่ และยอดดอกเบี้ยหรือเงินต้นมากกว่า 0' USING ERRCODE = '22023';
  END IF;
  -- เงินต้นคืนครั้งเดียวที่งวดสุดท้าย (บันทึกรับเงินต้น = รายการครบกำหนด ซึ่งปิดหลักทรัพย์)
  IF (SELECT count(*) FROM jsonb_array_elements(p_lines) x WHERE coalesce(nullif(x->>'principal', '')::numeric, 0) > 0) > 1
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
                 WHERE coalesce(nullif(x->>'principal', '')::numeric, 0) > 0
                   AND (x->>'due_date')::date < (SELECT max((y->>'due_date')::date) FROM jsonb_array_elements(p_lines) y)) THEN
    RAISE EXCEPTION 'INVALID: เงินต้นใส่ได้งวดเดียว คืองวดสุดท้าย (วันครบกำหนด)' USING ERRCODE = '22023';
  END IF;

  UPDATE public.investment_coupon_lines SET deleted_at = now()
   WHERE holding_id = p_holding_id AND deleted_at IS NULL;

  INSERT INTO public.investment_coupon_lines(holding_id, line_no, due_date, interest_due, principal_due, notes)
  SELECT p_holding_id,
         row_number() OVER (ORDER BY (x->>'due_date')::date, ord),
         (x->>'due_date')::date,
         round(coalesce(nullif(x->>'interest', '')::numeric, 0), 2),
         round(coalesce(nullif(x->>'principal', '')::numeric, 0), 2),
         left(nullif(trim(x->>'notes'), ''), 200)
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(x, ord);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.set_holding_coupon_schedule(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_holding_coupon_schedule(uuid, jsonb) TO authenticated;
