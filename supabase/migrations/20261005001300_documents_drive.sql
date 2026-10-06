-- =====================================================================
-- Documents + Google Drive
--   - ไฟล์อยู่ใน Google Drive ของระบบ (เชื่อมครั้งเดียวโดย ADMIN · สิทธิ์ drive.file = เห็นเฉพาะไฟล์ที่ระบบสร้าง)
--   - Refresh Token เก็บใน Supabase Vault (fwv_drive_refresh_token) · อ่านได้เฉพาะ Edge Function (service_role)
--   - ผู้ใช้ไม่เข้า Drive ตรง: เปิด / อัปโหลดผ่าน Edge Function "drive" ที่ตรวจสิทธิ์ทุกครั้ง
-- =====================================================================

CREATE TABLE IF NOT EXISTS private.drive_settings (
  id                   integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  account_email        text,
  root_folder_id       text,
  folder_ids           jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_at         timestamptz,
  connected_by         uuid,
  oauth_state          text,
  oauth_state_expires  timestamptz,
  oauth_return_url     text,
  oauth_started_by     uuid
);
INSERT INTO private.drive_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
REVOKE ALL ON private.drive_settings FROM PUBLIC;

-- เขียน Secret ลง Vault (สร้างใหม่ หรือแทนค่าเดิม)
CREATE OR REPLACE FUNCTION private.set_vault_secret(p_name text, p_value text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  SELECT s.id INTO v_id FROM vault.secrets s WHERE s.name = p_name;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_value, p_name, 'Family Wealth Vault');
  ELSE
    PERFORM vault.update_secret(v_id, p_value);
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.set_vault_secret(text, text) FROM PUBLIC;

-- ---------------------------------------------------------------------
-- สถานะการเชื่อม Drive (ทุกคนอ่านได้ · รหัสโฟลเดอร์เฉพาะ ADMIN)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drive_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s private.drive_settings; v_has boolean;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR','VIEWER');
  SELECT * INTO s FROM private.drive_settings WHERE id = 1;
  SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets d WHERE d.name = 'fwv_drive_refresh_token'
                  AND coalesce(d.decrypted_secret, '') <> '') INTO v_has;
  RETURN jsonb_build_object(
    'connected', v_has AND s.root_folder_id IS NOT NULL,
    'account_email', s.account_email,
    'connected_at', s.connected_at,
    'root_folder_id', CASE WHEN private.has_role('ADMIN') THEN s.root_folder_id END);
END $$;

-- ---------------------------------------------------------------------
-- server_* (Edge Function เท่านั้น)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.server_drive_config() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'refresh_token', (SELECT d.decrypted_secret FROM vault.decrypted_secrets d WHERE d.name = 'fwv_drive_refresh_token' LIMIT 1),
    'account_email', s.account_email, 'root_folder_id', s.root_folder_id, 'folder_ids', s.folder_ids,
    'family_name', (SELECT f.name FROM public.families f ORDER BY f.created_at LIMIT 1))
  FROM private.drive_settings s WHERE s.id = 1
$$;

