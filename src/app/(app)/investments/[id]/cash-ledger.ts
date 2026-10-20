/**
 * ยอดเคลื่อนไหวของ "บัญชีเงินฝากในพอร์ต" (CASH holding) — คิดแบบเดียวกับฐานข้อมูล
 *   private.holding_value_at (รายการลงทุน) + private.portfolio_in_transit (เงินโอนธนาคาร ↔ พอร์ต)
 *   ยอดตาม Statement (investment_valuations) = จุดตั้งต้นใหม่ · ไม่มี = ยอดตั้งต้น (OPENING_BALANCE)
 *   เงินโอนธนาคาร ↔ พอร์ต หลัง Statement ล่าสุดของบัญชี = "เงินระหว่างทาง" (Net Worth นับแยก จนกว่าจะมี Statement หลังวันโอน)
 */

export type LTx = {
  id: string; holding_id: string | null; transaction_date: string; transaction_type: string; amount: number; currency: string;
  fee: number | null; tax: number | null; quantity: number | null; price: number | null; settlement_date: string | null;
  settle_from_asset_id: string | null; settle_to_asset_id: string | null; cash_movement_id: string | null;
  counter_amount: number | null; counter_currency: string | null; cash_holding_id: string | null; counter_cash_holding_id: string | null;
  net_cash: number; notes: string | null; created_at: string;
};
export type LMove = {
  id: string; movement_date: string; movement_type: string; from_asset_id: string | null; to_asset_id: string | null;
  amount: number; currency: string; fee: number | null; counter_amount: number | null; counter_currency: string | null;
  counter_fee: number | null; cash_holding_id: string | null; description: string | null; created_at?: string;
};
export type LHolding = { id: string; holding_type: string; currency: string; is_default_cash: boolean };
export type LVal = { id: string; valuation_date: string; market_value: number; created_at: string };

/** รายการที่มีผลกับบัญชี: amt = + เงินเข้า / − เงินออก (สกุลของบัญชี) · null = ยังไม่ทราบยอด (รอยอดที่เข้า) */
export type LEvent = {
  key: string; date: string; created: string; amt: number | null;
  tx?: LTx; leg?: "in" | "out";          // รายการลงทุน (แลกเงิน / โอนในพอร์ต มี 2 ฝั่ง)
  mv?: LMove; waitBank?: boolean;         // เงินโอนธนาคาร ↔ พอร์ต · waitBank = ยังไม่ใส่ยอดที่เข้าธนาคาร
};

