import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, todayBangkok } from "@/lib/format";

/**
 * สกุลเงินสำหรับช่องเลือก
 *   used   = THB, USD + สกุลที่ครอบครัวใช้อยู่ (บัญชี / ทรัพย์สิน / หลักทรัพย์ / หนี้ / บัตร / ประกัน)
 *   others = สกุลที่มีอัตราแลกเปลี่ยนในระบบ (30 วันล่าสุด) แต่ยังไม่ได้ใช้
 */
export async function getCurrencyLists(supabase: SupabaseClient): Promise<{ used: string[]; others: string[] }> {
  const since = addDays(todayBangkok(), -30);
  const [a, h, l, c, p, fx] = await Promise.all([
    supabase.from("assets").select("currency").is("deleted_at", null),
    supabase.from("investment_holdings").select("currency").is("deleted_at", null),
    supabase.from("liabilities").select("currency").is("deleted_at", null),
    supabase.from("credit_cards").select("currency").is("deleted_at", null),
    supabase.from("insurance_policies").select("premium_currency").is("deleted_at", null),
    supabase.from("fx_rates").select("currency").gte("rate_date", since).limit(5000),
  ]);
  const inUse = new Set<string>(["THB", "USD"]);
  for (const r of [...(a.data ?? []), ...(h.data ?? []), ...(l.data ?? []), ...(c.data ?? [])]) if (r.currency) inUse.add(r.currency);
  for (const r of p.data ?? []) if (r.premium_currency) inUse.add(r.premium_currency);
  const head = (x: string) => (x === "THB" ? 0 : x === "USD" ? 1 : 2);
  const used = [...inUse].sort((x, y) => head(x) - head(y) || x.localeCompare(y));
  const others = [...new Set((fx.data ?? []).map((r) => r.currency as string))].filter((x) => !inUse.has(x)).sort();
  return { used, others };
}
