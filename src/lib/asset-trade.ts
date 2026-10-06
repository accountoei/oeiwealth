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

/** ขายทรัพย์สิน (อสังหาฯ / สินทรัพย์อื่น / ธุรกิจ) → เงินเข้าบัญชี + สถานะขายแล้ว */
export async function sellAsset(_: TradeState, form: FormData): Promise<TradeState> {
  const price = num(form.get("price"));
  if (price === null || Number.isNaN(price) || price < 0) return { error: "กรุณาใส่ราคาขายเป็นตัวเลข" };
  const fee = num(form.get("fee"));
  if (fee !== null && (Number.isNaN(fee) || fee < 0 || fee > price)) return { error: "ค่าใช้จ่ายในการขายไม่ถูกต้อง" };
  if (form.get("confirm") !== "on") return { error: "กรุณาติ๊กยืนยันการขาย" };
  const supabase = await createClient();
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
  const { error } = await supabase.from("cash_movements").insert({
    movement_date: str(form.get("date")), movement_type: "ASSET_PURCHASE", from_asset_id: bank,
    to_asset_id: String(form.get("asset_id")), amount, fee: num(form.get("fee")), currency: b?.currency ?? "THB",
    description: str(form.get("description")) ?? "จ่ายซื้อทรัพย์สิน",
  });
  if (error) return { error: friendlyError(error.message) };
  refresh(form);
  return { ok: "บันทึกการจ่ายเงินแล้ว · ถ้ามูลค่าทรัพย์สินเปลี่ยน ให้อัปเดตมูลค่าด้วย" };
}
