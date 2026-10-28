"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { EDUCATION_LEVEL_LABEL, friendlyError as friendly, RELATIONSHIP_LABEL, type FormState } from "@/lib/format";

export type ActionState = FormState;

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

/** ย้ายลำดับขึ้น (-1) / ลง (+1) */
export async function movePerson(form: FormData): Promise<void> {
  const supabase = await createClient();
  const dir = Number(form.get("dir"));
  await supabase.rpc("move_person", { p_person_id: String(form.get("id")), p_direction: dir === -1 ? -1 : 1 });
  refresh();
}

/** ชื่อครอบครัว + รูป + หัวหน้าครอบครัว (ADMIN เท่านั้น — ฐานข้อมูลบังคับสิทธิ์) */
export async function updateFamily(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const name = String(form.get("name") ?? "").trim();
  const head = String(form.get("head_person_id") ?? "");
  if (!name) return { error: "กรุณาใส่ชื่อครอบครัว" };
  if (name.length > 120) return { error: "ชื่อยาวเกินไป" };
  const { data: family } = await supabase.from("families").select("id,name,head_person_id").maybeSingle();
  if (!family) return { error: "ไม่พบข้อมูลครอบครัว" };
  const row: { name?: string; photo?: string | null } = {};
  if (name !== family.name) row.name = name;
  // รูปครอบครัว: ส่งมาเฉพาะเมื่อเลือกรูปใหม่ / กดลบรูป
  const photo = String(form.get("photo") ?? "");
  if (form.get("photo_clear") === "1") row.photo = null;
  else if (photo) {
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(photo) || photo.length > 300000) return { error: "รูปครอบครัวใหญ่เกินไป หรือไม่ใช่ไฟล์รูปภาพ" };
    row.photo = photo;
  }
  if (Object.keys(row).length) {
    const { data, error } = await supabase.from("families").update(row).eq("id", family.id).select("id");
    if (error) return { error: friendly(error.message) };
    if (!data?.length) return { error: "เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ข้อมูลครอบครัวได้" };
  }
  const headChanged = !!head && head !== family.head_person_id;
  if (headChanged) {
    const { error } = await supabase.rpc("set_family_head", { p_person_id: head });
    if (error) return { error: friendly(error.message) };
  }
  refresh();
  return { ok: headChanged ? "บันทึกแล้ว · เปลี่ยนหัวหน้าครอบครัวแล้ว" : "บันทึกแล้ว" };
}

const TEXT_FIELDS = ["title_prefix", "full_name_th", "full_name_en", "nickname", "phone", "email", "address",
  "emergency_contact_name", "emergency_contact_phone", "passport_no", "house_registration_no", "notes",
  "education_institution", "education_major", "occupation", "workplace", "job_title", "social_positions"] as const;

/** ข้อมูลส่วนบุคคล (หน้ารายคน) */
export async function updatePersonDetails(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("id"));
  const s = (k: string) => { const v = String(form.get(k) ?? "").trim(); return v === "" ? null : v; };
  const name = s("name");
  if (!name) return { error: "กรุณาใส่ชื่อ" };
  const relationship = String(form.get("relationship") ?? "");
  if (!(relationship in RELATIONSHIP_LABEL)) return { error: "กรุณาเลือกความสัมพันธ์" };
  const status = String(form.get("status") ?? "ACTIVE");
  if (!["ACTIVE", "INACTIVE", "DECEASED"].includes(status)) return { error: "สถานะไม่ถูกต้อง" };
  const row: Record<string, string | null> = { name, relationship, status };
  for (const k of TEXT_FIELDS) row[k] = s(k);
  const nid = String(form.get("national_id") ?? "").replace(/\D/g, "");
  if (nid && nid.length !== 13) return { error: "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก" };
  row.national_id = nid || null;
  // เพศว่าง → ฐานข้อมูลเติมจากคำนำหน้าให้เอง
  row.gender = s("gender");
  if (row.gender && !["M", "F"].includes(row.gender)) return { error: "เพศไม่ถูกต้อง" };
  row.education_level = s("education_level");
  if (row.education_level && !(row.education_level in EDUCATION_LEVEL_LABEL)) return { error: "วุฒิการศึกษาไม่ถูกต้อง" };
  for (const k of ["father_id", "mother_id", "spouse_id"] as const) {
    const v = s(k);
    if (v === id) return { error: "เลือกตัวเองเป็นพ่อ / แม่ / คู่สมรสไม่ได้" };
    row[k] = v;
  }
  if (row.father_id && row.father_id === row.mother_id) return { error: "พ่อกับแม่ต้องเป็นคนละคน" };
  row.birth_date = s("birth_date");
  row.death_date = status === "DECEASED" ? s("death_date") : null;
  row.passport_expiry = s("passport_expiry");
  const photo = String(form.get("photo") ?? "");
  if (form.get("photo_clear") === "1") row.photo = null;
  else if (photo) {
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(photo) || photo.length > 300000) return { error: "รูปโปรไฟล์ใหญ่เกินไป หรือไม่ใช่ไฟล์รูปภาพ" };
    row.photo = photo;
  }
  // เปลี่ยนสถานะหัวหน้าครอบครัว → โอนหัวหน้าให้คนใหม่ก่อน (ฐานข้อมูลบังคับลำดับนี้)
  const newHead = s("new_head_id");
  if (newHead && status !== "ACTIVE") {
    if (newHead === id) return { error: "เลือกหัวหน้าครอบครัวคนอื่น" };
    const { error: e1 } = await supabase.rpc("set_family_head", { p_person_id: newHead });
    if (e1) return { error: friendly(e1.message) };
  }
  const { data, error } = await supabase.from("persons").update(row).eq("id", id).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  refresh();
  return { ok: newHead && status !== "ACTIVE" ? "บันทึกแล้ว · โอนหัวหน้าครอบครัวแล้ว" : "บันทึกข้อมูลแล้ว" };
}

