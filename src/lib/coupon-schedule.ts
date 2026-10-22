// ตารางรับดอกเบี้ย / เงินต้นของหุ้นกู้ · FCN · Structured (ตกลง 22 ต.ค. 2026)
//   คำนวณจากข้อมูลหลักทุกครั้ง (ไม่เก็บเป็นตาราง) → แก้ข้อมูลหลักแล้วรายการเปลี่ยนตาม
//   วันรับนับย้อนจากวันครบกำหนดทีละ 1 / 3 / 6 / 12 เดือน จนถึงวันที่เริ่มถือ (รายการแรกของหลักทรัพย์)
//   ยอดต่องวด = เงินต้น × อัตรา % ÷ 100 × เดือนต่องวด ÷ 12 (ตอนบันทึกรับแก้เป็นยอดจริงได้)
//   งวดที่ "รับแล้ว" = มีรายการ Coupon / ดอกเบี้ยของหลักทรัพย์นี้ ตั้งแต่ 20 วันก่อนวันรับ จนก่อนงวดถัดไป (จับคู่ทีละงวดตามลำดับ)
//   เงินต้น "รับแล้ว" = มีรายการครบกำหนด (MATURITY) แล้ว

export const COUPON_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, SEMI_ANNUAL: 6, ANNUAL: 12 };
/** ตัวเลือกความถี่ในฟอร์มหุ้นกู้ (ค่าที่ฐานข้อมูลรับ · ih_coupon_frequency_ck) */
export const COUPON_FREQ_OPTIONS: [string, string][] = [
  ["MONTHLY", "ทุก 1 เดือน"], ["QUARTERLY", "ทุก 3 เดือน"], ["SEMI_ANNUAL", "ทุก 6 เดือน"], ["ANNUAL", "ทุก 1 ปี"], ["AT_MATURITY", "ครั้งเดียวตอนครบกำหนด"],
];
const EARLY_DAYS = 20;

export type SchedInput = {
  id: string; maturity_date: string | null; status: string;
  /** เงินต้น · อัตรา % ต่อปี · ความถี่ (หุ้นกู้: คอลัมน์ของหลักทรัพย์ · FCN: fcn_details) */
  face: number | null; rate: number | null; freq: string | null;
  /** วันเริ่มถือ (รายการแรก) · AT_MATURITY ใช้คิดจำนวนเดือน */
  start: string | null;
  /** มูลค่าปัจจุบัน — ใช้เป็นยอดเงินต้นเมื่อไม่ได้ใส่เงินต้น */
  current_value: number | null;
};
export type Receipt = { date: string; amount: number };
export type DueRow = {
  key: string; kind: "INTEREST" | "PRINCIPAL"; no: number; total: number; due: string;
  expected: number | null; received: Receipt | null;
};

function addMonths(iso: string, k: number, day: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
const shift = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86400000).toISOString().slice(0, 10);
const monthsBetween = (a: string, b: string) => {
  const [ya, ma, da] = a.split("-").map(Number), [yb, mb, db] = b.split("-").map(Number);
  return Math.max(0, (yb - ya) * 12 + (mb - ma) + (db - da) / 30);
};

/** วันรับดอกเบี้ยทุกงวด (เรียงเก่า → ใหม่) · ไม่มีข้อมูลพอ = [] */
export function couponDates(maturity: string, freq: string, start: string | null): string[] {
  if (freq === "AT_MATURITY") return [maturity];
  const step = COUPON_MONTHS[freq];
  if (!step) return [];
  const day = Number(maturity.slice(8, 10));
  const out: string[] = [];
  for (let k = 0; k < 600; k++) {
    const d = k === 0 ? maturity : addMonths(maturity, -k * step, day);
    if (start && d <= start) break;
    out.push(d);
  }
  return out.reverse();
}

