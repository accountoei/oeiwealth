// node scripts/money-endpoint.test.mjs — ทดสอบการอ่าน / แปลงช่องทางเงิน (src/lib/money-endpoint.ts · รหัสสมมติ)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { bankId, cardId, cardLabel, endpointFromColumns, endpointFromForm, endpointValue, holdingId, missingEndpoint, paidFromColumns, parseEndpoint, payLinesFromForm, usableDefault } from "../src/lib/money-endpoint.ts";

const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

// ฟอร์มแบบเลือกประเภท
assert.deepEqual(endpointFromForm(form({ pay_via: "bank", bank_asset_id: " A1 ", card_id: "C1" })), { kind: "bank", id: "A1" });
assert.deepEqual(endpointFromForm(form({ pay_via: "card", bank_asset_id: "A1", card_id: "C1" })), { kind: "card", id: "C1" });
assert.deepEqual(endpointFromForm(form({ pay_via: "portfolio", pf_cash_id: "H1" })), { kind: "portfolio", id: "H1" });
assert.deepEqual(endpointFromForm(form({ pay_via: "cash", bank_asset_id: "A1" })), { kind: "cash", id: null });
assert.deepEqual(endpointFromForm(form({ bank_asset_id: "A1" })), { kind: "bank", id: "A1" });                 // ไม่มี pay_via = บัญชี
assert.deepEqual(endpointFromForm(form({ pay_via: "bank", bank_asset_id: "" })), { kind: "bank", id: null });
assert.deepEqual(endpointFromForm(form({ pay_via: "BANK", bank_asset_id: "A1" })), { kind: "cash", id: null });    // ตัวพิมพ์ใหญ่ = ไม่รู้จัก
assert.deepEqual(endpointFromForm(form({ pay_via: "toString" })), { kind: "cash", id: null });
assert.deepEqual(endpointFromForm(form({ to_via: "card", card_id: "C1" }), "to_via"), { kind: "card", id: "C1" });

// คอลัมน์จ่ายจาก: ใส่ได้ช่องเดียวเสมอ
assert.deepEqual(paidFromColumns({ kind: "bank", id: "A1" }), { paid_from_asset_id: "A1", paid_from_credit_card_id: null, paid_from_cash_holding_id: null });
assert.deepEqual(paidFromColumns({ kind: "card", id: "C1" }), { paid_from_asset_id: null, paid_from_credit_card_id: "C1", paid_from_cash_holding_id: null });
assert.deepEqual(paidFromColumns({ kind: "portfolio", id: "H1" }), { paid_from_asset_id: null, paid_from_credit_card_id: null, paid_from_cash_holding_id: "H1" });
assert.deepEqual(paidFromColumns({ kind: "cash", id: null }), { paid_from_asset_id: null, paid_from_credit_card_id: null, paid_from_cash_holding_id: null });

// ตัวเลือกช่องเดียว (ตรงกับ p_account ของ update_entry) · ไปกลับได้
for (const e of [{ kind: "bank", id: "A1" }, { kind: "card", id: "C1" }, { kind: "portfolio", id: "H1" }]) {
  assert.deepEqual(parseEndpoint(endpointValue(e)), e);
}
assert.equal(endpointValue({ kind: "bank", id: "A1" }), "a:A1");
assert.equal(endpointValue({ kind: "card", id: "C1" }), "c:C1");
assert.equal(endpointValue({ kind: "portfolio", id: "H1" }), "h:H1");
assert.equal(endpointValue({ kind: "cash", id: null }), "");
assert.equal(endpointValue({ kind: "bank", id: null }), "");
assert.deepEqual(parseEndpoint(""), { kind: "cash", id: null });
assert.deepEqual(parseEndpoint(null), { kind: "cash", id: null });
assert.deepEqual(parseEndpoint("x:1"), { kind: "cash", id: null });
assert.deepEqual(parseEndpoint("a:"), { kind: "bank", id: null });

assert.equal(bankId({ kind: "bank", id: "A1" }), "A1");
assert.equal(bankId({ kind: "card", id: "C1" }), null);
assert.equal(cardId({ kind: "card", id: "C1" }), "C1");
assert.equal(holdingId({ kind: "portfolio", id: "H1" }), "H1");

