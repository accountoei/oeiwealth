// node scripts/form-input.test.mjs — ทดสอบตัวอ่านช่องกรอกใน src/lib/format.ts (ตัวเลขสมมติ)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { numOrNull, numOrZero, strOrNull } from "../src/lib/format.ts";

// ฝั่ง server: ว่าง = null · ตัดจุลภาค · ตัวอักษร = NaN (ให้ action แจ้งผิด)
assert.equal(numOrNull("1,234.50"), 1234.5);
assert.equal(numOrNull(" "), null);
assert.equal(numOrNull(null), null);
assert.ok(Number.isNaN(numOrNull("abc")));
assert.equal(strOrNull("  ข้อความ "), "ข้อความ");
assert.equal(strOrNull(""), null);

// ฝั่งหน้าจอ (ยอดรวมระหว่างพิมพ์): ว่าง / ตัวอักษร = 0
assert.equal(numOrZero("1,234.50"), 1234.5);
assert.equal(numOrZero(""), 0);
assert.equal(numOrZero(null), 0);
assert.equal(numOrZero(undefined), 0);
assert.equal(numOrZero("abc"), 0);
assert.equal(numOrZero("-5"), -5);

console.log("form-input: ALL TESTS PASSED");
