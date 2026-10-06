// =====================================================================
// Edge Function: drive  (Family Wealth Vault · Documents + Google Drive)
//
//   POST {action:"connect", return_url}       ADMIN (MFA) → คืน URL หน้าอนุญาตของ Google
//   GET  ?code=…&state=…                      Google ส่งกลับมา → เก็บ Refresh Token ใน Vault → กลับหน้าเว็บ
//   POST multipart (file + meta)              อัปโหลดเอกสาร (ทุกสิทธิ์ยกเว้น VIEWER)
//   POST {action:"download", id, mode}        เปิด / ดาวน์โหลดเอกสาร (ทุกสิทธิ์ · บันทึก Audit)
//
// Secrets ที่ต้องตั้งใน Supabase (Edge Functions → Secrets): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// สิทธิ์ Google = drive.file → ระบบเห็นเฉพาะไฟล์ / โฟลเดอร์ที่ระบบสร้างเอง ไม่เห็นไฟล์อื่นใน Drive
// ปิด "Verify JWT" ของฟังก์ชันนี้ (Google เรียกกลับมาโดยไม่มี JWT) — ฟังก์ชันตรวจสิทธิ์เองทุกคำขอ
// =====================================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const MAX_BYTES = 20 * 1024 * 1024;
const SCOPES = "openid email https://www.googleapis.com/auth/drive.file";
const FOLDER = "application/vnd.google-apps.folder";
const MODULE_FOLDER: Record<string, string> = {
  FAMILY: "01 ครอบครัว", FINANCIAL: "02 การเงิน", INVESTMENT: "03 การลงทุน", PROPERTY: "04 อสังหาริมทรัพย์",
  ALTERNATIVE: "05 สินทรัพย์อื่น", INSURANCE: "06 ประกัน", HEALTH: "07 สุขภาพ", CARD_MEMBERSHIP: "08 บัตรและสมาชิก",
  SYSTEM: "09 รายงานระบบ",
};
const MIME_OK = [
  /^application\/pdf$/, /^image\/(jpeg|png|webp|gif|heic|heif)$/, /^text\/(plain|csv)$/,
  /^application\/(msword|vnd\.ms-excel|vnd\.ms-powerpoint)$/, /^application\/vnd\.openxmlformats-officedocument\./,
];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "content-disposition, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const clean = (m: string) => m.replace(/^(INVALID|PERMISSION_DENIED|PERIOD_LOCKED|NOT_FOUND):\s*/, "");

function payload(token: string): Record<string, unknown> {
  try {
    const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p.padEnd(p.length + ((4 - (p.length % 4)) % 4), "=")), (c) => c.charCodeAt(0))));
  } catch { return {}; }
}
function firstKey(jsonEnv: string | undefined, fallback: string | undefined) {
  try {
    const keys = JSON.parse(jsonEnv ?? "{}") as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? fallback;
  } catch { return fallback; }
}

