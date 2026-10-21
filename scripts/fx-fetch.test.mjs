// node scripts/fx-fetch.test.mjs — ทดสอบการแปลงข้อมูล ธปท. (ไม่ต่อเน็ต)
import assert from "node:assert/strict";
import { parseBotResponse, parseBblResponse, bblRawLines, addDays } from "./fx-fetch.mjs";

const sample = { result: { data: { data_detail: [
  { period: "2026-09-29", currency_id: "USD", currency_name_eng: "USA : DOLLAR (USD)", buying_transfer: "32.10", selling: "32.50", mid_rate: "32.3050" },
  { period: "2026-09-29", currency_id: "JPY", currency_name_eng: "JAPAN : YEN (100 YEN)", buying_transfer: "21.50", selling: "22.10", mid_rate: "21.8000" },
  { period: "2026-09-29", currency_id: "EUR", currency_name_eng: "EURO ZONE : EURO (EUR)", buying_transfer: "37.00", selling: "37.60", mid_rate: "" },
  { period: "2026-09-29", currency_id: "XXX", currency_name_eng: "NO DATA", buying_transfer: "", selling: "", mid_rate: "" },
  { period: "2026-09-29", currency_id: "THB", mid_rate: "1" },
] } } };

const r = parseBotResponse(sample);
assert.equal(r.length, 3);
assert.deepEqual(r.find((x) => x.currency === "USD").rate_to_thb, 32.305);
assert.equal(r.find((x) => x.currency === "JPY").rate_to_thb, 0.218);          // ต่อ 1 เยน
assert.equal(r.find((x) => x.currency === "EUR").rate_to_thb, 37.3);           // ไม่มี mid → เฉลี่ย
assert.match(r.find((x) => x.currency === "EUR").source_reference, /avg/);
assert.deepEqual(parseBotResponse({}), []);
assert.equal(addDays("2026-09-30", 1), "2026-10-01");
// ธนาคารกรุงเทพ (ช่องตามตารางบนเว็บธนาคาร · ตัวเลขสมมติ)
//   BuyingRates / SellingRates = ธนบัตร · SightBill = ดราฟรับซื้อ · TT = โอนรับซื้อ · Bill_DD_TT = ดราฟ-โอน ขาย
const bbl = [
  { ID: "1", Family: "USD1", Description: "USD: 1-2", BuyingRates: "32.00", SellingRates: "34.00", Update: "1" },
  { ID: "2", Family: "USD5", Description: "USD: 5-20", BuyingRates: "32.50", SellingRates: "34.00", Update: "1" },
  { ID: "3", Family: "USD50", Description: "USD: 50-100", BuyingRates: "33.00", SellingRates: "34.00", SightBill: "33.20", TT: "33.40", Bill_DD_TT: "33.80", Update: "1" },
  { ID: "4", Family: "JPY", Description: "Japan (:100)", BuyingRates: "20.00", SellingRates: "22.00", SightBill: "20.90", TT: "21.00", Bill_DD_TT: "21.60" },
  { ID: "5", Family: "IDR", Description: "Indonesia (:1000)", BuyingRates: "1.50", SellingRates: "2.00", TT: "1.80", Bill_DD_TT: "1.96" },
  { ID: "6", Family: "BND", Description: "Brunei", BuyingRates: "25.00", SellingRates: "26.50", TT: "-", Bill_DD_TT: "-" },
  { ID: "7", Family: "KRW", Description: "Korea", TT: "0.022", Bill_DD_TT: "0.025" },
  { ID: "8", Family: "XYZ", Description: "no data" },
];
const m = parseBblResponse(bbl, "2026-10-21");
assert.deepEqual(m.map((x) => x.currency).sort(), ["BND", "IDR", "JPY", "USD"]);   // KRW ไม่อยู่ในรายการ
assert.equal(m.find((x) => x.currency === "USD").rate_to_thb, 33.6);              // แถว 50-100 · (TT 33.40 + ขาย 33.80) ÷ 2
assert.equal(m.find((x) => x.currency === "JPY").rate_to_thb, 0.213);             // (21.00 + 21.60) ÷ 2 ÷ 100
assert.equal(m.find((x) => x.currency === "IDR").rate_to_thb, 0.00188);           // (1.80 + 1.96) ÷ 2 ÷ 1000
assert.equal(m.find((x) => x.currency === "BND").rate_to_thb, 25.75);             // ไม่มีอัตราโอน → ธนบัตร
assert.match(m.find((x) => x.currency === "BND").source_reference, /ธนบัตร/);
assert.match(m.find((x) => x.currency === "IDR").source_reference, /\/1000/);
assert.equal(parseBblResponse(bbl, "2026-10-21", "BUYING_TT").find((x) => x.currency === "USD").rate_to_thb, 33.4);
assert.equal(parseBblResponse(bbl, "2026-10-21", "SELLING").find((x) => x.currency === "USD").rate_to_thb, 33.8);
assert.equal(m[0].rate_date, "2026-10-21");
assert.deepEqual(parseBblResponse(null, "2026-10-21"), []);
assert.equal(bblRawLines(bbl.slice(0, 1))[0], "  RAW ID=1 | Family=USD1 | Description=USD: 1-2 | BuyingRates=32.00 | SellingRates=34.00 | Update=1");
console.log("fx-fetch tests passed");
