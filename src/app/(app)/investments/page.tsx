import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cachedRpc } from "@/lib/data-cache";
import { requireAppUser } from "@/lib/auth";
import { ADD_BTN, HOLDING_TYPE_LABEL, PORTFOLIO_TYPE_LABEL, money, monthOptions, monthRange, todayBangkok, signedMoney, signedPct, thMonth } from "@/lib/format";
import { ShareBox, SHARE_COLORS } from "@/components/ShareTable";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import MonthPicker from "@/components/MonthPicker";
import { HeaderFilters, PageInfo } from "@/components/HeaderBar";
import { TabActions } from "@/components/TabActions";
import { CAPITAL_MOVE_COLS, INCOME_TO_BANK_COLS, OPENING_COST_COLS, incomeToBank, netInvested, vsInvested, type CapitalMove, type IncomeToBank, type OpeningCost } from "@/lib/net-invested";
import PortfolioTable, { type PortfolioRow } from "./PortfolioTable";
import { SortToggle, bySort } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { MonthChange, StatBox } from "@/components/Boxes";
import { changePct, prevMonthValue } from "@/lib/month-change";
import { TabNav, TabPanel, TabsProvider } from "@/components/ClientTabs";
import { DueTab, loadDue } from "./due";
import { UpdateTab, loadUpdate } from "./update";

const TABS = [["overview", "ภาพรวม"], ["update", "อัปเดตยอดคงเหลือ"], ["due", "บันทึกรับผลตอบแทน"]] as const;

type PV = { portfolio_id: string; asset_id: string; name: string; portfolio_currency: string; display_value: number | null;
  display_value_date: string | null; thb_value: number | null; in_transit_thb: number | null;
  portfolio_value: number | null; in_transit: number | null };
type H = { id: string; portfolio_asset_id: string; holding_type: string; currency: string; current_value: number | null;
  status: string; name: string; maturity_date: string | null; derived_status: string | null; valued_at_cost: boolean;
  value_thb: number | null };

export const metadata = { title: "Investments" };

