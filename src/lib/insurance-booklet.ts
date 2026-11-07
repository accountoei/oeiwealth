/**
 * กรมธรรม์เล่มเดียวกัน (ตกลง 6 พ.ย. 2026): สัญญาเพิ่มเติม (เช่น สุขภาพ / มะเร็ง) บันทึกเป็นอีกรายการ
 *   บริษัท + เลขกรมธรรม์เดียวกัน = เล่มเดียวกัน → หน้าจอแสดงรวมเป็นเล่ม (IRR / ภาษี ยังแยกตามรายการ)
 *   รายการหลัก = ประกันชีวิตก่อน แล้วบำนาญ อุบัติเหตุ สุขภาพ ทรัพย์สิน (ประเภทเดียวกัน = ตามลำดับเดิม)
 *   ฐานข้อมูลใช้กติกาเดียวกันตอนผูกชุดการจ่าย (private.link_premium_payments)
 */
export type BookletPolicy = { id: string; insurance_type: string; insurer: string | null; policy_no: string | null };

/** ชื่อส่วนของเล่ม (หัวคอลัมน์ / ป้าย) */
export const PART_LABEL: Record<string, string> = { LIFE: "ชีวิต", ANNUITY: "บำนาญ", ACCIDENT: "อุบัติเหตุ", HEALTH: "สุขภาพ", PROPERTY: "ทรัพย์สิน" };
/** ลำดับในเล่ม (รายการหลัก = ลำดับน้อยสุด) */
export const partRank = (type: string) => ({ LIFE: 0, ANNUITY: 1, ACCIDENT: 2, HEALTH: 3, PROPERTY: 4 } as Record<string, number>)[type] ?? 9;

/** กุญแจของเล่ม: บริษัท (ไม่สนตัวพิมพ์ / ช่องว่างหัวท้าย) + เลขกรมธรรม์ (ไม่สนตัวพิมพ์ / ช่องว่าง) · ไม่มีเลข = ไม่ใช่เล่ม */
export function bookletKey(p: { insurer: string | null; policy_no: string | null }): string | null {
  const no = (p.policy_no ?? "").replace(/\s/g, "").toUpperCase();
  return no ? `${(p.insurer ?? "").trim().toLowerCase()}|${no}` : null;
}

/** เล่มที่มีมากกว่า 1 รายการ: กุญแจ → รายการในเล่ม (รายการหลักก่อน) */
export function bookletGroups<T extends BookletPolicy>(ps: T[]): Map<string, T[]> {
  const by = new Map<string, T[]>();
  ps.forEach((p) => { const k = bookletKey(p); if (k) by.set(k, [...(by.get(k) ?? []), p]); });
  const out = new Map<string, T[]>();
  by.forEach((xs, k) => {
    if (xs.length < 2) return;
    out.set(k, xs.map((p, i) => ({ p, i })).sort((a, b) => partRank(a.p.insurance_type) - partRank(b.p.insurance_type) || a.i - b.i).map((x) => x.p));
  });
  return out;
}

/** เรียงให้รายการในเล่มเดียวกันอยู่ติดกัน (รายการหลักก่อน) ณ ตำแหน่งของรายการแรกที่พบ · รายการอื่นคงลำดับเดิม */
export function bookletOrder<T extends BookletPolicy>(ps: T[]): T[] {
  const groups = bookletGroups(ps);
  const done = new Set<string>();
  const out: T[] = [];
  ps.forEach((p) => {
    const k = bookletKey(p);
    const g = k ? groups.get(k) : undefined;
    if (!g) { out.push(p); return; }
    if (done.has(k as string)) return;
    done.add(k as string);
    out.push(...g);
  });
  return out;
}

/** ตำแหน่งของรายการในเล่ม: main = รายการหลัก · rider = สัญญาเพิ่มเติม · null = ไม่อยู่ในเล่มที่มีหลายรายการ */
export function bookletRole<T extends BookletPolicy>(p: T, groups: Map<string, T[]>): { key: string; main: T; parts: T[]; isMain: boolean } | null {
  const k = bookletKey(p);
  const g = k ? groups.get(k) : undefined;
  if (!k || !g) return null;
  return { key: k, main: g[0], parts: g, isMain: g[0].id === p.id };
}

/** ชื่อส่วนในเล่ม: ประเภทของรายการ · สัญญาเพิ่มเติมประเภทเดียวกับรายการหลัก = "สัญญาเพิ่มเติม" */
export function partLabel(p: BookletPolicy, main: BookletPolicy): string {
  if (p.id !== main.id && p.insurance_type === main.insurance_type) return "สัญญาเพิ่มเติม";
  return PART_LABEL[p.insurance_type] ?? "สัญญาเพิ่มเติม";
}

/** จำนวนเล่ม (นับเล่มเดียวกันเป็น 1 ฉบับ) */
export function bookletCount(ps: BookletPolicy[]): number {
  const keys = new Set<string>();
  let n = 0;
  ps.forEach((p) => { const k = bookletKey(p); if (!k) n += 1; else if (!keys.has(k)) { keys.add(k); n += 1; } });
  return n;
}
