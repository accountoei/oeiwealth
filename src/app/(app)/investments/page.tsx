import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { HOLDING_TYPE_LABEL, ITX_LABEL, money, thDate, todayBangkok, addDays, blueAt } from "@/lib/format";

type PV = { portfolio_id: string; asset_id: string; name: string; portfolio_currency: string; display_value: number | null;
  display_value_date: string | null; thb_value: number | null; in_transit_thb: number | null };
type H = { id: string; portfolio_asset_id: string; holding_type: string; currency: string; current_value: number | null;
  status: string; name: string; maturity_date: string | null; derived_status: string | null; valued_at_cost: boolean };

export default async function InvestmentsPage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: pvs, error }, { data: pfs }, { data: hs }, { data: fx }, { data: family }, { data: txs }] = await Promise.all([
    supabase.from("v_portfolio_values").select("*").order("name"),
    supabase.from("investment_portfolios").select("asset_id,institution,status").is("deleted_at", null),
    supabase.from("v_holdings_active").select("id,portfolio_asset_id,holding_type,currency,current_value,status,name,maturity_date,derived_status,valued_at_cost"),
    supabase.from("v_fx_status").select("currency,rate_to_thb"),
    supabase.from("families").select("go_live_date").maybeSingle(),
    supabase.from("investment_transactions")
      .select("id,transaction_date,transaction_type,amount,currency,holding_id,portfolio_id,investment_holdings(name),investment_portfolios(asset_id)")
      .is("deleted_at", null).order("transaction_date", { ascending: false }).order("created_at", { ascending: false }).limit(10),
  ]);
  const goLive = family?.go_live_date ?? "";
  const { data: income } = await supabase.from("income_transactions").select("base_amount")
    .not("source_transaction_id", "is", null).is("deleted_at", null).gte("date", goLive || "1900-01-01");

  const list = (pvs as PV[] | null) ?? [];
  type R = { unrealized_thb: number; unrealized_fx_thb: number; realized_thb: number; realized_fx_thb: number; income_thb: number; fees_thb: number; total_thb: number };
  const retRows = await Promise.all(list.map(async (p) => {
    const { data } = await supabase.rpc("investment_returns", { p_portfolio_asset_id: p.asset_id });
    const rs = (data as R[] | null) ?? [];
    const sum = (k: keyof R) => rs.reduce((t, r) => t + Number(r[k] ?? 0), 0);
    return { asset_id: p.asset_id, name: p.name, unreal: sum("unrealized_thb"), unrealFx: sum("unrealized_fx_thb"), real: sum("realized_thb"),
      realFx: sum("realized_fx_thb"), income: sum("income_thb") - sum("fees_thb"), total: sum("total_thb") };
  }));
  const inst = new Map((pfs ?? []).map((p) => [p.asset_id, p.institution]));
  const holdings = ((hs as H[] | null) ?? []).filter((h) => h.status === "ACTIVE");
  const rate = new Map<string, number>([["THB", 1], ...((fx ?? []).map((r) => [r.currency, Number(r.rate_to_thb)] as [string, number]))]);
  const thb = (v: number | null, c: string) => (v == null || !rate.get(c) ? 0 : Number(v) * (rate.get(c) as number));
  const total = list.reduce((s, p) => s + Number(p.thb_value ?? 0) + Number(p.in_transit_thb ?? 0), 0);
  const cash = holdings.filter((h) => h.holding_type === "CASH").reduce((s, h) => s + thb(h.current_value, h.currency), 0)
    + list.reduce((s, p) => s + Number(p.in_transit_thb ?? 0), 0);
  const incomeThb = (income ?? []).reduce((s, i) => s + Number(i.base_amount ?? 0), 0);
  const byType = new Map<string, number>();
  holdings.forEach((h) => byType.set(h.holding_type, (byType.get(h.holding_type) ?? 0) + thb(h.current_value, h.currency)));
  const byCcy = new Map<string, number>();
  holdings.forEach((h) => byCcy.set(h.currency, (byCcy.get(h.currency) ?? 0) + thb(h.current_value, h.currency)));
  const allocTotal = [...byType.values()].reduce((s, v) => s + v, 0);
  const soon = holdings.filter((h) => h.maturity_date && h.maturity_date >= todayBangkok() && h.maturity_date <= addDays(todayBangkok(), 60))
    .sort((x, y) => (x.maturity_date! < y.maturity_date! ? -1 : 1));
  const pfName = new Map(list.map((p) => [p.asset_id, p.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Investments</h1>
          <p className="text-sm text-slate-500">ทุกพอร์ต · มูลค่าเป็นบาทใช้ราคา Statement ล่าสุดของแต่ละตัว และ FX ล่าสุดของ ธปท.</p>
        </div>
        {me.role !== "VIEWER" && (
          <Link href="/investments/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มพอร์ต</Link>
        )}
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}

      <section className="grid gap-4 md:grid-cols-4">
        <Kpi label="มูลค่าลงทุนรวม" value={money(total, "THB", 0)} />
        <Kpi label="รายได้ลงทุนตั้งแต่ Go-live" value={money(incomeThb, "THB", 0)} sub="ปันผล · ดอกเบี้ย · Coupon (ก่อนภาษี)" />
        <Kpi label="จำนวนพอร์ต" value={String(list.length)} />
        <Kpi label="เงินสดในพอร์ต (รวมระหว่างทาง)" value={money(cash, "THB", 0)} />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.length === 0 && <p className="text-sm text-slate-500">ยังไม่มีพอร์ต</p>}
        {list.map((p) => {
          const n = holdings.filter((h) => h.portfolio_asset_id === p.asset_id && h.holding_type !== "CASH").length;
          const atCost = holdings.some((h) => h.portfolio_asset_id === p.asset_id && h.valued_at_cost);
          return (
            <Link key={p.asset_id} href={`/investments/${p.asset_id}`}
              className="block rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-400">
              <div className="font-medium text-slate-900">{p.name}</div>
              <div className="text-xs text-slate-500">{inst.get(p.asset_id)} · {p.portfolio_currency} · {n} หลักทรัพย์</div>
              <div className="mt-3 text-xl font-semibold tabular-nums">{money(p.display_value, p.portfolio_currency, 0)}</div>
              <div className="text-xs text-slate-500">
                {p.portfolio_currency !== "THB" && `≈ ${money(Number(p.thb_value ?? 0) + Number(p.in_transit_thb ?? 0), "THB", 0)} · `}
                ณ {thDate(p.display_value_date)}
                {Number(p.in_transit_thb ?? 0) !== 0 && " · มีเงินระหว่างทาง"}
              </div>
              {atCost && <div className="mt-1 text-xs text-amber-700">มีบางตัวยังใช้ราคาทุน (รอ Statement)</div>}
            </Link>
          );
        })}
      </section>

      {retRows.some((r) => r.total || r.unreal || r.real) && (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <h2 className="px-4 pt-4 font-medium text-slate-900">ผลตอบแทนแยกพอร์ต (บาท)</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">พอร์ต</th><th className="px-3 text-right">ยังไม่รับรู้</th><th className="px-3 text-right">รับรู้แล้ว</th>
                <th className="px-3 text-right">ส่วนจาก FX</th><th className="px-3 text-right">ปันผล / ดอกเบี้ย สุทธิค่าธรรมเนียม</th><th className="px-3 text-right">รวม</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...retRows, ...(retRows.length > 1 ? [{ asset_id: "", name: "รวมทุกพอร์ต",
                unreal: retRows.reduce((t, r) => t + r.unreal, 0), unrealFx: retRows.reduce((t, r) => t + r.unrealFx, 0),
                real: retRows.reduce((t, r) => t + r.real, 0), realFx: retRows.reduce((t, r) => t + r.realFx, 0),
                income: retRows.reduce((t, r) => t + r.income, 0), total: retRows.reduce((t, r) => t + r.total, 0) }] : [])].map((r) => (
                <tr key={r.asset_id || "total"} className={r.asset_id ? "" : "font-medium"}>
                  <td className="px-4 py-2">{r.asset_id ? <Link href={`/investments/${r.asset_id}`} className="hover:underline">{r.name}</Link> : r.name}</td>
                  {[r.unreal, r.real, r.unrealFx + r.realFx, r.income, r.total].map((v, i) => (
                    <td key={i} className={`px-3 text-right tabular-nums ${v > 0 ? "text-emerald-700" : v < 0 ? "text-red-700" : "text-slate-500"}`}>
                      {v ? `${v > 0 ? "+" : ""}${money(v, undefined, 0)}` : "-"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-slate-500">ต้นทุนเฉลี่ย · นับตั้งแต่ยอดตั้งต้น · &ldquo;ส่วนจาก FX&rdquo; รวมอยู่ในยังไม่รับรู้ / รับรู้แล้ว (แสดงแยกให้เห็นว่ามาจากค่าเงินเท่าไร)</p>
        </section>
      )}

      {allocTotal > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          <Alloc title="สัดส่วนตามประเภท" rows={[...byType.entries()].map(([k, v]) => [HOLDING_TYPE_LABEL[k] ?? k, v])} total={allocTotal} />
          <Alloc title="สัดส่วนตามสกุลเงิน" rows={[...byCcy.entries()]} total={allocTotal} />
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 font-medium text-slate-900">รายการล่าสุด</h2>
          {(txs ?? []).length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ</p> : (
            <ul className="space-y-1 text-sm">
              {(txs ?? []).map((t) => {
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

function Alloc({ title, rows, total }: { title: string; rows: [string, number][]; total: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 font-medium text-slate-900">{title}</h2>
      <ul className="space-y-2 text-sm">
        {rows.sort((a, b) => b[1] - a[1]).map(([k, v], i) => {
          const pct = (v / total) * 100;
          return (
            <li key={k}>
              <div className="flex justify-between gap-2">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: blueAt(i) }} />{k}</span>
                <span className="tabular-nums text-slate-600"><span className="font-medium text-slate-800">{pct.toFixed(1)}%</span> · {money(v, undefined, 0)}</span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-blue-50">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${blueAt(i)}, ${blueAt(i + 1)})` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-blue-50" aria-hidden>
        {rows.map(([k, v], i) => <div key={k} style={{ width: `${(v / total) * 100}%`, background: blueAt(i) }} className="h-full border-r border-white/70 last:border-r-0" />)}
      </div>
    </div>
  );
}
