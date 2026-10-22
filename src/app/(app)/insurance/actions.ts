"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str, type FormState } from "@/lib/format";
import { endpointFromForm, paidFromColumns } from "@/lib/money-endpoint";

export type ActionState = FormState;
/** ผลลงมูลค่าเวนคืนตามตารางในสัญญา (sync_insurance_cash_value) */
export type CvSync = { added: number; created: boolean; value?: number; date?: string; policy_year?: number };
export type PayState = ActionState & { cv?: CvSync };

function bens(form: FormData) {
  try { return JSON.parse(String(form.get("beneficiaries") ?? "[]")); } catch { return []; }
}

export async function createPolicy(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const hasCv = form.get("has_cash_value") === "on";
  const { data, error } = await supabase.rpc("create_insurance_policy", { p: {
    insurance_type: str(form.get("insurance_type")), person_id: str(form.get("person_id")), insured_asset_id: str(form.get("insured_asset_id")),
    insurer: str(form.get("insurer")), policy_no: str(form.get("policy_no")), start_date: str(form.get("start_date")),
    end_date: str(form.get("end_date")), insured_amount: num(form.get("insured_amount")), premium: num(form.get("premium")),
    currency: str(form.get("currency")), has_cash_value: hasCv, is_opening: form.get("is_opening") === "on",
    cash_value: hasCv ? num(form.get("cash_value")) : null, cash_value_date: hasCv ? str(form.get("cash_value_date")) : null,
    owners: ownersFromForm(form), beneficiaries: bens(form), notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  // ผู้จ่ายเบี้ย (ว่าง = ผู้เอาประกัน)
  const payer = str(form.get("payer_person_id"));
  if (payer && payer !== str(form.get("person_id"))) {
    const { error: e2 } = await supabase.from("insurance_policies").update({ payer_person_id: payer }).eq("id", data);
    if (e2) return { error: friendlyError(e2.message) };
  }
  revalidatePath("/insurance");
  redirect(`/insurance/${data}`);
}

export async function saveBeneficiaries(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const { error } = await supabase.rpc("set_beneficiaries", { p_policy_id: id, p_list: bens(form) });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/insurance/${id}`);
  return { ok: "บันทึกผู้รับผลประโยชน์แล้ว" };
}

export async function addClaim(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const { error } = await supabase.from("insurance_claims").insert({
    policy_id: id, incident_date: str(form.get("incident_date")), claim_date: str(form.get("claim_date")),
    claimed_amount: num(form.get("claimed_amount")), currency: str(form.get("currency")) ?? "THB",
    status: str(form.get("status")) ?? "SUBMITTED", notes: str(form.get("notes")), coverage_id: str(form.get("coverage_id")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath(`/insurance/${id}`);
  return { ok: "บันทึกเคลมแล้ว" };
}

function refresh(id: string) {
  revalidatePath(`/insurance/${id}`);
  revalidatePath("/insurance");
  revalidatePath("/income-expenses");
  revalidatePath("/financial/cash", "layout");
  revalidatePath("/");
}

/** ตั้ง / แทนงวดที่ยังไม่มีการชำระ (ตารางเบี้ย หรือ ตารางผลประโยชน์) */
export async function saveInsSchedule(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  let lines: unknown;
  try { lines = JSON.parse(String(form.get("lines") ?? "[]")); } catch { return { error: "อ่านตารางไม่ได้" }; }
  if (!Array.isArray(lines) || lines.length === 0) return { error: "ตารางต้องมีอย่างน้อย 1 งวด" };
  const { data, error } = await supabase.rpc("set_insurance_schedule", { p_policy_id: id, p_kind: String(form.get("kind")), p_lines: lines });
  if (error) return { error: friendlyError(error.message) };
  refresh(id);
  return { ok: `บันทึกตาราง ${data} งวดแล้ว` };
}

/** จ่ายเบี้ยตามงวด → ค่าใช้จ่ายหมวด "ประกัน" ผูกงวด */
export async function payPremium(_: PayState, form: FormData): Promise<PayState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const amount = num(form.get("amount"));
  if (amount == null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่จำนวนเงิน" };
  const pay = endpointFromForm(form);
  const { error } = await supabase.rpc("add_expense", { p: {
    date: str(form.get("date")), description: str(form.get("description")), amount, currency: str(form.get("currency")),
    expense_category: "ประกัน",
    ...paidFromColumns(pay),
    person_id: pay.kind === "cash" ? str(form.get("person_id")) : null,
    insurance_schedule_line_id: str(form.get("line_id")), notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  // ลงมูลค่าเวนคืนตามตารางในสัญญาต่อ (ถ้ามี) · ไม่สำเร็จก็ไม่กระทบการจ่ายเบี้ย
  const { data: cv } = await supabase.rpc("sync_insurance_cash_value", { p_policy_id: id });
  refresh(id);
  return { ok: "บันทึกจ่ายเบี้ยแล้ว", cv: (cv as CvSync | null) ?? undefined };
}

const cvMsg = (r: CvSync | null | undefined) => r && r.added > 0
  ? ` · ${r.created ? "สร้าง" : "อัปเดต"}มูลค่าเวนคืนตามสัญญา ${Number(r.value).toLocaleString("en-US", { minimumFractionDigits: 2 })} (สิ้นปีกรมธรรม์ที่ ${r.policy_year})`
  : "";

/** ตั้ง / แทนตารางมูลค่าเวนคืนตามสัญญา แล้วลงมูลค่าเวนคืนตามตารางต่อทันที */
export async function saveCashValueTable(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  let lines: unknown;
  try { lines = JSON.parse(String(form.get("lines") ?? "[]")); } catch { return { error: "อ่านตารางไม่ได้" }; }
  if (!Array.isArray(lines)) return { error: "อ่านตารางไม่ได้" };
  const { data, error } = await supabase.rpc("set_insurance_cash_value_table", { p_policy_id: id, p_lines: lines });
  if (error) return { error: friendlyError(error.message) };
  refresh(id);
  const r = data as { count: number; sync: CvSync } | null;
  return { ok: lines.length === 0 ? "ล้างตารางแล้ว" : `บันทึกตาราง ${r?.count ?? lines.length} ปีแล้ว${cvMsg(r?.sync)}` };
}

/** ปุ่ม "ลงมูลค่าตามตาราง" (ปีที่ถึงวันแล้ว แต่ยังไม่ได้ลง เช่น จ่ายเบี้ยครบแล้ว) */
export async function syncCashValue(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const { data, error } = await supabase.rpc("sync_insurance_cash_value", { p_policy_id: id });
  if (error) return { error: friendlyError(error.message) };
  refresh(id);
  const r = data as CvSync | null;
  return r && r.added > 0 ? { ok: `ลงแล้ว ${r.added} ปี${cvMsg(r)}` } : { ok: "ไม่มีปีที่ต้องลงเพิ่ม (ยังไม่ถึงวัน · เบี้ยก่อนหน้ายังค้าง · หรือมียอดที่ใหม่กว่าแล้ว)" };
}

/** รับผลประโยชน์ / ครบสัญญา / เวนคืน / สินไหม — ถอนจากมูลค่าเวนคืนก่อน ส่วนเกินเป็นรายได้ */
export async function receiveBenefit(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const { data, error } = await supabase.rpc("receive_insurance_benefit", { p: {
    policy_id: id, line_id: str(form.get("line_id")), date: str(form.get("date")), amount: num(form.get("amount")),
    bank_asset_id: str(form.get("bank_asset_id")), use_cash_value: !form.has("use_cash_value") || form.getAll("use_cash_value").includes("on"),
    outcome: str(form.get("outcome")), person_id: str(form.get("person_id")), notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  refresh(id);
  const r = data as { cash_value_part: number; income_part: number } | null;
  const fmt = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { ok: r ? `บันทึกแล้ว · จากมูลค่าเวนคืน ${fmt(r.cash_value_part)} · รายได้ ${fmt(r.income_part)}` : "บันทึกแล้ว" };
}

/** เพิ่มมูลค่าเวนคืน (รวมเงินปันผลสะสม) ให้กรมธรรม์ที่ยังไม่มี */
export async function addCashValue(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const value = num(form.get("value"));
  if (value == null || Number.isNaN(value) || value < 0) return { error: "กรุณาใส่มูลค่าเวนคืน" };
  const { error } = await supabase.rpc("add_insurance_cash_value", { p_policy_id: id, p: {
    value, valuation_date: str(form.get("valuation_date")), owner_person_id: str(form.get("owner_person_id")),
    notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  refresh(id);
  return { ok: "เพิ่มมูลค่าเวนคืนแล้ว" };
}

export async function addCoverage(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const limit = num(form.get("limit_amount"));
  if (limit == null || Number.isNaN(limit) || limit < 0) return { error: "กรุณาใส่วงเงิน" };
  const { error } = await supabase.from("insurance_coverages").insert({
    policy_id: id, coverage_type: str(form.get("coverage_type")), limit_amount: limit,
    currency: str(form.get("currency")) ?? "THB", notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  refresh(id);
  return { ok: "เพิ่มความคุ้มครองแล้ว" };
}

/** แก้ข้อมูลกรมธรรม์ (หน้าต่าง "แก้ไขข้อมูล") */
export async function updatePolicyInfo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("policy_id"));
  const patch: Record<string, unknown> = {
    insurer: str(form.get("insurer")), policy_no: str(form.get("policy_no")), start_date: str(form.get("start_date")),
    end_date: str(form.get("end_date")), insured_amount: num(form.get("insured_amount")), premium: num(form.get("premium")),
    payer_person_id: str(form.get("payer_person_id")), notes: str(form.get("notes")),
  };
  if (form.has("person_id")) patch.person_id = str(form.get("person_id"));
  if (!patch.insurer) return { error: "กรุณาใส่บริษัทประกัน" };
  const { data, error } = await supabase.from("insurance_policies").update(patch).eq("id", id).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  revalidatePath("/insurance");
  revalidatePath(`/insurance/${id}`);
  return { ok: "บันทึกข้อมูลแล้ว" };
}
