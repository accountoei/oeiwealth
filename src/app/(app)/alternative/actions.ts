"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { payFromForm, recordAssetPurchase } from "@/lib/asset-pay";
import { friendlyError, numOrNull as num, ownersFromForm, strOrNull as str, type FormState } from "@/lib/format";
import { BAD_ROWS_ERROR, TAX_ERROR, amountOrNull, isPositive, isValidTax, notSaved, plainNumber, readRows } from "@/lib/batch-entry";

/** created = สร้างรายการแล้วแต่บันทึกเงินออกไม่สำเร็จ → ลิงก์ไปหน้ารายการ (ไม่ให้กดบันทึกซ้ำ) */
export type ActionState = FormState & { id?: string; name?: string; unit?: string; created?: string };

export async function createAlternative(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const value = num(form.get("value"));
  if (value === null || Number.isNaN(value) || value < 0) return { error: "กรุณาใส่มูลค่าเป็นตัวเลข" };
  const pay = payFromForm(form);
  if (pay && "error" in pay) return { error: pay.error };
  const { data, error } = await supabase.rpc("create_alternative_asset", { p: {
    name: str(form.get("name")), category_id: str(form.get("category_id")), currency: str(form.get("currency")),
    value, value_date: str(form.get("value_date")), is_opening: form.get("is_opening") === "on",
    valuation_method: str(form.get("valuation_method")), acquisition_date: str(form.get("acquisition_date")),
    acquisition_cost: num(form.get("acquisition_cost")), brand: str(form.get("brand")), model: str(form.get("model")),
    serial_no: str(form.get("serial_no")), quantity: num(form.get("quantity")), unit: str(form.get("unit")), purity_pct: num(form.get("purity_pct")),
    storage_location: str(form.get("storage_location")),
    condition: str(form.get("condition")), details: str(form.get("details")), owners: ownersFromForm(form), notes: str(form.get("notes")),
  } });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/alternative");
  if (pay) {
    const e2 = await recordAssetPurchase(supabase, String(data), pay);
    revalidatePath("/financial/cash", "layout");
    if (e2) return { error: `บันทึกสินทรัพย์แล้ว แต่บันทึกเงินออกจากบัญชีไม่สำเร็จ (${e2}) — เปิดหน้าสินทรัพย์แล้วใช้ปุ่ม "+ จ่ายซื้อ / จ่ายเพิ่ม"`, created: `/alternative/${data}` };
  }
  redirect(`/alternative/${data}`);
}

export async function addCategory(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const name = str(form.get("category_name"));
  if (!name) return { error: "กรุณาใส่ชื่อหมวด" };
  const { data: fam } = await supabase.from("families").select("id").maybeSingle();
  const code = "CUSTOM_" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const { data, error } = await supabase.from("asset_categories")
    .insert({ family_id: fam?.id, category_code: code, category_name: name, default_unit: str(form.get("default_unit")) ?? "ชิ้น" }).select("id").single();
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/alternative/new");
  revalidatePath("/alternative");
  return { ok: `เพิ่มหมวด "${name}" แล้ว และเลือกให้แล้ว`, id: data.id, name, unit: str(form.get("default_unit")) ?? "ชิ้น" };
}

