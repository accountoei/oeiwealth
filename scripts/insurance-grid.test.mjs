// node scripts/insurance-grid.test.mjs — ทดสอบตารางเบี้ย / ผลประโยชน์ที่แก้ทีละช่อง (src/lib/insurance-grid.ts · ตัวเลขสมมติ)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { addMonthsIso, fillDown, gridNum, gridToLines, guessEvery, monthsBetween, nextRow, sortGrid } from "../src/lib/insurance-grid.ts";
import { blankKey, blankRider, covPayload, covRemoved, patchCovRow, riderPayload, rowsFromExisting, visibleCovTypes } from "../src/lib/insurance-coverage.ts";

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

// ---------------------------------------------------------------- ตารางความคุ้มครองมาตรฐาน (src/lib/insurance-coverage.ts · 7 พ.ย. 2026)
{
  const ORDER = ["LIFE", "ROOM_PER_DAY", "COPAY", "WAIVER", "OTHER"];
  const lbl = (t) => ({ LIFE: "เสียชีวิต", ROOM_PER_DAY: "ค่าห้อง", COPAY: "ร่วมจ่าย", WAIVER: "ยกเว้นเบี้ย", OTHER: "อื่น ๆ" })[t] ?? t;
  const ex = rowsFromExisting([
    { id: "c1", coverage_type: "LIFE", limit_amount: 500000, as_of_date: "2026-01-01" },
    { id: "c2", coverage_type: "WAIVER", limit_amount: 0, notes: "เมื่อทุพพลภาพ" },
    { id: "c3", coverage_type: "ROOM_PER_DAY", limit_amount: "4000", max_count: 365 },
  ]);
  assert.equal(ex[0].amount, "500,000.00");
  assert.equal(ex[1].waiver, true);
  assert.equal(ex[2].count, "365");
  // หัวข้อตามประเภท + หัวข้อที่มีรายการเดิม (ค่าห้องอยู่ในกรมธรรม์ชีวิตเดิม → ยังแสดง)
  assert.deepEqual(visibleCovTypes(ORDER, ["LIFE", "WAIVER", "OTHER"], ex, false), ["LIFE", "ROOM_PER_DAY", "WAIVER", "OTHER"]);
  assert.deepEqual(visibleCovTypes(ORDER, ["LIFE"], [], true), ORDER);
  // พิมพ์ในแถวว่าง → เพิ่มแถวจริง (key เดิม)
  let rows = patchCovRow(ex, "COPAY", blankKey("COPAY"), { amount: "20" });
  assert.equal(rows.length, 4);
  rows = patchCovRow(rows, "COPAY", blankKey("COPAY"), { amount: "20%" });
  assert.equal(rows.length, 4);
  const types = ["LIFE", "ROOM_PER_DAY", "COPAY", "WAIVER", "OTHER"];
  const ok = covPayload(rows, types, lbl);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.rows.map((r) => [r.id ?? "-", r.coverage_type, r.limit_amount, r.max_count]),
    [["c1", "LIFE", 500000, null], ["c2", "WAIVER", 0, null], ["c3", "ROOM_PER_DAY", 4000, 365], ["-", "COPAY", 20, null]]);
  // ล้างช่อง = ไม่คุ้มครอง (รายการเดิมถูกลบ) · ยกเว้นเบี้ยเอาติ๊กออก
  rows = patchCovRow(rows, "LIFE", "c1", { amount: "", asOf: "" });
  rows = patchCovRow(rows, "WAIVER", "c2", { waiver: false });   // แถวเดิม: เอาติ๊กออก = ลบ (หมายเหตุค้างได้)
  const cleared = covPayload(rows, types, lbl);
  assert.deepEqual(cleared.errors, []);
  assert.equal(covRemoved(["c1", "c2", "c3"], cleared.rows), 2);
  // ข้อผิดพลาด: หมายเหตุแต่ไม่มีวงเงิน · ร่วมจ่ายเกิน 100 · จำนวนไม่ใช่จำนวนเต็ม · วงเงินติดลบ
  const bad2 = covPayload([
    { key: "a", type: "OTHER", amount: "", count: "", asOf: "", notes: "ทันตกรรม", waiver: false },
    { key: "b", type: "COPAY", amount: "120", count: "", asOf: "", notes: "", waiver: false },
    { key: "c", type: "ROOM_PER_DAY", amount: "3,000", count: "1.5", asOf: "", notes: "", waiver: false },
    { key: "d", type: "LIFE", amount: "-1", count: "", asOf: "", notes: "", waiver: false },
  ], types, lbl);
  assert.equal(bad2.rows.length, 0);
  assert.match(bad2.errors[0], /อื่น ๆ \(ทันตกรรม\): ใส่วงเงิน/);
  assert.match(bad2.errors[1], /ร่วมจ่ายไม่เกิน 100%/);
  assert.match(bad2.errors[2], /จำนวนเต็ม/);
  assert.match(bad2.errors[3], /0 ขึ้นไป/);
  // หัวข้อที่ซ่อน (เปลี่ยนประเภทในฟอร์มเพิ่มกรมธรรม์) ไม่บันทึก
  assert.equal(covPayload([{ key: "h", type: "COPAY", amount: "10", count: "", asOf: "", notes: "", waiver: false }], ["LIFE"], lbl).rows.length, 0);
}

