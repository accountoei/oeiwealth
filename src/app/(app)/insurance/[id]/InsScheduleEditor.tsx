"use client";

import { useActionState, useMemo, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { saveInsSchedule, type ActionState } from "../actions";
import { generateAmountSchedule, parseAmountRows, parseAmountText, type AmountLine } from "@/lib/insurance-schedule";
import { fillDown, gridNum, gridToLines, guessEvery, nextRow, sortGrid, type GridLine } from "@/lib/insurance-grid";
import { SMALL_BTN, BENEFIT_TYPE_LABEL, money, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import Flash from "@/components/Flash";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const cell = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50";
const link = "rounded px-1.5 py-1 text-xs text-blue-700 hover:bg-blue-50";

/** งวดปัจจุบันของกรมธรรม์ (จาก v_insurance_schedule_status) */
export type SchedCurrent = { id: string; due_date: string; amount: number; benefit_type: string | null; notes: string | null; skipped: boolean; paid_amount: number };

type Mode = "GRID" | "FORMULA" | "TEXT";
let seq = 0;
const newKey = () => `n${++seq}`;

/**
 * ตั้ง / แก้ตารางเบี้ย (PREMIUM) หรือตารางผลประโยชน์ (BENEFIT) ทั้งชุด (ตกลง 4 พ.ย. 2026 · แบบ "ตั้ง / แก้ตารางผ่อน" ของสินเชื่อ)
 *   เริ่มจาก: ตารางปัจจุบัน · ยอดเท่ากันทุกงวด (สูตร) · อัปโหลด / วางจาก Excel → ลงตารางเดียวกัน แก้ทีละช่อง แล้วค่อยบันทึก
 *   แต่ละแถว: วันครบกำหนด · ยอด · ชนิดผลประโยชน์ · ไม่ได้จ่าย / ไม่ได้รับ · หมายเหตุ · แทรก / ลบ / ใช้ยอดนี้กับงวดถัดไป
 *   งวดที่จ่าย / รับแล้วล็อกไว้ (ฐานข้อมูลเก็บไว้เอง) · บันทึก = แทนงวดที่ยังไม่ชำระทั้งชุด · ตารางว่าง = ลบงวดที่ยังไม่ชำระ
 */
export default function InsScheduleEditor({ policyId, kind, currency, current, goLive, defaultAmount, defaultFirstDue }: {
  policyId: string; kind: "PREMIUM" | "BENEFIT"; currency: string; current: SchedCurrent[]; goLive: string | null;
  defaultAmount?: number; defaultFirstDue: string;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const prem = kind === "PREMIUM";
  const label = prem ? "ตารางเบี้ย" : "ตารางผลประโยชน์";
  const hasLines = current.length > 0;
  const defType = prem ? "" : "CASH_BACK";
  const toRows = (): GridLine[] => sortGrid(current.map((x) => ({
    key: x.id, due: x.due_date, amount: Number(x.amount).toFixed(2), type: x.benefit_type ?? defType, skipped: x.skipped, notes: x.notes ?? "",
    locked: Number(x.paid_amount) > 0 ? `${prem ? "จ่าย" : "รับ"}แล้ว ${money(x.paid_amount)}` : null,
  })));
  const [mode, setMode] = useState<Mode>("GRID");
  const [rows, setRows] = useState<GridLine[]>(toRows);
  // สูตร: ยอดเท่ากันทุกงวด
  const [amount, setAmount] = useState(defaultAmount ? defaultAmount.toFixed(2) : "");
  const [every, setEvery] = useState(prem ? "12" : "24");
  const [by, setBy] = useState<"COUNT" | "UNTIL">("COUNT");
  const [count, setCount] = useState(prem ? "10" : "1");
  const [until, setUntil] = useState("");
  const [first, setFirst] = useState(defaultFirstDue);
  const [btype, setBtype] = useState(defType);
  const [calcErr, setCalcErr] = useState("");
  // Excel / วาง
  const [text, setText] = useState("");
  const [fileMsg, setFileMsg] = useState("");
  const parsed = useMemo(() => parseAmountText(text), [text]);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveInsSchedule, {});
  const cf = useConfirmSubmit();
  const { lines, errors } = useMemo(() => gridToLines(rows, kind, goLive), [rows, kind, goLive]);

  // เปิดใหม่ทุกครั้ง = เริ่มจากตารางล่าสุด (หลังบันทึก / จ่ายเพิ่ม)
  const trigger = <button type="button" onClick={() => { if (!open) { setRows(toRows()); setMode("GRID"); } setOpen(!open); }}
    className={activeCls(hasLines ? obtn : btn)}>{hasLines ? `แก้${label}` : `+ ตั้ง${label}`}</button>;
  if (!open) return trigger;

  const locked = rows.filter((r) => r.locked);
  const editable = rows.length - locked.length;
  const total = rows.reduce((s, r) => s + (r.skipped ? 0 : Math.max(0, gridNum(r.amount) || 0)), 0);
  const pre = goLive ? rows.filter((r) => !r.locked && r.due && r.due < goLive).length : 0;
  const patch = (i: number, p: Partial<GridLine>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const insertAfter = (i: number) => {
    const every = guessEvery(rows.slice(0, i + 1));
    const n = [...rows]; n.splice(i + 1, 0, nextRow(rows[i], every, newKey(), defaultFirstDue));
    setRows(n);
  };
  const addLast = () => setRows([...rows, nextRow(rows.at(-1), guessEvery(rows), newKey(), defaultFirstDue)]);
  // ผลจากสูตร / Excel: แทนงวดที่ยังไม่ชำระ หรือเพิ่มเข้าตาราง
  const put = (ls: AmountLine[], type: string, how: "replace" | "add") => {
    const add: GridLine[] = ls.map((l) => ({ key: newKey(), due: l.due_date, amount: l.amount.toFixed(2), type, skipped: false, notes: l.notes ?? "" }));
    setRows(sortGrid([...(how === "replace" ? locked : rows), ...add]));
    setMode("GRID");
  };
  const calc = (how: "replace" | "add") => {
    const r = generateAmountSchedule({ amount: gridNum(amount), everyMonths: Number(every), firstDue: first,
      periods: by === "COUNT" ? gridNum(count) : undefined, until: by === "UNTIL" ? until : undefined });
    setCalcErr(r.error ?? "");
    if (!r.error) put(r.lines, btype, how);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileMsg("กำลังอ่านไฟล์…");
    try {
      const { default: readXlsxFile } = await import("read-excel-file/universal");
      const sheets = (await readXlsxFile(f)) as { sheet: string; data: unknown[][] }[];
      const sh = sheets.find((x) => parseAmountRows(x.data).lines.length > 0);
      if (!sh) { setFileMsg("ไม่พบงวดในไฟล์ — ต้องมีคอลัมน์วันที่ และยอด (เช่น หัวตาราง \"วันครบกำหนด\" / \"เบี้ยประกัน\")"); return; }
      const r = parseAmountRows(sh.data);
      setText(r.lines.map((l) => [l.due_date, l.amount.toFixed(2), l.notes ?? ""].join("\t").trimEnd()).join("\n"));
      setFileMsg(`อ่านแผ่นงาน "${sh.sheet}" ได้ ${r.lines.length} งวด${r.skipped ? ` · ข้ามยอด 0 จำนวน ${r.skipped} แถว` : ""} · กด "ใส่ลงตาราง" ด้านล่าง`);
    } catch { setFileMsg("อ่านไฟล์ไม่ได้ — รองรับเฉพาะ .xlsx (ถ้าเป็น .xls ให้เปิดใน Excel แล้ว Save As เป็น .xlsx)"); }
  };
  const typeSelect = (value: string, onChange: (v: string) => void, cls = input) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
      {Object.entries(BENEFIT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
  const confirmText = lines.length === 0
    ? `ลบงวดที่ยังไม่ชำระทั้งหมดของ${label}?`
    : hasLines ? `แทนงวดที่ยังไม่ชำระด้วยตารางนี้ (${lines.length} งวด)?` : "";

  return present(trigger, (
    <div className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-5 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-slate-900">ตั้ง / แก้{label}</h3>
          <p className="text-xs text-slate-500">เริ่มจากตารางเดิม / สูตร / Excel แล้วแก้ในตารางทีละช่องได้ · ดูผลก่อนกดบันทึก ·
            งวดที่{prem ? "จ่าย" : "รับ"}แล้วล็อกไว้ (แก้ที่แถวการ{prem ? "จ่าย" : "รับ"}ในแท็บเบี้ยและผลประโยชน์){goLive ? ` · งวดก่อน Go-live (${thDate(goLive)}) เป็นประวัติ นับว่า${prem ? "จ่าย" : "รับ"}แล้วโดยไม่มีเงินเข้า–ออก` : ""}</p>
        </div>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
      </div>

      <label className="block text-sm">เริ่มจาก
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={input}>
          <option value="GRID">{hasLines ? "ตารางปัจจุบัน · แก้ในตารางด้านล่าง" : "ใส่เองทีละงวดในตารางด้านล่าง"}</option>
          <option value="FORMULA">ยอดเท่ากันทุกงวด (คำนวณจากสูตร)</option>
          <option value="TEXT">อัปโหลด / วางจาก Excel</option>
        </select>
      </label>

      {mode === "FORMULA" && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">ยอดต่องวด ({currency})<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={input} /></label>
            <label className="text-sm">ทุก
              <select value={every} onChange={(e) => setEvery(e.target.value)} className={input}>
                <option value="1">ทุกเดือน</option><option value="3">ทุก 3 เดือน</option><option value="6">ทุก 6 เดือน</option>
                <option value="12">ทุกปี</option><option value="24">ทุก 2 ปี</option><option value="36">ทุก 3 ปี</option><option value="60">ทุก 5 ปี</option>
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
            {!prem && <label className="text-sm">ชนิดผลประโยชน์{typeSelect(btype, setBtype)}</label>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => calc("replace")} className={obtn}>คำนวณ → แทนงวดที่ยังไม่ชำระ</button>
            {editable > 0 && <button type="button" onClick={() => calc("add")} className={obtn}>คำนวณ → เพิ่มเข้าตาราง</button>}
            {calcErr && <span className="text-sm text-red-600">{calcErr}</span>}
          </div>
          {!prem && <p className="text-xs text-slate-500">เช่น เงินคืนทุก 2 ปี 5 งวด → &ldquo;แทนงวดที่ยังไม่ชำระ&rdquo; แล้วเปลี่ยนชนิดเป็นครบสัญญา 1 งวด → &ldquo;เพิ่มเข้าตาราง&rdquo;</p>}
        </section>
      )}

      {mode === "TEXT" && (
        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">อัปโหลดไฟล์ Excel (.xlsx)
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => onFile(e.target.files?.[0])}
                className="mt-1 block text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm" />
            </label>
            {!prem && <label className="w-56 text-sm">ชนิดผลประโยชน์ (ทุกแถวที่วาง){typeSelect(btype, setBtype)}</label>}
          </div>
          {fileMsg && <p className="text-xs text-slate-600">{fileMsg}</p>}
          <p className="text-xs text-slate-500">หรือวาง: 1 บรรทัด = 1 งวด · <b>วันครบกำหนด · ยอด · หมายเหตุ</b> (มีหัวตาราง &ldquo;เบี้ย&rdquo; / &ldquo;จำนวนเงิน&rdquo; ก็ได้) ·
            วันที่ใช้ 15 มิ.ย. 68, 15/06/2568 หรือ 2025-06-15 ได้ · ไฟล์อ่านในเครื่อง ไม่ถูกเก็บ</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} data-plain
            placeholder={"2026-11-15\t25000.00\n2027-11-15\t26500.00"} className="block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" />
          {parsed.errors.length > 0 && <ul className="text-xs text-red-600">{parsed.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={parsed.lines.length === 0} onClick={() => put(parsed.lines, btype, "replace")} className={obtn}>
              ใส่ลงตาราง · แทนงวดที่ยังไม่ชำระ{parsed.lines.length ? ` (${parsed.lines.length} งวด)` : ""}</button>
            {editable > 0 && <button type="button" disabled={parsed.lines.length === 0} onClick={() => put(parsed.lines, btype, "add")} className={obtn}>เพิ่มเข้าตาราง</button>}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium text-slate-800">{label}{rows.length ? ` ${rows.length} งวด` : ""}</span>
          <span className="text-xs text-slate-500">รวม {money(total, currency)}{locked.length > 0 && ` · ล็อก ${locked.length} งวด`}{pre > 0 && ` · ก่อน Go-live ${pre} งวด`}</span>
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="sticky top-0 z-10 bg-white text-left text-xs text-slate-500">
              <tr><th className="w-10 py-1">งวด</th><th className="w-40">ครบกำหนด</th><th className="w-36 pr-2 text-right">ยอด</th>
                {!prem && <th className="w-44 pl-2">ชนิด</th>}
                <th className="w-24 text-center">{prem ? "ไม่ได้จ่าย" : "ไม่ได้รับ"}</th><th>หมายเหตุ</th><th className="w-40"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => r.locked ? (
                <tr key={r.key} className="bg-slate-50 text-slate-500">
                  <td className="py-1.5 pl-1">{i + 1}</td><td>{thDate(r.due)}</td>
                  <td className="text-right tabular-nums">{money(gridNum(r.amount))}</td>
                  {!prem && <td className="text-xs">{BENEFIT_TYPE_LABEL[r.type] ?? "-"}</td>}
                  <td /><td className="text-xs">{r.notes}</td>
                  <td className="text-right text-xs">🔒 {r.locked}</td>
                </tr>
              ) : (
                <tr key={r.key} className={r.skipped ? "text-slate-400" : ""}>
                  <td className="py-1 pl-1 align-top">{i + 1}</td>
                  <td className="px-1 py-1">
                    <input type="date" value={r.due} onChange={(e) => patch(i, { due: e.target.value })} onBlur={() => setRows(sortGrid(rows))}
                      aria-label={`วันครบกำหนดงวดที่ ${i + 1}`} className={cell} />
                    {goLive && r.due && r.due < goLive && <span className="text-[11px] text-slate-500">ก่อน Go-live</span>}
                  </td>
                  <td className="px-1 py-1 align-top"><input value={r.amount} onChange={(e) => patch(i, { amount: e.target.value })} inputMode="decimal"
                    aria-label={`ยอดงวดที่ ${i + 1}`} className={`${cell} text-right tabular-nums ${r.skipped ? "line-through" : ""}`} /></td>
                  {!prem && <td className="px-1 py-1 align-top">{typeSelect(r.type || "OTHER", (v) => patch(i, { type: v }), cell)}</td>}
                  <td className="px-1 py-1 text-center align-top"><input type="checkbox" checked={r.skipped} onChange={(e) => patch(i, { skipped: e.target.checked })}
                    aria-label={`${prem ? "ไม่ได้จ่าย" : "ไม่ได้รับ"}งวดที่ ${i + 1}`} className="mt-2" /></td>
                  <td className="px-1 py-1 align-top"><input value={r.notes} onChange={(e) => patch(i, { notes: e.target.value })} maxLength={200}
                    aria-label={`หมายเหตุงวดที่ ${i + 1}`} className={cell} /></td>
                  <td className="whitespace-nowrap px-1 py-1 text-right align-top">
                    <button type="button" onClick={() => insertAfter(i)} title="แทรกงวดต่อจากงวดนี้" className={link}>+ แทรก</button>
                    {rows.slice(i + 1).some((x) => !x.locked) && <button type="button" onClick={() => setRows(fillDown(rows, i))}
                      title="ใช้ยอดนี้กับงวดถัดไปทั้งหมด (เช่น เบี้ยขึ้นตามอายุ)" className={link}>ยอดนี้ ↓</button>}
                    <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} title="ลบงวดนี้" className="rounded px-1.5 py-1 text-xs text-red-600 hover:bg-red-50">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" onClick={addLast} className={SMALL_BTN}>+ เพิ่มงวดท้ายตาราง</button>
          {rows.length === 0 && <span className="text-sm text-slate-500">ยังไม่มีงวด — คำนวณจากสูตร วางจาก Excel หรือกดเพิ่มงวด</span>}
        </div>
        <p className="mt-1 text-xs text-slate-500">ยอดนี้ ↓ = ใช้ยอดของงวดนี้กับงวดถัดไปทั้งหมด · ออกจากช่องวันที่แล้วเรียงตามวันที่ให้เอง · งวดที่เพิ่มใช้วันที่ถัดไปตามรอบของงวดก่อนหน้า</p>
      </section>

      <form action={action} className="flex flex-wrap items-center gap-3" onSubmit={cf.guard(confirmText, {}, !!confirmText)}>{cf.dialog}
        <input type="hidden" name="policy_id" value={policyId} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="lines" value={JSON.stringify(lines)} />
        <button disabled={pending || errors.length > 0 || (lines.length === 0 && !hasLines)} className={btn}>
          {pending ? "กำลังบันทึก…" : lines.length ? `บันทึก${label} (${lines.length} งวด)` : "บันทึก (ลบงวดที่ยังไม่ชำระ)"}</button>
        {errors.length > 0 && <span className="text-sm text-red-600">{errors[0]}{errors.length > 1 ? ` (และอีก ${errors.length - 1} จุด)` : ""}</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="text-sm text-emerald-700" />
      </form>
    </div>
  ));
}
