"use client";

import { useActionState } from "react";
import { addPerson, updateFamilyName, type ActionState } from "./actions";
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

export function FamilyNameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(updateFamilyName, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="name" defaultValue={name} required maxLength={120} className={`${input} min-w-64`} aria-label="ชื่อครอบครัว" />
      <button disabled={pending} className={btn}>บันทึก</button>
      <Msg s={state} />
    </form>
  );
}

export function AddPersonForm() {
  const [state, action, pending] = useActionState(addPerson, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="name" placeholder="ชื่อสมาชิก" required className={input} />
      <RelationshipSelect />
      <input name="birth_date" type="date" className={input} aria-label="วันเกิด" />
      <button disabled={pending} className={btn}>เพิ่มสมาชิก</button>
      <Msg s={state} />
    </form>
  );
}
