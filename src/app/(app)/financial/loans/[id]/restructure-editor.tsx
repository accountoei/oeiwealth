"use client";

import { useActionState, useMemo, useState } from "react";
import { restructureSchedule, type ActionState } from "../actions";
import { generateSchedule, PAYMENT_LABEL, SCHED_METHOD_LABEL, type SchedBasis, type SchedLine, type SchedMethod } from "@/lib/loan-schedule";
import { money, thDate } from "@/lib/format";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";
const num = (v: string) => Number(String(v).replace(/,/g, "")) || 0;
const fmt2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type OldSummary = { count: number; firstTotal: number; interest: number; lastDue: string | null };

/**
 * คำนวณงวดที่เหลือใหม่ — ชำระเกิน / ผู้กู้ขอเปลี่ยนจำนวนงวด ค่างวด ดอกเบี้ย / พักชำระ
 * งวดที่รับแล้วเก็บไว้ · งวดที่ยังไม่ครบถูกแทนด้วยตารางใหม่ (ฐานข้อมูลทำให้ในครั้งเดียว: restructure_loan_schedule)
 * ดอกเบี้ยค้าง (งวดที่ถึงกำหนดแล้วแต่ยังไม่ได้รับดอก) เลือกรวมเข้างวดแรกของตารางใหม่ได้ ไม่ให้หายไป
 */
