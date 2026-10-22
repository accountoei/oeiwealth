"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str } from "@/lib/format";

export type ActionState = { error?: string; ok?: string };

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
  if (par != null && par > 0) await supabase.from("private_business_details").update({ par_value: par }).eq("asset_id", String(data));
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
