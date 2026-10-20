import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { money, thDate, todayBangkok } from "@/lib/format";
import { loadPersonView } from "@/lib/person-view";
import PersonFilter from "@/components/PersonFilter";
import { MoveButtons, SortToggle, bySort, neighbors } from "@/components/SortControls";
import { loadSortMap, orderHrefs } from "@/lib/sort";
import { StatBox } from "@/components/Boxes";

const STATUS: Record<string, string> = { ACTIVE: "ปกติ", AT_RISK: "มีความเสี่ยง", CLOSED: "ปิดแล้ว", WRITTEN_OFF: "ตัดหนี้สูญ" };
const DERIVED: Record<string, { text: string; cls: string }> = {
  OVERDUE: { text: "เลยกำหนดคืน", cls: "text-red-600" }, DUE_SOON: { text: "ใกล้ครบกำหนด", cls: "text-amber-700" },
};

export default async function LoansPage({ searchParams }: { searchParams: Promise<{ p?: string; order?: string }> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const pv = await loadPersonView(sp.p);
  const canOrder = me.role === "ADMIN" || me.role === "EDITOR";
  const ordering = canOrder && sp.order === "1";
  const paths = ["/financial/loans"];
  const [{ data, error }, { data: sched }, sortMap] = await Promise.all([
    supabase.from("v_loans_status")
      .select("asset_id,name,currency,borrower_name,principal,outstanding_principal,interest_rate,due_date,status,derived_status")
      .order("status").order("name"),
    supabase.from("v_loan_schedule_status").select("loan_asset_id,due_date,total_remaining,status")
      .in("status", ["OVERDUE", "PARTIAL", "PENDING"]).order("due_date"),
    loadSortMap("assets"),
  ]);
  // ตารางผ่อน: งวดถัดไป + งวดที่เลยกำหนด ของแต่ละสัญญา
  const nextDue = new Map<string, { due_date: string; amount: number }>();
  const overdue = new Map<string, { n: number; amount: number }>();
  (sched ?? []).forEach((x) => {
    if (x.status === "OVERDUE") {
      const o = overdue.get(x.loan_asset_id) ?? { n: 0, amount: 0 };
      overdue.set(x.loan_asset_id, { n: o.n + 1, amount: o.amount + Number(x.total_remaining) });
    } else if (!nextDue.has(x.loan_asset_id)) nextDue.set(x.loan_asset_id, { due_date: x.due_date, amount: Number(x.total_remaining) });
  });
  const rows = bySort((data ?? []).filter((r) => pv.showAsset(r.asset_id)), (r) => r.asset_id, sortMap);
  const totals = new Map<string, number>();
  rows.filter((r) => r.status !== "CLOSED" && r.status !== "WRITTEN_OFF")
    .forEach((r) => totals.set(r.currency, (totals.get(r.currency) ?? 0) + Number(r.outstanding_principal ?? 0) * pv.assetShare(r.asset_id)));
  // สรุปด้านบน (สัญญาที่ยังไม่ปิด · THB · ตามสัดส่วนของสมาชิกที่เลือก)
  const open = rows.filter((r) => r.status !== "CLOSED" && r.status !== "WRITTEN_OFF");
  const thbOf = (r: (typeof rows)[number], v: number | null | undefined) => (r.currency === "THB" ? Number(v ?? 0) * pv.assetShare(r.asset_id) : 0);
  const outTotal = open.reduce((t, r) => t + thbOf(r, r.outstanding_principal), 0);
  const principalTotal = open.reduce((t, r) => t + thbOf(r, r.principal), 0);
  const overdueN = open.reduce((t, r) => t + (overdue.get(r.asset_id)?.n ?? 0), 0);
  const overdueAmt = open.reduce((t, r) => t + thbOf(r, overdue.get(r.asset_id)?.amount), 0);
  const ym = todayBangkok().slice(0, 7);
  const dueThisMonth = open.reduce((t, r) => t + (nextDue.get(r.asset_id)?.due_date.startsWith(ym) ? thbOf(r, nextDue.get(r.asset_id)?.amount) : 0), 0);
  const atRisk = open.filter((r) => r.status === "AT_RISK").length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Loans Receivable</h1>
          <p className="text-sm text-slate-500">เงินที่ให้คนอื่นยืม · มูลค่า = เงินต้นคงเหลือ (ลดลงเมื่อบันทึกรับชำระ)</p>
        </div>
        <div className="flex items-start gap-2">
          <PersonFilter persons={pv.persons} value={pv.personId} />
          {me.role !== "VIEWER" && <Link href="/financial/loans/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">+ เพิ่มเงินให้กู้</Link>}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">โหลดข้อมูลไม่สำเร็จ: {error.message}</p>}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">เงินต้นคงเหลือรวม (THB)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{money(outTotal, "THB")}</div>
          {principalTotal > 0 && <div className="text-xs text-slate-500">รับคืนแล้ว {(((principalTotal - outTotal) * 100) / principalTotal).toFixed(1)}% ของเงินต้น {money(principalTotal, undefined, 0)}</div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">สัญญาที่ยังไม่ปิด</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{open.length} <span className="text-sm font-normal text-slate-500">สัญญา</span></div>
          {atRisk > 0 && <div className="text-xs text-amber-700">มีความเสี่ยง {atRisk} สัญญา</div>}
        </div>
        <StatBox label="ครบกำหนดรับเดือนนี้ (THB)" value={money(dueThisMonth, "THB")} valueClass="text-emerald-700" />
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">ค้างรับ (เลยกำหนด)</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${overdueN > 0 ? "text-red-700" : ""}`}>{money(overdueAmt, "THB")}</div>
          <div className="text-xs text-slate-500">{overdueN} งวด</div>
        </div>
      </section>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
          <h2 className="font-medium text-slate-900">เงินให้กู้ทั้งหมด</h2>
          <div className="flex flex-wrap items-baseline gap-4">
            {totals.size > 0 && (
              <span className="text-sm text-slate-600">เงินต้นคงเหลือรวม{" "}
                {[...totals.entries()].map(([c, v], i) => <b key={c} className="tabular-nums text-slate-900">{i > 0 && " · "}{money(v, c)}</b>)}
              </span>
            )}
            {canOrder && rows.length > 1 && <SortToggle active={ordering} {...orderHrefs("/financial/loans", { p: sp.p })} />}
          </div>
        </div>
        <table className="mt-2 w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">รายการ</th><th className="px-4 text-right">เงินต้นคงเหลือ</th><th className="px-4">งวดถัดไป</th><th className="px-4">ครบกำหนดสัญญา</th><th className="px-4">สถานะ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">{pv.personId ? `ไม่มีเงินให้กู้ของ ${pv.personName}` : "ยังไม่มีเงินให้กู้"}</td></tr>}
            {rows.map((r, i) => (
              <tr key={r.asset_id} className={r.status === "CLOSED" || r.status === "WRITTEN_OFF" ? "opacity-50" : ""}>
                <td className="px-4 py-3">
                  {ordering && <span className="mr-2 align-middle"><MoveButtons table="assets" id={r.asset_id} paths={paths} {...neighbors(rows, i, (x) => x.asset_id)} /></span>}
                  <Link href={`/financial/loans/${r.asset_id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                  <div className="text-xs text-slate-500">ผู้กู้ {r.borrower_name} · เงินต้น {money(r.principal, r.currency)}{r.interest_rate != null && ` · ดอกเบี้ย ${Number(r.interest_rate)}%`}</div>
                </td>
                <td className="px-4 text-right tabular-nums">
                  {money(r.outstanding_principal == null ? null : Number(r.outstanding_principal) * pv.assetShare(r.asset_id), r.currency)}
                  {pv.assetPct(r.asset_id) != null && <div className="text-xs text-slate-400">{pv.assetPct(r.asset_id)}% ของ {money(r.outstanding_principal, r.currency)}</div>}
                </td>
                <td className="px-4">
                  {nextDue.get(r.asset_id) ? <>{thDate(nextDue.get(r.asset_id)?.due_date)}
                    <div className="text-xs tabular-nums text-slate-500">{money(nextDue.get(r.asset_id)?.amount, r.currency)}</div></> : <span className="text-slate-400">-</span>}
                  {overdue.get(r.asset_id) && <div className="text-xs text-red-600">เลยกำหนด {overdue.get(r.asset_id)?.n} งวด · {money(overdue.get(r.asset_id)?.amount)}</div>}
                </td>
                <td className="px-4">{thDate(r.due_date)}</td>
                <td className="px-4 text-xs">{STATUS[r.status] ?? r.status}
                  {r.derived_status && <div className={DERIVED[r.derived_status]?.cls}>{DERIVED[r.derived_status]?.text}</div>}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <tr><td className="px-4 py-3">รวม {open.length} สัญญาที่ยังไม่ปิด</td><td className="px-4 text-right tabular-nums">{money(outTotal)}</td><td></td><td></td><td></td></tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
