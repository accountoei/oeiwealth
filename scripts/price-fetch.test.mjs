// node scripts/price-fetch.test.mjs — ทดสอบการแปลงข้อมูลราคา (ไม่ต่อเน็ต · ตัวเลขสมมติ)
import assert from "node:assert/strict";
import { yahooSymbol, parseYahooChart, goldBahtPrice, parseSecNav, firstArray, isSecProjId, parseGoldtraders, parseThaiGoldApi, goldQuote } from "./price-fetch.mjs";

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
// สมาคมค้าทองคำ (โครงสร้างหน้า classic.goldtraders.or.th · ตัวเลขสมมติ)
const html = `<td><span id="DetailPlace_uc_goldprices1_lblBLSell"><b><font color="Red">41,150.00</font></b></span></td>
<span id="DetailPlace_uc_goldprices1_lblBLBuy"><b><font>41,050.00</font></b></span>
<span id="DetailPlace_uc_goldprices1_lblOMSell"><b><font>41,650.00</font></b></span>
<span id="DetailPlace_uc_goldprices1_lblOMBuy"><b><font>40,225.32</font></b></span>
<span id="DetailPlace_uc_goldprices1_lblAsTime"><b><font>21/10/2569 09:25 ครั้งที่ 1</font></b></span>`;
const g = parseGoldtraders(html);
assert.deepEqual(g, { bar_buy: 41050, bar_sell: 41150, orn_buy: 40225.32, orn_sell: 41650, as_of: "21/10/2569 09:25 ครั้งที่ 1" });
assert.equal(parseGoldtraders("<html>maintenance</html>"), null);
const api = parseThaiGoldApi({ status: "success", response: { update_date: "21 ต.ค. 2569", update_time: "09:25", price: { gold: { buy: "40,225.32", sell: "41,650.00" }, gold_bar: { buy: "41,050.00", sell: "41,150.00" } } } });
assert.equal(api.bar_buy, 41050);
assert.equal(api.orn_buy, 40225.32);
assert.equal(goldQuote(g, 41100, "BAR").price, 41050);
assert.equal(goldQuote(g, 41100, "ORNAMENT").price, 40225.32);
assert.equal(goldQuote(g, null, "BAR").price, 41050);                   // ไม่มีราคาโลก → ใช้ราคาสมาคมฯ
assert.equal(goldQuote(g, 45000, "BAR").price, null);                   // ต่างเกิน 3% → ไม่ใช้
assert.match(goldQuote(g, 45000, "BAR").reason, /SOURCE_MISMATCH/);
assert.match(goldQuote(null, 41100, "BAR").reason, /NO_ASSOC_PRICE/);
console.log("price-fetch tests passed");
