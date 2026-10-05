"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, strOrNull as str } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

function done(msg: string, extra: string[] = []): ActionState {
  revalidatePath("/income-expenses");
  revalidatePath("/financial/cash", "layout");
  extra.forEach((p) => revalidatePath(p));
  return { ok: msg };
}
const bad = (v: number | null) => v === null || Number.isNaN(v) || v <= 0;

// ------------------------------------------------------------------ รายได้
export async function addIncome(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const amount = num(form.get("amount"));
  if (bad(amount)) return { error: "กรุณาใส่ยอดรายได้ (ก่อนหักภาษี)" };
  const tax = num(form.get("tax"));
  if (tax !== null && (Number.isNaN(tax) || tax < 0 || tax > (amount as number))) return { error: "ภาษีต้องอยู่ระหว่าง 0 ถึงยอดรายได้" };
  const toAsset = str(form.get("received_to_asset_id"));
  let currency = str(form.get("currency")) ?? "THB";
  if (toAsset) {
    const { data: acc } = await supabase.from("assets").select("currency").eq("id", toAsset).maybeSingle();
    if (acc?.currency) currency = acc.currency;
  }
  const leaseId = str(form.get("lease_id"));
  const templateId = str(form.get("recurring_template_id"));
  const { error } = await supabase.from("income_transactions").insert({
    income_type: leaseId ? "RENT" : (str(form.get("income_type")) ?? "OTHER"),
    amount, tax, currency, date: str(form.get("date")), received_to_asset_id: toAsset,
    person_id: leaseId ? null : str(form.get("person_id")),
    lease_id: leaseId, recurring_template_id: templateId,
    income_period: leaseId || templateId ? str(form.get("income_period")) : null,
    notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done("บันทึกรายได้แล้ว", ["/property"]);
}

export async function dismissExpected(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const reason = str(form.get("reason"));
  if (!reason) return { error: "กรุณาระบุเหตุผล" };
  const { error } = await supabase.from("expected_income_dismissals").insert({
    source_type: String(form.get("source_type")), source_id: String(form.get("source_id")),
    income_period: String(form.get("income_period")), reason,
  });
  if (error) return { error: friendlyError(error.message) };
  return done("บันทึกว่าเดือนนี้ไม่ได้รับแล้ว");
}

export async function addTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const amount = num(form.get("expected_amount"));
  if (bad(amount)) return { error: "กรุณาใส่ยอดที่ได้รับตามปกติ" };
  const { data: fam } = await supabase.from("families").select("id").maybeSingle();
  if (!fam) return { error: "ไม่พบข้อมูลครอบครัว" };
  const toAsset = str(form.get("receive_to_asset_id"));
  let currency = str(form.get("currency")) ?? "THB";
  if (toAsset) {
    const { data: acc } = await supabase.from("assets").select("currency").eq("id", toAsset).maybeSingle();
    if (acc?.currency) currency = acc.currency;
  }
  const { error } = await supabase.from("recurring_income_templates").insert({
    family_id: fam.id, name: str(form.get("name")), income_type: str(form.get("income_type")) ?? "SALARY",
    person_id: str(form.get("person_id")), expected_amount: amount, currency,
    frequency: str(form.get("frequency")) ?? "MONTHLY", due_day: num(form.get("due_day")),
    receive_to_asset_id: toAsset, start_date: str(form.get("start_date")), end_date: str(form.get("end_date")),
    notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done("เพิ่มรายได้ประจำแล้ว");
}

export async function toggleTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("recurring_income_templates")
    .update({ active: form.get("active") === "true" }).eq("id", String(form.get("id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  return done("บันทึกแล้ว");
}

// ------------------------------------------------------------------ ค่าใช้จ่าย
export async function addExpense(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const amount = num(form.get("amount"));
  if (bad(amount)) return { error: "กรุณาใส่จำนวนเงิน" };
  const via = String(form.get("pay_via") ?? "bank");
  const reimb = form.get("is_reimbursable") === "on";
  const { error } = await supabase.rpc("add_expense", { p: {
    date: str(form.get("date")), description: str(form.get("description")), amount,
    currency: str(form.get("currency")), expense_category: str(form.get("expense_category")),
    paid_from_asset_id: via === "bank" ? str(form.get("bank_asset_id")) : null,
    paid_from_credit_card_id: via === "card" ? str(form.get("card_id")) : null,
    person_id: via === "cash" ? str(form.get("person_id")) : null,
    is_reimbursable: reimb, expected_reimbursement_amount: reimb ? num(form.get("expected_reimbursement_amount")) : null,
    notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  return done("บันทึกค่าใช้จ่ายแล้ว");
}

export async function setMonthStatus(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_expense_month_status", {
    p_month: String(form.get("month")), p_status: String(form.get("status")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done("บันทึกสถานะแล้ว");
}

export async function addReimbursement(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const amount = num(form.get("amount"));
  if (bad(amount)) return { error: "กรุณาใส่ยอดเงินคืน" };
  const via = String(form.get("to_via") ?? "bank");
  const { error } = await supabase.rpc("record_reimbursement", {
    p_expense_item_id: String(form.get("expense_item_id")), p_received_date: str(form.get("received_date")),
    p_amount: amount, p_received_to_asset_id: via === "bank" ? str(form.get("bank_asset_id")) : null,
    p_received_to_credit_card_id: via === "card" ? str(form.get("card_id")) : null, p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done("บันทึกเงินคืนแล้ว");
}

// ------------------------------------------------------------------ โอน / จ่ายบัตร / จ่ายหนี้ / เงินเข้าออกอื่น
export async function addMovement(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const type = String(form.get("movement_type"));
  const amount = num(form.get("amount"));
  if (bad(amount)) return { error: "กรุณาใส่จำนวนเงิน" };
  const date = str(form.get("date"));
  const fromBank = str(form.get("from_asset_id"));
  const toBank = str(form.get("to_asset_id"));
  const isIn = type === "OTHER_IN";
  const mainBank = isIn ? toBank : fromBank;
  if (!mainBank) return { error: isIn ? "กรุณาเลือกบัญชีที่รับเงิน" : "กรุณาเลือกบัญชีที่จ่าย" };
  const { data: acc } = await supabase.from("assets").select("currency").eq("id", mainBank).maybeSingle();
  const currency = acc?.currency ?? "THB";
  const fee = ["TRANSFER", "FX_EXCHANGE"].includes(type) ? num(form.get("fee")) : null;
  const row: Record<string, unknown> = {
    movement_date: date, movement_type: type, amount, currency,
    from_asset_id: isIn ? null : fromBank,
    to_asset_id: ["TRANSFER", "FX_EXCHANGE", "OTHER_IN"].includes(type) ? toBank : null,
    to_credit_card_id: type === "CARD_PAYMENT" ? str(form.get("card_id")) : null,
    to_liability_id: type === "LIABILITY_PAYMENT" ? str(form.get("liability_id")) : null,
    fee: fee && fee > 0 ? fee : null, fee_currency: fee && fee > 0 ? currency : null,
    description: str(form.get("description")),
    metadata: { fee_as_expense: form.get("fee_as_expense") === "on", via: "income_expenses" },
  };
  if (type === "FX_EXCHANGE") {
    const counter = num(form.get("counter_amount"));
    if (bad(counter)) return { error: "กรุณาใส่ยอดที่ได้รับในบัญชีปลายทาง" };
    const { data: to } = await supabase.from("assets").select("currency").eq("id", toBank ?? "").maybeSingle();
    row.counter_amount = counter; row.counter_currency = to?.currency;
  }
  const { error } = await supabase.from("cash_movements").insert(row);
  if (error) return { error: friendlyError(error.message) };

  // จ่ายแล้วอัปเดตยอดทันที (ไม่บังคับ)
  const newBal = num(form.get("new_balance"));
  if (type === "CARD_PAYMENT" && form.get("update_balance") === "on" && newBal !== null && !Number.isNaN(newBal)) {
    const { error: e2 } = await supabase.from("credit_cards").update({ outstanding_balance: newBal, balance_date: date })
      .eq("id", String(form.get("card_id")));
    if (e2) return { error: `บันทึกการจ่ายแล้ว แต่อัปเดตยอดบัตรไม่สำเร็จ: ${friendlyError(e2.message)}` };
  }
  if (type === "LIABILITY_PAYMENT" && form.get("update_balance") === "on" && newBal !== null && !Number.isNaN(newBal)) {
    const { error: e2 } = await supabase.from("liability_valuations").insert({
      liability_id: String(form.get("liability_id")), valuation_date: date, balance: newBal, source: "USER",
      notes: "อัปเดตหลังจ่ายหนี้",
    });
    if (e2) return { error: `บันทึกการจ่ายแล้ว แต่อัปเดตยอดหนี้ไม่สำเร็จ: ${friendlyError(e2.message)}` };
  }
  return done("บันทึกรายการแล้ว", ["/liabilities", "/family/cards"]);
}
