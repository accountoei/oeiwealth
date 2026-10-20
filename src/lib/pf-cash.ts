import type { createClient } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createClient>>;

/** บัญชีเงินฝากในพอร์ตที่จ่ายออกได้ (ค่าใช้จ่าย / จ่ายบัตร / ตัดบัตรอัตโนมัติ) · label = พอร์ต · บัญชี */
export type PfCash = { id: string; label: string; currency: string; portfolio: string };

export async function loadPfCash(supabase: Supa): Promise<PfCash[]> {
  const { data: hs } = await supabase.from("v_holdings_active").select("id,name,currency,portfolio_asset_id,sort_order")
    .eq("holding_type", "CASH").eq("status", "ACTIVE").order("sort_order").order("name");
  const ids = [...new Set((hs ?? []).map((h) => h.portfolio_asset_id as string))];
  if (!ids.length) return [];
  const { data: pfs } = await supabase.from("assets").select("id,name,status").in("id", ids).is("deleted_at", null);
  const pfName = new Map((pfs ?? []).filter((a) => a.status !== "CLOSED").map((a) => [a.id as string, a.name as string]));
  return (hs ?? []).filter((h) => pfName.has(h.portfolio_asset_id as string)).map((h) => ({
    id: h.id as string, currency: h.currency as string, portfolio: h.portfolio_asset_id as string,
    label: `${pfName.get(h.portfolio_asset_id as string)} · ${h.name}`,
  })).sort((a, b) => a.label.localeCompare(b.label, "th"));
}
