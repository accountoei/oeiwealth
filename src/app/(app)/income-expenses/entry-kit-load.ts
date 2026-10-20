import { createClient } from "@/lib/supabase/server";
import { buildHints } from "@/lib/category-hints";
import type { Bank, Card, Liab } from "./forms";
import { EXP_SELECT, INC_SELECT, type KitCtx, type Move } from "./entry-kit";
import { loadPfCash } from "@/lib/pf-cash";

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * โหลดข้อมูลที่ชุดคำสั่งกลาง (entry-kit) ต้องใช้ สำหรับหน้าที่ไม่ได้โหลดไว้เอง (หน้ารายละเอียดบัญชีธนาคาร)
 *   บัญชี / บัตร / หนี้ / สมาชิก / หมวด / คำเดา · รายได้ / ค่าใช้จ่ายที่รายการเงินเข้า–ออกอ้างถึง · ชื่อทรัพย์สินอื่น
 */
export async function loadKitCtx(supabase: Supa, moves: Move[], base: Pick<KitCtx, "ym" | "personId" | "canWrite" | "canDelete" | "paths">): Promise<KitCtx> {
  const incIds = [...new Set(moves.filter((m) => m.source_entity_type === "INCOME" && m.source_entity_id).map((m) => m.source_entity_id as string))];
  const expIds = [...new Set(moves.filter((m) => m.source_entity_type === "EXPENSE" && m.source_entity_id).map((m) => m.source_entity_id as string))];
  const none = Promise.resolve({ data: [] as never[] });
  const [{ data: banksRaw }, { data: cardsRaw }, { data: cardBal }, { data: liabRaw }, { data: persons }, { data: cats }, { data: hintRows },
    { data: incs }, { data: exps }, pfCash] = await Promise.all([
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency,outstanding_balance").is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("v_card_balances").select("card_id,current_balance"),
    supabase.from("liabilities").select("id,name,currency,outstanding_amount").is("deleted_at", null).eq("status", "ACTIVE"),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("ie_categories").select("kind,name,active").is("deleted_at", null).order("sort_order").order("name"),
    supabase.from("expense_items").select("description,expense_category,paid_from_asset_id,paid_from_credit_card_id")
      .is("deleted_at", null).eq("pending_split", false).is("source_cash_movement_id", null).is("liability_id", null)
      .is("insurance_schedule_line_id", null).is("property_utility_id", null)
      .order("date", { ascending: false }).order("created_at", { ascending: false }).limit(1500),
    incIds.length ? supabase.from("income_transactions").select(INC_SELECT).in("id", incIds) : none,
    expIds.length ? supabase.from("expense_items").select(EXP_SELECT).in("id", expIds) : none,
    loadPfCash(supabase),
  ]);
  const banks = (banksRaw as Bank[] | null) ?? [];
  const bankSet = new Set(banks.map((b) => b.asset_id));
  const otherIds = [...new Set(moves.flatMap((m) => [m.from_asset_id, m.to_asset_id]).filter((x): x is string => !!x && !bankSet.has(x)))];
  const { data: others } = otherIds.length ? await supabase.from("assets").select("id,name,asset_type").in("id", otherIds) : { data: [] };
  const cur = new Map((cardBal ?? []).map((r) => [r.card_id as string, Number(r.current_balance)]));
  const cards: Card[] = (cardsRaw ?? []).map((c) => ({ id: c.id, currency: c.currency, outstanding_balance: cur.get(c.id) ?? Number(c.outstanding_balance),
    label: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ") }));
  const expCats = (cats ?? []).filter((c) => c.kind === "EXPENSE" && c.active).map((c) => c.name as string);
  const incSubs = (cats ?? []).filter((c) => c.kind === "INCOME_OTHER" && c.active).map((c) => c.name as string);
  return {
    ...base, banks, cards, pfCash, liabs: (liabRaw as Liab[] | null) ?? [], persons: persons ?? [], incSubs, expCats,
    expHints: buildHints(hintRows ?? [], expCats), moves,
    incById: new Map((incs ?? []).map((i) => [i.id as string, i])), expById: new Map((exps ?? []).map((i) => [i.id as string, i])),
    otherAssets: (others ?? []) as { id: string; name: string; asset_type: string }[], tabLinks: false,
  };
}
