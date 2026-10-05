"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; ok?: string };

import { friendlyError as friendly } from "@/lib/format";

const RELATIONSHIPS = ["SELF", "SPOUSE", "CHILD", "CHILD_IN_LAW", "GRANDCHILD", "PARENT", "PARENT_IN_LAW", "SIBLING", "RELATIVE", "OTHER"];

export async function addPerson(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const name = String(form.get("name") ?? "").trim();
  const relationship = String(form.get("relationship") ?? "");
  const birthDate = String(form.get("birth_date") ?? "") || null;
  if (!name) return { error: "กรุณาใส่ชื่อ" };
  if (!RELATIONSHIPS.includes(relationship)) return { error: "กรุณาเลือกความสัมพันธ์" };

  const { data: family } = await supabase.from("families").select("id").maybeSingle();
  if (!family) return { error: "ไม่พบข้อมูลครอบครัว" };
  const { error } = await supabase.from("persons").insert({ family_id: family.id, name, relationship, birth_date: birthDate });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/settings/family-users");
  return { ok: `เพิ่ม ${name} แล้ว` };
}

export async function updatePerson(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("id"));
  const name = String(form.get("name") ?? "").trim();
  const relationship = String(form.get("relationship") ?? "");
  const status = String(form.get("status") ?? "ACTIVE");
  if (!name) return { error: "กรุณาใส่ชื่อ" };
  const { data, error } = await supabase.from("persons").update({ name, relationship, status }).eq("id", id).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  revalidatePath("/settings/family-users");
  return { ok: "บันทึกแล้ว" };
}

export async function setUserRole(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_role", {
    p_app_user_id: String(form.get("id")),
    p_role: String(form.get("role")),
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/settings/family-users");
  return { ok: "เปลี่ยนสิทธิ์แล้ว" };
}

export async function setUserStatus(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_status", {
    p_app_user_id: String(form.get("id")),
    p_status: String(form.get("status")),
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/settings/family-users");
  return { ok: "เปลี่ยนสถานะแล้ว" };
}
