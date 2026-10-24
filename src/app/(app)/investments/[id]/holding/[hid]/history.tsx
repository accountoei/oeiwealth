"use client";

import { Fragment, useState, type ReactNode } from "react";

// กล่อง "รายการและราคา" (หน้าหลักทรัพย์): รายการซื้อ / ขาย / ปันผล ฯลฯ + ประวัติราคา / มูลค่า ในตารางเดียว เรียงตามวันที่
//   ราคาตลาดอัตโนมัติ (ขึ้นทุกวันทำการ) ซ่อนไว้ก่อน · ติ๊กเพื่อแสดง
export type HistoryRow = { key: string; auto: boolean; row: ReactNode };

export default function HoldingHistory({ rows, head }: { rows: HistoryRow[]; head: ReactNode }) {
  const [showAuto, setShowAuto] = useState(false);
  const autoCount = rows.filter((r) => r.auto).length;
  const shown = showAuto ? rows : rows.filter((r) => !r.auto);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium text-slate-900">รายการและราคา / มูลค่า</h2>
        {autoCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showAuto} onChange={(e) => setShowAuto(e.target.checked)} />
            แสดงราคาอัตโนมัติรายวัน ({autoCount})
          </label>
        )}
      </div>
      {shown.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            {head}
            <tbody className="divide-y divide-slate-100">{shown.map((r) => <Fragment key={r.key}>{r.row}</Fragment>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
