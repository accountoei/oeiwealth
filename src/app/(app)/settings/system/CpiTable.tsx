"use client";

import { useActionState, useState } from "react";
import { deleteCpiYear, saveCpiYear, type FxState } from "./actions";
import Flash from "@/components/Flash";

export type CpiRow = { year: number; cpi_index: number; inflation_pct: number | null; source: string; notes: string | null };

/** ดัชนีเงินเฟ้อรายปี (ค่าเฉลี่ยทั้งปี) — ใช้กับวิธี "เงินเฟ้อ + ส่วนเพิ่ม" และข้อความเทียบในกล่องราคาขายขั้นต่ำ
 *  ADMIN เพิ่มปีถัดไปจาก % ที่ สนค. ประกาศ (ระบบต่อดัชนีจากปีก่อน) · แก้ / ลบได้เฉพาะปีล่าสุด */
export default function CpiTable({ rows, canEdit, thisYear }: { rows: CpiRow[]; canEdit: boolean; thisYear: number }) {
  const [all, setAll] = useState(false);
  const [state, action, pending] = useActionState<FxState, FormData>(saveCpiYear, {});
  const [delState, delAction, delPending] = useActionState<FxState, FormData>(deleteCpiYear, {});
  const [confirmDel, setConfirmDel] = useState(false);
  const last = rows[0]?.year ?? null;   // เรียงปีล่าสุดก่อน
  const nextYear = last != null && last + 1 < thisYear ? last + 1 : null;
  const [pick, setYear] = useState<number | null>(nextYear ?? last);
  // หลังเพิ่ม / ลบ ปีล่าสุดเปลี่ยน → กลับไปค่าเริ่มต้น
  const year = pick != null && (pick === nextYear || pick === last) ? pick : (nextYear ?? last);
  const shown = all ? rows : rows.slice(0, 10);
  const editing = year != null && year === last ? rows[0] : null;
  return (
    <div className="space-y-3 text-sm">
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
      {rows.length > 10 && (
        <button type="button" onClick={() => setAll(!all)} className="text-xs text-blue-700 hover:underline">
          {all ? "ย่อ (แสดง 10 ปีล่าสุด)" : `ดูย้อนหลังทั้งหมด (${rows.length} ปี ตั้งแต่ พ.ศ. ${rows[rows.length - 1].year + 543})`}</button>
      )}
      {canEdit && last != null && (
        <form action={action} className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
          <label className="text-xs text-slate-600">ปี (พ.ศ.)
            <select name="year" value={year ?? ""} onChange={(e) => { setYear(Number(e.target.value) - 543); setConfirmDel(false); }}
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
          {state.error && <span className="text-red-600">{state.error}</span>}
          <Flash on={state} as="span" className="text-emerald-700" />
          <p className="w-full text-xs text-slate-500">
            ใส่ &ldquo;อัตราเงินเฟ้อทั่วไปเฉลี่ยทั้งปี&rdquo; ที่ สนค. ประกาศ (ต้นเดือน ม.ค. ของปีถัดไป) · ระบบคิดดัชนี = ดัชนีปีก่อน × (1 + %) ·
            ใส่ได้เฉพาะปีที่จบแล้ว{nextYear == null && ` · ปี ${last + 1 + 543} ใส่ได้เมื่อจบปี`}
          </p>
        </form>
      )}
      {canEdit && last != null && rows.length > 2 && (
        <form action={delAction} className="flex flex-wrap items-center gap-2 text-xs">
          <input type="hidden" name="year" value={last} />
          {!confirmDel ? (
            <button type="button" onClick={() => setConfirmDel(true)} className="text-red-600 hover:underline">ลบปี {last + 543} (ปีล่าสุด)</button>
          ) : (<>
            <span className="text-slate-600">ลบปี {last + 543}? ราคาขายขั้นต่ำแบบเงินเฟ้อจะคิดถึงปี {last - 1 + 543} แทน</span>
            <button disabled={delPending} className="rounded-md bg-red-600 px-2 py-1 text-white hover:bg-red-700 disabled:opacity-50">ยืนยันลบ</button>
            <button type="button" onClick={() => setConfirmDel(false)} className="text-slate-600 hover:underline">ยกเลิก</button>
          </>)}
          {delState.error && <span className="text-red-600">{delState.error}</span>}
          <Flash on={delState} as="span" className="text-emerald-700" />
        </form>
      )}
    </div>
  );
}
