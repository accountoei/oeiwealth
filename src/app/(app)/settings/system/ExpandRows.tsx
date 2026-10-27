"use client";

import { Fragment, useState, type ReactNode } from "react";

export type ExpandRow = { key: string; cells: ReactNode[]; history: ReactNode[][] };

/** ตารางที่แสดงเฉพาะข้อมูลล่าสุดแถวละรายการ · กดที่แถว → ขยายดูข้อมูลวันก่อน ๆ ของรายการนั้น (กดอีกครั้งพับเก็บ) */
export default function ExpandRows({ head, historyHead, rows, alignRight = [] }: {
  head: string[]; historyHead: string[]; rows: ExpandRow[]; alignRight?: number[];
}) {
  const [open, setOpen] = useState<string[]>([]);
  const toggle = (k: string) => setOpen((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));
  const r = (i: number) => (alignRight.includes(i) ? "text-right tabular-nums" : "");
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-500">
        <tr><th className="w-5" />{head.map((h, i) => <th key={i} className={`py-1 pr-3 ${r(i)}`}>{h}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((row) => {
          const isOpen = open.includes(row.key);
          const can = row.history.length > 0;
          return (
            <Fragment key={row.key}>
              <tr onClick={can ? (e) => { if (!(e.target as HTMLElement).closest("a")) toggle(row.key); } : undefined} title={can ? (isOpen ? "กดเพื่อพับเก็บ" : "กดเพื่อดูวันก่อนหน้า") : undefined}
                className={can ? "cursor-pointer hover:bg-slate-50" : ""}>
                <td className="py-1.5 text-xs text-slate-400">{can ? (isOpen ? "▾" : "▸") : ""}</td>
                {row.cells.map((c, i) => <td key={i} className={`py-1.5 pr-3 ${r(i)}`}>{c}</td>)}
              </tr>
              {isOpen && (
                <tr>
                  <td />
                  <td colSpan={row.cells.length} className="pb-3">
                    <table className="w-full rounded-lg bg-slate-50 text-xs text-slate-600">
                      <thead className="text-left text-slate-400"><tr>{historyHead.map((h, i) => <th key={i} className={`px-3 py-1 ${i === 1 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {row.history.map((h, j) => (
                          <tr key={j}>{h.map((c, i) => <td key={i} className={`px-3 py-1 ${i === 1 ? "text-right tabular-nums" : ""}`}>{c}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
