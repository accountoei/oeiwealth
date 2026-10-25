import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { HOLDING_TYPE_LABEL, ITX_LABEL, PORTFOLIO_TYPE_LABEL, money, thDate, todayBangkok, addDays } from "@/lib/format";
import { ShareBox, SHARE_COLORS } from "@/components/ShareTable";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import PortfolioTable, { type PortfolioRow } from "./PortfolioTable";
import { SortToggle, bySort } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { StatBox } from "@/components/Boxes";
import { TabNav, TabPanel, TabsProvider } from "@/components/ClientTabs";
import { DueTab } from "./due";
import { UpdateTab } from "./update";

const TABS = [["overview", "ภาพรวม"], ["update", "อัปเดตยอดคงเหลือ"], ["due", "รอรับเดือนนี้"]] as const;

type PV = { portfolio_id: string; asset_id: string; name: string; portfolio_currency: string; display_value: number | null;
  display_value_date: string | null; thb_value: number | null; in_transit_thb: number | null;
  portfolio_value: number | null; in_transit: number | null };
type H = { id: string; portfolio_asset_id: string; holding_type: string; currency: string; current_value: number | null;
  status: string; name: string; maturity_date: string | null; derived_status: string | null; valued_at_cost: boolean;
  value_thb: number | null };

