"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, strOrNull as str } from "@/lib/format";
import { endpointFromForm, missingEndpoint } from "@/lib/money-endpoint";

export type TradeState = { error?: string; ok?: string };

function refresh(form: FormData) {
  String(form.get("paths") ?? "").split(",").filter(Boolean).forEach((p) => revalidatePath(p));
  revalidatePath("/");
  revalidatePath("/financial/cash", "layout");
}

type Receipt = { bank_asset_id: string; amount: number; note: string | null };
type Cost = { label: string; amount: number; pay: "DEDUCT" | "BANK" | "CARD"; bank_asset_id?: string; card_id?: string };

/** รับเงิน / ค่าใช้จ่ายหลายรายการจากฟอร์มขาย / รื้อถอน (ช่องซ่อน receipts / costs เป็น JSON · ตกลง 29 ต.ค. 2026)
 *  ค่าใช้จ่าย pay: "DEDUCT" = หักจากเงินที่ได้รับ · "a:<id>" = จ่ายจากบัญชี · "c:<id>" = จ่ายจากบัตร */
function linesFromForm(form: FormData): { receipts: Receipt[]; costs: Cost[] } | { error: string } {
  const parse = (k: string): Record<string, unknown>[] | null => {
    try { const v = JSON.parse(String(form.get(k) ?? "[]")); return Array.isArray(v) ? v : null; } catch { return null; }
  };
  const rs = parse("receipts"), cs = parse("costs");
  if (!rs || !cs) return { error: "รายการรับเงิน / ค่าใช้จ่ายไม่ถูกต้อง" };
  const amt = (v: unknown) => num(String(v ?? ""));
  const receipts: Receipt[] = [];
  for (const [i, r] of rs.entries()) {
    const a = amt(r.amount);
    if (!r.bank && (a === null || a === 0)) continue;   // แถวว่าง
    if (a === null || Number.isNaN(a) || a <= 0) return { error: `รับเงินแถวที่ ${i + 1}: ใส่จำนวนเงินมากกว่า 0` };
    if (!r.bank) return { error: `รับเงินแถวที่ ${i + 1}: เลือกบัญชีที่รับเงิน` };
    receipts.push({ bank_asset_id: String(r.bank), amount: a, note: str(String(r.note ?? "")) });
  }
  const costs: Cost[] = [];
  for (const [i, c] of cs.entries()) {
    const a = amt(c.amount);
    const label = String(c.label ?? "").trim();
    if (!label && (a === null || a === 0)) continue;
    if (a === null || Number.isNaN(a) || a <= 0) return { error: `ค่าใช้จ่ายแถวที่ ${i + 1}: ใส่จำนวนเงินมากกว่า 0` };
    if (!label) return { error: `ค่าใช้จ่ายแถวที่ ${i + 1}: ใส่รายการ` };
    const pay = String(c.pay ?? "DEDUCT");
    if (pay.startsWith("a:")) costs.push({ label, amount: a, pay: "BANK", bank_asset_id: pay.slice(2) });
    else if (pay.startsWith("c:")) costs.push({ label, amount: a, pay: "CARD", card_id: pay.slice(2) });
    else costs.push({ label, amount: a, pay: "DEDUCT" });
  }
  return { receipts, costs };
}
const total = (xs: { amount: number }[]) => Math.round(xs.reduce((t, x) => t + x.amount, 0) * 100) / 100;

/** ขายทรัพย์สิน (อสังหาฯ / สินทรัพย์อื่น / ธุรกิจ) → เงินเข้าบัญชี + สถานะขายแล้ว · Alternative ขายบางส่วนได้ (จำนวนน้อยกว่าที่ถือ)
 *  รับเงินได้หลายบัญชี · ค่าใช้จ่ายหลายรายการ (หักจากเงินที่ได้รับ / จ่ายจากบัญชี / บัตร) */
