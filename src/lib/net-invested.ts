// เงินลงทุนสุทธิของพอร์ต = ต้นทุนรวมของยอดตั้งต้น (ก่อน Go-live · ตกลง 12 พ.ย. 2026 แทนเงินโอนก่อน Go-live ที่กรอกเอง) + เงินโอนหลัง Go-live (cash_movements)
//   ตกลง 12 พ.ย. 2026 (ค่ำ): ใส่ "เงินที่โอนไปจริงก่อน Go-live" (portfolio_capital_transfers) ได้ → ใช้แทนต้นทุนรวมของยอดตั้งต้น
//     ต้นทุนรายตัวยังเป็นต้นทุนจริง · ส่วนต่าง (ต้นทุนรวม − เงินที่โอนไปจริง) = ปรับกำไร (ขาดทุน) ก่อน Go-live แสดงประกอบ
//   โอนไปพอร์ต (INVESTMENT_OUT) บวก · โอนกลับจากพอร์ต (INVESTMENT_IN) ลบ · ตกลง 2 พ.ย. 2026
//   ใช้เทียบกับมูลค่าล่าสุด → กำไร / ขาดทุนรวม (บาท = รวมผลค่าเงิน · สกุลพอร์ต = ผลการลงทุนล้วน)
//   ตกลง 12 พ.ย. 2026: นับเงินที่พอร์ตจ่ายเข้า / ตัดจากบัญชีธนาคารโดยตรงด้วย — ซื้อตัดบัญชี = โอนไป · ขาย / ไถ่ถอน / ครบกำหนดเข้าบัญชี = โอนกลับ
//   ปันผล / ดอกเบี้ย / Coupon ที่เข้าบัญชีธนาคารโดยตรง (ไม่อยู่ในมูลค่าพอร์ต) บวกกลับในกำไร / ขาดทุน (incomeToBank)

/** ยอดตั้งต้น (OPENING_BALANCE) ของพอร์ต · ต้นทุน = จำนวน × ราคาต่อหน่วย (สกุลหลักทรัพย์) / cost_base_currency (บาท) */
export type OpeningCost = { portfolio_asset_id: string; transaction_date: string; quantity: number | null; price: number | null; currency: string; cost_base_currency: number | null };
export const OPENING_COST_COLS = "transaction_date,quantity,price,currency,cost_base_currency";
/** เงินที่โอนไปจริงก่อน Go-live (portfolio_capital_transfers · ใส่เองที่หน้าต่างรายการเงินโอน) */
export type CapitalPre = { id: string; portfolio_asset_id: string; transfer_date: string; amount_thb: number; amount_ccy: number | null; notes: string | null };
export const CAPITAL_PRE_COLS = "id,portfolio_asset_id,transfer_date,amount_thb,amount_ccy,notes";
/** เงินโอนธนาคาร ↔ พอร์ต หลัง Go-live (cash_movements ที่ไม่ใช่รายการระบบสร้าง) */
export type CapitalMove = { id: string; movement_date: string; movement_type: string; from_asset_id: string | null; to_asset_id: string | null;
  amount: number; currency: string; counter_amount: number | null; counter_currency: string | null; base_amount: number | null; is_derived?: boolean };

export const CAPITAL_MOVE_COLS = "id,movement_date,movement_type,from_asset_id,to_asset_id,amount,currency,counter_amount,counter_currency,base_amount,is_derived";

/** derived = ซื้อ / ขาย ที่ชำระกับบัญชีธนาคารโดยตรง (ระบบสร้างจากรายการในพอร์ต) */
export type CapitalLine = { key: string; date: string; kind: "PRE" | "OUT" | "IN"; thb: number; ccy: number | null; pre?: CapitalPre; moveId?: string; derived?: boolean };
/** cost = ต้นทุนรวมของยอดตั้งต้น เมื่อใส่เงินที่โอนไปจริงก่อน Go-live แล้ว (แสดงประกอบ ไม่นับในยอด) */
export type NetInvested = { thb: number; ccy: number | null; lines: CapitalLine[]; cost: CapitalLine | null };

/** พอร์ตของรายการโอน (OUT = ปลายทาง · IN = ต้นทาง) */
export const movePortfolio = (m: CapitalMove) => (m.movement_type === "INVESTMENT_OUT" ? m.to_asset_id : m.from_asset_id);

/**
 * รวมเงินลงทุนสุทธิของพอร์ตหนึ่ง · pfCcy = สกุลพอร์ต
 * บาท: ก่อน Go-live = เงินที่โอนไปจริง (ถ้าใส่ไว้) ไม่เช่นนั้นต้นทุนรวมของยอดตั้งต้น (1 บรรทัด) · โอนไป = ยอดบาทของฝั่งธนาคาร (base_amount) · โอนกลับ = ยอดบาทที่เข้าบัญชี (ยังไม่ทราบ → base_amount)
 * สกุลพอร์ต: ยอดฝั่งพอร์ต · ไม่ทราบสักรายการ (เช่น รอยอดปลายทาง / ยอดตั้งต้นไม่มีสกุลพอร์ตเลย) → null (แสดงเฉพาะบาท)
 */
