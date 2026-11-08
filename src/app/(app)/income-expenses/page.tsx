import Link from "next/link";
import { Fragment } from "react";
import { requireAppUser } from "@/lib/auth";
import RowActions from "@/components/RowActions";
import {
  COST_STATUS, INCOME_TYPE_LABEL, HOME_CATEGORY, PERIODS_PER_YEAR, PROPERTY_COST_TYPE_LABEL, UTIL_EXPENSE_CATEGORY, UTIL_LABEL, money, monthOptions, monthRange, scheduleText,
  thDate, thMonth, todayBangkok, signedMoney, plusMoney, minusMoney } from "@/lib/format";
import { RecordCostForm } from "../property/[id]/forms";
import {
  AutopayConfirmForm, ExpectedActions, ExpenseForm, ExpenseTemplateForm, ExpenseTemplateToggle, IncomeForm,
  RecurringPayActions, UndoDismissButton, MovementForm, ReimbursementForm, TemplateForm, TemplateToggle,
  type Bank, type Card, type Claim, type Liab,
} from "./forms";
import { makeEntryKit, pname, type Move } from "./entry-kit";
import { ScrollToHash, SubPanel, SubTabs, TabLink, TabNav, TabPanel, TabsProvider } from "./tabs";
import { TabActions } from "@/components/TabActions";
import MonthTable, { type MonthRow } from "./MonthTable";
import PropertyCostTable, { type PropCostRow } from "./PropertyCostTable";
import CategoryBars, { type CatRow } from "./CategoryBars";
import MovesView, { type MoveRow } from "./MovesView";
import MonthPicker from "@/components/MonthPicker";
import CategoryManager from "./CategoryManager";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import { HeaderFilters, PageInfo, InfoTip } from "@/components/HeaderBar";
import { PaymentForm as LoanPaymentForm } from "../financial/loans/[id]/forms";
import { LOAN_SCHED_STATUS } from "@/lib/loan-schedule";
import { BenefitForm, PayPremiumForm } from "../insurance/[id]/ins-forms";
import { BENEFIT_TYPE_LABEL, INS_SCHED_STATUS, covName } from "@/lib/format";
import { stripPending } from "@/lib/ledger";
import MoveBadge from "@/components/MoveBadge";
import { StatBox } from "@/components/Boxes";
import { loadIeMonth, loadIePersonShares, loadIeRef } from "./page-data";

const PATHS = ["/income-expenses", "/financial/cash"];
// ชื่อรายการที่กดไปหน้าต้นทางได้ (ขีดเส้นใต้จาง ๆ · เมาส์เป็นรูปมือ)
const NAME_LINK = "cursor-pointer underline decoration-slate-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-400";
const TABS: [string, string][] = [["overview", "ภาพรวม"], ["income", "รายได้"], ["expense", "ค่าใช้จ่าย"], ["settings", "ตั้งค่า"]];
const EXP_STATUS: Record<string, { text: string; cls: string }> = {
  RECEIVED: { text: "ได้รับแล้ว", cls: "bg-emerald-50 text-emerald-700" }, PENDING: { text: "รอรับ", cls: "bg-slate-100 text-slate-700" },
  OVERDUE: { text: "เลยกำหนด", cls: "bg-red-50 text-red-700" }, DISMISSED: { text: "เดือนนี้ไม่ได้รับ", cls: "bg-slate-100 text-slate-500" },
};

type Sp = Promise<{ tab?: string; m?: string; p?: string; it?: string; et?: string; st?: string; hl?: string }>;

