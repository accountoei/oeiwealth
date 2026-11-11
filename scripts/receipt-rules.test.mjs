// node scripts/receipt-rules.test.mjs — กฎรับชำระ (src/lib/receipt-rules.ts · ตัวเลขสมมติ)
// ใช้ทั้งแท็บรับชำระ (financial/loans/LoanBatch.tsx · property/RentBatch.tsx) และหน้าต่างรายสัญญา (loans/[id]/forms.tsx · property/[id]/forms.tsx)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { dueAsOf, lateFee, payFromLine, splitInterestFirst } from "../src/lib/receipt-rules.ts";

const L = (due_date, status, total_remaining = 1000) => ({ due_date, status, total_remaining });

// ── งวดที่เริ่มเติม ──
// 1) มีงวดเลยกำหนด / ครบกำหนด (ผ่อนผัน) → งวดล่าสุดในนั้น ไม่ว่าจะส่ง monthLines หรือไม่
const withDue = [L("2026-08-15", "PAID", 0), L("2026-09-15", "OVERDUE"), L("2026-10-15", "DUE"), L("2026-11-15", "PENDING")];
assert.equal(payFromLine(withDue)?.due_date, "2026-10-15");
assert.equal(payFromLine(withDue, [withDue[3]])?.due_date, "2026-10-15");
assert.equal(payFromLine([L("2026-10-15", "DUE"), L("2026-09-15", "OVERDUE")])?.due_date, "2026-10-15");   // ไม่ขึ้นกับลำดับที่ส่งมา

// 2) แท็บรายเดือน: มีงวดในเดือนที่เลือก → งวดแรกที่ยังค้างของเดือน · รับครบแล้ว → ไม่เติมงวดเดือนหน้า
const monthly = [L("2026-11-05", "PENDING"), L("2026-11-25", "PENDING"), L("2026-12-25", "PENDING")];
assert.equal(payFromLine(monthly, monthly.slice(0, 2))?.due_date, "2026-11-05");
const paidMonth = [L("2026-11-05", "PAID", 0), L("2026-12-05", "PENDING")];
assert.equal(payFromLine(paidMonth, [paidMonth[0]]), undefined);

// 3) ไม่มีงวดในเดือนที่เลือก (สัญญาอื่น) / หน้าสัญญา → งวดถัดไป (ตกลง 11 พ.ย. 2026)
const quarterly = [L("2026-10-15", "PAID", 0), L("2027-01-15", "PENDING"), L("2027-04-15", "PENDING")];
assert.equal(payFromLine(quarterly, [])?.due_date, "2027-01-15");
assert.equal(payFromLine(quarterly)?.due_date, "2027-01-15");
assert.equal(payFromLine([L("2027-01-15", "PARTIAL", 400)])?.due_date, "2027-01-15");
assert.equal(payFromLine([L("2026-10-15", "PAID", 0), L("2026-11-15", "WRITTEN_OFF")]), undefined);
assert.equal(payFromLine([]), undefined);

// ── ยอดค้างถึงวันที่รับ ──
const owe = [{ no: 2, due: "2026-09-15", p: 1000, i: 150.105 }, { no: 3, due: "2026-10-15", p: 1000, i: 140 }, { no: 4, due: "2026-11-15", p: 1000, i: 130 }];
assert.deepEqual(dueAsOf(owe, "2026-09-15", "2026-10-20"), { p: 2000, i: 290.11, nos: [2, 3] });   // ครบถึงวันที่รับ
assert.deepEqual(dueAsOf(owe, "2026-10-15", "2026-09-01"), { p: 2000, i: 290.11, nos: [2, 3] });   // รับก่อนงวด from → เติมถึงงวด from
assert.deepEqual(dueAsOf(owe, undefined, "2026-09-01"), { p: 0, i: 0, nos: [] });
assert.deepEqual(dueAsOf([], "2026-10-15", "2026-10-15"), { p: 0, i: 0, nos: [] });
assert.deepEqual(dueAsOf([{ due: "2026-10-15", p: 5, i: 1 }], null, "2026-10-15"), { p: 5, i: 1, nos: [] });

// กรณีที่แก้ 11 พ.ย. 2026: ผ่อนทุก 3 เดือน รับล่วงหน้าเดือน พ.ย. ยอดรวม 10,300 → ทั้งสองหน้าหักดอกงวด ม.ค. ก่อน
const q = [{ no: 2, due: "2027-01-15", p: 10000, i: 300 }];
const from = payFromLine(quarterly, [])?.due_date;
const d = dueAsOf(q, from, "2026-11-11");
assert.deepEqual(d, { p: 10000, i: 300, nos: [2] });
assert.deepEqual(splitInterestFirst(10300, d.i), { interest: 300, principal: 10000 });

// ── แบ่งยอดรวม: ดอกเบี้ยก่อน ──
assert.deepEqual(splitInterestFirst(5000, 1200), { interest: 1200, principal: 3800 });
assert.deepEqual(splitInterestFirst(800, 1200), { interest: 800, principal: 0 });       // รับไม่พอดอก → เป็นดอกทั้งหมด
assert.deepEqual(splitInterestFirst(5000, 0), { interest: 0, principal: 5000 });
assert.deepEqual(splitInterestFirst(5000, -50), { interest: 0, principal: 5000 });       // ดอกติดลบ (รับเกินไว้) = 0
assert.deepEqual(splitInterestFirst(1000.1, 333.333), { interest: 333.33, principal: 666.77 });
const s = splitInterestFirst(0.3, 0.1);
assert.equal(Math.round((s.interest + s.principal) * 100) / 100, 0.3);              // รวมกลับได้ยอดเดิม

// ── ค่าปรับค่าเช่าล่าช้า ──
assert.equal(lateFee("2026-10-05", 5, 100, "2026-10-15"), 500);    // เลย 10 วัน − ผ่อนผัน 5 = 5 วัน
assert.equal(lateFee("2026-10-05", 5, 100, "2026-10-10"), 0);      // ยังอยู่ในช่วงผ่อนผัน
assert.equal(lateFee("2026-10-05", 0, 100, "2026-10-04"), 0);      // ยังไม่ถึงกำหนด
assert.equal(lateFee("2026-10-05", 0, 0, "2026-10-30"), 0);        // ไม่ได้ตั้งค่าปรับ
assert.equal(lateFee("2026-10-05", 0, 33.335, "2026-10-08"), 100.01);

console.log("receipt-rules: all tests passed");
