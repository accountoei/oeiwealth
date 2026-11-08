"use client";

import { useActionState, useMemo, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { saveCashValueTable, type ActionState } from "../actions";
import { parseCashValueText } from "@/lib/insurance-schedule";
import { cvAutoDate, cvGridToLines, cvNextRow, cvSetYear, sortCvGrid, type CvGridLine } from "@/lib/insurance-grid";
import { SMALL_BTN, SMALL_DEL_BTN, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import Flash from "@/components/Flash";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const cell = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50";

type Mode = "GRID" | "TEXT";
let seq = 0;
const newKey = () => `c${++seq}`;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim());

/**
 * ตั้ง / แก้ตารางมูลค่าเวนคืน (ตกลง 8 พ.ย. 2026 · หน้าตาเดียวกับตารางเบี้ย / ผลประโยชน์ · แทนช่องวางข้อความ)
 *   เริ่มจาก: ตารางปัจจุบัน · อัปโหลด / วางจาก Excel → แก้ทีละช่อง → บันทึกทั้งตาราง
 *   1 แถว = 1 ปีกรมธรรม์ · วันที่ = วันครบรอบ (แก้ได้ เช่น วันที่ในหนังสือแจ้ง) · มูลค่า
 *   เล่มที่ไม่มีตารางในสัญญา: ใส่ยอดตามหนังสือแจ้งเป็นแถวได้ · ระบบสร้าง / ลงมูลค่าเวนคืนให้เองเมื่อถึงวันและจ่ายเบี้ยก่อนหน้าครบ
 */
export default function CvTableEditor({ policyId, startDate, current, postedYears, today, goLive, currency }: {
  policyId: string; startDate: string | null; current: { policy_year: number; value: number; value_date: string }[];
  /** ปีที่ลงยอดแล้ว (ยอดตรงกับตาราง) */ postedYears: number[]; today: string; goLive: string | null; currency: string;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const hasRows = current.length > 0;
  const toRows = (): CvGridLine[] => current.map((x) => ({ key: `y${x.policy_year}`, year: String(x.policy_year), date: x.value_date, value: Number(x.value).toFixed(2) }));
  const [mode, setMode] = useState<Mode>("GRID");
  const [rows, setRows] = useState<CvGridLine[]>(toRows);
  const [text, setText] = useState("");
  const [fileMsg, setFileMsg] = useState("");
  const parsed = useMemo(() => parseCashValueText(text, startDate), [text, startDate]);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCashValueTable, {});
  const cf = useConfirmSubmit();
  const { lines, errors } = useMemo(() => cvGridToLines(rows, startDate), [rows, startDate]);
  const posted = new Set(postedYears);

  // เปิดใหม่ทุกครั้ง = เริ่มจากตารางล่าสุด
  const trigger = <button type="button" onClick={() => { if (!open) { setRows(toRows()); setMode("GRID"); } setOpen(!open); }}
    className={activeCls(hasRows ? obtn : btn)}>{hasRows ? "แก้ตารางมูลค่าเวนคืน" : "+ ตั้งตารางมูลค่าเวนคืน"}</button>;
  if (!open) return trigger;

  const patch = (i: number, p: Partial<CvGridLine>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const insertAfter = (i: number) => { const n = [...rows]; n.splice(i + 1, 0, cvNextRow(rows[i], newKey(), startDate)); setRows(n); };
  const addLast = () => setRows([...rows, cvNextRow(rows.at(-1), newKey(), startDate)]);
  const put = () => {
    setRows(parsed.lines.map((l) => ({ key: newKey(), year: String(l.policy_year), date: l.value_date ?? "", value: l.value.toFixed(2) })));
    setMode("GRID");
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileMsg("กำลังอ่านไฟล์…");
    try {
      const { default: readXlsxFile } = await import("read-excel-file/universal");
      const sheets = (await readXlsxFile(f)) as { sheet: string; data: unknown[][] }[];
      const asText = (d: unknown[][]) => d.map((r) => r.map(iso).join("\t")).join("\n");
      const sh = sheets.find((x) => parseCashValueText(asText(x.data), startDate).lines.length > 0);
      if (!sh) { setFileMsg("ไม่พบตารางในไฟล์ — ต้องมีคอลัมน์ปีกรมธรรม์ และมูลค่าเวนคืน"); return; }
      const t = asText(sh.data);
      setText(t);
      setFileMsg(`อ่านแผ่นงาน "${sh.sheet}" ได้ ${parseCashValueText(t, startDate).lines.length} ปี · กด "ใส่ลงตาราง" ด้านล่าง`);
    } catch { setFileMsg("อ่านไฟล์ไม่ได้ — รองรับเฉพาะ .xlsx (ถ้าเป็น .xls ให้เปิดใน Excel แล้ว Save As เป็น .xlsx)"); }
  };
  const status = (r: CvGridLine) => {
    const d = r.date || cvAutoDate(startDate, Number(r.year)) || "";
    if (!d) return null;
    if (posted.has(Number(r.year))) return <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">ลงแล้ว</span>;
    if (d > today) return <span className="text-slate-400">ยังไม่ถึง</span>;
    if (goLive && d < goLive) return <span className="text-slate-500">ก่อน Go-live</span>;
    return <span className="text-amber-700">ถึงแล้ว · รอลง</span>;
  };
  const removed = current.filter((c) => !lines.some((l) => l.policy_year === c.policy_year)).length;
  const confirmText = lines.length === 0 ? "ล้างตารางมูลค่าเวนคืนทั้งหมด?" : removed > 0 ? `บันทึกตาราง ${lines.length} ปี (ลบออก ${removed} ปี)?` : "";

  return present(trigger, (
    <div className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-5 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-slate-900">ตั้ง / แก้ตารางมูลค่าเวนคืน</h3>
          <p className="text-xs text-slate-500">มูลค่าเวนคืน ณ สิ้นปีกรมธรรม์ตามตารางในเล่ม · เล่มที่ไม่มีตาราง ใส่ยอดตามหนังสือแจ้งเป็นแถว (ปีกรมธรรม์ + วันที่ในหนังสือแจ้ง) ·
            บันทึกแล้วระบบลงยอดให้เองเมื่อถึงวัน และจ่ายเบี้ยก่อนหน้านั้นครบ
            {startDate ? <> · วันครบรอบนับจากวันเริ่มสัญญา {thDate(startDate)}</> : <span className="text-amber-700"> · กรมธรรม์ยังไม่มีวันเริ่มสัญญา ต้องใส่วันที่ทุกแถว</span>}</p>
        </div>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
      </div>

      <label className="block text-sm">เริ่มจาก
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={input}>
          <option value="GRID">{hasRows ? "ตารางปัจจุบัน · แก้ในตารางด้านล่าง" : "ใส่เองทีละปีในตารางด้านล่าง"}</option>
          <option value="TEXT">อัปโหลด / วางจาก Excel</option>
        </select>
      </label>

      {mode === "TEXT" && (
        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <label className="text-sm">อัปโหลดไฟล์ Excel (.xlsx)
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => onFile(e.target.files?.[0])}
              className="mt-1 block text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm" />
          </label>
          {fileMsg && <p className="text-xs text-slate-600">{fileMsg}</p>}
          <p className="text-xs text-slate-500">หรือวาง: 1 บรรทัด = 1 ปี · <b>ปีกรมธรรม์ · มูลค่าเวนคืน · [วันที่]</b> · ไม่ใส่วันที่ = วันครบรอบสัญญา · ไฟล์อ่านในเครื่อง ไม่ถูกเก็บ</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} data-plain
            placeholder={"1\t12000.00\n2\t28500.00\n3\t45000.00"} className="block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" />
          {parsed.errors.length > 0 && <ul className="text-xs text-red-600">{parsed.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>}
          <button type="button" disabled={parsed.lines.length === 0} onClick={put} className={obtn}>
            ใส่ลงตาราง · แทนตารางเดิม{parsed.lines.length ? ` (${parsed.lines.length} ปี)` : ""}</button>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium text-slate-800">ตารางมูลค่าเวนคืน{rows.length ? ` ${rows.length} ปี` : ""}</span>
          <span className="text-xs text-slate-500">{currency}{postedYears.length > 0 && ` · ลงแล้ว ${postedYears.length} ปี`}</span>
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="sticky top-0 z-10 bg-white text-left text-xs text-slate-500">
              <tr><th className="w-24 py-1">ปีกรมธรรม์</th><th className="w-44">สิ้นปีกรมธรรม์ / วันที่</th><th className="w-40 pr-2 text-right">มูลค่าเวนคืน</th>
                <th className="pl-2">สถานะ</th><th className="w-28"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="py-1 pr-1"><input value={r.year} onChange={(e) => setRows(rows.map((x, j) => (j === i ? cvSetYear(x, e.target.value, startDate) : x)))}
                    onBlur={() => setRows(sortCvGrid(rows))} inputMode="numeric" data-plain aria-label={`ปีกรมธรรม์แถวที่ ${i + 1}`} className={`${cell} text-right`} /></td>
                  <td className="px-1 py-1"><input type="date" value={r.date} onChange={(e) => patch(i, { date: e.target.value })}
                    aria-label={`วันที่แถวที่ ${i + 1}`} className={cell} /></td>
                  <td className="px-1 py-1"><input value={r.value} onChange={(e) => patch(i, { value: e.target.value })} inputMode="decimal"
                    aria-label={`มูลค่าเวนคืนแถวที่ ${i + 1}`} className={`${cell} text-right tabular-nums`} /></td>
                  <td className="pl-2 text-xs">{status(r)}</td>
                  <td className="whitespace-nowrap px-1 py-1 text-right">
                    <button type="button" onClick={() => insertAfter(i)} title="แทรกปีต่อจากแถวนี้" className={`${SMALL_BTN} mr-1`}>+ แทรก</button>
                    <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} title="ลบแถวนี้" className={`${SMALL_DEL_BTN} ml-1`}>ลบ</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" onClick={addLast} className={SMALL_BTN}>+ เพิ่มปีท้ายตาราง</button>
          {rows.length === 0 && <span className="text-sm text-slate-500">ยังไม่มีแถว — วางจาก Excel หรือกดเพิ่มปี</span>}
        </div>
        <p className="mt-1 text-xs text-slate-500">ออกจากช่องปีแล้วเรียงตามปีให้เอง · แก้ปีแล้ววันครบรอบเลื่อนตาม · ยอดที่ลงแล้วแก้ที่ตัวเลขสีฟ้าในตารางของหน้ากรมธรรม์</p>
      </section>

      <form action={action} className="flex flex-wrap items-center gap-3" onSubmit={cf.guard(confirmText, {}, !!confirmText)}>{cf.dialog}
        <input type="hidden" name="policy_id" value={policyId} />
        <input type="hidden" name="lines" value={JSON.stringify(lines)} />
        <button disabled={pending || errors.length > 0 || (lines.length === 0 && !hasRows)} className={btn}>
          {pending ? "กำลังบันทึก…" : lines.length ? `บันทึกตารางมูลค่าเวนคืน (${lines.length} ปี)` : "บันทึก (ล้างตาราง)"}</button>
        {errors.length > 0 && <span className="text-sm text-red-600">{errors[0]}{errors.length > 1 ? ` (และอีก ${errors.length - 1} จุด)` : ""}</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="text-sm text-emerald-700" />
      </form>
    </div>
  ));
}
