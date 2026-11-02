"use client";

import { useMemo, useState } from "react";
import { addMonthsKeepDay, generateSchedule, MAX_PERIODS, PAYMENT_LABEL, SCHED_METHOD_LABEL, type SchedBasis, type SchedMethod } from "@/lib/loan-schedule";
import { money, thDate, numOrZero as num } from "@/lib/format";
import { DayCountFields } from "../[id]/day-count";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/**
 * ตั้งตารางผ่อนพร้อมเพิ่มเงินให้กู้ (ไม่บังคับ · ตกลง 2 พ.ย. 2026)
 * เงินต้น / อัตรา / วันที่ให้กู้ มาจากช่องด้านบนของฟอร์ม · คำนวณให้ทันทีพร้อมตัวอย่าง · ส่ง schedule_lines ไปกับฟอร์ม
 * ตารางผ่อนไม่สม่ำเสมอ / วางจาก Excel → ทำที่หน้าสัญญา ("+ ตั้งตารางผ่อน")
 */
export default function NewLoanSchedule({ amount, ratePct, loanDate, dueDate, today }: {
  amount: number; ratePct: number; loanDate: string; dueDate: string; today: string;
}) {
  const [on, setOn] = useState(false);
  const [method, setMethod] = useState<SchedMethod>("EQUAL_PAYMENT");
  const [basis, setBasis] = useState<SchedBasis>("PERIODS");
  const [periods, setPeriods] = useState("");
  const [payment, setPayment] = useState("");
  const [every, setEvery] = useState("1");
  const [first, setFirst] = useState("");
  const [actual, setActual] = useState(false);
  const [from, setFrom] = useState("");
  // ค่าเริ่มต้นตามช่องด้านบน (ยังไม่ได้แก้เอง): งวดแรก = วันที่ให้กู้ + 1 งวด · จำนวนงวด = ถึงวันครบกำหนดคืน
  const firstDue = first || addMonthsKeepDay(loanDate || today, Number(every));
  const autoPeriods = dueDate && dueDate >= firstDue ? Math.floor(monthsBetween(firstDue, dueDate) / Number(every)) + 1 : 12;
  const nPeriods = periods.trim() === "" ? Math.min(Math.max(autoPeriods, 1), MAX_PERIODS) : num(periods);
  const byPayment = basis === "PAYMENT" && method !== "INTEREST_ONLY";
  const res = useMemo(() => on ? generateSchedule({ method, basis, amount, ratePct, periods: nPeriods, payment: num(payment), firstDue,
    everyMonths: Number(every), dayCount: actual ? "ACTUAL_365" : "MONTHLY", interestFrom: (actual ? from || loanDate : "") || undefined })
    : { lines: [] }, [on, method, basis, amount, ratePct, nPeriods, payment, firstDue, every, actual, from, loanDate]);
  const lines = res.error ? [] : res.lines;
  const totP = lines.reduce((s, l) => s + l.principal, 0), totI = lines.reduce((s, l) => s + l.interest, 0);
  const shown = lines.length > 8 ? [...lines.slice(0, 4).map((l, k) => ({ l, no: k + 1 })), null,
    ...lines.slice(-3).map((l, k) => ({ l, no: lines.length - 2 + k }))] : lines.map((l, k) => ({ l, no: k + 1 }));

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="mt-1" />
        <span><span className="font-medium text-slate-900">ตั้งตารางผ่อนเลย</span> (ไม่บังคับ)
          <span className="block text-xs text-slate-500">คิดจากเงินต้นและอัตราดอกเบี้ยด้านบน · ตารางที่ผ่อนไม่สม่ำเสมอ หรือวางจาก Excel ตั้งภายหลังที่หน้าสัญญาได้</span></span>
      </label>
      {on && <>
        <input type="hidden" name="schedule_lines" value={lines.length ? JSON.stringify(lines) : ""} />
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm md:col-span-3">วิธีคิด
            <select value={method} onChange={(e) => setMethod(e.target.value as SchedMethod)} className={input}>
              {(Object.keys(SCHED_METHOD_LABEL) as SchedMethod[]).map((k) => <option key={k} value={k}>{SCHED_METHOD_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="text-sm">ทุก
            <select value={every} onChange={(e) => setEvery(e.target.value)} className={input}>
              <option value="1">ทุกเดือน</option><option value="3">ทุก 3 เดือน</option><option value="6">ทุก 6 เดือน</option><option value="12">ทุกปี</option>
            </select>
          </label>
          {method !== "INTEREST_ONLY" && (
            <label className="text-sm">กำหนดจาก
              <select value={basis} onChange={(e) => setBasis(e.target.value as SchedBasis)} className={input}>
                <option value="PERIODS">ใส่จำนวนงวดที่ผ่อน</option>
                <option value="PAYMENT">ใส่จำนวนเงินที่ผ่อนต่องวด</option>
              </select>
            </label>
          )}
          {byPayment
            ? <label className="text-sm">{PAYMENT_LABEL[method]}<input value={payment} onChange={(e) => setPayment(e.target.value)} inputMode="decimal" className={input} /></label>
            : <label className="text-sm">จำนวนงวด<input value={periods} onChange={(e) => setPeriods(e.target.value)} name="quantity" inputMode="decimal"
                placeholder={String(nPeriods)} className={input} />
              <span className="mt-1 block text-xs text-slate-500">{dueDate ? `ว่าง = ถึงวันครบกำหนดคืน (${thDate(dueDate)})` : "ว่าง = 12 งวด"}</span></label>}
          <label className="text-sm">ครบกำหนดงวดแรก<input type="date" value={firstDue} onChange={(e) => setFirst(e.target.value)} className={input} />
            {!first && <span className="mt-1 block text-xs text-slate-500">ค่าเริ่มต้น: วันที่ให้กู้ + 1 งวด</span>}</label>
          <DayCountFields actual={actual} setActual={setActual} from={from || loanDate} setFrom={setFrom} hint="ตั้งต้น = วันที่ให้กู้" />
        </div>
        {res.error && amount > 0 && <p className="text-sm text-red-600">{res.error}</p>}
        {!(amount > 0) && <p className="text-sm text-slate-500">ใส่เงินต้นตามสัญญาด้านบนก่อน</p>}
        {lines.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">{lines.length} งวด · {thDate(lines[0].due_date)} – {thDate(lines.at(-1)!.due_date)} ·
              เงินต้นรวม {money(totP)} · ดอกเบี้ยรวม {money(totI)} · <span className="text-slate-500">วันครบกำหนดคืนจะตั้งเป็นวันงวดสุดท้ายให้</span></p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">งวด</th><th>ครบกำหนด</th>
                  <th className="text-right">เงินต้น</th><th className="text-right">ดอกเบี้ย</th><th className="text-right">รวม</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((x, k) => x ? (
                    <tr key={k}><td className="py-1">{x.no}</td><td>{thDate(x.l.due_date)}</td><td className="text-right">{money(x.l.principal)}</td>
                      <td className="text-right">{money(x.l.interest)}</td><td className="text-right">{money(x.l.principal + x.l.interest)}</td></tr>
                  ) : <tr key={k}><td colSpan={5} className="py-1 text-center text-slate-400">…</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>}
    </section>
  );
}
