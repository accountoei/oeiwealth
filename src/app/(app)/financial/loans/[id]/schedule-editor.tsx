"use client";

import { useActionState, useMemo, useState } from "react";
import { saveSchedule, type ActionState } from "../actions";
import { generateSchedule, parseScheduleText, scheduleToText, SCHED_METHOD_LABEL, type SchedLine, type SchedMethod } from "@/lib/loan-schedule";
import { money, thDate } from "@/lib/format";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";
const num = (v: string) => Number(String(v).replace(/,/g, "")) || 0;

/**
 * ตั้ง / แก้ตารางผ่อนทั้งชุด
 * 1) คำนวณจากสูตร → ได้ข้อความในช่องด้านล่าง  หรือ  2) วางตารางจาก Excel ลงช่องเดียวกัน
 * แก้ตัวเลขในช่องได้ทุกงวด · ดูตัวอย่างก่อนบันทึก · บันทึก = แทนที่ตารางเดิมทั้งชุด
 */
export function ScheduleEditor({ assetId, currency, current, defaults, hasSchedule }: {
  assetId: string; currency: string; current: SchedLine[]; hasSchedule: boolean;
  defaults: { amount: number; ratePct: number; firstDue: string };
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => scheduleToText(current));
  const [method, setMethod] = useState<SchedMethod>("EQUAL_PAYMENT");
  const [amount, setAmount] = useState(defaults.amount ? defaults.amount.toFixed(2) : "");
  const [rate, setRate] = useState(defaults.ratePct ? String(defaults.ratePct) : "");
  const [periods, setPeriods] = useState("12");
  const [every, setEvery] = useState("1");
  const [first, setFirst] = useState(defaults.firstDue);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSchedule, {});
  const parsed = useMemo(() => parseScheduleText(text), [text]);
  const totP = parsed.lines.reduce((s, l) => s + l.principal, 0);
  const totI = parsed.lines.reduce((s, l) => s + l.interest, 0);

  if (!open) return <button type="button" onClick={() => setOpen(true)} className={hasSchedule ? obtn : btn}>{hasSchedule ? "แก้ตารางผ่อนทั้งชุด" : "+ ตั้งตารางผ่อน"}</button>;

  const calc = () => setText(scheduleToText(generateSchedule({ method, amount: num(amount), ratePct: num(rate), periods: Math.max(1, Math.floor(num(periods))),
    firstDue: first, everyMonths: Number(every) })));

  return (
    <div className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-slate-900">ตั้งตารางผ่อน</h3>
          <p className="text-xs text-slate-500">เลือกได้ 2 ทาง: คำนวณจากสูตร หรือคัดลอกตารางจาก Excel มาวางในช่องด้านล่าง · แก้ตัวเลขทีละงวดในช่องได้</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
      </div>

      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium text-slate-800">ทางที่ 1 · คำนวณจากสูตร</div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm md:col-span-3">วิธีคิด
            <select value={method} onChange={(e) => setMethod(e.target.value as SchedMethod)} className={input}>
              {(Object.keys(SCHED_METHOD_LABEL) as SchedMethod[]).map((k) => <option key={k} value={k}>{SCHED_METHOD_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="text-sm">ยอดเงินต้น ({currency})<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={input} /></label>
          <label className="text-sm">ดอกเบี้ย % ต่อปี<input value={rate} onChange={(e) => setRate(e.target.value)} name="rate" inputMode="decimal" className={input} /></label>
          <label className="text-sm">จำนวนงวด<input value={periods} onChange={(e) => setPeriods(e.target.value)} name="quantity" inputMode="decimal" className={input} /></label>
          <label className="text-sm">ทุก
            <select value={every} onChange={(e) => setEvery(e.target.value)} className={input}>
              <option value="1">ทุกเดือน</option><option value="3">ทุก 3 เดือน</option><option value="6">ทุก 6 เดือน</option><option value="12">ทุกปี</option>
            </select>
          </label>
          <label className="text-sm">ครบกำหนดงวดแรก<input type="date" value={first} onChange={(e) => setFirst(e.target.value)} className={input} /></label>
          <div className="flex items-end"><button type="button" onClick={calc} className={obtn}>คำนวณ → ใส่ในช่องด้านล่าง</button></div>
        </div>
        <p className="text-xs text-slate-500">ปัดเศษทีละงวด · งวดสุดท้ายปรับเงินต้นให้ครบยอดพอดี</p>
      </section>

      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium text-slate-800">ทางที่ 2 · วางจาก Excel / แก้ทีละงวด</div>
        <p className="text-xs text-slate-500">
          1 บรรทัด = 1 งวด · คอลัมน์ตามลำดับ: <b>วันครบกำหนด · เงินต้น · ดอกเบี้ย · หมายเหตุ (ถ้ามี)</b> — มีคอลัมน์เลขงวดนำหน้าก็ได้ ·
          หัวตาราง / บรรทัดรวม ข้ามให้เอง · วันที่ใช้ 05/11/2569, 5/11/2026 หรือ 2026-11-05 ได้
        </p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} data-plain
          placeholder={"2026-11-05\t10000.00\t500.00\n2026-12-05\t10000.00\t450.00"}
          className="block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" />
        {parsed.errors.length > 0 && <ul className="text-xs text-red-600">{parsed.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>}
      </section>

      {parsed.lines.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 text-sm font-medium text-slate-800">ตัวอย่าง {parsed.lines.length} งวด</div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
                <tr><th className="py-1">งวด</th><th>ครบกำหนด</th><th className="text-right">เงินต้น</th><th className="text-right">ดอกเบี้ย</th><th className="text-right">รวม</th><th className="pl-3">หมายเหตุ</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parsed.lines.map((l, i) => (
                  <tr key={i}><td className="py-1">{i + 1}</td><td>{thDate(l.due_date)}</td>
                    <td className="text-right tabular-nums">{money(l.principal)}</td><td className="text-right tabular-nums">{money(l.interest)}</td>
                    <td className="text-right tabular-nums">{money(l.principal + l.interest)}</td><td className="pl-3 text-xs text-slate-500">{l.notes}</td></tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 font-medium">
                <tr><td className="py-1" colSpan={2}>รวม</td><td className="text-right tabular-nums">{money(totP)}</td>
                  <td className="text-right tabular-nums">{money(totI)}</td><td className="text-right tabular-nums">{money(totP + totI)}</td><td /></tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      <form action={action} className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => { if (hasSchedule && !confirm("แทนที่ตารางผ่อนเดิมทั้งชุด?")) e.preventDefault(); }}>
        <input type="hidden" name="asset_id" value={assetId} />
        <input type="hidden" name="lines" value={JSON.stringify(parsed.lines)} />
        <button disabled={pending || parsed.lines.length === 0 || parsed.errors.length > 0} className={btn}>
          {pending ? "กำลังบันทึก…" : `บันทึกตารางผ่อน (${parsed.lines.length} งวด)`}
        </button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
        <span className="text-xs text-slate-500">เงินต้นตามตารางควรรวมเท่ากับยอดเงินต้นของสัญญา (ใช้คำนวณว่างวดไหนรับแล้ว)</span>
      </form>
    </div>
  );
}
