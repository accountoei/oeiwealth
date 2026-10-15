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
/** เจ้าของจากฟอร์ม: owner_<id> = % · shares_<id> = จำนวนหุ้น (ธุรกิจ) */
export function ownersFromForm(form: FormData): { person_id: string; percent?: number; shares?: number }[] {
  const out: { person_id: string; percent?: number; shares?: number }[] = [];
  for (const [k, v] of form.entries()) {
    const n = Number(String(v).replace(/,/g, ""));
    if (k.startsWith("owner_") && n > 0) out.push({ person_id: k.slice(6), percent: n });
    if (k.startsWith("shares_") && n > 0) out.push({ person_id: k.slice(7), shares: n });
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
  CASH_TRANSFER: "โอนระหว่างบัญชีในพอร์ต",
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
export const ENTITY_MODULE: Record<string, string> = {
  FINANCIAL: "FINANCIAL", INVESTMENT: "INVESTMENT", PROPERTY: "PROPERTY", ALTERNATIVE: "ALTERNATIVE",
  LIABILITY: "FINANCIAL", INSURANCE_POLICY: "INSURANCE", PERSON: "FAMILY", CREDIT_CARD: "CARD_MEMBERSHIP",
};
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

/** อายุ (ปีเต็ม) จากวันเกิด YYYY-MM-DD · วันเกิดในอนาคต / ว่าง → null */
export function ageFrom(birth: string | null | undefined, today: string): number | null {
  if (!birth || birth > today) return null;
  const [by, bm, bd] = birth.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = today.slice(0, 10).split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
