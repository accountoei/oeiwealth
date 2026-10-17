"use client";

import { useState, type ReactNode } from "react";
import { money, thDate } from "@/lib/format";
import { moveMeta } from "@/lib/ledger";
import MoveBadge from "@/components/MoveBadge";
import { useOnMainTab } from "./tabs";

export type MoveRow = {
  key: string; date: string; type: string; fromLabel: string; toLabel: string;
  fromBank: string | null; toBank: string | null;                 // บัญชีธนาคารในระบบ (ใช้กรอง / แยกเข้า–ออก)
  fromAmount: number; fromCcy: string; toAmount: number; toCcy: string;
  extra?: ReactNode; detail: ReactNode; actions?: ReactNode; typeCls?: string;
  kind: string; merged?: boolean;
  metaOpts?: { incomeType: string | null; incomeSubtype: string | null; expenseCategory: string | null; pending: boolean };
};

/**
 * ความเคลื่อนไหวของเงิน (ป้ายประเภท + หมวด + เงินเข้า / เงินออก แยกคอลัมน์) · กรองตามบัญชี
 *   ทุกบัญชี: โอนระหว่างบัญชีของครอบครัว = ⇄ (ไม่นับเป็นเข้า / ออก)
 *   เลือกทีละบัญชี: มีคอลัมน์ยอดคงเหลือหลังแต่ละรายการ (ยอดยกมา + รายการ) — เทียบกับ Statement ได้
 */
export default function MovesView({ rows, banks, showActions = false, openings = {} }: {
  rows: MoveRow[]; banks: { id: string; name: string }[]; showActions?: boolean; openings?: Record<string, number | null>;
}) {
  const [acct, setAcct] = useState("");
  useOnMainTab(() => setAcct(""));
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
  // ยอดคงเหลือหลังแต่ละรายการ (เฉพาะเมื่อเลือกบัญชีเดียว) · รายการเรียงใหม่ → เก่า จึงคิดจากล่างขึ้นบน
  const opening = acct ? openings[acct] ?? null : null;
  const balance = new Map<string, number>();
  if (acct && opening != null) {
    let run = opening;
    [...shown].reverse().forEach((r) => {
      const d = dir(r);
      run += d === "in" ? r.toAmount : d === "out" ? -r.fromAmount : 0;
      balance.set(r.key, run);
    });
  }
  const withBal = acct !== "" && opening != null;
  const cols = 6 + (withBal ? 1 : 0) + (showActions ? 1 : 0);
  return (
    <div className="space-y-3">
      {used.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="mv-acct" className="text-xs text-slate-500">บัญชี</label>
          <select id="mv-acct" value={acct} onChange={(e) => setAcct(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
            <option value="">ทุกบัญชี</option>
            {used.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {acct
            ? <span className="text-xs text-slate-500">ยอดคงเหลือ = ยอดยกมา {opening == null ? "-" : money(opening)} + รายการ · ใช้เทียบกับ Statement ของบัญชีนี้</span>
            : <span className="text-xs text-slate-500">เลือกบัญชีเพื่อดูยอดคงเหลือหลังแต่ละรายการ</span>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="py-1.5">วันที่</th><th>ประเภท</th><th>รายละเอียด</th><th>หมวดหมู่</th>
              <th className="text-right">เงินเข้า</th><th className="text-right">เงินออก</th>
              {withBal && <th className="text-right">ยอดคงเหลือ</th>}{showActions && <th></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={cols} className="py-4 text-center text-slate-500">ไม่มีรายการ</td></tr>}
            {shown.map((r) => {
              const d = dir(r);
              const meta = moveMeta(r.kind, d, { merged: r.merged, ...(r.metaOpts ?? {}) });
              const bal = balance.get(r.key);
              return (
                <tr key={r.key} className="align-top">
                  <td className="whitespace-nowrap py-2 pr-2">{thDate(r.date)}</td>
                  <td className="pr-2"><MoveBadge label={meta.label} tone={meta.tone} /></td>
                  <td className="pr-2">
                    <div className="text-slate-800">{r.detail}</div>
                    <div className="text-xs text-slate-400">{r.fromLabel} → {r.toLabel}</div>
                  </td>
                  <td className="pr-2 text-indigo-700">{meta.category}</td>
                  {d === "move" ? (
                    <td colSpan={2} className="whitespace-nowrap text-right tabular-nums text-slate-500" title="โอนระหว่างบัญชีของครอบครัว (ไม่นับเป็นเงินเข้า / ออก)">
                      ⇄ {money(r.fromAmount, r.fromCcy)}{r.extra}
                    </td>
                  ) : (
                    <>
                      <td className="whitespace-nowrap text-right tabular-nums text-emerald-700">
                        {d === "in" ? <>{money(r.toAmount, r.toCcy)}{r.extra}</> : <span className="text-slate-300">–</span>}
                      </td>
                      <td className="whitespace-nowrap text-right tabular-nums text-red-700">
                        {d === "out" ? <>{money(r.fromAmount, r.fromCcy)}{r.extra}</> : <span className="text-slate-300">–</span>}
                      </td>
                    </>
                  )}
                  {withBal && <td className="whitespace-nowrap text-right tabular-nums text-slate-700">{bal == null ? "-" : money(bal)}</td>}
                  {showActions && <td className="pl-2 text-right">{r.actions}</td>}
                </tr>
              );
            })}
          </tbody>
          {shown.length > 0 && totals.size > 0 && (
            <tfoot className="border-t border-slate-200 text-sm">
              {[...totals.entries()].map(([ccy, t]) => (
                <tr key={ccy}>
                  <td colSpan={4} className="py-2 font-medium">
                    รวม{acct ? "" : " (ไม่นับโอนระหว่างบัญชีตัวเอง)"}{totals.size > 1 ? ` · ${ccy}` : ""}
                    <span className={`ml-3 font-semibold ${t.inn - t.out >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      สุทธิ {t.inn - t.out >= 0 ? "+" : "−"}{money(Math.abs(t.inn - t.out), ccy)}</span>
                  </td>
                  <td className="whitespace-nowrap text-right font-medium tabular-nums text-emerald-700">{money(t.inn, ccy)}</td>
                  <td className="whitespace-nowrap text-right font-medium tabular-nums text-red-700">{money(t.out, ccy)}</td>
                  <td colSpan={cols - 6}></td>
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
