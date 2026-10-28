-- =====================================================================
-- รูปครอบครัว (28 ต.ค. 2026) — แสดงมุมซ้ายบนของเมนูแทนชื่อย่อครอบครัว
-- เก็บแบบเดียวกับรูปสมาชิก (persons.photo): data URL รูปเล็ก ≤ 300 KB
-- แก้ได้เฉพาะ ADMIN (policy p_update + private.tg_families_guard เดิม) · ทุก Role อ่านได้
-- รันซ้ำได้
-- =====================================================================
ALTER TABLE public.families ADD COLUMN IF NOT EXISTS photo text;

ALTER TABLE public.families DROP CONSTRAINT IF EXISTS families_photo_format;
ALTER TABLE public.families ADD CONSTRAINT families_photo_format
  CHECK (photo IS NULL OR (photo ~ '^data:image/(jpeg|png|webp);base64,' AND length(photo) <= 300000));
