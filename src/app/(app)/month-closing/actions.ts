"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, strOrNull as str } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

function done(msg: string): ActionState {
  revalidatePath("/month-closing");
  revalidatePath("/financial/cash", "layout");
  revalidatePath("/");
  return { ok: msg };
}

export async function prepareRecon(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("prepare_bank_reconciliation", {
    p_asset_id: String(form.get("asset_id")), p_month: String(form.get("month")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done("คำนวณยอดแล้ว");
}

export async function confirmRecon(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const actual = num(form.get("actual_closing"));
  if (actual === null || Number.isNaN(actual)) return { error: "กรุณาใส่ยอดจริงตาม Statement / แอปธนาคาร" };
  const { error } = await supabase.rpc("confirm_bank_reconciliation", {
    p_reconciliation_id: String(form.get("id")), p_actual_closing: actual, p_actual_closing_date: null,
    p_rounding_adjustment: num(form.get("rounding")) ?? 0, p_difference_reason: str(form.get("reason")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done("ยืนยันยอดแล้ว");
}

/** ลงส่วนต่างเป็นค่าใช้จ่าย / รายได้ก้อนเดียว "รอแยกรายละเอียด" แล้วยืนยันยอด (ผลต่าง = 0) */
export async function settleRecon(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const actual = num(form.get("actual_closing"));
  const { data, error } = await supabase.rpc("settle_bank_difference", {
    p_reconciliation_id: String(form.get("id")), p_actual_closing: actual === null || Number.isNaN(actual) ? null : actual,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/income-expenses");
  const r = data as { kind: string | null; amount: number } | null;
  const amt = Number(r?.amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return done(r?.kind === "EXPENSE" ? `ลงค่าใช้จ่ายก้อนรอแยก ${amt} และยืนยันยอดแล้ว`
    : r?.kind === "INCOME" ? `ลงรายได้ก้อนรอแยก ${amt} และยืนยันยอดแล้ว` : "ยืนยันยอดแล้ว (ไม่มีส่วนต่าง)");
}

export async function finalizeMonth(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  if (form.get("confirm") !== "on") return { error: "กรุณาติ๊กยืนยันว่าตรวจตัวเลขแล้ว" };
  const { error } = await supabase.rpc("finalize_month", { p_month: String(form.get("month")) });
  if (error) return { error: friendlyError(error.message) };
  return done("ปิดเดือนแล้ว (FINAL)");
}

export async function reopenMonth(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const reason = str(form.get("reason"));
  if (!reason) return { error: "กรุณาระบุเหตุผล" };
  const { error } = await supabase.rpc("reopen_month", { p_month: String(form.get("month")), p_reason: reason });
  if (error) return { error: friendlyError(error.message) };
  return done("เปิดเดือนกลับเป็น DRAFT แล้ว");
}