export function RestructureEditor({ assetId, currency, outstanding, ratePct, startDefault, overdueInterest, old }: {
  assetId: string; currency: string; outstanding: number; ratePct: number; startDefault: string;
  overdueInterest: number; old: OldSummary;
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<SchedMethod>("EQUAL_PAYMENT");
  const [basis, setBasis] = useState<SchedBasis>("PERIODS");
  const [amount, setAmount] = useState(fmt2(outstanding));
  const [rate, setRate] = useState(ratePct ? String(ratePct) : "");
  const [periods, setPeriods] = useState(String(Math.max(1, old.count)));
  const [payment, setPayment] = useState(old.firstTotal ? fmt2(old.firstTotal) : "");
  const [every, setEvery] = useState("1");
  const [first, setFirst] = useState(startDefault);
  const [carry, setCarry] = useState(overdueInterest > 0);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<SchedLine[] | null>(null);
  const [err, setErr] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(restructureSchedule, {});
  const neu = useMemo(() => (lines ? {
    count: lines.length, firstTotal: lines[0] ? lines[0].principal + lines[0].interest : 0,
    interest: lines.reduce((s, l) => s + l.interest, 0), lastDue: lines.at(-1)?.due_date ?? null,
    principal: lines.reduce((s, l) => s + l.principal, 0),
  } : null), [lines]);

  if (!open) return <button type="button" onClick={() => setOpen(true)} className={obtn}>คำนวณงวดที่เหลือใหม่</button>;

  const byPayment = basis === "PAYMENT" && method !== "INTEREST_ONLY";
  const calc = () => {
    const r = generateSchedule({ method, basis, amount: num(amount), ratePct: num(rate), periods: num(periods), payment: num(payment),
      firstDue: first, everyMonths: Number(every) });
    setErr(r.error ?? "");
    if (r.error) { setLines(null); return; }
    const out = r.lines.map((l) => ({ ...l }));
    if (carry && overdueInterest > 0 && out[0]) {
      out[0].interest = Math.round((out[0].interest + overdueInterest) * 100) / 100;
      out[0].notes = `รวมดอกเบี้ยค้าง ${fmt2(overdueInterest)}`;
    }
    setLines(out);
  };
  const reset = () => setLines(null);

  return (
    <div className="w-full space-y-4 rounded-xl border border-amber-200 bg-amber-50/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-slate-900">คำนวณงวดที่เหลือใหม่</h3>
          <p className="text-xs text-slate-500">
            ใช้เมื่อชำระเกิน หรือผู้กู้ขอเปลี่ยนจำนวนงวด / ค่างวด / ดอกเบี้ย / พักชำระ · งวดที่รับแล้วเก็บไว้เหมือนเดิม ·
            งวดที่รับบางส่วนตัดเหลือส่วนที่รับแล้ว · งวดที่เหลือถูกแทนด้วยตารางใหม่
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
      </div>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm md:col-span-3">วิธีคิด
            <select value={method} onChange={(e) => { setMethod(e.target.value as SchedMethod); reset(); }} className={input}>
              {(Object.keys(SCHED_METHOD_LABEL) as SchedMethod[]).map((k) => <option key={k} value={k}>{SCHED_METHOD_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="text-sm">เงินต้นที่เหลือ ({currency})
            <input value={amount} onChange={(e) => { setAmount(e.target.value); reset(); }} inputMode="decimal" className={input} />
            <span className="mt-0.5 block text-xs text-slate-500">ตั้งต้น = เงินต้นคงเหลือจริง {fmt2(outstanding)}</span>
          </label>
          <label className="text-sm">ดอกเบี้ย % ต่อปี
            <input value={rate} onChange={(e) => { setRate(e.target.value); reset(); }} name="rate" inputMode="decimal" className={input} />
          </label>
          <label className="text-sm">ทุก
            <select value={every} onChange={(e) => { setEvery(e.target.value); reset(); }} className={input}>
              <option value="1">ทุกเดือน</option><option value="3">ทุก 3 เดือน</option><option value="6">ทุก 6 เดือน</option><option value="12">ทุกปี</option>
            </select>
          </label>
          {method !== "INTEREST_ONLY" && (
            <label className="text-sm">กำหนดจาก
              <select value={basis} onChange={(e) => { setBasis(e.target.value as SchedBasis); reset(); }} className={input}>
                <option value="PERIODS">ใส่จำนวนงวดที่เหลือ</option>
                <option value="PAYMENT">ใส่จำนวนเงินที่ผ่อนต่องวด</option>
              </select>
            </label>
          )}
          {byPayment
            ? <label className="text-sm">{PAYMENT_LABEL[method]}<input value={payment} onChange={(e) => { setPayment(e.target.value); reset(); }} inputMode="decimal" className={input} /></label>
            : <label className="text-sm">จำนวนงวดที่เหลือ<input value={periods} onChange={(e) => { setPeriods(e.target.value); reset(); }} name="quantity" inputMode="decimal" className={input} /></label>}
          <label className="text-sm">ครบกำหนดงวดแรกของตารางใหม่
            <input type="date" value={first} onChange={(e) => { setFirst(e.target.value); reset(); }} className={input} />
          </label>
          {overdueInterest > 0 && (
            <label className="flex items-start gap-2 text-sm md:col-span-3">
              <input type="checkbox" checked={carry} onChange={(e) => { setCarry(e.target.checked); reset(); }} className="mt-1" />
              <span>รวมดอกเบี้ยค้าง {fmt2(overdueInterest)} เข้างวดแรกของตารางใหม่
                <span className="block text-xs text-slate-500">ดอกเบี้ยของงวดที่ถึงกำหนดแล้วแต่ยังไม่ได้รับ — ไม่ติ๊ก = ยกให้ / ไม่เก็บ</span></span>
            </label>
          )}
          <label className="text-sm md:col-span-3">เหตุผล (บันทึกไว้ที่งวดแรกของตารางใหม่)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ผู้กู้ขอลดค่างวด / ชำระเกิน ตัดต้น" className={input} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={calc} className={obtn}>คำนวณ</button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </section>

      {lines && neu && (
        <>
          <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 text-sm font-medium text-slate-800">เปรียบเทียบงวดที่เหลือ</div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="py-1"></th><th className="text-right">เดิม</th><th className="text-right">ใหม่</th></tr></thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                <tr><td className="py-1">จำนวนงวด</td><td className="text-right">{old.count}</td><td className="text-right">{neu.count}</td></tr>
                <tr><td className="py-1">ค่างวดแรก</td><td className="text-right">{money(old.firstTotal)}</td><td className="text-right">{money(neu.firstTotal)}</td></tr>
                <tr><td className="py-1">ดอกเบี้ยรวมที่เหลือ</td><td className="text-right">{money(old.interest)}</td><td className="text-right">{money(neu.interest)}</td></tr>
                <tr><td className="py-1">งวดสุดท้าย</td><td className="text-right">{thDate(old.lastDue)}</td><td className="text-right">{thDate(neu.lastDue)}</td></tr>
              </tbody>
            </table>
            {Math.abs(neu.principal - outstanding) > 0.01 && (
              <p className="mt-2 text-xs text-amber-700">เงินต้นในตารางใหม่ ({money(neu.principal)}) ไม่เท่าเงินต้นคงเหลือจริง ({money(outstanding)}) — สถานะ &ldquo;รับแล้ว&rdquo; อาจคลาดเคลื่อน</p>
            )}
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 text-sm font-medium text-slate-800">ตารางใหม่ {lines.length} งวด</div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
                  <tr><th className="py-1">#</th><th>ครบกำหนด</th><th className="text-right">เงินต้น</th><th className="text-right">ดอกเบี้ย</th><th className="text-right">รวม</th><th className="pl-3">หมายเหตุ</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l, i) => (
                    <tr key={i}><td className="py-1">{i + 1}</td><td>{thDate(l.due_date)}</td>
                      <td className="text-right tabular-nums">{money(l.principal)}</td><td className="text-right tabular-nums">{money(l.interest)}</td>
                      <td className="text-right tabular-nums">{money(l.principal + l.interest)}</td><td className="pl-3 text-xs text-slate-500">{l.notes}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <form action={action} className="flex flex-wrap items-center gap-3"
            onSubmit={(e) => { if (!confirm("ยืนยันปรับตาราง? งวดที่ยังไม่ได้รับจะถูกแทนด้วยตารางใหม่")) e.preventDefault(); }}>
            <input type="hidden" name="asset_id" value={assetId} />
            <input type="hidden" name="lines" value={JSON.stringify(lines)} />
            <input type="hidden" name="note" value={note} />
            <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : `ยืนยันปรับตาราง (${lines.length} งวด)`}</button>
            {state.error && <span className="text-sm text-red-600">{state.error}</span>}
            {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
          </form>
        </>
      )}
    </div>
  );
}
