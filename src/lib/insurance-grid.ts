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