/** แก้ข้อมูลสินทรัพย์ (ชื่อ · วันที่ / ราคาที่ได้มา · หมายเหตุ + รายละเอียด หน่วย ความบริสุทธิ์ ฯลฯ) */
export async function updateAlternativeInfo(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const purity = num(form.get("purity_pct"));
  if (purity != null && (Number.isNaN(purity) || purity <= 0 || purity > 100)) return { error: "ความบริสุทธิ์ต้องอยู่ระหว่าง 0–100%" };
  const { data: a, error: e1 } = await supabase.from("assets").update({
    name: str(form.get("name")), acquisition_date: str(form.get("acquisition_date")), acquisition_cost: num(form.get("acquisition_cost")),
    notes: str(form.get("notes")),
  }).eq("id", id).select("id");
  if (e1) return { error: friendlyError(e1.message) };
  if (!a?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  const { error: e2 } = await supabase.from("alternative_asset_details").update({
    brand: str(form.get("brand")), model: str(form.get("model")), serial_no: str(form.get("serial_no")),
    quantity: num(form.get("quantity")), unit: str(form.get("unit")), purity_pct: purity,
    storage_location: str(form.get("storage_location")), condition: str(form.get("condition")), details: str(form.get("details")),
    ...(form.has("auto_price_shown") ? { auto_price: form.get("auto_price") === "on" } : {}),
    ...(form.has("gold_form") ? {
      gold_form: form.get("gold_form") === "ORNAMENT" ? "ORNAMENT" : "BAR",
      deduct_per_baht: form.get("gold_form") === "ORNAMENT" ? num(form.get("deduct_per_baht")) : null,
    } : {}),
  }).eq("asset_id", id);
  if (e2) return { error: friendlyError(e2.message) };
  revalidatePath("/alternative");
  revalidatePath(`/alternative/${id}`);
  return { ok: "บันทึกข้อมูลแล้ว" };
}

/** ทองคำ: ใส่ราคาต่อ 1 บาททองคำ (96.5%) → ฐานข้อมูลคำนวณมูลค่า (จำนวน × ราคา × ความบริสุทธิ์ ÷ 96.5 − ค่าหักรูปพรรณ) */
export async function addGoldValuation(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = String(form.get("asset_id"));
  const price = num(form.get("price_per_baht"));
  if (price === null || Number.isNaN(price) || price <= 0) return { error: "กรุณาใส่ราคาต่อบาททองคำ" };
  const { data, error } = await supabase.rpc("add_gold_valuation", {
    p_asset_id: id, p_date: str(form.get("valuation_date")), p_price_per_baht: price,
    p_method: str(form.get("valuation_method")) ?? "LATEST_TRANSACTION", p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath("/alternative");
  revalidatePath(`/alternative/${id}`);
  return { ok: `บันทึกมูลค่า ${Number(data).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาทแล้ว` };
}

// ---------------------------------------------------------------- แท็บ "บันทึกรับผลตอบแทน/อัพเดตมูลค่า" (ตกลง 27 ต.ค. 2026)
// บันทึกเป็น INSERT เดียวหลายแถว → ผิดแถวเดียว = ไม่บันทึกเลย

/** รับผลตอบแทนหลายรายการ: รายได้ "อื่น ๆ" ผูกสินทรัพย์ (แบ่งตามเจ้าของ) · สกุล = สกุลของบัญชีที่รับ */
export async function batchAltIncome(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const date = str(form.get("date"));
  const rows = readRows<{ asset_id: string; label: string; amount: string; tax: string; bank_asset_id: string; notes: string }>(form);
  if (!rows) return { error: BAD_ROWS_ERROR };
  if (!date) return { error: "กรุณาเลือกวันที่รับ" };
  if (!rows.length) return { error: "กรุณากรอกยอดอย่างน้อย 1 รายการ" };
  const banks = [...new Set(rows.map((r) => r.bank_asset_id).filter(Boolean))];
  const { data: accs } = banks.length ? await supabase.from("assets").select("id,currency").in("id", banks) : { data: [] };
  const ccy = new Map((accs ?? []).map((a) => [a.id as string, a.currency as string]));
  const clean = rows.map((r) => ({ label: r.label, asset_id: r.asset_id, amount: amountOrNull(r.amount), tax: amountOrNull(r.tax),
    received_to_asset_id: r.bank_asset_id || null, currency: ccy.get(r.bank_asset_id) ?? null, notes: r.notes?.trim() || null }));
  for (const r of clean) {
    if (!isPositive(r.amount)) return { error: `${r.label} · ยอดที่ได้รับต้องเป็นตัวเลขมากกว่า 0` };
    if (!isValidTax(r.tax) || (r.tax ?? 0) > r.amount) return { error: `${r.label} · ${TAX_ERROR} และไม่เกินยอดที่ได้รับ` };
    if (!r.received_to_asset_id || !r.currency) return { error: `${r.label} · กรุณาเลือกบัญชีที่รับ` };
  }
  const { error } = await supabase.from("income_transactions").insert(clean.map(({ label, ...r }) => ({
    ...r, income_type: "OTHER", date, notes: r.notes ? `ผลตอบแทน · ${label} · ${r.notes}` : `ผลตอบแทน · ${label}`,
  })));
  if (error) return { error: notSaved("ทุกรายการ", friendlyError(error.message)) };
  revalidatePath("/alternative", "layout");
  revalidatePath("/income-expenses");
  revalidatePath("/financial/cash", "layout");
  revalidatePath("/");
  return { ok: `บันทึกรับผลตอบแทนแล้ว ${clean.length} รายการ` };
}

/** มูลค่าใหม่หลายรายการ (วันที่ / วิธีประเมินเดียวทั้งชุด) */
export async function batchAltValues(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const date = str(form.get("date"));
  const method = str(form.get("method")) ?? "USER_ESTIMATE";
  if (!["USER_ESTIMATE", "APPRAISAL", "LATEST_TRANSACTION"].includes(method)) return { error: BAD_ROWS_ERROR };
  const rows = readRows<{ asset_id: string; label: string; value: string }>(form);
  if (!rows) return { error: BAD_ROWS_ERROR };
  if (!date) return { error: "กรุณาเลือกวันที่ประเมิน" };
  if (!rows.length) return { error: "กรุณากรอกมูลค่าอย่างน้อย 1 รายการ" };
  const clean = rows.map((r) => ({ label: r.label, asset_id: r.asset_id, value: Number(plainNumber(r.value)) }));
  const bad = clean.find((r) => !plainNumber(String(r.value)) || Number.isNaN(r.value) || r.value < 0);
  if (bad) return { error: `${bad.label} · มูลค่าต้องเป็นตัวเลข (ไม่ติดลบ)` };
  const { error } = await supabase.from("asset_valuations").insert(clean.map((r) => ({
    asset_id: r.asset_id, valuation_date: date, value: r.value, valuation_method: method, source: method === "APPRAISAL" ? "APPRAISAL" : "USER",
  })));
  if (error) return { error: notSaved("ทุกรายการ", friendlyError(error.message)) };
  revalidatePath("/alternative", "layout");
  revalidatePath("/");
  return { ok: `บันทึกมูลค่าแล้ว ${clean.length} รายการ` };
}
