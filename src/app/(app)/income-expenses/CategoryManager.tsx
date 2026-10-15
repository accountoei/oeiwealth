"use client";

import { useActionState, useState } from "react";
import { addCategory, moveCategory, renameCategory, toggleCategory, type ActionState } from "./actions";

export type Cat = { id: string; name: string; active: boolean; used: number };

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const btn = "rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40";
// หมวดที่ระบบบันทึกให้อัตโนมัติ → เปลี่ยนชื่อไม่ได้ (ซ่อนจากตัวเลือกได้)
const SYSTEM_EXP = ["ประกัน", "ดอกเบี้ยจ่าย", "บ้าน / สาธารณูปโภค"];

/** ตารางหมวด: เพิ่ม · เปลี่ยนชื่อ (รายการเดิมเปลี่ยนตาม) · ซ่อน / ใช้งาน · เลื่อนลำดับ */
export default function CategoryManager({ kind, cats, canEdit, unit }: {
  kind: "EXPENSE" | "INCOME_OTHER"; cats: Cat[]; canEdit: boolean; unit: string;
}) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100"><th className="py-1.5 pr-2">ชื่อ{unit}</th><th className="px-2 text-right">ใช้อยู่ (รายการ)</th>
              <th className="px-2">สถานะ</th>{canEdit && <th></th>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cats.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-slate-500">ยังไม่มี{unit}</td></tr>}
            {cats.map((c, i) => (
              <Row key={`${c.id}-${c.name}-${c.active}`} c={c} first={i === 0} last={i === cats.length - 1} canEdit={canEdit}
                locked={kind === "EXPENSE" && SYSTEM_EXP.includes(c.name)} />
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && <AddForm kind={kind} unit={unit} />}
    </div>
  );
}

function Row({ c, first, last, canEdit, locked }: { c: Cat; first: boolean; last: boolean; canEdit: boolean; locked: boolean }) {
  const [editing, setEditing] = useState(false);
  const [rs, renameAction, renaming] = useActionState<ActionState, FormData>(renameCategory, {});
  const [ts, toggleAction, toggling] = useActionState<ActionState, FormData>(toggleCategory, {});
  const [ms, moveAction, moving] = useActionState<ActionState, FormData>(moveCategory, {});
  const err = rs.error || ts.error || ms.error;
  return (
    <tr className={`align-top ${c.active ? "" : "text-slate-400"}`}>
      <td className="py-1.5 pr-2">
        {editing ? (
          <form action={renameAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={c.id} />
            <input name="name" defaultValue={c.name} required autoFocus className={`w-48 ${small}`} />
            <button disabled={renaming} className="rounded-md bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50">{renaming ? "…" : "บันทึก"}</button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500">ยกเลิก</button>
            {c.used > 0 && <span className="w-full text-xs text-slate-500">รายการเดิม {c.used} รายการจะเปลี่ยนชื่อตาม (ยอดเงินไม่เปลี่ยน)</span>}
          </form>
        ) : (
          <>
            {c.name}
            {locked && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">ระบบใช้อัตโนมัติ</span>}
          </>
        )}
        {rs.ok && !editing && <div className="text-xs text-emerald-700">{rs.ok}</div>}
        {err && <div className="text-xs text-red-600">{err}</div>}
      </td>
      <td className="px-2 text-right tabular-nums">{c.used || "–"}</td>
      <td className="px-2 text-xs">{c.active ? <span className="text-emerald-700">ใช้งาน</span> : "ซ่อนอยู่"}</td>
      {canEdit && (
        <td className="whitespace-nowrap pl-2 text-right">
          <div className="inline-flex items-center gap-1">
            <form action={moveAction} className="inline-flex gap-1">
              <input type="hidden" name="id" value={c.id} />
              <button name="dir" value="-1" disabled={first || moving} title="เลื่อนขึ้น" className={btn}>↑</button>
              <button name="dir" value="1" disabled={last || moving} title="เลื่อนลง" className={btn}>↓</button>
            </form>
            {!editing && !locked && <button type="button" onClick={() => setEditing(true)} className={btn}>เปลี่ยนชื่อ</button>}
            <form action={toggleAction} className="inline">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="active" value={String(!c.active)} />
              <button disabled={toggling} className={btn}>{c.active ? "ซ่อน" : "ใช้งาน"}</button>
            </form>
          </div>
        </td>
      )}
    </tr>
  );
}

function AddForm({ kind, unit }: { kind: string; unit: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addCategory, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input name="name" required placeholder={`ชื่อ${unit}ใหม่`} className={`w-56 ${small}`} />
      <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "…" : `+ เพิ่ม${unit}`}</button>
      {state.ok && <span className="text-xs text-emerald-700">{state.ok}</span>}
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
