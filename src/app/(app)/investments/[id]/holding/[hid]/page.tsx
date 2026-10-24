import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { COUPON_FREQ_LABEL, HOLDING_TYPE_LABEL, ITX_LABEL, addDays, money, qty, thDate, todayBangkok } from "@/lib/format";
import RowActions from "@/components/RowActions";
import StatusSelect from "@/components/StatusSelect";
import { type CashAcct, type Holding } from "../../forms";
import { scheduleOf } from "@/lib/coupon-schedule";
import { ScheduleBox } from "../../../due";
import ReturnsTable, { type Ret, type RetLocal } from "../../ReturnsTable";
import { ConvertUnitsForm, FcnForm, HoldingInfoForm, IncomeForm, UnderlyingForm, type Fcn } from "./forms";
import EditToggle from "@/components/EditToggle";
import { ActionBar } from "@/components/ActionBar";
import { DetailItem as Item } from "@/components/Boxes";
import PendingPrice, { type Pending } from "@/components/PendingPrice";
import HoldingHistory from "./history";

const STATUS_LABEL: Record<string, string> = { ACTIVE: "ถืออยู่", SOLD: "ขายแล้ว", MATURED: "ครบกำหนด", AUTOCALLED: "Autocall (ครบกำหนดก่อนกำหนด)" };
const STRUCTURED = ["FCN", "STRUCTURED_PRODUCT"];
const VAL_SOURCE_LABEL: Record<string, string> = { OPENING: "มูลค่า ณ วันตั้งต้น", STATEMENT: "ราคาตาม Statement", MARKET: "ราคาตลาด (อัตโนมัติ)", USER: "ราคา (ผู้ใช้ใส่)" };

type H = Holding & { portfolio_asset_id: string; average_cost: number | null; current_value: number | null; current_value_date: string | null;
  maturity_date: string | null; derived_status: string | null; valued_at_cost: boolean; notes: string | null };
type Tx = { id: string; transaction_date: string; settlement_date: string | null; transaction_type: string; quantity: number | null;
  price: number | null; amount: number; fee: number | null; tax: number | null; direction: string | null; notes: string | null;
  settle_from_asset_id: string | null; settle_to_asset_id: string | null; cash_movement_id: string | null };
type U = { id: string; symbol: string; name: string | null; initial_price: number | null; strike_price: number | null; barrier_price: number | null };

