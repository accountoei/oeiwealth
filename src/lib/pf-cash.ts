import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

/** บัญชีเงินฝากในพอร์ตที่จ่ายออกได้ (ค่าใช้จ่าย / จ่ายบัตร / ตัดบัตรอัตโนมัติ) · label = พอร์ต · บัญชี */
export type PfCash = { id: string; label: string; currency: string; portfolio: string };

type Asset = { name: string; status: string; deleted_at: string | null };
type Pf = { asset_id: string; deleted_at: string | null; assets: Asset | Asset[] | null };
type Row = { id: string; name: string; currency: string; investment_portfolios: Pf | Pf[] | null };
const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;

/**
 * บัญชีเงินฝากในพอร์ต + error ของคำถาม (ส่วนที่จำผลไว้ใช้ตัดสินว่าจำได้ไหม)
 *   อ่านตารางตรงคำถามเดียว (5 พ.ย. 2026) — เดิมอ่าน v_holdings_active ซึ่งคำนวณมูลค่าทุกรายการไปด้วย
 *   (คำถามที่ช้าที่สุดของหน้า Income & Expenses) แล้วถามชื่อพอร์ตอีกรอบ
 *   เงื่อนไขเดียวกับเดิม: รายการ / พอร์ต / ทรัพย์สินพอร์ตยังไม่ถูกลบ · ไม่รวมพอร์ตที่ปิดแล้ว
 */
export async function queryPfCash(supabase: SupabaseClient): Promise<{ data: PfCash[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.from("investment_holdings")
    .select("id,name,currency,investment_portfolios!inner(asset_id,deleted_at,assets(name,status,deleted_at))")
    .eq("holding_type", "CASH").eq("status", "ACTIVE").is("deleted_at", null).order("sort_order").order("name");
  const list = ((data ?? []) as unknown as Row[]).flatMap((h) => {
    const p = one(h.investment_portfolios);
    const a = one(p?.assets);
    return p && !p.deleted_at && a && !a.deleted_at && a.status !== "CLOSED"
      ? [{ id: h.id, currency: h.currency, portfolio: p.asset_id, label: `${a.name} · ${h.name}` }] : [];
  }).sort((x, y) => x.label.localeCompare(y.label, "th"));
  return { data: list, error };
}

export async function loadPfCash(supabase: SupabaseClient): Promise<PfCash[]> {
  return (await queryPfCash(supabase)).data;
}
