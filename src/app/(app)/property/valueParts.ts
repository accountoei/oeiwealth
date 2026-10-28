/** มูลค่าแยกส่วน (โฉนด / อาคาร · ตกลง 28 ต.ค. 2026) — ใช้ทั้งฝั่งหน้าจอและ server action */
export type ValuePart = { type: "DEED" | "BUILDING" | "OTHER"; deed_id?: string | null; label?: string | null; value: number; source_movement_id?: string | null };

/** เฉลี่ยยอดตามเนื้อที่ (ปัด 2 ตำแหน่ง เศษไปใบสุดท้าย) · ไม่มีเนื้อที่เลย = เฉลี่ยเท่ากัน */
export function splitByArea(total: number, areas: number[]): number[] {
  if (areas.length === 0) return [];
  const sum = areas.reduce((t, a) => t + (a > 0 ? a : 0), 0);
  const w = sum > 0 ? areas.map((a) => (a > 0 ? a : 0) / sum) : areas.map(() => 1 / areas.length);
  const out = w.map((x) => Math.round(total * x * 100) / 100);
  out[out.length - 1] = Math.round((total - out.slice(0, -1).reduce((t, v) => t + v, 0)) * 100) / 100;
  return out;
}

export const partsSum = (parts: { value: number }[]) => Math.round(parts.reduce((t, p) => t + p.value, 0) * 100) / 100;
