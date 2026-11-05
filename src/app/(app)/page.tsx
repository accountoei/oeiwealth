import Link from "next/link";
import { Suspense, cache, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { cachedRpc } from "@/lib/data-cache";
import { requireAppUser } from "@/lib/auth";
import { baht, millions, monthOptions, monthRange, thDate, thMonth, todayBangkok, signedPct } from "@/lib/format";
import DashboardFilters from "@/components/DashboardFilters";
import { HeaderFilters, InfoTip, PageInfo } from "@/components/HeaderBar";
import { ChangeDetail, PopupBox, type Bridge } from "./DashDetail";
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
  /** total_assets / total_liabilities: SQL 20261102000100 (เดิมใช้กับเส้นเล็กในการ์ด · ตอนนี้ไม่ได้ใช้ในหน้านี้) */
  opening: { date: string; net_worth: number; total_assets?: number | null; total_liabilities?: number | null };
  snapshots: { month: string; date: string; status: string; net_worth: number; total_assets?: number | null; total_liabilities?: number | null }[];
  prev_net_worth: number | null; prev_label: string | null; prev_date: string | null;
  income: number; investment_income: number; expenses: number; reimbursements: number;
};
type Family = { name: string; go_live_date: string; system_status: string };
type InvGain = { gain: number; fx: number };

/** สีหมวด (4 พ.ย. 2026 เจ้าของขอ "สดใสเหมือนกล่องเงินฝากตามธนาคาร"): ชุดสีเดียวกับ BANK_COLORS (financial/cash/page.tsx)
 *  เดิม (รอบ 4) เป็นสีหม่น OKLCH · ทุกสีเข้มพอบนพื้นขาว · ใช้กับหมวดเท่านั้น (รายบุคคลใช้สีเดียว) · มีชื่อหมวด + % กำกับเสมอ (ไม่ใช้สีอย่างเดียว)
 *  ประกัน = เขียวมะนาว (ไม่ใช้ชมพู เพราะใกล้แดงของหนี้สิน) · หนี้สิน = แดง (สีเดียวในหน้าที่เป็นโทนแดง) */
const GROUP_COLOR: Record<string, string> = { financial: "#2563eb", loans: "#0891b2", investment: "#7c3aed", business: "#475569",
  property: "#059669", alternative: "#f59e0b", insurance: "#65a30d" };
