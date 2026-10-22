import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { HOLDING_TYPE_LABEL, money, monthOptions, monthRange, thDate } from "@/lib/format";
import { scheduleOf, type DueRow } from "@/lib/coupon-schedule";
import MonthPicker from "@/components/MonthPicker";
import { MaturityForm, type Bank, type CashAcct } from "./[id]/forms";
import { IncomeForm } from "./[id]/holding/[hid]/forms";

// แท็บ "รอรับเดือนนี้" (หน้า Investments) + กล่องตารางรับ (หน้าหลักทรัพย์)
//   ดอกเบี้ย / Coupon และเงินต้นที่ครบกำหนดในเดือนที่เลือก แยกตามพอร์ต · งวดที่เลยกำหนดแล้วยังไม่บันทึก = ค้างรับ (ขึ้นก่อน · รวมงวดของเดือนก่อน ๆ) · หลังวันนี้ = รอรับ (ยังไม่ถึงกำหนด)
//   ตารางคำนวณจากข้อมูลหลักทุกครั้ง (src/lib/coupon-schedule.ts)

const label = (r: DueRow) => (r.kind === "PRINCIPAL" ? "เงินต้นครบกำหนด" : r.total > 1 ? `ดอกเบี้ย งวด ${r.no}/${r.total}` : "ดอกเบี้ย (ตอนครบกำหนด)");

function Status({ r, today }: { r: DueRow; today: string }) {
  if (r.received) return <span className="text-emerald-700">รับแล้ว {thDate(r.received.date)}</span>;
  if (r.due < today) {
    const d = Math.round((Date.parse(today) - Date.parse(r.due)) / 86400000);
    return <span className="text-red-700">ค้างรับ · เลยกำหนด {d} วัน</span>;
  }
  if (r.due === today) return <span className="text-amber-700">ถึงกำหนดวันนี้</span>;
  return <span className="text-slate-500">รอรับ (ยังไม่ถึงกำหนด)</span>;
}

/** หน้าหลักทรัพย์: ตารางรับทั้งหมด (งวดที่ยังไม่รับก่อน) */
export function ScheduleBox({ rows, currency, today }: { rows: DueRow[]; currency: string; today: string }) {
  const open = rows.filter((r) => !r.received).length;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium text-slate-900">ตารางรับดอกเบี้ย / เงินต้น</h2>
        <span className="text-xs text-slate-500">ยังไม่รับ {open} รายการ · บันทึกรับได้ที่หน้า Investments → แท็บ &ldquo;รอรับเดือนนี้&rdquo;</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1 pr-3">วันรับ</th><th className="pr-3">รายการ</th><th className="pr-3 text-right">ยอดคาดว่าจะได้รับ ({currency})</th>
              <th className="pr-3 text-right">ได้รับจริง</th><th>สถานะ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.key} className={r.received ? "text-slate-500" : ""}>
                <td className="py-1.5 pr-3">{thDate(r.due)}</td>
                <td className="pr-3">{label(r)}</td>
                <td className="pr-3 text-right tabular-nums">{r.expected != null ? money(r.expected) : "-"}</td>
                <td className="pr-3 text-right tabular-nums">{r.received ? money(r.received.amount) : ""}</td>
                <td><Status r={r} today={today} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type HRow = { id: string; name: string; holding_type: string; currency: string; status: string; maturity_date: string | null;
  current_value: number | null; face_value: number | null; interest_rate: number | null; coupon_frequency: string | null;
  investment_portfolios: { asset_id: string; assets: { name: string } | null } | null };
type Fcn = { holding_id: string; principal: number | null; coupon_rate: number | null; coupon_frequency: string | null; issue_date: string | null; trade_date: string | null };
type Tx = { holding_id: string; transaction_type: string; transaction_date: string; amount: number | null };

