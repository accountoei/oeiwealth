"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import Modal from "@/components/Modal";
import { money } from "@/lib/format";
import { loadGroupChanges, loadInvestmentGain, loadMonthFlows, type GroupChange, type InvestmentGain, type MonthFlows, type Row } from "./dashboard-detail";

/** กล่องบน Dashboard ที่กดได้ → pop up รายละเอียด (โหลดตอนกด) */
export function DetailBox({ title, hint, children, popupTitle, start, personId, ym, bridge }: {
  title: ReactNode; hint?: string; children: ReactNode; popupTitle: string;
  start: string; personId: string; ym: string;
  /** กล่องความมั่งคั่ง: บรรทัดสรุปเดียวกับในกล่อง (แสดงบนสุดของ pop up) */
  bridge?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* เหตุการณ์จากใน pop up (portal) ไหลกลับมาที่กล่องนี้ → รับเฉพาะที่เกิดในกล่องจริง */}
      <div role="button" tabIndex={0} title="กดเพื่อดูรายละเอียด"
        onClick={(e) => { if (!open && e.currentTarget.contains(e.target as Node)) setOpen(true); }}
        onKeyDown={(e) => { if (!open && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen(true); } }}
        className="block w-full cursor-pointer rounded-xl border border-slate-200 bg-white p-5 text-left transition hover:border-blue-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="font-medium text-slate-900">{title}</h2>
          <span className="shrink-0 text-xs text-blue-700">{hint ?? "ดูรายละเอียด ›"}</span>
        </div>
        {children}
      </div>
      {open && (
        <Modal title={popupTitle} size="lg" onClose={() => setOpen(false)}>
          <div data-keep-open>
            <ChangeDetail start={start} personId={personId} ym={ym} bridge={bridge} />
          </div>
        </Modal>
      )}
    </>
  );
}

function useLoad<T>(fn: () => Promise<T | { error: string }>) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    fn().then((r) => { if (!alive) return; if (r && typeof r === "object" && "error" in r) setErr(r.error); else setData(r as T); })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { data, err };
}

const Loading = () => <p className="animate-pulse text-sm text-slate-500">กำลังโหลด…</p>;
const sign = (v: number) => (v > 0 ? "text-emerald-700" : v < 0 ? "text-red-700" : "text-slate-500");

