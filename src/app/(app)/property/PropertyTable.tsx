"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useOnMainTab } from "../income-expenses/tabs";
import { money, thDate } from "@/lib/format";

export type PropRow = {
  id: string; assetId: string; name: string; sub: string; loc: string | null; type: string; typeLabel: string; usage: string; usageLabel: string;
  status: string; cost: number | null; costDate: string | null; value: number | null; valueDate: string | null; stale: boolean;
  rent: number; ytd: number; leases: { id: string; badge: string; cls: string; text: string }[]; noLease: boolean; move?: ReactNode;
  /** ว่างมาแล้วกี่เดือน (เฉพาะที่ว่างและใส่วันเริ่มว่าง) · เตือนเรื่องภาษีที่ดิน */ vacant?: { text: string; warn: boolean } | null;
};

const STATUS: Record<string, string> = { ACTIVE: "ถืออยู่", SOLD: "ขายแล้ว", GIFTED: "ยกให้แล้ว", LOST: "สูญหาย", CLOSED: "ปิดแล้ว" };
const small = "ml-2 rounded-md border border-slate-300 px-2 py-1 text-sm";

/** ทรัพย์สินทั้งหมด + ตัวกรอง ประเภท / การใช้งาน / กลุ่มทำเล / สถานะ (ตั้งต้น = ถืออยู่) · ยอดรวมตามตัวกรองด้านบน */
export default function PropertyTable({ rows, empty, toggle }: { rows: PropRow[]; empty: string; toggle?: ReactNode }) {
  const [type, setType] = useState("");
  const [usage, setUsage] = useState("");
  const [loc, setLoc] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  useOnMainTab(() => { setType(""); setUsage(""); setLoc(""); setStatus("ACTIVE"); });
  const types = useMemo(() => [...new Map(rows.map((r) => [r.type, r.typeLabel]))], [rows]);
  const usages = useMemo(() => [...new Map(rows.map((r) => [r.usage, r.usageLabel]))], [rows]);
  const locs = useMemo(() => [...new Set(rows.map((r) => r.loc ?? ""))].sort((a, b) => (a ? a.localeCompare(b, "th") : 1)), [rows]);
  const statuses = useMemo(() => [...new Set(["ACTIVE", ...rows.map((r) => r.status)])], [rows]);
  const shown = rows.filter((r) => (!type || r.type === type) && (!usage || r.usage === usage)
    && (!loc || (loc === "__none" ? !r.loc : r.loc === loc)) && (!status || r.status === status));
  const sum = (f: (r: PropRow) => number | null) => shown.reduce((t, r) => t + (f(r) ?? 0), 0);
  const filtered = !!(type || usage || loc || status !== "ACTIVE");
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-4 px-4 pt-4 text-xs text-slate-600">
        <label>ประเภท
          <select value={type} onChange={(e) => setType(e.target.value)} className={small}>
            <option value="">ทั้งหมด</option>{types.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>การใช้งาน
          <select value={usage} onChange={(e) => setUsage(e.target.value)} className={small}>
            <option value="">ทั้งหมด</option>{usages.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {locs.length > 1 && (
          <label>กลุ่มทำเล
            <select value={loc} onChange={(e) => setLoc(e.target.value)} className={small}>
              <option value="">ทั้งหมด</option>
              {locs.map((g) => <option key={g || "__none"} value={g || "__none"}>{g || "(ไม่ระบุ)"}</option>)}
            </select>
          </label>
        )}
        <label>สถานะ
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={small}>
            <option value="">ทั้งหมด</option>{statuses.map((s) => <option key={s} value={s}>{STATUS[s] ?? s}</option>)}
          </select>
        </label>
        {shown.length > 0 && (
          <span className="ml-auto text-right text-sm text-slate-700">
            รวม{filtered ? "ตามตัวกรอง" : ""} {shown.length} รายการ · มูลค่าล่าสุด <b className="tabular-nums">{money(sum((r) => r.value), "THB")}</b>
          </span>
        )}
        {toggle && <span className={shown.length > 0 ? "" : "ml-auto"}>{toggle}</span>}
      </div>
      <table className="mt-3 w-full min-w-[56rem] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr><th className="px-3 py-2">ทรัพย์สิน</th><th className="px-3">ประเภท</th><th className="px-3">การใช้งาน</th>
            <th className="px-3 text-right">มูลค่าที่ซื้อ (THB)</th><th className="px-3 text-right">มูลค่าล่าสุด (THB)</th>
            <th className="px-3 text-right">รายได้ค่าเช่า (THB)</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">{rows.length ? "ไม่มีทรัพย์สินตามตัวกรอง" : empty}</td></tr>}
          {shown.map((p) => (
            <tr key={p.id} className={`align-top hover:bg-slate-50 ${p.status !== "ACTIVE" ? "opacity-50" : ""}`}>
              <td className="px-3 py-3">
                {p.move && <span className="mr-2 align-middle">{p.move}</span>}
                <Link href={`/property/${p.assetId}`} className="font-medium text-slate-900 hover:underline">{p.name}</Link>
                {p.sub && <div className="text-xs text-slate-500">{p.sub}</div>}
              </td>
              <td className="px-3 py-3">{p.typeLabel}</td>
              <td className="px-3 py-3">{p.usageLabel}
                {p.vacant && <div className={`text-xs ${p.vacant.warn ? "font-medium text-amber-700" : "text-slate-500"}`}>{p.vacant.text}</div>}</td>
              <td className="px-3 py-3 text-right tabular-nums">{money(p.cost)}
                {p.costDate && <div className="text-xs text-slate-400">ซื้อ {thDate(p.costDate)}</div>}</td>
              <td className="px-3 py-3 text-right font-medium tabular-nums">{money(p.value)}
                <div className={`text-xs font-normal ${p.stale ? "text-amber-700" : "text-slate-400"}`}>ณ {thDate(p.valueDate)}{p.stale && " · เกิน 90 วัน"}</div></td>
              <td className="px-3 py-3 text-right tabular-nums">
                {p.rent > 0 || p.ytd > 0 ? <>
                  <div>{money(p.rent)}<span className="text-xs text-slate-400"> /เดือน</span></div>
                  <div className="text-xs text-slate-500">รับจริงปีนี้ {money(p.ytd)}</div>
                </> : <span className="text-slate-400">-</span>}
                {p.leases.map((l) => (
                  <div key={l.id} className="mt-1 text-xs text-slate-500">
                    <span className={`mr-1 rounded px-1.5 py-0.5 ${l.cls}`}>{l.badge}</span>{l.text}
                  </div>
                ))}
                {p.noLease && <div className="mt-1 text-xs text-amber-700">ไม่มีสัญญาที่มีผล</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
