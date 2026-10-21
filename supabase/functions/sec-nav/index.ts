// =====================================================================
// Edge Function: sec-nav  (Family Wealth Vault)
//
// ปุ่ม "ดึง NAV จาก ก.ล.ต." ในฟอร์มยอดตั้งต้น / แปลงเป็นจำนวนหน่วย
//   รับ { query: ชื่อย่อกองทุน | ชื่อชนิดหน่วย | "proj_id|ชนิดหน่วย", date: "YYYY-MM-DD" }
//   ตอบ { ref, proj_id, class, name_th, name_en, nav, nav_date }  (NAV ของวันนั้น หรือวันทำการก่อนหน้าภายใน 10 วัน)
//      หรือ { error, classes: [...] } เมื่อกองทุนมีหลายชนิดหน่วย (ให้ผู้ใช้เลือก)
//   อ่านอย่างเดียว — ไม่บันทึกอะไรลงฐานข้อมูล (ผู้ใช้ตรวจแล้วกดบันทึกเองในฟอร์ม)
//
// ความปลอดภัย
//   - ผู้เรียกต้องเป็นผู้ใช้ที่ ACTIVE และบันทึกข้อมูลได้ (ADMIN / EDITOR / CONTRIBUTOR) — ตรวจ Access Token เอง (Verify JWT ปิด)
//   - SEC_API_KEY อยู่ใน Supabase Edge Function Secrets เท่านั้น (ไม่อยู่ใน Vercel / โค้ด)
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SEC = "https://api.sec.or.th/v2/fund";
const LIVE = ["REGISTERED", "IPO", "EXPIRED"];

type Row = Record<string, unknown>;
const up = (v: unknown) => String(v ?? "").trim().toUpperCase();
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

class SecError extends Error { constructor(msg: string, public status = 502) { super(msg); } }

