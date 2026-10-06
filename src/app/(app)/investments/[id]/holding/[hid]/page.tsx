import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { COUPON_FREQ_LABEL, HOLDING_TYPE_LABEL, ITX_LABEL, addDays, money, qty, thDate, todayBangkok } from "@/lib/format";
import RowActions from "@/components/RowActions";
import StatusSelect from "@/components/StatusSelect";
import { MaturityForm, type Holding } from "../../forms";
import ReturnsTable, { type Ret } from "../../ReturnsTable";
import { FcnForm, IncomeForm, UnderlyingForm, type Fcn } from "./forms";

const STATUS_LABEL: Record<string, string> = { ACTIVE: "ถืออยู่", SOLD: "ขายแล้ว", MATURED: "ครบกำหนด", AUTOCALLED: "Autocall (ครบกำหนดก่อนกำหนด)" };
const STRUCTURED = ["FCN", "STRUCTURED_PRODUCT"];

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
  const [{ data: hRow }, { data: a }, { data: txs }, { data: vals }, { data: rets }, { data: fcnRow }, { data: banks }, { data: family }] = await Promise.all([
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
  ]);
  const h = hRow as H | null;
  if (!h || !a || h.holding_type === "CASH") notFound();

  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();
  const goLive = family?.go_live_date ?? "";
  const paths = [`/investments/${id}/holding/${hid}`, `/investments/${id}`, "/investments", "/income-expenses"];
  const ret = ((rets as Ret[] | null) ?? []).filter((r) => r.holding_id === hid);
  const isStructured = STRUCTURED.includes(h.holding_type);
  const fcn = fcnRow as (Fcn & { fcn_underlyings: (U & { deleted_at: string | null })[] }) | null;
  const unders = (fcn?.fcn_underlyings ?? []).filter((u) => !u.deleted_at);
  const txList = (txs as Tx[] | null) ?? [];
  const cost = h.average_cost != null ? Number(h.quantity) * Number(h.average_cost) : null;
  const daysLeft = h.maturity_date ? Math.round((Date.parse(h.maturity_date) - Date.parse(today)) / 86400000) : null;
  const coupons = txList.filter((t) => ["COUPON", "INTEREST", "DIVIDEND"].includes(t.transaction_type));
  const couponSum = coupons.reduce((s, t) => s + Number(t.amount) - Number(t.tax ?? 0), 0);
  const canMature = h.status === "ACTIVE" && ["BOND", "FCN", "STRUCTURED_PRODUCT", "OTHER"].includes(h.holding_type);
  const pct = (v: number | null) => (v == null ? "-" : `${Number(v)}%`);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/investments/${id}`} className="text-sm text-slate-500 hover:underline">← {a.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{h.name}{h.symbol && <span className="ml-2 text-base text-slate-500">{h.symbol}</span>}</h1>
        <p className="text-sm text-slate-500">
          {HOLDING_TYPE_LABEL[h.holding_type] ?? h.holding_type} · {h.currency} · {STATUS_LABEL[h.status] ?? h.status}
          {h.maturity_date && <> · ครบกำหนด {thDate(h.maturity_date)}{h.status === "ACTIVE" && daysLeft != null && daysLeft >= 0 && ` (อีก ${daysLeft} วัน)`}</>}
          {h.derived_status === "MATURITY_SOON" && <span className="text-amber-700"> · ใกล้ครบกำหนด</span>}
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <Kpi label="จำนวนที่ถือ" value={qty(h.quantity)} sub={h.average_cost != null ? `ต้นทุนเฉลี่ย ${money(h.average_cost, undefined, 4)}` : undefined} />
        <Kpi label={`มูลค่าตลาด (${h.currency})`} value={money(h.current_value)} sub={h.valued_at_cost ? "ราคาทุน · รอ Statement" : `ณ ${thDate(h.current_value_date)}`} />
        <Kpi label={`ต้นทุนที่ยังถือ (${h.currency})`} value={money(cost)}
          sub={cost && h.current_value != null && !h.valued_at_cost ? `กำไร/ขาดทุน ${money(Number(h.current_value) - cost)} (${(((Number(h.current_value) - cost) / cost) * 100).toFixed(2)}%)` : undefined} />
        <Kpi label={isStructured ? "Coupon ที่ได้รับ (สุทธิภาษี)" : "ปันผล / ดอกเบี้ยที่ได้รับ (สุทธิภาษี)"} value={money(couponSum, h.currency)} sub={`${coupons.length} ครั้ง`} />
      </section>

      {canWrite && h.status === "ACTIVE" && (
        <div className="flex flex-wrap items-start gap-3">
          <IncomeForm assetId={id} holdingId={hid} currency={h.currency} isFcn={isStructured} banks={banks ?? []} today={today} minDate={goLive} />
          {canMature && <div className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm">
            <MaturityForm assetId={id} holding={h} banks={banks ?? []} today={today} minDate={goLive} />
          </div>}
          <Link href={`/investments/${id}`} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">ซื้อ / ขาย / อัปเดตราคา (หน้าพอร์ต)</Link>
        </div>
      )}

      {ret.length > 0 && <ReturnsTable rows={ret} title="ผลตอบแทนของหลักทรัพย์นี้ (บาท)" />}

      {isStructured && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium text-slate-900">รายละเอียด {HOLDING_TYPE_LABEL[h.holding_type]}</h2>
            {fcn?.knock_in_occurred && <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">Knock-in แล้ว {fcn.knock_in_date && thDate(fcn.knock_in_date)}</span>}
          </div>
          {fcn && (
            <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-4">
              <Item k="ผู้ออก" v={fcn.issuer} /><Item k="เงินต้น" v={money(fcn.principal, h.currency)} />
              <Item k="วันที่ซื้อ / ออก" v={`${thDate(fcn.trade_date)} / ${thDate(fcn.issue_date)}`} />
              <Item k="ครบกำหนด" v={thDate(h.maturity_date)} />
              <Item k="Coupon" v={`${pct(fcn.coupon_rate)} ต่อปี${fcn.coupon_frequency ? ` · ${COUPON_FREQ_LABEL[fcn.coupon_frequency] ?? fcn.coupon_frequency}` : ""}`} />
              <Item k="Strike" v={pct(fcn.strike_level)} /><Item k="Knock-in / Barrier" v={pct(fcn.barrier_level)} />
              <Item k="Autocall" v={`${pct(fcn.autocall_level)}${fcn.observation_frequency ? ` · สังเกต ${fcn.observation_frequency}` : ""}`} />
              {fcn.coupon_rate != null && <Item k="Coupon ต่องวด (ประมาณ)" v={money(Number(fcn.principal) * Number(fcn.coupon_rate) / 100 /
                ({ MONTHLY: 12, QUARTERLY: 4, SEMI_ANNUAL: 2, ANNUAL: 1 }[fcn.coupon_frequency ?? ""] ?? 1), h.currency)} />}
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

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">รายการของหลักทรัพย์นี้</h2>
        {txList.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th>ประเภท</th><th className="text-right">จำนวน × ราคา</th><th className="text-right">ยอด</th><th className="pl-4">หมายเหตุ</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {txList.map((t) => (
                <tr key={t.id} className="align-top">
                  <td className="py-1.5">{thDate(t.transaction_date)}</td>
                  <td>{ITX_LABEL[t.transaction_type] ?? t.transaction_type}{t.direction && ` (${t.direction === "IN" ? "เพิ่ม" : "ลด"})`}</td>
                  <td className="text-right tabular-nums text-slate-600">{t.quantity != null && t.price != null ? `${qty(t.quantity)} × ${money(t.price, undefined, 4)}` : t.quantity != null ? qty(t.quantity) : ""}</td>
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
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">ประวัติราคา / มูลค่า</h2>
        {(vals ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีราคาจาก Statement (ใช้ราคาทุน)</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th className="text-right">ราคา</th><th className="text-right">จำนวน</th><th className="text-right">มูลค่า</th><th className="pl-4">ที่มา</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(vals ?? []).map((v) => (
                <tr key={v.id}>
                  <td className="py-1.5">{thDate(v.valuation_date)}</td>
                  <td className="text-right tabular-nums">{money(v.price, undefined, 4)}</td>
                  <td className="text-right tabular-nums">{qty(v.quantity)}</td>
                  <td className="text-right tabular-nums">{money(v.market_value)}</td>
                  <td className="pl-4 text-xs text-slate-500">{v.source === "OPENING" ? "ยอดตั้งต้น" : v.source === "STATEMENT" ? "Statement" : v.source}</td>
                  <td className="pl-2 text-right">{canWrite && v.source !== "OPENING" && <RowActions table="investment_valuations" id={v.id} paths={paths} canDelete={canDelete}
                    fields={[{ name: "valuation_date", label: "วันที่", type: "date", value: v.valuation_date }, { name: "price", label: "ราคา", type: "number", value: v.price },
                      { name: "market_value", label: "มูลค่า", type: "number", value: v.market_value }]} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {canWrite && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <RowActions table="investment_holdings" id={hid} paths={paths} canDelete={false} fields={[
            { name: "name", label: "ชื่อ", value: h.name, width: "w-48" }, { name: "symbol", label: "สัญลักษณ์", value: h.symbol, width: "w-24" },
            { name: "maturity_date", label: "ครบกำหนด", type: "date", value: h.maturity_date }, { name: "notes", label: "หมายเหตุ", value: h.notes, width: "w-48" }]} />
          {isStructured && ["MATURED", "AUTOCALLED"].includes(h.status) && (
            <div><StatusSelect table="investment_holdings" id={hid} value={h.status} paths={paths} label="ปิดแบบ"
              options={[["MATURED", "ครบกำหนดตามปกติ"], ["AUTOCALLED", "Autocall (ถูกเรียกคืนก่อนกำหนด)"]]} /></div>
          )}
          {isStructured && h.status === "ACTIVE" && (
            <p className="text-xs text-slate-500">ถูก Autocall: กด &ldquo;ครบกำหนด&rdquo; ด้านบน (ใส่วันที่ถูกเรียกคืน) แล้วเลือก &ldquo;ปิดแบบ Autocall&rdquo; ที่ส่วนนี้</p>
          )}
          {h.maturity_date && h.status === "ACTIVE" && h.maturity_date < addDays(today, 0) && (
            <p className="text-xs text-amber-700">เลยวันครบกำหนดแล้ว — บันทึก &ldquo;ครบกำหนด&rdquo; เมื่อได้รับเงินต้นคืน</p>
          )}
        </section>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
function Item({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-xs text-slate-500">{k}</dt><dd>{v}</dd></div>;
}