const LIAB_COLOR = "#dc2626";
/** ชื่อหมวด (4 พ.ย. 2026: "เงินฝาก / เงินสด" → "เงินฝากธนาคาร" · ไม่มีประเภทเงินสดในระบบ) */
const GROUP: [string, string][] = [["financial", "เงินฝากธนาคาร"], ["loans", "เงินให้กู้"], ["investment", "การลงทุน"], ["business", "ธุรกิจ"],
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
/** ค่างวดเงินกู้รวมต่อเดือน (การ์ดหนี้สิน "ค่างวด … บาท/เดือน" · ตกลง 3 พ.ย. 2026) — สูตรเดียวกับ "ค่างวดรวม" หน้า Liabilities:
 *  เงินกู้ที่ยังผ่อน (ACTIVE) สกุล THB · รายคน = × สัดส่วนหนี้ของคนนั้น (Net Worth Engine) · เป็นค่างวดปัจจุบัน ไม่ขึ้นกับเดือนที่เลือก */
const getMonthlyPay = cache(async (person: string): Promise<number> => {
  const supabase = await createClient();
  const [{ data: loans }, { data: mine }] = await Promise.all([
    supabase.from("liabilities").select("id,currency,monthly_payment").eq("status", "ACTIVE").is("deleted_at", null),
    person
      ? supabase.from("v_net_worth_items_current").select("liability_id,ownership_percent")
          .eq("person_id", person).eq("item_type", "LIABILITY").not("liability_id", "is", null)
      : Promise.resolve({ data: null }),
  ]);
  const share = new Map<string, number>();
  for (const r of (mine ?? []) as { liability_id: string; ownership_percent: number | null }[])
    share.set(r.liability_id, (share.get(r.liability_id) ?? 0) + Number(r.ownership_percent ?? 100) / 100);
  return ((loans ?? []) as { id: string; currency: string; monthly_payment: number | null }[])
    .filter((l) => l.currency === "THB")
    .reduce((t, l) => t + Number(l.monthly_payment ?? 0) * (person ? share.get(l.id) ?? 0 : 1), 0);
});
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
  void getMonth(start); void getPreview(start); void getHistory(); void getTrack(start); void getInvGain(start, personId); void getMonthlyPay(personId);
  if (personId) { void getItems(start, personId); void getPersonDash(start, personId); void getPersonBase(start, personId); } else void getFamilyItems(start);

  return (
    // @container/dash: จำนวนคอลัมน์ดูจากความกว้างเนื้อหาจริง (หักเมนูซ้ายแล้ว) ไม่ใช่ขนาดหน้าต่าง (ตกลง 3 พ.ย. 2026 ·
    // เดิม iPad Pro แนวตั้ง / จอ 1,280 ได้ 3 คอลัมน์ทั้งที่เนื้อหาแคบ → กล่องขวาถูกบีบเหลือ ~230 px)
    <div className="@container/dash space-y-4">
      {/* ชื่อครอบครัวอยู่มุมซ้ายบนของเมนูแล้ว · คำอธิบายย้ายเป็น ⓘ ข้างชื่อเมนู (ตกลง 28 ต.ค. 2026) */}
      <PageInfo>
        <Suspense fallback={<>ณ {thDate(today)}</>}><AsOf start={start} isCurrent={isCurrent} today={today} /></Suspense>
        {" · "}{isSetup ? "ช่วงตั้งค่า (SETUP)" : `Go-live ${thDate(family?.go_live_date)}`}
      </PageInfo>
      <HeaderFilters><DashboardFilters persons={persons.map((x) => ({ id: x.id, name: x.name }))} months={months}
        person={personId} month={ym} /></HeaderFilters>

      {/* ------------------------------------------------ การ์ดหลัก: ความมั่งคั่งสุทธิ (ใบแรก · พื้นฟ้าอ่อน · 4 พ.ย. 2026) → สินทรัพย์ → หนี้สิน */}
      <Suspense fallback={<section className={TOP_GRID}>{[0, 1, 2].map((i) => <CardSkeleton key={i} hero={i === 0} />)}</section>}>
        <TopCards start={start} personId={personId} personName={personName} isCurrent={isCurrent} />
      </Suspense>

      <section className={ROW}>
        {/* ------------------------------------------------ กราฟ (สูงเต็มกล่อง = เท่ากล่อง "เปลี่ยนเพราะอะไร" ข้าง ๆ → ไม่มีที่ว่างใต้คำอธิบายสี) */}
        <div className={`flex flex-col rounded-xl border border-slate-200 bg-white p-4 sm:p-5 xl:p-4 ${ROW_WIDE}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={`min-w-0 truncate ${H2}`}>ความมั่งคั่งสุทธิ (Net Worth) · {personName || "ทั้งครอบครัว"}</h2>
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
            {/* จุดทึบ = ยอดที่ล็อกแล้ว (ยอดตั้งต้น / เดือนที่ปิดแล้ว) · จุดกลวง = ยอดสิ้นเดือนอัตโนมัติ (คำนวณใหม่ทุกคืนจนกว่าจะปิดเดือน) และวันนี้ (ตกลง 2 พ.ย. 2026) */}
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />ยอดตั้งต้น / ปิดเดือนแล้ว</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-blue-600 bg-white" />ยังไม่ปิดงวด (ข้อมูลอาจเปลี่ยนแปลงได้)</span>
          </p>
        </div>

        <div className="grid gap-4">{/* grid → กล่องยืดสูงเท่ากล่องกราฟ */}
          {/* ------------------------------------------------ เปลี่ยนเพราะอะไร + รายได้ / ค่าใช้จ่าย (กด → pop up) */}
          <PopupBox className="flex flex-col"
            title={<>ความมั่งคั่งสุทธิเปลี่ยนเพราะอะไร<span className="block text-xs font-normal text-slate-500">{thMonth(start)} · {personName || "ทั้งครอบครัว"}</span></>}
            info={<>&ldquo;เงินคงเหลือสุทธิ&rdquo; = รายได้สุทธิ + รายได้ลงทุน − ค่าใช้จ่ายสุทธิ (เป็นยอดย่อย ไม่บวกซ้ำ) ·
              &ldquo;มูลค่าเปลี่ยน / อื่น ๆ&rdquo; = ประเมินใหม่ (อสังหาฯ / ธุรกิจ / ทอง) · อัตราแลกเปลี่ยนนอกพอร์ต · ยอดหนี้ · รายการที่ไม่ได้บันทึก
              {personId ? " · ค่าใช้จ่ายส่วนกลาง (ไม่ได้จ่ายจากบัญชี / บัตรของใคร และไม่ได้ระบุคน) รวมอยู่ใน “อื่น ๆ”" : ""}</>}
            popupTitle={`ความมั่งคั่งสุทธิเปลี่ยนเพราะอะไร ${thMonth(start)} · ${personName || "ทั้งครอบครัว"}`}
            popup={<Suspense fallback={<Lines n={6} />}><ChangePopup start={start} isCurrent={isCurrent} personId={personId} /></Suspense>}>
            <Suspense fallback={<Lines n={6} />}>
              <ChangeBody start={start} isCurrent={isCurrent} personId={personId} />
            </Suspense>
          </PopupBox>

        </div>
      </section>

      <section className={ROW}>
        {/* ------------------------------------------------ สัดส่วนสินทรัพย์ (กว้าง 2 ช่อง · ปุ่ม "ดูรายละเอียด ›" → pop up รายการของแต่ละหมวด · รอบ 4) */}
        <PopupBox className={`flex flex-col ${ROW_WIDE}`} title={`สัดส่วนสินทรัพย์ตามหมวด · ${personName || "ทั้งครอบครัว"}`}
          info="% คิดจากสินทรัพย์รวม · กด ดูรายละเอียด เพื่อดูรายการในแต่ละหมวด · ความมั่งคั่งสุทธิ = สินทรัพย์รวม − หนี้สิน (การ์ดบนสุด)"
          popupTitle={`สัดส่วนสินทรัพย์ตามหมวด ${thMonth(start)} · ${personName || "ทั้งครอบครัว"}`}
          popup={<Suspense fallback={<Lines n={7} />}><AllocationBody start={start} personId={personId} detail /></Suspense>}>
          <Suspense fallback={<Lines n={7} />}>
            <AllocationBody start={start} personId={personId} />
          </Suspense>
        </PopupBox>

        {/* ------------------------------------------------ รายบุคคล: Net Worth + % */}
        <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 sm:p-5 xl:p-4">
          <div className="mb-3 flex items-center gap-1">
            <h2 className={H2}>ความมั่งคั่งสุทธิรายบุคคล</h2>
            <InfoTip label="คำอธิบายกล่องนี้">ความมั่งคั่งสุทธิตามสัดส่วนเจ้าของ · % ของความมั่งคั่งสุทธิทั้งครอบครัว · กดชื่อเพื่อดูของคนนั้น</InfoTip>
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
/** การ์ดบน: ความมั่งคั่งสุทธิ (ใบแรก · 4 พ.ย. 2026 · เดิมขวาสุดตั้งแต่รอบ 3) · สินทรัพย์ · หนี้สิน เรียง 3 ใบเมื่อเนื้อหากว้าง ≥ 56rem (896px)
 *  แคบกว่า (มือถือ / iPad แนวตั้ง): ความมั่งคั่งสุทธิเต็มแถวบนสุด · สินทรัพย์ + หนี้สินคู่กันแถวล่าง
 *  ดูจากความกว้างเนื้อหา (@container/dash) ไม่ใช่ขนาดหน้าต่าง (3 พ.ย. 2026) */
const TOP_GRID = "grid grid-cols-2 gap-3 sm:gap-4 @min-[56rem]/dash:grid-cols-3";
const HERO = "col-span-2 @min-[56rem]/dash:col-span-1";
/** พื้นการ์ดความมั่งคั่งสุทธิ: ฟ้าอ่อน (4 พ.ย. 2026 เทียบภาพ 3 แบบ ก. ฟ้าอ่อน / ข. น้ำเงินเข้ม / ค. น้ำเงินสด → เจ้าของเลือก ก.)
 *  ถ้าจะเปลี่ยนเป็นพื้นเข้ม: แก้ HERO_BG + TONE.hero (ตัวหนังสือขาว · ป้ายพื้นขาว) และสีในแถวช่วงเวลา (NwPeriods) */
const HERO_BG = "border-blue-200 bg-blue-50/70";
/** สีข้อความของการ์ดใบเด่น / ใบปกติ */
const TONE = {
  hero: { label: "font-semibold text-ink", num: "text-ink", sub: "text-slate-500", icon: "bg-white text-blue-700 ring-1 ring-blue-100",
    up: "bg-emerald-50 text-emerald-800", down: "bg-red-50 text-red-800", same: "bg-slate-100 text-slate-600" },
  card: { label: "text-slate-500", num: "text-ink", sub: "text-slate-500", icon: "",
    up: "bg-emerald-50 text-emerald-800", down: "bg-red-50 text-red-800", same: "bg-slate-100 text-slate-600" },
};
/** แถวกราฟ + "เปลี่ยนเพราะอะไร" และแถวสัดส่วน + รายบุคคล: คู่กัน (2 : 1) เมื่อเนื้อหากว้าง ≥ 58rem (928px · จอ 1,280 ที่เมนูกว้างปกติยังคู่กัน)
 *  แคบกว่า (iPad แนวตั้ง / แนวนอนที่เมนูกาง) → เรียงลงเต็มความกว้าง (เดิมกล่องขวาถูกบีบเหลือ ~230 px ตัวหนังสือตกบรรทัด) */
const ROW = "grid gap-4 @min-[58rem]/dash:grid-cols-3";
const ROW_WIDE = "@min-[58rem]/dash:col-span-2";
/** หัวกล่อง */
const H2 = "text-base font-semibold text-slate-900";
/** ปุ่มช่วงเวลากราฟ: มือถือสูง 36px (นิ้วกดง่าย) · จอใหญ่ 28px */
const RANGE_BTN = "inline-flex min-h-9 items-center rounded-md px-2.5 text-xs sm:min-h-7";

function CardSkeleton({ hero }: { hero?: boolean }) {
  return (
    <div className={`@container rounded-xl border p-4 sm:p-5 xl:p-4 animate-pulse ${hero ? `${HERO} ${HERO_BG}` : "border-slate-200 bg-white"}`}>
      <div className="flex justify-between"><div className="h-3 w-28 rounded bg-slate-100" /><div className="h-5 w-24 rounded-full bg-slate-100" /></div>
      <div className={CARD_SPLIT}>
        <div className="mt-3 flex items-center gap-3"><div className="hidden h-9 w-9 rounded-lg bg-slate-100 sm:block" />
          <div><div className="h-7 w-36 rounded bg-slate-200" /><div className="mt-1.5 h-3 w-24 rounded bg-slate-100" /></div></div>
        <div className={INSIGHT_GAP}><InsightSlot /></div>
      </div>
      <div className="mt-3 h-3 w-32 rounded bg-slate-100" />
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

async function TopCards({ start, personId, personName, isCurrent }: { start: string; personId: string; personName: string; isCurrent: boolean }) {
  const [dm, pBase, monthly] = await Promise.all([getMonth(start), personId ? getPersonBase(start, personId) : null, getMonthlyPay(personId)]);
  // ฐานเทียบ: ครอบครัว = dashboard_month.base · รายคน = dashboard_person_base (ลำดับเลือกฐานเดียวกัน)
  const base = personId ? pBase : dm?.base ?? null;
  const byPerson = dm?.by_person ?? [];
  const person = personId ? byPerson.find((x) => x.person_id === personId) ?? { person_id: personId,
    name: personName, assets: 0, liabilities: 0, net_worth: 0 } : null;
  const nw = person ? person.net_worth : dm?.net_worth ?? 0;
  const assets = person ? person.assets : dm?.total_assets ?? 0;
  const liab = person ? person.liabilities : dm?.total_liabilities ?? 0;
  const who = person ? person.name : "ทั้งครอบครัว";
  const asOf = dm?.as_of ?? "";
  // บรรทัดอธิบายใต้ตัวเลข (เดิมอยู่ใน ⓘ ของหัวหน้า มองไม่เห็น) · ดูเดือนที่ผ่านมา = ณ สิ้นเดือนนั้น
  const asOfText = isCurrent ? "ณ วันนี้" : `ณ ${thDate(asOf)}`;
  const ratio = Number(assets) > 0 ? (Number(liab) / Number(assets)) * 100 : null;
  return (
    <section className={TOP_GRID}>
      <Big label="ความมั่งคั่งสุทธิ" who={who} value={nw} base={base ? Number(base.net_worth) : null} baseLabel={base?.label} hero
        icon={<IconNetWorth />} note={`${asOfText} · หลังหักหนี้สินแล้ว`}
        insight={<Suspense fallback={<InsightSlot />}><NwPeriods start={start} personId={personId} current={nw} asOf={asOf} base={base} isCurrent={isCurrent} /></Suspense>} />
      <Big label="สินทรัพย์รวม" shortLabel="สินทรัพย์" who={who} value={assets} base={base ? Number(base.total_assets) : null} baseLabel={base?.label}
        icon={<IconAssets />} note={asOfText}
        insight={<Suspense fallback={<InsightSlot />}><LiquidityRow start={start} personId={personId} /></Suspense>} />
      <Big label="หนี้สินรวม" shortLabel="หนี้สิน" who={who} value={liab} base={base ? Number(base.total_liabilities) : null} baseLabel={base?.label} inverse
        icon={<IconDebt />} insight={<DebtMeter ratio={ratio} />}
        note={monthly > 0 ? <>ค่างวด {baht(monthly)}<span className="hidden sm:inline"> บาท</span>/เดือน</> : asOfText}
        noteTitle={monthly > 0 ? `ค่างวดเงินกู้รวม ${baht(monthly)} บาท/เดือน (ค่างวดปัจจุบัน)` : undefined} />
    </section>
  );
}

// ---------------------------------------------------------------------------- แถวข้อมูลในการ์ด (3 พ.ย. 2026 · แทนเส้นเล็กที่ซ้ำกับกราฟใหญ่)
/** ที่ของแถวข้อมูล: สูงเท่ากันทุกการ์ด (ระหว่างโหลด / ไม่มีข้อมูล ก็ไม่ทำให้การ์ดกระโดด) */
const INSIGHT = "min-h-8";
/** การ์ดกว้าง (เนื้อในการ์ด ≥ 24rem · จอ 15 / 17 นิ้ว / จอคอม / Net Worth เต็มแถวบน iPad): ตัวเลขซ้าย · แถวข้อมูลขวา → การ์ดเตี้ยลง ไม่มีที่ว่างฝั่งขวา
 *  การ์ดแคบ: แถวข้อมูลอยู่ใต้ตัวเลขแบบเดิม (ตกลง 3 พ.ย. 2026) */
const CARD_SPLIT = "@min-[24rem]:grid @min-[24rem]:grid-cols-[auto_minmax(0,1fr)] @min-[24rem]:items-center @min-[24rem]:gap-x-6";
const INSIGHT_GAP = "mt-3 @min-[24rem]:mt-2";
function InsightSlot() {
  return <div className={INSIGHT} aria-hidden />;
}
/** % สั้น: ต่ำกว่า 10 → ทศนิยม 1 ตำแหน่ง */
const pctShort = (v: number) => (Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0));
/** แถบแนวนอนบาง (ภาพประกอบ · ตัวเลขอยู่ในบรรทัดใต้แถบแล้ว) */
function Bar({ pct, fill, ticks = [] }: { pct: number; fill: string; ticks?: number[] }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative h-1.5 rounded-full bg-slate-200" aria-hidden>
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${w}%`, minWidth: w > 0 ? 4 : 0 }} />
      {ticks.map((t) => <span key={t} className="absolute -bottom-0.5 -top-0.5 w-0.5 -translate-x-1/2 rounded-full bg-white ring-1 ring-slate-300" style={{ left: `${t}%` }} />)}
    </div>
  );
}

