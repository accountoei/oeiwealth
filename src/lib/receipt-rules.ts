/**
 * กฎ "รับชำระ" ที่ใช้ทั้งแท็บบันทึกเป็นกลุ่มและหน้าต่างรายสัญญา (ฟังก์ชันล้วน · ไม่แตะ database)
 * - เงินกู้: งวดที่เริ่มเติม → ยอดค้างถึงวันที่รับ → แบ่งยอดรวม (หักดอกเบี้ยก่อน)
 * - ค่าเช่า: ค่าปรับล่าช้า ณ วันที่รับ
 * ฐานข้อมูลยังเป็นตัวตัดสินสุดท้าย (v_loan_schedule_status / batch_receive_loans) — ที่นี่แค่เติมยอดให้ในหน้าจอ
 * เทสต์: node scripts/receipt-rules.test.mjs
 */

const r2 = (v: number) => Math.round(v * 100) / 100;

/** งวดในตารางผ่อน (จาก v_loan_schedule_status) */
export type LoanLine = { due_date: string; status: string; total_remaining: number | string };

const isOpen = (x: LoanLine) => x.status !== "PAID" && x.status !== "WRITTEN_OFF";
const isDue = (x: LoanLine) => x.status === "OVERDUE" || x.status === "DUE";

/**
 * งวดที่ปุ่มรับชำระเติมยอดให้อย่างน้อยถึง — ตกลง 30 ต.ค. 2026 + 11 พ.ย. 2026
 * 1. มีงวดที่ครบกำหนดแล้ว (เลยกำหนด / อยู่ในช่วงผ่อนผัน) → งวดล่าสุดในนั้น (ไม่เติมงวดที่ยังไม่ถึง)
 * 2. แท็บรับชำระรายเดือน: สัญญามีงวดในเดือนที่เลือก (monthLines ไม่ว่าง) → งวดแรกที่ยังค้างของเดือนนั้น
 *    (รับครบทุกงวดของเดือนแล้ว = undefined · ไม่เติมงวดเดือนหน้าให้)
 * 3. หน้าสัญญา / สัญญาที่ไม่มีงวดในเดือนที่เลือก → งวดถัดไปที่ยังค้าง
 * ไม่มีงวดค้างเลย → undefined
 */
export function payFromLine<T extends LoanLine>(lines: T[], monthLines?: T[]): T | undefined {
  const byDue = (a: T, b: T) => a.due_date.localeCompare(b.due_date);
  const due = lines.filter(isDue).sort(byDue);
  if (due.length) return due.at(-1);
  if (monthLines?.length) return monthLines.find((x) => Number(x.total_remaining) > 0.005);
  return lines.filter((x) => isOpen(x) && !isDue(x)).sort(byDue)[0];
}

/** งวดที่ยังค้าง: คงเหลือต่องวด */
export type OweLine = { no?: number; due: string; p: number; i: number };

/**
 * ยอดที่ถึงกำหนด ณ วันที่รับ = งวดที่ค้างที่ครบถึงวันนั้น · แต่ไม่น้อยกว่าถึงงวด from (รับล่วงหน้าก็เติมงวดนั้นให้)
 * ปัด 2 ตำแหน่ง · nos = เลขงวดที่รวมอยู่
 */
export function dueAsOf(lines: OweLine[], from: string | null | undefined, date: string): { p: number; i: number; nos: number[] } {
  const upTo = from && date < from ? from : date;
  const ls = lines.filter((x) => x.due <= upTo);
  return {
    p: r2(ls.reduce((t, x) => t + x.p, 0)),
    i: r2(ls.reduce((t, x) => t + x.i, 0)),
    nos: ls.flatMap((x) => (x.no == null ? [] : [x.no])),
  };
}

/** แบ่งยอดรวมที่รับ: หักดอกเบี้ยที่ถึงกำหนดก่อน ที่เหลือเป็นเงินต้น (ปัด 2 ตำแหน่ง) */
export function splitInterestFirst(total: number, dueInterest: number): { interest: number; principal: number } {
  const interest = r2(Math.min(total, Math.max(dueInterest, 0)));
  return { interest, principal: r2(total - interest) };
}

/**
 * ค่าปรับค่าเช่าล่าช้า ณ วันที่รับ = (จำนวนวันที่เลยกำหนด − วันผ่อนผัน) × ค่าปรับต่อวัน
 * ไม่เกินวันผ่อนผัน / ไม่ได้ตั้งค่าปรับ → 0
 */
export function lateFee(due: string, grace: number, perDay: number, date: string): number {
  const days = Math.round((Date.parse(date) - Date.parse(due)) / 86400000) - grace;
  return days > 0 && perDay > 0 ? r2(days * perDay) : 0;
}
