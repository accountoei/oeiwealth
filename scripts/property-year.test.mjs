// node scripts/property-year.test.mjs — ทดสอบช่วงเดือนของ "รายได้สุทธิทั้งปี" หน้าทรัพย์สิน (src/lib/property-year.ts · ตัวเลขสมมติ)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { periodsIn, yearSpan } from "../src/lib/property-year.ts";

// ปีที่ Go-live (1 ต.ค.) ดูเดือนปัจจุบัน (พ.ย. ยังไม่จบ) → เติม ม.ค.–ก.ย. · ค่าเฉลี่ยจาก ต.ค. (เดือนที่จบแล้ว)
let s = yearSpan("2026-11", "2026-10-01", "2026-11-07");
assert.deepEqual(s, { year: 2026, months: 11, actualFrom: "2026-10-01", fillMonths: 9, avgFrom: "2026-10-01", avgTo: "2026-10-31", avgMonths: 1, anchorMonth: 10 });
// ดู ธ.ค. ตอน ธ.ค. → เฉลี่ย ต.ค.–พ.ย.
s = yearSpan("2026-12", "2026-10-01", "2026-12-15");
assert.equal(s.avgTo, "2026-11-30"); assert.equal(s.avgMonths, 2); assert.equal(s.fillMonths, 9); assert.equal(s.months, 12);
// ดูเดือน Go-live ขณะยังไม่จบ → ยังไม่มีเดือนที่จบ ใช้เดือนนั้นไปก่อน
s = yearSpan("2026-10", "2026-10-01", "2026-10-20");
assert.equal(s.avgFrom, "2026-10-01"); assert.equal(s.avgTo, "2026-10-31"); assert.equal(s.avgMonths, 1);
// ดูเดือนที่ผ่านไปแล้ว → นับเดือนนั้นด้วย
s = yearSpan("2026-11", "2026-10-01", "2027-01-05");
assert.equal(s.avgTo, "2026-11-30"); assert.equal(s.avgMonths, 2);
// ปีถัดไป = ยอดจริงทั้งปี ไม่ต้องเติม
s = yearSpan("2027-03", "2026-10-01", "2027-03-10");
assert.equal(s.fillMonths, 0); assert.equal(s.actualFrom, "2027-01-01"); assert.equal(s.months, 3);
// Go-live ม.ค. → ไม่ต้องเติม
s = yearSpan("2026-05", "2026-01-01", "2026-05-02");
assert.equal(s.fillMonths, 0); assert.equal(s.actualFrom, "2026-01-01");
// Go-live กลางเดือน → เดือน Go-live เป็นยอดจริง (เติมเฉพาะเดือนก่อนหน้า)
s = yearSpan("2026-08", "2026-07-15", "2026-08-20");
assert.equal(s.fillMonths, 6); assert.equal(s.actualFrom, "2026-07-01"); assert.equal(s.avgTo, "2026-07-31");
// ก.พ. ปีอธิกสุรทิน
assert.equal(yearSpan("2028-03", "2028-02-01", "2028-03-09").avgTo, "2028-02-29");

// งวดค่าใช้จ่ายประจำ
assert.equal(periodsIn(12, null, 10, 1, 9), 9);          // รายเดือน ม.ค.–ก.ย.
assert.equal(periodsIn(1, 4, 10, 1, 9), 1);              // ภาษีที่ดิน รายปี เม.ย.
assert.equal(periodsIn(1, 11, 10, 1, 9), 0);             // รายปี พ.ย. → ไม่อยู่ในช่วง
assert.equal(periodsIn(1, null, 10, 1, 9), 0);           // รายปีไม่ระบุเดือน → ตั้งที่เดือน Go-live (ต.ค.)
assert.equal(periodsIn(4, 2, 10, 1, 9), 3);              // รายไตรมาส ก.พ. พ.ค. ส.ค.
assert.equal(periodsIn(4, 11, 10, 1, 9), 3);             // รายไตรมาส พ.ย. → ก.พ. พ.ค. ส.ค.
assert.equal(periodsIn(4, null, 10, 1, 12), 4);          // ตั้งที่ ต.ค. → ม.ค. เม.ย. ก.ค. ต.ค.
assert.equal(periodsIn(undefined, 4, 10, 1, 9), 0);      // ไม่มีความถี่
assert.equal(periodsIn(12, null, 10, 1, 0), 0);          // ไม่มีเดือนให้เติม

console.log("property-year: all tests passed");
