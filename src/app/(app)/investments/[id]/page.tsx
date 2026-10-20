import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import {
  HOLDING_TYPE_LABEL, ITX_LABEL, PORTFOLIO_TYPE_LABEL, addDays, money, qty, thDate, thMonth, todayBangkok,
} from "@/lib/format";
import {
  AddCashAccountForm, MoveCashForm, OpeningHoldingForm, TransferEditForm, TransferForm, TxForm, ValuationsForm, type PfTransfer,
  type CashAcct, type Holding,
} from "./forms";
import { moveHolding, setDefaultCash } from "../actions";
import ReturnsTable, { type Ret, type RetLocal } from "./ReturnsTable";
import RowActions from "@/components/RowActions";
import { TabNav, TabPanel, TabsProvider } from "@/components/ClientTabs";
import { CurrencyScope } from "@/components/CurrencyContext";
import TxFilter from "./tx-filter";
import { CashNameEdit, PortfolioInfoForm } from "./portfolio-ui";
import EditToggle from "@/components/EditToggle";
import OwnershipEditor from "@/components/OwnershipEditor";
import StatusSelect from "@/components/StatusSelect";
import { ActionBar } from "@/components/ActionBar";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { DetailItem as Item } from "@/components/Boxes";

type H = Holding & { average_cost: number | null; current_value: number | null; current_value_date: string | null;
  maturity_date: string | null; derived_status: string | null; valued_at_cost: boolean;
  is_default_cash: boolean; interest_rate: number | null; purpose: string | null;
  value_thb: number | null; fx_rate: number | null; fx_rate_date: string | null };
type Tx = { id: string; holding_id: string | null; transaction_date: string; settlement_date: string | null;
  transaction_type: string; quantity: number | null; price: number | null; amount: number; currency: string;
  fee: number | null; tax: number | null; direction: string | null; settle_from_asset_id: string | null;
  settle_to_asset_id: string | null; cash_movement_id: string | null; notes: string | null; net_cash: number;
  settlement_status: string; counter_amount: number | null; counter_currency: string | null;
  cash_holding_id: string | null; counter_cash_holding_id: string | null };

const STATUS_LABEL: Record<string, string> = { ACTIVE: "ถืออยู่", SOLD: "ขายแล้ว", MATURED: "ครบกำหนด", AUTOCALLED: "Autocall" };

