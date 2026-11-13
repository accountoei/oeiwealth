import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { detailTitle } from "@/lib/page-title";
import { cachedRpc } from "@/lib/data-cache";
import { requireAppUser } from "@/lib/auth";
import { COUPON_FREQ_LABEL, HOLDING_TYPE_LABEL, ITX_LABEL, addDays, money, qty, thDate, todayBangkok } from "@/lib/format";
import RowActions from "@/components/RowActions";
import { portfolioTxCols, portfolioTxFields } from "@/lib/source-edit";
import StatusSelect from "@/components/StatusSelect";
import { type CashAcct, type Holding } from "../../forms";
import { defaultIncomeAccount, incomeAccountOptions } from "@/lib/income-account";
import { COUPON_MONTHS, scheduleOf, type StoredLine } from "@/lib/coupon-schedule";
import { CouponEditor } from "./coupon-editor";
import { dueLabel } from "../../../due";
import { DueStatus } from "../../../due-batch";
import type { Ret, RetLocal } from "../../ReturnsTable";
import { ConvertUnitsForm, HoldingInfoForm, IncomeForm, UnderlyingForm, type Fcn } from "./forms";
import EditToggle from "@/components/EditToggle";
import { ActionBar } from "@/components/ActionBar";
import { DetailItem as Item } from "@/components/Boxes";
import PendingPrice, { type Pending } from "@/components/PendingPrice";
import HoldingHistory, { PriceHistory } from "./history";
import { InfoTip } from "@/components/HeaderBar";
import { activeBanks } from "@/lib/pay-sources";
import { VALUATION_AT_COLS, openingValues, ratesAt, type RateAt, type ValuationAt } from "@/lib/net-invested";
import HoldingValueBox from "./value-box";

const STATUS_LABEL: Record<string, string> = { ACTIVE: "ถืออยู่", SOLD: "ขายแล้ว", MATURED: "ครบกำหนด", AUTOCALLED: "Autocall (ครบกำหนดก่อนกำหนด)" };
const STRUCTURED = ["FCN", "STRUCTURED_PRODUCT"];
/** รายการที่เงินเข้า (แถวสีเขียวในตาราง) */
const MONEY_IN = ["COUPON", "INTEREST", "DIVIDEND", "MATURITY", "REDEMPTION", "SELL"];
const VAL_SOURCE_LABEL: Record<string, string> = { OPENING: "มูลค่า ณ วันตั้งต้น", STATEMENT: "ราคาตาม Statement", MARKET: "ราคาตลาด (อัตโนมัติ)", USER: "ราคา (ผู้ใช้ใส่)" };

type H = Holding & { portfolio_asset_id: string; average_cost: number | null; current_value: number | null; current_value_date: string | null;
  maturity_date: string | null; derived_status: string | null; valued_at_cost: boolean; notes: string | null };
type Tx = { id: string; transaction_date: string; settlement_date: string | null; transaction_type: string; quantity: number | null;
  price: number | null; amount: number; fee: number | null; tax: number | null; direction: string | null; notes: string | null;
  settle_from_asset_id: string | null; settle_to_asset_id: string | null; cash_movement_id: string | null; cost_base_currency: number | null };
type U = { id: string; symbol: string; name: string | null; initial_price: number | null; strike_price: number | null; barrier_price: number | null };

// ข้อมูลหลักของหน้า: ใช้ทั้งชื่อแท็บเบราว์เซอร์และในหน้า (cache → โหลดครั้งเดียวต่อการเปิดหน้า)
const loadHolding = cache(async (id: string, hid: string) =>
  (await createClient()).from("v_holdings_active").select("*").eq("id", hid).eq("portfolio_asset_id", id).maybeSingle());

export async function generateMetadata({ params }: { params: Promise<{ id: string; hid: string }> }) {
  const { id, hid } = await params;
  return detailTitle(() => loadHolding(id, hid).then((r) => r.data?.name), "Investments");
}

