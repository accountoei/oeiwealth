// =====================================================================
// FX Job — ดึงอัตราแลกเปลี่ยน (บาทต่อ 1 หน่วยสกุลต่างประเทศ) แล้วบันทึกลง Supabase ผ่าน server_upsert_fx_rates
//   แหล่งตามที่ ADMIN เลือก (Settings → System): ธปท. (อัตราเฉลี่ยรายวัน) หรือ ธนาคารกรุงเทพ (TT / ขาย)
//   อ่านค่าที่เลือกจาก server_fx_settings · ไม่ดึงวันที่ก่อน "วันที่เปลี่ยนแหล่ง" ในรอบประจำวัน
//
// ENV: SUPABASE_URL, SUPABASE_SECRET_KEY + BOT_API_TOKEN (ธปท.) หรือ BBL_API_KEY (ธนาคารกรุงเทพ)
//      START_DATE / END_DATE (YYYY-MM-DD, ไม่บังคับ — ค่าเริ่มต้น = ย้อนหลัง 10 วันถึงวันนี้)
//      DRY_RUN=true → แสดงอัตราที่อ่านได้ ไม่บันทึก (ใช้ตรวจครั้งแรกหลังตั้ง Key)
// ใช้ Node 20+ (มี fetch ในตัว) ไม่ต้องติดตั้งแพ็กเกจ
// =====================================================================

const BOT_URL = "https://gateway.api.bot.or.th/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/";
const BBL_URL = "https://bbl-sea-apim-p.azure-api.net/api/ExchangeRateService/Getfxrates";
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

/**
 * ธนาคารกรุงเทพ: แปลงผลลัพธ์ Getfxrates → [{rate_date, currency, rate_to_thb, source_reference}]
 *   rateKind: MID = (ซื้อ TT + ขาย) ÷ 2 · BUYING_TT · SELLING
 *   รหัสสกุล = ตัวอักษร 3 ตัวแรกที่เจอใน Family / ID / Description · หลายแถวต่อสกุล (ธนบัตรหลายราคา) ใช้แถวแรกที่มีตัวเลขครบ
 *   หน่วย: ถ้าคำอธิบายระบุต่อ 100 หน่วย (เช่น "JPY 100") หาร 100 · อัตราที่ต่างจากอัตราก่อนหน้าเกิน 5% ฐานข้อมูลไม่รับอยู่แล้ว
 */
