"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, strOrNull as str } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

export async function addCheckup(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  let results: unknown[] = [];
  try { results = JSON.parse(String(form.get("results") ?? "[]")); } catch { /* ว่าง */ }
  const { error } = await supabase.rpc("add_health_checkup", { p: {
    person_id: str(form.get("person_id")), checkup_date: str(form.get("checkup_date")), hospital: str(form.get("hospital")),
    package_name: str(form.get("package_name")), cost: num(form.get("cost")), notes: str(form.get("notes")), results,
  } });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/family/health");
  return { ok: "บันทึกผลตรวจแล้ว" };
}
