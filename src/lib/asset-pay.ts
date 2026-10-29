import type { createClient } from "@/lib/supabase/server";
import { friendlyError, numOrNull as num, strOrNull as str } from "@/lib/format";

/**
 * ฟอร์มเพิ่มทรัพย์สินใหม่ (Property / Alternative · ได้มาหลัง Go-live): ช่อง "จ่ายจากบัญชี" (ไม่บังคับ · ตกลง 27 ต.ค. 2026)
 * ใช้ "ราคาที่ได้มา" + "วันที่ได้มา" เป็นยอด / วันที่เงินออก (ไม่มีช่องจำนวนเงินแยก)
 * Property (ตกลง 29 ต.ค. 2026): pay_mode = PAID (จ่ายครบ) · CREDIT (จ่ายบางส่วน ส่วนที่เหลือเป็นหนี้ "ค้างจ่ายค่าซื้อ") · NONE (ไม่มีเงินออก)
 *   CREDIT: ยอดเงินออก = เงินดาวน์ (down_payment · ไม่ใส่ = ไม่มีเงินออก)
 */
export function payFromForm(form: FormData): { bank: string; amount: number; date: string } | { error: string } | null {
  if (form.get("is_opening") === "on") return null;
  const mode = str(form.get("pay_mode"));
  if (mode === "NONE") return null;
  const bank = str(form.get("pay_bank_asset_id"));
  const date = str(form.get("acquisition_date"));
  if (mode === "CREDIT") {
    const down = num(form.get("down_payment"));
    if (down === null || down === 0) return null;
    if (Number.isNaN(down) || down < 0) return { error: "เงินดาวน์ต้องเป็นตัวเลขไม่ติดลบ" };
    if (!bank) return { error: "ใส่เงินดาวน์แล้ว กรุณาเลือกบัญชีที่จ่าย" };
    if (!date) return { error: "กรุณาใส่วันที่ได้มาในตารางส่วนประกอบ (ใช้เป็นวันที่เงินออกจากบัญชี)" };
    return { bank, amount: down, date };
  }
  if (!bank) return mode === "PAID" ? { error: "กรุณาเลือกบัญชีที่จ่าย" } : null;
  const amount = num(form.get("acquisition_cost"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "เลือกบัญชีที่จ่ายแล้ว กรุณาใส่ราคาที่ได้มา (ใช้เป็นยอดเงินออกจากบัญชี)" };
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
