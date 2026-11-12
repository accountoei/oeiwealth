import type { FieldSpec } from "@/components/RowActions";
import { money, thDate } from "@/lib/format";

/**
 * ฟอร์มแก้รายการที่มาจากหน้าอื่น — ใช้ชุดเดียวกันทั้งหน้าต้นทางและหน้า Income & Expenses
 *   แก้ที่ไหนก็บันทึกที่แถวเดียวกัน (expense_items) ผ่าน updateRecord เดิม · กติกา (งวดปิด / สิทธิ์) อยู่ในฐานข้อมูล
 *   แก้ฟอร์มที่นี่ที่เดียว → เปลี่ยนทุกหน้า
 */
type Row = { date: string; amount: number | string; notes?: string | null };

/** จ่ายเบี้ยประกัน (หน้ากรมธรรม์ → ประวัติจ่ายเบี้ย) */
export const premiumPaymentFields = (e: Row): FieldSpec[] => [
  { name: "date", label: "วันที่จ่าย", type: "date", value: e.date },
  { name: "amount", label: "ยอด", type: "number", value: e.amount },
  { name: "notes", label: "หมายเหตุ", value: e.notes ?? null, width: "w-40" },
];

/** จ่ายค่าใช้จ่ายประจำของทรัพย์สิน (หน้าทรัพย์สิน → ประวัติจ่าย) */
export const propertyCostFields = (e: Row): FieldSpec[] => [
  { name: "date", label: "วันที่จ่าย", type: "date", value: e.date },
  { name: "amount", label: "ยอด", type: "number", value: e.amount },
  { name: "notes", label: "หมายเหตุ", value: e.notes ?? null, width: "w-40" },
];

/** ดอกเบี้ยจ่ายของหนี้ (หน้าหนี้สิน → ประวัติการจ่าย) */
export const debtInterestFields = (e: Row): FieldSpec[] => [
  { name: "date", label: "วันที่", type: "date", value: e.date },
  { name: "amount", label: "จำนวน", type: "number", value: e.amount },
];

// ---------------------------------------------------------------- รายได้
type IncRow = { date: string; amount: number | string; tax?: number | string | null; notes?: string | null };

/** รับค่าเช่า (หน้าทรัพย์สิน → ประวัติรับค่าเช่า) */
export const rentIncomeFields = (r: IncRow): FieldSpec[] => [
  { name: "date", label: "วันที่รับ", type: "date", value: r.date },
  { name: "amount", label: "ยอด", type: "number", value: r.amount },
  { name: "tax", label: "ภาษี", type: "number", value: r.tax ?? null },
  { name: "notes", label: "หมายเหตุ", value: r.notes ?? null, width: "w-40" },
];

/** ดอกเบี้ยรับจากเงินให้กู้ (หน้าเงินให้กู้ → ประวัติรับชำระ) */
export const loanInterestFields = (r: IncRow): FieldSpec[] => [
  { name: "date", label: "วันที่", type: "date", value: r.date },
  { name: "amount", label: "ดอกเบี้ย", type: "number", value: r.amount },
  { name: "tax", label: "ภาษี", type: "number", value: r.tax ?? null },
];

/** ปันผลจากกิจการ (หน้ากิจการ → ประวัติ) */
export const businessDividendFields = (r: IncRow): FieldSpec[] => [
  { name: "date", label: "วันที่", type: "date", value: r.date },
  { name: "amount", label: "ยอด", type: "number", value: r.amount },
  { name: "tax", label: "ภาษี", type: "number", value: r.tax ?? null },
];

/** รายได้ลดหนี้ (ยอดหนี้ลดเกินที่คำนวณ · แยกจากก้อน) — หน้าหนี้สิน → ประวัติการจ่าย */
export const debtDropIncomeFields = (r: IncRow): FieldSpec[] => [
  { name: "date", label: "วันที่", type: "date", value: r.date },
  { name: "amount", label: "ยอด", type: "number", value: r.amount },
  { name: "notes", label: "รายละเอียด", value: r.notes ?? null, width: "w-48" },
];

/** รายได้อื่นผูกทรัพย์สิน (Alternative "บันทึกรับผลตอบแทน") · ดอกเบี้ยเงินฝาก (Cash "บันทึกรับดอกเบี้ย") */
export const assetIncomeFields = (r: IncRow): FieldSpec[] => [
  { name: "date", label: "วันที่รับ", type: "date", value: r.date },
  { name: "amount", label: "ยอดก่อนภาษี", type: "number", value: r.amount },
  { name: "tax", label: "ภาษีหัก ณ ที่จ่าย", type: "number", value: r.tax ?? null },
  { name: "notes", label: "หมายเหตุ", value: r.notes ?? null, width: "w-48" },
];