export default async function HoldingPage({ params }: { params: Promise<{ id: string; hid: string }> }) {
  const { id, hid } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: hRow }, { data: a }, { data: txs }, { data: vals }, { data: rets }, { data: fcnRow }, { data: banks }, { data: family }, { data: cashRows }, { data: retsLocal }, { data: pvRow }, { data: autoRow }] = await Promise.all([
    supabase.from("v_holdings_active").select("*").eq("id", hid).eq("portfolio_asset_id", id).maybeSingle(),
    supabase.from("assets").select("name,currency").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_investment_transactions_net").select("*").eq("holding_id", hid)
      .order("transaction_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("investment_valuations").select("id,valuation_date,price,quantity,market_value,source").eq("holding_id", hid)
      .is("deleted_at", null).order("valuation_date", { ascending: false }).limit(60),
    supabase.rpc("investment_returns", { p_portfolio_asset_id: id }),
    supabase.from("fcn_details").select("*, fcn_underlyings(id,symbol,name,initial_price,strike_price,barrier_price,deleted_at)")
      .eq("holding_id", hid).is("deleted_at", null).maybeSingle(),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("v_holdings_active").select("id,name,currency,is_default_cash").eq("portfolio_asset_id", id)
      .eq("holding_type", "CASH").eq("status", "ACTIVE").order("created_at"),
    supabase.rpc("investment_returns_local", { p_portfolio_asset_id: id }),
    supabase.from("v_portfolio_values").select("portfolio_fx_rate").eq("asset_id", id).maybeSingle(),
    supabase.from("investment_holdings").select("auto_price,price_ref,price_pending,valuation_mode,face_value,interest_rate,coupon_frequency").eq("id", hid).maybeSingle(),
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
  const fxRates: Record<string, number> = { THB: 1 };
  const hfx = (hRow as { fx_rate?: number | null } | null)?.fx_rate;
  if (hfx != null && h) fxRates[h.currency] = Number(hfx);
  if (pvRow?.portfolio_fx_rate != null && a) fxRates[a.currency] = Number(pvRow.portfolio_fx_rate);
  const isStructured = STRUCTURED.includes(h.holding_type);
  const fcn = fcnRow as (Fcn & { fcn_underlyings: (U & { deleted_at: string | null })[] }) | null;
  const unders = (fcn?.fcn_underlyings ?? []).filter((u) => !u.deleted_at);
  const txList = (txs as Tx[] | null) ?? [];
  const cost = h.average_cost != null ? Number(h.quantity) * Number(h.average_cost) : null;
  const daysLeft = h.maturity_date ? Math.round((Date.parse(h.maturity_date) - Date.parse(today)) / 86400000) : null;
  const coupons = txList.filter((t) => ["COUPON", "INTEREST", "DIVIDEND"].includes(t.transaction_type));
  const couponSum = coupons.reduce((s, t) => s + Number(t.amount) - Number(t.tax ?? 0), 0);
  const canMature = h.status === "ACTIVE" && ["BOND", "FCN", "STRUCTURED_PRODUCT", "OTHER"].includes(h.holding_type);
  // ตารางรับดอกเบี้ย / เงินต้น (หุ้นกู้: ข้อมูลในแก้ไขข้อมูล · FCN: รายละเอียด FCN)
  const hasCoupon = ["BOND", "OTHER"].includes(h.holding_type);
  const sched = ["BOND", "FCN", "STRUCTURED_PRODUCT", "OTHER"].includes(h.holding_type)
    ? scheduleOf({ ...h, face_value: autoRow?.face_value, interest_rate: autoRow?.interest_rate, coupon_frequency: autoRow?.coupon_frequency }, fcn, txList)
    : [];
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
  // แปลงเป็นจำนวนหน่วย: มีแค่ยอดตั้งต้น · มูลค่าก้อนเดียว หรือ 1 หน่วย
  const opening = txList.find((t) => t.transaction_type === "OPENING_BALANCE");
  const onlyOpening = !!opening && txList.every((t) => t.transaction_type === "OPENING_BALANCE");
  const canConvert = canDelete && h.status === "ACTIVE" && onlyOpening && (lump || Number(h.quantity) === 1);
  const openingVal = opening ? valRows.find((v) => v.valuation_date === opening.transaction_date) : undefined;
  const openingValue = openingVal ? openingVal.value : opening ? Number(opening.amount) : 0;

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
              <IncomeForm assetId={id} portfolioName={a.name} holdingId={hid} holdingName={h.name} currency={h.currency} isFcn={isStructured} canMature={canMature} banks={banks ?? []} cashAccounts={cashAccounts} today={today} minDate={goLive} />
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
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">มูลค่าตลาด ({h.currency})</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{money(h.current_value)}</div>
          <div className={`mt-1 text-xs ${h.valued_at_cost ? "text-amber-700" : "text-slate-500"}`}>{h.valued_at_cost ? "ราคาทุน · รอ Statement" : `ณ ${thDate(h.current_value_date)}`}</div>
          {(() => { const g = cost && h.current_value != null && !h.valued_at_cost ? Number(h.current_value) - cost : null; return g == null ? null : (
            <div className={`mt-1 text-xs ${g >= 0 ? "text-emerald-700" : "text-red-700"}`}>กำไร / ขาดทุนยังไม่รับรู้ {money(g)} ({((g / (cost as number)) * 100).toFixed(2)}%)</div>); })()}
          <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs">
            {lump ? <div className="flex justify-between gap-3"><dt className="text-slate-500">วิธีนับ</dt><dd>มูลค่าก้อนเดียว</dd></div> : <>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">จำนวนที่ถือ</dt><dd className="tabular-nums">{qty(h.quantity)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">ต้นทุนเฉลี่ย</dt><dd className="tabular-nums">{money(h.average_cost, undefined, 4)}</dd></div>
            </>}
            <div className="flex justify-between gap-3"><dt className="text-slate-500">ต้นทุนที่ยังถือ</dt><dd className="tabular-nums">{money(cost)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">{isStructured ? "Coupon ที่ได้รับ (สุทธิภาษี)" : "ปันผล / ดอกเบี้ย (สุทธิภาษี)"}</dt>
              <dd className="tabular-nums">{money(couponSum, h.currency)} · {coupons.length} ครั้ง</dd></div>
          </dl>
        </div>
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
                {h.notes && <Item label="หมายเหตุ" wide>{h.notes}</Item>}
              </dl>
            }
            edit={
              <div className="space-y-5">
                <HoldingInfoForm id={hid} paths={paths} coupon={hasCoupon ? { face_value: autoRow?.face_value ?? null, interest_rate: autoRow?.interest_rate ?? null,
                  coupon_frequency: autoRow?.coupon_frequency ?? null, currency: h.currency } : null} autoKind={h.holding_type === "EQUITY" || h.holding_type === "FUND" ? h.holding_type : null}
                  autoBlocked={lump ? "มูลค่าก้อนเดียวดึงราคาอัตโนมัติไม่ได้ — แปลงเป็นจำนวนหน่วยก่อน" : h.holding_type === "FUND" && Number(h.quantity) === 1 && !h.auto_price ? "กองทุนนี้มีจำนวน 1 หน่วย (มักเป็นมูลค่ารวมที่ใส่แทนจำนวน) — แปลงเป็นจำนวนหน่วยก่อน" : null}
                  v={{ name: h.name, symbol: h.symbol, maturity_date: h.maturity_date, notes: h.notes, auto_price: h.auto_price, price_ref: h.price_ref }} />
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

      {sched.length > 0 && <ScheduleBox rows={sched} currency={h.currency} today={today} />}

      {ret.length > 0 && <ReturnsTable rows={ret} local={retLocal} portfolioCurrency={a.currency} rates={fxRates} title="ผลตอบแทนของหลักทรัพย์นี้" />}

      {isStructured && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium text-slate-900">รายละเอียด {HOLDING_TYPE_LABEL[h.holding_type]}</h2>
            {fcn?.knock_in_occurred && <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">Knock-in แล้ว {fcn.knock_in_date && thDate(fcn.knock_in_date)}</span>}
          </div>
          {fcn && (
            <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-4">
              <Item label="ผู้ออก">{fcn.issuer}</Item><Item num label="เงินต้น">{money(fcn.principal, h.currency)}</Item>
              <Item label="วันที่ซื้อ / ออก">{`${thDate(fcn.trade_date)} / ${thDate(fcn.issue_date)}`}</Item>
              <Item label="ครบกำหนด">{thDate(h.maturity_date)}</Item>
              <Item label="Coupon">{`${pct(fcn.coupon_rate)} ต่อปี${fcn.coupon_frequency ? ` · ${COUPON_FREQ_LABEL[fcn.coupon_frequency] ?? fcn.coupon_frequency}` : ""}`}</Item>
              <Item label="Strike">{pct(fcn.strike_level)}</Item><Item label="Knock-in / Barrier">{pct(fcn.barrier_level)}</Item>
              <Item label="Autocall">{`${pct(fcn.autocall_level)}${fcn.observation_frequency ? ` · สังเกต ${fcn.observation_frequency}` : ""}`}</Item>
              {fcn.coupon_rate != null && <Item num label="Coupon ต่องวด (ประมาณ)">{money(Number(fcn.principal) * Number(fcn.coupon_rate) / 100 /
                ({ MONTHLY: 12, QUARTERLY: 4, SEMI_ANNUAL: 2, ANNUAL: 1 }[fcn.coupon_frequency ?? ""] ?? 1), h.currency)}</Item>}
            </dl>
          )}
          {canWrite && <FcnForm assetId={id} holdingId={hid} fcn={fcn} defaultPrincipal={cost} />}

          {fcn && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-900">หุ้นอ้างอิง (Underlying)</h3>
              {unders.length === 0 ? <p className="text-sm text-slate-500">ยังไม่ได้ใส่</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">หุ้น</th><th className="text-right">ราคาเริ่มต้น</th>
                    <th className="text-right">Strike</th><th className="text-right">Knock-in / Barrier</th><th></th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {unders.map((u) => {
                      const auto = (lv: number | null) => (u.initial_price != null && lv != null ? Number(u.initial_price) * Number(lv) / 100 : null);
                      const strike = u.strike_price ?? auto(fcn.strike_level);
                      const barrier = u.barrier_price ?? auto(fcn.barrier_level);
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
              {canWrite && <div className="mt-2"><UnderlyingForm assetId={id} fcnId={fcn.id} /></div>}
              <p className="mt-2 text-xs text-slate-500">ราคา Strike / Barrier ที่ไม่ได้ใส่ คำนวณจากราคาเริ่มต้น × ระดับ % · Knock-in ให้ติ๊กเองเมื่อธนาคารแจ้ง</p>
            </div>
          )}
        </section>
      )}

      <HoldingHistory head={
        <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th>ประเภท</th><th className="text-right">จำนวน</th>
          <th className="text-right">ราคา</th><th className="text-right">มูลค่า</th><th className="pl-4">หมายเหตุ</th><th></th></tr></thead>
      } rows={[
        ...txList.map((t) => ({ date: t.transaction_date, h: {
          key: `t${t.id}`, auto: false, row: (
            <tr className="align-top">
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
                {canWrite && !t.cash_movement_id && <RowActions table="investment_transactions" id={t.id} paths={paths} canDelete={canDelete}
                  deleteNote="รายได้ / เงินเข้าออกบัญชีที่ระบบสร้างจากรายการนี้จะถูกลบตาม"
                  fields={[
                    ...(t.transaction_type === "OPENING_BALANCE" ? [] : [{ name: "transaction_date", label: "วันที่", type: "date" as const, value: t.transaction_date }]),
                    ...(t.quantity != null ? [{ name: "quantity", label: "จำนวน", type: "number" as const, value: t.quantity }] : []),
                    ...(t.price != null ? [{ name: "price", label: "ราคา", type: "number" as const, value: t.price }] : []),
                    ...(["BUY", "SELL", "OPENING_BALANCE"].includes(t.transaction_type) ? [] : [{ name: "amount", label: "ยอด", type: "number" as const, value: t.amount }]),
                    ...(["SELL", "REDEMPTION", "MATURITY", "DIVIDEND", "INTEREST", "COUPON"].includes(t.transaction_type) ? [{ name: "tax", label: "ภาษี", type: "number" as const, value: t.tax }] : []),
                    { name: "notes", label: "หมายเหตุ", value: t.notes, width: "w-40" }]} />}
              </td>
            </tr>
          ) } })),
        ...valRows.map((v) => ({ date: v.valuation_date, h: {
          key: `v${v.id}`, auto: v.source === "MARKET", row: (
            <tr className="text-slate-600">
              <td className="py-1.5">{thDate(v.valuation_date)}</td>
              <td>{VAL_SOURCE_LABEL[v.source] ?? v.source}</td>
              <td className="text-right tabular-nums" title="จำนวนที่ถือ ณ วันนั้น">{lump ? <span className="text-slate-400">—</span> : qty(v.q)}</td>
              <td className="text-right tabular-nums">{lump || v.price == null ? <span className="text-slate-400">—</span> : money(v.price, undefined, 4)}</td>
              <td className="text-right tabular-nums">{money(v.value)}</td>
              <td className="pl-4 text-xs text-slate-500">{lump ? "" : "จำนวน = หน่วยที่ถือ ณ วันนั้น"}</td>
              <td className="pl-2 text-right">{canWrite && v.source !== "OPENING" && <RowActions table="investment_valuations" id={v.id} paths={paths} canDelete={canDelete}
                fields={!lump && v.price != null
                  ? [{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date }, { name: "price", label: "ราคาต่อหน่วย (มูลค่า = ราคา × จำนวนหน่วยที่ถือ)", type: "number", value: v.price }]
                  : [{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date }, { name: "market_value", label: "มูลค่า", type: "number", value: v.market_value }]} />}</td>
            </tr>
          ) } })),
      ].sort((x, y) => y.date.localeCompare(x.date)).map((x) => x.h)} />

    </div>
  );
}
