import { INCOME_TYPE_LABEL } from "@/lib/format";

/**
 * ป้ายประเภท + หมวด ของรายการเงินเข้า–ออก (หน้าบัญชี · แท็บเงินเข้า–ออก) — ชุดเดียวกันทุกหน้า
 *   เขียว = รายได้ · ฟ้า = โอนเข้า · ส้ม = โอนออก (เงินแค่ย้ายบัญชี) · แดง = ค่าใช้จ่าย · หมวด "รอแยกรายละเอียด" = ป้ายเหลือง
 *   ม่วง = ชำระหนี้ / แลกเงิน · คราม = ลงทุน / เงินให้กู้ / ทรัพย์สิน · เทา = อื่น ๆ
 */
export type Tone = "green" | "sky" | "orange" | "red" | "amber" | "violet" | "indigo" | "slate";
export type MoveMeta = { label: string; tone: Tone; category: string; pending?: boolean };

export function moveMeta(type: string, dir: "in" | "out" | "move", o: {
  incomeType?: string | null; incomeSubtype?: string | null; expenseCategory?: string | null; pending?: boolean; merged?: boolean;
  /** ป้ายตามเมนูต้นทาง (ซื้อ / ขาย Property · Alternative · กิจการ · เงินประกัน · หลักทรัพย์ · เงินกู้ภายใน) — ดู sourceMeta */
  source?: MoveMeta | null;
} = {}): MoveMeta {
  if (o.source) return o.source;
  if (o.merged) return { label: "รับชำระเงินกู้", tone: "indigo", category: "เงินให้กู้" };
  switch (type) {
    case "INCOME":
      if (o.pending) return { label: "รายได้", tone: "green", category: "รอแยกรายละเอียด", pending: true };
      return { label: o.incomeType === "INTEREST" ? "ดอกเบี้ยรับ" : "รายได้", tone: "green",
        category: o.incomeSubtype || (o.incomeType ? INCOME_TYPE_LABEL[o.incomeType] ?? o.incomeType : "รายได้") };
    case "EXPENSE":
      if (o.pending) return { label: "ค่าใช้จ่าย", tone: "red", category: "รอแยกรายละเอียด", pending: true };
      return { label: "ค่าใช้จ่าย", tone: "red", category: o.expenseCategory === "BANK_FEE" ? "ค่าธรรมเนียมธนาคาร" : o.expenseCategory || "ค่าใช้จ่าย" };
    case "TRANSFER":
      return dir === "in" ? { label: "โอนเข้า", tone: "sky", category: "โอนระหว่างบัญชี" }
        : dir === "out" ? { label: "โอนออก", tone: "orange", category: "โอนระหว่างบัญชี" }
        : { label: "โอนระหว่างบัญชี", tone: "slate", category: "โอนระหว่างบัญชี" };
    case "FX_EXCHANGE": return { label: "แลกเงิน", tone: "violet", category: "โอนระหว่างบัญชี" };
    case "CARD_PAYMENT": return { label: "จ่ายบัตร", tone: "violet", category: "ชำระหนี้" };
    case "LIABILITY_PAYMENT": return { label: "จ่ายหนี้", tone: "violet", category: "ชำระหนี้" };
    case "INVESTMENT_OUT": return { label: "เข้าพอร์ต", tone: "indigo", category: "ลงทุน" };
    case "INVESTMENT_IN": return { label: "รับจากพอร์ต", tone: "indigo", category: "ลงทุน" };
    case "LOAN_DISBURSEMENT": return { label: "ให้กู้", tone: "indigo", category: "เงินให้กู้" };
    case "LOAN_PRINCIPAL_RECEIPT": return { label: "รับคืนเงินต้น", tone: "indigo", category: "เงินให้กู้" };
    case "ASSET_PURCHASE": return { label: "ซื้อทรัพย์สิน", tone: "indigo", category: "ทรัพย์สิน" };
    case "ASSET_SALE": return { label: "ขายทรัพย์สิน", tone: "indigo", category: "ทรัพย์สิน" };
    case "REIMBURSEMENT_IN": return { label: "เงินคืน", tone: "sky", category: "เงินคืนค่าใช้จ่าย" };
    // "เงินประกันการเช่า" เต็มคำ — ไม่ให้สับสนกับเงินประกันชีวิต / มูลค่าเวนคืน (ตกลง 9 พ.ย. 2026)
    case "SECURITY_DEPOSIT_IN": return { label: "รับเงินประกันการเช่า", tone: "slate", category: "เงินประกันการเช่า" };
    case "SECURITY_DEPOSIT_OUT": return { label: "คืนเงินประกันการเช่า", tone: "slate", category: "เงินประกันการเช่า" };
    case "OTHER_IN": return { label: "เงินเข้าอื่น", tone: "green", category: "อื่น ๆ" };
    case "OTHER_OUT": return { label: "เงินออกอื่น", tone: "red", category: "อื่น ๆ" };
    // เงินฝากในพอร์ต (รายการลงทุนที่มีผลกับเงินสดของบัญชี)
    case "ITX_BUY": return { label: "ซื้อ", tone: "indigo", category: "ลงทุน" };
    case "ITX_SELL": return { label: "ขาย", tone: "indigo", category: "ลงทุน" };
    case "ITX_REDEMPTION": return { label: "ไถ่ถอน", tone: "indigo", category: "ลงทุน" };
    case "ITX_MATURITY": return { label: "ครบกำหนด", tone: "indigo", category: "ลงทุน" };
    case "ITX_DIVIDEND": return { label: "ปันผล", tone: "green", category: "รายได้ลงทุน" };
    case "ITX_INTEREST": return { label: "ดอกเบี้ยรับ", tone: "green", category: "รายได้ลงทุน" };
    case "ITX_COUPON": return { label: "Coupon", tone: "green", category: "รายได้ลงทุน" };
    case "ITX_FEE": return { label: "ค่าธรรมเนียม", tone: "red", category: "ค่าธรรมเนียม / ภาษี" };
    case "ITX_TAX": return { label: "ภาษี", tone: "red", category: "ค่าธรรมเนียม / ภาษี" };
    case "ITX_FX_EXCHANGE": return { label: "แลกเงิน", tone: "violet", category: "โอนระหว่างบัญชี" };
    case "ITX_CASH_TRANSFER":
      return dir === "in" ? { label: "โอนเข้า", tone: "sky", category: "โอนในพอร์ต" } : { label: "โอนออก", tone: "orange", category: "โอนในพอร์ต" };
    case "ITX_DEPOSIT": return { label: "ฝากเพิ่ม", tone: "sky", category: "เงินเข้าออกพอร์ต" };
    case "ITX_WITHDRAWAL": return { label: "ถอนออก", tone: "orange", category: "เงินเข้าออกพอร์ต" };
    case "ITX_ADJUSTMENT": return { label: "ปรับปรุง", tone: "slate", category: "อื่น ๆ" };
    case "ITX_PAYMENT": return { label: "จ่ายออก", tone: "red", category: "อื่น ๆ" };
    default: return { label: type, tone: "slate", category: "-" };
  }
}

