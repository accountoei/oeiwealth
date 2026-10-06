"use client";

import { useActionState, useState } from "react";
import { addCheckup, type ActionState } from "./actions";
import { METRICS } from "./metrics";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const cell = "w-full rounded-md border border-slate-300 px-2 py-1 text-sm";
type R = { metric: string; value: string; unit: string; min: string; max: string; flag: string };
const blank = (code = ""): R => {
  const m = METRICS.find((x) => x.code === code);
  return { metric: code, value: "", unit: m?.unit ?? "", min: m?.min != null ? String(m.min) : "", max: m?.max != null ? String(m.max) : "", flag: "" };
};

export default function CheckupForm({ personId, today }: { personId: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<R[]>(["SYSTOLIC_BP", "DIASTOLIC_BP", "FBS", "CHOLESTEROL", "LDL", "HDL"].map(blank));
  const [state, action, pending] = useActionState<ActionState, FormData>(addCheckup, {});
  const set = (i: number, p: Partial<R>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800">+ บันทึกผลตรวจสุขภาพ</button>;
  const payload = rows.filter((r) => r.metric && r.value.trim()).map((r) => {
    const n = Number(r.value.replace(/,/g, ""));
    const numeric = r.value.trim() !== "" && !Number.isNaN(n);
    return { metric: r.metric, value_numeric: numeric ? n : null, value_text: numeric ? null : r.value, unit: r.unit,
      reference_min: r.min, reference_max: r.max, abnormal_flag: r.flag ||
        (numeric && r.max && n > Number(r.max) ? "H" : numeric && r.min && n < Number(r.min) ? "L" : "") };
  });
  return (
    <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="person_id" value={personId} />
      <input type="hidden" name="results" value={JSON.stringify(payload)} />
      <h3 className="font-medium text-slate-900">บันทึกผลตรวจสุขภาพ</h3>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-sm">วันที่ตรวจ *<input name="checkup_date" type="date" required defaultValue={today} max={today} className={input} /></label>
        <label className="text-sm">โรงพยาบาล<input name="hospital" className={input} /></label>
        <label className="text-sm">แพ็กเกจ<input name="package_name" className={input} /></label>
        <label className="text-sm">ค่าใช้จ่าย (บาท)<input name="cost" inputMode="decimal" className={input} /></label>
        <label className="text-sm md:col-span-4">หมายเหตุ / คำแนะนำแพทย์<input name="notes" className={input} /></label>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">รายการ</th><th>ผล</th><th>หน่วย</th><th>ค่าปกติ ต่ำสุด</th><th>สูงสุด</th><th>ผิดปกติ</th><th></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <select value={METRICS.some((m) => m.code === r.metric) ? r.metric : "__custom"} onChange={(e) => set(i, e.target.value === "__custom" ? { metric: "" } : blank(e.target.value))} className={cell}>
                  {METRICS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
                  <option value="__custom">อื่น ๆ (พิมพ์เอง)</option>
                </select>
                {!METRICS.some((m) => m.code === r.metric) && <input value={r.metric} onChange={(e) => set(i, { metric: e.target.value })} placeholder="ชื่อค่าตรวจ (อังกฤษ)" className={`mt-1 ${cell}`} />}
              </td>
              <td className="pr-2"><input value={r.value} onChange={(e) => set(i, { value: e.target.value })} className={cell} /></td>
              <td className="pr-2"><input value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} className={cell} /></td>
              <td className="pr-2"><input value={r.min} onChange={(e) => set(i, { min: e.target.value })} className={cell} /></td>
              <td className="pr-2"><input value={r.max} onChange={(e) => set(i, { max: e.target.value })} className={cell} /></td>
              <td className="pr-2">
                <select value={r.flag} onChange={(e) => set(i, { flag: e.target.value })} className={cell}>
                  <option value="">อัตโนมัติ</option><option value="H">สูง</option><option value="L">ต่ำ</option><option value="ABNORMAL">ผิดปกติ</option>
                </select>
              </td>
              <td><button type="button" onClick={() => setRows(rows.filter((_, k) => k !== i))} className="text-xs text-red-600">ลบ</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => setRows([...rows, blank("WEIGHT")])} className="text-xs text-slate-700 underline">+ เพิ่มรายการ</button>
      <p className="text-xs text-slate-500">เว้นช่องผลว่างได้ (ไม่บันทึก) · &ldquo;อัตโนมัติ&rdquo; = ระบบเทียบกับค่าปกติที่กรอกให้ · ค่าปกติเริ่มต้นเป็นค่าทั่วไป ควรแก้ตามใบผลแล็บ</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}
