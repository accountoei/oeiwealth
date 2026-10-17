// node scripts/price-fetch.test.mjs — ทดสอบการแปลงข้อมูลราคา (ไม่ต่อเน็ต · ตัวเลขสมมติ)
import assert from "node:assert/strict";
import { yahooSymbol, parseYahooChart, goldBahtPrice, parseSecNav, firstArray, isSecProjId } from "./price-fetch.mjs";

assert.equal(yahooSymbol({ symbol: "ptt", currency: "THB" }), "PTT.BK");
assert.equal(yahooSymbol({ symbol: "AAPL", currency: "USD" }), "AAPL");
assert.equal(yahooSymbol({ symbol: "PTT", price_ref: "PTT-R.BK", currency: "THB" }), "PTT-R.BK");
assert.equal(yahooSymbol({ currency: "THB" }), null);

const y = parseYahooChart({ chart: { result: [{ meta: { regularMarketPrice: 35.25, currency: "THB", regularMarketTime: 1792137600, exchangeTimezoneName: "Asia/Bangkok" } }] } });
assert.equal(y.price, 35.25);
assert.equal(y.currency, "THB");
assert.match(y.date, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(parseYahooChart({ chart: { result: [] } }), null);

// 2,000 USD/ozt × 35 บาท → 2,000 × 35 × 15.244 / 31.1035 × 0.965
assert.equal(goldBahtPrice(2000, 35), 33106.66);

const nav = { data: [
  { proj_id: "M0001_2550", nav_date: "2026-10-14", last_val: "10.1234", class_abbr_name: "K-ABC-A" },
  { proj_id: "M0001_2550", nav_date: "2026-10-15", last_val: "10.2000", class_abbr_name: "K-ABC-A" },
  { proj_id: "M0001_2550", nav_date: "2026-10-15", last_val: "11.0000", class_abbr_name: "K-ABC-SSF" },
] };
assert.deepEqual(parseSecNav(nav, "K-ABC-A"), { price: 10.2, date: "2026-10-15" });
assert.deepEqual(parseSecNav(nav, "K-ABC-SSF"), { price: 11, date: "2026-10-15" });
assert.equal(parseSecNav({ data: [] }), null);
assert.deepEqual(firstArray({ a: { b: [1, 2] } }), [1, 2]);
assert.equal(isSecProjId("M0001_2550"), true);
assert.equal(isSecProjId("M0001_2550|K-ABC-A"), true);
assert.equal(isSecProjId("K-FIXED-A"), false);
console.log("price-fetch tests passed");
