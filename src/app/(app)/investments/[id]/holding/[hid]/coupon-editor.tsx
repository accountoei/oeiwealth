"use client";

import { useActionState, useMemo, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { saveCouponSchedule, type ActionState } from "../../../actions";
import { COUPON_FREQ_OPTIONS, COUPON_MONTHS, couponLines } from "@/lib/coupon-schedule";
import { addMonthsKeepDay, parseScheduleText, type SchedLine } from "@/lib/loan-schedule";
import { SMALL_DEL_BTN, addDays, numOrZero as num } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import Flash from "@/components/Flash";
import ScheduleGrid, { rowsToLines, toRows, type GridRow } from "@/app/(app)/financial/loans/ScheduleGrid";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";

/**
 * ตั้ง / แก้ตารางรับดอกเบี้ย / เงินต้นทั้งชุด (หุ้นกู้ · FCN · Structured · ตกลง 13 พ.ย. 2026 · แบบตารางผ่อนเงินกู้)
 * เริ่มจาก: ตารางปัจจุบัน (ที่ตั้งไว้ หรือที่คำนวณจากข้อมูลหลัก) · สูตร · วางจาก Excel → ตารางที่แก้ได้ทีละช่อง (ScheduleGrid ของเงินกู้)
 * งวดก่อน Go-live ใส่ได้ (ข้อมูลเท่านั้น) · เงินต้นงวดสุดท้ายงวดเดียว · บันทึก = แทนที่ทั้งชุด · ลบตาราง = กลับไปใช้ตารางคำนวณ
 */
type Mode = "GRID" | "FORMULA" | "TEXT";
export function CouponEditor({ assetId, holdingId, currency, current, hasSchedule, defaults, goLive }: {
  assetId: string; holdingId: string; currency: string; goLive: string;
  /** งวดที่ตั้งไว้ (hasSchedule) หรืองวดที่คำนวณจากข้อมูลหลัก */
  current: SchedLine[]; hasSchedule: boolean;
  defaults: { face: number; ratePct: number; freq: string; start: string; maturity: string };
}) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const [mode, setMode] = useState<Mode>(current.length ? "GRID" : "FORMULA");
  const [rows, setRows] = useState<GridRow[]>(() => toRows(current));
  const [text, setText] = useState("");
  const [face, setFace] = useState(defaults.face ? defaults.face.toFixed(2) : "");
  const [rate, setRate] = useState(defaults.ratePct ? String(defaults.ratePct) : "");
  const [freq, setFreq] = useState(defaults.freq);
  const [start, setStart] = useState(defaults.start);
  const [maturity, setMaturity] = useState(defaults.maturity);
  const [actual, setActual] = useState(false);
  // งวดแรกนับดอกจากก่อนหน้า 1 รอบ (ครั้งเดียวตอนครบกำหนด: นับจากวันเริ่ม)
  const fromOf = (ls: SchedLine[]) => (ls[0] && COUPON_MONTHS[freq] ? addMonthsKeepDay(ls[0].due_date, -COUPON_MONTHS[freq]) : start);
  const [from, setFrom] = useState(() => fromOf(current));
  const [calcError, setCalcError] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCouponSchedule, {});
  const cf = useConfirmSubmit();
  const parsed = useMemo(() => {
    const r = parseScheduleText(text);
    // วางแค่ วันที่ · ดอกเบี้ย (ไม่มีหัวตาราง) → ช่องที่ 2 คือดอกเบี้ย
    return !r.header && r.lines.length > 1 && r.lines.every((l) => l.interest === 0)
      ? { ...r, lines: r.lines.map((l) => ({ ...l, principal: 0, interest: l.principal })) } : r;
  }, [text]);
  const { lines, errors } = useMemo(() => rowsToLines(rows), [rows]);
  const last = lines.reduce((m, l) => (l.due_date > m ? l.due_date : m), "");
  const badPrincipal = lines.filter((l) => l.principal > 0).length > 1 || lines.some((l) => l.principal > 0 && l.due_date < last);
  const opts = { amount: num(face), ratePct: num(rate), dayCount: actual ? "ACTUAL_365" as const : "MONTHLY" as const, interestFrom: from || undefined };

  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls((hasSchedule ? obtn : btn).replace("px-4 py-2", "px-3 py-1.5"))}>
    {hasSchedule ? "แก้ตารางรับทั้งชุด" : "+ ตั้งตารางรับ"}</button>;
  if (!open) return trigger;

  const fill = (ls: SchedLine[]) => { setRows(toRows(ls)); setFrom(fromOf(ls)); setMode("GRID"); };
  const calc = () => {
    if (!maturity) return setCalcError("ใส่วันครบกำหนดก่อน");
    if (!(num(face) > 0)) return setCalcError("ใส่เงินต้นก่อน");
    setCalcError("");
    fill(couponLines({ face: num(face), ratePct: num(rate), freq, start, maturity, actual }));
  };
  const faceInput = <input value={face} onChange={(e) => setFace(e.target.value)} inputMode="decimal" className={input} />;
  const rateInput = <input value={rate} onChange={(e) => setRate(e.target.value)} name="rate" inputMode="decimal" className={input} />;

  return present(trigger, (
    <div className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-5">
      <div>
        <h3 className="font-medium text-slate-900">ตั้ง / แก้ตารางรับ</h3>
        <p className="text-xs text-slate-500">เริ่มจากสูตร / Excel / ตารางเดิม แล้วแก้ในตารางทีละช่องได้ · งวดก่อน Go-live ใส่ได้ เป็นข้อมูลเท่านั้น ไม่เข้ายอดเงิน · ดูผลก่อนกดบันทึก</p>
      </div>

      <label className="block text-sm">เริ่มจาก
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={input}>
          <option value="GRID">{hasSchedule ? "ตารางที่ตั้งไว้ · แก้ในตารางด้านล่าง" : current.length ? "ตารางที่คำนวณจากข้อมูลหลัก · แก้ในตารางด้านล่าง" : "ใส่เองทีละงวดในตารางด้านล่าง"}</option>
          <option value="FORMULA">คำนวณจากสูตร</option>
          <option value="TEXT">วางจาก Excel</option>
        </select>
      </label>

      {mode === "FORMULA" && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">เงินต้น / มูลค่าหน้าตั๋ว ({currency}){faceInput}</label>
            <label className="text-sm">อัตราดอกเบี้ย % ต่อปี{rateInput}</label>
            <label className="text-sm">จ่ายดอกเบี้ย
              <select value={freq} onChange={(e) => setFreq(e.target.value)} className={input}>
                {COUPON_FREQ_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="text-sm">วันที่ซื้อ / วันออก<input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={input} />
              <span className="mt-1 block text-xs text-slate-500">ใส่วันที่ซื้อจริง (ก่อน Go-live ได้) เพื่อให้มีงวดก่อน Go-live</span></label>
            <label className="text-sm">วันครบกำหนด<input type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} className={input} /></label>
            <label className="flex items-start gap-2 text-sm md:col-span-3">
              <input type="checkbox" checked={actual} onChange={(e) => setActual(e.target.checked)} className="mt-1" />
              <span>คิดดอกตามจำนวนวันจริง (เงินต้น × อัตรา × จำนวนวันในงวด ÷ 365)
                <span className="block text-xs text-slate-500">ไม่ติ๊ก = ดอกเท่ากันทุกงวด (อัตรา × เดือนต่องวด ÷ 12)</span></span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={calc} className={obtn}>คำนวณ → ใส่ลงตาราง</button>
            {calcError && <span className="text-sm text-red-600">{calcError}</span>}
          </div>
          <p className="text-xs text-slate-500">วันรับนับย้อนจากวันครบกำหนดทีละงวด จนถึงหลังวันที่ซื้อ / วันออก · เงินต้นคืนงวดสุดท้าย · ผลคำนวณแทนที่ตารางด้านล่าง แล้วแก้ทีละงวดต่อได้</p>
        </section>
      )}

      {mode === "TEXT" && (
        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">
            คัดลอกจาก Excel มาวาง: 1 บรรทัด = 1 งวด · ถ้าคัดลอกหัวตารางมาด้วย ระบบใช้คอลัมน์ <b>&ldquo;เงินต้น&rdquo;</b> และ <b>&ldquo;ดอกเบี้ย&rdquo;</b> ตามหัวตาราง ·
            ไม่มีหัวตาราง: <b>วันที่ · เงินต้น · ดอกเบี้ย · หมายเหตุ</b> หรือ <b>วันที่ · ดอกเบี้ย</b> · บรรทัดรวม / งวดที่ยอดเป็น 0 ข้ามให้เอง ·
            วันที่ใช้ 15 มิ.ย. 68, 15/06/2568 หรือ 2025-06-15 ได้
          </p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} data-plain
            placeholder={"2026-06-15\t0\t25,000.00\n2026-12-15\t1,000,000.00\t25,000.00"}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" />
          {parsed.errors.length > 0 && <ul className="text-xs text-red-600">{parsed.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>}
          <button type="button" disabled={parsed.lines.length === 0} onClick={() => fill(parsed.lines)} className={`${obtn} disabled:opacity-50`}>
            ใส่ลงตาราง{parsed.lines.length ? ` (${parsed.lines.length} งวด)` : ""}
          </button>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 text-sm font-medium text-slate-800">ตารางรับ{rows.length ? ` ${rows.length} งวด` : ""}</div>
        <ScheduleGrid rows={rows} setRows={setRows} opts={opts} currency={currency} amountLabel="เงินต้น (มูลค่าหน้าตั๋ว)" recalcOnOpts={false}
          opening={goLive ? { date: addDays(goLive, -1), principal: num(face) } : undefined}
          controls={mode === "FORMULA" ? undefined : <>
            <label className="w-40">เงินต้น ({currency}){faceInput}</label>
            <label className="w-32">ดอกเบี้ย % ต่อปี{rateInput}</label>
            <label>นับดอก
              <select value={actual ? "A" : "M"} onChange={(e) => setActual(e.target.value === "A")} className={input}>
                <option value="M">เท่ากันทุกงวด (เดือน ÷ 12)</option><option value="A">ตามจำนวนวันจริง (÷ 365)</option>
              </select>
            </label>
          </>} />
        {rows.length === 0 && <p className="mt-2 text-sm text-slate-500">ยังไม่มีงวด — คำนวณจากสูตร วางจาก Excel หรือกด &ldquo;+ เพิ่มงวดท้ายตาราง&rdquo;</p>}
      </section>

      {cf.dialog}
      <div className="flex flex-wrap items-center gap-3">
        <form action={action} onSubmit={cf.guard("แทนที่ตารางรับเดิมทั้งชุด?", {}, hasSchedule)}>
          <input type="hidden" name="asset_id" value={assetId} />
          <input type="hidden" name="holding_id" value={holdingId} />
          <input type="hidden" name="lines" value={JSON.stringify(lines)} />
          <button disabled={pending || lines.length === 0 || errors.length > 0 || badPrincipal} className={btn}>
            {pending ? "กำลังบันทึก…" : `บันทึกตารางรับ (${lines.length} งวด)`}
          </button>
        </form>
        {hasSchedule && (
          <form action={action} onSubmit={cf.guard("ลบตารางที่ตั้งไว้ แล้วกลับไปใช้ตารางที่คำนวณจากข้อมูลหลัก?", { danger: true })}>
            <input type="hidden" name="asset_id" value={assetId} />
            <input type="hidden" name="holding_id" value={holdingId} />
            <input type="hidden" name="lines" value="[]" />
            <button disabled={pending} className={SMALL_DEL_BTN}>ลบตารางที่ตั้งไว้</button>
          </form>
        )}
        {errors.length > 0 && <span className="text-sm text-red-600">{errors[0]}{errors.length > 1 ? ` (และอีก ${errors.length - 1} จุด)` : ""}</span>}
        {badPrincipal && <span className="text-sm text-red-600">เงินต้นใส่ได้งวดเดียว คืองวดสุดท้าย (วันครบกำหนด)</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="text-sm text-emerald-700" />
      </div>
    </div>
  ));
}
