"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, sqwaFromForm, strOrNull as str, type FormState } from "@/lib/format";
import { payFromForm, recordAssetPurchase } from "@/lib/asset-pay";
import { bankId, cardId, endpointFromForm, paidFromColumns, parseEndpoint } from "@/lib/money-endpoint";
import { BAD_ROWS_ERROR, isPositive, notSaved, readRows } from "@/lib/batch-entry";

/** created = สร้างรายการแล้วแต่บันทึกเงินออกไม่สำเร็จ → ลิงก์ไปหน้ารายการ (ไม่ให้กดบันทึกซ้ำ) */
export type ActionState = FormState & { created?: string };

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

/** บัญชีรับค่าเช่า (ค่าตั้งต้น) — create_lease ไม่รับช่องนี้ จึงตั้งหลังสร้างสัญญา */
async function setRentAccount(supabase: Awaited<ReturnType<typeof createClient>>, leaseIds: string[], form: FormData) {
  const to = str(form.get("lease_rent_to_asset_id"));
  if (!to || !leaseIds.length) return null;
  const { error } = await supabase.from("property_leases").update({ rent_to_asset_id: to }).in("id", leaseIds);
  return error ? `ตั้งบัญชีรับค่าเช่าไม่ได้ (${friendlyError(error.message)}) — ตั้งใหม่ที่ปุ่มแก้ไขของสัญญา` : null;
}

function revalidateProperty(assetId?: string) {
  revalidatePath("/property");
  revalidatePath("/income-expenses");
  if (assetId) revalidatePath(`/property/${assetId}`);
  revalidatePath("/liabilities");
}

export async function createProperty(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const value = num(form.get("value"));
  if (value === null || Number.isNaN(value) || value < 0) return { error: "กรุณาใส่มูลค่าเป็นตัวเลข" };
  const usage = str(form.get("usage_type")) ?? "OWNER_OCCUPIED";
  const lease = usage === "RENTAL" ? leaseFromForm(form) : null;
  const pay = payFromForm(form);
  if (pay && "error" in pay) return { error: pay.error };
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
  if (lease?.tenant_name) {
    const { data: ls } = await supabase.from("property_leases").select("id,property_details!inner(asset_id)")
      .eq("property_details.asset_id", String(data)).is("deleted_at", null);
    const e1 = await setRentAccount(supabase, (ls ?? []).map((l) => l.id), form);
    if (e1) return { error: `บันทึกทรัพย์สินแล้ว แต่${e1}`, created: `/property/${data}` };
  }
  if (pay) {
    const e2 = await recordAssetPurchase(supabase, String(data), pay);
    revalidatePath("/financial/cash", "layout");
    if (e2) return { error: `บันทึกทรัพย์สินแล้ว แต่บันทึกเงินออกจากบัญชีไม่สำเร็จ (${e2}) — เปิดหน้าทรัพย์สินแล้วใช้ปุ่ม "+ จ่ายซื้อ / จ่ายเพิ่ม"`, created: `/property/${data}` };
  }
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

/** พิกัด "ละติจูด, ลองจิจูด" (ช่องเดียว) → 2 ค่า · ว่าง = ลบ · ไม่มีพิกัดแต่ลิงก์มี @lat,lng → ใช้จากลิงก์ */
function parseCoords(raw: string | null, url: string | null): { lat: number | null; lng: number | null } | { error: string } {
  const src = raw ?? url?.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)?.slice(1, 3).join(",") ?? null;
  if (!src) return { lat: null, lng: null };
  const m = src.trim().match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*\)?$/);
  if (!m) return { error: "พิกัดไม่ถูกต้อง — ใส่แบบ 13.7563, 100.5018 (ละติจูด, ลองจิจูด)" };
  const lat = Number(m[1]), lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: "พิกัดเกินช่วง (ละติจูด ±90 · ลองจิจูด ±180) — ตรวจว่าไม่ได้สลับกัน" };
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