export default async function InvestmentsPage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string; t?: string; tab?: string; m?: string; d?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "due" || sp.tab === "update" ? sp.tab : "overview";
  const me = await requireAppUser();
  const supabase = await createClient();
  const pv = await loadPersonView(sp.p);
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const sortMap = await loadSortMap("assets");
  const [{ data: pvs, error }, { data: pfs }, { data: hs }, { data: family }, { data: txs }] = await Promise.all([
    supabase.from("v_portfolio_values").select("*").order("name"),
    supabase.from("investment_portfolios").select("asset_id,institution,status,portfolio_type").is("deleted_at", null),
    supabase.from("v_holdings_active").select("id,portfolio_asset_id,holding_type,currency,current_value,status,name,maturity_date,derived_status,valued_at_cost,value_thb"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("investment_transactions")
      .select("id,transaction_date,transaction_type,amount,currency,holding_id,portfolio_id,investment_holdings(name),investment_portfolios(asset_id)")
      .is("deleted_at", null).order("transaction_date", { ascending: false }).order("created_at", { ascending: false }).limit(pv.personId ? 60 : 10),
  ]);
  const goLive = family?.go_live_date ?? "";
  // รายได้ลงทุน: ทั้งครอบครัว = ยอดเต็ม · รายบุคคล = ส่วนแบ่งตามเจ้าของพอร์ต (v_income_by_person)
  const { data: income } = pv.personId
    ? await supabase.from("v_income_by_person").select("base_amount:base_amount_share").eq("person_id", pv.personId)
        .eq("is_investment_income", true).gte("date", goLive || "1900-01-01")
    : await supabase.from("income_transactions").select("base_amount")
        .not("source_transaction_id", "is", null).is("deleted_at", null).gte("date", goLive || "1900-01-01");

  // มุมมองรายบุคคล: เฉพาะพอร์ตที่คนนั้นมีส่วน · มูลค่า × สัดส่วน
  const sh = (assetId: string) => pv.assetShare(assetId);
  const list = ((pvs as PV[] | null) ?? []).filter((p) => pv.showAsset(p.asset_id)).map((p) => ({ ...p,
    // มูลค่าในสกุลพอร์ต ณ วันนี้ (อัตราเดียวกับ Net Worth) + เงินระหว่างทาง
    full_display_value: p.portfolio_value == null ? null : Number(p.portfolio_value) + Number(p.in_transit ?? 0),
    display_value: p.portfolio_value == null ? null : (Number(p.portfolio_value) + Number(p.in_transit ?? 0)) * sh(p.asset_id),
    thb_value: p.thb_value == null ? null : Number(p.thb_value) * sh(p.asset_id),
    in_transit_thb: p.in_transit_thb == null ? null : Number(p.in_transit_thb) * sh(p.asset_id) }));
  type R = { status: string; cost_thb: number; unrealized_thb: number; unrealized_fx_thb: number; realized_thb: number; realized_fx_thb: number; income_thb: number; fees_thb: number; total_thb: number };
  const retRows = await Promise.all(list.map(async (p) => {
    const { data } = await supabase.rpc("investment_returns", { p_portfolio_asset_id: p.asset_id });
    const rs = (data as R[] | null) ?? [];
    const sum = (k: keyof R) => rs.reduce((t, r) => t + Number(r[k] ?? 0), 0);
    const k = sh(p.asset_id);
    return { asset_id: p.asset_id, name: p.name, unreal: sum("unrealized_thb") * k, unrealFx: sum("unrealized_fx_thb") * k, real: sum("realized_thb") * k,
      realFx: sum("realized_fx_thb") * k, income: (sum("income_thb") - sum("fees_thb")) * k, total: sum("total_thb") * k,
      cost: rs.filter((x) => x.status === "ACTIVE").reduce((t, x) => t + Number(x.cost_thb ?? 0), 0) * k };
  }));
  const recent = (txs ?? []).filter((t) => {
    const pa = (Array.isArray(t.investment_portfolios) ? t.investment_portfolios[0] : t.investment_portfolios) as { asset_id: string } | null;
    return !pa || pv.showAsset(pa.asset_id);
  }).slice(0, 10);
  const inst = new Map((pfs ?? []).map((p) => [p.asset_id, p.institution]));
  const holdings = ((hs as H[] | null) ?? []).filter((h) => h.status === "ACTIVE" && pv.showAsset(h.portfolio_asset_id))
    .map((h) => ({ ...h, current_value: h.current_value == null ? null : Number(h.current_value) * sh(h.portfolio_asset_id),
      value_thb: h.value_thb == null ? null : Number(h.value_thb) * sh(h.portfolio_asset_id) }));
  // บาทรายตัว = ชุดเดียวกับ Net Worth (อัตรา ณ วันนี้จากฐานข้อมูล)
  const thb = (h: { value_thb: number | null }) => Number(h.value_thb ?? 0);
  const total = list.reduce((s, p) => s + Number(p.thb_value ?? 0) + Number(p.in_transit_thb ?? 0), 0);
  const cash = holdings.filter((h) => h.holding_type === "CASH").reduce((s, h) => s + thb(h), 0)
    + list.reduce((s, p) => s + Number(p.in_transit_thb ?? 0), 0);
  const incomeThb = (income ?? []).reduce((s, i) => s + Number(i.base_amount ?? 0), 0);
  const byType = new Map<string, number>();
  holdings.forEach((h) => byType.set(h.holding_type, (byType.get(h.holding_type) ?? 0) + thb(h)));
  const byCcy = new Map<string, number>();
  holdings.forEach((h) => byCcy.set(h.currency, (byCcy.get(h.currency) ?? 0) + thb(h)));
  const allocTotal = [...byType.values()].reduce((s, v) => s + v, 0);
  const soon = holdings.filter((h) => h.maturity_date && h.maturity_date >= todayBangkok() && h.maturity_date <= addDays(todayBangkok(), 60))
    .sort((x, y) => (x.maturity_date! < y.maturity_date! ? -1 : 1));
  const pfName = new Map(list.map((p) => [p.asset_id, p.name]));
  const pfType = new Map((pfs ?? []).map((p) => [p.asset_id, p.portfolio_type as string]));
  const pfStatus = new Map((pfs ?? []).map((p) => [p.asset_id, p.status as string]));
  // ตัวกรองประเภทพอร์ต
  const types = [...new Set(list.map((p) => pfType.get(p.asset_id) ?? "OTHER"))];
  const tFilter = types.includes(sp.t ?? "") ? sp.t : undefined;
  const tHref = (t?: string) => { const q = new URLSearchParams(); if (sp.p) q.set("p", sp.p); if (t) q.set("t", t); const s = q.toString(); return `/investments${s ? `?${s}` : ""}`; };
  // ตารางพอร์ต · เรียงตามลำดับที่ตั้งไว้
  const ret = new Map(retRows.map((r) => [r.asset_id, r]));
  const rows: PortfolioRow[] = bySort(list.filter((p) => !tFilter || (pfType.get(p.asset_id) ?? "OTHER") === tFilter), (p) => p.asset_id, sortMap).map((p) => {
    const r = ret.get(p.asset_id);
    const n = holdings.filter((h) => h.portfolio_asset_id === p.asset_id && h.holding_type !== "CASH").length;
    const institution = inst.get(p.asset_id);
    return {
      asset_id: p.asset_id, name: p.name, currency: p.portfolio_currency, closed: pfStatus.get(p.asset_id) === "CLOSED",
      sub: [PORTFOLIO_TYPE_LABEL[pfType.get(p.asset_id) ?? ""] ?? null, institution && institution !== p.name ? institution : null, p.portfolio_currency, `${n} หลักทรัพย์`].filter(Boolean).join(" · "),
      value: p.display_value, valueThb: Number(p.thb_value ?? 0) + Number(p.in_transit_thb ?? 0), valueDate: p.display_value_date,
      sharePct: pv.assetPct(p.asset_id), fullValue: p.full_display_value, inTransit: Number(p.in_transit_thb ?? 0) !== 0,
      atCost: holdings.some((h) => h.portfolio_asset_id === p.asset_id && h.valued_at_cost),
      unreal: r?.unreal ?? 0, real: r?.real ?? 0, fx: (r?.unrealFx ?? 0) + (r?.realFx ?? 0), income: r?.income ?? 0,
      total: r?.total ?? 0, cost: r?.cost ?? 0,
    };
  });
  const share = (m: Map<string, number>, label: (k: string) => string, offset = 0) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ key: k, name: label(k), value: v, color: SHARE_COLORS[(i + offset) % SHARE_COLORS.length] }));

  return (
    <TabsProvider initial={tab} defaultKey="overview">
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Investments</h1>
          <p className="text-sm text-slate-500">ทุกพอร์ต · มูลค่าเป็นบาทใช้ราคา Statement ล่าสุดของแต่ละตัว และอัตราแลกเปลี่ยนล่าสุด</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <PersonFilter persons={pv.persons} value={pv.personId} />
          {me.role !== "VIEWER" && (
            <Link href="/investments/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มพอร์ต</Link>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <div className="border-b border-slate-200"><TabNav tabs={TABS} /></div>

      <TabPanel id="overview" className="space-y-6">

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatBox label={pv.personId ? `มูลค่าลงทุนส่วนของ ${pv.personName}` : "มูลค่าลงทุนรวม"} value={money(total, "THB", 0)} />
        <StatBox label="รายได้ลงทุนตั้งแต่ Go-live" value={money(incomeThb, "THB", 0)} sub="ปันผล · ดอกเบี้ย · Coupon (ก่อนภาษี)" />
        <StatBox label="จำนวนพอร์ต" value={String(list.filter((p) => pfStatus.get(p.asset_id) !== "CLOSED").length)}
          sub={list.some((p) => pfStatus.get(p.asset_id) === "CLOSED") ? `ปิดแล้ว ${list.filter((p) => pfStatus.get(p.asset_id) === "CLOSED").length} พอร์ต` : undefined} />
        <StatBox label="เงินฝากในพอร์ต (รวมเงินโอนรอใส่ยอด)" value={money(cash, "THB", 0)} />
      </section>

      {allocTotal > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          <ShareBox title={`สัดส่วนตามประเภท${pv.personId ? `ของ ${pv.personName}` : ""}`} label="ประเภท" total={allocTotal}
            rows={share(byType, (k) => HOLDING_TYPE_LABEL[k] ?? k)} />
          <ShareBox title="สัดส่วนตามสกุลเงิน" label="สกุลเงิน" total={allocTotal} rows={share(byCcy, (k) => k, 3)} />
        </section>
      )}

      {list.length === 0
        ? <p className="text-sm text-slate-500">{pv.personId ? `ไม่มีพอร์ตของ ${pv.personName}` : "ยังไม่มีพอร์ต"}</p>
        : <PortfolioTable rows={rows} ordering={ordering} paths={["/investments"]} label={tFilter ? "รวมตามประเภท" : "รวมทุกพอร์ต"}
            filter={types.length > 1 ? (
              <div className="flex flex-wrap gap-1 text-xs">
                <Link href={tHref()} scroll={false} className={`rounded-full border px-2.5 py-0.5 ${!tFilter ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>ทั้งหมด</Link>
                {types.map((t) => (
                  <Link key={t} href={tHref(t)} scroll={false}
                    className={`rounded-full border px-2.5 py-0.5 ${tFilter === t ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                    {PORTFOLIO_TYPE_LABEL[t] ?? t} ({list.filter((p) => (pfType.get(p.asset_id) ?? "OTHER") === t).length})</Link>
                ))}
              </div>) : null}
            toggle={canOrder && rows.length > 1 ? <SortToggle active={ordering} {...orderHrefs("/investments", { p: sp.p, t: tFilter })} /> : null} />}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 font-medium text-slate-900">รายการล่าสุด</h2>
          {recent.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ</p> : (
            <ul className="space-y-1 text-sm">
              {recent.map((t) => {
                const hn = (Array.isArray(t.investment_holdings) ? t.investment_holdings[0] : t.investment_holdings) as { name: string } | null;
                const pa = (Array.isArray(t.investment_portfolios) ? t.investment_portfolios[0] : t.investment_portfolios) as { asset_id: string } | null;
                return (
                  <li key={t.id} className="flex justify-between gap-3">
                    <span>{thDate(t.transaction_date)} · {ITX_LABEL[t.transaction_type] ?? t.transaction_type} {hn?.name ?? ""}
                      <span className="text-xs text-slate-500"> · {pa ? pfName.get(pa.asset_id) : ""}</span></span>
                    <span className="tabular-nums">{money(t.amount, t.currency)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 font-medium text-slate-900">กำลังจะครบกำหนด (60 วัน)</h2>
          {soon.length === 0 ? <p className="text-sm text-slate-500">ไม่มี</p> : (
            <ul className="space-y-1 text-sm">
              {soon.map((h) => (
                <li key={h.id}><Link href={`/investments/${h.portfolio_asset_id}/holding/${h.id}`} className="hover:underline">{h.name}</Link>
                  <span className="text-slate-500"> · ครบ {thDate(h.maturity_date)} · {money(h.current_value, h.currency, 0)}</span></li>
              ))}
            </ul>
          )}
        </div>
      </section>
      </TabPanel>

      <TabPanel id="update">
        <UpdateTab today={todayBangkok()} date={sp.d} goLive={goLive} canWrite={me.role !== "VIEWER"}
          portfolios={list.filter((p) => pfStatus.get(p.asset_id) !== "CLOSED").map((p) => ({ asset_id: p.asset_id, name: p.name }))} />
      </TabPanel>

      <TabPanel id="due">
        <DueTab month={/^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : todayBangkok().slice(0, 7)} today={todayBangkok()} goLive={goLive}
          showAsset={(x) => pv.showAsset(x)} canWrite={me.role !== "VIEWER"} />
      </TabPanel>
    </div>
    </TabsProvider>
  );
}
