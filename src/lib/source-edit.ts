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
