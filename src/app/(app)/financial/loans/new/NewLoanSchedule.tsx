"use client";

import { useEffect, useMemo, useState } from "react";
import { addMonthsKeepDay, generateSchedule, lastDueOf, MAX_PERIODS, PAYMENT_LABEL, periodsUntil, SCHED_METHOD_LABEL,
  type SchedBasis, type SchedLine, type SchedMethod } from "@/lib/loan-schedule";
import { thDate, numOrZero as num } from "@/lib/format";
import { DayCountFields } from "../[id]/day-count";
import ScheduleGrid, { rowsToLines, toRows, type GridRow } from "../ScheduleGrid";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

export type NewSched = { lines: SchedLine[]; errors: string[] };

/**
 * ตั้งตารางผ่อนพร้อมเพิ่มเงินให้กู้ (ไม่บังคับ · ตกลง 2 พ.ย. 2026)
 * เงินต้น / อัตรา / วันที่ให้กู้ มาจากช่องด้านบนของฟอร์ม · คำนวณจากสูตรให้ทันที → ลงตารางที่แก้ได้ทีละช่อง (ScheduleGrid)
 * แก้ในตารางแล้ว เปลี่ยนค่าในสูตรจะไม่ทับ (มีปุ่มคำนวณจากสูตรใหม่) · ส่ง schedule_lines ไปกับฟอร์ม
 * onChange: ส่งตารางให้ฟอร์มหลัก (เติมยอดตั้งต้นจากตาราง · กันบันทึกเมื่อตารางยังผิด)
 */
export default function NewLoanSchedule({ amount, ratePct, loanDate, dueDate, today, currency, openingDate, onChange }: {
  amount: number; ratePct: number; loanDate: string; dueDate: string; today: string; currency: string;
  /** ให้กู้ก่อน Go-live: วันตั้งต้น (งวดที่ครบกำหนดถึงวันนี้ = ก่อน Go-live) */
  openingDate?: string;
  onChange: (s: NewSched) => void;
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
  const [edited, setEdited] = useState<GridRow[] | null>(null);
  // ค่าเริ่มต้นตามช่องด้านบน (ยังไม่ได้แก้เอง): งวดแรก = วันที่ให้กู้ + 1 งวด · จำนวนงวด = ถึงวันครบกำหนดคืน
  const firstDue = first || addMonthsKeepDay(loanDate || today, Number(every));
  const autoPeriods = periodsUntil(firstDue, dueDate, Number(every)) || 12;
  const nPeriods = periods.trim() === "" ? Math.min(Math.max(autoPeriods, 1), MAX_PERIODS) : num(periods);
  const byPayment = basis === "PAYMENT" && method !== "INTEREST_ONLY";
  const interestFrom = (actual ? from || loanDate : loanDate) || undefined;
  const res = useMemo(() => on ? generateSchedule({ method, basis, amount, ratePct, periods: nPeriods, payment: num(payment), firstDue,
    everyMonths: Number(every), dayCount: actual ? "ACTUAL_365" : "MONTHLY", interestFrom: actual ? interestFrom : undefined })
    : { lines: [] as SchedLine[], error: undefined }, [on, method, basis, amount, ratePct, nPeriods, payment, firstDue, every, actual, interestFrom]);
  const formulaRows = useMemo(() => toRows(res.error ? [] : res.lines), [res]);
  const rows = edited ?? formulaRows;
  const { lines, errors } = useMemo(() => rowsToLines(rows), [rows]);
  // ส่งตารางให้ฟอร์มหลัก (เทียบด้วยข้อความ กันส่งซ้ำทุกครั้งที่ render)
  const sig = JSON.stringify(on ? { lines, errors } : { lines: [], errors: [] });
  useEffect(() => { onChange(JSON.parse(sig) as NewSched); }, [sig, onChange]);

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="mt-1" />
        <span><span className="font-medium text-slate-900">ตั้งตารางผ่อนเลย</span> (ไม่บังคับ)
          <span className="block text-xs text-slate-500">คิดจากเงินต้นและอัตราดอกเบี้ยด้านบน แล้วแก้ในตารางทีละงวดได้ (วันที่ / เงินต้น / ดอกเบี้ย / แทรก / ลบงวด) · วางจาก Excel ทำที่หน้าสัญญา</span></span>
      </label>
      {on && <>
        <input type="hidden" name="schedule_lines" value={lines.length && !errors.length ? JSON.stringify(lines) : ""} />
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
                <option value="PERIODS">ใส่จำนวนงวด / งวดสุดท้าย</option>
                <option value="PAYMENT">ใส่จำนวนเงินที่ผ่อนต่องวด</option>
              </select>
            </label>
          )}
          <label className="text-sm">ครบกำหนดงวดแรก<input type="date" value={firstDue} onChange={(e) => setFirst(e.target.value)} className={input} />
            {!first && <span className="mt-1 block text-xs text-slate-500">ค่าเริ่มต้น: วันที่ให้กู้ + 1 งวด</span>}</label>
          {byPayment
            ? <label className="text-sm">{PAYMENT_LABEL[method]}<input value={payment} onChange={(e) => setPayment(e.target.value)} inputMode="decimal" className={input} /></label>
            : <>
              <label className="text-sm">จำนวนงวด<input value={periods} onChange={(e) => setPeriods(e.target.value)} name="quantity" inputMode="decimal"
                  placeholder={String(nPeriods)} className={input} />
                <span className="mt-1 block text-xs text-slate-500">{dueDate ? `ว่าง = ถึงวันครบกำหนดคืน (${thDate(dueDate)})` : "ว่าง = 12 งวด"}</span></label>
              <label className="text-sm">งวดสุดท้ายครบกำหนด
                <input type="date" value={lastDueOf(firstDue, nPeriods, Number(every))} min={firstDue}
                  onChange={(e) => { const n = periodsUntil(firstDue, e.target.value, Number(every)); if (n) setPeriods(String(n)); }} className={input} />
                <span className="mt-1 block text-xs text-slate-500">ใส่ช่องไหนก็ได้ อีกช่องเปลี่ยนตาม</span></label>
            </>}
          <DayCountFields actual={actual} setActual={setActual} from={from || loanDate} setFrom={setFrom} hint="ตั้งต้น = วันที่ให้กู้" />
        </div>
        {res.error && amount > 0 && !edited && <p className="text-sm text-red-600">{res.error}</p>}
        {!(amount > 0) && <p className="text-sm text-slate-500">ใส่เงินต้นตามสัญญาด้านบนก่อน</p>}
        {edited && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-slate-700">แก้ตารางเองแล้ว — เปลี่ยนค่าด้านบนจะไม่คำนวณทับ ·{" "}
            <button type="button" onClick={() => setEdited(null)} className="text-blue-700 underline">คำนวณจากสูตรใหม่ (ทิ้งที่แก้)</button></p>
        )}
        {amount > 0 && (rows.length > 0 || edited) && (
          <>
            <ScheduleGrid rows={rows} setRows={setEdited} currency={currency}
              opts={{ amount, ratePct, dayCount: actual ? "ACTUAL_365" : "MONTHLY", interestFrom, flat: method === "FLAT" }}
              opening={openingDate ? { date: openingDate, principal: amount } : undefined} />
            {lines.length > 0 && <p className="text-xs text-slate-500">วันครบกำหนดคืนจะตั้งเป็นวันงวดสุดท้ายให้ ({thDate(lines.at(-1)!.due_date)})</p>}
          </>
        )}
      </>}
    </section>
  );
}
