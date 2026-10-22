/**
 * บันทึกเป็นกลุ่ม (หลายแถว · ผิดแถวเดียว = ไม่บันทึกเลย) — ส่วนที่ทุก batch action ใช้ร่วมกัน
 *   ฟอร์มส่งแถวมาเป็น JSON ในช่อง "rows" · ตัวเลขยังเป็นข้อความที่มีจุลภาค · RPC ฝั่ง DB บันทึกทั้งชุดในคำสั่งเดียว
 * ไฟล์นี้ต้องไม่ import อะไร — เทสต์ด้วย node ตรง ๆ (scripts/batch-entry.test.mjs)
 */

/** แถวจากช่อง "rows" (JSON) · null = ข้อมูลเสีย */
export function readRows<R>(form: FormData): R[] | null {
  try {
    const rows: unknown = JSON.parse(String(form.get("rows") ?? "[]"));
    return Array.isArray(rows) ? (rows as R[]) : null;
  } catch {
    return null;
  }
}

/** ข้อความตัวเลขในแถว → ตัดจุลภาค / ช่องว่าง · ว่าง = "" */
export const plainNumber = (s: string | null | undefined) => String(s ?? "").replace(/,/g, "").trim();

/** ข้อความตัวเลขในแถว → number · ว่าง = null · ไม่ใช่ตัวเลข = NaN */
export function amountOrNull(s: string | null | undefined): number | null {
  const t = plainNumber(s);
  return t === "" ? null : Number(t);
}

/** ยอดต้องเป็นตัวเลขมากกว่า 0 */
export const isPositive = (v: number | null): v is number => v != null && !Number.isNaN(v) && v > 0;

/** ภาษีว่างได้ · ถ้ากรอกต้องเป็นตัวเลขไม่ติดลบ */
export const isValidTax = (v: number | null) => v == null || (!Number.isNaN(v) && v >= 0);

export const TAX_ERROR = "ภาษีต้องเป็นตัวเลข (ไม่ติดลบ)";
export const BAD_ROWS_ERROR = "ข้อมูลไม่ถูกต้อง";

/** ข้อความเมื่อ RPC ปฏิเสธทั้งชุด · scope เช่น "ทุกบัญชี" / "ทุกรายการ" / "ทุกกิจการ" */
export const notSaved = (scope: string, reason: string) => `ยังไม่ได้บันทึก (${scope}) · ${reason}`;
