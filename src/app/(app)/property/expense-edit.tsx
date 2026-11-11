import type { SupabaseClient } from "@supabase/supabase-js";
import RowActions from "@/components/RowActions";
import { EntryEditor, type Bank, type Card, type Person } from "../income-expenses/forms";
import { queryPfCash, type PfCash } from "@/lib/pf-cash";
import { cardLabel } from "@/lib/money-endpoint";

/**
 * ค่าใช้จ่ายครั้งเดียวของทรัพย์สิน → หน้าต่างแก้ไขชุดเดียวกับ Income & Expenses (ตกลง 10 พ.ย. 2026)
 *   ใช้ที่หน้าทรัพย์สิน (ค่าใช้จ่ายครั้งเดียว) และหน้ารวม Property (กล่องที่บันทึกแล้ว)
 *   แก้ได้ครบ: วันที่ · รายละเอียด · ยอด · หมวด / ประเภท · ทรัพย์สิน · จ่ายจาก (บัญชี / บัตร / พอร์ต) · ของใคร · หมายเหตุ
 */
export type ExpEditCtx = { banks: Bank[]; cards: Card[]; pfCash: PfCash[]; persons: Person[]; categories: string[]; properties: { id: string; name: string }[] };

type Asset = { name: string; status: string; deleted_at: string | null };

/** ข้อมูลสำหรับช่องเลือกในหน้าต่างแก้ไข (เรียกใน Promise.all ของหน้า) */
export async function loadExpEditCtx(supabase: SupabaseClient): Promise<ExpEditCtx> {
  const [{ data: banks }, { data: cards }, { data: bal }, pf, { data: persons }, { data: cats }, { data: props }] = await Promise.all([
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("pick_order"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency,outstanding_balance").is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("v_card_balances").select("card_id,current_balance"),
    queryPfCash(supabase),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("ie_categories").select("name").eq("kind", "EXPENSE").eq("active", true).is("deleted_at", null).order("sort_order").order("name"),
    supabase.from("property_details").select("asset_id,assets!inner(name,status,deleted_at)").is("deleted_at", null),
  ]);
  const cur = new Map((bal ?? []).map((r) => [r.card_id as string, Number(r.current_balance)]));
  return {
    banks: (banks ?? []) as Bank[],
    cards: (cards ?? []).map((c) => ({ id: c.id as string, currency: c.currency as string, outstanding_balance: cur.get(c.id as string) ?? Number(c.outstanding_balance ?? 0),
      label: cardLabel(c) })),
    pfCash: pf.data,
    persons: (persons ?? []) as Person[],
    categories: (cats ?? []).map((c) => c.name as string),
    properties: ((props ?? []) as unknown as { asset_id: string; assets: Asset | Asset[] }[])
      .map((p) => ({ id: p.asset_id, a: Array.isArray(p.assets) ? p.assets[0] : p.assets }))
      .filter((p) => p.a && !p.a.deleted_at && p.a.status === "ACTIVE").map((p) => ({ id: p.id, name: p.a.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "th")),
  };
}

export type OneOffExp = {
  id: string; date: string; amount: number | string; currency: string; description: string | null; expense_category: string | null;
  property_cost_type: string | null; related_asset_id: string | null; person_id: string | null; notes: string | null;
  is_reimbursable?: boolean | null; expected_reimbursement_amount?: number | string | null;
  paid_from_asset_id: string | null; paid_from_credit_card_id: string | null; paid_from_cash_holding_id?: string | null;
};
/** คอลัมน์ที่ต้อง select ให้ครบสำหรับหน้าต่างแก้ไข */
export const ONE_OFF_COLS = "id,date,amount,currency,description,expense_category,property_cost_type,related_asset_id,person_id,notes,is_reimbursable,expected_reimbursement_amount,paid_from_asset_id,paid_from_credit_card_id,paid_from_cash_holding_id";

export function OneOffExpenseEdit({ e, ctx, paths, canDelete, button, buttonClass }: {
  e: OneOffExp; ctx: ExpEditCtx; paths: string[]; canDelete: boolean; button?: string; buttonClass?: string;
}) {
  return (
    <RowActions table="expense_items" id={e.id} paths={[...paths, "/income-expenses"]} canDelete={canDelete} button={button} buttonClass={buttonClass}
      editor={<EntryEditor kind="EXPENSE" id={e.id} currency={e.currency} banks={ctx.banks} cards={ctx.cards} pfCash={ctx.pfCash} persons={ctx.persons}
        categories={ctx.categories} reimbursable={!!e.is_reimbursable} properties={ctx.properties}
        values={{ date: e.date, amount: Number(e.amount), description: e.description, category: e.expense_category, property_cost_type: e.property_cost_type,
          related_asset_id: e.related_asset_id, person_id: e.person_id, notes: e.notes, expected_reimbursement_amount: e.expected_reimbursement_amount,
          bank: e.paid_from_asset_id, card: e.paid_from_credit_card_id, hold: e.paid_from_cash_holding_id ?? null }} />} />
  );
}
