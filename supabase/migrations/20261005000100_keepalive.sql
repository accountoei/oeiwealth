-- =====================================================================
-- Keep-alive สำหรับ Supabase Free Plan (กัน Project ถูก Pause เมื่อไม่มีการใช้งาน)
--   GitHub Actions เรียก POST /rest/v1/rpc/keepalive ทุก 3 วัน
--   - อ่านอย่างเดียว ไม่เขียนข้อมูลลงฐานข้อมูล
--   - ไม่คืนข้อมูลของครอบครัวใด ๆ (คืนแค่เวลาปัจจุบันของฐานข้อมูล)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.keepalive()
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT now()
$$;

REVOKE ALL ON FUNCTION public.keepalive() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.keepalive() TO anon, authenticated, service_role;
