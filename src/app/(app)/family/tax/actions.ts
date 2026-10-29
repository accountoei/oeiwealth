"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, strOrNull as str, type FormState } from "@/lib/format";

export type ActionState = FormState;

const done = (ok: string): ActionState => { revalidatePath("/family/tax"); return { ok }; };

/** สร้างแบบร่าง (ดึงยอดจากระบบ) */
export async function createReturn(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("tax_create_return", {
    p_person: str(form.get("person_id")), p_year: Number(form.get("tax_year")), p_form: str(form.get("form_type")) ?? "PND90",
  });
  return error ? { error: friendlyError(error.message) } : done("สร้างแบบร่างแล้ว");
}

/** ดึงยอดจากระบบใหม่ (ยอดใช้ยื่นที่แก้เองไม่ถูกทับ) */
export async function refreshReturn(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("tax_refresh_return", { p_id: str(form.get("id")) });
  return error ? { error: friendlyError(error.message) } : done("ดึงยอดจากระบบใหม่แล้ว");
}

/** เปลี่ยนสถานะ: ร่าง ↔ ตรวจแล้ว · บันทึกว่ายื่นแล้ว (วันที่ยื่น + เลขอ้างอิง + ผลภาษี) */
export async function setStatus(_: ActionState, form: FormData): Promise<ActionState> {
  const status = str(form.get("status"));
  const result = num(form.get("tax_result"));
  const info = status === "FILED" ? {
    filed_date: str(form.get("filed_date")), reference_no: str(form.get("reference_no")),
    tax_result: result == null ? null : (form.get("result_sign") === "refund" ? -Math.abs(result) : Math.abs(result)),
    settlement_status: str(form.get("settlement_status")), settled_date: str(form.get("settled_date")),
  } : {};
  const supabase = await createClient();
  const { error } = await supabase.rpc("tax_set_status", { p_id: str(form.get("id")), p_status: status, p_info: info });
  return error ? { error: friendlyError(error.message) } : done(status === "FILED" ? "บันทึกว่ายื่นแล้ว" : "เปลี่ยนสถานะแล้ว");
}

/** ยื่นเพิ่มเติม → ฉบับใหม่ (ฉบับเดิมคงไว้) */
export async function amendReturn(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("tax_amend_return", { p_id: str(form.get("id")), p_reason: str(form.get("reason")) });
  return error ? { error: friendlyError(error.message) } : done("สร้างฉบับยื่นเพิ่มเติมแล้ว");
}

/** ลบแบบร่าง (ยังไม่ยื่น) */
export async function deleteReturn(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("tax_delete_return", { p_id: str(form.get("id")) });
  return error ? { error: friendlyError(error.message) } : done("ลบแบบร่างแล้ว");
}

/** แก้ยอดใช้ยื่น / จำนวน / วิธีหักค่าใช้จ่าย + เหตุผล (ว่าง = ใช้ยอดจากระบบ) */
export async function saveLine(_: ActionState, form: FormData): Promise<ActionState> {
  const row: Record<string, unknown> = { filed_amount: num(form.get("filed_amount")), reason: str(form.get("reason")) };
  if (form.has("filed_qty")) row.filed_qty = num(form.get("filed_qty"));
  if (form.has("method")) row.method = str(form.get("method"));
  const supabase = await createClient();
  const { error } = await supabase.from("tax_return_lines").update(row).eq("id", str(form.get("id")));
  return error ? { error: friendlyError(error.message) } : done("บันทึกแล้ว");
}

/** แบบที่ยื่นแล้ว: บันทึกผลการชำระ / รับคืน และหมายเหตุ */
export async function saveSettlement(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.from("tax_returns").update({
    settlement_status: str(form.get("settlement_status")), settled_date: str(form.get("settled_date")), notes: str(form.get("notes")),
  }).eq("id", str(form.get("id")));
  return error ? { error: friendlyError(error.message) } : done("บันทึกแล้ว");
}
