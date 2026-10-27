import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { money, monthOptions, monthRange, thDate, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import MonthPicker from "@/components/MonthPicker";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { LOAN_SCHED_STATUS } from "@/lib/loan-schedule";
import { TabNav, TabPanel, TabsProvider } from "../../income-expenses/tabs";
import { PaymentForm } from "./[id]/forms";

const STATUS: Record<string, string> = { ACTIVE: "ปกติ", AT_RISK: "มีความเสี่ยง", CLOSED: "ปิดแล้ว", WRITTEN_OFF: "ตัดหนี้สูญ" };
const DERIVED: Record<string, { text: string; cls: string }> = {
  OVERDUE: { text: "เลยกำหนดคืน", cls: "text-red-600" }, DUE_SOON: { text: "ใกล้ครบกำหนด", cls: "text-amber-700" },
};
const TABS: [string, string][] = [["overview", "ภาพรวม"], ["monthly", "บันทึกรับชำระคืนเงินกู้"]];
const GROUPS: [string, string, string][] = [["ACTIVE", "ปกติ", "#16a34a"], ["AT_RISK", "มีความเสี่ยง", "#f59e0b"], ["WRITTEN_OFF", "ตัดหนี้สูญ", "#64748b"]];
const BADGE = { red: "bg-red-50 text-red-700", amber: "bg-amber-50 text-amber-800" };

type Line = { id: string; loan_asset_id: string; installment_no: number; due_date: string; principal_due: number; interest_due: number; total_due: number;
  principal_remaining: number; interest_remaining: number; total_remaining: number; status: string };
type Sp = Promise<{ p?: string; order?: string; tab?: string; m?: string; follow?: string }>;

export default async function LoansPage({ searchParams }: { searchParams: Sp }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const pv = await loadPersonView(sp.p);
  const today = todayBangkok();
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? (sp.m as string) : today.slice(0, 7);
  const { start, end } = monthRange(ym);
  const canWrite = me.role !== "VIEWER";
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const paths = ["/financial/loans"];
  const [{ data, error }, { data: extras }, { data: schedRaw }, { data: fx }, { data: pMoves }, { data: iRows }, { data: banks }, { data: family }, sortMap] = await Promise.all([
    supabase.from("v_loans_status")
      .select("asset_id,name,currency,borrower_name,principal,outstanding_principal,interest_rate,due_date,status,derived_status")
      .order("status").order("name"),
    supabase.from("loan_details").select("asset_id,borrower_phone").is("deleted_at", null),
    supabase.from("v_loan_schedule_status")
      .select("id,loan_asset_id,installment_no,due_date,principal_due,interest_due,total_due,principal_remaining,interest_remaining,total_remaining,status")
      .neq("status", "WRITTEN_OFF").order("due_date").order("installment_no"),
    supabase.from("v_fx_status").select("currency,rate_to_thb"),
    // รับชำระจริง: เงินต้น (เงินเข้าจากเงินให้กู้) + ดอกเบี้ย (รายได้)
    supabase.from("cash_movements").select("from_asset_id,movement_date,amount").eq("movement_type", "LOAN_PRINCIPAL_RECEIPT").is("deleted_at", null),
    supabase.from("income_transactions").select("asset_id,date,amount").eq("income_type", "LOAN_INTEREST").not("asset_id", "is", null).is("deleted_at", null),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    loadSortMap("assets"),
  ]);
  const rate = new Map<string, number>([["THB", 1], ...((fx ?? []).map((r) => [r.currency as string, Number(r.rate_to_thb)] as [string, number]))]);
  const phone = new Map((extras ?? []).map((x) => [x.asset_id as string, x.borrower_phone as string | null]));
  const sched = ((schedRaw as Line[] | null) ?? []).filter((x) => pv.showAsset(x.loan_asset_id));
  const byLoan = new Map<string, Line[]>();
  sched.forEach((x) => byLoan.set(x.loan_asset_id, [...(byLoan.get(x.loan_asset_id) ?? []), x]));
  // งวดถัดไป + งวดที่เลยกำหนด ของแต่ละสัญญา
  const nextDue = new Map<string, { due_date: string; amount: number }>();
  const overdue = new Map<string, { n: number; amount: number; oldest: string }>();
  sched.filter((x) => ["OVERDUE", "PARTIAL", "PENDING"].includes(x.status)).forEach((x) => {
    if (x.status === "OVERDUE") {
      const o = overdue.get(x.loan_asset_id);
      overdue.set(x.loan_asset_id, { n: (o?.n ?? 0) + 1, amount: (o?.amount ?? 0) + Number(x.total_remaining), oldest: o?.oldest ?? x.due_date });
    } else if (!nextDue.has(x.loan_asset_id)) nextDue.set(x.loan_asset_id, { due_date: x.due_date, amount: Number(x.total_remaining) });
  });
  const lastPaid = new Map<string, string>();
  const seen = (id: string | null, d: string) => { if (id && d > (lastPaid.get(id) ?? "")) lastPaid.set(id, d); };
  (pMoves ?? []).forEach((m) => seen(m.from_asset_id, m.movement_date));
  (iRows ?? []).forEach((i) => seen(i.asset_id, i.date));

  const rows = bySort((data ?? []).filter((r) => pv.showAsset(r.asset_id)), (r) => r.asset_id, sortMap);
  type R = (typeof rows)[number];
  const thbOf = (r: R, v: number | null | undefined) => Number(v ?? 0) * (rate.get(r.currency) ?? 0) * pv.assetShare(r.asset_id);
  const open = rows.filter((r) => r.status !== "CLOSED" && r.status !== "WRITTEN_OFF");
  const outTotal = open.reduce((t, r) => t + thbOf(r, r.outstanding_principal), 0);

  // ---------------------------------------------------------------- กล่องซ้าย: เงินต้นคงเหลือตามสถานะ (ตัดหนี้สูญ = 0 ใน Net Worth)
  const groups = GROUPS.map(([k, label, color]) => {
    const list = rows.filter((r) => r.status === k);
    return { k, label, color, n: list.length, v: k === "WRITTEN_OFF" ? 0 : list.reduce((t, r) => t + thbOf(r, r.outstanding_principal), 0) };
  });
  const gTotal = groups.reduce((t, g) => t + g.v, 0);
  const gCount = groups.reduce((t, g) => t + g.n, 0);

  // ---------------------------------------------------------------- กล่องขวา: รายการที่ต้องติดตาม
  const days = (d: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);
  const follow = open.map((r) => {
    const o = overdue.get(r.asset_id);
    const issues: { text: string; tone: "red" | "amber" }[] = [];
    if (o) issues.push({ text: `เกินกำหนด ${days(o.oldest)} วัน`, tone: "red" });
    else if (r.derived_status === "OVERDUE" && Number(r.outstanding_principal ?? 0) > 0) issues.push({ text: "เลยวันครบกำหนดสัญญา", tone: "red" });
    if (r.status === "AT_RISK") issues.push({ text: "มีความเสี่ยงไม่ได้รับคืน", tone: "amber" });
    return { r, issues, amount: o ? o.amount : Number(r.outstanding_principal ?? 0), sev: o ? days(o.oldest) + 10000 : r.status === "AT_RISK" ? 1 : 5000 };
  }).filter((x) => x.issues.length > 0).sort((a, b) => b.sev - a.sev);
  const showAllFollow = sp.follow === "all";
  const followShown = showAllFollow ? follow : follow.slice(0, 5);
  const keep = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ p: sp.p, ...o }).filter(([, v]) => v) as [string, string][]);
    return `/financial/loans${q.size ? `?${q}` : ""}`;
  };

  // ---------------------------------------------------------------- แท็บบันทึกรับชำระคืนเงินกู้
  const loanOf = new Map(rows.map((r) => [r.asset_id, r]));
  const monthLines = sched.filter((x) => loanOf.has(x.loan_asset_id)
    && ((x.due_date >= start && x.due_date <= end) || (x.due_date < start && ["OVERDUE", "PARTIAL"].includes(x.status))));
  const lr = (x: Line) => loanOf.get(x.loan_asset_id)!;
  const dueMonth = monthLines.filter((x) => x.due_date >= start).reduce((t, x) => t + thbOf(lr(x), x.total_due), 0);
  const recvMonth = [...(pMoves ?? []).map((m) => ({ id: m.from_asset_id as string, d: m.movement_date as string, v: Number(m.amount) })),
    ...(iRows ?? []).map((i) => ({ id: i.asset_id as string, d: i.date as string, v: Number(i.amount) }))]
    .filter((x) => loanOf.has(x.id) && x.d >= start && x.d <= end).reduce((t, x) => t + thbOf(loanOf.get(x.id)!, x.v), 0);
  const overdueAll = sched.filter((x) => x.status === "OVERDUE" && loanOf.has(x.loan_asset_id));
  const overdueThb = overdueAll.reduce((t, x) => t + thbOf(lr(x), x.total_remaining), 0);
  // บันทึกรับ: เฉพาะงวดเก่าสุดที่ยังค้างของแต่ละสัญญา (เงินที่รับตัดงวดเก่าก่อน)
  const firstOpen = new Map<string, string>();
  sched.filter((x) => x.status !== "PAID").forEach((x) => { if (!firstOpen.has(x.loan_asset_id)) firstOpen.set(x.loan_asset_id, x.id); });
  const upTo = (loan: string, d: string, k: "interest_remaining" | "principal_remaining") =>
    (byLoan.get(loan) ?? []).filter((y) => y.due_date <= d).reduce((t, y) => t + Number(y[k]), 0);
  const months = monthOptions(family?.go_live_date, today, 3, ym);
  const goLive = family?.go_live_date ?? "";

  return (
    <TabsProvider initial={tab}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Loans Receivable</h1>
          <p className="text-sm text-slate-500">เงินที่ให้คนอื่นยืม · มูลค่า = เงินต้นคงเหลือ (ลดลงเมื่อบันทึกรับชำระ)</p>
        </div>
        <div className="flex items-start gap-2">
          <PersonFilter persons={pv.persons} value={pv.personId} />
          {me.role !== "VIEWER" && <Link href="/financial/loans/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มเงินให้กู้</Link>}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <TabNav tabs={TABS} />

      {/* ============================================================ ภาพรวม */}
      <TabPanel id="overview">
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-medium text-slate-900">สรุปเงินต้นคงเหลือตามสถานะ <span className="text-xs font-normal text-slate-500">(THB)</span></h2>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-3 py-2">สถานะ</th><th className="px-3 text-right">จำนวนสัญญา</th><th className="px-3 text-right">เงินต้นคงเหลือ</th><th className="px-3 text-right">สัดส่วน</th><th className="w-1/4 px-3"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.map((g) => {
                const pct = gTotal > 0 ? (g.v / gTotal) * 100 : 0;
                return (
                  <tr key={g.k}>
                    <td className="px-3 py-2.5"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: g.color }} />{g.label}</td>
                    <td className="px-3 text-right tabular-nums">{g.n}</td>
                    <td className="px-3 text-right tabular-nums">{money(g.v, undefined, 0)}</td>
                    <td className="px-3 text-right tabular-nums">{pct.toFixed(1)}%</td>
                    <td className="px-3"><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: g.color }} /></div></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-blue-50/40 font-medium">
              <tr><td className="px-3 py-2.5">รวมใน Net Worth</td><td className="px-3 text-right tabular-nums">{gCount}</td>
                <td className="px-3 text-right tabular-nums">{money(gTotal, undefined, 0)}</td><td className="px-3 text-right tabular-nums">100%</td>
                <td className="px-3"><div className="h-2.5 rounded-full bg-blue-600" /></td></tr>
            </tfoot>
          </table>
          <p className="mt-2 text-xs text-slate-500">ไม่รวมสัญญาที่ปิดแล้ว (รับคืนครบ) · ตัดหนี้สูญมีมูลค่า 0 ใน Net Worth</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-medium text-slate-900">รายการที่ต้องติดตาม</h2>
            {follow.length > 5 && (showAllFollow
              ? <Link href={keep({})} scroll={false} className="text-sm text-blue-700 hover:underline">แสดง 5 รายการแรก</Link>
              : <Link href={keep({ follow: "all" })} scroll={false} className="text-sm text-blue-700 hover:underline">ดูทั้งหมด ({follow.length}) →</Link>)}
          </div>
          {follow.length === 0 ? <p className="rounded-lg bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-700">✓ ไม่มีรายการที่ต้องติดตาม</p> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-3 py-2">ผู้กู้</th><th className="px-3">ประเด็น</th><th className="px-3 text-right">ยอดค้าง</th><th className="px-3">ล่าสุด</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {followShown.map(({ r, issues, amount }) => (
                  <tr key={r.asset_id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5"><Link href={`/financial/loans/${r.asset_id}`} className="hover:underline">{r.borrower_name}</Link>
                      <div className="text-xs text-slate-500">{r.name}</div></td>
                    <td className="px-3"><div className="flex flex-wrap gap-1">{issues.map((i) => (
                      <span key={i.text} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${BADGE[i.tone]}`}>{i.text}</span>))}</div></td>
                    <td className="px-3 text-right tabular-nums">{money(amount * pv.assetShare(r.asset_id), r.currency === "THB" ? undefined : r.currency, 0)}</td>
                    <td className="whitespace-nowrap px-3 text-slate-600" title="วันที่รับชำระครั้งล่าสุด">{lastPaid.get(r.asset_id) ? thDate(lastPaid.get(r.asset_id)) : "-"}</td>
                    <td className="pr-2 text-right"><Link href={`/financial/loans/${r.asset_id}`} className="text-slate-400 hover:text-blue-700" aria-label="ไปหน้าสัญญา">›</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-slate-500">ยอดค้าง = งวดที่เลยกำหนด (หรือเงินต้นคงเหลือ ถ้าไม่มีงวดค้าง) · ล่าสุด = วันที่รับชำระครั้งล่าสุด</p>
        </div>
      </section>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
          <h2 className="font-medium text-slate-900">เงินให้กู้ทั้งหมด</h2>
          {canOrder && rows.length > 1 && <SortToggle active={ordering} {...orderHrefs("/financial/loans", { p: sp.p })} />}
        </div>
        <table className="mt-2 w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">รายการ</th><th className="px-4">สถานะ</th><th className="px-4">งวดถัดไป</th><th className="px-4">ครบกำหนดสัญญา</th><th className="px-4 text-right">เงินต้นคงเหลือ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">{pv.personId ? `ไม่มีเงินให้กู้ของ ${pv.personName}` : "ยังไม่มีเงินให้กู้"}</td></tr>}
            {rows.map((r, i) => (
              <tr key={r.asset_id} className={r.status === "CLOSED" || r.status === "WRITTEN_OFF" ? "opacity-50" : ""}>
                <td className="px-4 py-3">
                  {ordering && <span className="mr-2 align-middle"><MoveButtons table="assets" id={r.asset_id} paths={paths} {...neighbors(rows, i, (x) => x.asset_id)} /></span>}
                  <Link href={`/financial/loans/${r.asset_id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                  <div className="text-xs text-slate-500">ผู้กู้ {r.borrower_name}{phone.get(r.asset_id) && ` · โทร ${phone.get(r.asset_id)}`}</div>
                  <div className="text-xs text-slate-400">เงินต้น {money(r.principal, r.currency)}{r.interest_rate != null && ` · ดอกเบี้ย ${Number(r.interest_rate)}%`}</div>
                </td>
                <td className="px-4 text-xs">{STATUS[r.status] ?? r.status}
                  {r.derived_status && <div className={DERIVED[r.derived_status]?.cls}>{DERIVED[r.derived_status]?.text}</div>}</td>
                <td className="px-4">
                  {nextDue.get(r.asset_id) ? <>{thDate(nextDue.get(r.asset_id)?.due_date)}
                    <div className="text-xs tabular-nums text-slate-500">{money(nextDue.get(r.asset_id)?.amount, r.currency)}</div></> : <span className="text-slate-400">-</span>}
                  {overdue.get(r.asset_id) && <div className="text-xs text-red-600">เลยกำหนด {overdue.get(r.asset_id)?.n} งวด · {money(overdue.get(r.asset_id)?.amount)}</div>}
                </td>
                <td className="px-4">{thDate(r.due_date)}</td>
                <td className="px-4 text-right tabular-nums">
                  {money(r.outstanding_principal == null ? null : Number(r.outstanding_principal) * pv.assetShare(r.asset_id), r.currency)}
                  {pv.assetPct(r.asset_id) != null && <div className="text-xs text-slate-400">{pv.assetPct(r.asset_id)}% ของ {money(r.outstanding_principal, r.currency)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <tr><td className="px-4 py-3">รวม {open.length} สัญญาที่ยังไม่ปิด</td><td></td><td></td><td></td><td className="px-4 text-right tabular-nums">{money(outTotal, "THB")}</td></tr>
            </tfoot>
          )}
        </table>
      </div>
      </TabPanel>

      {/* ============================================================ บันทึกรับชำระคืนเงินกู้ */}
      <TabPanel id="monthly">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">งวดที่ครบกำหนดในเดือนที่เลือก + งวดที่ยังค้างจากเดือนก่อน · บันทึกที่นี่หรือที่หน้า Income &amp; Expenses ก็ได้ (คำสั่งเดียวกัน ไม่นับซ้ำ)</p>
          <MonthPicker months={months} value={ym} />
        </div>
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">ต้องรับเดือนนี้ (เงินต้น + ดอกเบี้ย)</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{money(dueMonth, "THB")}</div>
            <div className="mt-1 text-xs text-slate-500">{monthLines.filter((x) => x.due_date >= start).length} งวด</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">รับแล้วในเดือนนี้</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">{money(recvMonth, "THB")}</div>
            <div className="mt-1 text-xs text-slate-500">ตามวันที่รับจริง</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">ค้างรับ (เลยกำหนด ณ วันนี้)</div>
            <div className={`mt-1 text-xl font-semibold tabular-nums ${overdueThb > 0.005 ? "text-red-700" : ""}`}>{money(overdueThb, "THB")}</div>
            <div className="mt-1 text-xs text-slate-500">{overdueAll.length} งวด</div>
          </div>
        </section>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">สัญญา / ผู้กู้</th><th className="px-3">งวด</th><th className="px-3">ครบกำหนด</th><th className="px-3 text-right">เงินต้น</th>
                <th className="px-3 text-right">ดอกเบี้ย</th><th className="px-3 text-right">รวม</th><th className="px-3">สถานะ</th><th className="px-3"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {monthLines.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">ไม่มีงวดที่ต้องรับในเดือนนี้</td></tr>}
              {monthLines.map((x) => {
                const r = lr(x);
                const st = LOAN_SCHED_STATUS[x.status];
                const loanOpen = r.status !== "CLOSED" && r.status !== "WRITTEN_OFF";
                return (
                  <tr key={x.id} className={`align-top ${x.status === "PAID" ? "text-slate-500" : ""}`}>
                    <td className="px-4 py-2.5"><Link href={`/financial/loans/${r.asset_id}`} className="font-medium hover:underline">{r.name}</Link>
                      <div className="text-xs text-slate-500">{r.borrower_name}{phone.get(r.asset_id) && ` · โทร ${phone.get(r.asset_id)}`}</div></td>
                    <td className="px-3 py-2.5">{x.installment_no}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{thDate(x.due_date)}{x.due_date < start && <div className="text-xs text-red-600">ค้างจากเดือนก่อน</div>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(x.principal_due)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(x.interest_due)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(x.total_due, r.currency)}</td>
                    <td className="px-3 py-2.5"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${st?.cls ?? ""}`}>{st?.text ?? x.status}</span>
                      {x.status !== "PAID" && Number(x.total_remaining) < Number(x.total_due) - 0.005 && <div className="text-xs text-slate-500">ค้าง {money(x.total_remaining)}</div>}</td>
                    <td className="px-3 py-2.5 text-right">
                      {canWrite && loanOpen && firstOpen.get(x.loan_asset_id) === x.id && (
                        <PaymentForm assetId={r.asset_id} currency={r.currency} banks={banks ?? []} today={today} minDate={goLive} small button="บันทึกรับ"
                          title={`รับชำระ ${r.name} งวดที่ ${x.installment_no} · เงินที่รับตัดงวดที่ค้างเรียงจากงวดเก่าก่อน`}
                          principal={Number(x.principal_remaining)} interest={Number(x.interest_remaining)}
                          interestOwed={upTo(x.loan_asset_id, x.due_date, "interest_remaining")} principalDue={upTo(x.loan_asset_id, x.due_date, "principal_remaining")} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">ปุ่ม &ldquo;บันทึกรับ&rdquo; อยู่ที่งวดเก่าสุดที่ยังค้างของแต่ละสัญญา · เงินต้นลดยอดเงินให้กู้ · ดอกเบี้ยเป็นรายได้ (เห็นในหน้า Income &amp; Expenses ด้วย) · ยอดในกล่องเป็นบาท{pv.personId ? " ตามสัดส่วนของสมาชิกที่เลือก" : ""}</p>
      </TabPanel>
    </div>
    </TabsProvider>
  );
}
