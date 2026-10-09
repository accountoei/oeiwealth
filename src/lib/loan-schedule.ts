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

/** สร้างตารางผ่อนจากสูตร · ปัดเศษ 2 ตำแหน่ง · งวดสุดท้ายปรับเงินต้นให้ครบยอดพอดี */
export function generateSchedule(p: { method: SchedMethod; amount: number; ratePct: number; periods: number; firstDue: string; everyMonths: number }): SchedLine[] {
  const { method, amount, ratePct, periods: n, firstDue, everyMonths } = p;
  if (!(amount > 0) || !(n >= 1) || !firstDue) return [];
  const r = (ratePct / 100) * (everyMonths / 12);
  const pmt = r === 0 ? amount / n : (amount * r) / (1 - Math.pow(1 + r, -n));
  const flatInterest = r2(amount * r);
  const out: SchedLine[] = [];
  let bal = amount;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    let interest: number; let principal: number;
    switch (method) {
      case "EQUAL_PAYMENT": interest = r2(bal * r); principal = last ? r2(bal) : r2(pmt - interest); break;
      case "EQUAL_PRINCIPAL": interest = r2(bal * r); principal = last ? r2(bal) : r2(amount / n); break;
      case "FLAT": interest = flatInterest; principal = last ? r2(bal) : r2(amount / n); break;
      default: interest = flatInterest; principal = last ? r2(bal) : 0;
    }
    principal = Math.max(0, Math.min(principal, r2(bal)));
    bal = r2(bal - principal);
    out.push({ due_date: addMonthsKeepDay(firstDue, i * everyMonths), principal, interest });
  }
  return out;
}

/** แปลงตารางเป็นข้อความ (คั่นด้วย Tab) สำหรับแก้ในช่องข้อความ / วางกลับเข้า Excel */
export function scheduleToText(lines: SchedLine[]): string {
  return lines.map((l) => [l.due_date, l.principal.toFixed(2), l.interest.toFixed(2), l.notes ?? ""].join("\t").trimEnd()).join("\n");
}

/** อ่านวันที่: 2026-11-05 · 5/11/2026 · 5/11/2569 (พ.ศ.) · 5-11-26 → YYYY-MM-DD (วัน/เดือน/ปี) */
function parseDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3];
    if (y < 100) y += y > 50 ? 2500 : 2000;   // ปี 2 หลัก: 69 → 2569 (พ.ศ.) · 26 → 2026
  }
  if (y > 2400) y -= 543;                      // พ.ศ. → ค.ศ.
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}
const parseNum = (s: string) => {
  const t = s.trim().replace(/[,\s฿]/g, "");
  if (t === "" || t === "-") return 0;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
};

/**
 * อ่านข้อความที่คัดลอกจาก Excel: ต่อ 1 บรรทัด = 1 งวด
 * ลำดับคอลัมน์: [เลขงวด] วันครบกำหนด · เงินต้น · ดอกเบี้ย · [หมายเหตุ]  (คอลัมน์ "รวม" / "คงเหลือ" ท้ายตารางถูกข้าม)
 * บรรทัดหัวตาราง / บรรทัดว่าง ข้ามให้เอง
 */
export function parseScheduleText(text: string): { lines: SchedLine[]; errors: string[] } {
  const lines: SchedLine[] = []; const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    if (!raw.trim()) return;
    const cells = (raw.includes("\t") ? raw.split("\t") : raw.trim().split(/\s{2,}|\s*;\s*/)).map((c) => c.trim());
    const di = cells.findIndex((c) => parseDate(c) !== null);
    if (di < 0) {
      if (!/[ก-๙a-zA-Z]/.test(raw)) errors.push(`บรรทัด ${idx + 1}: ไม่พบวันที่`);
      return;   // หัวตาราง / บรรทัดรวม (มีตัวหนังสือ) ข้ามเงียบ ๆ
    }
    const principal = parseNum(cells[di + 1] ?? "");
    const interest = parseNum(cells[di + 2] ?? "");
    if (Number.isNaN(principal) || Number.isNaN(interest)) { errors.push(`บรรทัด ${idx + 1}: เงินต้น / ดอกเบี้ย ไม่ใช่ตัวเลข`); return; }
    if (principal < 0 || interest < 0 || principal + interest <= 0) { errors.push(`บรรทัด ${idx + 1}: ยอดต้องมากกว่า 0`); return; }
    const rest = cells.slice(di + 3).filter((c) => c && Number.isNaN(parseNum(c)));
    lines.push({ due_date: parseDate(cells[di]) as string, principal: r2(principal), interest: r2(interest), notes: rest.join(" ") || undefined });
  });
  lines.sort((a, b) => a.due_date.localeCompare(b.due_date));
  return { lines, errors };
}
