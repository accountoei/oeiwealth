"use client";

import { Fragment, useState, type ReactNode } from "react";

// ตารางเดียวเรียงตามวันที่ (ซื้อ / ขาย + มูลค่า) · มูลค่าอัตโนมัติรายวัน (ราคาทอง) ซ่อนไว้ก่อน · ติ๊กเพื่อแสดง
export type HistoryRow = { key: string; auto: boolean; row: ReactNode };

export default function HistoryRows({ rows, head, title, right, children }: {
  rows: HistoryRow[]; head: ReactNode; /** null = ไม่มีหัว (อยู่ในหน้าต่างที่มีชื่อแล้ว) */ title: ReactNode; right?: ReactNode; /** ระหว่างหัวกล่องกับตาราง (สรุปขาย · ฟอร์มอัปเดตมูลค่า) */ children?: ReactNode;
}) {
  const [showAuto, setShowAuto] = useState(false);
  const autoCount = rows.filter((r) => r.auto).length;
  const shown = showAuto ? rows : rows.filter((r) => !r.auto);
  return (
    <>
      {(title || autoCount > 0 || right) && <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        {title && <h2 className="font-medium text-slate-900">{title}</h2>}
        <div className="flex flex-wrap items-center gap-3">
          {autoCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showAuto} onChange={(e) => setShowAuto(e.target.checked)} />
              แสดงราคาอัตโนมัติรายวัน ({autoCount})
            </label>
          )}
          {right}
        </div>
      </div>}
      {children}
      {shown.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            {head}
            <tbody className="divide-y divide-slate-100">{shown.map((r) => <Fragment key={r.key}>{r.row}</Fragment>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
