"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError as friendly, RELATIONSHIP_LABEL } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

/** หน้าที่แสดงรายชื่อสมาชิก / ชื่อครอบครัว — ลำดับใหม่ต้องเห็นทุกหน้า */
function refresh() {
  revalidatePath("/", "layout");
}

export async function addPerson(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const name = String(form.get("name") ?? "").trim();
  const relationship = String(form.get("relationship") ?? "");
  const birthDate = String(form.get("birth_date") ?? "") || null;
  if (!name) return { error: "กรุณาใส่ชื่อ" };
  if (!(relationship in RELATIONSHIP_LABEL)) return { error: "กรุณาเลือกความสัมพันธ์" };

  const { data: family } = await supabase.from("families").select("id").maybeSingle();
  if (!family) return { error: "ไม่พบข้อมูลครอบครัว" };
  const { error } = await supabase.from("persons").insert({ family_id: family.id, name, relationship, birth_date: birthDate });
  if (error) return { error: friendly(error.message) };
  refresh();
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
  refresh();
  return { ok: "บันทึกแล้ว" };
}

/** ย้ายลำดับขึ้น (-1) / ลง (+1) */
export async function movePerson(form: FormData): Promise<void> {
  const supabase = await createClient();
  const dir = Number(form.get("dir"));
  await supabase.rpc("move_person", { p_person_id: String(form.get("id")), p_direction: dir === -1 ? -1 : 1 });
  refresh();
}

/** ชื่อครอบครัว (ADMIN เท่านั้น — ฐานข้อมูลบังคับสิทธิ์) */
export async function updateFamilyName(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "กรุณาใส่ชื่อครอบครัว" };
  if (name.length > 120) return { error: "ชื่อยาวเกินไป" };
  const { data: family } = await supabase.from("families").select("id").maybeSingle();
  if (!family) return { error: "ไม่พบข้อมูลครอบครัว" };
  const { data, error } = await supabase.from("families").update({ name }).eq("id", family.id).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ชื่อครอบครัวได้" };
  refresh();
  return { ok: "บันทึกชื่อครอบครัวแล้ว" };
}