CREATE OR REPLACE FUNCTION public.server_drive_begin(p_app_user_id uuid, p_state text, p_return_url text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF length(coalesce(p_state, '')) < 32 THEN RAISE EXCEPTION 'INVALID: state' USING ERRCODE = '22023'; END IF;
  UPDATE private.drive_settings SET oauth_state = p_state, oauth_state_expires = now() + interval '10 minutes',
         oauth_return_url = p_return_url, oauth_started_by = p_app_user_id
   WHERE id = 1;
END $$;

-- ตรวจ state (ไม่ลบ) → คืน return_url / ผู้เริ่ม / บัญชีเดิม
CREATE OR REPLACE FUNCTION public.server_drive_check_state(p_state text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s private.drive_settings;
BEGIN
  SELECT * INTO s FROM private.drive_settings WHERE id = 1;
  IF s.oauth_state IS NULL OR s.oauth_state <> p_state OR s.oauth_state_expires < now() THEN
    RAISE EXCEPTION 'INVALID: ลิงก์เชื่อม Drive หมดอายุ กรุณากดเชื่อมใหม่' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('return_url', s.oauth_return_url, 'started_by', s.oauth_started_by,
    'account_email', s.account_email, 'root_folder_id', s.root_folder_id,
    'has_documents', EXISTS (SELECT 1 FROM public.documents d WHERE d.deleted_at IS NULL));
END $$;

CREATE OR REPLACE FUNCTION public.server_drive_finish(p_state text, p_refresh_token text, p_email text, p_root_folder_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s private.drive_settings;
BEGIN
  SELECT * INTO s FROM private.drive_settings WHERE id = 1 FOR UPDATE;
  IF s.oauth_state IS NULL OR s.oauth_state <> p_state OR s.oauth_state_expires < now() THEN
    RAISE EXCEPTION 'INVALID: ลิงก์เชื่อม Drive หมดอายุ กรุณากดเชื่อมใหม่' USING ERRCODE = '22023';
  END IF;
  IF s.account_email IS NOT NULL AND lower(s.account_email) <> lower(p_email)
     AND EXISTS (SELECT 1 FROM public.documents d WHERE d.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ต้องเชื่อมด้วยบัญชีเดิม (%) เพราะมีเอกสารเก็บอยู่แล้ว', s.account_email USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_refresh_token, '') = '' OR coalesce(p_root_folder_id, '') = '' THEN
    RAISE EXCEPTION 'INVALID: ข้อมูลจาก Google ไม่ครบ' USING ERRCODE = '22023';
  END IF;
  PERFORM private.set_vault_secret('fwv_drive_refresh_token', p_refresh_token);
  UPDATE private.drive_settings SET
    account_email = lower(p_email),
    folder_ids = CASE WHEN root_folder_id IS DISTINCT FROM p_root_folder_id THEN '{}'::jsonb ELSE folder_ids END,
    root_folder_id = p_root_folder_id,
    connected_at = now(), connected_by = s.oauth_started_by,
    oauth_state = NULL, oauth_state_expires = NULL, oauth_return_url = NULL
   WHERE id = 1;
  PERFORM private.write_audit('SET_SENSITIVE', 'drive_settings', '1',
          jsonb_build_object('account_email', lower(p_email)), NULL, 'google_drive', s.oauth_started_by);
END $$;

CREATE OR REPLACE FUNCTION public.server_drive_set_folder(p_key text, p_folder_id text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE private.drive_settings SET folder_ids = folder_ids || jsonb_build_object(p_key, p_folder_id) WHERE id = 1
$$;

-- ---------------------------------------------------------------------
-- add_document (Edge Function เรียกด้วยสิทธิ์ของผู้ใช้ · RLS / Trigger ทำงานตามปกติ)
--   p: {module, document_type, title, drive_file_id, mime_type, file_size, issue_date, expiry_date, notes,
--       supersedes_document_id, links:[{entity_type, entity_id}]}
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_document(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id uuid; v_old uuid := nullif(p->>'supersedes_document_id', '')::uuid; l jsonb; v_n int := 0;
BEGIN
  IF length(trim(coalesce(p->>'title', ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อเอกสาร' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p->>'document_type', ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกประเภทเอกสาร' USING ERRCODE = '22023'; END IF;
  IF nullif(p->>'expiry_date', '')::date < nullif(p->>'issue_date', '')::date THEN
    RAISE EXCEPTION 'INVALID: วันหมดอายุต้องไม่ก่อนวันที่ออก' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.documents(family_id, module, document_type, title, drive_file_id, mime_type, file_size,
              issue_date, expiry_date, supersedes_document_id, notes)
  VALUES ((SELECT f.id FROM public.families f ORDER BY f.created_at LIMIT 1), p->>'module', trim(p->>'document_type'),
          trim(p->>'title'), p->>'drive_file_id', nullif(p->>'mime_type', ''), nullif(p->>'file_size', '')::bigint,
          nullif(p->>'issue_date', '')::date, nullif(p->>'expiry_date', '')::date, v_old, nullif(trim(p->>'notes'), ''))
  RETURNING id INTO v_id;

  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p->'links', '[]'::jsonb)) LOOP
    IF nullif(l->>'entity_id', '') IS NOT NULL THEN
      INSERT INTO public.document_links(document_id, entity_type, entity_id)
      VALUES (v_id, upper(l->>'entity_type'), (l->>'entity_id')::uuid) ON CONFLICT DO NOTHING;
      v_n := v_n + 1;
    END IF;
  END LOOP;

  IF v_old IS NOT NULL THEN
    UPDATE public.documents SET version_status = 'SUPERSEDED' WHERE id = v_old AND deleted_at IS NULL;
    IF v_n = 0 THEN            -- ฉบับใหม่ผูกกับรายการเดียวกับฉบับเดิม
      INSERT INTO public.document_links(document_id, entity_type, entity_id)
      SELECT v_id, x.entity_type, x.entity_id FROM public.document_links x WHERE x.document_id = v_old AND x.deleted_at IS NULL
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN v_id;
END $$;

-- ผูกเอกสารที่มีอยู่แล้วกับรายการเพิ่ม
CREATE OR REPLACE FUNCTION public.link_document(p_document_id uuid, p_entity_type text, p_entity_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.documents WHERE id = p_document_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID: ไม่พบเอกสาร' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.document_links(document_id, entity_type, entity_id) VALUES (p_document_id, upper(p_entity_type), p_entity_id)
  ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.drive_status()', 'public.add_document(jsonb)', 'public.link_document(uuid,text,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.server_drive_config()', 'public.server_drive_begin(uuid,text,text)',
    'public.server_drive_check_state(text)', 'public.server_drive_finish(text,text,text,text)',
    'public.server_drive_set_folder(text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
