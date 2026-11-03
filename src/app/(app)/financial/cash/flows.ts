// เงินเข้า–ออกบัญชีเงินฝากของเดือน แยกตามประเภทรายการ (การ์ดหน้าบัญชีเงินฝาก · ตกลง 3 พ.ย. 2026)
//   ยอดฝั่งบัญชีตรงกับ private.bank_movement_effects: เข้า = counter_amount (ถ้าต่างสกุล) หรือ amount · ออก = amount + fee
//   โอนระหว่างบัญชีธนาคารของครอบครัวไม่นับ (นับเฉพาะค่าธรรมเนียมโอน)
//   รายรับ − รายจ่าย + รายการอื่นๆ (สุทธิ) = เงินเข้า − เงินออก ของ bank_month_summary

export type Move = { movement_type: string; from_asset_id: string | null; to_asset_id: string | null;
  amount: number; fee: number | null; counter_amount: number | null; counter_currency: string | null };

/** บรรทัดในการ์ด · in = เงินเข้า (+) / out = เงินออก (−) */
export type FlowKey =
  | "INCOME" | "REIMB"
  | "EXPENSE" | "CARD" | "DEBT" | "FEE"
  | "INV_OUT" | "INV_IN" | "LOAN_OUT" | "LOAN_IN" | "ASSET_OUT" | "ASSET_IN" | "DEP_IN" | "DEP_OUT" | "FX_OUT" | "FX_IN" | "OTHER_IN" | "OTHER_OUT";

export const FLOW_LABEL: Record<FlowKey, string> = {
  INCOME: "รายรับ", REIMB: "เงินเบิกคืน",
  EXPENSE: "ค่าใช้จ่าย (จ่ายจากบัญชี)", CARD: "จ่ายบัตรเครดิต", DEBT: "จ่ายหนี้ / ผ่อนสินเชื่อ", FEE: "ค่าธรรมเนียมโอน",
  INV_OUT: "โอนไปพอร์ตลงทุน", INV_IN: "โอนกลับจากพอร์ต", LOAN_OUT: "ปล่อยกู้", LOAN_IN: "รับคืนเงินต้นเงินกู้",
  ASSET_OUT: "ซื้อทรัพย์สิน", ASSET_IN: "ขายทรัพย์สิน", DEP_IN: "รับเงินประกันการเช่า", DEP_OUT: "คืนเงินประกันการเช่า",
  FX_OUT: "แลกเงิน (ออก)", FX_IN: "แลกเงิน (เข้า)", OTHER_IN: "อื่นๆ (เข้า)", OTHER_OUT: "อื่นๆ (ออก)",
};
/** ลำดับบรรทัดในการ์ด "รายการอื่นๆ" */
export const OTHER_KEYS: FlowKey[] = ["INV_OUT", "INV_IN", "LOAN_OUT", "LOAN_IN", "ASSET_OUT", "ASSET_IN", "DEP_IN", "DEP_OUT", "FX_OUT", "FX_IN", "OTHER_IN", "OTHER_OUT"];
export const SPEND_KEYS: FlowKey[] = ["EXPENSE", "CARD", "DEBT", "FEE"];
export const INCOME_KEYS: FlowKey[] = ["INCOME", "REIMB"];

const IN_KEY: Record<string, FlowKey> = {
  INCOME: "INCOME", REIMBURSEMENT_IN: "REIMB", INVESTMENT_IN: "INV_IN", LOAN_PRINCIPAL_RECEIPT: "LOAN_IN",
  ASSET_SALE: "ASSET_IN", SECURITY_DEPOSIT_IN: "DEP_IN", FX_EXCHANGE: "FX_IN",
};
const OUT_KEY: Record<string, FlowKey> = {
  EXPENSE: "EXPENSE", CARD_PAYMENT: "CARD", LIABILITY_PAYMENT: "DEBT", INVESTMENT_OUT: "INV_OUT", LOAN_DISBURSEMENT: "LOAN_OUT",
  ASSET_PURCHASE: "ASSET_OUT", SECURITY_DEPOSIT_OUT: "DEP_OUT", FX_EXCHANGE: "FX_OUT",
};
const IS_IN = (k: FlowKey) => ["INCOME", "REIMB", "INV_IN", "LOAN_IN", "ASSET_IN", "DEP_IN", "FX_IN", "OTHER_IN"].includes(k);

export type Flows = { amt: Map<FlowKey, number>; n: Map<FlowKey, number> };

/**
 * รวมยอดตามประเภท · banks = บัญชีเงินฝากทั้งหมด (ใช้ดูว่าเป็นโอนระหว่างบัญชีของครอบครัวหรือไม่)
 * shown = บัญชีที่แสดงอยู่ → ฟังก์ชันแปลงยอดสกุลบัญชีเป็นบาท × สัดส่วนของคนที่เลือก
 */
export function monthFlows(moves: Move[], banks: Set<string>, shown: Map<string, (v: number) => number>): Flows {
  const amt = new Map<FlowKey, number>(), n = new Map<FlowKey, number>();
  const add = (k: FlowKey, v: number) => {
    amt.set(k, (amt.get(k) ?? 0) + (IS_IN(k) ? v : -v));
    n.set(k, (n.get(k) ?? 0) + 1);
  };
  for (const m of moves) {
    const internal = m.movement_type === "TRANSFER" && !!m.from_asset_id && !!m.to_asset_id && banks.has(m.from_asset_id) && banks.has(m.to_asset_id);
    const toBank = m.to_asset_id ? shown.get(m.to_asset_id) : undefined;
    const fromBank = m.from_asset_id ? shown.get(m.from_asset_id) : undefined;
    if (toBank && !internal) {
      add(IN_KEY[m.movement_type] ?? "OTHER_IN", toBank(m.counter_currency ? Number(m.counter_amount ?? 0) : Number(m.amount)));
    }
    if (fromBank) {
      if (internal) { if (Number(m.fee ?? 0) > 0) add("FEE", fromBank(Number(m.fee))); }
      else add(OUT_KEY[m.movement_type] ?? "OTHER_OUT", fromBank(Number(m.amount) + Number(m.fee ?? 0)));
    }
  }
  return { amt, n };
}

/** รวมยอด (มีเครื่องหมาย: เข้า +, ออก −) และจำนวนรายการของกลุ่มบรรทัด */
export const flowSum = (f: Flows, keys: FlowKey[]) => keys.reduce((t, k) => t + (f.amt.get(k) ?? 0), 0);
export const flowCount = (f: Flows, keys: FlowKey[]) => keys.reduce((t, k) => t + (f.n.get(k) ?? 0), 0);