export default async function IncomeExpensesPage({ searchParams }: { searchParams: Sp }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const today = todayBangkok();
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? (sp.m as string) : today.slice(0, 7);
  // ?tab=moves (ลิงก์เดิม) → ภาพรวม แล้วเลื่อนไปกล่อง "เงินเข้า–ออกบัญชีเดือนนี้"
  const tab = sp.it === "settings" || sp.et === "settings" ? "settings" : TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  const { start, end } = monthRange(ym);
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  // ดึงข้อมูลทุกชุดพร้อมกันรอบเดียว (30 ต.ค. 2026) — เดิมรอทีละชุดต่อกันราว 10 ทอด → ช้ามากเมื่อ Supabase เพิ่งตื่น
  // แยกเป็นชุดไม่ขึ้นกับเดือน / ชุดของเดือน / ส่วนแบ่งรายบุคคล แล้วจำไว้จนกว่าจะมีการบันทึก (5 พ.ย. 2026 · page-data.ts)
  //   → เปลี่ยนเดือน / กลับเข้าหน้า ถามเฉพาะชุดที่ยังไม่ได้จำ · ส่วนแบ่งรายบุคคลเริ่มทันทีที่รู้สมาชิกที่เลือก
  //   มุมมองรายบุคคล: ระบุคนเอง → 100% · ไม่ระบุ: ค่าใช้จ่าย = เจ้าของบัตร / เจ้าของบัญชีที่จ่าย · รายได้ = เจ้าของทรัพย์สิน / เจ้าของบัญชีที่รับ
  const pvQ = loadPersonView(sp.p, { liabilities: true });
  const [pv, { incShares, expShares }, ref, mon] = await Promise.all([
    pvQ,
    pvQ.then((v) => (v.personId ? loadIePersonShares(v.personId, start, end) : { incShares: null, expShares: null })),
    loadIeRef(),
    loadIeMonth(start, end),
  ]);
  const { banksRaw, cardsRaw, liabRaw, persons, fx, templates, claimsRaw, utilRows, cardBalRaw, rexpTplRaw, leaseRaw, covRaw, pfCash, propRows,
    leaseProps, expCatAll, incSubAll, expHints } = ref;
  const { incomes, expected, month, items, reimbStatus, reimbs, moves, costRows, loanRows, insRows, rexpRows, pfCardPays, openRaw, valuations,
    moveAssets } = mon;
  const incShare = new Map((incShares ?? []).map((r) => [r.income_id as string, r]));
  const expShare = new Map((expShares ?? []).map((r) => [r.expense_item_id as string, r]));
  // หมวดค่าใช้จ่าย / ประเภทย่อยรายได้อื่น (ตั้งค่าเองในแท็บ "ตั้งค่า") · จำนวนรายการที่ใช้แต่ละหมวดนับไว้ใน page-data.ts
  const expCats = expCatAll.filter((c) => c.active).map((c) => c.name);
  const incSubs = incSubAll.filter((c) => c.active).map((c) => c.name);
  const withCurrent = (list: string[], cur: string | null): [string, string][] =>
    [...(cur && !list.includes(cur) ? [cur] : []), ...list].map((c) => [c, c]);
  const goLive = ref.goLive;
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
    ...cards.map((c) => [c.id, c.label] as [string, string]), ...liabs.map((l) => [l.id, l.name] as [string, string]),
    ...pfCash.map((h) => [h.id, `พอร์ต ${h.label}`] as [string, string])]);
  const personOpts: [string, string][] = (persons ?? []).map((p) => [p.id, p.name]);
  const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
  const claims: Claim[] = (claimsRaw ?? []).map((c) => {
    const pol = one(c.insurance_policies as unknown as { insurer: string; policy_no: string | null; persons: unknown } | null);
    return { id: c.id, currency: c.currency, label: [pol?.insurer, pol?.policy_no, pname(pol?.persons),
      c.claim_date && `เคลม ${thDate(c.claim_date)}`, c.claimed_amount != null && money(c.claimed_amount, c.currency)].filter(Boolean).join(" · ") };
  });
  const newClaims: Claim[] = (covRaw ?? []).map((c) => {
    const pol = one(c.insurance_policies as unknown as { insurer: string; policy_no: string | null; persons: unknown } | null);
    return { id: `new:${c.id}`, currency: c.currency, label: [pname(pol?.persons), pol?.insurer, pol?.policy_no,
      covName(c.coverage_type, c.label)].filter(Boolean).join(" · ") };
  });

  type Cost = { utility_id: string; property_asset_id: string; property_name: string; utility_type: string; provider: string | null;
    cost_period: string; due_date: string; expected_amount: number; paid_amount: number; currency: string; status: string;
    dismissal_id: string | null; dismissal_reason: string | null };
  type Util = { id: string; utility_type: string; provider: string | null; expected_amount: number; currency: string; frequency: string;
    due_day: number | null; due_month: number | null; property_details: { asset_id: string; property_type: string; assets: { name: string; status: string; deleted_at: string | null } } };
  const costs = ((costRows as Cost[] | null) ?? []).filter((c) => pv.showAsset(c.property_asset_id));
  const utils = ((utilRows as unknown as Util[] | null) ?? [])
    .filter((u) => !u.property_details.assets.deleted_at && u.property_details.assets.status === "ACTIVE" && pv.showAsset(u.property_details.asset_id))
    .sort((a, b) => a.property_details.assets.name.localeCompare(b.property_details.assets.name, "th"));
  const costYear = utils.reduce((m, u) => m.set(u.currency, (m.get(u.currency) ?? 0) + Number(u.expected_amount) * (PERIODS_PER_YEAR[u.frequency] ?? 0) * pv.assetShare(u.property_details.asset_id)), new Map<string, number>());
  const utilName = (t: string, p: string | null) => [UTIL_LABEL[t] ?? t, p].filter(Boolean).join(" · ");
  // ค่าใช้จ่ายประจำทั่วไป: รายบุคคล = ระบุคนไว้ / ตามเจ้าของบัญชี / บัตรที่จ่าย
  const rexpMine = (x: { person_id: string | null; pay_from_asset_id: string | null; pay_from_credit_card_id: string | null }) =>
    x.person_id ? pv.isPerson(x.person_id) : x.pay_from_asset_id ? pv.showAsset(x.pay_from_asset_id)
      : x.pay_from_credit_card_id ? pv.showLiability(x.pay_from_credit_card_id) : !pv.personId;
  type RexpDue = { template_id: string; name: string; expense_category: string; person_id: string | null; pay_via: string;
    pay_from_asset_id: string | null; pay_from_credit_card_id: string | null; cost_period: string; due_date: string;
    expected_amount: number; paid_amount: number; currency: string; status: string; dismissal_id: string | null; dismissal_reason: string | null };
  const rexpDue = ((rexpRows as RexpDue[] | null) ?? []).filter(rexpMine);
  const rexpTpl = (rexpTplRaw ?? []).filter(rexpMine);
  const rexpYear = rexpTpl.filter((t) => t.active).reduce((m, t) => m.set(t.currency, (m.get(t.currency) ?? 0) + Number(t.expected_amount) * (PERIODS_PER_YEAR[t.frequency] ?? 0)), new Map<string, number>());
  const freqText = (f: string, d: number | null) => `${f === "MONTHLY" ? "ทุกเดือน" : f === "QUARTERLY" ? "ทุก 3 เดือน" : "ทุกปี"}${d ? ` วันที่ ${d}` : ""}`;

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
  // ตัวกรอง "จ่ายด้วย" อยู่ฝั่งหน้าจอ (MonthTable) · ที่นี่เตรียมรายชื่อบัญชี / บัตรที่มีในเดือน + ข้อมูลต่อแถว
  const payOf = (i: { paid_from_asset_id: string | null; paid_from_credit_card_id: string | null }) =>
    i.paid_from_credit_card_id ? `card:${i.paid_from_credit_card_id}` : i.paid_from_asset_id ? `bank:${i.paid_from_asset_id}` : "cash";
  const usedIds = (k: "bank" | "card") => [...new Set(itemList.map(payOf).filter((x) => x.startsWith(`${k}:`)).map((x) => x.slice(k.length + 1)))];
  const payBanks = usedIds("bank").map((id) => ({ id, label: name.get(id) ?? "บัญชี" })).sort((x, y) => x.label.localeCompare(y.label, "th"));
  const payCards = usedIds("card").map((id) => ({ id, label: name.get(id) ?? "บัตร" })).sort((x, y) => x.label.localeCompare(y.label, "th"));
  const expenseThb = pv.personId ? (expShares ?? []).reduce((s, r) => s + Number(r.base_amount_share ?? 0), 0) : Number(month?.total_amount ?? 0);
  const rs = new Map((reimbStatus ?? []).map((r) => [r.expense_item_id, r]));
  // รอเงินคืน (ยอดที่คาดว่าได้คืน − ได้แล้ว) · รายการรอแยกรายละเอียดของเดือนนี้
  const reimbPendingThb = itemList.filter((i) => i.is_reimbursable).reduce((s2, i) => {
    const got = Number(rs.get(i.id)?.reimbursed_amount ?? 0);
    const left = Math.max(Number(i.expected_reimbursement_amount ?? i.full_amount) - got, 0);
    return s2 + thb(left, i.currency) * i.share;
  }, 0);
  const incPendingSplit = incomeList.some((i) => i.pending_split);
  const expPendingSplit = itemList.some((i) => i.pending_split);
  const reimbThb = (reimbs ?? []).filter((r) => !pv.personId || itemShare.has(r.expense_item_id))
    .reduce((s, r) => s + thb(r.amount, r.currency) * (itemShare.get(r.expense_item_id) ?? 1), 0);
  // รายได้ที่คาดไว้: รายได้ประจำตามเจ้าของ · ค่าเช่าตามเจ้าของทรัพย์สิน
  // ค่าเช่าจ่ายหลังสิ้นรอบ: งวดเดือนนี้ที่ครบกำหนดเดือนหน้าไปขึ้นในเดือนที่ครบกำหนด (งวดเดือนก่อนขึ้นเดือนนี้แทน)
  const arrearsWait = (e: { rent_timing?: string | null; status: string; income_period: string; due_date: string }) =>
    e.rent_timing === "ARREARS" && e.status === "PENDING";
  const expectedList = (expected ?? []).filter((e) => (e.source_type === "LEASE" ? pv.showAsset(e.asset_id) : pv.isPerson(e.person_id)))
    .filter((e) => !(arrearsWait(e) && e.income_period === start && e.due_date > end))
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
  // สัญญาเช่าที่ยังมีผล (รายบุคคล = ทรัพย์สินที่คนนั้นถือ) · ชื่อ / ประเภททรัพย์สินถามไว้พร้อมชุดข้อมูลแล้ว (leaseProps)
  type Lease = { id: string; property_asset_id: string; unit_label: string | null; tenant_name: string; rent_amount: number; rent_currency: string;
    payment_frequency: string; payment_due_day: number | null; start_date: string; end_date: string; lease_status: string };
  const leases = ((leaseRaw as Lease[] | null) ?? []).filter((l) => pv.showAsset(l.property_asset_id));
  // ชื่อทรัพย์สินอื่น: ถามทุกทรัพย์สินในรายการของเดือนไว้แล้ว (page-data.ts) · ใช้เฉพาะที่ไม่ใช่บัญชี / บัตร / หนี้ (เหมือนเดิม)
  const otherSet = new Set(otherIds);
  const otherAssets = ((moveAssets ?? []) as { id: string; name: string; asset_type: string }[]).filter((a) => otherSet.has(a.id));
  // บัตรตัดบัญชีอัตโนมัติ: งวดของเดือนนี้ที่ยังไม่มีรายการจ่ายบัตร → ถึงวันครบชำระแล้ว = "รอยืนยัน" · ยังไม่ถึง = "จะตัด"
  const lastDay = Number(end.slice(8, 10));
  const autopay = (cardsRaw ?? [])
    .filter((c) => c.status === "ACTIVE" && (c.autopay_asset_id || c.autopay_cash_holding_id) && c.due_day && pv.isPerson(c.person_id))
    .map((c) => ({
      id: c.id as string, bank: (c.autopay_asset_id ?? c.autopay_cash_holding_id) as string, hold: (c.autopay_cash_holding_id ?? null) as string | null, currency: c.currency as string, minimum: c.autopay_mode === "MINIMUM",
      label: [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" "),
      balance: Number(c.outstanding_balance), balanceDate: c.balance_date as string | null,
      due: `${start.slice(0, 8)}${String(Math.min(Number(c.due_day), lastDay)).padStart(2, "0")}`,
      paid: (moves ?? []).some((m) => m.movement_type === "CARD_PAYMENT" && m.to_credit_card_id === c.id)
        || (pfCardPays ?? []).some((x) => x.to_credit_card_id === c.id),
    }))
    .filter((x) => !x.paid && (!goLive || x.due >= goLive) && (x.minimum || x.balance > 0))
    .sort((a, b) => a.due.localeCompare(b.due));
  const autopayPending = autopay.filter((x) => x.due <= today);
  const incById = new Map((incomes ?? []).map((i) => [i.id as string, i]));
  const expById = new Map((items ?? []).map((i) => [i.id as string, i]));
  // บ้าน / ที่ดินที่ถืออยู่ (ค่าใช้จ่ายหมวดบ้าน / สาธารณูปโภค เลือกทรัพย์สินได้ · ตกลง 30 ต.ค. 2026)
  const properties = ((propRows ?? []) as unknown as { asset_id: string; assets: { name: string; status: string; deleted_at: string | null } }[])
    .filter((p) => !p.assets.deleted_at && p.assets.status === "ACTIVE").map((p) => ({ id: p.asset_id, name: p.assets.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "th"));
  // ชุดคำสั่งกลาง (แก้ไข / ลบ / แยกก้อน / แถวเงินเข้า–ออก) — ใช้ร่วมกับหน้ารายละเอียดบัญชี
  const kit = makeEntryKit({ ym, personId: pv.personId, canWrite, canDelete, paths: PATHS, banks, cards, liabs, persons: persons ?? [],
    pfCash, incSubs, expCats, expHints, moves: (moves ?? []) as Move[], incById, expById, otherAssets,
    tabLinks: true, properties, closeoutIds: new Set(ref.closeoutIds) });
  const { incSource, expSource, incEdit, expEdit, incSplit, expSplit, closeoutNote } = kit;
  const moveRows = (withActions: boolean): MoveRow[] => kit.buildMoveRows(moveList as Move[], withActions);
  const bankOpts = banks.map((b) => ({ id: b.asset_id, name: b.name }));
  // ยอดยกมา (สิ้นเดือนก่อน) ของแต่ละบัญชี → ยอดคงเหลือหลังแต่ละรายการ เมื่อกรองทีละบัญชี
  const statements: Record<string, { key: string; date: string; value: number; label: string }[]> = {};
  const bankSet = new Set(banks.map((b) => b.asset_id));
  (valuations ?? []).filter((v) => bankSet.has(v.asset_id as string)).forEach((v) => { (statements[v.asset_id as string] ??= []).push({ key: `v${v.id}`, date: v.valuation_date as string, value: Number(v.value), label: "อัปเดตยอดคงเหลือ" }); });
  const openings = Object.fromEntries(((openRaw as { asset_id: string; calculated: number | null }[] | null) ?? [])
    .map((r) => [r.asset_id, r.calculated == null ? null : Number(r.calculated)]));
  // สรุปเงินเข้า–ออก (ทุกบัญชี · ไม่นับโอนระหว่างบัญชีตัวเอง) สำหรับแท็บภาพรวม
  //   ≈ บาท: ตามอัตรา ณ วันที่ของแต่ละรายการ (base_amount) · ยอดแยกสกุลอยู่ท้ายตารางด้านล่าง
  const moveSum = moveRows(false).reduce((acc, r) => {
    const thbOf = (ccy: string, v: number) => (ccy === "THB" ? v : Number(r.thb ?? 0));
    if (r.toBank && !r.fromBank) acc.inn += thbOf(r.toCcy, r.toAmount);
    else if (r.fromBank && !r.toBank) acc.out += thbOf(r.fromCcy, r.fromAmount);
    if (r.toCcy !== "THB" || r.fromCcy !== "THB") acc.fx = true;
    acc.count += 1;
    return acc;
  }, { count: 0, inn: 0, out: 0, fx: false });
  const savings = grossThb - taxThb - (expenseThb - reimbThb);
  const inMonth = start <= today && (!goLive || end >= goLive);
  const months = monthOptions(goLive, today, 3, ym);
  const costOpen = (st: string) => st === "PENDING" || st === "OVERDUE";
  // แท็บย่อย: รายการของเดือน (ค่าเริ่มต้น) · ตั้งค่ารายได้ / ค่าใช้จ่ายประจำ · ?it=split / ?et=split = เปิดตัวกรอง "รอแยกรายละเอียด"
  // แท็บย่อยของ "ตั้งค่า" (?st=) · ลิงก์เดิม ?it=settings / ?et=settings → รายได้ประจำ / ค่าใช้จ่ายประจำ
  const setTab = ["income", "expense", "types"].includes(sp.st ?? "") ? (sp.st as string) : sp.et === "settings" ? "expense" : "income";

  // ===== ตารางรวมของเดือน (รายการที่คาดไว้ซึ่งยังค้าง + รายการที่บันทึกแล้ว) =====
  const badge = (text: string, cls: string) => <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${cls}`}>{text}</span>;
  const share = (pct: number | null | undefined) => (pct == null ? 1 : pct / 100);
  // ช่องสถานะ: ปุ่มคำสั่งหลายปุ่มในแถวเดียว (ข้ามช่องว่าง)
  const acts = (...xs: React.ReactNode[]) => {
    const list = xs.filter((x) => x != null && x !== false && x !== "");
    return list.length ? <>{list.map((x, n) => <Fragment key={n}>{x}</Fragment>)}</> : null;
  };
  const late = (d: string) => d < start ? <div className="text-xs text-red-600">งวด {thMonth(d)}</div> : null;
  const DONE_INC = badge("ได้รับแล้ว", "bg-emerald-50 text-emerald-700");
  const DONE_EXP = badge("จ่ายแล้ว", "bg-emerald-50 text-emerald-700");
  // ชื่อรายการประจำ → แท็บตั้งค่า แท็บย่อยที่ถูกต้อง
  const toSettings = (st: "income" | "expense", text: React.ReactNode) => (
    <TabLink tab="settings" sub={["st", st]} href={`/income-expenses?tab=settings&st=${st}&m=${ym}`} className={`font-medium ${NAME_LINK}`}>{text}</TabLink>
  );

  const incLabel = (i: { source_transaction_id: string | null; lease_id: string | null; income_type: string; asset_id: string | null;
    insurance_schedule_line_id: string | null; received_to_liability_id: string | null; recurring_template_id: string | null }) =>
    i.source_transaction_id ? "รายได้ลงทุน" : i.lease_id ? "ค่าเช่า" : i.income_type === "LOAN_INTEREST" && i.asset_id ? "เงินให้กู้"
      : i.insurance_schedule_line_id || i.income_type === "INSURANCE_BENEFIT" ? "ผลประโยชน์ประกัน" : i.received_to_liability_id ? "ลดหนี้"
      : i.recurring_template_id ? "รายได้ประจำ" : i.income_type === "BUSINESS_DIVIDEND" && i.asset_id ? "ปันผลกิจการ" : "บันทึกเอง";
  const expLabel = (i: { source_cash_movement_id: string | null; liability_id: string | null; insurance_schedule_line_id: string | null;
    property_utility_id: string | null; recurring_expense_id: string | null }) =>
    i.source_cash_movement_id ? "ค่าธรรมเนียมโอน" : i.liability_id ? "หนี้สิน" : i.insurance_schedule_line_id ? "เบี้ยประกัน"
      : i.property_utility_id ? "ทรัพย์สิน" : i.recurring_expense_id ? "ค่าใช้จ่ายประจำ" : "บันทึกเอง";

  const incRows: MonthRow[] = [
    ...expectedList.filter((e) => e.status !== "RECEIVED").map((e): MonthRow => {
      const tpl = (templates ?? []).find((t) => t.id === e.source_id);
      const open = e.status === "PENDING" || e.status === "OVERDUE";
      const got = Number(e.received_amount ?? 0);
      return {
        key: `t-${e.source_type}-${e.source_id}-${e.income_period}`, date: e.due_date as string, source: e.source_type === "LEASE" ? "ค่าเช่า" : "รายได้ประจำ",
        status: open ? "OPEN" : "DISMISSED", currency: e.currency as string, expected: Number(e.expected_amount), done: got || null,
        thbDone: 0, thbLeft: open ? thb(Math.max(Number(e.expected_amount) - got, 0), e.currency) * share(e.pct) : 0,
        item: <>
          <div className="font-medium">{e.source_type === "LEASE" && e.asset_id
            ? <Link href={`/property/${e.asset_id}`} title="ไปหน้าทรัพย์สิน" className={NAME_LINK}>{e.name}</Link>
            : toSettings("income", e.name)}</div>
          <div className="text-xs text-slate-500">{INCOME_TYPE_LABEL[e.income_type] ?? e.income_type}
            {e.pct != null && ` · ส่วนของ ${pv.personName} ${e.pct}%`}</div>
          {arrearsWait(e) && e.income_period < start
            ? <div className="text-xs text-slate-500">งวด {thMonth(e.income_period)} · จ่ายหลังสิ้นรอบ</div>
            : late(e.income_period as string)}
        </>,
        account: e.receive_to_asset_id ? name.get(e.receive_to_asset_id) ?? "บัญชี" : "",
        late: e.status === "OVERDUE" && !e.in_grace, inGrace: e.status === "OVERDUE" && !!e.in_grace,
        action: canWrite && open ? (
          <ExpectedActions sourceType={e.source_type} sourceId={e.source_id} period={e.income_period} incomeType={e.income_type}
            personId={tpl?.person_id ?? null} expected={Number(e.expected_amount)} currency={e.currency}
            receiveTo={e.receive_to_asset_id} banks={banks} today={maxDate} minDate={minDate} />
        ) : e.in_grace ? badge("ครบกำหนด", "bg-amber-50 text-amber-800")
          : badge(EXP_STATUS[e.status]?.text ?? e.status, EXP_STATUS[e.status]?.cls ?? ""),
      };
    }),
    ...loanDue.filter((x) => x.status !== "PAID").map((x): MonthRow => {
      const pct = pv.assetPct(x.loan_asset_id);
      const got = Number(x.total_due) - Number(x.total_remaining);
      return {
        key: `l-${x.id}`, date: x.due_date, source: "เงินให้กู้", status: "OPEN", currency: x.currency,
        expected: Number(x.total_due), done: got || null,
        // ค้างรับนับเฉพาะดอกเบี้ย (เงินต้นไม่ใช่รายได้)
        thbDone: 0, thbLeft: thb(Number(x.interest_remaining), x.currency) * share(pct),
        item: <>
          <Link href={`/financial/loans/${x.loan_asset_id}`} title="ไปหน้าเงินให้กู้" className={`font-medium ${NAME_LINK}`}>{x.loan_name}</Link>
          <div className="text-xs text-slate-500">{x.borrower_name} · งวดที่ {x.installment_no}{pct != null && ` · ส่วนของ ${pv.personName} ${pct}%`}</div>
          <div className="text-xs text-slate-400">เงินต้น {money(x.principal_due)} + ดอกเบี้ย {money(x.interest_due)} · นับเป็นรายได้เฉพาะดอกเบี้ย</div>
          {late(x.due_date)}
          {got > 0 && <div className="text-xs text-amber-700">ได้รับบางส่วน · ค้าง {money(x.total_remaining)}</div>}
        </>,
        account: "",
        late: x.status === "OVERDUE",
        action: !canWrite ? badge(LOAN_SCHED_STATUS[x.status]?.text ?? x.status, LOAN_SCHED_STATUS[x.status]?.cls ?? "") : (
          <LoanPaymentForm assetId={x.loan_asset_id} currency={x.currency} banks={banks} today={today} minDate={goLive} small button="บันทึกรับ"
            title={`รับชำระ ${x.loan_name} งวดที่ ${x.installment_no}`}
            principal={Number(x.principal_remaining)} interest={Number(x.interest_remaining)}
            interestOwed={loanDue.filter((y) => y.loan_asset_id === x.loan_asset_id && y.due_date <= x.due_date)
              .reduce((s, y) => s + Number(y.interest_remaining), 0)}
            principalDue={loanDue.filter((y) => y.loan_asset_id === x.loan_asset_id && y.due_date <= x.due_date)
              .reduce((s, y) => s + Number(y.principal_remaining), 0)} />
        ),
      };
    }),
    ...benefitDue.filter((x) => x.status !== "PAID" && x.status !== "CLOSED").map((x): MonthRow => {
      const got = Number(x.amount) - Number(x.remaining);
      return {
        key: `b-${x.id}`, date: x.due_date, source: "ผลประโยชน์ประกัน", status: "OPEN", currency: x.currency,
        expected: Number(x.amount), done: got || null, thbDone: 0, thbLeft: thb(Number(x.remaining), x.currency),
        item: <>
          <Link href={`/insurance/${x.policy_id}`} title="ไปหน้ากรมธรรม์" className={`font-medium ${NAME_LINK}`}>{insName(x)}</Link>
          <div className="text-xs text-slate-500">{BENEFIT_TYPE_LABEL[x.benefit_type ?? "OTHER"]}</div>
          {x.cash_value_asset_id && <div className="text-xs text-slate-400">ถอนจากมูลค่าเวนคืนก่อน · ส่วนที่เกินนับเป็นรายได้</div>}
          {late(x.due_date)}
        </>,
        account: "",
        late: x.status === "OVERDUE",
        action: canWrite ? (
          <BenefitForm policyId={x.policy_id} lineId={x.id} amount={Number(x.remaining)} currency={x.currency} banks={banks}
            persons={persons ?? []} hasCashValue={!!x.cash_value_asset_id} today={today} small canClose={canDelete} />
        ) : badge(INS_SCHED_STATUS[x.status]?.text ?? x.status, INS_SCHED_STATUS[x.status]?.cls ?? ""),
      };
    }),
    ...incomeList.map((i): MonthRow => {
      const gross = Number(i.amount ?? 0), tax = Number(i.tax ?? 0), net = gross - tax;
      const netThb = gross ? Number(i.base_amount ?? 0) * net / gross : 0;
      const src = i.pending_split ? null : incSource(i);
      const type = INCOME_TYPE_LABEL[i.income_type] ?? i.income_type;
      const who = i.source_transaction_id ? `จาก${pname(i.src_asset) ? ` ${pname(i.src_asset)}` : "พอร์ตลงทุน"}`
        : i.lease_id ? `ค่าเช่า ${pname(i.src_asset) ?? ""} (แบ่งตามเจ้าของทรัพย์สิน)`
        : i.income_type === "LOAN_INTEREST" && i.asset_id ? `ดอกเบี้ยจาก ${pname(i.src_asset) ?? "เงินให้กู้"} (แบ่งตามเจ้าของ)`
        : pname(i.persons) ?? (i.asset_id && pname(i.src_asset) ? `${pname(i.src_asset)} (แบ่งตามเจ้าของ)`
          : i.received_to_asset_id ? "ตามเจ้าของบัญชีที่รับ" : i.received_to_liability_id ? "ตามผู้รับผิดชอบหนี้" : "ส่วนกลาง");
      const title = i.pending_split ? stripPending(i.notes ?? "") || "ก้อนรอแยกรายละเอียด"
        : `${type}${i.income_subtype ? ` · ${i.income_subtype}` : ""}`;
      return {
        key: `i-${i.id}`, date: i.date, source: incLabel(i), status: "DONE", split: !!i.pending_split, currency: i.currency,
        expected: null, done: net, thbDone: netThb, thbLeft: 0,
        item: <>
          <div className="font-medium">{src ? <Link href={src.href} title={`แก้ที่หน้า${src.label}`} className={NAME_LINK}>{title}</Link> : title}</div>
          <div className="text-xs text-slate-500">{who}</div>
          {i.notes && !i.source_transaction_id && !i.pending_split && <div className="text-xs text-slate-400">{stripPending(i.notes)}</div>}
          {closeoutNote(i.id)}
          {tax !== 0 && <div className="text-xs text-slate-500">รายได้รวม {money(gross, i.currency)} · ภาษี {money(tax, i.currency)}</div>}
          {i.pct != null && <div className="text-xs text-slate-500">ส่วนของคนนี้ {i.pct}% ของ {money(i.full_amount, i.currency)}</div>}
          {i.currency !== "THB" && <div className="text-xs text-slate-400">≈ {money(netThb, "THB")}</div>}
        </>,
        account: i.received_to_asset_id ? name.get(i.received_to_asset_id) ?? "บัญชี" : i.received_to_credit_card_id ? `เข้าบัตร ${name.get(i.received_to_credit_card_id) ?? ""}`
          : i.received_to_liability_id ? `ลดหนี้ ${name.get(i.received_to_liability_id) ?? ""}` : i.source_transaction_id ? "ตามรายการลงทุน" : "ไม่ผ่านบัญชี",
        action: i.pending_split ? incSplit(i) ?? <MoveBadge label="รอแยกรายละเอียด" tone="amber" /> : incEdit(i, "แก้ไข") ?? DONE_INC,
      };
    }),
  ];

  const expRows: MonthRow[] = [
    ...rexpDue.filter((x) => x.status !== "PAID").map((x): MonthRow => {
      const open = costOpen(x.status);
      const paid = Number(x.paid_amount);
      return {
        key: `r-${x.template_id}-${x.cost_period}`, date: x.due_date, source: "ค่าใช้จ่ายประจำ", status: open ? "OPEN" : "DISMISSED",
        currency: x.currency, expected: Number(x.expected_amount), done: paid || null,
        thbDone: 0, thbLeft: open ? thb(Math.max(Number(x.expected_amount) - paid, 0), x.currency) : 0,
        item: <>
          {toSettings("expense", x.name)}
          <div className="text-xs text-slate-500">{x.expense_category}{x.person_id && ` · ${persons?.find((p) => p.id === x.person_id)?.name ?? ""}`}</div>
          {x.status === "DISMISSED" && x.dismissal_reason && <div className="text-xs text-slate-400">{x.dismissal_reason}</div>}
          {late(x.cost_period)}
        </>,
        account: x.pay_via === "CARD" ? `บัตร ${name.get(x.pay_from_credit_card_id ?? "") ?? ""}` : x.pay_via === "CASH" ? "เงินสด"
          : x.pay_from_asset_id ? name.get(x.pay_from_asset_id) ?? "บัญชี" : "",
        late: x.status === "OVERDUE",
        action: canWrite && open ? (
          <RecurringPayActions templateId={x.template_id} period={x.cost_period} label={`${x.name} (${thMonth(x.cost_period)})`}
            category={x.expense_category} expected={Number(x.expected_amount)} currency={x.currency} payVia={x.pay_via}
            bankId={x.pay_from_asset_id} cardId={x.pay_from_credit_card_id} personId={x.person_id}
            banks={banks} cards={cards} persons={persons ?? []} today={maxDate} minDate={minDate} />
        ) : acts(badge(COST_STATUS[x.status]?.text ?? x.status, `bg-slate-100 ${COST_STATUS[x.status]?.cls ?? ""}`),
          canDelete && x.status === "DISMISSED" && x.dismissal_id && <UndoDismissButton id={x.dismissal_id} />),
      };
    }),
    ...costs.filter((c) => c.status !== "PAID").map((c): MonthRow => {
      const open = costOpen(c.status);
      const paid = Number(c.paid_amount);
      const pct = pv.assetPct(c.property_asset_id);
      return {
        key: `c-${c.utility_id}-${c.cost_period}`, date: c.due_date, source: "ทรัพย์สิน", status: open ? "OPEN" : "DISMISSED",
        currency: c.currency, expected: Number(c.expected_amount), done: paid || null,
        thbDone: 0, thbLeft: open ? thb(Math.max(Number(c.expected_amount) - paid, 0), c.currency) * share(pct) : 0,
        item: <>
          <Link href={`/property/${c.property_asset_id}`} title="ไปหน้าทรัพย์สิน" className={`font-medium ${NAME_LINK}`}>{utilName(c.utility_type, c.provider)}</Link>
          <div className="text-xs text-slate-500">{c.property_name}{pct != null && ` · ส่วนของ ${pv.personName} ${pct}%`}</div>
          {c.status === "DISMISSED" && c.dismissal_reason && <div className="text-xs text-slate-400">{c.dismissal_reason}</div>}
          {late(c.cost_period)}
        </>,
        account: "",
        late: c.status === "OVERDUE",
        action: canWrite && open ? (
          <RecordCostForm assetId={c.property_asset_id} utilityId={c.utility_id} period={c.cost_period} currency={c.currency}
            label={`${utilName(c.utility_type, c.provider)} · ${c.property_name} (${thMonth(c.cost_period)})`}
            category={UTIL_EXPENSE_CATEGORY[c.utility_type] ?? "บ้าน / สาธารณูปโภค"} expected={Number(c.expected_amount)}
            banks={banks} cards={cards} persons={persons ?? []} today={today} />
        ) : acts(badge(COST_STATUS[c.status]?.text ?? c.status, `bg-slate-100 ${COST_STATUS[c.status]?.cls ?? ""}`),
          canDelete && c.status === "DISMISSED" && c.dismissal_id && <UndoDismissButton id={c.dismissal_id} />),
      };
    }),
    ...premiumDue.filter((x) => x.status !== "PAID" && x.status !== "CLOSED").map((x): MonthRow => {
      const got = Number(x.amount) - Number(x.remaining);
      return {
        key: `p-${x.id}`, date: x.due_date, source: "เบี้ยประกัน", status: "OPEN", currency: x.currency,
        expected: Number(x.amount), done: got || null, thbDone: 0, thbLeft: thb(Number(x.remaining), x.currency),
        item: <>
          <Link href={`/insurance/${x.policy_id}`} title="ไปหน้ากรมธรรม์" className={`font-medium ${NAME_LINK}`}>เบี้ยประกัน งวดที่ {x.installment_no}</Link>
          <div className="text-xs text-slate-500">{insName(x)}{x.payer_person_id && ` · ผู้จ่าย ${persons?.find((p) => p.id === x.payer_person_id)?.name ?? ""}`}</div>
          {late(x.due_date)}
        </>,
        account: "",
        late: x.status === "OVERDUE",
        action: !canWrite ? badge(INS_SCHED_STATUS[x.status]?.text ?? x.status, INS_SCHED_STATUS[x.status]?.cls ?? "") : (
          <PayPremiumForm policyId={x.policy_id} lineId={x.id} amount={Number(x.remaining)} currency={x.currency}
            label={`เบี้ยประกัน ${insName(x)} งวดที่ ${x.installment_no}`} banks={banks} cards={cards} persons={persons ?? []}
            defaultPerson={x.payer_person_id} today={today} />
        ),
      };
    }),
    ...itemList.map((i): MonthRow => {
      const r = rs.get(i.id);
      const cap = Number(i.expected_reimbursement_amount ?? i.full_amount);   // เงินคืนคิดจากยอดเต็มของรายการ
      const remaining = cap - Number(r?.reimbursed_amount ?? 0);
      const src = i.pending_split ? null : expSource(i);
      const cat = [i.expense_category === "BANK_FEE" ? "ค่าธรรมเนียมธนาคาร" : i.expense_category,
        i.property_cost_type && PROPERTY_COST_TYPE_LABEL[i.property_cost_type]].filter(Boolean).join(" · ");
      const title = i.pending_split ? stripPending(i.description) : i.description;
      return {
        key: `e-${i.id}`, date: i.date, source: expLabel(i), status: "DONE", split: !!i.pending_split, currency: i.currency,
        expected: null, done: Number(i.amount ?? 0), thbDone: Number(i.base_amount ?? 0) * i.share, thbLeft: 0, pay: payOf(i),
        item: <>
          <div className="font-medium">{!src ? title : src.label === "รายการโอน"
            ? <TabLink tab="overview" anchor="moves" href={src.href} className={NAME_LINK}>{title}</TabLink>
            : <Link href={src.href} title={`แก้ที่หน้า${src.label}`} className={NAME_LINK}>{title}</Link>}</div>
          {!i.pending_split && <div className="text-xs text-indigo-700">{cat}</div>}
          {i.notes && <div className="text-xs text-slate-400">{i.notes}</div>}
          {closeoutNote(i.id)}
          {i.pct != null && <div className="text-xs text-slate-500">{i.pct}% ของ {money(i.full_amount, i.currency)}</div>}
          {i.currency !== "THB" && <div className="text-xs text-slate-400">≈ {money(Number(i.base_amount ?? 0) * i.share, "THB")}</div>}
          {i.is_reimbursable && (
            <div className="mt-1">{badge(r?.reimbursement_status === "FULL" ? `ได้เงินคืนครบ ${money(r?.reimbursed_amount, i.currency)}`
              : Number(r?.reimbursed_amount ?? 0) > 0 ? `ได้คืนแล้ว ${money(r?.reimbursed_amount, i.currency)} · รออีก ${money(remaining, i.currency)}`
              : `รอเงินคืน ${money(remaining, i.currency)}`, r?.reimbursement_status === "FULL" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-800")}</div>
          )}
        </>,
        account: <>
          {i.source_cash_movement_id ? "จากรายการโอน"
            : i.paid_from_asset_id ? name.get(i.paid_from_asset_id) ?? "บัญชี"
            : i.paid_from_credit_card_id ? `บัตร ${name.get(i.paid_from_credit_card_id) ?? ""}`
            : i.paid_from_cash_holding_id ? name.get(i.paid_from_cash_holding_id) ?? "เงินฝากในพอร์ต"
            : i.liability_id ? `ทบเข้าหนี้ ${name.get(i.liability_id) ?? ""}` : "เงินสด"}
          {!i.source_cash_movement_id && (pname(i.persons) ? <div className="text-slate-500">ของ {pname(i.persons)}</div>
            : i.liability_id ? <div className="text-slate-500">ตามผู้รับผิดชอบหนี้</div>
            : i.paid_from_cash_holding_id ? <div className="text-slate-500">ตามเจ้าของพอร์ต</div>
            : !i.paid_from_asset_id && !i.paid_from_credit_card_id && <div className="text-slate-500">ส่วนกลาง</div>)}
        </>,
        action: i.pending_split ? expSplit(i) ?? <MoveBadge label="รอแยกรายละเอียด" tone="amber" />
          : acts(expEdit(i, "แก้ไข") ?? DONE_EXP,
            canWrite && i.is_reimbursable && remaining > 0 && (
              <ReimbursementForm itemId={i.id} remaining={remaining} currency={i.currency} banks={banks} cards={cards} claims={claims} newClaims={newClaims}
                today={today} minDate={goLive} />
            )),
      };
    }),
  ];
  // ค่าเช่าจากสัญญาเช่า (ดูอย่างเดียว · แก้ที่หน้าทรัพย์สิน) · รายบุคคล = ทรัพย์สินที่คนนั้นถือ (ยอดตามสัดส่วน)
  const propOf = new Map((leaseProps ?? []).map((x) => [x.asset_id as string, { type: x.property_type as string, name: pname(x.assets) ?? "ทรัพย์สิน" }]));
  const leaseRowsView: PropCostRow[] = leases.map((l) => {
    const k = pv.assetShare(l.property_asset_id);
    return {
      id: l.id, assetId: l.property_asset_id, assetName: propOf.get(l.property_asset_id)?.name ?? "ทรัพย์สิน",
      ptype: propOf.get(l.property_asset_id)?.type ?? "OTHER", item: [l.tenant_name, l.unit_label].filter(Boolean).join(" · "),
      amount: Number(l.rent_amount) * k, currency: l.rent_currency, freq: l.payment_frequency,
      schedule: scheduleText(l.payment_frequency, l.payment_due_day, null),
      perYear: Number(l.rent_amount) * (PERIODS_PER_YEAR[l.payment_frequency] ?? 0) * k,
      note: l.lease_status === "UPCOMING" ? `เริ่ม ${thDate(l.start_date)} · ถึง ${thDate(l.end_date)}`
        : `ถึง ${thDate(l.end_date)}${l.lease_status === "EXPIRING_SOON" ? " · ใกล้หมดสัญญา" : ""}`,
      warn: l.lease_status === "EXPIRING_SOON",
    };
  });
  const leaseYear = leaseRowsView.reduce((m, r) => m.set(r.currency, (m.get(r.currency) ?? 0) + r.perYear), new Map<string, number>());
  // ค่าใช้จ่ายประจำของทรัพย์สิน (ดูอย่างเดียว · แก้ที่หน้าทรัพย์สิน)
  const utilRowsView: PropCostRow[] = utils.map((u) => ({
    id: u.id, assetId: u.property_details.asset_id, assetName: u.property_details.assets.name,
    ptype: u.property_details.property_type, item: utilName(u.utility_type, u.provider),
    amount: Number(u.expected_amount), currency: u.currency, freq: u.frequency,
    schedule: scheduleText(u.frequency, u.due_day, u.due_month),
    perYear: Number(u.expected_amount) * (PERIODS_PER_YEAR[u.frequency] ?? 0),
  }));
  // ภาพรวมตามประเภท / หมวด (บาท · ตามสัดส่วนเมื่อดูรายบุคคล)
  const group = (rows: { label: string; pending: boolean; name: string; date: string; value: number; sub?: string | null }[]) => {
    const m = new Map<string, CatRow>();
    for (const r of rows) {
      const g = m.get(r.label) ?? { label: r.label, value: 0, items: [], pending: r.pending };
      g.value += r.value; g.items.push({ name: r.name, date: r.date, value: r.value }); m.set(r.label, g);
      if (r.sub) {
        const x = (g.subs ??= []).find((y) => y.label === r.sub);
        if (x) x.value += r.value; else g.subs.push({ label: r.sub, value: r.value });
      }
    }
    return [...m.values()];
  };
  const incomeCats = group(incomeList.map((i) => {
    const type = i.income_type === "OTHER" && i.income_subtype ? i.income_subtype : INCOME_TYPE_LABEL[i.income_type] ?? i.income_type;
    return { label: i.pending_split ? "รอแยกรายละเอียด" : type, pending: !!i.pending_split, date: i.date,
      name: i.notes || pname(i.src_asset) || pname(i.persons) || type, value: Number(i.base_amount ?? 0) };
  }));
  const expenseCats = group(itemList.map((i) => ({
    label: i.pending_split ? "รอแยกรายละเอียด" : i.expense_category || "ไม่ระบุหมวด", pending: !!i.pending_split, date: i.date,
    // หมวดบ้าน / สาธารณูปโภค: แยกย่อยตามประเภท (ตกลง 29 ต.ค. 2026)
    name: [i.property_cost_type && PROPERTY_COST_TYPE_LABEL[i.property_cost_type], i.description].filter(Boolean).join(" · "),
    sub: i.pending_split ? null : i.expense_category === HOME_CATEGORY ? PROPERTY_COST_TYPE_LABEL[i.property_cost_type ?? ""] ?? "ไม่ระบุประเภท" : null,
    value: Number(i.base_amount ?? 0) * i.share })));

  return (
    <TabsProvider initial={tab}>
    <div className="space-y-6">
      <PageInfo>รายได้ · ค่าใช้จ่าย (ไม่บังคับบันทึก) · เงินคืน · โอนและจ่ายหนี้</PageInfo>
      <HeaderFilters>
        <PersonFilter persons={pv.persons} value={pv.personId} />
        <MonthPicker months={months} value={ym} />
      </HeaderFilters>

      <TabNav tabs={TABS} />
      {sp.tab === "moves" && <ScrollToHash id="moves" />}

      {canWrite && !inMonth && <p className="text-sm text-slate-500">เดือนนี้อยู่นอกช่วงที่บันทึกได้ (ก่อน Go-live หรือเป็นเดือนในอนาคต)</p>}

      {/* ============================================================ ภาพรวม */}
      {/* ปุ่มบันทึก 3 ปุ่ม ขวาสุดของแถวแท็บ · ขึ้นทุกแท็บ (ตกลง 30 ต.ค. 2026) */}
      {canWrite && inMonth && (
        <TabActions>
          <MovementForm banks={banks} cards={cards} pfCash={pfCash} liabilities={liabs} today={maxDate} minDate={minDate} />
          <IncomeForm banks={banks} persons={persons ?? []} today={maxDate} minDate={minDate} subtypes={incSubs} />
          <ExpenseForm banks={banks} cards={cards} pfCash={pfCash} persons={persons ?? []} today={maxDate} minDate={minDate} categories={expCats} hints={expHints} properties={properties} />
        </TabActions>
      )}
      <TabPanel id="overview">
          {autopayPending.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              บัตรเครดิตตัดบัญชีอัตโนมัติรอยืนยัน {autopayPending.length} รายการ — <a href="#moves" className="underline">ดูในกล่อง &ldquo;เงินเข้า–ออกบัญชีเดือนนี้&rdquo;</a>
            </p>
          )}
          <section className="grid gap-4 md:grid-cols-4">
            <StatBox label="รายได้รวม (Gross)" value={money(grossThb, "THB", 0)} sub={investThb ? `รวมรายได้ลงทุน ${money(investThb, undefined, 0)}` : "รวมรายได้ลงทุน"}
              flag={incPendingSplit ? <TabLink tab="income" href={`/income-expenses?tab=income&it=split&m=${ym}`} className="hover:underline">มีรายการรอแยกรายละเอียด</TabLink> : undefined} />
            <StatBox label="รายได้สุทธิ (หลังภาษี)" value={money(grossThb - taxThb, "THB", 0)} sub={`ภาษีหัก ณ ที่จ่าย ${money(taxThb, undefined, 0)}`} />
            {/* ค่าใช้จ่ายสุทธิ = ค่าใช้จ่าย − เงินคืน (ยอดเดียวกับ Dashboard) */}
            <StatBox label="ค่าใช้จ่ายสุทธิ" value={money(expenseThb - reimbThb, "THB", 0)}
              sub={track === "NOT_TRACKED" ? "ยังไม่ได้บันทึกค่าใช้จ่าย" : <>{itemList.length} รายการ
                {reimbThb > 0 && <div>ค่าใช้จ่าย {money(expenseThb, undefined, 0)} − เงินคืน {money(reimbThb, undefined, 0)}</div>}
                {reimbPendingThb > 0 && <div>รอเงินคืน {money(reimbPendingThb, undefined, 0)}</div>}</>}
              subClass={track === "NOT_TRACKED" ? "text-slate-500" : undefined}
              flag={expPendingSplit ? <TabLink tab="expense" href={`/income-expenses?tab=expense&et=split&m=${ym}`} className="hover:underline">มีรายการรอแยกรายละเอียด</TabLink> : undefined} />
            <StatBox label="เงินคงเหลือสุทธิ" value={money(savings, "THB", 0)} subClass={savings < 0 ? "text-red-700" : undefined}
              sub={<>รายได้สุทธิ − ค่าใช้จ่ายสุทธิ<div>{track === "NOT_TRACKED" ? "(ยังไม่ได้บันทึกค่าใช้จ่าย)" : "(คิดจากรายการที่บันทึกไว้)"}</div></>} />
          </section>
          <section className="grid gap-4 lg:grid-cols-2">
            <CategoryBars kind="income" title={`รายได้ตามประเภท ${thMonth(start)}`} rows={incomeCats}
              note="ยอดก่อนหักภาษี (บาท) · กดที่ประเภทเพื่อดูรายการ" empty="ยังไม่มีรายได้ที่บันทึกในเดือนนี้" />
            <CategoryBars kind="expense" title={`ค่าใช้จ่ายตามหมวด ${thMonth(start)}`} rows={expenseCats}
              note={`ยอดก่อนหักเงินคืน (บาท)${reimbThb ? ` · ได้เงินคืน ${money(reimbThb, undefined, 0)}` : ""} · กดที่หมวดเพื่อดูรายการ`}
              empty="ยังไม่ได้บันทึกค่าใช้จ่าย" />
          </section>
          {/* เงินเข้า–ออกบัญชี (เดิมเป็นแท็บแยก) · ปุ่มโอน / จ่ายบัตร / จ่ายหนี้ อยู่แถวแท็บ */}
          <section id="moves" className="scroll-mt-4 space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-medium text-slate-900">เงินเข้า–ออกบัญชีเดือนนี้ <InfoTip label="คำอธิบาย">ทุกรายการที่ทำให้ยอดเงินในบัญชีธนาคารเปลี่ยน · เลือกบัญชีเพื่อเทียบกับ Statement · รายการที่มาจากหน้าอื่นกด &ldquo;แก้ที่หน้า …&rdquo;
              · โอนเข้า/ออกพอร์ตลงทุนทำที่หน้า Investments · การรับ/คืนเงินประกันทำที่หน้า Property</InfoTip></h2>
                <p className="text-xs text-slate-500">ทุกบัญชีธนาคารในระบบ · ยอดสรุปไม่นับโอนระหว่างบัญชีตัวเอง · {moveSum.count} รายการ</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm tabular-nums">
              {moveSum.count === 0 ? <span className="text-slate-500">ยังไม่มีเงินเข้า–ออกในเดือนนี้</span> : <>
                <span className="text-emerald-700">เข้า {moveSum.fx ? "≈ " : ""}{plusMoney(moveSum.inn, "THB")}</span>
                <span className="text-red-700">ออก {moveSum.fx ? "≈ " : ""}{minusMoney(moveSum.out, "THB")}</span>
                <span className={`font-semibold ${moveSum.inn - moveSum.out >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  สุทธิ {moveSum.fx ? "≈ " : ""}{signedMoney(moveSum.inn - moveSum.out, "THB")}</span>
                {moveSum.fx && <span className="text-xs text-slate-500">รวมเป็นบาท (อัตรา ณ วันที่ของแต่ละรายการ) · แยกสกุลอยู่ท้ายตาราง</span>}
              </>}
            </div>
            {autopay.length > 0 && (
              <div className={`rounded-lg border p-4 ${autopayPending.length ? "border-amber-200 bg-amber-50/40" : "border-slate-200"}`}>
                <h3 className="mb-3 text-sm font-medium text-slate-900">บัตรเครดิตตัดบัญชีอัตโนมัติ เดือน {thMonth(start)} <InfoTip label="คำอธิบาย">ถึงวันครบชำระแล้วขึ้น &ldquo;รอยืนยัน&rdquo; · ตรวจยอดที่ตัดจริงในบัญชีแล้วกดยืนยัน ระบบจึงบันทึกเงินออกจากบัญชีให้</InfoTip></h3>
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
                          <AutopayConfirmForm cardId={x.id} bankId={x.hold ? null : x.bank} holdId={x.hold} currency={x.currency} dueDate={x.due} amount={x.balance}
                            minimum={x.minimum} today={today} minDate={minDate} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <MovesView rows={moveRows(canWrite)} banks={bankOpts} showActions={canWrite} openings={openings} statements={statements} monthStart={start} limit={sp.hl?.startsWith("m-") ? undefined : 20} />
          </section>
      </TabPanel>

      {/* ============================================================ รายได้ */}
      <TabPanel id="income">
            <MonthTable kind="income" rows={incRows} focus={sp.hl} empty="ยังไม่มีรายได้ หรือรายการที่คาดไว้ในเดือนนี้" initialSource={sp.it === "split" ? "split" : ""} 
              info={<>รายการที่คาดไว้มาจากรายได้ประจำ สัญญาเช่า ตารางผ่อนเงินให้กู้ และผลประโยชน์ประกัน · ระบบไม่สร้างรายได้เอง กดปุ่ม &ldquo;บันทึกรับ&rdquo; ในช่องสถานะด้วยยอดจริง</>} />
      </TabPanel>

      {/* ============================================================ ค่าใช้จ่าย */}
      <TabPanel id="expense">
            <MonthTable kind="expense" rows={expRows} focus={sp.hl} banks={payBanks} cards={payCards} initialSource={sp.et === "split" ? "split" : ""}
              empty={track === "NOT_TRACKED" ? "ยังไม่ได้บันทึกค่าใช้จ่าย และไม่มีรายการที่คาดไว้ในเดือนนี้" : "ยังไม่มีค่าใช้จ่ายในเดือนนี้"} 
              info={<>ไม่บังคับบันทึก · บันทึกก้อนเดียว เช่น &ldquo;ค่าใช้จ่ายทั่วไปประจำเดือน&rdquo; ต่อบัญชีที่จ่าย แล้วแยกเฉพาะรายการสำคัญก็ได้
              · รายการที่คาดไว้มาจากค่าใช้จ่ายประจำ (ทั่วไป และของทรัพย์สิน) และตารางเบี้ยประกัน กดปุ่ม &ldquo;บันทึกจ่าย&rdquo; ในช่องสถานะด้วยยอดจริง
              · เงินคืนไม่ใช่รายได้ และไม่แก้ยอดค่าใช้จ่ายเดิม (รายงานแสดง ค่าใช้จ่าย − เงินคืน = ค่าใช้จ่ายสุทธิ)</>} />
      </TabPanel>

      {/* ============================================================ ตั้งค่า: รายได้ประจำ · ค่าใช้จ่ายประจำ · ประเภท / หมวด */}
      <TabPanel id="settings">
          <SubTabs param="st" initial={setTab} tabs={[["income", "รายได้ประจำ"], ["expense", "ค่าใช้จ่ายประจำ"], ["types", "ประเภท / หมวด"]]}
            actions={canWrite ? Object.fromEntries(["income", "expense", "types"].map((k) => [k, <Fragment key={k}>
              <TemplateForm banks={banks} persons={persons ?? []} today={today} />
              <ExpenseTemplateForm banks={banks} cards={cards} persons={persons ?? []} categories={expCats} today={today} />
            </Fragment>])) : {}}>
          <SubPanel id="income">
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-medium text-slate-900">ตั้งค่ารายได้ประจำ{canWrite && templateList.length > 0 && <> <InfoTip label="คำอธิบาย">กดที่แถวเพื่อแก้ไข / ลบ</InfoTip></>}</h2>
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
          </section>
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium text-slate-900">ค่าเช่าจากสัญญาเช่า <InfoTip label="คำอธิบาย">ดูอย่างเดียว · สัญญาที่ยังมีผล (รวมสัญญาที่ยังไม่เริ่ม) · เพิ่ม / แก้ไข / ต่อสัญญา ที่หน้าทรัพย์สิน (กดชื่อทรัพย์สิน){pv.personId ? " · ยอดตามสัดส่วนที่ถือ" : ""}</InfoTip></h2>
              {[...leaseYear.entries()].filter(([, v]) => v > 0).map(([ccy, v]) => (
                <span key={ccy} className="text-sm text-slate-600">ประมาณการต่อปี <span className="font-medium tabular-nums">{money(v, ccy, 0)}</span></span>
              ))}
            </div>
            <PropertyCostTable rows={leaseRowsView} itemHead="ผู้เช่า · ห้อง / ยูนิต" freqLabel="ความถี่ในการรับ" whenHead="รับเมื่อ" />
          </section>
          </SubPanel>
          <SubPanel id="expense">
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium text-slate-900">ค่าใช้จ่ายประจำทั่วไป {canWrite && rexpTpl.length > 0 && <InfoTip label="คำอธิบาย">กดที่แถวเพื่อแก้ไข / หยุดใช้ / ลบ · เปลี่ยนบัญชีที่จ่ายประจำ: หยุดใช้รายการเดิมแล้วเพิ่มใหม่ (ตอนบันทึกจ่ายเลือกบัญชีอื่นได้ทุกครั้ง)</InfoTip>}</h2>
              {[...rexpYear.entries()].filter(([, v]) => v > 0).map(([ccy, v]) => (
                <span key={ccy} className="text-sm text-slate-600">ประมาณการต่อปี <span className="font-medium tabular-nums">{money(v, ccy, 0)}</span></span>
              ))}
            </div>
            {rexpTpl.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มี</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr className="border-b border-slate-100"><th className="py-1.5 pr-2">ชื่อ</th><th className="px-2">หมวด</th><th className="px-2">ของใคร</th>
                      <th className="px-2 text-right">ยอดปกติ</th><th className="px-2">จ่ายเมื่อ</th><th className="px-2">จ่ายจาก</th><th className="px-2">สถานะ</th><th></th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rexpTpl.map((t) => (
                      <tr key={t.id} className={`align-top ${t.active ? "" : "text-slate-400"}`}>
                        <td className="py-2 pr-2 font-medium">{t.name}
                          <div className="text-xs font-normal text-slate-500">เริ่ม {thDate(t.start_date)}{t.end_date && ` · ถึง ${thDate(t.end_date)}`}</div>
                          {t.notes && <div className="text-xs font-normal text-slate-400">{t.notes}</div>}</td>
                        <td className="px-2 py-2">{t.expense_category}</td>
                        <td className="px-2 py-2">{pname(t.persons) ?? <span className="text-xs text-slate-500">ตามเจ้าของบัญชี / บัตร</span>}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{money(t.expected_amount, t.currency)}</td>
                        <td className="whitespace-nowrap px-2 py-2">{freqText(t.frequency, t.due_day)}</td>
                        <td className="px-2 py-2 text-xs text-slate-600">{t.pay_via === "CARD" ? `บัตร ${name.get(t.pay_from_credit_card_id ?? "") ?? ""}`
                          : t.pay_via === "CASH" ? "เงินสด" : t.pay_from_asset_id ? name.get(t.pay_from_asset_id) ?? "บัญชี" : "บัญชี (ไม่ระบุ)"}</td>
                        <td className="px-2 py-2 text-xs">{t.active ? <span className="text-emerald-700">ใช้งาน</span> : "หยุดใช้"}</td>
                        <td className="pl-2 py-2 text-right">
                          {canWrite && <RowActions table="recurring_expense_templates" id={t.id} paths={PATHS} canDelete={canDelete}
                            deleteNote="ค่าใช้จ่ายที่บันทึกจ่ายไปแล้วยังอยู่" extra={<ExpenseTemplateToggle id={t.id} active={t.active} />} fields={[
                              { name: "name", label: "ชื่อ", value: t.name, width: "w-44" },
                              { name: "expense_category", label: "หมวด", type: "select" as const, value: t.expense_category, options: withCurrent(expCats, t.expense_category) },
                              { name: "person_id", label: "ของใคร", type: "select" as const, value: t.person_id,
                                options: [["", "ตามเจ้าของบัญชี / บัตร"] as [string, string], ...personOpts] },
                              { name: "expected_amount", label: "ยอดปกติ", type: "number", value: t.expected_amount },
                              { name: "due_day", label: "วันที่", type: "number", value: t.due_day, width: "w-16" },
                              { name: "end_date", label: "สิ้นสุด", type: "date", value: t.end_date },
                              { name: "notes", label: "หมายเหตุ", value: t.notes, width: "w-40" }]} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium text-slate-900">ค่าใช้จ่ายประจำของทรัพย์สิน <InfoTip label="คำอธิบาย">ดูอย่างเดียว · เพิ่ม / แก้ไข / ลบ ที่หน้าทรัพย์สิน (กดชื่อทรัพย์สิน) · ทุกรายการ (รวมภาษีที่ดิน) ใช้หมวด &ldquo;บ้าน / สาธารณูปโภค&rdquo;</InfoTip></h2>
              {[...costYear.entries()].filter(([, v]) => v > 0).map(([ccy, v]) => (
                <span key={ccy} className="text-sm text-slate-600">ประมาณการต่อปี <span className="font-medium tabular-nums">{money(v, ccy, 0)}</span></span>
              ))}
            </div>
            <PropertyCostTable rows={utilRowsView} />
          </section>
          </SubPanel>
          <SubPanel id="types">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-medium text-slate-900">ประเภทรายได้ <InfoTip label="คำอธิบาย">ประเภทหลักระบบกำหนดไว้ (ใช้คำนวณภาษี / รายงาน และผูกกับหน้าลงทุน / ทรัพย์สิน / ประกัน) จึงแก้ไม่ได้
              · ถ้าต้องการแยกละเอียดขึ้น ให้ตั้ง &ldquo;ประเภทย่อยของรายได้อื่น&rdquo; ด้านล่าง</InfoTip></h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(INCOME_TYPE_LABEL).map(([k, v]) => (
                <span key={k} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">{v}</span>
              ))}
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-medium text-slate-900">ประเภทย่อยของรายได้อื่น <InfoTip label="คำอธิบาย">เช่น ขายของมือสอง · ค่าคอมมิชชั่น · เงินรางวัล — เลือกได้ตอนบันทึก &ldquo;รายได้อื่น&rdquo; (ไม่บังคับ) และแยกแท่งในกราฟภาพรวม</InfoTip></h2>
            <CategoryManager kind="INCOME_OTHER" cats={incSubAll} canEdit={canDelete} unit="ประเภทย่อย" />
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-medium text-slate-900">หมวดค่าใช้จ่าย <InfoTip label="คำอธิบาย">ใช้เป็นตัวเลือกตอนบันทึก / แยกรายการ / แก้ไขค่าใช้จ่าย · เปลี่ยนชื่อแล้วรายการเดิมทุกเดือนเปลี่ยนตาม (ยอดเงินไม่เปลี่ยน)
              · &ldquo;ซ่อน&rdquo; = ไม่ขึ้นในตัวเลือกอีก แต่รายการเดิมยังอยู่ · ลำดับนี้ใช้ในตัวเลือกทุกที่
              · ค่าใช้จ่ายประจำของ Property ทุกรายการ (รวมภาษีที่ดิน) ใช้หมวด &ldquo;บ้าน / สาธารณูปโภค&rdquo;</InfoTip></h2>
            <CategoryManager kind="EXPENSE" cats={expCatAll} canEdit={canDelete} unit="หมวด" />
          </section>
          {!canDelete && <p className="text-xs text-slate-500">เฉพาะ ADMIN / EDITOR เพิ่มหรือแก้ไขได้</p>}
          </SubPanel>
          </SubTabs>
      </TabPanel>
    </div>
    </TabsProvider>
  );
}

