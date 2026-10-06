"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, strOrNull as str } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

export async function addMembership(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.from("memberships").insert({
    person_id: str(form.get("person_id")), program_name: str(form.get("program_name")), member_id: str(form.get("member_id")),
    tier: str(form.get("tier")), benefits: str(form.get("benefits")), expiry_date: str(form.get("expiry_date")), notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/family/cards");
  return { ok: "เพิ่มสมาชิกภาพแล้ว" };
}

export async function addPoints(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const link = str(form.get("link")) ?? "";
  const { error } = await supabase.from("points_accounts").insert({
    person_id: str(form.get("person_id")), program_name: str(form.get("program_name")),
    membership_id: link.startsWith("m:") ? link.slice(2) : null, credit_card_id: link.startsWith("c:") ? link.slice(2) : null,
    balance: num(form.get("balance")) ?? 0, balance_date: str(form.get("balance_date")), expiry_date: str(form.get("expiry_date")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/family/cards");
  return { ok: "เพิ่มบัญชีแต้มแล้ว" };
}
