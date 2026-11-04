/**
 * กระแสเงินของกรมธรรม์ (เบี้ย = เงินออก · ผลประโยชน์ = เงินเข้า) สำหรับแท็บ "เบี้ยและผลประโยชน์" (ตกลง 4 พ.ย. 2026)
 *   - สุทธิสะสม: ผลประโยชน์ − เบี้ย นับรวมตั้งแต่งวดแรกถึงแถวนั้น · คุ้มทุน = แถวแรกที่ยอดกลับมาไม่ติดลบ และไม่ติดลบอีกจนจบตาราง
 *   - IRR 3 ตัว (XIRR ตามวันที่จริง · วัน ÷ 365 แบบ Excel · ไม่รวมภาษีที่ลดหย่อนได้):
 *       ตามสัญญา  = ทุกงวดในตาราง ยอดเต็ม ณ วันครบกำหนด
 *       คาดการณ์ = เงินจริงที่จ่าย / รับแล้ว + งวดที่ยังค้างตามตาราง (กรมธรรม์จบแล้ว = ผลตอบแทนจริง)
 *       ถ้าเวนคืนวันนี้ = เงินจริงถึงวันนี้ + มูลค่าเวนคืนล่าสุด เหมือนได้รับวันนี้
 *   ไฟล์นี้ไม่มี import (ทดสอบด้วย node scripts/insurance-flow.test.mjs)
 */

export type Cash = { date: string; amount: number };

/** XIRR: อัตราผลตอบแทนต่อปี (0.0185 = 1.85%) · ต้องมีทั้งเงินออกและเงินเข้า · หาไม่ได้ = null */
export function xirr(flows: Cash[]): number | null {
  const fs = flows.filter((f) => Number.isFinite(f.amount) && Math.abs(f.amount) > 0.005);
  if (!fs.some((f) => f.amount > 0) || !fs.some((f) => f.amount < 0)) return null;
  const t0 = Math.min(...fs.map((f) => Date.parse(f.date)));
  const ts = fs.map((f) => ({ t: (Date.parse(f.date) - t0) / 86_400_000 / 365, a: f.amount }));
  const npv = (r: number) => ts.reduce((s, x) => s + x.a / Math.pow(1 + r, x.t), 0);
  // หาช่วงที่ NPV เปลี่ยนเครื่องหมาย แล้วแบ่งครึ่ง (ไม่แกว่งแบบ Newton)
  let lo = -0.9999, hi = 1;
  let flo = npv(lo), fhi = npv(hi);
  while (flo * fhi > 0 && hi < 1e4) { hi *= 4; fhi = npv(hi); }
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 300 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (fm === 0) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

/** งวดในตาราง (จาก v_insurance_schedule_status) */
export type FlowLine = {
  id: string; kind: string; installment_no: number; due_date: string; amount: number; paid_amount: number; status: string; currency: string;
};
/** เงินจริง: จ่ายเบี้ย (expense_items) / รับผลประโยชน์ (insurance_benefit_receipts) · line_id = null → รับเงินก้อนไม่ผูกงวด */
export type FlowCash = { kind: "PREMIUM" | "BENEFIT"; line_id: string | null; date: string; amount: number; currency: string };

const OPEN = ["PENDING", "OVERDUE", "PARTIAL"];
const sign = (kind: string) => (kind === "PREMIUM" ? -1 : 1);
/** ลำดับในตาราง: วันที่ → เบี้ยก่อนผลประโยชน์ (วันเดียวกัน) → งวด */
export const flowOrder = (a: { date: string; kind: string; no: number }, b: { date: string; kind: string; no: number }) =>
  a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "PREMIUM" ? -1 : 1) || a.no - b.no;

