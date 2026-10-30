// node scripts/form-input.test.mjs — ทดสอบตัวอ่านช่องกรอกใน src/lib/format.ts (ตัวเลขสมมติ)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { beToCe, numOrNull, numOrZero, strOrNull } from "../src/lib/format.ts";

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

// ช่องวันที่: ปี พ.ศ. (> 2400) → ค.ศ. · ปีปกติไม่แตะ · วันที่ไม่มีจริงในปี ค.ศ. = ok: false
assert.deepEqual(beToCe("2568-06-15"), { ok: true, value: "2025-06-15", be: 2568 });
assert.deepEqual(beToCe("2569-10"), { ok: true, value: "2026-10", be: 2569 });
assert.deepEqual(beToCe("2567-02-29"), { ok: true, value: "2024-02-29", be: 2567 });
assert.deepEqual(beToCe("2568-02-29"), { ok: false, be: 2568 });
assert.equal(beToCe("2025-06-15"), null);
assert.equal(beToCe("2400-01-01"), null);
assert.equal(beToCe(""), null);

console.log("form-input: ALL TESTS PASSED");