/**
 * ป้ายตามเมนูต้นทาง (ตกลง 9 พ.ย. 2026) · null = ใช้ป้ายตามประเภทรายการ (moveMeta)
 *   ซื้อ / ขายทรัพย์สิน → ตามกลุ่มทรัพย์สิน (Property · Alternative · กิจการ) · ถอนมูลค่าเวนคืน = เงินประกัน (ไม่ใช่รายได้)
 *   รายการในพอร์ตที่ตัด / เข้าบัญชีตรง = ซื้อ / ขายหลักทรัพย์ (ต่างจากการโอนเงินเข้า / ออกพอร์ต)
 *   ฝั่งผู้กู้ของเงินกู้ภายในครอบครัว = รับ / ชำระเงินกู้ภายใน (ไม่ใช่เงินเข้า / ออกอื่น)
 */
export function sourceMeta(m: { movement_type: string; is_derived: boolean; source_entity_type?: string | null },
  asset: { asset_type: string; asset_group?: string | null } | null | undefined): MoveMeta | null {
  const t = asset?.asset_type, g = asset?.asset_group;
  const grp = t === "PRIVATE_BUSINESS" ? "BUSINESS" : t === "INSURANCE_CASH_VALUE" ? "INSURANCE" : g === "PROPERTY" ? "PROPERTY" : g === "ALTERNATIVE" ? "ALTERNATIVE" : null;
  if (m.movement_type === "ASSET_PURCHASE" && !m.is_derived) {
    if (grp === "PROPERTY") return { label: "ซื้อ Property", tone: "indigo", category: "Property" };
    if (grp === "ALTERNATIVE") return { label: "ซื้อ Alternative", tone: "indigo", category: "Alternative" };
    if (grp === "BUSINESS") return { label: "ลงทุนเพิ่มในกิจการ", tone: "indigo", category: "Private Business" };
  }
  if (m.movement_type === "ASSET_SALE" && !m.is_derived) {
    if (grp === "INSURANCE") return { label: "เงินประกัน", tone: "sky", category: "ประกัน (ถอนมูลค่าเวนคืน)" };
    if (grp === "PROPERTY") return { label: "ขาย Property", tone: "indigo", category: "Property" };
    if (grp === "ALTERNATIVE") return { label: "ขาย Alternative", tone: "indigo", category: "Alternative" };
    if (grp === "BUSINESS") return { label: "ขายหุ้นกิจการ", tone: "indigo", category: "Private Business" };
  }
  if (m.is_derived && m.source_entity_type === "INVESTMENT_TX") {
    if (m.movement_type === "INVESTMENT_OUT") return { label: "ซื้อหลักทรัพย์", tone: "indigo", category: "ลงทุน" };
    if (m.movement_type === "INVESTMENT_IN") return { label: "ขาย / ไถ่ถอนหลักทรัพย์", tone: "indigo", category: "ลงทุน" };
  }
  if (m.is_derived && m.source_entity_type === "CASH_MOVEMENT") {
    if (m.movement_type === "OTHER_IN") return { label: "รับเงินกู้ภายใน", tone: "indigo", category: "เงินกู้ภายในครอบครัว" };
    if (m.movement_type === "OTHER_OUT") return { label: "ชำระเงินกู้ภายใน", tone: "indigo", category: "เงินกู้ภายในครอบครัว" };
  }
  return null;
}

export const TONE_CLS: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200", sky: "bg-sky-50 text-sky-700 ring-sky-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200", red: "bg-red-50 text-red-700 ring-red-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200", violet: "bg-violet-50 text-violet-700 ring-violet-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200", slate: "bg-slate-100 text-slate-600 ring-slate-200",
};

/** ข้อความของก้อน "รอแยกรายละเอียด" ขึ้นต้นด้วยคำนี้ → ตัดออกตอนแสดง (ป้ายในช่องหมวดหมู่บอกแล้ว · ข้อมูลที่เก็บไม่เปลี่ยน) */
export function stripPending<T extends string | null | undefined>(s: T): T {
  return (typeof s === "string" ? s.replace(/^รอแยกรายละเอียด\s*·\s*/, "") : s) as T;
}
