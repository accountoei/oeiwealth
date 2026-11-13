"use client";

import { Fragment, useState, type ReactNode } from "react";

// กล่อง "รายการและราคา" (หน้าหลักทรัพย์): รายการซื้อ / ขาย / ปันผล ฯลฯ + ประวัติราคา / มูลค่า ในตารางเดียว เรียงตามวันที่
//   ราคาตลาดอัตโนมัติ (ขึ้นทุกวันทำการ) ซ่อนไว้ก่อน · ติ๊กเพื่อแสดง
//   หุ้นกู้ / FCN (ตกลง 13 พ.ย. 2026 · แบบตารางผ่อนเงินกู้): งวดตามตารางรับอยู่ในตารางเดียวกัน · ตัวกรอง ยังไม่รับ / รับแล้ว / ทั้งหมด
/** open: งวดตามตาราง (true = ยังไม่รับ · false = รับแล้ว) · ไม่ใส่ = รายการ / ราคา */
export type HistoryRow = { key: string; auto: boolean; row: ReactNode; open?: boolean };

export default function HoldingHistory({ rows, head, title, info, foot, tools }: {
  rows: HistoryRow[]; head: ReactNode; title: string; info?: ReactNode; foot?: ReactNode;
  /** ปุ่มมุมขวาของหัวกล่อง (ตั้ง / แก้ตารางรับ) */
  tools?: ReactNode;
}) {
  const [showAuto, setShowAuto] = useState(false);
  const lines = rows.filter((r) => r.open !== undefined);
  const openCount = lines.filter((r) => r.open).length;
  const [f, setF] = useState<"open" | "done" | "all">("all");
  const autoCount = rows.filter((r) => r.auto).length;
  const shown = rows.filter((r) => (showAuto || !r.auto) && (f === "all" || (f === "open") === !!r.open));
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium text-slate-900">{title} {info}</h2>
        <div className="flex flex-wrap items-center gap-3">
          {autoCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showAuto} onChange={(e) => setShowAuto(e.target.checked)} />
              แสดงราคาอัตโนมัติรายวัน ({autoCount})
            </label>
          )}
          {tools}
        </div>
      </div>
      {lines.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setF("open")} className={chip(f === "open")}>ยังไม่รับ ({openCount})</button>
          <button type="button" onClick={() => setF("done")} className={chip(f === "done")}>รับแล้ว ({lines.length - openCount})</button>
          <button type="button" onClick={() => setF("all")} className={chip(f === "all")}>ทั้งหมด</button>
        </div>
      )}
      {shown.length === 0 ? <p className="text-sm text-slate-500">{f === "open" ? "รับครบทุกงวดแล้ว ✓" : "ยังไม่มีรายการ"}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            {head}
            <tbody className="divide-y divide-slate-100">{shown.map((r) => <Fragment key={r.key}>{r.row}</Fragment>)}</tbody>
            {f !== "open" && foot}
          </table>
        </div>
      )}
    </section>
  );
}
