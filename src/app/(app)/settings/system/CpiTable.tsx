"use client";

import { useActionState, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useResetSync } from "@/lib/useResetSync";
import { deleteCpiYear, saveCpiYear, type FxState } from "./actions";
import Flash from "@/components/Flash";
import {  } from "@/lib/format";

export type CpiRow = { year: number; cpi_index: number; inflation_pct: number | null; source: string; notes: string | null };

/** ดัชนีเงินเฟ้อรายปี (ค่าเฉลี่ยทั้งปี) — ใช้กับวิธี "เงินเฟ้อ + ส่วนเพิ่ม" และข้อความเทียบในกล่องราคาขายขั้นต่ำ
 *  ADMIN เพิ่มปีถัดไปจาก % ที่ สนค. ประกาศ (ระบบต่อดัชนีจากปีก่อน) · แก้ / ลบได้เฉพาะปีล่าสุด */
/** ปุ่มย่อ / ขยายไม่ให้หน้าจอกระโดด: จำตำแหน่งหัวข้อก่อนกด แล้วเลื่อนกลับให้หัวข้ออยู่ที่เดิม */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export default function CpiTable({ rows, canEdit, thisYear }: { rows: CpiRow[]; canEdit: boolean; thisYear: number }) {
  const [all, setAll] = useState(false);
  const [state, action, pending] = useActionState<FxState, FormData>(saveCpiYear, {});
  const [delState, delAction, delPending] = useActionState<FxState, FormData>(deleteCpiYear, {});
  const [confirmDel, setConfirmDel] = useState(false);
  const last = rows[0]?.year ?? null;   // เรียงปีล่าสุดก่อน
  const nextYear = last != null && last + 1 < thisYear ? last + 1 : null;
  const [pick, setPick] = useState<number | null>(nextYear ?? last);
  // หลังเพิ่ม / ลบ ปีล่าสุดเปลี่ยน → กลับไปค่าเริ่มต้น
  const year = pick != null && (pick === nextYear || pick === last) ? pick : (nextYear ?? last);
  const yearRef = useRef<HTMLSelectElement>(null);
  const syncYear = useCallback((v: string) => { setPick(Number(v) - 543); setConfirmDel(false); }, []);
  useResetSync(yearRef, syncYear);
  const shown = all ? rows : rows.slice(0, 10);
  const editing = year != null && year === last ? rows[0] : null;

  const headRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);
  const toggle = () => { anchor.current = headRef.current?.getBoundingClientRect().top ?? null; setAll(!all); };
  useLayoutEffect(() => {
    if (anchor.current == null || !headRef.current) return;
    const d = headRef.current.getBoundingClientRect().top - anchor.current;
    anchor.current = null;
    if (Math.abs(d) < 1) return;
    const sp = scrollParent(headRef.current);
    if (sp) sp.scrollTop += d; else window.scrollBy(0, d);
  }, [all]);

  return (
    <div className="space-y-3 text-sm">
      <div ref={headRef}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium text-slate-800">อัตราเงินเฟ้อรายปี (ดัชนีราคาผู้บริโภคทั่วไปของไทย · ค่าเฉลี่ยทั้งปี)</h3>
          {rows.length > 10 && (
            <button type="button" onClick={toggle} className="text-xs text-blue-700 hover:underline">
              {all ? "ย่อ (แสดง 10 ปีล่าสุด)" : `ดูย้อนหลังทั้งหมด (${rows.length} ปี ตั้งแต่ พ.ศ. ${rows[rows.length - 1].year + 543})`}</button>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          ใช้กับวิธี &ldquo;เงินเฟ้อ + ส่วนเพิ่ม&rdquo; และข้อความเทียบในกล่องราคาขายขั้นต่ำ · คิดถึงปีล่าสุดที่มีข้อมูลทั้งปี (ไม่ใช้ข้อมูลบางเดือน) ·
          ข้อมูลย้อนหลังจาก World Bank ซึ่งมาจากตัวเลขของ สนค. กระทรวงพาณิชย์
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1">ปี (พ.ศ.)</th><th className="text-right">เงินเฟ้อทั้งปี</th><th className="text-right">ดัชนี (2553 = 100)</th><th className="pl-4">แหล่งที่มา</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => (
              <tr key={r.year}>
                <td className="py-1">{r.year + 543}</td>
                <td className="text-right tabular-nums">{r.inflation_pct == null ? "-" : `${Number(r.inflation_pct).toFixed(2)}%`}</td>
                <td className="text-right tabular-nums">{Number(r.cpi_index).toFixed(2)}</td>
                <td className="pl-4 text-xs text-slate-500">{r.source}{r.notes && ` · ${r.notes}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && last != null && nextYear == null && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ปี {last + 1 + 543} ยังไม่จบ · เพิ่มได้ตั้งแต่ 1 ม.ค. {last + 2 + 543} (สนค. ประกาศเงินเฟ้อทั้งปีราวต้นเดือน ม.ค.) · ตอนนี้แก้ได้เฉพาะปี {last + 543}
        </p>
      )}
      {canEdit && last != null && (
        <form action={action} className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
          <label className="text-xs text-slate-600">ปี (พ.ศ.)
            <select key={`${last}-${nextYear}`} ref={yearRef} name="year" defaultValue={year != null ? year + 543 : ""}
              onChange={(e) => syncYear(e.target.value)}
              className="mt-1 block rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
              {nextYear != null && <option value={nextYear + 543}>{nextYear + 543} (เพิ่มปีใหม่)</option>}
              <option value={last + 543}>{last + 543} (แก้ปีล่าสุด)</option>
            </select></label>
          <label className="text-xs text-slate-600">เงินเฟ้อทั้งปี (%)
            <input key={`p${year}`} name="inflation_pct" inputMode="decimal" data-money="off" required
              defaultValue={editing?.inflation_pct ?? ""} placeholder="เช่น 1.23"
              className="mt-1 block w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-sm" /></label>
          <label className="text-xs text-slate-600">แหล่งที่มา
            <input key={`s${year}`} name="source" required defaultValue={editing?.source ?? "สนค. กระทรวงพาณิชย์"}
              className="mt-1 block w-56 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm" /></label>
          <label className="text-xs text-slate-600">หมายเหตุ
            <input key={`n${year}`} name="notes" defaultValue={editing?.notes ?? ""} placeholder="เช่น ประกาศ ม.ค. 2570"
              className="mt-1 block w-48 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm" /></label>
          <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : "บันทึก"}</button>
          {/* ลบได้เฉพาะปีล่าสุด · อยู่ข้างปุ่มบันทึก เมื่อเลือก "แก้ปีล่าสุด" */}
          {editing && rows.length > 2 && (!confirmDel ? (
            <button type="button" onClick={() => setConfirmDel(true)}
              className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">ลบปี {last + 543}</button>
          ) : (<>
            <button formAction={delAction} formNoValidate disabled={delPending}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50">ยืนยันลบปี {last + 543}</button>
            <button type="button" onClick={() => setConfirmDel(false)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">ยกเลิก</button>
          </>))}
          {state.error && <span className="text-red-600">{state.error}</span>}
          {delState.error && <span className="text-red-600">{delState.error}</span>}
          <Flash on={state} as="span" className="text-emerald-700" />
          <Flash on={delState} as="span" className="text-emerald-700" />
          {confirmDel && editing && <p className="w-full text-xs text-red-700">ลบปี {last + 543} แล้ว ราคาขายขั้นต่ำแบบเงินเฟ้อจะคิดถึงปี {last - 1 + 543} แทน</p>}
          <p className="w-full text-xs text-slate-500">
            ใส่ &ldquo;อัตราเงินเฟ้อทั่วไปเฉลี่ยทั้งปี&rdquo; ที่ สนค. ประกาศ · ระบบคิดดัชนี = ดัชนีปีก่อน × (1 + %) · ใส่ได้เฉพาะปีที่จบแล้ว
          </p>
        </form>
      )}
    </div>
  );
}
