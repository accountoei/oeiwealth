import Link from "next/link";
import { Suspense, cache, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { cachedRpc } from "@/lib/data-cache";
import { requireAppUser } from "@/lib/auth";
import { baht, millions, monthOptions, monthRange, thDate, thMonth, todayBangkok } from "@/lib/format";
import DashboardFilters from "@/components/DashboardFilters";
import { HeaderFilters, InfoTip, PageInfo } from "@/components/HeaderBar";
import { DetailBox, PopupBox } from "./DashDetail";
import TrendChart from "./TrendChart";

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

/** สีหมวด (รอบ 4, 1 พ.ย. 2026 · เลือกด้วยวิธีของ Impeccable): ตั้งใน OKLCH ให้ความสว่าง / ความสดใกล้กัน (ไม่มีสีไหนเด่นเกิน)
 *  ต่างกันที่เฉดสี + ความสว่าง · ทุกสีเข้มพอบนพื้นขาว (≥ 3:1) · ใช้กับหมวดเท่านั้น (รายบุคคลใช้สีเดียว) · มีชื่อหมวด + % กำกับเสมอ (ไม่ใช้สีอย่างเดียว)
 *  ประกัน = เขียวมะกอกเข้ม (เดิมชมพู ใกล้แดงของหนี้สิน) · หนี้สิน = แดง (สีเดียวในหน้าที่เป็นโทนแดง) */
const GROUP_COLOR: Record<string, string> = { financial: "#366bd3", loans: "#008c92", investment: "#7a4aba", business: "#586474",
  property: "#298954", alternative: "#b68028", insurance: "#546316" };
const LIAB_COLOR = "#c9302d";
const GROUP: [string, string][] = [["financial", "เงินฝาก / เงินสด"], ["loans", "เงินให้กู้"], ["investment", "การลงทุน"], ["business", "ธุรกิจ"],
  ["property", "อสังหาริมทรัพย์"], ["alternative", "สินทรัพย์อื่น"], ["insurance", "ประกัน"]];
/** item_group ของรายการรายคน → คีย์หมวดบน Dashboard */
const GROUP_FIELD: Record<string, string> = { FINANCIAL: "financial", LOANS: "loans", INVESTMENT: "investment", BUSINESS: "business",
  PROPERTY: "property", ALTERNATIVE: "alternative", INSURANCE: "insurance" };

// ---------------------------------------------------------------------------
// โหลดข้อมูลส่วนที่ช้า (คำนวณ Net Worth) ผ่าน cachedRpc() → จำผลไว้ข้ามคำขอจนมีการบันทึก / งานเบื้องหลังเสร็จ (เพดาน 1 ชั่วโมง · src/lib/data-cache.ts)
// และผ่าน cache() → เริ่มยิงตั้งแต่ต้นหน้า แล้วการ์ดหลายใบใช้ผลเดียวกันได้
// โดยไม่เรียกซ้ำ · แต่ละการ์ดอยู่ใน <Suspense> ของตัวเอง → ส่วนที่เสร็จก่อนขึ้นก่อน ไม่ต้องรอทั้งหน้า
// ---------------------------------------------------------------------------
const getMonth = cache(async (start: string) =>
  cachedRpc<DM>("dashboard_month", { p_month: start }));
const getPreview = cache(async (start: string) =>
  cachedRpc<Preview>("month_net_worth_preview", { p_month: start }));
const getHistory = cache(async () =>
  cachedRpc<Hist>("net_worth_history"));
const getItems = cache(async (start: string, person: string) =>
  cachedRpc<Item[]>("month_person_items", { p_month: start, p_person: person }));
const getFamilyItems = cache(async (start: string) =>
  cachedRpc<Item[]>("month_family_items", { p_month: start }));
const getPersonDash = cache(async (start: string, person: string) =>
  cachedRpc<PersonDash>("person_dashboard", { p_month: start, p_person: person }));
/** ฐานเทียบของ 3 การ์ดเมื่อเลือกรายคน (ปิดเดือนก่อน → สิ้นเดือนก่อน อัตโนมัติ → ยอดตั้งต้น) */
const getPersonBase = cache(async (start: string, person: string) =>
  cachedRpc<Base>("dashboard_person_base", { p_month: start, p_person: person }));
/** กำไร / ขาดทุนเงินลงทุนของเดือน (ครอบครัว หรือ รายคน) · แยกออกจาก "มูลค่าเปลี่ยน / อื่น ๆ" */
const getInvGain = cache(async (start: string, person: string) =>
  cachedRpc<InvGain>("month_investment_gain", { p_month: start, p_person: person || null }));
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
  // ปุ่มช่วงเวลาที่ย้อนไปก่อนยอดตั้งต้น (วันก่อน Go-live) = ได้กราฟเท่ากับ "ตั้งแต่ Go-live" → จาง กดไม่ได้
  const opening = family?.go_live_date ? new Date(Date.parse(`${family.go_live_date}T00:00:00Z`) - 864e5).toISOString().slice(0, 10) : null;
  const rangeOff = (r: string) => { const f = rangeStart(r, today); return !!(opening && f && f < opening); };
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
    <div className="space-y-4">
      {/* ชื่อครอบครัวอยู่มุมซ้ายบนของเมนูแล้ว · คำอธิบายย้ายเป็น ⓘ ข้างชื่อเมนู (ตกลง 28 ต.ค. 2026) */}
      <PageInfo>
        <Suspense fallback={<>ณ {thDate(today)}</>}><AsOf start={start} isCurrent={isCurrent} today={today} /></Suspense>
        {" · "}{isSetup ? "ช่วงตั้งค่า (SETUP)" : `Go-live ${thDate(family?.go_live_date)}`}
      </PageInfo>
      <HeaderFilters><DashboardFilters persons={persons.map((x) => ({ id: x.id, name: x.name }))} months={months}
        person={personId} month={ym} /></HeaderFilters>

      {/* ------------------------------------------------ การ์ดหลัก: สินทรัพย์ → หนี้สิน → Net Worth (ขวาสุด · เด่นด้วยพื้นสีอ่อน) */}
      <Suspense fallback={<section className={TOP_GRID}>{[0, 1, 2].map((i) => <CardSkeleton key={i} hero={i === 2} />)}</section>}>
        <TopCards start={start} personId={personId} personName={personName} />
      </Suspense>

      <section className="grid gap-4 lg:grid-cols-3">
        {/* ------------------------------------------------ กราฟ */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 xl:p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={`min-w-0 truncate ${H2}`}>Net Worth {personName || "ทั้งครอบครัว"}</h2>
            <nav className="flex flex-wrap gap-1" aria-label="ช่วงเวลากราฟ">
              {RANGES.map(([v, label]) => (v !== range && rangeOff(v)
                ? <span key={v} aria-disabled="true" title="ข้อมูลยังไม่ถึงช่วงนี้" className={`${RANGE_BTN} cursor-not-allowed text-slate-300`}>{label}</span>
                : <Link key={v} href={rangeHref(v)} scroll={false} aria-current={v === range ? "true" : undefined}
                    className={`${RANGE_BTN} ${v === range ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                    {label}
                  </Link>
              ))}
            </nav>
          </div>
          <Suspense fallback={<div className="mt-3 h-48 animate-pulse rounded-lg bg-slate-100" />}>
            <ChartBody start={start} isCurrent={isCurrent} personId={personId} from={rangeStart(range, today)} />
          </Suspense>
          {/* คำอธิบายจุดบนกราฟ (legend) ไว้ใต้กราฟ · ตัวเล็ก */}
          <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />ยอดตั้งต้น / สิ้นเดือน</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-blue-600 bg-white" />ยังไม่ปิด (ประมาณการ)</span>
          </p>
        </div>

        <div className="grid gap-4">{/* grid → กล่องยืดสูงเท่ากล่องกราฟ */}
          {/* ------------------------------------------------ เปลี่ยนเพราะอะไร + รายได้ / ค่าใช้จ่าย (กด → pop up) */}
          <DetailBox start={start} personId={personId} ym={ym}
            title={<>Net Worth เปลี่ยนเพราะอะไร<span className="block text-xs font-normal text-slate-500">{thMonth(start)} · {personName || "ทั้งครอบครัว"}</span></>}
            info={<>&ldquo;เงินคงเหลือสุทธิ&rdquo; = รายได้สุทธิ + รายได้ลงทุน − ค่าใช้จ่ายสุทธิ (เป็นยอดย่อย ไม่บวกซ้ำ) ·
              &ldquo;มูลค่าเปลี่ยน / อื่น ๆ&rdquo; = ประเมินใหม่ (อสังหาฯ / ธุรกิจ / ทอง) · อัตราแลกเปลี่ยนนอกพอร์ต · ยอดหนี้ · รายการที่ไม่ได้บันทึก
              {personId ? " · ค่าใช้จ่ายส่วนกลาง (ไม่ได้จ่ายจากบัญชี / บัตรของใคร และไม่ได้ระบุคน) รวมอยู่ใน “อื่น ๆ”" : ""}</>}
            popupTitle={`Net Worth เปลี่ยนเพราะอะไร ${thMonth(start)} · ${personName || "ทั้งครอบครัว"}`}
            bridge={<Suspense fallback={<Lines n={6} />}><ChangeBody start={start} isCurrent={isCurrent} personId={personId} /></Suspense>}>
            <Suspense fallback={<Lines n={6} />}>
              <ChangeBody start={start} isCurrent={isCurrent} personId={personId} />
            </Suspense>
          </DetailBox>

        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {/* ------------------------------------------------ สัดส่วนสินทรัพย์ (กว้าง 2 ช่อง · ปุ่ม "ดูรายละเอียด ›" → pop up รายการของแต่ละหมวด · รอบ 4) */}
        <PopupBox className="lg:col-span-2" title={`สัดส่วนสินทรัพย์ตามหมวด · ${personName || "ทั้งครอบครัว"}`}
          info="% คิดจากสินทรัพย์รวม · กด ดูรายละเอียด เพื่อดูรายการในแต่ละหมวด · Net Worth = สินทรัพย์รวม − หนี้สิน (การ์ดบนสุด)"
          popupTitle={`สัดส่วนสินทรัพย์ตามหมวด ${thMonth(start)} · ${personName || "ทั้งครอบครัว"}`}
          popup={<Suspense fallback={<Lines n={7} />}><AllocationBody start={start} personId={personId} detail /></Suspense>}>
          <Suspense fallback={<Lines n={7} />}>
            <AllocationBody start={start} personId={personId} />
          </Suspense>
        </PopupBox>

        {/* ------------------------------------------------ รายบุคคล: Net Worth + % */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 xl:p-4">
          <div className="mb-3 flex items-center gap-1">
            <h2 className={H2}>Net Worth รายบุคคล</h2>
            <InfoTip label="คำอธิบายกล่องนี้">Net Worth ตามสัดส่วนเจ้าของ · % ของ Net Worth ครอบครัว · กดชื่อเพื่อดูของคนนั้น</InfoTip>
          </div>
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
/** การ์ดบน (ตกลง 1 พ.ย. 2026 รอบ 3): สินทรัพย์ · หนี้สิน · Net Worth (ขวาสุด) กว้างเท่ากันบนจอกว้าง (xl)
 *  จอเล็กกว่า (มือถือ / แท็บเล็ต / จอคอมเล็กที่มีเมนูซ้าย): สินทรัพย์ + หนี้สินคู่กันแถวบน · Net Worth เต็มแถวด้านล่าง */
const TOP_GRID = "grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3";
const HERO = "col-span-2 xl:col-span-1";
/** หัวกล่อง */
const H2 = "text-base font-semibold text-slate-900";
/** ปุ่มช่วงเวลากราฟ: มือถือสูง 36px (นิ้วกดง่าย) · จอใหญ่ 28px */
const RANGE_BTN = "inline-flex min-h-9 items-center rounded-md px-2.5 text-xs sm:min-h-7";

function CardSkeleton({ hero }: { hero?: boolean }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 sm:p-5 animate-pulse ${hero ? HERO : ""}`}>
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
  return (
    <>
      <section className={TOP_GRID}>
        <Big label="สินทรัพย์รวม" who={person ? person.name : "ทั้งครอบครัว"} value={assets} base={base ? Number(base.total_assets) : null} baseLabel={base?.label} />
        <Big label="หนี้สินรวม" who={person ? person.name : "ทั้งครอบครัว"} value={liab} base={base ? Number(base.total_liabilities) : null} baseLabel={base?.label} inverse />
        <Big label="Net Worth" who={person ? person.name : "ทั้งครอบครัว"} value={nw}
          base={base ? Number(base.net_worth) : null} baseLabel={base?.label} hero />
      </section>
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

/** detail = เนื้อหา pop up (รายการของแต่ละหมวด) · ไม่ใช่ = แถวสรุปในกล่อง · ข้อมูลชุดเดียวกัน (cachedRpc → ดึงครั้งเดียว) */
async function AllocationBody({ start, personId, detail }: { start: string; personId: string; detail?: boolean }) {
  const items = (personId ? await getItems(start, personId) : await getFamilyItems(start)) ?? [];
  const g = groupItems(items);
  return detail ? <AllocationDetail g={g} showShare={!!personId} /> : <Allocation g={g} />;
}

type Grouped = { byKey: Record<string, Item[]>; total: number; liabs: Item[]; liabTotal: number };
const sumItems = (xs: Item[]) => xs.reduce((t, i) => t + Number(i.base_value ?? 0), 0);
function groupItems(items: Item[]): Grouped {
  const assets = items.filter((i) => i.item_type === "ASSET").sort((a, b) => Number(b.base_value) - Number(a.base_value));
  const liabs = items.filter((i) => i.item_type === "LIABILITY").sort((a, b) => Number(b.base_value) - Number(a.base_value));
  const byKey: Record<string, Item[]> = {};
  for (const i of assets) (byKey[GROUP_FIELD[i.item_group] ?? "alternative"] ??= []).push(i);
  return { byKey, total: sumItems(assets), liabs, liabTotal: sumItems(liabs) };
}

/** สัดส่วน 7 หมวด แถวละหมวด (% ของสินทรัพย์รวม) · ต่อด้วยหนี้สิน (ใช้ทั้งภาพรวมครอบครัวและรายคน)
 *  รอบ 4 (1 พ.ย. 2026): แถวไม่กางแล้ว · รายการของแต่ละหมวดอยู่ใน pop up "ดูรายละเอียด ›" (เหมือนกล่อง Net Worth เปลี่ยนเพราะอะไร)
 *  ไม่มีบรรทัด Net Worth ท้ายกล่อง (ซ้ำกับการ์ดบนสุด) */
function Allocation({ g: { byKey, total, liabs, liabTotal } }: { g: Grouped }) {
  return (
    // จอกว้าง (xl): 2 คอลัมน์ คอลัมน์ละ 4 แถว (เรียงลงก่อน) → กล่องเตี้ยลงครึ่งหนึ่ง ทั้งหน้าพอดีจอ · จอเล็กกว่า: แถวเดียวเรียงลง
    <div className="text-sm xl:grid xl:grid-flow-col xl:grid-rows-4 xl:gap-x-8 [&>*]:border-b [&>*]:border-slate-100">
      {GROUP.map(([k, label]) => {
        const list = byKey[k] ?? [];
        const v = sumItems(list);
        // หมวดที่ยังไม่มีรายการ: ตัวหนังสือสีเทา (ไม่ทำจาง) · แสดง — แทนตัวเลข
        return (
          <div key={k} className={`py-2 ${list.length ? "" : "text-slate-500"}`}>
            <AllocRow color={GROUP_COLOR[k]} label={label} pct={total ? (v / total) * 100 : 0} value={v} count={list.length} />
          </div>
        );
      })}
      {liabs.length > 0 && (
        <div className="py-2"><AllocRow color={LIAB_COLOR} label="หนี้สิน" value={-liabTotal} count={liabs.length} /></div>
      )}
    </div>
  );
}

/** pop up ของกล่องสัดส่วน: หมวดละตาราง (ชื่อรายการ · % ในหมวด · มูลค่า) + แถวรวมหมวด · หมวดที่ไม่มีรายการไม่แสดง · ต่อด้วยหนี้สิน */
function AllocationDetail({ g: { byKey, total, liabs, liabTotal }, showShare }: { g: Grouped; showShare: boolean }) {
  const groups = GROUP.filter(([k]) => byKey[k]?.length);
  if (!groups.length && !liabs.length) return <p className="text-sm text-slate-500">ยังไม่มีรายการ</p>;
  return (
    <div className="space-y-5">
      {groups.map(([k, label]) => {
        const list = byKey[k];
        const v = sumItems(list);
        return <ItemTable key={k} color={GROUP_COLOR[k]} label={label} pct={total ? (v / total) * 100 : 0} items={list} sum={v} showShare={showShare} />;
      })}
      {liabs.length > 0 && <ItemTable color={LIAB_COLOR} label="หนี้สิน" items={liabs} sum={liabTotal} showShare={showShare} negative />}
    </div>
  );
}

function AllocRow({ color, label, pct, value, count }: { color: string; label: string; pct?: number; value: number; count: number }) {
  const pctText = pct == null ? "" : count ? `${pct.toFixed(1)}%` : "—";
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[11rem_1fr_3.5rem_8.5rem] xl:grid-cols-[1fr_auto]">
      <span className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />{label}
        <span className="text-xs text-slate-400">{count ? `(${count})` : ""}</span>
      </span>
      <div className="col-span-2 row-start-2 h-1.5 overflow-hidden rounded-full bg-slate-100 sm:col-span-1 sm:row-start-auto sm:h-2 xl:col-span-2 xl:row-start-2 xl:h-1.5">
        {pct != null && pct > 0 && <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />}
      </div>
      <span className={`hidden text-right tabular-nums sm:block xl:hidden ${count ? "font-medium text-slate-700" : ""}`}>{pctText}</span>
      <span className={`text-right tabular-nums ${value < 0 ? "text-red-700" : count ? "text-slate-700" : ""}`}>
        {count > 0 && <span className="mr-2 font-medium sm:hidden xl:inline">{pctText}</span>}{count ? baht(value) : "—"}
      </span>
    </div>
  );
}

function ItemTable({ color, label, pct, items, sum, showShare, negative }: {
  color: string; label: string; pct?: number; items: Item[]; sum: number; showShare: boolean; negative?: boolean;
}) {
  const money = (v: number) => <span className={negative ? "text-red-700" : ""}>{negative ? "\u2212" : ""}{baht(v)}</span>;
  return (
    <section>
      <h3 className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-800">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />{label}
        <span className="text-xs font-normal text-slate-400">({items.length}){pct != null ? ` · ${pct.toFixed(1)}% ของสินทรัพย์รวม` : ""}</span>
      </h3>
      {/* table-fixed + กว้างคอลัมน์คงที่ → คอลัมน์ % และมูลค่าตรงกันทุกหมวด */}
      <table className="w-full table-fixed text-sm">
        <colgroup><col /><col className="w-14 sm:w-24" /><col className="w-[6.5rem] sm:w-36" /></colgroup>
        <tbody className="divide-y divide-slate-100">
          {items.map((i, k) => (
            <tr key={k}>
              <td className="py-1.5 pr-3 [overflow-wrap:anywhere]">{i.item_name}{showShare && i.share_note
                ? <span className="text-xs text-slate-400"> · {i.share_note}</span>
                : showShare && i.ownership_percent && Number(i.ownership_percent) < 100
                  ? <span className="text-xs text-slate-400"> · ถือ {Number(Number(i.ownership_percent).toFixed(2))}%</span> : null}</td>
              <td className="py-1.5 pr-3 text-right text-xs tabular-nums text-slate-500">{sum ? `${((Number(i.base_value) * 100) / sum).toFixed(1)}%` : ""}</td>
              <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{money(Number(i.base_value))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-slate-200 font-medium">
          <tr><td className="py-1.5">รวม{label}</td><td></td><td className="py-1.5 text-right tabular-nums whitespace-nowrap">{money(sum)}</td></tr>
        </tfoot>
      </table>
    </section>
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
          {/* ค่าใช้จ่าย: ชื่อบรรทัดมี "−" แล้ว ตัวเลขจึงไม่ติดลบซ้ำ · ยอดย่อย "เงินคงเหลือสุทธิ" เป็นบรรทัดเล็กสีเทา (ไม่ใช่บรรทัดที่บวกเพิ่ม) */}
          {track === "NOT_TRACKED" && !expense
            ? <tr><td className="py-1 pr-2">− ค่าใช้จ่ายสุทธิ</td><td className="text-right text-xs text-slate-500">ยังไม่ได้บันทึก</td></tr>
            : <BRow label={personId ? "− ค่าใช้จ่ายสุทธิ (ที่ระบุชื่อ)" : "− ค่าใช้จ่ายสุทธิ"} v={expense} />}
          <tr className="text-xs text-slate-500">
            <td className="py-0.5 pl-3 pr-2">ยอดย่อย: เงินคงเหลือสุทธิ</td>
            <td className={`text-right tabular-nums ${net < 0 ? "text-red-700" : ""}`}>{baht(net)}</td>
          </tr>
          <BRow label={personId ? "± กำไร / ขาดทุนเงินลงทุน (ตามสัดส่วนถือ)" : "± กำไร / ขาดทุนเงินลงทุน"} v={dm ? gain : 0} signed
            note={dm && fx ? <>ในนั้นจาก FX {fx > 0 ? "+" : ""}{baht(fx)}</> : null} />
          <BRow label="± มูลค่าเปลี่ยน / อื่น ๆ" v={dm ? other : 0} signed />
          <BRow label={isCurrent ? "= ณ วันนี้" : "= ณ สิ้นเดือน"} v={cur} bold />
        </tbody>
      </table>
    </>
  );
}

async function PersonsBody({ start, ym, personId }: { start: string; ym: string; personId: string }) {
  const dm = await getMonth(start);
  const rows = [...(dm?.by_person ?? [])].sort((a, b) => (a.person_id ? 0 : 1) - (b.person_id ? 0 : 1) || Number(b.net_worth) - Number(a.net_worth));
  const total = Number(dm?.net_worth ?? 0);                                // % ของ Net Worth ครอบครัว (รวมส่วนที่ไม่ระบุเจ้าของ)
  if (!rows.length) return <p className="text-sm text-slate-500">ยังไม่มีข้อมูล</p>;
  return (
    // แถวละคน: ชื่อ · % · Net Worth แล้วแท่งสัดส่วนเต็มความกว้างใต้แถว (เดิมเป็นคอลัมน์แท่งในตาราง → กล่องแคบแล้วตัวเลขล้นขอบขวา)
    <div className="text-sm">
      <ul className="divide-y divide-slate-100">
        {rows.map((x) => {
          const v = Number(x.net_worth);
          const pct = total ? (v * 100) / total : 0;
          const color = x.person_id ? "#1f5eff" : "#d97706";   // สีเดียวทุกคน (สีหมวดใช้เฉพาะกล่องหมวด) · ส้ม = ยังไม่ระบุเจ้าของ
          const sel = !!x.person_id && x.person_id === personId;
          return (
            <li key={x.person_id ?? "none"} className={`py-1 ${x.person_id ? "" : "text-amber-700"} ${sel ? "-mx-2 rounded-md bg-blue-50/60 px-2" : ""}`}>
              <div className={PROW}>
                <span className="flex min-w-0 items-center">
                  {x.person_id
                    ? <Link href={`/?p=${x.person_id}&m=${ym}`} className="truncate hover:underline" aria-current={sel ? "true" : undefined}>{x.name}</Link>
                    : <span className="truncate">{x.name}</span>}
                </span>
                <span className={`text-right tabular-nums ${pct < 0 ? "text-red-700" : "text-slate-600"}`}>{pct.toFixed(1)}%</span>
                <span className={`text-right font-medium tabular-nums ${v < 0 ? "text-red-700" : ""}`}>{baht(v)}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                {pct > 0 && <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />}
              </div>
            </li>
          );
        })}
      </ul>
      <div className={`${PROW} border-t border-slate-100 pt-2 font-medium`}>
        <span>รวมครอบครัว</span><span className="text-right tabular-nums">100.0%</span><span className="text-right tabular-nums">{baht(total)}</span>
      </div>
    </div>
  );
}

/** คอลัมน์ของกล่องรายบุคคล: ชื่อ (ยืด / ตัด …) · % · Net Worth */
const PROW = "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3";

/** การ์ดตัวเลขบน: ตัวใหญ่เป็น "ล้านบาท" (อ่านเร็ว) + เลขเต็มตัวเล็กใต้ (ตรวจทานได้) · ทุกการ์ดทุกยอด (รอบ 4)
 *  บรรทัดเปลี่ยนแปลงเป็นป้าย "เพิ่มขึ้น / ลดลง" (เขียว = ดีขึ้น · แดง = แย่ลง · หนี้ลด = ดีขึ้น) แล้วตามด้วย "จาก…" สีเทา */
function Big({ label, who, value, base, baseLabel, inverse, hero }: { label: string; who: string; value: number; base: number | null; baseLabel?: string; inverse?: boolean; hero?: boolean }) {
  // ปัดเป็นบาท (เหมือนตัวเลขที่แสดง) แล้วต่างกัน 0 = "ไม่เปลี่ยนแปลง"
  const diff = base == null ? null : Math.round(Number(value) - base);
  const good = diff == null ? null : inverse ? diff <= 0 : diff >= 0;
  // รอบ 4: ทุกการ์ดเป็น "ล้านบาท" แม้ต่ำกว่า 1 ล้าน (เช่น หนี้สิน 0.80 ล้านบาท) → 3 การ์ดมีบรรทัดเหมือนกัน
  const m = millions(value, true);
  const pct = diff && base ? Math.abs((diff / Math.abs(base)) * 100).toFixed(2) : null;
  // "สิ้นเดือน ต.ค. 2569 (อัตโนมัติ)" → "สิ้นเดือน ต.ค. 2569" (ชื่อเต็มอยู่ใน title เมื่อชี้) → การ์ดไม่ขึ้นบรรทัดใหม่
  const shortBase = (baseLabel ?? "").replace(/\s*\([^)]*\)\s*$/, "");
  return (
    <div className={`num-box min-w-0 rounded-xl border p-4 sm:p-5 xl:p-4 ${hero ? `${HERO} border-blue-200 bg-blue-50/70` : "border-slate-200 bg-white"}`}
      style={hero ? { boxShadow: "var(--card-shadow)" } : undefined}>
      {/* ชื่อคนบรรทัดเดียว (ยาวตัด …) → เปลี่ยนคนแล้วกล่องไม่สูง / เตี้ยลง */}
      <div className={`truncate text-xs ${hero ? "font-semibold text-ink" : "text-slate-500"}`} title={`${label} · ${who}`}>{label} · {who}</div>
      {/* ขนาดตัวเลขเป็น text-[…] ไม่ใช่ text-xl / text-2xl: globals.css มีกฎ .text-2xl.tabular-nums บังคับสีเกือบดำ (#0b1220)
          → เดิมการ์ดสินทรัพย์ / หนี้สินเป็นสีดำ ไม่ใช่กรมท่า (เจ้าของเห็นเป็นดำ · รอบ 4) */}
      <div className={`mt-1 whitespace-nowrap font-semibold leading-tight tracking-tight tabular-nums text-ink ${hero ? "text-[1.75rem] sm:text-3xl" : "text-[1.25rem] sm:text-[1.5rem]"}`}>
        {m ?? baht(value)}<span className="ml-1.5 text-sm font-normal tracking-normal text-slate-500">{m ? "ล้านบาท" : "บาท"}</span>
      </div>
      {m && <div className="text-xs tabular-nums text-slate-500">{baht(value)} บาท</div>}
      {diff != null && (
        <div className="mt-2 text-xs leading-relaxed">
          {diff === 0
            ? <span className="text-slate-500" title={`จาก${baseLabel}`}>ไม่เปลี่ยนแปลงจาก{shortBase}</span>
            : <>
                <span className={`inline-block rounded-full sm:whitespace-nowrap px-2 py-0.5 font-medium tabular-nums ${good ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
                  {/* มือถือ การ์ดเล็ก (สินทรัพย์ / หนี้สิน): แสดงแค่ % ให้ป้ายอยู่บรรทัดเดียว · เลขเต็มอยู่ในการ์ดจอใหญ่ */}
                  {!hero && pct && <span className="sm:hidden">{diff > 0 ? "เพิ่มขึ้น" : "ลดลง"} {pct}%</span>}
                  <span className={!hero && pct ? "hidden sm:inline" : ""}>{diff > 0 ? "เพิ่มขึ้น" : "ลดลง"} {baht(Math.abs(diff))}{pct ? ` (${pct}%)` : ""}</span>
                </span>
                <span className="text-slate-500" title={`จาก${baseLabel}`}> จาก{shortBase}</span>
              </>}
        </div>
      )}
    </div>
  );
}

function BRow({ label, v, bold, signed, note }: { label: string; v: number; bold?: boolean; signed?: boolean; note?: ReactNode }) {
  // ตัวเลขสีดำ · ติดลบเท่านั้นเป็นสีแดง (ตกลง 1 พ.ย. 2026) · signed = บรรทัด ± ใส่ "+" หน้ายอดบวก · note = บรรทัดเล็กใต้ชื่อ (ไม่บวกเพิ่ม)
  return (
    <tr className={bold ? "font-medium" : ""}>
      <td className="py-1 pr-2 xl:py-0.5">{label}
        {note && <div className="pl-3 text-xs font-normal text-slate-500">{note}</div>}</td>
      <td className={`text-right align-top pt-1 xl:pt-0.5 tabular-nums ${bold ? "text-ink" : ""} ${!bold && v < 0 ? "text-red-700" : ""}`}>{signed && Math.round(v) > 0 ? "+" : ""}{baht(v)}</td>
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