/** ตารางยอดตามกลุ่ม + แถวรวม */
function RowsTable({ title, rows, total, totalLabel = "รวม", empty, negative }: {
  title: string; rows: Row[]; total: number; totalLabel?: string; empty: string; negative?: boolean;
}) {
  return (
    <section>
      <h3 className="mb-1 text-sm font-medium text-slate-800">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-slate-500">{empty}</p> : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="py-1.5 pr-3">{r.label}{r.count ? <span className="text-xs text-slate-400"> ({r.count})</span> : null}</td>
                <td className="w-24 py-1.5 pr-3 text-right text-xs tabular-nums text-slate-500">{total ? `${((r.value * 100) / total).toFixed(1)}%` : ""}</td>
                <td className={`py-1.5 text-right tabular-nums ${negative ? "text-red-700" : ""}`}>{money(r.value, undefined, 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 font-medium">
            <tr><td className="py-1.5">{totalLabel}</td><td></td><td className={`py-1.5 text-right tabular-nums ${negative ? "text-red-700" : ""}`}>{money(total, undefined, 0)}</td></tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}

function ChangeDetail({ start, personId, ym, bridge }: { start: string; personId: string; ym: string; bridge?: ReactNode }) {
  const { data: f, err: e1 } = useLoad<MonthFlows>(() => loadMonthFlows(start, personId));
  const { data: g, err: e2 } = useLoad<GroupChange[]>(() => loadGroupChanges(start, personId));
  const { data: ig, err: e3 } = useLoad<InvestmentGain | null>(() => loadInvestmentGain(start, personId));
  const err = e1 || e2 || e3;
  const gs = g ?? [];
  const nw = (k: "start" | "end") => gs.reduce((t, r) => t + (r.key === "LIABILITY" ? -r[k] : r[k]), 0);
  return (
    <div className="space-y-5">
      {bridge && <section className="rounded-lg bg-slate-50 p-3">{bridge}</section>}
      {err && <p className="text-sm text-red-600">โหลดไม่สำเร็จ: {err}</p>}
      {!f || !g ? (!err && <Loading />) : (
        <>
          <section>
            <h3 className="mb-1 text-sm font-medium text-slate-800">มูลค่าตามหมวด ต้นงวด → สิ้นงวด</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1">หมวด</th><th className="text-right">ต้นงวด</th><th className="text-right">สิ้นงวด</th><th className="text-right">เปลี่ยน</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gs.map((r) => {
                  const d = (r.end - r.start) * (r.key === "LIABILITY" ? -1 : 1);       // หนี้เพิ่ม = ความมั่งคั่งลด
                  return (
                    <tr key={r.key}>
                      <td className="py-1.5">{r.label}</td>
                      <td className={`text-right tabular-nums ${r.key === "LIABILITY" ? "text-red-700" : ""}`}>{money(r.start, undefined, 0)}</td>
                      <td className={`text-right tabular-nums ${r.key === "LIABILITY" ? "text-red-700" : ""}`}>{money(r.end, undefined, 0)}</td>
                      <td className={`text-right tabular-nums ${sign(d)}`}>{d > 0 ? "+" : ""}{money(d, undefined, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 font-medium">
                <tr><td className="py-1.5">Net Worth</td><td className="text-right tabular-nums">{money(nw("start"), undefined, 0)}</td>
                  <td className="text-right tabular-nums">{money(nw("end"), undefined, 0)}</td>
                  <td className={`text-right tabular-nums ${sign(nw("end") - nw("start"))}`}>{nw("end") - nw("start") > 0 ? "+" : ""}{money(nw("end") - nw("start"), undefined, 0)}</td></tr>
              </tfoot>
            </table>
            <p className="mt-1 text-xs text-slate-500">
              &ldquo;เปลี่ยน&rdquo; ของแต่ละหมวดรวมเงินที่ย้ายระหว่างหมวดด้วย (เช่น โอนธนาคาร → พอร์ต 100,000: เงินฝาก −100,000 · การลงทุน +100,000 · รวมเป็น 0) ·
              หนี้สินเพิ่ม = ความมั่งคั่งลด
            </p>
          </section>
          {ig && ig.by_portfolio.length > 0 && <GainTable ig={ig} />}
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-5">
              <RowsTable title="+ รายได้สุทธิ (หลังภาษี) ตามประเภท" rows={f.income} total={f.incomeTotal} empty="ไม่มีรายได้" />
              {f.investment.length > 0 && <RowsTable title="+ รายได้ลงทุน ตามพอร์ต" rows={f.investment} total={f.investmentTotal} empty="-" />}
            </div>
            <RowsTable title="− ค่าใช้จ่ายตามหมวด" rows={f.expense} total={f.expenseTotal} empty="ไม่มีค่าใช้จ่าย" negative
              totalLabel={f.reimbursements ? `รวม (ก่อนหักเงินคืน ${money(f.reimbursements, undefined, 0)})` : "รวม"} />
          </div>
          {f.topExpenses.length > 0 && (
            <section>
              <h3 className="mb-1 text-sm font-medium text-slate-800">ค่าใช้จ่ายสูงสุด {f.topExpenses.length} รายการ</h3>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {f.topExpenses.map((e, i) => (
                    <tr key={i}>
                      <td className="w-24 py-1.5 pr-3 text-xs text-slate-500">{e.date.slice(8, 10)}/{e.date.slice(5, 7)}</td>
                      <td className="py-1.5 pr-3">{e.label}{e.category && <span className="text-xs text-slate-400"> · {e.category}</span>}</td>
                      <td className="py-1.5 text-right tabular-nums text-red-700">{money(e.value, undefined, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-500">{personId ? "ส่วนของสมาชิกที่เลือก (ตามสัดส่วน) · " : ""}&ldquo;มูลค่าเปลี่ยน / อื่น ๆ&rdquo; = ประเมินใหม่ (อสังหาฯ / ธุรกิจ / ทอง) · อัตราแลกเปลี่ยนนอกพอร์ต · ยอดหนี้ · รายการที่ไม่ได้บันทึก</p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/settings/month-closing?m=${ym}`} className="text-sm text-blue-700 hover:underline">เปิดหน้า Month Closing ›</Link>
              <Link href={`/income-expenses?m=${ym}${personId ? `&p=${personId}` : ""}`} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                เปิดหน้ารายได้ / ค่าใช้จ่าย (ทุกรายการ)</Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** กำไร / ขาดทุนเงินลงทุนตามพอร์ต: สิ้นงวด − ต้นงวด − เงินเข้า / ออก (โอน · ซื้อขายผ่านบัญชีธนาคาร · ปันผลที่เข้าพอร์ต · จ่ายออก) */
function GainTable({ ig }: { ig: InvestmentGain }) {
  const rows = ig.by_portfolio;
  return (
    <section>
      <h3 className="mb-1 text-sm font-medium text-slate-800">± กำไร / ขาดทุนเงินลงทุน ตามพอร์ต</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1">พอร์ต</th><th className="text-right">ต้นงวด</th><th className="text-right">เงินเข้า / ออก</th>
              <th className="text-right">สิ้นงวด</th><th className="text-right">กำไร / ขาดทุน</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.asset_id} className="align-top">
                <td className="py-1.5 pr-2"><Link href={`/investments/${r.asset_id}`} className="hover:underline">{r.name}</Link></td>
                <td className="text-right tabular-nums">{money(r.start, undefined, 0)}</td>
                <td className="text-right tabular-nums text-slate-500">{r.flows ? `${r.flows > 0 ? "+" : ""}${money(r.flows, undefined, 0)}` : "-"}</td>
                <td className="text-right tabular-nums">{money(r.end, undefined, 0)}</td>
                <td className={`text-right tabular-nums ${sign(r.gain)}`}>
                  {r.gain > 0 ? "+" : ""}{money(r.gain, undefined, 0)}
                  {r.fx !== 0 && <div className="text-xs text-slate-500">จาก FX {r.fx > 0 ? "+" : ""}{money(r.fx, undefined, 0)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot className="border-t-2 border-slate-200 font-medium">
              <tr><td className="py-1.5" colSpan={4}>รวม</td>
                <td className={`text-right tabular-nums ${sign(ig.gain)}`}>{ig.gain > 0 ? "+" : ""}{money(ig.gain, undefined, 0)}</td></tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        กำไร / ขาดทุน = สิ้นงวด − ต้นงวด − เงินเข้า / ออก · รวมราคาเปลี่ยน · ขายต่างจากราคาล่าสุด · ค่าธรรมเนียม / ภาษีในพอร์ต · อัตราแลกเปลี่ยนของพอร์ต ·
        &ldquo;เงินเข้า / ออก&rdquo; = โอนกับธนาคาร · ซื้อขายผ่านบัญชีธนาคาร · ปันผล / ดอกเบี้ยที่เข้าพอร์ต (อยู่ในรายได้ลงทุนแล้ว) · จ่ายค่าใช้จ่าย / บัตรจากพอร์ต ·
        &ldquo;จาก FX&rdquo; เป็นยอดประมาณ (มูลค่าต้นงวด × อัตราที่เปลี่ยน)
      </p>
    </section>
  );
}