export async function updatePropertyInfo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const mapUrl = str(form.get("map_url"));
  if (mapUrl && !/^https:\/\//i.test(mapUrl)) return { error: "ลิงก์ Google Maps ต้องขึ้นต้นด้วย https://" };
  const xy = parseCoords(str(form.get("coords")), mapUrl);
  if ("error" in xy) return { error: xy.error };
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
    deed_book: str(form.get("deed_book")), deed_page: str(form.get("deed_page")), map_sheet: str(form.get("map_sheet")),
    survey_page: str(form.get("survey_page")), subdistrict: str(form.get("subdistrict")), district: str(form.get("district")),
    province: str(form.get("province")),
    encumbrance_type: str(form.get("encumbrance_type")),
    encumbrance_details: ["", "NONE"].includes(str(form.get("encumbrance_type")) ?? "") ? null : str(form.get("encumbrance_details")),
    // ที่ว่าง: ส่งเฉพาะตอนเป็น "ว่าง" (ระบบเติมวันเริ่มว่าง / เก็บประวัติให้เมื่อเปลี่ยนการใช้งาน)
    ...(str(form.get("usage_type")) === "VACANT" ? { vacant_since: str(form.get("vacant_since")), vacant_plan: str(form.get("vacant_plan")),
      vacant_plan_date: str(form.get("vacant_plan_date")) } : {}),
    ...(form.has("coords") ? { map_url: mapUrl, latitude: xy.lat, longitude: xy.lng } : {}),
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
  const { data: leaseId, error } = await supabase.rpc("create_lease", { p_property_asset_id: id, p_lease: leaseFromForm(form) });
  if (error) return { error: friendlyError(error.message) };
  const warn = await setRentAccount(supabase, leaseId ? [String(leaseId)] : [], form);
  revalidateProperty(id);
  return warn ? { error: `สร้างสัญญาแล้ว แต่${warn}` } : { ok: "สร้างสัญญาเช่าแล้ว" };
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
    ...(form.has("pay_default") ? (() => { const e = parseEndpoint(str(form.get("pay_default"))); return { paid_from_asset_id: bankId(e), paid_from_credit_card_id: cardId(e) }; })() : {}),
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
  const pay = endpointFromForm(form);
  const { error } = await supabase.rpc("add_expense", { p: {
    date: str(form.get("date")), description: str(form.get("description")), amount,
    currency: str(form.get("currency")), expense_category: str(form.get("expense_category")),
    ...paidFromColumns(pay),
    person_id: pay.kind === "cash" ? str(form.get("person_id")) : null,
    property_utility_id: str(form.get("utility_id")), cost_period: str(form.get("cost_period")),
    notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  revalidateProperty(assetId ?? undefined);
  revalidatePath("/income-expenses");
  revalidatePath("/financial/cash", "layout");
  return { ok: "บันทึกจ่ายแล้ว" };
}

export type BatchState = { error?: string; ok?: string };

/** รับค่าเช่าหลายสัญญาพร้อมกัน (แท็บ บันทึกรับค่าเช่า/สัญญาเช่า) · ผิดแถวเดียว = ไม่บันทึกเลย */
export async function batchRent(_: BatchState, form: FormData): Promise<BatchState> {
  const supabase = await createClient();
  const rows = readRows<{ lease_id: string; amount: string; date: string; received_to_asset_id: string; income_period: string }>(form);
  if (!rows) return { error: BAD_ROWS_ERROR };
  const clean = rows.map((r) => ({ ...r, amount: num(r.amount), received_to_asset_id: r.received_to_asset_id || null }));
  if (!clean.length) return { error: "กรุณากรอกยอดที่ได้รับอย่างน้อย 1 รายการ" };
  if (!clean.every((r) => isPositive(r.amount))) return { error: "ยอดที่ได้รับต้องเป็นตัวเลขมากกว่า 0 ทุกแถวที่กรอก" };
  const { data, error } = await supabase.rpc("batch_record_rent", { p_rows: clean });
  if (error) return { error: notSaved("ทุกรายการ", friendlyError(error.message)) };
  revalidateProperty();
  revalidatePath("/financial/cash", "layout");
  return { ok: `บันทึกรับค่าเช่าแล้ว ${data} รายการ` };
}

/** ค่าใช้จ่ายของทรัพย์สินหลายรายการพร้อมกัน (แท็บ ค่าใช้จ่าย) · ผิดแถวเดียว = ไม่บันทึกเลย */
export async function batchPropertyExpenses(_: BatchState, form: FormData): Promise<BatchState> {
  const supabase = await createClient();
  const rows = readRows<{ amount: string; pay: string; description?: string } & Record<string, string>>(form);
  if (!rows) return { error: BAD_ROWS_ERROR };
  if (!rows.length) return { error: "กรุณากรอกยอดอย่างน้อย 1 รายการ" };
  const clean = rows.map(({ pay, amount, ...r }) => ({
    ...r, description: String(r.description ?? ""), amount: num(amount),
    paid_from_asset_id: bankId(parseEndpoint(pay)),
    paid_from_credit_card_id: cardId(parseEndpoint(pay)),
  }));
  if (!clean.every((r) => isPositive(r.amount))) return { error: "ยอดที่จ่ายต้องเป็นตัวเลขมากกว่า 0 ทุกแถวที่กรอก" };
  if (clean.some((r) => !r.description.trim())) return { error: "กรุณาใส่รายการ (รายละเอียด) ทุกแถว" };
  const { data, error } = await supabase.rpc("batch_add_property_expenses", { p_rows: clean });
  if (error) return { error: notSaved("ทุกรายการ", friendlyError(error.message)) };
  revalidateProperty();
  revalidatePath("/financial/cash", "layout");
  return { ok: `บันทึกค่าใช้จ่ายแล้ว ${data} รายการ` };
}

// ---------------------------------------------------------------- ภาษีที่ดินและสิ่งปลูกสร้าง
async function syncLandTax(supabase: Awaited<ReturnType<typeof createClient>>, assetId: string, year: number) {
  const { error } = await supabase.rpc("sync_land_tax_estimate", { p_asset_id: assetId, p_tax_year: year });
  return error ? friendlyError(error.message) : null;
}

/** เพิ่ม / แก้รายการภาษีที่ดิน 1 รายการ · ปีปัจจุบัน → ตั้งยอดประมาณ "ภาษีที่ดิน" ให้ตามภาษีรวม */
export async function saveTaxLine(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const id = str(form.get("id"));
  const year = Number(form.get("tax_year"));
  const rate = num(form.get("rate_pct"));
  if (!Number.isInteger(year)) return { error: "ปีภาษีไม่ถูกต้อง" };
  if (rate == null || Number.isNaN(rate)) return { error: "กรุณาใส่อัตราภาษี (%)" };
  const row = {
    asset_id: assetId, tax_year: year, sort_order: num(form.get("sort_order")) ?? 0, description: str(form.get("description")),
    land_sq_wa: sqwaFromForm(form), land_price_per_sq_wa: num(form.get("land_price_per_sq_wa")),
    building_type: str(form.get("building_type")), building_sqm: num(form.get("building_sqm")),
    building_price_per_sqm: num(form.get("building_price_per_sqm")), building_age: num(form.get("building_age")),
    depreciation_pct: num(form.get("depreciation_pct")) ?? 0, exemption: num(form.get("exemption")) ?? 0,
    exemption_reason: str(form.get("exemption_reason")), rate_pct: rate, discount_pct: num(form.get("discount_pct")) ?? 0,
    notes: str(form.get("notes")),
  };
  const { data, error } = id
    ? await supabase.from("property_tax_lines").update(row).eq("id", id).select("id")
    : await supabase.from("property_tax_lines").insert(row).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  const warn = await syncLandTax(supabase, assetId, year);
  revalidateProperty(assetId);
  return { ok: warn ? `บันทึกแล้ว · ตั้งยอดประมาณไม่สำเร็จ: ${warn}` : "บันทึกรายการภาษีแล้ว" };
}

export async function deleteTaxLine(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const year = Number(form.get("tax_year"));
  const { data, error } = await supabase.from("property_tax_lines").update({ deleted_at: new Date().toISOString() })
    .eq("id", String(form.get("id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์ลบรายการนี้" };
  await syncLandTax(supabase, assetId, year);
  revalidateProperty(assetId);
  return { ok: "ลบรายการแล้ว" };
}

export async function copyTaxYear(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const from = Number(form.get("from_year")), to = Number(form.get("to_year"));
  const { data, error } = await supabase.rpc("copy_property_tax_year", { p_asset_id: assetId, p_from_year: from, p_to_year: to });
  if (error) return { error: friendlyError(error.message) };
  await syncLandTax(supabase, assetId, to);
  revalidateProperty(assetId);
  return { ok: `คัดลอกจากปี ${from + 543} แล้ว ${data} รายการ` };
}

/** คัดลอกภาษีที่ดินจากปีก่อน ทุกทรัพย์สิน: เฉพาะที่ปีก่อนมีข้อมูล และปีนี้ยังไม่มี (ไม่ทับรายการที่กรอกแล้ว) */
export async function copyTaxYearAll(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const from = Number(form.get("from_year")), to = Number(form.get("to_year"));
  const ids = String(form.get("asset_ids") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return { error: "ปีไม่ถูกต้อง" };
  if (!ids.length) return { error: "ไม่มีทรัพย์สินให้คัดลอก" };
  const { data: rows, error } = await supabase.from("property_tax_lines").select("asset_id,tax_year")
    .in("asset_id", ids).in("tax_year", [from, to]).is("deleted_at", null);
  if (error) return { error: friendlyError(error.message) };
  const has = (y: number) => new Set((rows ?? []).filter((r) => r.tax_year === y).map((r) => r.asset_id as string));
  const src = has(from), dst = has(to);
  let done = 0, lines = 0;
  const failed: string[] = [];
  for (const id of ids) {
    if (!src.has(id) || dst.has(id)) continue;
    const { data: n, error: e } = await supabase.rpc("copy_property_tax_year", { p_asset_id: id, p_from_year: from, p_to_year: to });
    if (e) { failed.push(friendlyError(e.message)); continue; }
    await syncLandTax(supabase, id, to);
    done += 1; lines += Number(n ?? 0);
  }
  revalidateProperty();
  const skipHas = ids.filter((id) => dst.has(id)).length, skipNone = ids.filter((id) => !src.has(id) && !dst.has(id)).length;
  const msg = `คัดลอกจากปี ${from + 543} แล้ว ${done} ทรัพย์สิน (${lines} รายการ)`
    + (skipHas ? ` · ข้าม ${skipHas} (มีข้อมูลปี ${to + 543} แล้ว)` : "") + (skipNone ? ` · ข้าม ${skipNone} (ปี ${from + 543} ไม่มีข้อมูล)` : "");
  return failed.length ? { error: `${msg} · ไม่สำเร็จ ${failed.length}: ${failed[0]}` } : { ok: msg };
}
