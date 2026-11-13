// เงินลงทุนสุทธิของพอร์ต = ต้นทุนรวมของยอดตั้งต้น (ก่อน Go-live · ตกลง 12 พ.ย. 2026 แทนเงินโอนก่อน Go-live ที่กรอกเอง) + เงินโอนหลัง Go-live (cash_movements)
//   ตกลง 12 พ.ย. 2026 (ค่ำ): ใส่ "เงินที่โอนไปจริงก่อน Go-live" (portfolio_capital_transfers) ได้ → ใช้แทนต้นทุนรวมของยอดตั้งต้น
//     ต้นทุนรายตัวยังเป็นต้นทุนจริง · ส่วนต่าง (ต้นทุนรวม − เงินที่โอนไปจริง) = ผลตอบแทนที่รับรู้แล้วก่อน Go-live แสดงประกอบ (ชื่อใหม่ 13 พ.ย. 2026)
//   โอนไปพอร์ต (INVESTMENT_OUT) บวก · โอนกลับจากพอร์ต (INVESTMENT_IN) ลบ · ตกลง 2 พ.ย. 2026
//   ใช้เทียบกับมูลค่าล่าสุด → รวมผลตอบแทน (returnSplit · บาท = รวมผลค่าเงิน · สกุลพอร์ต = ผลการลงทุนล้วน)
//   ตกลง 12 พ.ย. 2026: นับเงินที่พอร์ตจ่ายเข้า / ตัดจากบัญชีธนาคารโดยตรงด้วย — ซื้อตัดบัญชี = โอนไป · ขาย / ไถ่ถอน / ครบกำหนดเข้าบัญชี = โอนกลับ
//   ปันผล / ดอกเบี้ย / Coupon ที่เข้าบัญชีธนาคารโดยตรง (ไม่อยู่ในมูลค่าพอร์ต) บวกกลับในกำไร / ขาดทุน (incomeToBank)

/** ยอดตั้งต้น (OPENING_BALANCE) ของพอร์ต · ต้นทุน = จำนวน × ราคาต่อหน่วย (สกุลหลักทรัพย์) / cost_base_currency (บาท) */
export type OpeningCost = { portfolio_asset_id: string; holding_id: string | null; transaction_date: string; quantity: number | null; price: number | null; currency: string; cost_base_currency: number | null };
export const OPENING_COST_COLS = "holding_id,transaction_date,quantity,price,currency,cost_base_currency";
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

/** มูลค่าตลาดของหลักทรัพย์ (investment_valuations) ที่ดึงมาเฉพาะถึงวันก่อน Go-live */
export type ValuationAt = { holding_id: string; valuation_date: string; market_value: number | null };
export const VALUATION_AT_COLS = "holding_id,valuation_date,market_value";
/** อัตรา (บาทต่อหน่วย) ช่วงก่อนวันก่อน Go-live → อัตราล่าสุดถึงวันนั้นของแต่ละสกุล */
export type RateAt = { currency: string; rate_date: string; rate_to_thb: number };
export function ratesAt(rows: RateAt[], date: string) {
  const m = new Map<string, RateAt>();
  for (const r of rows) if (r.rate_date <= date && !((m.get(r.currency)?.rate_date ?? "") > r.rate_date)) m.set(r.currency, r);
  return (ccy: string) => (ccy === "THB" ? 1 : m.has(ccy) ? Number(m.get(ccy)!.rate_to_thb) : null);
}

/** ยอดตั้งต้นรายตัว: ต้นทุน + มูลค่าตลาดล่าสุดถึงวันก่อน Go-live (สกุลหลักทรัพย์ · ไม่มีราคา เช่น เงินฝาก = ต้นทุน) */
export type OpeningValue = { currency: string; cost: number; value: number };
export function openingValues(assetId: string, opening: OpeningCost[], vals: ValuationAt[]): OpeningValue[] {
  const last = new Map<string, ValuationAt>();
  for (const v of vals) if (!((last.get(v.holding_id)?.valuation_date ?? "") > v.valuation_date)) last.set(v.holding_id, v);
  return opening.filter((o) => o.portfolio_asset_id === assetId).map((o) => {
    const cost = Number(o.quantity ?? 0) * Number(o.price ?? 0);
    const v = o.holding_id ? last.get(o.holding_id)?.market_value : null;
    return { currency: o.currency, cost, value: v == null ? cost : Number(v) };
  });
}

type Amt = { thb: number | null; ccy: number | null };

