/** จำนวนเงินแบบการเงิน: คอมมาคั่นหลักพัน + ทศนิยม 2 ตำแหน่งเสมอ (ราคาต่อหน่วยส่ง digits = 4 ได้) */
export function money(value: number | string | null | undefined, currency?: string, digits = 2): string {
  if (value === null || value === undefined || value === "") return "-";
  const n = typeof value === "string" ? Number(String(value).replace(/,/g, "")) : value;
  if (Number.isNaN(n)) return "-";
  const d = Math.max(digits, 2);
  const s = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: d });
  return currency ? `${s} ${currency}` : s;
}

export function thDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
}

/** วันที่แบบเต็ม เช่น "1 ตุลาคม 2569" (ใช้ในเอกสาร / สัญญา) */
export function thDateLong(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" });
}

const BAHT_DIGIT = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const BAHT_POS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];
/** ตัวเลข 0–999,999 เป็นคำอ่าน (เอ็ด / ยี่สิบ ตามหลักภาษาไทย) */
function bahtWords6(n: number, higher = false): string {
  const ds = String(n).split("").map(Number);
  return ds.map((d, i) => {
    const pos = ds.length - 1 - i;
    if (d === 0) return "";
    if (pos === 1 && d === 1) return "สิบ";
    if (pos === 1 && d === 2) return "ยี่สิบ";
    if (pos === 0 && d === 1 && (ds.length > 1 || higher)) return "เอ็ด";
    return BAHT_DIGIT[d] + BAHT_POS[pos];
  }).join("");
}
function bahtWords(n: number): string {
  if (n >= 1_000_000) return bahtWords(Math.floor(n / 1_000_000)) + "ล้าน" + bahtWords6(n % 1_000_000, true);
  return bahtWords6(n);
}
/** จำนวนเงินเป็นตัวอักษร เช่น 1,250,000.50 → "หนึ่งล้านสองแสนห้าหมื่นบาทห้าสิบสตางค์" */
export function bahtText(value: number): string {
  const v = Math.round(Math.abs(value) * 100);
  const baht = Math.floor(v / 100), satang = v % 100;
  if (baht === 0 && satang === 0) return "ศูนย์บาทถ้วน";
  return (baht ? `${bahtWords(baht)}บาท` : "") + (satang ? `${bahtWords(satang)}สตางค์` : "ถ้วน");
}

/** วันที่วันนี้ตามเวลาไทย รูปแบบ YYYY-MM-DD */
export function todayBangkok(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** แปลง Error จากฐานข้อมูลเป็นข้อความที่อ่านเข้าใจ */
export function friendlyError(message: string): string {
  if (/row-level security|permission denied/i.test(message)) return "คุณไม่มีสิทธิ์ทำรายการนี้";
  if (/duplicate key/i.test(message)) return "ข้อมูลนี้มีอยู่แล้ว";
  if (/pu_schedule_pair/.test(message)) return "ใส่ยอดประมาณกับความถี่ให้ครบคู่กัน (หรือเว้นว่างทั้งคู่)";
  if (/exp_cost_period_pair/.test(message)) return "ต้องระบุงวดของค่าใช้จ่ายประจำ";
  if (/persons_death_date_status/.test(message)) return "วันที่เสียชีวิตใส่ได้เฉพาะสมาชิกที่เป็น Archived";
  if (/persons_national_id_format/.test(message)) return "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก";
  if (/persons_photo_format/.test(message)) return "รูปโปรไฟล์ต้องเป็นไฟล์รูปภาพ (JPG / PNG / WEBP) และไม่ใหญ่เกินไป";
  if (/families_photo_format/.test(message)) return "รูปครอบครัวต้องเป็นไฟล์รูปภาพ (JPG / PNG / WEBP) และไม่ใหญ่เกินไป";
  const m = message.match(/^[A-Z_]+: ([\s\S]*)$/);
  return m ? m[1] : message;
}

/** ที่มาของอัตราแลกเปลี่ยน (fx_rates.source) */
export const FX_SOURCE_LABEL: Record<string, string> = { BOT_API: "ธปท.", BBL_API: "ธนาคารกรุงเทพ", ADMIN_OVERRIDE: "ADMIN Override" };
export const FX_BBL_RATE_LABEL: Record<string, string> = { MID: "อัตรากลาง (ซื้อ TT + ขาย) ÷ 2", BUYING_TT: "อัตราซื้อ TT", SELLING: "อัตราขาย" };

export const CURRENCIES = ["THB", "USD", "EUR", "GBP", "JPY", "CNY", "HKD", "SGD", "AUD", "CHF"];

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  SAVING: "ออมทรัพย์", CURRENT: "กระแสรายวัน", FIXED: "ฝากประจำ", FOREIGN_CURRENCY: "เงินฝากเงินตราต่างประเทศ", OTHER: "อื่น ๆ",
};

export const LIABILITY_TYPE_LABEL: Record<string, string> = {
  MORTGAGE: "สินเชื่อบ้าน", CAR_LOAN: "สินเชื่อรถยนต์", PERSONAL_LOAN: "สินเชื่อส่วนบุคคล",
  CREDIT_LINE: "วงเงินสินเชื่อ (O/D ฯลฯ)", OTHER: "อื่น ๆ",
};

/** อ่าน owner_<id> จาก FormData → [{person_id, percent}] */
/** เจ้าของจากฟอร์ม: owner_<id> = % · shares_<id> = จำนวนหุ้น (ธุรกิจ) */
export function ownersFromForm(form: FormData): { person_id: string; percent?: number; shares?: number; cost_per_share?: number }[] {
  const out: { person_id: string; percent?: number; shares?: number; cost_per_share?: number }[] = [];
  for (const [k, v] of form.entries()) {
    const n = Number(String(v).replace(/,/g, ""));
    if (k.startsWith("owner_") && n > 0) out.push({ person_id: k.slice(6), percent: n });
    if (k.startsWith("shares_") && n > 0) {
      const c = String(form.get(`cost_${k.slice(7)}`) ?? "").replace(/,/g, "").trim();
      out.push({ person_id: k.slice(7), shares: n, ...(c !== "" && !Number.isNaN(Number(c)) ? { cost_per_share: Number(c) } : {}) });
    }
  }
  return out;
}

export const numOrNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/,/g, "").trim();
  return s === "" ? null : Number(s);
};
export const strOrNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
/** ตัวเลขในช่องกรอก (ฝั่งหน้าจอ ใช้คิดยอดรวมระหว่างพิมพ์) → ตัดจุลภาค · ว่าง / ไม่ใช่ตัวเลข = 0 */
export const numOrZero = (v: FormDataEntryValue | string | null | undefined) => Number(String(v ?? "").replace(/,/g, "")) || 0;
/** ผลของ server action ที่ฟอร์มแสดง (useActionState) · แต่ละหน้าเพิ่มช่องของตัวเองได้ */
export type FormState = { error?: string; ok?: string };

