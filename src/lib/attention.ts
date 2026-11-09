import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { cachedData } from "@/lib/data-cache";
import { addDays, money, thDate, thMonth, todayBangkok } from "@/lib/format";
import { monthToClose } from "@/lib/closing";

/** เตือนล่วงหน้า: รายการรอรับ / รอจ่ายที่ครบกำหนดภายในกี่วัน (เจ้าของ 9 พ.ย. 2026) */
const DUE_SOON_DAYS = 7;

export type AttentionItem = { text: string; href: string; tone: "red" | "amber" | "slate" };

/** งานที่ต้องทำ ณ วันนี้ (หน้า "สิ่งที่ต้องทำ" + ตัวเลขที่ปุ่มกระดิ่งแถบบน) — ปิดเดือนอยู่บนสุด · cache() → ใน 1 คำขอคำนวณครั้งเดียว */
export const getAttention = cache(async (): Promise<AttentionItem[]> => buildAttention(await createClient(), await monthToClose()));

/** ตัวเลขที่ปุ่มกระดิ่ง (แถบบน): จำไว้จนมีการบันทึก / งานเบื้องหลังเสร็จ (เพดาน 1 ชั่วโมง · ทุกหน้าไม่ต้องยิง ~13 คำสั่งทุกคลิก) · หน้า To-Do List ยังใช้ getAttention() สด */
export const getTodoCount = cache(async (): Promise<{ total: number; red: number }> => {
  const toClose = await monthToClose();
  return cachedData(["todo-count", toClose], async (supabase) => {
    const a = await buildAttention(supabase, toClose);
    return { total: a.length, red: a.filter((x) => x.tone === "red").length };
  });
});

