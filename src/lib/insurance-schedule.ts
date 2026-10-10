// ตารางเบี้ยประกัน / ตารางรับผลประโยชน์: สร้างจากสูตร + อ่านจาก Excel (งวดละ 1 ยอด)
import { addMonthsKeepDay, toIsoDate, toNum } from "@/lib/loan-schedule";

export type AmountLine = { due_date: string; amount: number; notes?: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** ยอดเท่ากันทุกงวด: ใส่จำนวนงวด หรือ วันสิ้นสุด (งวดสุดท้ายไม่เกินวันนั้น) */
export function generateAmountSchedule(p: { amount: number; everyMonths: number; firstDue: string; periods?: number; until?: string }):
  { lines: AmountLine[]; error?: string } {
  if (!(p.amount > 0)) return { lines: [], error: "กรุณาใส่ยอดต่องวด" };
  if (!p.firstDue) return { lines: [], error: "กรุณาใส่วันครบกำหนดงวดแรก" };
  const out: AmountLine[] = [];
  for (let i = 0; i < 600; i++) {
    const d = addMonthsKeepDay(p.firstDue, i * p.everyMonths);
    if (p.until ? d > p.until : i >= Math.floor(p.periods ?? 0)) break;
    out.push({ due_date: d, amount: r2(p.amount) });
  }
  if (!out.length) return { lines: [], error: p.until ? "วันสิ้นสุดต้องอยู่หลังงวดแรก" : "กรุณาใส่จำนวนงวด" };
  return { lines: out };
}

/**
 * อ่านตารางจาก Excel / ข้อความที่คัดลอกมา: 1 แถว = 1 งวด
 * มีหัวตาราง (คอลัมน์ "เบี้ย" / "จำนวนเงิน" / "ยอด" / "ผลประโยชน์" / "เงินคืน"): ใช้คอลัมน์นั้น
 * ไม่มีหัวตาราง: วันที่ · ยอด · [หมายเหตุ] · ข้ามแถวรวม / แถวยอด 0 ให้เอง
 */
export function parseAmountRows(rows: unknown[][]): { lines: AmountLine[]; errors: string[]; skipped: number } {
  const lines: AmountLine[] = []; const errors: string[] = []; let skipped = 0;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  let start = 0; let dCol = -1; let aCol = -1; let nCol = -1;
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map(str);
    const a = cells.findIndex((c) => /(เบี้ย|จำนวนเงิน|ยอด|ผลประโยชน์|เงินคืน|amount|premium)/i.test(c) && !/(รวม|สะสม|คงเหลือ)/.test(c));
    const d = cells.findIndex((c) => /(วันที่|ครบ|กำหนด|เดือน|date)/i.test(c));
    if (a >= 0 && d >= 0) { start = r + 1; aCol = a; dCol = d; nCol = cells.findIndex((c) => /(หมายเหตุ|note)/i.test(c)); break; }
  }
  const isText = (v: unknown) => typeof v === "string" && /[ก-๙a-zA-Z]/.test(v) && toIsoDate(v) === null;
  for (let r = start; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => c == null || (typeof c === "string" && c.trim() === ""))) continue;
    const di = dCol >= 0 ? dCol : row.findIndex((c) => toIsoDate(c) !== null);
    const date = di >= 0 ? toIsoDate(row[di]) : null;
    if (!date) {
      if (!row.some(isText) && row.some((c) => { const n = toNum(c); return !Number.isNaN(n) && n !== 0; })) errors.push(`แถว ${r + 1}: ไม่พบวันที่`);
      continue;
    }
    const ai = aCol >= 0 ? aCol : row.findIndex((c, i) => i > di && c != null && str(c) !== "" && !Number.isNaN(toNum(c)));
    const amount = ai >= 0 ? toNum(row[ai]) : NaN;
    if (Number.isNaN(amount)) { errors.push(`แถว ${r + 1}: ยอดไม่ใช่ตัวเลข`); continue; }
    if (amount < 0) { errors.push(`แถว ${r + 1}: ยอดติดลบ`); continue; }
    if (amount === 0) { skipped++; continue; }
    const notes = nCol >= 0 ? str(row[nCol]) : row.slice(Math.max(di, ai) + 1).filter((c) => isText(c)).map(str).join(" ");
    lines.push({ due_date: date, amount: r2(amount), notes: notes || undefined });
  }
  lines.sort((a, b) => a.due_date.localeCompare(b.due_date));
  return { lines, errors, skipped };
}

export function parseAmountText(text: string) {
  return parseAmountRows(text.split(/\r?\n/).map((raw) => (raw.includes("\t") ? raw.split("\t") : raw.trim().split(/\s{2,}|\s*;\s*/))));
}

export function amountScheduleToText(lines: AmountLine[]) {
  return lines.map((l) => [l.due_date, l.amount.toFixed(2), l.notes ?? ""].join("\t").trimEnd()).join("\n");
}