/** การ์ดสินทรัพย์ (คำ 4 พ.ย. 2026 · เดิม ได้เงินเร็ว / ใช้เวลาขาย): สภาพคล่องสูง = เงินฝากธนาคาร + การลงทุน · ที่เหลือ = สภาพคล่องต่ำ (อสังหาฯ ธุรกิจ เงินให้กู้ ประกัน สินทรัพย์อื่น)
 *  ใช้รายการชุดเดียวกับกล่องสัดส่วน (cachedRpc → ไม่ถามฐานข้อมูลเพิ่ม) · แยก Suspense → ตัวเลขการ์ดขึ้นก่อน */
const QUICK = ["financial", "investment"];
async function LiquidityRow({ start, personId }: { start: string; personId: string }) {
  const g = groupItems((personId ? await getItems(start, personId) : await getFamilyItems(start)) ?? []);
  if (g.total <= 0) return <InsightSlot />;
  const quick = (QUICK.reduce((t, k) => t + sumItems(g.byKey[k] ?? []), 0) / g.total) * 100;
  const q = pctShort(quick), slow = pctShort(100 - Number(q));
  return (
    <div className={INSIGHT} title={`สภาพคล่องสูง ${q}% = เงินฝากธนาคาร + การลงทุน · สภาพคล่องต่ำ ${slow}% = อสังหาริมทรัพย์ ธุรกิจ เงินให้กู้ ประกัน สินทรัพย์อื่น`}>
      <Bar pct={quick} fill="bg-blue-600" />
      {/* 4 พ.ย. 2026: ฝั่งขวาสั้นเหลือ "ต่ำ X%" · ช่องแคบกว่า 11rem (การ์ดแคบ / มือถือ) → ซ่อนฝั่งขวา (ดูจากแถบแทน) ไม่ตัดคำฝั่งซ้ายเป็น "…"
          ดูจากความกว้างของแถวนี้เอง (@container/liq) ไม่ใช่ขนาดจอ */}
      <div className="@container/liq">
        <div className="mt-1.5 flex items-baseline justify-between gap-2 text-xs text-slate-600">
          <span className="whitespace-nowrap">สภาพคล่องสูง <span className={`font-semibold tabular-nums ${quick < 15 ? "text-red-700" : quick < 30 ? "text-amber-700" : "text-emerald-700"}`}>{q}%</span></span>
          <span className="hidden shrink-0 whitespace-nowrap text-slate-500 @min-[11rem]/liq:inline">ต่ำ <span className="font-semibold tabular-nums text-ink">{slow}%</span></span>
        </div>
      </div>
    </div>
  );
}

