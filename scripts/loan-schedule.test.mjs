// node scripts/loan-schedule.test.mjs — ทดสอบตารางผ่อนที่แก้ได้ทีละช่อง (src/lib/loan-schedule.ts · ตัวเลขสมมติ)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { generateSchedule, lastDueOf, openingFromSchedule, periodInterest, periodsUntil, recalcInterest } from "../src/lib/loan-schedule.ts";

// จำนวนงวด ↔ งวดสุดท้ายครบกำหนด
assert.equal(lastDueOf("2026-01-31", 3, 1), "2026-03-31");
assert.equal(lastDueOf("2026-01-15", 4, 3), "2026-10-15");
assert.equal(periodsUntil("2026-01-15", "2026-10-15", 3), 4);
assert.equal(periodsUntil("2026-01-15", "2027-12-15", 1), 24);
assert.equal(periodsUntil("2026-05-15", "2026-01-15", 1), 0);
assert.equal(lastDueOf("2026-01-15", periodsUntil("2026-01-15", "2028-06-15", 1), 1), "2028-06-15");

// ดอกเบี้ยของงวด: รายเดือน = เดือน ÷ 12 · วันจริง = วัน ÷ 365 · ห่างไม่ถึงเดือน = วันจริง
assert.equal(periodInterest(120000, 12, "2026-01-05", "2026-02-05", "MONTHLY"), 1200);
assert.equal(periodInterest(120000, 12, "2026-01-05", "2026-04-05", "MONTHLY"), 3600);
assert.equal(periodInterest(100000, 7.3, "2026-01-05", "2026-02-04", "ACTUAL_365"), 600);
assert.equal(periodInterest(100000, 7.3, "2026-01-05", "2026-01-15", "MONTHLY"), 200);
assert.equal(periodInterest(0, 12, "2026-01-05", "2026-02-05", "MONTHLY"), 0);
assert.equal(periodInterest(1000, 12, "2026-02-05", "2026-02-05", "MONTHLY"), 0);

// ตารางจากสูตร → แก้เงินต้นงวด 2 → ดอกเบี้ยงวด 3 เป็นต้นไปคิดใหม่ · งวด 1–2 ไม่เปลี่ยน
const opts = { amount: 120000, ratePct: 12, dayCount: "MONTHLY", interestFrom: "2026-01-05" };
const base = generateSchedule({ method: "EQUAL_PRINCIPAL", amount: 120000, ratePct: 12, periods: 4, firstDue: "2026-02-05", everyMonths: 1 }).lines;
assert.deepEqual(base.map((l) => l.interest), [1200, 900, 600, 300]);
assert.deepEqual(recalcInterest(base, 0, opts).map((l) => l.interest), [1200, 900, 600, 300]);   // สูตรเดียวกัน = ผลเดิม
const edited = base.map((l, i) => (i === 1 ? { ...l, principal: 50000 } : l));
const r1 = recalcInterest(edited, 2, opts);
assert.deepEqual(r1.map((l) => l.interest), [1200, 900, 400, 100]);
assert.equal(r1[1], edited[1]);
// ดอกเบี้ยที่พิมพ์เอง (manual) ไม่ถูกเขียนทับ
const r2 = recalcInterest(edited.map((l, i) => (i === 2 ? { ...l, interest: 555, manual: true } : l)), 2, opts);
assert.deepEqual(r2.map((l) => l.interest), [1200, 900, 555, 100]);
// เลื่อนวันงวด 3 ออกไป (มี.ค. → มิ.ย. = 3 เดือน) · งวด 4 ลงวันก่อนงวด 3 → 0 (หน้าจอเรียงวันที่ให้ก่อน)
const moved = recalcInterest(edited.map((l, i) => (i === 2 ? { ...l, due_date: "2026-06-05" } : l)), 2, opts);
assert.equal(moved[2].interest, 1200);
assert.equal(moved[3].interest, 0);
// แถวที่ยังไม่ใส่วันที่: ข้าม ไม่ทำให้งวดถัดไปเป็น 0
const gap = recalcInterest([base[0], { due_date: "", principal: 0, interest: 0 }, base[1]], 0, opts);
assert.equal(gap[1].interest, 0);
assert.equal(gap[2].interest, 900);
// ดอกเบี้ยคงที่ (Flat): คิดจากเงินต้นตามสัญญาทุกงวด
assert.deepEqual(recalcInterest(base, 0, { ...opts, flat: true }).map((l) => l.interest), [1200, 1200, 1200, 1200]);

// ยอดตั้งต้นจากตาราง = เงินต้นตามสัญญา − เงินต้นของงวดที่ครบกำหนดถึงวันตั้งต้น
assert.deepEqual(openingFromSchedule(120000, base, "2026-03-31"), { count: 2, paid: 60000, outstanding: 60000 });
assert.deepEqual(openingFromSchedule(120000, base, "2026-03-05"), { count: 2, paid: 60000, outstanding: 60000 });
assert.deepEqual(openingFromSchedule(120000, base, "2026-01-31"), { count: 0, paid: 0, outstanding: 120000 });

console.log("loan-schedule tests passed");
