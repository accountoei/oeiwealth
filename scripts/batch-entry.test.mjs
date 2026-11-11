// node scripts/batch-entry.test.mjs — ทดสอบส่วนกลางของการบันทึกเป็นกลุ่ม (src/lib/batch-entry.ts · ตัวเลขสมมติ)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { BAD_ROWS_ERROR, TAX_ERROR, amountOrNull, inputAmount, inputNumber, isPositive, isValidTax, notSaved, plainNumber, readRows, withholding, withholdingFor } from "../src/lib/batch-entry.ts";

const form = (rows) => { const f = new FormData(); if (rows !== undefined) f.set("rows", rows); return f; };

// แถวจาก JSON
assert.deepEqual(readRows(form(JSON.stringify([{ asset_id: "A1", amount: "1,000.50" }]))), [{ asset_id: "A1", amount: "1,000.50" }]);
assert.deepEqual(readRows(form()), []);                       // ไม่มีช่อง rows = ไม่มีแถว
assert.equal(readRows(form("{bad json")), null);
assert.equal(readRows(form(JSON.stringify({ asset_id: "A1" }))), null);   // ต้องเป็น array
assert.equal(BAD_ROWS_ERROR, "ข้อมูลไม่ถูกต้อง");

// ตัวเลข: ตัดจุลภาค · ว่าง = null · ตัวอักษร = NaN
assert.equal(plainNumber(" 1,234.50 "), "1234.50");
assert.equal(plainNumber(undefined), "");
assert.equal(amountOrNull("1,234.50"), 1234.5);
assert.equal(amountOrNull(""), null);
assert.equal(amountOrNull("  "), null);
assert.equal(amountOrNull(null), null);
assert.ok(Number.isNaN(amountOrNull("abc")));

// ช่องกรอกฝั่งหน้าจอ: ว่าง = 0 · พิมพ์ผิด = NaN · แสดงกลับแบบมีจุลภาค + 2 ตำแหน่ง
assert.equal(inputNumber("1,234.50"), 1234.5);
assert.equal(inputNumber(""), 0);
assert.equal(inputNumber(undefined), 0);
assert.ok(Number.isNaN(inputNumber("12a")));
assert.equal(inputAmount(1234.5), "1,234.50");
assert.equal(inputAmount(0), "0.00");
assert.equal(inputAmount(-0.1), "-0.10");

// หัก ณ ที่จ่าย: คิดแบบเดิมของทุกหน้า (ยอด × อัตรา ปัด 2 ตำแหน่ง)
const old = (s, rate) => inputAmount(Math.round(Number(s.replace(/,/g, "")) * rate * 100) / 100);
for (const [pct, rate] of [[15, 0.15], [10, 0.1], [5, 0.05]]) {
  for (const s of ["1,000.00", "1.10", "333.33", "0.07", "12,345.67", "99.99"]) assert.equal(withholding(s, pct), old(s, rate), `${s} @ ${pct}%`);
}
assert.equal(withholding("1,000", 15), "150.00");
assert.equal(withholding("10,000.00", 5), "500.00");
assert.deepEqual(withholdingFor(["a", "b", "c", "d"], { a: "1,000", b: "", c: "x1", d: "200" }, 10), { a: "100.00", d: "20.00" });
assert.deepEqual(withholdingFor([], { a: "1" }, 15), {});

// ยอด > 0
assert.equal(isPositive(0.01), true);
assert.equal(isPositive(0), false);
assert.equal(isPositive(-5), false);
assert.equal(isPositive(null), false);
assert.equal(isPositive(NaN), false);

// ภาษี: ว่างได้ · 0 ได้ · ติดลบ / ตัวอักษร ไม่ได้
assert.equal(isValidTax(null), true);
assert.equal(isValidTax(0), true);
assert.equal(isValidTax(15), true);
assert.equal(isValidTax(-1), false);
assert.equal(isValidTax(NaN), false);
assert.equal(TAX_ERROR, "ภาษีต้องเป็นตัวเลข (ไม่ติดลบ)");

assert.equal(notSaved("ทุกบัญชี", "วันที่อยู่ในเดือนที่ปิดแล้ว"), "ยังไม่ได้บันทึก (ทุกบัญชี) · วันที่อยู่ในเดือนที่ปิดแล้ว");

console.log("batch-entry: ALL TESTS PASSED");
