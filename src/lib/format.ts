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
