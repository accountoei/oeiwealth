"use server";

import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str, type FormState } from "@/lib/format";
import { BAD_ROWS_ERROR, TAX_ERROR, amountOrNull, isPositive, isValidTax, notSaved, plainNumber, readRows } from "@/lib/batch-entry";

export type ActionState = FormState;

function done(id: string, msg: string): ActionState {
  ["/financial/business", `/financial/business/${id}`, "/income-expenses", "/"].forEach((p) => revalidatePath(p));
  revalidatePath("/financial/cash", "layout");
  return { ok: msg };
}

export async function createBusiness(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const value = num(form.get("value"));
  if (value === null || Number.isNaN(value) || value < 0) return { error: "กรุณาใส่มูลค่าเป็นตัวเลข" };
  const { data, error } = await supabase.rpc("create_private_business", { p: {
    company_name: str(form.get("company_name")), name: str(form.get("name")), registration_no: str(form.get("registration_no")),
    business_type: str(form.get("business_type")), total_shares: num(form.get("total_shares")), shares_owned: num(form.get("shares_owned")),
    company_ownership_percent: num(form.get("company_ownership_percent")), investment_cost: num(form.get("investment_cost")),
    currency: str(form.get("currency")), value, value_date: str(form.get("value_date")), is_opening: form.get("is_opening") === "on",
    valuation_method: str(form.get("valuation_method")), acquisition_date: str(form.get("acquisition_date")),
    owners: ownersFromForm(form), notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  const par = num(form.get("par_value"));
  const contact = { address: str(form.get("address")), phone: str(form.get("phone")) };
  if ((par != null && par > 0) || contact.address || contact.phone) {
    await supabase.from("private_business_details").update({ ...(par != null && par > 0 ? { par_value: par } : {}), ...contact }).eq("asset_id", String(data));
  }
  revalidatePath("/financial/business");
  redirect(`/financial/business/${data}`);
}

export async function recordDividend(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่ยอดปันผล" };
  const bank = str(form.get("bank_asset_id"));
  const { data: a } = await supabase.from("assets").select("currency").eq("id", bank ?? id).maybeSingle();
  const { error } = await supabase.from("income_transactions").insert({
    asset_id: id, income_type: "BUSINESS_DIVIDEND", date: str(form.get("date")), amount, tax: num(form.get("tax")),
    currency: a?.currency ?? "THB", received_to_asset_id: bank, notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done(id, "บันทึกเงินปันผลแล้ว");
}

/** แก้รายละเอียดธุรกิจ: ชื่อรายการ (assets.name) + ข้อมูลบริษัท (private_business_details) · RLS / trigger คุมสิทธิ์และหุ้น */
export async function updateBusinessInfo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const name = str(form.get("name"));
  if (!name) return { error: "กรุณาใส่ชื่อรายการ" };
  if (!str(form.get("company_name"))) return { error: "กรุณาใส่ชื่อบริษัท" };
  const { data: a, error: e1 } = await supabase.from("assets").update({ name }).eq("id", assetId).select("id");
  if (e1) return { error: friendlyError(e1.message) };
  if (!a?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  const patch: Record<string, unknown> = {
    company_name: str(form.get("company_name")),
    registration_no: str(form.get("registration_no")),
    business_type: str(form.get("business_type")),
    established_date: str(form.get("established_date")),
    address: str(form.get("address")),
    phone: str(form.get("phone")),
    total_shares: num(form.get("total_shares")),
    par_value: num(form.get("par_value")),
    investment_cost: num(form.get("investment_cost")),
    notes: str(form.get("notes")),
  };
  // เจ้าของเป็น % (แบบเดิม): หุ้นที่ถือ / % ของบริษัท แก้เองได้ · เป็นจำนวนหุ้น: ระบบคำนวณให้
  if (form.has("shares_owned")) patch.shares_owned = num(form.get("shares_owned"));
  if (form.has("company_ownership_percent")) patch.company_ownership_percent = num(form.get("company_ownership_percent"));
  // โลโก้: ส่งมาเฉพาะเมื่อเปลี่ยน / ลบ (ว่าง = ลบ)
  if (form.has("logo_data")) patch.logo_data = str(form.get("logo_data"));
  const { error: e2 } = await supabase.from("private_business_details").update(patch).eq("asset_id", assetId);
  if (e2) return { error: friendlyError(e2.message) };
  return done(assetId, "บันทึกรายละเอียดแล้ว");
}

/** ขายหุ้นรายคน (บางส่วน / หมด) · ฐานข้อมูลปรับหุ้น มูลค่า และเงินเข้าบัญชีพร้อมกัน */
export async function sellShares(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const { error } = await supabase.rpc("sell_business_shares", {
    p_asset_id: assetId, p_person_id: str(form.get("person_id")), p_date: str(form.get("date")),
    p_shares: num(form.get("shares")), p_price: num(form.get("price")), p_fee: num(form.get("fee")),
    p_bank_asset_id: str(form.get("bank_asset_id")), p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done(assetId, "บันทึกการขายหุ้นแล้ว");
}

/** ยกเลิกการขายหุ้น (เฉพาะครั้งล่าสุด) */
export async function undoShareSale(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const { error } = await supabase.rpc("undo_business_share_sale", { p_sale_id: String(form.get("sale_id")) });
  if (error) return { error: friendlyError(error.message) };
  return done(assetId, "ยกเลิกการขายแล้ว");
}

/** ลงทุนเพิ่ม: ผู้ลงทุน · หุ้นที่ได้ · ยอดจ่าย · บริษัทออกหุ้นใหม่หรือไม่ (ฐานข้อมูลปรับหุ้น ทุนเฉลี่ย มูลค่า และเงินออกพร้อมกัน) */
export async function buyShares(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const assetId = String(form.get("asset_id"));
  const { error } = await supabase.rpc("buy_business_shares", {
    p_asset_id: assetId, p_person_id: str(form.get("person_id")), p_date: str(form.get("date")),
    p_shares: num(form.get("shares")), p_amount: num(form.get("amount")), p_bank_asset_id: str(form.get("bank_asset_id")),
    p_new_issue: form.get("new_issue") === "on", p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  return done(assetId, "บันทึกการลงทุนเพิ่มแล้ว");
}

/** แท็บ "บันทึกรับเงินปันผล/อัพเดตมูลค่า": ปันผลแยกตามผู้ถือหุ้น (1 แถว = 1 คน · เข้าบัญชีของคนนั้น) — คำสั่งเดียว (ผิดแถวเดียว = ไม่บันทึกเลย) */
export async function batchDividends(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const date = str(form.get("date"));
  const rows = readRows<{ asset_id: string; person_id: string; amount: string; tax: string; bank_asset_id: string }>(form);
  if (!rows) return { error: BAD_ROWS_ERROR };
  const clean = rows.map((r) => ({ asset_id: r.asset_id, person_id: r.person_id, date, amount: amountOrNull(r.amount), tax: amountOrNull(r.tax), bank_asset_id: r.bank_asset_id || null }));
  if (!date) return { error: "กรุณาเลือกวันที่รับ" };
  if (!clean.length) return { error: "กรุณากรอกปันผลอย่างน้อย 1 รายการ" };
  if (!clean.every((r) => isPositive(r.amount))) return { error: "ปันผลต้องเป็นตัวเลขมากกว่า 0 ทุกแถวที่กรอก" };
  if (!clean.every((r) => isValidTax(r.tax))) return { error: TAX_ERROR };
  const { data, error } = await supabase.rpc("batch_record_business_dividends", { p_rows: clean });
  if (error) return { error: notSaved("ทุกรายการ", friendlyError(error.message)) };
  new Set(clean.map((r) => r.asset_id)).forEach((id) => revalidatePath(`/financial/business/${id}`));
  return done("", `บันทึกปันผลแล้ว ${data} รายการ`);
}

/** แท็บ "บันทึกรับเงินปันผล/อัพเดตมูลค่า": มูลค่าใหม่หลายกิจการ — คำสั่งเดียว (ผิดแถวเดียว = ไม่บันทึกเลย) */
export async function batchValues(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const date = str(form.get("date"));
  const method = str(form.get("method")) ?? "USER_ESTIMATE";
  const rows = readRows<{ asset_id: string; value: string }>(form);
  if (!rows) return { error: BAD_ROWS_ERROR };
  const clean = rows.map((r) => ({ asset_id: r.asset_id, date, method, value: Number(plainNumber(r.value)) }));
  if (!date) return { error: "กรุณาเลือกวันที่ประเมิน" };
  if (!clean.length) return { error: "กรุณากรอกมูลค่าอย่างน้อย 1 กิจการ" };
  if (clean.some((r) => Number.isNaN(r.value) || r.value < 0)) return { error: "มูลค่าต้องเป็นตัวเลข (ไม่ติดลบ) ทุกแถวที่กรอก" };
  const { data, error } = await supabase.rpc("batch_record_business_values", { p_rows: clean });
  if (error) return { error: notSaved("ทุกกิจการ", friendlyError(error.message)) };
  new Set(clean.map((r) => r.asset_id)).forEach((id) => revalidatePath(`/financial/business/${id}`));
  return done("", `บันทึกมูลค่าแล้ว ${data} กิจการ`);
}

/* ---------------------------------------------------------------- ผลประกอบการรายปี (ตกลง 9 พ.ย. 2026)
   ข้อมูลดูอย่างเดียว: ไม่สร้างรายได้ / เงินเข้าออก · ตัวเลขทั้งบริษัท 100% · กิจการ (asset_id) หรือบริษัทที่ปิดแล้ว (past_business_id) */
function finDone(form: FormData, msg: string): ActionState {
  const asset = str(form.get("asset_id")), past = str(form.get("past_business_id"));
  ["/financial/business", asset ? `/financial/business/${asset}` : null, past ? `/financial/business/past/${past}` : null]
    .forEach((p) => p && revalidatePath(p));
  return { ok: msg };
}

const FIN_NUMS = ["revenue_domestic", "revenue_foreign", "employees", "executives", "corporate_tax", "net_profit", "dividends_paid", "equity",
  "land_value", "building_cost", "building_depreciation", "equipment_cost", "equipment_depreciation"] as const;

export async function saveFinancialYear(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = str(form.get("id"));
  const asset = str(form.get("asset_id")), past = str(form.get("past_business_id"));
  const beYear = Number(String(form.get("fiscal_year_be") ?? "").replace(/,/g, ""));
  if (!Number.isInteger(beYear) || beYear < 2443 || beYear > 2743) return { error: "กรุณาใส่ปีบัญชีเป็น พ.ศ. เช่น 2568" };
  const row: Record<string, unknown> = { fiscal_year: beYear - 543, audit_status: str(form.get("audit_status")) ?? "AUDITED", notes: str(form.get("notes")) };
  for (const k of FIN_NUMS) {
    // ช่องภาษีชื่อ income_tax ในฟอร์ม (ชื่อที่มีคำว่า "rate" ช่องตัวเลขจะไม่เติม .00)
    const v = num(form.get(k === "corporate_tax" ? "income_tax" : k));
    if (v != null && Number.isNaN(v)) return { error: "กรุณาใส่ตัวเลขให้ถูกต้อง" };
    row[k] = v;
  }
  if (row.revenue_domestic == null && row.revenue_foreign == null && row.net_profit == null) return { error: "กรุณาใส่รายได้ หรือ กำไร (ขาดทุน)" };
  if (row.employees != null && !Number.isInteger(row.employees)) return { error: "จำนวนพนักงานต้องเป็นจำนวนเต็ม" };
  if (row.executives != null && !Number.isInteger(row.executives)) return { error: "จำนวนผู้บริหารต้องเป็นจำนวนเต็ม" };
  if (!id) { row.asset_id = asset; row.past_business_id = past; }
  const { data, error } = id
    ? await supabase.from("business_financial_years").update(row).eq("id", id).select("id")
    : await supabase.from("business_financial_years").insert(row).select("id");
  if (error) return { error: /bfy_(asset|past)_year_uq/.test(error.message) ? `ปี ${beYear} มีข้อมูลแล้ว — กดแถวของปีนั้นเพื่อแก้ไข` : friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  return finDone(form, `บันทึกผลประกอบการปี ${beYear} แล้ว`);
}

export async function deleteFinancialYear(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("business_financial_years").update({ deleted_at: new Date().toISOString() })
    .eq("id", String(form.get("id"))).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์ลบรายการนี้" };
  return finDone(form, "ลบผลประกอบการปีนี้แล้ว");
}

/** บริษัทที่ปิดแล้ว (เก็บเป็นประวัติ · ไม่ใช่ทรัพย์สิน) */
export async function savePastBusiness(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = str(form.get("id"));
  const name = str(form.get("name"));
  if (!name) return { error: "กรุณาใส่ชื่อย่อบริษัท" };
  const row = { name, company_name: str(form.get("company_name")), established_date: str(form.get("established_date")),
    closed_date: str(form.get("closed_date")), notes: str(form.get("notes")) };
  const { data, error } = id
    ? await supabase.from("past_businesses").update(row).eq("id", id).select("id")
    : await supabase.from("past_businesses").insert(row).select("id");
  if (error) return { error: /past_businesses_dates_ck/.test(error.message) ? "วันที่ปิดต้องไม่ก่อนวันที่จัดตั้ง" : friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  revalidatePath("/financial/business");
  if (id) { revalidatePath(`/financial/business/past/${id}`); return { ok: "บันทึกแล้ว" }; }
  redirect(`/financial/business/past/${data[0].id}`);
}

/** ลบบริษัทที่ปิดแล้ว + ผลประกอบการทุกปีของบริษัทนั้น (soft delete · ADMIN / EDITOR) */
export async function deletePastBusiness(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("id"));
  const now = new Date().toISOString();
  const { error: e1 } = await supabase.from("business_financial_years").update({ deleted_at: now }).eq("past_business_id", id).is("deleted_at", null);
  if (e1) return { error: friendlyError(e1.message) };
  const { data, error } = await supabase.from("past_businesses").update({ deleted_at: now }).eq("id", id).select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์ลบรายการนี้" };
  revalidatePath("/financial/business");
  redirect("/financial/business?tab=results");
}
