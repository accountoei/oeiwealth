"use client";

import { useActionState, useState } from "react";
import { deleteRecord, updateRecord, type RecState } from "@/lib/records";
import { useRowPanel } from "@/components/RowPanel";
import { useConfirmSubmit } from "@/components/ConfirmDialog";

export type FieldSpec = {
  name: string; label: string; type?: "text" | "number" | "date" | "select";
  value?: string | number | null; options?: [string, string][]; width?: string;
};

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";

/**
 * แก้ไข / ลบ ต่อแถว (ลบ = Soft Delete พร้อมยืนยัน)
 *   อยู่ในแถวตาราง → กดที่แถวเพื่อเปิดกล่องแก้ไข / ลบ ใต้แถว · ไม่อยู่ในตาราง → ปุ่ม "แก้ไข" / "ลบ" แบบเดิม
 */
export default function RowActions({ table, id, paths, fields = [], canEdit = true, canDelete = true, deleteNote, extra, editor }: {
  table: string; id: string; paths: string[]; fields?: FieldSpec[]; canEdit?: boolean; canDelete?: boolean; deleteNote?: string;
  /** ปุ่มเพิ่มเติมในกล่องใต้แถว (เช่น ดาวน์โหลด / อัปโหลดฉบับใหม่) */
  extra?: React.ReactNode;
  /** ฟอร์มแก้ไขของหน้านั้นเอง (มีปุ่มบันทึกของตัวเอง) — ใช้แทนช่อง fields */
  editor?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [es, editAction, saving] = useActionState<RecState, FormData>(updateRecord, {});
  const [ds, delAction, deleting] = useActionState<RecState, FormData>(deleteRecord, {});
  const editable = canEdit && (fields.length > 0 || !!editor);
  const row = useRowPanel(editable || canDelete || !!extra);
  const cf = useConfirmSubmit();
  if (ds.ok) return <span className="text-xs text-slate-400">ลบแล้ว</span>;

  const hidden = (
    <>
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="paths" value={paths.join(",")} />
    </>
  );
  const confirmDelete = cf.guard(`ลบรายการนี้?${deleteNote ? `\n${deleteNote}` : ""}\n(รายการที่ระบบสร้างต่อจากรายการนี้จะถูกลบตามไปด้วย)`,
    { danger: true, okLabel: "ยืนยันลบ" });
  const fieldInputs = fields.map((f) => (
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
  ));

  // กล่องใต้แถว (กดที่แถวเพื่อเปิด)
  const panel = (
    <div className="flex flex-wrap items-end justify-between gap-3 text-left">
      {editable && editor ? <div className="min-w-0 flex-1">{editor}</div> : editable ? (
        <form action={editAction} className="flex flex-wrap items-end gap-2">
          {hidden}
          {fieldInputs}
          <button disabled={saving} className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50">{saving ? "…" : "บันทึก"}</button>
          {es.error && <span className="w-full text-xs text-red-600">{es.error}</span>}
          {es.ok && <span className="w-full text-xs text-emerald-700">{es.ok}</span>}
        </form>
      ) : extra ? null : <span className="text-xs text-slate-500">รายการนี้แก้ไขไม่ได้ (ลบแล้วบันทึกใหม่)</span>}
      <div className="flex flex-wrap items-center gap-3">
        {extra}
        {canDelete && (
          <form action={delAction} onSubmit={confirmDelete}>
            {hidden}
            <button disabled={deleting} className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50">{deleting ? "…" : "ลบรายการนี้"}</button>
          </form>
        )}
        <button type="button" onClick={() => row.setOpen(false)} className="text-xs text-slate-500">ปิด</button>
      </div>
      {ds.error && <div className="w-full text-xs text-red-600">{ds.error}</div>}
      {cf.dialog}
    </div>
  );
  if (!row.showButtons) return row.render(panel);

  return (
    <div className="inline-block text-left">
      {cf.dialog}
      {!editing && (
        <span className="inline-flex flex-wrap items-center gap-2 text-xs">
          {extra}
          {editable && <button type="button" onClick={() => setEditing(true)} className="text-slate-600 underline">แก้ไข</button>}
          {canDelete && (
            <form action={delAction} className="inline" onSubmit={confirmDelete}>
              {hidden}
              <button disabled={deleting} className="text-red-600 underline disabled:opacity-50">{deleting ? "…" : "ลบ"}</button>
            </form>
          )}
        </span>
      )}
      {ds.error && <div className="text-xs text-red-600">{ds.error}</div>}
      {editing && editor && (
        <div className="mt-1 rounded-lg bg-slate-50 p-2">
          {editor}
          <button type="button" onClick={() => setEditing(false)} className="mt-1 text-xs text-slate-500">ปิด</button>
        </div>
      )}
      {editing && !editor && (
        <form action={editAction} className="mt-1 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
          {hidden}
          {fieldInputs}
          <button disabled={saving} className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-50">{saving ? "…" : "บันทึก"}</button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500">ปิด</button>
          {es.error && <span className="w-full text-xs text-red-600">{es.error}</span>}
          {es.ok && <span className="w-full text-xs text-emerald-700">{es.ok}</span>}
        </form>
      )}
    </div>
  );
}
