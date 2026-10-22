import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { INCOME_TYPE_LABEL, LAND_TAX_RATE_BY_USAGE, LEASE_STATUS, PROPERTY_TYPE_LABEL, landTaxYears, USAGE_LABEL, UTIL_EXPENSE_CATEGORY, UTIL_LABEL, addDays, landText, money, monthOptions, monthRange, thDate, thMonth, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import { endpointValue } from "@/lib/money-endpoint";
import PersonFilter from "@/components/PersonFilter";
import MonthPicker from "@/components/MonthPicker";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import PropertyTable, { type PropRow } from "./PropertyTable";
import RentBatch, { type RentRow } from "./RentBatch";
import ExpenseBatch, { type CostRow, type PayOpt } from "./ExpenseBatch";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { TabNav, TabPanel, TabsProvider } from "../income-expenses/tabs";
import { StatBox } from "@/components/Boxes";
import LandTaxTable, { type TaxLineRow, type TaxPropRow } from "./LandTaxTable";

type Prop = { id: string; asset_id: string; property_type: string; usage_type: string; location_group: string | null;
  land_area_sq_wa: number | null;
  assets: { name: string; currency: string; current_value: number | null; current_value_date: string | null; status: string;
    acquisition_cost: number | null; acquisition_date: string | null } };
type Lease = { id: string; property_asset_id: string; tenant_name: string; unit_label: string | null; rent_amount: number;
  rent_currency: string; payment_frequency: string; start_date: string; end_date: string; lease_status: string };
type Inc = { id: string; asset_id: string; lease_id: string | null; received_to_asset_id: string | null; income_type: string; date: string; amount: number; currency: string; base_amount: number | null; notes: string | null };
type Exp = { id: string; related_asset_id: string | null; property_utility_id: string | null; date: string; description: string;
  amount: number; currency: string; base_amount: number | null };

// ทรัพย์สินทั้งหมดอยู่ท้ายแท็บภาพรวม (ลิงก์เดิม ?tab=all → ภาพรวม)
const TABS: [string, string][] = [["overview", "ภาพรวม"], ["income", "รายได้และสัญญาเช่า"], ["expense", "ค่าใช้จ่าย"]];
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

type Sp = Promise<{ tab?: string; m?: string; p?: string; order?: string; ty?: string }>;

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

  const canWrite = me.role !== "VIEWER";
  const [{ data, error }, { data: leases }, { data: fx }, { data: family }, sortMap, { data: rentTrack }, { data: costTrack },
    { data: bankRows }, { data: cardRows }] = await Promise.all([
    supabase.from("property_details")
      .select("id,asset_id,property_type,usage_type,location_group,land_area_sq_wa,assets!inner(name,currency,current_value,current_value_date,status,acquisition_cost,acquisition_date,deleted_at)")
      .is("deleted_at", null).is("assets.deleted_at", null).order("created_at"),
    supabase.from("v_lease_status").select("id,property_asset_id,tenant_name,unit_label,rent_amount,rent_currency,payment_frequency,start_date,end_date,lease_status")
      .in("lease_status", ["ACTIVE", "EXPIRING_SOON", "UPCOMING"]),
    supabase.from("v_fx_status").select("currency,rate_to_thb"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    loadSortMap("assets"),
    supabase.from("v_lease_rent_tracking").select("lease_id,property_asset_id,name,income_period,due_date,expected_amount,received_amount,currency,status").eq("income_period", start),
    supabase.from("v_property_cost_tracking").select("utility_id,property_asset_id,utility_type,provider,cost_period,due_date,expected_amount,paid_amount,currency,status")
      .eq("cost_period", start).order("utility_type"),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4,currency").is("deleted_at", null).neq("status", "CLOSED"),
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
  // ภาษีที่ดิน: ปีที่เลือก (?ty=) · ค่าเริ่มต้น = ปีของเดือนที่เลือก
  const { data: taxYearRows } = ids.length ? await supabase.from("property_tax_lines").select("tax_year").in("asset_id", ids).is("deleted_at", null) : { data: [] };
  const taxDataYears = [...new Set((taxYearRows ?? []).map((r) => Number(r.tax_year)))];
  const taxYears = landTaxYears(today, taxDataYears);
  const taxYear = taxYears.includes(Number(sp.ty)) ? Number(sp.ty)
    : taxYears.includes(Number(ym.slice(0, 4))) ? Number(ym.slice(0, 4)) : Number(today.slice(0, 4));
  const [{ data: incRaw }, { data: expA }, { data: expU }, { data: taxRaw }] = await Promise.all([
    ids.length ? supabase.from("income_transactions").select("id,asset_id,lease_id,received_to_asset_id,income_type,date,amount,currency,base_amount,notes")
      .in("asset_id", ids).gte("date", yearStart).lte("date", end).is("deleted_at", null).order("date", { ascending: false }) : none,
    ids.length ? supabase.from("expense_items").select(expCols).in("related_asset_id", ids).gte("date", start).lte("date", end).is("deleted_at", null) : none,
    utilProp.size ? supabase.from("expense_items").select(expCols).in("property_utility_id", [...utilProp.keys()]).gte("date", start).lte("date", end).is("deleted_at", null) : none,
    ids.length ? supabase.from("v_property_tax_lines").select("*").in("asset_id", ids).in("tax_year", [taxYear, taxYear - 1])
      .order("sort_order").order("created_at") : none,
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

  // ---------------------------------------------------------------- แท็บทรัพย์สินทั้งหมด
  const propRows: PropRow[] = props.map((p, i) => {
    const ls = byProp.get(p.asset_id) ?? [];
    return {
      id: p.id, assetId: p.asset_id, name: p.assets.name,
      sub: [p.location_group, p.land_area_sq_wa != null ? landText(p.land_area_sq_wa) : null].filter(Boolean).join(" · "), loc: p.location_group,
      type: p.property_type, typeLabel: PROPERTY_TYPE_LABEL[p.property_type] ?? p.property_type,
      usage: p.usage_type, usageLabel: USAGE_LABEL[p.usage_type] ?? p.usage_type, status: p.assets.status,
      cost: p.assets.acquisition_cost == null ? null : thb(p.assets.acquisition_cost, p.assets.currency) * share(p.asset_id),
      costDate: p.assets.acquisition_date, value: valueOf(p), valueDate: p.assets.current_value_date,
      stale: !p.assets.current_value_date || p.assets.current_value_date < old,
      rent: monthlyRent(p.asset_id), ytd: ytdRent.get(p.asset_id) ?? 0,
      leases: ls.map((l) => ({ id: l.id, badge: LEASE_STATUS[l.lease_status]?.text ?? l.lease_status, cls: LEASE_STATUS[l.lease_status]?.cls ?? "",
        text: `${[l.unit_label, l.tenant_name].filter(Boolean).join(" · ")} · ถึง ${thDate(l.end_date)}` })),
      noLease: p.usage_type === "RENTAL" && ls.length === 0,
      move: ordering ? <MoveButtons table="assets" id={p.asset_id} paths={paths} {...neighbors(props, i, (x) => x.asset_id)} /> : undefined,
    };
  });

  // ---------------------------------------------------------------- บันทึกหลายรายการ (วันที่ตั้งต้น = วันนี้ / วันสุดท้ายของเดือนที่เลือก)
  const defaultDate = end < today ? end : today;
  const banks = ((bankRows ?? []) as { asset_id: string; name: string; currency: string }[]).map((b) => ({ id: b.asset_id, name: b.name, currency: b.currency }));
  const lastBank = new Map<string, string>();
  [...incAll].sort((a, b) => a.date.localeCompare(b.date)).forEach((x) => { if (x.lease_id && x.received_to_asset_id) lastBank.set(x.lease_id, x.received_to_asset_id); });
  type RT = { lease_id: string; property_asset_id: string; name: string; income_period: string; due_date: string | null; expected_amount: number; received_amount: number | null; currency: string; status: string };
  const rentRows: RentRow[] = ((rentTrack ?? []) as RT[]).filter((r) => shown.has(r.property_asset_id)).map((r) => ({
    key: `${r.lease_id}:${r.income_period}`, leaseId: r.lease_id, assetId: r.property_asset_id, property: propName.get(r.property_asset_id) ?? "",
    tenant: r.name, period: r.income_period, due: r.due_date, expected: Number(r.expected_amount), received: Number(r.received_amount ?? 0),
    currency: r.currency, status: r.status,
    bank: lastBank.get(r.lease_id) ?? banks.find((b) => b.currency === r.currency)?.id ?? "",
  })).sort((a, b) => a.property.localeCompare(b.property, "th"));
  type CT = { utility_id: string; property_asset_id: string; utility_type: string; provider: string | null; cost_period: string; due_date: string | null; expected_amount: number | null; paid_amount: number | null; currency: string; status: string };
  const costRows: CostRow[] = ((costTrack ?? []) as CT[]).filter((c) => shown.has(c.property_asset_id)).map((c) => ({
    key: `${c.utility_id}:${c.cost_period}`, utilityId: c.utility_id, assetId: c.property_asset_id, property: propName.get(c.property_asset_id) ?? "",
    label: [UTIL_LABEL[c.utility_type] ?? c.utility_type, c.provider].filter(Boolean).join(" · "), period: c.cost_period, due: c.due_date,
    type: c.utility_type, typeLabel: UTIL_LABEL[c.utility_type] ?? c.utility_type,
    expected: Number(c.expected_amount ?? 0), paid: Number(c.paid_amount ?? 0), currency: c.currency, status: c.status,
    category: UTIL_EXPENSE_CATEGORY[c.utility_type] ?? "บ้าน / สาธารณูปโภค",
  })).sort((a, b) => a.property.localeCompare(b.property, "th"));
  // ---------------------------------------------------------------- ภาษีที่ดิน (ปีที่เลือก) รายทรัพย์สิน
  type TL = TaxLineRow & { asset_id: string; tax_year: number };
  const taxLinesAll = ((taxRaw ?? []) as TL[]);
  const taxPropRows: TaxPropRow[] = props.map((p) => {
    const lines = taxLinesAll.filter((t) => t.asset_id === p.asset_id && Number(t.tax_year) === taxYear);
    const prevLines = taxLinesAll.filter((t) => t.asset_id === p.asset_id && Number(t.tax_year) === taxYear - 1);
    return {
      assetId: p.asset_id, name: p.assets.name, type: p.property_type, typeLabel: PROPERTY_TYPE_LABEL[p.property_type] ?? p.property_type,
      usage: p.usage_type, usageLabel: USAGE_LABEL[p.usage_type] ?? p.usage_type, loc: p.location_group, status: p.assets.status,
      lines, hasPrev: prevLines.length > 0, landSqWa: p.land_area_sq_wa,
      rate: Number(prevLines.at(-1)?.rate_pct ?? LAND_TAX_RATE_BY_USAGE[p.usage_type] ?? 0.3),
    };
  });
  // ประมาณรายได้ค่าเช่าทั้งปี = ค่าเช่าตามสัญญาที่มีผล (ต่อเดือน) × 12
  const leaseCount = props.reduce((t, p) => t + (byProp.get(p.asset_id) ?? []).filter((l) => l.lease_status !== "UPCOMING" && PER_MONTHS[l.payment_frequency]).length, 0);
  const annualRent = props.reduce((t, p) => t + monthlyRent(p.asset_id), 0) * 12;
  const pays: PayOpt[] = [
    ...banks.map((b) => ({ value: endpointValue({ kind: "bank", id: b.id }), label: `บัญชี ${b.name}`, currency: b.currency })),
    ...((cardRows ?? []) as { id: string; issuer: string | null; card_name: string | null; card_last4: string | null; currency: string }[])
      .map((c) => ({ value: endpointValue({ kind: "card", id: c.id }), label: `บัตร ${[c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ")}`, currency: c.currency })),
  ];

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
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatBox label={`รายได้จากทรัพย์สิน${mLabel}`} value={`+${money(incTotal, "THB")}`} valueClass="text-emerald-700" sub={`${incMonth.length} รายการ`} />
          <StatBox label={`ค่าใช้จ่ายทรัพย์สิน${mLabel}`} value={`−${money(expTotal, "THB")}`} valueClass="text-red-700" sub={`${expRows.length} รายการ`} />
          <StatBox label={`รายได้สุทธิ${mLabel}`} value={`${incTotal - expTotal >= 0 ? "+" : "−"}${money(Math.abs(incTotal - expTotal), "THB")}`}
            valueClass={incTotal - expTotal >= 0 ? "text-emerald-700" : "text-red-700"} sub="รายได้ − ค่าใช้จ่าย" />
          <StatBox label="ประมาณรายได้ค่าเช่าทั้งปี" value={money(annualRent, "THB")} valueClass="text-emerald-700"
            sub={leaseCount ? `จากสัญญาที่มีผล ${leaseCount} สัญญา (ต่อเดือน × 12)` : "ยังไม่มีสัญญาเช่าที่มีผล"} />
        </section>
        <section className="grid gap-4 lg:grid-cols-2">
          <div className={card}>
            <h2 className="font-medium text-slate-900">มูลค่ารวม</h2>
            <div className="mt-1 text-right text-xl font-semibold tabular-nums">{money(totalValue, "THB")}</div>
            <p className="text-right text-xs text-slate-500">รวม {active.length} รายการ{latestDate && ` · ประเมินล่าสุด ${thDate(latestDate)}`}</p>
            <ShareRows label="ประเภท" rows={typeRows} total={totalValue} />
          </div>
          <div className={card}>
            <h2 className="font-medium text-slate-900">มูลค่าตามการใช้งาน</h2>
            <p className="text-right text-xs text-slate-500">รวม {money(totalValue, "THB")}</p>
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
        </section>
        <p className="-mt-3 text-xs text-slate-500">
          มูลค่า = มูลค่าประเมินล่าสุด{pv.personId && ` · แสดงเฉพาะส่วนของ ${pv.personName} ตามสัดส่วนความเป็นเจ้าของ`} · สกุลอื่นแปลงเป็นบาทด้วยอัตราล่าสุด
        </p>
        <PropertyTable rows={propRows} empty={pv.personId ? `ไม่มีทรัพย์สินของ ${pv.personName}` : "ยังไม่มีทรัพย์สิน"}
          toggle={canOrder && props.length > 1 ? <SortToggle active={ordering} {...orderHrefs("/property", { p: sp.p, m: sp.m })} /> : null} />
      </TabPanel>

      <TabPanel id="income">
        <div className="space-y-4">
          <RentBatch key={`r${ym}`} rows={rentRows} banks={banks} defaultDate={defaultDate} today={today} ym={ym} canWrite={canWrite} />
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <h2 className="px-4 pt-4 font-medium text-slate-900">รายได้จากทรัพย์สินที่บันทึกแล้ว · {thMonth(start)}</h2>
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
        </div>
      </TabPanel>

      <TabPanel id="expense">
        <div className="space-y-4">
          <ExpenseBatch key={`e${ym}`} rows={costRows} props={props.filter((p) => p.assets.status === "ACTIVE").map((p) => ({ id: p.asset_id, name: p.assets.name }))}
            pays={pays} defaultDate={defaultDate} today={today} ym={ym} canWrite={canWrite} />
          <LandTaxTable rows={taxPropRows} year={taxYear} years={taxYears} dataYears={taxDataYears}
            hrefOf={`/property?tab=expense&m=${ym}${sp.p ? `&p=${sp.p}` : ""}&ty=__Y__`} canWrite={canWrite} canDelete={canOrder}
            note={`คำนวณจากข้อมูลภาษีของทรัพย์สินแต่ละรายการ · ใช้ตรวจกับใบแจ้งภาษีของเขต / อบต.${pv.personId ? ` · แสดงเต็มจำนวนของทรัพย์สินที่ ${pv.personName} ถือ` : ""} · สถานะการจ่ายดูที่ค่าใช้จ่ายประจำด้านบน`} />
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <h2 className="px-4 pt-4 font-medium text-slate-900">ค่าใช้จ่ายทรัพย์สินที่บันทึกแล้ว · {thMonth(start)}</h2>
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
