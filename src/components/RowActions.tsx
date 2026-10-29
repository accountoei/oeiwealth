"use client";

import { createContext, useActionState, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { deleteRecord, updateRecord, type RecState } from "@/lib/records";
import { useRowPanel } from "@/components/RowPanel";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import Modal from "@/components/Modal";
import Flash from "@/components/Flash";

export type FieldSpec = {
  name: string; label: string; type?: "text" | "number" | "date" | "select";
  value?: string | number | null; options?: [string, string][]; width?: string;
  /** แสดงอย่างเดียว (ค่าที่คำนวณจากช่องอื่น เช่น มูลค่า = จำนวน × ราคา) · ไม่ส่งไปบันทึก */
  readOnly?: boolean;
  /** เต็มความกว้างหน้าต่าง (เช่น หมายเหตุ) */
  wide?: boolean;
  /** คำนวณจากช่องอื่นเมื่อช่องนั้นถูกแก้ (a × b หรือ a ÷ b · อ้างชื่อช่อง) เช่น มูลค่า = จำนวน × ราคา · ราคา = มูลค่า ÷ จำนวน */
  calc?: { op: "mul" | "div"; a: string; b: string; digits?: number };
};

const toNum = (s: string) => Number(s.replace(/,/g, ""));
/** แก้ช่องหนึ่ง → ช่องที่คำนวณจากช่องนั้นเปลี่ยนตาม (ไม่ย้อนกลับไปแก้ช่องที่กำลังพิมพ์) */
function recalc(form: HTMLFormElement, changed: string, fields: FieldSpec[]) {
  const el = (n: string) => form.querySelector<HTMLInputElement>(`[data-f="${n}"]`);
  for (const f of fields) {
    if (!f.calc || f.name === changed || (f.calc.a !== changed && f.calc.b !== changed)) continue;
    const a = toNum(el(f.calc.a)?.value ?? ""), b = toNum(el(f.calc.b)?.value ?? ""), out = el(f.name);
    if (!out || !Number.isFinite(a) || !Number.isFinite(b) || (f.calc.op === "div" && b === 0)) continue;
    const v = f.calc.op === "mul" ? a * b : a / b;
    out.value = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: f.calc.digits ?? 2 });
  }
}

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";

const DeleteSlotCtx = createContext<ReactNode>(null);
/** ปุ่มลบของ RowActions สำหรับฟอร์มแก้ไขของหน้าเอง (editor) — วางไว้ข้างปุ่มบันทึก · นอก RowActions ไม่แสดงอะไร */
export function DeleteSlot() { return useContext(DeleteSlotCtx); }

/**
 * แก้ไข / ลบ ต่อแถว (ลบ = Soft Delete พร้อมยืนยัน) — เปิดเป็นหน้าต่าง pop up เสมอ
 *   อยู่ในแถวตาราง → กดที่แถว · ไม่อยู่ในตาราง → ปุ่ม "แก้ไข" / "ลบ"
 *   บันทึกสำเร็จ → หน้าต่างปิดเอง + รีเฟรชหน้า
 */