export const PROPERTY_TYPE_LABEL: Record<string, string> = {
  HOUSE: "บ้าน", CONDO: "คอนโด / ห้องชุด", LAND: "ที่ดิน", OTHER: "อื่น ๆ",
};
export const USAGE_LABEL: Record<string, string> = {
  OWNER_OCCUPIED: "อยู่อาศัยเอง", PERSONAL_USE: "ใช้ส่วนตัว", RENTAL: "ปล่อยเช่า", VACANT: "ว่าง",
  BUSINESS_USE: "ใช้ในกิจการ", OTHER: "อื่น ๆ",
};
/** ค่าน้ำไฟของสัญญาเช่า */
export const UTILITIES_BILLING_LABEL: Record<string, string> = {
  TENANT_PAYS: "ผู้เช่าจ่ายเอง", INCLUDED: "รวมในค่าเช่า", REBILL: "เราจ่ายแล้วเรียกเก็บ",
};
export const REBILL_SUBTYPE = "ค่าน้ำไฟเรียกเก็บจากผู้เช่า";
/** ราคาตลาด Property (อ้างอิง · ไม่นับเข้า Net Worth · ตกลง 28 ต.ค. 2026) */
export const MARKET_METHOD_LABEL: Record<string, string> = {
  OWNER_ESTIMATE: "เจ้าของประเมินเอง", BROKER: "นายหน้าประเมิน", APPRAISER: "ผู้ประเมินอิสระ / ธนาคาร",
  COMPARABLE_SALES: "เทียบราคาซื้อขายแถวนั้น", OTHER: "อื่น ๆ",
};
export const MARKET_PRICE_TYPE_LABEL: Record<string, string> = { LISTING: "ราคาประกาศขาย", TRANSACTION: "ราคาซื้อขายจริง", APPRAISAL: "ราคาจากผู้ประเมิน" };
export const MARKET_CONFIDENCE_LABEL: Record<string, string> = { HIGH: "มั่นใจสูง", MEDIUM: "มั่นใจปานกลาง", LOW: "มั่นใจต่ำ" };
export const MARKET_UNIT_LABEL: Record<string, string> = { SQ_WA: "ตร.ว.", SQ_M: "ตร.ม.", TOTAL: "ยอดรวม" };
/** หน่วยตั้งต้นตามประเภททรัพย์สิน: ที่ดิน → ต่อ ตร.ว. · คอนโด → ต่อ ตร.ม. · อื่น ๆ → ยอดรวม */
export function marketDefaultUnit(propertyType: string): string {
  return propertyType === "LAND" ? "SQ_WA" : propertyType === "CONDO" ? "SQ_M" : "TOTAL";
}
/** ราคาตลาดเก่ากว่า 12 เดือน → เตือน */
export function marketStale(date: string | null | undefined, today: string): boolean {
  return !!date && date < addDays(today, -365);
}
/** ส่วนต่าง เช่น "+3,200,000.00 (+64.0%)" */
export function diffText(diff: number, base: number): string {
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  const pct = base > 0 ? ` (${sign}${(Math.abs(diff) * 100 / base).toFixed(1)}%)` : "";
  return `${sign}${money(Math.abs(diff))}${pct}`;
}
/** ภาระผูกพันของ Property (แสดงผลอย่างเดียว ไม่กระทบมูลค่า) */
export const ENCUMBRANCE_LABEL: Record<string, string> = {
  NONE: "ไม่มี", SERVITUDE: "ภาระจำยอม", USUFRUCT: "สิทธิเก็บกิน", MORTGAGE: "จำนอง", LEASEHOLD: "สิทธิการเช่า", OTHER: "อื่น ๆ",
};
/** จำนวนเดือนเต็มระหว่าง 2 วัน (YYYY-MM-DD) */
export function monthsBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}
/** "2 ปี 4 เดือน" · ไม่ถึงเดือน = "ไม่ถึง 1 เดือน" */
export function durationText(months: number): string {
  const y = Math.floor(months / 12), m = months % 12;
  return [y && `${y} ปี`, m && `${m} เดือน`].filter(Boolean).join(" ") || "ไม่ถึง 1 เดือน";
}
/** ที่ดินว่างเปล่าไม่ทำประโยชน์ต่อเนื่อง 3 ปี → อัตราภาษีที่ดินเพิ่ม 0.3% ทุก 3 ปี (สูงสุด 3%) · เตือนล่วงหน้า 6 เดือน */
export function vacancyWarning(months: number): string | null {
  if (months >= 36) return `ว่างต่อเนื่องเกิน 3 ปี — ภาษีที่ดินที่ดินว่างเปล่าอาจเพิ่ม 0.3% ทุก 3 ปี (ตรวจกับ อปท.)`;
  if (months >= 30) return `อีก ${36 - months} เดือนจะว่างครบ 3 ปี — ภาษีที่ดินที่ดินว่างเปล่าอาจเพิ่ม (ตรวจกับ อปท.)`;
  return null;
}
export const FREQ_LABEL: Record<string, string> = {
  MONTHLY: "รายเดือน", QUARTERLY: "ราย 3 เดือน", YEARLY: "รายปี", OTHER: "อื่น ๆ",
};

/** ค่าใช้จ่ายประจำของอสังหาฯ (ตาราง property_utilities) */
export const UTIL_LABEL: Record<string, string> = {
  ELECTRICITY: "ไฟฟ้า", WATER: "ประปา", COMMON_FEE: "ค่าส่วนกลาง", LAND_TAX: "ภาษีที่ดิน", OTHER: "อื่น ๆ",
};
/** หมวดที่ใช้ตอนบันทึกเป็นค่าใช้จ่าย */
export const UTIL_EXPENSE_CATEGORY: Record<string, string> = {
  ELECTRICITY: "บ้าน / สาธารณูปโภค", WATER: "บ้าน / สาธารณูปโภค", COMMON_FEE: "บ้าน / สาธารณูปโภค", LAND_TAX: "บ้าน / สาธารณูปโภค", OTHER: "บ้าน / สาธารณูปโภค",
};
export const COST_STATUS: Record<string, { text: string; cls: string }> = {
  PAID: { text: "จ่ายแล้ว", cls: "text-emerald-700" }, PENDING: { text: "รอจ่าย", cls: "text-slate-600" },
  OVERDUE: { text: "เลยกำหนด", cls: "text-red-600" }, DISMISSED: { text: "เดือนนี้ไม่ได้จ่าย", cls: "text-slate-500" },
};
export const PERIODS_PER_YEAR: Record<string, number> = { MONTHLY: 12, QUARTERLY: 4, YEARLY: 1 };
export const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
/** "รายเดือน · ทุกวันที่ 5" / "รายปี · ทุก 30 เม.ย." */
export function scheduleText(frequency: string | null, dueDay: number | null, dueMonth: number | null): string {
  if (!frequency) return "";
  const f = FREQ_LABEL[frequency] ?? frequency;
  if (frequency === "YEARLY" && dueMonth) return `${f} · ทุก ${dueDay ?? "สิ้น"} ${TH_MONTHS[dueMonth - 1]}`;
  if (frequency === "QUARTERLY" && dueMonth) return `${f} · เริ่ม ${TH_MONTHS[dueMonth - 1]}${dueDay ? ` วันที่ ${dueDay}` : ""}`;
  return dueDay ? `${f} · ทุกวันที่ ${dueDay}` : f;
}

