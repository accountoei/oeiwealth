import type { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, strOrNull as str } from "@/lib/format";

/**
 * ฟอร์มเพิ่มทรัพย์สินใหม่ (Property / Alternative · ได้มาหลัง Go-live): ช่อง "จ่ายจากบัญชี" (ไม่บังคับ · ตกลง 27 ต.ค. 2026)
 * ใช้ "ราคาที่ได้มา" + "วันที่ได้มา" เป็นยอด / วันที่เงินออก (ไม่มีช่องจำนวนเงินแยก)
 */
export function payFromForm(form: FormData): { bank: string; amount: number; date: string } | { error: string } | null {
  const bank = str(form.get("pay_bank_asset_id"));
  if (!bank || form.get("is_opening") === "on") return null;
  const amount = num(form.get("acquisition_cost"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "เลือกบัญชีที่จ่ายแล้ว กรุณาใส่ราคาที่ได้มา (ใช้เป็นยอดเงินออกจากบัญชี)" };
  const date = str(form.get("acquisition_date"));
  if (!date) return { error: "กรุณาใส่วันที่ได้มา (ใช้เป็นวันที่เงินออกจากบัญชี)" };
  return { bank, amount, date };
}

/** บันทึกเงินออก "ซื้อทรัพย์สิน" (แบบเดียวกับปุ่ม + จ่ายซื้อ / จ่ายเพิ่ม) · คืนข้อความผิดพลาด หรือ null */
export async function recordAssetPurchase(supabase: Awaited<ReturnType<typeof createClient>>, assetId: string, pay: { bank: string; amount: number; date: string }): Promise<string | null> {
  const { data: b } = await supabase.from("assets").select("currency").eq("id", pay.bank).maybeSingle();
  const { error } = await supabase.from("cash_movements").insert({
    movement_date: pay.date, movement_type: "ASSET_PURCHASE", from_asset_id: pay.bank, to_asset_id: assetId,
    amount: pay.amount, currency: b?.currency ?? "THB", description: "จ่ายซื้อทรัพย์สิน",
  });
  return error ? friendlyError(error.message) : null;
}
