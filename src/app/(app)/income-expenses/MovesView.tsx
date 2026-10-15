"use client";

import { useState, type ReactNode } from "react";
import { money, thDate } from "@/lib/format";

export type MoveRow = {
  key: string; date: string; type: string; fromLabel: string; toLabel: string;
  fromBank: string | null; toBank: string | null;                 // บัญชีธนาคารในระบบ (ใช้กรอง / แยกเข้า–ออก)
  fromAmount: number; fromCcy: string; toAmount: number; toCcy: string;
  extra?: ReactNode; detail: ReactNode; actions?: ReactNode; typeCls?: string;
};

/** ความเคลื่อนไหวของเงิน: กรองตามบัญชี · เงินเข้า (เขียว) / ออก (แดง) / โอนระหว่างบัญชีตัวเอง (เทา) · แถวรวมเข้า / ออก / สุทธิ */
export default function MovesView({ rows, banks, showActions = false }: {
  rows: MoveRow[]; banks: { id: string; name: string }[]; showActions?: boolean;
}) {
  const [acct, setAcct] = useState("");
  const used = banks.filter((b) => rows.some((r) => r.fromBank === b.id || r.toBank === b.id));
  const shown = rows.filter((r) => !acct || r.fromBank === acct || r.toBank === acct);
  // ทิศทางของเงิน (เทียบกับบัญชีที่เลือก หรือทั้งครอบครัว)
  const dir = (r: MoveRow): "in" | "out" | "move" => {
    if (acct) return r.toBank === acct && r.fromBank !== acct ? "in" : r.fromBank === acct && r.toBank !== acct ? "out" : "move";
    return r.toBank && !r.fromBank ? "in" : r.fromBank && !r.toBank ? "out" : "move";
  };
  const totals = new Map<string, { inn: number; out: number }>();
  const add = (ccy: string, k: "inn" | "out", v: number) => {
    const t = totals.get(ccy) ?? { inn: 0, out: 0 }; t[k] += v; totals.set(ccy, t);
  };
  shown.forEach((r) => {
    const d = dir(r);
    if (d === "in") add(r.toCcy, "inn", r.toAmount);
    if (d === "out") add(r.fromCcy, "out", r.fromAmount);
  });
  const cols = showActions ? 6 : 5;
  return (
    <div className="space-y-3">
      {used.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="mv-acct" className="text-xs text-slate-500">บัญชี</label>
          <select id="mv-acct" value={acct} onChange={(e) => setAcct(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
            <option value="">ทุกบัญชี</option>
            {used.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {acct && <span className="text-xs text-slate-500">ใช้เทียบกับ Statement ของบัญชีนี้</span>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100"><th className="py-1.5">วันที่</th><th>ประเภท</th><th>จาก → ไป</th><th className="text-right">จำนวน</th>
              <th className="pl-4">รายละเอียด</th>{showActions && <th></th>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={cols} className="py-4 text-center text-slate-500">ไม่มีรายการ</td></tr>}
            {shown.map((r) => {
              const d = dir(r);
              const amt = d === "in" ? r.toAmount : r.fromAmount;
              const ccy = d === "in" ? r.toCcy : r.fromCcy;
              return (
                <tr key={r.key} className="align-top">
                  <td className="whitespace-nowrap py-1.5 pr-2">{thDate(r.date)}</td>
                  <td className={`pr-2 ${r.typeCls ?? ""}`}>{r.type}</td>
                  <td className="pr-2 text-xs text-slate-600">{r.fromLabel} → {r.toLabel}</td>
                  <td className={`whitespace-nowrap text-right tabular-nums ${d === "in" ? "text-emerald-700" : d === "out" ? "text-red-700" : "text-slate-700"}`}>
                    {d === "in" ? "+" : d === "out" ? "−" : ""}{money(amt, ccy)}
                    {r.extra}
                  </td>
                  <td className="pl-4 text-xs text-slate-500">{r.detail}</td>
                  {showActions && <td className="pl-2 text-right">{r.actions}</td>}
                </tr>
              );
            })}
          </tbody>
          {shown.length > 0 && totals.size > 0 && (
            <tfoot className="border-t border-slate-200 text-sm">
              {[...totals.entries()].map(([ccy, t]) => (
                <tr key={ccy}>
                  <td colSpan={3} className="py-2 font-medium">รวม{acct ? "" : " (ไม่นับโอนระหว่างบัญชีตัวเอง)"}{totals.size > 1 ? ` · ${ccy}` : ""}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    <div className="text-emerald-700">เข้า +{money(t.inn, ccy)}</div>
                    <div className="text-red-700">ออก −{money(t.out, ccy)}</div>
                    <div className={`font-semibold ${t.inn - t.out >= 0 ? "text-emerald-700" : "text-red-700"}`}>สุทธิ {t.inn - t.out >= 0 ? "+" : "−"}{money(Math.abs(t.inn - t.out), ccy)}</div>
                  </td>
                  <td colSpan={cols - 4}></td>
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
