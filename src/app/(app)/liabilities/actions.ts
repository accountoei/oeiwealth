"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

export async function createLiability(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const balance = num(form.get("balance"));
  if (balance === null || Number.isNaN(balance) || balance < 0) return { error: "กรุณาใส่ยอดคงค้างเป็นตัวเลข" };
  const { data, error } = await supabase.rpc("create_liability", {
    p_liability_type: str(form.get("liability_type")),
    p_name: str(form.get("name")),
    p_currency: str(form.get("currency")) ?? "THB",
    p_balance: balance,
    p_balance_date: str(form.get("balance_date")),
    p_is_opening: form.get("is_opening") === "on",
    p_lender: str(form.get("lender")),
    p_original_amount: num(form.get("original_amount")),
    p_interest_rate: num(form.get("interest_rate")),
    p_monthly_payment: num(form.get("monthly_payment")),
    p_payment_due_day: num(form.get("payment_due_day")),
    p_start_date: str(form.get("start_date")),
    p_due_date: str(form.get("due_date")),
    p_linked_asset_id: str(form.get("linked_asset_id")),
    p_owners: ownersFromForm(form),
    p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/liabilities");
  redirect(`/liabilities/${data}`);
}

export async function addLiabilityBalance(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("liability_id"));
  const balance = num(form.get("balance"));
  if (balance === null || Number.isNaN(balance) || balance < 0) return { error: "กรุณาใส่ยอดคงค้างเป็นตัวเลข" };
  const { error } = await supabase.from("liability_valuations").insert({
    liability_id: id, valuation_date: str(form.get("valuation_date")), balance,
    source: str(form.get("source")) ?? "STATEMENT", notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/liabilities/${id}`);
  revalidatePath("/liabilities");
  return { ok: "บันทึกยอดคงค้างแล้ว" };
}

export async function updateLiabilityInfo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("liability_id"));
  const { data, error } = await supabase.from("liabilities").update({
    name: str(form.get("name")), lender: str(form.get("lender")),
    interest_rate: num(form.get("interest_rate")), monthly_payment: num(form.get("monthly_payment")),
    payment_due_day: num(form.get("payment_due_day")), due_date: str(form.get("due_date")),
    status: str(form.get("status")) ?? "ACTIVE", notes: str(form.get("notes")),
  }).eq("id", id).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  revalidatePath(`/liabilities/${id}`);
  revalidatePath("/liabilities");
  return { ok: "บันทึกข้อมูลแล้ว" };
}

// ---------------------------------------------------------------- Credit cards
export async function createCard(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const last4 = str(form.get("card_last4"));
  if (last4 && !/^\d{4}$/.test(last4)) return { error: "เลขบัตร 4 ตัวท้ายต้องเป็นตัวเลข 4 หลัก (ห้ามใส่เลขบัตรเต็ม)" };
  const outstanding = num(form.get("outstanding_balance")) ?? 0;
  const { error } = await supabase.from("credit_cards").insert({
    person_id: str(form.get("person_id")), issuer: str(form.get("issuer")), card_name: str(form.get("card_name")),
    card_last4: last4, credit_limit: num(form.get("credit_limit")), currency: str(form.get("currency")) ?? "THB",
    statement_day: num(form.get("statement_day")), due_day: num(form.get("due_day")),
    annual_fee: num(form.get("annual_fee")), annual_fee_currency: num(form.get("annual_fee")) ? (str(form.get("currency")) ?? "THB") : null,
    expiry_date: str(form.get("expiry_date")),
    outstanding_balance: outstanding, balance_date: str(form.get("balance_date")), notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/family/cards");
  revalidatePath("/liabilities");
  return { ok: "เพิ่มบัตรแล้ว" };
}

export async function updateCardBalance(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const balance = num(form.get("outstanding_balance"));
  if (balance === null || Number.isNaN(balance) || balance < 0) return { error: "กรุณาใส่ยอดค้างเป็นตัวเลข" };
  const patch: Record<string, unknown> = { outstanding_balance: balance, balance_date: str(form.get("balance_date")) };
  const notes = str(form.get("notes"));
  if (notes) patch.notes = notes;
  const { data, error } = await supabase.from("credit_cards").update(patch).eq("id", String(form.get("card_id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขบัตรนี้" };
  revalidatePath("/family/cards");
  revalidatePath("/liabilities");
  return { ok: "อัปเดตยอดบัตรแล้ว" };
}

export async function updateCardStatus(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("credit_cards")
    .update({ status: String(form.get("status")) }).eq("id", String(form.get("card_id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขบัตรนี้" };
  revalidatePath("/family/cards");
  return { ok: "เปลี่ยนสถานะแล้ว" };
}
