// node scripts/tax-calc.test.mjs — ทดสอบตัวคำนวณภาษีใน src/lib/tax.ts (ตัวเลขสมมติ · คิดมือตามอัตราขั้นบันได)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { calcTax, progressiveTax } from "../src/lib/tax.ts";

const L = (section, code, amount, extra = {}) => ({ section, code, system_amount: amount, ...extra });
const me = (extra = []) => [L("DEDUCTION", "PERSONAL", null, { qty: 1 }), ...extra];

// ขั้นบันได
assert.equal(progressiveTax(150000).tax, 0);
assert.equal(progressiveTax(401000).tax, 17600);       // 7,500 + 10,100
assert.equal(progressiveTax(5500000).tax, 1440000);     // 7,500+20,000+37,500+50,000+250,000+900,000+175,000

// A) เงินเดือน 600,000 · หัก ณ ที่จ่าย 15,000 · ประกันสังคม 9,000 · ประกันชีวิต 30,000
let c = calcTax(me([L("INCOME", "40(1)", 600000), L("CREDIT", "WHT", 15000), L("DEDUCTION", "SOCIAL_SECURITY", 9000),
  L("DEDUCTION", "LIFE_INS", 30000), L("EXPENSE", "EXP_40_1_2", null, { method: "FLAT" })]), 2025);
assert.equal(c.expenses, 100000);
assert.equal(c.taxable, 401000);
assert.equal(c.tax, 17600);
assert.equal(c.result, 2600);
assert.equal(c.warning, null);

// ยอดใช้ยื่นแทนยอดระบบ · รายได้รอตรวจสอบไม่นับ
c = calcTax(me([L("INCOME", "40(1)", 600000, { filed_amount: 700000 }), L("INCOME", "REVIEW", 999999)]), 2025);
assert.equal(c.assessable, 700000);

// B) บริจาค: 2 เท่าไม่เกิน 10% · ทั่วไปไม่เกิน 10% ของยอดหลังหัก 2 เท่า
c = calcTax(me([L("INCOME", "40(1)", 1200000), L("DONATION", "DON_DOUBLE", 20000), L("DONATION", "DON_GENERAL", 50000)]), 2025);
assert.equal(c.donations, 90000);
assert.equal(c.taxable, 950000);
assert.equal(c.tax, 105000);
c = calcTax(me([L("INCOME", "40(1)", 300000), L("DONATION", "DON_GENERAL", 50000)]), 2025);
assert.equal(c.donations, 14000);                        // (300,000 − 100,000 − 60,000) × 10%
assert.ok(c.capped.some((x) => x.code === "DON_GENERAL"));

// C) ประกันชีวิต + สุขภาพรวมไม่เกิน 100,000 · สุขภาพไม่เกิน 25,000
c = calcTax(me([L("INCOME", "40(1)", 2000000), L("DEDUCTION", "LIFE_INS", 90000), L("DEDUCTION", "HEALTH_INS", 40000)]), 2025);
assert.equal(c.deductions, 60000 + 90000 + 10000);
// ครอบครัว: ยอดที่กรอกเองแทน จำนวน × อัตรา
c = calcTax([L("INCOME", "40(1)", 2000000), L("DEDUCTION", "PERSONAL", null, { qty: 1 }), L("DEDUCTION", "CHILD", null, { qty: 2, filed_amount: 90000 }),
  L("DEDUCTION", "PARENT", null, { qty: 2 })], 2025);
assert.equal(c.deductions, 60000 + 90000 + 60000);

// D) กลุ่มเกษียณรวมไม่เกิน 500,000 · Thai ESG แยก (ปี 2567 = 100,000 · ปี 2568 = 300,000)
const funds = [L("INCOME", "40(1)", 2000000), L("DEDUCTION", "PVD", 100000), L("DEDUCTION", "RMF", 400000), L("DEDUCTION", "SSF", 200000), L("DEDUCTION", "THAI_ESG", 400000)];
c = calcTax(funds, 2024);
assert.equal(c.deductions, 100000 + 400000 + 0 + 100000);
c = calcTax(funds, 2025);
assert.equal(c.deductions, 100000 + 400000 + 0 + 300000);
assert.ok(c.capped.some((x) => x.code === "SSF" && x.allowed === 0));

// E) ค่าเช่าเหมา 30% · ภาษีวิธีที่ 2 (0.5%) ใช้เมื่อสูงกว่าขั้นบันไดและเกิน 5,000
c = calcTax(me([L("INCOME", "40(5)", 3000000), L("EXPENSE", "EXP_40_5", 50000, { method: "FLAT" })]), 2025);
assert.equal(c.expenses, 900000);
assert.equal(c.tax, 377000);
assert.equal(c.minTax, 15000);
c = calcTax(me([L("INCOME", "40(8)", 2000000), L("EXPENSE", "EXP_40_6_8", null, { method: "ACTUAL", filed_amount: 1990000 })]), 2025);
assert.equal(c.progressive, 0);
assert.equal(c.tax, 10000);
c = calcTax(me([L("INCOME", "40(5)", 400000), L("EXPENSE", "EXP_40_5", 50000, { method: "ACTUAL" })]), 2025);
assert.equal(c.expenses, 50000);                         // ตามจริงจากยอดระบบ · ต่ำกว่า 1 ล้าน ไม่มีวิธีที่ 2
assert.equal(c.minTax, 0);

// F) อายุ 65 ปีขึ้นไป ยกเว้น 190,000 · ดอกเบี้ย / ปันผลไม่มีค่าใช้จ่าย
c = calcTax(me([L("INCOME", "40(4)", 500000)]), 2025, { age: 66 });
assert.equal(c.taxable, 250000);
assert.equal(c.tax, 5000);
c = calcTax(me([L("INCOME", "40(4)", 500000)]), 2025, { age: 64 });
assert.equal(c.taxable, 440000);

// G) ขอคืน · ปีที่ยังไม่มีเพดานใช้ปีก่อนหน้า
c = calcTax(me([L("INCOME", "40(1)", 300000), L("CREDIT", "WHT", 5000), L("EXPENSE", "EXP_40_1_2", null, { method: "FLAT" })]), 2027);
assert.equal(c.result, -5000);
assert.equal(c.rulesYear, 2026);
assert.ok(c.warning);

console.log("tax-calc tests passed");
