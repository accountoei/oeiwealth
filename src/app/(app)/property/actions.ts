"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, sqwaFromForm, strOrNull as str } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

/** อ่านช่องสัญญาเช่า (prefix lease_) → jsonb สำหรับ create_lease */
function leaseFromForm(form: FormData) {
  const g = (k: string) => str(form.get(`lease_${k}`));
  return {
    unit_label: g("unit_label"), tenant_name: g("tenant_name"), contract_no: g("contract_no"),
    start_date: g("start_date"), end_date: g("end_date"),
    rent_amount: g("rent_amount")?.replace(/,/g, "") ?? null, rent_currency: g("rent_currency"),
    payment_frequency: g("payment_frequency"), payment_due_day: g("payment_due_day"),
    security_deposit: g("security_deposit")?.replace(/,/g, "") ?? null,
    deposit_received_date: g("deposit_received_date"), deposit_to_asset_id: g("deposit_to_asset_id"),
    carried_from_lease_id: form.get("lease_carry") === "on" ? g("carried_from_lease_id") : null,
    notes: g("notes"),
  };
}

function revalidateProperty(assetId?: string) {
  revalidatePath("/property");
  revalidatePath("/property/costs");
  if (assetId) revalidatePath(`/property/${assetId}`);
  revalidatePath("/liabilities");
}

