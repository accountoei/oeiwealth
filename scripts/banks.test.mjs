// node scripts/banks.test.mjs — ชื่อธนาคารมาตรฐาน (src/lib/banks.ts)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { BANKS, bankLabel } from "../src/lib/banks.ts";

// ชื่อที่พิมพ์ต่างกัน → ชื่อเดียว
assert.equal(bankLabel("BBL"), "กรุงเทพ (BBL)");
assert.equal(bankLabel("ธนาคารกรุงเทพ จำกัด (มหาชน)"), "กรุงเทพ (BBL)");
assert.equal(bankLabel("Bangkok Bank"), "กรุงเทพ (BBL)");
assert.equal(bankLabel("kbank"), "กสิกรไทย (KBANK)");
assert.equal(bankLabel("ธ.ก.ส."), "ธ.ก.ส. (BAAC)");
assert.equal(bankLabel("TMB Thanachart"), "ทีทีบี (TTB)");
assert.equal(bankLabel("Citibank"), "ซิตี้แบงก์ (Citibank)");
// ชื่อมาตรฐานเดิม = เหมือนเดิม · ไม่รู้จัก = ชื่อที่พิมพ์ · ว่าง = "-"
assert.equal(bankLabel("ไทยพาณิชย์ (SCB)"), "ไทยพาณิชย์ (SCB)");
assert.equal(bankLabel("Maybank SG"), "Maybank SG");
assert.equal(bankLabel("  "), "-");
assert.equal(bankLabel(null), "-");

// รหัสไม่ซ้ำ · ชื่อไม่ซ้ำ · ชื่อย่อแต่ละตัวชี้ธนาคารเดียว
assert.equal(new Set(BANKS.map((b) => b.code)).size, BANKS.length);
assert.equal(new Set(BANKS.map((b) => b.label)).size, BANKS.length);
for (const b of BANKS) for (const a of b.aliases) assert.equal(bankLabel(a), b.label, `${a} → ${b.label}`);

console.log("banks: ALL TESTS PASSED");
