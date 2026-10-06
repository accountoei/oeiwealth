import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import {
  HOLDING_TYPE_LABEL, ITX_LABEL, PORTFOLIO_TYPE_LABEL, addDays, money, qty, thDate, todayBangkok,
} from "@/lib/format";
import { FxForm, MaturityForm, OpeningHoldingForm, TransferForm, TxForm, ValuationsForm, type Holding } from "./forms";
import ReturnsTable, { type Ret } from "./ReturnsTable";
import RowActions from "@/components/RowActions";
import OwnershipEditor from "@/components/OwnershipEditor";
import DeleteEntity from "@/components/DeleteEntity";
import StatusSelect from "@/components/StatusSelect";
import EntityDocuments from "@/components/docs/EntityDocuments";

type H = Holding & { average_cost: number | null; current_value: number | null; current_value_date: string | null;
  maturity_date: string | null; derived_status: string | null; valued_at_cost: boolean };
type Tx = { id: string; holding_id: string | null; transaction_date: string; settlement_date: string | null;
  transaction_type: string; quantity: number | null; price: number | null; amount: number; currency: string;
  fee: number | null; tax: number | null; direction: string | null; settle_from_asset_id: string | null;
  settle_to_asset_id: string | null; cash_movement_id: string | null; notes: string | null; net_cash: number;
  settlement_status: string; counter_amount: number | null; counter_currency: string | null };

const STATUS_LABEL: Record<string, string> = { ACTIVE: "ถืออยู่", SOLD: "ขายแล้ว", MATURED: "ครบกำหนด", AUTOCALLED: "Autocall" };