async function sec(key: string, path: string, params: Record<string, string | undefined>): Promise<Row[]> {
  const q = new URLSearchParams({ page_size: "100" });
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const res = await fetch(`${SEC}${path}?${q}`, { headers: { "Ocp-Apim-Subscription-Key": key, accept: "application/json" } });
  if (res.status === 401 || res.status === 403) throw new SecError("ก.ล.ต. ปฏิเสธ Key — ตรวจ SEC_API_KEY ใน Supabase Secrets", 500);
  if (res.status === 204 || res.status === 404) return [];
  if (res.status === 421 || res.status === 429) throw new SecError("ก.ล.ต. จำกัดจำนวนครั้ง — ลองใหม่อีกสักครู่", 429);
  if (!res.ok) throw new SecError(`ก.ล.ต. ตอบ ${res.status}: ${(await res.text()).replace(/\s+/g, " ").slice(0, 120)}`);
  const body = await res.json().catch(() => null) as { items?: Row[] } | null;
  return Array.isArray(body?.items) ? body.items : [];
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

  // ---- 1) ตรวจผู้เรียก ------------------------------------------------------
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "ต้องเข้าสู่ระบบก่อน" }, 401);
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่" }, 401);
  const { data: me } = await admin.from("app_users").select("role,status").eq("auth_user_id", who.user.id).maybeSingle();
  if (!me || me.status !== "ACTIVE" || !["ADMIN", "EDITOR", "CONTRIBUTOR"].includes(me.role)) {
    return json({ error: "ไม่มีสิทธิ์ใช้งานส่วนนี้" }, 403);
  }

  // ---- 2) ข้อมูลที่ส่งมา ----------------------------------------------------
  const key = Deno.env.get("SEC_API_KEY");
  if (!key) return json({ error: "ยังไม่ได้ตั้ง SEC_API_KEY ใน Supabase → Edge Functions → Secrets" }, 500);
  const body = await req.json().catch(() => ({})) as { query?: string; date?: string };
  const query = String(body.query ?? "").trim();
  const date = String(body.date ?? "");
  if (!query) return json({ error: "ใส่ชื่อย่อกองทุน หรือชื่อชนิดหน่วยก่อน" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "วันที่ไม่ถูกต้อง" }, 400);

  try {
    // ---- 3) หากองทุน --------------------------------------------------------
    const want = up(query);
    let projId = "", cls = "", nameTh = "", nameEn = "";
    const direct = want.match(/^(M\d+_\d+)(?:\|(.+))?$/);
    if (direct) {
      projId = direct[1]; cls = direct[2] ?? "";
    } else {
      // project_info ค้นรหัส / ชื่อ / ชื่อย่อกองทุน · ชื่อชนิดหน่วยใช้ตัวกรอง fund_class_name
      let rows = await sec(key, "/general-info/profiles", { project_info: want });
      const live = (r: Row) => LIVE.includes(up(r.fund_status));
      let byClass = rows.filter(live).find((r) => up(r.fund_class_name) === want);
      if (!byClass && !rows.some((r) => live(r) && up(r.proj_abbr_name) === want)) {
        rows = await sec(key, "/general-info/profiles", { fund_class_name: want });
        byClass = rows.filter(live).find((r) => up(r.fund_class_name) === want);
      }
      const pick = byClass ?? rows.filter(live).find((r) => up(r.proj_abbr_name) === want);
      if (!pick) return json({ error: `ไม่พบ ${want} ใน ก.ล.ต. — ตรวจชื่อย่อ / ชื่อชนิดหน่วย หรือพิมพ์ NAV จาก Statement เอง` }, 404);
      projId = String(pick.proj_id); nameTh = String(pick.proj_name_th ?? ""); nameEn = String(pick.proj_name_en ?? "");
      if (byClass) cls = up(byClass.fund_class_name);
      else {
        const classes = [...new Set(rows.filter((r) => live(r) && r.proj_id === pick.proj_id).map((r) => up(r.fund_class_name)).filter(Boolean))];
        if (classes.length > 1) {
          return json({ error: `กองทุน ${want} มีหลายชนิดหน่วย — เลือกชนิดที่ถือ`, name_th: nameTh, classes }, 409);
        }
        cls = classes[0] ?? "";
      }
    }

    // ---- 4) NAV ของวันนั้น (หรือวันทำการก่อนหน้าภายใน 10 วัน) --------------------
    const range = { proj_id: projId, start_nav_date: addDays(date, -10), end_nav_date: date };
    let navRows = await sec(key, "/daily-info/nav", { ...range, fund_class_name: cls || undefined });
    if (!navRows.length && cls) navRows = await sec(key, "/daily-info/nav", range);   // บางกองส่งชื่อชนิดหน่วยว่าง
    const usable = navRows.filter((r) => num(r.last_val) !== null && r.nav_date && String(r.nav_date).slice(0, 10) <= date);
    const classesInNav = new Set(usable.map((r) => up(r.fund_class_name)).filter(Boolean));
    let mine = cls ? usable.filter((r) => up(r.fund_class_name) === cls) : usable;
    if (cls && !mine.length && classesInNav.size <= 1) mine = usable;   // กองทุนชนิดเดียวที่ส่งชื่อชนิดหน่วยว่าง
    if (!cls && classesInNav.size > 1) {
      return json({ error: "กองทุนนี้มีหลายชนิดหน่วย — เลือกชนิดที่ถือ", name_th: nameTh, classes: [...classesInNav] }, 409);
    }
    const best = mine.sort((a, b) => String(b.nav_date).localeCompare(String(a.nav_date)))[0];
    if (!best) return json({ error: `ไม่มี NAV ของ ${cls || want} ช่วง 10 วันก่อน ${date} — พิมพ์ NAV จาก Statement เอง`, name_th: nameTh }, 404);

    if (!nameTh) {                                                  // ใส่รหัสตรง ๆ → หาชื่อเต็มไว้แสดงให้ตรวจ
      const prof = await sec(key, "/general-info/profiles", { project_info: projId }).catch(() => [] as Row[]);
      const p = prof.find((r) => r.proj_id === projId);
      nameTh = String(p?.proj_name_th ?? ""); nameEn = String(p?.proj_name_en ?? "");
    }
    return json({
      ref: cls ? `${projId}|${cls}` : projId, proj_id: projId, class: cls || null, name_th: nameTh || null, name_en: nameEn || null,
      nav: num(best.last_val), nav_date: String(best.nav_date).slice(0, 10),
    });
  } catch (e) {
    const err = e instanceof SecError ? e : new SecError(`เชื่อมต่อ ก.ล.ต. ไม่ได้: ${(e as Error).message}`.slice(0, 160));
    return json({ error: err.message }, err.status);
  }
});
