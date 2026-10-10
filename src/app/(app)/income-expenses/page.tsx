import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import RowActions from "@/components/RowActions";
import {
  COST_STATUS, INCOME_TYPE_LABEL, MOVE_LABEL, PERIODS_PER_YEAR, UTIL_EXPENSE_CATEGORY, UTIL_LABEL, money, monthRange, scheduleText,
  thDate, thMonth, todayBangkok,
} from "@/lib/format";
import { RecordCostForm, UtilityForm, type PropertyPick } from "../property/[id]/forms";
import {
  ExpectedActions, ExpenseForm, IncomeForm, MonthStatusForm, MovementForm, ReimbursementForm, TemplateForm, TemplateToggle,
  type Bank, type Card, type Claim, type Liab,
} from "./forms";
import { MonthNav, TabNav, TabPanel, TabsProvider } from "./tabs";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import { PaymentForm as LoanPaymentForm } from "../financial/loans/[id]/forms";
import { LOAN_SCHED_STATUS } from "@/lib/loan-schedule";

const PATHS = ["/income-expenses", "/financial/cash"];
const TABS: [string, string][] = [["overview", "ภาพรวม"], ["income", "รายได้"], ["expense", "ค่าใช้จ่าย"], ["moves", "โอน & จ่ายหนี้"]];
const EXP_STATUS: Record<string, { text: string; cls: string }> = {
  RECEIVED: { text: "ได้รับแล้ว", cls: "bg-emerald-50 text-emerald-700" }, PENDING: { text: "รอรับ", cls: "bg-slate-100 text-slate-700" },
  OVERDUE: { text: "เลยกำหนด", cls: "bg-red-50 text-red-700" }, DISMISSED: { text: "เดือนนี้ไม่ได้รับ", cls: "bg-slate-100 text-slate-500" },
};
const TRACK: Record<string, { text: string; cls: string }> = {
  NOT_TRACKED: { text: "ไม่ได้บันทึก", cls: "text-slate-500" }, PARTIAL: { text: "บันทึกบางส่วน (ข้อมูลไม่ครบ)", cls: "text-amber-700" },
  COMPLETE: { text: "บันทึกครบแล้ว", cls: "text-emerald-700" },
};
const REIMB: Record<string, string> = { PENDING: "รอรับเงินคืน", PARTIAL: "ได้คืนบางส่วน", FULL: "ได้คืนครบ" };

type Sp = Promise<{ tab?: string; m?: string; p?: string }>;

