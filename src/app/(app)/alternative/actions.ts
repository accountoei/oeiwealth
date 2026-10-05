"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

export async function createAlternative(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const value = num(form.get("value"));
  if (value === null || Number.isNaN(value) || value < 0) return { error: "กรุณาใส่มูลค่าเป็นตัวเลข" };
  const { data, error } = await supabase.rpc("create_alternative_asset", { p: {
    name: str(form.get("name")), category_id: str(form.get("category_id")), currency: str(form.get("currency")),
    value, value_date: str(form.get("value_date")), is_opening: form.get("is_opening") === "on",
    valuation_method: str(form.get("valuation_method")), acquisition_date: str(form.get("acquisition_date")),
    acquisition_cost: num(form.get("acquisition_cost")), brand: str(form.get("brand")), model: str(form.get("model")),
    serial_no: str(form.get("serial_no")), quantity: num(form.get("quantity")), storage_location: str(form.get("storage_location")),
    condition: str(form.get("condition")), details: str(form.get("details")), owners: ownersFromForm(form), notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/alternative");
  redirect(`/alternative/${data}`);
}

export async function addCategory(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const name = str(form.get("category_name"));
  if (!name) return { error: "กรุณาใส่ชื่อหมวด" };
  const { data: fam } = await supabase.from("families").select("id").maybeSingle();
  const code = "CUSTOM_" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const { error } = await supabase.from("asset_categories").insert({ family_id: fam?.id, category_code: code, category_name: name });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/alternative/new");
  return { ok: `เพิ่มหมวด "${name}" แล้ว` };
}
