"use client";

import Link from "next/link";
import { Fragment, useState, type ReactNode } from "react";
import { MoveButtons, neighbors } from "@/components/SortControls";
import { money, thDate } from "@/lib/format";

export type PortfolioRow = {
  asset_id: string; name: string; sub: string; currency: string; value: number | null; valueThb: number; valueDate: string | null;
  sharePct: number | null; fullValue: number | null; inTransit: boolean; atCost: boolean; closed?: boolean;
  unreal: number; real: number; fx: number; income: number; total: number; cost: number;
};

const sign = (v: number) => (v > 0 ? "text-emerald-700" : v < 0 ? "text-red-700" : "text-slate-500");
const amt = (v: number) => (v ? `${v > 0 ? "+" : ""}${money(v, undefined, 0)}` : "-");
const pct = (total: number, cost: number) => (cost > 0 && total ? `${total > 0 ? "+" : ""}${((total / cost) * 100).toFixed(2)}%` : "");

/** ตารางพอร์ต: มูลค่า (บาท) + ผลตอบแทนรวม (บาท / % เทียบต้นทุน) · กดแถวเพื่อดูผลตอบแทนแยกส่วน */
export default function PortfolioTable({ rows, ordering = false, paths = [], toggle, filter, label = "รวมทุกพอร์ต" }: {
  rows: PortfolioRow[]; ordering?: boolean; paths?: string[]; toggle?: ReactNode; filter?: ReactNode; label?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const sum = (k: keyof PortfolioRow) => rows.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  const tot = { valueThb: sum("valueThb"), total: sum("total"), cost: sum("cost") };
  return (
    <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-medium text-slate-900">พอร์ตทั้งหมด</h2>
          {filter}
        </div>
        {toggle}
      </div>
      <table className="mt-2 w-full min-w-[44rem] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2">พอร์ต</th>
            <th className="px-3 text-right">ต้นทุน (บาท)</th>
            <th className="px-3 text-right">มูลค่า (บาท)</th>
            <th className="px-3 text-right">ผลตอบแทนรวม (บาท)</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => {
            const isOpen = open === r.asset_id;
            return (
              <Fragment key={r.asset_id}>
                <tr onClick={(e) => { if (!ordering && !(e.target as HTMLElement).closest("a,button,form")) setOpen(isOpen ? null : r.asset_id); }}
                  className={`cursor-pointer align-top hover:bg-slate-50 ${isOpen ? "bg-blue-50/60" : ""} ${r.closed ? "opacity-50" : ""}`} title="กดเพื่อดูผลตอบแทนแยกส่วน">
                  <td className="min-w-40 px-4 py-2.5">
                    {ordering && <span className="mr-2 align-middle"><MoveButtons table="assets" id={r.asset_id} paths={paths} {...neighbors(rows, i, (x) => x.asset_id)} /></span>}
                    <Link href={`/investments/${r.asset_id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                    <div className="text-xs text-slate-500">{r.sub}</div>
                    {r.closed && <div className="text-xs text-slate-500">ปิดพอร์ตแล้ว</div>}
                    {r.atCost && <div className="text-xs text-amber-700">มีบางตัวยังใช้ราคาทุน (รอ Statement)</div>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{r.cost ? money(r.cost, undefined, 2) : "-"}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="font-medium tabular-nums">{money(r.valueThb, undefined, 2)}</div>
                    <div className="text-xs text-slate-500">
                      {r.currency !== "THB" && <>{money(r.value, r.currency, 2)} · </>}ณ {thDate(r.valueDate)}
                    </div>
                    {r.sharePct != null && <div className="text-xs text-slate-400">{r.sharePct}% ของ {money(r.fullValue, r.currency, 0)}</div>}
                    {r.inTransit && <div className="text-xs text-amber-700">มีเงินระหว่างทาง</div>}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${sign(r.total)}`}>
                    <div className="font-medium">{amt(r.total)}</div>
                    {pct(r.total, r.cost) && <div className="text-xs">{pct(r.total, r.cost)}</div>}
                  </td>
                  <td className="pr-3 pt-2.5 text-right text-xs text-slate-400">{isOpen ? "▴" : "▾"}</td>
                </tr>
                {isOpen && (
                  <tr className="bg-slate-50">
                    <td colSpan={5} className="px-4 py-3">
                      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
                        <Item label="ต้นทุน" value={money(r.cost, undefined, 0)} />
                        <Item label="ยังไม่รับรู้" value={amt(r.unreal)} cls={sign(r.unreal)} />
                        <Item label="รับรู้แล้ว (ขาย / ไถ่ถอน)" value={amt(r.real)} cls={sign(r.real)} />
                        <Item label="ส่วนจากค่าเงิน (FX)" value={amt(r.fx)} cls={sign(r.fx)} note="รวมอยู่ใน 2 ช่องก่อนหน้า" />
                        <Item label="ปันผล / ดอกเบี้ย สุทธิค่าธรรมเนียม" value={amt(r.income)} cls={sign(r.income)} />
                      </dl>
                      <Link href={`/investments/${r.asset_id}`} className="mt-2 inline-block text-xs text-blue-700 hover:underline">เปิดพอร์ต →</Link>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        {rows.length > 0 && (
          <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
            <tr>
              <td className="px-4 py-2.5">{label}</td>
              <td className="px-3 text-right tabular-nums">{money(tot.cost, undefined, 2)}</td>
              <td className="px-3 text-right tabular-nums">{money(tot.valueThb, undefined, 2)}</td>
              <td className={`px-3 text-right tabular-nums ${sign(tot.total)}`}>
                {amt(tot.total)}{pct(tot.total, tot.cost) && <div className="text-xs font-normal">{pct(tot.total, tot.cost)}</div>}
              </td>
              <td></td>
            </tr>
          </tfoot>
        )}
      </table>
      <p className="px-4 py-3 text-xs text-slate-500">
        ต้นทุน = ต้นทุนเฉลี่ยของหลักทรัพย์ที่ถืออยู่ · ผลตอบแทนนับตั้งแต่ยอดตั้งต้น · % เทียบต้นทุน · กดแถวเพื่อดูแยกส่วน · กดชื่อเพื่อเปิดพอร์ต
      </p>
    </section>
  );
}

function Item({ label, value, cls = "", note }: { label: string; value: string; cls?: string; note?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`tabular-nums ${cls}`}>{value}</dd>
      {note && <dd className="text-xs text-slate-400">{note}</dd>}
    </div>
  );
}
