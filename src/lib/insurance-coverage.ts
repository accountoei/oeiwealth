/**
 * ตารางความคุ้มครองมาตรฐาน (ตกลง 7 พ.ย. 2026): หัวข้อตามประเภทกรมธรรม์ · กรอกวงเงิน / สูงสุด / ณ วันที่ / หมายเหตุ · ช่องว่าง = ไม่คุ้มครอง
 *   ใช้ 2 ที่: ฟอร์มเพิ่มกรมธรรม์ · หน้าต่าง "แก้ความคุ้มครอง" ของหน้ากรมธรรม์ (ทุกส่วนของเล่มในครั้งเดียว)
 *   บันทึกด้วย set_insurance_coverages (แถวเดิมที่ล้างช่องแล้ว = ลบ · แถวที่ไม่เปลี่ยน = ไม่แตะ)
 *   ไฟล์นี้ไม่มี import (ทดสอบด้วย node scripts/insurance-grid.test.mjs)
 */

export type CovExisting = {
  id: string; coverage_type: string; limit_amount: number | string; max_count?: number | null; as_of_date?: string | null; notes?: string | null;
};
export type CovRow = { key: string; id?: string; type: string; amount: string; count: string; asOf: string; notes: string; waiver: boolean };
export type CovSave = { id?: string; coverage_type: string; limit_amount: number; max_count: number | null; as_of_date: string | null; notes: string | null };

let seq = 0;
/** แถวว่างของหัวข้อ (key ไม่ส่ง = สร้างใหม่) */
export const blankCovRow = (type: string, key = `n${++seq}`): CovRow => ({ key, type, amount: "", count: "", asOf: "", notes: "", waiver: false });
/** key ของแถวว่างที่แสดงไว้ให้กรอก (คงเดิมหลังพิมพ์ตัวแรก → ช่องไม่หลุดโฟกัส) */
export const blankKey = (type: string) => `blank:${type}`;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
/** ตัวเลขจากช่อง (ตัดคอมมา / % ท้าย · ว่าง = NaN) */
const num = (s: string) => { const t = s.replace(/,/g, "").replace(/%$/, "").trim(); return t === "" ? NaN : Number(t); };

/** แถวเริ่มต้นจากรายการเดิม (ตามลำดับเดิม) */
export function rowsFromExisting(xs: CovExisting[]): CovRow[] {
  return xs.map((c) => ({
    key: c.id, id: c.id, type: c.coverage_type,
    amount: c.coverage_type === "WAIVER" ? "" : c.coverage_type === "COPAY" ? String(Number(c.limit_amount)) : fmt(Number(c.limit_amount)),
    count: c.max_count ? String(c.max_count) : "", asOf: c.as_of_date ?? "", notes: c.notes ?? "", waiver: c.coverage_type === "WAIVER",
  }));
}

/** แถวที่กรอกแล้ว (มีวงเงิน หรือ ติ๊ก "มีสิทธิ์" ของยกเว้นเบี้ย) */
export const covFilled = (r: CovRow) => (r.type === "WAIVER" ? r.waiver : r.amount.trim() !== "");

/**
 * หัวข้อที่แสดง (เรียงตาม order): ตามประเภทกรมธรรม์ (หรือทุกหัวข้อ) + หัวข้อที่มีรายการเดิมอยู่แล้ว
 *   แถวที่กรอกไว้ในหัวข้อที่ซ่อน (เช่น เปลี่ยนประเภทในฟอร์มเพิ่มกรมธรรม์) ไม่แสดงและไม่บันทึก
 */
export function visibleCovTypes(order: string[], forType: string[] | undefined, rows: CovRow[], all: boolean): string[] {
  const has = new Set(rows.filter((r) => r.id).map((r) => r.type));
  return order.filter((t) => all || !forType || forType.includes(t) || has.has(t));
}

/** แก้ช่องของแถว · แถวว่างที่แสดงไว้ (blankKey) = เพิ่มเป็นแถวจริงตอนพิมพ์ตัวแรก */
export function patchCovRow(rows: CovRow[], type: string, key: string, p: Partial<CovRow>): CovRow[] {
  return rows.some((r) => r.key === key) ? rows.map((r) => (r.key === key ? { ...r, ...p } : r)) : [...rows, { ...blankCovRow(type, key), ...p }];
}

