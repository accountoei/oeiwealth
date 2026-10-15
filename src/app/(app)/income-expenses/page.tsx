import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import RowActions from "@/components/RowActions";
import {
  COST_STATUS, INCOME_TYPE_LABEL, MOVE_LABEL, PERIODS_PER_YEAR, UTIL_EXPENSE_CATEGORY, UTIL_LABEL, money, monthOptions, monthRange, scheduleText,
  thDate, thMonth, todayBangkok,
} from "@/lib/format";
import { RecordCostForm, UtilityForm, type PropertyPick } from "../property/[id]/forms";
import {
  AccountEditor, AutopayConfirmForm, ExpectedActions, ExpenseForm, IncomeForm, MonthStatusForm, MovementForm, ReimbursementForm, TemplateForm, TemplateToggle,
  type Bank, type Card, type Claim, type Liab,
} from "./forms";
import { SubPanel, SubTabs, TabLink, TabNav, TabPanel, TabsProvider } from "./tabs";
import { ActionRow } from "@/components/ActionBar";
import CategoryBars, { type CatRow } from "./CategoryBars";
import DueTable from "./DueTable";
import MovesView, { type MoveRow } from "./MovesView";
import MonthPicker from "@/components/MonthPicker";
import SplitForm from "./SplitForm";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import { PaymentForm as LoanPaymentForm } from "../financial/loans/[id]/forms";
import { LOAN_SCHED_STATUS } from "@/lib/loan-schedule";
import { BenefitForm, PayPremiumForm } from "../insurance/[id]/ins-forms";
import { BENEFIT_TYPE_LABEL, INS_SCHED_STATUS } from "@/lib/format";

const PATHS = ["/income-expenses", "/financial/cash"];
const TABS: [string, string][] = [["overview", "ภาพรวม"], ["income", "รายได้"], ["expense", "ค่าใช้จ่าย"], ["moves", "เงินเข้า–ออก & โอน"]];
const EXP_STATUS: Record<string, { text: string; cls: string }> = {
  RECEIVED: { text: "ได้รับแล้ว", cls: "bg-emerald-50 text-emerald-700" }, PENDING: { text: "รอรับ", cls: "bg-slate-100 text-slate-700" },
  OVERDUE: { text: "เลยกำหนด", cls: "bg-red-50 text-red-700" }, DISMISSED: { text: "เดือนนี้ไม่ได้รับ", cls: "bg-slate-100 text-slate-500" },
};
const TRACK: Record<string, { text: string; cls: string }> = {
  NOT_TRACKED: { text: "ไม่ได้บันทึก", cls: "text-slate-500" }, PARTIAL: { text: "บันทึกบางส่วน (ข้อมูลไม่ครบ)", cls: "text-amber-700" },
  COMPLETE: { text: "บันทึกครบแล้ว", cls: "text-emerald-700" },
};
const REIMB: Record<string, string> = { PENDING: "รอรับเงินคืน", PARTIAL: "ได้คืนบางส่วน", FULL: "ได้คืนครบ" };

type Sp = Promise<{ tab?: string; m?: string; p?: string; it?: string; et?: string }>;

