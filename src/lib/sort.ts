import { createClient } from "@/lib/supabase/server";

/** ลำดับที่ตั้งไว้ของตาราง (id → sort_order) */
export async function loadSortMap(table: "assets" | "insurance_policies" | "liabilities" | "credit_cards" | "memberships" | "points_accounts") {
  const supabase = await createClient();
  const { data } = await supabase.from(table).select("id,sort_order").is("deleted_at", null);
  return new Map(((data ?? []) as { id: string; sort_order: number | null }[]).map((r) => [r.id, r.sort_order]));
}

/** ลิงก์ของหน้าเดิม (คงตัวกรองไว้) พร้อม / ไม่พร้อม ?order= */
export function orderHrefs(path: string, params: Record<string, string | undefined>, key = "1") {
  const build = (order?: string) => {
    const u = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v && k !== "order") u.set(k, v); });
    if (order) u.set("order", order);
    const s = u.toString();
    return `${path}${s ? `?${s}` : ""}`;
  };
  return { href: build(key), doneHref: build() };
}
