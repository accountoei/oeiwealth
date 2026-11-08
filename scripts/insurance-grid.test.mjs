// node scripts/insurance-grid.test.mjs — ทดสอบตารางเบี้ย / ผลประโยชน์ที่แก้ทีละช่อง (src/lib/insurance-grid.ts · ตัวเลขสมมติ)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { addMonthsIso, fillDown, gridNum, gridToLines, guessEvery, monthsBetween, nextRow, sortGrid } from "../src/lib/insurance-grid.ts";
import {
  addableCovTypes, blankCovRow, blankKey, blankRider, covPayload, covRemoved, partText, patchCovRow, riderPayload, rowsFromExisting, sortCovRows, visibleCovTypes,
} from "../src/lib/insurance-coverage.ts";

const R = (key, due, amount, extra = {}) => ({ key, due, amount, type: "", skipped: false, notes: "", ...extra });

// วันที่
assert.equal(addMonthsIso("2026-01-31", 1), "2026-02-28");
assert.equal(addMonthsIso("2028-01-31", 1), "2028-02-29");
assert.equal(addMonthsIso("2026-11-15", 12), "2027-11-15");
assert.equal(addMonthsIso("2026-11-15", 24), "2028-11-15");
assert.equal(monthsBetween("2026-03-01", "2028-03-01"), 24);
assert.equal(gridNum("12,500.00"), 12500);
assert.equal(gridNum(""), 0);
assert.ok(Number.isNaN(gridNum("abc")));

// เดาระยะห่างจากสองงวดท้าย · ไม่พอ = 12 เดือน
assert.equal(guessEvery([R("a", "2026-03-01", "1"), R("b", "2028-03-01", "1")]), 24);
assert.equal(guessEvery([R("a", "2026-03-01", "1")]), 12);
// แถวใหม่ต่อจากแถวเดิม: วันที่ + ระยะห่าง · ยอด / ชนิดเดิม
assert.deepEqual(nextRow(R("a", "2026-03-01", "5,000.00", { type: "CASH_BACK" }), 24, "n", "2026-01-01"),
  { key: "n", due: "2028-03-01", amount: "5,000.00", type: "CASH_BACK", skipped: false, notes: "" });
assert.equal(nextRow(undefined, 12, "n", "2026-01-01").due, "2026-01-01");

// เรียงตามวันที่ · ไม่มีวันที่อยู่ท้าย
assert.deepEqual(sortGrid([R("c", "", "1"), R("b", "2027-01-01", "1"), R("a", "2026-01-01", "1")]).map((r) => r.key), ["a", "b", "c"]);
// ใช้ยอดนี้กับงวดถัดไป (ข้ามแถวที่ล็อก)
assert.deepEqual(fillDown([R("a", "2026-01-01", "1"), R("b", "2027-01-01", "2", { locked: "จ่ายแล้ว" }), R("c", "2028-01-01", "9")], 0).map((r) => r.amount), ["1", "2", "1"]);