export default async function HoldingPage({ params }: { params: Promise<{ id: string; hid: string }> }) {
  const { id, hid } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const famQ = supabase.from("families").select("go_live_date").maybeSingle().then((r) => r);
  const [{ data: hRow }, { data: a }, { data: txs }, { data: vals }, { data: rets }, { data: fcnRow }, { data: banks }, { data: family }, { data: cashRows }, { data: retsLocal }, { data: autoRow },
    [{ data: vals0 }, { data: rates0 }], { data: lineRows }] = await Promise.all([
    loadHolding(id, hid),
    supabase.from("assets").select("name,currency").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_investment_transactions_net").select("*").eq("holding_id", hid)
      .order("transaction_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("investment_valuations").select("id,valuation_date,price,quantity,market_value,source").eq("holding_id", hid)
      .is("deleted_at", null).order("valuation_date", { ascending: false }).limit(1500),   // ราคาอัตโนมัติขึ้นทุกวันทำการ ≈ 6 ปี
    cachedRpc<Ret[]>("investment_returns", { p_portfolio_asset_id: id }).then((data) => ({ data })),   // ผลเดียวกับหน้ารวม (จำไว้ / จนมีการบันทึก)
    supabase.from("fcn_details").select("*, fcn_underlyings(id,symbol,name,initial_price,strike_price,barrier_price,deleted_at)")
      .eq("holding_id", hid).is("deleted_at", null).maybeSingle(),
    activeBanks(supabase),
    famQ,
    supabase.from("v_holdings_active").select("id,name,currency,is_default_cash").eq("portfolio_asset_id", id)
      .eq("holding_type", "CASH").eq("status", "ACTIVE").order("created_at"),
    cachedRpc<RetLocal[]>("investment_returns_local", { p_portfolio_asset_id: id }).then((data) => ({ data })),   // คู่กับบรรทัดบน (ตารางเดียวกัน → ตัวเลขชุดเดียวกัน)
    supabase.from("investment_holdings").select("auto_price,price_ref,price_pending,valuation_mode,face_value,interest_rate,coupon_frequency,income_cash_holding_id,income_bank_asset_id").eq("id", hid).maybeSingle(),
    // ผลตอบแทนก่อน Go-live: มูลค่าตลาด + อัตรา (บาท) ถึงวันก่อน Go-live (เหมือนหน้าพอร์ต · ตกลง 13 พ.ย. 2026)
    famQ.then(async ({ data: f }) => {
      const d0 = f?.go_live_date ? addDays(f.go_live_date, -1) : null;
      return d0 ? Promise.all([
        supabase.from("investment_valuations").select(VALUATION_AT_COLS).eq("holding_id", hid).lte("valuation_date", d0).is("deleted_at", null)
          .order("valuation_date", { ascending: false }).limit(1).then((r) => r),
        supabase.from("fx_rates").select("currency,rate_date,rate_to_thb").eq("rate_type", "MID_AVERAGE").is("deleted_at", null)
          .gte("rate_date", addDays(d0, -14)).lte("rate_date", d0).then((r) => r),
      ]) : [{ data: [] }, { data: [] }];
    }),
    supabase.from("investment_coupon_lines").select("due_date,interest_due,principal_due,notes").eq("holding_id", hid).is("deleted_at", null).order("due_date"),
  ]);
  const cashAccounts = (cashRows ?? []) as CashAcct[];
  const h = hRow ? { ...(hRow as H), auto_price: !!autoRow?.auto_price, price_ref: (autoRow?.price_ref as string | null) ?? null } : null;
  if (!h || !a || h.holding_type === "CASH") notFound();

  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();
  const goLive = family?.go_live_date ?? "";
  const paths = [`/investments/${id}/holding/${hid}`, `/investments/${id}`, "/investments", "/income-expenses"];
  const ret = ((rets as Ret[] | null) ?? []).filter((r) => r.holding_id === hid);
  const retLocal = ((retsLocal as RetLocal[] | null) ?? []).filter((r) => r.holding_id === hid);
  const isStructured = STRUCTURED.includes(h.holding_type);
  const fcn = fcnRow as (Fcn & { fcn_underlyings: (U & { deleted_at: string | null })[] }) | null;
  const unders = (fcn?.fcn_underlyings ?? []).filter((u) => !u.deleted_at);
  const txList = (txs as Tx[] | null) ?? [];
  const cost = h.average_cost != null ? Number(h.quantity) * Number(h.average_cost) : null;
  const daysLeft = h.maturity_date ? Math.round((Date.parse(h.maturity_date) - Date.parse(today)) / 86400000) : null;
  const coupons = txList.filter((t) => ["COUPON", "INTEREST", "DIVIDEND"].includes(t.transaction_type));
  const couponGross = coupons.reduce((s, t) => s + Number(t.amount), 0);
  const couponTax = coupons.reduce((s, t) => s + Number(t.tax ?? 0), 0);
  const otherFees = txList.filter((t) => t.transaction_type === "FEE" || t.transaction_type === "TAX").reduce((s, t) => s + Number(t.amount), 0);
  const canMature = h.status === "ACTIVE" && ["BOND", "FCN", "STRUCTURED_PRODUCT", "OTHER"].includes(h.holding_type);
  // ตารางรับดอกเบี้ย / เงินต้น (หุ้นกู้: ข้อมูลในแก้ไขข้อมูล · FCN: รายละเอียด FCN · ตั้งเองรายงวด: ปุ่ม "+ ตั้งตารางรับ")
  const hasCoupon = ["BOND", "OTHER"].includes(h.holding_type);
  const hasSched = ["BOND", "FCN", "STRUCTURED_PRODUCT", "OTHER"].includes(h.holding_type);
  const stored = (lineRows as StoredLine[] | null) ?? [];
  const sched = hasSched
    ? scheduleOf({ ...h, face_value: autoRow?.face_value, interest_rate: autoRow?.interest_rate, coupon_frequency: autoRow?.coupon_frequency }, fcn, txList, stored, goLive)
    : [];
  // ปุ่ม "+ รับ…" เติมงวดดอกเบี้ยที่ค้างรับ (เก่าสุด) ไม่มี = งวดถัดไป (แบบปุ่มบันทึกรับชำระของเงินกู้ · ตกลง 13 พ.ย. 2026)
  const waiting = (x: (typeof sched)[number]) => x.kind === "INTEREST" && !x.received && !x.pre && !x.cancelled;
  const dueNext = sched.find((x) => waiting(x) && x.due <= today) ?? sched.find(waiting);
  // งวดก่อน Go-live (ข้อมูลเท่านั้น) → รวมไว้ท้ายตาราง
  const preLines = sched.filter((x) => x.pre && x.kind === "INTEREST");
  const preSum = preLines.reduce((s, x) => s + Number(x.expected ?? 0), 0);
  // หน้าต่างตั้ง / แก้ตารางรับ: เริ่มจากงวดที่ตั้งไว้ ไม่มี = งวดที่คำนวณจากข้อมูลหลัก (ดอกเบี้ย + เงินต้นวันเดียวกัน = งวดเดียว)
  const editorLines = stored.length
    ? stored.map((l) => ({ due_date: l.due_date, principal: Number(l.principal_due), interest: Number(l.interest_due), notes: l.notes ?? undefined }))
    : [...new Set(sched.map((x) => x.due))].sort().map((d) => {
      const sum = (k: string) => sched.filter((x) => x.due === d && x.kind === k).reduce((s, x) => s + Number(x.expected ?? 0), 0);
      return { due_date: d, principal: sum("PRINCIPAL"), interest: sum("INTEREST") };
    }).filter((l) => l.principal + l.interest > 0);
  const freq0 = autoRow?.coupon_frequency ?? fcn?.coupon_frequency ?? "";
  const pct = (v: number | null) => (v == null ? "-" : `${Number(v)}%`);
  // วิธีนับ: มูลค่าก้อนเดียว = ไม่แสดงจำนวน / ราคาต่อหน่วย (เก็บภายในเป็น 1 × มูลค่า)
  const lump = autoRow?.valuation_mode === "LUMP_SUM";
  // จำนวนหน่วยที่ถือ ณ วันที่ — สูตรเดียวกับฐานข้อมูล (private.holding_value_at)
  const txAsc = [...txList].reverse();
  const qtyAt = (d: string) => {
    let q = 0;
    for (const t of txAsc) {
      if (t.transaction_date > d) break;
      const tq = Number(t.quantity ?? 0);
      if (t.transaction_type === "OPENING_BALANCE") q = tq;
      else if (t.transaction_type === "BUY") q += tq;
      else if (t.transaction_type === "SELL" || t.transaction_type === "REDEMPTION") q = Math.max(q - (t.quantity == null ? q : tq), 0);
      else if (t.transaction_type === "MATURITY") q = 0;
      else if (t.transaction_type === "ADJUSTMENT" && t.quantity != null) q = Math.max(q + (t.direction === "IN" ? tq : -tq), 0);
    }
    return q;
  };
  type V = { id: string; valuation_date: string; price: number | null; quantity: number; market_value: number; source: string };
  const valRows = ((vals as V[] | null) ?? []).map((v) => {
    const q = lump ? 1 : qtyAt(v.valuation_date);
    const value = v.price != null ? Number(v.price) * q : Number(v.quantity) > 0 ? Number(v.market_value) * q / Number(v.quantity) : Number(v.market_value);
    return { ...v, q, value };
  });
  // กล่องราคา: ราคาอัตโนมัติเดือนละบรรทัด = ราคาล่าสุดของเดือน · ที่เหลือ = รายวัน (ซ่อนไว้ก่อน · ส่งเฉพาะ 1 ปีล่าสุด)
  const marketMonths = new Set<string>();
  const dailyFrom = addDays(today, -366);
  const priceRows = valRows.map((v) => {
    const m = v.valuation_date.slice(0, 7);
    const daily = v.source === "MARKET" && marketMonths.has(m);
    if (v.source === "MARKET") marketMonths.add(m);
    return { ...v, daily };
  }).filter((v) => !v.daily || v.valuation_date >= dailyFrom);
  // แปลงเป็นจำนวนหน่วย: มีแค่ยอดตั้งต้น · มูลค่าก้อนเดียว หรือ 1 หน่วย
  const opening = txList.find((t) => t.transaction_type === "OPENING_BALANCE");
  const onlyOpening = !!opening && txList.every((t) => t.transaction_type === "OPENING_BALANCE");
  const canConvert = canDelete && h.status === "ACTIVE" && onlyOpening && (lump || Number(h.quantity) === 1);
  const openingVal = opening ? valRows.find((v) => v.valuation_date === opening.transaction_date) : undefined;
  const openingValue = openingVal ? openingVal.value : opening ? Number(opening.amount) : 0;
  // กล่องมูลค่า (ตกลง 13 พ.ย. 2026): บรรทัดเดียวกับกล่องพอร์ต · รวมผลตอบแทน = แถวของตัวนี้ในตารางผลตอบแทน
  //   ก่อน Go-live = มูลค่าตลาด ณ วันก่อน Go-live − ต้นทุนยอดตั้งต้น (บาท: อัตรา ณ วันนั้น − ต้นทุนบาทที่บันทึก) · ตั้งแต่ Go-live = รวม − ก่อน Go-live
  //   % = รวมผลตอบแทน ÷ เงินที่ใส่ในตัวนี้ (ยอดตั้งต้น + ซื้อเพิ่ม)
  const r = ret[0], rl = retLocal[0];
  const fxH = h.currency !== "THB";
  const thb0 = ratesAt((rates0 as RateAt[] | null) ?? [], goLive ? addDays(goLive, -1) : "");
  const ov = opening && goLive && opening.transaction_date < goLive
    ? openingValues(id, [{ portfolio_asset_id: id, holding_id: hid, transaction_date: opening.transaction_date, quantity: opening.quantity, price: opening.price,
      currency: h.currency, cost_base_currency: opening.cost_base_currency }], (vals0 as ValuationAt[] | null) ?? [])[0] : null;
  const k0 = thb0(h.currency);
  const pre = ov ? { thb: k0 == null || opening?.cost_base_currency == null ? null : ov.value * k0 - Number(opening.cost_base_currency), ccy: ov.value - ov.cost } : null;
  const paid = (f: (t: Tx) => number | null) => txList.filter((t) => ["OPENING_BALANCE", "BUY"].includes(t.transaction_type))
    .reduce<number | null>((s, t) => { const x = f(t); return s == null || x == null ? null : s + x; }, 0);
  const paidCcy = paid((t) => Number(t.amount) + (t.transaction_type === "BUY" ? Number(t.fee ?? 0) : 0));
  const paidThb = fxH ? paid((t) => (t.cost_base_currency == null ? null : Number(t.cost_base_currency))) : paidCcy;
  const income = coupons.reduce((s, t) => s + Number(t.amount) - Number(t.tax ?? 0) - Number(t.fee ?? 0), 0);
  const sinceCcy = rl ? Number(rl.total) - (pre?.ccy ?? 0) : null;
  const split = r && rl ? {
    pre,
    since: { thb: pre && pre.thb == null ? null : Number(r.total_thb) - (pre?.thb ?? 0), ccy: sinceCcy, income, price: sinceCcy == null ? null : sinceCcy - income },
    total: { thb: Number(r.total_thb), ccy: Number(rl.total), pctThb: paidThb ? (Number(r.total_thb) / paidThb) * 100 : null, pctCcy: paidCcy ? (Number(rl.total) / paidCcy) * 100 : null },
  } : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/investments/${id}`} className="text-sm text-slate-500 hover:underline">← {a.name}</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{h.name}{h.symbol && <span className="ml-2 text-base text-slate-500">{h.symbol}</span>}</h1>
            <p className="text-sm text-slate-500">
              {HOLDING_TYPE_LABEL[h.holding_type] ?? h.holding_type} · {h.currency} · {STATUS_LABEL[h.status] ?? h.status}
              {h.maturity_date && <> · ครบกำหนด {thDate(h.maturity_date)}{h.status === "ACTIVE" && daysLeft != null && daysLeft >= 0 && ` (อีก ${daysLeft} วัน)`}</>}
              {h.derived_status === "MATURITY_SOON" && <span className="text-amber-700"> · ใกล้ครบกำหนด</span>}
            </p>
          </div>
          {canWrite && h.status === "ACTIVE" && (
            <ActionBar>
              <IncomeForm assetId={id} portfolioName={a.name} holdingId={hid} holdingName={h.name} currency={h.currency} isFcn={isStructured} canMature={canMature} banks={banks ?? []} cashAccounts={cashAccounts} today={today} minDate={goLive}
                {...(dueNext && { defaultType: "COUPON", defaultAmount: dueNext.expected, defaultNotes: `${dueLabel(dueNext)} (ครบ ${thDate(dueNext.due)})`,
                  defaultDate: dueNext.due > today ? today : dueNext.due < goLive ? goLive : dueNext.due })}
                incomeAccount={defaultIncomeAccount(incomeAccountOptions(cashAccounts, banks ?? [], h.currency), autoRow?.income_cash_holding_id, autoRow?.income_bank_asset_id)} />
              <Link href={`/investments/${id}`} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">ซื้อ / ขาย / อัปเดตราคา (หน้าพอร์ต)</Link>
            </ActionBar>
          )}
        </div>
      </div>

      {autoRow?.price_pending && (
        <PendingPrice kind="holding" id={hid} pending={autoRow.price_pending as Pending} currency={h.currency} canResolve={canDelete} paths={paths} />
      )}

      {canConvert && opening && (
        <ConvertUnitsForm assetId={id} holdingId={hid} isFund={h.holding_type === "FUND"} lump={lump} symbol={h.symbol ?? ""}
          openingDate={opening.transaction_date} openingValue={openingValue} currency={h.currency} paths={paths} />
      )}

      <section className="grid gap-4 md:grid-cols-3">
        {/* ซ้าย: มูลค่า */}
        <HoldingValueBox currency={h.currency} value={{ thb: r ? Number(r.value_thb) : fxH ? null : h.current_value, ccy: h.current_value }}
          cost={{ thb: r ? Number(r.cost_thb) : fxH ? null : cost, ccy: cost }} lump={lump} quantity={Number(h.quantity)} avgCost={h.average_cost}
          dateNote={<div className={`mt-1 text-xs ${h.valued_at_cost ? "text-amber-700" : "text-slate-500"}`}>{h.valued_at_cost ? "ราคาทุน · รอ Statement" : `ณ ${thDate(h.current_value_date)}`}</div>}
          split={split} incomeCount={coupons.length} soldSince={txList.some((t) => ["SELL", "REDEMPTION", "MATURITY"].includes(t.transaction_type))} />
        <div className="rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
          <EditToggle title="รายละเอียด" canEdit={canWrite}
            view={
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Item label="ชื่อ">{h.name}</Item>
                <Item label="สัญลักษณ์ / รหัส">{h.symbol || "-"}</Item>
                <Item label="ประเภท">{HOLDING_TYPE_LABEL[h.holding_type] ?? h.holding_type}</Item>
                <Item label="สกุลเงิน">{h.currency}</Item>
                <Item label="ครบกำหนด">{h.maturity_date ? thDate(h.maturity_date) : "-"}</Item>
                <Item label="สถานะ">{STATUS_LABEL[h.status] ?? h.status}</Item>
                <Item label="วิธีนับมูลค่า">{lump ? "มูลค่าก้อนเดียว" : "นับเป็นหน่วย"}</Item>
                {(h.holding_type === "EQUITY" || h.holding_type === "FUND") && <Item label="ราคาอัตโนมัติ">{h.auto_price ? `เปิด · ${h.holding_type === "FUND" ? "NAV จาก ก.ล.ต." : "Yahoo Finance"}${h.price_ref ? ` (${h.price_ref})` : ""}` : "ปิด"}</Item>}
                {isStructured && fcn && <>
                  <Item label="ผู้ออก">{fcn.issuer}</Item>
                  <Item label="เงินต้น">{money(fcn.principal, h.currency)}</Item>
                  <Item label="วันที่ซื้อ / ออก">{`${fcn.trade_date ? thDate(fcn.trade_date) : "-"} / ${fcn.issue_date ? thDate(fcn.issue_date) : "-"}`}</Item>
                  <Item label="Coupon">{`${pct(fcn.coupon_rate)} ต่อปี${fcn.coupon_frequency ? ` · ${COUPON_FREQ_LABEL[fcn.coupon_frequency] ?? fcn.coupon_frequency}` : ""}`}</Item>
                  {fcn.coupon_rate != null && <Item label="Coupon ต่องวด (ประมาณ)">{money(Number(fcn.principal) * Number(fcn.coupon_rate) / 100 /
                    ({ MONTHLY: 12, QUARTERLY: 4, SEMI_ANNUAL: 2, ANNUAL: 1 }[fcn.coupon_frequency ?? ""] ?? 1), h.currency)}</Item>}
                  <Item label="Strike">{pct(fcn.strike_level)}</Item>
                  <Item label="Knock-in / Barrier">{pct(fcn.barrier_level)}{fcn.knock_in_occurred && <span className="ml-2 rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">Knock-in แล้ว{fcn.knock_in_date && ` ${thDate(fcn.knock_in_date)}`}</span>}</Item>
                  <Item label="Autocall">{`${pct(fcn.autocall_level)}${fcn.observation_frequency ? ` · สังเกต ${fcn.observation_frequency}` : ""}`}</Item>
                </>}
                {h.notes && <Item label="หมายเหตุ" wide>{h.notes}</Item>}
              </dl>
            }
            edit={
              <div className="space-y-5">
                <HoldingInfoForm id={hid} paths={paths} coupon={hasCoupon ? { face_value: autoRow?.face_value ?? null, interest_rate: autoRow?.interest_rate ?? null,
                  coupon_frequency: autoRow?.coupon_frequency ?? null, currency: h.currency } : null} autoKind={h.holding_type === "EQUITY" || h.holding_type === "FUND" ? h.holding_type : null}
                  autoBlocked={lump ? "มูลค่าก้อนเดียวดึงราคาอัตโนมัติไม่ได้ — แปลงเป็นจำนวนหน่วยก่อน" : h.holding_type === "FUND" && Number(h.quantity) === 1 && !h.auto_price ? "กองทุนนี้มีจำนวน 1 หน่วย (มักเป็นมูลค่ารวมที่ใส่แทนจำนวน) — แปลงเป็นจำนวนหน่วยก่อน" : null}
                  v={{ name: h.name, symbol: h.symbol, maturity_date: h.maturity_date, notes: h.notes, auto_price: h.auto_price, price_ref: h.price_ref }}
                  income={{ currency: h.currency, cashAccounts, banks: banks ?? [], cashId: autoRow?.income_cash_holding_id ?? null, bankId: autoRow?.income_bank_asset_id ?? null }}
                  structured={isStructured ? { assetId: id, label: HOLDING_TYPE_LABEL[h.holding_type] ?? h.holding_type, fcn, defaultPrincipal: cost } : null} />
                {isStructured && ["MATURED", "AUTOCALLED"].includes(h.status) && (
                  <div className="border-t border-slate-100 pt-4"><StatusSelect table="investment_holdings" id={hid} value={h.status} paths={paths} label="ปิดแบบ"
                    options={[["MATURED", "ครบกำหนดตามปกติ"], ["AUTOCALLED", "Autocall (ถูกเรียกคืนก่อนกำหนด)"]]} /></div>
                )}
                {isStructured && h.status === "ACTIVE" && (
                  <p className="text-xs text-slate-500">ถูก Autocall: กด &ldquo;+ รับ Coupon&rdquo; → ประเภท &ldquo;คืนเงินต้น&rdquo; (ใส่วันที่ถูกเรียกคืน) แล้วกลับมาเลือก &ldquo;ปิดแบบ Autocall&rdquo; ที่นี่</p>
                )}
              </div>
            } />
          {h.maturity_date && h.status === "ACTIVE" && h.maturity_date < addDays(today, 0) && (
            <p className="mt-3 text-xs text-amber-700">เลยวันครบกำหนดแล้ว — กด &ldquo;{isStructured ? "+ รับ Coupon" : "+ รับปันผล / ดอกเบี้ย"}&rdquo; → ประเภท &ldquo;คืนเงินต้น&rdquo; เมื่อได้รับเงินต้นคืน</p>
          )}
        </div>
      </section>

      {isStructured && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div>
              <h2 className="mb-2 font-medium text-slate-900">หุ้นอ้างอิง (Underlying) <InfoTip label="คำอธิบาย">ราคา Strike / Barrier ที่ไม่ได้ใส่ คำนวณจากราคาเริ่มต้น × ระดับ % · Knock-in ให้ติ๊กในแก้ไขข้อมูลเมื่อธนาคารแจ้ง</InfoTip></h2>
              {unders.length === 0 ? <p className="text-sm text-slate-500">ยังไม่ได้ใส่</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">หุ้น</th><th className="text-right">ราคาเริ่มต้น</th>
                    <th className="text-right">Strike</th><th className="text-right">Knock-in / Barrier</th><th></th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {unders.map((u) => {
                      const auto = (lv: number | null) => (u.initial_price != null && lv != null ? Number(u.initial_price) * Number(lv) / 100 : null);
                      const strike = u.strike_price ?? auto(fcn?.strike_level ?? null);
                      const barrier = u.barrier_price ?? auto(fcn?.barrier_level ?? null);
                      return (
                        <tr key={u.id}>
                          <td className="py-1.5 font-medium">{u.symbol}{u.name && <span className="ml-1 text-xs font-normal text-slate-500">{u.name}</span>}</td>
                          <td className="text-right tabular-nums">{money(u.initial_price, undefined, 4)}</td>
                          <td className="text-right tabular-nums">{money(strike, undefined, 4)}{u.strike_price == null && strike != null && <span className="text-xs text-slate-400"> (คำนวณ)</span>}</td>
                          <td className="text-right tabular-nums">{money(barrier, undefined, 4)}{u.barrier_price == null && barrier != null && <span className="text-xs text-slate-400"> (คำนวณ)</span>}</td>
                          <td className="pl-2 text-right">{canWrite && <RowActions table="fcn_underlyings" id={u.id} paths={paths} canDelete={canDelete} fields={[
                            { name: "symbol", label: "สัญลักษณ์", value: u.symbol, width: "w-24" }, { name: "initial_price", label: "ราคาเริ่มต้น", type: "number", value: u.initial_price },
                            { name: "strike_price", label: "Strike", type: "number", value: u.strike_price }, { name: "barrier_price", label: "Barrier", type: "number", value: u.barrier_price }]} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {canWrite && (fcn ? <div className="mt-2"><UnderlyingForm assetId={id} fcnId={fcn.id} /></div>
                : <p className="mt-2 text-xs text-slate-500">เพิ่มหุ้นอ้างอิงได้หลังใส่ผู้ออก + เงินต้น ใน &ldquo;แก้ไขข้อมูล&rdquo; ของกล่องรายละเอียด</p>)}
          </div>
        </section>
      )}

      <PriceHistory info={<InfoTip label="คำอธิบาย">ล่าสุดขึ้นก่อน · แสดง 12 เดือนล่าสุด ที่เก่ากว่ากด &ldquo;ดูทั้งหมด&rdquo; ·
        ราคาอัตโนมัติ (ขึ้นทุกวันทำการ) แสดงเฉพาะราคาล่าสุดของแต่ละเดือน ติ๊ก &ldquo;แสดงราคารายวัน&rdquo; เพื่อดูทุกวัน{lump ? "" : " · จำนวน = หน่วยที่ถือ ณ วันนั้น"} ·
        อัปเดตราคาที่หน้าพอร์ต · คลิกแถวเพื่อแก้ไข</InfoTip>}
        head={<thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th>ที่มา</th><th className="text-right">จำนวน</th>
          <th className="text-right">ราคา</th><th className="text-right">มูลค่า</th><th></th></tr></thead>}
        rows={priceRows.map((v) => ({ key: v.id, month: v.valuation_date.slice(0, 7), daily: v.daily, row: (
          <tr>
            <td className="py-1.5">{thDate(v.valuation_date)}</td>
            <td>{VAL_SOURCE_LABEL[v.source] ?? v.source}</td>
            <td className="text-right tabular-nums">{lump ? <span className="text-slate-400">—</span> : qty(v.q)}</td>
            <td className="text-right tabular-nums">{lump || v.price == null ? <span className="text-slate-400">—</span> : money(v.price, undefined, 4)}</td>
            <td className="text-right tabular-nums">{money(v.value)}</td>
            <td className="pl-2 text-right">{canWrite && v.source !== "OPENING" && <RowActions table="investment_valuations" id={v.id} paths={paths} canDelete={canDelete} cols={4}
              fields={[
                // วันที่ · จำนวน · ราคา · มูลค่า แถวเดียว · แก้ราคา → มูลค่าเปลี่ยนตาม · แก้มูลค่า → ราคา = มูลค่า ÷ จำนวน (ตกลง 24 ต.ค.)
                { name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date },
                ...(lump || !(v.q > 0)
                  ? [{ name: "market_value", label: "มูลค่า", type: "number" as const, value: v.market_value }]
                  : [{ name: "held", label: "จำนวนที่ถือ ณ วันนั้น", type: "number" as const, value: qty(v.q), readOnly: true },
                     { name: "price", label: "ราคา", type: "number" as const, value: v.price ?? Number((v.value / v.q).toFixed(6)),
                       calc: { op: "div" as const, a: "market_value", b: "held", digits: 6 } },
                     { name: "market_value", label: "มูลค่า", type: "number" as const, value: Number(v.value.toFixed(2)),
                       calc: { op: "mul" as const, a: "held", b: "price" } }]),
              ]} />}</td>
          </tr>
          ) }))} />

      <HoldingHistory title={sched.length ? "ตารางรับและรายการ" : "รายการ"}
        tools={hasSched && canDelete && <CouponEditor assetId={id} holdingId={hid} currency={h.currency} goLive={goLive} current={editorLines} hasSchedule={stored.length > 0}
          defaults={{ face: Number(autoRow?.face_value ?? fcn?.principal ?? cost ?? 0), ratePct: Number(autoRow?.interest_rate ?? fcn?.coupon_rate ?? 0),
            freq: COUPON_MONTHS[freq0] || freq0 === "AT_MATURITY" ? freq0 : "SEMI_ANNUAL",
            start: fcn?.issue_date ?? fcn?.trade_date ?? txList.filter((t) => ["OPENING_BALANCE", "BUY"].includes(t.transaction_type)).at(-1)?.transaction_date ?? "",
            maturity: h.maturity_date ?? "" }} />}
        info={sched.length > 0 && <InfoTip label="คำอธิบายตาราง">{stored.length
          ? <>งวดตามตารางที่ตั้งไว้ (แก้ที่ปุ่ม &ldquo;แก้ตารางรับทั้งชุด&rdquo;)</>
          : <>งวดตามตาราง คำนวณจากเงินต้น · อัตรา · จ่ายทุก · วันครบกำหนด (แก้ได้ที่ &ldquo;แก้ไขข้อมูล&rdquo; หรือตั้งเองรายงวดที่ปุ่ม &ldquo;+ ตั้งตารางรับ&rdquo;)</>} ·
          ก่อน Go-live = ข้อมูลเท่านั้น ไม่เข้ายอดเงิน · ยกเลิก = ขาย / ครบกำหนดก่อนถึงงวด ·
          แถวสีเขียว = เงินที่ได้รับจริง (ปันผล ดอกเบี้ย เงินต้นคืน ขาย) · แถวสีฟ้า = ยอดตั้งต้น / ซื้อ ·
          บันทึกรับ: ปุ่ม &ldquo;{isStructured ? "+ รับ Coupon" : "+ รับปันผล / ดอกเบี้ย"}&rdquo; ด้านบน (เติมยอดงวดที่ถึงกำหนดให้) หรือแท็บ &ldquo;บันทึกรับผลตอบแทน&rdquo; ของหน้า Investments · คลิกแถวรายการเพื่อแก้ไข</InfoTip>}
        head={
        <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th>รายการ</th><th className="text-right">จำนวน</th>
          <th className="text-right">ราคา</th><th className="text-right">ยอดเงิน</th><th className="pl-4">{sched.length ? "สถานะ / หมายเหตุ" : "หมายเหตุ"}</th><th></th></tr></thead>
      } foot={coupons.length > 0 || otherFees > 0 || preLines.length > 0 ? (
        <tfoot className="border-t-2 border-slate-200 text-xs text-slate-600">
          {preLines.length > 0 && <tr><td colSpan={4} className="py-2">ดอกเบี้ยตามตารางก่อน Go-live {preLines.length} งวด (ข้อมูลเท่านั้น · ก่อนภาษี)</td>
            <td className="text-right text-sm tabular-nums">{money(preSum, h.currency)}</td><td colSpan={2} /></tr>}
          {coupons.length > 0 && <tr><td colSpan={4} className="py-2">รับปันผล / ดอกเบี้ยแล้ว {coupons.length} ครั้ง · สุทธิหลังหักภาษี / ค่าธรรมเนียม</td>
            <td className="text-right text-sm font-medium tabular-nums text-emerald-700">{money(income, h.currency)}</td>
            <td className="pl-4">ก่อนภาษี {money(couponGross)}{couponTax > 0 && ` · ภาษี ${money(couponTax)}`}</td><td /></tr>}
          {otherFees > 0 && <tr><td colSpan={4} className="py-2">ค่าธรรมเนียมอื่น (หักจากผลตอบแทน)</td>
            <td className="text-right text-sm tabular-nums">{money(otherFees, h.currency)}</td><td colSpan={2} /></tr>}
        </tfoot>) : undefined}
        rows={[
        ...sched.map((x) => ({ date: x.due, o: 0, h: {
          // ยกเลิก: ไม่นับทั้งยังไม่รับ / รับแล้ว · ก่อน Go-live: นับเป็นรับแล้ว (รับก่อนเริ่มใช้ระบบ)
          key: `s${x.key}`, open: x.cancelled ? undefined : !x.received && !x.pre, row: (
            <tr className={`align-top [&>td]:py-1.5 ${x.received ? "text-slate-500" : x.pre || x.cancelled ? "text-slate-400" : ""}`}>
              <td className="py-1.5">{thDate(x.due)}</td>
              <td>{dueLabel(x)}</td>
              <td /><td />
              <td className="text-right tabular-nums">{x.expected != null ? money(x.expected) : "-"}</td>
              <td className="pl-4 text-xs">{x.cancelled ? "ยกเลิก" : x.pre && !x.received ? "ก่อน Go-live" : <DueStatus due={x.due} received={x.received} today={today} />}
                {x.notes && <div className="text-slate-500">{x.notes}</div>}</td>
              <td />
            </tr>
          ) } })),
        ...txList.map((t) => ({ date: t.transaction_date, o: 1, h: {
          key: `t${t.id}`, row: (
            <tr className={`align-top [&>td]:py-1.5 ${MONEY_IN.includes(t.transaction_type) ? "bg-emerald-50/40" : t.transaction_type === "OPENING_BALANCE" || t.transaction_type === "BUY" ? "bg-blue-50/50" : ""}`}
              data-row={`x-${t.id}`}>
              <td className="py-1.5">{thDate(t.transaction_date)}</td>
              <td>{ITX_LABEL[t.transaction_type] ?? t.transaction_type}{t.direction && ` (${t.direction === "IN" ? "เพิ่ม" : "ลด"})`}</td>
              <td className="text-right tabular-nums text-slate-600">{t.quantity != null ? qty(t.quantity) : ""}</td>
              <td className="text-right tabular-nums text-slate-600">{t.price != null ? money(t.price, undefined, 4) : ""}</td>
              <td className="text-right tabular-nums">{money(t.amount)}
                {(Number(t.fee ?? 0) > 0 || Number(t.tax ?? 0) > 0) && <div className="text-xs text-slate-500">
                  {Number(t.fee ?? 0) > 0 && `ค่าธรรมเนียม ${money(t.fee)}`} {Number(t.tax ?? 0) > 0 && `ภาษี ${money(t.tax)}`}</div>}
              </td>
              <td className="pl-4 text-xs text-slate-500">{t.notes}{(t.settle_from_asset_id || t.settle_to_asset_id) && <div>ผ่านบัญชีธนาคาร</div>}</td>
              <td className="pl-2 text-right">
                {canWrite && !t.cash_movement_id && <RowActions table="investment_transactions" id={t.id} paths={paths} canDelete={canDelete} cols={portfolioTxCols(t)}
                  deleteNote="รายได้ / เงินเข้าออกบัญชีที่ระบบสร้างจากรายการนี้จะถูกลบตาม"
                  fields={portfolioTxFields(t, !!(t.settle_from_asset_id || t.settle_to_asset_id))} />}
              </td>
            </tr>
          ) } })),
      // มีตารางรับ: เรียงเก่า → ใหม่แบบตารางผ่อน (วันเดียวกัน: งวด → รายการ) · ไม่มี: ล่าสุดก่อน
      ].sort((x, y) => (sched.length ? x.date.localeCompare(y.date) : y.date.localeCompare(x.date)) || x.o - y.o).map((x) => x.h)} />

    </div>
  );
}