/** ตารางวารวม → "3-1-71 ไร่ (1,371 ตร.ว. · 5,484 ตร.ม.)" */
export function landText(sqwa: number | string | null | undefined): string {
  if (sqwa == null || sqwa === "") return "-";
  const w = Number(sqwa);
  const rai = Math.floor(w / 400), ngan = Math.floor((w % 400) / 100), wa = +(w % 100).toFixed(2);
  const f = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
  return `${rai}-${ngan}-${f(wa)} ไร่ (${f(w)} ตร.ว. · ${f(w * 4)} ตร.ม.)`;
}
export function landParts(sqwa: number | string | null | undefined) {
  if (sqwa == null || sqwa === "") return { rai: "", ngan: "", wa: "" };
  const w = Number(sqwa);
  return { rai: String(Math.floor(w / 400)), ngan: String(Math.floor((w % 400) / 100)), wa: String(+(w % 100).toFixed(2)) };
}
/** อ่าน land_rai / land_ngan / land_wa จากฟอร์ม → ตารางวารวม (หรือ null) */
export function sqwaFromForm(form: FormData): number | null {
  const g = (k: string) => String(form.get(k) ?? "").replace(/,/g, "").trim();
  const r = g("land_rai"), n = g("land_ngan"), w = g("land_wa");
  if (!r && !n && !w) return null;
  return (Number(r) || 0) * 400 + (Number(n) || 0) * 100 + (Number(w) || 0);
}

export const LEASE_STATUS: Record<string, { text: string; cls: string }> = {
  ACTIVE: { text: "มีผล", cls: "bg-emerald-50 text-emerald-700" },
  EXPIRING_SOON: { text: "ใกล้หมดสัญญา", cls: "bg-amber-50 text-amber-700" },
  UPCOMING: { text: "เริ่มในอนาคต", cls: "bg-sky-50 text-sky-700" },
  EXPIRED: { text: "หมดสัญญาแล้ว", cls: "bg-slate-100 text-slate-600" },
  TERMINATED: { text: "เลิกสัญญาแล้ว", cls: "bg-slate-100 text-slate-600" },
};