// ส่งเฉพาะแถวที่แก้ได้ · ชนิดผลประโยชน์ต่อแถว · ติ๊กไม่ได้จ่าย · หมายเหตุ
const ok = gridToLines([
  R("h", "2024-01-15", "12,000.00"),
  R("s", "2025-01-15", "12,000.00", { skipped: true, notes: " ขาดอายุ " }),
  R("p", "2026-01-15", "12,000.00", { locked: "จ่ายแล้ว 12,000.00" }),
  R("f", "2027-01-15", "12,500.50"),
], "PREMIUM", "2025-10-01");
assert.deepEqual(ok.errors, []);
assert.deepEqual(ok.lines, [
  { due_date: "2024-01-15", amount: 12000 },
  { due_date: "2025-01-15", amount: 12000, notes: "ขาดอายุ", skipped: true },
  { due_date: "2027-01-15", amount: 12500.5 },
]);
const ben = gridToLines([R("a", "2028-01-15", "5000", { type: "CASH_BACK" }), R("b", "2040-01-15", "200000", { type: "MATURITY" }), R("c", "2030-01-15", "1")], "BENEFIT", null);
assert.deepEqual(ben.lines.map((l) => l.benefit_type), ["CASH_BACK", "MATURITY", "OTHER"]);
// ข้อผิดพลาด: ไม่มีวันที่ · ยอด 0 / ตัวอักษร · งวดหลัง Go-live ก่อนงวดที่จ่ายแล้ว (งวดก่อน Go-live ใส่ย้อนหลังได้)
const bad = gridToLines([
  R("x", "", "100"), R("y", "2026-06-01", "0"), R("z", "2026-07-01", "abc"),
  R("p", "2026-09-01", "100", { locked: "จ่ายแล้ว" }),
  R("q", "2026-08-01", "100"), R("old", "2025-01-01", "100"),
], "PREMIUM", "2025-10-01");
assert.equal(bad.errors.length, 4);
assert.match(bad.errors[0], /งวดที่ 1: ใส่วันครบกำหนด/);
assert.match(bad.errors[1], /งวดที่ 2: ยอด/);
assert.match(bad.errors[2], /งวดที่ 3: ยอด/);
assert.match(bad.errors[3], /งวดที่ 5 \(1\/8\/2569\).*\(1\/9\/2569\)/);
assert.deepEqual(bad.lines, [{ due_date: "2025-01-01", amount: 100 }]);
// ตารางว่าง (ลบงวดที่ยังไม่ชำระทั้งหมด) ไม่ใช่ข้อผิดพลาด
assert.deepEqual(gridToLines([R("p", "2026-09-01", "100", { locked: "จ่ายแล้ว" })], "PREMIUM", null), { lines: [], errors: [] });

