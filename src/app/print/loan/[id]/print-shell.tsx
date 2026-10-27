"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

export type PrintSection = { key: string; label: string; on: boolean; node: ReactNode; note?: string };

/** แถบเลือกส่วนที่จะพิมพ์ + ปุ่มพิมพ์ (แถบนี้ไม่ออกในกระดาษ) · แต่ละส่วนขึ้นหน้าใหม่ */
export default function PrintShell({ back, sections, warn }: { back: string; sections: PrintSection[]; warn?: string[] }) {
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(sections.map((s) => [s.key, s.on])));
  const shown = sections.filter((s) => on[s.key]);
  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3 print:hidden">
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Link href={back} className="text-slate-500 hover:underline">← กลับ</Link>
          <span className="font-medium text-slate-900">พิมพ์:</span>
          {sections.map((s) => (
            <label key={s.key} className="inline-flex items-center gap-1.5" title={s.note}>
              <input type="checkbox" checked={!!on[s.key]} onChange={(e) => setOn({ ...on, [s.key]: e.target.checked })} />{s.label}
            </label>
          ))}
          <button type="button" onClick={() => window.print()} disabled={shown.length === 0}
            className="ml-auto rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">พิมพ์ / บันทึกเป็น PDF</button>
        </div>
        {warn && warn.length > 0 && <div className="mx-auto mt-2 max-w-[210mm] space-y-0.5 text-xs text-amber-700">{warn.map((w) => <p key={w}>⚠ {w}</p>)}</div>}
      </div>
      <div className="mx-auto max-w-[210mm] space-y-6 py-6 print:space-y-0 print:py-0">
        {shown.map((s, i) => (
          <section key={s.key} className={`bg-white px-[16mm] py-[14mm] shadow-sm print:p-0 print:shadow-none ${i > 0 ? "print:break-before-page" : ""}`}>{s.node}</section>
        ))}
        {shown.length === 0 && <p className="text-center text-sm text-slate-500">เลือกส่วนที่จะพิมพ์ด้านบน</p>}
      </div>
    </div>
  );
}
