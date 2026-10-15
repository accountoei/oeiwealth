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
  const itype = leaseId ? "RENT" : (str(form.get("income_type")) ?? "OTHER");
  const { error } = await supabase.from("income_transactions").insert({
    income_type: itype, income_subtype: itype === "OTHER" ? str(form.get("income_subtype")) : null,
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
    person_id: str(form.get("person_id")),
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
    p_insurance_claim_id: str(form.get("insurance_claim_id")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/insurance", "layout");
  return done("บันทึกเงินคืนแล้ว");
}

// ------------------------------------------------------------------ โอน / จ่ายบัตร / จ่ายหนี้ / เงินเข้าออกอื่น
export async function addMovement(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const type = String(form.get("movement_type"));
  // จ่ายหนี้: แยกเงินต้น (ลดยอดหนี้) / ดอกเบี้ย (ค่าใช้จ่าย)
  if (type === "LIABILITY_PAYMENT") {
    const newBal = num(form.get("new_balance"));
    const { error } = await supabase.rpc("pay_liability", { p: {
      liability_id: str(form.get("liability_id")), bank_asset_id: str(form.get("from_asset_id")), date: str(form.get("date")),
      principal: num(form.get("principal")) ?? 0, interest: num(form.get("interest")) ?? 0, notes: str(form.get("description")),
      statement_balance: form.get("update_balance") === "on" ? newBal : null,
    } });
    if (error) return { error: friendlyError(error.message) };
    return done("บันทึกการจ่ายหนี้แล้ว", ["/liabilities"]);
  }
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
  return done("บันทึกรายการแล้ว", ["/liabilities"]);
}

/** แยกรายการ "รอแยกรายละเอียด" เป็นหลายบรรทัด (ยอดรวมไม่เกินก้อน · ส่วนที่เหลือยังรอแยก) — ทำได้แม้ปิดงวดแล้ว */
export async function splitPending(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  let lines: { description: string; amount: string; expense_category?: string; income_type?: string; person_id?: string }[] = [];
  try { lines = JSON.parse(String(form.get("lines") ?? "[]")); } catch { return { error: "ข้อมูลไม่ถูกต้อง" }; }
  const clean = lines.filter((l) => l.description?.trim() || l.amount?.trim())
    .map((l) => ({ ...l, amount: num(l.amount) }));
  if (!clean.length) return { error: "กรุณาใส่อย่างน้อย 1 บรรทัด" };
  if (clean.some((l) => !l.description?.trim() || l.amount === null || Number.isNaN(l.amount) || l.amount <= 0)) {
    return { error: "ทุกบรรทัดต้องมีรายละเอียดและจำนวนเงินมากกว่า 0" };
  }
  const { data, error } = await supabase.rpc("split_pending_item", {
    p_kind: String(form.get("kind")), p_id: String(form.get("id")), p_lines: clean,
  });
  if (error) return { error: friendlyError(error.message) };
  const left = Number(data ?? 0);
  return done(left > 0.005 ? `แยกแล้ว · ยังรอแยกอีก ${left.toLocaleString("th-TH", { minimumFractionDigits: 2 })}` : "แยกครบแล้ว", ["/liabilities"]);
}

/** แก้บัญชีที่รับ / จ่าย (+ ประเภทรายได้) ของรายการที่บันทึกเอง · ยอดบัญชี / บัตร / ก้อนรอแยก ปรับตามในฐานข้อมูล */
export async function changeAccount(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("change_entry_account", {
    p_kind: String(form.get("kind")), p_id: String(form.get("id")), p_account: String(form.get("account") ?? ""),
    p_income_type: str(form.get("income_type")),
  });
  if (error) return { error: friendlyError(error.message) };
  const warn = (data as { recon_warning?: boolean } | null)?.recon_warning;
  return done(warn ? "บันทึกแล้ว · บัญชีนี้กระทบยอดเดือนนี้ไปแล้ว ให้ตรวจที่หน้ากระทบยอด (Month Closing) อีกครั้ง" : "บันทึกแล้ว",
    ["/liabilities", "/month-closing", "/"]);
}

// ------------------------------------------------------------------ ค่าใช้จ่ายประจำทั่วไป
export async function addExpenseTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const amount = num(form.get("expected_amount"));
  if (amount === null || Number.isNaN(amount) || amount < 0) return { error: "กรุณาใส่ยอดที่จ่ายตามปกติ" };
  const category = str(form.get("expense_category"));
  if (!category) return { error: "กรุณาเลือกหมวด" };
  const { data: fam } = await supabase.from("families").select("id").maybeSingle();
  if (!fam) return { error: "ไม่พบข้อมูลครอบครัว" };
  const via = String(form.get("pay_via") ?? "BANK");
  const bank = via === "BANK" ? str(form.get("pay_from_asset_id")) : null;
  const card = via === "CARD" ? str(form.get("pay_from_credit_card_id")) : null;
  if (via === "CARD" && !card) return { error: "กรุณาเลือกบัตร" };
  let currency = str(form.get("currency")) ?? "THB";
  if (bank) {
    const { data: acc } = await supabase.from("assets").select("currency").eq("id", bank).maybeSingle();
    if (acc?.currency) currency = acc.currency;
  }
  if (card) {
    const { data: c } = await supabase.from("credit_cards").select("currency").eq("id", card).maybeSingle();
    if (c?.currency) currency = c.currency;
  }
  const { error } = await supabase.from("recurring_expense_templates").insert({
    family_id: fam.id, name: str(form.get("name")), expense_category: category, person_id: str(form.get("person_id")),
    expected_amount: amount, currency, frequency: str(form.get("frequency")) ?? "MONTHLY", due_day: num(form.get("due_day")),
    pay_via: via, pay_from_asset_id: bank, pay_from_credit_card_id: card,
    start_date: str(form.get("start_date")), end_date: str(form.get("end_date")), notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done("เพิ่มค่าใช้จ่ายประจำแล้ว");
}

export async function toggleExpenseTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("recurring_expense_templates")
    .update({ active: form.get("active") === "true" }).eq("id", String(form.get("id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  return done("บันทึกแล้ว");
}

/** บันทึกจ่ายค่าใช้จ่ายประจำทั่วไป 1 งวด (ยอดจริง) */
export async function payRecurringExpense(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const amount = num(form.get("amount"));
  if (bad(amount)) return { error: "กรุณาใส่จำนวนเงิน" };
  const via = String(form.get("pay_via") ?? "bank");
  const { error } = await supabase.rpc("add_expense", { p: {
    date: str(form.get("date")), description: str(form.get("description")), amount,
    currency: str(form.get("currency")), expense_category: str(form.get("expense_category")),
    paid_from_asset_id: via === "bank" ? str(form.get("bank_asset_id")) : null,
    paid_from_credit_card_id: via === "card" ? str(form.get("card_id")) : null,
    person_id: str(form.get("person_id")),
    recurring_expense_id: str(form.get("template_id")), cost_period: str(form.get("cost_period")),
    notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  return done("บันทึกจ่ายแล้ว", ["/liabilities"]);
}

/** "เดือนนี้ไม่ได้จ่าย" — ค่าใช้จ่ายประจำทั่วไป (RECURRING) / ของทรัพย์สิน (PROPERTY) */
export async function dismissExpense(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const reason = str(form.get("reason"));
  if (!reason) return { error: "กรุณาระบุเหตุผล" };
  const { error } = await supabase.from("expected_expense_dismissals").insert({
    source_type: String(form.get("source_type")), source_id: String(form.get("source_id")),
    cost_period: String(form.get("cost_period")), reason,
  });
  if (error) return { error: error.code === "23505" ? "งวดนี้บันทึกไว้แล้ว" : friendlyError(error.message) };
  revalidatePath("/property", "layout");
  return done("บันทึกว่าเดือนนี้ไม่ได้จ่ายแล้ว");
}

export async function undoDismissExpense(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("expected_expense_dismissals")
    .update({ deleted_at: new Date().toISOString() }).eq("id", String(form.get("id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  revalidatePath("/property", "layout");
  return done("ยกเลิกแล้ว · กลับเป็นรอจ่าย");
}

// ------------------------------------------------------------------ ตั้งค่า: หมวดค่าใช้จ่าย / ประเภทย่อยรายได้อื่น
const SYS_CATS = ["BANK_FEE", "รอแยกรายละเอียด"];
function catDone(msg: string): ActionState {
  revalidatePath("/income-expenses");
  revalidatePath("/property", "layout");
  revalidatePath("/");
  return { ok: msg };
}

export async function addCategory(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const kind = String(form.get("kind"));
  const name = str(form.get("name"));
  if (!["EXPENSE", "INCOME_OTHER"].includes(kind)) return { error: "ข้อมูลไม่ถูกต้อง" };
  if (!name) return { error: "กรุณาใส่ชื่อ" };
  if (SYS_CATS.includes(name)) return { error: "ชื่อนี้ระบบใช้อยู่" };
  const { data: last } = await supabase.from("ie_categories").select("sort_order").eq("kind", kind).is("deleted_at", null)
    .order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("ie_categories").insert({ kind, name, sort_order: (last?.sort_order ?? 0) + 1 });
  if (error) return { error: error.message.includes("ie_categories_name_uq") || error.code === "23505" ? "มีชื่อนี้อยู่แล้ว" : friendlyError(error.message) };
  return catDone("เพิ่มแล้ว");
}

export async function renameCategory(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rename_ie_category", { p_id: String(form.get("id")), p_name: String(form.get("name") ?? "") });
  if (error) return { error: error.code === "23505" ? "มีชื่อนี้อยู่แล้ว" : friendlyError(error.message) };
  const n = Number(data ?? 0);
  return catDone(n > 0 ? `เปลี่ยนชื่อแล้ว · ปรับรายการเดิม ${n} รายการ` : "เปลี่ยนชื่อแล้ว");
}

export async function toggleCategory(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("ie_categories")
    .update({ active: form.get("active") === "true" }).eq("id", String(form.get("id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  return catDone("บันทึกแล้ว");
}

export async function moveCategory(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_ie_category", { p_id: String(form.get("id")), p_dir: Number(form.get("dir")) });
  if (error) return { error: friendlyError(error.message) };
  return catDone("เลื่อนลำดับแล้ว");
}