// ---------------------------------------------------------------- รายการในพอร์ต
type ItxRow = { transaction_type: string; transaction_date: string; settlement_date?: string | null; quantity?: number | string | null;
  price?: number | string | null; amount: number | string; fee?: number | string | null; tax?: number | string | null; notes?: string | null;
  currency?: string; cost_base_currency?: number | string | null };

/**
 * รายการในพอร์ต — ชุดเดียวทุกหน้า (หน้าพอร์ต · หน้าหลักทรัพย์ · บัญชีเงินฝากในพอร์ต · แท็บบันทึกรับ · Income & Expenses · ตกลง 10 พ.ย. 2026)
 *   bank = ตัด / เข้าบัญชีธนาคารตรง (มีวันชำระ) · ซื้อ / ขาย / ตั้งต้นที่มีจำนวน × ราคา → มูลค่าคำนวณให้ (แก้ไม่ได้)
 */
export const portfolioTxFields = (t: ItxRow, bank: boolean): FieldSpec[] => {
  const type = t.transaction_type;
  const trade = ["BUY", "SELL", "OPENING_BALANCE"].includes(type) && t.quantity != null && t.price != null;
  const income = ["DIVIDEND", "INTEREST", "COUPON"].includes(type);
  // ยอดตั้งต้นสกุลต่างประเทศ: ต้นทุนรวมเป็นบาท แก้ได้ · แก้ราคา / จำนวน → บาทเปลี่ยนตามอัตราเดิมของรายการ (ตกลง 12 พ.ย. 2026)
  //   ยอดตั้งต้นเงินบาท: ต้นทุนบาท = มูลค่า (คำนวณใหม่ตอนบันทึก ใน updateRecord)
  const fxOpen = type === "OPENING_BALANCE" && !!t.currency && t.currency !== "THB";
  const rate = fxOpen && Number(t.amount) > 0 && t.cost_base_currency != null ? Number(t.cost_base_currency) / Number(t.amount) : null;
  const thbCost: FieldSpec[] = !fxOpen ? [] : [
    ...(rate != null ? [{ name: "cost_rate", label: `อัตราต้นทุน (บาท / ${t.currency})`, value: money(rate, undefined, 6), readOnly: true }] : []),
    { name: "cost_base_currency", label: "ต้นทุนรวมเป็นบาท", type: "number" as const,
      value: t.cost_base_currency == null ? null : money(t.cost_base_currency),
      ...(rate != null ? { calc: { op: "mul" as const, a: trade ? "value" : "amount", b: "cost_rate" } } : {}) },
  ];
  return [
    type === "OPENING_BALANCE"
      ? { name: "opening_date", label: "วันที่ (วันตั้งต้น)", value: thDate(t.transaction_date), readOnly: true }
      : { name: "transaction_date", label: "วันที่", type: "date", value: t.transaction_date },
    ...(bank ? [{ name: "settlement_date", label: "วันชำระ", type: "date" as const, value: t.settlement_date ?? null }] : []),
    ...(t.quantity != null ? [{ name: "quantity", label: "จำนวน", type: "number" as const, value: t.quantity }] : []),
    ...(t.price != null ? [{ name: "price", label: "ราคา", type: "number" as const, value: t.price }] : []),
    ...(trade ? [{ name: "value", label: "มูลค่า (= จำนวน × ราคา)", type: "number" as const, value: money(t.amount), readOnly: true,
      calc: { op: "mul" as const, a: "quantity", b: "price" } }]
      : [{ name: "amount", label: income ? "ยอดก่อนภาษี" : type === "MATURITY" ? "เงินต้นที่ได้คืน" : "ยอด", type: "number" as const, value: t.amount }]),
    ...thbCost,
    ...(["FEE", "TAX", "OPENING_BALANCE", "ADJUSTMENT", "PAYMENT"].includes(type) ? [] : [{ name: "fee", label: "ค่าธรรมเนียม", type: "number" as const, value: t.fee ?? null }]),
    ...(["SELL", "REDEMPTION", "MATURITY", "DIVIDEND", "INTEREST", "COUPON"].includes(type) ? [{ name: "tax", label: income ? "ภาษีหัก ณ ที่จ่าย" : "ภาษี", type: "number" as const, value: t.tax ?? null }] : []),
    { name: "notes", label: "หมายเหตุ", value: t.notes ?? null, wide: true },
  ];
};

/** มีช่องจำนวน + ราคา → 4 ช่องต่อแถว (วันที่ · จำนวน · ราคา · มูลค่า) */
export const portfolioTxCols = (t: ItxRow): 3 | 4 => (t.quantity != null && t.price != null ? 4 : 3);
