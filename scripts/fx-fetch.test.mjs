// node scripts/fx-fetch.test.mjs — ทดสอบการแปลงข้อมูล ธปท. (ไม่ต่อเน็ต)
import assert from "node:assert/strict";
import { parseBotResponse, addDays } from "./fx-fetch.mjs";

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
console.log("fx-fetch tests passed");
