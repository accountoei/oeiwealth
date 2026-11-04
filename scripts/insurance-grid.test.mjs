// node scripts/insurance-grid.test.mjs — ทดสอบตารางเบี้ย / ผลประโยชน์ที่แก้ทีละช่อง (src/lib/insurance-grid.ts · ตัวเลขสมมติ)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { addMonthsIso, fillDown, gridNum, gridToLines, guessEvery, monthsBetween, nextRow, sortGrid } from "../src/lib/insurance-grid.ts";

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

console.log("insurance-grid: all tests passed");
