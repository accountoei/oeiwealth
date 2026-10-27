import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { money, thDate, thMonth, todayBangkok } from "@/lib/format";
import { monthToClose } from "@/lib/closing";

export type AttentionItem = { text: string; href: string; tone: "red" | "amber" | "slate" };

/** งานที่ต้องทำ ณ วันนี้ (หน้า "สิ่งที่ต้องทำ" + ตัวเลขที่เมนูซ้าย) — ปิดเดือนอยู่บนสุด · cache() → ใน 1 คำขอคำนวณครั้งเดียว */
export const getAttention = cache(async (): Promise<AttentionItem[]> => {
  const supabase = await createClient();
  const today = todayBangkok();
  const { data: family } = await supabase.from("families").select("system_status").maybeSingle();
  const isSetup = family?.system_status === "SETUP";
  const [toClose, { data: readiness }, { data: fx }, { data: expected }, { data: liabs }, { data: holds }, { data: leases }, { data: insOverdue }, { data: fups }, { data: bankBal }, { data: bankAcc }, { data: pendH }, { data: pendG }] = await Promise.all([
    monthToClose(),
    isSetup ? supabase.from("v_go_live_readiness").select("status") : Promise.resolve({ data: null }),
    supabase.from("v_fx_status").select("currency,latest_rate_date,is_stale"),
    supabase.from("v_expected_income").select("name,income_period,status").eq("status", "OVERDUE"),
    supabase.from("v_liabilities_all").select("name,liability_source,derived_status").not("derived_status", "is", null),
    supabase.from("v_holdings_active").select("name,portfolio_asset_id,status,derived_status,valued_at_cost,maturity_date").eq("status", "ACTIVE"),
    supabase.from("v_lease_status").select("tenant_name,unit_label,end_date,property_asset_id,lease_status").eq("lease_status", "EXPIRING_SOON"),
    supabase.from("v_insurance_schedule_status").select("policy_id,kind").eq("status", "OVERDUE"),
    supabase.from("insurance_followups").select("id").is("deleted_at", null).in("status", ["OPEN", "IN_PROGRESS"]),
    // บัญชีธนาคารที่ยอดตามระบบติดลบ (เกินวงเงิน O/D) ณ วันนี้ (แสดงสีแดง · ปิดเดือนไม่ได้จนกว่าจะแก้)
    supabase.rpc("bank_balances_at", { p_date: today }),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,overdraft_limit").eq("status", "ACTIVE"),
    // ราคาอัตโนมัติรอยืนยัน (ครั้งแรก / ต่างเกิน 20%)
    supabase.from("investment_holdings").select("id,name,portfolio_id,investment_portfolios(asset_id)").not("price_pending", "is", null).is("deleted_at", null),
    supabase.from("alternative_asset_details").select("asset_id").not("price_pending", "is", null).is("deleted_at", null),
  ]);

  // งานที่ต้องทำ (Attention) — ปิดเดือนอยู่บนสุด
  const attention: AttentionItem[] = [];
  if (isSetup) {
    const missing = (readiness ?? []).filter((r: { status: string }) => r.status === "MISSING").length;
    attention.push({ text: `ระบบยังอยู่ช่วงตั้งค่า · ยังขาดยอดตั้งต้น ${missing} รายการ ก่อน Confirm Go-live`, href: "/settings/opening", tone: "amber" });
  } else if (toClose) {
    attention.push({ text: `ปิดเดือน ${thMonth(`${toClose}-01`)}`, href: `/settings/month-closing?m=${toClose}`, tone: "red" });
  }
  const accName = new Map((bankAcc ?? []).map((b) => [b.asset_id as string, b]));
  // บัญชีที่มีวงเงิน O/D: ติดลบไม่เกินวงเงิน = ใช้วงเงินตามปกติ ไม่เตือน (เหมือน Month Closing) · เกินวงเงินจึงเตือน
  const odOf = (id: string) => Number(accName.get(id)?.overdraft_limit ?? 0);
  ((bankBal as { asset_id: string; calculated: number | null }[] | null) ?? [])
    .filter((r) => accName.has(r.asset_id) && r.calculated != null && Number(r.calculated) < -odOf(r.asset_id) - 0.005)
    .forEach((r) => { const a = accName.get(r.asset_id); attention.push({ text: odOf(r.asset_id) > 0
      ? `บัญชี ${a?.name} เกินวงเงิน O/D ${money(odOf(r.asset_id), undefined, 0)} · ยอด ${money(Number(r.calculated), a?.currency as string)}`
      : `บัญชี ${a?.name} ติดลบ ${money(Number(r.calculated), a?.currency as string)}`,
      href: `/financial/cash/${r.asset_id}`, tone: "red" }); });
  ((pendH ?? []) as { id: string; name: string; investment_portfolios: { asset_id: string } | { asset_id: string }[] | null }[]).forEach((x) => {
    const pf = Array.isArray(x.investment_portfolios) ? x.investment_portfolios[0] : x.investment_portfolios;
    if (pf) attention.push({ text: `ราคา ${x.name} รอยืนยัน (ราคาอัตโนมัติ)`, href: `/investments/${pf.asset_id}/holding/${x.id}`, tone: "amber" });
  });
  (pendG ?? []).forEach((x) => attention.push({ text: "มูลค่าทองคำรอยืนยัน (ราคาอัตโนมัติ)", href: `/alternative/${x.asset_id}`, tone: "amber" }));
  (fx ?? []).filter((f) => f.is_stale).forEach((f) => attention.push({ text: `อัตราแลกเปลี่ยน ${f.currency} ไม่อัปเดต (ล่าสุด ${thDate(f.latest_rate_date)})`, href: "/settings/system", tone: "red" }));
  if ((fups ?? []).length) attention.push({ text: `กรมธรรม์ที่ต้องติดตาม (สมาชิก Archived) ${(fups ?? []).length} รายการ`, href: "/insurance", tone: "red" });
  const premOver = (insOverdue ?? []).filter((x) => x.kind === "PREMIUM").length;
  if (premOver) attention.push({ text: `เบี้ยประกันเลยกำหนด ${premOver} งวด`, href: "/income-expenses?tab=expense", tone: "red" });
  if ((expected ?? []).length) attention.push({ text: `รายได้เลยกำหนดยังไม่ได้รับ ${(expected ?? []).length} รายการ`, href: "/income-expenses?tab=income", tone: "amber" });
  (liabs ?? []).forEach((l) => {
    if (l.derived_status === "PAID_AFTER_BALANCE_DATE") attention.push({ text: `${l.name}: จ่ายบัตรแล้ว ยังไม่อัปเดตยอด`, href: "/liabilities#cards", tone: "amber" });
    if (l.derived_status === "DEPOSIT_REFUND_OVERDUE") attention.push({ text: `${l.name}: เงินประกันเลยกำหนดคืน`, href: "/property", tone: "red" });
  });
  const atCost = (holds ?? []).filter((x) => x.valued_at_cost);
  if (atCost.length) attention.push({ text: `หลักทรัพย์ใช้ราคาทุน รอ Statement ${atCost.length} ตัว`, href: "/investments", tone: "slate" });
  (holds ?? []).filter((x) => x.derived_status === "MATURITY_SOON").forEach((x) =>
    attention.push({ text: `${x.name} ครบกำหนด ${thDate(x.maturity_date)}`, href: `/investments/${x.portfolio_asset_id}`, tone: "slate" }));
  (leases ?? []).forEach((l) => attention.push({ text: `สัญญาเช่า ${[l.unit_label, l.tenant_name].filter(Boolean).join(" · ")} หมด ${thDate(l.end_date)}`, href: `/property/${l.property_asset_id}`, tone: "slate" }));

  return attention;
});
