import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ADD_BTN, BENEFIT_TYPE_LABEL, COVERAGE_ANNUAL, COVERAGE_LABEL, FOLLOWUP_ROLE, FOLLOWUP_STATUS, INS_STATUS, INS_TYPE, addDays, money, monthOptions, monthRange, thDate, thMonth, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import MonthPicker from "@/components/MonthPicker";
import { HeaderFilters, PageInfo } from "@/components/HeaderBar";
import { TabActions } from "@/components/TabActions";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { StatBox } from "@/components/Boxes";
import YearTable, { OPEN, type YLine } from "./YearTable";
import InsuranceBatch, { type InsLine, type PayOpt } from "./InsuranceBatch";
import CashValueBatch, { type CvRow } from "./CashValueBatch";
import { recEdit, recLabel, recLink, type Recorded } from "@/lib/recorded-edit";
import { premiumPaymentFields } from "@/lib/source-edit";
import { TabNav, TabPanel, TabsProvider } from "@/components/ClientTabs";
import { endpointValue } from "@/lib/money-endpoint";
import UndoButton from "@/components/UndoButton";
import RowActions from "@/components/RowActions";
import ModalButton from "@/components/ModalButton";

const TYPE = Object.fromEntries(INS_TYPE);
const STATUS = Object.fromEntries(INS_STATUS);
const TABS = [["overview", "ภาพรวม"], ["update", "อัปเดตมูลค่าเวนคืน"], ["benefit", "บันทึกรับผลประโยชน์"], ["premium", "จ่ายชำระเบี้ยประกัน"]] as const;

