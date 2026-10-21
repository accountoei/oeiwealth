// =====================================================================
// Price Job — ดึงราคาล่าสุดของรายการที่เปิด "ดึงราคาอัตโนมัติ" แล้วบันทึกผ่าน server_upsert_prices
//   หุ้นไทย / ต่างประเทศ: Yahoo Finance (ฟรี ไม่เป็นทางการ) · หุ้นไทยใส่ PTT → ใช้ PTT.BK ให้
//   กองทุนไทย: ก.ล.ต. SEC Open API v2 (ต้องมี SEC_API_KEY) · ใส่ชื่อย่อกองทุน หรือชื่อชนิดหน่วย → ระบบหา proj_id ให้ครั้งแรกแล้วจำไว้
//             profiles?project_info=… (ค้นหา) · daily-info/nav?proj_id=…&start_nav_date=…&end_nav_date=…&fund_class_name=…
//             แบ่งหน้าด้วย page_size / next_cursor · ผลลัพธ์อยู่ใน items
//   ทองคำ: ราคารับซื้อของสมาคมค้าทองคำ (classic.goldtraders.or.th · สำรอง thai-gold-api) — ทองคำแท่ง / ทองรูปพรรณ ตามชนิด
//          เทียบกับราคาโลก (GC=F × USD/THB → บาท ต่อ 1 บาททองคำ 96.5%) · ต่างเกิน 3% = ไม่บันทึก (อาจอ่านผิด)
//   ฐานข้อมูล: ราคาครั้งแรก / ต่างจากราคาครั้งก่อน (30 วัน) เกิน 20% → ยังไม่บันทึก เก็บเป็นราคารอยืนยัน (price_pending) · ไม่ทับราคาจาก Statement
//
// ENV: SUPABASE_URL, SUPABASE_SECRET_KEY · SEC_API_KEY (ไม่บังคับ — ไม่มี = ข้ามกองทุน) · DRY_RUN=true = แสดงอย่างเดียว
// ใช้ Node 20+ ไม่ต้องติดตั้งแพ็กเกจ
// =====================================================================

const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";
const SEC = "https://api.sec.or.th/v2/fund";
const GTA_URL = "https://classic.goldtraders.or.th/default.aspx";
const GTA_FALLBACK = "https://api.chnwt.dev/thai-gold-api/latest";
export const GOLD_MAX_GAP = 0.03;
export const GRAMS_PER_BAHT = 15.244;
export const GRAMS_PER_TROY_OZ = 31.1034768;

const num = (v) => { const n = Number(String(v ?? "").replace(/,/g, "").trim()); return Number.isFinite(n) && n > 0 ? n : null; };

/** สัญลักษณ์สำหรับ Yahoo: ใช้ price_ref ก่อน แล้วค่อย symbol · หุ้นสกุลบาทที่ไม่มีตลาดต่อท้าย → .BK */
export function yahooSymbol(h) {
  const s = String(h.price_ref || h.symbol || "").trim().toUpperCase();
  if (!s) return null;
  return h.currency === "THB" && !s.includes(".") ? `${s}.BK` : s;
}

/** Yahoo chart → { price, currency, date (YYYY-MM-DD ตามเวลาตลาด) } */
export function parseYahooChart(json) {
  const meta = json?.chart?.result?.[0]?.meta;
  const price = num(meta?.regularMarketPrice);
  if (!meta || price === null) return null;
  const tz = meta.exchangeTimezoneName || "Asia/Bangkok";
  const date = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toLocaleDateString("en-CA", { timeZone: tz }) : null;
  return { price, currency: meta.currency ?? null, date };
}

/** ราคาทอง บาท ต่อ 1 บาททองคำ 96.5% จากราคาโลก (USD/ozt) × USD/THB */
export function goldBahtPrice(usdPerOz, thbPerUsd) {
  return Math.round((usdPerOz * thbPerUsd * GRAMS_PER_BAHT / GRAMS_PER_TROY_OZ) * 0.965 * 100) / 100;
}

