"use client";

import { useState, type ReactNode } from "react";
import { money } from "@/lib/format";
import { useOnMainTab } from "./tabs";
import DateSortHead from "@/components/DateSortHead";

/**
 * ตารางรายได้ / ค่าใช้จ่ายของเดือน (รวม "ที่ต้องได้รับ / จ่าย" + "บันทึกแล้ว" เป็นตารางเดียว)
 *   OPEN      = รายการที่คาดไว้ ยังค้าง (รอ / เลยกำหนด / ได้บางส่วน)
 *   DISMISSED = รายการที่คาดไว้ "เดือนนี้ไม่ได้รับ / จ่าย"
 *   DONE      = รายการที่บันทึกแล้ว (รายการที่คาดไว้ซึ่งรับ / จ่ายครบแล้ว ไม่แสดงซ้ำ — นับจากรายการที่บันทึก)
 *   กล่องสรุป 3 กล่อง = ตัวกรองสถานะ (เปิดหน้า = "ยังไม่ได้บันทึก") · ปุ่มกลม = ตัวกรองที่มา · "จ่ายด้วย" (ค่าใช้จ่าย)
 *   ช่องสถานะ = ปุ่มคำสั่งของแถว (บันทึกรับ / จ่าย · แก้ไข · แยกรายละเอียด · เงินคืน) หรือป้ายสถานะ (แก้ที่หน้านี้ไม่ได้)
 */
export type MonthRow = {
  key: string; date: string; source: string; status: "OPEN" | "DONE" | "DISMISSED"; split?: boolean;
  currency: string; expected: number | null; done: number | null;
  /** ยอดเป็นบาท: ได้รับ / จ่ายแล้ว (DONE) · ยอดที่ยังค้าง (OPEN) */
  thbDone: number; thbLeft: number;
  /** จ่ายด้วย: bank:<id> · card:<id> · cash · (ว่าง = รายการที่คาดไว้) */
  pay?: string;
  /** เลยกำหนด → ตัวแดงใต้วันที่ */
  late?: boolean;
  item: ReactNode; account: ReactNode;
  /** ช่องสถานะ: ปุ่มคำสั่ง หรือป้ายสถานะ */
  action: ReactNode;
};
type Opt = { id: string; label: string };
const SPLIT = "รอแยกรายละเอียด";

