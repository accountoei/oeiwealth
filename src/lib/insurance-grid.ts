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

/**
 * ตารางเบี้ยทั้งเล่ม (ตกลง 8 พ.ย. 2026 · ปุ่ม "แก้ตารางเบี้ย" ปุ่มเดียวของเล่มที่มีสัญญาเพิ่มเติม)
 *   1 แถว = 1 วันครบกำหนด · 1 คอลัมน์ = 1 ส่วนของเล่ม (สัญญาหลัก / สัญญาเพิ่มเติม) + รวม · ยอดว่าง = ส่วนนั้นไม่มีงวดวันนั้น
 *   ช่องที่จ่ายแล้ว (locked) แก้ไม่ได้ · แถวที่มีช่องจ่ายแล้วแก้วันที่ / ลบแถวไม่ได้ · บันทึกทุกส่วนพร้อมกัน (set_insurance_booklet_schedule)
 */
export type BookCell = { amount: string; skipped: boolean; notes: string; locked?: string | null };
export type BookRow = { key: string; due: string; cells: Record<string, BookCell> };
export type BookPart = { id: string; label: string };
export type BookCurrent = { policy_id: string; due_date: string; amount: number; notes: string | null; skipped: boolean; locked: string | null };
export type BookSavePart = { policy_id: string; label: string; lines: SaveLine[] };

const blankCell = (): BookCell => ({ amount: "", skipped: false, notes: "" });
/** ช่องที่มียอด (ไม่นับช่องว่าง) */
const hasAmt = (c: BookCell | undefined) => !!c && (!!c.locked || c.amount.trim() !== "");
export const bookLocked = (r: BookRow) => Object.values(r.cells).some((c) => !!c.locked);
export const bookEmpty = (r: BookRow) => !Object.values(r.cells).some(hasAmt);
/** รวมต่อแถว (ไม่นับช่องที่ติ๊กไม่ได้จ่าย) */
export const bookTotal = (r: BookRow) => Object.values(r.cells).reduce((s, c) => s + (c.skipped ? 0 : Math.max(0, gridNum(c.amount) || 0)), 0);
/** ติ๊กไม่ได้จ่ายทั้งแถว = ทุกช่องที่มียอดและยังแก้ได้ติ๊กไว้ */
export const bookSkipped = (r: BookRow) => {
  const xs = Object.values(r.cells).filter((c) => !c.locked && c.amount.trim() !== "");
  return xs.length > 0 && xs.every((c) => c.skipped);
};

/** งวดปัจจุบันของทุกส่วน → แถว (วันเดียวกัน = แถวเดียว · งวดซ้ำวันในส่วนเดียวกันแยกแถว) */
export function bookRows(current: BookCurrent[], newKey: () => string): BookRow[] {
  const rows: BookRow[] = [];
  [...current].sort((a, b) => a.due_date.localeCompare(b.due_date)).forEach((x) => {
    const cell: BookCell = { amount: Number(x.amount).toFixed(2), skipped: x.skipped, notes: x.notes ?? "", locked: x.locked };
    const hit = rows.find((r) => r.due === x.due_date && !r.cells[x.policy_id]);
    if (hit) hit.cells[x.policy_id] = cell;
    else rows.push({ key: newKey(), due: x.due_date, cells: { [x.policy_id]: cell } });
  });
  return rows;
}

export const sortBook = (rows: BookRow[]) =>
  rows.map((r, i) => ({ r, i })).sort((a, b) => (a.r.due || "9999").localeCompare(b.r.due || "9999") || a.i - b.i).map((x) => x.r);

export const bookEvery = (rows: BookRow[]) => guessEvery(rows.map((r) => ({ key: r.key, due: r.due, amount: "", type: "", skipped: false, notes: "" })));

/** แถวใหม่ต่อจากแถวนี้: วันที่ + ระยะห่างเดิม · ยอดของทุกส่วนเท่าแถวเดิม */
export function bookNextRow(after: BookRow | undefined, every: number, key: string, fallbackDue: string, partIds: string[]): BookRow {
  const cells: Record<string, BookCell> = {};
  partIds.forEach((id) => { const c = after?.cells[id]; if (c && c.amount.trim() !== "") cells[id] = { amount: c.amount, skipped: false, notes: "" }; });
  return { key, due: after && ISO.test(after.due) ? addMonthsIso(after.due, every) : fallbackDue, cells };
}

