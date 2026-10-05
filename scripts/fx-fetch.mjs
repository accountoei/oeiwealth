// =====================================================================
// FX Job — ดึงอัตราแลกเปลี่ยนเฉลี่ยรายวัน (THB / สกุลต่างประเทศ) จาก ธปท.
// แล้วบันทึกลง Supabase ผ่าน server_upsert_fx_rates (Core Schema Section 16)
//
// ENV: BOT_API_TOKEN, SUPABASE_URL, SUPABASE_SECRET_KEY
//      START_DATE / END_DATE (YYYY-MM-DD, ไม่บังคับ — ค่าเริ่มต้น = ย้อนหลัง 10 วันถึงวันนี้)
// ใช้ Node 20+ (มี fetch ในตัว) ไม่ต้องติดตั้งแพ็กเกจ
// =====================================================================

const BOT_URL = "https://gateway.api.bot.or.th/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/";
const CHUNK_DAYS = 30;

export function todayBangkok() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}
export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const toNum = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return String(v).trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n;
};

// บางสกุล ธปท. ประกาศต่อ 100 หน่วย (เช่น "JAPAN : YEN (100 YEN)") → แปลงเป็นต่อ 1 หน่วย
export function unitOf(row) {
  const m = String(row.currency_name_eng ?? "").match(/\((\d[\d,]*)\s/);
  return m ? Number(m[1].replace(/,/g, "")) : 1;
}

/**
 * แปลงผลลัพธ์ของ ธปท. → [{rate_date, currency, rate_to_thb, source_reference}]
 * Rate ที่ใช้ = mid_rate (ถ้าไม่มี ใช้ค่าเฉลี่ยของ buying_transfer กับ selling)
 */
export function parseBotResponse(json) {
  const rows = json?.result?.data?.data_detail ?? [];
  const out = [];
  for (const r of rows) {
    const ccy = String(r.currency_id ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(ccy) || ccy === "THB" || !r.period) continue;
    let rate = toNum(r.mid_rate);
    let field = "mid_rate";
    if (rate === null) {
      const b = toNum(r.buying_transfer), s = toNum(r.selling);
      if (b !== null && s !== null) { rate = (b + s) / 2; field = "avg(buying_transfer,selling)"; }
    }
    if (rate === null) continue;
    const unit = unitOf(r);
    out.push({
      rate_date: String(r.period).slice(0, 10),
      currency: ccy,
      rate_to_thb: Number((rate / unit).toFixed(10)),
      source_reference: `BOT DAILY_AVG_EXG_RATE ${field}${unit !== 1 ? ` /${unit}` : ""}`,
    });
  }
  return out;
}

async function fetchBot(token, start, end) {
  const url = `${BOT_URL}?start_period=${start}&end_period=${end}`;
  for (const auth of [token, `Bearer ${token}`]) {
    const res = await fetch(url, { headers: { Authorization: auth, accept: "application/json" } });
    if (res.status === 401 || res.status === 403) continue;
    if (!res.ok) throw new Error(`BOT API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error("BOT API ปฏิเสธ Token (401/403) — ตรวจ BOT_API_TOKEN และว่าได้ Subscribe Exchange Rates แล้ว");
}

async function upsert(supabaseUrl, key, rates, jobType) {
  const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/server_upsert_fx_rates`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_rates: rates, p_job_type: jobType }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  return text;
}

async function main() {
  const { BOT_API_TOKEN, SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  for (const [k, v] of Object.entries({ BOT_API_TOKEN, SUPABASE_URL, SUPABASE_SECRET_KEY })) {
    if (!v) throw new Error(`ยังไม่ได้ตั้งค่า ${k}`);
  }
  const end = process.env.END_DATE || todayBangkok();
  const start = process.env.START_DATE || addDays(end, -10);
  const jobType = process.env.START_DATE ? "FX_BACKFILL" : "FX_FETCH";
  if (start > end) throw new Error(`START_DATE (${start}) ต้องไม่เกิน END_DATE (${end})`);

  let total = 0;
  for (let s = start; s <= end; s = addDays(s, CHUNK_DAYS)) {
    const e = addDays(s, CHUNK_DAYS - 1) < end ? addDays(s, CHUNK_DAYS - 1) : end;
    const rates = parseBotResponse(await fetchBot(BOT_API_TOKEN, s, e));
    console.log(`${s} → ${e}: ${rates.length} rates (${[...new Set(rates.map((r) => r.currency))].length} currencies)`);
    if (rates.length) {
      await upsert(SUPABASE_URL, SUPABASE_SECRET_KEY, rates, jobType);
      total += rates.length;
    }
  }
  console.log(`Done: ${total} rates upserted (${start} → ${end})`);
  if (total === 0) console.log("::warning::ไม่มี Rate ในช่วงนี้ (อาจเป็นวันหยุดทั้งหมด หรือ ธปท. ยังไม่ประกาศ)");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
}
