import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { INCOME_TYPE_LABEL, LEASE_STATUS, PROPERTY_TYPE_LABEL, USAGE_LABEL, addDays, landText, money, monthOptions, monthRange, thDate, thMonth, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import MonthPicker from "@/components/MonthPicker";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { TabNav, TabPanel, TabsProvider } from "../income-expenses/tabs";

type Prop = { id: string; asset_id: string; property_type: string; usage_type: string; location_group: string | null;
  land_area_sq_wa: number | null;
  assets: { name: string; currency: string; current_value: number | null; current_value_date: string | null; status: string;
    acquisition_cost: number | null; acquisition_date: string | null } };
type Lease = { id: string; property_asset_id: string; tenant_name: string; unit_label: string | null; rent_amount: number;
  rent_currency: string; payment_frequency: string; start_date: string; end_date: string; lease_status: string };
type Inc = { id: string; asset_id: string; lease_id: string | null; income_type: string; date: string; amount: number; currency: string; base_amount: number | null; notes: string | null };
type Exp = { id: string; related_asset_id: string | null; property_utility_id: string | null; date: string; description: string;
  amount: number; currency: string; base_amount: number | null };

const TABS: [string, string][] = [["overview", "ภาพรวม"], ["all", "ทรัพย์สินทั้งหมด"], ["income", "รายได้และสัญญาเช่า"], ["expense", "ค่าใช้จ่าย"]];
const TYPE_COLORS: Record<string, string> = { LAND: "#3b82f6", HOUSE: "#8b5cf6", CONDO: "#10b981", OTHER: "#f59e0b" };
// การใช้งาน → กลุ่มที่แสดงในภาพรวม
const USAGE_GROUP: Record<string, string> = { RENTAL: "RENTAL", OWNER_OCCUPIED: "LIVE", PERSONAL_USE: "LIVE", VACANT: "VACANT", BUSINESS_USE: "BUSINESS", OTHER: "OTHER" };
const GROUPS: { key: string; label: string; color: string }[] = [
  { key: "RENTAL", label: "ปล่อยเช่า", color: "#3b82f6" },
  { key: "LIVE", label: "อยู่อาศัย / ใช้ส่วนตัว", color: "#10b981" },
  { key: "VACANT", label: "ว่าง / ยังไม่ใช้ประโยชน์", color: "#f59e0b" },
  { key: "BUSINESS", label: "ใช้ในกิจการ", color: "#8b5cf6" },
  { key: "OTHER", label: "อื่น ๆ", color: "#64748b" },
];
const PER_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };
const FREQ_TEXT: Record<string, string> = { MONTHLY: "/เดือน", QUARTERLY: "/ไตรมาส", YEARLY: "/ปี", OTHER: "" };

type Sp = Promise<{ tab?: string; m?: string; p?: string; order?: string }>;

