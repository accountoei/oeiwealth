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
  const building = buildingFromForm(form);
  if ("error" in building) return { error: building.error };
  const assetId = String(form.get("asset_id"));
  const pick = property ? componentFromForm(form) : null;
  if (pick && "error" in pick) return { error: pick.error };
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
  if (property && !pick?.id && !pick?.create && building.isBuilding) {
    const e2 = await setPaymentBuilding(supabase, assetId, mv.id, building, str(form.get("description")));
    if (e2) return { error: `บันทึกการจ่ายแล้ว แต่ตั้งเป็นอาคารไม่สำเร็จ (${e2}) — แก้ที่รายการจ่ายได้` };
  }
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

type Building = { isBuilding: boolean; years: number };
function buildingFromForm(form: FormData): Building | { error: string } {
  const isBuilding = form.get("is_building") === "on";
  const years = num(form.get("depreciation_years")) ?? 20;
  if (isBuilding && (Number.isNaN(years) || !Number.isInteger(years) || years < 1 || years > 100)) return { error: "อายุอาคารต้องเป็นจำนวนปีเต็ม 1–100" };
  return { isBuilding, years };
}

/** ตั้ง / เลิกตั้ง รายการจ่ายของ Property เป็นอาคาร (property_cost_items ผูกกับรายการจ่าย · ยอด / วันที่ตามรายการจ่าย) · คืนข้อความผิดพลาด หรือ null */
async function setPaymentBuilding(supabase: Awaited<ReturnType<typeof createClient>>, assetId: string, movementId: string,
  b: Building, description: string | null): Promise<string | null> {
  const { data: cur } = await supabase.from("property_cost_items").select("id").eq("movement_id", movementId).is("deleted_at", null).maybeSingle();
  const { error } = cur
    ? (b.isBuilding
        ? await supabase.from("property_cost_items").update({ is_building: true, depreciation_years: b.years, description }).eq("id", cur.id)
        : await supabase.from("property_cost_items").update({ deleted_at: new Date().toISOString() }).eq("id", cur.id))
    : b.isBuilding
      ? await supabase.from("property_cost_items").insert({ asset_id: assetId, movement_id: movementId, is_building: true,
          depreciation_years: b.years, description, amount: 1, cost_date: "2000-01-01" })
      : { error: null };
  return error ? friendlyError(error.message) : null;
}

/** แก้รายการจ่ายซื้อ / จ่ายเพิ่มของ Property: วันที่ / ยอด / รายละเอียด + อาคาร (มูลค่าที่ระบบเพิ่มให้ปรับตามเอง) */
export async function updatePropertyPayment(_: TradeState, form: FormData): Promise<TradeState> {
  const amount = num(form.get("amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "กรุณาใส่จำนวนเงิน" };
  const date = str(form.get("date"));
  if (!date) return { error: "กรุณาใส่วันที่" };
  const building = buildingFromForm(form);
  if ("error" in building) return { error: building.error };
  const supabase = await createClient();
  const id = String(form.get("id"));
  const description = str(form.get("description"));
  // ติ๊ก "เพิ่มมูลค่า" ย้อนหลัง / เอาติ๊กออก → metadata.add_value (ฐานข้อมูลเพิ่ม / ลบมูลค่าให้)
  const { data: cur } = await supabase.from("cash_movements").select("metadata").eq("id", id).maybeSingle();
  const meta = { ...((cur?.metadata as Record<string, unknown> | null) ?? {}) };
  if (form.get("add_value") === "on") meta.add_value = true; else delete meta.add_value;
  // เปลี่ยนแถวของรายการจ่าย (มูลค่ารายแถวที่ระบบเพิ่มให้ย้ายตามในฐานข้อมูล)
  if (form.has("component")) { const c = str(form.get("component")); if (c && !c.startsWith("new:")) meta.component_id = c; else delete meta.component_id; }
  const { data, error } = await supabase.from("cash_movements").update({ movement_date: date, amount, description, metadata: meta })
    .eq("id", id).eq("movement_type", "ASSET_PURCHASE").select("id");
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: "คุณไม่มีสิทธิ์แก้ไขรายการนี้" };
  refresh(form);
  // เลือกแถวแล้ว = อาคาร / ไม่ใช่อาคาร ตามแถวนั้น (ไม่ใช้ติ๊กอาคารแบบเดิม)
  const e2 = await setPaymentBuilding(supabase, String(form.get("asset_id")), id, meta.component_id ? { isBuilding: false, years: 20 } : building, description);
  if (e2) return { error: `บันทึกรายการจ่ายแล้ว แต่ตั้งอาคารไม่สำเร็จ (${e2})` };
  return { ok: "บันทึกรายการจ่ายแล้ว" };
}
