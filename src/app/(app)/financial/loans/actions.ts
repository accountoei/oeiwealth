"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str, thDate, type FormState } from "@/lib/format";
import { BAD_ROWS_ERROR, amountOrNull, isValidTax, notSaved, readRows, TAX_ERROR } from "@/lib/batch-entry";

/** rateChanged = แก้อัตราดอกเบี้ย → ถามต่อว่าจะคำนวณงวดที่เหลือใหม่ไหม */
export type ActionState = FormState & { rateChanged?: boolean };

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

/** แท็บ "บันทึกรับชำระคืนเงินกู้": รับชำระหลายสัญญาในคำสั่งเดียว (ผิดแถวเดียว = ไม่บันทึกเลย) */
export async function batchReceiveLoans(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const date = str(form.get("date"));
  const rows = readRows<{ loan_asset_id: string; label: string; bank_asset_id: string; principal?: string; interest?: string; interest_tax?: string }>(form);
  if (!rows) return { error: BAD_ROWS_ERROR };
  if (!date) return { error: "กรุณาเลือกวันที่ได้รับ" };
  if (!rows.length) return { error: "กรุณากรอกยอดอย่างน้อย 1 สัญญา" };
  const bad = (v: number | null) => v != null && (Number.isNaN(v) || v < 0);
  const clean = rows.map((r) => ({ loan_asset_id: r.loan_asset_id, label: r.label, bank_asset_id: r.bank_asset_id || null, date,
    principal: amountOrNull(r.principal), interest: amountOrNull(r.interest), interest_tax: amountOrNull(r.interest_tax) }));
  for (const r of clean) {
    if (bad(r.principal) || bad(r.interest) || (r.principal ?? 0) + (r.interest ?? 0) <= 0) return { error: `${r.label} · ยอดที่รับต้องเป็นตัวเลขมากกว่า 0` };
    if (!isValidTax(r.interest_tax)) return { error: `${r.label} · ${TAX_ERROR}` };
    if (!r.bank_asset_id) return { error: `${r.label} · กรุณาเลือกบัญชีที่รับเงิน` };
  }
  const { data, error } = await supabase.rpc("batch_receive_loan_payments", { p_rows: clean });
  if (error) return { error: notSaved("ทุกสัญญา", friendlyError(error.message)) };
  clean.forEach((r) => revalidatePath(`/financial/loans/${r.loan_asset_id}`));
  return done(clean[0].loan_asset_id, `บันทึกรับชำระแล้ว ${data} สัญญา`);
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
  // วันครบกำหนดสัญญาต้องไม่ก่อนงวดสุดท้ายในตารางผ่อน (ตั้ง / ปรับตาราง ระบบตั้งให้เท่างวดสุดท้ายเอง)
  const due = str(form.get("due_date"));
  const { data: last } = await supabase.from("loan_schedule_lines").select("due_date").eq("loan_asset_id", assetId).is("deleted_at", null)
    .order("due_date", { ascending: false }).limit(1).maybeSingle();
  if (last && (!due || due < last.due_date)) {
    return { error: `วันครบกำหนดสัญญาต้องไม่ก่อนงวดสุดท้ายในตารางผ่อน (${thDate(last.due_date)})` };
  }
  const { data: cur } = await supabase.from("loan_details").select("interest_rate,outstanding_principal").eq("asset_id", assetId).is("deleted_at", null).maybeSingle();
  const rate = num(form.get("interest_rate"));
  // มีความเสี่ยง: กรอก "มูลค่าคาดว่าจะได้รับคืน" → เก็บเป็นส่วนที่มีความเสี่ยง = เงินต้นคงเหลือ − มูลค่าคาดว่าได้คืน (แสดงอย่างเดียว)
  let risk: { at_risk_amount: number | null; risk_assessed_date: string | null; risk_note: string | null } | null = null;
  if (form.has("expected_recoverable")) {
    const expected = num(form.get("expected_recoverable"));
    const out = Number(cur?.outstanding_principal ?? 0);
    if (expected != null && (Number.isNaN(expected) || expected < 0)) return { error: "มูลค่าคาดว่าจะได้รับคืนต้องเป็นตัวเลข (ไม่ติดลบ)" };
    if (expected != null && expected > out + 0.005) return { error: "มูลค่าคาดว่าจะได้รับคืนต้องไม่เกินเงินต้นคงเหลือ" };
    risk = expected == null ? { at_risk_amount: null, risk_assessed_date: null, risk_note: str(form.get("risk_note")) }
      : { at_risk_amount: Math.round((out - expected) * 100) / 100, risk_assessed_date: str(form.get("risk_assessed_date")), risk_note: str(form.get("risk_note")) };
  }
  const { data: a, error: e1 } = await supabase.from("assets").update({ name }).eq("id", assetId).select("id");
  if (e1) return { error: friendlyError(e1.message) };
  if (!a?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  const { error: e2 } = await supabase.from("loan_details").update({
    ...(risk ?? {}),
    borrower_name: str(form.get("borrower_name")),
    interest_rate: rate,
    due_date: due,
    notes: str(form.get("notes")),
    borrower_phone: str(form.get("borrower_phone")),
    contract_no: str(form.get("contract_no")),
    purpose: str(form.get("purpose")),
  }).eq("asset_id", assetId);
  if (e2) return { error: friendlyError(e2.message) };
  return { ...done(assetId, "บันทึกรายละเอียดแล้ว"), rateChanged: (cur?.interest_rate == null ? null : Number(cur.interest_rate)) !== rate };
}

/** ปิดสัญญา (หลังรับเงินต้นครบ) · ฐานข้อมูลตรวจซ้ำว่าเงินต้นคงเหลือ = 0 */
export async function closeLoan(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const { data, error } = await supabase.from("loan_details").update({ status: "CLOSED" }).eq("asset_id", assetId).is("deleted_at", null).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  return done(assetId, "ปิดสัญญาแล้ว");
}
