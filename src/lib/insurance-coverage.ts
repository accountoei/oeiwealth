/**
 * ตารางความคุ้มครองมาตรฐาน (ตกลง 7 พ.ย. 2026 · ปรับ 8 พ.ย. 2026)
 *   ใช้ 2 ที่: ฟอร์มเพิ่มกรมธรรม์ · หน้าต่าง "แก้ความคุ้มครอง" ของหน้ากรมธรรม์ (ทุกส่วนของเล่มในครั้งเดียว)
 *   แสดงเฉพาะแถวที่มี + ปุ่มเพิ่มหัวข้อมาตรฐานที่ยังไม่ได้ใส่ · "แสดงทุกหัวข้อ" = แถวว่างครบทุกหัวข้อ (แบบเดิม)
 *   ต่อแถว: วงเงิน · สูงสุด (จำนวน + รอบ ต่อครั้ง / ต่อปี / ตลอดสัญญา) · ชื่อ (เฉพาะ "อื่น ๆ") · หมายเหตุ · ช่องว่าง = ไม่คุ้มครอง
 *   รอบ: เฉพาะที่ใช้กับหัวข้อนั้นได้ (periodAllowed) · ใส่จำนวนแล้วเลือกรอบที่พบบ่อยให้ก่อน (PERIOD_DEFAULT)
 *   บันทึกด้วย set_insurance_coverages (แถวเดิมที่ล้างวงเงิน / กดลบ = ลบ · แถวที่ไม่เปลี่ยน = ไม่แตะ)
 *   ไฟล์นี้ไม่มี import (ทดสอบด้วย node scripts/insurance-grid.test.mjs)
 */

export type CovExisting = {
  id: string; coverage_type: string; limit_amount: number | string; max_count?: number | null; count_period?: string | null; label?: string | null;
  as_of_date?: string | null; notes?: string | null;
};
/** asOf = "ณ วันที่" เดิม (เลิกแสดงแล้ว · ส่งค่าเดิมกลับเพื่อไม่ให้แถวที่ไม่ได้แก้นับเป็นแก้) */
export type CovRow = {
  key: string; id?: string; type: string; amount: string; count: string; period: string; label: string; notes: string; waiver: boolean; asOf: string;
};
export type CovSave = {
  id?: string; coverage_type: string; limit_amount: number; max_count: number | null; count_period: string | null; label: string | null;
  as_of_date: string | null; notes: string | null;
};

let seq = 0;
/** แถวว่างของหัวข้อ (key ไม่ส่ง = สร้างใหม่) */
export const blankCovRow = (type: string, key = `n${++seq}`): CovRow =>
  ({ key, type, amount: "", count: "", period: "", label: "", notes: "", waiver: false, asOf: "" });
/** key ของแถวว่างที่แสดงไว้ให้กรอก ("แสดงทุกหัวข้อ" · คงเดิมหลังพิมพ์ตัวแรก → ช่องไม่หลุดโฟกัส) */
export const blankKey = (type: string) => `blank:${type}`;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const PERIODS = ["PER_EVENT", "PER_YEAR", "PER_TERM"];
/** รอบที่เลือกได้ของหัวข้อ (ไม่มีในรายการ = ได้ทุกรอบ) · OPD ต่อครั้ง / โรคร้ายแรง / ทุพพลภาพรายงวด ไม่มี "ต่อครั้ง" (ตกลง 8 พ.ย. 2026) */
const PERIOD_ONLY: Record<string, string[]> = {
  OPD_PER_VISIT: ["PER_YEAR", "PER_TERM"], CI_EARLY: ["PER_YEAR", "PER_TERM"], CRITICAL_ILLNESS: ["PER_YEAR", "PER_TERM"], DISABILITY_INCOME: ["PER_YEAR", "PER_TERM"],
};
/** รอบนี้เลือกได้ไหม (รอบที่บันทึกไว้แล้วยังแสดงเสมอ → ไม่หายเงียบ ๆ) */
export const periodAllowed = (type: string, period: string, current?: string | null) =>
  period === (current ?? "") || !PERIOD_ONLY[type] || PERIOD_ONLY[type].includes(period);