export async function sellAsset(_: TradeState, form: FormData): Promise<TradeState> {
  const lines = linesFromForm(form);
  if ("error" in lines) return { error: lines.error };
  const deducted = total(lines.costs.filter((c) => c.pay === "DEDUCT"));
  const price = total(lines.receipts) + deducted;
  if (price <= 0) return { error: "กรุณาใส่เงินที่ได้รับจากการขาย" };
  if (form.get("confirm") !== "on") return { error: "กรุณาติ๊กยืนยันการขาย" };
  const supabase = await createClient();
  // Property: ขายบางแถว (ที่ดินบางแปลง / อาคาร) → end_property_components · ติ๊กครบทุกแถว = ขายทั้งทรัพย์สิน
  if (form.get("scope") === "part") return endComponents(supabase, form, "SELL", lines);
  // Alternative ที่มีจำนวน: ขายน้อยกว่าที่ถือ = ขายบางส่วน · เท่ากับที่ถือ = ขายทั้งรายการ
  const totalQty = num(form.get("total_quantity"));
  if (totalQty !== null && totalQty > 0) {
    const qty = num(form.get("quantity"));
    if (qty === null || Number.isNaN(qty) || qty <= 0) return { error: "กรุณาใส่จำนวนที่ขาย" };
    if (qty > totalQty) return { error: "ขายเกินจำนวนที่ถืออยู่ไม่ได้" };
    if (qty < totalQty) {
      if (lines.receipts.length > 1 || lines.costs.some((c) => c.pay !== "DEDUCT"))
        return { error: "ขายบางส่วน: รับเงินได้บัญชีเดียว และค่าใช้จ่ายต้องหักจากเงินที่ได้รับ (จ่ายจากบัญชีอื่นให้บันทึกเป็นค่าใช้จ่ายแยก)" };
      const { error } = await supabase.rpc("sell_alternative_part", {
        p_asset_id: String(form.get("asset_id")), p_date: str(form.get("date")), p_quantity: qty, p_price: price,
        p_fee: deducted || null, p_bank_asset_id: lines.receipts[0]?.bank_asset_id ?? null, p_notes: str(form.get("notes")),
      });
      if (error) return { error: friendlyError(error.message) };
      refresh(form);
      return { ok: "บันทึกการขายบางส่วนแล้ว" };
    }
  }
  const { error } = await supabase.rpc("sell_asset", {
    p_asset_id: String(form.get("asset_id")), p_date: str(form.get("date")), p_receipts: lines.receipts, p_costs: lines.costs,
    p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  refresh(form);
  return { ok: "บันทึกการขายแล้ว" };
}

/** Property: รื้อถอนอาคาร / สิ่งปลูกสร้าง (ขาดทุนเท่ามูลค่าเดิม · ขายเศษวัสดุได้ · ค่าจ้างรื้อถอนจ่ายจากบัญชี / บัตรได้) */
export async function demolishComponents(_: TradeState, form: FormData): Promise<TradeState> {
  const lines = linesFromForm(form);
  if ("error" in lines) return { error: lines.error };
  if (form.get("confirm") !== "on") return { error: "กรุณาติ๊กยืนยันการรื้อถอน" };
  return endComponents(await createClient(), form, "DEMOLISH", lines);
}

async function endComponents(supabase: Awaited<ReturnType<typeof createClient>>, form: FormData, kind: "SELL" | "DEMOLISH",
  lines: { receipts: Receipt[]; costs: Cost[] }): Promise<TradeState> {
  const ids = form.getAll("comp").map(String).filter(Boolean);
  if (ids.length === 0) return { error: kind === "SELL" ? "เลือกแถวที่ขายอย่างน้อย 1 แถว" : "เลือกอาคาร / สิ่งปลูกสร้างที่รื้อถอน" };
  const book = form.has("book_value") ? num(form.get("book_value")) : null;
  if (form.has("book_value") && (book === null || Number.isNaN(book) || book < 0)) return { error: "กรุณาใส่มูลค่าเดิมของแถวที่เลือก" };
  const { error } = await supabase.rpc("end_property_components", {
    p_asset_id: String(form.get("asset_id")), p_kind: kind, p_component_ids: ids, p_date: str(form.get("date")),
    p_receipts: lines.receipts, p_costs: lines.costs, p_book_value: book, p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  refresh(form);
  return { ok: kind === "DEMOLISH" ? "บันทึกการรื้อถอนแล้ว" : form.get("all_rows") === "1" ? "บันทึกการขายทั้งทรัพย์สินแล้ว" : "บันทึกการขายบางแถวแล้ว" };
}

/** Property: ยกเลิกการขายบางแถว / รื้อถอน (เฉพาะครั้งล่าสุด) */
export async function undoComponentEvent(_: TradeState, form: FormData): Promise<TradeState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("undo_property_component_event", { p_event_id: String(form.get("event_id")) });
  if (error) return { error: friendlyError(error.message) };
  refresh(form);
  return { ok: "ยกเลิกแล้ว" };
}

/** จ่ายเงินซื้อ / จ่ายเพิ่ม (เงินออกจากบัญชีไปเป็นทรัพย์สิน — ไม่ใช่ค่าใช้จ่าย) */
export async function payForAsset(_: TradeState, form: FormData): Promise<TradeState> {
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่จำนวนเงิน" };
  const property = form.get("property") === "1";
  // Property: จ่ายจากบัญชี / บัตรเครดิต / เงินสด (ตกลง 29 ต.ค. 2026) · อื่น ๆ: บัญชีเท่านั้น
  const pay = property ? endpointFromForm(form) : { kind: "bank" as const, id: str(form.get("bank_asset_id")) };
  const missing = missingEndpoint(pay);
  if (missing) return { error: missing };
  const bank = pay.kind === "bank" ? pay.id : null;
  const cashPerson = pay.kind === "cash" ? str(form.get("person_id")) : null;
  if (pay.kind === "cash" && !cashPerson) return { error: "กรุณาเลือกผู้จ่าย" };
  const supabase = await createClient();
  const { data: b } = bank ? await supabase.from("assets").select("currency").eq("id", bank).maybeSingle() : { data: null };
  const addValue = property && form.get("add_value") === "on";
  const assetId = String(form.get("asset_id"));
  const pick = property ? componentFromForm(form) : null;
  if (pick && "error" in pick) return { error: pick.error };
  if (pick && !pick.id && !pick.create) return { error: "กรุณาเลือกแถวของรายการจ่าย (ที่ดิน / อาคาร / แถวใหม่)" };
  // Property: pay_property = รายการจ่าย (+ แถวส่วนประกอบใหม่) ในคราวเดียว · มูลค่าใหม่ = มูลค่าล่าสุด + ยอดจ่าย (trigger a70_property_pay_value)
  const { data: mv, error } = property
    ? await supabase.rpc("pay_property", {
        p_asset_id: assetId, p_bank_asset_id: bank, p_date: str(form.get("date")), p_amount: amount, p_fee: bank ? num(form.get("fee")) : null,
        p_description: str(form.get("description")), p_add_value: addValue, p_component_id: pick?.id ?? null, p_new_component: pick?.create ?? null,
        p_card_id: pay.kind === "card" ? pay.id : null, p_cash_person_id: cashPerson,
      }).then((r) => ({ data: r.data ? { id: String(r.data) } : null, error: r.error }))
    : await supabase.from("cash_movements").insert({
        movement_date: str(form.get("date")), movement_type: "ASSET_PURCHASE", from_asset_id: bank,
        to_asset_id: assetId, amount, fee: num(form.get("fee")), currency: b?.currency ?? "THB",
        description: str(form.get("description")) ?? "จ่ายซื้อทรัพย์สิน",
      }).select("id").single();
  if (error || !mv) return { error: friendlyError(error?.message ?? "บันทึกไม่สำเร็จ") };
  refresh(form);
  return { ok: addValue ? "บันทึกการจ่ายเงิน + เพิ่มมูลค่าแล้ว" : "บันทึกการจ่ายเงินแล้ว · ถ้ามูลค่าทรัพย์สินเปลี่ยน ให้อัปเดตมูลค่าด้วย" };
}

/** Property: รายการจ่ายนี้เป็นของส่วนประกอบไหน (id) หรือสร้างแถวใหม่ (create) · ไม่ระบุ = {} */
function componentFromForm(form: FormData): { id?: string; create?: Record<string, string | number | null> } | { error: string } {
  const pick = str(form.get("component"));
  if (!pick) return {};
  if (!pick.startsWith("new:")) return { id: pick };
  const type = pick.slice(4);
  const g = (k: string) => str(form.get(`nc_${k}`))?.replace(/,/g, "") ?? null;
  if (type === "LAND") {
    const rai = g("rai"), ngan = g("ngan"), wa = g("wa");
    const area = rai || ngan || wa ? (Number(rai) || 0) * 400 + (Number(ngan) || 0) * 100 + (Number(wa) || 0) : null;
    if (area !== null && !(area >= 0)) return { error: "เนื้อที่ต้องเป็นตัวเลข" };
    return { create: { type, title_deed_no: g("title_deed_no"), land_no: g("land_no"), land_area_sq_wa: area } };
  }
  const years = g("years") ? Number(g("years")) : 20;
  if (!Number.isInteger(years) || years < 1 || years > 100) return { error: "อายุใช้งานต้องเป็นจำนวนปีเต็ม 1–100" };
  return { create: { type, label: str(form.get("nc_label")), building_area_sqm: g("area"), useful_life_years: years } };
}

/** รายการจ่ายที่เลือกแถวแล้ว: ล้างติ๊กอาคารแบบเดิม (property_cost_items ผูกกับรายการจ่าย) — อาคาร / ไม่ใช่ ตามชนิดของแถว · คืนข้อความผิดพลาด หรือ null */
async function clearPaymentBuilding(supabase: Awaited<ReturnType<typeof createClient>>, movementId: string): Promise<string | null> {
  const { error } = await supabase.from("property_cost_items").update({ deleted_at: new Date().toISOString() })
    .eq("movement_id", movementId).is("deleted_at", null);
  return error ? friendlyError(error.message) : null;
}

/** แก้รายการจ่ายซื้อ / จ่ายเพิ่มของ Property: วันที่ / ยอด / รายละเอียด + อาคาร (มูลค่าที่ระบบเพิ่มให้ปรับตามเอง) */
export async function updatePropertyPayment(_: TradeState, form: FormData): Promise<TradeState> {
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่จำนวนเงิน" };
  const date = str(form.get("date"));
  if (!date) return { error: "กรุณาใส่วันที่" };
  const c = str(form.get("component"));
  if (!c || c.startsWith("new:")) return { error: "กรุณาเลือกแถวของรายการจ่าย" };
  const supabase = await createClient();
  const id = String(form.get("id"));
  const description = str(form.get("description"));
  // ติ๊ก "เพิ่มมูลค่า" ย้อนหลัง / เอาติ๊กออก → metadata.add_value (ฐานข้อมูลเพิ่ม / ลบมูลค่าให้)
  const { data: cur } = await supabase.from("cash_movements").select("metadata").eq("id", id).maybeSingle();
  const meta = { ...((cur?.metadata as Record<string, unknown> | null) ?? {}) };
  if (form.get("add_value") === "on") meta.add_value = true; else delete meta.add_value;
  // เปลี่ยนแถวของรายการจ่าย (มูลค่ารายแถวที่ระบบเพิ่มให้ย้ายตามในฐานข้อมูล)
  meta.component_id = c;
  const { data, error } = await supabase.from("cash_movements").update({ movement_date: date, amount, description, metadata: meta })
    .eq("id", id).eq("movement_type", "ASSET_PURCHASE").select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  refresh(form);
  // เลือกแถวแล้ว = อาคาร / ไม่ใช่อาคาร ตามแถวนั้น (ไม่ใช้ติ๊กอาคารแบบเดิม)
  const e2 = await clearPaymentBuilding(supabase, id);
  if (e2) return { error: `บันทึกรายการจ่ายแล้ว แต่ตั้งอาคารไม่สำเร็จ (${e2})` };
  return { ok: "บันทึกรายการจ่ายแล้ว" };
}
