"use client";

import { useActionState, useMemo, useState } from "react";
import { saveSchedule, type ActionState } from "../actions";
import { generateSchedule, parseScheduleRows, parseScheduleText, PAYMENT_LABEL, scheduleToText, SCHED_METHOD_LABEL,
  type SchedBasis, type SchedLine, type SchedMethod } from "@/lib/loan-schedule";
import { money, thDate } from "@/lib/format";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";
const num = (v: string) => Number(String(v).replace(/,/g, "")) || 0;

/**
 * ตั้ง / แก้ตารางผ่อนทั้งชุด — เลือกวิธีจาก Dropdown แสดงเฉพาะวิธีนั้น
 * 1) คำนวณจากสูตร (ใส่จำนวนงวด หรือ ยอดผ่อนต่องวด)  2) อัปโหลดไฟล์ / วางจาก Excel / แก้ทีละงวด
 *    ไฟล์ .xlsx อ่านในเบราว์เซอร์ (ไม่ส่งไฟล์ขึ้น Server · ไม่เก็บไฟล์) → แปลงเป็นข้อความให้ตรวจ / แก้ก่อนบันทึก
 * ผลคำนวณจากวิธีที่ 1 ส่งต่อไปแก้ทีละงวดในวิธีที่ 2 ได้ · ดูตัวอย่างก่อนบันทึก · บันทึก = แทนที่ตารางเดิมทั้งชุด
 */
