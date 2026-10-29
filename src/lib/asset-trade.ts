"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, strOrNull as str } from "@/lib/format";

export type TradeState = { error?: string; ok?: string };

function refresh(form: FormData) {
  String(form.get("paths") ?? "").split(",").filter(Boolean).forEach((p) => revalidatePath(p));
  revalidatePath("/");
  revalidatePath("/financial/cash", "layout");
}

/** ขายทรัพย์สิน (อสังหาฯ / สินทรัพย์อื่น / ธุรกิจ) → เงินเข้าบัญชี + สถานะขายแล้ว · Alternative ขายบางส่วนได้ (จำนวนน้อยกว่าที่ถือ) */
export async function sellAsset(_: TradeState, form: FormData): Promise<TradeState> {
  const price = num(form.get("price"));
  if (price === null || Number.isNaN(price) || price < 0) return { error: "กรุณาใส่ราคาขายเป็นตัวเลข" };
  const fee = num(form.get("fee"));
  if (fee !== null && (Number.isNaN(fee) || fee < 0 || fee > price)) return { error: "ค่าใช้จ่ายในการขายไม่ถูกต้อง" };
  if (form.get("confirm") !== "on") return { error: "กรุณาติ๊กยืนยันการขาย" };
  const supabase = await createClient();
  // Property: ขายบางแถว (ที่ดินบางแปลง / อาคาร) → end_property_components · แถวที่เหลือยังถืออยู่
  if (form.get("scope") === "part") return endComponents(supabase, form, "SELL", price, fee);
  // Alternative ที่มีจำนวน: ขายน้อยกว่าที่ถือ = ขายบางส่วน · เท่ากับที่ถือ = ขายทั้งรายการ
  const total = num(form.get("total_quantity"));
  if (total !== null && total > 0) {
    const qty = num(form.get("quantity"));
    if (qty === null || Number.isNaN(qty) || qty <= 0) return { error: "กรุณาใส่จำนวนที่ขาย" };
    if (qty > total) return { error: "ขายเกินจำนวนที่ถืออยู่ไม่ได้" };
    if (qty < total) {
      const { error } = await supabase.rpc("sell_alternative_part", {
        p_asset_id: String(form.get("asset_id")), p_date: str(form.get("date")), p_quantity: qty, p_price: price,
        p_fee: fee, p_bank_asset_id: str(form.get("bank_asset_id")), p_notes: str(form.get("notes")),
      });
      if (error) return { error: friendlyError(error.message) };
      refresh(form);
      return { ok: "บันทึกการขายบางส่วนแล้ว" };
    }
  }
  const { error } = await supabase.rpc("sell_asset", {
    p_asset_id: String(form.get("asset_id")), p_date: str(form.get("date")), p_price: price,
    p_bank_asset_id: str(form.get("bank_asset_id")), p_fee: fee, p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  refresh(form);
  return { ok: "บันทึกการขายแล้ว" };
}

/** Property: รื้อถอนอาคาร / สิ่งปลูกสร้าง (ขาดทุนเท่ามูลค่าเดิม · ขายเศษวัสดุได้) */
export async function demolishComponents(_: TradeState, form: FormData): Promise<TradeState> {
  const price = num(form.get("price")) ?? 0;
  if (Number.isNaN(price) || price < 0) return { error: "ราคาขายเศษวัสดุไม่ถูกต้อง" };
  const fee = num(form.get("fee"));
  if (fee !== null && (Number.isNaN(fee) || fee < 0 || fee > price)) return { error: "ค่าใช้จ่ายไม่ถูกต้อง (ต้องไม่เกินราคาขายเศษวัสดุ)" };
  if (form.get("confirm") !== "on") return { error: "กรุณาติ๊กยืนยันการรื้อถอน" };
  return endComponents(await createClient(), form, "DEMOLISH", price, fee);
}

async function endComponents(supabase: Awaited<ReturnType<typeof createClient>>, form: FormData, kind: "SELL" | "DEMOLISH",
  price: number, fee: number | null): Promise<TradeState> {
  const ids = form.getAll("comp").map(String).filter(Boolean);
  if (ids.length === 0) return { error: kind === "SELL" ? "เลือกแถวที่ขายอย่างน้อย 1 แถว" : "เลือกอาคาร / สิ่งปลูกสร้างที่รื้อถอน" };
  const book = form.has("book_value") ? num(form.get("book_value")) : null;
  if (form.has("book_value") && (book === null || Number.isNaN(book) || book < 0)) return { error: "กรุณาใส่มูลค่าเดิมของแถวที่เลือก" };
  const { error } = await supabase.rpc("end_property_components", {
    p_asset_id: String(form.get("asset_id")), p_kind: kind, p_component_ids: ids, p_date: str(form.get("date")), p_price: price,
    p_fee: fee, p_bank_asset_id: str(form.get("bank_asset_id")), p_book_value: book, p_notes: str(form.get("notes")),
  });
  if (error) return { error: friendlyError(error.message) };
  refresh(form);
  return { ok: kind === "SELL" ? "บันทึกการขายบางแถวแล้ว" : "บันทึกการรื้อถอนแล้ว" };
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
  const bank = str(form.get("bank_asset_id"));
  if (!bank) return { error: "กรุณาเลือกบัญชีที่จ่าย" };
  const supabase = await createClient();
  const { data: b } = await supabase.from("assets").select("currency").eq("id", bank).maybeSingle();
  const property = form.get("property") === "1";
  const addValue = property && form.get("add_value") === "on";
  const assetId = String(form.get("asset_id"));
  const pick = property ? componentFromForm(form) : null;
  if (pick && "error" in pick) return { error: pick.error };
  if (pick && !pick.id && !pick.create) return { error: "กรุณาเลือกแถวของรายการจ่าย (ที่ดิน / อาคาร / แถวใหม่)" };
  // Property: pay_property = รายการจ่าย (+ แถวส่วนประกอบใหม่) ในคราวเดียว · มูลค่าใหม่ = มูลค่าล่าสุด + ยอดจ่าย (trigger a70_property_pay_value)
  const { data: mv, error } = property
    ? await supabase.rpc("pay_property", {
        p_asset_id: assetId, p_bank_asset_id: bank, p_date: str(form.get("date")), p_amount: amount, p_fee: num(form.get("fee")),
        p_description: str(form.get("description")), p_add_value: addValue, p_component_id: pick?.id ?? null, p_new_component: pick?.create ?? null,
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