export function parseBblResponse(rows, rateDate, rateKind = "MID") {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const text = [r.Family, r.ID, r.Description, r.FamilyLong].map((x) => String(x ?? "")).join(" ");
    const ccy = (text.match(/\b([A-Z]{3})\b/) ?? [])[1];
    if (!ccy || ccy === "THB" || out.has(ccy)) continue;
    const buy = toNum(r.TT) ?? toNum(r.Bill_DD_TT) ?? toNum(r.BuyingRates);
    const sell = toNum(r.SellingRates);
    const rate = rateKind === "BUYING_TT" ? buy : rateKind === "SELLING" ? sell : buy !== null && sell !== null ? (buy + sell) / 2 : null;
    if (rate === null) continue;
    // ต่อ 100 หน่วย: "JPY 100" / "(100 YEN)" / "per 100" — ไม่ใช่ช่วงธนบัตร เช่น "USD 50-100"
    const per100 = [r.Description, r.FamilyLong].some((x) => /^\s*[A-Z]{3}\s*100\s*$|\(100\b|\bper 100\b/i.test(String(x ?? "")));
    const unit = per100 ? 100 : 1;
    out.set(ccy, {
      rate_date: rateDate,
      currency: ccy,
      rate_to_thb: Number((rate / unit).toFixed(10)),
      source_reference: `BBL Getfxrates ${rateKind}${unit !== 1 ? " /100" : ""}${r.Update ? ` รอบ ${r.Update}` : ""}`,
    });
  }
  return [...out.values()];
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

/** อัตราของวันนั้น: ลองรอบล่าสุดก่อน (3 → 1) · วันหยุด / ยังไม่ประกาศ = [] */
async function fetchBbl(key, iso) {
  const [y, m, d] = iso.split("-");
  for (const round of [3, 2, 1]) {
    const res = await fetch(`${BBL_URL}/${d}/${m}/${y}/${round}/en`, { headers: { "Ocp-Apim-Subscription-Key": key, accept: "application/json" } });
    if (res.status === 401 || res.status === 403) throw new Error("ธนาคารกรุงเทพปฏิเสธ Key (401/403) — ตรวจ BBL_API_KEY และว่าได้ Subscribe Exchange Rate Service แล้ว");
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`BBL API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json().catch(() => null);
    if (Array.isArray(json) && json.length) return json;
  }
  return [];
}

async function rpc(supabaseUrl, key, fn, body) {
  const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${fn} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SECRET_KEY })) {
    if (!v) throw new Error(`ยังไม่ได้ตั้งค่า ${k}`);
  }
  const dry = /^(1|true|yes)$/i.test(process.env.DRY_RUN ?? "");
  const settings = (await rpc(SUPABASE_URL, SUPABASE_SECRET_KEY, "server_fx_settings", {})) ?? {};
  const source = settings.source === "BBL" ? "BBL" : "BOT";
  const end = process.env.END_DATE || todayBangkok();
  let start = process.env.START_DATE || addDays(end, -10);
  // รอบประจำวัน: ไม่ย้อนไปก่อนวันที่เปลี่ยนแหล่ง (อัตราเดิมไม่เปลี่ยน)
  if (!process.env.START_DATE && settings.since && start < settings.since) start = settings.since;
  const jobType = process.env.START_DATE ? "FX_BACKFILL" : "FX_FETCH";
  if (start > end) { console.log(`ไม่มีวันที่ต้องดึง (${start} > ${end})`); return; }
  console.log(`แหล่ง: ${source === "BBL" ? `ธนาคารกรุงเทพ (${settings.bbl_rate ?? "MID"})` : "ธปท."}${settings.since ? ` · ตั้งแต่ ${settings.since}` : ""} · ${start} → ${end}${dry ? " · DRY RUN" : ""}`);

  let total = 0;
  const save = async (rates, label) => {
    console.log(`${label}: ${rates.length} rates (${[...new Set(rates.map((r) => r.currency))].join(", ") || "-"})`);
    if (dry) { rates.forEach((r) => console.log(`  ${r.rate_date} ${r.currency} ${r.rate_to_thb} · ${r.source_reference}`)); return; }
    if (rates.length) {
      await rpc(SUPABASE_URL, SUPABASE_SECRET_KEY, "server_upsert_fx_rates", { p_rates: rates, p_job_type: jobType, p_source: source === "BBL" ? "BBL_API" : "BOT_API" });
      total += rates.length;
    }
  };

  if (source === "BBL") {
    if (!process.env.BBL_API_KEY) throw new Error("ยังไม่ได้ตั้งค่า BBL_API_KEY (GitHub → Settings → Secrets) — หรือเปลี่ยนแหล่งกลับเป็น ธปท. ที่ Settings → System");
    for (let d = start; d <= end; d = addDays(d, 1)) {
      await save(parseBblResponse(await fetchBbl(process.env.BBL_API_KEY, d), d, settings.bbl_rate ?? "MID"), d);
    }
  } else {
    if (!process.env.BOT_API_TOKEN) throw new Error("ยังไม่ได้ตั้งค่า BOT_API_TOKEN");
    for (let s = start; s <= end; s = addDays(s, CHUNK_DAYS)) {
      const e = addDays(s, CHUNK_DAYS - 1) < end ? addDays(s, CHUNK_DAYS - 1) : end;
      await save(parseBotResponse(await fetchBot(process.env.BOT_API_TOKEN, s, e)), `${s} → ${e}`);
    }
  }
  console.log(dry ? "DRY RUN: ไม่ได้บันทึก" : `Done: ${total} rates sent (${start} → ${end}) · อัตราที่ผิดปกติ (ต่างเกิน 5%) ดูได้ที่ Settings → System → ประวัติ Job`);
  if (!dry && total === 0) console.log("::warning::ไม่มี Rate ในช่วงนี้ (อาจเป็นวันหยุดทั้งหมด หรือยังไม่ประกาศ)");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
}
