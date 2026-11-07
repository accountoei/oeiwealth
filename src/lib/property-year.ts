// รายได้สุทธิทั้งปีของหน้าทรัพย์สิน (ตกลง 7 พ.ย. 2026)
//   ยอดจริงตั้งแต่ ม.ค. ถึงเดือนที่เลือก
//   ปีที่ Go-live: เดือนก่อน Go-live ไม่มีข้อมูลในระบบ → เติมให้
//     รายได้ = ค่าเฉลี่ยรายได้จริงต่อเดือนของเดือนที่จบแล้วหลัง Go-live × จำนวนเดือนก่อน Go-live
//     ค่าใช้จ่าย = ค่าใช้จ่ายประจำตามงวดของเดือนก่อน Go-live (ไม่เอาค่าใช้จ่ายครั้งเดียวมาคูณ)
// ไม่ import ไฟล์อื่น (ทดสอบด้วย node scripts/property-year.test.mjs ได้ตรง ๆ)

export type YearSpan = {
  year: number;
  /** ม.ค. → เดือนที่เลือก (จำนวนเดือน · ใช้ปรับเป็นต่อปี) */
  months: number;
  /** วันแรกที่ใช้ยอดจริง (ปีที่ Go-live = วันแรกของเดือน Go-live) */
  actualFrom: string;
  /** จำนวนเดือนก่อน Go-live ที่ต้องเติม (ม.ค. → เดือนนี้) · 0 = ไม่ต้องเติม */
  fillMonths: number;
  /** เดือนที่ใช้หาค่าเฉลี่ยรายได้ (วันแรก..วันสุดท้าย) */
  avgFrom: string;
  avgTo: string;
  avgMonths: number;
  /** เดือนที่ใช้ตั้งงวดของค่าใช้จ่ายประจำที่ไม่ได้ระบุเดือน (= เดือน Go-live เหมือน v_property_cost_tracking) */
  anchorMonth: number;
};

const pad = (m: number) => String(m).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

/** ช่วงเดือนของปีที่เลือก: ym = "YYYY-MM" (เดือนที่เลือก) · today = "YYYY-MM-DD" */
export function yearSpan(ym: string, goLive: string | null | undefined, today: string): YearSpan {
  const year = Number(ym.slice(0, 4)), sel = Number(ym.slice(5, 7));
  const glMonth = goLive ? Number(goLive.slice(5, 7)) : 1;
  // Go-live ปีเดียวกับที่เลือก → เดือนก่อน Go-live ต้องเติม · ปีอื่น = ยอดจริงทั้งปี
  const start = goLive && Number(goLive.slice(0, 4)) === year ? Math.min(glMonth, sel) : 1;
  // ค่าเฉลี่ย: เดือนที่จบแล้ว (เดือนปัจจุบันยังไม่จบ ไม่นับ) · ยังไม่มีเดือนที่จบ → ใช้ถึงเดือนที่เลือก
  let last = ym < today.slice(0, 7) ? sel : sel - 1;
  if (last < start) last = sel;
  return {
    year, months: sel, actualFrom: `${year}-${pad(start)}-01`, fillMonths: start - 1,
    avgFrom: `${year}-${pad(start)}-01`, avgTo: lastDay(year, last), avgMonths: last - start + 1, anchorMonth: glMonth,
  };
}

/** จำนวนงวดของค่าใช้จ่ายประจำในเดือน from..to (1–12) · perYear = งวดต่อปี (PERIODS_PER_YEAR: 12 / 4 / 1)
 *  งวดเริ่มที่ dueMonth (ไม่ระบุ = anchorMonth) แล้วเว้นตามความถี่ */
export function periodsIn(perYear: number | undefined, dueMonth: number | null, anchorMonth: number, from: number, to: number): number {
  const per = perYear ?? 0;
  if (!per || 12 % per !== 0) return 0;
  const step = 12 / per, a = dueMonth ?? anchorMonth;
  let n = 0;
  for (let m = from; m <= to; m++) if ((((m - a) % step) + step) % step === 0) n++;
  return n;
}
