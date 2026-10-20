"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str } from "@/lib/format";

/** ยอดตาม Statement ต่ำกว่าที่คำนวณ → ถามต่อว่าเป็นการจ่ายหรือไม่ (n = เลขครั้ง ให้กล่องถามแสดงใหม่ทุกครั้งที่บันทึก) */
export type Drop = { kind: "CARD" | "LIABILITY"; id: string; date: string; amount: number; n: number };
export type ActionState = { error?: string; ok?: string; drop?: Drop };

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
    p_source: str(form.get("source")) ?? "STATEMENT", p_notes: str(form.get("notes")), p_settle: true,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/liabilities/${id}`);
  revalidatePath("/liabilities");
  revalidatePath("/income-expenses");
  const r = data as { difference: number | null; lump: number } | null;
  return { ok: lumpMessage("บันทึกยอดคงค้างแล้ว", r, "ยอดหนี้"), drop: dropOf("LIABILITY", id, str(form.get("valuation_date")), r) };
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
function revalidateCards(cardId?: string | null) {
  revalidatePath("/liabilities");
  if (cardId) revalidatePath(`/liabilities/cards/${cardId}`);
  revalidatePath("/family/memberships");
}

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
  revalidateCards();
  return { ok: "เพิ่มบัตรแล้ว" };
}

export async function updateCardBalance(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const balance = num(form.get("outstanding_balance"));
  if (balance === null || Number.isNaN(balance) || balance < 0) return { error: "กรุณาใส่ยอดค้างเป็นตัวเลข" };
  const cardId = String(form.get("card_id"));
  // อัปเดตยอด + (ถ้าเลือก) ส่วนที่สูงกว่ารายการที่บันทึก → ค่าใช้จ่ายก้อน "รอแยกรายละเอียด"
  const { data, error } = await supabase.rpc("update_card_statement", {
    p_card_id: cardId, p_date: str(form.get("balance_date")), p_balance: balance, p_settle: true,
    p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidateCards(cardId);
  revalidatePath("/income-expenses");
  const r = data as { difference: number | null; lump: number; history_only?: boolean; merged?: boolean } | null;
  if (r?.history_only) return { ok: "บันทึกเป็นประวัติยอดแล้ว (วันที่ก่อนยอดล่าสุด · ยอดปัจจุบันไม่เปลี่ยน)" };
  return { ok: lumpMessage(r?.merged ? "อัปเดตยอดบัตรแล้ว (ปรับก้อนรอแยกเดิมของเดือนนี้)" : "อัปเดตยอดบัตรแล้ว", r, "ยอดบัตร"),
    drop: dropOf("CARD", cardId, str(form.get("balance_date")), r) };
}

function dropOf(kind: Drop["kind"], id: string, date: string | null, r: { lump: number } | null): Drop | undefined {
  const lump = Number(r?.lump ?? 0);
  return lump < -0.005 && date ? { kind, id, date, amount: Math.round(-lump * 100) / 100, n: Date.now() } : undefined;
}

/** "ลงเป็นการจ่าย": รายได้ก้อนของยอดที่ลดลง → เงินออกจากบัญชี (จ่ายบัตร / จ่ายเงินต้น) วันเดียวกับยอด */
export async function payFromDrop(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const kind = String(form.get("kind")), id = String(form.get("id"));
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่ยอดที่จ่าย" };
  if (!str(form.get("bank_asset_id"))) return { error: "กรุณาเลือกบัญชีที่จ่าย" };
  const { data, error } = await supabase.rpc("pay_from_statement_drop", { p: {
    kind, id, bank_asset_id: str(form.get("bank_asset_id")), date: str(form.get("date")), amount } });
  if (error) return { error: friendlyError(error.message) };
  if (kind === "CARD") revalidateCards(id); else { revalidatePath(`/liabilities/${id}`); revalidatePath("/liabilities"); }
  revalidatePath("/income-expenses");
  revalidatePath("/financial/cash", "layout");
  const left = Number((data as { lump_left?: number } | null)?.lump_left ?? 0);
  const f = (v: number) => v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { ok: left > 0.005
    ? `บันทึกการจ่ายแล้ว · เหลือรายได้ก้อนรอแยก ${f(left)}`
    : "บันทึกการจ่ายแล้ว · รายได้ก้อนรอแยกของยอดนี้หมดแล้ว" };
}

/** ข้อความหลังอัปเดตยอดจาก Statement: บอกส่วนต่าง / ก้อนรอแยก */
function lumpMessage(base: string, r: { difference: number | null; lump: number } | null, what: string) {
  const d = Number(r?.difference ?? 0), lump = Number(r?.lump ?? 0);
  const f = (v: number) => v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (lump > 0) return `${base} · ลงค่าใช้จ่ายก้อนรอแยกรายละเอียด ${f(lump)} (แยกได้ที่ Income & Expenses)`;
  if (lump < 0) return what === "ยอดบัตร"
    ? `${base} · ลงรายได้ก้อนรอแยกรายละเอียด ${f(-lump)} เข้าบัตร (เงินคืน / เครดิต · แยกได้ที่ Income & Expenses)`
    : `${base} · ยอดหนี้ลดเกินที่คำนวณ → ลงรายได้ก้อนรอแยกรายละเอียด ${f(-lump)} (ส่วนลด / ลดหนี้ · แยกได้ที่ Income & Expenses)`;
  if (r?.difference == null || Math.abs(d) < 0.005) return base;
  const card = what === "ยอดบัตร";
  return d > 0 ? `${base} · ${what}สูงกว่ารายการที่บันทึก ${f(d)}`
    : card ? `${base} · ${what}ต่ำกว่าที่บันทึก ${f(-d)} (อาจมีเงินคืน / เครดิตที่ยังไม่ได้บันทึก)`
    : `${base} · ${what}ต่ำกว่าที่คำนวณ ${f(-d)} (อาจมีการจ่าย / เงินคืนที่ยังไม่ได้บันทึก)`;
}

export async function updateCardStatus(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("credit_cards")
    .update({ status: String(form.get("status")) }).eq("id", String(form.get("card_id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขบัตรนี้" };
  revalidateCards(String(form.get("card_id")));
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
  // ค่า "h:<id>" = บัญชีเงินฝากในพอร์ต · อื่น ๆ = บัญชีธนาคาร · ผูกได้ทางเดียว
  const sel = str(form.get("autopay_asset_id"));
  const hold = sel?.startsWith("h:") ? sel.slice(2) : null;
  const bank = sel && !hold ? sel : null;
  const mode = sel ? (str(form.get("autopay_mode")) ?? "FULL") : null;
  const { data, error } = await supabase.from("credit_cards")
    .update({ autopay_asset_id: bank, autopay_cash_holding_id: hold, autopay_mode: mode }).eq("id", String(form.get("card_id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขบัตรนี้" };
  revalidateCards(String(form.get("card_id")));
  revalidatePath("/income-expenses");
  return { ok: sel ? "ตั้งค่าตัดบัญชีอัตโนมัติแล้ว" : "ปิดตัดบัญชีอัตโนมัติแล้ว" };
}

/** ยืนยันว่าตัดบัญชีอัตโนมัติแล้ว (หรือจ่ายบัตรเอง) → บันทึกจ่ายบัตร (ยอดค้างบัตรลดเองจากการคำนวณ) */
export async function confirmCardPayment(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่ยอดที่ตัดจริง" };
  const { error } = await supabase.rpc("pay_credit_card", { p: {
    card_id: str(form.get("card_id")), bank_asset_id: str(form.get("bank_asset_id")), cash_holding_id: str(form.get("cash_holding_id")),
    date: str(form.get("date")), amount, reduce_balance: false, autopay: form.get("autopay") === "true",
  } });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/income-expenses");
  revalidateCards(str(form.get("card_id")));
  revalidatePath("/financial/cash", "layout");
  revalidatePath("/liabilities");
  revalidatePath("/");
  return { ok: "บันทึกการตัดบัญชีแล้ว" };
}

/** แก้ข้อมูลบัตรเครดิต (หน้าต่าง "แก้ไขข้อมูล") · ไม่กระทบยอดค้าง */
export async function updateCardInfo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("card_id"));
  const issuer = str(form.get("issuer"));
  if (!issuer) return { error: "กรุณาใส่ผู้ออกบัตร" };
  const { data, error } = await supabase.from("credit_cards").update({
    issuer, card_name: str(form.get("card_name")), card_last4: str(form.get("card_last4")),
    credit_limit: num(form.get("credit_limit")), statement_day: num(form.get("statement_day")), due_day: num(form.get("due_day")),
    annual_fee: num(form.get("annual_fee")), expiry_date: str(form.get("expiry_date")), notes: str(form.get("notes")),
  }).eq("id", id).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  revalidatePath("/liabilities");
  revalidatePath(`/liabilities/cards/${id}`);
  return { ok: "บันทึกข้อมูลแล้ว" };
}