export default async function PortfolioDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ order?: string; tab?: string; m?: string; type?: string; h?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const orderMode = sp.order;                       // "cash" | "sec" = โหมดจัดลำดับ
  const tab = sp.tab === "ret" || sp.tab === "tx" ? sp.tab : "hold";   // แท็บ ถือครอง | ผลตอบแทน | รายการ
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: a }, { data: pf }, { data: pv }, { data: hs }, { data: owners }, { data: banks }, { data: family },
    { data: unsettled }, { data: persons }] = await Promise.all([
    supabase.from("assets").select("*").eq("id", id).eq("asset_type", "INVESTMENT_PORTFOLIO").is("deleted_at", null).maybeSingle(),
    supabase.from("investment_portfolios").select("*").eq("asset_id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_portfolio_values").select("thb_value,in_transit,in_transit_thb,portfolio_value,portfolio_fx_rate").eq("asset_id", id).maybeSingle(),
    supabase.from("v_holdings_active").select("*").eq("portfolio_asset_id", id).order("sort_order").order("name"),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("v_unsettled_trades").select("*").eq("portfolio_asset_id", id),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
  ]);
  if (!a || !pf) notFound();
  // แท็บรายการ: กรองเดือน (เริ่มที่เดือนล่าสุดที่มีรายการ) / ประเภท / หลักทรัพย์-บัญชี
  const { data: lastTx } = await supabase.from("investment_transactions").select("transaction_date").eq("portfolio_id", pf.id)
    .is("deleted_at", null).order("transaction_date", { ascending: false }).limit(1).maybeSingle();
  const txMonth = sp.m === "all" || /^\d{4}-\d{2}$/.test(sp.m ?? "") ? (sp.m as string)
    : (lastTx?.transaction_date ?? todayBangkok()).slice(0, 7);
  const txType = sp.type && /^[A-Z_]+$/.test(sp.type) ? sp.type : "";
  const txHolding = sp.h && (hs ?? []).some((x: { id: string }) => x.id === sp.h) ? sp.h : "";
  // โหลดรายการทั้งหมดของพอร์ตครั้งเดียว → กรองในเบราว์เซอร์ (ไม่โหลดหน้าใหม่)
  const txq = supabase.from("v_investment_transactions_net").select("*").eq("portfolio_id", pf.id);
  const [{ data: txs }, { data: income }, { data: rets }, { data: retsLocal }, { data: mvs }, { data: autoRows }] = await Promise.all([
    txq.order("transaction_date", { ascending: false }).order("created_at", { ascending: false }).limit(5000),
    supabase.from("income_transactions").select("amount,tax,currency,base_amount").eq("asset_id", id)
      .not("source_transaction_id", "is", null).is("deleted_at", null),
    supabase.rpc("investment_returns", { p_portfolio_asset_id: id }),
    supabase.rpc("investment_returns_local", { p_portfolio_asset_id: id }),
    // รายการโอน ธนาคาร ↔ พอร์ต (แก้ไข / ใส่ยอดที่เข้าทีหลัง)
    supabase.from("cash_movements")
      .select("id,movement_date,movement_type,from_asset_id,to_asset_id,amount,currency,fee,counter_amount,counter_currency,counter_fee,cash_holding_id,description")
      .eq("is_derived", false).is("deleted_at", null)
      .or(`and(movement_type.eq.INVESTMENT_OUT,to_asset_id.eq.${id}),and(movement_type.eq.INVESTMENT_IN,from_asset_id.eq.${id})`)
      .order("movement_date", { ascending: false }).limit(2000),
    supabase.from("investment_holdings").select("id").eq("portfolio_id", pf.id).eq("auto_price", true).is("deleted_at", null),
  ]);

  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const paths = [`/investments/${id}`, "/investments", "/financial/cash", "/income-expenses"];
  const today = todayBangkok();
  const goLive = family?.go_live_date ?? "";
  const isSetup = family?.system_status === "SETUP";
  const openingDate = goLive ? addDays(goLive, -1) : today;
  const holdings = (hs as H[] | null) ?? [];
  const autoIds = new Set((autoRows ?? []).map((x) => x.id as string));
  const byId = new Map(holdings.map((h) => [h.id, h]));
  // มูลค่าเป็นบาทรายตัว = ชุดเดียวกับ Net Worth (มูลค่าสกุลเดิม × อัตรา ณ วันนี้ จากฐานข้อมูล)
  const thbOf = (h: H) => (h.value_thb == null ? null : Number(h.value_thb));
  // อัตราล่าสุด (บาทต่อหน่วย) จากฐานข้อมูล — ชุดเดียวกับ Net Worth · ใช้แปลงผลตอบแทนเป็นสกุลพอร์ต
  const fxRates: Record<string, number> = { THB: 1 };
  for (const h of holdings) if (h.fx_rate != null) fxRates[h.currency] = Number(h.fx_rate);
  if (pv?.portfolio_fx_rate != null) fxRates[a.currency] = Number(pv.portfolio_fx_rate);
  const active = holdings.filter((h) => h.status === "ACTIVE");
  const totalThb = active.reduce((s, h) => s + (thbOf(h) ?? 0), 0);
  const cashHoldings = active.filter((h) => h.holding_type === "CASH");
  const securities = holdings.filter((h) => h.holding_type !== "CASH");
  const cashAccounts: CashAcct[] = cashHoldings.map((h) => ({ id: h.id, name: h.name, currency: h.currency, is_default_cash: h.is_default_cash }));
  // เงินฝากรวมรายสกุล (หลายบัญชีต่อสกุลได้)
  const cashByCcy = new Map<string, { value: number; count: number }>();
  for (const c of cashHoldings) {
    const x = cashByCcy.get(c.currency) ?? { value: 0, count: 0 };
    cashByCcy.set(c.currency, { value: x.value + Number(c.current_value ?? 0), count: x.count + 1 });
  }
  const cashThb = cashHoldings.reduce((s, h) => s + (thbOf(h) ?? 0), 0);
  const secThb = securities.filter((h) => h.status === "ACTIVE").reduce((s, h) => s + (thbOf(h) ?? 0), 0);
  const rateNote = (h: H) => h.currency === "THB" ? null
    : h.fx_rate == null ? "ไม่มีอัตรา" : `@ ${money(h.fx_rate, undefined, 4)}${h.fx_rate_date ? ` (${thDate(h.fx_rate_date)})` : ""}`;
  const multiCash = [...cashByCcy.values()].some((x) => x.count > 1);
  const acctName = (hid: string | null) => (hid ? byId.get(hid)?.name ?? "" : "");
  const incomeThb = (income ?? []).reduce((s, i) => s + Number(i.base_amount ?? 0), 0);
  const activeOwners = (owners ?? []).filter((o) => !o.end_date);
  const ownerTotal = activeOwners.reduce((s, o) => s + Number(o.ownership_percent), 0);
  const bankList = banks ?? [];
  const bankName = new Map(bankList.map((b) => [b.asset_id, b.name]));
  const txList = (txs as Tx[] | null) ?? [];
  const transfers = (mvs as PfTransfer[] | null) ?? [];
  const transferById = new Map(transfers.map((m) => [m.id, m]));
  const waitingTransfers = transfers.filter((m) => m.counter_currency != null && m.counter_amount == null);
  const transferBank = (m: PfTransfer) => bankName.get((m.movement_type === "INVESTMENT_OUT" ? m.from_asset_id : m.to_asset_id) ?? "") ?? "บัญชีธนาคาร";
  // ตัวเลือกเดือน: เดือนปัจจุบัน → เดือนยอดตั้งต้น (ใหม่สุดก่อน) + ทุกเดือน
  const txMonths: { value: string; label: string }[] = [];
  for (let m = today.slice(0, 7); txMonths.length < 240; ) {
    txMonths.push({ value: m, label: thMonth(`${m}-01`) });
    if (m <= openingDate.slice(0, 7)) break;
    const [y, mo] = m.split("-").map(Number);
    m = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
  }
  if (txMonth !== "all" && !txMonths.some((x) => x.value === txMonth)) txMonths.unshift({ value: txMonth, label: thMonth(`${txMonth}-01`) });
  txMonths.push({ value: "all", label: "ทุกเดือน" });

  // ช่องเลือกสกุลเงินในหน้านี้: กลุ่มบน = สกุลที่พอร์ตใช้อยู่ (สกุลพอร์ต + บัญชีเงินฝาก + หลักทรัพย์)
  const pfCurrencies = [a.currency, ...holdings.filter((h) => h.status === "ACTIVE" || h.holding_type === "CASH").map((h) => h.currency)];

  return (
    <CurrencyScope used={pfCurrencies}>
    <div className="space-y-6">
      <div>
        <Link href="/investments" className="text-sm text-slate-500 hover:underline">← Investments</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{a.name}</h1>
            <p className="text-sm text-slate-500">{[pf.institution, PORTFOLIO_TYPE_LABEL[pf.portfolio_type] ?? pf.portfolio_type, `สกุลพอร์ต ${a.currency}`].filter(Boolean).join(" · ")}
              {a.status === "CLOSED" && <span className="text-slate-700"> · ปิดพอร์ตแล้ว</span>}</p>
          </div>
          {canWrite && (
            <ActionBar className="max-w-3xl">
              <TxForm assetId={id} portfolioName={a.name} portfolioCurrency={a.currency} holdings={holdings} banks={bankList} cashAccounts={cashAccounts} today={today} minDate={goLive} />
              <TransferForm assetId={id} currency={a.currency} banks={bankList} cashAccounts={cashAccounts} today={today} minDate={goLive} />
              <MoveCashForm assetId={id} cashAccounts={cashAccounts} today={today} minDate={goLive} />
              <ValuationsForm assetId={id} holdings={holdings} today={today} minDate={goLive} />
              <AddCashAccountForm assetId={id} currency={a.currency} isSetup={isSetup} openingDate={openingDate} />
              {(isSetup || me.role === "ADMIN") && (
                <OpeningHoldingForm assetId={id} currency={a.currency} openingDate={openingDate} isSetup={isSetup} />
              )}
            </ActionBar>
          )}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {/* ซ้าย: มูลค่า + เอกสาร */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">มูลค่าเป็นบาท (ใช้ใน Net Worth)</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{money(pv?.thb_value ?? null, "THB", 0)}</div>
            {a.currency !== "THB" && (
              <div className="mt-1 text-xs text-slate-500">= {money(pv?.portfolio_value ?? null, a.currency, 0)}
                {pv?.portfolio_fx_rate ? ` · 1 ${a.currency} = ${money(pv.portfolio_fx_rate, undefined, 4)} บาท` : ""}</div>
            )}
            <div className={`mt-1 text-xs ${Number(pv?.in_transit ?? 0) !== 0 ? "text-amber-700" : "text-slate-500"}`}>
              {Number(pv?.in_transit ?? 0) !== 0 ? `+ เงินระหว่างทาง ${money(pv?.in_transit ?? 0, a.currency, 0)}` : "ไม่มีเงินระหว่างทาง"}</div>
            <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">เงินฝากในพอร์ต</dt>
                <dd className="text-right tabular-nums">{cashByCcy.size === 0 ? "-" : [...cashByCcy.entries()].map(([c, x]) => <div key={c}>{money(x.value, c, 0)}</div>)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">หลักทรัพย์</dt><dd className="tabular-nums">{money(secThb, "THB", 0)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">รายได้ลงทุนตั้งแต่ Go-live</dt><dd className="tabular-nums">{money(incomeThb, "THB", 0)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-slate-400">เงินฝากคำนวณจาก Statement ล่าสุด + รายการหลังจากนั้น · รายได้ก่อนหักภาษี</p>
          </div>
          <div className="flex flex-1 flex-col">
            <EntityDocuments category="INVESTMENT" entityType="ASSET" entityId={id} module="INVESTMENT" role={me.role} paths={paths} fill />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
          <EditToggle title="รายละเอียด" canEdit={canDelete}
            view={
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Item label="สถาบัน">{pf.institution || "-"}</Item>
                <Item label="ประเภท">{PORTFOLIO_TYPE_LABEL[pf.portfolio_type] ?? pf.portfolio_type}</Item>
                <Item label="สกุลพอร์ต">{a.currency}</Item>
                <Item label="จำนวนหลักทรัพย์">{securities.filter((h) => h.status === "ACTIVE").length} ตัว
                  {securities.some((h) => h.status !== "ACTIVE") && <span className="block text-xs text-slate-500">จบแล้ว {securities.filter((h) => h.status !== "ACTIVE").length} ตัว</span>}</Item>
                <Item label="บัญชีเงินฝากในพอร์ต">{cashHoldings.length} บัญชี</Item>
                <Item label="สถานะ">{a.status === "CLOSED" ? "ปิดพอร์ตแล้ว" : "ใช้งาน"}</Item>
                <Item label="เจ้าของ">
                  {activeOwners.length === 0 ? "-" : activeOwners.map((o) => <div key={o.person_id}>{o.person_name} · {Number(o.ownership_percent)}%</div>)}
                  {ownerTotal < 99.99999 && <div className="text-xs text-amber-700">ยังไม่ระบุเจ้าของ {Math.round((100 - ownerTotal) * 10000) / 10000}%</div>}
                </Item>
                {a.notes && <Item label="หมายเหตุ" wide>{a.notes}</Item>}
              </dl>
            }
            edit={
              <div className="space-y-5">
                <PortfolioInfoForm assetId={id} name={a.name} institution={pf.institution} portfolioType={pf.portfolio_type} currency={a.currency} notes={a.notes} />
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="mb-2 text-sm font-medium text-slate-800">สมาชิกที่เป็นเจ้าของ</h3>
                  <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={today} startOpen
                    current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />
                </div>
                <div className="border-t border-slate-100 pt-4">
                  <StatusSelect table="assets" id={id} value={a.status} paths={paths} label="สถานะพอร์ต"
                    options={[["ACTIVE", "ใช้งาน"], ["CLOSED", "ปิดพอร์ตแล้ว"]]}
                    remove={me.role === "ADMIN" ? { kind: "asset", id, redirectTo: "/investments", paths: ["/investments"], label: "ลบพอร์ตนี้",
                      hint: "ลบได้เฉพาะพอร์ตที่มีแค่ยอดตั้งต้น (ไม่มีซื้อ ขาย ปันผล หรือการโอน)" } : undefined} />
                </div>
              </div>
            } />
        </div>
      </section>

      {Number(pv?.in_transit ?? 0) !== 0 && (
        <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
          เงินโอนเข้าพอร์ต {money(pv?.in_transit ?? 0, a.currency)} ยังเป็น &ldquo;เงินระหว่างทาง&rdquo; — นับรวมใน Net Worth แล้ว
          และจะรวมเข้าเงินฝากในพอร์ตเมื่อบันทึกยอดเงินฝากตาม Statement (อัปเดตราคา / Statement)
        </p>
      )}

      {waitingTransfers.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-medium text-amber-900">รอยอดปลายทาง ({waitingTransfers.length})</h2>
          <p className="text-xs text-amber-800">โอนแล้วแต่ยังไม่ได้ใส่ยอดที่เข้าจริง — นับเป็นเงินระหว่างทางใน Net Worth แล้ว · ได้ Statement แล้วกด &ldquo;ใส่ยอดที่เข้า&rdquo;</p>
          <ul className="mt-2 divide-y divide-amber-200">
            {waitingTransfers.map((m) => (
              <li key={m.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {thDate(m.movement_date)} · {m.movement_type === "INVESTMENT_OUT" ? `${transferBank(m)} → ${acctName(m.cash_holding_id) || "พอร์ต"}` : `${acctName(m.cash_holding_id) || "พอร์ต"} → ${transferBank(m)}`}
                    {" · "}ออก <span className="tabular-nums">{money(m.amount, m.currency)}</span> → รอยอด {m.counter_currency}
                    {m.description && <span className="text-slate-500"> · {m.description}</span>}
                  </span>
                  {canWrite && <TransferEditForm assetId={id} t={m} bankLabel={transferBank(m)} cashAccounts={cashAccounts} minDate={goLive} today={today} />}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------ เงินฝากในพอร์ต (รายบัญชี) */}
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
          <div className="flex items-baseline gap-3">
            <h2 className="font-medium text-slate-900">เงินฝากในพอร์ต</h2>
            {canDelete && cashHoldings.length > 1 && <OrderToggle id={id} mode="cash" active={orderMode === "cash"} />}
          </div>
          <span className="text-sm text-slate-500">รวม <span className="font-medium tabular-nums text-slate-900">{money(cashThb, "THB", 0)}</span></span>
        </div>
        <table className="mt-2 w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">บัญชี</th><th className="px-3 text-right">ยอดคงเหลือ</th><th className="px-3 text-right">มูลค่า (บาท)</th>
              <th className="px-3 text-right">สัดส่วน</th><th className="px-3"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cashHoldings.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">ยังไม่มีบัญชีเงินฝาก</td></tr>}
            {(orderMode === "cash" ? [""] : [...cashByCcy.keys()]).map((ccy) => {
              // โหมดจัดลำดับ: แสดงทุกบัญชีตามลำดับจริง (ไม่จัดกลุ่มตามสกุล)
              const rows = orderMode === "cash" ? cashHoldings : cashHoldings.filter((h) => h.currency === ccy);
              const sub = cashByCcy.get(ccy) ?? { value: 0, count: 0 };
              const subThb = rows.reduce((t, h) => t + (thbOf(h) ?? 0), 0);
              return [
                ...rows.map((h, k) => {
                  const v = thbOf(h);
                  const share = v != null && totalThb > 0 ? (v / totalThb) * 100 : null;
                  const many = (cashByCcy.get(h.currency)?.count ?? 0) > 1;
                  return (
                    <tr key={h.id} className="align-top">
                      <td className="px-4 py-2.5">
                        <CashNameEdit id={h.id} name={h.name} purpose={h.purpose} interestRate={h.interest_rate} paths={paths}
                          canEdit={canWrite && orderMode !== "cash"}>
                          {h.is_default_cash && many && <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-normal text-blue-700" title="บัญชีหลักของสกุลนี้ — รายการที่ไม่ได้เลือกบัญชีจะเข้าบัญชีนี้">★ บัญชีหลัก</span>}
                        </CashNameEdit>
                        <div className="text-xs text-slate-500">
                          {h.currency}
                          {h.interest_rate != null && ` · ดอกเบี้ย ${Number(h.interest_rate)}% ต่อปี`}
                          {h.purpose && ` · ${h.purpose}`}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 text-right">
                        <div className="tabular-nums">{money(h.current_value, h.currency)}</div>
                        <div className="text-xs text-slate-500">{h.current_value_date ? `ณ ${thDate(h.current_value_date)}` : ""}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 text-right">
                        <div className="tabular-nums">{v == null ? "—" : money(v, undefined, 0)}</div>
                        {rateNote(h) && <div className="text-xs text-slate-500">{rateNote(h)}</div>}
                      </td>
                      <td className="px-3 text-right tabular-nums text-slate-600">{share != null ? `${share.toFixed(1)}%` : ""}</td>
                      <td className="px-3 py-2.5 text-right">
                        {orderMode === "cash" ? <MoveButtons id={id} hid={h.id} first={k === 0} last={k === rows.length - 1} /> : (
                          canDelete && many && !h.is_default_cash && (
                            <form action={setDefaultCash}>
                              <input type="hidden" name="holding_id" value={h.id} /><input type="hidden" name="asset_id" value={id} />
                              <button className="whitespace-nowrap text-xs text-slate-700 underline">ตั้งเป็นบัญชีหลัก</button>
                            </form>
                          ))}
                      </td>
                    </tr>
                  );
                }),
                ...(orderMode !== "cash" && sub.count > 1 ? [(
                  <tr key={`sub-${ccy}`} className="bg-slate-50/60 text-xs text-slate-600">
                    <td className="px-4 py-1.5">รวม {ccy} ({sub.count} บัญชี)</td>
                    <td className="px-3 text-right tabular-nums">{money(sub.value, ccy)}</td>
                    <td className="px-3 text-right tabular-nums">{money(subThb, undefined, 0)}</td>
                    <td colSpan={2}></td>
                  </tr>
                )] : []),
              ];
            })}
          </tbody>
        </table>
        {multiCash && <p className="px-4 pb-3 pt-2 text-xs text-slate-500">★ บัญชีหลัก = บัญชีที่ระบบเลือกให้ก่อนเมื่อบันทึกรายการสกุลนั้น (เปลี่ยนในฟอร์มได้ทุกครั้ง) · กดชื่อบัญชีเพื่อแก้ไข</p>}
      </section>

      {(unsettled ?? []).length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <h2 className="font-medium text-amber-900">รอชำระ (Trade แล้ว ยังไม่ Settle)</h2>
          <ul className="mt-1 space-y-0.5 text-amber-900">
            {(unsettled ?? []).map((u) => (
              <li key={u.transaction_id}>
                {u.direction === "PAYABLE" ? "รอจ่าย" : "รอรับ"} {money(u.net_amount, u.currency)} · {ITX_LABEL[u.transaction_type]}
                {" "}{byId.get(u.holding_id)?.name ?? ""} · เงินเข้า/ออก {thDate(u.settlement_date)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------ หลักทรัพย์: แท็บ ถือครอง | ผลตอบแทน | รายการ */}
      <TabsProvider initial={tab} defaultKey="hold">
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 pt-3">
          <TabNav tabs={[["hold", "ถือครอง"], ["ret", "ผลตอบแทน"], ["tx", "รายการ"]]} />
          <TabPanel id="hold" className="flex items-baseline gap-3 pb-2">
            {canDelete && securities.length > 1 && <OrderToggle id={id} mode="sec" active={orderMode === "sec"} />}
            <span className="text-sm text-slate-500">รวมหลักทรัพย์ <span className="font-medium tabular-nums text-slate-900">{money(secThb, "THB", 0)}</span></span>
          </TabPanel>
        </div>

        <TabPanel id="hold">
          <table className="mt-2 w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">หลักทรัพย์</th><th className="px-3 text-right">จำนวน</th><th className="px-3 text-right">ต้นทุนเฉลี่ย</th>
                <th className="px-3 text-right">ราคาล่าสุด</th><th className="px-3 text-right">มูลค่าตลาด</th><th className="px-3 text-right">มูลค่า (บาท)</th>
                <th className="px-3 text-right">กำไร/ขาดทุนยังไม่รับรู้</th><th className="px-3 text-right">สัดส่วน</th>
                {orderMode === "sec" && <th className="px-3"></th>}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {securities.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">ยังไม่มีหลักทรัพย์</td></tr>}
              {securities.map((h, k) => {
                const cost = h.average_cost != null ? Number(h.quantity) * Number(h.average_cost) : null;
                const gain = cost != null && h.current_value != null && !h.valued_at_cost ? Number(h.current_value) - cost : null;
                const v = thbOf(h);
                const share = h.status === "ACTIVE" && v != null && totalThb > 0 ? (v / totalThb) * 100 : null;
                return (
                  <tr key={h.id} className={`align-top ${h.status !== "ACTIVE" ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">
                        <Link href={`/investments/${id}/holding/${h.id}`} className="hover:underline">{h.name}</Link>
                        {h.symbol && <span className="ml-1 text-xs text-slate-500">{h.symbol}</span>}
                      </div>
                      <div className="text-xs text-slate-500">
                        {HOLDING_TYPE_LABEL[h.holding_type] ?? h.holding_type} · {h.currency}
                        {h.status !== "ACTIVE" && ` · ${STATUS_LABEL[h.status] ?? h.status}`}
                        {h.maturity_date && ` · ครบ ${thDate(h.maturity_date)}`}
                        {h.derived_status === "MATURITY_SOON" && <span className="text-amber-700"> · ใกล้ครบกำหนด</span>}
                      </div>
                    </td>
                    <td className="px-3 text-right tabular-nums">{qty(h.quantity)}</td>
                    <td className="px-3 text-right tabular-nums">{money(h.average_cost, undefined, 4)}</td>
                    <td className="px-3 text-right tabular-nums">{money(h.current_price, undefined, 4)}</td>
                    <td className="whitespace-nowrap px-3 text-right">
                      <div className="tabular-nums">{money(h.current_value)}</div>
                      <div className={`text-xs ${h.valued_at_cost ? "text-amber-700" : "text-slate-500"}`}>
                        {h.valued_at_cost ? "ราคาทุน · รอ Statement" : `ณ ${thDate(h.current_value_date)}`}
                        {autoIds.has(h.id) && <span className="text-sky-700"> · อัตโนมัติ</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 text-right">
                      <div className="tabular-nums">{v == null ? "—" : money(v, undefined, 0)}</div>
                      {rateNote(h) && <div className="text-xs text-slate-500">{rateNote(h)}</div>}
                    </td>
                    <td className={`px-3 text-right tabular-nums ${gain == null ? "" : gain >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {gain == null ? "" : <>{money(gain)}<div className="text-xs">{cost ? `${((gain / cost) * 100).toFixed(2)}%` : ""}</div></>}
                    </td>
                    <td className="px-3 text-right tabular-nums text-slate-600">{share != null ? `${share.toFixed(1)}%` : ""}</td>
                    {orderMode === "sec" && (
                      <td className="px-3 py-2.5 text-right"><MoveButtons id={id} hid={h.id} first={k === 0} last={k === securities.length - 1} /></td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 pb-3 pt-2 text-xs text-slate-500">
            มูลค่า (บาท) = มูลค่าในสกุลเดิม × อัตราแลกเปลี่ยนล่าสุด (บาทต่อ 1 หน่วย · วันที่ในวงเล็บ = วันของอัตรา) · ชุดเดียวกับ Net Worth
            · เงินฝาก {money(cashThb, undefined, 0)} + หลักทรัพย์ {money(secThb, undefined, 0)} = {money(cashThb + secThb, "THB", 0)}
            · กดชื่อหลักทรัพย์เพื่อดูรายละเอียด / แก้ไข / ครบกำหนด
          </p>
        </TabPanel>

        <TabPanel id="ret">
          <ReturnsTable bare rows={(rets as Ret[] | null) ?? []} local={(retsLocal as RetLocal[] | null) ?? []}
            portfolioCurrency={a.currency} rates={fxRates} hrefBase={`/investments/${id}/holding/`} />
        </TabPanel>

        <TabPanel id="tx" className="p-4">
          <div data-tx-panel="">
            {txList.length > 0 && (
              <TxFilter months={txMonths} types={Object.entries(ITX_LABEL)} holdings={holdings.map((h) => ({ id: h.id, name: h.name }))}
                initial={{ m: txMonth, type: txType, h: txHolding }}
                meta={txList.map((t) => ({ m: t.transaction_date.slice(0, 7), type: t.transaction_type,
                  h: [t.holding_id, t.cash_holding_id, t.counter_cash_holding_id].filter((x): x is string => !!x) }))} />
            )}
            {txList.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">ยังไม่มีรายการ</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr><th className="py-1">วันที่</th><th>ประเภท</th><th>หลักทรัพย์</th><th className="text-right">จำนวน × ราคา</th>
                      <th className="text-right">ยอด</th><th className="text-right">เงินฝากเพิ่ม / ลด</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {txList.map((t) => {
                      const bank = t.settle_from_asset_id ?? t.settle_to_asset_id;
                      const cashEffect = bank || (t.cash_movement_id && ["DEPOSIT", "WITHDRAWAL"].includes(t.transaction_type)) ? null : Number(t.net_cash);
                      return (
                        <tr key={t.id} className="align-top" data-tx="" data-m={t.transaction_date.slice(0, 7)} data-type={t.transaction_type}
                          data-h={[t.holding_id, t.cash_holding_id, t.counter_cash_holding_id].filter(Boolean).join(" ")}>
                          <td className="py-1.5">{thDate(t.transaction_date)}</td>
                          <td>{ITX_LABEL[t.transaction_type] ?? t.transaction_type}{t.direction && ` (${t.direction === "IN" ? "เพิ่ม" : "ลด"})`}</td>
                          <td className="text-slate-600">
                            {t.transaction_type === "CASH_TRANSFER" ? `${acctName(t.cash_holding_id)} → ${acctName(t.counter_cash_holding_id)}`
                              : t.transaction_type === "FX_EXCHANGE" ? `${acctName(t.cash_holding_id) || `เงินฝาก ${t.currency}`} → ${acctName(t.counter_cash_holding_id) || t.counter_currency}`
                              : t.holding_id ? byId.get(t.holding_id)?.name : acctName(t.cash_holding_id) || "เงินฝากพอร์ต"}
                            {multiCash && t.holding_id && t.cash_holding_id && t.cash_holding_id !== t.holding_id && (
                              <div className="text-xs text-slate-500">บัญชี: {acctName(t.cash_holding_id)}</div>
                            )}
                            {/* ชำระ / การโอน / หมายเหตุ — บรรทัดเล็กใต้ชื่อ (เฉพาะแถวที่มี) */}
                            <div className="text-xs text-slate-500">
                              {bank && <div>{t.transaction_type === "BUY" ? "จ่ายจาก" : "เข้า"} {bankName.get(bank) ?? "บัญชีธนาคาร"}{t.settlement_date && ` · ${thDate(t.settlement_date)}`}
                                {t.settlement_status === "UNSETTLED" && <span className="text-amber-700"> · รอชำระ</span>}</div>}
                              {t.cash_movement_id && (() => {
                                const m = transferById.get(t.cash_movement_id);
                                if (!m) return <div>สร้างจากการโอนเงิน</div>;
                                return (
                                  <div>
                                    {m.movement_type === "INVESTMENT_OUT" ? `จาก ${transferBank(m)}` : `ไป ${transferBank(m)}`}
                                    {m.counter_currency && m.counter_currency !== m.currency
                                      ? ` · ${money(m.amount, m.currency)} → ${m.counter_amount != null ? money(m.counter_amount, m.counter_currency) : `รอยอด ${m.counter_currency}`}` : ""}
                                    {(Number(m.fee ?? 0) > 0 || Number(m.counter_fee ?? 0) > 0) && ` · ค่าธรรมเนียม ${[
                                      Number(m.fee ?? 0) > 0 ? money(m.fee, m.currency) : null,
                                      Number(m.counter_fee ?? 0) > 0 ? money(m.counter_fee, m.counter_currency ?? undefined) : null].filter(Boolean).join(" + ")}`}
                                    {canWrite && <TransferEditForm assetId={id} t={m} bankLabel={transferBank(m)} cashAccounts={cashAccounts} minDate={goLive} today={today} rowMode />}
                                  </div>
                                );
                              })()}
                              {t.notes && <div>{t.notes}</div>}
                            </div>
                            {canWrite && !t.cash_movement_id && (
                              <RowActions table="investment_transactions" id={t.id} paths={paths} canDelete={canDelete}
                                deleteNote="รายได้ / เงินเข้าออกบัญชีที่ระบบสร้างจากรายการนี้จะถูกลบตาม"
                                fields={[
                                  ...(t.transaction_type === "OPENING_BALANCE" ? [] : [{ name: "transaction_date", label: "วันที่", type: "date" as const, value: t.transaction_date }]),
                                  ...(bank ? [{ name: "settlement_date", label: "วันชำระ", type: "date" as const, value: t.settlement_date }] : []),
                                  ...(t.quantity != null ? [{ name: "quantity", label: "จำนวน", type: "number" as const, value: t.quantity }] : []),
                                  ...(t.price != null ? [{ name: "price", label: "ราคา", type: "number" as const, value: t.price }] : []),
                                  ...(["BUY", "SELL", "OPENING_BALANCE"].includes(t.transaction_type) ? [] : [{ name: "amount", label: "ยอด", type: "number" as const, value: t.amount }]),
                                  ...(["FEE", "TAX", "OPENING_BALANCE", "ADJUSTMENT"].includes(t.transaction_type) ? [] : [{ name: "fee", label: "ค่าธรรมเนียม", type: "number" as const, value: t.fee }]),
                                  ...(["SELL", "REDEMPTION", "MATURITY", "DIVIDEND", "INTEREST", "COUPON"].includes(t.transaction_type) ? [{ name: "tax", label: "ภาษี", type: "number" as const, value: t.tax }] : []),
                                  { name: "notes", label: "หมายเหตุ", value: t.notes, width: "w-40" }]} />
                            )}
                          </td>
                          <td className="text-right tabular-nums text-slate-600">
                            {t.quantity != null && t.price != null ? `${qty(t.quantity)} × ${money(t.price, undefined, 4)}` : t.quantity != null ? qty(t.quantity) : ""}
                          </td>
                          <td className="text-right tabular-nums">
                            {money(t.amount)}{t.transaction_type === "FX_EXCHANGE" && <> {t.currency} → {money(t.counter_amount)} {t.counter_currency}</>}
                            {t.transaction_type === "CASH_TRANSFER" && <> {t.currency}</>}
                            {(Number(t.fee ?? 0) > 0 || Number(t.tax ?? 0) > 0) && (
                              <div className="text-xs text-slate-500">
                                {Number(t.fee ?? 0) > 0 && `ค่าธรรมเนียม ${money(t.fee)}`} {Number(t.tax ?? 0) > 0 && `ภาษี ${money(t.tax)}`}
                              </div>
                            )}
                          </td>
                          <td className={`text-right tabular-nums ${cashEffect == null || cashEffect === 0 ? "text-slate-400" : cashEffect > 0 ? "text-emerald-700" : "text-red-700"}`}>
                            {cashEffect == null ? "—" : cashEffect === 0 ? "0" : money(cashEffect)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-slate-500">
              กดที่รายการเพื่อแก้ไข / ลบ · &ldquo;—&rdquo; ในช่องเงินฝากเพิ่ม / ลด = เงินผ่านบัญชีธนาคารโดยตรง หรือเป็นเงินระหว่างทางจากการโอน · ผลตอบแทนนับตั้งแต่ Go-live (ยอดตั้งต้นใช้ต้นทุนเดิม)
            </p>
          </div>
        </TabPanel>
      </section>
      </TabsProvider>

    </div>
    </CurrencyScope>
  );
}

/** ปุ่ม "จัดลำดับ" / "เสร็จ" ต่อชื่อกล่อง */
function OrderToggle({ id, mode, active }: { id: string; mode: "cash" | "sec"; active: boolean }) {
  return active
    ? <Link href={`/investments/${id}`} scroll={false} className="rounded-md bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-700">เสร็จ</Link>
    : <Link href={`/investments/${id}?order=${mode}`} scroll={false} className="text-xs text-slate-600 underline">จัดลำดับ</Link>;
}

/** ↑ ↓ — มีผลทันทีทุกครั้งที่กด */
function MoveButtons({ id, hid, first, last }: { id: string; hid: string; first: boolean; last: boolean }) {
  const b = "rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-30";
  return (
    <div className="inline-flex gap-1">
      <form action={moveHolding}><input type="hidden" name="holding_id" value={hid} /><input type="hidden" name="asset_id" value={id} />
        <input type="hidden" name="dir" value="-1" /><button className={b} disabled={first} aria-label="เลื่อนขึ้น">↑</button></form>
      <form action={moveHolding}><input type="hidden" name="holding_id" value={hid} /><input type="hidden" name="asset_id" value={id} />
        <input type="hidden" name="dir" value="1" /><button className={b} disabled={last} aria-label="เลื่อนลง">↓</button></form>
    </div>
  );
}