// สัญญาเพิ่มเติม (ตกลง 7 พ.ย. 2026): ประเภท · ทุน · เบี้ย · วันสิ้นสุด · หมายเหตุ + ความคุ้มครองของส่วนนั้น
{
  const lbl = (t) => ({ ROOM_PER_DAY: "ค่าห้อง", OTHER: "อื่น ๆ" })[t] ?? t;
  const types = () => ["ROOM_PER_DAY", "OTHER"];
  const h = { ...blankRider(), sum: "1,000,000.00", premium: "15,000.00", end: "2036-01-15", notes: " แผน A ",
    cov: [{ key: "x", type: "ROOM_PER_DAY", amount: "4,000.00", count: "365", asOf: "", notes: "", waiver: false }] };
  assert.equal(blankRider().type, "HEALTH");
  assert.notEqual(blankRider().key, blankRider().key);
  const ok = riderPayload([h, { ...blankRider("ACCIDENT"), premium: "1,200" }], types, lbl, "BK-001");
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.rows, [
    { insurance_type: "HEALTH", insured_amount: 1000000, premium: 15000, end_date: "2036-01-15", notes: "แผน A",
      coverages: [{ coverage_type: "ROOM_PER_DAY", limit_amount: 4000, max_count: 365, as_of_date: null, notes: null }] },
    { insurance_type: "ACCIDENT", insured_amount: null, premium: 1200, end_date: null, notes: null, coverages: [] },
  ]);
  // ไม่มีสัญญาเพิ่มเติม = ไม่ต้องมีเลขกรมธรรม์
  assert.deepEqual(riderPayload([], types, lbl, ""), { rows: [], errors: [] });
  // มีสัญญาเพิ่มเติมแต่ไม่มีเลขกรมธรรม์ · ไม่มีทุนและเบี้ย · ตัวเลขผิด · ความคุ้มครองผิด (บอกส่วนที่ผิด)
  const bad = riderPayload([
    blankRider(),
    { ...blankRider(), sum: "abc", premium: "-5" },
    { ...h, cov: [{ key: "y", type: "OTHER", amount: "", count: "", asOf: "", notes: "ทันตกรรม", waiver: false }] },
  ], types, lbl, "  ");
  assert.equal(bad.rows.length, 0);
  assert.match(bad.errors[0], /ใส่เลขกรมธรรม์ก่อน/);
  assert.match(bad.errors[1], /^สัญญาเพิ่มเติม 1: ใส่ทุนประกันหรือเบี้ย/);
  assert.match(bad.errors[2], /^สัญญาเพิ่มเติม 2: ทุนประกันต้องเป็นตัวเลข/);
  assert.match(bad.errors[3], /^สัญญาเพิ่มเติม 2: เบี้ยต้องเป็นตัวเลข/);
  assert.match(bad.errors[4], /^สัญญาเพิ่มเติม 3 · อื่น ๆ \(ทันตกรรม\): ใส่วงเงิน/);
}

console.log("insurance-grid: all tests passed");
