"use client";

import Link from "next/link";
import { useState } from "react";
import { FREQ_LABEL, PROPERTY_TYPE_LABEL, money } from "@/lib/format";
import { useOnMainTab } from "./tabs";

/** แถวค่าใช้จ่ายประจำของทรัพย์สิน (ดูอย่างเดียว · แก้ที่หน้าทรัพย์สิน) */
export type PropCostRow = {
  id: string; assetId: string; assetName: string; ptype: string; item: string;
  amount: number; currency: string; freq: string; schedule: string; perYear: number;
  /** บรรทัดเล็กใต้รายการ (เช่น หมดสัญญา) · warn = สีส้ม */
  note?: string; warn?: boolean;
};

/** ตารางค่าใช้จ่ายประจำ / ค่าเช่าของทรัพย์สิน (ดูอย่างเดียว) + ตัวกรองประเภททรัพย์สิน / ความถี่ */
export default function PropertyCostTable({ rows, itemHead = "รายการ", freqLabel = "ความถี่ในการจ่าย", whenHead = "จ่ายเมื่อ" }: {
  rows: PropCostRow[]; itemHead?: string; freqLabel?: string; whenHead?: string;
}) {
  const [pt, setPt] = useState("");
  const [fq, setFq] = useState("");
  useOnMainTab(() => { setPt(""); setFq(""); });
  if (rows.length === 0) return <p className="text-sm text-slate-500">ยังไม่มี</p>;

  const types = [...new Set(rows.map((r) => r.ptype))];
  const freqs = ["MONTHLY", "QUARTERLY", "YEARLY", "OTHER"].filter((f) => rows.some((r) => r.freq === f));
  const shown = rows.filter((r) => (!pt || r.ptype === pt) && (!fq || r.freq === fq));
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
  const nT = (t: string) => rows.filter((r) => (!t || r.ptype === t) && (!fq || r.freq === fq)).length;
  const nF = (f: string) => rows.filter((r) => (!pt || r.ptype === pt) && (!f || r.freq === f)).length;
  const year = new Map<string, number>();
  shown.forEach((r) => year.set(r.currency, (year.get(r.currency) ?? 0) + r.perYear));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-24 text-xs text-slate-500">ประเภททรัพย์สิน</span>
        <button type="button" onClick={() => setPt("")} className={chip(!pt)}>ทั้งหมด ({nT("")})</button>
        {types.map((t) => (
          <button key={t} type="button" onClick={() => setPt(pt === t ? "" : t)} className={chip(pt === t)}>{PROPERTY_TYPE_LABEL[t] ?? t} ({nT(t)})</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-24 text-xs text-slate-500">{freqLabel}</span>
        <button type="button" onClick={() => setFq("")} className={chip(!fq)}>ทั้งหมด ({nF("")})</button>
        {freqs.map((f) => (
          <button key={f} type="button" onClick={() => setFq(fq === f ? "" : f)} className={chip(fq === f)}>{FREQ_LABEL[f] ?? f} ({nF(f)})</button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100"><th className="py-1.5 pr-2">ทรัพย์สิน</th><th className="px-2">{itemHead}</th>
              <th className="px-2 text-right">ยอดปกติ</th><th className="px-2">{whenHead}</th><th className="px-2 text-right">ต่อปี (ประมาณ)</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-slate-500">ไม่มีรายการตามตัวกรอง</td></tr>}
            {shown.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="py-2 pr-2">
                  <Link href={`/property/${r.assetId}`} title="ไปแก้ที่หน้าทรัพย์สิน" className="underline decoration-slate-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-400">{r.assetName}</Link>
                  <div className="text-xs text-slate-500">{PROPERTY_TYPE_LABEL[r.ptype] ?? r.ptype}</div>
                </td>
                <td className="px-2 py-2">{r.item}
                  {r.note && <div className={`text-xs ${r.warn ? "text-amber-700" : "text-slate-500"}`}>{r.note}</div>}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{money(r.amount, r.currency)}</td>
                <td className="px-2 py-2">{r.schedule}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-500">{money(r.perYear, r.currency === "THB" ? undefined : r.currency, 0)}</td>
                <td className="py-2 pl-2 text-right"><Link href={`/property/${r.assetId}`} className="whitespace-nowrap text-xs text-blue-700 hover:underline">แก้ที่หน้าทรัพย์สิน ›</Link></td>
              </tr>
            ))}
          </tbody>
          {shown.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 font-medium">
              {[...year.entries()].map(([ccy, v], i) => (
                <tr key={ccy}>
                  <td colSpan={4} className="py-2">{i === 0 ? `รวม${pt || fq ? "ตามตัวกรอง" : ""} ${shown.length} รายการ · ประมาณการต่อปี` : ""}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{money(v, ccy, 0)}</td><td></td>
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