/** รอบที่เลือกให้ก่อนเมื่อใส่จำนวนสูงสุด (ตกลง 8 พ.ย. 2026) */
export const PERIOD_DEFAULT: Record<string, string> = {
  ROOM_PER_DAY: "PER_EVENT", HOSPITAL_CASH_PER_DAY: "PER_EVENT", OPD_PER_VISIT: "PER_YEAR",
  CI_EARLY: "PER_TERM", CRITICAL_ILLNESS: "PER_TERM", DISABILITY_INCOME: "PER_TERM",
};
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
/** ตัวเลขจากช่อง (ตัดคอมมา / % ท้าย · ว่าง = NaN) */
const num = (s: string) => { const t = s.replace(/,/g, "").replace(/%$/, "").trim(); return t === "" ? NaN : Number(t); };

/** แถวเริ่มต้นจากรายการเดิม (ตามลำดับเดิม) */
export function rowsFromExisting(xs: CovExisting[]): CovRow[] {
  return xs.map((c) => ({
    key: c.id, id: c.id, type: c.coverage_type,
    amount: c.coverage_type === "WAIVER" ? "" : c.coverage_type === "COPAY" ? String(Number(c.limit_amount)) : fmt(Number(c.limit_amount)),
    count: c.max_count ? String(c.max_count) : "", period: c.count_period ?? "", label: c.label ?? "", notes: c.notes ?? "",
    waiver: c.coverage_type === "WAIVER", asOf: c.as_of_date ?? "",
  }));
}

/** แถวที่กรอกแล้ว (มีวงเงิน หรือ ติ๊ก "มีสิทธิ์" ของยกเว้นเบี้ย) */
export const covFilled = (r: CovRow) => (r.type === "WAIVER" ? r.waiver : r.amount.trim() !== "");

/** หัวข้อที่แสดงเมื่อกด "แสดงทุกหัวข้อ" (เรียงตาม order): ตามประเภทกรมธรรม์ (หรือทุกหัวข้อ) + หัวข้อที่มีแถวอยู่แล้ว */
export function visibleCovTypes(order: string[], forType: string[] | undefined, rows: CovRow[], all: boolean): string[] {
  const has = new Set(rows.map((r) => r.type));
  return order.filter((t) => all || !forType || forType.includes(t) || has.has(t));
}

/** ปุ่ม "+ หัวข้อ" ที่ยังไม่ได้ใส่ (ตามประเภทกรมธรรม์ · "อื่น ๆ" เพิ่มได้หลายแถวเสมอ) */
export function addableCovTypes(order: string[], forType: string[] | undefined, rows: CovRow[]): string[] {
  const has = new Set(rows.map((r) => r.type));
  return order.filter((t) => (!forType || forType.includes(t)) && (t === "OTHER" || !has.has(t)));
}

/** แถวที่มี เรียงตามหัวข้อมาตรฐาน (ภายในหัวข้อเดียวกันตามลำดับที่เพิ่ม) */
export const sortCovRows = (order: string[], rows: CovRow[]) =>
  rows.map((r, i) => ({ r, i, o: order.indexOf(r.type) < 0 ? order.length : order.indexOf(r.type) }))
    .sort((a, b) => a.o - b.o || a.i - b.i).map((x) => x.r);

