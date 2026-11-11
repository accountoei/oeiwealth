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

/** ช่องตัวเลขในตาราง (ฝั่งหน้าจอ) → number · ว่าง = 0 · ไม่ใช่ตัวเลข = NaN (ใช้แยก "พิมพ์ผิด" ออกจาก "ว่าง") */
export const inputNumber = (s: string | null | undefined) => Number(plainNumber(s));

/** ตัวเลข → ข้อความใส่ช่องกรอก: จุลภาค + ทศนิยม 2 ตำแหน่ง (แบบที่ช่อง inputMode="decimal" แสดง) */
export const inputAmount = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ภาษีหัก ณ ที่จ่าย pct% ของยอดที่กรอก (ปัดทศนิยม 2 ตำแหน่ง) → ข้อความใส่ช่องภาษี */
export const withholding = (amount: string | null | undefined, pct: number) =>
  inputAmount(Math.round(inputNumber(amount) * (pct / 100) * 100) / 100);

/**
 * ปุ่ม "หัก ณ ที่จ่าย x%" ของแถบบน: ภาษีของทุกแถวใน keys ที่กรอกยอดเป็นตัวเลข → { key: ภาษี } (เอาไปรวมกับช่องภาษีเดิม)
 *   แถวที่ยอดว่าง / พิมพ์ผิด ไม่แตะ
 */
export function withholdingFor(keys: string[], amounts: Record<string, string>, pct: number): Record<string, string> {
  return Object.fromEntries(keys.filter((k) => plainNumber(amounts[k]) !== "" && !Number.isNaN(inputNumber(amounts[k])))
    .map((k) => [k, withholding(amounts[k], pct)]));
}

/** ยอดต้องเป็นตัวเลขมากกว่า 0 */
export const isPositive = (v: number | null): v is number => v != null && !Number.isNaN(v) && v > 0;

/** ภาษีว่างได้ · ถ้ากรอกต้องเป็นตัวเลขไม่ติดลบ */
export const isValidTax = (v: number | null) => v == null || (!Number.isNaN(v) && v >= 0);

export const TAX_ERROR = "ภาษีต้องเป็นตัวเลข (ไม่ติดลบ)";
export const BAD_ROWS_ERROR = "ข้อมูลไม่ถูกต้อง";

/** ข้อความเมื่อ RPC ปฏิเสธทั้งชุด · scope เช่น "ทุกบัญชี" / "ทุกรายการ" / "ทุกกิจการ" */
export const notSaved = (scope: string, reason: string) => `ยังไม่ได้บันทึก (${scope}) · ${reason}`;