/** ข้อมูลที่ส่งบันทึก + ข้อผิดพลาด (ชื่อหัวข้อจาก label) · เฉพาะหัวข้อที่แสดง */
export function covPayload(rows: CovRow[], types: string[], label: (t: string) => string): { rows: CovSave[]; errors: string[] } {
  const out: CovSave[] = [];
  const errors: string[] = [];
  rows.filter((r) => types.includes(r.type)).forEach((r) => {
    const name = label(r.type) + (r.type === "OTHER" && r.notes.trim() ? ` (${r.notes.trim()})` : "");
    if (!covFilled(r)) {
      // แถวเดิมที่ล้างวงเงิน (หรือเอาติ๊กออก) = ลบ (ถามยืนยันตอนบันทึก) · แถวใหม่ที่กรอกช่องอื่นไว้แต่ไม่มีวงเงิน = เตือน (กันข้อมูลหาย)
      if (!r.id && (r.count.trim() || r.asOf || r.notes.trim()))
        errors.push(`${name}: ${r.type === "WAIVER" ? "ติ๊ก “มีสิทธิ์”" : "ใส่วงเงิน"} หรือล้างช่องอื่นในแถวนี้`);
      return;
    }
    const amt = r.type === "WAIVER" ? 0 : num(r.amount);
    if (!Number.isFinite(amt) || amt < 0) { errors.push(`${name}: วงเงินต้องเป็นตัวเลข 0 ขึ้นไป`); return; }
    if (r.type === "COPAY" && amt > 100) { errors.push(`${name}: ร่วมจ่ายไม่เกิน 100%`); return; }
    const cnt = r.count.trim() === "" ? null : num(r.count);
    if (cnt !== null && (!Number.isInteger(cnt) || cnt <= 0)) { errors.push(`${name}: สูงสุดต้องเป็นจำนวนเต็มมากกว่า 0`); return; }
    if (r.asOf && !ISO.test(r.asOf)) { errors.push(`${name}: วันที่ไม่ถูกต้อง`); return; }
    out.push({ ...(r.id ? { id: r.id } : {}), coverage_type: r.type, limit_amount: amt, max_count: cnt, as_of_date: r.asOf || null, notes: r.notes.trim() || null });
  });
  return { rows: out, errors };
}

/** จำนวนรายการเดิมที่จะถูกลบ (ล้างช่องแล้ว หรืออยู่ในหัวข้อที่ซ่อน) */
export const covRemoved = (existingIds: string[], payload: CovSave[]) => existingIds.filter((id) => !payload.some((r) => r.id === id)).length;

/* ---------------------------------------------------------------- สัญญาเพิ่มเติม (ตกลง 7 พ.ย. 2026)
 * ฟอร์มเพิ่มกรมธรรม์ (ส่วน "สัญญาเพิ่มเติม (ถ้ามี)") · ปุ่ม "+ เพิ่มสัญญาเพิ่มเติม" ในหน้าเล่ม
 *   กรอกเฉพาะ ประเภท · ทุน · เบี้ยต่อปี · วันสิ้นสุด · หมายเหตุ + ตารางความคุ้มครอง · ที่เหลือใช้ของสัญญาหลัก
 *   บันทึกด้วย create_insurance_booklet (ผิดส่วนเดียว = ไม่บันทึกเลยทั้งเล่ม)
 */
export type RiderRow = { key: string; type: string; sum: string; premium: string; end: string; notes: string; cov: CovRow[] };
export type RiderSave = { insurance_type: string; insured_amount: number | null; premium: number | null; end_date: string | null; notes: string | null; coverages: CovSave[] };

/** สัญญาเพิ่มเติมว่าง (ค่าเริ่มต้น = สุขภาพ · พบบ่อยสุด) */
export const blankRider = (type = "HEALTH"): RiderRow => ({ key: `r${++seq}`, type, sum: "", premium: "", end: "", notes: "", cov: [] });

/**
 * ข้อมูลสัญญาเพิ่มเติมที่ส่งบันทึก + ข้อผิดพลาด (ขึ้นต้นด้วย "สัญญาเพิ่มเติม N")
 *   types(r) = หัวข้อความคุ้มครองที่แสดงของส่วนนั้น · policyNo = เลขกรมธรรม์ของเล่ม (ต้องมีเมื่อมีสัญญาเพิ่มเติม)
 */
export function riderPayload(rs: RiderRow[], types: (r: RiderRow) => string[], label: (t: string) => string, policyNo: string | null): { rows: RiderSave[]; errors: string[] } {
  const rows: RiderSave[] = [];
  const errors: string[] = [];
  if (rs.length > 0 && !(policyNo ?? "").replace(/\s/g, ""))
    errors.push("สัญญาเพิ่มเติม: ใส่เลขกรมธรรม์ก่อน (สัญญาเพิ่มเติมผูกกับเล่มด้วยบริษัท + เลขกรมธรรม์)");
  rs.forEach((r, i) => {
    const name = `สัญญาเพิ่มเติม ${i + 1}`;
    const sum = num(r.sum);
    const prem = num(r.premium);
    const cov = covPayload(r.cov, types(r), label);
    const bad: string[] = [];
    if (r.sum.trim() === "" && r.premium.trim() === "") bad.push("ใส่ทุนประกันหรือเบี้ย (หรือกดลบส่วนนี้)");
    if (r.sum.trim() !== "" && (!Number.isFinite(sum) || sum < 0)) bad.push("ทุนประกันต้องเป็นตัวเลข 0 ขึ้นไป");
    if (r.premium.trim() !== "" && (!Number.isFinite(prem) || prem < 0)) bad.push("เบี้ยต้องเป็นตัวเลข 0 ขึ้นไป");
    if (r.end && !ISO.test(r.end)) bad.push("วันสิ้นสุดไม่ถูกต้อง");
    bad.forEach((e) => errors.push(`${name}: ${e}`));
    cov.errors.forEach((e) => errors.push(`${name} · ${e}`));
    if (bad.length || cov.errors.length) return;
    rows.push({
      insurance_type: r.type, insured_amount: r.sum.trim() === "" ? null : sum, premium: r.premium.trim() === "" ? null : prem,
      end_date: r.end || null, notes: r.notes.trim() || null, coverages: cov.rows,
    });
  });
  return { rows, errors };
}
