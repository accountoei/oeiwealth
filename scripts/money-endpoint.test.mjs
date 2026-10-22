// node scripts/money-endpoint.test.mjs — ทดสอบการอ่าน / แปลงช่องทางเงิน (src/lib/money-endpoint.ts · รหัสสมมติ)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { bankId, cardId, endpointFromForm, endpointValue, holdingId, missingEndpoint, paidFromColumns, parseEndpoint } from "../src/lib/money-endpoint.ts";

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

console.log("money-endpoint: ALL TESTS PASSED");
