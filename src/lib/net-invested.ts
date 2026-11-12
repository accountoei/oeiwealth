// เงินลงทุนสุทธิของพอร์ต = ต้นทุนรวมของยอดตั้งต้น (ก่อน Go-live · ตกลง 12 พ.ย. 2026 แทนเงินโอนก่อน Go-live ที่กรอกเอง) + เงินโอนหลัง Go-live (cash_movements)
//   โอนไปพอร์ต (INVESTMENT_OUT) บวก · โอนกลับจากพอร์ต (INVESTMENT_IN) ลบ · ตกลง 2 พ.ย. 2026
//   ใช้เทียบกับมูลค่าล่าสุด → กำไร / ขาดทุนรวม (บาท = รวมผลค่าเงิน · สกุลพอร์ต = ผลการลงทุนล้วน)
//   ตกลง 12 พ.ย. 2026: นับเงินที่พอร์ตจ่ายเข้า / ตัดจากบัญชีธนาคารโดยตรงด้วย — ซื้อตัดบัญชี = โอนไป · ขาย / ไถ่ถอน / ครบกำหนดเข้าบัญชี = โอนกลับ
//   ปันผล / ดอกเบี้ย / Coupon ที่เข้าบัญชีธนาคารโดยตรง (ไม่อยู่ในมูลค่าพอร์ต) บวกกลับในกำไร / ขาดทุน (incomeToBank)

/** ยอดตั้งต้น (OPENING_BALANCE) ของพอร์ต · ต้นทุน = จำนวน × ราคาต่อหน่วย (สกุลหลักทรัพย์) / cost_base_currency (บาท) */
export type OpeningCost = { portfolio_asset_id: string; transaction_date: string; quantity: number | null; price: number | null; currency: string; cost_base_currency: number | null };
export const OPENING_COST_COLS = "transaction_date,quantity,price,currency,cost_base_currency";
/** เงินโอนธนาคาร ↔ พอร์ต หลัง Go-live (cash_movements ที่ไม่ใช่รายการระบบสร้าง) */
export type CapitalMove = { id: string; movement_date: string; movement_type: string; from_asset_id: string | null; to_asset_id: string | null;
  amount: number; currency: string; counter_amount: number | null; counter_currency: string | null; base_amount: number | null; is_derived?: boolean };

export const CAPITAL_MOVE_COLS = "id,movement_date,movement_type,from_asset_id,to_asset_id,amount,currency,counter_amount,counter_currency,base_amount,is_derived";

/** derived = ซื้อ / ขาย ที่ชำระกับบัญชีธนาคารโดยตรง (ระบบสร้างจากรายการในพอร์ต) */
export type CapitalLine = { key: string; date: string; kind: "PRE" | "OUT" | "IN"; thb: number; ccy: number | null; moveId?: string; derived?: boolean };
export type NetInvested = { thb: number; ccy: number | null; lines: CapitalLine[] };

/** พอร์ตของรายการโอน (OUT = ปลายทาง · IN = ต้นทาง) */
export const movePortfolio = (m: CapitalMove) => (m.movement_type === "INVESTMENT_OUT" ? m.to_asset_id : m.from_asset_id);

/**
 * รวมเงินลงทุนสุทธิของพอร์ตหนึ่ง · pfCcy = สกุลพอร์ต
 * บาท: ก่อน Go-live = ต้นทุนรวมของยอดตั้งต้น (1 บรรทัด) · โอนไป = ยอดบาทของฝั่งธนาคาร (base_amount) · โอนกลับ = ยอดบาทที่เข้าบัญชี (ยังไม่ทราบ → base_amount)
 * สกุลพอร์ต: ยอดฝั่งพอร์ต · ไม่ทราบสักรายการ (เช่น รอยอดปลายทาง / ยอดตั้งต้นต่างสกุลพอร์ต) → null (แสดงเฉพาะบาท)
 */
export function netInvested(assetId: string, pfCcy: string, opening: OpeningCost[], moves: CapitalMove[]): NetInvested {
  const lines: CapitalLine[] = [];
  const op = opening.filter((o) => o.portfolio_asset_id === assetId);
  if (op.length) {
    const thb = op.reduce((t, o) => t + Number(o.cost_base_currency ?? 0), 0);
    lines.push({ key: "opening", date: op[0].transaction_date, kind: "PRE", thb,
      ccy: pfCcy === "THB" ? thb : op.every((o) => o.currency === pfCcy) ? op.reduce((t, o) => t + Number(o.quantity ?? 0) * Number(o.price ?? 0), 0) : null });
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
  return { thb, ccy, lines };
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