/** แก้ช่องของแถว · แถวว่างที่แสดงไว้ (blankKey) = เพิ่มเป็นแถวจริงตอนพิมพ์ตัวแรก */
export function patchCovRow(rows: CovRow[], type: string, key: string, p: Partial<CovRow>): CovRow[] {
  const cur = rows.find((r) => r.key === key) ?? blankCovRow(type, key);
  const next = { ...cur, ...p };
  // ใส่จำนวนสูงสุดครั้งแรกโดยยังไม่ได้เลือกรอบ → เลือกรอบที่พบบ่อยให้ก่อน (แก้ได้ · ล้างรอบแล้วแก้จำนวนต่อ = ไม่เลือกให้อีก)
  if (p.count !== undefined && p.period === undefined && !cur.count.trim() && p.count.trim() && !cur.period && PERIOD_DEFAULT[type]) next.period = PERIOD_DEFAULT[type];
  return rows.some((r) => r.key === key) ? rows.map((r) => (r.key === key ? next : r)) : [...rows, next];
}

/** ข้อมูลที่ส่งบันทึก + ข้อผิดพลาด (ชื่อหัวข้อจาก label) */
export function covPayload(rows: CovRow[], label: (t: string) => string): { rows: CovSave[]; errors: string[] } {
  const out: CovSave[] = [];
  const errors: string[] = [];
  rows.forEach((r) => {
    const own = r.type === "OTHER" ? (r.label.trim() || r.notes.trim()) : "";
    const name = label(r.type) + (own ? ` (${own})` : "");
    if (!covFilled(r)) {
      // แถวเดิมที่ล้างวงเงิน (หรือเอาติ๊กออก) = ลบ (ถามยืนยันตอนบันทึก) · แถวใหม่ที่กรอกช่องอื่นไว้แต่ไม่มีวงเงิน = เตือน (กันข้อมูลหาย)
      if (!r.id && (r.count.trim() || r.period || r.label.trim() || r.notes.trim()))
        errors.push(`${name}: ${r.type === "WAIVER" ? "ติ๊ก “มีสิทธิ์”" : "ใส่วงเงิน"} หรือกดลบแถวนี้`);
      return;
    }
    const amt = r.type === "WAIVER" ? 0 : num(r.amount);
    if (!Number.isFinite(amt) || amt < 0) { errors.push(`${name}: วงเงินต้องเป็นตัวเลข 0 ขึ้นไป`); return; }
    if (r.type === "COPAY" && amt > 100) { errors.push(`${name}: ร่วมจ่ายไม่เกิน 100%`); return; }
    if (r.type === "OTHER" && !own) { errors.push(`${name}: ใส่ชื่อความคุ้มครอง`); return; }
    const cnt = r.count.trim() === "" ? null : num(r.count);
    if (cnt !== null && (!Number.isInteger(cnt) || cnt <= 0)) { errors.push(`${name}: สูงสุดต้องเป็นจำนวนเต็มมากกว่า 0`); return; }
    if (r.period && !PERIODS.includes(r.period)) { errors.push(`${name}: รอบไม่ถูกต้อง`); return; }
    out.push({
      ...(r.id ? { id: r.id } : {}), coverage_type: r.type, limit_amount: amt, max_count: cnt, count_period: r.period || null,
      label: r.type === "OTHER" ? r.label.trim() || null : null, as_of_date: ISO.test(r.asOf) ? r.asOf : null, notes: r.notes.trim() || null,
    });
  });
  return { rows: out, errors };
}

/** จำนวนรายการเดิมที่จะถูกลบ (ล้างวงเงิน หรือกดลบ) */
export const covRemoved = (existingIds: string[], payload: CovSave[]) => existingIds.filter((id) => !payload.some((r) => r.id === id)).length;

/** ข้อมูลต่อส่วน (คุ้มครองเฉพาะ · ชื่อแบบ) ตัดช่องว่าง · ว่าง = null */
export const partText = (s: string, max: number) => s.trim().slice(0, max) || null;

