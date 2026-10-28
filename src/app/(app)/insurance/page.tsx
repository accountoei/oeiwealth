import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { COVERAGE_ANNUAL, COVERAGE_LABEL, FOLLOWUP_ROLE, FOLLOWUP_STATUS, INS_STATUS, INS_TYPE, addDays, money, thDate, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { StatBox } from "@/components/Boxes";
import YearTable, { OPEN, type YLine } from "./YearTable";
import InsuranceBatch, { type InsLine, type PayOpt } from "./InsuranceBatch";
import { recEdit, recLabel, recLink, type Recorded } from "@/lib/recorded-edit";
import { premiumPaymentFields } from "@/lib/source-edit";
import { TabNav, TabPanel, TabsProvider } from "@/components/ClientTabs";
import { endpointValue } from "@/lib/money-endpoint";
import UndoButton from "@/components/UndoButton";

const TYPE = Object.fromEntries(INS_TYPE);
const STATUS = Object.fromEntries(INS_STATUS);
const TABS = [["overview", "ภาพรวม"], ["benefit", "บันทึกรับผลประโยชน์"], ["premium", "จ่ายชำระเบี้ยประกัน"]] as const;

export default async function InsurancePage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string; t?: string; y?: string; tab?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const paths = ["/insurance"];
  const sortMap = await loadSortMap("insurance_policies");
  const supabase = await createClient();
  const today = todayBangkok();
  const year = today.slice(0, 4);
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  const [pv, { data, error }, { data: persons }, { data: cvs }, { data: covs }, { data: claims }, { data: dues }, { data: fups }, { data: allLines },
    { data: banks }, { data: cards }, { data: family }] = await Promise.all([
    loadPersonView(sp.p),
    supabase.from("v_insurance_status").select("id,insurance_type,person_id,payer_person_id,insurer,policy_no,end_date,insured_amount,insured_amount_currency,premium,premium_currency,has_cash_value,cash_value_asset_id,status,derived_status")
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
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("families").select("go_live_date").maybeSingle(),
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
  type Sum = { limit: number; used: number; currency: string; policies: number };
  const byPerson = new Map<string, Map<string, Sum>>();
  (covs ?? []).forEach((c) => {
    const pid = activePolicy.get(c.policy_id);
    if (!pid || !pv.isPerson(pid)) return;
    const m = byPerson.get(pid) ?? new Map<string, Sum>();
    const cur = m.get(c.coverage_type) ?? { limit: 0, used: 0, currency: c.currency, policies: 0 };
    m.set(c.coverage_type, { ...cur, limit: cur.limit + Number(c.limit_amount), used: cur.used + (usedByCov.get(c.id) ?? 0), policies: cur.policies + 1 });
    byPerson.set(pid, m);
  });
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
  const yr = /^\d{4}$/.test(sp.y ?? "") ? Number(sp.y) : yNow;
  const yearLines = lineList.filter((l) => shown.has(l.policy_id) && l.due_date.startsWith(`${yr}-`));
  const yHref = (y: number) => { const q = new URLSearchParams(); if (sp.p) q.set("p", sp.p); if (tFilter) q.set("t", tFilter); if (y !== yNow) q.set("y", String(y)); const x = q.toString(); return `/insurance${x ? `?${x}` : ""}`; };
  const groupsOf = (kind: string) => rows.map((r) => ({ r, lines: yearLines.filter((l) => l.policy_id === r.id && l.kind === kind) })).filter((g) => g.lines.length > 0);
  const cvOf = (r: (typeof rows)[number]) => { const c = r.cash_value_asset_id ? cv.get(r.cash_value_asset_id) : null;
    return c && c.currency === "THB" && c.current_value != null ? Number(c.current_value) * pv.assetShare(c.id) : 0; };
  // แท็บบันทึกทั้งชุด: งวดที่ยังไม่จ่าย / ยังไม่รับ ของกรมธรรม์ที่มีผล (ตามตัวกรองคน)
  const activeIds = new Set(mineRows.filter((r) => r.status === "ACTIVE").map((r) => r.id));
  // งวดที่จ่าย / รับไปแล้ว (บางส่วน หรือครบภายใน 60 วัน) → ยอดที่บันทึกแล้วกดเพื่อแก้ / ลบ ในตาราง (ตกลง 28 ต.ค. 2026)
  //   เบี้ย = ฟอร์มเดียวกับหน้ากรมธรรม์ · ผลประโยชน์ = ยกเลิกทั้งก้อนแล้วบันทึกใหม่ · งวดที่ครบแล้วยังอยู่ในตาราง ("ครบแล้ว" · ไม่มีช่องกรอก)
  const since = addDays(today, -60);
  const [{ data: recentPays }, { data: recentBens }] = await Promise.all([
    supabase.from("expense_items").select("insurance_schedule_line_id").not("insurance_schedule_line_id", "is", null).gte("date", since).is("deleted_at", null),
    supabase.from("insurance_benefit_receipts").select("line_id").not("line_id", "is", null).gte("receipt_date", since).is("undone_at", null).is("deleted_at", null),
  ]);
  const recentLines = new Set([...(recentPays ?? []).map((e) => e.insurance_schedule_line_id as string), ...(recentBens ?? []).map((b) => b.line_id as string)]);
  const inBatch = (l: YLine) => activeIds.has(l.policy_id) && (OPEN.includes(l.status) || (l.status === "PAID" && recentLines.has(l.id)));
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
  return (
    <TabsProvider initial={tab} defaultKey="overview">
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Insurance</h1>
          <p className="text-sm text-slate-500">กรมธรรม์ทั้งหมด · มูลค่าเวนคืนนับเป็นสินทรัพย์ (หมวดการเงิน)</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <PersonFilter persons={pv.persons} value={pv.personId} />
          {me.role !== "VIEWER" && <Link href="/insurance/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มกรมธรรม์</Link>}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <div className="border-b border-slate-200"><TabNav tabs={TABS} /></div>

      <TabPanel id="benefit">
        <InsuranceBatch key={`b${lineList.length}`} kind="BENEFIT" rows={batchLines("BENEFIT")} pays={bankPays} today={today} soon={addDays(today, 60)} minDate={goLive} canWrite={canWrite} />
      </TabPanel>
      <TabPanel id="premium">
        <InsuranceBatch key={`p${lineList.length}`} kind="PREMIUM" rows={batchLines("PREMIUM")} pays={[...bankPays, ...cardPays]} today={today} soon={addDays(today, 60)} minDate={goLive} canWrite={canWrite} />
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
      {byPerson.size > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          {[...byPerson.entries()].map(([pid, m]) => (
            <div key={pid} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-2 font-medium text-slate-900">สิทธิ์คุ้มครอง · {pname.get(pid)}</div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {Object.keys(COVERAGE_LABEL).filter((k) => m.has(k)).map((k) => {
                    const x = m.get(k) as Sum;
                    const annual = COVERAGE_ANNUAL.includes(k);
                    return (
                      <tr key={k}>
                        <td className="py-1.5">{COVERAGE_LABEL[k][0]}{COVERAGE_LABEL[k][1] && <span className="text-xs text-slate-500"> {COVERAGE_LABEL[k][1]}</span>}
                          {x.policies > 1 && <span className="text-xs text-slate-400"> · {x.policies} กรมธรรม์</span>}</td>
                        <td className="text-right tabular-nums">{money(x.limit, x.currency)}
                          {annual && x.used > 0 && <div className="text-xs text-slate-500">ใช้ปีนี้ {money(x.used)} · เหลือ {money(Math.max(x.limit - x.used, 0))}</div>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
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
      <YearTable kind="PREMIUM" year={yr} groups={groupsOf("PREMIUM")} pname={pname} prevHref={yHref(yr - 1)} nextHref={yHref(yr + 1)} thisHref={yr !== yNow ? yHref(yNow) : undefined} />
      <YearTable kind="BENEFIT" year={yr} groups={groupsOf("BENEFIT")} pname={pname} prevHref={yHref(yr - 1)} nextHref={yHref(yr + 1)} thisHref={yr !== yNow ? yHref(yNow) : undefined} />
      </TabPanel>
    </div>
    </TabsProvider>
  );
}