/** การ์ดหนี้สิน: หนี้สิน ÷ สินทรัพย์ · สีตามระดับ (เกณฑ์ทั่วไป) ต่ำ < 30% · ปานกลาง 30–50% · สูง > 50% · ขีดบนแถบ = 30% / 50% */
function DebtMeter({ ratio }: { ratio: number | null }) {
  if (ratio == null) return <InsightSlot />;
  const lv = ratio < 30 ? { t: ratio > 0 ? "หนี้ต่ำ" : "ไม่มีหนี้", bar: "bg-emerald-500", text: "text-emerald-700" }
    : ratio <= 50 ? { t: "หนี้ปานกลาง", bar: "bg-amber-500", text: "text-amber-700" }
    : { t: "หนี้สูง", bar: "bg-red-600", text: "text-red-700" };
  const r = ratio.toFixed(ratio < 10 ? 2 : 1);
  return (
    <div className={INSIGHT} title={`หนี้สิน ${r}% ของสินทรัพย์ · ต่ำ = ไม่ถึง 30% · ปานกลาง = 30–50% · สูง = เกิน 50%`}>
      <Bar pct={ratio} fill={lv.bar} ticks={[30, 50]} />
      <div className="mt-1.5 flex items-baseline justify-between gap-2 text-xs text-slate-600">
        <span className="min-w-0 truncate"><span className="font-semibold tabular-nums text-ink">{r}%</span><span className="hidden sm:inline"> ของสินทรัพย์</span></span>
        <span className={`shrink-0 font-medium ${lv.text}`}>{lv.t}</span>
      </div>
    </div>
  );
}

/** การ์ด Net Worth: เปลี่ยนไปเท่าไรในแต่ละช่วง — เดือนนี้ (ฐานเดียวกับป้ายบนการ์ด) · ตั้งแต่ต้นปี (สิ้นปีก่อน) · ตั้งแต่ Go-live (ยอดตั้งต้น)
 *  ช่วงที่ฐานเป็นวันเดียวกันแสดงครั้งเดียว (เช่น ปีแรกที่ Go-live กลางปี → ไม่มี "ตั้งแต่ต้นปี") · ใช้ประวัติชุดเดียวกับกราฟใหญ่ */