type Mode = "FORMULA" | "TEXT";
type XSheet = { sheet: string; data: unknown[][] };
export function ScheduleEditor({ assetId, currency, current, defaults, hasSchedule }: {
  assetId: string; currency: string; current: SchedLine[]; hasSchedule: boolean;
  defaults: { amount: number; ratePct: number; firstDue: string };
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(hasSchedule ? "TEXT" : "FORMULA");
  const [text, setText] = useState(() => scheduleToText(current));
  const [generated, setGenerated] = useState<SchedLine[] | null>(null);
  const [calcError, setCalcError] = useState("");
  const [method, setMethod] = useState<SchedMethod>("EQUAL_PAYMENT");
  const [basis, setBasis] = useState<SchedBasis>("PERIODS");
  const [payment, setPayment] = useState("");
  const [amount, setAmount] = useState(defaults.amount ? defaults.amount.toFixed(2) : "");
  const [rate, setRate] = useState(defaults.ratePct ? String(defaults.ratePct) : "");
  const [periods, setPeriods] = useState("12");
  const [every, setEvery] = useState("1");
  const [first, setFirst] = useState(defaults.firstDue);
  const [sheets, setSheets] = useState<XSheet[]>([]);
  const [fileName, setFileName] = useState("");
  const [fileMsg, setFileMsg] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSchedule, {});
  const parsed = useMemo(() => parseScheduleText(text), [text]);
  const lines = mode === "FORMULA" ? generated ?? [] : parsed.lines;
  const errors = mode === "FORMULA" ? [] : parsed.errors;
  const totP = lines.reduce((s, l) => s + l.principal, 0);
  const totI = lines.reduce((s, l) => s + l.interest, 0);
  const byPayment = basis === "PAYMENT" && method !== "INTEREST_ONLY";

  if (!open) return <button type="button" onClick={() => setOpen(true)} className={hasSchedule ? obtn : btn}>{hasSchedule ? "แก้ตารางผ่อนทั้งชุด" : "+ ตั้งตารางผ่อน"}</button>;

  // อ่านแผ่นงาน → ข้อความในช่อง (ใช้หัวตาราง "เงินต้น" / "ดอกเบี้ย" · ข้ามแถวยอด 0 · วันที่ พ.ศ. แปลงให้)
  const pickSheet = (list: XSheet[], name: string) => {
    const sh = list.find((x) => x.sheet === name);
    if (!sh) return;
    const r = parseScheduleRows(sh.data);
    setText(scheduleToText(r.lines));
    setFileMsg(r.lines.length === 0
      ? `แผ่นงาน "${name}" ไม่พบงวดผ่อน — ต้องมีหัวตาราง "เงินต้น" และ "ดอกเบี้ย" หรือคอลัมน์ วันที่ · เงินต้น · ดอกเบี้ย`
      : `อ่านแผ่นงาน "${name}" ได้ ${r.lines.length} งวด${r.skipped ? ` · ข้ามงวดที่ยอดเป็น 0 จำนวน ${r.skipped} แถว` : ""}${r.errors.length ? ` · มีปัญหา ${r.errors.length} แถว: ${r.errors.slice(0, 3).join(", ")}` : ""}`);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileName(f.name); setFileMsg("กำลังอ่านไฟล์…"); setSheets([]);
    try {
      const { default: readXlsxFile } = await import("read-excel-file/universal");
      const list = (await readXlsxFile(f)) as XSheet[];
      setSheets(list);
      // เลือกแผ่นงานแรกที่อ่านงวดได้
      const first = list.find((x) => parseScheduleRows(x.data).lines.length > 0) ?? list[0];
      if (first) pickSheet(list, first.sheet);
    } catch {
      setFileMsg("อ่านไฟล์ไม่ได้ — รองรับเฉพาะไฟล์ .xlsx (ถ้าเป็น .xls ให้เปิดใน Excel แล้ว Save As เป็น .xlsx)");
    }
  };

  const calc = () => {
    const r = generateSchedule({ method, basis, amount: num(amount), ratePct: num(rate), periods: num(periods), payment: num(payment),
      firstDue: first, everyMonths: Number(every) });
    setCalcError(r.error ?? "");
    setGenerated(r.error ? null : r.lines);
    if (!r.error) setText(scheduleToText(r.lines));   // ส่งต่อให้วิธีที่ 2 แก้ทีละงวดได้
  };

  return (
    <div className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-slate-900">ตั้งตารางผ่อน</h3>
          <p className="text-xs text-slate-500">เลือกวิธีด้านล่าง · ดูตัวอย่างก่อนกดบันทึก</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
      </div>

      <label className="block text-sm">วิธีใส่ตารางผ่อน
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={input}>
          <option value="FORMULA">ทางที่ 1 · คำนวณจากสูตร</option>
          <option value="TEXT">ทางที่ 2 · อัปโหลด / วางจาก Excel / แก้ทีละงวด</option>
        </select>
      </label>

      {mode === "FORMULA" && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm md:col-span-3">วิธีคิด
              <select value={method} onChange={(e) => { setMethod(e.target.value as SchedMethod); setGenerated(null); }} className={input}>
                {(Object.keys(SCHED_METHOD_LABEL) as SchedMethod[]).map((k) => <option key={k} value={k}>{SCHED_METHOD_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="text-sm">ยอดเงินต้น ({currency})<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={input} /></label>
            <label className="text-sm">ดอกเบี้ย % ต่อปี<input value={rate} onChange={(e) => setRate(e.target.value)} name="rate" inputMode="decimal" className={input} /></label>
            <label className="text-sm">ทุก
              <select value={every} onChange={(e) => setEvery(e.target.value)} className={input}>
                <option value="1">ทุกเดือน</option><option value="3">ทุก 3 เดือน</option><option value="6">ทุก 6 เดือน</option><option value="12">ทุกปี</option>
              </select>
            </label>
            {method !== "INTEREST_ONLY" && (
              <label className="text-sm">กำหนดจาก
                <select value={basis} onChange={(e) => { setBasis(e.target.value as SchedBasis); setGenerated(null); }} className={input}>
                  <option value="PERIODS">ใส่จำนวนงวดที่ผ่อน</option>
                  <option value="PAYMENT">ใส่จำนวนเงินที่ผ่อนต่องวด</option>
                </select>
              </label>
            )}
            {byPayment
              ? <label className="text-sm">{PAYMENT_LABEL[method]}<input value={payment} onChange={(e) => setPayment(e.target.value)} inputMode="decimal" className={input} /></label>
              : <label className="text-sm">จำนวนงวด<input value={periods} onChange={(e) => setPeriods(e.target.value)} name="quantity" inputMode="decimal" className={input} /></label>}
            <label className="text-sm">ครบกำหนดงวดแรก<input type="date" value={first} onChange={(e) => setFirst(e.target.value)} className={input} /></label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={calc} className={obtn}>คำนวณ</button>
            {calcError && <span className="text-sm text-red-600">{calcError}</span>}
          </div>
          <p className="text-xs text-slate-500">
            {byPayment ? "ผ่อนไปจนครบยอด ระบบนับจำนวนงวดให้ · งวดสุดท้ายเท่าที่เหลือ" : "ปัดเศษทีละงวด · งวดสุดท้ายปรับเงินต้นให้ครบยอดพอดี"}
            {" "}· อยากปรับบางงวด: คำนวณแล้วเปลี่ยนเป็น &ldquo;ทางที่ 2&rdquo; ตัวเลขจะตามไปให้แก้ต่อ
          </p>
        </section>
      )}

      {mode === "TEXT" && (
        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">อัปโหลดไฟล์ Excel (.xlsx)
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => onFile(e.target.files?.[0])}
                className="mt-1 block text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm" />
            </label>
            {sheets.length > 1 && (
              <label className="text-sm">แผ่นงาน
                <select onChange={(e) => pickSheet(sheets, e.target.value)} defaultValue={sheets.find((x) => parseScheduleRows(x.data).lines.length > 0)?.sheet}
                  className={input}>
                  {sheets.map((x) => <option key={x.sheet} value={x.sheet}>{x.sheet}</option>)}
                </select>
              </label>
            )}
          </div>
          {fileMsg && <p className={`text-xs ${fileMsg.startsWith("อ่านแผ่นงาน") ? "text-emerald-700" : fileMsg.startsWith("กำลัง") ? "text-slate-500" : "text-red-600"}`}>
            {fileName && <span className="text-slate-500">{fileName} · </span>}{fileMsg}</p>}
          <p className="text-xs text-slate-500">ไฟล์อ่านในเครื่องของคุณเท่านั้น ไม่ถูกอัปโหลดหรือเก็บไว้ในระบบ · ผลที่อ่านได้จะขึ้นในช่องด้านล่าง ตรวจ / แก้ได้ก่อนบันทึก</p>
          <p className="text-xs text-slate-500">
            หรือคัดลอกจาก Excel มาวาง: 1 บรรทัด = 1 งวด · ถ้าคัดลอกหัวตารางมาด้วย ระบบใช้คอลัมน์ <b>&ldquo;เงินต้น&rdquo;</b> และ <b>&ldquo;ดอกเบี้ย&rdquo;</b> ตามหัวตาราง ·
            ไม่มีหัวตาราง: <b>วันครบกำหนด · เงินต้น · ดอกเบี้ย · หมายเหตุ</b> · บรรทัดรวม / งวดที่ยอดเป็น 0 ข้ามให้เอง ·
            วันที่ใช้ 15 มิ.ย. 68, 15/06/2568 หรือ 2025-06-15 ได้
          </p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} data-plain
            placeholder={"2026-11-05\t10000.00\t500.00\n2026-12-05\t10000.00\t450.00"}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" />
          {parsed.errors.length > 0 && <ul className="text-xs text-red-600">{parsed.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>}
        </section>
      )}

      {lines.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 text-sm font-medium text-slate-800">ตัวอย่าง {lines.length} งวด</div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
                <tr><th className="py-1">งวด</th><th>ครบกำหนด</th><th className="text-right">เงินต้น</th><th className="text-right">ดอกเบี้ย</th><th className="text-right">รวม</th><th className="pl-3">หมายเหตุ</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l, i) => (
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
        <input type="hidden" name="lines" value={JSON.stringify(lines)} />
        <button disabled={pending || lines.length === 0 || errors.length > 0} className={btn}>
          {pending ? "กำลังบันทึก…" : `บันทึกตารางผ่อน (${lines.length} งวด)`}
        </button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
        <span className="text-xs text-slate-500">เงินต้นตามตารางควรรวมเท่ากับยอดเงินต้นของสัญญา (ใช้คำนวณว่างวดไหนรับแล้ว)</span>
      </form>
    </div>
  );
}