export default async function IncomeExpensesPage({ searchParams }: { searchParams: Sp }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const today = todayBangkok();
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? (sp.m as string) : today.slice(0, 7);
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  const { start, end, prev, next } = monthRange(ym);
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const pv = await loadPersonView(sp.p, { liabilities: true });
  // มุมมองรายบุคคล: ส่วนแบ่งรายได้ / ค่าใช้จ่ายของคนที่เลือก (ตามกติกาเดียวกับ Dashboard: person → 100% · ทรัพย์สิน → สัดส่วนเจ้าของ)
  const [{ data: incShares }, { data: expShares }] = pv.personId ? await Promise.all([
    supabase.from("v_income_by_person").select("income_id,share_percent,amount_share,tax_share,base_amount_share")
      .eq("person_id", pv.personId).gte("date", start).lte("date", end),
    supabase.from("v_expense_by_person").select("expense_item_id,share_percent,amount_share,base_amount_share")
      .eq("person_id", pv.personId).gte("date", start).lte("date", end),
  ]) : [{ data: null }, { data: null }];
  const incShare = new Map((incShares ?? []).map((r) => [r.income_id as string, r]));
  const expShare = new Map((expShares ?? []).map((r) => [r.expense_item_id as string, r]));

  const [{ data: family }, { data: banksRaw }, { data: cardsRaw }, { data: liabRaw }, { data: persons }, { data: fx },
    { data: incomes }, { data: expected }, { data: templates }, { data: month }, { data: items }, { data: reimbStatus },
    { data: reimbs }, { data: moves }, { data: claimsRaw }, { data: costRows }, { data: utilRows }, { data: propRows }, { data: loanRows }] = await Promise.all([
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency,outstanding_balance,status").is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("liabilities").select("id,name,currency,outstanding_amount").is("deleted_at", null).eq("status", "ACTIVE"),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
    supabase.from("v_fx_status").select("currency,rate_to_thb"),
    supabase.from("income_transactions").select("id,date,income_type,amount,tax,currency,base_amount,received_to_asset_id,person_id,lease_id,source_transaction_id,asset_id,notes,persons(name),src_asset:assets!income_transactions_asset_id_fkey(name)")
      .is("deleted_at", null).gte("date", start).lte("date", end).order("date", { ascending: false }),
    supabase.from("v_expected_income").select("*").eq("income_period", start).order("due_date"),
    supabase.from("recurring_income_templates").select("id,name,income_type,expected_amount,currency,frequency,due_day,active,person_id,persons(name)")
      .is("deleted_at", null).order("name"),
    supabase.from("monthly_expenses").select("id,total_amount,tracking_status").eq("year_month", start).is("deleted_at", null).maybeSingle(),
    supabase.from("expense_items").select("id,date,description,amount,currency,base_amount,expense_category,paid_from_asset_id,paid_from_credit_card_id,person_id,source_cash_movement_id,is_reimbursable,expected_reimbursement_amount,notes,persons(name)")
      .is("deleted_at", null).gte("date", start).lte("date", end).order("date", { ascending: false }),
    supabase.from("v_expense_reimbursement_status").select("expense_item_id,reimbursed_amount,reimbursement_status").eq("is_reimbursable", true),
    supabase.from("expense_reimbursements").select("id,received_date,amount,currency,expense_item_id").is("deleted_at", null).gte("received_date", start).lte("received_date", end),
    supabase.from("cash_movements").select("id,movement_date,movement_type,from_asset_id,to_asset_id,to_credit_card_id,to_liability_id,amount,currency,counter_amount,counter_currency,fee,is_derived,description,movement_group_id")
      .is("deleted_at", null).gte("movement_date", start).lte("movement_date", end).order("movement_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("insurance_claims").select("id,claim_date,claimed_amount,received_amount,currency,status,insurance_policies(insurer,policy_no,persons(name))")
      .is("deleted_at", null).in("status", ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_PAID"]).order("claim_date", { ascending: false }),
    // ค่าใช้จ่ายประจำ (อสังหาฯ): งวดเดือนนี้ + ที่เลยกำหนดจากเดือนก่อน
    supabase.from("v_property_cost_tracking")
      .select("utility_id,property_asset_id,property_name,utility_type,provider,cost_period,due_date,expected_amount,paid_amount,currency,status")
      .or(`cost_period.eq.${start},and(status.eq.OVERDUE,cost_period.lt.${start})`).order("due_date"),
    supabase.from("property_utilities")
      .select("id,utility_type,provider,expected_amount,currency,frequency,due_day,due_month,property_details!inner(asset_id,assets!inner(name,status,deleted_at))")
      .is("deleted_at", null).eq("active", true).not("frequency", "is", null),
    supabase.from("property_details").select("id,asset_id,assets!inner(name,currency,status,deleted_at)").is("deleted_at", null),
    // งวดเงินให้กู้: ครบกำหนดเดือนนี้ + ที่เลยกำหนดจากเดือนก่อน
    supabase.from("v_loan_schedule_status")
      .select("id,loan_asset_id,loan_name,borrower_name,currency,installment_no,due_date,principal_due,interest_due,total_due,principal_remaining,interest_remaining,total_remaining,status")
      .or(`and(due_date.gte.${start},due_date.lte.${end}),and(status.in.(OVERDUE,PARTIAL),due_date.lt.${start})`)
      .neq("status", "WRITTEN_OFF").order("due_date"),
  ]);

  const goLive = family?.go_live_date ?? "";
  const minDate = goLive > start ? goLive : start;
  const maxDate = end < today ? end : today;
  const banks = (banksRaw as Bank[] | null) ?? [];
  const cards: Card[] = (cardsRaw ?? []).map((c) => ({ id: c.id, currency: c.currency, outstanding_balance: Number(c.outstanding_balance),
    label: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ") }));
  const liabs = (liabRaw as Liab[] | null) ?? [];
  const rate = new Map<string, number>([["THB", 1], ...((fx ?? []).map((r) => [r.currency, Number(r.rate_to_thb)] as [string, number]))]);
  const thb = (v: number | null, c: string) => Number(v ?? 0) * (rate.get(c) ?? 0);
  const name = new Map<string, string>([...banks.map((b) => [b.asset_id, b.name] as [string, string]),
    ...cards.map((c) => [c.id, c.label] as [string, string]), ...liabs.map((l) => [l.id, l.name] as [string, string])]);
  const pname = (p: unknown) => ((Array.isArray(p) ? p[0] : p) as { name: string } | null)?.name;
  const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
  const claims: Claim[] = (claimsRaw ?? []).map((c) => {
    const pol = one(c.insurance_policies as unknown as { insurer: string; policy_no: string | null; persons: unknown } | null);
    return { id: c.id, currency: c.currency, label: [pol?.insurer, pol?.policy_no, pname(pol?.persons),
      c.claim_date && `เคลม ${thDate(c.claim_date)}`, c.claimed_amount != null && money(c.claimed_amount, c.currency)].filter(Boolean).join(" · ") };
  });

  type Cost = { utility_id: string; property_asset_id: string; property_name: string; utility_type: string; provider: string | null;
    cost_period: string; due_date: string; expected_amount: number; paid_amount: number; currency: string; status: string };
  type Util = { id: string; utility_type: string; provider: string | null; expected_amount: number; currency: string; frequency: string;
    due_day: number | null; due_month: number | null; property_details: { asset_id: string; assets: { name: string; status: string; deleted_at: string | null } } };
  const costs = ((costRows as Cost[] | null) ?? []).filter((c) => pv.showAsset(c.property_asset_id));
  const utils = ((utilRows as unknown as Util[] | null) ?? [])
    .filter((u) => !u.property_details.assets.deleted_at && u.property_details.assets.status === "ACTIVE" && pv.showAsset(u.property_details.asset_id))
    .sort((a, b) => a.property_details.assets.name.localeCompare(b.property_details.assets.name, "th"));
  const properties: PropertyPick[] = ((propRows ?? []) as unknown as { id: string; asset_id: string;
    assets: { name: string; currency: string; status: string; deleted_at: string | null } }[])
    .filter((p) => !p.assets.deleted_at && p.assets.status === "ACTIVE")
    .map((p) => ({ id: p.id, assetId: p.asset_id, name: p.assets.name, currency: p.assets.currency }))
    .sort((a, b) => a.name.localeCompare(b.name, "th"));
  const costYear = utils.reduce((m, u) => m.set(u.currency, (m.get(u.currency) ?? 0) + Number(u.expected_amount) * (PERIODS_PER_YEAR[u.frequency] ?? 0) * pv.assetShare(u.property_details.asset_id)), new Map<string, number>());
  const utilName = (t: string, p: string | null) => [UTIL_LABEL[t] ?? t, p].filter(Boolean).join(" · ");

  // รายได้ / ค่าใช้จ่าย: ทั้งครอบครัว = ยอดเต็ม · รายบุคคล = เฉพาะรายการที่มีส่วน · ยอด × สัดส่วน (เก็บยอดเต็มไว้แสดงประกอบ)
  const incomeList = (incomes ?? []).filter((i) => !pv.personId || incShare.has(i.id)).map((i) => {
    const sh = incShare.get(i.id);
    return !sh ? { ...i, full_amount: i.amount, full_tax: i.tax, pct: null as number | null } : { ...i, full_amount: i.amount, full_tax: i.tax,
      pct: Number(sh.share_percent) < 100 ? Number(sh.share_percent) : null,
      amount: Number(sh.amount_share), tax: Number(sh.tax_share), base_amount: Number(sh.base_amount_share) };
  });
  const grossThb = incomeList.reduce((s, i) => s + Number(i.base_amount ?? 0), 0);
  const taxThb = incomeList.reduce((s, i) => s + (Number(i.amount) ? Number(i.tax ?? 0) * Number(i.base_amount ?? 0) / Number(i.amount) : 0), 0);
  const investThb = incomeList.filter((i) => i.source_transaction_id).reduce((s, i) => s + Number(i.base_amount ?? 0), 0);
  const track = month?.tracking_status ?? "NOT_TRACKED";
  const itemList = (items ?? []).filter((i) => !pv.personId || expShare.has(i.id)).map((i) => {
    const sh = expShare.get(i.id);
    return { ...i, full_amount: i.amount, share: sh ? Number(sh.share_percent) / 100 : 1,
      pct: sh && Number(sh.share_percent) < 100 ? Number(sh.share_percent) : null,
      amount: sh ? Number(sh.amount_share) : i.amount };
  });
  const itemShare = new Map(itemList.map((i) => [i.id, i.share]));
  const expenseThb = pv.personId ? (expShares ?? []).reduce((s, r) => s + Number(r.base_amount_share ?? 0), 0) : Number(month?.total_amount ?? 0);
  const reimbThb = (reimbs ?? []).filter((r) => !pv.personId || itemShare.has(r.expense_item_id))
    .reduce((s, r) => s + thb(r.amount, r.currency) * (itemShare.get(r.expense_item_id) ?? 1), 0);
  // รายได้ที่คาดไว้: รายได้ประจำตามเจ้าของ · ค่าเช่าตามเจ้าของทรัพย์สิน
  const expectedList = (expected ?? []).filter((e) => (e.source_type === "LEASE" ? pv.showAsset(e.asset_id) : pv.isPerson(e.person_id)))
    .map((e) => ({ ...e, pct: e.source_type === "LEASE" ? pv.assetPct(e.asset_id) : null }));
  const templateList = (templates ?? []).filter((t) => pv.isPerson(t.person_id));
  type LoanDue = { id: string; loan_asset_id: string; loan_name: string; borrower_name: string; currency: string; installment_no: number;
    due_date: string; principal_due: number; interest_due: number; total_due: number; principal_remaining: number;
    interest_remaining: number; total_remaining: number; status: string };
  const loanDue = ((loanRows as LoanDue[] | null) ?? []).filter((x) => pv.showAsset(x.loan_asset_id));
  // โอน & จ่ายหนี้: รายการที่แตะบัญชี / บัตร / หนี้ ของคนนั้น (แสดงยอดเต็ม)
  const moveList = (moves ?? []).filter((m) => !pv.personId || [m.from_asset_id, m.to_asset_id].some((id) => id && pv.showAsset(id))
    || [m.to_credit_card_id, m.to_liability_id].some((id) => id && pv.showLiability(id)));
  const savings = grossThb - taxThb - (expenseThb - reimbThb);
  const rs = new Map((reimbStatus ?? []).map((r) => [r.expense_item_id, r]));
  const inMonth = start <= today && (!goLive || end >= goLive);

  return (
    <TabsProvider initial={tab}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Income &amp; Expenses</h1>
          <p className="text-sm text-slate-500">รายได้ · ค่าใช้จ่าย (ไม่บังคับบันทึก) · เงินคืน · โอนและจ่ายหนี้</p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <PersonFilter persons={pv.persons} value={pv.personId} />
          <MonthNav prev={prev} next={next} label={thMonth(start)} person={pv.personId} />
        </div>
      </div>

      <TabNav tabs={TABS} />

      {canWrite && !inMonth && <p className="text-sm text-slate-500">เดือนนี้อยู่นอกช่วงที่บันทึกได้ (ก่อน Go-live หรือเป็นเดือนในอนาคต)</p>}

      {/* ============================================================ ภาพรวม */}
      <TabPanel id="overview">
          <section className="grid gap-4 md:grid-cols-4">
            <Kpi label="รายได้รวม (Gross)" value={money(grossThb, "THB", 0)} sub={investThb ? `รวมรายได้ลงทุน ${money(investThb, undefined, 0)}` : "รวมรายได้ลงทุน"} />
            <Kpi label="รายได้สุทธิหลังภาษี" value={money(grossThb - taxThb, "THB", 0)} sub={`ภาษีหัก ณ ที่จ่าย ${money(taxThb, undefined, 0)}`} />
            <Kpi label="ค่าใช้จ่าย" value={track === "NOT_TRACKED" ? "ไม่ได้บันทึก" : money(expenseThb, "THB", 0)}
              sub={`${TRACK[track].text}${reimbThb ? ` · ได้เงินคืน ${money(reimbThb, undefined, 0)}` : ""}`} cls={TRACK[track].cls} />
            <Kpi label="เงินออม (ไม่รวมการลงทุน)" value={track === "COMPLETE" ? money(savings, "THB", 0) : "—"}
              sub={track === "COMPLETE" ? "รายได้สุทธิ − ค่าใช้จ่ายสุทธิ" : "แสดงเมื่อยืนยันว่าบันทึกค่าใช้จ่ายครบ"} />
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-2 font-medium text-slate-900">ความเคลื่อนไหวของเงินในเดือนนี้</h2>
            <MovesTable moves={moveList} name={name} />
          </section>
      </TabPanel>

      {/* ============================================================ รายได้ */}
      <TabPanel id="income">
          {canWrite && inMonth && <IncomeForm banks={banks} persons={persons ?? []} today={maxDate} minDate={minDate} />}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 font-medium text-slate-900">รายได้ที่ต้องได้รับ เดือน {thMonth(start)}</h2>
            <p className="mb-3 text-xs text-slate-500">จากรายได้ประจำ สัญญาเช่า และตารางผ่อนเงินให้กู้ · ระบบไม่สร้างรายได้เอง กด &ldquo;บันทึกรับ&rdquo; ด้วยยอดจริง</p>
            {expectedList.length === 0 && loanDue.length === 0 ? <p className="text-sm text-slate-500">ไม่มีรายการที่คาดไว้ในเดือนนี้</p> : (
              <div className="grid gap-3 md:grid-cols-2">
                {expectedList.map((e) => {
                  const tpl = (templates ?? []).find((t) => t.id === e.source_id);
                  return (
                    <div key={`${e.source_type}-${e.source_id}`} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">{e.name}</div>
                          <div className="text-xs text-slate-500">{INCOME_TYPE_LABEL[e.income_type] ?? e.income_type} · ครบ {thDate(e.due_date)}</div>
                        </div>
                        <span className={`rounded px-1.5 py-0.5 text-xs ${EXP_STATUS[e.status]?.cls ?? ""}`}>{EXP_STATUS[e.status]?.text ?? e.status}</span>
                      </div>
                      <div className="mt-1 tabular-nums">
                        คาดไว้ {money(e.expected_amount, e.currency)}
                        {e.received_amount != null && <span className="text-emerald-700"> · ได้รับ {money(e.received_amount)}</span>}
                        {e.pct != null && <div className="text-xs text-slate-500">ส่วนของ {pv.personName} {e.pct}%</div>}
                      </div>
                      {canWrite && (e.status === "PENDING" || e.status === "OVERDUE") && (
                        <div className="mt-2">
                          <ExpectedActions sourceType={e.source_type} sourceId={e.source_id} period={start} incomeType={e.income_type}
                            personId={tpl?.person_id ?? null} expected={Number(e.expected_amount)} currency={e.currency}
                            receiveTo={e.receive_to_asset_id} banks={banks} today={maxDate} minDate={minDate} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {loanDue.map((x) => (
                  <div key={x.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Link href={`/financial/loans/${x.loan_asset_id}`} className="font-medium hover:underline">{x.loan_name}</Link>
                        <div className="text-xs text-slate-500">
                          เงินให้กู้ · {x.borrower_name} · งวดที่ {x.installment_no} · ครบ {thDate(x.due_date)}{x.due_date < start && ` (${thMonth(x.due_date)})`}
                        </div>
                      </div>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${LOAN_SCHED_STATUS[x.status]?.cls ?? ""}`}>{LOAN_SCHED_STATUS[x.status]?.text ?? x.status}</span>
                    </div>
                    <div className="mt-1 tabular-nums">
                      <span className="text-slate-500">ตามตาราง:</span> เงินต้น {money(x.principal_due, x.currency)} · ดอกเบี้ย {money(x.interest_due)}
                      {x.status !== "PAID" && Number(x.total_remaining) < Number(x.total_due) && <span className="text-amber-700"> · ค้าง {money(x.total_remaining)}</span>}
                      {pv.assetPct(x.loan_asset_id) != null && <div className="text-xs text-slate-500">ส่วนของ {pv.personName} {pv.assetPct(x.loan_asset_id)}%</div>}
                    </div>
                    <div className="text-xs text-slate-400">เงินต้นที่ได้คืนไม่นับเป็นรายได้ · ดอกเบี้ยนับเป็นรายได้</div>
                    {canWrite && x.status !== "PAID" && (
                      <div className="mt-2">
                        <LoanPaymentForm assetId={x.loan_asset_id} currency={x.currency} banks={banks} today={today} minDate={goLive} small button="บันทึกรับ"
                          title={`รับชำระ ${x.loan_name} งวดที่ ${x.installment_no}`}
                          principal={Number(x.principal_remaining)} interest={Number(x.interest_remaining)}
                          interestOwed={loanDue.filter((y) => y.loan_asset_id === x.loan_asset_id && y.due_date <= x.due_date)
                            .reduce((s, y) => s + Number(y.interest_remaining), 0)} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-medium text-slate-900">รายได้ที่บันทึกแล้ว</h2>
            {incomeList.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายได้ในเดือนนี้</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr><th className="py-1">วันที่</th><th>ประเภท</th><th>ของใคร / ที่มา</th><th className="text-right">Gross</th><th className="text-right">ภาษี</th><th className="pl-4">เข้าบัญชี</th><th></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {incomeList.map((i) => (
                    <tr key={i.id} className="align-top">
                      <td className="py-1.5">{thDate(i.date)}</td>
                      <td>{INCOME_TYPE_LABEL[i.income_type] ?? i.income_type}</td>
                      <td className="text-slate-600">
                        {i.source_transaction_id ? <Link href={`/investments/${i.asset_id}`} className="underline">จากพอร์ตลงทุน (แก้ที่รายการลงทุน)</Link>
                          : i.lease_id ? <Link href={`/property/${i.asset_id}`} className="underline">ค่าเช่า (แบ่งตามเจ้าของทรัพย์สิน)</Link>
                          : i.income_type === "LOAN_INTEREST" && i.asset_id
                            ? <Link href={`/financial/loans/${i.asset_id}`} className="underline">ดอกเบี้ยจาก {pname(i.src_asset) ?? "เงินให้กู้"} (แบ่งตามเจ้าของ)</Link>
                          : pname(i.persons) ?? (i.asset_id && pname(i.src_asset) ? `${pname(i.src_asset)} (แบ่งตามเจ้าของ)` : "ส่วนกลาง")}
                        {i.notes && !i.source_transaction_id && <div className="text-xs text-slate-400">{i.notes}</div>}
                      </td>
                      <td className="text-right tabular-nums">{money(i.amount, i.currency)}
                        {i.pct != null && <div className="text-xs text-slate-500">{i.pct}% ของ {money(i.full_amount)}</div>}</td>
                      <td className="text-right tabular-nums text-slate-500">{Number(i.tax ?? 0) ? money(i.tax) : ""}</td>
                      <td className="pl-4 text-xs text-slate-500">{i.received_to_asset_id ? name.get(i.received_to_asset_id) ?? "บัญชี" : i.source_transaction_id ? "ตามรายการลงทุน" : "ไม่ผ่านบัญชี"}</td>
                      <td className="pl-2 text-right">
                        {canWrite && !i.source_transaction_id && (
                          <RowActions table="income_transactions" id={i.id} paths={PATHS} canDelete={canDelete} fields={[
                            { name: "date", label: "วันที่", type: "date", value: i.date },
                            { name: "amount", label: "Gross", type: "number", value: i.full_amount },
                            { name: "tax", label: "ภาษี", type: "number", value: i.full_tax },
                            { name: "notes", label: "หมายเหตุ", value: i.notes, width: "w-40" }]} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-medium text-slate-900">ตั้งค่ารายได้ประจำ</h2>
            {templateList.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มี</p> : (
              <ul className="space-y-1 text-sm">
                {templateList.map((t) => (
                  <li key={t.id} className={t.active ? "" : "opacity-50"}>
                    {t.name} · {pname(t.persons) ?? "ส่วนกลาง"} · {money(t.expected_amount, t.currency)}
                    {" "}{t.frequency === "MONTHLY" ? "ทุกเดือน" : t.frequency === "QUARTERLY" ? "ทุก 3 เดือน" : "ทุกปี"}
                    {t.due_day && ` วันที่ ${t.due_day}`}
                    {canWrite && <span className="ml-2"><TemplateToggle id={t.id} active={t.active} /></span>}
                    {canWrite && <span className="ml-2"><RowActions table="recurring_income_templates" id={t.id} paths={PATHS} canDelete={canDelete}
                      deleteNote="รายได้ที่บันทึกรับไปแล้วยังอยู่" fields={[
                        { name: "name", label: "ชื่อ", value: t.name, width: "w-44" },
                        { name: "expected_amount", label: "ยอดปกติ", type: "number", value: t.expected_amount },
                        { name: "due_day", label: "วันที่", type: "number", value: t.due_day, width: "w-16" },
                        { name: "end_date", label: "สิ้นสุด", type: "date", value: null }]} /></span>}
                  </li>
                ))}
              </ul>
            )}
            {canWrite && <TemplateForm banks={banks} persons={persons ?? []} today={today} />}
          </section>
      </TabPanel>

      {/* ============================================================ ค่าใช้จ่าย */}
      <TabPanel id="expense">
          {canWrite && inMonth && <ExpenseForm banks={banks} cards={cards} persons={persons ?? []} today={maxDate} minDate={minDate} />}
          <p className="text-xs text-slate-500">ไม่บังคับบันทึก · บันทึกก้อนเดียว เช่น &ldquo;ค่าใช้จ่ายทั่วไปประจำเดือน&rdquo; ต่อบัญชีที่จ่าย แล้วแยกเฉพาะรายการสำคัญก็ได้</p>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 font-medium text-slate-900">ค่าใช้จ่ายที่ต้องจ่าย เดือน {thMonth(start)}</h2>
            <p className="mb-3 text-xs text-slate-500">จากค่าใช้จ่ายประจำ (ค่าส่วนกลาง ภาษีที่ดิน ไฟ น้ำ) · ระบบไม่สร้างค่าใช้จ่ายเอง กด &ldquo;บันทึกจ่าย&rdquo; ด้วยยอดจริง</p>
            {costs.length === 0 ? <p className="text-sm text-slate-500">ไม่มีรายการที่คาดไว้ในเดือนนี้</p> : (
              <div className="grid gap-3 md:grid-cols-2">
                {costs.map((c) => (
                  <div key={`${c.utility_id}-${c.cost_period}`} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{utilName(c.utility_type, c.provider)}</div>
                        <div className="text-xs text-slate-500">
                          <Link href={`/property/${c.property_asset_id}`} className="hover:underline">{c.property_name}</Link>
                          {" · "}ครบ {thDate(c.due_date)}{c.cost_period < start && ` · งวด ${thMonth(c.cost_period)}`}
                        </div>
                      </div>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${c.status === "PAID" ? "bg-emerald-50" : c.status === "OVERDUE" ? "bg-red-50" : "bg-slate-100"} ${COST_STATUS[c.status]?.cls ?? ""}`}>
                        {COST_STATUS[c.status]?.text ?? c.status}
                      </span>
                    </div>
                    <div className="mt-1 tabular-nums">
                      คาดไว้ {money(c.expected_amount, c.currency)}
                      {Number(c.paid_amount) > 0 && <span className="text-emerald-700"> · จ่ายจริง {money(c.paid_amount)}</span>}
                      {pv.assetPct(c.property_asset_id) != null && <div className="text-xs text-slate-500">ส่วนของ {pv.personName} {pv.assetPct(c.property_asset_id)}%</div>}
                    </div>
                    {canWrite && c.status !== "PAID" && (
                      <div className="mt-2">
                        <RecordCostForm assetId={c.property_asset_id} utilityId={c.utility_id} period={c.cost_period} currency={c.currency}
                          label={`${utilName(c.utility_type, c.provider)} · ${c.property_name} (${thMonth(c.cost_period)})`}
                          category={UTIL_EXPENSE_CATEGORY[c.utility_type] ?? "บ้าน / สาธารณูปโภค"} expected={Number(c.expected_amount)}
                          banks={banks} cards={cards} persons={persons ?? []} today={today} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-medium text-slate-900">ค่าใช้จ่ายที่บันทึกแล้ว</h2>
                <div className="mt-0.5 text-sm">
                  <span className="font-semibold tabular-nums">{track === "NOT_TRACKED" ? "ไม่ได้บันทึก" : money(expenseThb, "THB", 0)}</span>
                  <span className={`ml-2 text-xs ${TRACK[track].cls}`}>{TRACK[track].text}</span>
                </div>
              </div>
              {canWrite && track !== "NOT_TRACKED" && inMonth && <MonthStatusForm month={start} status={track} />}
            </div>
            {itemList.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีค่าใช้จ่ายในเดือนนี้</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr><th className="py-1">วันที่</th><th>รายละเอียด</th><th>หมวด</th><th>จ่ายด้วย</th><th className="text-right">จำนวน</th><th className="pl-4">เงินคืน</th><th></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {itemList.map((i) => {
                    const r = rs.get(i.id);
                    const cap = Number(i.expected_reimbursement_amount ?? i.full_amount);   // เงินคืนคิดจากยอดเต็มของรายการ
                    const remaining = cap - Number(r?.reimbursed_amount ?? 0);
                    return (
                      <tr key={i.id} className="align-top">
                        <td className="py-1.5">{thDate(i.date)}</td>
                        <td>{i.description}{i.notes && <div className="text-xs text-slate-400">{i.notes}</div>}</td>
                        <td className="text-slate-600">{i.expense_category === "BANK_FEE" ? "ค่าธรรมเนียมธนาคาร" : i.expense_category}</td>
                        <td className="text-xs text-slate-600">
                          {i.source_cash_movement_id ? "จากรายการโอน (แก้ที่รายการโอน)"
                            : i.paid_from_asset_id ? name.get(i.paid_from_asset_id) ?? "บัญชี"
                            : i.paid_from_credit_card_id ? `บัตร ${name.get(i.paid_from_credit_card_id) ?? ""}`
                            : `เงินสด · ${pname(i.persons) ?? "ส่วนกลาง"}`}
                        </td>
                        <td className="text-right tabular-nums">{money(i.amount, i.currency)}
                          {i.pct != null && <div className="text-xs text-slate-500">{i.pct}% ของ {money(i.full_amount)}</div>}</td>
                        <td className="pl-4 text-xs">
                          {i.is_reimbursable && (
                            <>
                              <div className={r?.reimbursement_status === "FULL" ? "text-emerald-700" : "text-amber-700"}>
                                {REIMB[r?.reimbursement_status ?? "PENDING"]} {Number(r?.reimbursed_amount ?? 0) > 0 && `(${money(r?.reimbursed_amount)})`}
                              </div>
                              {canWrite && remaining > 0 && (
                                <ReimbursementForm itemId={i.id} remaining={remaining} currency={i.currency} banks={banks} cards={cards} claims={claims}
                                  today={today} minDate={goLive} />
                              )}
                            </>
                          )}
                        </td>
                        <td className="pl-2 text-right">
                          {canWrite && !i.source_cash_movement_id && (
                            <RowActions table="expense_items" id={i.id} paths={PATHS} canDelete={canDelete} fields={[
                              { name: "date", label: "วันที่", type: "date", value: i.date },
                              { name: "description", label: "รายละเอียด", value: i.description, width: "w-44" },
                              { name: "amount", label: "จำนวน", type: "number", value: i.full_amount },
                              { name: "expense_category", label: "หมวด", value: i.expense_category },
                              ...(i.is_reimbursable ? [{ name: "expected_reimbursement_amount", label: "คาดได้คืน", type: "number" as const, value: i.expected_reimbursement_amount }] : [])]} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
          <p className="text-xs text-slate-500">เงินคืนไม่ใช่รายได้ และไม่แก้ยอดค่าใช้จ่ายเดิม · รายงานแสดง ค่าใช้จ่าย − เงินคืน = ค่าใช้จ่ายสุทธิ</p>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium text-slate-900">ตั้งค่าค่าใช้จ่ายประจำ</h2>
              {[...costYear.entries()].filter(([, v]) => v > 0).map(([ccy, v]) => (
                <span key={ccy} className="text-sm text-slate-600">ประมาณการต่อปี <span className="font-medium tabular-nums">{money(v, ccy, 0)}</span></span>
              ))}
            </div>
            {utils.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มี</p> : (
              <ul className="space-y-1 text-sm">
                {utils.map((u) => (
                  <li key={u.id}>
                    <Link href={`/property/${u.property_details.asset_id}`} className="hover:underline">{u.property_details.assets.name}</Link>
                    {" · "}{utilName(u.utility_type, u.provider)} · {money(u.expected_amount, u.currency)} · {scheduleText(u.frequency, u.due_day, u.due_month)}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-500">แก้ไข / ลบ ได้ที่หน้าทรัพย์สินแต่ละรายการ (กดชื่อทรัพย์สิน)</p>
            {canWrite && properties.length > 0 && <UtilityForm properties={properties} label="+ ค่าใช้จ่ายประจำ" tracked />}
          </section>
      </TabPanel>

      {/* ============================================================ โอน & จ่ายหนี้ */}
      <TabPanel id="moves">
          {canWrite && inMonth && <MovementForm banks={banks} cards={cards} liabilities={liabs} today={maxDate} minDate={minDate} />}
          <p className="text-xs text-slate-500">โอนเข้า/ออกพอร์ตลงทุนทำที่หน้า Investments · การรับ/คืนเงินประกันทำที่หน้า Property</p>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <MovesTable moves={moveList} name={name} actions={canWrite} canDelete={canDelete} />
          </section>
      </TabPanel>
    </div>
    </TabsProvider>
  );
}

type Move = { id: string; movement_date: string; movement_type: string; from_asset_id: string | null; to_asset_id: string | null;
  to_credit_card_id: string | null; to_liability_id: string | null; amount: number; currency: string; counter_amount: number | null;
  counter_currency: string | null; fee: number | null; is_derived: boolean; description: string | null; movement_group_id?: string | null;
  parts?: Move[] };

/** รับชำระเงินให้กู้ครั้งเดียว (เงินต้น + ดอกเบี้ย) เข้าบัญชีเดียวกัน → รวมเป็น 1 แถว ให้ตรงกับ Statement */
function mergeGroups(moves: Move[]): Move[] {
  const out: Move[] = []; const byGroup = new Map<string, Move>();
  moves.forEach((m) => {
    const g = m.movement_group_id;
    const merged = g ? byGroup.get(g) : undefined;
    if (merged && merged.to_asset_id && merged.to_asset_id === m.to_asset_id) {
      merged.parts = [...(merged.parts ?? [merged]), m];
      merged.amount = Number(merged.amount) + Number(m.amount);
      return;
    }
    const r = { ...m }; out.push(r);
    if (g) byGroup.set(g, r);
  });
  return out;
}

const EDITABLE_MOVES = ["TRANSFER", "FX_EXCHANGE", "CARD_PAYMENT", "LIABILITY_PAYMENT", "OTHER_IN", "OTHER_OUT",
  "INVESTMENT_OUT", "INVESTMENT_IN", "LOAN_DISBURSEMENT", "SECURITY_DEPOSIT_IN"];

function MovesTable({ moves, name, actions = false, canDelete = false }: { moves: Move[]; name: Map<string, string>; actions?: boolean; canDelete?: boolean }) {
  if (!moves.length) return <p className="text-sm text-slate-500">ยังไม่มีรายการในเดือนนี้</p>;
  const rows = mergeGroups(moves);
  const partLabel = (m: Move) => (m.movement_type === "LOAN_PRINCIPAL_RECEIPT" ? "เงินต้น" : m.movement_type === "INCOME" ? "ดอกเบี้ย" : MOVE_LABEL[m.movement_type] ?? m.movement_type);
  const label = (id: string | null) => (id ? name.get(id) ?? "พอร์ต / ทรัพย์สิน" : "ภายนอก");
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-500">
        <tr><th className="py-1">วันที่</th><th>ประเภท</th><th>จาก → ไป</th><th className="text-right">จำนวน</th><th className="pl-4">รายละเอียด</th>{actions && <th></th>}</tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((m) => (
          <tr key={m.id} className="align-top">
            <td className="py-1.5">{thDate(m.movement_date)}</td>
            <td className={m.movement_type === "REIMBURSEMENT_IN" ? "text-sky-700" : ""}>{m.parts ? "รับชำระเงินกู้" : MOVE_LABEL[m.movement_type] ?? m.movement_type}</td>
            <td className="text-xs text-slate-600">
              {label(m.from_asset_id)} → {m.to_credit_card_id ? `บัตร ${label(m.to_credit_card_id)}` : m.to_liability_id ? label(m.to_liability_id) : label(m.to_asset_id)}
            </td>
            <td className="text-right tabular-nums">
              {money(m.amount, m.currency)}
              {m.counter_amount != null && <div className="text-xs text-slate-500">→ {money(m.counter_amount, m.counter_currency ?? undefined)}</div>}
              {Number(m.fee ?? 0) > 0 && <div className="text-xs text-slate-500">ค่าธรรมเนียม {money(m.fee)}</div>}
            </td>
            <td className="pl-4 text-xs text-slate-500">{m.parts ? m.parts.map((x) => `${partLabel(x)} ${money(x.amount)}`).join(" + ") : m.description}{!m.parts && m.is_derived && <span className="ml-1 text-slate-400">(ระบบสร้าง · แก้ที่รายการต้นทาง)</span>}</td>
            {actions && (
              <td className="pl-2 text-right">
                {!m.parts && !m.is_derived && EDITABLE_MOVES.includes(m.movement_type) && (
                  <RowActions table="cash_movements" id={m.id} paths={PATHS} canDelete={canDelete}
                    deleteNote={m.movement_type === "INVESTMENT_OUT" || m.movement_type === "INVESTMENT_IN" ? "รายการฝาก/ถอนในพอร์ตจะถูกลบตาม" : undefined}
                    fields={[
                      { name: "movement_date", label: "วันที่", type: "date", value: m.movement_date },
                      { name: "amount", label: "จำนวน", type: "number", value: m.amount },
                      ...(m.movement_type === "FX_EXCHANGE" ? [{ name: "counter_amount", label: "ยอดปลายทาง", type: "number" as const, value: m.counter_amount }] : []),
                      ...(["TRANSFER", "FX_EXCHANGE"].includes(m.movement_type) ? [{ name: "fee", label: "ค่าธรรมเนียม", type: "number" as const, value: m.fee }] : []),
                      { name: "description", label: "รายละเอียด", value: m.description, width: "w-40" }]} />
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Kpi({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className={`mt-1 text-xs ${cls ?? "text-slate-500"}`}>{sub}</div>}
    </div>
  );
}