/** ผลตอบแทนก่อน Go-live (บาท) = มูลค่าตลาด ณ วันก่อน Go-live (อัตรา ณ วันนั้น) − เงินที่โอนไปจริง (ไม่ได้ใส่ = ต้นทุนรวมของยอดตั้งต้น) · null = ไม่มียอดตั้งต้น / ไม่มีอัตรา */
export function preGoLiveThb(n: NetInvested, rows: OpeningValue[], thb0: (ccy: string) => number | null) {
  const sent = n.lines.filter((l) => l.pre);
  const cost = n.cost ?? n.lines.find((l) => l.key === "opening") ?? null;
  if (!rows.length || !cost || rows.some((r) => thb0(r.currency) == null)) return null;
  return rows.reduce((t, r) => t + r.value * thb0(r.currency)!, 0) - (sent.length ? sent.reduce((t, l) => t + l.thb, 0) : cost.thb);
}

/** ผลตอบแทนแยกช่วง · บรรทัดย่อยเป็นสกุลพอร์ต (null = ไม่ทราบ / ไม่แสดง) */
export type ReturnSplit = {
  pre: (Amt & { got: number | null; price: number | null }) | null;
  since: Amt & { income: number | null; price: number | null };
  total: Amt & { pctThb: number | null; pctCcy: number | null };
  /** ต้นทุนรวมของยอดตั้งต้น เทียบเงินที่โอนไปจริงก่อน Go-live (เฉพาะเมื่อใส่ไว้) · ท้ายตารางผลตอบแทนใช้ */
  basis: { cost: Amt; sent: Amt } | null;
};

/**
 * ผลตอบแทนก่อน / ตั้งแต่ Go-live (ตกลง 13 พ.ย. 2026 · แทน "กำไร / ขาดทุนรวม" + "รายได้ลงทุนตั้งแต่ Go-live")
 * รวมผลตอบแทน = มูลค่า + เงินที่เข้าบัญชีธนาคารแล้ว − เงินลงทุนสุทธิ (vsInvested)
 * ก่อน Go-live = มูลค่าตลาด ณ วันก่อน Go-live − เงินที่โอนไปจริง (ไม่ได้ใส่ = ต้นทุนรวมของยอดตั้งต้น)
 *   รับแล้ว = ต้นทุนรวม − เงินที่โอนไปจริง (ปันผล ดอกเบี้ย คูปอง กำไรที่นำมาลงทุนต่อ) · ราคาเปลี่ยน = มูลค่า − ต้นทุนรวม (รวมค่าเงิน)
 * ตั้งแต่ Go-live = รวม − ก่อน Go-live · ราคาเปลี่ยน = ส่วนที่เหลือหลังหักปันผล ดอกเบี้ย คูปอง (รวมค่าเงิน)
 * rate0 = อัตราแปลงสกุลหลักทรัพย์ → สกุลพอร์ต ณ วันก่อน Go-live · thb0 = บาทต่อหน่วย ณ วันนั้น
 */
export function returnSplit(pfCcy: string, n: NetInvested, rows: OpeningValue[], value: Amt, received: Amt, incomeCcy: number | null,
  thb0: (ccy: string) => number | null, rate0: (ccy: string) => number | null): ReturnSplit | null {
  const tThb = vsInvested(value.thb, n.thb, received.thb);
  if (!tThb) return null;
  const tCcy = pfCcy === "THB" ? tThb : vsInvested(value.ccy, n.ccy, received.ccy);
  const sent = n.lines.filter((l) => l.pre);
  const cost = n.cost ?? n.lines.find((l) => l.key === "opening") ?? null;
  const sentCcy = sent.some((l) => l.ccy == null) ? null : sent.reduce((t, l) => t + (l.ccy ?? 0), 0);
  const basis = sent.length && cost ? { cost: { thb: cost.thb, ccy: cost.ccy }, sent: { thb: sent.reduce((t, l) => t + l.thb, 0), ccy: sentCcy } } : null;
  let pre: ReturnSplit["pre"] = null;
  const preThb = preGoLiveThb(n, rows, thb0);
  if (preThb != null && cost) {
    const basisCcy = sent.length ? sentCcy : cost.ccy;
    const v0 = rows.reduce<number | null>((t, r) => { const k = rate0(r.currency); return t == null || k == null ? null : t + r.value * k; }, 0);
    pre = {
      thb: preThb, ccy: v0 == null || basisCcy == null ? null : v0 - basisCcy,
      got: sent.length && cost.ccy != null && sentCcy != null ? cost.ccy - sentCcy : null,
      price: v0 == null || cost.ccy == null ? null : v0 - cost.ccy,
    };
  }
  const sinceCcy = tCcy == null ? null : pre ? (pre.ccy == null ? null : tCcy.pl - pre.ccy) : tCcy.pl;
  return {
    pre,
    since: { thb: tThb.pl - (pre?.thb ?? 0), ccy: sinceCcy, income: incomeCcy,
      price: sinceCcy == null || incomeCcy == null ? null : sinceCcy - incomeCcy },
    total: { thb: tThb.pl, ccy: tCcy?.pl ?? null, pctThb: tThb.pct, pctCcy: tCcy?.pct ?? null },
    basis,
  };
}
