/**
 * เดาหมวด / บัญชีที่จ่าย จากรายการค่าใช้จ่ายที่เคยบันทึก (รายละเอียดเดียวกัน → หมวด + บัญชีเดิม)
 *   หน้า Income & Expenses ส่งรายการล่าสุด (ไม่ซ้ำรายละเอียด) มาให้ฟอร์ม · เดาให้เฉพาะช่องที่ผู้ใช้ยังไม่ได้เลือกเอง
 */
export type ExpHint = { d: string; c: string; via: "bank" | "card" | "cash"; acc: string | null };

export const normDesc = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** ตรงทั้งคำก่อน → ขึ้นต้นเหมือนกัน (พิมพ์อย่างน้อย 3 ตัวอักษร) */
export function findHint(hints: ExpHint[], text: string): ExpHint | null {
  const q = normDesc(text);
  if (q.length < 2) return null;
  const exact = hints.find((h) => normDesc(h.d) === q);
  if (exact || q.length < 3) return exact ?? null;
  return hints.find((h) => normDesc(h.d).startsWith(q)) ?? null;
}

/** แถวค่าใช้จ่ายล่าสุด → รายการเดา (ไม่ซ้ำรายละเอียด · ใหม่สุดก่อน) */
export function buildHints(rows: { description: string | null; expense_category: string | null; paid_from_asset_id: string | null;
  paid_from_credit_card_id: string | null }[], categories: string[], max = 400): ExpHint[] {
  const ok = new Set(categories);
  const seen = new Set<string>();
  const out: ExpHint[] = [];
  for (const r of rows) {
    const d = (r.description ?? "").trim();
    const k = normDesc(d);
    if (!d || !r.expense_category || !ok.has(r.expense_category) || seen.has(k)) continue;
    seen.add(k);
    out.push({ d, c: r.expense_category, via: r.paid_from_credit_card_id ? "card" : r.paid_from_asset_id ? "bank" : "cash",
      acc: r.paid_from_credit_card_id ?? r.paid_from_asset_id ?? null });
    if (out.length >= max) break;
  }
  return out;
}
