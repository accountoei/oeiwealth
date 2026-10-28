import Link from "next/link";
import { Suspense, cache, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { money, monthOptions, monthRange, thDate, thMonth, todayBangkok, blueAt } from "@/lib/format";
import DashboardFilters from "@/components/DashboardFilters";
import { HeaderFilters, PageInfo } from "@/components/HeaderBar";
import { DetailBox } from "./DashDetail";

type Preview = {
  as_of: string; financial: number; investment: number; property: number; alternative: number;
  total_assets: number; total_liabilities: number; net_worth: number; unallocated: number;
  prev_net_worth: number | null; prev_label: string | null; prev_date: string | null;
  income: number; investment_income: number; expenses: number; reimbursements: number; other_change: number | null;
  by_person: { person_id: string | null; name: string; assets: number; liabilities: number; net_worth: number }[];
};
type DM = {
  month: string; source: string; as_of: string; financial: number; loans: number; insurance: number; business: number; investment: number; property: number; alternative: number;
  total_assets: number; total_liabilities: number; net_worth: number;
  by_person: { person_id: string | null; name: string; assets: number; liabilities: number; net_worth: number }[];
  base: { label: string; date: string; total_assets: number; total_liabilities: number; net_worth: number } | null;
};
type Base = { label: string; date: string; total_assets: number; total_liabilities: number; net_worth: number };
type Hist = {
  opening: { date: string; total_assets: number; total_liabilities: number; net_worth: number };
  snapshots: { month: string; date: string; status: string; total_assets: number; total_liabilities: number; net_worth: number }[];
};
type Item = { item_type: string; item_name: string; item_group: string; base_value: number | null; ownership_percent: number | null;
  /** ธุรกิจ: "4,000 หุ้น · 40% ของบริษัท" */ share_note?: string | null };
type PersonDash = {
  opening: { date: string; net_worth: number };
  snapshots: { month: string; date: string; status: string; net_worth: number }[];
  prev_net_worth: number | null; prev_label: string | null; prev_date: string | null;
  income: number; investment_income: number; expenses: number; reimbursements: number;
};
type Family = { name: string; go_live_date: string; system_status: string };
type InvGain = { gain: number; fx: number };

const GROUP: [string, string][] = [["financial", "เงินฝาก / เงินสด"], ["loans", "เงินให้กู้"], ["investment", "การลงทุน"], ["business", "ธุรกิจ"],
  ["property", "อสังหาริมทรัพย์"], ["alternative", "สินทรัพย์อื่น"], ["insurance", "ประกัน"]];
/** item_group ของรายการรายคน → คีย์หมวดบน Dashboard */
const GROUP_FIELD: Record<string, string> = { FINANCIAL: "financial", LOANS: "loans", INVESTMENT: "investment", BUSINESS: "business",
  PROPERTY: "property", ALTERNATIVE: "alternative", INSURANCE: "insurance" };

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
const getFamilyItems = cache(async (start: string) =>
  ((await (await createClient()).rpc("month_family_items", { p_month: start })).data ?? null) as Item[] | null);
const getPersonDash = cache(async (start: string, person: string) =>
  ((await (await createClient()).rpc("person_dashboard", { p_month: start, p_person: person })).data ?? null) as PersonDash | null);
/** ฐานเทียบของ 3 การ์ดเมื่อเลือกรายคน (ปิดเดือนก่อน → สิ้นเดือนก่อน อัตโนมัติ → ยอดตั้งต้น) */
const getPersonBase = cache(async (start: string, person: string) =>
  ((await (await createClient()).rpc("dashboard_person_base", { p_month: start, p_person: person })).data ?? null) as Base | null);
/** กำไร / ขาดทุนเงินลงทุนของเดือน (ครอบครัว หรือ รายคน) · แยกออกจาก "มูลค่าเปลี่ยน / อื่น ๆ" */
const getInvGain = cache(async (start: string, person: string) =>
  ((await (await createClient()).rpc("month_investment_gain", { p_month: start, p_person: person || null })).data ?? null) as InvGain | null);
const getTrack = cache(async (start: string) => {
  const { data } = await (await createClient()).from("monthly_expenses").select("tracking_status")
    .eq("year_month", start).is("deleted_at", null).maybeSingle();
  return (data?.tracking_status ?? "NOT_TRACKED") as string;
});

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ p?: string; m?: string; r?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const today = todayBangkok();
  const curYm = today.slice(0, 7);

  const [{ data: familyRaw }, { data: personsRaw }] = await Promise.all([
    supabase.from("families").select("name,go_live_date,system_status").maybeSingle(),
    supabase.from("persons").select("id,name,status").is("deleted_at", null).order("sort_order").order("created_at"),
  ]);
  const family = familyRaw as Family | null;
  const isSetup = family?.system_status === "SETUP";
  // เดือนที่เลือกได้: เดือน Go-live → เดือนปัจจุบัน (ใหม่สุดก่อน)
  const months = monthOptions(family?.go_live_date, today);
  const ym = months.some((x) => x.value === sp.m) ? (sp.m as string) : curYm;
  const isCurrent = ym === curYm;
  const { start } = monthRange(ym);
  const persons = ((personsRaw ?? []) as { id: string; name: string; status: string }[])
    .filter((x) => x.status !== "DECEASED" || x.id === sp.p);   // ตัวกรองไม่แสดง Archived (ยกเว้นคนที่เลือกอยู่)
  const personId = persons.some((x) => x.id === sp.p) ? (sp.p as string) : "";
  const personName = persons.find((x) => x.id === personId)?.name ?? "";
  const range = RANGES.some(([v]) => v === sp.r) ? (sp.r as string) : "all";
  // ลิงก์ปุ่มช่วงเวลา: คงคน / เดือนที่เลือกไว้ · ค่าเริ่มต้น (ตั้งแต่ Go-live) ไม่ต้องใส่ใน URL
  const rangeHref = (r: string) => {
    const q = new URLSearchParams();
    if (personId) q.set("p", personId);
    if (sp.m === ym) q.set("m", ym);
    if (r !== "all") q.set("r", r);
    return q.size ? `/?${q}` : "/";
  };

  // เริ่มคำนวณส่วนที่ช้าทันที (ไม่รอ) — การ์ดด้านล่างจะรับผลจากคำขอเดียวกันนี้
  void getMonth(start); void getPreview(start); void getHistory(); void getTrack(start); void getInvGain(start, personId);
  if (personId) { void getItems(start, personId); void getPersonDash(start, personId); void getPersonBase(start, personId); } else void getFamilyItems(start);

  return (
    <div className="space-y-6">
      {/* ชื่อครอบครัวอยู่มุมซ้ายบนของเมนูแล้ว · คำอธิบายย้ายเป็น ⓘ ข้างชื่อเมนู (ตกลง 28 ต.ค. 2026) */}
      <PageInfo>
        <Suspense fallback={<>ณ {thDate(today)}</>}><AsOf start={start} isCurrent={isCurrent} today={today} /></Suspense>
        {" · "}{isSetup ? "ช่วงตั้งค่า (SETUP)" : `Go-live ${thDate(family?.go_live_date)}`}
      </PageInfo>
      <HeaderFilters><DashboardFilters persons={persons.map((x) => ({ id: x.id, name: x.name }))} months={months}
        person={personId} month={ym} /></HeaderFilters>

      {/* ------------------------------------------------ การ์ดหลัก: สินทรัพย์ → หนี้สิน → ความมั่งคั่งสุทธิ */}
      <Suspense fallback={<section className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <CardSkeleton key={i} />)}</section>}>
        <TopCards start={start} personId={personId} personName={personName} />
      </Suspense>

      <section className="grid gap-4 lg:grid-cols-3">
        {/* ------------------------------------------------ กราฟ */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="min-w-0 truncate font-medium text-slate-900">Net Worth {personName || "ทั้งครอบครัว"}</h2>
            <nav className="flex flex-wrap gap-1" aria-label="ช่วงเวลากราฟ">
              {RANGES.map(([v, label]) => (
                <Link key={v} href={rangeHref(v)} scroll={false} aria-current={v === range ? "true" : undefined}
                  className={`rounded-md px-2 py-0.5 text-xs ${v === range ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <p className="mb-3 mt-1 text-xs text-slate-500">● ทึบ = ยอดตั้งต้น / ปิดเดือนแล้ว · ○ กลวง = ยังไม่ปิด (ประมาณการ)</p>
          <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-slate-100" />}>
            <ChartBody start={start} isCurrent={isCurrent} personId={personId} from={rangeStart(range, today)} />
          </Suspense>
        </div>

        <div className="grid gap-4">{/* grid → กล่องยืดสูงเท่ากล่องกราฟ */}
          {/* ------------------------------------------------ เปลี่ยนเพราะอะไร + รายได้ / ค่าใช้จ่าย (กด → pop up) */}
          <DetailBox start={start} personId={personId} ym={ym}
            title={<>ความมั่งคั่งเปลี่ยนเพราะอะไร {thMonth(start)}<span className="block text-xs font-normal text-slate-500">{personName || "ทั้งครอบครัว"}</span></>}
            popupTitle={`ความมั่งคั่งเปลี่ยนเพราะอะไร ${thMonth(start)} · ${personName || "ทั้งครอบครัว"}`}
            bridge={<Suspense fallback={<Lines n={6} />}><ChangeBody start={start} isCurrent={isCurrent} personId={personId} /></Suspense>}>
            <Suspense fallback={<Lines n={6} />}>
              <ChangeBody start={start} isCurrent={isCurrent} personId={personId} />
            </Suspense>
          </DetailBox>

        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {/* ------------------------------------------------ สัดส่วนสินทรัพย์ (กว้าง 2 ช่อง · กดแต่ละหมวดเพื่อดูรายการ) */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <h2 className="truncate font-medium text-slate-900">สัดส่วนสินทรัพย์ตามหมวด · {personName || "ทั้งครอบครัว"}</h2>
          <p className="mb-3 text-xs text-slate-500">% คิดจากสินทรัพย์รวม · กดที่หมวดเพื่อดูรายการ</p>
          <Suspense fallback={<Lines n={7} />}>
            <AllocationBody start={start} personId={personId} />
          </Suspense>
        </div>

        {/* ------------------------------------------------ รายบุคคล: Net Worth + % */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">สัดส่วนรายบุคคล (Net Worth)</h2>
          <p className="mb-3 text-xs text-slate-500">Net Worth ตามสัดส่วนเจ้าของ · % ของ Net Worth ครอบครัว · กดชื่อเพื่อดูของคนนั้น</p>
          <Suspense fallback={<Lines n={4} />}>
            <PersonsBody start={start} ym={ym} personId={personId} />
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
  const [dm, pBase] = await Promise.all([getMonth(start), personId ? getPersonBase(start, personId) : null]);
  // ฐานเทียบ: ครอบครัว = dashboard_month.base · รายคน = dashboard_person_base (ลำดับเลือกฐานเดียวกัน)
  const base = personId ? pBase : dm?.base ?? null;
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
        <Big label="สินทรัพย์รวม" who={person ? person.name : "ทั้งครอบครัว"} value={assets} base={base ? Number(base.total_assets) : null} baseLabel={base?.label} />
        <Big label="หนี้สินรวม" who={person ? person.name : "ทั้งครอบครัว"} value={liab} base={base ? Number(base.total_liabilities) : null} baseLabel={base?.label} inverse />
        <Big label="ความมั่งคั่งสุทธิ" who={person ? person.name : "ทั้งครอบครัว"} value={nw}
          base={base ? Number(base.net_worth) : null} baseLabel={base?.label} />
      </section>
      {!person && unalloc && Number(unalloc.net_worth) !== 0 && (
        <p className="text-xs text-amber-700">มีมูลค่าที่ยังไม่ระบุเจ้าของ {money(unalloc.net_worth, "THB", 0)} (รวมในยอดครอบครัว แต่ไม่อยู่ในยอดรายบุคคล)</p>
      )}
    </>
  );
}

async function ChartBody({ start, isCurrent, personId, from }: { start: string; isCurrent: boolean; personId: string; from: string | null }) {
  let points: { label: string; date: string; v: number; solid: boolean }[];
  let asOf: string | undefined;
  if (personId) {
    const [dm, h] = await Promise.all([getMonth(start), getPersonDash(start, personId)]);
    const cur = Number(dm?.by_person.find((x) => x.person_id === personId)?.net_worth ?? 0);
    points = [
      ...(h ? [{ label: "ตั้งต้น", date: h.opening.date, v: Number(h.opening.net_worth), solid: true }] : []),
      ...(h?.snapshots ?? []).map((s) => ({ label: thMonth(s.month), date: s.date, v: Number(s.net_worth), solid: s.status === "FINAL" || s.status === "AUTO" })),
      ...(isCurrent && dm ? [{ label: "วันนี้", date: dm.as_of, v: cur, solid: false }] : []),
    ];
    asOf = dm?.as_of;
  } else {
    const [dm, h] = await Promise.all([getMonth(start), getHistory()]);
    // จุดบนกราฟ: ยอดตั้งต้น + ยอดสิ้นเดือน (ปิดแล้ว / อัตโนมัติ · ทึบ) + ยอดวันนี้ (กลวง)
    points = [
      ...(h ? [{ label: "ตั้งต้น", date: h.opening.date, v: Number(h.opening.net_worth), solid: true }] : []),
      ...(h?.snapshots ?? []).map((s) => ({ label: thMonth(s.month), date: s.date, v: Number(s.net_worth), solid: s.status === "FINAL" || s.status === "AUTO" })),
      ...(isCurrent && dm ? [{ label: "วันนี้", date: dm.as_of, v: Number(dm.net_worth), solid: false }] : []),
    ];
    asOf = dm?.as_of;
  }
  points = clipRange(points, from);
  return <TrendChart points={points} selected={points.findIndex((pt) => pt.date === asOf)} />;
}

async function AllocationBody({ start, personId }: { start: string; personId: string }) {
  const items = (personId ? await getItems(start, personId) : await getFamilyItems(start)) ?? [];
  return <Allocation items={items} showShare={!!personId} />;
}

/** สัดส่วน 7 หมวด แถวละหมวด (% ของสินทรัพย์รวม) · กดหมวดเพื่อกางรายการใต้แถว · ต่อด้วยหนี้สิน แล้วปิดท้ายด้วย Net Worth (ใช้ทั้งภาพรวมครอบครัวและรายคน) */
function Allocation({ items, showShare }: { items: Item[]; showShare: boolean }) {
  const assets = items.filter((i) => i.item_type === "ASSET").sort((a, b) => Number(b.base_value) - Number(a.base_value));
  const liabs = items.filter((i) => i.item_type === "LIABILITY").sort((a, b) => Number(b.base_value) - Number(a.base_value));
  const total = assets.reduce((t, i) => t + Number(i.base_value ?? 0), 0);
  const byKey: Record<string, Item[]> = {};
  for (const i of assets) (byKey[GROUP_FIELD[i.item_group] ?? "alternative"] ??= []).push(i);
  const sum = (xs: Item[]) => xs.reduce((t, i) => t + Number(i.base_value ?? 0), 0);
  const liabTotal = sum(liabs);
  return (
    <div className="divide-y divide-slate-100 text-sm">
      {GROUP.map(([k, label], gi) => {
        const list = byKey[k] ?? [];
        const v = sum(list);
        const pct = total ? (v / total) * 100 : 0;
        const head = (
          <AllocRow dot={blueAt(gi)} label={label} pct={pct} value={v} count={list.length}
            bar={`linear-gradient(90deg, ${blueAt(gi)}, ${blueAt(gi + 1)})`} />
        );
        if (!list.length) return <div key={k} className="py-2.5 opacity-50">{head}</div>;
        return (
          <details key={k} className="group py-2.5">
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{head}</summary>
            <ItemList items={list} showShare={showShare} />
          </details>
        );
      })}
      {liabs.length > 0 && (
        <details className="group py-2.5">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <AllocRow dot="#dc2626" label="หนี้สิน" value={-liabTotal} count={liabs.length} />
          </summary>
          <ItemList items={liabs} showShare={showShare} negative />
        </details>
      )}
      {/* บรรทัดสุดท้าย = สินทรัพย์ − หนี้สิน (ตรงกับกล่อง "ความมั่งคั่งสุทธิ" ด้านบน) */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 border-t-2 border-slate-200 py-2.5 font-medium sm:grid-cols-[11rem_1fr_3.5rem_8.5rem_1rem]">
        <span className="sm:col-span-2">ความมั่งคั่งสุทธิ (Net Worth)</span>
        <span className="hidden sm:block" />
        <span className={`text-right tabular-nums ${total - liabTotal < 0 ? "text-red-700" : ""}`}>{money(total - liabTotal, undefined, 0)}</span>
        <span className="hidden sm:block" />
      </div>
    </div>
  );
}

function AllocRow({ dot, label, pct, value, count, bar }: { dot: string; label: string; pct?: number; value: number; count: number; bar?: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[11rem_1fr_3.5rem_8.5rem_1rem]">
      <span className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} />{label}
        <span className="text-xs text-slate-400">{count ? `(${count})` : ""}</span>
      </span>
      <div className="col-span-2 row-start-2 h-2.5 overflow-hidden rounded-full bg-blue-50 sm:col-span-1 sm:row-start-auto">
        {pct != null && <div className="h-full rounded-full" style={{ width: `${pct}%`, background: bar }} />}
      </div>
      <span className="hidden text-right tabular-nums font-medium text-slate-700 sm:block">{pct != null ? `${pct.toFixed(1)}%` : ""}</span>
      <span className={`text-right tabular-nums ${value < 0 ? "text-red-700" : "text-slate-700"}`}>
        <span className="mr-2 font-medium sm:hidden">{pct != null ? `${pct.toFixed(1)}%` : ""}</span>{money(value, undefined, 0)}
      </span>
      <span className="hidden text-slate-400 transition-transform group-open:rotate-90 sm:block">{count ? "▸" : ""}</span>
    </div>
  );
}

function ItemList({ items, showShare, negative }: { items: Item[]; showShare: boolean; negative?: boolean }) {
  return (
    <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 px-3 py-2 sm:ml-[1.125rem] sm:mr-7">
      {items.map((i, k) => (
        <li key={k} className="flex justify-between gap-3">
          <span>{i.item_name}{showShare && i.share_note
            ? <span className="text-xs text-slate-400"> · {i.share_note}</span>
            : showShare && i.ownership_percent && Number(i.ownership_percent) < 100
              ? <span className="text-xs text-slate-400"> · ถือ {Number(Number(i.ownership_percent).toFixed(2))}%</span> : null}</span>
          <span className={`shrink-0 tabular-nums ${negative ? "text-red-700" : ""}`}>{negative ? "−" : ""}{money(i.base_value, undefined, 0)}</span>
        </li>
      ))}
    </ul>
  );
}

async function ChangeBody({ start, isCurrent, personId }: { start: string; isCurrent: boolean; personId: string }) {
  // รวมกล่อง "รายได้ & ค่าใช้จ่าย": เงินคงเหลือสุทธิ (ยอดย่อย) = รายได้สุทธิหลังภาษี + รายได้ลงทุน − ค่าใช้จ่ายสุทธิ — ยอดเดียวกับหน้ารายได้ / ค่าใช้จ่าย
  const [dm, p, track, ig] = await Promise.all([getMonth(start), personId ? getPersonDash(start, personId) : getPreview(start), getTrack(start),
    getInvGain(start, personId)]);
  if (p?.prev_net_worth == null) return <p className="text-sm text-slate-500">ยังไม่มียอดงวดก่อนให้เทียบ</p>;
  const cur = personId ? Number(dm?.by_person.find((x) => x.person_id === personId)?.net_worth ?? 0) : Number(dm?.net_worth ?? 0);
  const expense = Number(p.expenses) - Number(p.reimbursements);
  const net = Number(p.income) + Number(p.investment_income) - expense;
  const gain = Number(ig?.gain ?? 0), fx = Number(ig?.fx ?? 0);
  const other = cur - Number(p.prev_net_worth) - net - gain;
  return (
    <>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          <BRow label={p.prev_label ?? "ยอดงวดก่อน"} v={p.prev_net_worth} bold />
          <BRow label="+ รายได้สุทธิ (หลังภาษี)" v={p.income} />
          <BRow label={personId ? "+ รายได้ลงทุน (ตามสัดส่วนถือ)" : "+ รายได้ลงทุน"} v={p.investment_income} />
          {track === "NOT_TRACKED" && !expense
            ? <tr><td className="py-1.5 pr-2">− ค่าใช้จ่ายสุทธิ</td><td className="text-right text-xs text-slate-500">ยังไม่ได้บันทึก</td></tr>
            : <BRow label={personId ? "− ค่าใช้จ่ายสุทธิ (ที่ระบุชื่อ)" : "− ค่าใช้จ่ายสุทธิ"} v={-expense} />}
          <BRow label="= เงินคงเหลือสุทธิ" v={net} sub />
          <BRow label={personId ? "± กำไร / ขาดทุนเงินลงทุน (ตามสัดส่วนถือ)" : "± กำไร / ขาดทุนเงินลงทุน"} v={dm ? gain : 0}
            note={dm && fx ? <>ในนั้นจาก FX {money(fx, undefined, 0)}</> : null} />
          <BRow label="± มูลค่าเปลี่ยน / อื่น ๆ" v={dm ? other : 0} />
          <BRow label={isCurrent ? "= ณ วันนี้" : "= ณ สิ้นเดือน"} v={cur} bold />
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">&ldquo;เงินคงเหลือสุทธิ&rdquo; เป็นยอดย่อยของ 3 บรรทัดบน (ไม่บวกซ้ำ)
        {personId ? " · ค่าใช้จ่ายส่วนกลาง (ไม่ได้จ่ายจากบัญชี / บัตรของใคร และไม่ได้ระบุคน) รวมอยู่ใน “อื่น ๆ”" : ""}</p>
    </>
  );
}

async function PersonsBody({ start, ym, personId }: { start: string; ym: string; personId: string }) {
  const dm = await getMonth(start);
  const rows = [...(dm?.by_person ?? [])].sort((a, b) => (a.person_id ? 0 : 1) - (b.person_id ? 0 : 1) || Number(b.net_worth) - Number(a.net_worth));
  const total = Number(dm?.net_worth ?? 0);                                // % ของ Net Worth ครอบครัว (รวมส่วนที่ไม่ระบุเจ้าของ)
  if (!rows.length) return <p className="text-sm text-slate-500">ยังไม่มีข้อมูล</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-500">
        <tr><th className="py-1">สมาชิก</th><th className="hidden sm:table-cell"></th><th className="px-2 text-right">%</th><th className="text-right">Net Worth</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((x, i) => {
          const v = Number(x.net_worth);
          const pct = total ? (v * 100) / total : 0;
          const color = x.person_id ? blueAt(i) : "#d97706";
          return (
            <tr key={x.person_id ?? "none"} className={`${x.person_id ? "" : "text-amber-700"} ${x.person_id && x.person_id === personId ? "bg-blue-50/60" : ""}`}>
              <td className="whitespace-nowrap py-2 pr-2">
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: color }} />
                {x.person_id ? <Link href={`/?p=${x.person_id}&m=${ym}`} className="hover:underline">{x.name}</Link> : x.name}
              </td>
              <td className="hidden w-full min-w-12 sm:table-cell">
                <div className="h-2.5 overflow-hidden rounded-full bg-blue-50">
                  {pct > 0 && <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />}
                </div>
              </td>
              <td className={`whitespace-nowrap px-2 text-right tabular-nums ${pct < 0 ? "text-red-700" : "text-slate-600"}`}>{pct.toFixed(1)}%</td>
              <td className={`whitespace-nowrap text-right font-medium tabular-nums ${v < 0 ? "text-red-700" : ""}`}>{money(v, undefined, 0)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot className="border-t-2 border-slate-200 font-medium">
        <tr><td className="py-2">รวมครอบครัว</td><td className="hidden sm:table-cell"></td><td className="px-2 text-right tabular-nums">100.0%</td>
          <td className="text-right tabular-nums">{money(total, undefined, 0)}</td></tr>
      </tfoot>
    </table>
  );
}

function Big({ label, who, value, base, baseLabel, inverse }: { label: string; who: string; value: number; base: number | null; baseLabel?: string; inverse?: boolean }) {
  // ปัดเป็นบาท (เหมือนตัวเลขที่แสดง) แล้วต่างกัน 0 = "ไม่เปลี่ยนแปลง"
  const diff = base == null ? null : Math.round(Number(value) - base);
  const good = diff == null ? null : inverse ? diff <= 0 : diff >= 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
      {/* ชื่อคนบรรทัดเดียว (ยาวตัด …) → เปลี่ยนคนแล้วกล่องไม่สูง / เตี้ยลง */}
      <div className="truncate text-xs text-slate-500" title={`${label} · ${who}`}>{label} · {who}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{money(value, "THB", 0)}</div>
      {diff != null && (diff === 0
        ? <div className="mt-1 text-xs text-slate-500">ไม่เปลี่ยนแปลงจาก{baseLabel}</div>
        : <div className={`mt-1 text-xs ${good ? "text-emerald-700" : "text-red-700"}`}>
            {diff > 0 ? "▲ +" : "▼ "}{money(diff, undefined, 0)}
            {base ? ` (${((diff / Math.abs(base)) * 100).toFixed(2)}%)` : ""} จาก{baseLabel}
          </div>
      )}
    </div>
  );
}

function BRow({ label, v, bold, sub, note }: { label: string; v: number; bold?: boolean; sub?: boolean; note?: ReactNode }) {
  // sub = ยอดย่อย (ตัวเอียง พื้นเทา) ไม่ใช่บรรทัดที่บวกเพิ่ม · note = บรรทัดเล็กใต้ชื่อ (ไม่บวกเพิ่ม)
  return (
    <tr className={bold ? "font-medium" : sub ? "bg-slate-50 italic" : ""}>
      <td className={`py-1.5 pr-2 ${sub ? "pl-2 font-medium text-slate-700" : ""}`}>{label}
        {note && <div className="pl-3 text-xs text-slate-500">{note}</div>}</td>
      <td className={`text-right tabular-nums ${sub ? "pr-2 font-medium " : ""}${!bold && v < 0 ? "text-red-700" : !bold && v > 0 ? "text-emerald-700" : ""}`}>{money(v, undefined, 0)}</td>
    </tr>
  );
}

/** ช่วงเวลาของกราฟ (?r=) · ไม่มี 1W เพราะข้อมูลเป็นยอดปิดรายเดือน + วันนี้ */
const RANGES: [string, string][] = [["1m", "1M"], ["3m", "3M"], ["6m", "6M"], ["ytd", "YTD"], ["1y", "1Y"], ["all", "ตั้งแต่ Go-live"]];

/** วันเริ่มช่วง = สิ้นเดือนย้อนหลัง N เดือน (ตรงกับวัน Snapshot) เช่น 1M ณ 22 ต.ค. → 30 ก.ย. · YTD → 31 ธ.ค. ปีก่อน · null = ทั้งหมด */
function rangeStart(range: string, today: string): string | null {
  const [y, m] = today.split("-").map(Number);
  const back = ({ "1m": 1, "3m": 3, "6m": 6, "1y": 12, ytd: m } as Record<string, number>)[range];
  return back ? new Date(Date.UTC(y, m - back, 0)).toISOString().slice(0, 10) : null;
}

/** ตัดจุดก่อนวันเริ่มช่วง · ถ้าไม่มีจุดตรงวันเริ่ม ให้เก็บจุดสุดท้ายก่อนหน้าไว้เป็นจุดเริ่ม (เห็นว่าเปลี่ยนไปเท่าไรในช่วงนั้น) */
function clipRange<T extends { date: string }>(points: T[], from: string | null): T[] {
  if (!from) return points;
  const i = points.findIndex((pt) => pt.date >= from);
  if (i < 0) return points.slice(-1);
  return points.slice(points[i].date === from ? i : Math.max(0, i - 1));
}

/** กราฟเส้นเดียว (SVG) — จุดทึบ = ยอดยืนยันแล้ว, จุดกลวง = ประมาณการ · hover แสดงค่า */
function TrendChart({ points, selected }: { points: { label: string; date: string; v: number; solid: boolean }[]; selected: number }) {
  if (points.length < 2) return <p className="text-sm text-slate-500">ข้อมูลยังไม่พอแสดงกราฟ</p>;
  // แกนตัวเลขทั้งซ้ายและขวา (ชุดเดียวกัน) → อ่านค่าจุดล่าสุดด้านขวาได้ง่าย
  const W = 640, H = 220, L = 70, R = 70, T = 12, B = 28;
  const vs = points.map((x) => x.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
  lo -= pad; hi += pad;
  const x = (i: number) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * f);
  // ทศนิยมแกนปรับตามช่วงยอด: ยอดขยับน้อย → แสดงละเอียดขึ้น (กันป้ายซ้ำกัน เช่น 209.4M สามบรรทัด)
  const step = (hi - lo) / 2;
  const fmt = (v: number) => {
    const [div, unit] = Math.abs(v) >= 1e6 ? [1e6, "M"] : Math.abs(v) >= 1e3 ? [1e3, "K"] : [1, ""];
    const d = Math.min(4, Math.max(unit === "M" ? 1 : 0, Math.ceil(-Math.log10(step / div))));
    return `${(v / div).toFixed(d)}${unit}`;
  };
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
          <text x={W - R + 8} y={y(t) + 4} textAnchor="start" fontSize={11} fill="#64748b">{fmt(t)}</text>
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
