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
// ธนาคารกรุงเทพ (โครงสร้างตามเอกสาร API · ตัวเลขสมมติ)
const bbl = [
  { ID: "1", Family: "USD", Description: "USD 50-100", BuyingRates: "", SellingRates: "33.20", SightBill: "32.70", Bill_DD_TT: "32.75", TT: "32.80", Update: "3" },
  { ID: "2", Family: "USD", Description: "USD 1", BuyingRates: "", SellingRates: "33.20", SightBill: "", Bill_DD_TT: "", TT: "32.80" },
  { ID: "3", Family: "JPY", Description: "JPY 100", SellingRates: "22.40", TT: "21.60" },
  { ID: "4", Family: "EUR", Description: "EURO", SellingRates: "38.10", TT: "" , Bill_DD_TT: "37.50" },
  { ID: "5", Family: "XYZ", Description: "no data", SellingRates: "", TT: "" },
];
const m = parseBblResponse(bbl, "2026-10-16");
assert.equal(m.length, 3);
assert.equal(m.find((x) => x.currency === "USD").rate_to_thb, 33);              // (32.80 + 33.20) ÷ 2 · แถวแรกของสกุล
assert.equal(m.find((x) => x.currency === "JPY").rate_to_thb, 0.22);            // ต่อ 1 เยน
assert.equal(m.find((x) => x.currency === "EUR").rate_to_thb, 37.8);            // ไม่มี TT → Bill DD/TT
assert.equal(parseBblResponse(bbl, "2026-10-16", "BUYING_TT").find((x) => x.currency === "USD").rate_to_thb, 32.8);
assert.equal(parseBblResponse(bbl, "2026-10-16", "SELLING").find((x) => x.currency === "USD").rate_to_thb, 33.2);
assert.equal(m[0].rate_date, "2026-10-16");
assert.deepEqual(parseBblResponse(null, "2026-10-16"), []);
// หน่วยตามที่ธนาคารกรุงเทพประกาศจริง · แถวธนบัตรใบย่อย (ซื้อถูกกว่า) ไม่ใช้ · สกุลนอกรายการไม่บันทึก
const bbl2 = [
  { Family: "USD", Description: "USD 1-2", TT: "32.10", SellingRates: "33.40" },
  { Family: "USD", Description: "USD 50-100", TT: "33.20", SellingRates: "33.40" },
  { Family: "JPY", Description: "JAPAN YEN", TT: "21.20", SellingRates: "21.64" },
  { Family: "IDR", Description: "INDONESIA RUPIAH", TT: "1.80", SellingRates: "1.98" },
  { Family: "VND", Description: "VIETNAM DONG", TT: "1.20", SellingRates: "1.50" },
  { Family: "KRW", Description: "KOREA WON", TT: "0.022", SellingRates: "0.025" },
];
const m2 = parseBblResponse(bbl2, "2026-10-21");
assert.deepEqual(m2.map((x) => x.currency).sort(), ["IDR", "JPY", "USD"]);
assert.equal(m2.find((x) => x.currency === "USD").rate_to_thb, 33.3);
assert.equal(m2.find((x) => x.currency === "JPY").rate_to_thb, 0.2142);
assert.equal(m2.find((x) => x.currency === "IDR").rate_to_thb, 0.00189);
assert.match(m2.find((x) => x.currency === "IDR").source_reference, /\/1000/);
assert.equal(bblRawLines(bbl2.slice(0, 1))[0], "  RAW Family=USD | Description=USD 1-2 | TT=32.10 | SellingRates=33.40");
console.log("fx-fetch tests passed");