/** "2026-09-01" → "ก.ย. 2569" */
export function thMonth(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(`${value.slice(0, 10)}T12:00:00Z`)
    .toLocaleDateString("th-TH", { month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
}

export const HOLDING_TYPE_LABEL: Record<string, string> = {
  EQUITY: "หุ้น", FUND: "กองทุน", BOND: "หุ้นกู้ / พันธบัตร", FCN: "FCN", STRUCTURED_PRODUCT: "Structured Product",
  CASH: "เงินฝากในพอร์ต", OTHER: "อื่น ๆ",
};
export const PORTFOLIO_TYPE_LABEL: Record<string, string> = {
  BROKERAGE: "บัญชีหลักทรัพย์ / กองทุน", PRIVATE_FUND: "กองทุนส่วนบุคคล", OTHER: "อื่น ๆ",
};
export const ITX_LABEL: Record<string, string> = {
  OPENING_BALANCE: "ยอดตั้งต้น", DEPOSIT: "โอนเข้าพอร์ต", WITHDRAWAL: "ถอนออกจากพอร์ต", BUY: "ซื้อ", SELL: "ขาย",
  DIVIDEND: "ปันผล", INTEREST: "ดอกเบี้ย", COUPON: "Coupon", FEE: "ค่าธรรมเนียม", TAX: "ภาษี",
  MATURITY: "ครบกำหนด", REDEMPTION: "ไถ่ถอน / ขายคืน", FX_EXCHANGE: "แลกเงิน", ADJUSTMENT: "ปรับปรุง",
  CASH_TRANSFER: "โอนระหว่างบัญชีในพอร์ต", PAYMENT: "จ่ายออกจากพอร์ต",
};
/** จำนวนหน่วย (ไม่เกิน 4 ตำแหน่ง) */
export function qty(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("th-TH", { maximumFractionDigits: 4 });
}

export const INCOME_TYPE_LABEL: Record<string, string> = {
  SALARY: "เงินเดือน", BONUS: "โบนัส", INTEREST: "ดอกเบี้ย", DIVIDEND: "ปันผล", COUPON: "Coupon", RENT: "ค่าเช่า",
  LOAN_INTEREST: "ดอกเบี้ยเงินให้กู้", BUSINESS_DIVIDEND: "ปันผลกิจการ", INSURANCE_BENEFIT: "ผลประโยชน์ประกัน", OTHER: "รายได้อื่น",
};
export const MOVE_LABEL: Record<string, string> = {
  INCOME: "รายได้", EXPENSE: "ค่าใช้จ่าย", TRANSFER: "โอนระหว่างบัญชี", FX_EXCHANGE: "แลกเงิน", INVESTMENT_OUT: "โอนเข้าพอร์ต",
  INVESTMENT_IN: "รับจากพอร์ต", LOAN_DISBURSEMENT: "ให้กู้", LOAN_PRINCIPAL_RECEIPT: "รับชำระเงินกู้",
  ASSET_PURCHASE: "ซื้อทรัพย์สิน", ASSET_SALE: "ขายทรัพย์สิน", CARD_PAYMENT: "จ่ายบัตรเครดิต",
  LIABILITY_PAYMENT: "จ่ายหนี้", SECURITY_DEPOSIT_IN: "รับเงินประกัน", SECURITY_DEPOSIT_OUT: "คืนเงินประกัน",
  REIMBURSEMENT_IN: "เงินคืน (ไม่ใช่รายได้)", OTHER_IN: "เงินเข้าอื่น ๆ", OTHER_OUT: "เงินออกอื่น ๆ",
};
/** "2026-10" → ช่วงวันที่ของเดือน */
export function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const start = `${ym}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  return { start, end, prev, next };
}

/** รายการเดือนให้เลือก (ใหม่สุดก่อน): ตั้งแต่เดือน Go-live ถึงเดือนนี้ (+ เดือนข้างหน้า ahead เดือน) · คงเดือนที่เลือกอยู่ไว้เสมอ */
export function monthOptions(goLiveDate: string | null | undefined, today: string, ahead = 0, keep?: string) {
  const cur = today.slice(0, 7);
  let top = cur;
  for (let k = 0; k < ahead; k++) top = monthRange(top).next;
  const goYm = (goLiveDate || today).slice(0, 7);
  const out: { value: string; label: string }[] = [];
  for (let m = top; out.length < 120; m = monthRange(m).prev) {
    out.push({ value: m, label: thMonth(`${m}-01`) + (m === cur ? " (เดือนนี้)" : "") });
    if (m <= goYm) break;
  }
  if (keep && /^\d{4}-\d{2}$/.test(keep) && !out.some((x) => x.value === keep)) {
    out.push({ value: keep, label: thMonth(`${keep}-01`) });
    out.sort((a, b) => b.value.localeCompare(a.value));
  }
  return out;
}

/** ปุ่มคำสั่งในแถวตาราง (บันทึกรับ / บันทึกจ่าย) · สีเดียวกันทุกหน้า */
export const ROW_BTN = "rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50";

export const INS_TYPE: [string, string][] = [["LIFE", "ประกันชีวิต / สะสมทรัพย์"], ["HEALTH", "ประกันสุขภาพ"], ["ACCIDENT", "ประกันอุบัติเหตุ"], ["PROPERTY", "ประกันทรัพย์สิน"]];
export const INS_STATUS: [string, string][] = [["ACTIVE", "มีผล"], ["LAPSED", "ขาดอายุ"], ["SURRENDERED", "เวนคืนแล้ว"], ["MATURED", "ครบสัญญา"], ["CLAIMED", "เคลมจบแล้ว"], ["CANCELLED", "ยกเลิก"]];
export const CLAIM_STATUS: [string, string][] = [["DRAFT", "ร่าง"], ["SUBMITTED", "ยื่นแล้ว"], ["APPROVED", "อนุมัติ"], ["PARTIALLY_PAID", "จ่ายบางส่วน"], ["PAID", "จ่ายครบ"], ["REJECTED", "ปฏิเสธ"], ["CANCELLED", "ยกเลิก"]];

export const COUPON_FREQ_LABEL: Record<string, string> = {
  MONTHLY: "รายเดือน", QUARTERLY: "รายไตรมาส", SEMI_ANNUAL: "ทุก 6 เดือน", ANNUAL: "รายปี", AT_MATURITY: "ตอนครบกำหนด", OTHER: "อื่น ๆ",
};

export const DOC_MODULE_LABEL: Record<string, string> = {
  FAMILY: "ครอบครัว", FINANCIAL: "การเงิน", INVESTMENT: "การลงทุน", PROPERTY: "อสังหาริมทรัพย์", ALTERNATIVE: "สินทรัพย์อื่น",
  INSURANCE: "ประกัน", HEALTH: "สุขภาพ", CARD_MEMBERSHIP: "บัตรและสมาชิก", SYSTEM: "รายงานระบบ",
};
/** ประเภทเอกสารที่แนะนำ (พิมพ์ประเภทอื่นเองได้) */
export const DOC_TYPES: Record<string, string[]> = {
  FAMILY: ["บัตรประชาชน", "ทะเบียนบ้าน", "สูติบัตร", "ทะเบียนสมรส", "หนังสือเดินทาง", "พินัยกรรม", "หนังสือมอบอำนาจ", "อื่น ๆ"],
  FINANCIAL: ["สมุดบัญชี", "Statement ธนาคาร", "สัญญาเงินกู้", "สัญญากู้ยืม (ให้กู้)", "หนังสือรับรองบริษัท", "ใบหุ้น", "งบการเงิน", "อื่น ๆ"],
  INVESTMENT: ["Statement พอร์ต", "Term Sheet", "ใบยืนยันการซื้อขาย", "สัญญาเปิดบัญชี", "อื่น ๆ"],
  PROPERTY: ["โฉนด / หนังสือกรรมสิทธิ์", "สัญญาซื้อขาย", "สัญญาเช่า", "ใบประเมินราคา", "ใบเสร็จภาษีที่ดิน", "แบบบ้าน / ใบอนุญาตก่อสร้าง", "อื่น ๆ"],
  ALTERNATIVE: ["ใบเสร็จ / ใบกำกับภาษี", "ใบรับประกัน", "ใบรับรอง (Certificate)", "รูปถ่าย", "อื่น ๆ"],
  INSURANCE: ["กรมธรรม์", "ใบเสร็จเบี้ยประกัน", "เอกสารเคลม", "สลักหลังกรมธรรม์", "อื่น ๆ"],
  HEALTH: ["ผลตรวจสุขภาพ", "ใบรับรองแพทย์", "ประวัติวัคซีน", "อื่น ๆ"],
  CARD_MEMBERSHIP: ["บัตรสมาชิก", "สัญญาสมาชิก", "อื่น ๆ"],
  SYSTEM: ["รายงานรายเดือน", "อื่น ๆ"],
};
/** หมวดเอกสาร = หน้าที่แนบ (ตั้งอัตโนมัติจากรายการที่ผูก) · ประเภทเลือกจากรายการของหมวด + "อื่น ๆ" พิมพ์เอง */
export const DOC_CATEGORY_LABEL: Record<string, string> = {
  BANK: "บัญชีธนาคาร", LOAN: "เงินให้กู้", BUSINESS: "กิจการ", LIABILITY: "หนี้สิน", CARD: "บัตรเครดิต", INVESTMENT: "การลงทุน",
  PROPERTY: "อสังหาฯ", ALTERNATIVE: "สินทรัพย์อื่น", INSURANCE: "ประกัน", PERSON: "สมาชิก", DONATION: "การบริจาค", OTHER: "อื่น ๆ / ยังไม่ผูก",
};
export const DOC_TYPES_BY_CATEGORY: Record<string, string[]> = {
  BANK: ["Statement", "สมุดบัญชี", "เอกสารเปิด / ปิดบัญชี", "ใบฝากประจำ"],
  LOAN: ["สัญญากู้ยืม", "หลักฐานการโอนเงิน", "หลักประกัน", "หนังสือรับสภาพหนี้"],
  BUSINESS: ["หนังสือรับรองบริษัท", "ใบหุ้น / บัญชีผู้ถือหุ้น", "งบการเงิน", "รายงานประชุม / มติ"],
  LIABILITY: ["สัญญาเงินกู้", "ตารางผ่อน", "Statement หนี้", "หนังสือปลดหนี้"],
  CARD: ["Statement บัตร", "ใบสมัคร / เงื่อนไขบัตร"],
  INVESTMENT: ["Statement พอร์ต", "ใบยืนยันการซื้อขาย", "Term Sheet", "สัญญาเปิดบัญชี"],
  PROPERTY: ["โฉนด / หนังสือกรรมสิทธิ์", "สัญญาซื้อขาย", "สัญญาเช่า", "ใบประเมินราคา", "ใบเสร็จภาษีที่ดิน", "แบบบ้าน / ใบอนุญาตก่อสร้าง"],
  ALTERNATIVE: ["ใบเสร็จ / ใบกำกับภาษี", "ใบรับประกัน", "ใบรับรอง (Certificate)", "รูปถ่าย"],
  INSURANCE: ["กรมธรรม์", "ใบเสร็จเบี้ยประกัน", "เอกสารเคลม", "สลักหลังกรมธรรม์"],
  PERSON: ["บัตรประชาชน", "ทะเบียนบ้าน", "สูติบัตร", "ทะเบียนสมรส", "หนังสือเดินทาง", "พินัยกรรม", "หนังสือมอบอำนาจ"],
  DONATION: ["ใบอนุโมทนาบัตร / ใบรับบริจาค", "สลิปโอนเงิน", "รายการ e-Donation", "รูปถ่าย"],
  OTHER: [],
};
/** หมวดของเอกสารจากรายการที่ผูก (entity_type + ประเภทสินทรัพย์) · ไม่ผูก = ตามหมวดเดิม (module) */
export function docCategory(entityType: string | null | undefined, assetType?: string | null, assetGroup?: string | null, module?: string | null): string {
  if (entityType === "LIABILITY") return "LIABILITY";
  if (entityType === "CREDIT_CARD") return "CARD";
  if (entityType === "INSURANCE_POLICY") return "INSURANCE";
  if (entityType === "PERSON") return "PERSON";
  if (entityType === "DONATION") return "DONATION";
  if (entityType === "ASSET") {
    if (assetType === "BANK_ACCOUNT") return "BANK";
    if (assetType === "LOAN_RECEIVABLE") return "LOAN";
    if (assetType === "PRIVATE_BUSINESS") return "BUSINESS";
    if (assetType === "INSURANCE_CASH_VALUE") return "INSURANCE";
    if (assetGroup === "INVESTMENT") return "INVESTMENT";
    if (assetGroup === "PROPERTY") return "PROPERTY";
    if (assetGroup === "ALTERNATIVE") return "ALTERNATIVE";
  }
  return ({ FAMILY: "PERSON", INSURANCE: "INSURANCE", PROPERTY: "PROPERTY", ALTERNATIVE: "ALTERNATIVE", INVESTMENT: "INVESTMENT",
    CARD_MEMBERSHIP: "CARD", HEALTH: "PERSON" } as Record<string, string>)[module ?? ""] ?? "OTHER";
}
export const ENTITY_MODULE: Record<string, string> = {
  FINANCIAL: "FINANCIAL", INVESTMENT: "INVESTMENT", PROPERTY: "PROPERTY", ALTERNATIVE: "ALTERNATIVE",
  LIABILITY: "FINANCIAL", INSURANCE_POLICY: "INSURANCE", PERSON: "FAMILY", CREDIT_CARD: "CARD_MEMBERSHIP", DONATION: "FAMILY",
};

// ---------- การบริจาค (Family → Donations) ----------
export const DONEE_TYPE_LABEL: Record<string, string> = {
  TEMPLE: "วัด / ศาสนสถาน", SCHOOL: "สถานศึกษา", HOSPITAL: "โรงพยาบาล", FOUNDATION: "มูลนิธิ / สมาคม", GOVERNMENT: "หน่วยงานรัฐ", OTHER: "อื่น ๆ",
};
export const DONATION_TAX_STATUS_LABEL: Record<string, string> = { PENDING: "รอตรวจสอบ", ELIGIBLE: "ใช้สิทธิได้", NONE: "ไม่ใช้สิทธิ" };
export const DONATION_TAX_KIND_LABEL: Record<string, string> = {
  GENERAL: "ทั่วไป (1 เท่า)", DOUBLE: "การศึกษา / โรงพยาบาลรัฐ ฯลฯ (2 เท่า)", POLITICAL: "พรรคการเมือง",
};
export const DONATION_FORM_LABEL: Record<string, string> = { CASH: "เงิน", IN_KIND: "สิ่งของ" };
export function fileSize(n: number | null | undefined) {
  if (n == null) return "";
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
export function extFromMime(m: string | null | undefined) {
  const map: Record<string, string> = {
    "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
    "image/heic": ".heic", "image/heif": ".heif", "text/plain": ".txt", "text/csv": ".csv", "application/msword": ".doc",
    "application/vnd.ms-excel": ".xls", "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  };
  return map[m ?? ""] ?? "";
}

/** โทนน้ำเงินสำหรับกราฟ / แถบสัดส่วน (เข้ม → อ่อน) */
export const BLUES = ["#1442b8", "#1f5eff", "#3d78ff", "#5f92ff", "#86afff", "#a9c6ff", "#c7daff"];
export const blueAt = (i: number) => BLUES[Math.min(i, BLUES.length - 1)];

// ---------------------------------------------------------------- ประกัน: ความคุ้มครอง / ตารางเบี้ย / ผลประโยชน์ / ติดตาม
/** ความคุ้มครอง: [ชื่อ, หน่วย] · หน่วยใช้แสดงผล (ต่อปี / ต่อวัน / ต่อครั้ง) */
export const COVERAGE_LABEL: Record<string, [string, string]> = {
  LIFE: ["เสียชีวิต", ""], ACCIDENT_DEATH: ["เสียชีวิต / ทุพพลภาพ จากอุบัติเหตุ", ""], DISABILITY: ["ทุพพลภาพ", ""],
  CRITICAL_ILLNESS: ["โรคร้ายแรง", ""], IPD_ANNUAL: ["ค่ารักษาผู้ป่วยใน (IPD)", "ต่อปี"], IPD_PER_ADMIT: ["ค่ารักษาผู้ป่วยใน (IPD)", "ต่อครั้ง"],
  ROOM_PER_DAY: ["ค่าห้อง", "ต่อวัน"], OPD_PER_VISIT: ["ผู้ป่วยนอก (OPD)", "ต่อครั้ง"], OPD_ANNUAL: ["ผู้ป่วยนอก (OPD)", "ต่อปี"],
  HOSPITAL_CASH_PER_DAY: ["ค่าชดเชยรายวัน", "ต่อวัน"], OTHER: ["อื่น ๆ", ""],
};
/** ความคุ้มครองที่วงเงินเป็น "ต่อปี" → หักยอดเคลมในปีนั้นเพื่อดูวงเงินคงเหลือ */
export const COVERAGE_ANNUAL = ["IPD_ANNUAL", "OPD_ANNUAL"];
export const BENEFIT_TYPE_LABEL: Record<string, string> = {
  CASH_BACK: "เงินคืนระหว่างสัญญา", ANNUITY: "บำนาญ / รายงวด", MATURITY: "ครบสัญญา", OTHER: "อื่น ๆ",
};
export const INS_SCHED_STATUS: Record<string, { text: string; cls: string }> = {
  PAID: { text: "จ่ายแล้ว", cls: "bg-emerald-50 text-emerald-700" }, PARTIAL: { text: "บางส่วน", cls: "bg-amber-50 text-amber-700" },
  PENDING: { text: "รอ", cls: "bg-slate-100 text-slate-700" }, OVERDUE: { text: "เลยกำหนด", cls: "bg-red-50 text-red-700" },
  CLOSED: { text: "ไม่ต้องชำระ (ปิดกรมธรรม์)", cls: "bg-slate-100 text-slate-500" },
};
export const FOLLOWUP_ROLE: Record<string, string> = { INSURED: "ผู้เอาประกัน", PAYER: "ผู้จ่ายเบี้ย", BENEFICIARY: "ผู้รับผลประโยชน์" };
export const FOLLOWUP_STATUS: [string, string][] = [["OPEN", "ยังไม่เริ่ม"], ["IN_PROGRESS", "กำลังดำเนินการ"], ["DONE", "เสร็จแล้ว"], ["NOT_APPLICABLE", "ไม่ต้องทำ"]];

/** ความสัมพันธ์ของสมาชิกครอบครัว */
export const RELATIONSHIP_LABEL: Record<string, string> = {
  SELF: "หัวหน้าครอบครัว", SPOUSE: "คู่สมรส", CHILD: "บุตร", CHILD_IN_LAW: "ลูกเขย / ลูกสะใภ้",
  GRANDCHILD: "หลาน", PARENT: "บิดา / มารดา", GRANDPARENT: "ปู่ ย่า ตา ยาย", PARENT_IN_LAW: "พ่อตา แม่ยาย / พ่อแม่สามี",
  SIBLING: "พี่น้อง", RELATIVE: "ญาติอื่น ๆ", OTHER: "อื่น ๆ",
};
export const PERSON_STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", INACTIVE: "Inactive", DECEASED: "Archived" };

/** คำนำหน้าชื่อที่ใช้บ่อย (พิมพ์เองได้) */
export const TITLE_PREFIXES = ["นาย", "นาง", "นางสาว", "เด็กชาย", "เด็กหญิง", "Mr.", "Mrs.", "Ms."];

export const GENDER_LABEL: Record<string, string> = { M: "ชาย", F: "หญิง" };
export const EDUCATION_LEVEL_LABEL: Record<string, string> = {
  PRIMARY: "ประถมศึกษา", LOWER_SECONDARY: "มัธยมต้น", UPPER_SECONDARY: "มัธยมปลาย / ปวช.", DIPLOMA: "ปวส. / อนุปริญญา",
  BACHELOR: "ปริญญาตรี", MASTER: "ปริญญาโท", DOCTORATE: "ปริญญาเอก",
};
/** รุ่น (ใช้กรองรายชื่อสมาชิก) เทียบกับหัวหน้าครอบครัว */
export const RELATION_GEN: Record<string, "up" | "mid" | "down"> = {
  GRANDPARENT: "up", PARENT: "up", PARENT_IN_LAW: "up", SELF: "mid", SPOUSE: "mid", SIBLING: "mid",
  CHILD: "down", CHILD_IN_LAW: "down", GRANDCHILD: "down",
};
export const GEN_FILTER_LABEL: Record<string, string> = { up: "รุ่นพ่อแม่ขึ้นไป", mid: "รุ่นเดียวกับหัวหน้า", down: "รุ่นลูกหลาน", other: "ญาติอื่น ๆ" };

const PREFIX_GENDER: Record<string, "M" | "F"> = {
  "นาย": "M", "เด็กชาย": "M", "ด.ช.": "M", "mr.": "M", "mr": "M", "master": "M",
  "นาง": "F", "นางสาว": "F", "น.ส.": "F", "เด็กหญิง": "F", "ด.ญ.": "F", "mrs.": "F", "mrs": "F", "ms.": "F", "ms": "F", "miss": "F",
};
/** เพศจากคำนำหน้า (ตรงกับ private.gender_from_prefix ในฐานข้อมูล) */
export function genderFromPrefix(prefix: string | null | undefined): "M" | "F" | null {
  return PREFIX_GENDER[(prefix ?? "").trim().toLowerCase()] ?? null;
}

export type KinPerson = {
  id: string; relationship: string | null; gender?: string | null; title_prefix?: string | null; birth_date?: string | null;
  father_id: string | null; mother_id: string | null; spouse_id: string | null;
};

/** เพศที่ใช้แสดง: ที่บันทึกไว้ → จากคำนำหน้า → จากผัง (เป็นพ่อ / แม่ของใคร · ตรงข้ามกับคู่สมรส) */
export function genderOf(p: KinPerson, people: KinPerson[], viaSpouse = true): "M" | "F" | null {
  if (p.gender === "M" || p.gender === "F") return p.gender;
  const g = genderFromPrefix(p.title_prefix);
  if (g) return g;
  const father = people.some((c) => c.father_id === p.id), mother = people.some((c) => c.mother_id === p.id);
  if (father !== mother) return father ? "M" : "F";
  const spouse = viaSpouse ? people.find((x) => x.id === p.spouse_id || x.spouse_id === p.id) : undefined;
  const sg = spouse ? genderOf(spouse, people, false) : null;
  return sg === "M" ? "F" : sg === "F" ? "M" : null;
}

/** ชื่อเรียกตามเพศ เทียบกับหัวหน้าครอบครัว (บิดา / มารดา · บุตรชาย / บุตรสาว · ปู่ / ย่า / ตา / ยาย ฯลฯ) */
/** ลำดับพี่น้อง (คนที่ 1, 2, …) ในพ่อแม่เดียวกัน ใช้กับบุตร / หลาน · นับทุกเพศ · เรียงวันเกิด (ไม่มีวันเกิด → ต่อท้าย ตามลำดับในรายชื่อ) · ลูกคนเดียว / ไม่ได้ผูกพ่อแม่ → null */
export function childOrdinal(p: KinPerson, people: KinPerson[]): number | null {
  if (!p.father_id && !p.mother_id) return null;
  const sibs = people.filter((x) => x.relationship === p.relationship && x.father_id === p.father_id && x.mother_id === p.mother_id);
  if (sibs.length < 2) return null;
  const idx = new Map(sibs.map((x, i) => [x.id, i]));
  const key = (x: KinPerson) => x.birth_date ?? "9999";
  sibs.sort((a, b) => (key(a) !== key(b) ? (key(a) < key(b) ? -1 : 1) : idx.get(a.id)! - idx.get(b.id)!));
  const n = sibs.findIndex((x) => x.id === p.id);
  return n < 0 ? null : n + 1;
}

export function kinLabel(p: KinPerson, people: KinPerson[], headId: string | null | undefined, ordinal = true): string {
  const rel = p.relationship ?? "";
  const base = RELATIONSHIP_LABEL[rel] ?? "-";
  const g = genderOf(p, people);
  const head = headId ? people.find((x) => x.id === headId) : undefined;
  const pick = (m: string, f: string, both = base) => (g === "M" ? m : g === "F" ? f : both);
  switch (rel) {
    case "SPOUSE": return pick("สามี", "ภรรยา");
    case "PARENT": return pick("บิดา", "มารดา");
    case "CHILD": {
      const n = ordinal ? childOrdinal(p, people) : null;
      return pick("บุตรชาย", "บุตรสาว") + (n ? ` คนที่ ${n}` : "");
    }
    case "CHILD_IN_LAW": return pick("ลูกเขย", "ลูกสะใภ้");
    case "GRANDCHILD": {
      const n = ordinal ? childOrdinal(p, people) : null;
      return pick("หลานชาย", "หลานสาว") + (n ? ` คนที่ ${n}` : "");
    }
    case "GRANDPARENT": {
      const parentOf = (pid: string | null) => people.find((x) => x.id === pid);
      const isParentOf = (x: KinPerson | undefined) => !!x && (x.father_id === p.id || x.mother_id === p.id);
      const side = isParentOf(parentOf(head?.father_id ?? null)) ? "F" : isParentOf(parentOf(head?.mother_id ?? null)) ? "M" : null;
      if (side === "F") return pick("ปู่", "ย่า", "ปู่ / ย่า");
      if (side === "M") return pick("ตา", "ยาย", "ตา / ยาย");
      return pick("ปู่ / ตา", "ย่า / ยาย");
    }
    case "PARENT_IN_LAW": {
      const hg = head ? genderOf(head, people) : null;
      if (hg === "M") return pick("พ่อตา", "แม่ยาย", "พ่อตา / แม่ยาย");
      if (hg === "F") return pick("พ่อสามี", "แม่สามี", "พ่อ / แม่สามี");
      return pick("พ่อของคู่สมรส", "แม่ของคู่สมรส");
    }
    case "SIBLING": {
      const hb = head?.birth_date, pb = p.birth_date;
      if (hb && pb && hb !== pb) return pb < hb ? pick("พี่ชาย", "พี่สาว", "พี่") : pick("น้องชาย", "น้องสาว", "น้อง");
      return pick("พี่ชาย / น้องชาย", "พี่สาว / น้องสาว");
    }
    default: return base;
  }
}

/** อีกกี่วันถึงวันเกิดครั้งถัดไป (0 = วันนี้) · ว่าง → null · เกิด 29 ก.พ. ปีที่ไม่มี → 1 มี.ค. */
export function daysToBirthday(birth: string | null | undefined, today: string): number | null {
  if (!birth) return null;
  const [, bm, bd] = birth.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = today.slice(0, 10).split("-").map(Number);
  const t = Date.UTC(ty, tm - 1, td);
  let next = Date.UTC(ty, bm - 1, bd);
  if (next < t) next = Date.UTC(ty + 1, bm - 1, bd);
  return Math.round((next - t) / 86400000);
}

/** อายุ (ปีเต็ม) จากวันเกิด YYYY-MM-DD · วันเกิดในอนาคต / ว่าง → null */
export function ageFrom(birth: string | null | undefined, today: string): number | null {
  if (!birth || birth > today) return null;
  const [by, bm, bd] = birth.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = today.slice(0, 10).split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

// ---------------------------------------------------------------- ธนาคาร (ชื่อมาตรฐาน)
/** รายชื่อธนาคาร: ใช้ในช่องเลือกตอนเพิ่ม / แก้บัญชี · ชื่อที่บันทึก = label */
export const BANKS: { code: string; label: string; aliases: string[] }[] = [
  { code: "BBL", label: "กรุงเทพ (BBL)", aliases: ["bbl", "กรุงเทพ", "bangkokbank", "bualuang"] },
  { code: "KBANK", label: "กสิกรไทย (KBANK)", aliases: ["kbank", "kbiz", "kplus", "กสิกร", "กสิกรไทย", "kasikorn", "kasikornbank"] },
  { code: "SCB", label: "ไทยพาณิชย์ (SCB)", aliases: ["scb", "ไทยพาณิชย์", "siamcommercial", "siamcommercialbank"] },
  { code: "KTB", label: "กรุงไทย (KTB)", aliases: ["ktb", "กรุงไทย", "krungthai", "krungthaibank"] },
  { code: "BAY", label: "กรุงศรี (BAY)", aliases: ["bay", "กรุงศรี", "กรุงศรีอยุธยา", "krungsri", "bankofayudhya"] },
  { code: "TTB", label: "ทีทีบี (TTB)", aliases: ["ttb", "ทีทีบี", "ทหารไทยธนชาต", "ทหารไทย", "ธนชาต", "tmb", "thanachart", "tmbthanachart"] },
  { code: "GSB", label: "ออมสิน (GSB)", aliases: ["gsb", "ออมสิน", "governmentsavings", "governmentsavingsbank"] },
  { code: "BAAC", label: "ธ.ก.ส. (BAAC)", aliases: ["baac", "ธกส", "ธ.ก.ส.", "เพื่อการเกษตรและสหกรณ์การเกษตร"] },
  { code: "GHB", label: "อาคารสงเคราะห์ (GHB)", aliases: ["ghb", "ธอส", "ธ.อ.ส.", "อาคารสงเคราะห์", "governmenthousing"] },
  { code: "UOB", label: "ยูโอบี (UOB)", aliases: ["uob", "ยูโอบี"] },
  { code: "CIMB", label: "ซีไอเอ็มบี ไทย (CIMB)", aliases: ["cimb", "cimbthai", "ซีไอเอ็มบี", "ซีไอเอ็มบีไทย"] },
  { code: "KKP", label: "เกียรตินาคินภัทร (KKP)", aliases: ["kkp", "เกียรตินาคิน", "เกียรตินาคินภัทร", "kiatnakin", "kiatnakinphatra"] },
  { code: "TISCO", label: "ทิสโก้ (TISCO)", aliases: ["tisco", "ทิสโก้"] },
  { code: "LHB", label: "แลนด์ แอนด์ เฮ้าส์ (LH Bank)", aliases: ["lhb", "lhbank", "แลนด์แอนด์เฮ้าส์", "landandhouses"] },
  { code: "TCRB", label: "ไทยเครดิต (TCRB)", aliases: ["tcrb", "ไทยเครดิต", "thaicredit"] },
  { code: "ICBC", label: "ไอซีบีซี ไทย (ICBC)", aliases: ["icbc", "icbcthai", "ไอซีบีซี"] },
  { code: "IBANK", label: "อิสลามแห่งประเทศไทย (ibank)", aliases: ["ibank", "อิสลาม", "อิสลามแห่งประเทศไทย"] },
  { code: "CITI", label: "ซิตี้แบงก์ (Citibank)", aliases: ["citi", "citibank", "ซิตี้", "ซิตี้แบงก์", "ซิตี้แบงค์"] },
  { code: "HSBC", label: "เอชเอสบีซี (HSBC)", aliases: ["hsbc", "เอชเอสบีซี"] },
  { code: "SCBT", label: "สแตนดาร์ดชาร์เตอร์ด (SC)", aliases: ["standardchartered", "สแตนดาร์ดชาร์เตอร์ด", "scbt"] },
];
const bankKey = (s: string) => s.toLowerCase().replace(/ธนาคาร|bank|จำกัด|\(มหาชน\)|มหาชน|pcl|public company limited|[\s.\-()]/g, "");
/** ชื่อธนาคารที่พิมพ์ต่างกัน (BBL / กรุงเทพ / Bangkok Bank) → ชื่อมาตรฐานเดียว · ไม่รู้จัก = ชื่อเดิม */
export function bankLabel(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "-";
  const exact = BANKS.find((b) => b.label === s);
  if (exact) return exact.label;
  const k = bankKey(s);
  const hit = BANKS.find((b) => b.aliases.some((a) => bankKey(a) === k) || bankKey(b.code) === k);
  return hit?.label ?? s;
}

/** อัตราภาษีที่ดินและสิ่งปลูกสร้างที่ระบบเสนอ (% ของฐานภาษี · ขั้นแรก) ตามการใช้งาน — ใช้เมื่อยังไม่มีรายการปีก่อน · แก้ได้ทุกครั้ง */
/** ปีภาษีที่ดินปีแรกที่เลือกได้ (ค.ศ.) — ปีก่อนหน้าไม่มีข้อมูล · ถึงปีหน้า */
export const LAND_TAX_FIRST_YEAR = 2026;
export function landTaxYears(today: string, withData: number[] = []): number[] {
  const cur = Number(today.slice(0, 4));
  const ys = new Set<number>(withData);
  for (let y = LAND_TAX_FIRST_YEAR; y <= cur + 1; y++) ys.add(y);
  return [...ys].sort((a, b) => b - a);
}
export const LAND_TAX_RATE_BY_USAGE: Record<string, number> = {
  OWNER_OCCUPIED: 0.02, PERSONAL_USE: 0.02, RENTAL: 0.3, BUSINESS_USE: 0.3, VACANT: 0.3, OTHER: 0.3,
};
/** ภาษีที่ดิน 1 รายการ (คำนวณแบบเดียวกับ v_property_tax_lines) */
export function landTaxCalc(x: { land_sq_wa?: number | null; land_price_per_sq_wa?: number | null; building_sqm?: number | null;
  building_price_per_sqm?: number | null; depreciation_pct?: number | null; exemption?: number | null; rate_pct?: number | null; discount_pct?: number | null }) {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const land = r2((x.land_sq_wa ?? 0) * (x.land_price_per_sq_wa ?? 0));
  const gross = r2((x.building_sqm ?? 0) * (x.building_price_per_sqm ?? 0));
  const dep = r2((gross * (x.depreciation_pct ?? 0)) / 100);
  const total = land + gross - dep;
  const taxable = Math.max(total - (x.exemption ?? 0), 0);
  const full = r2((taxable * (x.rate_pct ?? 0)) / 100);
  const tax = r2(((taxable * (x.rate_pct ?? 0)) / 100) * (1 - (x.discount_pct ?? 0) / 100));
  return { land, gross, dep, building: gross - dep, total, taxable, full, tax };
}

/** Alternative Assets: หน่วยนับที่เลือกได้ตามหมวด (หมวดอื่น = ALT_UNITS_ANY) · พิมพ์หน่วยเองได้เสมอ */
export const ALT_UNITS_BY_CODE: Record<string, string[]> = {
  GOLD: ["บาททองคำ", "กรัม", "ออนซ์", "ชิ้น"], JEWELRY: ["ชิ้น", "ชุด", "กะรัต"], WATCH: ["เรือน"], SHOES: ["คู่"],
  CRYPTO: ["เหรียญ"],
};
export const ALT_UNITS_ANY = ["ชิ้น", "ชุด", "ขวด", "ลัง", "องค์", "คัน", "ภาพ", "ใบ", "เล่ม", "เหรียญ"];
export const GRAM_PER_GOLD_BAHT = 15.244;
/** "5 บาททองคำ (76.22 กรัม)" · จำนวนทศนิยมตามที่มี (สูงสุด 8) */
export function qtyUnit(q: number | string | null | undefined, unit: string | null | undefined): string {
  if (q == null || q === "") return "-";
  const n = Number(q);
  const s = n.toLocaleString("en-US", { maximumFractionDigits: 8 });
  const g = unit === "บาททองคำ" ? ` (${(n * GRAM_PER_GOLD_BAHT).toLocaleString("en-US", { maximumFractionDigits: 2 })} กรัม)` : "";
  return `${s}${unit ? ` ${unit}` : ""}${g}`;
}

/** ปุ่ม "+ เพิ่ม…" ท้ายแถวแท็บ — ขนาดเดียวกันทุกเมนู (ตกลง 28 ต.ค. 2026) */
export const ADD_BTN = "inline-flex items-center whitespace-nowrap rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700";

/** ชื่อย่อครอบครัว (ไม่มีรูป): หลายคำ (เว้นวรรค / ขีด) = ตัวแรกของ 2 คำแรก · คำเดียว = 2 ตัวแรก · ภาษาไทย = พยัญชนะตัวแรก */
export function familyInitials(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "FW";
  if (/^[\u0E00-\u0E7F]/.test(n)) return n.match(/[\u0E01-\u0E2E]/)?.[0] ?? n.charAt(0);
  const words = n.split(/[\s\-_.]+/).filter(Boolean);
  return (words.length > 1 ? words[0].charAt(0) + words[1].charAt(0) : words[0].slice(0, 2)).toUpperCase();
}
