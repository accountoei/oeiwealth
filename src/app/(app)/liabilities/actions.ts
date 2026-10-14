"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

export async function createLiability(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const balance = num(form.get("balance"));
  if (balance === null || Number.isNaN(balance) || balance < 0) return { error: "กรุณาใส่ยอดคงค้างเป็นตัวเลข" };
  const { data, error } = await supabase.rpc("create_liability", {
    p_liability_type: str(form.get("liability_type")),
    p_name: str(form.get("name")),
    p_currency: str(form.get("currency")) ?? "THB",
    p_balance: balance,
    p_balance_date: str(form.get("balance_date")),
    p_is_opening: form.get("is_opening") === "on",
    p_lender: str(form.get("lender")),
    p_original_amount: num(form.get("original_amount")),
    p_interest_rate: num(form.get("interest_rate")),
    p_monthly_payment: num(form.get("monthly_payment")),
    p_payment_due_day: num(form.get("payment_due_day")),
    p_start_date: str(form.get("start_date")),
    p_due_date: str(form.get("due_date")),
    p_linked_asset_id: str(form.get("linked_asset_id")),
    p_owners: ownersFromForm(form),
    p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/liabilities");
  redirect(`/liabilities/${data}`);
}

export async function addLiabilityBalance(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("liability_id"));
  const balance = num(form.get("balance"));
  if (balance === null || Number.isNaN(balance) || balance < 0) return { error: "กรุณาใส่ยอดคงค้างเป็นตัวเลข" };
  const { data, error } = await supabase.rpc("update_liability_statement", {
    p_liability_id: id, p_date: str(form.get("valuation_date")), p_balance: balance,
    p_source: str(form.get("source")) ?? "STATEMENT", p_notes: str(form.get("notes")), p_settle: form.get("settle") === "on",
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/liabilities/${id}`);
  revalidatePath("/liabilities");
  revalidatePath("/income-expenses");
  return { ok: lumpMessage("บันทึกยอดคงค้างแล้ว", data as { difference: number | null; lump: number } | null, "ยอดหนี้") };
}

export async function updateLiabilityInfo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("liability_id"));
  const { data, error } = await supabase.from("liabilities").update({
    name: str(form.get("name")), lender: str(form.get("lender")),
    interest_rate: num(form.get("interest_rate")), monthly_payment: num(form.get("monthly_payment")),
    payment_due_day: num(form.get("payment_due_day")), due_date: str(form.get("due_date")),
    status: str(form.get("status")) ?? "ACTIVE", notes: str(form.get("notes")),
  }).eq("id", id).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  revalidatePath(`/liabilities/${id}`);
  revalidatePath("/liabilities");
  return { ok: "บันทึกข้อมูลแล้ว" };
}

// ---------------------------------------------------------------- Credit cards
export async function createCard(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const last4 = str(form.get("card_last4"));
  if (last4 && !/^\d{4}$/.test(last4)) return { error: "เลขบัตร 4 ตัวท้ายต้องเป็นตัวเลข 4 หลัก (ห้ามใส่เลขบัตรเต็ม)" };
  const outstanding = num(form.get("outstanding_balance")) ?? 0;
  const { error } = await supabase.from("credit_cards").insert({
    person_id: str(form.get("person_id")), issuer: str(form.get("issuer")), card_name: str(form.get("card_name")),
    card_last4: last4, credit_limit: num(form.get("credit_limit")), currency: str(form.get("currency")) ?? "THB",
    statement_day: num(form.get("statement_day")), due_day: num(form.get("due_day")),
    annual_fee: num(form.get("annual_fee")), annual_fee_currency: num(form.get("annual_fee")) ? (str(form.get("currency")) ?? "THB") : null,
    expiry_date: str(form.get("expiry_date")),
    outstanding_balance: outstanding, balance_date: str(form.get("balance_date")), notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/family/cards");
  revalidatePath("/liabilities");
  return { ok: "เพิ่มบัตรแล้ว" };
}

export async function updateCardBalance(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const balance = num(form.get("outstanding_balance"));
  if (balance === null || Number.isNaN(balance) || balance < 0) return { error: "กรุณาใส่ยอดค้างเป็นตัวเลข" };
  const cardId = String(form.get("card_id"));
  // อัปเดตยอด + (ถ้าเลือก) ส่วนที่สูงกว่ารายการที่บันทึก → ค่าใช้จ่ายก้อน "รอแยกรายละเอียด"
  const { data, error } = await supabase.rpc("update_card_statement", {
    p_card_id: cardId, p_date: str(form.get("balance_date")), p_balance: balance, p_settle: form.get("settle") === "on",
  });
  if (error) return { error: friendlyError(error.message) };
  const notes = str(form.get("notes"));
  if (notes) await supabase.from("credit_cards").update({ notes }).eq("id", cardId);
  revalidatePath("/family/cards");
  revalidatePath("/liabilities");
  revalidatePath("/income-expenses");
  return { ok: lumpMessage("อัปเดตยอดบัตรแล้ว", data as { difference: number | null; lump: number } | null, "ยอดบัตร") };
}

/** ข้อความหลังอัปเดตยอดจาก Statement: บอกส่วนต่าง / ก้อนรอแยก */
function lumpMessage(base: string, r: { difference: number | null; lump: number } | null, what: string) {
  const d = Number(r?.difference ?? 0), lump = Number(r?.lump ?? 0);
  const f = (v: number) => v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (lump > 0) return `${base} · ลงค่าใช้จ่ายก้อนรอแยกรายละเอียด ${f(lump)} (แยกได้ที่ Income & Expenses)`;
  if (r?.difference == null || Math.abs(d) < 0.005) return base;
  return d > 0 ? `${base} · ${what}สูงกว่ารายการที่บันทึก ${f(d)} (ติ๊ก "ลงส่วนต่างเป็นค่าใช้จ่ายก้อน" ถ้าต้องการ)`
    : `${base} · ${what}ต่ำกว่าที่คำนวณ ${f(-d)} (อาจมีการจ่าย / เงินคืนที่ยังไม่ได้บันทึก)`;
}

export async function updateCardStatus(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("credit_cards")
    .update({ status: String(form.get("status")) }).eq("id", String(form.get("card_id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขบัตรนี้" };
  revalidatePath("/family/cards");
  return { ok: "เปลี่ยนสถานะแล้ว" };
}

/** จ่ายค่างวด: เงินต้นลดยอดหนี้ · ดอกเบี้ยเป็นค่าใช้จ่าย "ดอกเบี้ยจ่าย" */
export async function payLiability(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("liability_id"));
  const { error } = await supabase.rpc("pay_liability", { p: {
    liability_id: id, bank_asset_id: str(form.get("bank_asset_id")), date: str(form.get("date")),
    principal: num(form.get("principal")) ?? 0, interest: num(form.get("interest")) ?? 0, notes: str(form.get("notes")),
    statement_balance: form.get("update_balance") === "on" ? num(form.get("new_balance")) : null,
  } });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/liabilities/${id}`);
  revalidatePath("/liabilities");
  revalidatePath("/income-expenses");
  revalidatePath("/financial/cash", "layout");
  revalidatePath("/");
  return { ok: "บันทึกการจ่ายแล้ว" };
}

/** ตั้งค่าบัตรตัดบัญชีอัตโนมัติ (บัญชีที่ตัด + เต็มจำนวน / ขั้นต่ำ) · ไม่เลือกบัญชี = ปิด */
export async function setCardAutopay(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const bank = str(form.get("autopay_asset_id"));
  const mode = bank ? (str(form.get("autopay_mode")) ?? "FULL") : null;
  const { data, error } = await supabase.from("credit_cards")
    .update({ autopay_asset_id: bank, autopay_mode: mode }).eq("id", String(form.get("card_id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขบัตรนี้" };
  revalidatePath("/family/cards");
  revalidatePath("/income-expenses");
  return { ok: bank ? "ตั้งค่าตัดบัญชีอัตโนมัติแล้ว" : "ปิดตัดบัญชีอัตโนมัติแล้ว" };
}

/** ยืนยันว่าตัดบัญชีอัตโนมัติแล้ว (หรือจ่ายบัตรเอง) → บันทึกจ่ายบัตร + หักยอดบัตร */
export async function confirmCardPayment(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่ยอดที่ตัดจริง" };
  const { error } = await supabase.rpc("pay_credit_card", { p: {
    card_id: str(form.get("card_id")), bank_asset_id: str(form.get("bank_asset_id")), date: str(form.get("date")),
    amount, reduce_balance: form.get("reduce_balance") === "on", autopay: form.get("autopay") === "true",
  } });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/income-expenses");
  revalidatePath("/family/cards");
  revalidatePath("/financial/cash", "layout");
  revalidatePath("/liabilities");
  revalidatePath("/");
  return { ok: "บันทึกการตัดบัญชีแล้ว" };
}
