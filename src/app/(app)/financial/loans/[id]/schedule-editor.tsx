"use client";

import { useActionState, useMemo, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { saveSchedule, type ActionState } from "../actions";
import { generateSchedule, lastDueOf, MAX_PERIODS, openingFromSchedule, parseScheduleRows, parseScheduleText, PAYMENT_LABEL, periodsUntil, SCHED_METHOD_LABEL,
  type SchedBasis, type SchedLine, type SchedMethod } from "@/lib/loan-schedule";
import { money, thDate, numOrZero as num } from "@/lib/format";
import { DayCountFields } from "./day-count";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import Flash from "@/components/Flash";
import ScheduleGrid, { rowsToLines, toRows, type GridRow } from "../ScheduleGrid";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";

/**
 * ตั้ง / แก้ตารางผ่อนทั้งชุด
 * เริ่มจาก: ตารางปัจจุบัน · คำนวณจากสูตร · อัปโหลด / วางจาก Excel → ผลลงตารางที่แก้ได้ทีละช่อง (ScheduleGrid)
 *   แก้วันที่ / เงินต้น → ดอกเบี้ยงวดถัดไปคิดใหม่ทันที · แทรก / ลบงวดได้ (ตกลง 2 พ.ย. 2026)
 * ไฟล์ .xlsx อ่านในเบราว์เซอร์ (ไม่ส่งไฟล์ขึ้น Server · ไม่เก็บไฟล์) · บันทึก = แทนที่ตารางเดิมทั้งชุด
 * สัญญาก่อน Go-live: เทียบยอดตั้งต้นกับตาราง · ติ๊กให้ปรับยอดตั้งต้นตามตารางพร้อมบันทึกได้
 */
type Mode = "GRID" | "FORMULA" | "TEXT";
type XSheet = { sheet: string; data: unknown[][] };
export function ScheduleEditor({ assetId, currency, current, defaults, hasSchedule, opening }: {
  assetId: string; currency: string; current: SchedLine[]; hasSchedule: boolean;
  /** amount = เงินต้นตามสัญญา · lastDue = วันครบกำหนดสัญญา → จำนวนงวดเริ่มต้นให้งวดสุดท้ายตรงวันนี้ */
  defaults: { amount: number; ratePct: number; firstDue: string; interestFrom?: string; lastDue?: string };
  /** สัญญาที่ให้กู้ก่อน Go-live: วันตั้งต้น + ยอดตั้งต้นที่บันทึกไว้ */
  opening?: { date: string; recorded: number };
}) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const [mode, setMode] = useState<Mode>(hasSchedule ? "GRID" : "FORMULA");
  const [rows, setRows] = useState<GridRow[]>(() => toRows(current));
  const [text, setText] = useState("");
  const [calcError, setCalcError] = useState("");
  const [method, setMethod] = useState<SchedMethod>("EQUAL_PAYMENT");
  const [flat, setFlat] = useState(false);
  const [basis, setBasis] = useState<SchedBasis>("PERIODS");
  const [payment, setPayment] = useState("");
  const [amount, setAmount] = useState(defaults.amount ? defaults.amount.toFixed(2) : "");
  const [rate, setRate] = useState(defaults.ratePct ? String(defaults.ratePct) : "");
  const [every, setEvery] = useState("1");
  const [first, setFirst] = useState(defaults.firstDue);
  const [periods, setPeriods] = useState(() => String(periodsUntil(defaults.firstDue, defaults.lastDue ?? "", 1) || 12));
  const [actual, setActual] = useState(false);
  const [from, setFrom] = useState(defaults.interestFrom ?? "");
  const [sheets, setSheets] = useState<XSheet[]>([]);
  const [fileName, setFileName] = useState("");
  const [fileMsg, setFileMsg] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSchedule, {});
  const cf = useConfirmSubmit();
  const parsed = useMemo(() => parseScheduleText(text), [text]);
  const { lines, errors } = useMemo(() => rowsToLines(rows), [rows]);
  const byPayment = basis === "PAYMENT" && method !== "INTEREST_ONLY";
  const opts = { amount: num(amount), ratePct: num(rate), dayCount: actual ? "ACTUAL_365" as const : "MONTHLY" as const, interestFrom: from || undefined, flat };
  // ยอดตั้งต้นตามตาราง (คิดจากเงินต้นตามสัญญาที่บันทึกไว้ — ฝั่ง Server คิดซ้ำตอนบันทึก)
  const o = opening && lines.length ? openingFromSchedule(defaults.amount, lines, opening.date) : null;
  const openingDiff = !!(o && o.outstanding >= 0 && Math.abs(o.outstanding - opening!.recorded) > 0.005);
  const [syncOpening, setSyncOpening] = useState(true);

  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(hasSchedule ? obtn : btn)}>{hasSchedule ? "แก้ตารางผ่อนทั้งชุด" : "+ ตั้งตารางผ่อน"}</button>;
  if (!open) return trigger;

  const fill = (ls: SchedLine[], isFlat = false) => { setRows(toRows(ls)); setFlat(isFlat); setMode("GRID"); };
  // อ่านแผ่นงาน → ลงตาราง (ใช้หัวตาราง "เงินต้น" / "ดอกเบี้ย" · ข้ามแถวยอด 0 · วันที่ พ.ศ. แปลงให้)
  const pickSheet = (list: XSheet[], name: string) => {
    const sh = list.find((x) => x.sheet === name);
    if (!sh) return;
    const r = parseScheduleRows(sh.data);
    if (r.lines.length) { setRows(toRows(r.lines)); setFlat(false); }
    setFileMsg(r.lines.length === 0
      ? `แผ่นงาน "${name}" ไม่พบงวดผ่อน — ต้องมีหัวตาราง "เงินต้น" และ "ดอกเบี้ย" หรือคอลัมน์ วันที่ · เงินต้น · ดอกเบี้ย`
      : `อ่านแผ่นงาน "${name}" ได้ ${r.lines.length} งวด ลงตารางด้านล่างแล้ว${r.skipped ? ` · ข้ามงวดที่ยอดเป็น 0 จำนวน ${r.skipped} แถว` : ""}${r.errors.length ? ` · มีปัญหา ${r.errors.length} แถว: ${r.errors.slice(0, 3).join(", ")}` : ""}`);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileName(f.name); setFileMsg("กำลังอ่านไฟล์…"); setSheets([]);
    try {
      const { default: readXlsxFile } = await import("read-excel-file/universal");
      const list = (await readXlsxFile(f)) as XSheet[];
      setSheets(list);
      // เลือกแผ่นงานแรกที่อ่านงวดได้
      const firstSheet = list.find((x) => parseScheduleRows(x.data).lines.length > 0) ?? list[0];
      if (firstSheet) pickSheet(list, firstSheet.sheet);
    } catch {
      setFileMsg("อ่านไฟล์ไม่ได้ — รองรับเฉพาะไฟล์ .xlsx (ถ้าเป็น .xls ให้เปิดใน Excel แล้ว Save As เป็น .xlsx)");
    }
  };

  const calc = () => {
    const r = generateSchedule({ method, basis, amount: num(amount), ratePct: num(rate), periods: num(periods), payment: num(payment),
      firstDue: first, everyMonths: Number(every), dayCount: actual ? "ACTUAL_365" : "MONTHLY", interestFrom: from || undefined });
    setCalcError(r.error ?? "");
    if (!r.error) fill(r.lines, method === "FLAT");
  };
  const last = lastDueOf(first, num(periods), Number(every));

  return present(trigger, (
    <div className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-slate-900">ตั้ง / แก้ตารางผ่อน</h3>
          <p className="text-xs text-slate-500">เริ่มจากสูตร / Excel / ตารางเดิม แล้วแก้ในตารางทีละช่องได้ · ดูผลก่อนกดบันทึก</p>
        </div>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
      </div>

      <label className="block text-sm">เริ่มจาก
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={input}>
          <option value="GRID">{hasSchedule ? "ตารางปัจจุบัน · แก้ในตารางด้านล่าง" : "ใส่เองทีละงวดในตารางด้านล่าง"}</option>
          <option value="FORMULA">คำนวณจากสูตร</option>
          <option value="TEXT">อัปโหลด / วางจาก Excel</option>
        </select>
      </label>

      {mode === "FORMULA" && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm md:col-span-3">วิธีคิด
              <select value={method} onChange={(e) => setMethod(e.target.value as SchedMethod)} className={input}>
                {(Object.keys(SCHED_METHOD_LABEL) as SchedMethod[]).map((k) => <option key={k} value={k}>{SCHED_METHOD_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="text-sm">เงินต้นตามสัญญา ({currency})<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={input} />
              {Math.abs(num(amount) - defaults.amount) > 0.005 && <span className="mt-1 block text-xs text-amber-700">ต่างจากที่บันทึกไว้ ({money(defaults.amount)}) · แก้เงินต้นตามสัญญาที่ &ldquo;แก้ไขรายละเอียด&rdquo;</span>}</label>
            <label className="text-sm">ดอกเบี้ย % ต่อปี<input value={rate} onChange={(e) => setRate(e.target.value)} name="rate" inputMode="decimal" className={input} /></label>
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
            <label className="text-sm">ครบกำหนดงวดแรก<input type="date" value={first} onChange={(e) => setFirst(e.target.value)} className={input} /></label>
            {byPayment
              ? <label className="text-sm">{PAYMENT_LABEL[method]}<input value={payment} onChange={(e) => setPayment(e.target.value)} inputMode="decimal" className={input} /></label>
              : <>
                <label className="text-sm">จำนวนงวด<input value={periods} onChange={(e) => setPeriods(e.target.value)} name="quantity" inputMode="decimal" className={input} /></label>
                <label className="text-sm">งวดสุดท้ายครบกำหนด
                  <input type="date" value={last} min={first} onChange={(e) => { const n = periodsUntil(first, e.target.value, Number(every)); if (n) setPeriods(String(n)); }} className={input} />
                  <span className="mt-1 block text-xs text-slate-500">ใส่ช่องไหนก็ได้ อีกช่องเปลี่ยนตาม{defaults.lastDue ? ` · ครบกำหนดสัญญา ${thDate(defaults.lastDue)}` : ""}</span>
                </label>
              </>}
            <DayCountFields actual={actual} setActual={setActual} from={from} setFrom={setFrom} hint="ตั้งต้น = วันที่ให้กู้" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={calc} className={obtn}>คำนวณ → ใส่ลงตาราง</button>
            {calcError && <span className="text-sm text-red-600">{calcError}</span>}
          </div>
          <p className="text-xs text-slate-500">
            {byPayment ? "ผ่อนไปจนครบยอด ระบบนับจำนวนงวดให้ · งวดสุดท้ายเท่าที่เหลือ" : `ปัดเศษทีละงวด · งวดสุดท้ายปรับเงินต้นให้ครบยอดพอดี · จำนวนงวดสูงสุด ${MAX_PERIODS}`}
            {" "}· ผลคำนวณแทนที่ตารางด้านล่าง แล้วแก้ทีละงวดต่อได้
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
          <p className="text-xs text-slate-500">ไฟล์อ่านในเครื่องของคุณเท่านั้น ไม่ถูกอัปโหลดหรือเก็บไว้ในระบบ · ผลที่อ่านได้ลงตารางด้านล่าง แก้ได้ก่อนบันทึก</p>
          <p className="text-xs text-slate-500">
            หรือคัดลอกจาก Excel มาวาง: 1 บรรทัด = 1 งวด · ถ้าคัดลอกหัวตารางมาด้วย ระบบใช้คอลัมน์ <b>&ldquo;เงินต้น&rdquo;</b> และ <b>&ldquo;ดอกเบี้ย&rdquo;</b> ตามหัวตาราง ·
            ไม่มีหัวตาราง: <b>วันครบกำหนด · เงินต้น · ดอกเบี้ย · หมายเหตุ</b> · บรรทัดรวม / งวดที่ยอดเป็น 0 ข้ามให้เอง ·
            วันที่ใช้ 15 มิ.ย. 68, 15/06/2568 หรือ 2025-06-15 ได้
          </p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} data-plain
            placeholder={"2026-11-05\t10000.00\t500.00\n2026-12-05\t10000.00\t450.00"}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" />
          {parsed.errors.length > 0 && <ul className="text-xs text-red-600">{parsed.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>}
          <button type="button" disabled={parsed.lines.length === 0} onClick={() => fill(parsed.lines)} className={`${obtn} disabled:opacity-50`}>
            ใส่ลงตาราง{parsed.lines.length ? ` (${parsed.lines.length} งวด)` : ""}
          </button>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 text-sm font-medium text-slate-800">ตารางผ่อน{rows.length ? ` ${rows.length} งวด` : ""}</div>
        <ScheduleGrid rows={rows} setRows={setRows} opts={opts} currency={currency}
          opening={opening ? { date: opening.date, principal: defaults.amount, recorded: opening.recorded } : undefined}
          controls={mode === "FORMULA" ? undefined : <>
            <label className="w-32">ดอกเบี้ย % ต่อปี<input value={rate} onChange={(e) => setRate(e.target.value)} name="rate" inputMode="decimal" className={input} /></label>
            <label>นับดอก
              <select value={actual ? "A" : "M"} onChange={(e) => setActual(e.target.value === "A")} className={input}>
                <option value="M">รายเดือน (อัตรา ÷ 12)</option><option value="A">ตามจำนวนวันจริง (÷ 365)</option>
              </select>
            </label>
          </>} />
        {rows.length === 0 && <p className="mt-2 text-sm text-slate-500">ยังไม่มีงวด — คำนวณจากสูตร วางจาก Excel หรือกด &ldquo;+ เพิ่มงวดท้ายตาราง&rdquo;</p>}
      </section>

      <form action={action} className="space-y-2"
        onSubmit={cf.guard("แทนที่ตารางผ่อนเดิมทั้งชุด?", {}, hasSchedule)}>{cf.dialog}
        <input type="hidden" name="asset_id" value={assetId} />
        <input type="hidden" name="lines" value={JSON.stringify(lines)} />
        {openingDiff && (
          <label className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm">
            <input type="checkbox" name="sync_opening" checked={syncOpening} onChange={(e) => setSyncOpening(e.target.checked)} className="mt-1" />
            <span>ปรับยอดตั้งต้นเป็น <b>{money(o!.outstanding, currency)}</b> ตามตารางพร้อมบันทึก (ตอนนี้ {money(opening!.recorded)})
              <span className="block text-xs text-slate-500">{opening!.recorded > o!.outstanding
                ? "ไม่ติ๊ก = คงยอดตั้งต้นเดิม (ใช้เมื่อผู้กู้ค้างชำระจริงก่อน Go-live · งวดก่อน Go-live ที่ยังไม่ได้รับจะขึ้น “เลยกำหนด”)"
                : "ยอดตั้งต้นเดิมน้อยกว่าตาราง = ผู้กู้คืนเงินต้นก่อนกำหนด · ใส่งวดที่คืนจริงในตารางด้านบน แล้วกด “หักจากงวดท้าย” ยอดจะตรงกันเอง"}</span></span>
          </label>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending || lines.length === 0 || errors.length > 0} className={btn}>
            {pending ? "กำลังบันทึก…" : `บันทึกตารางผ่อน (${lines.length} งวด)`}
          </button>
          {errors.length > 0 && <span className="text-sm text-red-600">{errors[0]}{errors.length > 1 ? ` (และอีก ${errors.length - 1} จุด)` : ""}</span>}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          <Flash on={state} as="span" className="text-sm text-emerald-700" />
        </div>
      </form>
    </div>
  ));
}