// ---------------------------------------------------------------- ตารางความคุ้มครองมาตรฐาน (src/lib/insurance-coverage.ts · 7–8 พ.ย. 2026)
{
  const ORDER = ["LIFE", "ROOM_PER_DAY", "DEDUCTIBLE", "COPAY", "WAIVER", "OTHER"];
  const lbl = (t) => ({ LIFE: "เสียชีวิต", ROOM_PER_DAY: "ค่าห้อง", DEDUCTIBLE: "ความรับผิดส่วนแรก", COPAY: "ร่วมจ่าย", WAIVER: "ยกเว้นเบี้ย", OTHER: "อื่น ๆ" })[t] ?? t;
  const B = (key, type, x = {}) => ({ key, type, amount: "", count: "", period: "", label: "", notes: "", waiver: false, asOf: "", ...x });
  const ex = rowsFromExisting([
    { id: "c1", coverage_type: "LIFE", limit_amount: 500000, as_of_date: "2026-01-01" },
    { id: "c2", coverage_type: "WAIVER", limit_amount: 0, notes: "เมื่อทุพพลภาพ" },
    { id: "c3", coverage_type: "ROOM_PER_DAY", limit_amount: "4000", max_count: 365, count_period: "PER_YEAR" },
    { id: "c4", coverage_type: "OTHER", limit_amount: 5000, label: "ค่ารถพยาบาล" },
  ]);
  assert.equal(ex[0].amount, "500,000.00");
  assert.equal(ex[0].asOf, "2026-01-01");
  assert.equal(ex[1].waiver, true);
  assert.equal(ex[2].count, "365");
  assert.equal(ex[2].period, "PER_YEAR");
  assert.equal(ex[3].label, "ค่ารถพยาบาล");
  // แสดงทุกหัวข้อ: ตามประเภท + หัวข้อที่มีแถว · all = ทุกหัวข้อ
  assert.deepEqual(visibleCovTypes(ORDER, ["LIFE", "WAIVER", "OTHER"], ex, false), ["LIFE", "ROOM_PER_DAY", "WAIVER", "OTHER"]);
  assert.deepEqual(visibleCovTypes(ORDER, ["LIFE"], [], true), ORDER);
  // ปุ่มเพิ่มหัวข้อ = หัวข้อตามประเภทที่ยังไม่มีแถว · "อื่น ๆ" เพิ่มได้เสมอ
  assert.deepEqual(addableCovTypes(ORDER, ["LIFE", "DEDUCTIBLE", "WAIVER", "OTHER"], ex), ["DEDUCTIBLE", "OTHER"]);
  assert.deepEqual(addableCovTypes(ORDER, undefined, []), ORDER);
  // แถวที่มีเรียงตามหัวข้อมาตรฐาน (ในหัวข้อเดียวกันตามลำดับที่เพิ่ม)
  assert.deepEqual(sortCovRows(ORDER, [B("o2", "OTHER"), B("r", "ROOM_PER_DAY"), B("o1", "OTHER"), B("l", "LIFE")]).map((r) => r.key), ["l", "r", "o2", "o1"]);
  // พิมพ์ในแถวว่าง (แสดงทุกหัวข้อ) → เพิ่มแถวจริง (key เดิม)
  let rows = patchCovRow(ex, "COPAY", blankKey("COPAY"), { amount: "20" });
  assert.equal(rows.length, 5);
  rows = patchCovRow(rows, "COPAY", blankKey("COPAY"), { amount: "20%" });
  assert.equal(rows.length, 5);
  // ปุ่มเพิ่ม → แถวว่าง · ความรับผิดส่วนแรก: รอบอย่างเดียว
  rows = [...rows, { ...blankCovRow("DEDUCTIBLE"), amount: "10,000", period: "PER_YEAR" }];
  const ok = covPayload(rows, lbl);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.rows.map((r) => [r.id ?? "-", r.coverage_type, r.limit_amount, r.max_count, r.count_period, r.label, r.as_of_date]), [
    ["c1", "LIFE", 500000, null, null, null, "2026-01-01"], ["c2", "WAIVER", 0, null, null, null, null], ["c3", "ROOM_PER_DAY", 4000, 365, "PER_YEAR", null, null],
    ["c4", "OTHER", 5000, null, null, "ค่ารถพยาบาล", null], ["-", "COPAY", 20, null, null, null, null], ["-", "DEDUCTIBLE", 10000, null, "PER_YEAR", null, null],
  ]);
  // ล้างวงเงิน / เอาติ๊กออก / กดลบ = ไม่คุ้มครอง (รายการเดิมถูกลบ)
  rows = patchCovRow(rows, "LIFE", "c1", { amount: "" });
  rows = patchCovRow(rows, "WAIVER", "c2", { waiver: false });   // แถวเดิม: เอาติ๊กออก = ลบ (หมายเหตุค้างได้)
  rows = rows.filter((r) => r.key !== "c4");                      // ปุ่มลบ
  const cleared = covPayload(rows, lbl);
  assert.deepEqual(cleared.errors, []);
  assert.equal(covRemoved(["c1", "c2", "c3", "c4"], cleared.rows), 3);
  // แถวใหม่ที่เพิ่มไว้แต่ไม่ได้กรอกอะไร = ไม่บันทึก ไม่เตือน
  assert.deepEqual(covPayload([blankCovRow("ROOM_PER_DAY")], lbl), { rows: [], errors: [] });
  // ข้อผิดพลาด: หมายเหตุแต่ไม่มีวงเงิน · ร่วมจ่ายเกิน 100 · จำนวนไม่ใช่จำนวนเต็ม · วงเงินติดลบ · "อื่น ๆ" ไม่มีชื่อ · เลือกรอบแต่ไม่มีวงเงิน
  const bad2 = covPayload([
    B("a", "OTHER", { notes: "ทันตกรรม" }),
    B("b", "COPAY", { amount: "120" }),
    B("c", "ROOM_PER_DAY", { amount: "3,000", count: "1.5" }),
    B("d", "LIFE", { amount: "-1" }),
    B("e", "OTHER", { amount: "1,000" }),
    B("f", "DEDUCTIBLE", { period: "PER_EVENT" }),
  ], lbl);
  assert.equal(bad2.rows.length, 0);
  assert.match(bad2.errors[0], /อื่น ๆ \(ทันตกรรม\): ใส่วงเงิน หรือกดลบแถวนี้/);
  assert.match(bad2.errors[1], /ร่วมจ่ายไม่เกิน 100%/);
  assert.match(bad2.errors[2], /จำนวนเต็ม/);
  assert.match(bad2.errors[3], /0 ขึ้นไป/);
  assert.match(bad2.errors[4], /^อื่น ๆ: ใส่ชื่อความคุ้มครอง/);
  assert.match(bad2.errors[5], /^ความรับผิดส่วนแรก: ใส่วงเงิน/);
  // "อื่น ๆ" เดิมที่เขียนชื่อไว้ในหมายเหตุ ยังบันทึกได้ · ชื่อของหัวข้ออื่นไม่ส่ง
  assert.deepEqual(covPayload([B("g", "OTHER", { amount: "500", notes: "ค่าแว่น" }), B("h", "LIFE", { amount: "1", label: "x" })], lbl).rows.map((r) => [r.label, r.notes]),
    [[null, "ค่าแว่น"], [null, null]]);
  assert.equal(partText("  มะเร็ง  ", 100), "มะเร็ง");
  assert.equal(partText("   ", 100), null);
}

