// ตารางผ่อนเงินให้กู้: คำนวณจากสูตร + อ่านข้อความที่วางจาก Excel (ใช้ได้ทั้งฝั่ง Server และ Client)

export type SchedLine = { due_date: string; principal: number; interest: number; notes?: string };
export type SchedMethod = "EQUAL_PAYMENT" | "EQUAL_PRINCIPAL" | "FLAT" | "INTEREST_ONLY";

export const SCHED_METHOD_LABEL: Record<SchedMethod, string> = {
  EQUAL_PAYMENT: "ผ่อนเท่ากันทุกงวด (ลดต้นลดดอก)",
  EQUAL_PRINCIPAL: "เงินต้นเท่ากันทุกงวด (ดอกลดลงตามยอดคงเหลือ)",
  FLAT: "ดอกเบี้ยคงที่ (Flat rate) คิดจากยอดเริ่มต้น",
  INTEREST_ONLY: "จ่ายดอกทุกงวด คืนต้นงวดสุดท้าย",
};

export const LOAN_SCHED_STATUS: Record<string, { text: string; cls: string }> = {
  PAID: { text: "รับแล้ว", cls: "bg-emerald-50 text-emerald-700" },
  PARTIAL: { text: "รับบางส่วน", cls: "bg-amber-50 text-amber-700" },
  PENDING: { text: "รอรับ", cls: "bg-slate-100 text-slate-700" },
  OVERDUE: { text: "เลยกำหนด", cls: "bg-red-50 text-red-700" },
  WRITTEN_OFF: { text: "ตัดหนี้สูญ", cls: "bg-slate-100 text-slate-500" },
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");

/** เลื่อนวันที่ทีละ n เดือน โดยคงวันที่เดิม (ถ้าเดือนนั้นไม่มีวันที่ดังกล่าว ใช้วันสุดท้ายของเดือน) */
export function addMonthsKeepDay(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = (m - 1) + months;
  const yy = y + Math.floor(total / 12);
  const mm = ((total % 12) + 12) % 12 + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${pad(mm)}-${pad(Math.min(d, last))}`;
}

/** วิธีกำหนดตาราง: ใส่จำนวนงวด หรือ ใส่ยอดผ่อนต่องวด (ระบบนับจำนวนงวดให้) */
export type SchedBasis = "PERIODS" | "PAYMENT";
export const MAX_PERIODS = 600;

/** ช่อง "ยอดต่องวด" ของแต่ละวิธีหมายถึงอะไร (ดอกคงที่ / ผ่อนเท่ากัน = รวมดอก · ต้นเท่ากัน = เฉพาะเงินต้น) */
export const PAYMENT_LABEL: Record<SchedMethod, string> = {
  EQUAL_PAYMENT: "ยอดผ่อนต่องวด (รวมดอกเบี้ย)",
  EQUAL_PRINCIPAL: "เงินต้นต่องวด (ไม่รวมดอกเบี้ย)",
  FLAT: "ยอดผ่อนต่องวด (รวมดอกเบี้ย)",
  INTEREST_ONLY: "",
};

/** วิธีนับดอกเบี้ย: เท่ากันทุกงวด (อัตรา ÷ 12 × เดือน) หรือ ตามจำนวนวันจริง (อัตรา × วัน ÷ 365) */
export type DayCount = "MONTHLY" | "ACTUAL_365";

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * สร้างตารางผ่อนจากสูตร · ปัดเศษ 2 ตำแหน่ง
 * - basis PERIODS: ใส่จำนวนงวด → งวดสุดท้ายปรับเงินต้นให้ครบยอดพอดี
 * - basis PAYMENT: ใส่ยอดต่องวด → ผ่อนไปจนหมด งวดสุดท้ายเท่าที่เหลือ (จ่ายดอกอย่างเดียวใช้แบบนี้ไม่ได้)
 * - dayCount ACTUAL_365: ดอกงวด = ยอดคงเหลือ × อัตรา × จำนวนวันในงวด ÷ 365
 *   (นับจากงวดก่อนหน้า · งวดแรกนับจาก interestFrom — ไม่ใส่ = ก่อนงวดแรก 1 รอบ)
 *   ผ่อนเท่ากัน: ค่างวดเท่าเดิม สัดส่วนต้น / ดอกขยับตามจำนวนวัน · ดอกคงที่ (Flat): คิดจากยอดเริ่มต้น × วันจริง
 * - งวดที่ยอดเป็น 0 ทั้งต้นและดอก (เช่น ไม่คิดดอก + คืนต้นงวดสุดท้าย) ไม่ใส่ในตาราง
 */
export function generateSchedule(p: { method: SchedMethod; basis?: SchedBasis; amount: number; ratePct: number; periods?: number;
  payment?: number; firstDue: string; everyMonths: number; dayCount?: DayCount; interestFrom?: string }): { lines: SchedLine[]; error?: string } {
  const { method, amount, ratePct, firstDue, everyMonths } = p;
  const basis = method === "INTEREST_ONLY" ? "PERIODS" : p.basis ?? "PERIODS";
  const actual = p.dayCount === "ACTUAL_365";
  if (!(amount > 0)) return { lines: [], error: "กรุณาใส่ยอดเงินต้น" };
  if (!firstDue) return { lines: [], error: "กรุณาใส่วันครบกำหนดงวดแรก" };
  const start = p.interestFrom || addMonthsKeepDay(firstDue, -everyMonths);
  if (actual && daysBetween(start, firstDue) <= 0) return { lines: [], error: "วันเริ่มนับดอกต้องอยู่ก่อนวันครบกำหนดงวดแรก" };
  const r = (ratePct / 100) * (everyMonths / 12);
  const due = (i: number) => addMonthsKeepDay(firstDue, i * everyMonths);
  // อัตราดอกของงวด i (สัดส่วนของปี)
  const rate = (i: number) => (actual ? (ratePct / 100) * daysBetween(i === 0 ? start : due(i - 1), due(i)) / 365 : r);
  const interestOn = (bal: number, i: number) => r2((method === "FLAT" ? amount : bal) * rate(i));
  const out: SchedLine[] = [];
  let bal = amount;

  if (basis === "PAYMENT") {
    const pay = p.payment ?? 0;
    if (!(pay > 0)) return { lines: [], error: "กรุณาใส่ยอดต่องวด" };
    // เงินต้นที่ลดได้ในงวดแรก ต้องมากกว่า 0 ไม่อย่างนั้นผ่อนไม่มีวันหมด
    const i0 = interestOn(bal, 0);
    if ((method === "EQUAL_PRINCIPAL" ? pay : pay - i0) <= 0) {
      return { lines: [], error: `ยอดต่องวดต้องมากกว่าดอกเบี้ยต่องวด (${i0.toLocaleString("en-US", { minimumFractionDigits: 2 })})` };
    }
    for (let i = 0; bal > 0.004; i++) {
      if (i >= MAX_PERIODS) return { lines: [], error: `ยอดต่องวดน้อยเกินไป — เกิน ${MAX_PERIODS} งวด` };
      const interest = interestOn(bal, i);
      const principal = r2(Math.min(bal, method === "EQUAL_PRINCIPAL" ? pay : pay - interest));
      if (principal <= 0) return { lines: [], error: "ยอดต่องวดไม่พอจ่ายดอกเบี้ยของบางงวด (เดือนที่มีจำนวนวันมาก) — เพิ่มยอดต่องวด" };
      bal = r2(bal - principal);
      out.push({ due_date: due(i), principal, interest });
    }
    return { lines: out };
  }

  const n = Math.floor(p.periods ?? 0);
  if (!(n >= 1)) return { lines: [], error: "กรุณาใส่จำนวนงวด" };
  if (n > MAX_PERIODS) return { lines: [], error: `จำนวนงวดเกิน ${MAX_PERIODS}` };
  const pmt = r === 0 ? amount / n : (amount * r) / (1 - Math.pow(1 + r, -n));
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const interest = interestOn(bal, i);
    let principal: number;
    switch (method) {
      case "EQUAL_PAYMENT": principal = last ? r2(bal) : r2(pmt - interest); break;
      case "EQUAL_PRINCIPAL": case "FLAT": principal = last ? r2(bal) : r2(amount / n); break;
      default: principal = last ? r2(bal) : 0;
    }
    principal = Math.max(0, Math.min(principal, r2(bal)));
    bal = r2(bal - principal);
    out.push({ due_date: due(i), principal, interest });
  }
  return { lines: out.filter((l) => l.principal + l.interest > 0) };
}

/** แปลงตารางเป็นข้อความ (คั่นด้วย Tab) สำหรับแก้ในช่องข้อความ / วางกลับเข้า Excel */
export function scheduleToText(lines: SchedLine[]): string {
  return lines.map((l) => [l.due_date, l.principal.toFixed(2), l.interest.toFixed(2), l.notes ?? ""].join("\t").trimEnd()).join("\n");
}

// ชื่อเดือนภาษาไทย (เต็ม / ย่อ) และอังกฤษ (ย่อ 3 ตัว) → เลขเดือน
const TH_MONTH_NAMES: [RegExp, number][] = [
  [/^(มกราคม|ม\.?ค\.?)$/, 1], [/^(กุมภาพันธ์|ก\.?พ\.?)$/, 2], [/^(มีนาคม|มี\.?ค\.?)$/, 3], [/^(เมษายน|เม\.?ย\.?)$/, 4],
  [/^(พฤษภาคม|พ\.?ค\.?)$/, 5], [/^(มิถุนายน|มิ\.?ย\.?)$/, 6], [/^(กรกฎาคม|ก\.?ค\.?)$/, 7], [/^(สิงหาคม|ส\.?ค\.?)$/, 8],
  [/^(กันยายน|ก\.?ย\.?)$/, 9], [/^(ตุลาคม|ต\.?ค\.?)$/, 10], [/^(พฤศจิกายน|พ\.?ย\.?)$/, 11], [/^(ธันวาคม|ธ\.?ค\.?)$/, 12],
];
const EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function monthFromName(n: string): number | null {
  const t = n.trim().toLowerCase();
  for (const [re, m] of TH_MONTH_NAMES) if (re.test(t)) return m;
  const e = EN_MONTHS.indexOf(t.slice(0, 3));
  return e >= 0 ? e + 1 : null;
}

function ymd(y: number, mo: number, d: number): string | null {
  if (y > 2400) y -= 543;                      // พ.ศ. → ค.ศ.
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/**
 * อ่านวันที่ → YYYY-MM-DD (ปี พ.ศ. แปลงเป็น ค.ศ. ให้)
 * รับ: 2026-11-05 · 5/11/2026 · 5/11/2569 · 5-11-26 · 15 มิถุนายน 68 · 15 มิ.ย. 2568 · 15-Jun-25 · ค่าวันที่จากไฟล์ Excel
 * ปี 2 หลัก: มากกว่า 50 = พ.ศ. (68 → 2568) · ไม่เกิน 50 = ค.ศ. (26 → 2026)
 */
export function toIsoDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : ymd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v !== "string") return null;
  const t = v.trim();
  const yy = (n: number) => (n < 100 ? n + (n > 50 ? 2500 : 2000) : n);
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(T[\d:.]+Z?)?$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return ymd(yy(+m[3]), +m[2], +m[1]);
  m = t.match(/^(\d{1,2})[\s-]*([ก-๙A-Za-z.]+)[\s-]*(\d{2,4})$/);
  if (m) { const mo = monthFromName(m[2]); return mo ? ymd(yy(+m[3]), mo, +m[1]) : null; }
  return null;
}
export function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null) return 0;
  if (typeof v !== "string") return NaN;
  const t = v.trim().replace(/[,\s฿]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (t === "" || /^-+$/.test(t)) return 0;      // ช่องว่าง / "-" (รูปแบบบัญชีของ Excel) = 0
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}
const isText = (v: unknown) => typeof v === "string" && /[ก-๙a-zA-Z]/.test(v) && toIsoDate(v) === null;

export type ParseResult = { lines: SchedLine[]; errors: string[]; skipped: number; header: boolean };

/**
 * อ่านตารางผ่อนจากแถวข้อมูล (ไฟล์ Excel หรือข้อความที่คัดลอกมา)
 * - มีหัวตาราง (คอลัมน์ "เงินต้น" + "ดอกเบี้ย"): ใช้ตามหัวตาราง — คอลัมน์อื่น เช่น เงินต้นคงเหลือ / รวม / ยอดคงเหลือ ไม่ใช้
 *   คอลัมน์วันที่ = หัว "วันที่ / เดือน / ครบกำหนด" (ไม่มี = ช่องแรกที่เป็นวันที่)
 * - ไม่มีหัวตาราง: [เลขงวด] วันครบกำหนด · เงินต้น · ดอกเบี้ย · [หมายเหตุ]
 * - ข้ามเงียบ ๆ: บรรทัดว่าง · ข้อความ (หัวตาราง / บรรทัดรวม) · งวดที่ยอดเป็น 0 ทั้งเงินต้นและดอกเบี้ย (นับไว้ใน skipped)
 */
export function parseScheduleRows(rows: unknown[][]): ParseResult {
  const lines: SchedLine[] = []; const errors: string[] = [];
  let skipped = 0;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  // หาหัวตาราง
  let start = 0; let dCol = -1; let pCol = -1; let iCol = -1; let nCol = -1; let header = false;
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map(str);
    const p = cells.findIndex((c) => /^(เงินต้น(ที่)?(ชำระ|จ่าย|ผ่อน)?|principal)$/i.test(c.replace(/\s/g, "")));
    const i = cells.findIndex((c) => /^(ดอกเบี้ย(ที่)?(ชำระ|จ่าย)?|interest)$/i.test(c.replace(/\s/g, "")));
    if (p >= 0 && i >= 0) {
      header = true; start = r + 1; pCol = p; iCol = i;
      dCol = cells.findIndex((c) => /(วันที่|เดือน|ครบ|กำหนด|งวดวันที่|date|month)/i.test(c) && !/^งวด(ที่)?$/.test(c));
      nCol = cells.findIndex((c) => /(หมายเหตุ|note)/i.test(c));
      break;
    }
  }
  for (let r = start; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const label = `แถว ${r + 1}`;
    if (row.every((c) => c == null || (typeof c === "string" && c.trim() === ""))) continue;
    const di = header && dCol >= 0 ? dCol : row.findIndex((c) => toIsoDate(c) !== null);
    const date = di >= 0 ? toIsoDate(row[di]) : null;
    if (!date) {
      // มีตัวเลขที่ไม่ใช่ 0 แต่ไม่มีวันที่และไม่มีข้อความกำกับ = น่าจะพิมพ์วันที่ผิด → แจ้ง
      if (!row.some(isText) && row.some((c) => { const n = toNum(c); return !Number.isNaN(n) && n !== 0; })) errors.push(`${label}: ไม่พบวันที่`);
      continue;   // หัวตาราง / บรรทัดรวม / ยอดยกมา / แถวว่างที่เป็น 0
    }
    const principal = toNum(row[header ? pCol : di + 1]);
    const interest = toNum(row[header ? iCol : di + 2]);
    if (Number.isNaN(principal) || Number.isNaN(interest)) { errors.push(`${label}: เงินต้น / ดอกเบี้ย ไม่ใช่ตัวเลข`); continue; }
    if (principal < 0 || interest < 0) { errors.push(`${label}: ยอดติดลบ`); continue; }
    if (principal + interest === 0) { skipped++; continue; }
    const notes = header
      ? (nCol >= 0 ? str(row[nCol]) : "")
      : row.slice(di + 3).filter((c) => typeof c === "string" && Number.isNaN(toNum(c))).map(str).join(" ");
    lines.push({ due_date: date, principal: r2(principal), interest: r2(interest), notes: notes || undefined });
  }
  lines.sort((a, b) => a.due_date.localeCompare(b.due_date));
  return { lines, errors, skipped, header };
}

/** อ่านข้อความที่คัดลอกจาก Excel (คั่นด้วย Tab) หรือพิมพ์เอง (คั่นด้วยเว้นวรรค 2 ช่องขึ้นไป / ;) */
export function parseScheduleText(text: string): ParseResult {
  const rows = text.split(/\r?\n/).map((raw) => (raw.includes("\t") ? raw.split("\t") : raw.trim().split(/\s{2,}|\s*;\s*/)));
  return parseScheduleRows(rows);
}
