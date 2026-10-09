import { createClient } from "@/lib/supabase/server";
import { todayBangkok } from "@/lib/format";

export type PersonOpt = { id: string; name: string };

/**
 * ตัวกรอง "ดูทีละสมาชิก" (?p=) ที่ใช้ในหน้ารายการต่าง ๆ
 * - ไม่เลือก (ทั้งครอบครัว): ทุกรายการ สัดส่วน 100%
 * - เลือกสมาชิก: เฉพาะรายการที่คนนั้นมีส่วน · มูลค่า × สัดส่วน (ตรงกับ Dashboard รายบุคคล)
 *   ทรัพย์สิน = สัดส่วนเจ้าของ (v_asset_ownerships_active) · หนี้สิน / บัตร / เงินประกัน = จาก Net Worth Engine
 */
export async function loadPersonView(p: string | undefined, opts: { liabilities?: boolean } = {}) {
  const supabase = await createClient();
  const { data } = await supabase.from("persons").select("id,name").is("deleted_at", null).order("created_at");
  const persons = (data ?? []) as PersonOpt[];
  const personId = p && persons.some((x) => x.id === p) ? p : "";
  const personName = persons.find((x) => x.id === personId)?.name ?? "";
  const asset = new Map<string, number>();
  const liability = new Map<string, number>();   // key: liability_id | credit_card_id | lease_id
  if (personId) {
    const today = todayBangkok();
    const [{ data: ao }, { data: li }] = await Promise.all([
      supabase.from("v_asset_ownerships_active").select("asset_id,ownership_percent,end_date").eq("person_id", personId),
      opts.liabilities
        ? supabase.from("v_net_worth_items_current").select("liability_id,credit_card_id,lease_id,ownership_percent")
            .eq("person_id", personId).eq("item_type", "LIABILITY")
        : Promise.resolve({ data: null }),
    ]);
    (ao ?? []).filter((o) => !o.end_date || o.end_date >= today)
      .forEach((o) => asset.set(o.asset_id, (asset.get(o.asset_id) ?? 0) + Number(o.ownership_percent)));
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
    assetPct: (id: string | null | undefined) => (personId && (asset.get(id ?? "") ?? 0) < 100 ? asset.get(id ?? "") ?? 0 : null),
    liabilityPct: (id: string | null | undefined) => (personId && (liability.get(id ?? "") ?? 0) < 100 ? liability.get(id ?? "") ?? 0 : null),
    /** ตรงกับคนที่เลือกไหม (ใช้กับรายการที่มีเจ้าของคนเดียว เช่น บัตร / กรมธรรม์) */
    isPerson: (pid: string | null | undefined) => !personId || pid === personId,
  };
}