/* ---------------------------------------------------------------- สัญญาเพิ่มเติม (ตกลง 7 พ.ย. 2026 · ชื่อแบบ / คุ้มครองเฉพาะ 8 พ.ย. 2026)
 * ฟอร์มเพิ่มกรมธรรม์ (ส่วน "สัญญาเพิ่มเติม (ถ้ามี)") · ปุ่ม "+ เพิ่มสัญญาเพิ่มเติม" ในหน้าเล่ม
 *   กรอกเฉพาะ ประเภท · ชื่อแบบ · ทุน · เบี้ยต่อปี · วันสิ้นสุด · หมายเหตุ + คุ้มครองเฉพาะ / ตารางความคุ้มครอง · ที่เหลือใช้ของสัญญาหลัก
 *   บันทึกด้วย create_insurance_booklet (ผิดส่วนเดียว = ไม่บันทึกเลยทั้งเล่ม)
 */
export type RiderRow = { key: string; type: string; plan: string; scope: string; sum: string; premium: string; end: string; notes: string; cov: CovRow[] };
export type RiderSave = {
  insurance_type: string; plan_name: string | null; coverage_scope: string | null; insured_amount: number | null; premium: number | null;
  end_date: string | null; notes: string | null; coverages: CovSave[];
};

/** สัญญาเพิ่มเติมว่าง (ค่าเริ่มต้น = สุขภาพ · พบบ่อยสุด) */
export const blankRider = (type = "HEALTH"): RiderRow => ({ key: `r${++seq}`, type, plan: "", scope: "", sum: "", premium: "", end: "", notes: "", cov: [] });

/**
 * ข้อมูลสัญญาเพิ่มเติมที่ส่งบันทึก + ข้อผิดพลาด (ขึ้นต้นด้วย "สัญญาเพิ่มเติม N")
 *   policyNo = เลขกรมธรรม์ของเล่ม (ต้องมีเมื่อมีสัญญาเพิ่มเติม)
 */
export function riderPayload(rs: RiderRow[], label: (t: string) => string, policyNo: string | null): { rows: RiderSave[]; errors: string[] } {
  const rows: RiderSave[] = [];
  const errors: string[] = [];
  if (rs.length > 0 && !(policyNo ?? "").replace(/\s/g, ""))
    errors.push("สัญญาเพิ่มเติม: ใส่เลขกรมธรรม์ก่อน (สัญญาเพิ่มเติมผูกกับเล่มด้วยบริษัท + เลขกรมธรรม์)");
  rs.forEach((r, i) => {
    const name = `สัญญาเพิ่มเติม ${i + 1}`;
    const sum = num(r.sum);
    const prem = num(r.premium);
    const cov = covPayload(r.cov, label);
    const bad: string[] = [];
    if (r.sum.trim() === "" && r.premium.trim() === "") bad.push("ใส่ทุนประกันหรือเบี้ย (หรือกดลบส่วนนี้)");
    if (r.sum.trim() !== "" && (!Number.isFinite(sum) || sum < 0)) bad.push("ทุนประกันต้องเป็นตัวเลข 0 ขึ้นไป");
    if (r.premium.trim() !== "" && (!Number.isFinite(prem) || prem < 0)) bad.push("เบี้ยต้องเป็นตัวเลข 0 ขึ้นไป");
    if (r.end && !ISO.test(r.end)) bad.push("วันสิ้นสุดไม่ถูกต้อง");
    bad.forEach((e) => errors.push(`${name}: ${e}`));
    cov.errors.forEach((e) => errors.push(`${name} · ${e}`));
    if (bad.length || cov.errors.length) return;
    rows.push({
      // คุ้มครองเฉพาะ: ประกันสุขภาพ / อุบัติเหตุเท่านั้น (เปลี่ยนประเภทหลังพิมพ์ = ไม่ส่ง)
      insurance_type: r.type, plan_name: partText(r.plan, 200), coverage_scope: r.type === "HEALTH" || r.type === "ACCIDENT" ? partText(r.scope, 100) : null,
      insured_amount: r.sum.trim() === "" ? null : sum, premium: r.premium.trim() === "" ? null : prem,
      end_date: r.end || null, notes: r.notes.trim() || null, coverages: cov.rows,
    });
  });
  return { rows, errors };
}
