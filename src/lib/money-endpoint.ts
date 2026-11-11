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

/** ชื่อบัตรเครดิตแบบเดียวกันทุกหน้า: ผู้ออกบัตร ชื่อบัตร ••เลขท้าย */
export function cardLabel(c: { issuer?: string | null; card_name?: string | null; card_last4?: string | null }): string {
  return [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ");
}

/** อ่านกลับจากคอลัมน์ "จ่ายจาก" (กลับด้านของ paidFromColumns) · ไม่มีเลย = เงินสด */
export function endpointFromColumns(r: { paid_from_asset_id?: string | null; paid_from_credit_card_id?: string | null; paid_from_cash_holding_id?: string | null }): Endpoint {
  if (r.paid_from_asset_id) return { kind: "bank", id: r.paid_from_asset_id };
  if (r.paid_from_credit_card_id) return { kind: "card", id: r.paid_from_credit_card_id };
  if (r.paid_from_cash_holding_id) return { kind: "portfolio", id: r.paid_from_cash_holding_id };
  return { kind: "cash", id: null };
}

/**
 * ค่าตั้งต้น "จ่ายจาก" ที่เก็บไว้ ("a:" / "c:") → รหัสบัญชี / บัตรที่ยังเลือกได้ในฟอร์ม
 * ใช้เฉพาะเมื่อยังอยู่ในรายการและสกุลเงินตรงกัน · ไม่ตรง = ไม่มีค่าตั้งต้น (ฟอร์มใช้บัญชีแรกแบบเดิม)
 */
export function usableDefault(value: string | null | undefined, currency: string,
  banks: { asset_id: string; currency: string }[], cards: { id: string; currency: string }[]): { bank?: string; card?: string } {
  const e = parseEndpoint(value);
  if (e.kind === "bank" && banks.some((b) => b.asset_id === e.id && b.currency === currency)) return { bank: e.id! };
  if (e.kind === "card" && cards.some((c) => c.id === e.id && c.currency === currency)) return { card: e.id! };
  return {};
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

/** 1 บรรทัดของ "จ่ายด้วย" แบบหลายบรรทัด (Property: จ่ายซื้อ / จ่ายเพิ่ม · ค่าใช้จ่าย) · เงินสด: id = ผู้จ่าย */
export type PayLine = { kind: "bank" | "card" | "cash"; id: string; amount: number };

/**
 * อ่านหลายบรรทัดจากช่องซ้ำ pl_via (bank | card | cash) · pl_id · pl_amount (ตกลง 29 ต.ค. 2026 · ให้ยอดตรงกับ statement)
 * บรรทัดที่ไม่มียอด = ข้าม · ยอดผิด / ไม่ได้เลือกบัญชี → { error } บอกเลขบรรทัด
 */
export function payLinesFromForm(form: FormData): PayLine[] | { error: string } {
  const via = form.getAll("pl_via"), ids = form.getAll("pl_id"), amounts = form.getAll("pl_amount");
  const out: PayLine[] = [];
  for (let i = 0; i < via.length; i++) {
    const raw = clean(amounts[i])?.replace(/,/g, "") ?? null;
    if (raw === null) continue;
    const amount = Number(raw);
    if (!(amount > 0)) return { error: `บรรทัดที่ ${i + 1} · จำนวนเงินต้องเป็นตัวเลขมากกว่า 0` };
    const v = String(via[i]);
    const kind: PayLine["kind"] = v === "card" ? "card" : v === "cash" ? "cash" : "bank";
    const id = clean(ids[i]);
    if (!id) return { error: `บรรทัดที่ ${i + 1} · กรุณาเลือก${kind === "cash" ? "ผู้จ่าย" : kind === "card" ? "บัตร" : "บัญชี"}` };
    out.push({ kind, id, amount });
  }
  return out.length ? out : { error: "กรุณาใส่จำนวนเงินอย่างน้อย 1 บรรทัด" };
}
