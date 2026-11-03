"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { addMonthsKeepDay, annuityPrincipals, isMidPeriod, openingFromSchedule, recalcInterest, type RecalcOpts, type SchedLine } from "@/lib/loan-schedule";
import { money, thDate } from "@/lib/format";

/**
 * ตารางผ่อนที่แก้ได้ทีละช่อง (ตกลง 2 พ.ย. 2026)
 * - แก้วันที่ / เงินต้น → ดอกเบี้ยของงวดถัดไปคำนวณใหม่ทันที (ยอดคงเหลือ × อัตรา × ระยะเวลา)
 * - ดอกเบี้ยที่พิมพ์เอง = มีจุดกำกับ ไม่ถูกเขียนทับ (กดจุดเพื่อกลับไปคิดให้)
 * - แทรก / ลบงวดได้ · เรียงตามวันที่ให้เมื่อออกจากช่องวันที่
 * - ท้ายตาราง: เงินต้นรวมเทียบเงินต้นตามสัญญา · สัญญาก่อน Go-live: ยอดคงเหลือ ณ วันตั้งต้นตามตาราง
 * รอบ 3 พ.ย. 2026:
 * - เปลี่ยนอัตรา / วิธีนับดอก → คิดดอกเบี้ยทุกงวดใหม่ทันที (recalcOnOpts · เว้นงวดที่พิมพ์เอง)
 * - งวดคืนเงินต้นเพิ่มระหว่างงวด (carry): ดอกเบี้ยถึงวันคืนรวมเข้างวดปกติถัดไป
 * - เงินต้นรวมไม่เท่ายอด: ปุ่ม "ปรับงวดท้ายให้พอดี" / "คำนวณค่างวดที่เหลือใหม่ (จบวันเดิม)"
 * - ข้อความเตือน (data-warn) ไม่ใช่ข้อผิดพลาด → บันทึกสำเร็จแล้วหน้าต่างปิดเอง
 * ใช้ทั้งหน้าเพิ่มเงินให้กู้ (NewLoanSchedule) และ "ตั้ง / แก้ตารางผ่อน" (ScheduleEditor)
 */
export type GridRow = { key: number; due_date: string; principal: string; interest: string; notes: string; manual: boolean; carry?: boolean };

