// =====================================================================
// Edge Function: fx-refresh  (Family Wealth Vault)
//
// ปุ่ม "อัปเดตอัตราตอนนี้" (Settings → System) → สั่ง GitHub Actions รันงาน FX rates (fx-rates.yml) ทันที
//   งานใช้โปรแกรม / Key / กฎเดิมทั้งหมด (แหล่งที่เลือก · กันต่างเกิน 5% · ไม่ทับ Override · ไม่แตะงวดที่ปิด)
//
// ความปลอดภัย
//   - ผู้เรียกต้องเป็น ADMIN ที่ ACTIVE (ตรวจ Access Token ของผู้ใช้เอง — Verify JWT ปิด)
//   - กันกดถี่: ห่างกันอย่างน้อย 5 นาที (นับจาก audit_logs)
//   - GITHUB_DISPATCH_TOKEN (Fine-grained token: repo นี้เท่านั้น · สิทธิ์ Actions = Read and write) อยู่ใน Supabase Edge Function Secrets เท่านั้น
//   - GITHUB_REPO (ไม่บังคับ) ค่าตั้งต้น accountoei/oeiwealth
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const MIN_GAP_MS = 5 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  let serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
    serviceKey = keys.default ?? Object.values(keys)[0] ?? serviceKey;
  } catch { /* ใช้ค่าเดิม */ }
  if (!url || !serviceKey) return json({ error: "ระบบยังไม่ได้ตั้งค่า Edge Function" }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // ---- 1) ตรวจผู้เรียก: ADMIN ที่ ACTIVE --------------------------------------
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "ต้องเข้าสู่ระบบก่อน" }, 401);
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่" }, 401);
  const { data: me } = await admin.from("app_users").select("id,role,status,family_id")
    .eq("auth_user_id", who.user.id).maybeSingle();
  if (!me || me.role !== "ADMIN" || me.status !== "ACTIVE") return json({ error: "เฉพาะผู้ดูแลระบบเท่านั้น" }, 403);

  // ---- 2) กันกดถี่ ----------------------------------------------------------
  const { data: last } = await admin.from("audit_logs").select("event_at")
    .eq("entity_type", "fx_rates").eq("field_name", "fx_refresh_request")
    .order("event_at", { ascending: false }).limit(1).maybeSingle();
  if (last?.event_at) {
    const wait = MIN_GAP_MS - (Date.now() - Date.parse(last.event_at));
    if (wait > 0) return json({ error: `เพิ่งสั่งอัปเดตไป — กดได้อีกครั้งในอีก ${Math.ceil(wait / 60000)} นาที` }, 429);
  }

  // ---- 3) สั่ง GitHub Actions ------------------------------------------------
  const gh = Deno.env.get("GITHUB_DISPATCH_TOKEN");
  if (!gh) return json({ error: "ยังไม่ได้ตั้ง GITHUB_DISPATCH_TOKEN ใน Supabase → Edge Functions → Secrets" }, 500);
  const repo = Deno.env.get("GITHUB_REPO") || "accountoei/oeiwealth";
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/fx-rates.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gh}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "family-wealth-vault-fx-refresh", "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  // วันหมดอายุของ token (GitHub ส่งมาใน header) — ใช้เตือนในหน้า Settings
  const expires = res.headers.get("github-authentication-token-expiration");
  if (res.status === 401) return json({ error: "GitHub ปฏิเสธ token (อาจหมดอายุ) — สร้าง token ใหม่แล้วใส่ใน Supabase Secrets" }, 502);
  if (res.status === 403 || res.status === 404) return json({ error: `GitHub ไม่ให้สิทธิ์ (${res.status}) — token ต้องเลือก repo นี้ และสิทธิ์ Actions = Read and write` }, 502);
  if (res.status !== 204) return json({ error: `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502);

  await admin.from("audit_logs").insert({
    family_id: me.family_id, user_id: me.id, actor_type: "USER", action: "UPDATE", entity_type: "fx_rates",
    field_name: "fx_refresh_request", metadata: { token_expires: expires },
  });
  return json({ ok: true, token_expires: expires });
});