/** หน้าเว็บสมาคมค้าทองคำ → { bar_buy, bar_sell, orn_buy, orn_sell, as_of } (บาท ต่อ 1 บาททองคำ 96.5%) · อ่านไม่ได้ = null */
export function parseGoldtraders(html) {
  const pick = (id) => {
    const m = String(html ?? "").match(new RegExp(`id="DetailPlace_uc_goldprices1_${id}"[^>]*>([\\s\\S]*?)</span>`));
    return m ? m[1].replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim() : null;
  };
  const r = { bar_buy: num(pick("lblBLBuy")), bar_sell: num(pick("lblBLSell")), orn_buy: num(pick("lblOMBuy")), orn_sell: num(pick("lblOMSell")), as_of: pick("lblAsTime") ?? "" };
  return r.bar_buy && r.orn_buy ? r : null;
}

/** thai-gold-api (อ่านจากเว็บสมาคมฯ อีกทาง) → รูปแบบเดียวกับ parseGoldtraders */
export function parseThaiGoldApi(json) {
  const p = json?.response?.price;
  const r = { bar_buy: num(p?.gold_bar?.buy), bar_sell: num(p?.gold_bar?.sell), orn_buy: num(p?.gold?.buy), orn_sell: num(p?.gold?.sell),
    as_of: [json?.response?.update_date, json?.response?.update_time].filter(Boolean).join(" ") };
  return r.bar_buy && r.orn_buy ? r : null;
}

/** ราคาต่อบาททองคำของทองแต่ละรายการ: ราคาสมาคมฯ ตามชนิด · ไม่มี / ต่างจากราคาโลกเกิน 3% → price null + เหตุผล */
export function goldQuote(assoc, world, form) {
  if (!assoc) return { price: null, reason: "NO_ASSOC_PRICE: อ่านราคาสมาคมค้าทองคำไม่ได้" };
  if (world && Math.abs(assoc.bar_buy / world - 1) > GOLD_MAX_GAP)
    return { price: null, reason: `SOURCE_MISMATCH: สมาคมฯ ${assoc.bar_buy} ต่างจากราคาโลก ${world} เกิน 3%` };
  return { price: form === "ORNAMENT" ? assoc.orn_buy : assoc.bar_buy };
}

/** proj_id ของ ก.ล.ต. รูปแบบ M0123_2556 (ต่อท้าย |ชนิดหน่วย ได้) — อย่างอื่นถือเป็นชื่อย่อกองทุน */
export const isSecProjId = (v) => /^M\d+_\d+(\|.+)?$/i.test(String(v ?? "").trim());

/** หา array แรกในผลลัพธ์ (API ของ ก.ล.ต. ห่อข้อมูลไม่เหมือนกันทุก endpoint) */
export function firstArray(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") for (const v of Object.values(json)) { const a = firstArray(v); if (a) return a; }
  return null;
}

/** แถวข้อมูลจากผลลัพธ์ ก.ล.ต. v2 (ห่อแบบ { message, page_size, next_cursor, items }) */
export const secItems = (json) => (Array.isArray(json?.items) ? json.items : firstArray(json) ?? []);

/** NAV ล่าสุดจากผลลัพธ์ daily-info/nav · cls = ชื่อชนิดหน่วย (ถ้ากองทุนมีหลายชนิด)
 *  ไม่ระบุชนิดหน่วย แต่ผลลัพธ์มีหลายชนิด = null (ไม่เดาว่าเป็นชนิดไหน) */