export default async function PortfolioDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: a }, { data: pf }, { data: pv }, { data: hs }, { data: owners }, { data: banks }, { data: family },
    { data: fx }, { data: unsettled }, { data: persons }] = await Promise.all([
    supabase.from("assets").select("*").eq("id", id).eq("asset_type", "INVESTMENT_PORTFOLIO").is("deleted_at", null).maybeSingle(),
    supabase.from("investment_portfolios").select("*").eq("asset_id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_portfolio_values").select("thb_value,in_transit,in_transit_thb").eq("asset_id", id).maybeSingle(),
    supabase.from("v_holdings_active").select("*").eq("portfolio_asset_id", id).order("holding_type").order("name"),
    supabase.from("v_asset_ownerships_active").select("person_id,person_name,ownership_percent,end_date").eq("asset_id", id),
    supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name"),
    supabase.from("families").select("go_live_date,system_status").maybeSingle(),
    supabase.from("v_fx_status").select("currency,rate_to_thb"),
    supabase.from("v_unsettled_trades").select("*").eq("portfolio_asset_id", id),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
  ]);
  if (!a || !pf) notFound();
  const [{ data: txs }, { data: income }, { data: rets }] = await Promise.all([
    supabase.from("v_investment_transactions_net").select("*").eq("portfolio_id", pf.id)
      .order("transaction_date", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    supabase.from("income_transactions").select("amount,tax,currency,base_amount").eq("asset_id", id)
      .not("source_transaction_id", "is", null).is("deleted_at", null),
    supabase.rpc("investment_returns", { p_portfolio_asset_id: id }),
  ]);

  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const paths = [`/investments/${id}`, "/investments", "/financial/cash", "/income-expenses"];
  const today = todayBangkok();
  const goLive = family?.go_live_date ?? "";
  const isSetup = family?.system_status === "SETUP";
  const openingDate = goLive ? addDays(goLive, -1) : today;
  const holdings = (hs as H[] | null) ?? [];
  const byId = new Map(holdings.map((h) => [h.id, h]));
  const rate = new Map<string, number>([["THB", 1], ...((fx ?? []).map((r) => [r.currency, Number(r.rate_to_thb)] as [string, number]))]);
  const thb = (v: number | null, c: string) => (v == null || !rate.get(c) ? null : Number(v) * (rate.get(c) as number));
  const active = holdings.filter((h) => h.status === "ACTIVE");
  const totalThb = active.reduce((s, h) => s + (thb(h.current_value, h.currency) ?? 0), 0);
  const cashHoldings = active.filter((h) => h.holding_type === "CASH");
  const incomeThb = (income ?? []).reduce((s, i) => s + Number(i.base_amount ?? 0), 0);
  const activeOwners = (owners ?? []).filter((o) => !o.end_date);
  const ownerTotal = activeOwners.reduce((s, o) => s + Number(o.ownership_percent), 0);
  const bankList = banks ?? [];
  const bankName = new Map(bankList.map((b) => [b.asset_id, b.name]));
  const txList = (txs as Tx[] | null) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/investments" className="text-sm text-slate-500 hover:underline">← Investments</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{a.name}</h1>
        <p className="text-sm text-slate-500">
          {pf.institution} · {PORTFOLIO_TYPE_LABEL[pf.portfolio_type] ?? pf.portfolio_type} · สกุลพอร์ต {a.currency}
          {" · "}เจ้าของ {activeOwners.map((o) => `${o.person_name} ${Number(o.ownership_percent)}%`).join(", ") || "-"}
          {ownerTotal < 100 && <span className="text-amber-700"> (ยังไม่ครบ {100 - ownerTotal}%)</span>}
        </p>
        {canWrite && <OwnershipEditor kind="asset" id={id} persons={persons ?? []} paths={paths} today={today}
          current={activeOwners.map((o) => ({ person_id: o.person_id, percent: Number(o.ownership_percent) }))} />}
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <Kpi label={`มูลค่าพอร์ต (${a.currency})`} value={money(a.current_value, undefined, 0)} sub={`ณ ${thDate(a.current_value_date)}`} />
        <Kpi label="มูลค่าเป็นบาท (ใช้ใน Net Worth)" value={money(pv?.thb_value ?? null, "THB", 0)}
          sub={Number(pv?.in_transit ?? 0) !== 0 ? `+ เงินระหว่างทาง ${money(pv?.in_transit ?? 0, a.currency, 0)}` : "ไม่มีเงินระหว่างทาง"} />
        <Kpi label="เงินสดในพอร์ต" value={cashHoldings.map((h) => money(h.current_value, h.currency, 0)).join(" · ") || "-"}
          sub="คำนวณจาก Statement ล่าสุด + รายการหลังจากนั้น" />
        <Kpi label="รายได้ลงทุน (ปันผล/ดอกเบี้ย)" value={money(incomeThb, "THB", 0)} sub="ตั้งแต่ Go-live · ก่อนหักภาษี" />
      </section>

      {canWrite && (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <TxForm assetId={id} portfolioCurrency={a.currency} holdings={holdings} banks={bankList} today={today} minDate={goLive} />
            <TransferForm assetId={id} currency={a.currency} banks={bankList} today={today} minDate={goLive} />
            <FxForm assetId={id} cashCurrencies={cashHoldings.map((h) => h.currency)} today={today} minDate={goLive} />
            <ValuationsForm assetId={id} holdings={holdings} today={today} minDate={goLive} />
            {(isSetup || me.role === "ADMIN") && (
              <OpeningHoldingForm assetId={id} currency={a.currency} openingDate={openingDate} isSetup={isSetup} />
            )}
          </div>
        </section>
      )}

      {Number(pv?.in_transit ?? 0) !== 0 && (
        <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
          เงินโอนเข้าพอร์ต {money(pv?.in_transit ?? 0, a.currency)} ยังเป็น &ldquo;เงินระหว่างทาง&rdquo; — นับรวมใน Net Worth แล้ว
          และจะรวมเข้าเงินสดในพอร์ตเมื่อบันทึกยอดเงินสดตาม Statement (อัปเดตราคา / Statement)
        </p>
      )}

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">หลักทรัพย์</th><th className="px-3 text-right">จำนวน</th><th className="px-3 text-right">ต้นทุนเฉลี่ย</th>
              <th className="px-3 text-right">ราคาล่าสุด</th><th className="px-3 text-right">มูลค่าตลาด</th>
              <th className="px-3 text-right">กำไร/ขาดทุนยังไม่รับรู้</th><th className="px-3 text-right">สัดส่วน</th><th className="px-3"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {holdings.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">ยังไม่มีหลักทรัพย์</td></tr>}
            {holdings.map((h) => {
              const isCash = h.holding_type === "CASH";
              const cost = !isCash && h.average_cost != null ? Number(h.quantity) * Number(h.average_cost) : null;
              const gain = cost != null && h.current_value != null && !h.valued_at_cost ? Number(h.current_value) - cost : null;
              const v = thb(h.current_value, h.currency);
              const share = h.status === "ACTIVE" && v != null && totalThb > 0 ? (v / totalThb) * 100 : null;
              const canMature = h.status === "ACTIVE" && ["BOND", "FCN", "STRUCTURED_PRODUCT", "OTHER"].includes(h.holding_type);
              return (
                <tr key={h.id} className={`align-top ${h.status !== "ACTIVE" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-900">
                      {isCash ? h.name : <Link href={`/investments/${id}/holding/${h.id}`} className="hover:underline">{h.name}</Link>}
                      {h.symbol && <span className="ml-1 text-xs text-slate-500">{h.symbol}</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {HOLDING_TYPE_LABEL[h.holding_type] ?? h.holding_type} · {h.currency}
                      {h.status !== "ACTIVE" && ` · ${STATUS_LABEL[h.status] ?? h.status}`}
                      {h.maturity_date && ` · ครบ ${thDate(h.maturity_date)}`}
                      {h.derived_status === "MATURITY_SOON" && <span className="text-amber-700"> · ใกล้ครบกำหนด</span>}
                    </div>
                  </td>
                  <td className="px-3 text-right tabular-nums">{isCash ? "" : qty(h.quantity)}</td>
                  <td className="px-3 text-right tabular-nums">{isCash ? "" : money(h.average_cost, undefined, 4)}</td>
                  <td className="px-3 text-right tabular-nums">{isCash ? "" : money(h.current_price, undefined, 4)}</td>
                  <td className="px-3 text-right">
                    <div className="tabular-nums">{money(h.current_value)}</div>
                    <div className={`text-xs ${h.valued_at_cost ? "text-amber-700" : "text-slate-500"}`}>
                      {h.valued_at_cost ? "ราคาทุน · รอ Statement" : `ณ ${thDate(h.current_value_date)}`}
                    </div>
                  </td>
                  <td className={`px-3 text-right tabular-nums ${gain == null ? "" : gain >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {gain == null ? "" : <>{money(gain)}<div className="text-xs">{cost ? `${((gain / cost) * 100).toFixed(2)}%` : ""}</div></>}
                  </td>
                  <td className="px-3 text-right tabular-nums text-slate-600">{share != null ? `${share.toFixed(1)}%` : ""}</td>
                  <td className="px-3 py-2.5 text-right">
                    {canWrite && canMature && <MaturityForm assetId={id} holding={h} banks={bankList} today={today} minDate={goLive} />}
                    {canWrite && !isCash && <RowActions table="investment_holdings" id={h.id} paths={paths} canDelete={false} fields={[
                      { name: "name", label: "ชื่อ", value: h.name }, { name: "symbol", label: "สัญลักษณ์", value: h.symbol, width: "w-24" },
                      { name: "maturity_date", label: "ครบกำหนด", type: "date", value: h.maturity_date }]} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <ReturnsTable rows={(rets as Ret[] | null) ?? []} hrefBase={`/investments/${id}/holding/`} />

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

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-slate-900">รายการ (ล่าสุด 100 รายการ)</h2>
        {txList.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1">วันที่</th><th>ประเภท</th><th>หลักทรัพย์</th><th className="text-right">จำนวน × ราคา</th>
                  <th className="text-right">ยอด</th><th className="text-right">เงินสดพอร์ต</th><th className="pl-4">ชำระ / หมายเหตุ</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {txList.map((t) => {
                  const bank = t.settle_from_asset_id ?? t.settle_to_asset_id;
                  const cashEffect = bank || (t.cash_movement_id && ["DEPOSIT", "WITHDRAWAL"].includes(t.transaction_type)) ? null : Number(t.net_cash);
                  return (
                    <tr key={t.id} className="align-top">
                      <td className="py-1.5">{thDate(t.transaction_date)}</td>
                      <td>{ITX_LABEL[t.transaction_type] ?? t.transaction_type}{t.direction && ` (${t.direction === "IN" ? "เพิ่ม" : "ลด"})`}</td>
                      <td className="text-slate-600">{t.holding_id ? byId.get(t.holding_id)?.name : t.transaction_type === "FX_EXCHANGE" ? `เงินสด ${t.currency} → ${t.counter_currency}` : "เงินสดพอร์ต"}</td>
                      <td className="text-right tabular-nums text-slate-600">
                        {t.quantity != null && t.price != null ? `${qty(t.quantity)} × ${money(t.price, undefined, 4)}` : t.quantity != null ? qty(t.quantity) : ""}
                      </td>
                      <td className="text-right tabular-nums">
                        {money(t.amount)}{t.transaction_type === "FX_EXCHANGE" && <> {t.currency} → {money(t.counter_amount)} {t.counter_currency}</>}
                        {(Number(t.fee ?? 0) > 0 || Number(t.tax ?? 0) > 0) && (
                          <div className="text-xs text-slate-500">
                            {Number(t.fee ?? 0) > 0 && `ค่าธรรมเนียม ${money(t.fee)}`} {Number(t.tax ?? 0) > 0 && `ภาษี ${money(t.tax)}`}
                          </div>
                        )}
                      </td>
                      <td className={`text-right tabular-nums ${cashEffect == null || cashEffect === 0 ? "text-slate-400" : cashEffect > 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {cashEffect == null ? "—" : cashEffect === 0 ? "0" : money(cashEffect)}
                      </td>
                      <td className="pl-4 text-xs text-slate-500">
                        {bank && <div>{t.transaction_type === "BUY" ? "จ่ายจาก" : "เข้า"} {bankName.get(bank) ?? "บัญชีธนาคาร"}{t.settlement_date && ` · ${thDate(t.settlement_date)}`}
                          {t.settlement_status === "UNSETTLED" && <span className="text-amber-700"> · รอชำระ</span>}</div>}
                        {t.cash_movement_id && <div>สร้างจากการโอนเงิน (แก้ที่รายการโอน)</div>}
                        {t.notes && <div>{t.notes}</div>}
                      </td>
                      <td className="pl-2 text-right">
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          &ldquo;—&rdquo; ในช่องเงินสดพอร์ต = เงินผ่านบัญชีธนาคารโดยตรง หรือเป็นเงินระหว่างทางจากการโอน · ผลตอบแทนนับตั้งแต่ Go-live (ยอดตั้งต้นใช้ต้นทุนเดิม)
        </p>
      </section>

      {canWrite && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <StatusSelect table="assets" id={id} value={a.status} paths={paths} label="สถานะพอร์ต"
            options={[["ACTIVE", "ใช้งาน"], ["CLOSED", "ปิดพอร์ตแล้ว"]]} />
          {canDelete && <div><DeleteEntity kind="asset" id={id} redirectTo="/investments" paths={["/investments"]} label="ลบพอร์ตนี้"
            hint="ลบได้เมื่อมีแค่ยอดตั้งต้น (ไม่มีซื้อ ขาย ปันผล หรือการโอน)" /></div>}
        </section>
      )}
      <EntityDocuments entityType="ASSET" entityId={id} module="INVESTMENT" role={me.role} paths={paths} />
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
