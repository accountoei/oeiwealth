"use client";

import { useActionState } from "react";
import { updateRecord, type RecState } from "@/lib/records";
import { useStatusDelete, type RemoveOpt } from "./DeleteEntity";

/**
 * เปลี่ยนสถานะทันทีเมื่อเลือก (เช่น ปิดบัญชี / ขายแล้ว)
 *   remove: เพิ่มตัวเลือก "ลบ…" ท้ายรายการ (ADMIN / EDITOR) → หน้าต่างยืนยันลบ (แบบเดียวกับ "สถานะพอร์ต")
 */
export default function StatusSelect({ table, id, value, options, paths, field = "status", label = "สถานะ", remove }: {
  table: string; id: string; value: string; options: [string, string][]; paths: string[]; field?: string; label?: string;
  remove?: RemoveOpt;
}) {
  const [state, action, pending] = useActionState<RecState, FormData>(updateRecord, {});
  const del = useStatusDelete(remove, value);
  return (
    <>
    <form action={action} className="inline-flex items-center gap-2 text-sm">
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      <span className="text-xs text-slate-500">{label}</span>
      <select name={`f_${field}`} defaultValue={value} disabled={pending}
        onChange={(e) => { if (del.pick(e)) return; e.currentTarget.form?.requestSubmit(); }}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        {del.option}
      </select>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      {state.ok && <span className="text-xs text-emerald-700">✓</span>}
    </form>
    {del.dialog}
    </>
  );
}
