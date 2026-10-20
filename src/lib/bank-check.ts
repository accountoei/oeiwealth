"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";

// ตรวจยอดคงเหลือก่อนบันทึกเงินออกจากบัญชีธนาคาร (ใช้กับ <BalanceGuard> ในฟอร์มเงินออกทุกฟอร์ม)
//   ยอด ณ วันที่ทำรายการ − ยอดที่จะออก · และวันถัดไปที่บัญชีนี้มีรายการ (ถึง Statement ถัดไป) — ติดลบวันไหนก็เตือน
//   อ่านอย่างเดียว (RLS เดิม) · ไม่บล็อกการบันทึก: ผู้ใช้กดยืนยันแล้วบันทึกต่อได้
export type BalanceCheck = {
  name: string; currency: string;
  /** ยอดหลังรายการนี้ ณ วันที่ทำรายการ */
  at: number;
  /** วันถัดไปที่ยอดต่ำสุด (ถ้าติดลบ) */
  low: { date: string; value: number } | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function checkBankOutflow(assetId: string, date: string, amount: number): Promise<BalanceCheck | null> {
  await requireAppUser();
  if (!UUID.test(assetId) || !YMD.test(date) || !(amount > 0)) return null;
  const supabase = await createClient();
  const [{ data: acc }, { data: nextStmt }] = await Promise.all([
    supabase.from("v_bank_accounts_safe").select("name,currency").eq("asset_id", assetId).maybeSingle(),
    // Statement ถัดไปหลังวันที่ทำรายการ = ยอดจริงตั้งใหม่ → ตรวจถึงก่อนวันนั้น
    supabase.from("asset_valuations").select("valuation_date").eq("asset_id", assetId).is("deleted_at", null)
      .gt("valuation_date", date).order("valuation_date").limit(1).maybeSingle(),
  ]);
  if (!acc) return null;
  let q = supabase.from("cash_movements").select("movement_date").is("deleted_at", null)
    .or(`from_asset_id.eq.${assetId},to_asset_id.eq.${assetId}`).gt("movement_date", date)
    .order("movement_date").limit(200);
  if (nextStmt?.valuation_date) q = q.lt("movement_date", nextStmt.valuation_date);
  const { data: later } = await q;
  const dates = [date, ...new Set((later ?? []).map((m) => m.movement_date as string))].slice(0, 31);
  const bal = await Promise.all(dates.map(async (d) => {
    const { data } = await supabase.rpc("bank_balances_at", { p_date: d });
    const row = ((data as { asset_id: string; calculated: number | null }[] | null) ?? []).find((r) => r.asset_id === assetId);
    return row?.calculated == null ? null : Number(row.calculated) - amount;
  }));
  if (bal[0] == null) return null;                         // ยังไม่มียอดตั้งต้น → ตรวจไม่ได้
  let low: BalanceCheck["low"] = null;
  bal.slice(1).forEach((v, i) => { if (v != null && v < -0.005 && (!low || v < low.value)) low = { date: dates[i + 1], value: v }; });
  return { name: acc.name as string, currency: acc.currency as string, at: bal[0], low };
}