async function buildAttention(supabase: SupabaseClient, toClose: string | null): Promise<AttentionItem[]> {
  const today = todayBangkok();
  const { data: family } = await supabase.from("families").select("system_status").maybeSingle();
  const isSetup = family?.system_status === "SETUP";
  const soonTo = addDays(today, DUE_SOON_DAYS);
  const [{ data: readiness }, { data: fx }, { data: expected }, { data: liabs }, { data: holds }, { data: leases }, { data: insOverdue }, { data: fups }, { data: bankBal }, { data: bankAcc }, { data: pendH }, { data: pendG },
    { data: loanDue }, { data: recExpLate }, { data: propCostLate }, { data: incSoon }, { data: insSoon }, { data: recExpSoon }, { data: propCostSoon }] = await Promise.all([
    isSetup ? supabase.from("v_go_live_readiness").select("status") : Promise.resolve({ data: null }),
    supabase.from("v_fx_status").select("currency,latest_rate_date,is_stale"),
    supabase.from("v_expected_income").select("name,income_period,status,source_type,in_grace").eq("status", "OVERDUE"),
    supabase.from("v_liabilities_all").select("name,liability_source,derived_status,due_date").not("derived_status", "is", null),
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
    // รอรับ / รอจ่าย (เจ้าของ 9 พ.ย. 2026): เลยกำหนด = แดง · ครบกำหนดภายใน 7 วัน = เทา
    //   งวดเงินให้กู้: เลยกำหนด (เกินวันผ่อนผัน) / ครบแล้วอยู่ในวันผ่อนผัน (DUE) / ครบภายใน 7 วัน
    supabase.from("v_loan_schedule_status").select("status,due_date")
      .or(`status.in.(OVERDUE,DUE),and(status.in.(PENDING,PARTIAL),due_date.gte.${today},due_date.lte.${soonTo})`),
    supabase.from("v_recurring_expense_tracking").select("template_id").eq("status", "OVERDUE"),
    supabase.from("v_property_cost_tracking").select("utility_id").eq("status", "OVERDUE"),
    supabase.from("v_expected_income").select("source_type").eq("status", "PENDING").gte("due_date", today).lte("due_date", soonTo),
    // ประกัน: ผลประโยชน์เลยกำหนด (เบี้ยเลยกำหนดอยู่ใน insOverdue แล้ว) + ครบภายใน 7 วันทั้งเบี้ยและผลประโยชน์
    supabase.from("v_insurance_schedule_status").select("kind,status,due_date")
      .in("status", ["PENDING", "PARTIAL"]).gte("due_date", today).lte("due_date", soonTo),
    supabase.from("v_recurring_expense_tracking").select("template_id").eq("status", "PENDING").gte("due_date", today).lte("due_date", soonTo),
    supabase.from("v_property_cost_tracking").select("utility_id").eq("status", "PENDING").gte("due_date", today).lte("due_date", soonTo),
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
  const benOver = (insOverdue ?? []).filter((x) => x.kind !== "PREMIUM").length;
  if (benOver) attention.push({ text: `ผลประโยชน์ประกันเลยกำหนด ยังไม่ได้รับ ${benOver} งวด`, href: "/insurance?tab=benefit", tone: "red" });
  const loans = (loanDue ?? []) as { status: string; due_date: string }[];
  const loanOver = loans.filter((x) => x.status === "OVERDUE").length;
  const loanGrace = loans.filter((x) => x.status === "DUE").length;
  if (loanOver) attention.push({ text: `งวดเงินให้กู้เลยกำหนด (เกินวันผ่อนผัน) ${loanOver} งวด`, href: "/financial/loans?tab=monthly", tone: "red" });
  if (loanGrace) attention.push({ text: `งวดเงินให้กู้ครบกำหนด ยังไม่ได้รับ (อยู่ในวันผ่อนผัน) ${loanGrace} งวด`, href: "/financial/loans?tab=monthly", tone: "amber" });
  if ((recExpLate ?? []).length) attention.push({ text: `ค่าใช้จ่ายประจำเลยกำหนด ยังไม่ได้จ่าย ${(recExpLate ?? []).length} รายการ`, href: "/income-expenses?tab=expense", tone: "red" });
  if ((propCostLate ?? []).length) attention.push({ text: `ค่าใช้จ่ายอสังหาฯ เลยกำหนด ยังไม่ได้จ่าย ${(propCostLate ?? []).length} รายการ`, href: "/property?tab=expense", tone: "red" });
  // ค่าเช่า: ภายในวันผ่อนผัน = ส้ม · เกินวันผ่อนผัน = แดง (เจ้าของ 6 พ.ย. 2026) · รายได้ประจำอื่นยังเป็นส้ม
  const rentLate = (expected ?? []).filter((x) => x.source_type === "LEASE");
  const rentRed = rentLate.filter((x) => !x.in_grace).length;
  const rentGrace = rentLate.length - rentRed;
  const otherLate = (expected ?? []).length - rentLate.length;
  if (rentRed) attention.push({ text: `ค่าเช่าเลยกำหนด (เกินวันผ่อนผัน) ${rentRed} งวด`, href: "/property?tab=income", tone: "red" });
  if (rentGrace) attention.push({ text: `ค่าเช่าครบกำหนด ยังไม่ได้รับ (อยู่ในวันผ่อนผัน) ${rentGrace} งวด`, href: "/property?tab=income", tone: "amber" });
  if (otherLate) attention.push({ text: `รายได้เลยกำหนดยังไม่ได้รับ ${otherLate} รายการ`, href: "/income-expenses?tab=income", tone: "amber" });
  (liabs ?? []).forEach((l) => {
    if (l.derived_status === "PAID_AFTER_BALANCE_DATE") attention.push({ text: `${l.name}: จ่ายบัตรแล้ว ยังไม่อัปเดตยอด`, href: "/liabilities#cards", tone: "amber" });
    // เงินประกัน: คืนภายใน 30 วันนับจากวันสิ้นสุด / เลิกสัญญา (ตามสัญญา · ตกลง 6 พ.ย. 2026) = ส้ม · เกิน = แดง
    if (l.derived_status === "REFUND_PENDING")
      attention.push({ text: `${l.name}: รอคืนเงินประกัน ภายใน ${thDate(addDays(l.due_date as string, 30))}`, href: "/property", tone: "amber" });
    if (l.derived_status === "DEPOSIT_REFUND_OVERDUE") attention.push({ text: `${l.name}: เงินประกันเลยกำหนดคืน`, href: "/property", tone: "red" });
  });
  const atCost = (holds ?? []).filter((x) => x.valued_at_cost);
  if (atCost.length) attention.push({ text: `หลักทรัพย์ใช้ราคาทุน รอ Statement ${atCost.length} ตัว`, href: "/investments", tone: "slate" });
  // ครบกำหนดภายใน 60 วัน (เจ้าของ 5 พ.ย. 2026 · เดิม 30 วันตาม derived_status ของ View)
  const maturityTo = addDays(today, 60);
  (holds ?? []).filter((x) => x.maturity_date && x.maturity_date >= today && x.maturity_date <= maturityTo).forEach((x) =>
    attention.push({ text: `${x.name} ครบกำหนด ${thDate(x.maturity_date)}`, href: `/investments/${x.portfolio_asset_id}`, tone: "slate" }));
  // ครบกำหนดภายใน 7 วัน (ยังไม่ถึงกำหนด · เทา) — บรรทัดละประเภท ไปที่แท็บบันทึกรับ / จ่ายของหน้านั้น
  const soon = (n: number, what: string, unit: string, href: string) => {
    if (n) attention.push({ text: `${what}ครบกำหนดภายใน ${DUE_SOON_DAYS} วัน ${n} ${unit}`, href, tone: "slate" });
  };
  const inc = (incSoon ?? []) as { source_type: string }[];
  soon(inc.filter((x) => x.source_type === "LEASE").length, "ค่าเช่า", "งวด", "/property?tab=income");
  soon(inc.filter((x) => x.source_type !== "LEASE").length, "รายได้ประจำ", "รายการ", "/income-expenses?tab=income");
  soon(loans.filter((x) => x.status === "PENDING" || x.status === "PARTIAL").length, "งวดเงินให้กู้", "งวด", "/financial/loans?tab=monthly");
  const ins = (insSoon ?? []) as { kind: string }[];
  soon(ins.filter((x) => x.kind !== "PREMIUM").length, "ผลประโยชน์ประกัน", "งวด", "/insurance?tab=benefit");
  soon(ins.filter((x) => x.kind === "PREMIUM").length, "เบี้ยประกัน", "งวด", "/insurance?tab=premium");
  soon((recExpSoon ?? []).length, "ค่าใช้จ่ายประจำ", "รายการ", "/income-expenses?tab=expense");
  soon((propCostSoon ?? []).length, "ค่าใช้จ่ายอสังหาฯ ", "รายการ", "/property?tab=expense");
  (leases ?? []).forEach((l) => attention.push({ text: `สัญญาเช่า ${[l.unit_label, l.tenant_name].filter(Boolean).join(" · ")} หมด ${thDate(l.end_date)}`, href: `/property/${l.property_asset_id}`, tone: "slate" }));

  return attention;
}
