// node scripts/coupon-schedule.test.mjs — ทดสอบตารางรับดอกเบี้ย / เงินต้นของหุ้นกู้ · FCN (src/lib/coupon-schedule.ts · ตัวเลขสมมติ)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { buildSchedule, couponLines } from "../src/lib/coupon-schedule.ts";

const bond = { id: "b", maturity_date: "2028-06-15", status: "ACTIVE", face: 1000000, rate: 5, freq: "SEMI_ANNUAL", start: "2026-09-30", current_value: 1000000 };
const view = (rows) => rows.map((r) => [r.kind[0], r.due, r.expected, r.received ? "รับ" : r.pre ? "ก่อน" : r.cancelled ? "ยกเลิก" : "รอ"]);

// ไม่ได้ตั้งตาราง: คำนวณจากข้อมูลหลัก (นับย้อนจากวันครบกำหนดถึงหลังวันเริ่มถือ) · รับ Coupon ก่อนวันรับไม่เกิน 20 วัน = รับงวดนั้น
assert.deepEqual(view(buildSchedule(bond, [{ date: "2026-12-01", amount: 25000 }], null, [], "2026-10-01")), [
  ["I", "2026-12-15", 25000, "รับ"], ["I", "2027-06-15", 25000, "รอ"], ["I", "2027-12-15", 25000, "รอ"], ["I", "2028-06-15", 25000, "รอ"],
  ["P", "2028-06-15", 1000000, "รอ"],
]);

// ตั้งตารางเอง: ใช้งวดที่ตั้งไว้แทน · ก่อน Go-live = ข้อมูลเท่านั้น · งวดก่อน Go-live ที่รับหลัง Go-live ยังจับคู่ได้ · หมายเหตุติดไปด้วย
const stored = [
  { due_date: "2026-03-15", interest_due: 24000, principal_due: 0, notes: null },
  { due_date: "2026-09-25", interest_due: 24500, principal_due: 0, notes: null },
  { due_date: "2027-03-15", interest_due: 25500, principal_due: 0, notes: "ตาม term sheet" },
  { due_date: "2027-09-15", interest_due: 25000, principal_due: 1000000, notes: null },
];
const s1 = buildSchedule({ ...bond, maturity_date: null }, [{ date: "2026-10-02", amount: 24500 }], null, stored, "2026-10-01");
assert.deepEqual(view(s1), [
  ["I", "2026-03-15", 24000, "ก่อน"], ["I", "2026-09-25", 24500, "รับ"], ["I", "2027-03-15", 25500, "รอ"], ["I", "2027-09-15", 25000, "รอ"],
  ["P", "2027-09-15", 1000000, "รอ"],
]);
assert.equal(s1[2].notes, "ตาม term sheet");
assert.deepEqual([s1[0].no, s1[0].total, s1[4].key], [1, 4, "b:P"]);

// ขายไปแล้ว (ไม่มีรายการครบกำหนด) → งวดที่ยังไม่รับ = ยกเลิก
assert.deepEqual(view(buildSchedule({ ...bond, status: "SOLD" }, [{ date: "2026-12-10", amount: 25000 }], null, [], "2026-10-01")).map((r) => r[3]),
  ["รับ", "ยกเลิก", "ยกเลิก", "ยกเลิก", "ยกเลิก"]);

// Autocall: งวดถึงวันเรียกคืนยังรอรับ · หลังจากนั้นยกเลิก · เงินต้นลงวันเรียกคืน = รับแล้ว
assert.deepEqual(view(buildSchedule({ ...bond, status: "AUTOCALLED" }, [{ date: "2026-12-15", amount: 25000 }], { date: "2027-06-15", amount: 1000000 }, [], "2026-10-01")), [
  ["I", "2026-12-15", 25000, "รับ"], ["I", "2027-06-15", 25000, "รอ"], ["I", "2027-12-15", 25000, "ยกเลิก"], ["I", "2028-06-15", 25000, "ยกเลิก"],
  ["P", "2027-06-15", 1000000, "รับ"],
]);

// สูตรตั้งตาราง: ดอกเท่ากันทุกงวด / ตามจำนวนวันจริง · เงินต้นงวดสุดท้าย
const p = { face: 1000000, ratePct: 5, freq: "SEMI_ANNUAL", start: "2026-01-01", maturity: "2027-06-15", actual: false };
assert.deepEqual(couponLines(p), [
  { due_date: "2026-06-15", principal: 0, interest: 25000 }, { due_date: "2026-12-15", principal: 0, interest: 25000 },
  { due_date: "2027-06-15", principal: 1000000, interest: 25000 },
]);
assert.deepEqual(couponLines({ ...p, actual: true }).map((l) => l.interest), [24931.51, 25068.49, 24931.51]);   // 182 · 183 · 182 วัน
assert.deepEqual(couponLines({ ...p, freq: "AT_MATURITY", start: "2026-01-15", maturity: "2027-01-15" }), [{ due_date: "2027-01-15", principal: 1000000, interest: 50000 }]);
assert.deepEqual(couponLines({ ...p, ratePct: 0 }), [{ due_date: "2027-06-15", principal: 1000000, interest: 0 }]);

console.log("coupon-schedule: ผ่านทั้งหมด");