async function NwPeriods({ start, personId, current, asOf, base, isCurrent }: {
  start: string; personId: string; current: number; asOf: string; base: Base | null; isCurrent: boolean;
}) {
  type Pt = { date: string; net_worth: number };
  const h: { opening: Pt; snapshots: Pt[] } | null = personId ? await getPersonDash(start, personId) : await getHistory();
  if (!h || !asOf) return <InsightSlot />;
  const yearEnd = `${Number(asOf.slice(0, 4)) - 1}-12-31`;
  const ye = h.snapshots.find((x) => x.date === yearEnd);
  const list: { label: string; date: string; v: number; from: string }[] = [];
  if (base && base.date < asOf) list.push({ label: isCurrent ? "เดือนนี้" : "ในเดือนที่เลือก", date: base.date, v: Number(base.net_worth), from: base.label });
  if (ye && ye.date < asOf) list.push({ label: "ตั้งแต่ต้นปี", date: ye.date, v: Number(ye.net_worth), from: `สิ้นปี ${thDate(ye.date)}` });
  list.push({ label: "ตั้งแต่ Go-live", date: h.opening.date, v: Number(h.opening.net_worth), from: "ยอดตั้งต้น" });
  // ซ้ายไปขวา = ช่วงยาว → สั้น: ตั้งแต่ Go-live ชิดซ้าย · เดือนนี้ชิดขวา (เหมือนแถวข้อมูลของอีก 2 การ์ด · 5 พ.ย. 2026)
  const periods = list.filter((x, i) => list.findIndex((y) => y.date === x.date) === i).reverse();
  return (
    <div className={`${INSIGHT} flex flex-wrap justify-between gap-x-6 gap-y-1`}>
      {periods.map((x, i) => {
        const diff = Math.round(Number(current) - x.v);
        const pct = x.v ? (diff / Math.abs(x.v)) * 100 : null;
        return (
          <div key={x.label} className={`leading-4 ${i > 0 && i === periods.length - 1 ? "text-right" : ""}`} title={`${diff === 0 ? "ไม่เปลี่ยนแปลง" : `${diff > 0 ? "เพิ่มขึ้น" : "ลดลง"} ${baht(Math.abs(diff))} บาท`} จาก${x.from}`}>
            <div className="text-[11px] text-slate-500">{x.label}</div>
            <div className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${diff === 0 ? "text-slate-600" : diff > 0 ? "text-emerald-700" : "text-red-700"}`}>
              {diff !== 0 && <Arrow up={diff > 0} />}
              <span className="sr-only">{diff > 0 ? "เพิ่มขึ้น" : diff < 0 ? "ลดลง" : ""}</span>
              {pct == null ? `${diff > 0 ? "+" : diff < 0 ? "\u2212" : ""}${baht(Math.abs(diff))}` : signedPct(pct)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------- ไอคอนการ์ด (SVG ในหน้า ไม่โหลดไฟล์ · เส้น 1.75)
const ICON = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
/** สินทรัพย์: อาคาร (ธนาคาร / ทรัพย์สิน) */
const IconAssets = () => <svg {...ICON}><path d="M3 21h18M4 10h16M12 3 4 7v3h16V7l-8-4ZM6 10v8M10 10v8M14 10v8M18 10v8" /></svg>;
/** หนี้สิน: บัตร / สัญญากู้ */
const IconDebt = () => <svg {...ICON}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></svg>;
/** Net Worth: กราฟแท่ง */
const IconNetWorth = () => <svg {...ICON}><path d="M4 20h16M7 16v-4M12 16V8M17 16v-7" /></svg>;
/** ลูกศรขึ้น / ลง ในป้ายเปลี่ยนแปลง (ทิศ = ยอดขึ้น / ลง · สี = ดี / ไม่ดี) */
const Arrow = ({ up }: { up: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="shrink-0"><path d={up ? "M5 1.5 9 8H1z" : "M5 8.5 1 2h8z"} fill="currentColor" /></svg>
);

async function ChartBody({ start, isCurrent, personId, from }: { start: string; isCurrent: boolean; personId: string; from: string | null }) {
  let points: { label: string; date: string; v: number; solid: boolean }[];
  let asOf: string | undefined;
  if (personId) {
    const [dm, h] = await Promise.all([getMonth(start), getPersonDash(start, personId)]);
    const cur = Number(dm?.by_person.find((x) => x.person_id === personId)?.net_worth ?? 0);
    points = [
      ...(h ? [{ label: "ตั้งต้น", date: h.opening.date, v: Number(h.opening.net_worth), solid: true }] : []),
      ...(h?.snapshots ?? []).map((s) => ({ label: thMonth(s.month), date: s.date, v: Number(s.net_worth), solid: s.status === "FINAL" })),
      ...(isCurrent && dm ? [{ label: "วันนี้", date: dm.as_of, v: cur, solid: false }] : []),
    ];
    asOf = dm?.as_of;
  } else {
    const [dm, h] = await Promise.all([getMonth(start), getHistory()]);
    // จุดบนกราฟ: ยอดตั้งต้น + ยอดสิ้นเดือน (ปิดแล้ว / อัตโนมัติ · ทึบ) + ยอดวันนี้ (กลวง)
    points = [
      ...(h ? [{ label: "ตั้งต้น", date: h.opening.date, v: Number(h.opening.net_worth), solid: true }] : []),
      ...(h?.snapshots ?? []).map((s) => ({ label: thMonth(s.month), date: s.date, v: Number(s.net_worth), solid: s.status === "FINAL" })),
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

/** หมวดที่มีรายการ เรียงมูลค่ามาก → น้อย แล้วต่อด้วยหมวดที่ยังไม่มีรายการ (ตกลง 4 พ.ย. 2026 · แบบ ข.: เรียงแล้วเทียบกันง่าย) */
function sortedGroups(byKey: Record<string, Item[]>) {
  return GROUP.map(([k, label]) => ({ k, label, list: byKey[k] ?? [], v: sumItems(byKey[k] ?? []) }))
    .sort((a, b) => (b.list.length ? 1 : 0) - (a.list.length ? 1 : 0) || b.v - a.v);
}

/** แถบรวม 100% ของสินทรัพย์ แบ่งสีตามหมวด (มองแวบเดียวเห็นว่าก้อนไหนใหญ่) · ชี้แต่ละช่วงเห็นชื่อหมวด + % */
function StackBar({ parts }: { parts: { k: string; label: string; pct: number }[] }) {
  const shown = parts.filter((p) => p.pct > 0);
  if (!shown.length) return null;
  return (
    <div className="mb-1 flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img"
      aria-label={`สัดส่วนสินทรัพย์: ${shown.map((p) => `${p.label} ${p.pct.toFixed(1)}%`).join(" · ")}`}>
      {shown.map((p) => (
        <div key={p.k} className="h-full border-r-2 border-white last:border-r-0" title={`${p.label} ${p.pct.toFixed(1)}%`}
          style={{ width: `${p.pct}%`, background: GROUP_COLOR[p.k] }} />
      ))}
    </div>
  );
}

/** สัดส่วน 7 หมวด (% ของสินทรัพย์รวม) · ต่อด้วยหนี้สิน (ใช้ทั้งภาพรวมครอบครัวและรายคน)
 *  4 พ.ย. 2026 (แบบ ข.): แถบรวม 100% ด้านบน · หมวดเรียงมาก → น้อย · ตัวเลขหนา % บางอยู่หลังตัวเลข · แถบหนา 10px สีสด
 *  รายการของแต่ละหมวดอยู่ใน pop up "ดูรายละเอียด ›" · ไม่มีบรรทัด Net Worth ท้ายกล่อง (ซ้ำกับการ์ดบนสุด) */
function Allocation({ g: { byKey, total, liabs, liabTotal } }: { g: Grouped }) {
  const groups = sortedGroups(byKey);
  return (
    // กล่องกว้าง (เนื้อใน ≥ 40rem): 2 คอลัมน์ คอลัมน์ละ 4 แถว (เรียงลงก่อน: คอลัมน์ซ้าย = 4 หมวดใหญ่สุด) · แคบกว่า: แถวเดียวเรียงลง
    // ดูจากความกว้างกล่องเอง (@container/alloc · 3 พ.ย. 2026) · กล่องสูงกว่าเนื้อหา (ข้างกล่องรายบุคคลที่ยาวกว่า) → แถวกระจายลงให้ขอบล่างตรงกัน
    <div className="@container/alloc flex flex-1 flex-col">
    <StackBar parts={groups.map((x) => ({ k: x.k, label: x.label, pct: total ? (x.v / total) * 100 : 0 }))} />
    <div className="flex flex-1 flex-col justify-between text-sm @min-[40rem]/alloc:grid @min-[40rem]/alloc:justify-normal @min-[40rem]/alloc:grid-flow-col @min-[40rem]/alloc:grid-rows-[repeat(4,auto)] @min-[40rem]/alloc:content-between @min-[40rem]/alloc:gap-x-8">
      {groups.map(({ k, label, list, v }) => (
        // หมวดที่ยังไม่มีรายการ: ตัวหนังสือสีเทา (ไม่ทำจาง) · แสดง — แทนตัวเลข
        <div key={k} className={`py-2 ${list.length ? "" : "text-slate-500"}`}>
          <AllocRow color={GROUP_COLOR[k]} label={label} pct={total ? (v / total) * 100 : 0} value={v} count={list.length} />
        </div>
      ))}
      {liabs.length > 0 && (
        <div className="py-2"><AllocRow color={LIAB_COLOR} label="หนี้สิน" pct={total ? (liabTotal / total) * 100 : undefined} value={-liabTotal} count={liabs.length} negative /></div>
      )}
    </div>
    </div>
  );
}

/** pop up ของกล่องสัดส่วน (ตกลง 2 พ.ย. 2026 · แบบ ก.): หมวดละบรรทัดเหมือนในกล่อง (เรียงมาก → น้อย) กดหมวดเพื่อกางรายการใต้บรรทัด
 *  (ชื่อรายการ · % ในหมวด · มูลค่า) · หมวดที่ไม่มีรายการไม่แสดง · ต่อด้วยหนี้สิน · ใช้ <details> → กางได้โดยไม่ต้องมี JavaScript */
function AllocationDetail({ g: { byKey, total, liabs, liabTotal }, showShare }: { g: Grouped; showShare: boolean }) {
  const groups = sortedGroups(byKey).filter((x) => x.list.length);
  if (!groups.length && !liabs.length) return <p className="text-sm text-slate-500">ยังไม่มีรายการ</p>;
  const row = (key: string, color: string, label: string, items: Item[], sum: number, pct?: number, negative?: boolean) => (
    <details key={key} className="group border-b border-slate-100">
      <summary className="-mx-2 flex cursor-pointer list-none items-start gap-1.5 rounded-md px-2 py-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 text-xs text-slate-400 transition-transform group-open:rotate-90" aria-hidden="true">▸</span>
        <div className="min-w-0 flex-1"><AllocRow color={color} label={label} pct={pct} value={negative ? -sum : sum} count={items.length} negative={negative} /></div>
      </summary>
      <div className="mb-3 ml-[1.125rem] rounded-lg bg-slate-50 px-3 py-2">
        <ItemTable items={items} sum={sum} showShare={showShare} negative={negative} />
      </div>
    </details>
  );
  return (
    <div className="space-y-2">
      <StackBar parts={groups.map((x) => ({ k: x.k, label: x.label, pct: total ? (x.v / total) * 100 : 0 }))} />
      <div className="@container/alloc text-sm">
        {groups.map(({ k, label, list, v }) => row(k, GROUP_COLOR[k], label, list, v, total ? (v / total) * 100 : 0))}
        {liabs.length > 0 && row("liab", LIAB_COLOR, "หนี้สิน", liabs, liabTotal, total ? (liabTotal / total) * 100 : undefined, true)}
      </div>
      <p className="text-xs text-slate-500">กดหมวดที่มี ▸ เพื่อดูรายการ · % ในบรรทัดหมวด = ของสินทรัพย์รวม · % ในรายการ = ของหมวดนั้น</p>
    </div>
  );
}

/** แถวหมวด: ชื่อ (จำนวนรายการ) · ยอด · % (ตัวหนา · กว้างคงที่ → % ตรงกันทุกแถว) · แถบ 10px · ไม่มีเส้นคั่นแถว (แถบสีคั่นอยู่แล้ว)
 *  4 พ.ย. 2026: % หนา ยอดไม่หนา (กล่องนี้คือ "สัดส่วน") · เหมือนกล่องรายบุคคล
 *  หนี้สิน (negative): % ของสินทรัพย์รวม (ฐานเดียวกับหมวดอื่น = ตัวเลขในการ์ดหนี้สิน) สีแดง + แถบแดงบนรางเทา */
function AllocRow({ color, label, pct, value, count, negative }: { color: string; label: string; pct?: number; value: number; count: number; negative?: boolean }) {
  // หนี้สิน: ทศนิยมแบบเดียวกับการ์ดหนี้สิน (ต่ำกว่า 10% → 2 ตำแหน่ง เช่น 0.11%)
  const pctText = pct == null || !count ? "" : `${pct.toFixed(negative && pct < 10 ? 2 : 1)}%`;
  return (
    // คอลัมน์ตามความกว้างกล่อง (@container/alloc): แคบ = ชื่อ · ยอด · % แล้วแถบใต้ · 30–40rem = ชื่อ | แถบ | ยอด | % แถวเดียว · ≥ 40rem (2 คอลัมน์) = แบบแคบ
    <div className="grid grid-cols-[minmax(0,1fr)_auto_3.5rem] items-center gap-x-3 gap-y-1.5 @min-[30rem]/alloc:grid-cols-[11rem_1fr_8.5rem_3.5rem] @min-[40rem]/alloc:grid-cols-[minmax(0,1fr)_auto_3.5rem]">
      <span className="flex min-w-0 items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} /><span className="truncate">{label}</span>
        <span className="shrink-0 text-xs text-slate-400">{count ? `(${count})` : ""}</span>
      </span>
      <div className={`col-span-3 row-start-2 h-2.5 overflow-hidden rounded-full bg-slate-100 ${pct == null ? "invisible" : ""} @min-[30rem]/alloc:col-span-1 @min-[30rem]/alloc:row-start-auto @min-[40rem]/alloc:col-span-3 @min-[40rem]/alloc:row-start-2`}>
        {pct != null && pct > 0 && <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, minWidth: 4, background: color }} />}
      </div>
      <span className={`text-right tabular-nums ${negative ? "text-red-700" : count ? "text-slate-700" : ""}`}>{count ? baht(value) : "—"}</span>
      <span className={`text-right font-semibold tabular-nums ${negative ? "text-red-700" : "text-slate-900"}`}>{pctText}</span>
    </div>
  );
}

/** รายการในหมวดที่กาง: ชื่อ · % ในหมวด · มูลค่า (ยอดรวมอยู่ที่บรรทัดหมวดแล้ว) */
function ItemTable({ items, sum, showShare, negative }: { items: Item[]; sum: number; showShare: boolean; negative?: boolean }) {
  const money = (v: number) => <span className={negative ? "text-red-700" : ""}>{negative ? "\u2212" : ""}{baht(v)}</span>;
  return (
    // table-fixed + กว้างคอลัมน์คงที่ → คอลัมน์ % และมูลค่าตรงกันทุกหมวด
    <table className="w-full table-fixed text-sm">
      <colgroup><col /><col className="w-14 sm:w-24" /><col className="w-[6.5rem] sm:w-36" /></colgroup>
      <tbody className="divide-y divide-slate-100">
        {items.map((i, k) => (
          <tr key={k}>
            <td className="py-1 pr-3 [overflow-wrap:anywhere]">{i.item_name}{showShare && i.share_note
              ? <span className="text-xs text-slate-400"> · {i.share_note}</span>
              : showShare && i.ownership_percent && Number(i.ownership_percent) < 100
                ? <span className="text-xs text-slate-400"> · ถือ {Number(Number(i.ownership_percent).toFixed(2))}%</span> : null}</td>
            <td className="py-1 pr-3 text-right text-xs tabular-nums text-slate-500">{sum ? `${((Number(i.base_value) * 100) / sum).toFixed(1)}%` : ""}</td>
            <td className="py-1 text-right tabular-nums whitespace-nowrap">{money(Number(i.base_value))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** ตัวเลขของกล่อง "Net Worth เปลี่ยนเพราะอะไร" · ใช้ทั้งในกล่องและใน pop up (กดบรรทัดเพื่อกางรายละเอียด) */
async function changeBridge(start: string, isCurrent: boolean, personId: string): Promise<Bridge | null> {
  // รวมกล่อง "รายได้ & ค่าใช้จ่าย": เงินคงเหลือสุทธิ (ยอดย่อย) = รายได้สุทธิหลังภาษี + รายได้ลงทุน − ค่าใช้จ่ายสุทธิ — ยอดเดียวกับหน้ารายได้ / ค่าใช้จ่าย
  const [dm, p, track, ig] = await Promise.all([getMonth(start), personId ? getPersonDash(start, personId) : getPreview(start), getTrack(start),
    getInvGain(start, personId)]);
  if (p?.prev_net_worth == null) return null;
  const cur = personId ? Number(dm?.by_person.find((x) => x.person_id === personId)?.net_worth ?? 0) : Number(dm?.net_worth ?? 0);
  const expense = Number(p.expenses) - Number(p.reimbursements);
  const net = Number(p.income) + Number(p.investment_income) - expense;
  const gain = Number(ig?.gain ?? 0), fx = Number(ig?.fx ?? 0);
  const other = cur - Number(p.prev_net_worth) - net - gain;
  return {
    prevLabel: p.prev_label ?? "ยอดงวดก่อน", prev: Number(p.prev_net_worth), income: Number(p.income), investment: Number(p.investment_income),
    expense, expenseUntracked: track === "NOT_TRACKED" && !expense, net,
    gain: dm ? gain : 0, fx: dm ? fx : 0, other: dm ? other : 0, cur, endLabel: isCurrent ? "= ณ วันนี้" : "= ณ สิ้นเดือน", person: !!personId,
  };
}

async function ChangeBody({ start, isCurrent, personId }: { start: string; isCurrent: boolean; personId: string }) {
  const b = await changeBridge(start, isCurrent, personId);
  if (!b) return <p className="text-sm text-slate-500">ยังไม่มียอดงวดก่อนให้เทียบ</p>;
  return (
    // บรรทัดสรุป "= ณ วันนี้" แยกจากตาราง: เว้นระยะด้านบน ไม่มีเส้น · กล่องสูงกว่าเนื้อหา → อยู่ล่างสุด (แบบ "รวมครอบครัว" · 5 พ.ย. 2026)
    <div className="flex flex-1 flex-col text-sm">
    <table className="w-full">
      <tbody className="divide-y divide-slate-100">
        <BRow label={b.prevLabel} v={b.prev} bold />
        <BRow label="+ รายได้สุทธิ (หลังภาษี)" v={b.income} />
        <BRow label={b.person ? "+ รายได้ลงทุน (ตามสัดส่วนถือ)" : "+ รายได้ลงทุน"} v={b.investment} />
        {/* ค่าใช้จ่าย: ชื่อบรรทัดมี "−" แล้ว ตัวเลขจึงไม่ติดลบซ้ำ · ยอดย่อย "เงินคงเหลือสุทธิ" เป็นบรรทัดเล็กสีเทา (ไม่ใช่บรรทัดที่บวกเพิ่ม) */}
        {b.expenseUntracked
          ? <tr><td className="py-1 pr-2">− ค่าใช้จ่ายสุทธิ</td><td className="text-right text-xs text-slate-500">ยังไม่ได้บันทึก</td></tr>
          : <BRow label={b.person ? "− ค่าใช้จ่ายสุทธิ (ที่ระบุชื่อ)" : "− ค่าใช้จ่ายสุทธิ"} v={b.expense} />}
        <tr className="text-xs text-slate-500">
          <td className="py-0.5 pl-3 pr-2">ยอดย่อย: เงินคงเหลือสุทธิ</td>
          <td className={`text-right tabular-nums ${b.net < 0 ? "text-red-700" : ""}`}>{baht(b.net)}</td>
        </tr>
        <BRow label={b.person ? "± กำไร / ขาดทุนเงินลงทุน (ตามสัดส่วนถือ)" : "± กำไร / ขาดทุนเงินลงทุน"} v={b.gain} signed
          note={b.fx ? <>ในนั้นจาก FX {b.fx > 0 ? "+" : ""}{baht(b.fx)}</> : null} />
        <BRow label="± มูลค่าเปลี่ยน / อื่น ๆ" v={b.other} signed />
      </tbody>
    </table>
    <div className="mt-auto flex items-baseline justify-between gap-2 pt-2 font-medium">
      <span>{b.endLabel}</span>
      <span className={`tabular-nums ${b.cur < 0 ? "text-red-700" : "text-ink"}`}>{baht(b.cur)}</span>
    </div>
    </div>
  );
}

/** pop up: บรรทัดเดียวกับในกล่อง แต่กดบรรทัดเพื่อกางรายละเอียด (ตกลง 2 พ.ย. 2026 · แบบ ก.) */
async function ChangePopup({ start, isCurrent, personId }: { start: string; isCurrent: boolean; personId: string }) {
  const b = await changeBridge(start, isCurrent, personId);
  if (!b) return <p className="text-sm text-slate-500">ยังไม่มียอดงวดก่อนให้เทียบ</p>;
  return <ChangeDetail start={start} personId={personId} b={b} />;
}

async function PersonsBody({ start, ym, personId }: { start: string; ym: string; personId: string }) {
  const dm = await getMonth(start);
  const rows = [...(dm?.by_person ?? [])].sort((a, b) => (a.person_id ? 0 : 1) - (b.person_id ? 0 : 1) || Number(b.net_worth) - Number(a.net_worth));
  const total = Number(dm?.net_worth ?? 0);                                // % ของ Net Worth ครอบครัว (รวมส่วนที่ไม่ระบุเจ้าของ)
  if (!rows.length) return <p className="text-sm text-slate-500">ยังไม่มีข้อมูล</p>;
  return (
    // แถวละคน: ชื่อ · Net Worth · % แล้วแท่งสัดส่วนเต็มความกว้างใต้แถว (เดิมเป็นคอลัมน์แท่งในตาราง → กล่องแคบแล้วตัวเลขล้นขอบขวา)
    // กล่องสูงกว่าเนื้อหา (ข้างกล่องสัดส่วนที่ยาวกว่า) → บรรทัดรวมอยู่ล่างสุด ขอบล่างตรงกับกล่องข้าง ๆ
    <div className="flex flex-1 flex-col text-sm">
      <ul>
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
                <span className={`text-right tabular-nums ${v < 0 ? "text-red-700" : "text-slate-700"}`}>{baht(v)}</span>
                <span className={`text-right font-semibold tabular-nums ${pct < 0 ? "text-red-700" : "text-slate-900"}`}>{pct.toFixed(1)}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                {pct > 0 && <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />}
              </div>
            </li>
          );
        })}
      </ul>
      <div className={`${PROW} mt-auto pt-2`}>
        <span className="font-medium">รวมครอบครัว</span><span className="text-right tabular-nums text-slate-700">{baht(total)}</span><span className="text-right font-semibold tabular-nums text-slate-900">100.0%</span>
      </div>
    </div>
  );
}

/** คอลัมน์ของกล่องรายบุคคล: ชื่อ (ยืด / ตัด …) · ความมั่งคั่งสุทธิ · % (ตัวหนา หลังตัวเลข · กว้างคงที่ → ตรงกันทุกแถว · 4 พ.ย. 2026) · ไม่มีเส้นคั่นแถว */
const PROW = "grid grid-cols-[minmax(0,1fr)_auto_3.5rem] items-center gap-x-3";

/** การ์ดตัวเลขบน (2 พ.ย. 2026 ตามภาพที่เจ้าของส่งมา · 3 พ.ย. 2026 เส้นเล็กเปลี่ยนเป็นแถวข้อมูล):
 *  แถวบน   ชื่อการ์ด · คน ................ ป้าย ▲/▼ ยอดเปลี่ยน (%)   (เขียว = ดีขึ้น · แดง = แย่ลง · หนี้ลด = ดีขึ้น · ลูกศร = ทิศของยอด)
 *  แถวกลาง [ไอคอน] ตัวใหญ่ "ล้านบาท" + เลขเต็มใต้
 *  แถวข้อมูล สภาพคล่อง / หนี้ต่อสินทรัพย์ / เปลี่ยนไปในแต่ละช่วง (ข้อมูลที่กราฟใหญ่ไม่ได้บอก)
 *  แถวล่าง บรรทัดอธิบาย (ณ วันนี้ / ค่างวดรวม / หลังหักหนี้สิน) ........ เทียบกับ…
 *  ไม่ใช้ปุ่มมน (ดูเหมือนกดได้แต่กดไม่ได้) · ไม่ใช้พื้นไล่สี · ไอคอนซ่อนบนมือถือ */
function Big({ label, shortLabel, who, value, base, baseLabel, inverse, hero, icon, insight, note, noteTitle }: {
  label: string; shortLabel?: string; who: string; value: number; base: number | null; baseLabel?: string; inverse?: boolean; hero?: boolean;
  icon: ReactNode; insight: ReactNode; note: ReactNode; noteTitle?: string;
}) {
  // ปัดเป็นบาท (เหมือนตัวเลขที่แสดง) แล้วต่างกัน 0 = "ไม่เปลี่ยนแปลง"
  const diff = base == null ? null : Math.round(Number(value) - base);
  const good = diff == null ? null : inverse ? diff <= 0 : diff >= 0;
  // ทุกการ์ดเป็น "ล้านบาท" แม้ต่ำกว่า 1 ล้าน (เช่น หนี้สิน 0.80 ล้านบาท) → 3 การ์ดมีบรรทัดเหมือนกัน
  const m = millions(value, true);
  const pct = diff && base ? Math.abs((diff / Math.abs(base)) * 100).toFixed(2) : null;
  // "สิ้นเดือน ต.ค. 2569 (อัตโนมัติ)" → "สิ้นเดือน ต.ค. 2569" (ชื่อเต็มอยู่ใน title เมื่อชี้)
  const shortBase = (baseLabel ?? "").replace(/\s*\([^)]*\)\s*$/, "");
  const t = hero ? TONE.hero : TONE.card;
  return (
    <div className={`@container min-w-0 rounded-xl border p-4 sm:p-5 xl:p-4 ${hero ? `${HERO} ${HERO_BG}` : "border-slate-200 bg-white"}`}
      style={hero ? { boxShadow: "var(--card-shadow)" } : undefined}>
      <div className="flex items-start justify-between gap-2">
        {/* บรรทัดเดียว (ยาวตัด …) → เปลี่ยนคนแล้วกล่องไม่สูง / เตี้ยลง · ต่อท้ายชื่อคน / "ทั้งครอบครัว" (ตกลง PR #204)
            การ์ดแคบ (เนื้อใน < 15rem: มือถือ) ใช้ชื่อสั้น (สินทรัพย์ / หนี้สิน) ไม่มีที่ต่อชื่อคน → ชื่อคนอยู่ที่การ์ดความมั่งคั่งสุทธิ (เต็มแถว)
            ดูจากความกว้างของการ์ดเอง (@container) ไม่ใช่ขนาดจอ (3 พ.ย. 2026) */}
        <div className={`min-w-0 truncate pt-0.5 text-xs ${t.label}`} title={`${label} · ${who}`}>
          {shortLabel ? <><span className="@min-[15rem]:hidden">{shortLabel}</span><span className="hidden @min-[15rem]:inline">{label}</span></> : label}
          <span className={hero ? "" : "hidden @min-[15rem]:inline"}> · {who}</span>
        </div>
        {diff != null && (diff === 0
          ? <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${t.same}`}>ไม่เปลี่ยนแปลง</span>
          : <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${good ? t.up : t.down}`}
              title={`${diff > 0 ? "เพิ่มขึ้น" : "ลดลง"} ${baht(Math.abs(diff))} บาท จาก${baseLabel}`}>
              <Arrow up={diff > 0} />
              <span className="sr-only">{diff > 0 ? "เพิ่มขึ้น" : "ลดลง"}</span>
              {/* การ์ดแคบ (เนื้อใน < 20rem): แสดงแค่ % ให้ป้ายพอดี (ยอดเต็มอยู่ใน title เมื่อชี้) */}
              {pct && <span className="@min-[20rem]:hidden">{pct}%</span>}
              <span className={pct ? "hidden @min-[20rem]:inline" : ""}>{diff > 0 ? "+" : "\u2212"}{baht(Math.abs(diff))}{pct ? ` (${diff > 0 ? "+" : "\u2212"}${pct}%)` : ""}</span>
            </span>)}
      </div>
      <div className={CARD_SPLIT}>
      <div className="mt-2 flex items-end gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:flex ${hero ? t.icon : inverse ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>{icon}</span>
          <div className="min-w-0">
            {/* ขนาดตัวเลขเป็น text-[…] ไม่ใช่ text-xl / text-2xl: globals.css มีกฎ .text-2xl.tabular-nums บังคับสีเกือบดำ (#0b1220) */}
            <div className={`whitespace-nowrap font-semibold leading-tight tracking-tight tabular-nums ${t.num} ${hero ? "text-[1.75rem] sm:text-3xl" : "text-[1.25rem] sm:text-[1.5rem]"}`}>
              {m ?? baht(value)}<span className={`ml-1.5 text-sm font-normal tracking-normal ${t.sub}`}>{m ? "ล้านบาท" : "บาท"}</span>
            </div>
            {m && <div className={`text-xs tabular-nums ${t.sub}`}>{baht(value)} บาท</div>}
          </div>
        </div>
      </div>
      <div className={INSIGHT_GAP}>{insight}</div>
      </div>
      <div className={`mt-2 flex items-baseline justify-between gap-2 text-xs ${t.sub}`}>
        <span className="min-w-0 truncate" title={noteTitle ?? (typeof note === "string" ? note : undefined)}>{note}</span>
        {/* การ์ดแคบ (เนื้อใน < 20rem เช่น 3 การ์ดบนจอ 1,280) ไม่มีที่ → ซ่อน "จาก…" ไม่ให้บรรทัดซ้ายถูกตัด (ป้ายด้านบนมี title บอกฐานเทียบ) */}
        {diff != null && shortBase && <span className="hidden shrink-0 @min-[20rem]:inline" title={`จาก${baseLabel}`}>จาก{shortBase}</span>}
      </div>
    </div>
  );
}

function BRow({ label, v, bold, signed, note }: { label: string; v: number; bold?: boolean; signed?: boolean; note?: ReactNode }) {
  // ตัวเลขสีดำ · ติดลบเท่านั้นเป็นสีแดง (ตกลง 1 พ.ย. 2026) · signed = บรรทัด ± ใส่ "+" หน้ายอดบวก · note = บรรทัดเล็กใต้ชื่อ (ไม่บวกเพิ่ม)
  return (
    <tr className={bold ? "font-medium" : ""}>
      <td className="py-1 pr-2 xl:py-0.5">{label}
        {note && <div className="pl-3 text-xs font-normal text-slate-500">{note}</div>}</td>
      <td className={`text-right align-top pt-1 xl:pt-0.5 tabular-nums ${v < 0 ? "text-red-700" : bold ? "text-ink" : ""}`}>{signed && Math.round(v) > 0 ? "+" : ""}{baht(v)}</td>
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
