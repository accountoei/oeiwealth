"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, ownersFromForm } from "@/lib/format";

export type RecState = { error?: string; ok?: string };

type Kind = "num" | "str" | "date" | "bool";
// ตาราง + ฟิลด์ที่แก้ได้จากหน้าจอ (ฟิลด์อื่น / รายการที่ระบบสร้าง ถูกกันด้วย Trigger อีกชั้น)
const EDITABLE: Record<string, Record<string, Kind>> = {
  income_transactions: { date: "date", amount: "num", tax: "num", notes: "str" },
  expense_items: { date: "date", description: "str", amount: "num", expense_category: "str", notes: "str", expected_reimbursement_amount: "num" },
  cash_movements: { movement_date: "date", amount: "num", counter_amount: "num", fee: "num", description: "str" },
  investment_transactions: { transaction_date: "date", settlement_date: "date", quantity: "num", price: "num", amount: "num", fee: "num", tax: "num", notes: "str" },
  asset_valuations: { valuation_date: "date", value: "num", notes: "str" },
  liability_valuations: { valuation_date: "date", balance: "num", notes: "str" },
  investment_valuations: { valuation_date: "date", price: "num", market_value: "num" },
  expense_reimbursements: { received_date: "date", amount: "num", notes: "str" },
  recurring_income_templates: { name: "str", expected_amount: "num", due_day: "num", end_date: "date", notes: "str" },
  property_leases: { tenant_name: "str", unit_label: "str", contract_no: "str", end_date: "date", rent_amount: "num", payment_due_day: "num", notes: "str" },
  property_utilities: { provider: "str", account_no: "str", meter_no: "str", notes: "str" },
  insurance_claims: { incident_date: "date", claim_date: "date", claimed_amount: "num", received_amount: "num", status: "str", notes: "str" },
  credit_cards: { issuer: "str", card_name: "str", credit_limit: "num", statement_day: "num", due_day: "num", annual_fee: "num", expiry_date: "date", notes: "str" },
  investment_holdings: { name: "str", symbol: "str", maturity_date: "date", notes: "str" },
  loan_details: { borrower_name: "str", interest_rate: "num", due_date: "date", status: "str", notes: "str" },
  alternative_asset_details: { brand: "str", model: "str", serial_no: "str", quantity: "num", storage_location: "str", condition: "str", details: "str" },
  insurance_policies: { insurer: "str", policy_no: "str", start_date: "date", end_date: "date", insured_amount: "num", premium: "num", status: "str", notes: "str" },
  assets: { name: "str", acquisition_date: "date", acquisition_cost: "num", status: "str", notes: "str" },
};
const DELETABLE = new Set(["income_transactions", "expense_items", "cash_movements", "investment_transactions", "asset_valuations",
  "liability_valuations", "investment_valuations", "expense_reimbursements", "recurring_income_templates", "property_utilities",
  "insurance_claims", "expected_income_dismissals"]);

function refresh(form: FormData) {
  String(form.get("paths") ?? "").split(",").filter(Boolean).forEach((p) => revalidatePath(p));
  revalidatePath("/");
}
function parse(v: FormDataEntryValue | null, k: Kind) {
  const s = String(v ?? "").trim();
  if (k === "bool") return s === "on" || s === "true";
  if (s === "") return null;
  if (k === "num") return Number(s.replace(/,/g, ""));
  return s;
}

export async function updateRecord(_: RecState, form: FormData): Promise<RecState> {
  const table = String(form.get("table"));
  const spec = EDITABLE[table];
  if (!spec) return { error: "แก้ไขรายการประเภทนี้ไม่ได้" };
  const patch: Record<string, unknown> = {};
  for (const [k] of form.entries()) {
    if (!k.startsWith("f_")) continue;
    const f = k.slice(2);
    if (!spec[f]) continue;
    const v = parse(form.get(k), spec[f]);
    if (typeof v === "number" && Number.isNaN(v)) return { error: "ตัวเลขไม่ถูกต้อง" };
    patch[f] = v;
  }
  if (!Object.keys(patch).length) return { error: "ไม่มีข้อมูลที่แก้" };
  const supabase = await createClient();
  const id = String(form.get("id"));
  if (table === "investment_transactions" && patch.quantity != null && patch.price != null) {
    const { data: t } = await supabase.from("investment_transactions").select("transaction_type").eq("id", id).maybeSingle();
    if (t && ["BUY", "SELL"].includes(t.transaction_type)) patch.amount = Math.round(Number(patch.quantity) * Number(patch.price) * 10000) / 10000;
  }
  const { data, error } = await supabase.from(table).update(patch).eq("id", id).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้ (ผู้บันทึกแก้ได้เฉพาะรายการของตัวเองภายใน 24 ชม.)" };
  refresh(form);
  return { ok: "บันทึกการแก้ไขแล้ว" };
}