/** ยอดที่นับของงวด: ก่อน Go-live = เต็มงวด · ค้าง (กรมธรรม์ยังมีผล) = เต็มงวดตามตาราง (คาดการณ์) · อื่น ๆ = ยอดที่จ่าย / รับจริง */
export function lineValue(l: FlowLine, active: boolean): { value: number; projected: boolean } {
  if (l.status === "HISTORY") return { value: Number(l.amount), projected: false };
  if (OPEN.includes(l.status) && active) return { value: Number(l.amount), projected: true };
  return { value: Number(l.paid_amount), projected: false };
}

export type NetRow = { key: string; date: string; net: number; projected: boolean };

/**
 * สุทธิสะสมต่อแถว (งวด + รับเงินก้อนไม่ผูกงวด) เรียงตาม flowOrder · breakEven = key ของแถวคุ้มทุน (null = ไม่ถึง / ไม่มีเบี้ย)
 * lumps = รับเงินก้อนที่ไม่ผูกงวด (key ของแต่ละก้อนส่งมาเอง)
 */
export function runningNet(lines: FlowLine[], lumps: { key: string; date: string; amount: number }[], active: boolean) {
  const items = [
    ...lines.map((l) => { const v = lineValue(l, active); return { key: l.id, date: l.due_date, kind: l.kind, no: l.installment_no, amt: sign(l.kind) * v.value, projected: v.projected }; }),
    ...lumps.map((r) => ({ key: r.key, date: r.date, kind: "BENEFIT", no: 0, amt: Number(r.amount), projected: false })),
  ].sort(flowOrder);
  let net = 0;
  const rows: NetRow[] = items.map((it) => { net += it.amt; return { key: it.key, date: it.date, net, projected: it.projected }; });
  const lastNeg = rows.findLastIndex((r) => r.net < -0.005);
  const breakEven = lastNeg >= 0 && lastNeg + 1 < rows.length ? rows[lastNeg + 1] : null;
  return { rows, breakEven, final: net };
}

/** วันที่ที่ใช้คิดงวดค้าง: ครบกำหนดแล้วแต่ยังไม่จ่าย / รับ = วันนี้ */
const laterOf = (a: string, b: string) => (a > b ? a : b);

/** กระแสเงินตามสัญญา (ทุกงวด ยอดเต็ม ณ วันครบกำหนด) */
export function contractFlows(lines: FlowLine[]): Cash[] {
  return lines.map((l) => ({ date: l.due_date, amount: sign(l.kind) * Number(l.amount) }));
}

/** เงินจริงถึงวันนี้: งวดก่อน Go-live (เต็มงวด ณ วันครบกำหนด) + ทุกรายการที่จ่าย / รับจริง */
export function actualFlows(lines: FlowLine[], cash: FlowCash[]): Cash[] {
  return [
    ...lines.filter((l) => l.status === "HISTORY").map((l) => ({ date: l.due_date, amount: sign(l.kind) * Number(l.amount) })),
    ...cash.map((c) => ({ date: c.date, amount: sign(c.kind) * Number(c.amount) })),
  ];
}

/** คาดการณ์: เงินจริง + ยอดค้างของงวดที่ยังไม่ครบ (เฉพาะกรมธรรม์ที่ยังมีผล) */
export function projectedFlows(lines: FlowLine[], cash: FlowCash[], today: string, active: boolean): Cash[] {
  const open = active ? lines.filter((l) => OPEN.includes(l.status)) : [];
  return [
    ...actualFlows(lines, cash),
    ...open.map((l) => ({ date: laterOf(l.due_date, today), amount: sign(l.kind) * Math.max(0, Number(l.amount) - Number(l.paid_amount)) })),
  ];
}

/** ถ้าเวนคืนวันนี้: เงินจริงถึงวันนี้ + มูลค่าเวนคืนเป็นเงินเข้าวันนี้ */
export function surrenderFlows(lines: FlowLine[], cash: FlowCash[], today: string, cashValue: number): Cash[] {
  return [...actualFlows(lines, cash), { date: today, amount: cashValue }];
}