export async function createProperty(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const value = num(form.get("value"));
  if (value === null || Number.isNaN(value) || value < 0) return { error: "กรุณาใส่มูลค่าเป็นตัวเลข" };
  const usage = str(form.get("usage_type")) ?? "OWNER_OCCUPIED";
  const lease = usage === "RENTAL" ? leaseFromForm(form) : null;
  const { data, error } = await supabase.rpc("create_property", {
    p_name: str(form.get("name")),
    p_property_type: str(form.get("property_type")) ?? "HOUSE",
    p_usage_type: usage,
    p_currency: str(form.get("currency")) ?? "THB",
    p_value: value,
    p_value_date: str(form.get("value_date")),
    p_is_opening: form.get("is_opening") === "on",
    p_valuation_method: str(form.get("valuation_method")) ?? "USER_ESTIMATE",
    p_acquisition_date: str(form.get("acquisition_date")),
    p_acquisition_cost: num(form.get("acquisition_cost")),
    p_location_group: str(form.get("location_group")),
    p_address: str(form.get("address")),
    p_land_area_sq_wa: sqwaFromForm(form),
    p_title_type: str(form.get("title_type")),
    p_title_deed_no: str(form.get("title_deed_no")),
    p_land_no: str(form.get("land_no")),
    p_owners: ownersFromForm(form),
    p_lease: lease?.tenant_name ? lease : null,
    p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty();
  redirect(`/property/${data}`);
}

export async function addValuation(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const value = num(form.get("value"));
  if (value === null || Number.isNaN(value) || value < 0) return { error: "กรุณาใส่มูลค่าเป็นตัวเลข" };
  const method = str(form.get("valuation_method")) ?? "USER_ESTIMATE";
  const { error } = await supabase.from("asset_valuations").insert({
    asset_id: id, valuation_date: str(form.get("valuation_date")), value, valuation_method: method,
    source: method === "APPRAISAL" ? "APPRAISAL" : "USER", notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty(id);
  return { ok: "บันทึกมูลค่าแล้ว" };
}

export async function updatePropertyInfo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const { data: a, error: e1 } = await supabase.from("assets").update({
    name: str(form.get("name")), notes: str(form.get("notes")),
    acquisition_date: str(form.get("acquisition_date")), acquisition_cost: num(form.get("acquisition_cost")),
  }).eq("id", id).select("id");
  if (e1) return { error: friendlyError(e1.message) };
  if (!a?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  const { error: e2 } = await supabase.from("property_details").update({
    property_type: str(form.get("property_type")), usage_type: str(form.get("usage_type")),
    location_group: str(form.get("location_group")), address: str(form.get("address")),
    land_area_sq_wa: sqwaFromForm(form), title_type: str(form.get("title_type")),
    title_deed_no: str(form.get("title_deed_no")), land_no: str(form.get("land_no")),
  }).eq("asset_id", id);
  if (e2) return { error: friendlyError(e2.message) };
  revalidateProperty(id);
  return { ok: "บันทึกข้อมูลแล้ว" };
}

export async function setUsage(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const { data, error } = await supabase.from("property_details")
    .update({ usage_type: String(form.get("usage_type")) }).eq("asset_id", id).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  revalidateProperty(id);
  return { ok: "เปลี่ยนการใช้งานแล้ว" };
}

export async function createLease(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const { error } = await supabase.rpc("create_lease", { p_property_asset_id: id, p_lease: leaseFromForm(form) });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty(id);
  return { ok: "สร้างสัญญาเช่าแล้ว" };
}

export async function terminateLease(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const date = str(form.get("terminated_date"));
  if (!date) return { error: "กรุณาใส่วันที่เลิกสัญญา" };
  const { data, error } = await supabase.from("property_leases")
    .update({ status: "TERMINATED", terminated_date: date }).eq("id", String(form.get("lease_id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขสัญญานี้" };
  revalidateProperty(id);
  return { ok: "บันทึกการเลิกสัญญาแล้ว" };
}

export async function settleDeposit(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const refunded = num(form.get("refunded_amount"));
  if (refunded === null || Number.isNaN(refunded) || refunded < 0) return { error: "กรุณาใส่ยอดที่คืนเป็นตัวเลข (คืน 0 ได้)" };
  const { data, error } = await supabase.rpc("settle_security_deposit", {
    p_lease_id: String(form.get("lease_id")),
    p_settled_date: str(form.get("settled_date")),
    p_refunded_amount: refunded,
    p_refund_from_asset_id: str(form.get("refund_from_asset_id")),
    p_deduction_reason: str(form.get("deduction_reason")),
    p_record_deduction_as_income: form.get("record_as_income") === "on",
  });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty(id);
  const warn = (data as { warning?: string } | null)?.warning;
  return { ok: warn ? `บันทึกแล้ว · ${warn}` : "บันทึกการคืนเงินประกันแล้ว" };
}

export async function recordRent(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่ยอดที่ได้รับ" };
  const toAsset = str(form.get("received_to_asset_id"));
  let currency = str(form.get("currency")) ?? "THB";
  if (toAsset) {
    const { data: acc } = await supabase.from("assets").select("currency").eq("id", toAsset).maybeSingle();
    if (acc?.currency) currency = acc.currency;
  }
  const { error } = await supabase.from("income_transactions").insert({
    lease_id: String(form.get("lease_id")), income_type: "RENT", date: str(form.get("date")),
    income_period: str(form.get("income_period")), amount, currency,
    received_to_asset_id: toAsset, notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty(id);
  if (toAsset) revalidatePath(`/financial/cash/${toAsset}`);
  return { ok: "บันทึกรับค่าเช่าแล้ว" };
}

export async function addUtility(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const amount = num(form.get("expected_amount"));
  const frequency = str(form.get("frequency"));
  if (amount != null && (Number.isNaN(amount) || amount < 0)) return { error: "ยอดประมาณไม่ถูกต้อง" };
  if ((amount == null) !== (frequency == null)) return { error: "ถ้าจะติดตามค่าใช้จ่าย ให้ใส่ทั้งยอดประมาณและความถี่ (หรือเว้นว่างทั้งคู่)" };
  const dueDay = num(form.get("due_day"));
  const dueMonth = frequency && frequency !== "MONTHLY" ? num(form.get("due_month")) : null;
  const { error } = await supabase.from("property_utilities").insert({
    property_id: String(form.get("property_id")), utility_type: str(form.get("utility_type")) ?? "ELECTRICITY",
    provider: str(form.get("provider")), account_no: str(form.get("account_no")), meter_no: str(form.get("meter_no")),
    notes: str(form.get("notes")), expected_amount: amount, frequency, currency: str(form.get("currency")) ?? "THB",
    due_day: dueDay, due_month: dueMonth,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty(id);
  return { ok: "เพิ่มแล้ว" };
}

/** บันทึกจ่ายค่าใช้จ่ายประจำ (ส่วนกลาง / ภาษีที่ดิน / ไฟ / น้ำ) ของงวดหนึ่ง → สร้างรายการค่าใช้จ่ายผูกกับรายการนั้น */
export async function recordPropertyCost(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = str(form.get("asset_id"));
  const amount = num(form.get("amount"));
  if (amount == null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่จำนวนเงิน" };
  const via = String(form.get("pay_via") ?? "bank");
  const { error } = await supabase.rpc("add_expense", { p: {
    date: str(form.get("date")), description: str(form.get("description")), amount,
    currency: str(form.get("currency")), expense_category: str(form.get("expense_category")),
    paid_from_asset_id: via === "bank" ? str(form.get("bank_asset_id")) : null,
    paid_from_credit_card_id: via === "card" ? str(form.get("card_id")) : null,
    person_id: via === "cash" ? str(form.get("person_id")) : null,
    property_utility_id: str(form.get("utility_id")), cost_period: str(form.get("cost_period")),
    notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty(assetId ?? undefined);
  revalidatePath("/income-expenses");
  revalidatePath("/financial/cash", "layout");
  return { ok: "บันทึกจ่ายแล้ว" };
}
