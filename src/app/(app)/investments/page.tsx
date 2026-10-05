import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { HOLDING_TYPE_LABEL, ITX_LABEL, money, thDate, todayBangkok, addDays } from "@/lib/format";

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
          <Link href="/investments/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800">+ เพิ่มพอร์ต</Link>
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
                <li key={h.id}><Link href={`/investments/${h.portfolio_asset_id}`} className="hover:underline">{h.name}</Link>
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
        {rows.sort((a, b) => b[1] - a[1]).map(([k, v]) => {
          const pct = (v / total) * 100;
          return (
            <li key={k}>
              <div className="flex justify-between"><span>{k}</span><span className="tabular-nums text-slate-600">{pct.toFixed(1)}% · {money(v, undefined, 0)}</span></div>
              <div className="mt-1 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-slate-700" style={{ width: `${pct}%` }} /></div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
