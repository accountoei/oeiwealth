"use client";

import { useActionState } from "react";
import { addPerson, updatePerson, setUserRole, setUserStatus, type ActionState } from "./actions";

export const RELATIONSHIP_LABEL: Record<string, string> = {
  SELF: "หัวหน้าครอบครัว", SPOUSE: "คู่สมรส", CHILD: "บุตร", CHILD_IN_LAW: "ลูกเขย / ลูกสะใภ้",
  GRANDCHILD: "หลาน", PARENT: "บิดา / มารดา", PARENT_IN_LAW: "พ่อตา แม่ยาย / พ่อแม่สามี",
  SIBLING: "พี่น้อง", RELATIVE: "ญาติอื่น ๆ", OTHER: "อื่น ๆ",
};
const PERSON_STATUS: Record<string, string> = { ACTIVE: "ใช้งาน", INACTIVE: "ไม่ใช้งาน", DECEASED: "เสียชีวิต" };
const ROLES: Record<string, string> = { ADMIN: "ผู้ดูแลระบบ", EDITOR: "ผู้แก้ไข", CONTRIBUTOR: "ผู้บันทึก", VIEWER: "ผู้ดู" };

const input = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";
const btn = "rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800 disabled:opacity-50";

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

export function PersonRow({ p }: { p: { id: string; name: string; relationship: string | null; status: string } }) {
  const [state, action, pending] = useActionState(updatePerson, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 py-2">
      <input type="hidden" name="id" value={p.id} />
      <input name="name" defaultValue={p.name} required className={`${input} min-w-40`} />
      <RelationshipSelect defaultValue={p.relationship ?? ""} />
      <select name="status" defaultValue={p.status} className={input}>
        {Object.entries(PERSON_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <button disabled={pending} className={btn}>บันทึก</button>
      <Msg s={state} />
    </form>
  );
}

export function UserRoleForm({ id, role }: { id: string; role: string }) {
  const [state, action, pending] = useActionState(setUserRole, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <select name="role" defaultValue={role} className={input}>
        {Object.entries(ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <button disabled={pending} className={btn}>เปลี่ยน</button>
      <Msg s={state} />
    </form>
  );
}

export function UserStatusForm({ id, status }: { id: string; status: string }) {
  const [state, action, pending] = useActionState(setUserStatus, {});
  const next = status === "DISABLED" ? "ACTIVE" : "DISABLED";
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={next} />
      <button disabled={pending}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
        {next === "DISABLED" ? "ปิดการใช้งาน" : "เปิดใช้งาน"}
      </button>
      <Msg s={state} />
    </form>
  );
}