export default function MonthTable({ kind, rows, empty, banks = [], cards = [], actions, initialSource = "" }: {
  kind: "income" | "expense"; rows: MonthRow[]; empty: string;
  /** "split" = เปิดตัวกรอง "รอแยกรายละเอียด" ไว้ก่อน (ลิงก์จากหน้าอื่น) */
  initialSource?: string;
  /** ค่าใช้จ่าย: ตัวเลือก "จ่ายด้วย" */
  banks?: Opt[]; cards?: Opt[];
  /** ปุ่มมุมขวาบน (บันทึกรายได้ / ค่าใช้จ่าย) */
  actions?: ReactNode;
}) {
  const inc = kind === "income";
  const split0 = initialSource === "split";
  const [status, setStatus] = useState<"" | "DONE" | "OPEN">(split0 ? "" : "OPEN");
  const [source, setSource] = useState(split0 ? SPLIT : "");
  const [pay, setPay] = useState("");
  const [asc, setAsc] = useState(true);
  useOnMainTab(() => { setStatus("OPEN"); setSource(""); setPay(""); });

  const payOk = (r: MonthRow) => !pay || (!!r.pay && (pay === "bank" || pay === "card" ? r.pay.startsWith(`${pay}:`) : r.pay === pay));
  const srcOk = (r: MonthRow) => !source || (source === SPLIT ? !!r.split : r.source === source);
  const stOk = (r: MonthRow) => !status || r.status === status;
  const base = rows.filter((r) => payOk(r) && srcOk(r));                   // กล่องสรุปตามตัวกรองที่มา / จ่ายด้วย
  const shown = base.filter(stOk).sort((a, b) =>
    (a.status === "OPEN" ? 0 : 1) - (b.status === "OPEN" ? 0 : 1) || (asc ? 1 : -1) * a.date.localeCompare(b.date));
  const sum = (xs: MonthRow[], k: "thbDone" | "thbLeft") => xs.reduce((t, r) => t + r[k], 0);
  const doneThb = sum(base.filter((r) => r.status === "DONE"), "thbDone");
  const leftThb = sum(base.filter((r) => r.status === "OPEN"), "thbLeft");
  const nOpen = base.filter((r) => r.status === "OPEN").length;

  const sources = [...new Set(rows.map((r) => r.source))];
  const nSplit = rows.filter((r) => r.split).length;
  // ก้อนรอแยกเป็นรายการที่บันทึกแล้วเสมอ → นับโดยไม่สนตัวกรองสถานะ
  const cnt = (s: string) => rows.filter((r) => payOk(r) && (s === SPLIT ? r.split : stOk(r) && (!s || r.source === s))).length;
  const allDone = !rows.some((r) => r.status === "OPEN");                  // เดือนนี้ไม่มีรายการค้างเลย
  const pickSource = (s: string) => { const v = source === s ? "" : s; setSource(v); if (v === SPLIT) setStatus(""); };
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
  const box = (on: boolean) => `rounded-xl border p-4 text-left transition num-box ${on ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-500" : "border-slate-200 bg-white hover:border-blue-300"}`;
  const payKind = pay.startsWith("card") ? "card" : pay.startsWith("bank") ? "bank" : pay;
  const payPick = pay.includes(":") ? pay.split(":")[1] : "";
  const second = payKind === "bank" ? { label: "บัญชี", all: "ทุกบัญชี", list: banks } : payKind === "card" ? { label: "บัตร", all: "ทุกใบ", list: cards } : null;
  const sel = "ml-1 rounded-md border border-slate-300 px-2 py-1 text-xs";

  // แถวรวมท้ายตาราง (ตามตัวกรอง) แยกสกุล
  const tot = new Map<string, { exp: number; done: number }>();
  for (const r of shown) {
    const t = tot.get(r.currency) ?? { exp: 0, done: 0 };
    // คาดไว้ = เฉพาะรายการที่ยังค้าง · ได้รับ / จ่ายแล้ว = เฉพาะรายการที่บันทึก (ยอดรับบางส่วนของรายการค้างนับอยู่ในรายการที่บันทึกแล้ว)
    t.exp += r.status === "OPEN" ? Number(r.expected ?? 0) : 0; t.done += r.status === "DONE" ? Number(r.done ?? 0) : 0;
    tot.set(r.currency, t);
  }

  return (
    <div className="space-y-4">
      {/* กล่องสรุป = ตัวกรองสถานะ: ยังไม่ได้บันทึก (ค่าเริ่มต้น) · ได้รับ / จ่ายแล้ว · ยอดรวมทั้งเดือน */}
      <div className="grid gap-3 sm:grid-cols-3">
        <button type="button" onClick={() => setStatus("OPEN")} className={box(status === "OPEN")}>
          <div className="text-xs text-slate-500">ยังไม่ได้บันทึก</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${leftThb > 0.005 ? "text-amber-700" : ""}`}>{money(leftThb, "THB")}</div>
          <div className="mt-1 text-xs text-slate-500">{nOpen} รายการ{inc ? "ที่ต้องได้รับ" : "ที่ต้องจ่าย"}</div>
        </button>
        <button type="button" onClick={() => setStatus("DONE")} className={box(status === "DONE")}>
          <div className="text-xs text-slate-500">{inc ? "ได้รับแล้ว (หลังภาษี)" : "จ่ายแล้ว"}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">{money(doneThb, "THB")}</div>
          <div className="mt-1 text-xs text-slate-500">{base.filter((r) => r.status === "DONE").length} รายการ</div>
        </button>
        <button type="button" onClick={() => setStatus("")} className={box(status === "")}>
          <div className="text-xs text-slate-500">ยอดรวมทั้งเดือน</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{money(doneThb + leftThb, "THB")}</div>
          <div className="mt-1 text-xs text-slate-500">{inc ? "ได้รับแล้ว + ยังไม่ได้บันทึก" : "จ่ายแล้ว + ยังไม่ได้บันทึก"}</div>
        </button>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => pickSource("")} className={chip(!source)}>ทั้งหมด ({cnt("")})</button>
            {sources.map((s) => (
              <button key={s} type="button" onClick={() => pickSource(s)} className={chip(source === s)}>{s} ({cnt(s)})</button>
            ))}
            {nSplit > 0 && <button type="button" onClick={() => pickSource(SPLIT)}
              className={`${chip(source === SPLIT)} ${source === SPLIT ? "" : "border-amber-300 text-amber-800"}`}>{SPLIT} ({cnt(SPLIT)})</button>}
          </div>
          {actions && <div className="flex flex-wrap items-start gap-2">{actions}</div>}
        </div>
        {!inc && (banks.length > 0 || cards.length > 0) && (
          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <label>จ่ายด้วย
              <select value={payKind} onChange={(e) => setPay(e.target.value)} className={sel}>
                <option value="">ทั้งหมด</option>
                {banks.length > 0 && <option value="bank">บัญชีธนาคาร</option>}
                {cards.length > 0 && <option value="card">บัตรเครดิต</option>}
                <option value="cash">เงินสด / อื่น ๆ</option>
              </select>
            </label>
            {second && second.list.length > 0 && (
              <label>{second.label}
                <select value={payPick} onChange={(e) => setPay(e.target.value ? `${payKind}:${e.target.value}` : payKind)} className={sel}>
                  <option value="">{second.all}</option>
                  {second.list.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
            )}
            {pay && <span className="text-slate-400">(ซ่อนรายการที่ยังไม่ได้จ่าย)</span>}
          </div>
        )}
        {status === "OPEN" && allDone && rows.length > 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-6 text-center">
            <div className="font-medium text-emerald-800">✓ เดือนนี้บันทึกครบแล้ว</div>
            <div className="mt-1 text-sm text-emerald-700">ไม่มีรายการ{inc ? "ที่ต้องได้รับ" : "ที่ต้องจ่าย"}ค้างอยู่</div>
            <div className="mt-1 text-xs text-slate-600">ดูหรือแก้ไขรายการที่บันทึกแล้ว กดกล่อง &ldquo;{inc ? "ได้รับแล้ว" : "จ่ายแล้ว"}&rdquo; หรือ &ldquo;ยอดรวมทั้งเดือน&rdquo; ด้านบน</div>
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="py-1.5 pr-2"><DateSortHead asc={asc} onToggle={() => setAsc(!asc)} label="วันที่" /></th>
                <th className="px-2">รายการ</th><th className="px-2">{inc ? "เข้าบัญชี" : "จ่ายจาก"}</th>
                <th className="px-2 text-right">คาดไว้</th><th className="px-2 text-right">{inc ? "ได้รับ" : "จ่ายแล้ว"}</th>
                <th className="px-2">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">{rows.length ? "ไม่มีรายการตามตัวกรอง" : empty}</td></tr>}
              {shown.map((r) => (
                <tr key={r.key} data-row={r.key} className={`align-top ${r.status === "DISMISSED" ? "text-slate-400" : ""}`}>
                  <td className="whitespace-nowrap py-2 pr-2">{r.date ? `${r.date.slice(8, 10)}/${r.date.slice(5, 7)}/${Number(r.date.slice(0, 4)) + 543}` : ""}
                    {r.late && <div className="text-xs font-medium text-red-600">เลยกำหนด</div>}</td>
                  <td className="px-2 py-2">{r.item}</td>
                  <td className="px-2 py-2 text-xs text-slate-600">{r.account}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-600">{r.expected != null ? money(r.expected, r.currency) : ""}</td>
                  <td className={`whitespace-nowrap px-2 py-2 text-right tabular-nums ${r.status === "DONE" ? "font-medium" : "text-emerald-700"}`}>
                    {r.done != null && (r.status === "DONE" || r.done > 0) ? money(r.done, r.currency) : ""}</td>
                  <td className="px-2 py-2"><div className="flex flex-wrap items-center gap-1.5">{r.action}</div></td>
                </tr>
              ))}
            </tbody>
            {shown.length > 0 && (
              <tfoot className="border-t-2 border-slate-200 font-medium">
                {[...tot.entries()].map(([ccy, t], i) => (
                  <tr key={ccy}>
                    <td colSpan={3} className="py-2">{i === 0 ? <>รวม{status || source || pay ? "ตามตัวกรอง" : "ทั้งเดือน"} {shown.length} รายการ</> : ""}
                      {tot.size > 1 && <span className="ml-1 text-xs font-normal text-slate-500">({ccy})</span>}</td>
                    <td className="whitespace-nowrap px-2 text-right tabular-nums text-slate-600">{t.exp ? money(t.exp, ccy) : ""}</td>
                    <td className="whitespace-nowrap px-2 text-right tabular-nums">{status === "OPEN" ? "" : money(t.done, ccy)}</td>
                    <td></td>
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
        </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          รายการค้างอยู่บนสุด · กดชื่อรายการเพื่อไปหน้าต้นทาง · บันทึก / แก้ไข (ลบอยู่ในหน้าต่างแก้ไข) / แยกรายละเอียด ที่ปุ่มในช่องสถานะ
          {inc ? " · ยอดได้รับ = สุทธิหลังภาษี" : ""} · รายการที่คาดไว้ซึ่ง{inc ? "รับ" : "จ่าย"}ครบแล้ว แสดงเป็นรายการที่บันทึกแล้วแถวเดียว
        </p>
      </section>
    </div>
  );
}
