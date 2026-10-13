import { createClient } from "@/lib/supabase/server";
import { todayBangkok } from "@/lib/format";

export type PersonOpt = { id: string; name: string };

/** % สำหรับแสดง: ทศนิยมไม่เกิน 2 ตำแหน่ง (44.4444… → 44.44) */
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * ตัวกรอง "ดูทีละสมาชิก" (?p=) ที่ใช้ในหน้ารายการต่าง ๆ
 * - ไม่เลือก (ทั้งครอบครัว): ทุกรายการ สัดส่วน 100%
 * - เลือกสมาชิก: เฉพาะรายการที่คนนั้นมีส่วน · มูลค่า × สัดส่วน (ตรงกับ Dashboard รายบุคคล)
 *   ทรัพย์สิน = สัดส่วนเจ้าของ (v_asset_ownerships_active) · หนี้สิน / บัตร / เงินประกัน = จาก Net Worth Engine
 */
export async function loadPersonView(p: string | undefined, opts: { liabilities?: boolean } = {}) {
  const supabase = await createClient();
  const { data } = await supabase.from("persons").select("id,name,status").is("deleted_at", null).order("sort_order").order("created_at");
  // ตัวกรองไม่แสดงสมาชิก Archived (ยกเว้นคนที่กำลังเลือกอยู่ เช่น เปิดจากหน้าข้อมูลของคนนั้น)
  const persons = ((data ?? []) as (PersonOpt & { status: string })[])
    .filter((x) => x.status !== "DECEASED" || x.id === p).map(({ id, name }) => ({ id, name }));
  const personId = p && persons.some((x) => x.id === p) ? p : "";
  const personName = persons.find((x) => x.id === personId)?.name ?? "";
  const asset = new Map<string, number>();
  const assetShares = new Map<string, number>();   // ธุรกิจที่เก็บเจ้าของเป็นจำนวนหุ้น: หุ้นของคนที่เลือก
  const liability = new Map<string, number>();   // key: liability_id | credit_card_id | lease_id
  if (personId) {
    const today = todayBangkok();
    const [{ data: ao }, { data: li }] = await Promise.all([
      // เจ้าของทุกคนของทุกรายการ (ต้องใช้หุ้นรวมเพื่อคิดสัดส่วนแบบไม่ปัดเศษ — ชุดเดียวกับ Net Worth)
      supabase.from("asset_ownerships").select("asset_id,person_id,ownership_percent,shares,start_date,end_date").is("deleted_at", null),
      opts.liabilities
        ? supabase.from("v_net_worth_items_current").select("liability_id,credit_card_id,lease_id,ownership_percent")
            .eq("person_id", personId).eq("item_type", "LIABILITY")
        : Promise.resolve({ data: null }),
    ]);
    type O = { asset_id: string; person_id: string; ownership_percent: number; shares: number | null; start_date: string; end_date: string | null };
    const byAsset = new Map<string, O[]>();
    ((ao ?? []) as O[]).filter((o) => o.start_date <= today && (!o.end_date || o.end_date >= today))
      .forEach((o) => byAsset.set(o.asset_id, [...(byAsset.get(o.asset_id) ?? []), o]));
    for (const [aid, rows] of byAsset) {
      const mine = rows.filter((o) => o.person_id === personId);
      if (!mine.length) continue;
      // เจ้าของระบุหุ้นครบทุกคน → หุ้นของคน ÷ หุ้นรวม (ไม่ปัดเศษ) · ไม่งั้นใช้ % ที่บันทึก
      const byShares = rows.every((o) => o.shares != null);
      const total = rows.reduce((t, o) => t + Number(o.shares ?? 0), 0);
      const pct = byShares && total > 0
        ? (mine.reduce((t, o) => t + Number(o.shares), 0) * 100) / total
        : mine.reduce((t, o) => t + Number(o.ownership_percent), 0);
      asset.set(aid, pct);
      if (byShares) assetShares.set(aid, mine.reduce((t, o) => t + Number(o.shares), 0));
    }
    ((li ?? []) as { liability_id: string | null; credit_card_id: string | null; lease_id: string | null; ownership_percent: number | null }[])
      .forEach((l) => {
        const k = l.liability_id ?? l.credit_card_id ?? l.lease_id;
        if (k) liability.set(k, (liability.get(k) ?? 0) + Number(l.ownership_percent ?? 100));
      });
  }
  /** สัดส่วน 0–1 ของสมาชิกที่เลือก (ไม่เลือก = 1) */
  const assetShare = (id: string | null | undefined) => (!personId ? 1 : (asset.get(id ?? "") ?? 0) / 100);
  const liabilityShare = (id: string | null | undefined) => (!personId ? 1 : (liability.get(id ?? "") ?? 0) / 100);
  return {
    persons, personId, personName,
    /** แสดงรายการนี้ไหม */
    showAsset: (id: string | null | undefined) => !personId || asset.has(id ?? ""),
    showLiability: (id: string | null | undefined) => !personId || liability.has(id ?? ""),
    assetShare, liabilityShare,
    /** % สำหรับแสดง (null เมื่อไม่ได้เลือกสมาชิก หรือถือ 100%) */
    assetPct: (id: string | null | undefined) => (personId && (asset.get(id ?? "") ?? 0) < 99.99999 ? round2(asset.get(id ?? "") ?? 0) : null),
    /** จำนวนหุ้นของสมาชิกที่เลือก (ธุรกิจที่เก็บเจ้าของเป็นหุ้น · ไม่ใช่ = null) */
    assetShares: (id: string | null | undefined) => (personId ? assetShares.get(id ?? "") ?? null : null),
    liabilityPct: (id: string | null | undefined) => (personId && (liability.get(id ?? "") ?? 0) < 100 ? liability.get(id ?? "") ?? 0 : null),
    /** ตรงกับคนที่เลือกไหม (ใช้กับรายการที่มีเจ้าของคนเดียว เช่น บัตร / กรมธรรม์) */
    isPerson: (pid: string | null | undefined) => !personId || pid === personId,
  };
}
