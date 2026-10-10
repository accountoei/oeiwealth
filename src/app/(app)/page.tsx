import Link from "next/link";
import { Suspense, cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { money, monthRange, thDate, thMonth, todayBangkok, blueAt } from "@/lib/format";
import DashboardFilters from "@/components/DashboardFilters";

type Preview = {
  as_of: string; financial: number; investment: number; property: number; alternative: number;
  total_assets: number; total_liabilities: number; net_worth: number; unallocated: number;
  prev_net_worth: number | null; prev_label: string | null; prev_date: string | null;
  income: number; investment_income: number; expenses: number; reimbursements: number; other_change: number | null;
  by_person: { person_id: string | null; name: string; assets: number; liabilities: number; net_worth: number }[];
};
type DM = {
  month: string; source: string; as_of: string; financial: number; investment: number; property: number; alternative: number;
  total_assets: number; total_liabilities: number; net_worth: number;
  by_person: { person_id: string | null; name: string; assets: number; liabilities: number; net_worth: number }[];
  base: { label: string; date: string; total_assets: number; total_liabilities: number; net_worth: number } | null;
};
type Hist = {
  opening: { date: string; total_assets: number; total_liabilities: number; net_worth: number };
  snapshots: { month: string; date: string; status: string; total_assets: number; total_liabilities: number; net_worth: number }[];
};
type Item = { item_type: string; item_name: string; item_group: string; base_value: number | null; ownership_percent: number | null };
type Family = { name: string; go_live_date: string; system_status: string };

const GROUP: [string, string][] = [["financial", "การเงิน (เงินฝาก เงินให้กู้ ประกัน)"], ["investment", "การลงทุน"], ["property", "อสังหาริมทรัพย์"], ["alternative", "สินทรัพย์อื่น"]];
const GROUP_KEY: Record<string, string> = { FINANCIAL: "การเงิน", INVESTMENT: "การลงทุน", PROPERTY: "อสังหาฯ", ALTERNATIVE: "สินทรัพย์อื่น" };
const FIELD: Record<string, string> = {
  document: "เอกสาร", ownership: "เจ้าของครบ 100%", valuation: "มูลค่า", acquisition_date: "วันที่ได้มา",
  acquisition_cost: "ราคาที่ได้มา", account_no: "เลขบัญชี", title_deed_no: "เลขโฉนด", land_area_sq_wa: "เนื้อที่",
};

// ---------------------------------------------------------------------------
// โหลดข้อมูลส่วนที่ช้า (คำนวณ Net Worth) ผ่าน cache() → เริ่มยิงตั้งแต่ต้นหน้า แล้วการ์ดหลายใบใช้ผลเดียวกันได้
// โดยไม่เรียกซ้ำ · แต่ละการ์ดอยู่ใน <Suspense> ของตัวเอง → ส่วนที่เสร็จก่อนขึ้นก่อน ไม่ต้องรอทั้งหน้า
// ---------------------------------------------------------------------------
const getMonth = cache(async (start: string) =>
  ((await (await createClient()).rpc("dashboard_month", { p_month: start })).data ?? null) as DM | null);
const getPreview = cache(async (start: string) =>
  ((await (await createClient()).rpc("month_net_worth_preview", { p_month: start })).data ?? null) as Preview | null);
const getHistory = cache(async () =>
  ((await (await createClient()).rpc("net_worth_history")).data ?? null) as Hist | null);
const getItems = cache(async (start: string, person: string) =>
  ((await (await createClient()).rpc("month_person_items", { p_month: start, p_person: person })).data ?? null) as Item[] | null);
const getTrack = cache(async (start: string) => {
  const { data } = await (await createClient()).from("monthly_expenses").select("tracking_status")
    .eq("year_month", start).is("deleted_at", null).maybeSingle();
  return (data?.tracking_status ?? "NOT_TRACKED") as string;
});

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ p?: string; m?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const today = todayBangkok();
  const curYm = today.slice(0, 7);

  const [{ data: familyRaw }, { data: personsRaw }] = await Promise.all([
    supabase.from("families").select("name,go_live_date,system_status").maybeSingle(),
    supabase.from("persons").select("id,name").is("deleted_at", null).order("created_at"),
  ]);
  const family = familyRaw as Family | null;
  const isSetup = family?.system_status === "SETUP";
  const goYm = (family?.go_live_date ?? today).slice(0, 7);
  // เดือนที่เลือกได้: เดือน Go-live → เดือนปัจจุบัน (ใหม่สุดก่อน)
  const months: { value: string; label: string }[] = [];
  for (let m = curYm; months.length < 120; m = monthRange(m).prev) {
    months.push({ value: m, label: thMonth(`${m}-01`) + (m === curYm ? " (เดือนนี้)" : "") });
    if (m <= goYm) break;
  }
  const ym = months.some((x) => x.value === sp.m) ? (sp.m as string) : curYm;
  const isCurrent = ym === curYm;
  const { start } = monthRange(ym);
  const persons = (personsRaw ?? []) as { id: string; name: string }[];
  const personId = persons.some((x) => x.id === sp.p) ? (sp.p as string) : "";
  const personName = persons.find((x) => x.id === personId)?.name ?? "";

  // เริ่มคำนวณส่วนที่ช้าทันที (ไม่รอ) — การ์ดด้านล่างจะรับผลจากคำขอเดียวกันนี้
  void getMonth(start); void getPreview(start); void getHistory(); void getTrack(start);
  if (personId) void getItems(start, personId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{family?.name ?? "Dashboard"}</h1>
          <p className="text-sm text-slate-500">
            <Suspense fallback={<>ณ {thDate(today)}</>}><AsOf start={start} isCurrent={isCurrent} today={today} /></Suspense>
            {" · "}{isSetup ? "ช่วงตั้งค่า (SETUP)" : `Go-live ${thDate(family?.go_live_date)}`}
          </p>
        </div>
        <DashboardFilters persons={persons.map((x) => ({ id: x.id, name: x.name }))} months={months}
          person={personId} month={ym} />
      </div>

      {/* ------------------------------------------------ การ์ดหลัก */}
      <Suspense fallback={<section className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <CardSkeleton key={i} />)}</section>}>
        <TopCards start={start} personId={personId} personName={personName} />
      </Suspense>

      <section className="grid gap-4 lg:grid-cols-3">
        {/* ------------------------------------------------ กราฟ */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <h2 className="font-medium text-slate-900">Net Worth ครอบครัว</h2>
          <p className="mb-3 text-xs text-slate-500">● ทึบ = ยอดตั้งต้น / ปิดเดือนแล้ว · ○ กลวง = ยังไม่ปิด (ประมาณการ)</p>
          <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-slate-100" />}>
            <ChartBody start={start} isCurrent={isCurrent} />
          </Suspense>
        </div>

        {/* ------------------------------------------------ Attention */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 font-medium text-slate-900">สิ่งที่ต้องทำ <span className="text-xs font-normal text-slate-500">(ณ วันนี้)</span></h2>
          <Suspense fallback={<Lines n={4} />}>
            <AttentionBody family={family} isSetup={isSetup} today={today} />
          </Suspense>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {/* ------------------------------------------------ สัดส่วนสินทรัพย์ */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-medium text-slate-900">สัดส่วนสินทรัพย์</h2>
          <Suspense fallback={<Lines n={4} />}>
            <AllocationBody start={start} personId={personId} />
          </Suspense>
        </div>

        {/* ------------------------------------------------ เปลี่ยนเพราะอะไร */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 font-medium text-slate-900">{thMonth(start)} ความมั่งคั่งเปลี่ยนเพราะอะไร</h2>
          <Suspense fallback={<Lines n={6} />}>
            <ChangeBody start={start} isCurrent={isCurrent} />
          </Suspense>
        </div>

        {/* ------------------------------------------------ รายได้ / ค่าใช้จ่าย */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 font-medium text-slate-900">รายได้ &amp; ค่าใช้จ่าย {thMonth(start)}</h2>
          <Suspense fallback={<Lines n={3} />}>
            <IncomeBody start={start} />
          </Suspense>
          <Link href={`/income-expenses?m=${ym}`} className="mt-3 inline-block text-xs text-slate-700 underline">ดูรายละเอียด</Link>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------------------------ รายบุคคล */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 font-medium text-slate-900">รายบุคคล</h2>
          <Suspense fallback={<Lines n={4} />}>
            <PersonsBody start={start} ym={ym} />
          </Suspense>
        </div>

        {/* ------------------------------------------------ Data Completeness */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <Suspense fallback={<>
            <h2 className="mb-2 font-medium text-slate-900">ความครบถ้วนของข้อมูล <span className="text-xs font-normal text-slate-500">(ณ วันนี้)</span></h2>
            <Lines n={5} />
          </>}>
            <CompletenessBody />
          </Suspense>
        </div>
      </section>
      {me.role === "VIEWER" && <p className="text-xs text-slate-400">สิทธิ์ผู้ดู: ดูข้อมูลได้อย่างเดียว</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------- โครงเทาระหว่างรอ
function CardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 animate-pulse">
      <div className="h-3 w-28 rounded bg-slate-100" />
      <div className="mt-2 h-7 w-40 rounded bg-slate-200" />
      <div className="mt-2 h-3 w-24 rounded bg-slate-100" />
    </div>
  );
}
function Lines({ n }: { n: number }) {
  return (
    <div className="space-y-2.5 animate-pulse" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex justify-between gap-3">
          <div className="h-4 rounded bg-slate-100" style={{ width: `${55 - (i % 3) * 10}%` }} />
          <div className="h-4 w-16 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------- ส่วนที่โหลดแยก
async function AsOf({ start, isCurrent, today }: { start: string; isCurrent: boolean; today: string }) {
  const dm = await getMonth(start);
  return (
    <>
      ณ {thDate(dm?.as_of ?? today)} · {dm?.source === "SNAPSHOT" ? "ยอดปิดเดือนแล้ว (Snapshot)"
        : isCurrent ? "ยอดคำนวณระหว่างเดือน" : "เดือนนี้ยังไม่ปิด · ยอดคำนวณ ณ สิ้นเดือน"}
    </>
  );
}

async function TopCards({ start, personId, personName }: { start: string; personId: string; personName: string }) {
  const dm = await getMonth(start);
  const base = dm?.base ?? null;
  const byPerson = dm?.by_person ?? [];
  const person = personId ? byPerson.find((x) => x.person_id === personId) ?? { person_id: personId,
    name: personName, assets: 0, liabilities: 0, net_worth: 0 } : null;
  const nw = person ? person.net_worth : dm?.net_worth ?? 0;
  const assets = person ? person.assets : dm?.total_assets ?? 0;
  const liab = person ? person.liabilities : dm?.total_liabilities ?? 0;
  const unalloc = byPerson.find((x) => !x.person_id);
  return (
    <>
      <section className="grid gap-4 md:grid-cols-3">
        <Big label={person ? `ความมั่งคั่งสุทธิ · ${person.name}` : "ความมั่งคั่งสุทธิ (Net Worth)"} value={nw}
          base={!person && base ? Number(base.net_worth) : null} baseLabel={base?.label} />
        <Big label="สินทรัพย์รวม" value={assets} base={!person && base ? Number(base.total_assets) : null} baseLabel={base?.label} />
        <Big label="หนี้สินรวม" value={liab} base={!person && base ? Number(base.total_liabilities) : null} baseLabel={base?.label} inverse />
      </section>
      {!person && unalloc && Number(unalloc.net_worth) !== 0 && (
        <p className="text-xs text-amber-700">มีมูลค่าที่ยังไม่ระบุเจ้าของ {money(unalloc.net_worth, "THB", 0)} (รวมในยอดครอบครัว แต่ไม่อยู่ในยอดรายบุคคล)</p>
      )}
    </>
  );
}

async function ChartBody({ start, isCurrent }: { start: string; isCurrent: boolean }) {
  const [dm, h] = await Promise.all([getMonth(start), getHistory()]);
  // จุดบนกราฟ: ยอดตั้งต้น + Snapshot (ทึบ) + ยอดวันนี้ (กลวง)
  const points = [
    ...(h ? [{ label: "ตั้งต้น", date: h.opening.date, v: Number(h.opening.net_worth), solid: true }] : []),
    ...(h?.snapshots ?? []).map((s) => ({ label: thMonth(s.month), date: s.date, v: Number(s.net_worth), solid: s.status === "FINAL" })),
    ...(isCurrent && dm ? [{ label: "วันนี้", date: dm.as_of, v: Number(dm.net_worth), solid: false }] : []),
  ];
  return <TrendChart points={points} selected={points.findIndex((pt) => pt.date === dm?.as_of)} />;
}

async function AttentionBody({ family, isSetup, today }: { family: Family | null; isSetup: boolean; today: string }) {
  const supabase = await createClient();
  const [h, { data: readiness }, { data: fx }, { data: expected }, { data: liabs }, { data: holds }, { data: leases }, { data: insOverdue }, { data: fups }] = await Promise.all([
    getHistory(),
    isSetup ? supabase.from("v_go_live_readiness").select("status") : Promise.resolve({ data: null }),
    supabase.from("v_fx_status").select("currency,latest_rate_date,is_stale"),
    supabase.from("v_expected_income").select("name,income_period,status").eq("status", "OVERDUE"),
    supabase.from("v_liabilities_all").select("name,liability_source,derived_status").not("derived_status", "is", null),
    supabase.from("v_holdings_active").select("name,portfolio_asset_id,status,derived_status,valued_at_cost,maturity_date").eq("status", "ACTIVE"),
    supabase.from("v_lease_status").select("tenant_name,unit_label,end_date,property_asset_id,lease_status").eq("lease_status", "EXPIRING_SOON"),
    supabase.from("v_insurance_schedule_status").select("policy_id,kind").eq("status", "OVERDUE"),
    supabase.from("insurance_followups").select("id").is("deleted_at", null).in("status", ["OPEN", "IN_PROGRESS"]),
  ]);
  const finals = (h?.snapshots ?? []).filter((s) => s.status === "FINAL");

  // งานที่ต้องทำ (Attention) — ปิดเดือนอยู่บนสุด
  const attention: { text: string; href: string; tone: "red" | "amber" | "slate" }[] = [];
  if (isSetup) {
    const missing = (readiness ?? []).filter((r: { status: string }) => r.status === "MISSING").length;
    attention.push({ text: `ระบบยังอยู่ช่วงตั้งค่า · ยังขาดยอดตั้งต้น ${missing} รายการ ก่อน Confirm Go-live`, href: "/settings/opening", tone: "amber" });
  } else if (family) {
    const lastFinal = finals.length ? finals[finals.length - 1].month.slice(0, 7) : null;
    const toClose = lastFinal ? monthRange(lastFinal).next : family.go_live_date.slice(0, 7);
    if (monthRange(toClose).end < today) attention.push({ text: `ปิดเดือน ${thMonth(`${toClose}-01`)}`, href: `/month-closing?m=${toClose}`, tone: "red" });
  }
  (fx ?? []).filter((f) => f.is_stale).forEach((f) => attention.push({ text: `อัตราแลกเปลี่ยน ${f.currency} ไม่อัปเดต (ล่าสุด ${thDate(f.latest_rate_date)})`, href: "/settings/system", tone: "red" }));
  if ((fups ?? []).length) attention.push({ text: `ติดตามกรมธรรม์หลังเสียชีวิต ${(fups ?? []).length} รายการ`, href: "/insurance", tone: "red" });
  const premOver = (insOverdue ?? []).filter((x) => x.kind === "PREMIUM").length;
  if (premOver) attention.push({ text: `เบี้ยประกันเลยกำหนด ${premOver} งวด`, href: "/income-expenses?tab=expense", tone: "red" });
  if ((expected ?? []).length) attention.push({ text: `รายได้เลยกำหนดยังไม่ได้รับ ${(expected ?? []).length} รายการ`, href: "/income-expenses?tab=income", tone: "amber" });
  (liabs ?? []).forEach((l) => {
    if (l.derived_status === "PAID_AFTER_BALANCE_DATE") attention.push({ text: `${l.name}: จ่ายบัตรแล้ว ยังไม่อัปเดตยอด`, href: "/family/cards", tone: "amber" });
    if (l.derived_status === "DEPOSIT_REFUND_OVERDUE") attention.push({ text: `${l.name}: เงินประกันเลยกำหนดคืน`, href: "/property", tone: "red" });
  });
  const atCost = (holds ?? []).filter((x) => x.valued_at_cost);
  if (atCost.length) attention.push({ text: `หลักทรัพย์ใช้ราคาทุน รอ Statement ${atCost.length} ตัว`, href: "/investments", tone: "slate" });
  (holds ?? []).filter((x) => x.derived_status === "MATURITY_SOON").forEach((x) =>
    attention.push({ text: `${x.name} ครบกำหนด ${thDate(x.maturity_date)}`, href: `/investments/${x.portfolio_asset_id}`, tone: "slate" }));
  (leases ?? []).forEach((l) => attention.push({ text: `สัญญาเช่า ${[l.unit_label, l.tenant_name].filter(Boolean).join(" · ")} หมด ${thDate(l.end_date)}`, href: `/property/${l.property_asset_id}`, tone: "slate" }));

  if (attention.length === 0) return <p className="text-sm text-emerald-700">ไม่มีงานค้าง ✓</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {attention.slice(0, 10).map((a, i) => (
        <li key={i} className="flex gap-2">
          <span className={a.tone === "red" ? "text-red-600" : a.tone === "amber" ? "text-amber-600" : "text-slate-400"}>●</span>
          <Link href={a.href} className="hover:underline">{a.text}</Link>
        </li>
      ))}
      {attention.length > 10 && <li className="text-xs text-slate-500">และอีก {attention.length - 10} รายการ</li>}
    </ul>
  );
}

async function AllocationBody({ start, personId }: { start: string; personId: string }) {
  if (personId) return <PersonItems items={(await getItems(start, personId)) ?? []} />;
  const dm = await getMonth(start);
  return (
    <ul className="space-y-2.5 text-sm">
      {GROUP.map(([k, label], gi) => {
        const v = Number((dm as unknown as Record<string, number> | null)?.[k] ?? 0);
        const pct = dm?.total_assets ? (v / Number(dm.total_assets)) * 100 : 0;
        return (
          <li key={k}>
            <div className="flex justify-between gap-2">
              <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: blueAt(gi) }} />{label}</span>
              <span className="tabular-nums font-medium text-slate-700">{pct.toFixed(1)}%</span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-blue-50" title={money(v, "THB", 0)}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${blueAt(gi)}, ${blueAt(gi + 1)})` }} />
            </div>
            <div className="mt-0.5 text-xs tabular-nums text-slate-500">{money(v, "THB", 0)}</div>
          </li>
        );
      })}
    </ul>
  );
}

async function ChangeBody({ start, isCurrent }: { start: string; isCurrent: boolean }) {
  const [dm, p] = await Promise.all([getMonth(start), getPreview(start)]);
  if (p?.prev_net_worth == null) return <p className="text-sm text-slate-500">ยังไม่มียอดงวดก่อนให้เทียบ</p>;
  const otherChange = dm
    ? Number(dm.net_worth) - Number(p.prev_net_worth) - Number(p.income) - Number(p.investment_income) + (Number(p.expenses) - Number(p.reimbursements))
    : null;
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-slate-100">
        <BRow label={p.prev_label ?? "ยอดงวดก่อน"} v={p.prev_net_worth} bold />
        <BRow label="+ รายได้ (หลังภาษี)" v={p.income} />
        <BRow label="− ค่าใช้จ่ายสุทธิ" v={-(p.expenses - p.reimbursements)} />
        <BRow label="+ รายได้ลงทุน" v={p.investment_income} />
        <BRow label="± มูลค่าเปลี่ยน / อื่น ๆ" v={otherChange ?? 0} />
        <BRow label={isCurrent ? "= ณ วันนี้" : "= ณ สิ้นเดือน"} v={dm?.net_worth ?? 0} bold />
      </tbody>
    </table>
  );
}

async function IncomeBody({ start }: { start: string }) {
  const [p, track] = await Promise.all([getPreview(start), getTrack(start)]);
  return (
    <dl className="space-y-1.5 text-sm">
      <div className="flex justify-between"><dt>รายได้ (หลังภาษี)</dt><dd className="tabular-nums">{money(Number(p?.income ?? 0) + Number(p?.investment_income ?? 0), undefined, 0)}</dd></div>
      <div className="flex justify-between text-xs text-slate-500"><dt>รวมรายได้ลงทุน</dt><dd className="tabular-nums">{money(p?.investment_income ?? 0, undefined, 0)}</dd></div>
      <div className="flex justify-between"><dt>ค่าใช้จ่ายสุทธิ</dt>
        <dd className="tabular-nums">{track === "NOT_TRACKED" ? <span className="text-slate-500">ไม่ได้บันทึก</span> : money(Number(p?.expenses ?? 0) - Number(p?.reimbursements ?? 0), undefined, 0)}</dd></div>
      {track === "PARTIAL" && <p className="text-xs text-amber-700">ค่าใช้จ่ายบันทึกไม่ครบ</p>}
    </dl>
  );
}

async function PersonsBody({ start, ym }: { start: string; ym: string }) {
  const dm = await getMonth(start);
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">สมาชิก</th><th className="text-right">สินทรัพย์</th><th className="text-right">หนี้สิน</th><th className="text-right">สุทธิ</th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {(dm?.by_person ?? []).map((x) => (
          <tr key={x.person_id ?? "none"} className={x.person_id ? "" : "text-amber-700"}>
            <td className="py-1.5">{x.person_id ? <Link href={`/?p=${x.person_id}&m=${ym}`} className="hover:underline">{x.name}</Link> : x.name}</td>
            <td className="text-right tabular-nums">{money(x.assets, undefined, 0)}</td>
            <td className="text-right tabular-nums">{money(x.liabilities, undefined, 0)}</td>
            <td className="text-right font-medium tabular-nums">{money(x.net_worth, undefined, 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function CompletenessBody() {
  const { data: completeness } = await (await createClient()).rpc("asset_completeness");
  const comp = (completeness ?? []) as { asset_id: string; name: string; asset_group: string; asset_type: string; score: number | null; missing: string[] }[];
  const compAvg = comp.length ? Math.round(comp.reduce((s, c) => s + Number(c.score ?? 0), 0) / comp.length) : null;
  const assetHref = (c: { asset_id: string }) => `/a/${c.asset_id}`;
  return (
    <>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-medium text-slate-900">ความครบถ้วนของข้อมูล <span className="text-xs font-normal text-slate-500">(ณ วันนี้)</span></h2>
        {compAvg != null && <span className="text-xl font-semibold tabular-nums">{compAvg}%</span>}
      </div>
      <p className="mb-2 text-xs text-slate-500">คิดจากข้อมูลที่แนะนำ (เอกสาร เจ้าของ มูลค่า ฯลฯ) · ไม่กระทบตัวเลข Net Worth</p>
      <ul className="space-y-1 text-sm">
        {comp.filter((c) => Number(c.score) < 100).sort((a, b) => Number(a.score) - Number(b.score)).slice(0, 6).map((c) => (
          <li key={c.asset_id} className="flex justify-between gap-2">
            <Link href={assetHref(c)} className="hover:underline">{c.name}</Link>
            <span className="text-xs text-slate-500">{c.score}% · ขาด {c.missing.map((m) => FIELD[m] ?? m).join(", ")}</span>
          </li>
        ))}
        {comp.length > 0 && comp.every((c) => Number(c.score) >= 100) && <li className="text-emerald-700">ครบทุกรายการ ✓</li>}
      </ul>
    </>
  );
}

function Big({ label, value, base, baseLabel, inverse }: { label: string; value: number; base: number | null; baseLabel?: string; inverse?: boolean }) {
  const diff = base == null ? null : Number(value) - base;
  const good = diff == null ? null : inverse ? diff <= 0 : diff >= 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{money(value, "THB", 0)}</div>
      {diff != null && (
        <div className={`mt-1 text-xs ${diff === 0 ? "text-slate-500" : good ? "text-emerald-700" : "text-red-700"}`}>
          {diff > 0 ? "▲ +" : diff < 0 ? "▼ " : ""}{money(diff, undefined, 0)}
          {base ? ` (${((diff / Math.abs(base)) * 100).toFixed(2)}%)` : ""} จาก{baseLabel}
        </div>
      )}
    </div>
  );
}

function BRow({ label, v, bold }: { label: string; v: number; bold?: boolean }) {
  return (
    <tr className={bold ? "font-medium" : ""}>
      <td className="py-1.5 pr-2">{label}</td>
      <td className={`text-right tabular-nums ${!bold && v < 0 ? "text-red-700" : !bold && v > 0 ? "text-emerald-700" : ""}`}>{money(v, undefined, 0)}</td>
    </tr>
  );
}

function PersonItems({ items }: { items: Item[] }) {
  const assets = items.filter((i) => i.item_type === "ASSET").sort((a, b) => Number(b.base_value) - Number(a.base_value));
  const liabs = items.filter((i) => i.item_type === "LIABILITY");
  return (
    <div className="space-y-3 text-sm">
      <ul className="space-y-1">
        {assets.slice(0, 12).map((i, k) => (
          <li key={k} className="flex justify-between gap-2">
            <span>{i.item_name} <span className="text-xs text-slate-400">{GROUP_KEY[i.item_group] ?? ""}{i.ownership_percent && Number(i.ownership_percent) < 100 ? ` · ${Number(i.ownership_percent)}%` : ""}</span></span>
            <span className="tabular-nums">{money(i.base_value, undefined, 0)}</span>
          </li>
        ))}
      </ul>
      {liabs.length > 0 && (
        <ul className="space-y-1 border-t border-slate-100 pt-2 text-red-700">
          {liabs.map((i, k) => <li key={k} className="flex justify-between gap-2"><span>{i.item_name}</span><span className="tabular-nums">−{money(i.base_value, undefined, 0)}</span></li>)}
        </ul>
      )}
    </div>
  );
}

/** กราฟเส้นเดียว (SVG) — จุดทึบ = ยอดยืนยันแล้ว, จุดกลวง = ประมาณการ · hover แสดงค่า */
function TrendChart({ points, selected }: { points: { label: string; date: string; v: number; solid: boolean }[]; selected: number }) {
  if (points.length < 2) return <p className="text-sm text-slate-500">ข้อมูลยังไม่พอแสดงกราฟ</p>;
  const W = 640, H = 220, L = 70, R = 16, T = 12, B = 28;
  const vs = points.map((x) => x.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
  lo -= pad; hi += pad;
  const x = (i: number) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * f);
  const fmt = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0));
  const path = points.map((pt, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(pt.v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="กราฟ Net Worth">
      <defs>
        <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1f5eff" stopOpacity={0.22} />
          <stop offset="100%" stopColor="#1f5eff" stopOpacity={0} />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e6ecf7" strokeWidth={1} strokeDasharray="3 4" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#64748b">{fmt(t)}</text>
        </g>
      ))}
      <path d={`${path} L${x(points.length - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`} fill="url(#nwFill)" stroke="none" />
      <path d={path} fill="none" stroke="#1f5eff" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((pt, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(pt.v)} r={14} fill="transparent"><title>{`${pt.label} (${pt.date}): ${pt.v.toLocaleString("th-TH", { maximumFractionDigits: 0 })} บาท`}</title></circle>
          {i === selected && <circle cx={x(i)} cy={y(pt.v)} r={10} fill="none" stroke="#86afff" strokeWidth={2.5} pointerEvents="none" />}
          <circle cx={x(i)} cy={y(pt.v)} r={5} fill={pt.solid ? "#1f5eff" : "#ffffff"} stroke="#1f5eff" strokeWidth={2} pointerEvents="none" />
          {(i === 0 || i === points.length - 1 || points.length <= 8) && (
            <text x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontSize={11} fill="#64748b">{pt.label}</text>
          )}
        </g>
      ))}
    </svg>
  );
}
