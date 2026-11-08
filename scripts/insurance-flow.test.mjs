// node scripts/insurance-flow.test.mjs — ทดสอบสุทธิสะสม / จุดคุ้มทุน / IRR ของกรมธรรม์ (src/lib/insurance-flow.ts · ตัวเลขสมมติ)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { actualFlows, ageAt, cashNet, contractFlows, cvBreakEven, lineValue, policyYearAt, projectedFlows, runningNet, surrenderFlows, xirr } from "../src/lib/insurance-flow.ts";

const near = (a, b, eps = 1e-6) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const npv = (flows, r) => {
  const t0 = Math.min(...flows.map((f) => Date.parse(f.date)));
  return flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, (Date.parse(f.date) - t0) / 86400000 / 365), 0);
};

// XIRR: 1 ปีพอดี (365 วัน) ได้ 10%
near(xirr([{ date: "2021-01-01", amount: -1000 }, { date: "2022-01-01", amount: 1100 }]), 0.1);
// ตัวอย่างในคู่มือ Excel XIRR = 0.373362535
near(xirr([
  { date: "2008-01-01", amount: -10000 }, { date: "2008-03-01", amount: 2750 }, { date: "2008-10-30", amount: 4250 },
  { date: "2009-02-15", amount: 3250 }, { date: "2009-04-01", amount: 2750 },
]), 0.373362535, 1e-8);
// ได้คืนน้อยกว่าที่จ่าย = ติดลบ
near(xirr([{ date: "2021-01-01", amount: -1000 }, { date: "2022-01-01", amount: 900 }]), -0.1);
// ไม่มีเงินเข้า / ไม่มีเงินออก / ว่าง = คำนวณไม่ได้
assert.equal(xirr([{ date: "2021-01-01", amount: -1000 }, { date: "2022-01-01", amount: -1000 }]), null);
assert.equal(xirr([{ date: "2021-01-01", amount: 1000 }]), null);
assert.equal(xirr([]), null);
// ลำดับรายการไม่มีผล
near(xirr([{ date: "2022-01-01", amount: 1100 }, { date: "2021-01-01", amount: -1000 }]), 0.1);
// ระยะยาวมาก (เบี้ย 20 ปี · ครบสัญญาอีก 76 ปี) ต้องคำนวณได้ ไม่ใช่ "–"
{
  const long = [...Array.from({ length: 20 }, (_, i) => ({ date: `${2017 + i}-07-20`, amount: -1000 })), { date: "2093-07-20", amount: 100000 }];
  const r = xirr(long);
  assert.ok(r !== null && r > 0 && r < 0.1, `long horizon IRR = ${r}`);
  assert.ok(Math.abs(npv(long, r)) < 1e-4, "NPV ≈ 0 ที่ IRR ระยะยาว");
}

// ตัวอย่างที่ตอบเจ้าของ: เบี้ยปีละ 100,000 × 10 ปี · เงินคืน 20,000 ทุก 2 ปี (ปี 2–10) · ครบสัญญาปี 15 ได้ 1,050,000 → คุ้มทุนปีที่ 15 (+150,000)
const L = (id, kind, no, due, amount, status = "PENDING", paid = 0) => ({ id, kind, installment_no: no, due_date: due, amount, paid_amount: paid, status, currency: "THB" });
const prem = Array.from({ length: 10 }, (_, i) => L(`p${i + 1}`, "PREMIUM", i + 1, `${2030 + i}-03-01`, 100000));
const ben = [2, 4, 6, 8, 10].map((y, i) => L(`b${i + 1}`, "BENEFIT", i + 1, `${2030 + y}-03-01`, 20000)).concat(L("b6", "BENEFIT", 6, "2045-03-01", 1050000));
const all = [...prem, ...ben];
const n1 = runningNet(all, [], true);
assert.equal(n1.rows.length, 16);
assert.equal(n1.rows[0].net, -100000);
assert.equal(n1.rows.find((r) => r.key === "p10").net, -1000000 + 80000);   // งวดเบี้ยวันเดียวกับเงินคืน: เบี้ยก่อน
assert.equal(n1.rows.find((r) => r.key === "b5").net, -900000);
assert.equal(n1.breakEven.key, "b6");
assert.equal(n1.breakEven.net, 150000);
assert.equal(n1.final, 150000);
assert.ok(n1.rows.every((r) => r.projected));
// IRR ตามสัญญา: NPV ที่อัตรานั้น ≈ 0 และเป็นบวก
const irrC = xirr(contractFlows(all));
assert.ok(irrC > 0 && irrC < 0.02, `irr ${irrC}`);
assert.ok(Math.abs(npv(contractFlows(all), irrC)) < 1e-3);
// ไม่มีเงินครบสัญญาในตาราง → ไม่ถึงจุดคุ้มทุน
assert.equal(runningNet(all.filter((l) => l.id !== "b6"), [], true).breakEven, null);
// ไม่มีเบี้ยเลย → ไม่มีป้ายคุ้มทุน
assert.equal(runningNet([L("x", "BENEFIT", 1, "2030-01-01", 100)], [], true).breakEven, null);
// บวกแล้วกลับติดลบ แล้วบวกอีก → คุ้มทุน = ครั้งสุดท้ายที่กลับมาไม่ติดลบ
const dip = [L("a", "PREMIUM", 1, "2030-01-01", 100), L("b", "BENEFIT", 1, "2031-01-01", 150), L("c", "PREMIUM", 2, "2032-01-01", 100), L("d", "BENEFIT", 2, "2033-01-01", 100)];
assert.equal(runningNet(dip, [], true).breakEven.key, "d");

