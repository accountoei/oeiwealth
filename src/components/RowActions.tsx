"use client";

import { useActionState, useState } from "react";
import { deleteRecord, updateRecord, type RecState } from "@/lib/records";

export type FieldSpec = {
  name: string; label: string; type?: "text" | "number" | "date" | "select";
  value?: string | number | null; options?: [string, string][]; width?: string;
};

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";

/** ปุ่ม แก้ไข / ลบ ต่อแถว (แก้ไขแบบฟอร์มในแถว · ลบ = Soft Delete พร้อมยืนยัน) */
export default function RowActions({ table, id, paths, fields = [], canEdit = true, canDelete = true, deleteNote }: {
  table: string; id: string; paths: string[]; fields?: FieldSpec[]; canEdit?: boolean; canDelete?: boolean; deleteNote?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [es, editAction, saving] = useActionState<RecState, FormData>(updateRecord, {});
  const [ds, delAction, deleting] = useActionState<RecState, FormData>(deleteRecord, {});
  if (ds.ok) return <span className="text-xs text-slate-400">ลบแล้ว</span>;
  return (
    <div className="inline-block text-left">
      {!editing && (
        <span className="inline-flex gap-2 text-xs">
          {canEdit && fields.length > 0 && <button type="button" onClick={() => setEditing(true)} className="text-slate-600 underline">แก้ไข</button>}
          {canDelete && (
            <form action={delAction} className="inline"
              onSubmit={(e) => { if (!confirm(`ลบรายการนี้?${deleteNote ? `\n${deleteNote}` : ""}\n(รายการที่ระบบสร้างต่อจากรายการนี้จะถูกลบตามไปด้วย)`)) e.preventDefault(); }}>
              <input type="hidden" name="table" value={table} />
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="paths" value={paths.join(",")} />
              <button disabled={deleting} className="text-red-600 underline disabled:opacity-50">{deleting ? "…" : "ลบ"}</button>
            </form>
          )}
        </span>
      )}
      {ds.error && <div className="text-xs text-red-600">{ds.error}</div>}
      {editing && (
        <form action={editAction} className="mt-1 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
          <input type="hidden" name="table" value={table} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="paths" value={paths.join(",")} />
          {fields.map((f) => (
            <label key={f.name} className="text-xs text-slate-600">{f.label}
              {f.type === "select" ? (
                <select name={`f_${f.name}`} defaultValue={String(f.value ?? "")} className={`mt-0.5 block ${small}`}>
                  {(f.options ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : (
                <input name={`f_${f.name}`} type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "decimal" : undefined}
                  defaultValue={f.value == null ? "" : String(f.value)} className={`mt-0.5 block ${f.width ?? (f.type === "date" ? "" : "w-32")} ${small}`} />
              )}
            </label>
          ))}
          <button disabled={saving} className="rounded-md bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-50">{saving ? "…" : "บันทึก"}</button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500">ปิด</button>
          {es.error && <span className="w-full text-xs text-red-600">{es.error}</span>}
          {es.ok && <span className="w-full text-xs text-emerald-700">{es.ok}</span>}
        </form>
      )}
    </div>
  );
}
