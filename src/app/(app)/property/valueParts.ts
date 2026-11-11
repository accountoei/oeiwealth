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

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ส่วนประกอบ 1 แถวสำหรับวางแผนมูลค่าใหม่ · last = มูลค่าครั้งล่าสุด (null = ไม่รู้) · typed = ยอดที่พิมพ์ (null = ไม่ได้พิมพ์) */
export type PlanPart = { key: string; land: boolean; area: number | null; last: number | null; typed: number | null };

/**
 * ผลการวางแผน · total: null = ยังไม่ได้กรอก · NaN = กรอกรายแถวไม่ครบ
 * values: มูลค่าใหม่ครบทุกแถว (null = บันทึกยอดรวมอย่างเดียว → ระบบแบ่งรายแถวตามสัดส่วนเดิม)
 * auto: แถวที่ระบบเติมให้ (ที่ดินรับส่วนที่เหลือ) · est: ตัวเลขของแถว auto (แสดงแม้มี error)
 */
export type ValuePlan = { total: number | null; values: Record<string, number> | null; auto: string[]; est: Record<string, number>; error?: string };

export const VALUE_PLAN_ERROR = {
  NEG_LAND: "ยอดรวมน้อยกว่ามูลค่าสิ่งปลูกสร้าง",
  MISMATCH: "ยอดรวมไม่เท่าผลรวมรายแถว",
  INCOMPLETE: "ครั้งก่อนไม่มีมูลค่ารายแถว ต้องกรอกให้ครบทุกแถว",
} as const;

/**
 * มูลค่าใหม่ของทรัพย์สินที่มีส่วนประกอบ (ตกลง 28–30 ต.ค. 2026 · กติกาเดียวทั้งหน้าทรัพย์สินและแท็บอัปเดตมูลค่า)
 * - พิมพ์ยอดรวม → สิ่งปลูกสร้าง (และที่ดินที่พิมพ์เอง) ใช้ยอดที่พิมพ์ / ยอดล่าสุด · ที่ดินที่ไม่ได้พิมพ์รับส่วนที่เหลือ แบ่งตามเนื้อที่
 *   ไม่มีที่ดินที่ไม่ได้พิมพ์ → แถวเดียวที่ไม่ได้พิมพ์รับส่วนที่เหลือ · ไม่มีเลย → ผลรวมรายแถวต้องเท่ายอดรวม
 *   แถวอื่นไม่รู้ยอดล่าสุด → บันทึกยอดรวมอย่างเดียว
 * - พิมพ์เฉพาะรายแถว → แถวที่ไม่ได้พิมพ์ = ยอดล่าสุด · ยอดรวม = ผลรวม (ไม่รู้ยอดล่าสุดบางแถว = ต้องกรอกให้ครบ)
 */
export function planValueParts(parts: PlanPart[], typedTotal: number | null): ValuePlan {
  const anyTyped = parts.some((p) => p.typed != null);
  if (typedTotal == null && !anyTyped) return { total: null, values: null, auto: [], est: {} };
  const eff = new Map(parts.map((p) => [p.key, p.typed ?? p.last]));
  const known = (p: PlanPart) => eff.get(p.key) != null;
  const all = () => Object.fromEntries(parts.map((p) => [p.key, Number(eff.get(p.key))]));
  const sumOf = (ps: PlanPart[]) => round2(ps.reduce((t, p) => t + Number(eff.get(p.key) ?? 0), 0));
  if (typedTotal != null) {
    if (!parts.length) return { total: typedTotal, values: null, auto: [], est: {} };
    const untyped = parts.filter((p) => p.typed == null);
    const lands = untyped.some((p) => p.land) ? untyped.filter((p) => p.land) : untyped.length === 1 ? untyped : [];
    if (lands.length) {
      const others = parts.filter((p) => !lands.includes(p));
      if (!others.every(known)) return { total: typedTotal, values: null, auto: [], est: {} };
      const share = splitByArea(round2(typedTotal - sumOf(others)), lands.map((p) => p.area ?? 0));
      lands.forEach((p, i) => eff.set(p.key, share[i]));
      const auto = lands.map((p) => p.key), est = Object.fromEntries(lands.map((p, i) => [p.key, share[i]]));
      if (share.some((v) => v < 0)) return { total: typedTotal, values: null, auto, est, error: VALUE_PLAN_ERROR.NEG_LAND };
      return { total: typedTotal, values: all(), auto, est };
    }
    if (!anyTyped) return { total: typedTotal, values: null, auto: [], est: {} };
    if (!parts.every(known) || Math.abs(sumOf(parts) - typedTotal) > 0.005)
      return { total: typedTotal, values: null, auto: [], est: {}, error: VALUE_PLAN_ERROR.MISMATCH };
    return { total: typedTotal, values: all(), auto: [], est: {} };
  }
  if (!parts.every(known)) return { total: NaN, values: null, auto: [], est: {}, error: VALUE_PLAN_ERROR.INCOMPLETE };
  return { total: sumOf(parts), values: all(), auto: [], est: {} };
}
