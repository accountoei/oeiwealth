// node scripts/value-parts.test.mjs — มูลค่าใหม่ของทรัพย์สินที่มีส่วนประกอบ (src/app/(app)/property/valueParts.ts · ตัวเลขสมมติ)
// ใช้ทั้งแท็บอัปเดตมูลค่า (property/ValueBatch.tsx) และหน้าต่างปรับมูลค่าของหน้าทรัพย์สิน (property/ValuePartsForm.tsx)
// ต้องใช้ Node 22.18+ (อ่านไฟล์ .ts ได้เอง)
import assert from "node:assert/strict";
import { VALUE_PLAN_ERROR as E, partsSum, planValueParts, splitByArea } from "../src/app/(app)/property/valueParts.ts";

const P = (key, land, area, last, typed = null) => ({ key, land, area, last, typed });

// splitByArea: ตามเนื้อที่ · เศษไปใบสุดท้าย · ไม่มีเนื้อที่ = เท่ากัน
assert.deepEqual(splitByArea(1000, [100, 300]), [250, 750]);
assert.deepEqual(splitByArea(100, [1, 1, 1]), [33.33, 33.33, 33.34]);
assert.deepEqual(splitByArea(90, [0, 0]), [45, 45]);
assert.deepEqual(splitByArea(10, []), []);
assert.equal(partsSum([{ value: 0.1 }, { value: 0.2 }]), 0.3);

// ไม่ได้กรอกอะไร
assert.deepEqual(planValueParts([P("l1", true, 100, 500)], null), { total: null, values: null, auto: [], est: {} });

// ยอดรวม: อาคารคงยอดล่าสุด · ที่ดิน 2 แปลงรับส่วนที่เหลือตามเนื้อที่
const house = [P("l1", true, 100, 1000), P("l2", true, 300, 3000), P("b", false, null, 2000)];
let r = planValueParts(house, 10000);
assert.deepEqual(r, { total: 10000, values: { l1: 2000, l2: 6000, b: 2000 }, auto: ["l1", "l2"], est: { l1: 2000, l2: 6000 } });

// ยอดรวม + อาคารพิมพ์ใหม่
r = planValueParts([P("l1", true, 100, 1000), P("l2", true, 300, 3000), P("b", false, null, 2000, 4000)], 10000);
assert.deepEqual(r.values, { l1: 1500, l2: 4500, b: 4000 });

// ที่ดินที่พิมพ์เองคงตามที่พิมพ์ · ที่ดินอีกแปลงรับส่วนที่เหลือ
r = planValueParts([P("l1", true, 100, 1000, 2500), P("l2", true, 300, 3000), P("b", false, null, 2000)], 10000);
assert.deepEqual(r.values, { l1: 2500, l2: 5500, b: 2000 });
assert.deepEqual(r.auto, ["l2"]);

// ยอดรวมน้อยกว่าอาคาร → ที่ดินติดลบ = error (ยังเห็นตัวเลขประมาณ)
r = planValueParts(house, 1500);
assert.equal(r.error, E.NEG_LAND);
assert.equal(r.values, null);
assert.deepEqual(r.est, { l1: -125, l2: -375 });

// อาคารไม่รู้ยอดล่าสุด → บันทึกยอดรวมอย่างเดียว
assert.deepEqual(planValueParts([P("l1", true, 100, null), P("b", false, null, null)], 5000), { total: 5000, values: null, auto: [], est: {} });

// ไม่มีที่ดิน: แถวเดียวที่ไม่ได้พิมพ์รับส่วนที่เหลือ
r = planValueParts([P("b1", false, null, 1000, 1200), P("b2", false, null, 800)], 3000);
assert.deepEqual(r.values, { b1: 1200, b2: 1800 });
assert.deepEqual(r.auto, ["b2"]);

// ไม่มีที่ดิน + ไม่ได้พิมพ์รายแถว (2 แถว) → ยอดรวมอย่างเดียว (แบ่งตามสัดส่วนเดิม)
assert.deepEqual(planValueParts([P("b1", false, null, 1000), P("b2", false, null, 800)], 3000), { total: 3000, values: null, auto: [], est: {} });

// พิมพ์ครบทุกแถว + ยอดรวม: ต้องเท่ากัน
r = planValueParts([P("b1", false, null, 1000, 1200), P("b2", false, null, 800, 1800)], 3000);
assert.deepEqual(r.values, { b1: 1200, b2: 1800 });
r = planValueParts([P("b1", false, null, 1000, 1200), P("b2", false, null, 800, 1700)], 3000);
assert.equal(r.error, E.MISMATCH);

// ส่วนประกอบเดียว + ยอดรวม → แถวนั้น = ยอดรวม
assert.deepEqual(planValueParts([P("l1", true, 50, 900)], 1000).values, { l1: 1000 });
// ไม่มีส่วนประกอบ → ยอดรวมอย่างเดียว
assert.deepEqual(planValueParts([], 1000), { total: 1000, values: null, auto: [], est: {} });

// พิมพ์เฉพาะรายแถว → ยอดรวม = ผลรวม (แถวที่ไม่ได้พิมพ์ = ยอดล่าสุด)
r = planValueParts([P("l1", true, 100, 1000, 1500.25), P("b", false, null, 2000.5)], null);
assert.deepEqual(r, { total: 3500.75, values: { l1: 1500.25, b: 2000.5 }, auto: [], est: {} });
// ครั้งก่อนเป็นยอดรวม (ไม่รู้รายแถว) และกรอกไม่ครบ → ต้องกรอกให้ครบ
r = planValueParts([P("l1", true, 100, null, 1500), P("b", false, null, null)], null);
assert.ok(Number.isNaN(r.total));
assert.equal(r.error, E.INCOMPLETE);

console.log("value-parts: all tests passed");