export function cashLedger(holdings: LHolding[], txs: LTx[], moves: LMove[]) {
  const def = (ccy: string | null) => holdings.find((h) => h.holding_type === "CASH" && h.is_default_cash && h.currency === ccy)?.id ?? null;
  const txOfMove = new Map(txs.filter((t) => t.cash_movement_id && ["DEPOSIT", "WITHDRAWAL"].includes(t.transaction_type))
    .map((t) => [t.cash_movement_id as string, t]));
  /** บัญชีที่รับ / จ่ายเงินโอน (ไม่ระบุ = บัญชีหลักของสกุลฝั่งพอร์ต) */
  const moveHolding = (m: LMove) => m.cash_holding_id ?? txOfMove.get(m.id)?.cash_holding_id
    ?? def(m.movement_type === "INVESTMENT_OUT" ? m.counter_currency ?? m.currency : m.currency);

  /** รายการทั้งหมดของบัญชี hid (เรียงตามวันที่ → เวลาที่บันทึก) */
  function events(hid: string, ccy: string): LEvent[] {
    const out: LEvent[] = [];
    for (const t of txs) {
      if (t.transaction_type === "OPENING_BALANCE") continue;
      if (t.settle_from_asset_id || t.settle_to_asset_id) continue;                         // จ่าย / รับผ่านธนาคารโดยตรง
      if (t.cash_movement_id && ["DEPOSIT", "WITHDRAWAL"].includes(t.transaction_type)) continue;  // มาจากเงินโอน (นับที่ moves)
      if (t.currency !== ccy && t.counter_currency !== ccy) continue;
      const base = { date: t.transaction_date, created: t.created_at, tx: t };
      if (t.transaction_type === "FX_EXCHANGE" || t.transaction_type === "CASH_TRANSFER") {
        if ((t.cash_holding_id ?? def(t.currency)) === hid)
          out.push({ ...base, key: `${t.id}:o`, leg: "out", amt: -(Number(t.amount) + Number(t.fee ?? 0)) });
        if ((t.counter_cash_holding_id ?? def(t.counter_currency)) === hid)
          out.push({ ...base, key: `${t.id}:i`, leg: "in", amt: Number(t.counter_amount ?? 0) });
        continue;
      }
      if ((t.cash_holding_id ?? def(t.currency)) !== hid) continue;
      const v = Number(t.net_cash ?? 0);
      if (Math.abs(v) < 0.005) continue;
      out.push({ ...base, key: t.id, leg: v > 0 ? "in" : "out", amt: v });
    }
    for (const m of moves) {
      if (moveHolding(m) !== hid) continue;
      const base = { key: `m${m.id}`, date: m.movement_date, created: m.created_at ?? "", mv: m };
      if (m.movement_type === "INVESTMENT_OUT") {
        out.push({ ...base, amt: m.counter_currency ? (m.counter_amount == null ? null : Number(m.counter_amount)) : Number(m.amount) });
      } else {
        out.push({ ...base, amt: -(Number(m.amount) + (m.counter_currency ? Number(m.fee ?? 0) : 0)),
          waitBank: !!m.counter_currency && m.counter_amount == null });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.created.localeCompare(b.created));
  }

  /** จุดตั้งต้น ณ วันที่ d: Statement ล่าสุด ≤ d · ไม่มี = ยอดตั้งต้น · ไม่มีทั้งคู่ = 0 */
  function baseAt(hid: string, vals: LVal[], d: string, fallbackDate: string) {
    const v = vals.filter((x) => x.valuation_date <= d)
      .sort((a, b) => b.valuation_date.localeCompare(a.valuation_date) || b.created_at.localeCompare(a.created_at))[0];
    if (v) return { value: Number(v.market_value), date: v.valuation_date, statement: true };
    const o = txs.filter((t) => t.transaction_type === "OPENING_BALANCE" && t.holding_id === hid && t.transaction_date <= d)
      .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))[0];
    if (o) return { value: Number(o.amount), date: o.transaction_date, statement: false };
    return { value: 0, date: fallbackDate, statement: false };
  }

  /** ยอดคงเหลือ ณ สิ้นวัน d (รวมเงินโอนที่ยังรอ Statement) + เงินระหว่างทาง */
  function balanceAt(hid: string, ccy: string, vals: LVal[], d: string, fallbackDate: string) {
    const b = baseAt(hid, vals, d, fallbackDate);
    const after = events(hid, ccy).filter((e) => e.date > b.date && e.date <= d);
    const sum = after.reduce((t, e) => t + (e.amt ?? 0), 0);
    const transit = after.filter((e) => e.mv).reduce((t, e) => t + (e.amt ?? 0), 0);
    // Net Worth: เงินถอนออกที่ยังไม่ใส่ยอดฝั่งธนาคาร ยังนับไว้ที่พอร์ต (ยอดที่ออก) จนกว่าจะใส่ยอด
    const held = events(hid, ccy).filter((e) => e.waitBank && e.date <= d).reduce((t, e) => t + Number(e.mv!.amount), 0);
    return { balance: Math.round((b.value + sum) * 100) / 100, transit: Math.round(transit * 100) / 100,
      nwTransit: Math.round((transit + held) * 100) / 100, base: b };
  }

  return { events, baseAt, balanceAt, moveHolding };
}
