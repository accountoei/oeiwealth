"use client";

import { Fragment, useState, type ReactNode } from "react";
import { money, thDate } from "@/lib/format";

/** แถวตารางผ่อน (คำนวณสถานะจากยอดที่รับจริงที่ฐานข้อมูล) · บันทึกรับใช้ปุ่ม "บันทึกรับชำระ" ด้านบนตาราง (ปุ่มเดียว) */
export type SchedRow = {
  id: string; no: number; due: string; principal: number; interest: number; total: number; remaining: number;
  /** เงินต้นคงเหลือตามแผน หลังงวดนี้ (รวมยอดที่ให้กู้เพิ่มถึงวันนั้น) */
  balance: number;
  status: string; statusText: string; statusCls: string; notes: string | null;
  /** งวดที่รับครบแล้ว: วันที่รับครบ (null = ก่อนเริ่มใช้ระบบ) */
  paidOn?: string | null;
};

/** รายการเงินจริง (รับชำระ / ให้กู้ / ให้กู้เพิ่ม) แสดงแทรกในตารางตามวันที่ (ตกลง 3 พ.ย. 2026 · แทนกล่องประวัติด้านล่าง) */
export type SchedEvent = {
  key: string; date: string; kind: "PAY" | "LEND";
  /** เช่น "รับชำระ" / "ให้กู้เพิ่ม" / "จ่ายเงินกู้ (เริ่มสัญญา)" */
  label: string; bank: string;
  principal: number; interest: number; tax: number;
  /** ให้กู้เพิ่ม (เพิ่มยอดคงเหลือ) · 0 = ไม่ใช่ */
  lent: number;
  /** จ่ายเงินกู้ครั้งแรกของสัญญา (ยอดเงินต้นตามสัญญา ไม่ใช่ให้กู้เพิ่ม) */
  initial?: number;
  /** ยอดคงเหลือหลังให้กู้ (เฉพาะแถวให้กู้) */
  balance?: number | null;
  /** ปุ่มแก้ / ลบ (เฉพาะรายการล่าสุด) */
  actions?: ReactNode;
  /** ลิงก์พิมพ์บันทึกต่อท้ายสัญญา (เฉพาะแถวให้กู้เพิ่ม) */
  print?: string;
};

type Item = { t: "line"; d: string; r: SchedRow } | { t: "event"; d: string; e: SchedEvent };

