import type { FieldSpec } from "@/components/RowActions";

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
