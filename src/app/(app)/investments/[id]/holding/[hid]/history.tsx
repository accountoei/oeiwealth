"use client";

import { Fragment, useState, type ReactNode } from "react";

// หน้าหลักทรัพย์ 2 กล่อง แบบเดียวกันทุกประเภท (ตกลง 13 พ.ย. 2026):
//   1) PriceHistory "ราคา / มูลค่า" (อยู่บน): ล่าสุดก่อน · เดือนละบรรทัด · 12 เดือนล่าสุด ที่เหลือกด "ดูทั้งหมด"
//      ราคาตลาดอัตโนมัติ (ขึ้นทุกวันทำการ) แสดงเฉพาะราคาล่าสุดของเดือน · ติ๊กเพื่อแสดงรายวัน
//   2) HoldingHistory "รายการ" / "ตารางรับและรายการ": รายการซื้อ / ขาย / ปันผล ฯลฯ
//      หุ้นกู้ / FCN (แบบตารางผ่อนเงินกู้): งวดตามตารางรับอยู่ในตารางเดียวกัน · ตัวกรอง ยังไม่รับ / รับแล้ว / ทั้งหมด
/** open: งวดตามตาราง (true = ยังไม่รับ · false = รับแล้ว) · ไม่ใส่ = รายการ */
export type HistoryRow = { key: string; row: ReactNode; open?: boolean };
/** month: "YYYY-MM" · daily: ราคาอัตโนมัติที่ไม่ใช่ราคาล่าสุดของเดือน (ซ่อนไว้ก่อน) */
export type PriceRow = { key: string; month: string; daily: boolean; row: ReactNode };

const MONTHS = 12;

export function PriceHistory({ rows, head, info, tools, pinned }: { rows: PriceRow[]; head: ReactNode; info?: ReactNode;
  /** ปุ่มมุมขวาของหัวกล่อง (อัปเดตราคา / Statement) */ tools?: ReactNode;
  /** แถวบนสุดเสมอ: ยอดตั้งต้น (ต้นทุน) · ตกลง 14 พ.ย. 2026 */ pinned?: ReactNode }) {
  const [daily, setDaily] = useState(false);
  const [all, setAll] = useState(false);
  const dailyCount = rows.filter((r) => r.daily).length;
  const visible = rows.filter((r) => daily || !r.daily);
  const months = [...new Set(visible.map((r) => r.month))];
  const recent = new Set(months.slice(0, MONTHS));
  const shown = all ? visible : visible.filter((r) => recent.has(r.month));
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium text-slate-900">ราคา / มูลค่า {info}</h2>
        <div className="flex flex-wrap items-center gap-3">
          {dailyCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} />
              แสดงราคารายวัน ({dailyCount})
            </label>
          )}
          {tools}
        </div>
      </div>
      {shown.length === 0 && !pinned ? <p className="text-sm text-slate-500">ยังไม่มีราคา / มูลค่า</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            {head}
            <tbody className="divide-y divide-slate-100">{pinned}{shown.map((r) => <Fragment key={r.key}>{r.row}</Fragment>)}</tbody>
          </table>
        </div>
      )}
      {months.length > MONTHS && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-xs text-blue-700 hover:underline">
          {all ? "ย่อ ▴" : `ดูทั้งหมด (${months.length} เดือน) ▾`}</button>
      )}
    </section>
  );
}

export default function HoldingHistory({ rows, head, title, info, foot, tools }: {
  rows: HistoryRow[]; head: ReactNode; title: string; info?: ReactNode; foot?: ReactNode;
  /** ปุ่มมุมขวาของหัวกล่อง (ตั้ง / แก้ตารางรับ) */
  tools?: ReactNode;
}) {
  const lines = rows.filter((r) => r.open !== undefined);
  const openCount = lines.filter((r) => r.open).length;
  const [f, setF] = useState<"open" | "done" | "all">("all");
  const shown = rows.filter((r) => f === "all" || (f === "open") === !!r.open);
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium text-slate-900">{title} {info}</h2>
        {tools}
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