export function parseSecNav(json, cls) {
  const rows = secItems(json).filter((r) => num(r?.last_val) !== null && r?.nav_date);
  const clsOf = (r) => String(r.fund_class_name ?? r.class_abbr_name ?? "").trim().toUpperCase();
  let pick = rows;
  if (cls) pick = rows.filter((r) => [r.class_abbr_name, r.fund_class_name].some((x) => String(x ?? "").trim().toUpperCase() === cls.toUpperCase()));
  else if (new Set(rows.map(clsOf).filter(Boolean)).size > 1) return null;
  const best = pick.sort((a, b) => (String(a.nav_date) < String(b.nav_date) ? 1 : -1))[0];
  return best ? { price: num(best.last_val), date: String(best.nav_date).slice(0, 10) } : null;
}

const STATUS_RANK = { REGISTERED: 0, IPO: 1, EXPIRED: 2 };

/** เลือกกองทุนจากผลลัพธ์ general-info/profiles (1 แถว = 1 ชนิดหน่วย)
 *  → { ref: "proj_id" | "proj_id|ชนิดหน่วย" } หรือ { error } (ไม่พบ / มีหลายชนิดหน่วย ต้องระบุ) */
export function pickSecFund(rows, abbr) {
  const want = String(abbr ?? "").trim().toUpperCase();
  const up = (v) => String(v ?? "").trim().toUpperCase();
  const live = rows.filter((r) => r?.proj_id && (STATUS_RANK[up(r.fund_status)] ?? 9) < 9)
    .sort((a, b) => (STATUS_RANK[up(a.fund_status)] ?? 9) - (STATUS_RANK[up(b.fund_status)] ?? 9));
  // 1) ตรงกับชื่อชนิดหน่วย (เช่น K-ABC-A) → ใช้ชนิดนั้น
  const byClass = live.find((r) => up(r.fund_class_name) === want);
  if (byClass) return { ref: `${byClass.proj_id}|${up(byClass.fund_class_name)}` };
  // 2) ตรงกับชื่อย่อกองทุน → ถ้ามีชนิดหน่วยเดียว ใช้ได้เลย · หลายชนิด → ให้ผู้ใช้ระบุ
  const byAbbr = live.filter((r) => up(r.proj_abbr_name) === want);
  if (!byAbbr.length) return { error: `ไม่พบชื่อย่อกองทุน ${want} ใน ก.ล.ต.` };
  const proj = byAbbr[0].proj_id;
  const classes = [...new Set(byAbbr.filter((r) => r.proj_id === proj).map((r) => up(r.fund_class_name)).filter(Boolean))];
  if (classes.length > 1) return { error: `กองทุน ${want} มีหลายชนิดหน่วย (${classes.join(", ")}) — ใส่ชื่อชนิดหน่วยที่ถือแทน` };
  return { ref: classes.length === 1 && classes[0] !== want ? `${proj}|${classes[0]}` : String(proj) };
}

const UA = { "User-Agent": "Mozilla/5.0 (FamilyWealthVault price job)", accept: "application/json" };

async function yahoo(symbol) {
  const res = await fetch(`${YAHOO}/${encodeURIComponent(symbol)}?range=5d&interval=1d`, { headers: UA });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${res.status}`);
  return parseYahooChart(await res.json());
}

/** URL ของ SEC Open API v2 · ใส่เฉพาะพารามิเตอร์ที่มีค่า · page_size 100 เสมอ (ตามเอกสาร API v2) */
export function secUrl(path, params = {}) {
  const q = new URLSearchParams({ page_size: "100" });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return `${SEC}${path}?${q}`;
}

async function sec(path, params, key) {
  const res = await fetch(secUrl(path, params), { headers: { "Ocp-Apim-Subscription-Key": key, accept: "application/json" } });
  if (res.status === 401 || res.status === 403) throw new Error("ก.ล.ต. ปฏิเสธ Key (401/403) — ตรวจ SEC_API_KEY");
  if (res.status === 404 || res.status === 204) return null;
  if (res.status === 421 || res.status === 429) throw new Error(`ก.ล.ต. จำกัดจำนวนครั้ง (${res.status}) — รอบหน้าจะลองใหม่`);
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 120);
    throw new Error(`SEC ${path} ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.json();
}

