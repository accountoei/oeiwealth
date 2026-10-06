"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
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

// ---------------------------------------------------------------- Invite (Edge Function: invite-user)
export type InviteState = ActionState & { link?: string; email?: string };

async function callInvite(body: Record<string, unknown>): Promise<InviteState> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("invite-user", { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try { msg = (await ctx.json()).error ?? msg; } catch { /* ไม่ใช่ JSON */ }
    }
    if (/Failed to send a request|not found|404/i.test(msg)) msg = "ยังไม่ได้ติดตั้ง Edge Function invite-user ใน Supabase";
    return { error: msg };
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const link = `${proto}://${host}/auth/accept?token_hash=${encodeURIComponent(data.token_hash)}&type=${data.type}`;
  revalidatePath("/settings/family-users");
  return { ok: "สร้างลิงก์แล้ว", link, email: data.email };
}

export async function inviteUser(_: InviteState, form: FormData): Promise<InviteState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "กรุณาใส่อีเมล" };
  return callInvite({
    action: "invite", email, role: String(form.get("role") ?? "VIEWER"),
    person_id: String(form.get("person_id") ?? "") || null,
  });
}

export async function resendInvite(_: InviteState, form: FormData): Promise<InviteState> {
  return callInvite({ action: "resend", app_user_id: String(form.get("id")) });
}

export async function resetPasswordLink(_: InviteState, form: FormData): Promise<InviteState> {
  return callInvite({ action: "reset_password", app_user_id: String(form.get("id")) });
}

export async function resetMfa(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("invite-user", { body: { action: "reset_mfa", app_user_id: String(form.get("id")) } });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") { try { msg = (await ctx.json()).error ?? msg; } catch { /* */ } }
    return { error: msg };
  }
  return { ok: `ลบ MFA แล้ว ${data?.removed ?? 0} รายการ · ผู้ใช้ต้องสแกน QR ใหม่ตอนเข้าระบบครั้งถัดไป` };
}
