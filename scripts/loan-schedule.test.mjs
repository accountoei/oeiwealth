// node scripts/loan-schedule.test.mjs — ทดสอบตารางผ่อนที่แก้ได้ทีละช่อง (src/lib/loan-schedule.ts · ตัวเลขสมมติ)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { annuityPrincipals, generateSchedule, isMidPeriod, lastDueOf, openingFromSchedule, periodInterest, periodsUntil, recalcInterest } from "../src/lib/loan-schedule.ts";

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

// คืนเงินต้นเพิ่มระหว่างงวด (carry): ดอกเบี้ยถึงวันคืน (ยอดเดิม) + จากวันคืนถึงงวดถัดไป (ยอดใหม่) รวมในงวดถัดไป
// จ่ายแต่ดอก 6% วันจริง · เงินต้น 3,650,000 · คืนเพิ่ม 365,000 วันที่ 21 ก.พ. (21 วันหลังงวด 31 ม.ค.)
const io = { amount: 3650000, ratePct: 6, dayCount: "ACTUAL_365", interestFrom: "2026-01-01" };
const ioLines = [
  { due_date: "2026-01-31", principal: 0, interest: 0 },
  { due_date: "2026-02-21", principal: 365000, interest: 0, carry: true },
  { due_date: "2026-02-28", principal: 0, interest: 0 },
  { due_date: "2026-03-31", principal: 3285000, interest: 0 },
];
const c1 = recalcInterest(ioLines, 0, io);
assert.equal(c1[0].interest, 18000);              // 3,650,000 × 6% × 30/365
assert.equal(c1[1].interest, 0);                  // งวดคืนเพิ่ม: ดอกเบี้ย 0
assert.equal(c1[2].interest, 12600 + 3780);       // 3,650,000 × 21 วัน + 3,285,000 × 7 วัน
assert.equal(c1[3].interest, 16740);              // 3,285,000 × 31 วัน
// แก้เฉพาะงวดหลัง (from = 2) ยังรวมดอกของงวดคืนเพิ่มที่อยู่ก่อนหน้า
assert.equal(recalcInterest(ioLines, 2, io)[2].interest, 16380);
// ไม่ใช่ carry: งวดคืนเพิ่มคิดดอกแยก งวดถัดไปนับจากวันคืน
const c0 = recalcInterest(ioLines.map((l) => ({ ...l, carry: false })), 0, io);
assert.equal(c0[1].interest, 12600);
assert.equal(c0[2].interest, 3780);
// แยกงวดคืนเพิ่ม = ระหว่างงวดปกติ และห่างงวดถัดไปไม่ถึงเดือน
assert.equal(isMidPeriod("2026-02-21", "2026-01-31", "2026-02-28"), true);
assert.equal(isMidPeriod("2026-02-28", "2026-01-31", "2026-03-31"), false);
assert.equal(isMidPeriod("2026-02-21", "2026-01-31", undefined), false);

// ค่างวดเท่ากันสำหรับวันที่ที่กำหนด (จบวันเดิม): งวดสุดท้ายหมดพอดี ทุกงวดยอดรวมใกล้กัน
const dates = ["2026-02-05", "2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05", "2026-07-05"];
const ap = annuityPrincipals(60000, 12, "2026-01-05", dates, "MONTHLY");
assert.equal(Math.round(ap.reduce((t, x) => t + x, 0) * 100) / 100, 60000);
let bal = 60000;
const tot = ap.map((p) => { const t = p + Math.round(bal * 0.01 * 100) / 100; bal -= p; return t; });
assert.ok(Math.max(...tot) - Math.min(...tot) < 1, `ค่างวดเท่ากัน: ${tot}`);
assert.deepEqual(annuityPrincipals(1000, 12, "2026-01-05", ["2026-02-05"], "MONTHLY"), [1000]);

console.log("loan-schedule tests passed");
