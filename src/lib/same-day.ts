import type { createClient } from "@/lib/supabase/server";

type Sb = Awaited<ReturnType<typeof createClient>>;

/**
 * อัปเดตยอดซ้ำวันเดิม = แทนแถวเดิม (ตกลง 9 พ.ย. 2026 · SQL 20261109230000)
 *   เรียกหลังบันทึกยอด / มูลค่าใหม่สำเร็จ → แถวเก่าของทรัพย์สินเดียวกัน วันเดียวกัน ถูกลบแบบ soft delete
 *   ฐานข้อมูลตรวจเอง: แถวล่าสุดของวันนั้นต้องเป็นของผู้ใช้คนนี้ที่เพิ่งบันทึก · ไม่แตะยอดตั้งต้น / กระทบยอด / แถวที่ผูกกับรายการอื่น
 *   คืนข้อความเตือน (ยอดใหม่บันทึกแล้ว แต่แถวเก่ายังอยู่) หรือ null
 */
export async function replaceSameDay(supabase: Sb, assetIds: string[], date: string | null): Promise<string | null> {
  if (!date) return null;
  const results = await Promise.all([...new Set(assetIds)].map((id) =>
    supabase.rpc("replace_same_day_valuation", { p_asset_id: id, p_date: date })));
  return results.some((r) => r.error) ? "บันทึกยอดใหม่แล้ว แต่ลบยอดเดิมของวันเดียวกันไม่สำเร็จ — ลบแถวเดิมเองได้ในประวัติ" : null;
}