/** ใช้ยอดของแถว i กับแถวถัดไปทั้งหมด (เฉพาะส่วนที่แถว i มียอด · ช่องที่จ่ายแล้วไม่แตะ) */
export function bookFillDown(rows: BookRow[], i: number): BookRow[] {
  const src = rows[i];
  return rows.map((r, j) => {
    if (j <= i) return r;
    const cells = { ...r.cells };
    Object.entries(src.cells).forEach(([id, c]) => {
      if (c.amount.trim() === "" || cells[id]?.locked) return;
      cells[id] = { ...(cells[id] ?? blankCell()), amount: c.amount };
    });
    return { ...r, cells };
  });
}

/** ตั้งยอดช่องเดียว (ยอดว่าง = ส่วนนั้นไม่มีงวดในแถวนี้) */
export function bookSetCell(rows: BookRow[], i: number, partId: string, amount: string): BookRow[] {
  return rows.map((r, j) => (j === i && !r.cells[partId]?.locked
    ? { ...r, cells: { ...r.cells, [partId]: { ...(r.cells[partId] ?? blankCell()), amount } } } : r));
}

/** ติ๊ก / เลิกติ๊ก "ไม่ได้จ่าย" ทั้งแถว (ช่องที่จ่ายแล้วไม่แตะ) */
export function bookSetSkipped(rows: BookRow[], i: number, skipped: boolean): BookRow[] {
  return rows.map((r, j) => {
    if (j !== i) return r;
    const cells = Object.fromEntries(Object.entries(r.cells).map(([id, c]) => [id, c.locked ? c : { ...c, skipped }]));
    return { ...r, cells };
  });
}

/** หมายเหตุของแถว (ช่องที่ยังแก้ได้ · ต่างกัน = ต่อกันด้วย " · ") */
export const bookNotes = (r: BookRow) => [...new Set(Object.values(r.cells).filter((c) => !c.locked).map((c) => c.notes.trim()).filter(Boolean))].join(" · ");

/** แก้หมายเหตุของแถว = ทุกช่องที่ยังแก้ได้ในแถวนั้น (ช่องที่จ่ายแล้วไม่แตะ) */
export function bookSetNotes(rows: BookRow[], i: number, notes: string): BookRow[] {
  return rows.map((r, j) => (j !== i ? r
    : { ...r, cells: Object.fromEntries(Object.entries(r.cells).map(([id, c]) => [id, c.locked ? c : { ...c, notes }])) }));
}

/** ลบแถวว่าง (ไม่มียอดทุกส่วน · ไม่มีช่องที่จ่ายแล้ว) */
const dropEmpty = (rows: BookRow[]) => rows.filter((r) => !bookEmpty(r) || bookLocked(r));

/**
 * ใส่ยอดจากสูตร / Excel ลงคอลัมน์ของส่วนต่าง ๆ · data[].amounts ตามลำดับ partIds (null / 0 = ไม่มีงวด)
 *   replace = ล้างช่องที่ยังแก้ได้ของส่วนที่มีข้อมูลมาก่อน (ส่วนที่ไม่มีข้อมูลมาไม่แตะ) · add = เพิ่ม / ทับเฉพาะวันที่มีข้อมูล
 */
export function bookPut(rows: BookRow[], partIds: string[], data: { due: string; amounts: (number | null)[] }[], how: "replace" | "add", newKey: () => string): BookRow[] {
  const touched = partIds.filter((_, k) => data.some((d) => (d.amounts[k] ?? 0) > 0));
  let out = rows.map((r) => ({ ...r, cells: { ...r.cells } }));
  if (how === "replace") {
    out = out.map((r) => {
      touched.forEach((id) => { if (r.cells[id] && !r.cells[id].locked) delete r.cells[id]; });
      return r;
    });
  }
  data.forEach((d) => {
    partIds.forEach((id, k) => {
      const v = d.amounts[k];
      if (v == null || !(v > 0)) return;
      const amount = v.toFixed(2);
      const row = out.find((r) => r.due === d.due && !r.cells[id]?.locked);
      if (row) row.cells[id] = { ...(row.cells[id] ?? blankCell()), amount };
      else out.push({ key: newKey(), due: d.due, cells: { [id]: { amount, skipped: false, notes: "" } } });
    });
  });
  return sortBook(dropEmpty(out));
}

