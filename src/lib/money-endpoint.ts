/**
 * ช่องทางเงิน — เงินออกจาก / เข้า ที่ไหน: บัญชีธนาคาร · บัตรเครดิต · บัญชีเงินฝากในพอร์ต · เงินสด (ไม่ผ่านบัญชี)
 *
 * ทุกฟอร์มและ server action อ่าน / เขียนช่องทางผ่านไฟล์นี้ที่เดียว
 *   - ฟอร์มแบบเลือกประเภท: pay_via = bank | card | portfolio | cash + ช่อง bank_asset_id / card_id / pf_cash_id
 *   - ตัวเลือกช่องเดียว (dropdown รวม): "a:<id>" บัญชี · "c:<id>" บัตร · "h:<id>" เงินฝากในพอร์ต · ว่าง = เงินสด
 *     (ตรงกับ p_account ของ RPC update_entry)
 * ไฟล์นี้ต้องไม่ import อะไร — ใช้ได้ทั้งฝั่ง server / client และเทสต์ด้วย node ตรง ๆ (scripts/money-endpoint.test.mjs)
 */

export type EndpointKind = "bank" | "card" | "portfolio" | "cash";
export type Endpoint = { kind: EndpointKind; id: string | null };

const PREFIX: Record<Exclude<EndpointKind, "cash">, string> = { bank: "a:", card: "c:", portfolio: "h:" };
const FIELD: Record<Exclude<EndpointKind, "cash">, string> = { bank: "bank_asset_id", card: "card_id", portfolio: "pf_cash_id" };

const clean = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const isKind = (v: string): v is Exclude<EndpointKind, "cash"> => Object.hasOwn(PREFIX, v);

/** ค่าในตัวเลือกช่องเดียว · เงินสด = "" */
export function endpointValue(e: Endpoint): string {
  return e.kind === "cash" || !e.id ? "" : `${PREFIX[e.kind]}${e.id}`;
}

/** อ่านค่าจากตัวเลือกช่องเดียว ("a:" / "c:" / "h:") · ว่างหรือไม่รู้จัก = เงินสด */
export function parseEndpoint(v: string | null | undefined): Endpoint {
  const s = clean(v);
  if (s) for (const k of Object.keys(PREFIX) as Exclude<EndpointKind, "cash">[]) {
    if (s.startsWith(PREFIX[k])) return { kind: k, id: clean(s.slice(PREFIX[k].length)) };
  }
  return { kind: "cash", id: null };
}

/**
 * อ่านจากฟอร์มแบบเลือกประเภท: ช่อง `field` (ปกติ pay_via) + ช่องรหัสของประเภทนั้น
 * ไม่มีช่อง `field` → ใช้ `fallback` · ค่าที่ไม่รู้จัก = เงินสด
 */
export function endpointFromForm(form: FormData, field = "pay_via", fallback: EndpointKind = "bank"): Endpoint {
  const via = String(form.get(field) ?? fallback);
  if (!isKind(via)) return { kind: "cash", id: null };
  return { kind: via, id: clean(form.get(FIELD[via])) };
}

/** คอลัมน์ "จ่ายจาก" ของ expense_items / add_expense */
export function paidFromColumns(e: Endpoint) {
  return {
    paid_from_asset_id: e.kind === "bank" ? e.id : null,
    paid_from_credit_card_id: e.kind === "card" ? e.id : null,
    paid_from_cash_holding_id: e.kind === "portfolio" ? e.id : null,
  };
}

/** รหัสบัญชีธนาคาร / บัตร ของช่องทาง (null ถ้าเป็นประเภทอื่น) */
export const bankId = (e: Endpoint) => (e.kind === "bank" ? e.id : null);
export const cardId = (e: Endpoint) => (e.kind === "card" ? e.id : null);
export const holdingId = (e: Endpoint) => (e.kind === "portfolio" ? e.id : null);

/** ข้อความเมื่อเลือกประเภทแล้วแต่ยังไม่เลือกบัญชี / บัตร · null = ครบ */
export function missingEndpoint(e: Endpoint): string | null {
  if (e.kind === "cash" || e.id) return null;
  return e.kind === "bank" ? "กรุณาเลือกบัญชี" : e.kind === "card" ? "กรุณาเลือกบัตร" : "กรุณาเลือกบัญชีเงินฝากในพอร์ต";
}
