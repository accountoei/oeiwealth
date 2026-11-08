"use client";

import { useActionState, useMemo, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { saveBookletSchedule, type ActionState } from "../actions";
import { generateAmountSchedule } from "@/lib/insurance-schedule";
import {
  bookEvery, bookFillDown, bookLocked, bookNextRow, bookNotes, bookPut, bookRows, bookSetCell, bookSetNotes, bookSetSkipped, bookSkipped,
  bookToParts, bookTotal, gridNum, parseBookTable, sortBook, type BookCurrent, type BookRow,
} from "@/lib/insurance-grid";
import { toIsoDate, toNum } from "@/lib/loan-schedule";
import { SMALL_BTN, SMALL_DEL_BTN, money, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import Flash from "@/components/Flash";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const cell = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50";
const link = "rounded px-1.5 py-1 text-xs text-blue-700 hover:bg-blue-50";

/** ส่วนของเล่ม (สัญญาหลักก่อน) · ยอด / วันที่ตั้งต้นของสูตร */
export type BookletPart = { id: string; label: string; currency: string; defaultAmount: number; defaultFirstDue: string };

type Mode = "GRID" | "FORMULA" | "TEXT";
let seq = 0;
const newKey = () => `b${++seq}`;
/** วางจาก Excel: แยกช่องด้วย Tab (คัดลอกจาก Excel) หรือเว้น 2 ช่องขึ้นไป / ; */
const splitPaste = (text: string) => text.split(/\r?\n/).map((raw) => (raw.includes("\t") ? raw.split("\t") : raw.trim().split(/\s{2,}|\s*;\s*/)));

/**
 * แก้ตารางเบี้ยทั้งเล่ม (ตกลง 8 พ.ย. 2026 · ปุ่มเดียวแทนปุ่มละส่วน): 1 แถว = 1 วันครบกำหนด · คอลัมน์ละส่วน (ชีวิต / สุขภาพ …) + รวม
 *   เริ่มจาก: ตารางปัจจุบัน · ยอดเท่ากันทุกงวด (สูตร · ทีละส่วน) · อัปโหลด / วางจาก Excel (วันที่ · ยอดส่วนที่ 1 · ยอดส่วนที่ 2 …)
 *   ช่องที่จ่ายแล้วล็อกไว้ · ช่องว่าง = ส่วนนั้นไม่มีงวดวันนั้น · บันทึก = แทนงวดที่ยังไม่ชำระของทุกส่วนพร้อมกัน (ผิดส่วนเดียว = ไม่บันทึกเลย)
 */
export default function BookletScheduleEditor({ parts, current, goLive }: { parts: BookletPart[]; current: BookCurrent[]; goLive: string | null }) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const ids = parts.map((p) => p.id);
  const ccys = [...new Set(parts.map((p) => p.currency))];
  const oneCcy = ccys.length === 1;
  const hasLines = current.length > 0;
  const toRows = () => sortBook(bookRows(current.filter((x) => ids.includes(x.policy_id)), newKey));
  const [mode, setMode] = useState<Mode>("GRID");
  const [rows, setRows] = useState<BookRow[]>(toRows);
  // สูตร: ยอดเท่ากันทุกงวด ทีละส่วน
  const [fpart, setFpart] = useState(parts[0]?.id ?? "");
  const fp = parts.find((p) => p.id === fpart) ?? parts[0];
  const [amount, setAmount] = useState(fp?.defaultAmount ? fp.defaultAmount.toFixed(2) : "");
  const [every, setEvery] = useState("12");
  const [by, setBy] = useState<"COUNT" | "UNTIL">("COUNT");
  const [count, setCount] = useState("10");
  const [until, setUntil] = useState("");
  const [first, setFirst] = useState(fp?.defaultFirstDue ?? "");
  const [calcErr, setCalcErr] = useState("");
  // Excel / วาง
  const [text, setText] = useState("");
  const [fileMsg, setFileMsg] = useState("");
  const parsed = useMemo(() => parseBookTable(splitPaste(text), parts.length, toIsoDate, toNum), [text, parts.length]);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBookletSchedule, {});
  const cf = useConfirmSubmit();
  const out = useMemo(() => bookToParts(rows, parts, goLive), [rows, parts, goLive]);

  // เปิดใหม่ทุกครั้ง = เริ่มจากตารางล่าสุด (หลังบันทึก / จ่ายเพิ่ม)
  const trigger = <button type="button" onClick={() => { if (!open) { setRows(toRows()); setMode("GRID"); } setOpen(!open); }}
    className={activeCls(hasLines ? obtn : btn)}>{hasLines ? "แก้ตารางเบี้ย" : "+ ตั้งตารางเบี้ย"}</button>;
  if (!open) return trigger;

  const pickPart = (pid: string) => {
    const x = parts.find((p) => p.id === pid);
    setFpart(pid);
    if (x) { setAmount(x.defaultAmount ? x.defaultAmount.toFixed(2) : ""); setFirst(x.defaultFirstDue); }
  };
  const lockedCells = rows.reduce((s, r) => s + Object.values(r.cells).filter((c) => c.locked).length, 0);
  const editable = rows.filter((r) => !bookLocked(r)).length;
  const sumOf = (pid: string) => rows.reduce((s, r) => { const c = r.cells[pid]; return s + (!c || c.skipped ? 0 : Math.max(0, gridNum(c.amount) || 0)); }, 0);
  const pre = goLive ? rows.filter((r) => !bookLocked(r) && r.due && r.due < goLive).length : 0;
  const insertAfter = (i: number) => {
    const n = [...rows]; n.splice(i + 1, 0, bookNextRow(rows[i], bookEvery(rows.slice(0, i + 1)), newKey(), parts[0]?.defaultFirstDue ?? "", ids));
    setRows(n);
  };
  const addLast = () => setRows([...rows, bookNextRow(rows.at(-1), bookEvery(rows), newKey(), parts[0]?.defaultFirstDue ?? "", ids)]);
  const put = (data: { due: string; amounts: (number | null)[] }[], how: "replace" | "add") => { setRows(bookPut(rows, ids, data, how, newKey)); setMode("GRID"); };
  const calc = (how: "replace" | "add") => {
    const r = generateAmountSchedule({ amount: gridNum(amount), everyMonths: Number(every), firstDue: first,
      periods: by === "COUNT" ? gridNum(count) : undefined, until: by === "UNTIL" ? until : undefined });
    setCalcErr(r.error ?? "");
    const k = ids.indexOf(fp?.id ?? "");
    if (!r.error && k >= 0) put(r.lines.map((l) => ({ due: l.due_date, amounts: ids.map((_, j) => (j === k ? l.amount : null)) })), how);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileMsg("กำลังอ่านไฟล์…");
    try {
      const { default: readXlsxFile } = await import("read-excel-file/universal");
      const sheets = (await readXlsxFile(f)) as { sheet: string; data: unknown[][] }[];
      const sh = sheets.find((x) => parseBookTable(x.data, parts.length, toIsoDate, toNum).data.length > 0);
      if (!sh) { setFileMsg(`ไม่พบงวดในไฟล์ — ต้องมีคอลัมน์วันที่ แล้วตามด้วยยอด ${parts.map((p) => p.label).join(" · ")}`); return; }
      const r = parseBookTable(sh.data, parts.length, toIsoDate, toNum);
      setText(r.data.map((d) => [d.due, ...d.amounts.map((a) => (a == null ? "" : a.toFixed(2)))].join("\t")).join("\n"));
      setFileMsg(`อ่านแผ่นงาน "${sh.sheet}" ได้ ${r.data.length} วันครบกำหนด · กด "ใส่ลงตาราง" ด้านล่าง`);
    } catch { setFileMsg("อ่านไฟล์ไม่ได้ — รองรับเฉพาะ .xlsx (ถ้าเป็น .xls ให้เปิดใน Excel แล้ว Save As เป็น .xlsx)"); }
  };
  const confirmText = out.count === 0
    ? "ลบงวดที่ยังไม่ชำระทั้งหมดของทุกส่วนในเล่ม?"
    : hasLines ? `แทนงวดที่ยังไม่ชำระของทุกส่วนด้วยตารางนี้ (${out.count} งวด)?` : "";
  const colHead = parts.map((p) => p.label).join(" · ");

  return present(trigger, (
    <div className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-5 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-slate-900">ตั้ง / แก้ตารางเบี้ยทั้งเล่ม</h3>
          <p className="text-xs text-slate-500">1 แถว = 1 วันครบกำหนด · คอลัมน์ละส่วน ({colHead}) · ช่องว่าง = ส่วนนั้นไม่มีงวดวันนั้น ·
            ช่องที่จ่ายแล้วล็อกไว้ (แก้ที่แถวการจ่ายในตารางของหน้ากรมธรรม์) · บันทึกทุกส่วนพร้อมกัน ผิดส่วนเดียว = ยังไม่บันทึกเลย
            {goLive ? ` · งวดก่อน Go-live (${thDate(goLive)}) เป็นประวัติ นับว่าจ่ายแล้วโดยไม่มีเงินออก` : ""}</p>
        </div>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
      </div>

      <label className="block text-sm">เริ่มจาก
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={input}>
          <option value="GRID">{hasLines ? "ตารางปัจจุบัน · แก้ในตารางด้านล่าง" : "ใส่เองทีละงวดในตารางด้านล่าง"}</option>
          <option value="FORMULA">ยอดเท่ากันทุกงวด (คำนวณจากสูตร ทีละส่วน)</option>
          <option value="TEXT">อัปโหลด / วางจาก Excel</option>
        </select>
      </label>

      {mode === "FORMULA" && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">ส่วน
              <select value={fp?.id ?? ""} onChange={(e) => pickPart(e.target.value)} className={input}>
                {parts.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-sm">ยอดต่องวด ({fp?.currency ?? "THB"})<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={input} /></label>
            <label className="text-sm">ทุก
              <select value={every} onChange={(e) => setEvery(e.target.value)} className={input}>
                <option value="1">ทุกเดือน</option><option value="3">ทุก 3 เดือน</option><option value="6">ทุก 6 เดือน</option>
                <option value="12">ทุกปี</option><option value="24">ทุก 2 ปี</option>
              </select>
            </label>
            <label className="text-sm">ครบกำหนดงวดแรก<input type="date" value={first} onChange={(e) => setFirst(e.target.value)} className={input} /></label>
            <label className="text-sm">กำหนดจาก
              <select value={by} onChange={(e) => setBy(e.target.value as "COUNT" | "UNTIL")} className={input}>
                <option value="COUNT">จำนวนงวด</option><option value="UNTIL">จนถึงวันที่</option>
              </select>
            </label>
            {by === "COUNT"
              ? <label className="text-sm">จำนวนงวด<input value={count} onChange={(e) => setCount(e.target.value)} name="quantity" inputMode="decimal" className={input} /></label>
              : <label className="text-sm">งวดสุดท้ายไม่เกินวันที่<input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={input} /></label>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => calc("replace")} className={obtn}>คำนวณ → แทนงวดที่ยังไม่ชำระของ{fp?.label}</button>
            {editable > 0 && <button type="button" onClick={() => calc("add")} className={obtn}>คำนวณ → เพิ่มเข้าตาราง</button>}
            {calcErr && <span className="text-sm text-red-600">{calcErr}</span>}
          </div>
          <p className="text-xs text-slate-500">ทำทีละส่วน: เลือกส่วน → คำนวณ แล้วเลือกส่วนถัดไป → คำนวณอีกครั้ง · ส่วนที่ไม่ได้เลือกไม่ถูกแตะ · เบี้ยขึ้นตามอายุ ใช้ &ldquo;ยอดนี้ ↓&rdquo; ในตาราง</p>
        </section>
      )}

      {mode === "TEXT" && (
        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <label className="block text-sm">อัปโหลดไฟล์ Excel (.xlsx)
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => onFile(e.target.files?.[0])}
              className="mt-1 block text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm" />
          </label>
          {fileMsg && <p className="text-xs text-slate-600">{fileMsg}</p>}
          <p className="text-xs text-slate-500">หรือวาง: 1 บรรทัด = 1 วันครบกำหนด · คอลัมน์ <b>วันครบกำหนด · {colHead}</b> ตามลำดับนี้ (มีหัวตารางก็ได้) ·
            ช่องว่าง / &ldquo;-&rdquo; / 0 = ส่วนนั้นไม่มีงวดวันนั้น · วันที่ใช้ 15 มิ.ย. 68, 15/06/2568 หรือ 2025-06-15 ได้ · ไฟล์อ่านในเครื่อง ไม่ถูกเก็บ</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} data-plain
            placeholder={parts.length > 1 ? "2026-07-20\t1402.00\t2500.00\n2027-07-20\t1402.00\t2800.00" : "2026-07-20\t1402.00"}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" />
          {parsed.errors.length > 0 && <ul className="text-xs text-red-600">{parsed.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>}
          {parsed.data.length > 0 && <p className="text-xs text-slate-600">อ่านได้ {parsed.data.length} วันครบกำหนด · {parts.map((p, k) => `${p.label} ${parsed.data.filter((d) => d.amounts[k] != null).length} งวด`).join(" · ")}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={parsed.data.length === 0} onClick={() => put(parsed.data, "replace")} className={obtn}>
              ใส่ลงตาราง · แทนงวดที่ยังไม่ชำระ</button>
            {editable > 0 && <button type="button" disabled={parsed.data.length === 0} onClick={() => put(parsed.data, "add")} className={obtn}>เพิ่มเข้าตาราง</button>}
          </div>
          <p className="text-xs text-slate-500">แทนงวดที่ยังไม่ชำระ = เฉพาะส่วนที่มียอดในข้อมูลที่วาง (เช่น วางแค่คอลัมน์สุขภาพ ส่วนชีวิตไม่ถูกแตะ)</p>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium text-slate-800">ตารางเบี้ยทั้งเล่ม{rows.length ? ` ${rows.length} วันครบกำหนด` : ""}</span>
          <span className="text-xs text-slate-500">{parts.map((p) => `${p.label} ${money(sumOf(p.id), p.currency)}`).join(" · ")}
            {lockedCells > 0 && ` · ล็อก ${lockedCells} งวด`}{pre > 0 && ` · ก่อน Go-live ${pre} แถว`}</span>
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-sm" style={{ minWidth: `${40 + parts.length * 8}rem` }}>
            <thead className="sticky top-0 z-10 bg-white text-left text-xs text-slate-500">
              <tr><th className="w-10 py-1">งวด</th><th className="w-36">ครบกำหนด</th>
                {parts.map((p) => <th key={p.id} className="w-32 pr-2 text-right">{p.label}{oneCcy ? "" : ` (${p.currency})`}</th>)}
                {oneCcy && parts.length > 1 && <th className="w-28 pr-2 text-right">รวม</th>}
                <th className="w-20 text-center">ไม่ได้จ่าย</th><th className="min-w-[8rem]">หมายเหตุ</th><th className="w-40"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => {
                const lk = bookLocked(r);
                const free = parts.some((p) => !r.cells[p.id]?.locked);
                const skip = bookSkipped(r);
                return (
                  <tr key={r.key} className={lk && !free ? "bg-slate-50 text-slate-500" : skip ? "text-slate-400" : ""}>
                    <td className="py-1 pl-1 align-top">{i + 1}</td>
                    <td className="px-1 py-1 align-top">
                      {lk ? <span className="block py-1">{thDate(r.due)}</span>
                        : <input type="date" value={r.due} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))}
                          onBlur={() => setRows(sortBook(rows))} aria-label={`วันครบกำหนดแถวที่ ${i + 1}`} className={cell} />}
                      {goLive && !lk && r.due && r.due < goLive && <span className="text-[11px] text-slate-500">ก่อน Go-live</span>}
                    </td>
                    {parts.map((p) => {
                      const c = r.cells[p.id];
                      return c?.locked
                        ? <td key={p.id} className="px-1 py-1 text-right align-top text-xs text-slate-500" title={c.locked}>
                          <span className="block py-1 text-sm tabular-nums">🔒 {money(gridNum(c.amount))}</span></td>
                        : <td key={p.id} className="px-1 py-1 align-top">
                          <input value={c?.amount ?? ""} onChange={(e) => setRows(bookSetCell(rows, i, p.id, e.target.value))} inputMode="decimal"
                            aria-label={`${p.label} แถวที่ ${i + 1}`} placeholder="-"
                            className={`${cell} text-right tabular-nums ${c?.skipped ? "line-through" : ""}`} /></td>;
                    })}
                    {oneCcy && parts.length > 1 && <td className="px-1 py-1 pr-2 text-right align-top tabular-nums"><span className="block py-1">{money(bookTotal(r))}</span></td>}
                    <td className="px-1 py-1 text-center align-top">
                      {free && <input type="checkbox" checked={skip} onChange={(e) => setRows(bookSetSkipped(rows, i, e.target.checked))}
                        aria-label={`ไม่ได้จ่ายแถวที่ ${i + 1}`} className="mt-2" />}</td>
                    <td className="px-1 py-1 align-top">
                      {free ? <input value={bookNotes(r)} onChange={(e) => setRows(bookSetNotes(rows, i, e.target.value))} maxLength={200}
                        aria-label={`หมายเหตุแถวที่ ${i + 1}`} className={cell} />
                        : <span className="block py-1 text-xs">{Object.values(r.cells).map((c) => c.notes).filter(Boolean).join(" · ")}</span>}
                    </td>
                    <td className="whitespace-nowrap px-1 py-1 text-right align-top">
                      <button type="button" onClick={() => insertAfter(i)} title="แทรกวันครบกำหนดต่อจากแถวนี้" className={`${SMALL_BTN} mr-1`}>+ แทรก</button>
                      {free && rows.slice(i + 1).some((x) => !bookLocked(x)) && <button type="button" onClick={() => setRows(bookFillDown(rows, i))}
                        title="ใช้ยอดของแถวนี้กับแถวถัดไปทั้งหมด (เช่น เบี้ยขึ้นตามอายุ)" className={link}>ยอดนี้ ↓</button>}
                      {!lk && <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} title="ลบแถวนี้" className={`${SMALL_DEL_BTN} ml-1`}>ลบ</button>}
                      {lk && <span className="ml-1 text-xs text-slate-500" title={Object.values(r.cells).map((c) => c.locked).filter(Boolean).join(" · ")}>🔒 จ่ายแล้ว</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" onClick={addLast} className={SMALL_BTN}>+ เพิ่มงวดท้ายตาราง</button>
          {rows.length === 0 && <span className="text-sm text-slate-500">ยังไม่มีงวด — คำนวณจากสูตร วางจาก Excel หรือกดเพิ่มงวด</span>}
        </div>
        <p className="mt-1 text-xs text-slate-500">ยอดนี้ ↓ = ใช้ยอดของแถวนี้กับแถวถัดไปทั้งหมด · ออกจากช่องวันที่แล้วเรียงตามวันที่ให้เอง · แถวที่เพิ่มใช้วันที่ถัดไปตามรอบของแถวก่อนหน้า ·
          แถวที่มีส่วนที่จ่ายแล้วแก้วันที่ / ลบแถวไม่ได้ แต่ใส่ยอดของส่วนที่ยังไม่จ่ายได้</p>
      </section>

      <form action={action} className="flex flex-wrap items-center gap-3" onSubmit={cf.guard(confirmText, {}, !!confirmText)}>{cf.dialog}
        <input type="hidden" name="parts" value={JSON.stringify(out.parts)} />
        <button disabled={pending || out.errors.length > 0 || (out.count === 0 && !hasLines)} className={btn}>
          {pending ? "กำลังบันทึก…" : out.count ? `บันทึกตารางเบี้ยทั้งเล่ม (${out.count} งวด)` : "บันทึก (ลบงวดที่ยังไม่ชำระ)"}</button>
        {out.errors.length > 0 && <span className="text-sm text-red-600">{out.errors[0]}{out.errors.length > 1 ? ` (และอีก ${out.errors.length - 1} จุด)` : ""}</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="text-sm text-emerald-700" />
      </form>
    </div>
  ));
}
