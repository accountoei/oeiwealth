"use client";

import { useActionState, useState } from "react";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { useActionSlot } from "@/components/ActionBar";
import { addPerson, updateFamily, type ActionState } from "./actions";
import { RELATIONSHIP_LABEL } from "@/lib/format";

const input = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";
const btn = "rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <span className="text-xs text-red-600">{s.error}</span>;
  if (s.ok) return <span className="text-xs text-emerald-700">{s.ok}</span>;
  return null;
}

function RelationshipSelect({ defaultValue }: { defaultValue?: string }) {
  return (
    <select name="relationship" defaultValue={defaultValue ?? ""} required className={input}>
      <option value="" disabled>ความสัมพันธ์…</option>
      {Object.entries(RELATIONSHIP_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

/** แก้ไขชื่อครอบครัว + หัวหน้าครอบครัว (ADMIN) — เปลี่ยนหัวหน้าต้องยืนยัน เพราะความสัมพันธ์ของทุกคนจะคำนวณใหม่ */
export function FamilyForm({ name, headId, candidates }: { name: string; headId: string | null; candidates: { id: string; name: string }[] }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState(updateFamily, {});
  const [head, setHead] = useState(headId ?? "");
  const c = useConfirmSubmit();
  const trigger = <button type="button" onClick={() => { setHead(headId ?? ""); setOpen(!open); }} className={activeCls("text-xs text-blue-700 underline")}>แก้ไข</button>;
  if (!open) return trigger;
  const newHead = candidates.find((x) => x.id === head)?.name;
  return present(trigger, (
    <>
      <form action={action} className="space-y-3"
        onSubmit={c.guard(`ตั้ง ${newHead} เป็นหัวหน้าครอบครัว?\nความสัมพันธ์ของสมาชิกทุกคนจะคำนวณใหม่เทียบกับคนนี้`, {}, !!head && head !== (headId ?? ""))}>
        <h2 className="font-medium text-slate-900">แก้ไขครอบครัว</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-700">ชื่อครอบครัว *
            <input name="name" defaultValue={name} required maxLength={120} className={`${input} mt-1 block w-full`} />
            <span className="mt-1 block text-xs text-slate-500">แสดงเป็นหัวข้อหน้า Dashboard</span>
          </label>
          <label className="text-sm text-slate-700">หัวหน้าครอบครัว *
            <select name="head_person_id" value={head} onChange={(e) => setHead(e.target.value)} required className={`${input} mt-1 block w-full`}>
              <option value="" disabled>เลือกสมาชิก…</option>
              {candidates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">ความสัมพันธ์ของทุกคนคิดเทียบกับคนนี้ (เลือกได้เฉพาะสมาชิก Active)</span>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
          <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
          <Msg s={state} />
        </div>
      </form>
      {c.dialog}
    </>
  ));
}

export function AddPersonForm() {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState(addPerson, {});
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls("rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700")}>+ เพิ่มสมาชิก</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-3">
      <h2 className="font-medium text-slate-900">เพิ่มสมาชิกครอบครัว</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-slate-700">ชื่อสมาชิก *<input name="name" required className={`${input} mt-1 block w-full`} /></label>
        <label className="text-sm text-slate-700">ความสัมพันธ์ *<div className="mt-1 [&>select]:w-full"><RelationshipSelect /></div></label>
        <label className="text-sm text-slate-700">วันเกิด<input name="birth_date" type="date" className={`${input} mt-1 block w-full`} /></label>
      </div>
      <p className="text-xs text-slate-500">ข้อมูลอื่น (ชื่อเต็ม รูป ที่อยู่ เอกสาร) ใส่ต่อได้ที่หน้าของสมาชิกคนนั้น</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "เพิ่มสมาชิก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}
