-- =====================================================================
-- Documents: ฉบับใหม่แทนหลายฉบับ + กันไฟล์ซ้ำ
--   - content_sha256 = ลายนิ้วมือของไฟล์ (Edge Function คำนวณ) → ไฟล์เดียวกันทุกไบต์บันทึกซ้ำไม่ได้
--   - add_document รับ supersedes_document_ids (หลายฉบับ) · ฉบับเดิมเป็น SUPERSEDED ได้ทุก Role ที่เพิ่มเอกสารได้
-- =====================================================================

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS content_sha256 text
  CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$');
CREATE INDEX IF NOT EXISTS documents_sha256_idx ON public.documents(content_sha256) WHERE deleted_at IS NULL;

-- ตั้งฉบับเดิมเป็น SUPERSEDED (ผู้บันทึก CONTRIBUTOR แก้แถวของคนอื่นไม่ได้ตาม RLS → ทำผ่านฟังก์ชันนี้)
CREATE OR REPLACE FUNCTION private.mark_documents_superseded(p_new uuid, p_old uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
  PERFORM private.require_role('ADMIN','EDITOR','CONTRIBUTOR');
  IF NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = p_new AND d.deleted_at IS NULL
                  AND d.version_status = 'CURRENT' AND d.created_by = private.app_user_id()) THEN
    RAISE EXCEPTION 'INVALID: ไม่พบเอกสารฉบับใหม่' USING ERRCODE = '22023';
  END IF;
  UPDATE public.documents SET version_status = 'SUPERSEDED'
   WHERE id = ANY (p_old) AND id <> p_new AND deleted_at IS NULL AND version_status = 'CURRENT';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION private.mark_documents_superseded(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mark_documents_superseded(uuid, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------
-- add_document (แทนฉบับเดิม)
--   p: {..., content_sha256, supersedes_document_ids:[uuid], supersedes_document_id (เดิม · ยังรับได้)}
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_document(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_id uuid; l jsonb; v_n int := 0; v_dup text;
  v_old uuid[] := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(coalesce(p->'supersedes_document_ids', '[]'::jsonb)) x
                         WHERE x <> '');
  v_hash text := nullif(lower(p->>'content_sha256'), '');
BEGIN
  IF nullif(p->>'supersedes_document_id', '') IS NOT NULL THEN
    v_old := array_append(v_old, (p->>'supersedes_document_id')::uuid);
  END IF;
  IF length(trim(coalesce(p->>'title', ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาใส่ชื่อเอกสาร' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p->>'document_type', ''))) = 0 THEN RAISE EXCEPTION 'INVALID: กรุณาเลือกประเภทเอกสาร' USING ERRCODE = '22023'; END IF;
  IF nullif(p->>'expiry_date', '')::date < nullif(p->>'issue_date', '')::date THEN
    RAISE EXCEPTION 'INVALID: วันหมดอายุต้องไม่ก่อนวันที่ออก' USING ERRCODE = '22023';
  END IF;
  IF v_hash IS NOT NULL THEN
    SELECT d.title INTO v_dup FROM public.documents d WHERE d.content_sha256 = v_hash AND d.deleted_at IS NULL LIMIT 1;
    IF v_dup IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID: ไฟล์นี้มีอยู่ในระบบแล้ว ชื่อ "%"', v_dup USING ERRCODE = '22023';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_old) o WHERE NOT EXISTS (
               SELECT 1 FROM public.documents d WHERE d.id = o AND d.deleted_at IS NULL AND d.version_status = 'CURRENT')) THEN
    RAISE EXCEPTION 'INVALID: ฉบับเดิมที่เลือกไม่ใช่ฉบับปัจจุบันแล้ว — ลองโหลดหน้าใหม่' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.documents(family_id, module, document_type, title, drive_file_id, mime_type, file_size,
              issue_date, expiry_date, supersedes_document_id, notes, content_sha256)
  VALUES ((SELECT f.id FROM public.families f ORDER BY f.created_at LIMIT 1), p->>'module', trim(p->>'document_type'),
          trim(p->>'title'), p->>'drive_file_id', nullif(p->>'mime_type', ''), nullif(p->>'file_size', '')::bigint,
          nullif(p->>'issue_date', '')::date, nullif(p->>'expiry_date', '')::date, v_old[1], nullif(trim(p->>'notes'), ''), v_hash)
  RETURNING id INTO v_id;

  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p->'links', '[]'::jsonb)) LOOP
    IF nullif(l->>'entity_id', '') IS NOT NULL THEN
      INSERT INTO public.document_links(document_id, entity_type, entity_id)
      VALUES (v_id, upper(l->>'entity_type'), (l->>'entity_id')::uuid) ON CONFLICT DO NOTHING;
      v_n := v_n + 1;
    END IF;
  END LOOP;

  IF cardinality(v_old) > 0 THEN
    PERFORM private.mark_documents_superseded(v_id, v_old);
    IF v_n = 0 THEN            -- ฉบับใหม่ผูกกับรายการเดียวกับฉบับเดิม
      INSERT INTO public.document_links(document_id, entity_type, entity_id)
      SELECT DISTINCT v_id, x.entity_type, x.entity_id FROM public.document_links x
       WHERE x.document_id = ANY (v_old) AND x.deleted_at IS NULL
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.add_document(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_document(jsonb) TO authenticated;
