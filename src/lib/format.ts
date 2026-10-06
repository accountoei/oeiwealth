export function money(value: number | string | null | undefined, currency?: string, digits = 2): string {
  if (value === null || value === undefined || value === "") return "-";
  const n = typeof value === "string" ? Number(value) : value;
  const s = n.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return currency ? `${s} ${currency}` : s;
}

export function thDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
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
  const m = message.match(/^[A-Z_]+: ([\s\S]*)$/);
  return m ? m[1] : message;
}

export const CURRENCIES = ["THB", "USD", "EUR", "GBP", "JPY", "CNY", "HKD", "SGD", "AUD", "CHF"];

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  SAVING: "ออมทรัพย์", FIXED: "ฝากประจำ", FOREIGN_CURRENCY: "เงินฝากเงินตราต่างประเทศ", OTHER: "อื่น ๆ",
};

export const LIABILITY_TYPE_LABEL: Record<string, string> = {
  MORTGAGE: "สินเชื่อบ้าน", CAR_LOAN: "สินเชื่อรถยนต์", PERSONAL_LOAN: "สินเชื่อส่วนบุคคล",
  CREDIT_LINE: "วงเงินสินเชื่อ (O/D ฯลฯ)", OTHER: "อื่น ๆ",
};

/** อ่าน owner_<id> จาก FormData → [{person_id, percent}] */
export function ownersFromForm(form: FormData): { person_id: string; percent: number }[] {
  const out: { person_id: string; percent: number }[] = [];
  for (const [k, v] of form.entries()) {
    const n = Number(String(v).replace(/,/g, ""));
    if (k.startsWith("owner_") && n > 0) out.push({ person_id: k.slice(6), percent: n });
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

export const PROPERTY_TYPE_LABEL: Record<string, string> = {
  HOUSE: "บ้าน", CONDO: "คอนโด / ห้องชุด", LAND: "ที่ดิน", OTHER: "อื่น ๆ",
};
export const USAGE_LABEL: Record<string, string> = {
  OWNER_OCCUPIED: "อยู่อาศัยเอง", PERSONAL_USE: "ใช้ส่วนตัว", RENTAL: "ปล่อยเช่า", VACANT: "ว่าง",
  BUSINESS_USE: "ใช้ในกิจการ", OTHER: "อื่น ๆ",
};
export const FREQ_LABEL: Record<string, string> = {
  MONTHLY: "รายเดือน", QUARTERLY: "ราย 3 เดือน", YEARLY: "รายปี", OTHER: "อื่น ๆ",
};

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
  CASH: "เงินสดในพอร์ต", OTHER: "อื่น ๆ",
};
export const PORTFOLIO_TYPE_LABEL: Record<string, string> = {
  BROKERAGE: "บัญชีหลักทรัพย์ / กองทุน", PRIVATE_FUND: "กองทุนส่วนบุคคล", OTHER: "อื่น ๆ",
};
export const ITX_LABEL: Record<string, string> = {
  OPENING_BALANCE: "ยอดตั้งต้น", DEPOSIT: "โอนเข้าพอร์ต", WITHDRAWAL: "ถอนออกจากพอร์ต", BUY: "ซื้อ", SELL: "ขาย",
  DIVIDEND: "ปันผล", INTEREST: "ดอกเบี้ย", COUPON: "Coupon", FEE: "ค่าธรรมเนียม", TAX: "ภาษี",
  MATURITY: "ครบกำหนด", REDEMPTION: "ไถ่ถอน / ขายคืน", FX_EXCHANGE: "แลกเงิน", ADJUSTMENT: "ปรับปรุง",
};
/** จำนวนหน่วย (ไม่เกิน 4 ตำแหน่ง) */
export function qty(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("th-TH", { maximumFractionDigits: 4 });
}

export const INCOME_TYPE_LABEL: Record<string, string> = {
  SALARY: "เงินเดือน", BONUS: "โบนัส", INTEREST: "ดอกเบี้ย", DIVIDEND: "ปันผล", COUPON: "Coupon", RENT: "ค่าเช่า",
  LOAN_INTEREST: "ดอกเบี้ยเงินให้กู้", BUSINESS_DIVIDEND: "ปันผลกิจการ", OTHER: "รายได้อื่น",
};
export const MOVE_LABEL: Record<string, string> = {
  INCOME: "รายได้", EXPENSE: "ค่าใช้จ่าย", TRANSFER: "โอนระหว่างบัญชี", FX_EXCHANGE: "แลกเงิน", INVESTMENT_OUT: "โอนเข้าพอร์ต",
  INVESTMENT_IN: "รับจากพอร์ต", LOAN_DISBURSEMENT: "ให้กู้", LOAN_PRINCIPAL_RECEIPT: "รับชำระเงินกู้",
  ASSET_PURCHASE: "ซื้อทรัพย์สิน", ASSET_SALE: "ขายทรัพย์สิน", CARD_PAYMENT: "จ่ายบัตรเครดิต",
  LIABILITY_PAYMENT: "จ่ายหนี้", SECURITY_DEPOSIT_IN: "รับเงินประกัน", SECURITY_DEPOSIT_OUT: "คืนเงินประกัน",
  REIMBURSEMENT_IN: "เงินคืน (ไม่ใช่รายได้)", OTHER_IN: "เงินเข้าอื่น ๆ", OTHER_OUT: "เงินออกอื่น ๆ",
};
export const EXPENSE_CATEGORIES = ["ทั่วไป", "อาหาร", "บ้าน / สาธารณูปโภค", "เดินทาง / รถ", "การศึกษา", "สุขภาพ",
  "ประกัน", "ภาษี", "ท่องเที่ยว", "ช้อปปิ้ง", "ครอบครัว / ของขวัญ", "บริจาค", "BANK_FEE", "อื่น ๆ"];
/** "2026-10" → ช่วงวันที่ของเดือน */
export function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const start = `${ym}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  return { start, end, prev, next };
}

export const INS_TYPE: [string, string][] = [["LIFE", "ประกันชีวิต / สะสมทรัพย์"], ["HEALTH", "ประกันสุขภาพ"], ["ACCIDENT", "ประกันอุบัติเหตุ"], ["PROPERTY", "ประกันทรัพย์สิน"]];
export const INS_STATUS: [string, string][] = [["ACTIVE", "มีผล"], ["LAPSED", "ขาดอายุ"], ["SURRENDERED", "เวนคืนแล้ว"], ["MATURED", "ครบสัญญา"], ["CLAIMED", "เคลมจบแล้ว"], ["CANCELLED", "ยกเลิก"]];
export const CLAIM_STATUS: [string, string][] = [["DRAFT", "ร่าง"], ["SUBMITTED", "ยื่นแล้ว"], ["APPROVED", "อนุมัติ"], ["PARTIALLY_PAID", "จ่ายบางส่วน"], ["PAID", "จ่ายครบ"], ["REJECTED", "ปฏิเสธ"], ["CANCELLED", "ยกเลิก"]];

export const COUPON_FREQ_LABEL: Record<string, string> = {
  MONTHLY: "รายเดือน", QUARTERLY: "รายไตรมาส", SEMI_ANNUAL: "ทุก 6 เดือน", ANNUAL: "รายปี", AT_MATURITY: "ตอนครบกำหนด", OTHER: "อื่น ๆ",
};
