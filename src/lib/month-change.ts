import { cachedRpc } from "@/lib/data-cache";
import { addDays } from "@/lib/format";

/** รายการความมั่งคั่งสุทธิของเดือน (month_family_items / month_person_items) */
export type NwItem = { item_type: string; item_group: string; base_value: number | null };

/** วันแรกของเดือนก่อนเดือนของ today (YYYY-MM-01) */
export function prevMonthStart(today: string): string {
  return `${addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
}

/**
 * มูลค่าสินทรัพย์ของหมวด ณ สิ้นเดือนก่อน (THB · ชุดเดียวกับ Dashboard: ปิดเดือนแล้ว = ยอดที่ปิด · จำผลไว้)
 *   group: INVESTMENT · ALTERNATIVE · BUSINESS · LOANS · PROPERTY …  · personId = ส่วนของสมาชิกคนนั้น
 */
export async function prevMonthValue(today: string, personId: string, group: string): Promise<number> {
  const p_month = prevMonthStart(today);
  const items = personId
    ? await cachedRpc<NwItem[]>("month_person_items", { p_month, p_person: personId })
    : await cachedRpc<NwItem[]>("month_family_items", { p_month });
  return (items ?? []).filter((i) => i.item_type === "ASSET" && i.item_group === group).reduce((t, i) => t + Number(i.base_value ?? 0), 0);
}

/** % เปลี่ยนแปลงจากเดือนก่อน (ไม่มีข้อมูลเดือนก่อน = null) */
export function changePct(now: number, prev: number): number | null {
  return Math.abs(prev) < 0.005 ? null : ((now - prev) / Math.abs(prev)) * 100;
}
