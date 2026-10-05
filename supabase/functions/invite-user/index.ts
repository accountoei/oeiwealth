// =====================================================================
// Edge Function: invite-user  (Family Wealth Vault · Core Schema Section 5)
//
// เรียกจากเว็บ (Server Action) พร้อม Access Token ของผู้ใช้ที่ Login อยู่
//   action = "invite" : สร้างบัญชี + app_users (INVITED) แล้วคืน token สำหรับลิงก์ตั้งรหัสผ่าน
//   action = "resend" : สร้างลิงก์ใหม่ให้ผู้ใช้ที่ยังเป็น INVITED (ลิงก์เดิมหมดอายุ)
//
// ไม่ส่งอีเมล: ADMIN คัดลอกลิงก์ไปส่งเอง (LINE / อีเมลส่วนตัว)
//   → ไม่ต้องตั้ง SMTP · Supabase แผน Free ส่งอีเมลได้เฉพาะสมาชิกทีม Supabase เท่านั้น
//
// ความปลอดภัย
//   - ผู้เรียกต้องเป็น ADMIN ที่ ACTIVE และยืนยัน MFA แล้ว (aal2)
//   - ใช้ Service Role ที่ Supabase ใส่ให้ใน Edge Function อัตโนมัติ (ไม่อยู่ใน Vercel / GitHub)
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const ROLES = ["ADMIN", "EDITOR", "CONTRIBUTOR", "VIEWER"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function jwtPayload(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "=")));
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  // Secret key ที่ Supabase ใส่ให้อัตโนมัติ (แบบใหม่ SUPABASE_SECRET_KEYS ก่อน แล้วค่อยแบบเดิม)
  let serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
    serviceKey = keys.default ?? Object.values(keys)[0] ?? serviceKey;
  } catch { /* ใช้ค่าเดิม */ }
  if (!url || !serviceKey) return json({ error: "ระบบยังไม่ได้ตั้งค่า Edge Function" }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // ---- 1) ตรวจผู้เรียก --------------------------------------------------
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "ต้องเข้าสู่ระบบก่อน" }, 401);
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่" }, 401);
  if (jwtPayload(token).aal !== "aal2") return json({ error: "ต้องยืนยัน MFA ก่อนเชิญผู้ใช้" }, 403);

  const { data: me } = await admin.from("app_users").select("id,role,status")
    .eq("auth_user_id", who.user.id).maybeSingle();
  if (!me || me.role !== "ADMIN" || me.status !== "ACTIVE") return json({ error: "เฉพาะผู้ดูแลระบบเท่านั้น" }, 403);

  // ---- 2) อ่านคำขอ ------------------------------------------------------
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400); }
  const action = String(body.action ?? "invite");

  // ---- resend: ลิงก์ใหม่สำหรับผู้ใช้ที่ยังไม่เคยเข้าระบบ ----------------------
  if (action === "resend") {
    const { data: target } = await admin.from("app_users").select("id,email,status")
      .eq("id", String(body.app_user_id ?? "")).maybeSingle();
    if (!target) return json({ error: "ไม่พบผู้ใช้" }, 404);
    if (target.status !== "INVITED") return json({ error: "ผู้ใช้นี้เข้าระบบแล้ว (สร้างลิงก์ได้เฉพาะผู้ที่ยังไม่เคยเข้าระบบ)" }, 400);
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: target.email });
    if (error || !data?.properties?.hashed_token) return json({ error: `สร้างลิงก์ไม่สำเร็จ: ${error?.message ?? ""}` }, 500);
    return json({ ok: true, email: target.email, token_hash: data.properties.hashed_token, type: "magiclink" });
  }

  if (action !== "invite") return json({ error: "action ไม่ถูกต้อง" }, 400);

  // ---- invite -----------------------------------------------------------
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "");
  const personId = body.person_id ? String(body.person_id) : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "รูปแบบอีเมลไม่ถูกต้อง" }, 400);
  if (!ROLES.includes(role)) return json({ error: "สิทธิ์ไม่ถูกต้อง" }, 400);

  const { data: dup } = await admin.from("app_users").select("id").eq("email", email).maybeSingle();
  if (dup) return json({ error: "อีเมลนี้มีบัญชีในระบบแล้ว" }, 409);
  if (personId) {
    const { data: p } = await admin.from("persons").select("id").eq("id", personId).is("deleted_at", null).maybeSingle();
    if (!p) return json({ error: "ไม่พบสมาชิกครอบครัวที่เลือก" }, 400);
    const { data: linked } = await admin.from("app_users").select("id").eq("person_id", personId).maybeSingle();
    if (linked) return json({ error: "สมาชิกคนนี้มีบัญชีผู้ใช้แล้ว" }, 409);
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "invite", email });
  if (linkErr || !link?.user || !link.properties?.hashed_token) {
    const msg = linkErr?.message ?? "";
    return json({ error: /already|registered|exists/i.test(msg)
      ? "อีเมลนี้มีบัญชีใน Supabase Auth แล้ว (ลบที่ Authentication → Users ก่อน แล้วเชิญใหม่)"
      : `สร้างบัญชีไม่สำเร็จ: ${msg}` }, 400);
  }

  const { error: regErr } = await admin.rpc("server_register_invited_user", {
    p_auth_user_id: link.user.id, p_email: email, p_role: role, p_invited_by: me.id, p_person_id: personId,
  });
  if (regErr) {
    await admin.auth.admin.deleteUser(link.user.id);          // ย้อนกลับ ไม่ให้เหลือบัญชีค้าง
    return json({ error: `บันทึกผู้ใช้ไม่สำเร็จ: ${regErr.message}` }, 400);
  }
  return json({ ok: true, email, token_hash: link.properties.hashed_token, type: "invite" });
});