// ยอดที่นับของงวด
assert.deepEqual(lineValue(L("h", "PREMIUM", 1, "2020-01-01", 500, "HISTORY"), true), { value: 500, projected: false });
assert.deepEqual(lineValue(L("s", "PREMIUM", 1, "2020-01-01", 500, "SKIPPED"), true), { value: 0, projected: false });
assert.deepEqual(lineValue(L("p", "PREMIUM", 1, "2026-01-01", 500, "PAID", 500), true), { value: 500, projected: false });
assert.deepEqual(lineValue(L("o", "PREMIUM", 1, "2026-01-01", 500, "PARTIAL", 200), true), { value: 500, projected: true });
// กรมธรรม์จบแล้ว: งวดค้างนับเท่าที่จ่ายจริง
assert.deepEqual(lineValue(L("o", "PREMIUM", 1, "2026-01-01", 500, "PARTIAL", 200), false), { value: 200, projected: false });

// เงินจริง / คาดการณ์ / ถ้าเวนคืนวันนี้ (วันนี้ = 2026-06-01)
const lines = [
  L("h1", "PREMIUM", 1, "2024-06-01", 1000, "HISTORY"),           // ก่อน Go-live
  L("p2", "PREMIUM", 2, "2025-06-01", 1000, "PAID", 1000),
  L("p3", "PREMIUM", 3, "2026-05-01", 1000, "OVERDUE"),            // เลยกำหนด → คิดวันนี้
  L("p4", "PREMIUM", 4, "2027-06-01", 1000, "PENDING"),
  L("b1", "BENEFIT", 1, "2028-06-01", 4500, "PENDING"),
];
const cash = [{ kind: "PREMIUM", line_id: "p2", date: "2025-06-10", amount: 1000, currency: "THB" }];
assert.deepEqual(actualFlows(lines, cash), [{ date: "2024-06-01", amount: -1000 }, { date: "2025-06-10", amount: -1000 }]);
const proj = projectedFlows(lines, cash, "2026-06-01", true);
assert.deepEqual(proj.slice(2), [{ date: "2026-06-01", amount: -1000 }, { date: "2027-06-01", amount: -1000 }, { date: "2028-06-01", amount: 4500 }]);
assert.equal(projectedFlows(lines, cash, "2026-06-01", false).length, 2);   // จบแล้ว = เงินจริงเท่านั้น
assert.ok(xirr(proj) > 0);
const sur = surrenderFlows(lines, cash, "2026-06-01", 1500);
assert.deepEqual(sur.at(-1), { date: "2026-06-01", amount: 1500 });
assert.ok(xirr(sur) < 0);                                              // ได้คืนน้อยกว่าที่จ่าย
// รับเงินก้อนไม่ผูกงวด นับในสุทธิสะสม
const n2 = runningNet([L("p", "PREMIUM", 1, "2025-01-01", 1000, "PAID", 1000)], [{ key: "r1", date: "2026-01-01", amount: 1200 }], true);
assert.equal(n2.breakEven.key, "r1");
assert.equal(n2.final, 200);

// ปีกรมธรรม์: วันเริ่มสัญญา = 0 · ครบรอบ = ปีถัดไป · ระหว่างปี = ปีที่ครบล่าสุด
assert.equal(policyYearAt("2017-07-20", "2017-07-20"), 0);
assert.equal(policyYearAt("2017-07-20", "2018-07-19"), 0);
assert.equal(policyYearAt("2017-07-20", "2018-07-20"), 1);
assert.equal(policyYearAt("2017-07-20", "2022-07-20"), 5);
assert.equal(policyYearAt("2017-07-20", "2022-12-31"), 5);
assert.equal(policyYearAt("2017-07-20", "2017-07-19"), null);    // ก่อนเริ่มสัญญา
assert.equal(policyYearAt(null, "2022-07-20"), null);
assert.equal(policyYearAt("2020-02-29", "2021-02-28"), 0);       // เริ่ม 29 ก.พ. → ครบรอบปีปกติ 1 มี.ค.
assert.equal(policyYearAt("2020-02-29", "2021-03-01"), 1);