export function netInvested(assetId: string, pfCcy: string, opening: OpeningCost[], moves: CapitalMove[], pre: CapitalPre[] = []): NetInvested {
  const lines: CapitalLine[] = [];
  const sent = pre.filter((p) => p.portfolio_asset_id === assetId);
  sent.forEach((p) => lines.push({ key: `p${p.id}`, date: p.transfer_date, kind: "PRE", thb: Number(p.amount_thb),
    ccy: pfCcy === "THB" ? Number(p.amount_thb) : p.amount_ccy == null ? null : Number(p.amount_ccy), pre: p }));
  let cost: CapitalLine | null = null;
  const op = opening.filter((o) => o.portfolio_asset_id === assetId);
  if (op.length) {
    const thb = op.reduce((t, o) => t + Number(o.cost_base_currency ?? 0), 0);
    // ยอดตั้งต้นต่างสกุลพอร์ต (เช่น AUD ในพอร์ต USD) แปลงด้วยอัตราเฉลี่ยของยอดตั้งต้นสกุลพอร์ต (ต้นทุนบาท ÷ ต้นทุนสกุลพอร์ต)
    const same = op.filter((o) => o.currency === pfCcy);
    const sameCcy = same.reduce((t, o) => t + Number(o.quantity ?? 0) * Number(o.price ?? 0), 0);
    const sameThb = same.reduce((t, o) => t + Number(o.cost_base_currency ?? 0), 0);
    cost = { key: "opening", date: op[0].transaction_date, kind: "PRE", thb,
      ccy: pfCcy === "THB" ? thb : same.length === op.length ? sameCcy : sameCcy > 0 && sameThb > 0 ? sameCcy + (thb - sameThb) * sameCcy / sameThb : null };
    if (!sent.length) lines.push(cost);
  }
  moves.filter((m) => movePortfolio(m) === assetId).forEach((m) => {
    const out = m.movement_type === "INVESTMENT_OUT";
    // ฝั่งพอร์ต: โอนไป = ปลายทาง (counter ถ้าต่างสกุล) · โอนกลับ = ต้นทาง
    const pfSide = out ? (m.counter_currency ? (m.counter_amount == null ? null : { amt: Number(m.counter_amount), ccy: m.counter_currency }) : { amt: Number(m.amount), ccy: m.currency })
      : { amt: Number(m.amount), ccy: m.currency };
    // ฝั่งธนาคาร (บาท): โอนไป = ต้นทาง · โอนกลับ = ปลายทาง
    const thb = out ? (m.currency === "THB" ? Number(m.amount) : Number(m.base_amount ?? 0))
      : (m.counter_currency === "THB" && m.counter_amount != null ? Number(m.counter_amount)
        : !m.counter_currency && m.currency === "THB" ? Number(m.amount) : Number(m.base_amount ?? 0));
    const ccy = pfCcy === "THB" ? thb : pfSide && pfSide.ccy === pfCcy ? pfSide.amt : null;
    const s = out ? 1 : -1;
    lines.push({ key: `m${m.id}`, date: m.movement_date, kind: out ? "OUT" : "IN", thb: s * thb, ccy: ccy == null ? null : s * ccy, moveId: m.id, derived: !!m.is_derived });
  });
  lines.sort((a, b) => a.date.localeCompare(b.date));
  const thb = lines.reduce((t, l) => t + l.thb, 0);
  const ccy = lines.some((l) => l.ccy == null) ? null : lines.reduce((t, l) => t + (l.ccy ?? 0), 0);
  return { thb, ccy, lines, cost: sent.length ? cost : null };
}

/** ปันผล / ดอกเบี้ย / Coupon ที่เข้าบัญชีธนาคารโดยตรง (investment_transactions ที่มี settle_to_asset_id) */
export type IncomeToBank = { amount: number; fee: number | null; tax: number | null; currency: string; amount_base_currency: number | null };
export const INCOME_TO_BANK_COLS = "amount,fee,tax,currency,amount_base_currency";

/** รวมยอดสุทธิ (หลังค่าธรรมเนียม / ภาษี) · บาท + สกุลพอร์ต (null = มีรายการต่างสกุล) */
export function incomeToBank(pfCcy: string, rows: IncomeToBank[]) {
  let thb = 0, ccy: number | null = 0;
  for (const r of rows) {
    const amt = Number(r.amount);
    const net = amt - Number(r.fee ?? 0) - Number(r.tax ?? 0);
    thb += r.currency === "THB" ? net : amt ? (net * Number(r.amount_base_currency ?? 0)) / amt : 0;
    ccy = ccy == null || r.currency !== pfCcy ? null : ccy + net;
  }
  return { thb, ccy: pfCcy === "THB" ? thb : ccy };
}

/** กำไร / ขาดทุนเทียบเงินลงทุนสุทธิ = มูลค่า + ผลตอบแทนที่เข้าบัญชีธนาคารแล้ว − เงินลงทุนสุทธิ (% เฉพาะเมื่อเงินลงทุนสุทธิ > 0) */
export function vsInvested(value: number | null, invested: number | null, received: number | null = 0) {
  if (value == null || invested == null || received == null) return null;
  const pl = value + received - invested;
  return { pl, pct: invested > 0 ? (pl / invested) * 100 : null };
}