export async function deleteRecord(_: RecState, form: FormData): Promise<RecState> {
  const table = String(form.get("table"));
  if (!DELETABLE.has(table)) return { error: "ลบรายการประเภทนี้ไม่ได้" };
  const supabase = await createClient();
  const { data, error } = await supabase.from(table).update({ deleted_at: new Date().toISOString() })
    .eq("id", String(form.get("id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์ลบรายการนี้" };
  refresh(form);
  return { ok: "ลบแล้ว" };
}

/** ลบรายการหลักทั้งชุด (บัญชี / ทรัพย์สิน / พอร์ต / หนี้ / บัตร / สัญญาเช่า / กรมธรรม์) */
export async function deleteEntity(_: RecState, form: FormData): Promise<RecState> {
  const supabase = await createClient();
  const kind = String(form.get("kind"));
  const id = String(form.get("id"));
  const reason = String(form.get("reason") ?? "").trim();
  const call =
    kind === "asset" ? supabase.rpc("delete_asset", { p_asset_id: id, p_reason: reason })
    : kind === "liability" ? supabase.rpc("delete_liability", { p_liability_id: id, p_reason: reason })
    : kind === "card" ? supabase.rpc("delete_credit_card", { p_card_id: id, p_reason: reason })
    : kind === "lease" ? supabase.rpc("delete_lease", { p_lease_id: id })
    : kind === "policy" ? supabase.rpc("delete_insurance_policy", { p_policy_id: id, p_reason: reason })
    : null;
  if (!call) return { error: "ประเภทไม่ถูกต้อง" };
  const { error } = await call;
  if (error) return { error: friendlyError(error.message) };
  refresh(form);
  const to = String(form.get("redirect") ?? "");
  if (to) redirect(to);
  return { ok: "ลบแล้ว" };
}

export async function setOwnership(_: RecState, form: FormData): Promise<RecState> {
  const supabase = await createClient();
  const kind = String(form.get("kind"));
  const id = String(form.get("id"));
  const owners = ownersFromForm(form);
  const { error } = kind === "liability"
    ? await supabase.rpc("set_liability_responsibility", { p_liability_id: id, p_owners: owners })
    : await supabase.rpc("set_asset_ownership", {
        p_asset_id: id, p_owners: owners, p_mode: String(form.get("mode") ?? "CORRECT"),
        p_effective_date: String(form.get("effective_date") ?? "") || null,
      });
  if (error) return { error: friendlyError(error.message) };
  refresh(form);
  return { ok: "บันทึกสัดส่วนแล้ว" };
}

export async function addAssetValuation(_: RecState, form: FormData): Promise<RecState> {
  const supabase = await createClient();
  const value = Number(String(form.get("value") ?? "").replace(/,/g, ""));
  if (!String(form.get("value") ?? "").trim() || Number.isNaN(value) || value < 0) return { error: "กรุณาใส่มูลค่าเป็นตัวเลข" };
  const method = String(form.get("valuation_method") ?? "USER_ESTIMATE");
  const { error } = await supabase.from("asset_valuations").insert({
    asset_id: String(form.get("asset_id")), valuation_date: String(form.get("valuation_date")), value,
    valuation_method: method, source: method === "APPRAISAL" ? "APPRAISAL" : method === "STATEMENT" ? "STATEMENT" : "USER",
    notes: String(form.get("notes") ?? "").trim() || null,
  });
  if (error) return { error: friendlyError(error.message) };
  refresh(form);
  return { ok: "บันทึกมูลค่าแล้ว" };
}