const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = firstKey(Deno.env.get("SUPABASE_SECRET_KEYS"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
const ANON = firstKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"), Deno.env.get("SUPABASE_ANON_KEY"));
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const REDIRECT = `${URL_}/functions/v1/drive`;
const admin = createClient(URL_, SERVICE ?? "", { auth: { persistSession: false, autoRefreshToken: false } });

// ---------------------------------------------------------------- ผู้เรียก
type Caller = { id: string; role: string; token: string; db: SupabaseClient };
async function caller(req: Request, roles?: string[]): Promise<Caller> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "ต้องเข้าสู่ระบบก่อน");
  const { data: who, error } = await admin.auth.getUser(token);
  if (error || !who?.user) throw new HttpError(401, "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่");
  const { data: me } = await admin.from("app_users").select("id,role,status").eq("auth_user_id", who.user.id).maybeSingle();
  if (!me || me.status !== "ACTIVE") throw new HttpError(403, "ไม่มีสิทธิ์ใช้งาน");
  if (roles && !roles.includes(me.role)) throw new HttpError(403, "สิทธิ์ของคุณทำรายการนี้ไม่ได้");
  if (payload(token).aal !== "aal2") {
    let mustMfa = me.role === "ADMIN";
    if (!mustMfa) {
      const { data: f } = await admin.auth.admin.mfa.listFactors({ userId: who.user.id });
      mustMfa = (f?.factors ?? []).some((x) => x.status === "verified");
    }
    if (mustMfa) throw new HttpError(403, "ต้องยืนยัน MFA ก่อน");
  }
  const db = createClient(URL_, ANON ?? "", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { id: me.id, role: me.role, token, db };
}

// ---------------------------------------------------------------- Google
let cached: { token: string; exp: number } | null = null;
async function googleToken(params: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === "invalid_grant") throw new HttpError(502, "การเชื่อม Google Drive ถูกยกเลิกหรือหมดอายุ — ให้ ADMIN กด \"เชื่อม Google Drive\" ใหม่");
    throw new HttpError(502, `Google ตอบกลับผิดพลาด: ${j.error_description ?? j.error ?? r.status}`);
  }
  return j as { access_token: string; expires_in: number; refresh_token?: string; id_token?: string };
}
async function config() {
  const { data, error } = await admin.rpc("server_drive_config");
  if (error) throw new HttpError(500, `อ่านการตั้งค่า Drive ไม่สำเร็จ: ${error.message}`);
  return data as { refresh_token: string | null; account_email: string | null; root_folder_id: string | null;
    folder_ids: Record<string, string>; family_name: string | null };
}
async function accessToken(refresh: string | null) {
  if (!refresh) throw new HttpError(409, "ยังไม่ได้เชื่อม Google Drive — ให้ ADMIN เชื่อมที่หน้า Documents");
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const t = await googleToken({ grant_type: "refresh_token", refresh_token: refresh });
  cached = { token: t.access_token, exp: Date.now() + t.expires_in * 1000 };
  return t.access_token;
}
async function gfetch(token: string, url: string, init: RequestInit = {}) {
  return await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
}
async function createFolder(token: string, name: string, parent?: string) {
  const r = await gfetch(token, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new HttpError(502, `สร้างโฟลเดอร์ใน Drive ไม่สำเร็จ (${r.status})`);
  return j.id as string;
}
async function folderAlive(token: string, id: string) {
  const r = await gfetch(token, `https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed`);
  if (!r.ok) return false;
  const j = await r.json().catch(() => ({}));
  return j.id && !j.trashed;
}
async function moduleFolder(token: string, cfg: Awaited<ReturnType<typeof config>>, module: string, fresh = false) {
  if (!cfg.root_folder_id) throw new HttpError(409, "ยังไม่ได้เชื่อม Google Drive");
  const have = cfg.folder_ids?.[module];
  if (have && !fresh) return have;
  const id = await createFolder(token, MODULE_FOLDER[module] ?? module, cfg.root_folder_id);
  await admin.rpc("server_drive_set_folder", { p_key: module, p_folder_id: id });
  cfg.folder_ids = { ...(cfg.folder_ids ?? {}), [module]: id };
  return id;
}
async function uploadFile(token: string, folder: string, name: string, mime: string, bytes: ArrayBuffer) {
  const b = `fwv${crypto.randomUUID().replace(/-/g, "")}`;
  const body = new Blob([
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n`,
    `--${b}\r\nContent-Type: ${mime}\r\n\r\n`, bytes, `\r\n--${b}--`,
  ]);
  return await gfetch(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,mimeType,size", {
    method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body,
  });
}

// ---------------------------------------------------------------- Actions
async function connect(req: Request, body: Record<string, unknown>) {
  const me = await caller(req, ["ADMIN"]);
  if (!CLIENT_ID || !CLIENT_SECRET) throw new HttpError(500, "ยังไม่ได้ตั้ง GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET ใน Supabase Secrets");
  const ret = String(body.return_url ?? "");
  if (!/^https:\/\/|^http:\/\/localhost(:\d+)?\//.test(ret)) throw new HttpError(400, "return_url ไม่ถูกต้อง");
  const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join("");
  const { error } = await admin.rpc("server_drive_begin", { p_app_user_id: me.id, p_state: state, p_return_url: ret });
  if (error) throw new HttpError(500, error.message);
  const cfg = await config();
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: "code", scope: SCOPES,
    access_type: "offline", prompt: "consent", state, ...(cfg.account_email ? { login_hint: cfg.account_email } : {}),
  });
  return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
}

async function callback(url: URL) {
  const state = url.searchParams.get("state") ?? "";
  const back = (ret: string | null, q: string) => {
    const to = ret ?? "about:blank";
    return new Response(null, { status: 302, headers: { Location: `${to}${to.includes("?") ? "&" : "?"}${q}` } });
  };
  const { data: chk, error: chkErr } = await admin.rpc("server_drive_check_state", { p_state: state });
  if (chkErr) return new Response(clean(chkErr.message), { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const ret = (chk as { return_url: string | null }).return_url;
  try {
    if (url.searchParams.get("error")) throw new HttpError(400, "ยกเลิกการอนุญาตที่หน้า Google");
    const t = await googleToken({ grant_type: "authorization_code", code: url.searchParams.get("code") ?? "", redirect_uri: REDIRECT });
    if (!t.refresh_token) throw new HttpError(400, "Google ไม่ส่ง Refresh Token — ลองกดเชื่อมใหม่อีกครั้ง");
    const granted = (t as unknown as { scope?: string }).scope ?? "";
    if (!granted.includes("drive.file")) throw new HttpError(400, "ไม่ได้อนุญาตสิทธิ์ Google Drive — กดเชื่อมใหม่แล้วติ๊กอนุญาต Drive");
    const email = String(payload(t.id_token ?? "").email ?? "");
    if (!email) throw new HttpError(400, "อ่านอีเมลบัญชี Google ไม่ได้");
    const c = chk as { account_email: string | null; root_folder_id: string | null; has_documents: boolean };
    if (c.account_email && c.account_email.toLowerCase() !== email.toLowerCase() && c.has_documents) {
      throw new HttpError(400, `ต้องใช้บัญชีเดิม (${c.account_email}) เพราะมีเอกสารเก็บอยู่แล้ว`);
    }
    let root = c.account_email?.toLowerCase() === email.toLowerCase() && c.root_folder_id && await folderAlive(t.access_token, c.root_folder_id)
      ? c.root_folder_id : null;
    if (!root) {
      const cfg = await config();
      root = await createFolder(t.access_token, `Family Wealth Vault - ${cfg.family_name ?? "Family"}`);
    }
    const { error } = await admin.rpc("server_drive_finish", { p_state: state, p_refresh_token: t.refresh_token, p_email: email, p_root_folder_id: root });
    if (error) throw new HttpError(400, clean(error.message));
    cached = { token: t.access_token, exp: Date.now() + t.expires_in * 1000 };
    return back(ret, "drive=connected");
  } catch (e) {
    return back(ret, `drive_error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}

async function upload(req: Request) {
  const me = await caller(req, ["ADMIN", "EDITOR", "CONTRIBUTOR"]);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "กรุณาเลือกไฟล์");
  if (file.size > MAX_BYTES) throw new HttpError(400, "ไฟล์ใหญ่เกิน 20 MB");
  const mime = file.type || "application/octet-stream";
  if (!MIME_OK.some((re) => re.test(mime))) throw new HttpError(400, "รองรับเฉพาะ PDF, รูปภาพ, Word, Excel, PowerPoint, CSV, TXT");
  let meta: Record<string, unknown>;
  try { meta = JSON.parse(String(form.get("meta") ?? "{}")); } catch { throw new HttpError(400, "ข้อมูลเอกสารไม่ถูกต้อง"); }
  const module = String(meta.module ?? "");
  if (!MODULE_FOLDER[module]) throw new HttpError(400, "หมวดเอกสารไม่ถูกต้อง");
  const title = String(meta.title ?? "").trim();
  if (!title) throw new HttpError(400, "กรุณาใส่ชื่อเอกสาร");

  const cfg = await config();
  const token = await accessToken(cfg.refresh_token);
  const ext = (file.name.match(/\.[A-Za-z0-9]{1,6}$/)?.[0] ?? "").toLowerCase();
  const stamp = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const name = `${stamp} ${title}`.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 150) + ext;
  const bytes = await file.arrayBuffer();

  let folder = await moduleFolder(token, cfg, module);
  let r = await uploadFile(token, folder, name, mime, bytes);
  if (r.status === 404) {                     // โฟลเดอร์ถูกลบใน Drive → สร้างใหม่แล้วลองอีกครั้ง
    folder = await moduleFolder(token, cfg, module, true);
    r = await uploadFile(token, folder, name, mime, bytes);
  }
  const up = await r.json().catch(() => ({}));
  if (!r.ok || !up.id) throw new HttpError(502, `อัปโหลดเข้า Google Drive ไม่สำเร็จ (${r.status} ${up?.error?.message ?? ""})`);

  const { data: docId, error } = await me.db.rpc("add_document", { p: {
    ...meta, module, title, drive_file_id: up.id, mime_type: mime, file_size: file.size,
  } });
  if (error) {
    await gfetch(token, `https://www.googleapis.com/drive/v3/files/${up.id}`, { method: "DELETE" });   // ไม่ให้เหลือไฟล์ค้าง
    throw new HttpError(400, clean(error.message));
  }
  return json({ ok: true, id: docId });
}

async function download(req: Request, body: Record<string, unknown>) {
  const me = await caller(req);
  const { data: d } = await me.db.from("documents").select("id,title,drive_file_id,mime_type").eq("id", String(body.id ?? "")).maybeSingle();
  if (!d) throw new HttpError(404, "ไม่พบเอกสาร หรือไม่มีสิทธิ์เปิด");
  const cfg = await config();
  const token = await accessToken(cfg.refresh_token);
  const r = await gfetch(token, `https://www.googleapis.com/drive/v3/files/${d.drive_file_id}?alt=media`);
  if (!r.ok || !r.body) throw new HttpError(r.status === 404 ? 404 : 502, r.status === 404 ? "ไม่พบไฟล์ใน Google Drive (อาจถูกลบใน Drive)" : `เปิดไฟล์ไม่สำเร็จ (${r.status})`);
  const dl = body.mode === "download";
  await admin.rpc("server_log_event", { p_app_user_id: me.id, p_action: dl ? "DOWNLOAD_DOCUMENT" : "VIEW_DOCUMENT",
    p_entity_type: "documents", p_entity_id: d.id, p_metadata: { title: d.title } });
  return new Response(r.body, { headers: { ...CORS,
    "Content-Type": d.mime_type ?? r.headers.get("Content-Type") ?? "application/octet-stream",
    "Content-Disposition": `${dl ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(d.title)}`,
    "Cache-Control": "private, no-store" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!URL_ || !SERVICE || !ANON) return json({ error: "ระบบยังไม่ได้ตั้งค่า Edge Function" }, 500);
  try {
    const url = new URL(req.url);
    if (req.method === "GET" && url.searchParams.has("state")) return await callback(url);
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if ((req.headers.get("Content-Type") ?? "").startsWith("multipart/form-data")) return await upload(req);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action === "connect") return await connect(req, body);
    if (body.action === "download") return await download(req, body);
    return json({ error: "action ไม่ถูกต้อง" }, 400);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "เกิดข้อผิดพลาดในระบบ" }, 500);
  }
});
