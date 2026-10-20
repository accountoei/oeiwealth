"use client";

import { useState, type ReactNode } from "react";
import { money, thDate } from "@/lib/format";

/** แถวตารางผ่อน (คำนวณสถานะจากยอดที่รับจริงที่ฐานข้อมูล) · action = ปุ่มบันทึกรับ (เฉพาะงวดเก่าสุดที่ยังค้าง) */
export type SchedRow = {
  id: string; no: number; due: string; principal: number; interest: number; total: number; remaining: number;
  /** เงินต้นคงเหลือตามแผน หลังงวดนี้ (เงินต้นรวมตามตาราง − เงินต้นสะสมถึงงวดนี้) */
  balance: number;
  status: string; statusText: string; statusCls: string; notes: string | null;
  /** งวดที่รับครบแล้ว: วันที่รับครบ (null = ก่อนเริ่มใช้ระบบ) */
  paidOn?: string | null;
  action?: ReactNode;
};

/** ตารางผ่อนชำระ ยาวจนจบ · ตัวกรอง ยังไม่ชำระ (ค่าเริ่มต้น) / ชำระแล้ว / ทั้งหมด */
export default function ScheduleTable({ rows, currency }: { rows: SchedRow[]; currency: string }) {
  const unpaid = rows.filter((r) => r.status !== "PAID");
  const [f, setF] = useState<"open" | "paid" | "all">(unpaid.length ? "open" : "all");
  const shown = f === "open" ? unpaid : f === "paid" ? rows.filter((r) => r.status === "PAID") : rows;
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
  const sum = (k: "principal" | "interest" | "total" | "remaining") => shown.reduce((t, r) => t + r[k], 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setF("open")} className={chip(f === "open")}>ยังไม่ชำระ ({unpaid.length})</button>
        <button type="button" onClick={() => setF("paid")} className={chip(f === "paid")}>ชำระแล้ว ({rows.length - unpaid.length})</button>
        <button type="button" onClick={() => setF("all")} className={chip(f === "all")}>ทั้งหมด ({rows.length})</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100"><th className="py-1.5">งวด</th><th>ครบกำหนด</th><th className="text-right">เงินต้น</th><th className="text-right">ดอกเบี้ย</th>
              <th className="text-right">รวม</th><th className="text-right" title="เงินต้นคงเหลือตามแผน หลังงวดนั้น">ยอดคงเหลือ</th><th className="pl-4">สถานะ</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-slate-500">{f === "open" ? "รับครบทุกงวดแล้ว ✓" : "ไม่มีรายการ"}</td></tr>}
            {shown.map((x) => (
              <tr key={x.id} className={`align-top ${x.status === "PAID" ? "text-slate-500" : ""}`}>
                <td className="py-2">{x.no}</td>
                <td className="whitespace-nowrap py-2">{thDate(x.due)}{x.notes && <div className="text-xs text-slate-400">{x.notes}</div>}</td>
                <td className="py-2 text-right tabular-nums">{money(x.principal)}</td>
                <td className="py-2 text-right tabular-nums">{money(x.interest)}</td>
                <td className="py-2 text-right tabular-nums">{money(x.total)}</td>
                <td className="py-2 text-right tabular-nums text-slate-600">{money(x.balance)}</td>
                <td className="py-2 pl-4">
                  <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${x.statusCls}`}>{x.statusText}</span>
                  {x.status === "PAID" && <div className="text-xs text-slate-500">{x.paidOn ? `รับครบ ${thDate(x.paidOn)}` : "รับก่อนเริ่มใช้ระบบ"} · {money(x.total)}</div>}
                  {x.status !== "PAID" && x.remaining < x.total - 0.005 && <div className="text-xs text-slate-500">รับแล้ว {money(x.total - x.remaining)} · ค้าง {money(x.remaining)}</div>}
                </td>
                <td className="py-2 pl-2 text-right">{x.action}</td>
              </tr>
            ))}
          </tbody>
          {shown.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 font-medium">
              <tr><td colSpan={2} className="py-2">รวม {shown.length} งวด</td>
                <td className="text-right tabular-nums">{money(sum("principal"))}</td><td className="text-right tabular-nums">{money(sum("interest"))}</td>
                <td className="text-right tabular-nums">{money(sum("total"), currency)}</td><td></td>
                <td className="pl-4 text-xs font-normal text-slate-500">{f !== "paid" && sum("remaining") > 0.005 ? `ค้าง ${money(sum("remaining"))}` : ""}</td><td></td></tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
