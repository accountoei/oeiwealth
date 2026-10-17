"use client";

import { useState, type ReactNode } from "react";
import { money } from "@/lib/format";
import { useOnMainTab } from "./tabs";
import DateSortHead from "@/components/DateSortHead";

export type DueRow = {
  key: string; due: string; type: string; currency: string;
  expected: number; done: number; open: boolean;      // open = ยังต้องรับ / จ่าย (ไม่รวมรับครบ / ยกเว้น)
  el: ReactNode;
};

/** ตารางรายการที่ต้องรับ / จ่ายในเดือน · ตัวกรองตามประเภท + เฉพาะที่ยังค้าง · แถวรวมตามตัวกรอง · กดปุ่มในแถว → ฟอร์มกางใต้แถว */
export default function DueTable({ kind, rows }: { kind: "income" | "expense"; rows: DueRow[] }) {
  const [type, setType] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [asc, setAsc] = useState(true);                // เรียงวันที่น้อย → มาก (ล่าสุดอยู่ล่าง)
  useOnMainTab(() => setOnlyOpen(true));            // สลับแท็บแล้วกลับมา → ติ๊ก "เฉพาะที่ยังไม่…" ไว้เสมอ
  const types = [...new Set(rows.map((r) => r.type))];
  const count = (t: string) => rows.filter((r) => (!t || r.type === t) && (!onlyOpen || r.open)).length;
  const shown = rows.filter((r) => (!type || r.type === type) && (!onlyOpen || r.open))
    .sort((a, b) => (asc ? 1 : -1) * a.due.localeCompare(b.due));
  const totals = new Map<string, { expected: number; done: number; left: number }>();
  for (const r of shown) {
    const t = totals.get(r.currency) ?? { expected: 0, done: 0, left: 0 };
    t.expected += r.expected; t.done += r.done; if (r.open) t.left += Math.max(r.expected - r.done, 0);
    totals.set(r.currency, t);
  }
  const chip = (active: boolean) => `rounded-full border px-3 py-1 text-xs ${active
    ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
  const doneLabel = kind === "income" ? "ได้รับแล้ว" : "จ่ายแล้ว";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {types.length > 1 && (
          <>
            <button type="button" onClick={() => setType("")} className={chip(!type)}>ทั้งหมด ({count("")})</button>
            {types.map((t) => (
              <button key={t} type="button" onClick={() => setType(type === t ? "" : t)} className={chip(type === t)}>{t} ({count(t)})</button>
            ))}
          </>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          เฉพาะที่ยัง{kind === "income" ? "ไม่ได้รับ" : "ไม่ได้จ่าย"}
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100"><th className="py-1.5 pr-2"><DateSortHead asc={asc} onToggle={() => setAsc(!asc)} label="ครบกำหนด" /></th><th className="px-2">รายการ</th><th className="px-2 text-right">คาดไว้</th>
              <th className="px-2 text-right">{doneLabel}</th><th className="px-2">สถานะ</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-slate-500">{onlyOpen ? `ไม่มีรายการที่ยัง${kind === "income" ? "ไม่ได้รับ" : "ไม่ได้จ่าย"} · เอาติ๊กออกเพื่อดูทั้งเดือน` : "ไม่มีรายการตามตัวกรอง"}</td></tr>}
            {shown.map((r) => <Frag key={r.key}>{r.el}</Frag>)}
          </tbody>
          {shown.length > 0 && (
            <tfoot className="border-t border-slate-200 text-sm font-medium">
              {[...totals.entries()].map(([ccy, t]) => (
                <tr key={ccy}>
                  <td className="py-2 pr-2">รวม{type ? ` ${type}` : ""}{totals.size > 1 ? ` (${ccy})` : ""}</td>
                  <td></td>
                  <td className="px-2 text-right tabular-nums">{money(t.expected, ccy)}</td>
                  <td className="px-2 text-right tabular-nums text-emerald-700">{money(t.done)}</td>
                  <td colSpan={2} className="px-2 text-xs font-normal">
                    {t.left > 0.005 ? <span className="text-amber-700">ยังค้าง {money(t.left)}</span> : <span className="text-slate-400">ไม่มียอดค้าง</span>}
                  </td>
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Frag({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
