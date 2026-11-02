// เงินลงทุนสุทธิของพอร์ต = เงินที่โอนเข้าก่อน Go-live (portfolio_capital_transfers) + เงินโอนหลัง Go-live (cash_movements)
//   โอนไปพอร์ต (INVESTMENT_OUT) บวก · โอนกลับจากพอร์ต (INVESTMENT_IN) ลบ · ตกลง 2 พ.ย. 2026
//   ใช้เทียบกับมูลค่าล่าสุด → กำไร / ขาดทุนรวม (บาท = รวมผลค่าเงิน · สกุลพอร์ต = ผลการลงทุนล้วน)

/** แถวของ portfolio_capital_transfers (ก่อน Go-live) */
export type CapitalPre = { id: string; portfolio_asset_id: string; transfer_date: string; amount_thb: number; amount_ccy: number | null; notes: string | null };
/** เงินโอนธนาคาร ↔ พอร์ต หลัง Go-live (cash_movements ที่ไม่ใช่รายการระบบสร้าง) */
export type CapitalMove = { id: string; movement_date: string; movement_type: string; from_asset_id: string | null; to_asset_id: string | null;
  amount: number; currency: string; counter_amount: number | null; counter_currency: string | null; base_amount: number | null };

export const CAPITAL_MOVE_COLS = "id,movement_date,movement_type,from_asset_id,to_asset_id,amount,currency,counter_amount,counter_currency,base_amount";

export type CapitalLine = { key: string; date: string; kind: "PRE" | "OUT" | "IN"; thb: number; ccy: number | null; pre?: CapitalPre; moveId?: string };
export type NetInvested = { thb: number; ccy: number | null; lines: CapitalLine[] };

/** พอร์ตของรายการโอน (OUT = ปลายทาง · IN = ต้นทาง) */
export const movePortfolio = (m: CapitalMove) => (m.movement_type === "INVESTMENT_OUT" ? m.to_asset_id : m.from_asset_id);

/**
 * รวมเงินลงทุนสุทธิของพอร์ตหนึ่ง · pfCcy = สกุลพอร์ต
 * บาท: ก่อน Go-live = ยอดบาทที่ใส่ · โอนไป = ยอดบาทของฝั่งธนาคาร (base_amount) · โอนกลับ = ยอดบาทที่เข้าบัญชี (ยังไม่ทราบ → base_amount)
 * สกุลพอร์ต: ยอดฝั่งพอร์ต · ไม่ทราบสักรายการ (เช่น รอยอดปลายทาง / ก่อน Go-live ไม่ได้ใส่) → null (แสดงเฉพาะบาท)
 */
export function netInvested(assetId: string, pfCcy: string, pre: CapitalPre[], moves: CapitalMove[]): NetInvested {
  const lines: CapitalLine[] = [];
  pre.filter((p) => p.portfolio_asset_id === assetId).forEach((p) => lines.push({
    key: `p${p.id}`, date: p.transfer_date, kind: "PRE", thb: Number(p.amount_thb),
    ccy: pfCcy === "THB" ? Number(p.amount_thb) : p.amount_ccy == null ? null : Number(p.amount_ccy), pre: p }));
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
    lines.push({ key: `m${m.id}`, date: m.movement_date, kind: out ? "OUT" : "IN", thb: s * thb, ccy: ccy == null ? null : s * ccy, moveId: m.id });
  });
  lines.sort((a, b) => a.date.localeCompare(b.date));
  const thb = lines.reduce((t, l) => t + l.thb, 0);
  const ccy = lines.some((l) => l.ccy == null) ? null : lines.reduce((t, l) => t + (l.ccy ?? 0), 0);
  return { thb, ccy, lines };
}

/** กำไร / ขาดทุนเทียบเงินลงทุนสุทธิ (% เฉพาะเมื่อเงินลงทุนสุทธิ > 0) */
export function vsInvested(value: number | null, invested: number | null) {
  if (value == null || invested == null) return null;
  const pl = value - invested;
  return { pl, pct: invested > 0 ? (pl / invested) * 100 : null };
}