export default async function PropertyPage({ searchParams }: { searchParams: Sp }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const today = todayBangkok();
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : "overview";
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? (sp.m as string) : today.slice(0, 7);
  const { start, end } = monthRange(ym);
  const yearStart = `${ym.slice(0, 4)}-01-01`;
  const pv = await loadPersonView(sp.p);
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const paths = ["/property"];

  const [{ data, error }, { data: leases }, { data: owners }, { data: fx }, { data: family }, sortMap] = await Promise.all([
    supabase.from("property_details")
      .select("id,asset_id,property_type,usage_type,location_group,land_area_sq_wa,assets!inner(name,currency,current_value,current_value_date,status,acquisition_cost,acquisition_date,deleted_at)")
      .is("deleted_at", null).is("assets.deleted_at", null).order("created_at"),
    supabase.from("v_lease_status").select("id,property_asset_id,tenant_name,unit_label,rent_amount,rent_currency,payment_frequency,start_date,end_date,lease_status")
      .in("lease_status", ["ACTIVE", "EXPIRING_SOON", "UPCOMING"]),
    supabase.from("v_asset_ownerships_active").select("asset_id,person_name,ownership_percent,end_date"),
    supabase.from("v_fx_status").select("currency,rate_to_thb"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    loadSortMap("assets"),
  ]);
  const allProps = (data as unknown as Prop[] | null) ?? [];
  const ids = allProps.map((p) => p.asset_id);
  const none = Promise.resolve({ data: [] as never[] });
  const { data: utils } = allProps.length
    ? await supabase.from("property_utilities").select("id,property_id").in("property_id", allProps.map((p) => p.id))
    : { data: [] as { id: string; property_id: string }[] };
  const utilProp = new Map(((utils ?? []) as { id: string; property_id: string }[])
    .map((u) => [u.id, allProps.find((p) => p.id === u.property_id)?.asset_id ?? ""]));
  const expCols = "id,related_asset_id,property_utility_id,date,description,amount,currency,base_amount";
  const [{ data: incRaw }, { data: expA }, { data: expU }] = await Promise.all([
    ids.length ? supabase.from("income_transactions").select("id,asset_id,lease_id,income_type,date,amount,currency,base_amount,notes")
      .in("asset_id", ids).gte("date", yearStart).lte("date", end).is("deleted_at", null).order("date", { ascending: false }) : none,
    ids.length ? supabase.from("expense_items").select(expCols).in("related_asset_id", ids).gte("date", start).lte("date", end).is("deleted_at", null) : none,
    utilProp.size ? supabase.from("expense_items").select(expCols).in("property_utility_id", [...utilProp.keys()]).gte("date", start).lte("date", end).is("deleted_at", null) : none,
  ]);

  const rate = new Map<string, number>([["THB", 1], ...((fx ?? []).map((r) => [r.currency as string, Number(r.rate_to_thb)] as [string, number]))]);
  const thb = (v: number | null | undefined, c: string) => Number(v ?? 0) * (rate.get(c) ?? 0);
  const props = bySort(allProps.filter((p) => pv.showAsset(p.asset_id)), (p) => p.asset_id, sortMap);
  const share = (id: string) => pv.assetShare(id);
  const valueOf = (p: Prop) => (p.assets.current_value == null ? null : thb(p.assets.current_value, p.assets.currency) * share(p.asset_id));
  const active = props.filter((p) => p.assets.status === "ACTIVE");
  const totalValue = active.reduce((t, p) => t + (valueOf(p) ?? 0), 0);
  const latestDate = active.map((p) => p.assets.current_value_date ?? "").sort().at(-1) || null;
  const pct = (v: number, t: number) => (t > 0 ? (v * 100) / t : 0);

  const byProp = new Map<string, Lease[]>();
  ((leases as Lease[] | null) ?? []).forEach((l) => byProp.set(l.property_asset_id, [...(byProp.get(l.property_asset_id) ?? []), l]));
  const ownRows = (owners ?? []).filter((o) => !o.end_date);
  const ownersOf = (id: string) => ownRows.filter((o) => o.asset_id === id);
  const propName = new Map(allProps.map((p) => [p.asset_id, p.assets.name]));
  const shown = new Set(props.map((p) => p.asset_id));

  // ---------------------------------------------------------------- รายได้ / ค่าใช้จ่าย (ส่วนของสมาชิกที่เลือก = ตามสัดส่วนความเป็นเจ้าของทรัพย์สิน)
  const baseOf = (x: { base_amount: number | null; amount: number; currency: string }) => (x.base_amount != null ? Number(x.base_amount) : thb(x.amount, x.currency));
  const incAll = ((incRaw as Inc[] | null) ?? []).filter((x) => shown.has(x.asset_id));
  const incMonth = incAll.filter((x) => x.date >= start);
  const incOf = (x: Inc) => baseOf(x) * share(x.asset_id);
  const ytdRent = new Map<string, number>();
  incAll.forEach((x) => ytdRent.set(x.asset_id, (ytdRent.get(x.asset_id) ?? 0) + incOf(x)));
  const expRows = [...new Map([...((expA as Exp[] | null) ?? []), ...((expU as Exp[] | null) ?? [])].map((x) => [x.id, x])).values()]
    .map((x) => ({ ...x, prop: x.related_asset_id && shown.has(x.related_asset_id) ? x.related_asset_id : utilProp.get(x.property_utility_id ?? "") ?? "" }))
    .filter((x) => shown.has(x.prop)).sort((a, b) => b.date.localeCompare(a.date));
  const expOf = (x: (typeof expRows)[number]) => baseOf(x) * share(x.prop);
  const incTotal = incMonth.reduce((t, x) => t + incOf(x), 0);
  const expTotal = expRows.reduce((t, x) => t + expOf(x), 0);

  // ค่าเช่าตามสัญญา (เทียบต่อเดือน)
  const monthlyRent = (id: string) => (byProp.get(id) ?? []).filter((l) => l.lease_status !== "UPCOMING")
    .reduce((t, l) => t + (PER_MONTHS[l.payment_frequency] ? thb(l.rent_amount, l.rent_currency) / PER_MONTHS[l.payment_frequency] : 0), 0) * share(id);

  // ---------------------------------------------------------------- กล่องภาพรวม
  const typeRows = Object.keys(PROPERTY_TYPE_LABEL).map((k) => {
    const ps = active.filter((p) => p.property_type === k);
    return { key: k, label: PROPERTY_TYPE_LABEL[k], n: ps.length, value: ps.reduce((t, p) => t + (valueOf(p) ?? 0), 0), color: TYPE_COLORS[k] ?? "#64748b" };
  }).filter((r) => r.n > 0).sort((a, b) => b.value - a.value);
  const usageRows = GROUPS.map((g) => {
    const ps = active.filter((p) => (USAGE_GROUP[p.usage_type] ?? "OTHER") === g.key);
    return { ...g, n: ps.length, value: ps.reduce((t, p) => t + (valueOf(p) ?? 0), 0) };
  }).filter((r) => r.n > 0 && (r.value > 0 || ["RENTAL", "LIVE", "VACANT"].includes(r.key)));
  const months = monthOptions(family?.go_live_date, today, 0, ym);
  const mLabel = ym === today.slice(0, 7) ? "เดือนนี้" : thMonth(start);
  const old = addDays(today, -90);
  const card = "rounded-xl border border-slate-200 bg-white p-5";

  return (
    <TabsProvider initial={tab}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Property</h1>
          <p className="text-sm text-slate-500">อสังหาริมทรัพย์ทุกการใช้งาน · สัญญาเช่า · ค่าเช่า · ค่าใช้จ่าย</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <PersonFilter persons={pv.persons} value={pv.personId} />
          <MonthPicker months={months} value={ym} />
          {me.role !== "VIEWER" && (
            <Link href="/property/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มทรัพย์สิน</Link>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <TabNav tabs={TABS} />

      <TabPanel id="overview">
        <section className="grid gap-4 xl:grid-cols-[1fr_1fr_17rem]">
          <div className={card}>
            <h2 className="font-medium text-slate-900">มูลค่ารวม</h2>
            <div className="mt-1 text-xl font-semibold tabular-nums">{money(totalValue, "THB")}</div>
            <p className="text-xs text-slate-500">รวม {active.length} รายการ{latestDate && ` · ประเมินล่าสุด ${thDate(latestDate)}`}</p>
            <ShareRows label="ประเภท" rows={typeRows} total={totalValue} />
          </div>
          <div className={card}>
            <h2 className="font-medium text-slate-900">มูลค่าตามการใช้งาน</h2>
            <p className="text-xs text-slate-500">รวม {money(totalValue, "THB")}</p>
            {totalValue > 0 && (
              <div className="mt-3 flex h-6 overflow-hidden rounded-md text-[11px] font-medium text-white">
                {usageRows.filter((r) => r.value > 0).map((r) => {
                  const w = pct(r.value, totalValue);
                  return <div key={r.key} className="flex items-center justify-center" style={{ width: `${w}%`, background: r.color }}>{w >= 8 ? `${w.toFixed(0)}%` : ""}</div>;
                })}
              </div>
            )}
            <ShareRows label="การใช้งาน" rows={usageRows} total={totalValue} />
          </div>
          <div className="grid gap-3">
            <div className={card}>
              <div className="text-xs text-slate-500">รายได้จากทรัพย์สิน{mLabel}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">+{money(incTotal, "THB")}</div>
              <div className="text-xs text-slate-500">{incMonth.length} รายการ</div>
            </div>
            <div className={card}>
              <div className="text-xs text-slate-500">ค่าใช้จ่ายทรัพย์สิน{mLabel}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-red-700">−{money(expTotal, "THB")}</div>
              <div className="text-xs text-slate-500">{expRows.length} รายการ</div>
            </div>
            <div className={card}>
              <div className="text-xs text-slate-500">รายได้สุทธิ{mLabel}</div>
              <div className={`mt-1 text-xl font-semibold tabular-nums ${incTotal - expTotal >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                {incTotal - expTotal >= 0 ? "+" : "−"}{money(Math.abs(incTotal - expTotal), "THB")}</div>
              <div className="text-xs text-slate-500">รายได้ − ค่าใช้จ่าย</div>
            </div>
          </div>
        </section>
        <p className="-mt-3 text-xs text-slate-500">
          มูลค่า = มูลค่าประเมินล่าสุด{pv.personId && ` · แสดงเฉพาะส่วนของ ${pv.personName} ตามสัดส่วนความเป็นเจ้าของ`} · สกุลอื่นแปลงเป็นบาทด้วยอัตราล่าสุด
        </p>
      </TabPanel>

      <TabPanel id="all">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
            <h2 className="font-medium text-slate-900">ทรัพย์สินทั้งหมด</h2>
            {canOrder && props.length > 1 && <SortToggle active={ordering} {...orderHrefs("/property", { p: sp.p, m: sp.m, tab: "all" })} />}
          </div>
          <table className="mt-2 w-full min-w-[56rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-3 py-2">ทรัพย์สิน</th><th className="px-3">เจ้าของ</th><th className="px-3">การใช้งาน</th>
                <th className="px-3 text-right">มูลค่าที่ซื้อ (THB)</th><th className="px-3 text-right">มูลค่าล่าสุด (THB)</th>
                <th className="px-3 text-right">รายได้ค่าเช่า (THB)</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {props.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">{pv.personId ? `ไม่มีทรัพย์สินของ ${pv.personName}` : "ยังไม่มีทรัพย์สิน"}</td></tr>}
              {props.map((p, i) => {
                const ls = byProp.get(p.asset_id) ?? [];
                const stale = !p.assets.current_value_date || p.assets.current_value_date < old;
                const os = ownersOf(p.asset_id);
                const cost = p.assets.acquisition_cost == null ? null : thb(p.assets.acquisition_cost, p.assets.currency) * share(p.asset_id);
                const rent = monthlyRent(p.asset_id);
                const ytd = ytdRent.get(p.asset_id) ?? 0;
                return (
                  <tr key={p.id} className={`align-top hover:bg-slate-50 ${p.assets.status !== "ACTIVE" ? "opacity-50" : ""}`}>
                    <td className="px-3 py-3">
                      {ordering && <span className="mr-2 align-middle"><MoveButtons table="assets" id={p.asset_id} paths={paths} {...neighbors(props, i, (x) => x.asset_id)} /></span>}
                      <Link href={`/property/${p.asset_id}`} className="font-medium text-slate-900 hover:underline">{p.assets.name}</Link>
                      <div className="text-xs text-slate-500">
                        {PROPERTY_TYPE_LABEL[p.property_type] ?? p.property_type}
                        {p.location_group && ` · ${p.location_group}`}
                        {p.land_area_sq_wa != null && ` · ${landText(p.land_area_sq_wa)}`}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-700">
                      {os.length === 0 ? <span className="text-amber-700">ยังไม่ระบุ</span>
                        : os.map((o) => <div key={o.person_name}>{o.person_name}{os.length > 1 && <span className="text-slate-400"> {Number(o.ownership_percent)}%</span>}</div>)}
                    </td>
                    <td className="px-3 py-3">{USAGE_LABEL[p.usage_type] ?? p.usage_type}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(cost)}
                      {p.assets.acquisition_date && <div className="text-xs text-slate-400">ซื้อ {thDate(p.assets.acquisition_date)}</div>}</td>
                    <td className="px-3 py-3 text-right font-medium tabular-nums">{money(valueOf(p))}
                      <div className={`text-xs font-normal ${stale ? "text-amber-700" : "text-slate-400"}`}>ณ {thDate(p.assets.current_value_date)}{stale && " · เกิน 90 วัน"}</div></td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {rent > 0 || ytd > 0 ? <>
                        <div>{money(rent)}<span className="text-xs text-slate-400"> /เดือน</span></div>
                        <div className="text-xs text-slate-500">รับจริงปีนี้ {money(ytd)}</div>
                      </> : <span className="text-slate-400">-</span>}
                      {ls.map((l) => (
                        <div key={l.id} className="mt-1 text-xs text-slate-500">
                          <span className={`mr-1 rounded px-1.5 py-0.5 ${LEASE_STATUS[l.lease_status]?.cls ?? ""}`}>{LEASE_STATUS[l.lease_status]?.text ?? l.lease_status}</span>
                          {[l.unit_label, l.tenant_name].filter(Boolean).join(" · ")} · ถึง {thDate(l.end_date)}
                        </div>
                      ))}
                      {p.usage_type === "RENTAL" && ls.length === 0 && <div className="mt-1 text-xs text-amber-700">ไม่มีสัญญาที่มีผล</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TabPanel>

      <TabPanel id="income">
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <h2 className="px-4 pt-4 font-medium text-slate-900">รายได้จากทรัพย์สิน · {thMonth(start)}</h2>
            <table className="mt-2 w-full min-w-[40rem] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-3 py-2">วันที่</th><th className="px-3">ทรัพย์สิน</th><th className="px-3">ประเภท</th><th className="px-3">รายละเอียด</th><th className="px-3 text-right">จำนวน (THB)</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {incMonth.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">ยังไม่มีรายได้ในเดือนนี้</td></tr>}
                {incMonth.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap px-3 py-2">{thDate(x.date)}</td>
                    <td className="px-3"><Link href={`/property/${x.asset_id}`} className="hover:underline">{propName.get(x.asset_id)}</Link></td>
                    <td className="px-3">{INCOME_TYPE_LABEL[x.income_type] ?? x.income_type}</td>
                    <td className="px-3 text-xs text-slate-500">{x.notes}</td>
                    <td className="px-3 text-right tabular-nums text-emerald-700">{money(incOf(x))}</td>
                  </tr>
                ))}
              </tbody>
              {incMonth.length > 0 && <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium"><tr><td colSpan={4} className="px-3 py-2">รวม</td><td className="px-3 text-right tabular-nums text-emerald-700">{money(incTotal)}</td></tr></tfoot>}
            </table>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <h2 className="px-4 pt-4 font-medium text-slate-900">สัญญาเช่าที่มีผล</h2>
            <table className="mt-2 w-full min-w-[40rem] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-3 py-2">ทรัพย์สิน</th><th className="px-3">ผู้เช่า</th><th className="px-3">สถานะ</th><th className="px-3">ระยะสัญญา</th><th className="px-3 text-right">ค่าเช่า</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {props.flatMap((p) => byProp.get(p.asset_id) ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">ไม่มีสัญญาเช่าที่มีผล</td></tr>}
                {props.flatMap((p) => (byProp.get(p.asset_id) ?? []).map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2"><Link href={`/property/${p.asset_id}`} className="hover:underline">{p.assets.name}</Link></td>
                    <td className="px-3">{[l.unit_label, l.tenant_name].filter(Boolean).join(" · ")}</td>
                    <td className="px-3"><span className={`rounded px-1.5 py-0.5 text-xs ${LEASE_STATUS[l.lease_status]?.cls ?? ""}`}>{LEASE_STATUS[l.lease_status]?.text ?? l.lease_status}</span></td>
                    <td className="whitespace-nowrap px-3 text-xs text-slate-500">{thDate(l.start_date)} – {thDate(l.end_date)}</td>
                    <td className="px-3 text-right tabular-nums">{money(l.rent_amount, l.rent_currency)}<span className="text-xs text-slate-400">{FREQ_TEXT[l.payment_frequency] ?? ""}</span></td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">บันทึกรับค่าเช่าได้ที่หน้าของทรัพย์สินแต่ละรายการ · ตารางบันทึกหลายรายการพร้อมกันจะเพิ่มในขั้นถัดไป</p>
        </div>
      </TabPanel>

      <TabPanel id="expense">
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <h2 className="px-4 pt-4 font-medium text-slate-900">ค่าใช้จ่ายทรัพย์สิน · {thMonth(start)}</h2>
            <table className="mt-2 w-full min-w-[36rem] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-3 py-2">วันที่</th><th className="px-3">ทรัพย์สิน</th><th className="px-3">รายการ</th><th className="px-3 text-right">จำนวน (THB)</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expRows.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">ยังไม่มีค่าใช้จ่ายในเดือนนี้</td></tr>}
                {expRows.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap px-3 py-2">{thDate(x.date)}</td>
                    <td className="px-3"><Link href={`/property/${x.prop}`} className="hover:underline">{propName.get(x.prop)}</Link></td>
                    <td className="px-3">{x.description}</td>
                    <td className="px-3 text-right tabular-nums text-red-700">{money(expOf(x))}</td>
                  </tr>
                ))}
              </tbody>
              {expRows.length > 0 && <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium"><tr><td colSpan={3} className="px-3 py-2">รวม</td><td className="px-3 text-right tabular-nums text-red-700">{money(expTotal)}</td></tr></tfoot>}
            </table>
          </div>
          <p className="text-xs text-slate-500">นับค่าใช้จ่ายที่ผูกกับทรัพย์สิน และค่าใช้จ่ายประจำ (ไฟ / น้ำ ฯลฯ) ของทรัพย์สิน · ตารางบันทึกหลายรายการพร้อมกันจะเพิ่มในขั้นถัดไป</p>
        </div>
      </TabPanel>
    </div>
    </TabsProvider>
  );
}

/** ตารางสัดส่วน: ชื่อ (จำนวนรายการ) · มูลค่า · % */
function ShareRows({ label, rows, total }: { label: string; rows: { key: string; label: string; n: number; value: number; color: string }[]; total: number }) {
  if (rows.length === 0) return <p className="mt-3 text-sm text-slate-500">ยังไม่มีข้อมูล</p>;
  return (
    <table className="mt-3 w-full text-sm">
      <thead className="text-left text-xs text-slate-500">
        <tr className="border-b border-slate-100"><th className="py-2 font-normal">{label}</th><th className="text-right font-normal">มูลค่า (THB)</th><th className="text-right font-normal">สัดส่วน</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="py-2.5"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: r.color }} />{r.label}
              <span className="ml-1 text-xs text-slate-400">({r.n} รายการ)</span></td>
            <td className="text-right tabular-nums text-slate-700">{money(r.value, undefined, 0)}</td>
            <td className="text-right tabular-nums text-slate-600">{(total > 0 ? (r.value * 100) / total : 0).toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
