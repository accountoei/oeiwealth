import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ITX_LABEL, addDays, money, monthOptions, monthRange, thDate, thMonth, todayBangkok } from "@/lib/format";
import MonthPicker from "@/components/MonthPicker";
import MovesView, { type MoveRow, type StmtRow } from "../../../../income-expenses/MovesView";
import EditButton from "@/components/EditButton";
import RowActions from "@/components/RowActions";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { DetailItem as Item } from "@/components/Boxes";
import { TransferEditForm, type CashAcct, type PfTransfer } from "../../forms";
import { cashLedger, type LEvent, type LHolding, type LMove, type LTx, type LVal } from "../../cash-ledger";
import { CashInfoForm, CashStatementForm, SetDefaultButton } from "./forms";

type HC = LHolding & { name: string; status: string; purpose: string | null; interest_rate: number | null;
  current_value: number | null; current_value_date: string | null; value_thb: number | null; fx_rate: number | null; holding_type: string };

/** บัญชีเงินฝากในพอร์ต: หน้าตาแบบเดียวกับหน้าบัญชีธนาคาร */
export default async function PortfolioCashPage({ params, searchParams }: {
  params: Promise<{ id: string; hid: string }>; searchParams: Promise<{ m?: string }>;
}) {
  const { id, hid } = await params;
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const today = todayBangkok();
  const ym = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? (sp.m as string) : today.slice(0, 7);
  const { start, end } = monthRange(ym);
  const dayBefore = addDays(start, -1);
  const prevEnd = addDays(`${today.slice(0, 7)}-01`, -1);

  const [{ data: a }, { data: pf }, { data: hs }, { data: family }, { data: banks }] = await Promise.all([
    supabase.from("assets").select("id,name,currency,status").eq("id", id).eq("asset_type", "INVESTMENT_PORTFOLIO").is("deleted_at", null).maybeSingle(),
    supabase.from("investment_portfolios").select("id,institution").eq("asset_id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_holdings_active").select("id,name,holding_type,currency,status,is_default_cash,purpose,interest_rate,current_value,current_value_date,value_thb,fx_rate")
      .eq("portfolio_asset_id", id),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("v_bank_accounts_safe").select("asset_id,name"),
  ]);
  const holdings = (hs as HC[] | null) ?? [];
  const h = holdings.find((x) => x.id === hid);
  if (!a || !pf || !h || h.holding_type !== "CASH") notFound();

  const [{ data: vals }, { data: txs }, { data: mvs }] = await Promise.all([
    supabase.from("investment_valuations").select("id,valuation_date,market_value,source,created_at").eq("holding_id", hid).is("deleted_at", null)
      .order("valuation_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("v_investment_transactions_net").select("*").eq("portfolio_id", pf.id).limit(5000),
    supabase.from("cash_movements")
      .select("id,movement_date,movement_type,from_asset_id,to_asset_id,amount,currency,fee,counter_amount,counter_currency,counter_fee,cash_holding_id,description,created_at")
      .eq("is_derived", false).is("deleted_at", null)
      .or(`and(movement_type.eq.INVESTMENT_OUT,to_asset_id.eq.${id}),and(movement_type.eq.INVESTMENT_IN,from_asset_id.eq.${id})`)
      .limit(2000),
  ]);

  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const goLive = family?.go_live_date ?? "";
  const fallback = goLive ? addDays(goLive, -1) : "1900-01-01";
  const paths = [`/investments/${id}/cash/${hid}`, `/investments/${id}`, "/investments", "/financial/cash", "/income-expenses"];
  const ccy = h.currency;
  const valList = ((vals ?? []) as (LVal & { source: string })[]);
  const L = cashLedger(holdings, (txs ?? []) as LTx[], (mvs ?? []) as LMove[]);
  const now = L.balanceAt(hid, ccy, valList, today, fallback);
  const prev = L.balanceAt(hid, ccy, valList, prevEnd, fallback);
  const opening = L.balanceAt(hid, ccy, valList, dayBefore, fallback).balance;
  const all = L.events(hid, ccy);
  const waiting = all.filter((e) => e.amt == null || e.waitBank);
  const latestBase = now.base.date;

  const bankName = new Map((banks ?? []).map((b) => [b.asset_id as string, b.name as string]));
  const holdingName = new Map(holdings.map((x) => [x.id, x.name]));
  const cashAccounts: CashAcct[] = holdings.filter((x) => x.holding_type === "CASH" && x.status === "ACTIVE")
    .map((x) => ({ id: x.id, name: x.name, currency: x.currency, is_default_cash: x.is_default_cash }));
  const sameCcy = cashAccounts.filter((x) => x.currency === ccy).length;
  const transferBank = (m: LMove) => bankName.get((m.movement_type === "INVESTMENT_OUT" ? m.from_asset_id : m.to_asset_id) ?? "") ?? "บัญชีธนาคาร";

  // ---------------------------------------------------------------- แถวของตาราง (เดือนที่เลือก) → แบบเดียวกับหน้าบัญชีธนาคาร
  const tiny = (t: string, cls = "text-amber-700") => <div className={`text-xs font-normal ${cls}`}>{t}</div>;
  const txRow = (e: LEvent): MoveRow => {
    const t = e.tx!;
    const isIn = (e.amt ?? 0) > 0;
    const amt = Math.abs(e.amt ?? 0);
    const other = t.transaction_type === "CASH_TRANSFER" || t.transaction_type === "FX_EXCHANGE"
      ? holdingName.get((e.leg === "in" ? t.cash_holding_id : t.counter_cash_holding_id) ?? "") ?? (e.leg === "in" ? `เงินฝาก ${t.currency}` : `เงินฝาก ${t.counter_currency}`)
      : "ภายนอก";
    const what = t.holding_id && t.holding_id !== hid ? holdingName.get(t.holding_id) : null;
    const detail = [ITX_LABEL[t.transaction_type] ?? t.transaction_type, what].filter(Boolean).join(" · ");
    const subs = [
      t.quantity != null && t.price != null ? `${Number(t.quantity).toLocaleString("en-US", { maximumFractionDigits: 4 })} × ${money(t.price, undefined, 4)}` : null,
      t.transaction_type === "FX_EXCHANGE" ? `${money(t.amount, t.currency)} → ${money(t.counter_amount, t.counter_currency ?? undefined)}` : null,
      Number(t.fee ?? 0) > 0 ? `ค่าธรรมเนียม ${money(t.fee)}` : null, Number(t.tax ?? 0) > 0 ? `ภาษี ${money(t.tax)}` : null, t.notes,
    ].filter(Boolean).join(" · ");
    return {
      key: e.key, date: e.date, type: t.transaction_type, kind: `ITX_${t.transaction_type}`,
      fromLabel: isIn ? other : h.name, toLabel: isIn ? h.name : other,
      fromBank: isIn ? null : hid, toBank: isIn ? hid : null, fromAmount: amt, fromCcy: ccy, toAmount: amt, toCcy: ccy,
      detail, sub: subs ? <div className="text-xs text-slate-400">{subs}{other !== "ภายนอก" && <> · {isIn ? "จาก" : "ไป"} {other}</>}</div> : undefined,
      actions: canWrite ? (
        <RowActions table="investment_transactions" id={t.id} paths={paths} canDelete={canDelete}
          deleteNote="รายได้ / เงินเข้าออกบัญชีที่ระบบสร้างจากรายการนี้จะถูกลบตาม"
          fields={[
            { name: "transaction_date", label: "วันที่", type: "date" as const, value: t.transaction_date },
            ...(t.quantity != null ? [{ name: "quantity", label: "จำนวน", type: "number" as const, value: t.quantity }] : []),
            ...(t.price != null ? [{ name: "price", label: "ราคา", type: "number" as const, value: t.price }] : []),
            ...(["BUY", "SELL"].includes(t.transaction_type) ? [] : [{ name: "amount", label: "ยอด", type: "number" as const, value: t.amount }]),
            ...(["FEE", "TAX", "ADJUSTMENT"].includes(t.transaction_type) ? [] : [{ name: "fee", label: "ค่าธรรมเนียม", type: "number" as const, value: t.fee }]),
            ...(["SELL", "REDEMPTION", "MATURITY", "DIVIDEND", "INTEREST", "COUPON"].includes(t.transaction_type) ? [{ name: "tax", label: "ภาษี", type: "number" as const, value: t.tax }] : []),
            { name: "notes", label: "หมายเหตุ", value: t.notes, width: "w-40" }]} />
      ) : undefined,
    };
  };
  const moveRow = (e: LEvent): MoveRow => {
    const m = e.mv!;
    const isIn = m.movement_type === "INVESTMENT_OUT";
    const bank = transferBank(m);
    const pending = e.amt == null;
    const transit = !pending && e.date > latestBase;
    const fx = m.counter_currency && m.counter_currency !== m.currency;
    const fees = [Number(m.fee ?? 0) > 0 ? money(m.fee, m.currency) : null, Number(m.counter_fee ?? 0) > 0 ? money(m.counter_fee, m.counter_currency ?? undefined) : null].filter(Boolean);
    const amt = Math.abs(e.amt ?? 0);
    return {
      key: e.key, date: e.date, type: "TRANSFER", kind: "TRANSFER",
      fromLabel: isIn ? bank : h.name, toLabel: isIn ? h.name : bank,
      // ยังไม่ทราบยอดที่เข้า: แสดงเป็น ⇄ ยอดที่ส่ง (ไม่นับในยอดคงเหลือ จนกว่าจะใส่ยอด)
      fromBank: pending ? hid : isIn ? null : hid, toBank: pending || isIn ? hid : null,
      fromAmount: pending ? Number(m.amount) : amt, fromCcy: pending ? m.currency : ccy, toAmount: amt, toCcy: ccy,
      detail: m.description || (isIn ? "โอนเข้าพอร์ต" : "ถอนออกจากพอร์ต"),
      sub: <div className="text-xs text-slate-400">{isIn ? "จาก" : "ไป"} {bank}
        {fx && ` · ${money(m.amount, m.currency)} → ${m.counter_amount != null ? money(m.counter_amount, m.counter_currency ?? undefined) : `รอยอด ${m.counter_currency}`}`}
        {fees.length > 0 && ` · ค่าธรรมเนียม ${fees.join(" + ")}`}</div>,
      extra: pending ? tiny("รอยอดที่เข้า") : e.waitBank ? tiny("รอยอดฝั่งธนาคาร") : transit ? tiny("ระหว่างทาง · รอ Statement") : undefined,
      actions: canWrite ? <TransferEditForm assetId={id} t={m as PfTransfer} bankLabel={bank} cashAccounts={cashAccounts} minDate={goLive} today={today} rowMode /> : undefined,
    };
  };
  const monthEvents = all.filter((e) => e.date >= start && e.date <= end);
  const rows: MoveRow[] = monthEvents.map((e) => (e.mv ? moveRow(e) : txRow(e))).reverse();   // MovesView รับ ใหม่ → เก่า
  const stmts: StmtRow[] = valList.filter((v) => v.valuation_date >= start && v.valuation_date <= end)
    .map((v) => ({ key: `v${v.id}`, date: v.valuation_date, value: Number(v.market_value), label: v.source === "STATEMENT" ? "Statement" : "ผู้ใช้" }));
  const monthHist = valList.filter((v) => v.valuation_date >= start && v.valuation_date <= end);
  const lastVal = valList.find((v) => v.valuation_date <= end);
  const months = monthOptions(goLive, today, 0, ym);
  const sumIn = rows.reduce((t, r) => t + (r.toBank === hid && r.fromBank !== hid ? r.toAmount : 0), 0);
  const sumOut = rows.reduce((t, r) => t + (r.fromBank === hid && r.toBank !== hid ? r.fromAmount : 0), 0);
  const closing = L.balanceAt(hid, ccy, valList, end < today ? end : today, fallback).balance;
  const neg = (v: number | null | undefined) => (Number(v ?? 0) < -0.005 ? "text-red-700" : "");
  const thbNow = h.currency === "THB" ? null : h.fx_rate != null ? now.balance * Number(h.fx_rate) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/investments/${id}`} className="text-sm text-slate-500 hover:underline">← {a.name}</Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{h.name}</h1>
          <p className="text-sm text-slate-500">{["เงินฝากในพอร์ต", a.name, pf.institution, ccy].filter(Boolean).join(" · ")}</p>
        </div>
        {canWrite && (
          <EditButton label="บันทึกยอดคงเหลือตาม Statement" title={`บันทึกยอดคงเหลือตาม Statement · ${h.name}`}>
            <div className="space-y-5">
              <CashStatementForm assetId={id} holdingId={hid} currency={ccy} today={today} minDate={goLive} />
              <div className="border-t border-slate-100 pt-4">
                <h3 className="mb-2 text-sm font-medium text-slate-800">ยอดตาม Statement · {thMonth(start)}</h3>
                {monthHist.length === 0 ? (
                  <p className="text-sm text-slate-500">ยังไม่มียอดเดือนนี้{lastVal ? <> · ยอดล่าสุด {thDate(lastVal.valuation_date)} = <span className="tabular-nums">{money(lastVal.market_value, ccy)}</span></> : ""}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th className="text-right">ยอด</th><th></th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {monthHist.map((v) => (
                        <tr key={v.id}>
                          <td className="whitespace-nowrap py-1.5">{thDate(v.valuation_date)}</td>
                          <td className={`whitespace-nowrap text-right tabular-nums ${neg(v.market_value)}`}>{money(v.market_value, ccy)}</td>
                          <td className="pl-2 text-right">
                            <RowActions table="investment_valuations" id={v.id} paths={paths} canDelete={canDelete}
                              fields={[{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date },
                                { name: "market_value", label: "ยอด", type: "number", value: v.market_value }]} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-2 text-xs text-slate-500">ดูเดือนอื่น: เลือกเดือนที่กล่องรายการเงินเข้า–ออกด้านล่าง</p>
              </div>
            </div>
          </EditButton>
        )}
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {/* ซ้าย: ยอดคงเหลือ + เอกสาร (ยืดให้ขอบล่างเท่ากล่องรายละเอียด) */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">ยอดคงเหลือล่าสุด</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${neg(now.balance)}`}>{money(now.balance, ccy)}</div>
            {thbNow != null && <div className="mt-0.5 text-xs text-slate-500">≈ {money(thbNow, "THB", 0)} · 1 {ccy} = {money(h.fx_rate, undefined, 4)} บาท</div>}
            <div className="mt-1 text-xs text-slate-500">{now.base.statement ? `ยอดตาม Statement ล่าสุด ${thDate(now.base.date)}` : "ยังไม่มียอดตาม Statement (เริ่มจากยอดตั้งต้น)"}</div>
            {Math.abs(now.transit) >= 0.005 && (
              <div className="mt-1 text-xs text-amber-700">รวมเงินโอนระหว่างทาง {money(now.transit, ccy)} — หายเมื่อบันทึกยอดตาม Statement หลังวันโอน</div>
            )}
            {waiting.length > 0 && <div className="mt-1 text-xs text-amber-700">รอใส่ยอดที่เข้า {waiting.length} รายการ (กดที่แถวในตารางด้านล่าง)</div>}
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-slate-100 pt-3 text-sm">
              <span className="text-slate-500">ยอดสิ้นเดือนก่อน <span className="text-xs">({thDate(prevEnd)})</span></span>
              <span className={`tabular-nums ${neg(prev.balance)}`}>{money(prev.balance, ccy)}</span>
            </div>
          </div>
          <div className="flex flex-1 flex-col">
            <EntityDocuments category="INVESTMENT" entityType="ASSET" entityId={id} module="INVESTMENT" role={me.role} paths={paths}
              title="เอกสารของพอร์ต / Statement" fill />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 className="font-medium text-slate-900">รายละเอียด</h2>
            {canWrite && (
              <EditButton title="แก้ไขรายละเอียด" small>
                <div className="space-y-5">
                  <CashInfoForm id={hid} name={h.name} purpose={h.purpose} interestRate={h.interest_rate == null ? null : Number(h.interest_rate)} paths={paths} />
                  {canDelete && sameCcy > 1 && !h.is_default_cash && (
                    <div className="border-t border-slate-100 pt-4"><SetDefaultButton assetId={id} holdingId={hid} /></div>
                  )}
                </div>
              </EditButton>
            )}
          </div>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Item label="ชื่อบัญชี">{h.name}</Item>
            <Item label="พอร์ต"><Link href={`/investments/${id}`} className="text-blue-700 hover:underline">{a.name}</Link></Item>
            <Item label="สถาบัน" dash>{pf.institution}</Item>
            <Item label="สกุลเงิน">{ccy}</Item>
            <Item label="อัตราดอกเบี้ย" dash>{h.interest_rate != null ? `${Number(h.interest_rate)}% ต่อปี` : null}</Item>
            <Item label="วัตถุประสงค์" dash>{h.purpose}</Item>
            <Item label="บัญชีหลักของสกุล">{h.is_default_cash ? "★ ใช่ — รายการที่ไม่ได้เลือกบัญชีเข้าบัญชีนี้" : "ไม่ใช่"}</Item>
            <Item label="สถานะ">{h.status === "ACTIVE" ? <span className="text-emerald-700">ใช้งาน</span> : <span className="text-slate-500">ปิดแล้ว</span>}</Item>
          </dl>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium text-slate-900">รายการเงินเข้า–ออก {thMonth(start)}</h2>
          <MonthPicker months={months} value={ym} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-emerald-700">เงินเข้า <b className="tabular-nums">+{money(sumIn)}</b></span>
          <span className="text-red-700">เงินออก <b className="tabular-nums">−{money(sumOut)}</b></span>
          <span className="text-slate-600">ยอด{end < today ? "สิ้นเดือน" : "ล่าสุด"} <b className={`tabular-nums ${neg(closing)}`}>{money(closing, ccy)}</b></span>
        </div>
        <div className="mt-3">
          <MovesView rows={rows} banks={[]} showActions={canWrite} fixedAcct={hid}
            openings={{ [hid]: opening }} statements={{ [hid]: stmts }} monthStart={start} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          ซื้อ / ขาย / ปันผล ฯลฯ บันทึกที่หน้าพอร์ต · กดที่แถวเพื่อแก้ไข / ลบ · ยอดตาม Statement เป็นจุดตั้งต้นใหม่ของยอดคงเหลือ ·
          เงินโอนจากธนาคารนับในยอดคงเหลือทันที และเป็น &ldquo;เงินระหว่างทาง&rdquo; ใน Net Worth จนกว่าจะบันทึกยอดตาม Statement หลังวันโอน
        </p>
      </section>
    </div>
  );
}
