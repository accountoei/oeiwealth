"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

function done(id: string, msg: string): ActionState {
  ["/financial/business", `/financial/business/${id}`, "/income-expenses", "/"].forEach((p) => revalidatePath(p));
  revalidatePath("/financial/cash", "layout");
  return { ok: msg };
}

export async function createBusiness(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const value = num(form.get("value"));
  if (value === null || Number.isNaN(value) || value < 0) return { error: "กรุณาใส่มูลค่าเป็นตัวเลข" };
  const { data, error } = await supabase.rpc("create_private_business", { p: {
    company_name: str(form.get("company_name")), name: str(form.get("name")), registration_no: str(form.get("registration_no")),
    business_type: str(form.get("business_type")), total_shares: num(form.get("total_shares")), shares_owned: num(form.get("shares_owned")),
    company_ownership_percent: num(form.get("company_ownership_percent")), investment_cost: num(form.get("investment_cost")),
    currency: str(form.get("currency")), value, value_date: str(form.get("value_date")), is_opening: form.get("is_opening") === "on",
    valuation_method: str(form.get("valuation_method")), acquisition_date: str(form.get("acquisition_date")),
    owners: ownersFromForm(form), notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/financial/business");
  redirect(`/financial/business/${data}`);
}

export async function recordDividend(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่ยอดปันผล" };
  const bank = str(form.get("bank_asset_id"));
  const { data: a } = await supabase.from("assets").select("currency").eq("id", bank ?? id).maybeSingle();
  const { error } = await supabase.from("income_transactions").insert({
    asset_id: id, income_type: "BUSINESS_DIVIDEND", date: str(form.get("date")), amount, tax: num(form.get("tax")),
    currency: a?.currency ?? "THB", received_to_asset_id: bank, notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done(id, "บันทึกเงินปันผลแล้ว");
}

export async function addCapital(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่จำนวนเงิน" };
  const bank = str(form.get("bank_asset_id"));
  const { data: a } = await supabase.from("assets").select("currency").eq("id", bank ?? "").maybeSingle();
  const { error } = await supabase.from("cash_movements").insert({
    movement_date: str(form.get("date")), movement_type: "ASSET_PURCHASE", from_asset_id: bank, to_asset_id: id,
    amount, currency: a?.currency ?? "THB", description: str(form.get("description")) ?? "ลงทุนเพิ่มในกิจการ",
  });
  if (error) return { error: friendlyError(error.message) };
  return done(id, "บันทึกเงินลงทุนเพิ่มแล้ว · อย่าลืมอัปเดตมูลค่ากิจการ");
}
