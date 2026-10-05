"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

function bens(form: FormData) {
  try { return JSON.parse(String(form.get("beneficiaries") ?? "[]")); } catch { return []; }
}

export async function createPolicy(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const hasCv = form.get("has_cash_value") === "on";
  const { data, error } = await supabase.rpc("create_insurance_policy", { p: {
    insurance_type: str(form.get("insurance_type")), person_id: str(form.get("person_id")), insured_asset_id: str(form.get("insured_asset_id")),
    insurer: str(form.get("insurer")), policy_no: str(form.get("policy_no")), start_date: str(form.get("start_date")),
    end_date: str(form.get("end_date")), insured_amount: num(form.get("insured_amount")), premium: num(form.get("premium")),
    currency: str(form.get("currency")), has_cash_value: hasCv, is_opening: form.get("is_opening") === "on",
    cash_value: hasCv ? num(form.get("cash_value")) : null, cash_value_date: hasCv ? str(form.get("cash_value_date")) : null,
    owners: ownersFromForm(form), beneficiaries: bens(form), notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/insurance");
  redirect(`/insurance/${data}`);
}

export async function saveBeneficiaries(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const { error } = await supabase.rpc("set_beneficiaries", { p_policy_id: id, p_list: bens(form) });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/insurance/${id}`);
  return { ok: "บันทึกผู้รับผลประโยชน์แล้ว" };
}

export async function addClaim(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const { error } = await supabase.from("insurance_claims").insert({
    policy_id: id, incident_date: str(form.get("incident_date")), claim_date: str(form.get("claim_date")),
    claimed_amount: num(form.get("claimed_amount")), currency: str(form.get("currency")) ?? "THB",
    status: str(form.get("status")) ?? "SUBMITTED", notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/insurance/${id}`);
  return { ok: "บันทึกเคลมแล้ว" };
}