export default async function IncomeExpensesPage({ searchParams }: { searchParams: Sp }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const today = todayBangkok();
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? (sp.m as string) : today.slice(0, 7);
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  const { start, end } = monthRange(ym);
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const pv = await loadPersonView(sp.p, { liabilities: true });
  // มุมมองรายบุคคล: ส่วนแบ่งรายได้ / ค่าใช้จ่ายของคนที่เลือก (กติกาเดียวกับ Dashboard)
  //   ระบุคนเอง → 100% · ไม่ระบุ: ค่าใช้จ่าย = เจ้าของบัตร / เจ้าของบัญชีที่จ่าย · รายได้ = เจ้าของทรัพย์สิน / เจ้าของบัญชีที่รับ
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
    { data: reimbs }, { data: moves }, { data: claimsRaw }, { data: costRows }, { data: utilRows }, { data: propRows }, { data: loanRows }, { data: insRows }] = await Promise.all([
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("credit_cards").select("id,person_id,issuer,card_name,card_last4,currency,outstanding_balance,balance_date,status,due_day,autopay_asset_id,autopay_mode")
      .is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("liabilities").select("id,name,currency,outstanding_amount").is("deleted_at", null).eq("status", "ACTIVE"),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("v_fx_status").select("currency,rate_to_thb"),
    supabase.from("income_transactions").select("id,date,income_type,amount,tax,currency,base_amount,received_to_asset_id,received_to_credit_card_id,person_id,lease_id,source_transaction_id,asset_id,insurance_schedule_line_id,notes,pending_split,persons(name),ins_line:insurance_schedule_lines(policy_id),src_asset:assets!income_transactions_asset_id_fkey(name)")
      .is("deleted_at", null).gte("date", start).lte("date", end).order("date", { ascending: false }),
    supabase.from("v_expected_income").select("*").eq("income_period", start).order("due_date"),
    supabase.from("recurring_income_templates").select("id,name,income_type,expected_amount,currency,frequency,due_day,active,person_id,receive_to_asset_id,start_date,end_date,persons(name)")
      .is("deleted_at", null).order("name"),
    supabase.from("monthly_expenses").select("id,total_amount,tracking_status").eq("year_month", start).is("deleted_at", null).maybeSingle(),
    supabase.from("expense_items").select("id,date,description,amount,currency,base_amount,expense_category,paid_from_asset_id,paid_from_credit_card_id,liability_id,insurance_schedule_line_id,property_utility_id,source_fee_side,related_asset_id,pending_split,person_id,source_cash_movement_id,is_reimbursable,expected_reimbursement_amount,notes,persons(name),ins_line:insurance_schedule_lines(policy_id)")
      .is("deleted_at", null).gte("date", start).lte("date", end).order("date", { ascending: false }),
    supabase.from("v_expense_reimbursement_status").select("expense_item_id,reimbursed_amount,reimbursement_status").eq("is_reimbursable", true),
    supabase.from("expense_reimbursements").select("id,received_date,amount,currency,expense_item_id").is("deleted_at", null).gte("received_date", start).lte("received_date", end),
    supabase.from("cash_movements").select("id,movement_date,movement_type,from_asset_id,to_asset_id,to_credit_card_id,to_liability_id,amount,currency,counter_amount,counter_currency,fee,is_derived,description,movement_group_id,source_entity_type,source_entity_id")
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
    // งวดเบี้ยประกัน / ผลประโยชน์: ครบกำหนดเดือนนี้ + ที่เลยกำหนดจากเดือนก่อน
    supabase.from("v_insurance_schedule_status")
      .select("id,policy_id,kind,installment_no,due_date,amount,currency,benefit_type,remaining,status,insurer,policy_no,person_id,payer_person_id,cash_value_asset_id")
      .or(`and(due_date.gte.${start},due_date.lte.${end}),and(status.in.(OVERDUE,PARTIAL),due_date.lt.${start})`)
      .neq("status", "CLOSED").order("due_date"),
  ]);

  // รายการ "รอแยกรายละเอียด" ทุกเดือน (แจ้งเตือน)
  const [{ data: pendExp }, { data: pendInc }, { data: cardBalRaw }] = await Promise.all([
    supabase.from("expense_items").select("id,date").eq("pending_split", true).is("deleted_at", null),
    supabase.from("income_transactions").select("id,date").eq("pending_split", true).is("deleted_at", null),
    supabase.from("v_card_balances").select("card_id,current_balance"),
  ]);
  const pendingMonths = [...new Set([...(pendExp ?? []), ...(pendInc ?? [])].map((x) => String(x.date).slice(0, 7)))].sort();
  const pendingCount = (pendExp ?? []).length + (pendInc ?? []).length;
  const goLive = family?.go_live_date ?? "";
  const minDate = goLive > start ? goLive : start;
  const maxDate = end < today ? end : today;
  const banks = (banksRaw as Bank[] | null) ?? [];
  const cardCur = new Map((cardBalRaw ?? []).map((r) => [r.card_id as string, Number(r.current_balance)]));
  const cards: Card[] = (cardsRaw ?? []).map((c) => ({ id: c.id, currency: c.currency, outstanding_balance: cardCur.get(c.id) ?? Number(c.outstanding_balance),
    label: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ") }));
  const liabs = (liabRaw as Liab[] | null) ?? [];
  const rate = new Map<string, number>([["THB", 1], ...((fx ?? []).map((r) => [r.currency, Number(r.rate_to_thb)] as [string, number]))]);
  const thb = (v: number | null, c: string) => Number(v ?? 0) * (rate.get(c) ?? 0);
  const name = new Map<string, string>([...banks.map((b) => [b.asset_id, b.name] as [string, string]),
    ...cards.map((c) => [c.id, c.label] as [string, string]), ...liabs.map((l) => [l.id, l.name] as [string, string])]);
  const personOpts: [string, string][] = (persons ?? []).map((p) => [p.id, p.name]);
  const pname = (p: unknown) => ((Array.isArray(p) ? p[0] : p) as { name: string } | null)?.name;
  const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
  // รายการที่สร้างจากหน้าอื่น → แก้ / ลบที่หน้าต้นทาง (null = บันทึกที่หน้านี้ แก้ที่นี่ได้)
  const policyOf = (x: unknown) => one(x as { policy_id: string } | { policy_id: string }[] | null)?.policy_id;
  const incSource = (i: { source_transaction_id: string | null; lease_id: string | null; asset_id: string | null; income_type: string;
    insurance_schedule_line_id: string | null; ins_line?: unknown }): { href: string; label: string } | null => {
    if (i.source_transaction_id) return { href: `/investments/${i.asset_id}`, label: "พอร์ตลงทุน" };
    if (i.lease_id) return { href: `/property/${i.asset_id}`, label: "ทรัพย์สิน (สัญญาเช่า)" };
    if (i.insurance_schedule_line_id || i.income_type === "INSURANCE_BENEFIT") {
      const pol = policyOf(i.ins_line);
      return { href: pol ? `/insurance/${pol}` : "/insurance", label: "กรมธรรม์" };
    }
    if (i.income_type === "LOAN_INTEREST" && i.asset_id) return { href: `/financial/loans/${i.asset_id}`, label: "เงินให้กู้" };
    if (i.income_type === "BUSINESS_DIVIDEND" && i.asset_id) return { href: `/financial/business/${i.asset_id}`, label: "กิจการ" };
    if (i.asset_id) return { href: `/a/${i.asset_id}`, label: "ทรัพย์สิน" };
    return null;
  };
  const expSource = (i: { source_cash_movement_id: string | null; liability_id: string | null; insurance_schedule_line_id: string | null;
    property_utility_id: string | null; related_asset_id: string | null; ins_line?: unknown }): { href: string; label: string } | null => {
    if (i.source_cash_movement_id) return { href: `/income-expenses?tab=moves&m=${ym}`, label: "รายการโอน" };
    if (i.liability_id) return { href: `/liabilities/${i.liability_id}`, label: "หนี้สิน" };
    if (i.insurance_schedule_line_id) { const pol = policyOf(i.ins_line); return { href: pol ? `/insurance/${pol}` : "/insurance", label: "กรมธรรม์" }; }
    if (i.property_utility_id) return { href: i.related_asset_id ? `/property/${i.related_asset_id}` : "/property", label: "ทรัพย์สิน (ค่าใช้จ่ายประจำ)" };
    return null;
  };
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
  type InsDue = { id: string; policy_id: string; kind: string; installment_no: number; due_date: string; amount: number; currency: string;
    benefit_type: string | null; remaining: number; status: string; insurer: string; policy_no: string | null; person_id: string | null;
    payer_person_id: string | null; cash_value_asset_id: string | null };
  const insDue = ((insRows as InsDue[] | null) ?? []).filter((x) => pv.isPerson(x.payer_person_id) || pv.isPerson(x.person_id));
  const premiumDue = insDue.filter((x) => x.kind === "PREMIUM");
  const benefitDue = insDue.filter((x) => x.kind === "BENEFIT");
  const insName = (x: InsDue) => `${x.insurer}${x.policy_no ? ` ${x.policy_no}` : ""}`;
  // โอน & จ่ายหนี้: รายการที่แตะบัญชี / บัตร / หนี้ ของคนนั้น (แสดงยอดเต็ม)
  const moveList = (moves ?? []).filter((m) => !pv.personId || [m.from_asset_id, m.to_asset_id].some((id) => id && pv.showAsset(id))
    || [m.to_credit_card_id, m.to_liability_id].some((id) => id && pv.showLiability(id)));
  // ชื่อทรัพย์สินอื่นในรายการเงิน (เงินให้กู้ / พอร์ต / ทรัพย์สิน / มูลค่าเวนคืน)
  const otherIds = [...new Set(moveList.flatMap((m) => [m.from_asset_id, m.to_asset_id]).filter((x): x is string => !!x && !name.has(x)))];
  const { data: otherAssets } = otherIds.length
    ? await supabase.from("assets").select("id,name,asset_type").in("id", otherIds)
    : { data: [] as { id: string; name: string; asset_type: string }[] };
  const ASSET_PREFIX: Record<string, string> = { LOAN_RECEIVABLE: "เงินให้กู้", INVESTMENT_PORTFOLIO: "พอร์ต", INSURANCE_CASH_VALUE: "มูลค่าเวนคืน" };
  const otherName = new Map((otherAssets ?? []).map((a) => [a.id as string, [ASSET_PREFIX[a.asset_type as string], a.name].filter(Boolean).join(" ")]));
  const assetType = new Map((otherAssets ?? []).map((a) => [a.id as string, a.asset_type as string]));
  // บัตรตัดบัญชีอัตโนมัติ: งวดของเดือนนี้ที่ยังไม่มีรายการจ่ายบัตร → ถึงวันครบชำระแล้ว = "รอยืนยัน" · ยังไม่ถึง = "จะตัด"
  const lastDay = Number(end.slice(8, 10));
  const autopay = (cardsRaw ?? [])
    .filter((c) => c.status === "ACTIVE" && c.autopay_asset_id && c.due_day && pv.isPerson(c.person_id))
    .map((c) => ({
      id: c.id as string, bank: c.autopay_asset_id as string, currency: c.currency as string, minimum: c.autopay_mode === "MINIMUM",
      label: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" "),
      balance: Number(c.outstanding_balance), balanceDate: c.balance_date as string | null,
      due: `${start.slice(0, 8)}${String(Math.min(Number(c.due_day), lastDay)).padStart(2, "0")}`,
      paid: (moves ?? []).some((m) => m.movement_type === "CARD_PAYMENT" && m.to_credit_card_id === c.id),
    }))
    .filter((x) => !x.paid && (!goLive || x.due >= goLive) && (x.minimum || x.balance > 0))
    .sort((a, b) => a.due.localeCompare(b.due));
  const autopayPending = autopay.filter((x) => x.due <= today);
  const bankIds = new Set(banks.map((b) => b.asset_id));
  const incById = new Map((incomes ?? []).map((i) => [i.id as string, i]));
  const expById = new Map((items ?? []).map((i) => [i.id as string, i]));
  const placeOf = (id: string | null) => (id ? name.get(id) ?? otherName.get(id) ?? "ทรัพย์สิน" : "ภายนอก");
  // กดที่รายละเอียดเพื่อไปแก้ที่ต้นทาง (ขีดเส้นใต้ · เมาส์เป็นรูปมือ)
  const srcLink = (l: { href: string; label: string; tab?: string } | null, text: React.ReactNode) => {
    const cls = "cursor-pointer underline decoration-slate-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-400";
    if (!l || !text) return text;
    return l.tab ? <TabLink tab={l.tab} href={l.href} className={cls}>{text}</TabLink>
      : <Link href={l.href} title={`แก้ที่หน้า${l.label}`} className={cls}>{text}</Link>;
  };
  const tabLink = (tab: string, label: string) => ({
    href: `/income-expenses?tab=${tab}&m=${ym}${tab === "income" ? "&it=recorded" : tab === "expense" ? "&et=recorded" : ""}${pv.personId ? `&p=${pv.personId}` : ""}`, label, tab });
  const moveRows = (withActions: boolean): MoveRow[] => mergeGroups(moveList as Move[]).map((m) => {
    let detail: React.ReactNode = m.description;
    let link: { href: string; label: string; tab?: string } | null = null;
    let type = MOVE_LABEL[m.movement_type] ?? m.movement_type;
    let pending = false;
    if (m.parts) {
      type = "รับชำระเงินให้กู้";
      detail = m.parts.map((x) => `${x.movement_type === "LOAN_PRINCIPAL_RECEIPT" ? "เงินต้น" : x.movement_type === "INCOME" ? "ดอกเบี้ย" : MOVE_LABEL[x.movement_type] ?? x.movement_type} ${money(x.amount)}`).join(" + ");
      const loan = m.parts.find((x) => x.from_asset_id)?.from_asset_id;
      link = loan ? { href: `/financial/loans/${loan}`, label: "เงินให้กู้" } : null;
    } else if (m.is_derived && m.source_entity_type === "INCOME") {
      const inc = m.source_entity_id ? incById.get(m.source_entity_id) : undefined;
      if (inc) {
        type = INCOME_TYPE_LABEL[inc.income_type] ?? type;
        pending = !!inc.pending_split;
        detail = [inc.lease_id || inc.asset_id ? pname(inc.src_asset) : null, inc.notes].filter(Boolean).join(" · ") || type;
        link = incSource(inc) ?? tabLink("income", "แท็บรายได้");
      } else link = tabLink("income", "แท็บรายได้");
    } else if (m.is_derived && m.source_entity_type === "EXPENSE") {
      const it = m.source_entity_id ? expById.get(m.source_entity_id) : undefined;
      if (it) { detail = it.description; pending = !!it.pending_split; link = expSource(it); if (link?.label === "รายการโอน") link = null; else link = link ?? tabLink("expense", "แท็บค่าใช้จ่าย"); }
      else link = tabLink("expense", "แท็บค่าใช้จ่าย");
    } else if (m.is_derived && m.source_entity_type === "REIMBURSEMENT") {
      link = tabLink("expense", "แท็บค่าใช้จ่าย");
    } else if (m.is_derived && m.source_entity_type === "INVESTMENT_TX") {
      const pf = [m.from_asset_id, m.to_asset_id].find((x) => x && assetType.get(x) === "INVESTMENT_PORTFOLIO");
      link = { href: pf ? `/investments/${pf}` : "/investments", label: "พอร์ตลงทุน" };
    } else if (m.is_derived) {
      link = null;
    }
    const counter = m.counter_amount != null ? Number(m.counter_amount) : Number(m.amount);
    return {
      key: m.id, date: m.movement_date, type, typeCls: m.movement_type === "REIMBURSEMENT_IN" ? "text-sky-700" : undefined,
      fromLabel: placeOf(m.from_asset_id),
      toLabel: m.to_credit_card_id ? `บัตร ${placeOf(m.to_credit_card_id)}` : m.to_liability_id ? placeOf(m.to_liability_id) : placeOf(m.to_asset_id),
      fromBank: m.from_asset_id && bankIds.has(m.from_asset_id) ? m.from_asset_id : null,
      toBank: m.to_asset_id && bankIds.has(m.to_asset_id) ? m.to_asset_id : null,
      fromAmount: Number(m.amount), fromCcy: m.currency, toAmount: counter, toCcy: m.counter_currency ?? m.currency,
      extra: <>
        {m.counter_amount != null && (m.counter_currency !== m.currency || Number(m.counter_amount) !== Number(m.amount)) && <div className="text-xs text-slate-500">{money(m.amount, m.currency)} → {money(m.counter_amount, m.counter_currency ?? undefined)}</div>}
        {m.counter_amount == null && m.counter_currency && <div className="text-xs text-amber-700">→ รอยอด {m.counter_currency}</div>}
        {Number(m.fee ?? 0) > 0 && <div className="text-xs text-slate-500">ค่าธรรมเนียม {money(m.fee)}</div>}
      </>,
      detail: <>{pending && <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">รอแยกรายละเอียด</span>}{srcLink(link, detail || type)}</>,
      actions: withActions && !m.parts && !m.is_derived && EDITABLE_MOVES.includes(m.movement_type) ? (
        <RowActions table="cash_movements" id={m.id} paths={PATHS} canDelete={canDelete}
          deleteNote={m.movement_type === "INVESTMENT_OUT" || m.movement_type === "INVESTMENT_IN" ? "รายการฝาก/ถอนในพอร์ตจะถูกลบตาม" : undefined}
          fields={[
            { name: "movement_date", label: "วันที่", type: "date", value: m.movement_date },
            { name: "amount", label: "จำนวน", type: "number", value: m.amount },
            ...(m.movement_type === "FX_EXCHANGE" ? [{ name: "counter_amount", label: "ยอดปลายทาง", type: "number" as const, value: m.counter_amount }] : []),
            ...(["TRANSFER", "FX_EXCHANGE"].includes(m.movement_type) ? [{ name: "fee", label: "ค่าธรรมเนียม", type: "number" as const, value: m.fee }] : []),
            { name: "description", label: "รายละเอียด", value: m.description, width: "w-40" }]} />
      ) : null,
    };
  });
  const bankOpts = banks.map((b) => ({ id: b.asset_id, name: b.name }));
  // สรุปเงินเข้า–ออก (ทุกบัญชี · ไม่นับโอนระหว่างบัญชีตัวเอง) สำหรับแท็บภาพรวม
  const moveSum = moveRows(false).reduce((acc, r) => {
    const t = (c: string) => acc.byCcy.get(c) ?? acc.byCcy.set(c, { inn: 0, out: 0 }).get(c)!;
    if (r.toBank && !r.fromBank) t(r.toCcy).inn += r.toAmount;
    else if (r.fromBank && !r.toBank) t(r.fromCcy).out += r.fromAmount;
    acc.count += 1;
    return acc;
  }, { count: 0, byCcy: new Map<string, { inn: number; out: number }>() });
  const savings = grossThb - taxThb - (expenseThb - reimbThb);
  const rs = new Map((reimbStatus ?? []).map((r) => [r.expense_item_id, r]));
  const inMonth = start <= today && (!goLive || end >= goLive);
  const months = monthOptions(goLive, today, 3, ym);
  // แท็บย่อย: มีรายการค้าง → เปิด "ที่ต้องได้รับ / จ่าย" ก่อน · ไม่มี → "บันทึกแล้ว"
  const incOpen = expectedList.filter((e) => e.status === "PENDING" || e.status === "OVERDUE").length
    + loanDue.filter((x) => x.status !== "PAID").length + benefitDue.filter((x) => x.status !== "PAID" && x.status !== "CLOSED").length;
  const expOpen = costs.filter((c) => c.status !== "PAID").length + premiumDue.filter((x) => x.status !== "PAID" && x.status !== "CLOSED").length;
  const SUBS = ["due", "recorded", "settings"];
  const incTab = SUBS.includes(sp.it ?? "") ? (sp.it as string) : incOpen > 0 ? "due" : "recorded";
  const expTab = SUBS.includes(sp.et ?? "") ? (sp.et as string) : expOpen > 0 ? "due" : "recorded";
  // ภาพรวมตามประเภท / หมวด (บาท · ตามสัดส่วนเมื่อดูรายบุคคล)
  const group = (rows: { label: string; pending: boolean; name: string; date: string; value: number }[]) => {
    const m = new Map<string, CatRow>();
    for (const r of rows) {
      const g = m.get(r.label) ?? { label: r.label, value: 0, items: [], pending: r.pending };
      g.value += r.value; g.items.push({ name: r.name, date: r.date, value: r.value }); m.set(r.label, g);
    }
    return [...m.values()];
  };
  const incomeCats = group(incomeList.map((i) => {
    const type = INCOME_TYPE_LABEL[i.income_type] ?? i.income_type;
    return { label: i.pending_split ? "รอแยกรายละเอียด" : type, pending: !!i.pending_split, date: i.date,
      name: i.notes || pname(i.src_asset) || pname(i.persons) || type, value: Number(i.base_amount ?? 0) };
  }));
  const expenseCats = group(itemList.map((i) => ({
    label: i.pending_split ? "รอแยกรายละเอียด" : i.expense_category || "ไม่ระบุหมวด", pending: !!i.pending_split, date: i.date,
    name: i.description, value: Number(i.base_amount ?? 0) * i.share })));

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
          <MonthPicker months={months} value={ym} />
        </div>
      </div>

      <TabNav tabs={TABS} />
      {pendingCount > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          มีรายการ &ldquo;รอแยกรายละเอียด&rdquo; {pendingCount} รายการ (เดือน {pendingMonths.map((m) => thMonth(`${m}-01`)).join(", ")})
          · กด &ldquo;แยกรายการ&rdquo; ที่รายการนั้นในแท็บรายได้ / ค่าใช้จ่าย
        </p>
      )}

      {canWrite && !inMonth && <p className="text-sm text-slate-500">เดือนนี้อยู่นอกช่วงที่บันทึกได้ (ก่อน Go-live หรือเป็นเดือนในอนาคต)</p>}

      {/* ============================================================ ภาพรวม */}
      <TabPanel id="overview">
          {autopayPending.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              บัตรเครดิตตัดบัญชีอัตโนมัติรอยืนยัน {autopayPending.length} รายการ — ดูที่แท็บ &ldquo;เงินเข้า–ออก &amp; โอน&rdquo;
            </p>
          )}
          <section className="grid gap-4 md:grid-cols-4">
            <Kpi label="รายได้รวม (Gross)" value={money(grossThb, "THB", 0)} sub={investThb ? `รวมรายได้ลงทุน ${money(investThb, undefined, 0)}` : "รวมรายได้ลงทุน"} />
            <Kpi label="รายได้สุทธิหลังภาษี" value={money(grossThb - taxThb, "THB", 0)} sub={`ภาษีหัก ณ ที่จ่าย ${money(taxThb, undefined, 0)}`} />
            <Kpi label="ค่าใช้จ่าย" value={track === "NOT_TRACKED" ? "ไม่ได้บันทึก" : money(expenseThb, "THB", 0)}
              sub={`${TRACK[track].text}${reimbThb ? ` · ได้เงินคืน ${money(reimbThb, undefined, 0)}` : ""}`} cls={TRACK[track].cls} />
            <Kpi label="เงินคงเหลือสุทธิ" value={track === "COMPLETE" ? money(savings, "THB", 0) : "—"}
              sub={track === "COMPLETE" ? "รายได้สุทธิ − ค่าใช้จ่าย" : "แสดงเมื่อยืนยันว่าบันทึกค่าใช้จ่ายครบ"} />
          </section>
          <section className="grid gap-4 lg:grid-cols-2">
            <CategoryBars kind="income" title={`รายได้ตามประเภท ${thMonth(start)}`} rows={incomeCats}
              note="ยอดก่อนหักภาษี (บาท) · กดที่ประเภทเพื่อดูรายการ" empty="ยังไม่มีรายได้ที่บันทึกในเดือนนี้" />
            <CategoryBars kind="expense" title={`ค่าใช้จ่ายตามหมวด ${thMonth(start)}`} rows={expenseCats}
              note={`ยอดก่อนหักเงินคืน (บาท)${reimbThb ? ` · ได้เงินคืน ${money(reimbThb, undefined, 0)}` : ""} · กดที่หมวดเพื่อดูรายการ`}
              empty={track === "NOT_TRACKED" ? "เดือนนี้ไม่ได้บันทึกค่าใช้จ่าย" : "ยังไม่มีค่าใช้จ่ายที่บันทึกในเดือนนี้"} />
          </section>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5">
            <div>
              <h2 className="font-medium text-slate-900">เงินเข้า–ออกบัญชีเดือนนี้</h2>
              <p className="text-xs text-slate-500">ทุกบัญชีธนาคารในระบบ · ไม่นับโอนระหว่างบัญชีตัวเอง · {moveSum.count} รายการ</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm tabular-nums">
              {[...moveSum.byCcy.entries()].map(([ccy, t]) => (
                <span key={ccy} className="flex flex-wrap gap-x-4">
                  <span className="text-emerald-700">เข้า +{money(t.inn, ccy)}</span>
                  <span className="text-red-700">ออก −{money(t.out, ccy)}</span>
                  <span className={`font-semibold ${t.inn - t.out >= 0 ? "text-emerald-700" : "text-red-700"}`}>สุทธิ {t.inn - t.out >= 0 ? "+" : "−"}{money(Math.abs(t.inn - t.out), ccy)}</span>
                </span>
              ))}
              <TabLink tab="moves" href={`/income-expenses?tab=moves&m=${ym}${pv.personId ? `&p=${pv.personId}` : ""}`} className="text-xs text-blue-700 hover:underline">ดูรายการทั้งหมด →</TabLink>
            </div>
          </section>
      </TabPanel>

      {/* ============================================================ รายได้ */}
      <TabPanel id="income">
          {canWrite && inMonth && <IncomeForm banks={banks} persons={persons ?? []} today={maxDate} minDate={minDate} />}
          <SubTabs param="it" initial={incTab} tabs={[["due", `ที่ต้องได้รับ (${incOpen})`], ["recorded", `บันทึกแล้ว (${incomeList.length})`], ["settings", "รายได้ประจำ"]]}>
          <SubPanel id="due">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 font-medium text-slate-900">รายได้ที่ต้องได้รับ เดือน {thMonth(start)}</h2>
            <p className="mb-3 text-xs text-slate-500">จากรายได้ประจำ สัญญาเช่า ตารางผ่อนเงินให้กู้ และผลประโยชน์ประกัน · ระบบไม่สร้างรายได้เอง กด &ldquo;บันทึกรับ&rdquo; ด้วยยอดจริง</p>
            {expectedList.length === 0 && loanDue.length === 0 && benefitDue.length === 0 ? <p className="text-sm text-slate-500">ไม่มีรายการที่คาดไว้ในเดือนนี้</p> : (
              <DueTable kind="income" rows={[
                ...expectedList.map((e) => {
                  const tpl = (templates ?? []).find((t) => t.id === e.source_id);
                  return { key: `t-${e.source_type}-${e.source_id}`, due: e.due_date as string, type: e.source_type === "LEASE" ? "ค่าเช่า" : "รายได้ประจำ",
                    currency: e.currency as string, expected: Number(e.expected_amount), done: Number(e.received_amount ?? 0),
                    open: e.status === "PENDING" || e.status === "OVERDUE", el: (
                    <ActionRow key={`${e.source_type}-${e.source_id}`} colSpan={6} cells={<>
                      <td className="py-2 pr-2">
                        <div className="font-medium">{e.name}</div>
                        <div className="text-xs text-slate-500">{INCOME_TYPE_LABEL[e.income_type] ?? e.income_type}
                          {e.pct != null && ` · ส่วนของ ${pv.personName} ${e.pct}%`}</div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">{thDate(e.due_date)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(e.expected_amount, e.currency)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{e.received_amount != null ? money(e.received_amount) : ""}</td>
                      <td className="px-2 py-2"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${EXP_STATUS[e.status]?.cls ?? ""}`}>{EXP_STATUS[e.status]?.text ?? e.status}</span></td>
                    </>} actions={canWrite && (e.status === "PENDING" || e.status === "OVERDUE") ? (
                      <ExpectedActions sourceType={e.source_type} sourceId={e.source_id} period={start} incomeType={e.income_type}
                        personId={tpl?.person_id ?? null} expected={Number(e.expected_amount)} currency={e.currency}
                        receiveTo={e.receive_to_asset_id} banks={banks} today={maxDate} minDate={minDate} />
                    ) : null} />
                  ) };
                }),
                ...loanDue.map((x) => ({ key: `l-${x.id}`, due: x.due_date, type: "เงินให้กู้", currency: x.currency, expected: Number(x.total_due),
                  done: Number(x.total_due) - Number(x.total_remaining), open: x.status !== "PAID", el: (
                  <ActionRow key={x.id} colSpan={6} cells={<>
                    <td className="py-2 pr-2">
                      <Link href={`/financial/loans/${x.loan_asset_id}`} className="font-medium hover:underline">{x.loan_name}</Link>
                      <div className="text-xs text-slate-500">เงินให้กู้ · {x.borrower_name} · งวดที่ {x.installment_no}
                        {pv.assetPct(x.loan_asset_id) != null && ` · ส่วนของ ${pv.personName} ${pv.assetPct(x.loan_asset_id)}%`}</div>
                      <div className="text-xs text-slate-400">เงินต้น {money(x.principal_due)} + ดอกเบี้ย {money(x.interest_due)} · เงินต้นไม่นับเป็นรายได้</div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">{thDate(x.due_date)}{x.due_date < start && <div className="text-xs text-red-600">งวด {thMonth(x.due_date)}</div>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(x.total_due, x.currency)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {Number(x.total_remaining) < Number(x.total_due) && <span className="text-emerald-700">{money(Number(x.total_due) - Number(x.total_remaining))}</span>}
                      {x.status !== "PAID" && Number(x.total_remaining) < Number(x.total_due) && <div className="text-xs text-amber-700">ค้าง {money(x.total_remaining)}</div>}
                    </td>
                    <td className="px-2 py-2"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${LOAN_SCHED_STATUS[x.status]?.cls ?? ""}`}>{LOAN_SCHED_STATUS[x.status]?.text ?? x.status}</span></td>
                  </>} actions={canWrite && x.status !== "PAID" ? (
                    <LoanPaymentForm assetId={x.loan_asset_id} currency={x.currency} banks={banks} today={today} minDate={goLive} small button="บันทึกรับ"
                      title={`รับชำระ ${x.loan_name} งวดที่ ${x.installment_no}`}
                      principal={Number(x.principal_remaining)} interest={Number(x.interest_remaining)}
                      interestOwed={loanDue.filter((y) => y.loan_asset_id === x.loan_asset_id && y.due_date <= x.due_date)
                        .reduce((s, y) => s + Number(y.interest_remaining), 0)}
                      principalDue={loanDue.filter((y) => y.loan_asset_id === x.loan_asset_id && y.due_date <= x.due_date)
                        .reduce((s, y) => s + Number(y.principal_remaining), 0)} />
                  ) : null} />
                ) })),
                ...benefitDue.map((x) => ({ key: `b-${x.id}`, due: x.due_date, type: "ผลประโยชน์ประกัน", currency: x.currency, expected: Number(x.amount),
                  done: Number(x.amount) - Number(x.remaining), open: x.status !== "PAID" && x.status !== "CLOSED", el: (
                  <ActionRow key={x.id} colSpan={6} cells={<>
                    <td className="py-2 pr-2">
                      <Link href={`/insurance/${x.policy_id}`} className="font-medium hover:underline">{insName(x)}</Link>
                      <div className="text-xs text-slate-500">ผลประโยชน์ประกัน · {BENEFIT_TYPE_LABEL[x.benefit_type ?? "OTHER"]}</div>
                      {x.cash_value_asset_id && <div className="text-xs text-slate-400">ถอนจากมูลค่าเวนคืนก่อน · ส่วนที่เกินนับเป็นรายได้</div>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">{thDate(x.due_date)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(x.amount, x.currency)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {Number(x.remaining) < Number(x.amount) && <span className="text-emerald-700">{money(Number(x.amount) - Number(x.remaining))}</span>}
                      {x.status !== "PAID" && Number(x.remaining) < Number(x.amount) && <div className="text-xs text-amber-700">ค้าง {money(x.remaining)}</div>}
                    </td>
                    <td className="px-2 py-2"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${INS_SCHED_STATUS[x.status]?.cls ?? ""}`}>{x.status === "PAID" ? "ได้รับแล้ว" : INS_SCHED_STATUS[x.status]?.text ?? x.status}</span></td>
                  </>} actions={canWrite && x.status !== "PAID" ? (
                    <BenefitForm policyId={x.policy_id} lineId={x.id} amount={Number(x.remaining)} currency={x.currency} banks={banks}
                      persons={persons ?? []} hasCashValue={!!x.cash_value_asset_id} today={today} small canClose={canDelete} />
                  ) : null} />
                ) })),
              ]} />
            )}
          </section>
          </SubPanel>

          <SubPanel id="recorded">
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
                        {(() => {
                          // รายการจากหน้าอื่น: กดที่ชื่อเพื่อไปแก้ที่ต้นทาง
                          const src = i.pending_split ? null : incSource(i);
                          const text = i.source_transaction_id ? `จาก${pname(i.src_asset) ? ` ${pname(i.src_asset)}` : "พอร์ตลงทุน"}`
                            : i.lease_id ? `ค่าเช่า ${pname(i.src_asset) ?? ""} (แบ่งตามเจ้าของทรัพย์สิน)`
                            : i.income_type === "LOAN_INTEREST" && i.asset_id ? `ดอกเบี้ยจาก ${pname(i.src_asset) ?? "เงินให้กู้"} (แบ่งตามเจ้าของ)`
                            : pname(i.persons) ?? (i.asset_id && pname(i.src_asset) ? `${pname(i.src_asset)} (แบ่งตามเจ้าของ)`
                              : i.received_to_asset_id ? "ตามเจ้าของบัญชีที่รับ" : "ส่วนกลาง");
                          return src ? <Link href={src.href} title={`แก้ที่หน้า${src.label}`} className="cursor-pointer underline decoration-slate-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-400">{text}</Link> : text;
                        })()}
                        {i.notes && !i.source_transaction_id && <div className="text-xs text-slate-400">{i.notes}</div>}
                        {i.pending_split && (
                          <div className="mt-1 space-y-1">
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">รอแยกรายละเอียด</span>
                            {canWrite && canDelete && <SplitForm kind="INCOME" id={i.id} amount={Number(i.full_amount)} currency={i.currency} persons={persons ?? []} />}
                          </div>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{money(i.amount, i.currency)}
                        {i.pct != null && <div className="text-xs text-slate-500">{i.pct}% ของ {money(i.full_amount)}</div>}</td>
                      <td className="text-right tabular-nums text-slate-500">{Number(i.tax ?? 0) ? money(i.tax) : ""}</td>
                      <td className="pl-4 text-xs text-slate-500">{i.received_to_asset_id ? name.get(i.received_to_asset_id) ?? "บัญชี" : i.received_to_credit_card_id ? `เข้าบัตร ${name.get(i.received_to_credit_card_id) ?? ""}` : i.source_transaction_id ? "ตามรายการลงทุน" : "ไม่ผ่านบัญชี"}</td>
                      <td className="pl-2 text-right">
                        {!incSource(i) && canWrite && !i.pending_split && (
                          <RowActions table="income_transactions" id={i.id} paths={PATHS} canDelete={canDelete} fields={[
                            { name: "date", label: "วันที่", type: "date", value: i.date },
                            { name: "amount", label: "Gross", type: "number", value: i.full_amount },
                            { name: "tax", label: "ภาษี", type: "number", value: i.full_tax },
                            { name: "person_id", label: "ของใคร", type: "select", value: i.person_id,
                              options: [["", i.asset_id ? "ตามเจ้าของทรัพย์สิน" : i.received_to_asset_id ? "ตามเจ้าของบัญชีที่รับ" : "ส่วนกลาง"], ...personOpts] },
                            { name: "notes", label: "หมายเหตุ", value: i.notes, width: "w-40" }]}
                            extra={!i.received_to_credit_card_id
                              ? <AccountEditor kind="INCOME" id={i.id} current={i.received_to_asset_id ? `a:${i.received_to_asset_id}` : ""}
                                  incomeType={i.income_type} currency={i.currency} banks={banks} /> : undefined} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          </SubPanel>

          <SubPanel id="settings">
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-medium text-slate-900">ตั้งค่ารายได้ประจำ</h2>
            {templateList.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มี</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr className="border-b border-slate-100"><th className="py-1.5 pr-2">ชื่อ</th><th className="px-2">ของใคร</th><th className="px-2">ประเภท</th>
                      <th className="px-2 text-right">ยอดปกติ</th><th className="px-2">รับเมื่อ</th><th className="px-2">เข้าบัญชี</th><th className="px-2">สถานะ</th><th></th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {templateList.map((t) => (
                      <tr key={t.id} className={`align-top ${t.active ? "" : "text-slate-400"}`}>
                        <td className="py-2 pr-2 font-medium">{t.name}
                          {t.end_date && <div className="text-xs font-normal text-slate-500">ถึง {thDate(t.end_date)}</div>}</td>
                        <td className="px-2 py-2">{pname(t.persons) ?? "ส่วนกลาง"}</td>
                        <td className="px-2 py-2">{INCOME_TYPE_LABEL[t.income_type] ?? t.income_type}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{money(t.expected_amount, t.currency)}</td>
                        <td className="whitespace-nowrap px-2 py-2">{t.frequency === "MONTHLY" ? "ทุกเดือน" : t.frequency === "QUARTERLY" ? "ทุก 3 เดือน" : "ทุกปี"}
                          {t.due_day && ` วันที่ ${t.due_day}`}</td>
                        <td className="px-2 py-2 text-xs text-slate-600">{t.receive_to_asset_id ? name.get(t.receive_to_asset_id) ?? "บัญชี" : "-"}</td>
                        <td className="px-2 py-2 text-xs">{t.active ? <span className="text-emerald-700">ใช้งาน</span> : "หยุดใช้"}</td>
                        <td className="pl-2 py-2 text-right">
                          {canWrite && <RowActions table="recurring_income_templates" id={t.id} paths={PATHS} canDelete={canDelete}
                            deleteNote="รายได้ที่บันทึกรับไปแล้วยังอยู่" extra={<TemplateToggle id={t.id} active={t.active} />} fields={[
                              { name: "name", label: "ชื่อ", value: t.name, width: "w-44" },
                              { name: "expected_amount", label: "ยอดปกติ", type: "number", value: t.expected_amount },
                              { name: "due_day", label: "วันที่", type: "number", value: t.due_day, width: "w-16" },
                              { name: "end_date", label: "สิ้นสุด", type: "date", value: t.end_date }]} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {canWrite && templateList.length > 0 && <p className="text-xs text-slate-500">กดที่แถวเพื่อแก้ไข / ลบ</p>}
            {canWrite && <TemplateForm banks={banks} persons={persons ?? []} today={today} />}
          </section>
          </SubPanel>
          </SubTabs>
      </TabPanel>

      {/* ============================================================ ค่าใช้จ่าย */}
      <TabPanel id="expense">
          {canWrite && inMonth && <ExpenseForm banks={banks} cards={cards} persons={persons ?? []} today={maxDate} minDate={minDate} />}
          <p className="text-xs text-slate-500">ไม่บังคับบันทึก · บันทึกก้อนเดียว เช่น &ldquo;ค่าใช้จ่ายทั่วไปประจำเดือน&rdquo; ต่อบัญชีที่จ่าย แล้วแยกเฉพาะรายการสำคัญก็ได้</p>

          <SubTabs param="et" initial={expTab} tabs={[["due", `ที่ต้องจ่าย (${expOpen})`], ["recorded", `บันทึกแล้ว (${itemList.length})`], ["settings", "ค่าใช้จ่ายประจำ"]]}>
          <SubPanel id="due">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 font-medium text-slate-900">ค่าใช้จ่ายที่ต้องจ่าย เดือน {thMonth(start)}</h2>
            <p className="mb-3 text-xs text-slate-500">จากค่าใช้จ่ายประจำ (ค่าส่วนกลาง ภาษีที่ดิน ไฟ น้ำ) และตารางเบี้ยประกัน · ระบบไม่สร้างค่าใช้จ่ายเอง กด &ldquo;บันทึกจ่าย&rdquo; ด้วยยอดจริง</p>
            {costs.length === 0 && premiumDue.length === 0 ? <p className="text-sm text-slate-500">ไม่มีรายการที่คาดไว้ในเดือนนี้</p> : (
              <DueTable kind="expense" rows={[
                ...costs.map((c) => ({ key: `c-${c.utility_id}-${c.cost_period}`, due: c.due_date, type: UTIL_LABEL[c.utility_type] ?? "อื่น ๆ", currency: c.currency,
                  expected: Number(c.expected_amount), done: Number(c.paid_amount), open: c.status !== "PAID", el: (
                  <ActionRow key={`${c.utility_id}-${c.cost_period}`} colSpan={6} cells={<>
                    <td className="py-2 pr-2">
                      <div className="font-medium">{utilName(c.utility_type, c.provider)}</div>
                      <div className="text-xs text-slate-500">
                        <Link href={`/property/${c.property_asset_id}`} className="hover:underline">{c.property_name}</Link>
                        {c.cost_period < start && ` · งวด ${thMonth(c.cost_period)}`}
                        {pv.assetPct(c.property_asset_id) != null && ` · ส่วนของ ${pv.personName} ${pv.assetPct(c.property_asset_id)}%`}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">{thDate(c.due_date)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(c.expected_amount, c.currency)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{Number(c.paid_amount) > 0 ? money(c.paid_amount) : ""}</td>
                    <td className="px-2 py-2">
                      <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${c.status === "PAID" ? "bg-emerald-50" : c.status === "OVERDUE" ? "bg-red-50" : "bg-slate-100"} ${COST_STATUS[c.status]?.cls ?? ""}`}>
                        {COST_STATUS[c.status]?.text ?? c.status}
                      </span>
                    </td>
                  </>} actions={canWrite && c.status !== "PAID" ? (
                    <RecordCostForm assetId={c.property_asset_id} utilityId={c.utility_id} period={c.cost_period} currency={c.currency}
                      label={`${utilName(c.utility_type, c.provider)} · ${c.property_name} (${thMonth(c.cost_period)})`}
                      category={UTIL_EXPENSE_CATEGORY[c.utility_type] ?? "บ้าน / สาธารณูปโภค"} expected={Number(c.expected_amount)}
                      banks={banks} cards={cards} persons={persons ?? []} today={today} />
                  ) : null} />
                ) })),
                ...premiumDue.map((x) => ({ key: `p-${x.id}`, due: x.due_date, type: "เบี้ยประกัน", currency: x.currency, expected: Number(x.amount),
                  done: Number(x.amount) - Number(x.remaining), open: x.status !== "PAID" && x.status !== "CLOSED", el: (
                  <ActionRow key={x.id} colSpan={6} cells={<>
                    <td className="py-2 pr-2">
                      <div className="font-medium">เบี้ยประกัน งวดที่ {x.installment_no}</div>
                      <div className="text-xs text-slate-500">
                        <Link href={`/insurance/${x.policy_id}`} className="hover:underline">{insName(x)}</Link>
                        {x.payer_person_id && ` · ผู้จ่าย ${persons?.find((p) => p.id === x.payer_person_id)?.name ?? ""}`}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">{thDate(x.due_date)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(x.amount, x.currency)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {Number(x.remaining) < Number(x.amount) && <span className="text-emerald-700">{money(Number(x.amount) - Number(x.remaining))}</span>}
                      {x.status !== "PAID" && Number(x.remaining) < Number(x.amount) && <div className="text-xs text-amber-700">ค้าง {money(x.remaining)}</div>}
                    </td>
                    <td className="px-2 py-2"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${INS_SCHED_STATUS[x.status]?.cls ?? ""}`}>{INS_SCHED_STATUS[x.status]?.text ?? x.status}</span></td>
                  </>} actions={canWrite && x.status !== "PAID" ? (
                    <PayPremiumForm policyId={x.policy_id} lineId={x.id} amount={Number(x.remaining)} currency={x.currency}
                      label={`เบี้ยประกัน ${insName(x)} งวดที่ ${x.installment_no}`} banks={banks} cards={cards} persons={persons ?? []}
                      defaultPerson={x.payer_person_id} today={today} />
                  ) : null} />
                ) })),
              ]} />
            )}
          </section>
          </SubPanel>
          <SubPanel id="recorded">
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
                        <td>{(() => {
                          const src = i.pending_split ? null : expSource(i);
                          const cls = "cursor-pointer underline decoration-slate-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-400";
                          if (!src) return i.description;
                          return src.label === "รายการโอน"
                            ? <TabLink tab="moves" href={src.href} className={cls}>{i.description}</TabLink>
                            : <Link href={src.href} title={`แก้ที่หน้า${src.label}`} className={cls}>{i.description}</Link>;
                        })()}{i.notes && <div className="text-xs text-slate-400">{i.notes}</div>}
                          {i.pending_split && (
                            <div className="mt-1 space-y-1">
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">รอแยกรายละเอียด</span>
                              {canWrite && canDelete && <SplitForm kind="EXPENSE" id={i.id} amount={Number(i.full_amount)} currency={i.currency} persons={persons ?? []} />}
                            </div>
                          )}</td>
                        <td className="text-slate-600">{i.expense_category === "BANK_FEE" ? "ค่าธรรมเนียมธนาคาร" : i.expense_category}</td>
                        <td className="text-xs text-slate-600">
                          {i.source_cash_movement_id ? "จากรายการโอน"
                            : i.paid_from_asset_id ? name.get(i.paid_from_asset_id) ?? "บัญชี"
                            : i.paid_from_credit_card_id ? `บัตร ${name.get(i.paid_from_credit_card_id) ?? ""}`
                            : i.liability_id ? `ทบเข้าหนี้ ${name.get(i.liability_id) ?? ""}`
                            : "เงินสด"}
                          {!i.source_cash_movement_id && (pname(i.persons)
                            ? <div className="text-slate-500">ของ {pname(i.persons)}</div>
                            : !i.paid_from_asset_id && !i.paid_from_credit_card_id && <div className="text-slate-500">ส่วนกลาง</div>)}
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
                          {!expSource(i) && canWrite && !i.pending_split && (
                            <RowActions table="expense_items" id={i.id} paths={PATHS} canDelete={canDelete} fields={[
                              { name: "date", label: "วันที่", type: "date", value: i.date },
                              { name: "description", label: "รายละเอียด", value: i.description, width: "w-44" },
                              { name: "amount", label: "จำนวน", type: "number", value: i.full_amount },
                              { name: "expense_category", label: "หมวด", value: i.expense_category },
                              { name: "person_id", label: "ของใคร", type: "select" as const, value: i.person_id,
                                options: [["", i.paid_from_credit_card_id ? "ตามเจ้าของบัตร" : i.paid_from_asset_id ? "ตามเจ้าของบัญชี" : "ส่วนกลาง"] as [string, string], ...personOpts] },
                              ...(i.is_reimbursable ? [{ name: "expected_reimbursement_amount", label: "คาดได้คืน", type: "number" as const, value: i.expected_reimbursement_amount }] : [])]}
                              extra={<AccountEditor kind="EXPENSE" id={i.id} currency={i.currency} banks={banks} cards={cards}
                                    current={i.paid_from_asset_id ? `a:${i.paid_from_asset_id}` : i.paid_from_credit_card_id ? `c:${i.paid_from_credit_card_id}` : ""} />} />
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
          </SubPanel>

          <SubPanel id="settings">
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium text-slate-900">ตั้งค่าค่าใช้จ่ายประจำ</h2>
              {[...costYear.entries()].filter(([, v]) => v > 0).map(([ccy, v]) => (
                <span key={ccy} className="text-sm text-slate-600">ประมาณการต่อปี <span className="font-medium tabular-nums">{money(v, ccy, 0)}</span></span>
              ))}
            </div>
            {utils.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มี</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr className="border-b border-slate-100"><th className="py-1.5 pr-2">ทรัพย์สิน</th><th className="px-2">รายการ</th>
                      <th className="px-2 text-right">ยอดปกติ</th><th className="px-2">จ่ายเมื่อ</th><th className="px-2 text-right">ต่อปี (ประมาณ)</th><th></th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {utils.map((u) => (
                      <tr key={u.id} className="align-top">
                        <td className="py-2 pr-2"><Link href={`/property/${u.property_details.asset_id}`} className="hover:underline">{u.property_details.assets.name}</Link></td>
                        <td className="px-2 py-2">{utilName(u.utility_type, u.provider)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{money(u.expected_amount, u.currency)}</td>
                        <td className="px-2 py-2">{scheduleText(u.frequency, u.due_day, u.due_month)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-500">{money(Number(u.expected_amount) * (PERIODS_PER_YEAR[u.frequency] ?? 0), undefined, 0)}</td>
                        <td className="pl-2 py-2 text-right">
                          {canWrite && <RowActions table="property_utilities" id={u.id} paths={[...PATHS, `/property/${u.property_details.asset_id}`]} canDelete={canDelete}
                            deleteNote="ค่าใช้จ่ายที่บันทึกจ่ายไปแล้วยังอยู่" fields={[
                              { name: "provider", label: "ผู้ให้บริการ / รายละเอียด", value: u.provider, width: "w-40" },
                              { name: "expected_amount", label: "ยอดปกติ", type: "number", value: u.expected_amount },
                              { name: "due_day", label: "วันที่", type: "number", value: u.due_day, width: "w-16" }]} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-slate-500">กดที่แถวเพื่อแก้ไข / ลบ · ตั้งค่าเพิ่มเติม (ความถี่ เลขผู้ใช้ไฟ / มิเตอร์) ที่หน้าทรัพย์สิน (กดชื่อทรัพย์สิน)</p>
            {canWrite && properties.length > 0 && <UtilityForm properties={properties} label="+ ค่าใช้จ่ายประจำ" tracked />}
          </section>
          </SubPanel>
          </SubTabs>
      </TabPanel>

      {/* ============================================================ เงินเข้า–ออก & โอน */}
      <TabPanel id="moves">
          {autopay.length > 0 && (
            <section className={`rounded-xl border p-5 ${autopayPending.length ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-white"}`}>
              <h2 className="mb-1 font-medium text-slate-900">บัตรเครดิตตัดบัญชีอัตโนมัติ เดือน {thMonth(start)}</h2>
              <p className="mb-3 text-xs text-slate-500">ถึงวันครบชำระแล้วขึ้น &ldquo;รอยืนยัน&rdquo; · ตรวจยอดที่ตัดจริงในบัญชีแล้วกดยืนยัน ระบบจึงบันทึกเงินออกจากบัญชีให้</p>
              <div className="grid gap-3 md:grid-cols-2">
                {autopay.map((x) => (
                  <div key={x.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{x.label}</div>
                        <div className="text-xs text-slate-500">ตัดจาก {name.get(x.bank) ?? "บัญชี"} · ครบ {thDate(x.due)}</div>
                      </div>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${x.due <= today ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                        {x.due <= today ? "รอยืนยัน" : "ยังไม่ถึงวันตัด"}
                      </span>
                    </div>
                    <div className="mt-1 tabular-nums">
                      {x.minimum ? "ตัดยอดขั้นต่ำ" : `ตัดเต็มจำนวน ${money(x.balance, x.currency)}`}
                      {!x.minimum && x.balanceDate && <span className="text-xs text-slate-500"> (ยอดบัตร ณ {thDate(x.balanceDate)})</span>}
                    </div>
                    {canWrite && x.due <= today && (
                      <div className="mt-2">
                        <AutopayConfirmForm cardId={x.id} bankId={x.bank} currency={x.currency} dueDate={x.due} amount={x.balance}
                          minimum={x.minimum} today={today} minDate={minDate} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
          {canWrite && inMonth && <MovementForm banks={banks} cards={cards} liabilities={liabs} today={maxDate} minDate={minDate} />}
          <p className="text-xs text-slate-500">โอนเข้า/ออกพอร์ตลงทุนทำที่หน้า Investments · การรับ/คืนเงินประกันทำที่หน้า Property</p>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 font-medium text-slate-900">เงินเข้า–ออกบัญชีเดือนนี้</h2>
            <p className="mb-3 text-xs text-slate-500">ทุกรายการที่ทำให้ยอดเงินในบัญชีธนาคารเปลี่ยน · เลือกบัญชีเพื่อเทียบกับ Statement · รายการที่มาจากหน้าอื่นกด &ldquo;แก้ที่หน้า …&rdquo;</p>
            <MovesView rows={moveRows(canWrite)} banks={bankOpts} showActions={canWrite} />
          </section>
      </TabPanel>
    </div>
    </TabsProvider>
  );
}

type Move = { id: string; movement_date: string; movement_type: string; from_asset_id: string | null; to_asset_id: string | null;
  to_credit_card_id: string | null; to_liability_id: string | null; amount: number; currency: string; counter_amount: number | null;
  counter_currency: string | null; fee: number | null; is_derived: boolean; description: string | null; movement_group_id?: string | null;
  source_entity_type?: string | null; source_entity_id?: string | null; parts?: Move[] };

/** รับชำระเงินให้กู้ครั้งเดียว (เงินต้น + ดอกเบี้ย) เข้าบัญชีเดียวกัน → รวมเป็น 1 แถว ให้ตรงกับ Statement */
function mergeGroups(moves: Move[]): Move[] {
  const out: Move[] = []; const byGroup = new Map<string, Move>();
  moves.forEach((m) => {
    const g = m.movement_group_id;
    const merged = g ? byGroup.get(g) : undefined;
    if (merged && merged.to_asset_id && merged.to_asset_id === m.to_asset_id) {
      merged.parts = [...(merged.parts ?? [{ ...merged }]), m];       // เก็บสำเนาส่วนแรกก่อนรวมยอด
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


function Kpi({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className={`mt-1 text-xs ${cls ?? "text-slate-500"}`}>{sub}</div>}
    </div>
  );
}