/** แถว → งวดที่จะบันทึกต่อส่วน (ช่องที่จ่ายแล้วไม่ส่ง · ฐานข้อมูลเก็บไว้เอง) + ข้อผิดพลาด */
export function bookToParts(rows: BookRow[], parts: BookPart[], goLive: string | null): { parts: BookSavePart[]; errors: string[]; count: number } {
  const errors: string[] = [];
  const out: BookSavePart[] = parts.map((p) => ({ policy_id: p.id, label: p.label, lines: [] }));
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const no = `แถวที่ ${i + 1}`;
    if (bookLocked(r)) return void seen.set(r.due, i);
    if (bookEmpty(r)) { errors.push(`${no}: ใส่ยอดอย่างน้อย 1 ส่วน หรือกดลบแถว`); return; }
    if (!ISO.test(r.due)) { errors.push(`${no}: ใส่วันครบกำหนด`); return; }
    if (seen.has(r.due)) { errors.push(`${no} (${thShort(r.due)}): วันซ้ำกับแถวที่ ${(seen.get(r.due) ?? 0) + 1} — ใส่ยอดในแถวเดียวกัน`); return; }
    seen.set(r.due, i);
  });
  parts.forEach((p, k) => {
    const keptMax = rows.filter((r) => r.cells[p.id]?.locked && ISO.test(r.due)).map((r) => r.due).sort().at(-1) ?? null;
    rows.forEach((r, i) => {
      const c = r.cells[p.id];
      if (!c || c.locked || c.amount.trim() === "" || !ISO.test(r.due)) return;
      const no = `แถวที่ ${i + 1} · ${p.label}`;
      const amt = gridNum(c.amount);
      if (!Number.isFinite(amt) || amt <= 0) { errors.push(`${no}: ยอดต้องเป็นตัวเลขมากกว่า 0 (ว่าง = ไม่มีงวด)`); return; }
      if (keptMax && r.due <= keptMax && (!goLive || r.due >= goLive)) {
        errors.push(`${no} (${thShort(r.due)}): งวดหลัง Go-live ที่ยังไม่ชำระต้องอยู่หลังงวดที่ชำระแล้ว (${thShort(keptMax)})`);
        return;
      }
      out[k].lines.push({ due_date: r.due, amount: Math.round(amt * 100) / 100,
        ...(c.notes.trim() ? { notes: c.notes.trim() } : {}), ...(c.skipped ? { skipped: true } : {}) });
    });
    if (out[k].lines.length > 600) errors.push(`${p.label}: ตารางยาวเกิน 600 งวด`);
  });
  return { parts: out, errors, count: out.reduce((s, x) => s + x.lines.length, 0) };
}

/**
 * อ่านตารางจาก Excel / ข้อความที่วาง: วันครบกำหนด · ยอดส่วนที่ 1 · ยอดส่วนที่ 2 … (หัวตารางมีหรือไม่มีก็ได้)
 *   toIso / toNum ส่งเข้ามา (ไฟล์นี้ไม่มี import) · ช่องว่าง / "-" / 0 = ส่วนนั้นไม่มีงวดวันนั้น
 */
export function parseBookTable(rows: unknown[][], nParts: number, toIso: (v: unknown) => string | null, toNum: (v: unknown) => number):
  { data: { due: string; amounts: (number | null)[] }[]; errors: string[] } {
  const data: { due: string; amounts: (number | null)[] }[] = [];
  const errors: string[] = [];
  rows.forEach((row, r) => {
    const cells = row ?? [];
    if (cells.every((c) => c == null || (typeof c === "string" && c.trim() === ""))) return;
    const di = cells.findIndex((c) => toIso(c) !== null);
    if (di < 0) return;                                   // หัวตาราง / บรรทัดที่ไม่มีวันที่
    const due = toIso(cells[di]) as string;
    const amounts: (number | null)[] = [];
    let bad = false;
    for (let k = 0; k < nParts; k++) {
      const v = cells[di + 1 + k];
      const n = toNum(v);
      if (Number.isNaN(n)) { bad = true; amounts.push(null); continue; }
      if (n < 0) { errors.push(`แถว ${r + 1}: ยอดติดลบ`); bad = true; amounts.push(null); continue; }
      amounts.push(n > 0 ? Math.round(n * 100) / 100 : null);
    }
    if (bad && amounts.every((a) => a == null)) { errors.push(`แถว ${r + 1}: ยอดไม่ใช่ตัวเลข`); return; }
    if (amounts.every((a) => a == null)) return;
    data.push({ due, amounts });
  });
  data.sort((a, b) => a.due.localeCompare(b.due));
  return { data, errors };
}