/** ตารางผ่อนชำระ ยาวจนจบ + รายการเงินจริงแทรกตามวันที่ · ตัวกรอง ยังไม่ชำระ (ค่าเริ่มต้น) / ชำระแล้ว / ทั้งหมด */
export default function ScheduleTable({ rows, events = [], currency }: { rows: SchedRow[]; events?: SchedEvent[]; currency: string }) {
  const unpaid = rows.filter((r) => r.status !== "PAID");
  const [f, setF] = useState<"open" | "paid" | "all">(unpaid.length ? "open" : "all");
  const lines = f === "open" ? unpaid : f === "paid" ? rows.filter((r) => r.status === "PAID") : rows;
  const evs = f === "open" ? [] : events;
  // เรียงตามวันที่ · วันเดียวกัน: งวดก่อน แล้วรายการเงินจริง
  const items: Item[] = [...lines.map((r): Item => ({ t: "line", d: r.due, r })), ...evs.map((e): Item => ({ t: "event", d: e.date, e }))]
    .sort((a, b) => a.d.localeCompare(b.d) || (a.t === b.t ? 0 : a.t === "line" ? -1 : 1));
  const lendCol = events.some((e) => e.lent > 0);
  const cols = lendCol ? 8 : 7;
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
  const sum = (k: "principal" | "interest" | "total" | "remaining") => lines.reduce((t, r) => t + r[k], 0);
  const pays = evs.filter((e) => e.kind === "PAY");
  const esum = (k: "principal" | "interest" | "tax" | "lent") => evs.reduce((t, e) => t + e[k], 0);
  const dash = <span className="text-slate-300">–</span>;
  return (
    <div className="space-y-3">
      {rows.length > 0 && <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setF("open")} className={chip(f === "open")}>ยังไม่ชำระ ({unpaid.length})</button>
        <button type="button" onClick={() => setF("paid")} className={chip(f === "paid")}>ชำระแล้ว ({rows.length - unpaid.length})</button>
        <button type="button" onClick={() => setF("all")} className={chip(f === "all")}>ทั้งหมด ({rows.length})</button>
        {events.length > 0 && f === "open" && <span className="text-xs text-slate-500">รายการรับชำระ / ให้กู้ที่บันทึกแล้ว ดูได้ที่ &ldquo;ชำระแล้ว&rdquo; หรือ &ldquo;ทั้งหมด&rdquo;</span>}
      </div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100"><th className="py-1.5">งวด</th><th>ครบกำหนด / วันที่</th><th className="text-right">คืนเงินต้น</th>
              {lendCol && <th className="text-right">ให้กู้เพิ่ม</th>}
              <th className="text-right">ดอกเบี้ย</th><th className="text-right">รวม</th>
              <th className="text-right" title="เงินต้นคงเหลือตามแผน (รวมยอดที่ให้กู้เพิ่ม)">ยอดคงเหลือ</th><th className="pl-4">สถานะ</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 && <tr><td colSpan={cols} className="py-4 text-center text-slate-500">{f === "open" ? "รับครบทุกงวดแล้ว ✓" : "ไม่มีรายการ"}</td></tr>}
            {items.map((it) => it.t === "line" ? (
              <tr key={it.r.id} className={`align-top ${it.r.status === "PAID" ? "text-slate-500" : ""}`}>
                <td className="py-2">{it.r.no}</td>
                <td className="whitespace-nowrap py-2">{thDate(it.r.due)}{it.r.notes && <div className="text-xs text-slate-400">{it.r.notes}</div>}</td>
                <td className="py-2 text-right tabular-nums">{money(it.r.principal)}</td>
                {lendCol && <td />}
                <td className="py-2 text-right tabular-nums">{money(it.r.interest)}</td>
                <td className="py-2 text-right tabular-nums">{money(it.r.total)}</td>
                <td className="py-2 text-right tabular-nums text-slate-600">{money(it.r.balance)}</td>
                <td className="py-2 pl-4">
                  <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${it.r.statusCls}`}>{it.r.statusText}</span>
                  {it.r.status === "PAID" && <div className="text-xs text-slate-500">{it.r.paidOn ? `รับครบ ${thDate(it.r.paidOn)}` : "รับก่อนเริ่มใช้ระบบ"} · {money(it.r.total)}</div>}
                  {it.r.status !== "PAID" && it.r.remaining < it.r.total - 0.005 && <div className="text-xs text-slate-500">รับแล้ว {money(it.r.total - it.r.remaining)} · ค้าง {money(it.r.remaining)}</div>}
                </td>
              </tr>
            ) : (
              <Fragment key={it.e.key}>
                <tr className={`align-top text-xs ${it.e.kind === "PAY" ? "bg-emerald-50/40" : "bg-blue-50/50"}`}>
                  <td className="py-1.5 pl-1">
                    <span className={`whitespace-nowrap rounded px-1 py-0.5 text-[10px] ${it.e.kind === "PAY" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}`}>
                      {it.e.kind === "PAY" ? "รับ" : "ให้กู้"}</span>
                  </td>
                  <td className="py-1.5">
                    <div className="whitespace-nowrap text-sm text-slate-700">{thDate(it.e.date)}</div>
                    <div className="text-slate-500">{it.e.label}{it.e.bank ? ` · ${it.e.bank}` : ""}</div>
                  </td>
                  <td className="py-1.5 text-right text-sm tabular-nums text-emerald-700">{it.e.principal > 0 ? money(it.e.principal) : it.e.kind === "PAY" ? dash : ""}</td>
                  {lendCol && <td className="py-1.5 text-right text-sm tabular-nums text-blue-700">{it.e.lent > 0 ? money(it.e.lent) : ""}</td>}
                  <td className="py-1.5 text-right text-sm tabular-nums text-emerald-700">{it.e.interest > 0 ? money(it.e.interest) : it.e.kind === "PAY" ? dash : ""}
                    {it.e.tax > 0 && <div className="text-slate-500">หัก ณ ที่จ่าย {money(it.e.tax)}</div>}</td>
                  <td className={`py-1.5 text-right text-sm tabular-nums ${it.e.kind === "PAY" ? "text-emerald-700" : "text-blue-700"}`}>
                    {it.e.kind === "PAY" ? money(it.e.principal + it.e.interest - it.e.tax) : it.e.initial ? money(it.e.initial) : ""}</td>
                  <td className="py-1.5 text-right text-sm tabular-nums text-slate-600">{it.e.balance != null ? money(it.e.balance) : ""}</td>
                  <td className="py-1.5 pl-4">
                    {it.e.print && <a href={it.e.print} target="_blank" className="mb-1 inline-block text-xs text-blue-700 underline">พิมพ์บันทึกให้กู้เพิ่ม</a>}
                    {it.e.actions}</td>
                </tr>
              </Fragment>
            ))}
          </tbody>
          {(lines.length > 0 || pays.length > 0 || esum("lent") > 0) && (
            <tfoot className="border-t-2 border-slate-200 font-medium">
              {lines.length > 0 && <tr><td colSpan={2} className="py-2">รวม {lines.length} งวด</td>
                <td className="text-right tabular-nums">{money(sum("principal"))}</td>{lendCol && <td />}<td className="text-right tabular-nums">{money(sum("interest"))}</td>
                <td className="text-right tabular-nums">{money(sum("total"), currency)}</td><td></td>
                <td className="pl-4 text-xs font-normal text-slate-500">{f !== "paid" && sum("remaining") > 0.005 ? `ค้าง ${money(sum("remaining"))}` : ""}</td></tr>}
              {(pays.length > 0 || esum("lent") > 0) && (
                <tr className="text-xs font-normal text-slate-600"><td colSpan={2} className="py-2">รับจริง {pays.length} ครั้ง</td>
                  <td className="py-2 text-right tabular-nums text-emerald-700">{money(esum("principal"))}</td>
                  {lendCol && <td className="py-2 text-right tabular-nums text-blue-700">{money(esum("lent"))}</td>}
                  <td className="py-2 text-right tabular-nums text-emerald-700">{money(esum("interest"))}</td>
                  <td className="py-2 text-right tabular-nums text-emerald-700">{money(esum("principal") + esum("interest") - esum("tax"), currency)}</td><td colSpan={2} /></tr>
              )}
            </tfoot>
          )}
        </table>
      </div>
      {events.length > 0 && f !== "open" && (
        <p className="text-xs text-slate-500">แถวสีเขียว = เงินที่รับจริง (รวม = เงินเข้าบัญชีหลังหักภาษี ณ ที่จ่าย ตรงกับ Statement · เงินต้นลดยอดเงินให้กู้ · ดอกเบี้ยเป็นรายได้) · แถวสีฟ้า = จ่ายเงินให้กู้ ·
          แก้ / ลบได้เฉพาะรายการล่าสุด ถ้ารายการเก่าผิด ให้ลบย้อนจากรายการล่าสุดลงมา</p>
      )}
    </div>
  );
}
