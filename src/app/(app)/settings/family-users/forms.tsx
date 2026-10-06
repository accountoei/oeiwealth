"use client";

import { useActionState, useState } from "react";
import {
  addPerson, inviteUser, resendInvite, resetMfa, resetPasswordLink, setUserRole, setUserStatus, updatePerson, type ActionState, type InviteState,
} from "./actions";

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

/* ---------------------------------------------------------------- เชิญผู้ใช้ */
function LinkBox({ s }: { s: InviteState }) {
  const [copied, setCopied] = useState(false);
  if (!s.link) return null;
  const text = s.link.includes("type=recovery")
    ? `ลิงก์ตั้งรหัสผ่านใหม่ Family Wealth Vault (${s.email})\nเปิดลิงก์แล้วกด "ยืนยันและตั้งรหัสผ่าน":\n${s.link}\n(ลิงก์ใช้ได้ครั้งเดียวและมีอายุจำกัด)`
    : `เชิญเข้าใช้ Family Wealth Vault (${s.email})\nเปิดลิงก์แล้วกด "ยืนยันและตั้งรหัสผ่าน":\n${s.link}\n(ลิงก์ใช้ได้ครั้งเดียวและมีอายุจำกัด)`;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
      <div className="font-medium text-emerald-900">ลิงก์สำหรับ {s.email}</div>
      <textarea readOnly value={text} rows={4} className="w-full rounded-md border border-emerald-200 bg-white p-2 font-mono text-xs" />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btn}
          onClick={() => { navigator.clipboard.writeText(text); setCopied(true); }}>{copied ? "คัดลอกแล้ว ✓" : "คัดลอกข้อความ"}</button>
        <span className="text-xs text-emerald-800">ส่งให้ผู้รับทาง LINE / อีเมลส่วนตัว · ระบบไม่ได้ส่งอีเมลให้ · ลิงก์ไม่ถูกเก็บไว้ ปิดหน้านี้แล้วต้องสร้างใหม่</span>
      </div>
    </div>
  );
}

export function InviteForm({ persons }: { persons: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteUser, {});
  return (
    <div>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">อีเมล
          <input name="email" type="email" required placeholder="name@example.com" className={`mt-1 block w-56 ${input}`} />
        </label>
        <label className="text-xs text-slate-600">สิทธิ์
          <select name="role" defaultValue="VIEWER" className={`mt-1 block ${input}`}>
            {Object.entries(ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">เป็นสมาชิกครอบครัว
          <select name="person_id" defaultValue="" className={`mt-1 block ${input}`}>
            <option value="">— ไม่ใช่สมาชิก (เช่น ผู้ดูแลระบบภายนอก) —</option>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button disabled={pending} className={btn}>{pending ? "กำลังสร้าง…" : "เชิญ"}</button>
        <Msg s={state.link ? {} : state} />
      </form>
      <LinkBox s={state} />
    </div>
  );
}

export function ResendInviteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(resendInvite, {});
  return (
    <div>
      <form action={action} className="inline">
        <input type="hidden" name="id" value={id} />
        <button disabled={pending} className="text-xs text-slate-700 underline disabled:opacity-50">
          {pending ? "…" : "สร้างลิงก์ใหม่"}
        </button>
        {!state.link && <Msg s={state} />}
      </form>
      <LinkBox s={state} />
    </div>
  );
}

/* ---------------------------------------------------------------- ลืมรหัสผ่าน / MFA หาย */
export function UserRecovery({ id }: { id: string }) {
  const [ps, pwAction, pwPending] = useActionState<InviteState, FormData>(resetPasswordLink, {});
  const [ms, mfaAction, mfaPending] = useActionState<ActionState, FormData>(resetMfa, {});
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-3 text-xs">
        <form action={pwAction}><input type="hidden" name="id" value={id} />
          <button disabled={pwPending} className="text-slate-700 underline disabled:opacity-50">{pwPending ? "…" : "ลิงก์ตั้งรหัสผ่านใหม่"}</button>
        </form>
        <form action={mfaAction} onSubmit={(e) => { if (!confirm("ลบ MFA ของผู้ใช้นี้? (ใช้เมื่อทำมือถือหาย) ผู้ใช้ต้องสแกน QR ใหม่ตอนเข้าระบบครั้งถัดไป")) e.preventDefault(); }}>
          <input type="hidden" name="id" value={id} />
          <button disabled={mfaPending} className="text-slate-700 underline disabled:opacity-50">{mfaPending ? "…" : "รีเซ็ต MFA"}</button>
        </form>
      </div>
      {!ps.link && ps.error && <p className="text-xs text-red-600">{ps.error}</p>}
      <LinkBox s={ps} />
      <Msg s={ms} />
    </div>
  );
}
