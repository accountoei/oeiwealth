"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

function done(id: string, msg: string): ActionState {
  revalidatePath("/financial/loans");
  revalidatePath(`/financial/loans/${id}`);
  revalidatePath("/financial/cash", "layout");
  revalidatePath("/income-expenses");
  revalidatePath("/");
  return { ok: msg };
}

export async function createLoan(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const opening = form.get("is_opening") === "on";
  const { data, error } = await supabase.rpc("create_loan", { p: {
    name: str(form.get("name")), borrower_name: str(form.get("borrower_name")), principal: num(form.get("principal")),
    currency: str(form.get("currency")), interest_rate: num(form.get("interest_rate")),
    loan_date: str(form.get("loan_date")), due_date: str(form.get("due_date")), is_opening: opening,
    opening_outstanding: opening ? num(form.get("opening_outstanding")) : null,
    disburse_from_asset_id: opening ? null : str(form.get("disburse_from_asset_id")),
    disburse_date: opening ? null : str(form.get("disburse_date")),
    owners: ownersFromForm(form), notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/financial/loans");
  redirect(`/financial/loans/${data}`);
}

export async function receivePayment(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const { error } = await supabase.rpc("receive_loan_payment", {
    p_loan_asset_id: id, p_bank_asset_id: str(form.get("bank_asset_id")), p_date: str(form.get("date")),
    p_principal: num(form.get("principal")) ?? 0, p_interest: num(form.get("interest")) ?? 0,
    p_interest_tax: num(form.get("interest_tax")), p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done(id, "บันทึกรับชำระแล้ว");
}

export async function disburseMore(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่จำนวนเงิน" };
  const bank = str(form.get("bank_asset_id"));
  const { data: acc } = await supabase.from("assets").select("currency").eq("id", bank ?? "").maybeSingle();
  const { error } = await supabase.from("cash_movements").insert({
    movement_date: str(form.get("date")), movement_type: "LOAN_DISBURSEMENT", from_asset_id: bank, to_asset_id: id,
    amount, currency: acc?.currency ?? "THB", description: str(form.get("description")) ?? "ให้กู้เพิ่ม",
  });
  if (error) return { error: friendlyError(error.message) };
  return done(id, "บันทึกการให้กู้เพิ่มแล้ว");
}

/** ตั้ง / แทนที่ตารางผ่อนทั้งชุด (ADMIN / EDITOR · ฐานข้อมูลตรวจซ้ำ) */
export async function saveSchedule(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  let lines: unknown;
  try { lines = JSON.parse(String(form.get("lines") ?? "[]")); } catch { return { error: "อ่านตารางผ่อนไม่ได้" }; }
  if (!Array.isArray(lines) || lines.length === 0) return { error: "ตารางผ่อนต้องมีอย่างน้อย 1 งวด" };
  const { data, error } = await supabase.rpc("set_loan_schedule", { p_loan_asset_id: id, p_lines: lines });
  if (error) return { error: friendlyError(error.message) };
  return done(id, `บันทึกตารางผ่อน ${data} งวดแล้ว`);
}

/** คำนวณงวดที่เหลือใหม่: เก็บงวดที่รับแล้ว · ตัดงวดรับบางส่วน · แทนงวดที่ยังไม่ได้รับด้วยตารางใหม่ (ADMIN / EDITOR) */
export async function restructureSchedule(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  let lines: unknown;
  try { lines = JSON.parse(String(form.get("lines") ?? "[]")); } catch { return { error: "อ่านตารางใหม่ไม่ได้" }; }
  if (!Array.isArray(lines) || lines.length === 0) return { error: "ตารางใหม่ต้องมีอย่างน้อย 1 งวด" };
  const { data, error } = await supabase.rpc("restructure_loan_schedule", {
    p_loan_asset_id: id, p_lines: lines, p_note: str(form.get("note")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done(id, `ปรับตารางแล้ว · งวดใหม่ ${data} งวด`);
}

/** แก้รายละเอียดเงินให้กู้: ชื่อรายการ (assets.name) + ผู้กู้ / เบอร์ติดต่อ / เลขที่สัญญา / วัตถุประสงค์ / ดอกเบี้ย / ครบกำหนด / หมายเหตุ (loan_details) · RLS คุมสิทธิ์ */
export async function updateLoanInfo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const name = str(form.get("name"));
  if (!name) return { error: "กรุณาใส่ชื่อรายการ" };
  if (!str(form.get("borrower_name"))) return { error: "กรุณาใส่ชื่อผู้กู้" };
  const { data: a, error: e1 } = await supabase.from("assets").update({ name }).eq("id", assetId).select("id");
  if (e1) return { error: friendlyError(e1.message) };
  if (!a?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  const { error: e2 } = await supabase.from("loan_details").update({
    borrower_name: str(form.get("borrower_name")),
    interest_rate: num(form.get("interest_rate")),
    due_date: str(form.get("due_date")),
    notes: str(form.get("notes")),
    borrower_phone: str(form.get("borrower_phone")),
    contract_no: str(form.get("contract_no")),
    purpose: str(form.get("purpose")),
  }).eq("asset_id", assetId);
  if (e2) return { error: friendlyError(e2.message) };
  return done(assetId, "บันทึกรายละเอียดแล้ว");
}