// อายุเต็มปี ณ วันนั้น
assert.equal(ageAt("1980-05-10", "2022-05-09"), 41);
assert.equal(ageAt("1980-05-10", "2022-05-10"), 42);
assert.equal(ageAt(null, "2022-05-10"), null);

// เวนคืนคุ้มทุน: ปีแรกที่มูลค่าเวนคืน ≥ เบี้ยสุทธิที่จ่ายก่อนวันนั้น (เบี้ยวันเดียวกันไม่นับ)
{
  // เบี้ยปีละ 1,000 × 3 งวด (2020–2022) · มูลค่าเวนคืนปีที่ 1–4
  const net = [{ date: "2020-01-01", net: -1000 }, { date: "2021-01-01", net: -2000 }, { date: "2022-01-01", net: -3000 }];
  const cv = [
    { policy_year: 1, value_date: "2021-01-01", value: 500 },
    { policy_year: 2, value_date: "2022-01-01", value: 2000 },   // จ่ายไปก่อนวันนั้น 2,000 (งวด 3 ครบวันเดียวกัน ไม่นับ) → คุ้มทุน
    { policy_year: 3, value_date: "2023-01-01", value: 3100 },
  ];
  assert.equal(cvBreakEven(net, cv)?.policy_year, 2);
  assert.equal(cvBreakEven(net, cv.map((r) => ({ ...r, value: r.value - 1 })))?.policy_year, 3);
  assert.equal(cvBreakEven(net, [{ policy_year: 1, value_date: "2021-01-01", value: 999 }]), null);
  // ได้เงินคืนจนสุทธิ ≥ 0 แล้ว = ไม่ต้องเวนคืนก็คุ้ม → ไม่ติดป้าย
  assert.equal(cvBreakEven([{ date: "2020-01-01", net: -1000 }, { date: "2020-06-01", net: 500 }], [{ policy_year: 1, value_date: "2021-01-01", value: 100 }]), null);
  // ยังไม่จ่ายอะไรก่อนวันนั้น = ไม่นับ
  assert.equal(cvBreakEven(net, [{ policy_year: 0, value_date: "2019-01-01", value: 0 }]), null);
}

// สุทธิสะสมตามเงินจริง (ตกลง 8 พ.ย. 2026): เงินจริงวางตามวันที่จ่าย / รับจริง · งวดค้าง = ยอดค้าง ณ วันครบกำหนด (คาดการณ์)
{
  const lines = [
    L("h1", "PREMIUM", 1, "2024-07-20", 1000, "HISTORY"),             // ก่อน Go-live = เต็มงวด ณ วันครบกำหนด
    L("p2", "PREMIUM", 2, "2025-07-20", 1000, "PAID", 1000),          // จ่ายจริงวันที่ 2025-08-13 (แถวเงินจริง)
    L("b1", "BENEFIT", 1, "2026-01-01", 3000, "PARTIAL", 2000),       // รับก่อน 2,000 (2025-11-08) · ค้าง 1,000
    L("p3", "PREMIUM", 3, "2026-07-20", 1000, "PENDING"),
  ];
  const cash = [{ key: "e1", kind: "PREMIUM", date: "2025-08-13", amount: 1000 }, { key: "r1", kind: "BENEFIT", date: "2025-11-08", amount: 2000 }];
  const n = cashNet(lines, cash, true);
  assert.deepEqual(n.rows.map((r) => [r.key, r.net, r.projected]), [
    ["h1", -1000, false], ["p2", -1000, false], ["e1", -2000, false], ["r1", 0, false], ["b1", 1000, true], ["p3", 0, true]]);
  assert.equal(n.breakEven.key, "r1");
  // วันเดียวกัน: แถวงวดก่อนแถวเงินจริง
  const same = cashNet([L("p", "PREMIUM", 1, "2025-01-01", 500, "PAID", 500)], [{ key: "e", kind: "PREMIUM", date: "2025-01-01", amount: 500 }], true);
  assert.deepEqual(same.rows.map((r) => [r.key, r.net]), [["p", 0], ["e", -500]]);
  // กรมธรรม์จบแล้ว: งวดค้างไม่นับ
  assert.deepEqual(cashNet([L("x", "PREMIUM", 1, "2030-01-01", 700)], [], false).rows.map((r) => [r.net, r.projected]), [[0, false]]);
}

console.log("insurance-flow: all tests passed");
