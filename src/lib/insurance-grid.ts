/**
 * ตารางเบี้ย / ผลประโยชน์ที่แก้ได้ทีละช่อง (ตกลง 4 พ.ย. 2026 · แบบตารางผ่อนของสินเชื่อ)
 *   แถวที่จ่าย / รับแล้ว (locked) แสดงไว้แต่ไม่ส่งไปบันทึก (ฐานข้อมูลเก็บงวดนั้นไว้เอง)
 *   ตรวจแบบเดียวกับ set_insurance_schedule: วันที่ · ยอด > 0 · งวดหลัง Go-live ที่ยังไม่จ่ายต้องอยู่หลังงวดที่จ่ายแล้ว
 *   ไฟล์นี้ไม่มี import (ทดสอบด้วย node scripts/insurance-grid.test.mjs)
 */

export type GridLine = {
  key: string; due: string; amount: string; type: string; skipped: boolean; notes: string;
  /** จ่าย / รับแล้ว = แก้ในตารางนี้ไม่ได้ (ข้อความบอกเหตุผล) */
  locked?: string | null;
};

export type SaveLine = { due_date: string; amount: number; benefit_type?: string; notes?: string; skipped?: boolean };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** ตัวเลขจากช่อง (ตัดคอมมา · ว่าง = 0 · ตัวอักษร = NaN) */
export const gridNum = (s: string) => { const t = s.replace(/,/g, "").trim(); return t === "" ? 0 : Number(t); };
const thShort = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${d}/${m}/${y + 543}`; };

/** บวกเดือน คงวันที่เดิม (31 ม.ค. + 1 เดือน = 28/29 ก.พ.) */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = y * 12 + (m - 1) + months;
  const ny = Math.floor(t / 12), nm = t % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** จำนวนเดือนระหว่างสองวัน (นับตามเดือนปฏิทิน) */
export const monthsBetween = (a: string, b: string) => {
  const [ya, ma] = a.split("-").map(Number); const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

/** ระยะห่างของงวดท้าย ๆ (เดือน) ใช้เดาวันของงวดที่เพิ่ม · ไม่พอ = 12 เดือน */
export function guessEvery(rows: GridLine[]): number {
  const ds = rows.map((r) => r.due).filter((d) => ISO.test(d)).sort();
  if (ds.length < 2) return 12;
  const n = monthsBetween(ds[ds.length - 2], ds[ds.length - 1]);
  return n > 0 && n <= 120 ? n : 12;
}

/** แถวใหม่ต่อจากแถวนี้: วันที่ + ระยะห่างเดิม · ยอด / ชนิดเดิม */
export function nextRow(after: GridLine | undefined, every: number, key: string, fallbackDue: string): GridLine {
  return {
    key, due: after && ISO.test(after.due) ? addMonthsIso(after.due, every) : fallbackDue,
    amount: after?.amount ?? "", type: after?.type ?? "", skipped: false, notes: "",
  };
}

/** เรียงตามวันที่ (แถวที่ยังไม่มีวันที่อยู่ท้าย · ลำดับเดิมเมื่อวันเดียวกัน) */
export const sortGrid = (rows: GridLine[]) =>
  rows.map((r, i) => ({ r, i })).sort((a, b) => (a.r.due || "9999").localeCompare(b.r.due || "9999") || a.i - b.i).map((x) => x.r);

/** ใช้ยอดของแถว i กับแถวถัดไปทั้งหมดที่ยังแก้ได้ */
export const fillDown = (rows: GridLine[], i: number) => rows.map((r, j) => (j > i && !r.locked ? { ...r, amount: rows[i].amount } : r));

/** แถว → งวดที่จะบันทึก (เฉพาะแถวที่แก้ได้) + ข้อผิดพลาด */
export function gridToLines(rows: GridLine[], kind: "PREMIUM" | "BENEFIT", goLive: string | null): { lines: SaveLine[]; errors: string[] } {
  const errors: string[] = [];
  const lines: SaveLine[] = [];
  const keptMax = rows.filter((r) => r.locked && ISO.test(r.due)).map((r) => r.due).sort().at(-1) ?? null;
  rows.forEach((r, i) => {
    if (r.locked) return;
    const no = `งวดที่ ${i + 1}`;
    if (!ISO.test(r.due)) { errors.push(`${no}: ใส่วันครบกำหนด`); return; }
    const amt = gridNum(r.amount);
    if (!Number.isFinite(amt) || amt <= 0) { errors.push(`${no}: ยอดต้องเป็นตัวเลขมากกว่า 0`); return; }
    if (keptMax && r.due <= keptMax && (!goLive || r.due >= goLive)) {
      errors.push(`${no} (${thShort(r.due)}): งวดหลัง Go-live ที่ยังไม่ชำระต้องอยู่หลังงวดที่ชำระแล้ว (${thShort(keptMax)})`);
      return;
    }
    lines.push({
      due_date: r.due, amount: Math.round(amt * 100) / 100,
      ...(kind === "BENEFIT" ? { benefit_type: r.type || "OTHER" } : {}),
      ...(r.notes.trim() ? { notes: r.notes.trim() } : {}),
      ...(r.skipped ? { skipped: true } : {}),
    });
  });
  if (lines.length > 600) errors.push("ตารางยาวเกิน 600 งวด");
  return { lines, errors };
}

/**
 * ตารางมูลค่าเวนคืนแบบแก้ทีละช่อง (ตกลง 8 พ.ย. 2026 · หน้าตาเดียวกับตารางเบี้ย / ผลประโยชน์)
 *   1 แถว = 1 ปีกรมธรรม์ · วันที่เริ่มเป็นวันครบรอบ (วันเริ่มสัญญา + N ปี) แก้ได้ · ส่งวันที่ไปเก็บเฉพาะเมื่อไม่ตรงวันครบรอบ
 *   เล่มที่ไม่มีตารางในสัญญา: ใส่ยอดตามหนังสือแจ้งเป็นแถว (ปีกรมธรรม์ + วันที่ในหนังสือแจ้ง)
 */
export type CvGridLine = { key: string; year: string; date: string; value: string };
export type CvSaveLine = { policy_year: number; value: number; value_date?: string };

/** วันครบรอบปีกรมธรรม์ที่ N (null = ยังไม่มีวันเริ่มสัญญา / ปีไม่ถูกต้อง) */
export const cvAutoDate = (start: string | null, year: number) =>
  start && ISO.test(start) && Number.isInteger(year) && year >= 1 && year <= 120 ? addMonthsIso(start, year * 12) : null;

/** แก้ปีของแถว: วันที่ที่ยังเป็นวันครบรอบเดิม เลื่อนตามปีใหม่ */
export function cvSetYear(r: CvGridLine, year: string, start: string | null): CvGridLine {
  const was = cvAutoDate(start, Number(r.year));
  const now = cvAutoDate(start, Number(year));
  return { ...r, year, date: !r.date || r.date === was ? now ?? r.date : r.date };
}

/** แถวถัดไป: ปี + 1 · วันที่ = วันครบรอบ (หรือ + 12 เดือนจากแถวก่อน ถ้าแถวก่อนใส่วันที่เอง) */
export function cvNextRow(after: CvGridLine | undefined, key: string, start: string | null): CvGridLine {
  const y = after && Number.isInteger(Number(after.year)) && after.year.trim() ? Number(after.year) + 1 : 1;
  const auto = cvAutoDate(start, y);
  const prevAuto = after ? cvAutoDate(start, Number(after.year)) : null;
  const date = after?.date && ISO.test(after.date) && after.date !== prevAuto ? addMonthsIso(after.date, 12) : auto ?? "";
  return { key, year: String(y), date, value: "" };
}

export const sortCvGrid = (rows: CvGridLine[]) =>
  [...rows].sort((a, b) => (Number(a.year) || 999) - (Number(b.year) || 999));

/** ตาราง → แถวที่ส่งให้ set_insurance_cash_value_table · แถวว่างทั้งแถวข้ามไป */
export function cvGridToLines(rows: CvGridLine[], start: string | null): { lines: CvSaveLine[]; errors: string[] } {
  const lines: CvSaveLine[] = []; const errors: string[] = [];
  const seen = new Set<number>();
  rows.forEach((r, i) => {
    const no = `แถว ${i + 1}`;
    if (!r.year.trim() && !r.value.trim()) return;
    const y = Number(r.year);
    if (!Number.isInteger(y) || y < 1 || y > 120) { errors.push(`${no}: ปีกรมธรรม์ 1–120`); return; }
    if (seen.has(y)) { errors.push(`${no}: ปีที่ ${y} ซ้ำ`); return; }
    const v = gridNum(r.value);
    if (!r.value.trim() || !Number.isFinite(v) || v < 0) { errors.push(`${no}: มูลค่าต้องเป็นตัวเลขไม่ติดลบ`); return; }
    const auto = cvAutoDate(start, y);
    const date = r.date || auto;
    if (!date || !ISO.test(date)) { errors.push(`${no}: ใส่วันที่ (กรมธรรม์ยังไม่มีวันเริ่มสัญญา)`); return; }
    seen.add(y);
    lines.push({ policy_year: y, value: Math.round(v * 100) / 100, ...(date !== auto ? { value_date: date } : {}) });
  });
  lines.sort((a, b) => a.policy_year - b.policy_year);
  if (lines.length > 120) errors.push("ตารางยาวเกิน 120 ปี");
  return { lines, errors };
}