/** หา proj_id จากชื่อย่อกองทุน / ชื่อชนิดหน่วย ด้วยตัวกรอง project_info ของ API v2 (ไม่ต้องไล่ทุกหน้า) */
async function findFund(abbr, key) {
  const want = String(abbr ?? "").trim();
  if (!want) return { error: "ยังไม่ได้ใส่ชื่อย่อกองทุน" };
  const rows = [];
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const json = await sec("/general-info/profiles", { project_info: want, next_cursor: cursor }, key);
    const items = secItems(json);
    rows.push(...items);
    cursor = json?.next_cursor ?? "";
    if (!cursor || !items.length) break;
  }
  let hit = pickSecFund(rows, want);
  if (hit.ref) return hit;
  // project_info ค้นเฉพาะรหัส / ชื่อ / ชื่อย่อกองทุน ไม่ค้นชื่อชนิดหน่วย (เช่น SCBXXXA, K-ABC-A)
  // → ลองตัวกรอง fund_class_name (ชื่อชนิดหน่วยตรงตัว) แล้วค่อยลองชื่อกองทุนหลัก (ตัดส่วนท้ายหลัง - ตัวสุดท้าย)
  const alts = [{ fund_class_name: want }];
  if (want.includes("-")) alts.push({ project_info: want.slice(0, want.lastIndexOf("-")) });
  for (const params of alts) {
    const alt = pickSecFund(secItems(await sec("/general-info/profiles", params, key)), want);
    if (alt.ref) return alt;
  }
  return hit;
}