/** แท็บ "รอรับเดือนนี้" */
export async function DueTab({ month, today, goLive, showAsset, canWrite }: {
  month: string; today: string; goLive: string; showAsset: (assetId: string) => boolean; canWrite: boolean;
}) {
  // วันที่ตั้งต้นของฟอร์มบันทึกรับ = วันรับตามตาราง (ยังไม่ถึง → วันนี้ · ก่อน Go-live → วัน Go-live) · แก้ได้ในฟอร์ม
  const dueDefault = (due: string) => (due > today ? today : due < goLive ? goLive : due);
  const supabase = await createClient();
  const { data: hs } = await supabase.from("investment_holdings")
    .select("id,name,holding_type,currency,status,maturity_date,current_value,face_value,interest_rate,coupon_frequency,investment_portfolios!inner(asset_id,deleted_at,assets(name))")
    .in("holding_type", ["BOND", "FCN", "STRUCTURED_PRODUCT", "OTHER"]).not("maturity_date", "is", null)
    .is("deleted_at", null).is("investment_portfolios.deleted_at", null);
  const holdings = ((hs as unknown as HRow[] | null) ?? []).filter((h) => h.investment_portfolios && showAsset(h.investment_portfolios.asset_id));
  const ids = holdings.map((h) => h.id);
  const none = Promise.resolve({ data: [] as never[] });
  const [{ data: fcns }, { data: txs }, { data: banks }, { data: cash }] = await Promise.all([
    ids.length ? supabase.from("fcn_details").select("holding_id,principal,coupon_rate,coupon_frequency,issue_date,trade_date").in("holding_id", ids).is("deleted_at", null) : none,
    ids.length ? supabase.from("investment_transactions").select("holding_id,transaction_type,transaction_date,amount").in("holding_id", ids)
      .in("transaction_type", ["OPENING_BALANCE", "BUY", "COUPON", "INTEREST", "MATURITY"]).is("deleted_at", null) : none,
    canWrite ? supabase.from("v_bank_accounts_safe").select("asset_id,name,currency").eq("status", "ACTIVE").order("name") : none,
    canWrite ? supabase.from("v_holdings_active").select("id,name,currency,is_default_cash,portfolio_asset_id").eq("holding_type", "CASH").eq("status", "ACTIVE").order("created_at") : none,
  ]);
  const fcnOf = new Map(((fcns as Fcn[] | null) ?? []).map((f) => [f.holding_id, f]));
  const txOf = new Map<string, Tx[]>();
  ((txs as Tx[] | null) ?? []).forEach((t) => txOf.set(t.holding_id, [...(txOf.get(t.holding_id) ?? []), t]));
  const cashOf = (pf: string) => ((cash as (CashAcct & { portfolio_asset_id: string })[] | null) ?? []).filter((c) => c.portfolio_asset_id === pf);

  const { start, end } = monthRange(month);
  const curMonth = today.slice(0, 7);
  // เดือนที่เลือก + งวดที่เลยกำหนดยังไม่รับ (เมื่อดูเดือนนี้หรือเดือนข้างหน้า)
  const items = holdings.flatMap((h) => scheduleOf(h, fcnOf.get(h.id) ?? null, txOf.get(h.id) ?? []).map((r) => ({ r, h })))
    .filter(({ r }) => (r.due >= start && r.due <= end) || (month >= curMonth && !r.received && r.due < start && r.due >= goLive));
  const late = (r: DueRow) => !r.received && r.due < today;
  items.sort((a, b) => Number(late(b.r)) - Number(late(a.r)) || a.r.due.localeCompare(b.r.due) || a.h.name.localeCompare(b.h.name));
  const groups = new Map<string, { name: string; rows: typeof items }>();
  items.forEach((x) => {
    const pf = x.h.investment_portfolios!;
    const g = groups.get(pf.asset_id) ?? { name: pf.assets?.name ?? "พอร์ต", rows: [] };
    g.rows.push(x); groups.set(pf.asset_id, g);
  });
  const sumBy = (rows: typeof items, pick: (x: (typeof items)[number]) => boolean) => {
    const m = new Map<string, number>();
    rows.filter(pick).forEach(({ r, h }) => m.set(h.currency, (m.get(h.currency) ?? 0) + Number(r.received ? r.received.amount : r.expected ?? 0)));
    return [...m.entries()].map(([c, v]) => money(v, c)).join(" · ") || "-";
  };
  const months = monthOptions(goLive, today, 12, month);
  const open = items.filter(({ r }) => !r.received);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">ดอกเบี้ย / Coupon และเงินต้นที่ครบกำหนดรับ · แยกตามพอร์ต · ตั้งข้อมูลที่หลักทรัพย์ → แก้ไขข้อมูล (เงินต้น · อัตรา · จ่ายทุก)</p>
        <MonthPicker months={months} value={month} />
      </div>
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="num-box rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">ยังไม่บันทึกรับ</div>
          <div className="text-2xl font-semibold">{open.length} รายการ</div>
          <div className="text-xs text-red-700">{open.filter(({ r }) => late(r)).length ? `ค้างรับ (เลยกำหนด) ${open.filter(({ r }) => late(r)).length} รายการ` : ""}</div></div>
        <div className="num-box rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">ยอดที่รอรับ (คาดการณ์ก่อนภาษี)</div>
          <div className="text-lg font-semibold tabular-nums">{sumBy(items, ({ r }) => !r.received)}</div></div>
        <div className="num-box rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">รับแล้วในเดือนนี้</div>
          <div className="text-lg font-semibold tabular-nums">{sumBy(items, ({ r }) => !!r.received)}</div></div>
      </section>

      {groups.size === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
          ไม่มีรายการที่ต้องรับในเดือนนี้ · หุ้นกู้จะขึ้นที่นี่เมื่อใส่วันครบกำหนด + เงินต้น + อัตรา + จ่ายทุก ในหน้าแก้ไขข้อมูลของหลักทรัพย์
        </p>
      )}
      {[...groups.entries()].map(([pf, g]) => (
        <section key={pf} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <h2 className="px-4 pt-4 font-medium text-slate-900"><Link href={`/investments/${pf}`} className="hover:underline">{g.name}</Link></h2>
          {/* ความกว้างคอลัมน์คงที่ → ทุกพอร์ตตรงกัน */}
          <table className="mt-2 w-full min-w-[52rem] table-fixed text-sm">
            <colgroup><col /><col className="w-44" /><col className="w-36" /><col className="w-48" /><col className="w-56" /><col className="w-28" /></colgroup>
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-3 py-2">หลักทรัพย์</th><th className="px-3">รายการ</th><th className="px-3">วันครบกำหนด</th>
                <th className="px-3 text-right">ยอดคาดว่าจะได้รับ</th><th className="px-3">สถานะ</th><th className="px-3" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {g.rows.map(({ r, h }) => (
                <tr key={r.key} className={`align-top ${r.received ? "text-slate-500" : ""}`}>
                  <td className="break-words px-3 py-2.5"><Link href={`/investments/${pf}/holding/${h.id}`} className="font-medium text-slate-900 hover:underline">{h.name}</Link>
                    <div className="text-xs text-slate-400">{HOLDING_TYPE_LABEL[h.holding_type] ?? h.holding_type} · {h.currency}</div></td>
                  <td className="px-3 py-2.5">{label(r)}</td>
                  <td className="px-3 py-2.5">{thDate(r.due)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.expected != null ? money(r.expected, h.currency) : "-"}
                    {r.received && <div className="text-xs text-emerald-700">ได้รับ {money(r.received.amount, h.currency)}</div>}</td>
                  <td className="px-3 py-2.5"><Status r={r} today={today} /></td>
                  <td className="px-3 py-2 text-right">
                    {canWrite && !r.received && (r.kind === "INTEREST"
                      ? <IncomeForm assetId={pf} portfolioName={g.name} holdingId={h.id} currency={h.currency} isFcn={h.holding_type !== "BOND" && h.holding_type !== "OTHER"}
                          banks={(banks as Bank[] | null) ?? []} cashAccounts={cashOf(pf)} today={today} minDate={goLive}
                          label="บันทึกรับ" title={`บันทึกรับดอกเบี้ย · ${h.name}`} defaultAmount={r.expected} defaultDate={dueDefault(r.due)} defaultNotes={`${label(r)} (ครบ ${thDate(r.due)})`} />
                      : h.status === "ACTIVE" && <MaturityForm assetId={pf} portfolioName={g.name} banks={(banks as Bank[] | null) ?? []} cashAccounts={cashOf(pf)}
                          holding={{ id: h.id, name: h.name, symbol: null, holding_type: h.holding_type, currency: h.currency, quantity: 0, current_price: null, status: h.status }}
                          today={today} minDate={goLive} label="บันทึกรับ" defaultAmount={r.expected} defaultDate={dueDefault(r.due)} />)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