// สัญญาเพิ่มเติม (ตกลง 7 พ.ย. 2026 · ชื่อแบบ / คุ้มครองเฉพาะ 8 พ.ย. 2026): ประเภท · ชื่อแบบ · ทุน · เบี้ย · วันสิ้นสุด · หมายเหตุ + ความคุ้มครองของส่วนนั้น
{
  const lbl = (t) => ({ ROOM_PER_DAY: "ค่าห้อง", OTHER: "อื่น ๆ" })[t] ?? t;
  const B = (key, type, x = {}) => ({ key, type, amount: "", count: "", period: "", label: "", notes: "", waiver: false, asOf: "", ...x });
  const h = { ...blankRider(), plan: " สุขภาพทดสอบ ", scope: "", sum: "1,000,000.00", premium: "15,000.00", end: "2036-01-15", notes: " แผน A ",
    cov: [B("x", "ROOM_PER_DAY", { amount: "4,000.00", count: "365", period: "PER_YEAR" })] };
  assert.equal(blankRider().type, "HEALTH");
  assert.notEqual(blankRider().key, blankRider().key);
  const ok = riderPayload([h, { ...blankRider("ACCIDENT"), premium: "1,200" }, { ...blankRider(), scope: " มะเร็ง ", premium: "3,000" }], lbl, "BK-001");
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.rows, [
    { insurance_type: "HEALTH", plan_name: "สุขภาพทดสอบ", coverage_scope: null, insured_amount: 1000000, premium: 15000, end_date: "2036-01-15", notes: "แผน A",
      coverages: [{ coverage_type: "ROOM_PER_DAY", limit_amount: 4000, max_count: 365, count_period: "PER_YEAR", label: null, as_of_date: null, notes: null }] },
    { insurance_type: "ACCIDENT", plan_name: null, coverage_scope: null, insured_amount: null, premium: 1200, end_date: null, notes: null, coverages: [] },
    { insurance_type: "HEALTH", plan_name: null, coverage_scope: "มะเร็ง", insured_amount: null, premium: 3000, end_date: null, notes: null, coverages: [] },
  ]);
  // ไม่มีสัญญาเพิ่มเติม = ไม่ต้องมีเลขกรมธรรม์
  assert.deepEqual(riderPayload([], lbl, ""), { rows: [], errors: [] });
  // มีสัญญาเพิ่มเติมแต่ไม่มีเลขกรมธรรม์ · ไม่มีทุนและเบี้ย · ตัวเลขผิด · ความคุ้มครองผิด (บอกส่วนที่ผิด)
  const bad = riderPayload([
    blankRider(),
    { ...blankRider(), sum: "abc", premium: "-5" },
    { ...h, cov: [B("y", "OTHER", { notes: "ทันตกรรม" })] },
  ], lbl, "  ");
  assert.equal(bad.rows.length, 0);
  assert.match(bad.errors[0], /ใส่เลขกรมธรรม์ก่อน/);
  assert.match(bad.errors[1], /^สัญญาเพิ่มเติม 1: ใส่ทุนประกันหรือเบี้ย/);
  assert.match(bad.errors[2], /^สัญญาเพิ่มเติม 2: ทุนประกันต้องเป็นตัวเลข/);
  assert.match(bad.errors[3], /^สัญญาเพิ่มเติม 2: เบี้ยต้องเป็นตัวเลข/);
  assert.match(bad.errors[4], /^สัญญาเพิ่มเติม 3 · อื่น ๆ \(ทันตกรรม\): ใส่วงเงิน/);
}

console.log("insurance-grid: all tests passed");
