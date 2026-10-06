-- =====================================================================
-- LOCAL TEST ONLY — จำลองสิ่งที่ Supabase มีให้อยู่แล้ว
-- ห้ามรันไฟล์นี้บน Supabase จริง
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Supabase Vault (จำลอง)
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (id uuid NOT NULL DEFAULT gen_random_uuid(), name text PRIMARY KEY, secret text, description text);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
INSERT INTO vault.secrets(name, secret) VALUES ('fwv_bank_account_key', 'local-test-key-do-not-use-in-prod')
ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '', new_key_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql AS $$ INSERT INTO vault.secrets(name, secret, description) VALUES (new_name, new_secret, new_description) RETURNING id $$;
CREATE OR REPLACE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL, new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ UPDATE vault.secrets SET secret = coalesce(new_secret, secret) WHERE id = secret_id $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