let seq = 1_000_000;
const f2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** ช่องตัวเลข → number (ว่าง = 0 · ตัวอักษร = NaN) */
const parse = (s: string) => {
  const t = s.replace(/,/g, "").trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** งวดที่ดอกเบี้ย 0 มีเงินต้น และห่างจากงวดถัดไปไม่ถึงเดือน = งวดคืนเงินต้นเพิ่มระหว่างงวด (ดอกเบี้ยอยู่ในงวดถัดไป) */
export const toRows = (lines: SchedLine[]): GridRow[] =>
  lines.map((l, i) => ({ key: i, due_date: l.due_date, principal: f2(l.principal), interest: f2(l.interest), notes: l.notes ?? "", manual: false,
    carry: l.interest === 0 && l.principal > 0 && isMidPeriod(l.due_date, lines[i - 1]?.due_date, lines[i + 1]?.due_date) }));

/** แถวในตาราง → งวดที่จะบันทึก + ข้อผิดพลาด (ไม่มีวันที่ / ไม่ใช่ตัวเลข / ติดลบ / ยอด 0) */
export function rowsToLines(rows: GridRow[]): { lines: SchedLine[]; errors: string[] } {
  const lines: SchedLine[] = []; const errors: string[] = [];
  rows.forEach((r, i) => {
    const p = parse(r.principal), it = parse(r.interest);
    const at = `งวดที่ ${i + 1}`;
    if (!r.due_date) errors.push(`${at}: ยังไม่ใส่วันครบกำหนด`);
    else if (Number.isNaN(p) || Number.isNaN(it)) errors.push(`${at}: เงินต้น / ดอกเบี้ย ต้องเป็นตัวเลข`);
    else if (p < 0 || it < 0) errors.push(`${at}: ยอดติดลบไม่ได้`);
    else if (p + it <= 0) errors.push(`${at}: ยอดเป็น 0 (ลบงวดนี้ออก)`);
    else lines.push({ due_date: r.due_date, principal: r2(p), interest: r2(it), notes: r.notes.trim() || undefined });
  });
  return { lines, errors };
}

function recalc(rows: GridRow[], from: number, opts: RecalcOpts): GridRow[] {
  const out = recalcInterest(rows.map((r) => ({ due_date: r.due_date, principal: parse(r.principal) || 0, interest: parse(r.interest) || 0, manual: r.manual, carry: r.carry })), from, opts);
  return rows.map((r, i) => (i < from || r.manual || !r.due_date || out[i].interest === parse(r.interest) ? r : { ...r, interest: f2(out[i].interest) }));
}

const cell = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
// ช่องที่ผิด: ใช้ style (globals.css กำหนดสีขอบ / พื้นของ input ไว้ ทับ class ของ Tailwind)
const bad = (on: boolean) => (on ? { borderColor: "#ef4444", backgroundColor: "#fef2f2", color: "#b91c1c" } : undefined);

export default function ScheduleGrid({ rows, setRows, opts, currency, opening, controls, amountLabel = "เงินต้นตามสัญญา", after, recalcOnOpts = true }: {
  rows: GridRow[]; setRows: (rows: GridRow[]) => void;
  /** ใช้คำนวณดอกเบี้ยใหม่ · amount = เงินต้นตามสัญญา (ยอดคงเหลือ = amount − เงินต้นงวดก่อนหน้า) */
  opts: RecalcOpts;
  currency: string;
  /** สัญญาที่ให้กู้ก่อน Go-live: วันตั้งต้น + เงินต้นตามสัญญาที่บันทึกไว้ + ยอดตั้งต้นที่บันทึกไว้ (ไม่มี = ฟอร์มสัญญาใหม่) */
  opening?: { date: string; principal: number; recorded?: number | null };
  /** ช่องอัตราดอกเบี้ย / วิธีนับดอก (แสดงบนหัวตาราง) */
  controls?: ReactNode;
  /** ชื่อยอดที่เงินต้นรวมต้องเท่ากัน (คำนวณงวดที่เหลือใหม่ = เงินต้นที่เหลือ) */
  amountLabel?: string;
  /** ทุกงวดต้องลงวันที่หลังวันนี้ (คำนวณงวดที่เหลือใหม่: งวดสุดท้ายที่รับครบแล้ว) */
  after?: { date: string; label: string };
  /** เปลี่ยนอัตรา / วิธีนับดอก / วันเริ่มนับดอก → คิดดอกเบี้ยทุกงวดใหม่ทันที (หน้าเพิ่มสัญญา: เฉพาะเมื่อแก้ตารางเองแล้ว) */
  recalcOnOpts?: boolean;
}) {
  const [auto, setAuto] = useState(true);
  // งวดที่แก้เงินต้นล่าสุด → จุดเริ่ม "คำนวณค่างวดที่เหลือใหม่"
  const [lastEdit, setLastEdit] = useState<number | null>(null);
  const latest = useRef({ rows, setRows, opts, on: auto && recalcOnOpts });
  useEffect(() => { latest.current = { rows, setRows, opts, on: auto && recalcOnOpts }; });
  const optKey = `${opts.ratePct}|${opts.dayCount}|${opts.interestFrom ?? ""}|${opts.flat ? 1 : 0}`;
  const seenKey = useRef(optKey);
  useEffect(() => {
    if (seenKey.current === optKey) return;
    seenKey.current = optKey;
    const { rows: rs, setRows: put, opts: o, on } = latest.current;
    if (!on || !rs.length) return;
    const next = recalc(rs, 0, o);
    if (next.some((r, i) => r !== rs[i])) put(next);
  }, [optKey]);
  const set = (next: GridRow[], from: number | null) => setRows(auto && from != null ? recalc(next, from, opts) : next);
  const patch = (i: number, p: Partial<GridRow>) => rows.map((r, k) => (k === i ? { ...r, ...p } : r));
  // NumberInputs จัดรูปตอนออกจากช่อง (1000 → 1,000.00) = ค่าเดิม → ไม่นับเป็นการแก้
  const onPrincipal = (i: number, v: string) => {
    const changed = parse(v) !== parse(rows[i].principal);
    if (changed) setLastEdit(rows[i].key);
    set(patch(i, { principal: v }), changed ? i : null);
  };
  const onInterest = (i: number, v: string) => setRows(patch(i, parse(v) === parse(rows[i].interest) ? { interest: v } : { interest: v, manual: true }));
  // งวดที่เพิ่งแทรก: ลงวันที่ระหว่างงวดปกติ (ห่างงวดถัดไปไม่ถึงเดือน) → เป็นงวดคืนเงินต้นเพิ่ม ดอกเบี้ยยกไปงวดถัดไปให้
  const onDate = (i: number, v: string) => set(patch(i, rows[i].key >= 1_000_000 && !rows[i].manual
    ? { due_date: v, carry: isMidPeriod(v, rows[i - 1]?.due_date, rows[i + 1]?.due_date) } : { due_date: v }), v ? i : null);
  const toggleCarry = (i: number) => set(patch(i, { carry: !rows[i].carry, manual: false }), i);
  const sortDates = () => {
    const sorted = [...rows].sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));
    const at = sorted.findIndex((r, i) => r !== rows[i]);
    if (at >= 0) set(sorted, at);
  };
  const insert = (i: number) => {
    const cur = rows[i]?.due_date, next = rows[i + 1]?.due_date;
    let d = cur ? addMonthsKeepDay(cur, 1) : "";
    if (d && next && d >= next) d = "";
    const row: GridRow = { key: ++seq, due_date: d, principal: "0.00", interest: "0.00", notes: "", manual: false };
    set([...rows.slice(0, i + 1), row, ...rows.slice(i + 1)], i + 1);
  };
  const append = () => {
    const last = rows.at(-1)?.due_date;
    const d = last ? addMonthsKeepDay(last, 1) : opts.interestFrom ? addMonthsKeepDay(opts.interestFrom, 1) : "";
    set([...rows, { key: ++seq, due_date: d, principal: "0.00", interest: "0.00", notes: "", manual: false }], rows.length);
  };
  const remove = (i: number) => set(rows.filter((_, k) => k !== i), i);
  const all = () => setRows(recalc(rows.map((r) => ({ ...r, manual: false })), 0, opts));

  const view = rows.reduce<{ r: GridRow; p: number; it: number; bal: number }[]>((acc, r) => {
    const p = parse(r.principal), it = parse(r.interest);
    acc.push({ r, p, it, bal: r2((acc.at(-1)?.bal ?? opts.amount) - (p || 0)) });
    return acc;
  }, []);
  const totP = r2(view.reduce((s, x) => s + (x.p || 0), 0));
  const totI = r2(view.reduce((s, x) => s + (x.it || 0), 0));
  const diffP = r2(totP - opts.amount);
  const lines = rows.filter((r) => r.due_date).map((r) => ({ due_date: r.due_date, principal: parse(r.principal) || 0 }));
  const o = opening ? openingFromSchedule(opening.principal, lines, opening.date) : null;
  const unordered = rows.some((r, i) => i > 0 && r.due_date && rows[i - 1].due_date && r.due_date < rows[i - 1].due_date);
  const tooEarly = (d: string) => !!(after && d && d <= after.date);
  const early = rows.filter((r) => tooEarly(r.due_date)).length;

  // เงินต้นรวมไม่เท่ายอด → ปรับงวดท้าย (เกิน: หักจากงวดท้ายย้อนขึ้นไป · ขาด: เพิ่มเข้างวดท้าย)
  const fitLast = () => {
    let left = diffP, first = rows.length;
    const next = [...rows];
    for (let k = next.length - 1; k >= 0 && Math.abs(left) > 0.005; k--) {
      const p = parse(next[k].principal) || 0;
      if (!next[k].due_date || (left > 0 && p <= 0)) continue;
      const cut = left > 0 ? Math.min(p, left) : left;
      next[k] = { ...next[k], principal: f2(r2(p - cut)) };
      left = r2(left - cut); first = k;
    }
    // งวดที่เหลือยอด 0 ทั้งเงินต้นและดอกเบี้ย → ลบออก (จบเร็วขึ้น)
    set(next.filter((r, k) => k < first || parse(r.principal) > 0 || parse(r.interest) > 0 || !r.due_date), first);
  };
  // คำนวณค่างวดที่เหลือใหม่หลังงวดที่แก้ล่าสุด (จบวันเดิม): ค่างวดเท่ากัน → หาค่างวดใหม่ · ไม่เท่ากัน → ลดเงินต้นทุกงวดตามสัดส่วน
  const anchor = lastEdit == null ? -1 : rows.findIndex((r) => r.key === lastEdit);
  const restIdx = anchor < 0 ? [] : rows.map((r, k) => k).filter((k) => k > anchor && rows[k].due_date && !rows[k].carry);
  const restP = restIdx.map((k) => parse(rows[k].principal) || 0);
  // ผ่อนเงินต้นทุกงวด (ไม่ใช่จ่ายแต่ดอกแล้วคืนก้อนท้าย) จึงมีปุ่มนี้ · ดอกเบี้ยคงที่ไม่ใช้
  const canSpread = Math.abs(diffP) > 0.005 && restIdx.length >= 2 && !opts.flat && restP.slice(0, -1).some((p) => p > 0);
  const spread = () => {
    const balAt = Math.max(r2(opts.amount - rows.slice(0, anchor + 1).reduce((t, r) => t + (parse(r.principal) || 0), 0)), 0);
    const totals = restIdx.slice(0, -1).map((k, j) => restP[j] + (parse(rows[k].interest) || 0));
    const mean = totals.reduce((t, x) => t + x, 0) / Math.max(totals.length, 1);
    // ค่างวดเท่ากันทุกงวด (ต่างกันไม่เกิน 1%) → หาค่างวดใหม่ · ไม่เท่ากัน → ลดเงินต้นทุกงวดตามสัดส่วน
    const level = mean > 0 && restP.slice(0, -1).every((p) => p > 0) && Math.max(...totals) - Math.min(...totals) <= mean * 0.01;
    const prevDate = rows.slice(0, anchor + 1).map((r) => r.due_date).filter(Boolean).at(-1) ?? "";
    let newP: number[];
    if (level) newP = annuityPrincipals(balAt, opts.ratePct, prevDate, restIdx.map((k) => rows[k].due_date), opts.dayCount);
    else {
      const sumP = restP.reduce((t, x) => t + x, 0);
      newP = restP.map((p) => r2(sumP > 0 ? (p * balAt) / sumP : 0));
      newP[newP.length - 1] = r2(balAt - newP.slice(0, -1).reduce((t, x) => t + x, 0));
    }
    const next = [...rows];
    restIdx.forEach((k, j) => { next[k] = { ...next[k], principal: f2(newP[j]) }; });
    set(next, anchor + 1);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 text-sm">
        {controls}
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          คำนวณดอกเบี้ยงวดถัดไปให้ทันทีเมื่อแก้
        </label>
        <button type="button" onClick={all} className="mb-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50">คำนวณดอกเบี้ยทุกงวดใหม่</button>
      </div>
      <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[46rem] text-sm tabular-nums">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-2 py-1.5">งวด</th><th className="px-1">ครบกำหนด</th><th className="px-1 text-right">เงินต้น</th><th className="px-1 text-right">ดอกเบี้ย</th>
              <th className="px-1 text-right">รวม</th><th className="px-1 text-right">เงินต้นคงเหลือ</th><th className="px-1">หมายเหตุ</th><th className="px-1" /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {view.map(({ r, p, it, bal: left }, i) => {
              const pre = !!(opening && r.due_date && r.due_date <= opening.date);
              return (
                <tr key={r.key} className={pre ? "bg-slate-50" : undefined}>
                  <td className="px-2 py-1 text-xs text-slate-500">{i + 1}{pre && <span className="block whitespace-nowrap text-[10px] text-slate-400">ก่อน Go-live</span>}</td>
                  <td className="px-1 py-1"><input type="date" value={r.due_date} onChange={(e) => onDate(i, e.target.value)} onBlur={sortDates} aria-label={`วันครบกำหนดงวดที่ ${i + 1}`}
                    style={bad(!r.due_date || tooEarly(r.due_date))} className={`${cell} min-w-[9rem]`} /></td>
                  <td className="px-1 py-1"><input value={r.principal} onChange={(e) => onPrincipal(i, e.target.value)} inputMode="decimal" aria-label={`เงินต้นงวดที่ ${i + 1}`}
                    style={bad(Number.isNaN(p))} className={`${cell} min-w-[7rem] text-right`} /></td>
                  <td className="px-1 py-1">
                    {r.carry ? (
                      <div className="flex min-w-[7rem] items-center gap-1 text-xs text-slate-500">
                        <span className="h-2.5 w-2.5 shrink-0" />
                        <span className="flex-1 text-right">รวมในงวดถัดไป</span>
                        <button type="button" onClick={() => toggleCarry(i)} title="คิดดอกเบี้ยแยกในงวดนี้" className="rounded px-1 text-blue-700 hover:bg-blue-50">แยก</button>
                      </div>
                    ) : <div className="flex items-center gap-1">
                      {r.manual
                        ? <button type="button" onClick={() => set(patch(i, { manual: false }), i)} title="ดอกเบี้ยที่พิมพ์เอง · กดเพื่อให้ระบบคิดให้"
                            className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" aria-label="ยกเลิกดอกเบี้ยที่พิมพ์เอง" />
                        : <span className="h-2.5 w-2.5 shrink-0" />}
                      <input value={r.interest} onChange={(e) => onInterest(i, e.target.value)} inputMode="decimal" aria-label={`ดอกเบี้ยงวดที่ ${i + 1}`}
                        style={bad(Number.isNaN(it))} className={`${cell} min-w-[6.5rem] text-right`} />
                      {r.key >= 1_000_000 && i < rows.length - 1 && (parse(r.principal) || 0) > 0 && (
                        <button type="button" onClick={() => toggleCarry(i)} title="คืนเงินต้นเพิ่มระหว่างงวด: ยกดอกเบี้ยถึงวันนี้ไปรวมกับงวดถัดไป"
                          className="shrink-0 rounded px-1 text-xs text-blue-700 hover:bg-blue-50">รวมงวดถัดไป</button>
                      )}
                    </div>}
                  </td>
                  <td className="px-1 py-1 text-right">{money((p || 0) + (it || 0))}</td>
                  <td data-warn className={`px-1 py-1 text-right ${left < -0.005 ? "text-red-600" : "text-slate-600"}`}>{money(left)}</td>
                  <td className="px-1 py-1"><input value={r.notes} onChange={(e) => setRows(patch(i, { notes: e.target.value }))} maxLength={200} aria-label={`หมายเหตุงวดที่ ${i + 1}`}
                    className={`${cell} min-w-[8rem]`} /></td>
                  <td className="whitespace-nowrap px-1 py-1 text-xs">
                    <button type="button" onClick={() => insert(i)} title="แทรกงวดต่อจากงวดนี้" className="rounded px-1.5 py-1 text-blue-700 hover:bg-blue-50">+ แทรก</button>
                    <button type="button" onClick={() => remove(i)} title="ลบงวดนี้" aria-label={`ลบงวดที่ ${i + 1}`} className="rounded px-1.5 py-1 text-slate-500 hover:bg-red-50 hover:text-red-600">✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="sticky bottom-0 border-t border-slate-200 bg-white font-medium">
              <tr><td className="px-2 py-1.5" colSpan={2}>รวม {rows.length} งวด</td><td className="px-1 text-right">{money(totP)}</td>
                <td className="px-1 text-right">{money(totI)}</td><td className="px-1 text-right">{money(totP + totI)}</td><td colSpan={3} /></tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={append} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">+ เพิ่มงวดท้ายตาราง</button>
        {unordered && <span className="text-xs text-amber-700">วันที่ยังไม่เรียงลำดับ — ออกจากช่องวันที่แล้วระบบเรียงให้</span>}
      </div>
      <ul className="space-y-0.5 text-xs">
        <li className="text-slate-500">ดอกเบี้ยคิดใหม่ = เงินต้นคงเหลือ × {opts.ratePct || 0}% ต่อปี × {opts.dayCount === "ACTUAL_365" ? "จำนวนวัน ÷ 365" : "จำนวนเดือน ÷ 12"}
          {opts.flat ? " (ดอกเบี้ยคงที่: คิดจากเงินต้นตามสัญญา)" : ""} · <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> = ดอกเบี้ยที่พิมพ์เอง ระบบไม่เขียนทับ
          {" "}· แทรกงวดคืนเงินต้นเพิ่มระหว่างงวด → ดอกเบี้ยถึงวันคืน &ldquo;รวมในงวดถัดไป&rdquo; ให้</li>
        {rows.length > 0 && (Math.abs(diffP) > 0.005
          ? <li data-warn className="text-red-600">เงินต้นรวม {money(totP)} ไม่เท่ากับ{amountLabel} {money(opts.amount, currency)} (ต่าง {money(Math.abs(diffP))}{diffP > 0 ? " เกิน" : " ขาด"}) — สถานะ &ldquo;รับแล้ว&rdquo; อาจคลาดเคลื่อน
              <span className="mt-1 flex flex-wrap gap-2">
                <button type="button" onClick={fitLast} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50">
                  {diffP > 0 ? `หักจากงวดท้าย ${money(diffP)} (จบเร็วขึ้น)` : `เพิ่มเข้างวดท้าย ${money(-diffP)}`}</button>
                {canSpread && <button type="button" onClick={spread} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50">
                  คำนวณค่างวดหลังงวดที่ {anchor + 1} ใหม่ (จบวันเดิม)</button>}
              </span></li>
          : <li className="text-emerald-700">เงินต้นรวมเท่ากับ{amountLabel} {money(opts.amount, currency)}</li>)}
        {early > 0 && <li data-warn className="text-red-600">{early} งวดลงวันที่ไม่หลัง {thDate(after!.date)} ({after!.label}) — แก้วันที่ก่อนบันทึก</li>}
        {o && rows.length > 0 && (
          <li data-warn className={o.outstanding < -0.005 || (opening?.recorded != null && Math.abs(opening.recorded - o.outstanding) > 0.005) ? "text-red-600" : "text-slate-600"}>
            ยอดคงเหลือ ณ วันตั้งต้น ({thDate(opening!.date)}) ตามตาราง: {money(opening!.principal)} − เงินต้น {o.count} งวดที่ครบกำหนดถึงวันนั้น {money(o.paid)} = <b>{money(o.outstanding, currency)}</b>
            {o.outstanding < -0.005 && " — เงินต้นงวดก่อน Go-live เกินเงินต้นตามสัญญา"}
            {opening?.recorded != null && Math.abs(opening.recorded - o.outstanding) > 0.005 && <> · ไม่ตรงกับยอดตั้งต้นที่บันทึกไว้ {money(opening.recorded)}</>}
          </li>
        )}
      </ul>
    </div>
  );
}