export default function RowActions({ table, id, paths, fields = [], cols = 3, canEdit = true, canDelete = true, deleteNote, deleteEffect, extra, section, editor, button, buttonClass, deleteControl }: {
  table: string; id: string; paths: string[]; fields?: FieldSpec[]; canEdit?: boolean; canDelete?: boolean; deleteNote?: string;
  /** จำนวนช่องต่อแถวบนจอกว้าง (4 = วันที่ · จำนวน · ราคา · มูลค่า แถวเดียว) */
  cols?: 3 | 4;
  /** ผลของการลบที่บอกได้ชัด (เช่น "เงินออกจากบัญชี A จะถูกยกเลิก") — ใช้แทนบรรทัดกลางในวงเล็บ */
  deleteEffect?: string;
  /** ปุ่มเพิ่มเติมในกล่องใต้แถว (เช่น ดาวน์โหลด / อัปโหลดฉบับใหม่) */
  extra?: React.ReactNode;
  /** ส่วนเพิ่มเติมเต็มความกว้างต่อจากฟอร์มแก้ไข (มีปุ่มของตัวเอง เช่น "เอกสารของ" ในหน้า Documents) */
  section?: React.ReactNode;
  /** ฟอร์มแก้ไขของหน้านั้นเอง (มีปุ่มบันทึกของตัวเอง) — ใช้แทนช่อง fields · วาง <DeleteSlot /> ข้างปุ่มบันทึก */
  editor?: React.ReactNode;
  /** ปุ่มลบแบบอื่นของหน้านั้น (เช่น ลบสัญญาเช่า ผ่าน DeleteEntity) — วางข้างปุ่มบันทึกแทนปุ่มลบปกติ (ใช้กับ canDelete={false}) */
  deleteControl?: React.ReactNode;
  /** ปุ่มเดียว (เช่น "แก้ไข") เปิดหน้าต่างแก้ไข + ลบ — ใช้แทนการกดที่แถว (ช่องสถานะของตารางรายได้ / ค่าใช้จ่าย) */
  button?: string;
  /** หน้าตาของปุ่มเดียว (เช่น ลิงก์ "รับแล้ว 5 ต.ค. · 500.00" ในแท็บบันทึกรับ) · ไม่ใส่ = ปุ่มขอบเทา */
  buttonClass?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [es, editAction, saving] = useActionState<RecState, FormData>(updateRecord, {});
  const [ds, delAction, deleting] = useActionState<RecState, FormData>(deleteRecord, {});
  const editable = canEdit && (fields.length > 0 || !!editor);
  const row = useRowPanel(!button && (editable || canDelete || !!extra || !!section));
  const cf = useConfirmSubmit();
  const router = useRouter();
  const delFormId = `del-${useId()}`;
  useEffect(() => { if (ds.ok) router.refresh(); }, [ds.ok, router]);   // ลบแล้ว → รีเฟรชหน้า
  if (ds.ok) return <span className="text-xs text-slate-400">ลบแล้ว</span>;

  const hidden = (
    <>
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="paths" value={paths.join(",")} />
    </>
  );
  const confirmDelete = cf.guard(`ลบรายการนี้?${deleteNote ? `\n${deleteNote}` : ""}\n${deleteEffect ?? "(ข้อมูลที่ระบบสร้างขึ้นจากรายการนี้ เช่น เงินเข้า–ออกบัญชี จะถูกยกเลิกตามไปด้วย)"}`,
    { danger: true, okLabel: "ยืนยันลบ" });
  const fieldInputs = fields.map((f) => (
    <label key={f.name} className={`text-sm text-slate-700 ${f.wide ? "col-span-full" : ""}`}>{f.label}
      {f.readOnly ? (
        <input type="text" readOnly tabIndex={-1} data-f={f.name} data-plain defaultValue={f.value == null ? "" : String(f.value)}
          className={`mt-1 block w-full ${small} bg-slate-50 py-2 text-slate-600 ${f.type === "number" ? "text-right tabular-nums" : ""}`} />
      ) : f.type === "select" ? (
        <select name={`f_${f.name}`} defaultValue={String(f.value ?? "")} className={`mt-1 block w-full ${small} py-2`}>
          {(f.options ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : (
        <input name={`f_${f.name}`} data-f={f.name} type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "decimal" : undefined}
          defaultValue={f.value == null ? "" : String(f.value)} className={`mt-1 block w-full ${small} py-2 ${f.type === "number" ? "text-right" : ""}`} />
      )}
    </label>
  ));
  // ปุ่มลบอยู่ข้างปุ่มบันทึก (ตกลง 24 ต.ค. 2026 · ฟอร์มของหน้าเองด้วย 27 ต.ค.) — ฟอร์มลบแยกอยู่นอกฟอร์มแก้ไข ปุ่มผูกด้วย form={id}
  const delInline = editable;
  const delButton = (
    <button form={delFormId} disabled={deleting} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">{deleting ? "กำลังลบ…" : "ลบรายการนี้"}</button>
  );
  const delForm = canDelete ? <form id={delFormId} action={delAction} onSubmit={confirmDelete}>{hidden}</form> : null;
  const editorWithDelete = editor && <DeleteSlotCtx.Provider value={canDelete ? delButton : null}>{editor}</DeleteSlotCtx.Provider>;
  const editForm = (
    <form action={editAction} className="space-y-3"
      onInput={fields.some((f) => f.calc) ? (e) => {
        const n = (e.target as HTMLElement).dataset?.f;
        if (n) recalc(e.currentTarget, n, fields);
      } : undefined}>
      {hidden}
      <div className={`grid gap-3 sm:grid-cols-2 ${cols === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>{fieldInputs}</div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={saving} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{saving ? "กำลังบันทึก…" : "บันทึก"}</button>
        {canDelete && delInline && delButton}
        {deleteControl}
        {es.error && <span className="text-sm text-red-600">{es.error}</span>}
        <Flash on={es} as="span" className="text-sm text-emerald-700" />
      </div>
    </form>
  );

  // เนื้อหาในหน้าต่าง: ฟอร์มแก้ไข (ถ้ามี) + ปุ่มเพิ่มเติม / ลบ
  const panel = (
    <div className="space-y-4 text-left">
      {editable ? (editorWithDelete || editForm)
        : extra ? null : <p className="text-sm text-slate-500">รายการนี้แก้ไขไม่ได้ (ลบแล้วบันทึกใหม่)</p>}
      {section && <div className={editable ? "border-t border-slate-100 pt-3" : ""}>{section}</div>}
      {delForm}
      {(extra || (canDelete && !delInline)) && (
        <div className={`flex flex-wrap items-center gap-3 ${editable ? "border-t border-slate-100 pt-3" : ""}`}>
          {extra}
          {canDelete && !delInline && delButton}
        </div>
      )}
      {ds.error && <div className="text-sm text-red-600">{ds.error}</div>}
      {cf.dialog}
    </div>
  );
  const title = editable ? "แก้ไขรายการ" : "จัดการรายการ";
  if (button) return (
    <>
      <button type="button" onClick={() => setPanelOpen(true)}
        className={buttonClass ?? "rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"}>{button}</button>
      {panelOpen && <Modal title={title} onClose={() => setPanelOpen(false)}>{panel}</Modal>}
    </>
  );
  if (!row.showButtons) return row.render(panel, title);

  return (
    <div className="inline-block text-left">
      {cf.dialog}
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
      {ds.error && <div className="text-xs text-red-600">{ds.error}</div>}
      {editing && (
        <Modal title="แก้ไขรายการ" onClose={() => setEditing(false)}>{editorWithDelete || editForm}{section && <div className="mt-4 border-t border-slate-100 pt-3">{section}</div>}{delForm}</Modal>
      )}
    </div>
  );
}
