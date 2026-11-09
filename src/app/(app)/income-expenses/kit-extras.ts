import type { createClient } from "@/lib/supabase/server";
import { compName, type Component } from "../property/components";

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * ข้อมูลเพิ่มของแถวเงินเข้า–ออกที่มาจากหน้าอื่น → กดที่แถวแล้วเปิดฟอร์มชุดเดียวกับหน้าต้นทาง (ตกลง 9 พ.ย. 2026)
 *   receipts = การรับเงินประกัน (ถอนมูลค่าเวนคืน / ผลประโยชน์) ของกรมธรรม์ในรายการ · latest = รายการรับล่าสุดของกรมธรรม์ (แก้ได้เฉพาะอันนี้)
 *   comps    = แถวส่วนประกอบของ Property ที่มีรายการจ่ายซื้อ / จ่ายเพิ่ม (ฟอร์มแก้รายการจ่ายต้องเลือกแถว)
 *   itxs     = รายการในพอร์ตที่ตัด / เข้าบัญชีธนาคารตรง (ซื้อ / ขาย / ไถ่ถอน ฯลฯ)
 * เก็บเป็น array ธรรมดา (เก็บในแคชของหน้าได้)
 */
export type KitReceipt = { id: string; policy_id: string; receipt_date: string; amount: number; currency: string; bank_asset_id: string | null;
  notes: string | null; outcome: string | null; cash_value_part: number; movement_id: string | null; income_id: string | null;
  latest: boolean; has_cv: boolean };
export type KitComp = { asset_id: string; id: string; label: string; type: "LAND" | "BUILDING" | "OTHER" };
export type KitItx = { id: string; transaction_type: string; transaction_date: string; settlement_date: string | null;
  settle_from_asset_id: string | null; settle_to_asset_id: string | null; quantity: number | null; price: number | null; amount: number;
  fee: number | null; tax: number | null; notes: string | null; cash_movement_id: string | null; source_expense_item_id: string | null };
export type KitExtras = { receipts: KitReceipt[]; comps: KitComp[]; itxs: KitItx[] };

type MoveLite = { movement_type: string; is_derived: boolean; to_asset_id: string | null; source_entity_type?: string | null;
  source_entity_id?: string | null; metadata?: unknown };
type IncLite = { income_type?: string; insurance_schedule_line_id?: string | null; ins_line?: unknown };

const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);
const none = Promise.resolve({ data: [] as never[] });

export async function loadKitExtras(supabase: Supa, moves: MoveLite[], incomes: IncLite[]): Promise<KitExtras> {
  const policyIds = [...new Set([
    ...moves.filter((m) => m.movement_type === "ASSET_SALE").map((m) => (m.metadata as { policy_id?: string } | null)?.policy_id),
    ...incomes.filter((i) => i.income_type === "INSURANCE_BENEFIT" || i.insurance_schedule_line_id)
      .map((i) => one(i.ins_line as { policy_id: string } | { policy_id: string }[] | null)?.policy_id),
  ].filter((x): x is string => !!x))];
  const buyAssets = [...new Set(moves.filter((m) => m.movement_type === "ASSET_PURCHASE" && m.to_asset_id).map((m) => m.to_asset_id as string))];
  const txIds = [...new Set(moves.filter((m) => m.is_derived && m.source_entity_type === "INVESTMENT_TX" && m.source_entity_id)
    .map((m) => m.source_entity_id as string))];
  const res = await Promise.all([
    policyIds.length ? supabase.from("insurance_benefit_receipts")
      .select("id,policy_id,receipt_date,amount,currency,bank_asset_id,notes,outcome,cash_value_part,movement_id,income_id,created_at,pol:insurance_policies(cash_value_asset_id)")
      .in("policy_id", policyIds).is("undone_at", null).is("deleted_at", null) : none,
    buyAssets.length ? supabase.from("property_details")
      .select("asset_id,property_deeds(id,component_type,label,title_type,title_deed_no,land_no,sort_order,created_at,ended_date,deleted_at)")
      .in("asset_id", buyAssets) : none,
    txIds.length ? supabase.from("investment_transactions")
      .select("id,transaction_type,transaction_date,settlement_date,settle_from_asset_id,settle_to_asset_id,quantity,price,amount,fee,tax,notes,cash_movement_id,source_expense_item_id")
      .in("id", txIds) : none,
  ]);
  const bad = res.find((r) => "error" in r && r.error);
  if (bad) throw new Error("โหลดข้อมูลรายการต้นทางไม่สำเร็จ");   // ไม่เก็บผลที่ไม่ครบไว้ในแคช
  const [{ data: rc }, { data: pds }, { data: tx }] = res;
  // รายการรับล่าสุดของแต่ละกรมธรรม์ (วันที่ → เวลาที่บันทึก · เหมือนหน้ากรมธรรม์)
  type Rc = Omit<KitReceipt, "latest" | "has_cv"> & { created_at: string; pol: unknown };
  const rows = (rc ?? []) as unknown as Rc[];
  const latest = new Map<string, Rc>();
  rows.forEach((r) => {
    const cur = latest.get(r.policy_id);
    if (!cur || r.receipt_date > cur.receipt_date || (r.receipt_date === cur.receipt_date && r.created_at > cur.created_at)) latest.set(r.policy_id, r);
  });
  const receipts: KitReceipt[] = rows.map((r) => ({
    id: r.id, policy_id: r.policy_id, receipt_date: r.receipt_date, amount: Number(r.amount), currency: r.currency, bank_asset_id: r.bank_asset_id,
    notes: r.notes, outcome: r.outcome, cash_value_part: Number(r.cash_value_part ?? 0), movement_id: r.movement_id, income_id: r.income_id,
    latest: latest.get(r.policy_id)?.id === r.id,
    has_cv: !!one(r.pol as { cash_value_asset_id: string | null } | { cash_value_asset_id: string | null }[] | null)?.cash_value_asset_id,
  }));
  // แถวส่วนประกอบ: ชื่อ / ลำดับแบบเดียวกับหน้า Property · ขาย / รื้อถอนแล้วเลือกไม่ได้
  type Deed = Component & { sort_order: number; created_at: string; deleted_at: string | null };
  const comps: KitComp[] = ((pds ?? []) as unknown as { asset_id: string; property_deeds: Deed[] | null }[]).flatMap((p) => {
    const all = (p.property_deeds ?? []).filter((d) => !d.deleted_at)
      .sort((x, y) => x.sort_order - y.sort_order || x.created_at.localeCompare(y.created_at));
    return all.map((d, i) => ({ d, label: compName(d, i) })).filter((x) => !x.d.ended_date)
      .map((x) => ({ asset_id: p.asset_id, id: x.d.id, label: x.label, type: x.d.component_type }));
  });
  return { receipts, comps, itxs: (tx ?? []) as unknown as KitItx[] };
}