export default async function InvestmentsPage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string; t?: string; tab?: string; m?: string; d?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "due" || sp.tab === "update" ? sp.tab : "overview";
  const me = await requireAppUser();
  const supabase = await createClient();
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const canWrite = me.role !== "VIEWER";
  // เดือนที่เลือก (แถบบน · ตกลง 28 ต.ค. 2026): แท็บรับผลตอบแทน = เดือนนั้น · แท็บอัปเดตยอด = เริ่มที่สิ้นเดือนนั้น (ไม่เกินวันนี้) · ภาพรวม = ยอดล่าสุด
  const today = todayBangkok();
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : today.slice(0, 7);
  // ดึงข้อมูลพร้อมกันรอบเดียว (30 ต.ค. 2026) — เดิมรอต่อกันหลายทอด (สมาชิก → ลำดับ → ข้อมูลพอร์ต → รายได้ → ผลตอบแทน → แท็บอัปเดตยอด / รับผลตอบแทน)
  //   ชุดที่ต้องใช้ผลของอีกชุดเริ่มทันทีที่ชุดนั้นเสร็จ: แท็บรับผลตอบแทน ← สมาชิกที่เลือก · รายได้ลงทุน ← สมาชิก + วัน Go-live
  //   ผลตอบแทน / แท็บอัปเดตยอด ← พอร์ตที่แสดง (สมาชิก + รายชื่อพอร์ต)
  const pvQ = loadPersonView(sp.p);
  const familyQ = supabase.from("families").select("go_live_date").maybeSingle().then((r) => r);
  const pvsQ = supabase.from("v_portfolio_values").select("*").order("name").then((r) => r);
  const pfsQ = supabase.from("investment_portfolios").select("asset_id,institution,status,portfolio_type").is("deleted_at", null).then((r) => r);
  // มุมมองรายบุคคล: เฉพาะพอร์ตที่คนนั้นมีส่วน
  const shownQ = Promise.all([pvQ, pvsQ]).then(([v, { data }]) => ((data as PV[] | null) ?? []).filter((p) => v.showAsset(p.asset_id)));
  type R = { status: string; cost_thb: number; unrealized_thb: number; unrealized_fx_thb: number; realized_thb: number; realized_fx_thb: number; income_thb: number; fees_thb: number; total_thb: number };
  const [pv, sortMap, [{ data: pvs, error }, { data: pfs }, { data: hs }, { data: family }, { data: opening }, { data: capMoves }, { data: incBank }], { data: income }, rets,
    [openPfs, updateData], dueData, totalPrev] = await Promise.all([
    pvQ,
    loadSortMap("assets"),
    Promise.all([
      pvsQ,
      pfsQ,
      supabase.from("v_holdings_active").select("id,portfolio_asset_id,holding_type,currency,current_value,status,name,maturity_date,derived_status,valued_at_cost,value_thb"),
      familyQ,
      // เงินลงทุนสุทธิรายพอร์ต: ต้นทุนรวมของยอดตั้งต้น + โอนไป / โอนกลับหลัง Go-live
      supabase.from("investment_transactions").select(`${OPENING_COST_COLS},pf:investment_portfolios!inner(asset_id)`)
        .eq("transaction_type", "OPENING_BALANCE").is("deleted_at", null).limit(5000),
      //   + ซื้อ / ขาย ที่ชำระกับบัญชีธนาคารโดยตรง (ระบบสร้างจากรายการในพอร์ต)
      supabase.from("cash_movements").select(CAPITAL_MOVE_COLS).in("movement_type", ["INVESTMENT_OUT", "INVESTMENT_IN"])
        .or("is_derived.eq.false,source_entity_type.eq.INVESTMENT_TX").is("deleted_at", null).limit(5000),
      // ปันผล / ดอกเบี้ย / Coupon ที่เข้าบัญชีธนาคารโดยตรง → บวกกลับในกำไรเทียบเงินลงทุน
      supabase.from("investment_transactions").select(`${INCOME_TO_BANK_COLS},pf:investment_portfolios!inner(asset_id)`)
        .in("transaction_type", ["DIVIDEND", "INTEREST", "COUPON"]).not("settle_to_asset_id", "is", null).is("deleted_at", null).limit(5000),
    ]),
    // รายได้ลงทุน: ทั้งครอบครัว = ยอดเต็ม · รายบุคคล = ส่วนแบ่งตามเจ้าของพอร์ต (v_income_by_person)
    Promise.all([pvQ, familyQ]).then(async ([v, { data: f }]) => {
      const since = f?.go_live_date || "1900-01-01";
      return v.personId
        ? await supabase.from("v_income_by_person").select("base_amount:base_amount_share,date").eq("person_id", v.personId)
            .eq("is_investment_income", true).gte("date", since)
        : await supabase.from("income_transactions").select("base_amount,date")
            .not("source_transaction_id", "is", null).is("deleted_at", null).gte("date", since);
    }),
    // ผลตอบแทนรายพอร์ต (คำนวณหนัก · ทุกพอร์ตทุกครั้งที่เปิด) → จำผลไว้จนมีการบันทึก / ราคาอัตโนมัติเข้า (เพดาน 1 ชั่วโมง · src/lib/data-cache.ts)
    shownQ.then((ps) => Promise.all(ps.map(async (p) =>
      [p.asset_id, (await cachedRpc<R[]>("investment_returns", { p_portfolio_asset_id: p.asset_id })) ?? []] as const))),
    // แท็บอัปเดตยอด: พอร์ตที่แสดง ยกเว้นพอร์ตที่ปิดแล้ว
    Promise.all([shownQ, pfsQ]).then(async ([ps, { data }]) => {
      const status = new Map((data ?? []).map((p) => [p.asset_id, p.status as string]));
      const open = ps.filter((p) => status.get(p.asset_id) !== "CLOSED").map((p) => ({ asset_id: p.asset_id, name: p.name }));
      return [open, await loadUpdate(open)] as const;
    }),
    pvQ.then((v) => loadDue(ym, canWrite, v.showAsset)),
    // มูลค่าลงทุน ณ สิ้นเดือนก่อน (เทียบ ▲/▼ ในกล่องแรก)
    pvQ.then((v) => prevMonthValue(today, v.personId, "INVESTMENT")),
  ]);
  const goLive = family?.go_live_date ?? "";
  const monthEnd = monthRange(ym).end;
  const months = monthOptions(goLive, today, 12, ym);

  // มุมมองรายบุคคล: เฉพาะพอร์ตที่คนนั้นมีส่วน · มูลค่า × สัดส่วน
  const sh = (assetId: string) => pv.assetShare(assetId);
  const list = ((pvs as PV[] | null) ?? []).filter((p) => pv.showAsset(p.asset_id)).map((p) => ({ ...p,
    // มูลค่าในสกุลพอร์ต ณ วันนี้ (อัตราเดียวกับ Net Worth) + เงินระหว่างทาง
    full_display_value: p.portfolio_value == null ? null : Number(p.portfolio_value) + Number(p.in_transit ?? 0),
    display_value: p.portfolio_value == null ? null : (Number(p.portfolio_value) + Number(p.in_transit ?? 0)) * sh(p.asset_id),
    thb_value: p.thb_value == null ? null : Number(p.thb_value) * sh(p.asset_id),
    in_transit_thb: p.in_transit_thb == null ? null : Number(p.in_transit_thb) * sh(p.asset_id) }));
  const retOf = new Map<string, R[]>(rets);
  const retRows = list.map((p) => {
    const rs = retOf.get(p.asset_id) ?? [];
    const sum = (k: keyof R) => rs.reduce((t, r) => t + Number(r[k] ?? 0), 0);
    const k = sh(p.asset_id);
    return { asset_id: p.asset_id, name: p.name, unreal: sum("unrealized_thb") * k, unrealFx: sum("unrealized_fx_thb") * k, real: sum("realized_thb") * k,
      realFx: sum("realized_fx_thb") * k, income: (sum("income_thb") - sum("fees_thb")) * k, total: sum("total_thb") * k,
      cost: rs.filter((x) => x.status === "ACTIVE").reduce((t, x) => t + Number(x.cost_thb ?? 0), 0) * k };
  });
  const inst = new Map((pfs ?? []).map((p) => [p.asset_id, p.institution]));
  const holdings = ((hs as H[] | null) ?? []).filter((h) => h.status === "ACTIVE" && pv.showAsset(h.portfolio_asset_id))
    .map((h) => ({ ...h, current_value: h.current_value == null ? null : Number(h.current_value) * sh(h.portfolio_asset_id),
      value_thb: h.value_thb == null ? null : Number(h.value_thb) * sh(h.portfolio_asset_id) }));
  // บาทรายตัว = ชุดเดียวกับ Net Worth (อัตรา ณ วันนี้จากฐานข้อมูล)
  const thb = (h: { value_thb: number | null }) => Number(h.value_thb ?? 0);
  const total = list.reduce((s, p) => s + Number(p.thb_value ?? 0) + Number(p.in_transit_thb ?? 0), 0);
  const transit = list.reduce((s, p) => s + Number(p.in_transit_thb ?? 0), 0);
  const cash = holdings.filter((h) => h.holding_type === "CASH").reduce((s, h) => s + thb(h), 0) + transit;
  // กล่องเงินฝากในพอร์ต (ตกลง 9 พ.ย. 2026): % ของมูลค่าลงทุนรวม · รอใส่ยอด (ถ้ามี) หรือจำนวนพอร์ตที่มีเงินฝาก
  const cashPfCount = new Set([...holdings.filter((h) => h.holding_type === "CASH" && Math.abs(thb(h)) > 0.005).map((h) => h.portfolio_asset_id),
    ...list.filter((p) => Number(p.in_transit_thb ?? 0) > 0.005).map((p) => p.asset_id)]).size;
  const incomeThb = (income ?? []).reduce((s, i) => s + Number(i.base_amount ?? 0), 0);
  // รายได้ปีนี้ (ม.ค. → เดือนที่เลือก) / เดือนที่เลือก (ตกลง 9 พ.ย. 2026)
  const mStart = `${ym}-01`, mEnd = monthRange(ym).end, yStart = `${ym.slice(0, 4)}-01-01`;
  const incomeIn = (a: string, b: string) => (income ?? []).filter((i) => String(i.date) >= a && String(i.date) <= b)
    .reduce((s, i) => s + Number(i.base_amount ?? 0), 0);
  const incomeYear = incomeIn(yStart, mEnd), incomeMonth = incomeIn(mStart, mEnd);
  const mLabel = ym === today.slice(0, 7) ? "เดือนนี้" : thMonth(mStart);
  const byType = new Map<string, number>();
  holdings.forEach((h) => byType.set(h.holding_type, (byType.get(h.holding_type) ?? 0) + thb(h)));
  const byCcy = new Map<string, number>();
  holdings.forEach((h) => byCcy.set(h.currency, (byCcy.get(h.currency) ?? 0) + thb(h)));
  const allocTotal = [...byType.values()].reduce((s, v) => s + v, 0);
  const pfType = new Map((pfs ?? []).map((p) => [p.asset_id, p.portfolio_type as string]));
  const pfStatus = new Map((pfs ?? []).map((p) => [p.asset_id, p.status as string]));
  // ตัวกรองประเภทพอร์ต
  const types = [...new Set(list.map((p) => pfType.get(p.asset_id) ?? "OTHER"))];
  const tFilter = types.includes(sp.t ?? "") ? sp.t : undefined;
  const tHref = (t?: string) => { const q = new URLSearchParams(); if (sp.p) q.set("p", sp.p); if (t) q.set("t", t); const s = q.toString(); return `/investments${s ? `?${s}` : ""}`; };
  const openingRows: OpeningCost[] = ((opening ?? []) as unknown as (Omit<OpeningCost, "portfolio_asset_id"> & { pf: { asset_id: string } })[])
    .map((o) => ({ ...o, portfolio_asset_id: o.pf.asset_id }));
  // เงินลงทุนสุทธิ (บาท × สัดส่วนของสมาชิกที่เลือก) · null = ไม่มียอดตั้งต้นและยังไม่มีเงินโอน
  const investedOf = (assetId: string, ccy: string) => {
    const n = netInvested(assetId, ccy, openingRows, (capMoves as CapitalMove[] | null) ?? []);
    return n.lines.length ? n.thb * sh(assetId) : null;
  };
  const receivedOf = (assetId: string, ccy: string) =>
    incomeToBank(ccy, ((incBank ?? []) as unknown as (IncomeToBank & { pf: { asset_id: string } })[]).filter((r) => r.pf.asset_id === assetId)).thb * sh(assetId);
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
      invested: investedOf(p.asset_id, p.portfolio_currency), received: receivedOf(p.asset_id, p.portfolio_currency),
    };
  });
  // กล่องสรุป: พอร์ตที่ยังเปิด (เทียบมูลค่าล่าสุด) แยกจากพอร์ตที่ปิดแล้ว (กำไรที่รับรู้แล้ว) · ทุกพอร์ต ไม่ขึ้นกับตัวกรองประเภท
  const allInv = list.map((p) => ({ closed: pfStatus.get(p.asset_id) === "CLOSED", inv: investedOf(p.asset_id, p.portfolio_currency),
    value: Number(p.thb_value ?? 0) + Number(p.in_transit_thb ?? 0) + receivedOf(p.asset_id, p.portfolio_currency) })).filter((x) => x.inv != null);
  const openInv = allInv.filter((x) => !x.closed);
  const invOpen = openInv.reduce((t, x) => t + x.inv!, 0);
  const invOpenPl = vsInvested(openInv.reduce((t, x) => t + x.value, 0), invOpen);
  const closedPl = allInv.filter((x) => x.closed).reduce((t, x) => t + (x.value - x.inv!), 0);
  const hasClosedInv = allInv.some((x) => x.closed);
  const share = (m: Map<string, number>, label: (k: string) => string, offset = 0) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ key: k, name: label(k), value: v, color: SHARE_COLORS[(i + offset) % SHARE_COLORS.length] }));

  const openCount = list.filter((p) => pfStatus.get(p.asset_id) !== "CLOSED").length;
  const closedCount = list.length - openCount;
  return (
    <TabsProvider initial={tab} defaultKey="overview">
    <div className="space-y-6">
      <PageInfo>ทุกพอร์ต · มูลค่าเป็นบาทใช้ราคา Statement ล่าสุดของแต่ละตัว และอัตราแลกเปลี่ยนล่าสุด</PageInfo>
      <HeaderFilters><PersonFilter persons={pv.persons} value={pv.personId} /><MonthPicker months={months} value={ym} /></HeaderFilters>
      {me.role !== "VIEWER" && <TabActions><Link href="/investments/new" className={ADD_BTN}>+ เพิ่มพอร์ต</Link></TabActions>}
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <div className="border-b border-slate-200"><TabNav tabs={TABS} /></div>

      <TabPanel id="overview" className="space-y-6">

      <section className={`grid gap-4 sm:grid-cols-2 ${allInv.length ? "xl:grid-cols-4" : "lg:grid-cols-3"}`}>
        {/* 4 กล่อง (ตกลง 7 พ.ย. 2026): มูลค่าลงทุนรวม + จำนวนพอร์ต (แบบกล่องยอดเงินฝากรวมของ Bank Accounts) · รายได้ · เงินลงทุนสุทธิ · เงินฝากในพอร์ต (ท้ายสุด) */}
        <StatBox label={<>{pv.personId ? `มูลค่าลงทุนส่วนของ ${pv.personName}` : "มูลค่าลงทุนรวม"} (THB Equivalent) · ถึงวันนี้</>} value={money(total, "THB", 0)}
          sub={<>
            <MonthChange pct={changePct(total, totalPrev)} prev={totalPrev} />
            <div>พอร์ตที่เปิด {openCount} พอร์ต{closedCount ? ` · ปิดแล้ว ${closedCount}` : ""}</div>
          </>} />
        <StatBox label={<>รายได้ลงทุนตั้งแต่ Go-live <span className="text-slate-400">· ปันผล ดอกเบี้ย Coupon (ก่อนภาษี)</span></>} value={money(incomeThb, "THB", 0)}
          sub={<><div>ปีนี้ (ม.ค. – {thMonth(mStart)}) {money(incomeYear, "THB", 0)}</div><div>{mLabel} {money(incomeMonth, "THB", 0)}</div></>} />
        {allInv.length > 0 && (
          <StatBox label="เงินลงทุนสุทธิ (พอร์ตที่เปิด)" value={money(invOpen, "THB", 0)}
            sub={<>
              {invOpenPl && <div className={invOpenPl.pl >= 0 ? "text-emerald-700" : "text-red-700"}>
                กำไร / ขาดทุน {signedMoney(invOpenPl.pl, "THB", 0)}{invOpenPl.pct != null && <> (<span className="font-semibold">{signedPct(invOpenPl.pct)}</span>)</>}</div>}
              {hasClosedInv && <div className="text-slate-500">พอร์ตที่ปิดแล้ว: รับรู้แล้ว <span className={closedPl < -0.005 ? "text-red-700" : closedPl > 0.005 ? "text-emerald-700" : ""}>{signedMoney(closedPl, "THB", 0)}</span></div>}
            </>} />
        )}
        <StatBox label="เงินฝากในพอร์ต" value={money(cash, "THB", 0)}
          sub={<>
            {total > 0.005 && <div><span className="font-semibold">{((cash * 100) / total).toFixed(1)}%</span> ของมูลค่าลงทุนรวม</div>}
            <div>{transit > 0.005 ? `รวมเงินโอนรอใส่ยอด ${money(transit, "THB", 0)}` : `อยู่ใน ${cashPfCount} พอร์ต`}</div>
          </>} />
      </section>

      {allocTotal > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          <ShareBox title={`มูลค่าลงทุนตามประเภท${pv.personId ? ` ส่วนของ ${pv.personName}` : ""}`} label="ประเภท" total={allocTotal}
            rows={share(byType, (k) => HOLDING_TYPE_LABEL[k] ?? k)} />
          <ShareBox title="มูลค่าลงทุนตามสกุลเงิน" label="สกุลเงิน" total={allocTotal} rows={share(byCcy, (k) => k, 3)} />
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

      </TabPanel>

      <TabPanel id="update">
        <UpdateTab data={updateData} today={today} date={sp.d ?? (monthEnd < today ? monthEnd : undefined)} goLive={goLive} canWrite={canWrite}
          portfolios={openPfs} />
      </TabPanel>

      <TabPanel id="due">
        <DueTab data={dueData} month={ym} today={today} goLive={goLive} canWrite={canWrite} canDelete={canOrder} />
      </TabPanel>
    </div>
    </TabsProvider>
  );
}