function addDays(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

async function rpc(url, key, fn, body) {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${fn} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY, SEC_API_KEY } = process.env;
  for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SECRET_KEY })) if (!v) throw new Error(`ยังไม่ได้ตั้งค่า ${k}`);
  const dry = /^(1|true|yes)$/i.test(process.env.DRY_RUN ?? "");
  const t = await rpc(SUPABASE_URL, SUPABASE_SECRET_KEY, "server_price_targets", {});
  const today = t.today;
  const out = [];
  const miss = (h, reason) => out.push({ kind: "HOLDING", id: h.id, date: today, price: null, reason, source_reference: "" });

  for (const h of t.holdings ?? []) {
    try {
      if (h.holding_type === "FUND") {
        if (!SEC_API_KEY) { miss(h, "ไม่มี SEC_API_KEY"); continue; }
        let ref = isSecProjId(h.price_ref) ? h.price_ref : null;
        if (!ref) {
          const f = await findFund(h.price_ref || h.symbol || h.name, SEC_API_KEY);
          if (!f.ref) { miss(h, f.error); continue; }
          ref = f.ref;
          if (dry) console.log(`  ก.ล.ต.: ${h.price_ref || h.symbol || h.name} → ${ref}`);
        }
        const [proj, cls] = ref.split("|");
        const navJson = await sec("/daily-info/nav", { proj_id: proj, start_nav_date: addDays(today, -10), end_nav_date: today, fund_class_name: cls }, SEC_API_KEY);
        let nav = parseSecNav(navJson, cls);
        // บางกองทุนส่ง fund_class_name เป็นค่าว่าง → ถ้ากรองตามชนิดหน่วยแล้วไม่มีแถวเลย ลองอ่านแบบไม่กรอง (ใช้ได้เฉพาะเมื่อมีชนิดเดียว)
        if (!nav && cls && !secItems(navJson).length) nav = parseSecNav(await sec("/daily-info/nav", { proj_id: proj, start_nav_date: addDays(today, -10), end_nav_date: today }, SEC_API_KEY));
        if (!nav) { miss(h, secItems(navJson).length && !cls ? "กองทุนมีหลายชนิดหน่วย — ใส่ชื่อชนิดหน่วยที่ถือ" : "ยังไม่มี NAV 10 วันล่าสุด"); continue; }
        out.push({ kind: "HOLDING", id: h.id, date: nav.date, price: nav.price, price_ref: ref, source_reference: `SEC NAV ${proj}${cls ? ` ${cls}` : ""}` });
      } else {
        const sym = yahooSymbol(h);
        if (!sym) { miss(h, "ยังไม่ได้ใส่สัญลักษณ์หุ้น"); continue; }
        const q = await yahoo(sym);
        if (!q) { miss(h, `ไม่พบ ${sym}`); continue; }
        if (q.currency !== h.currency) { miss(h, `สกุล ${q.currency} ไม่ตรงกับ ${h.currency}`); continue; }
        out.push({ kind: "HOLDING", id: h.id, date: q.date && q.date <= today ? q.date : today, price: q.price, source_reference: `Yahoo ${sym}` });
      }
    } catch (e) { miss(h, e.message.slice(0, 100)); }
  }

  if ((t.gold ?? []).length) {
    let world = null, worldNote = "";
    try {
      const [g, fx] = await Promise.all([yahoo("GC=F"), yahoo("THB=X")]);
      if (g && fx) { world = goldBahtPrice(g.price, fx.price); worldNote = `โลก ${g.price} USD/ozt × ${fx.price} ≈ ${world}`; }
    } catch (e) { console.log(`::warning::ราคาทองโลก: ${e.message}`); }
    let assoc = null, from = "";
    try {
      const res = await fetch(GTA_URL, { headers: { "User-Agent": UA["User-Agent"], accept: "text/html" } });
      if (res.ok) { assoc = parseGoldtraders(await res.text()); from = "สมาคมค้าทองคำ"; }
      else console.log(`::warning::เว็บสมาคมค้าทองคำ ${res.status}`);
    } catch (e) { console.log(`::warning::เว็บสมาคมค้าทองคำ: ${e.message}`); }
    if (!assoc) {
      try {
        const res = await fetch(GTA_FALLBACK, { headers: UA });
        if (res.ok) { assoc = parseThaiGoldApi(await res.json()); from = "สมาคมค้าทองคำ (ผ่าน thai-gold-api)"; }
      } catch (e) { console.log(`::warning::thai-gold-api: ${e.message}`); }
    }
    console.log(`ทองคำ: ${assoc ? `${from} ${assoc.as_of} · แท่ง รับซื้อ ${assoc.bar_buy} / ขาย ${assoc.bar_sell} · รูปพรรณ รับซื้อ ${assoc.orn_buy} / ขาย ${assoc.orn_sell}` : "อ่านราคาสมาคมฯ ไม่ได้"} · ${worldNote || "ไม่มีราคาโลก"}`);
    for (const a of t.gold) {
      const q = goldQuote(assoc, world, a.gold_form);
      out.push({ kind: "GOLD", asset_id: a.asset_id, date: today, price_per_baht_965: q.price, world_per_baht_965: world, reason: q.reason,
        source_reference: q.price ? `${from} ${assoc.as_of} · ${a.gold_form === "ORNAMENT" ? "ทองรูปพรรณ" : "ทองคำแท่ง"} รับซื้อ ${q.price}/บาททองคำ${worldNote ? ` · ${worldNote}` : ""}` : "" });
    }
  }

  out.forEach((x) => console.log(`  ${x.date} ${x.kind} ${x.id ?? x.asset_id} ${x.price ?? x.price_per_baht_965 ?? "-"} ${x.reason ?? x.source_reference}`));
  if (dry) { console.log(`DRY RUN: ${out.length} รายการ ไม่ได้บันทึก`); return; }
  if (!out.length) { console.log("ไม่มีรายการที่เปิดดึงราคาอัตโนมัติ"); return; }
  const n = await rpc(SUPABASE_URL, SUPABASE_SECRET_KEY, "server_upsert_prices", { p_prices: out, p_job_type: "PRICE_FETCH" });
  console.log(`Done: บันทึก ${n} รายการ · รายการที่ข้ามดูได้ที่ Settings → System → ประวัติงานอัตโนมัติ`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
}