export default async function InsurancePage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string; t?: string; y?: string; tab?: string; m?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const paths = ["/insurance"];
  const sortMap = await loadSortMap("insurance_policies");
  const supabase = await createClient();
  const today = todayBangkok();
  // เดือนที่เลือก (แถบบน · ตกลง 28 ต.ค. 2026): เดือนนี้ = แท็บรับ / จ่ายแบบเดิม (ค้าง + ภายใน 60 วัน · ครบแล้วภายใน 60 วัน)
  //   เดือนอื่น = งวดค้าง + งวดที่ครบถึงสิ้นเดือนนั้น · งวดครบแล้วที่บันทึกในเดือนนั้น · วันที่ตั้งต้น = สิ้นเดือน (ไม่เกินวันนี้)
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : today.slice(0, 7);
  const isCur = ym === today.slice(0, 7);
  const { start: mStart, end: mEnd } = monthRange(ym);
  const defaultDate = mEnd < today ? mEnd : today;
  const year = today.slice(0, 4);
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  const [pv, { data, error }, { data: persons }, { data: cvs }, { data: covs }, { data: claims }, { data: dues }, { data: fups }, { data: allLines },
    { data: banks }, { data: cards }, { data: family }, { data: cvTable }] = await Promise.all([
    loadPersonView(sp.p),
    supabase.from("v_insurance_status").select("id,insurance_type,person_id,payer_person_id,insurer,policy_no,end_date,insured_amount,insured_amount_currency,premium,premium_currency,has_cash_value,cash_value_asset_id,status,derived_status,start_date")
      .order("status").order("insurer"),
    supabase.from("persons").select("id,name").order("sort_order"),
    supabase.from("assets").select("id,current_value,currency,current_value_date").eq("asset_type", "INSURANCE_CASH_VALUE").is("deleted_at", null),
    supabase.from("insurance_coverages").select("id,policy_id,coverage_type,limit_amount,currency").is("deleted_at", null),
    supabase.from("insurance_claims").select("coverage_id,claimed_amount,received_amount,status,claim_date").is("deleted_at", null)
      .not("coverage_id", "is", null).gte("claim_date", `${year}-01-01`).lte("claim_date", `${year}-12-31`),
    supabase.from("v_insurance_schedule_status").select("policy_id,due_date,remaining,status").eq("kind", "PREMIUM")
      .in("status", ["PENDING", "OVERDUE", "PARTIAL"]).order("due_date"),
    supabase.from("insurance_followups").select("id,person_id,policy_id,role,action,status").is("deleted_at", null)
      .in("status", ["OPEN", "IN_PROGRESS"]).order("created_at"),
    supabase.from("v_insurance_schedule_status").select("id,policy_id,kind,installment_no,due_date,amount,currency,benefit_type,paid_amount,remaining,status")
      .order("due_date").order("installment_no"),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency,frequent").eq("status", "ACTIVE").order("pick_order"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("insurance_cash_value_table").select("policy_id,policy_year,value_date,value").is("deleted_at", null).lte("value_date", today)
      .order("value_date"),
  ]);
  const pname = new Map((persons ?? []).map((p) => [p.id, p.name]));
  const cv = new Map((cvs ?? []).map((a) => [a.id, a]));
  // มุมมองรายบุคคล: กรมธรรม์ที่คนนั้นเป็นผู้เอาประกัน หรือเป็นเจ้าของมูลค่าเวนคืน · มูลค่าเวนคืน × สัดส่วนเจ้าของ
  const mineRows = bySort((data ?? []).filter((r) => pv.isPerson(r.person_id) || (pv.personId !== "" && r.payer_person_id === pv.personId)
    || (!!r.cash_value_asset_id && pv.personId !== "" && pv.showAsset(r.cash_value_asset_id))), (r) => r.id, sortMap);
  // ตัวกรองประเภท (?t=)
  const types = [...new Set(mineRows.map((r) => r.insurance_type as string))];
  const tFilter = types.includes(sp.t ?? "") ? sp.t : undefined;
  const rows = tFilter ? mineRows.filter((r) => r.insurance_type === tFilter) : mineRows;
  const tHref = (t?: string) => { const q = new URLSearchParams(); if (sp.p) q.set("p", sp.p); if (t) q.set("t", t); const x = q.toString(); return `/insurance${x ? `?${x}` : ""}`; };
  // เบี้ยงวดถัดไป / เลยกำหนด ต่อกรมธรรม์
  const nextPremium = new Map<string, { due_date: string; remaining: number }>();
  const overduePremium = new Map<string, number>();
  (dues ?? []).forEach((d) => {
    if (d.status === "OVERDUE") overduePremium.set(d.policy_id, (overduePremium.get(d.policy_id) ?? 0) + 1);
    else if (!nextPremium.has(d.policy_id)) nextPremium.set(d.policy_id, { due_date: d.due_date, remaining: Number(d.remaining) });
  });
  // สรุปสิทธิ์รายคน: กรมธรรม์ที่ยังมีผล · รวมวงเงินตามผู้เอาประกัน · วงเงินรายปีหักยอดเคลมปีนี้
  const activePolicy = new Map((data ?? []).filter((r) => r.status === "ACTIVE" && r.person_id).map((r) => [r.id, r.person_id as string]));
  const usedByCov = new Map<string, number>();
  (claims ?? []).filter((c) => !["REJECTED", "CANCELLED"].includes(c.status)).forEach((c) =>
    usedByCov.set(c.coverage_id as string, (usedByCov.get(c.coverage_id as string) ?? 0) + Number(c.received_amount ?? c.claimed_amount ?? 0)));
  // ตารางสิทธิ์: แถว = ความคุ้มครอง · คอลัมน์ = คน · กดตัวเลขดูว่ามาจากกรมธรรม์ไหน (ตกลง 2 พ.ย. 2026)
  type Sum = { limit: number; used: number; currency: string; policies: number; items: { policyId: string; limit: number; used: number; currency: string }[] };
  const byPerson = new Map<string, Map<string, Sum>>();
  (covs ?? []).forEach((c) => {
    const pid = activePolicy.get(c.policy_id);
    if (!pid || !pv.isPerson(pid)) return;
    const m = byPerson.get(pid) ?? new Map<string, Sum>();
    const cur = m.get(c.coverage_type) ?? { limit: 0, used: 0, currency: c.currency, policies: 0, items: [] };
    const used = usedByCov.get(c.id) ?? 0;
    m.set(c.coverage_type, { ...cur, limit: cur.limit + Number(c.limit_amount), used: cur.used + used, policies: cur.policies + 1,
      items: [...cur.items, { policyId: c.policy_id, limit: Number(c.limit_amount), used, currency: c.currency }] });
    byPerson.set(pid, m);
  });
  const covPersons = (persons ?? []).map((x) => x.id).filter((id) => byPerson.has(id));
  const covTypes = Object.keys(COVERAGE_LABEL).filter((k) => covPersons.some((id) => byPerson.get(id)?.has(k)));
  const policyName = new Map((data ?? []).map((r) => [r.id, `${r.insurer}${r.policy_no ? ` · ${r.policy_no}` : ""}`]));
  const fupRows = (fups ?? []).filter((f) => pv.isPerson(f.person_id) || rows.some((r) => r.id === f.policy_id));
  const cvTotal = (cvs ?? []).filter((a) => pv.showAsset(a.id))
    .reduce((s, a) => s + (a.currency === "THB" ? Number(a.current_value ?? 0) * pv.assetShare(a.id) : 0), 0);
  // สรุปด้านบน (กรมธรรม์ที่มีผล · THB)
  const act = mineRows.filter((r) => r.status === "ACTIVE");
  const sumThb = (f: (r: (typeof act)[number]) => number | null, ccyOf: (r: (typeof act)[number]) => string | null) =>
    act.reduce((t, r) => t + ((ccyOf(r) ?? "THB") === "THB" ? Number(f(r) ?? 0) : 0), 0);
  const insuredTotal = sumThb((r) => r.insured_amount, (r) => r.insured_amount_currency);
  const premiumTotal = sumThb((r) => r.premium, (r) => r.premium_currency);
  const overdueTotal = mineRows.reduce((t, r) => t + (overduePremium.get(r.id) ?? 0), 0);
  // งวดสุดท้าย (ปี พ.ศ.) + งวดที่เหลือ ต่อกรมธรรม์ · ตารางทั้งปี (?y=)
  const lineList = (allLines ?? []) as YLine[];
  const lastOf = (pid: string, kind: string) => {
    const xs = lineList.filter((l) => l.policy_id === pid && l.kind === kind);
    const d = xs.at(-1)?.due_date;
    return d ? { year: Number(d.slice(0, 4)) + 543, left: xs.filter((l) => OPEN.includes(l.status)).length } : null;
  };
  const shown = new Set(rows.map((r) => r.id));
  const yNow = Number(year);
  const yr = /^\d{4}$/.test(sp.y ?? "") ? Number(sp.y) : isCur ? yNow : Number(ym.slice(0, 4));
  const yearLines = lineList.filter((l) => shown.has(l.policy_id) && l.due_date.startsWith(`${yr}-`));
  const yHref = (y: number, t: string) => { const q = new URLSearchParams({ tab: t }); if (sp.p) q.set("p", sp.p); if (tFilter) q.set("t", tFilter); if (sp.m) q.set("m", sp.m);
    if (y !== yNow) q.set("y", String(y)); return `/insurance?${q.toString()}`; };
  const groupsOf = (kind: string) => rows.map((r) => ({ r, lines: yearLines.filter((l) => l.policy_id === r.id && l.kind === kind) })).filter((g) => g.lines.length > 0);
  const cvOf = (r: (typeof rows)[number]) => { const c = r.cash_value_asset_id ? cv.get(r.cash_value_asset_id) : null;
    return c && c.currency === "THB" && c.current_value != null ? Number(c.current_value) * pv.assetShare(c.id) : 0; };
  // แท็บบันทึกทั้งชุด: งวดที่ยังไม่จ่าย / ยังไม่รับ ของกรมธรรม์ที่มีผล (ตามตัวกรองคน)
  const activeIds = new Set(mineRows.filter((r) => r.status === "ACTIVE").map((r) => r.id));
  // งวดที่จ่าย / รับไปแล้ว (บางส่วน หรือครบภายใน 60 วัน) → ยอดที่บันทึกแล้วกดเพื่อแก้ / ลบ ในตาราง (ตกลง 28 ต.ค. 2026)
  //   เบี้ย = ฟอร์มเดียวกับหน้ากรมธรรม์ · ผลประโยชน์ = ยกเลิกทั้งก้อนแล้วบันทึกใหม่ · งวดที่ครบแล้วยังอยู่ในตาราง ("ครบแล้ว" · ไม่มีช่องกรอก)
  const since = isCur ? addDays(today, -60) : mStart, until = isCur ? today : mEnd;
  // ดึงช่วงเดียวครอบทั้ง "ภายใน 60 วัน" และทั้งเดือนที่เลือก → ใช้ทั้งตารางบันทึกทั้งชุดและกล่อง "ที่บันทึกแล้ว · เดือน" (ไม่เพิ่มรอบ)
  const qUntil = until > mEnd ? until : mEnd;
  const [{ data: recentPays }, { data: recentBens }] = await Promise.all([
    supabase.from("expense_items").select("id,insurance_schedule_line_id,date,amount,currency,notes,paid_from_asset_id,paid_from_credit_card_id,person_id")
      .not("insurance_schedule_line_id", "is", null).gte("date", since).lte("date", qUntil).is("deleted_at", null).order("date").order("created_at"),
    supabase.from("insurance_benefit_receipts").select("id,policy_id,line_id,receipt_date,amount,currency,bank_asset_id,cash_value_part,income_part,outcome,notes")
      .gte("receipt_date", since).lte("receipt_date", qUntil).is("undone_at", null).is("deleted_at", null).order("receipt_date").order("created_at"),
  ]);
  const recentLines = new Set([...(recentPays ?? []).filter((e) => e.date <= until).map((e) => e.insurance_schedule_line_id as string),
    ...(recentBens ?? []).filter((b) => b.line_id && b.receipt_date <= until).map((b) => b.line_id as string)]);
  const inBatch = (l: YLine) => activeIds.has(l.policy_id)
    && ((OPEN.includes(l.status) && (isCur || l.due_date <= mEnd)) || (l.status === "PAID" && recentLines.has(l.id)));
  const soon = isCur ? addDays(today, 60) : mEnd;
  const paidIds = lineList.filter((l) => inBatch(l) && Number(l.paid_amount ?? 0) > 0).map((l) => l.id);
  const [{ data: partPays }, { data: partBens }] = paidIds.length ? await Promise.all([
    supabase.from("expense_items").select("id,insurance_schedule_line_id,date,amount,currency,notes").in("insurance_schedule_line_id", paidIds).is("deleted_at", null).order("date"),
    supabase.from("insurance_benefit_receipts").select("id,line_id,receipt_date,amount,currency,outcome").in("line_id", paidIds).is("undone_at", null).is("deleted_at", null).order("receipt_date"),
  ]) : [{ data: [] as { id: string; insurance_schedule_line_id: string; date: string; amount: number; currency: string; notes: string | null }[] },
    { data: [] as { id: string; line_id: string; receipt_date: string; amount: number; currency: string; outcome: string | null }[] }];
  const editsOf = (l: { id: string; policy_id: string; installment_no: number }): Recorded[] => {
    const paths = ["/insurance", `/insurance/${l.policy_id}`, "/income-expenses"];
    return [
      ...(partPays ?? []).filter((e) => e.insurance_schedule_line_id === l.id).map((e) => ({ id: e.id as string, node: recEdit({
        canWrite, canDelete: canOrder, table: "expense_items", id: e.id as string, label: recLabel("จ่ายแล้ว", e.date as string, Number(e.amount), e.currency as string),
        paths, fields: premiumPaymentFields(e as { date: string; amount: number }) }) })),
      ...(partBens ?? []).filter((b) => b.line_id === l.id).map((b) => {
        const label = recLabel("รับแล้ว", b.receipt_date as string, Number(b.amount), b.currency as string);
        return { id: b.id as string, node: canOrder && !b.outcome
          ? <span className="inline-flex items-center gap-2"><span className="text-xs text-emerald-700">{label}</span>
              <UndoButton kind="BENEFIT" id={b.id as string} paths={paths} label="ยกเลิก"
                confirmText={`ยกเลิกการรับ ${money(Number(b.amount), b.currency as string)} วันที่ ${thDate(b.receipt_date as string)} (งวดที่ ${l.installment_no}) ทั้งก้อน?\nเงินที่ถอนจากมูลค่าเวนคืน / รายได้ของครั้งนี้ถูกย้อนทั้งหมด แล้วบันทึกยอดที่ถูกใหม่ในตารางได้`} /></span>
          : recLink(label, `/insurance/${l.policy_id}`) };
      }),
    ];
  };
  const batchLines = (k: string): InsLine[] => lineList.filter((l) => l.kind === k && inBatch(l))
    .map((l) => {
      const r = mineRows.find((x) => x.id === l.policy_id);
      return { id: l.id, policyId: l.policy_id, policy: policyName.get(l.policy_id) ?? "-", person: r?.person_id ? pname.get(r.person_id) ?? null : null,
        no: l.installment_no, due: l.due_date, remaining: Number(l.remaining),
        amount: Number(l.amount), paid: Number(l.paid_amount ?? 0), currency: l.currency, status: l.status, benefitType: l.benefit_type, edits: editsOf(l) };
    });
  const bankPays: PayOpt[] = (banks ?? []).map((b) => ({ value: endpointValue({ kind: "bank", id: b.asset_id }), label: `บัญชี ${b.name}`, currency: b.currency }));
  const cardPays: PayOpt[] = (cards ?? []).map((c) => ({ value: endpointValue({ kind: "card", id: c.id }),
    label: `บัตร ${[c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ")}`, currency: c.currency }));
  const canWrite = me.role !== "VIEWER";
  const goLive = family?.go_live_date ?? "";
  // กล่อง "ที่บันทึกแล้ว · เดือน" ใต้ตารางบันทึกทั้งชุด (เหมือนหน้า Property · ตกลง 2 พ.ย. 2026) · ตามตัวกรองคน
  const lineById = new Map(lineList.map((l) => [l.id, l]));
  const mine = new Set(mineRows.map((r) => r.id));
  const bankName = new Map((banks ?? []).map((b) => [b.asset_id as string, b.name as string]));
  const cardName = new Map((cards ?? []).map((c) => [c.id as string, [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ")]));
  const monthPays = (recentPays ?? []).filter((e) => e.date >= mStart && e.date <= mEnd)
    .map((e) => ({ ...e, line: lineById.get(e.insurance_schedule_line_id as string) })).filter((e) => e.line && mine.has(e.line.policy_id));
  const monthBens = (recentBens ?? []).filter((b) => b.receipt_date >= mStart && b.receipt_date <= mEnd && mine.has(b.policy_id));
  const sumThbOf = (xs: { amount: number; currency: string }[]) => xs.filter((x) => x.currency === "THB").reduce((t, x) => t + Number(x.amount), 0);
  const AMT = "tabular-nums underline decoration-dotted underline-offset-4 hover:text-blue-700";
  const paidWith = (e: { paid_from_asset_id: string | null; paid_from_credit_card_id: string | null; person_id: string | null }) =>
    e.paid_from_asset_id ? `บัญชี ${bankName.get(e.paid_from_asset_id) ?? ""}` : e.paid_from_credit_card_id ? `บัตร ${cardName.get(e.paid_from_credit_card_id) ?? ""}`
      : e.person_id ? `เงินสด / ${pname.get(e.person_id) ?? ""}` : "-";
  const OUTCOME: Record<string, string> = { MATURED: "ครบสัญญา", SURRENDERED: "เวนคืน", CLAIMED: "สินไหม" };
  const actRows = rows.filter((r) => r.status === "ACTIVE");
  const nextBenefit = (pid: string) => lineList.find((l) => l.policy_id === pid && l.kind === "BENEFIT" && OPEN.includes(l.status));
  const monthLabel = thMonth(mStart);
  // แท็บอัปเดตมูลค่าเวนคืน: กรมธรรม์ที่มีผลและมีมูลค่าเวนคืน / ตารางตามสัญญา · ปีล่าสุดที่ถึงวันแล้ว · ยังไม่ได้ลง (เงื่อนไขเดียวกับ sync_insurance_cash_value)
  const dueOf = new Map<string, { year: number; value: number; date: string }>();
  (cvTable ?? []).forEach((c) => dueOf.set(c.policy_id, { year: Number(c.policy_year), value: Number(c.value), date: c.value_date as string }));
  const cvRows: CvRow[] = actRows.filter((r) => r.has_cash_value || r.cash_value_asset_id || dueOf.has(r.id)).map((r) => {
    const a = r.cash_value_asset_id ? cv.get(r.cash_value_asset_id) : undefined;
    const due = dueOf.get(r.id) ?? null;
    const pending = !!due && (!a ? true : due.date >= goLive && (!a.current_value_date || due.date > a.current_value_date));
    const premiumDue = !!due && lineList.some((l) => l.policy_id === r.id && l.kind === "PREMIUM" && l.due_date < due.date && l.status !== "PAID");
    return { policyId: r.id, assetId: a?.id ?? null, name: policyName.get(r.id) ?? "-", person: r.person_id ? pname.get(r.person_id) ?? null : null,
      currency: a?.currency ?? r.insured_amount_currency ?? "THB", value: a?.current_value == null ? null : Number(a.current_value), date: a?.current_value_date ?? null,
      due, pending, premiumDue, factor: a && a.currency === "THB" ? pv.assetShare(a.id) : 0 };
  });
  return (
    <TabsProvider initial={tab} defaultKey="overview">
    <div className="space-y-6">
      <PageInfo>กรมธรรม์ทั้งหมด · มูลค่าเวนคืนนับเป็นสินทรัพย์ (หมวดการเงิน)</PageInfo>
      <HeaderFilters><PersonFilter persons={pv.persons} value={pv.personId} /><MonthPicker months={monthOptions(goLive, today, 12, ym)} value={ym} /></HeaderFilters>
      {me.role !== "VIEWER" && <TabActions><Link href="/insurance/new" className={ADD_BTN}>+ เพิ่มกรมธรรม์</Link></TabActions>}
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <div className="border-b border-slate-200"><TabNav tabs={TABS} /></div>

      <TabPanel id="benefit" className="space-y-4">
        <InsuranceBatch key={`b${ym}${lineList.length}`} kind="BENEFIT" rows={batchLines("BENEFIT")} pays={bankPays} today={today} defaultDate={defaultDate} soon={soon} minDate={goLive} canWrite={canWrite} />
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <h2 className="px-4 pt-4 font-medium text-slate-900">ผลประโยชน์ที่รับแล้ว · {monthLabel}</h2>
          <table className="mt-2 w-full min-w-[48rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-3 py-2">วันที่</th><th className="px-3">กรมธรรม์</th><th className="px-3">รายการ</th><th className="px-3">เข้าบัญชี</th>
                <th className="px-3 text-right">จากมูลค่าเวนคืน</th><th className="px-3 text-right">รายได้</th><th className="px-3 text-right">ยอดรับ</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {monthBens.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">ยังไม่มีการรับผลประโยชน์ในเดือนนี้</td></tr>}
              {monthBens.map((b) => {
                const l = b.line_id ? lineById.get(b.line_id) : undefined;
                return (
                  <tr key={b.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2">{thDate(b.receipt_date)}</td>
                    <td className="px-3"><Link href={`/insurance/${b.policy_id}`} className="hover:underline">{policyName.get(b.policy_id) ?? "-"}</Link></td>
                    <td className="px-3">{l ? `งวดที่ ${l.installment_no} · ${BENEFIT_TYPE_LABEL[l.benefit_type ?? "OTHER"]}` : "รับเงินก้อน"}{b.outcome && ` · ${OUTCOME[b.outcome] ?? b.outcome}`}
                      {b.notes && <div className="text-xs text-slate-500">{b.notes}</div>}</td>
                    <td className="px-3 text-xs text-slate-600">{b.bank_asset_id ? bankName.get(b.bank_asset_id) ?? "บัญชี" : "-"}</td>
                    <td className="px-3 text-right tabular-nums">{Number(b.cash_value_part) > 0 ? money(b.cash_value_part) : "-"}</td>
                    <td className="px-3 text-right tabular-nums">{Number(b.income_part) > 0 ? money(b.income_part) : "-"}</td>
                    <td className="whitespace-nowrap px-3 text-right tabular-nums text-emerald-700">{money(b.amount, b.currency !== "THB" ? b.currency : undefined)}</td>
                    <td className="px-3 text-right">
                      {canOrder && !b.outcome ? <UndoButton kind="BENEFIT" id={b.id} paths={["/insurance", `/insurance/${b.policy_id}`, "/income-expenses"]} label="ยกเลิก"
                        confirmText={`ยกเลิกการรับ ${money(Number(b.amount), b.currency)} วันที่ ${thDate(b.receipt_date)} ทั้งก้อน?\nเงินที่ถอนจากมูลค่าเวนคืน / รายได้ของครั้งนี้ถูกย้อนทั้งหมด`} />
                        : b.outcome && canOrder ? <Link href={`/insurance/${b.policy_id}`} className="text-xs text-slate-500 hover:underline" title="ยกเลิกที่หน้ากรมธรรม์">หน้ากรมธรรม์ →</Link> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {monthBens.length > 0 && <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium"><tr><td colSpan={4} className="px-3 py-2">รวม (THB)</td>
              <td className="px-3 text-right tabular-nums">{money(monthBens.filter((b) => b.currency === "THB").reduce((t, b) => t + Number(b.cash_value_part), 0))}</td>
              <td className="px-3 text-right tabular-nums">{money(monthBens.filter((b) => b.currency === "THB").reduce((t, b) => t + Number(b.income_part), 0))}</td>
              <td className="px-3 text-right tabular-nums text-emerald-700">{money(sumThbOf(monthBens))}</td><td></td></tr></tfoot>}
          </table>
          <p className="px-4 pb-3 pt-2 text-xs text-slate-500">เงินที่รับถอนจากมูลค่าเวนคืนก่อน ส่วนที่เกินนับเป็นรายได้ · ยกเลิก = ย้อนทั้งก้อนแล้วบันทึกใหม่ในตารางด้านบน · รับเงินก้อน (ครบสัญญา / เวนคืน / สินไหม) ยกเลิกที่หน้ากรมธรรม์</p>
        </div>
        <YearTable kind="BENEFIT" year={yr} groups={groupsOf("BENEFIT")} pname={pname} prevHref={yHref(yr - 1, "benefit")} nextHref={yHref(yr + 1, "benefit")} thisHref={yr !== yNow ? yHref(yNow, "benefit") : undefined} />
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <h2 className="px-4 pt-4 font-medium text-slate-900">กรมธรรม์ที่มีผล</h2>
          <table className="mt-2 w-full min-w-[44rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-3 py-2">กรมธรรม์</th><th className="px-3">ผู้เอาประกัน</th><th className="px-3">ระยะสัญญา</th><th className="px-3">ผลประโยชน์งวดถัดไป</th><th className="px-3 text-right">มูลค่าเวนคืน</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {actRows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">ไม่มีกรมธรรม์ที่มีผล</td></tr>}
              {actRows.map((r) => {
                const nb = nextBenefit(r.id);
                const lb = lastOf(r.id, "BENEFIT");
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2"><Link href={`/insurance/${r.id}`} className="hover:underline">{policyName.get(r.id)}</Link>
                      <div className="text-xs text-slate-500">{TYPE[r.insurance_type] ?? r.insurance_type}</div></td>
                    <td className="px-3">{r.person_id ? pname.get(r.person_id) : "-"}</td>
                    <td className="whitespace-nowrap px-3 text-xs text-slate-500">{thDate(r.start_date)} – {thDate(r.end_date)}</td>
                    <td className="px-3 text-xs">{nb ? <>{thDate(nb.due_date)} · <span className="tabular-nums">{money(nb.remaining, nb.currency)}</span></> : <span className="text-slate-400">-</span>}
                      {lb && <div className="text-slate-500">รับถึงปี {lb.year} · เหลือ {lb.left} งวด</div>}</td>
                    <td className="px-3 text-right tabular-nums">{r.has_cash_value ? money(cvOf(r), undefined, 0) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TabPanel>
      <TabPanel id="premium" className="space-y-4">
        <InsuranceBatch key={`p${ym}${lineList.length}`} kind="PREMIUM" rows={batchLines("PREMIUM")} pays={[...bankPays, ...cardPays]} today={today} defaultDate={defaultDate} soon={soon} minDate={goLive} canWrite={canWrite} />
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <h2 className="px-4 pt-4 font-medium text-slate-900">เบี้ยที่จ่ายแล้ว · {monthLabel}</h2>
          <table className="mt-2 w-full min-w-[40rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-3 py-2">วันที่</th><th className="px-3">กรมธรรม์</th><th className="px-3">งวด</th><th className="px-3">จ่ายด้วย</th><th className="px-3 text-right">จำนวน</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {monthPays.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">ยังไม่มีการจ่ายเบี้ยในเดือนนี้</td></tr>}
              {monthPays.map((e) => {
                const l = e.line as YLine;
                const text = money(e.amount, e.currency !== "THB" ? e.currency : undefined);
                return (
                  <tr key={e.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2">{thDate(e.date)}</td>
                    <td className="px-3"><Link href={`/insurance/${l.policy_id}`} className="hover:underline">{policyName.get(l.policy_id) ?? "-"}</Link></td>
                    <td className="px-3">งวดที่ {l.installment_no} <span className="text-xs text-slate-500">· ครบ {thDate(l.due_date)}</span>{e.notes && <div className="text-xs text-slate-500">{e.notes}</div>}</td>
                    <td className="px-3 text-xs text-slate-600">{paidWith(e)}</td>
                    <td className="whitespace-nowrap px-3 text-right tabular-nums text-red-700">
                      {canWrite ? <RowActions table="expense_items" id={e.id} paths={["/insurance", `/insurance/${l.policy_id}`, "/income-expenses"]} canDelete={canOrder}
                        fields={premiumPaymentFields(e as { date: string; amount: number })} button={`${text} ✎`} buttonClass={AMT} /> : text}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {monthPays.length > 0 && <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium"><tr><td colSpan={4} className="px-3 py-2">รวม (THB)</td>
              <td className="px-3 text-right tabular-nums text-red-700">{money(sumThbOf(monthPays))}</td></tr></tfoot>}
          </table>
          <p className="px-4 pb-3 pt-2 text-xs text-slate-500">กดยอดเพื่อแก้ / ลบ · ลบแล้วงวดนั้นกลับเป็น &ldquo;รอจ่าย&rdquo; · เดือนที่ปิดแล้วต้อง Reopen ก่อน</p>
        </div>
        <YearTable kind="PREMIUM" year={yr} groups={groupsOf("PREMIUM")} pname={pname} prevHref={yHref(yr - 1, "premium")} nextHref={yHref(yr + 1, "premium")} thisHref={yr !== yNow ? yHref(yNow, "premium") : undefined} />
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <h2 className="px-4 pt-4 font-medium text-slate-900">กรมธรรม์ที่มีผล</h2>
          <table className="mt-2 w-full min-w-[44rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-3 py-2">กรมธรรม์</th><th className="px-3">ผู้จ่าย</th><th className="px-3">ระยะสัญญา</th><th className="px-3">เบี้ยงวดถัดไป</th><th className="px-3 text-right">เบี้ยต่อปี</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {actRows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">ไม่มีกรมธรรม์ที่มีผล</td></tr>}
              {actRows.map((r) => {
                const np = nextPremium.get(r.id);
                const lp = lastOf(r.id, "PREMIUM");
                const payer = r.payer_person_id ?? r.person_id;
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2"><Link href={`/insurance/${r.id}`} className="hover:underline">{policyName.get(r.id)}</Link>
                      <div className="text-xs text-slate-500">{TYPE[r.insurance_type] ?? r.insurance_type}</div></td>
                    <td className="px-3">{payer ? pname.get(payer) : "-"}</td>
                    <td className="whitespace-nowrap px-3 text-xs text-slate-500">{thDate(r.start_date)} – {thDate(r.end_date)}</td>
                    <td className="px-3 text-xs">{np ? <>{thDate(np.due_date)} · <span className="tabular-nums">{money(np.remaining)}</span></> : <span className="text-slate-400">-</span>}
                      {overduePremium.get(r.id) && <div className="text-red-600">เลยกำหนด {overduePremium.get(r.id)} งวด</div>}
                      {lp && <div className="text-slate-500">จ่ายถึงปี {lp.year} · เหลือ {lp.left} งวด</div>}</td>
                    <td className="px-3 text-right tabular-nums">{r.premium != null ? money(r.premium, r.premium_currency ?? undefined, 0) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
            {actRows.length > 0 && <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium"><tr><td colSpan={4} className="px-3 py-2">รวม {actRows.length} ฉบับ (THB)</td>
              <td className="px-3 text-right tabular-nums">{money(actRows.filter((r) => (r.premium_currency ?? "THB") === "THB").reduce((t, r) => t + Number(r.premium ?? 0), 0), undefined, 0)}</td></tr></tfoot>}
          </table>
        </div>
      </TabPanel>

      <TabPanel id="update">
        <CashValueBatch key={`u${cvRows.map((r) => `${r.policyId}${r.date}`).join("")}`} rows={cvRows} today={today} minDate={goLive} canWrite={canWrite} canCreate={canOrder}
          shareNote={pv.personId ? `ยอดรวมท้ายตาราง = ส่วนของ ${pv.personName} ตามสัดส่วนเจ้าของ (มูลค่าในแถว = ทั้งกรมธรรม์)` : null} />
      </TabPanel>

      <TabPanel id="overview" className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatBox label="กรมธรรม์ที่มีผล" value={act.length} unit="ฉบับ" sub={<>ทั้งหมด {mineRows.length} ฉบับ</>} />
        <StatBox label="ทุนประกันรวม (THB)" value={money(insuredTotal, "THB", 0)} />
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">เบี้ยรวมต่อปี (THB)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{money(premiumTotal, "THB", 0)}</div>
          {overdueTotal > 0 && <div className="text-xs text-red-600">เบี้ยเลยกำหนด {overdueTotal} งวด</div>}
        </div>
        <StatBox label={<>{pv.personId ? `มูลค่าเวนคืนส่วนของ ${pv.personName}` : "มูลค่าเวนคืนรวม"} (THB)</>} value={money(cvTotal, "THB", 0)} sub="นับเป็นสินทรัพย์หมวดการเงิน" />
      </section>
      {fupRows.length > 0 && (
        <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-medium text-slate-900">กรมธรรม์ที่ต้องติดตาม (สมาชิก Archived) · ค้าง {fupRows.length} รายการ</h2>
          <ul className="space-y-1 text-sm">
            {fupRows.map((f) => (
              <li key={f.id}>
                <Link href={`/insurance/${f.policy_id}`} className="font-medium hover:underline">{policyName.get(f.policy_id) ?? "กรมธรรม์"}</Link>
                {" · "}{pname.get(f.person_id)} ({FOLLOWUP_ROLE[f.role]}) · {f.action}
                <span className="ml-1 text-xs text-amber-800">[{Object.fromEntries(FOLLOWUP_STATUS)[f.status]}]</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {covPersons.length > 0 && (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <h2 className="px-4 pt-4 font-medium text-slate-900">สิทธิ์คุ้มครองรายคน</h2>
          <p className="px-4 text-xs text-slate-500">รวมวงเงินจากกรมธรรม์ที่มีผลตามผู้เอาประกัน · วงเงินต่อปีหักยอดเคลมปีนี้ · กดตัวเลขเพื่อดูว่ามาจากกรมธรรม์ไหน</p>
          <table className="mt-2 w-full min-w-[36rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">ความคุ้มครอง</th>{covPersons.map((id) => <th key={id} className="px-4 text-right">{pname.get(id)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {covTypes.map((k) => (
                <tr key={k} className="align-top">
                  <td className="px-4 py-2">{COVERAGE_LABEL[k][0]}{COVERAGE_LABEL[k][1] && <span className="text-xs text-slate-500"> {COVERAGE_LABEL[k][1]}</span>}</td>
                  {covPersons.map((id) => {
                    const x = byPerson.get(id)?.get(k);
                    if (!x) return <td key={id} className="px-4 text-right text-slate-300">-</td>;
                    const annual = COVERAGE_ANNUAL.includes(k);
                    return (
                      <td key={id} className="px-4 py-2 text-right">
                        <ModalButton label={money(x.limit, x.currency, 0)} title={`${COVERAGE_LABEL[k][0]} · ${pname.get(id)}`}
                          className="tabular-nums text-slate-900 underline decoration-dotted underline-offset-4 hover:text-blue-700">
                          <table className="w-full text-sm">
                            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">กรมธรรม์</th><th className="text-right">วงเงิน</th>{annual && <th className="text-right">ใช้ปีนี้</th>}</tr></thead>
                            <tbody className="divide-y divide-slate-100">
                              {x.items.map((it, n) => (
                                <tr key={n}><td className="py-1.5"><Link href={`/insurance/${it.policyId}`} className="hover:underline">{policyName.get(it.policyId)}</Link></td>
                                  <td className="text-right tabular-nums">{money(it.limit, it.currency, 0)}</td>
                                  {annual && <td className="text-right tabular-nums">{it.used > 0 ? money(it.used, undefined, 0) : "-"}</td>}</tr>
                              ))}
                            </tbody>
                          </table>
                        </ModalButton>
                        {x.policies > 1 && <div className="text-xs text-slate-400">{x.policies} กรมธรรม์</div>}
                        {annual && x.used > 0 && <div className="text-xs text-slate-500">เหลือ {money(Math.max(x.limit - x.used, 0), undefined, 0)}</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 pb-3 pt-2 text-xs text-slate-500">เคลม: บันทึกเงินคืนที่ Income &amp; Expenses แล้วเลือก &ldquo;เคลมใหม่&rdquo; ตามความคุ้มครอง ระบบสร้างเคลมและหักวงเงินให้เอง · ดูสิทธิ์สุขภาพรายคนได้ที่ Family → Health</p>
        </section>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-medium text-slate-900">กรมธรรม์ทั้งหมด</h2>
            {types.length > 1 && (
              <div className="flex flex-wrap gap-1 text-xs">
                <Link href={tHref()} scroll={false} className={`rounded-full border px-2.5 py-0.5 ${!tFilter ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>ทั้งหมด</Link>
                {types.map((t) => (
                  <Link key={t} href={tHref(t)} scroll={false}
                    className={`rounded-full border px-2.5 py-0.5 ${tFilter === t ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                    {TYPE[t] ?? t} ({mineRows.filter((r) => r.insurance_type === t).length})</Link>
                ))}
              </div>
            )}
          </div>
          {canOrder && rows.length > 1 && <SortToggle active={ordering} {...orderHrefs("/insurance", { p: sp.p, t: tFilter })} />}
        </div>
        <table className="mt-2 w-full min-w-[52rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">กรมธรรม์</th><th className="px-4">ผู้เอาประกัน</th><th className="px-4 text-right">ทุน / เบี้ย</th><th className="px-4 text-right">มูลค่าเวนคืน</th><th className="px-4">เบี้ยงวดถัดไป / งวดสุดท้าย</th><th className="px-4">สถานะ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">{pv.personId ? `ไม่มีกรมธรรม์ของ ${pv.personName}` : "ยังไม่มีกรมธรรม์"}</td></tr>}
            {rows.map((r, i) => {
              const c = r.cash_value_asset_id ? cv.get(r.cash_value_asset_id) : null;
              return (
                <tr key={r.id} className={r.status !== "ACTIVE" ? "opacity-50" : ""}>
                  <td className="px-4 py-3">
                    {ordering && <span className="mr-2 align-middle"><MoveButtons table="insurance_policies" id={r.id} paths={paths} {...neighbors(rows, i, (x) => x.id)} /></span>}
                    <Link href={`/insurance/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.insurer}{r.policy_no && ` · ${r.policy_no}`}</Link>
                    <div className="text-xs text-slate-500">{TYPE[r.insurance_type] ?? r.insurance_type}{r.end_date && ` · ถึง ${thDate(r.end_date)}`}</div>
                  </td>
                  <td className="px-4">{r.person_id ? pname.get(r.person_id) : "-"}
                    {r.payer_person_id && r.payer_person_id !== r.person_id && <div className="text-xs text-slate-500">ผู้จ่าย {pname.get(r.payer_person_id)}</div>}</td>
                  <td className="px-4 text-right tabular-nums text-xs">
                    {r.insured_amount != null && <div>ทุน {money(r.insured_amount, r.insured_amount_currency ?? undefined, 0)}</div>}
                    {r.premium != null && <div className="text-slate-500">เบี้ย {money(r.premium, undefined, 0)}/ปี</div>}
                  </td>
                  <td className="px-4 text-right tabular-nums">{r.has_cash_value ? (c ? <>
                    {money(c.current_value == null ? null : Number(c.current_value) * pv.assetShare(c.id), c.currency, 0)}
                    {pv.assetPct(c.id) != null && <div className="text-xs text-slate-500">{pv.assetPct(c.id)}% ของ {money(c.current_value, c.currency, 0)}</div>}
                  </> : <span className="text-amber-700">ยังไม่มี</span>) : "-"}</td>
                  <td className="px-4 text-xs">
                    {nextPremium.get(r.id) ? <>{thDate(nextPremium.get(r.id)?.due_date)}<div className="tabular-nums text-slate-500">{money(nextPremium.get(r.id)?.remaining)}</div></> : <span className="text-slate-400">-</span>}
                    {overduePremium.get(r.id) && <div className="text-red-600">เลยกำหนด {overduePremium.get(r.id)} งวด</div>}
                    {lastOf(r.id, "PREMIUM") && <div className="text-slate-500">จ่ายถึงปี {lastOf(r.id, "PREMIUM")?.year} · เหลือ {lastOf(r.id, "PREMIUM")?.left} งวด</div>}
                    {lastOf(r.id, "BENEFIT") && <div className="text-slate-500">รับถึงปี {lastOf(r.id, "BENEFIT")?.year}</div>}
                  </td>
                  <td className="px-4 text-xs">{STATUS[r.status] ?? r.status}
                    {r.derived_status === "EXPIRING_SOON" && <div className="text-amber-700">ใกล้ครบ</div>}
                    {r.derived_status === "EXPIRED" && r.status === "ACTIVE" && <div className="text-red-600">เลยวันสิ้นสุด</div>}</td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 text-xs font-medium">
              <tr>
                <td className="px-4 py-3 text-sm">รวม{tFilter ? "ตามประเภท" : ""} {rows.length} ฉบับ</td><td></td>
                <td className="px-4 text-right tabular-nums">เบี้ย {money(rows.filter((r) => r.status === "ACTIVE" && (r.premium_currency ?? "THB") === "THB").reduce((t, r) => t + Number(r.premium ?? 0), 0), undefined, 0)}/ปี</td>
                <td className="px-4 text-right tabular-nums text-sm">{money(rows.reduce((t, r) => t + cvOf(r), 0), undefined, 0)}</td><td></td><td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      </TabPanel>
    </div>
    </TabsProvider>
  );
}