assert.equal(missingEndpoint({ kind: "bank", id: null }), "กรุณาเลือกบัญชี");
assert.equal(missingEndpoint({ kind: "card", id: null }), "กรุณาเลือกบัตร");
assert.equal(missingEndpoint({ kind: "portfolio", id: null }), "กรุณาเลือกบัญชีเงินฝากในพอร์ต");
assert.equal(missingEndpoint({ kind: "cash", id: null }), null);
assert.equal(missingEndpoint({ kind: "bank", id: "A1" }), null);

// หลายบรรทัด (pl_via · pl_id · pl_amount)
const lines = (rows) => { const f = new FormData(); for (const [v, id, a] of rows) { f.append("pl_via", v); f.append("pl_id", id); f.append("pl_amount", a); } return f; };
assert.deepEqual(payLinesFromForm(lines([["bank", "A1", "1,000.50"], ["card", "C1", "200"], ["cash", "P1", "50"], ["bank", "A2", ""]])),
  [{ kind: "bank", id: "A1", amount: 1000.5 }, { kind: "card", id: "C1", amount: 200 }, { kind: "cash", id: "P1", amount: 50 }]);
assert.deepEqual(payLinesFromForm(lines([["bank", "A1", "0"]])), { error: "บรรทัดที่ 1 · จำนวนเงินต้องเป็นตัวเลขมากกว่า 0" });
assert.deepEqual(payLinesFromForm(lines([["bank", "A1", "10"], ["cash", "", "5"]])), { error: "บรรทัดที่ 2 · กรุณาเลือกผู้จ่าย" });
assert.deepEqual(payLinesFromForm(lines([["bank", "A1", " "]])), { error: "กรุณาใส่จำนวนเงินอย่างน้อย 1 บรรทัด" });
assert.equal(payLinesFromForm(lines([["bank", "A1", "abc"]])).error, "บรรทัดที่ 1 · จำนวนเงินต้องเป็นตัวเลขมากกว่า 0");

// ชื่อบัตร: ผู้ออกบัตร ชื่อบัตร ••เลขท้าย (ช่องว่างข้ามไป)
assert.equal(cardLabel({ issuer: "ธนาคาร ก", card_name: "Gold", card_last4: "1234" }), "ธนาคาร ก Gold ••1234");
assert.equal(cardLabel({ issuer: "ธนาคาร ก", card_name: null, card_last4: null }), "ธนาคาร ก");
assert.equal(cardLabel({}), "");

// คอลัมน์ "จ่ายจาก" → ช่องทาง (กลับด้านของ paidFromColumns)
for (const e of [{ kind: "bank", id: "A1" }, { kind: "card", id: "C1" }, { kind: "portfolio", id: "H1" }, { kind: "cash", id: null }])
  assert.deepEqual(endpointFromColumns(paidFromColumns(e)), e);
assert.deepEqual(endpointFromColumns({}), { kind: "cash", id: null });
assert.equal(endpointValue(endpointFromColumns({ paid_from_asset_id: "A1", paid_from_credit_card_id: null })), "a:A1");

// ค่าตั้งต้นที่เก็บไว้ → ใช้ได้เมื่อยังอยู่ในรายการและสกุลตรง
const banks = [{ asset_id: "A1", currency: "THB" }, { asset_id: "A2", currency: "USD" }], cards = [{ id: "C1", currency: "THB" }];
assert.deepEqual(usableDefault("a:A1", "THB", banks, cards), { bank: "A1" });
assert.deepEqual(usableDefault("a:A2", "THB", banks, cards), {});          // สกุลไม่ตรง
assert.deepEqual(usableDefault("a:A9", "THB", banks, cards), {});          // ปิดบัญชีไปแล้ว
assert.deepEqual(usableDefault("c:C1", "THB", banks, cards), { card: "C1" });
assert.deepEqual(usableDefault("", "THB", banks, cards), {});
assert.deepEqual(usableDefault(undefined, "THB", banks, cards), {});


console.log("money-endpoint: ALL TESTS PASSED");