export function buildSchedule(h: SchedInput, coupons: Receipt[], maturityTx: Receipt | null): DueRow[] {
  if (!h.maturity_date) return [];
  const closed = h.status !== "ACTIVE";
  // ถูกเรียกคืนก่อนกำหนด (Autocall / ขาย) → งวดหลังวันปิดไม่มีแล้ว
  const endDate = closed && maturityTx && maturityTx.date < h.maturity_date ? maturityTx.date : h.maturity_date;
  const rows: DueRow[] = [];
  const canInterest = h.face != null && h.face > 0 && h.rate != null && h.rate > 0 && !!h.freq;
  if (canInterest) {
    const dates = couponDates(h.maturity_date, h.freq!, h.start);
    const months = h.freq === "AT_MATURITY" ? (h.start ? monthsBetween(h.start, h.maturity_date) : 12) : COUPON_MONTHS[h.freq!];
    const amount = Math.round(h.face! * h.rate! / 100 * months / 12 * 100) / 100;
    const pool = [...coupons].sort((a, b) => a.date.localeCompare(b.date));
    const used = new Set<number>();
    dates.forEach((due, i) => {
      const lo = shift(due, -EARLY_DAYS);
      const hi = dates[i + 1] ? shift(dates[i + 1], -EARLY_DAYS) : "9999-12-31";
      const j = pool.findIndex((r, k) => !used.has(k) && r.date >= lo && r.date < hi);
      if (j >= 0) used.add(j);
      // ปิดแล้ว: งวดที่ยังไม่รับ แสดงเฉพาะเมื่อครบกำหนด / Autocall แล้ว และไม่เกินวันปิด (ขายไปแล้ว = ไม่ต้องรอรับ)
      if (closed && j < 0 && (!maturityTx || due > endDate)) return;
      rows.push({ key: `${h.id}:I:${due}`, kind: "INTEREST", no: i + 1, total: dates.length, due, expected: amount, received: j >= 0 ? pool[j] : null });
    });
  }
  if (!closed || maturityTx) {
    rows.push({ key: `${h.id}:P`, kind: "PRINCIPAL", no: 1, total: 1, due: endDate,
      expected: h.face ?? h.current_value, received: maturityTx });
  }
  return rows;
}

type HoldingCols = { id: string; status: string; maturity_date: string | null; current_value: number | null;
  face_value?: number | null; interest_rate?: number | null; coupon_frequency?: string | null };
type FcnCols = { principal: number | null; coupon_rate: number | null; coupon_frequency: string | null; issue_date: string | null; trade_date: string | null };
type TxCols = { transaction_type: string; transaction_date: string; amount: number | null };

/** ข้อมูลหลัก + รายการของหลักทรัพย์ → ตารางรับ (หุ้นกู้ใช้คอลัมน์ของหลักทรัพย์ · FCN ใช้ fcn_details เมื่อหลักทรัพย์ไม่ได้ใส่) */
export function scheduleOf(h: HoldingCols, fcn: FcnCols | null, txs: TxCols[]): DueRow[] {
  const n = (v: number | null | undefined) => (v == null ? null : Number(v));
  const firstTx = txs.filter((t) => t.transaction_type === "OPENING_BALANCE" || t.transaction_type === "BUY")
    .map((t) => t.transaction_date).sort()[0] ?? null;
  const mat = txs.filter((t) => t.transaction_type === "MATURITY").sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))[0];
  return buildSchedule({
    id: h.id, maturity_date: h.maturity_date, status: h.status, current_value: n(h.current_value),
    face: n(h.face_value) ?? n(fcn?.principal), rate: n(h.interest_rate) ?? n(fcn?.coupon_rate),
    freq: h.coupon_frequency ?? fcn?.coupon_frequency ?? null,
    start: fcn?.issue_date ?? fcn?.trade_date ?? firstTx,
  }, txs.filter((t) => t.transaction_type === "COUPON" || t.transaction_type === "INTEREST").map((t) => ({ date: t.transaction_date, amount: Number(t.amount ?? 0) })),
  mat ? { date: mat.transaction_date, amount: Number(mat.amount ?? 0) } : null);
}
