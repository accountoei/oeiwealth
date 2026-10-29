"use client";

import { useActionState, useState, type ReactNode } from "react";
import Modal from "@/components/Modal";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import {
  inviteUser, resendInvite, resetMfa, resetPasswordLink, setUserRole, setUserStatus, type ActionState, type InviteState,
} from "./actions";
import Flash from "@/components/Flash";

const ROLES: Record<string, string> = { ADMIN: "ผู้ดูแลระบบ", EDITOR: "ผู้แก้ไข", CONTRIBUTOR: "ผู้บันทึก", VIEWER: "ผู้ดู" };

const input = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";
const btn = "rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <span className="text-xs text-red-600">{s.error}</span>;
  if (s.ok) return <Flash on={s} as="span" className="text-xs text-emerald-700" />;
  return null;
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
    // data-keep-open: หน้าต่างไม่ปิดเอง (ต้องคัดลอกลิงก์ก่อน)
    <div data-keep-open className="mt-3 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
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
        <button disabled={pending} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {pending ? "…" : "สร้างลิงก์เชิญใหม่"}
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
  const cf = useConfirmSubmit();
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <form action={pwAction}><input type="hidden" name="id" value={id} />
          <button disabled={pwPending} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">{pwPending ? "…" : "ลิงก์ตั้งรหัสผ่านใหม่"}</button>
        </form>
        <form action={mfaAction} onSubmit={cf.guard("ลบ MFA ของผู้ใช้นี้? (ใช้เมื่อทำมือถือหาย) ผู้ใช้ต้องสแกน QR ใหม่ตอนเข้าระบบครั้งถัดไป", {danger: true})}>{cf.dialog}
          <input type="hidden" name="id" value={id} />
          <button disabled={mfaPending} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">{mfaPending ? "…" : "รีเซ็ต MFA"}</button>
        </form>
      </div>
      {!ps.link && ps.error && <p className="text-xs text-red-600">{ps.error}</p>}
      <LinkBox s={ps} />
      <Msg s={ms} />
    </div>
  );
}

/* ---------------------------------------------------------------- ปุ่มเปิด pop up */
function PopupButton({ label, title, className, children }: { label: string; title: string; className: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>{label}</button>
      {open && <Modal title={title} onClose={() => setOpen(false)}>{children}</Modal>}
    </>
  );
}

/** ปุ่ม "+ เชิญผู้ใช้ใหม่" (มุมขวาบนของกล่องผู้ใช้ระบบ) */
export function InviteButton({ persons }: { persons: { id: string; name: string }[] }) {
  return (
    <PopupButton label="+ เชิญผู้ใช้ใหม่" title="เชิญผู้ใช้ใหม่" className={`${btn} px-4 py-2`}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          ระบบสร้างลิงก์ให้คัดลอกไปส่งเอง · ผู้รับเปิดลิงก์ ตั้งรหัสผ่าน แล้วเข้าใช้ได้ทันที · ผู้ใช้ที่ไม่ใช่สมาชิกครอบครัว (เช่น ผู้ดูแลระบบภายนอก) ไม่ต้องเลือกสมาชิก
        </p>
        <InviteForm persons={persons} />
      </div>
    </PopupButton>
  );
}

/** ปุ่ม "จัดการ" ท้ายแถวผู้ใช้ → pop up รวม เปลี่ยนสิทธิ์ · เปิด / ปิดการใช้งาน · ลิงก์เชิญใหม่ · ลิงก์ตั้งรหัสผ่านใหม่ · รีเซ็ต MFA */
export function UserManage({ id, email, role, status, statusLabel }: { id: string; email: string; role: string; status: string; statusLabel: string }) {
  const sec = "space-y-2 border-t border-slate-100 pt-3";
  return (
    <PopupButton label="จัดการ" title={`จัดการผู้ใช้ · ${email}`} className={btn}>
      <div className="space-y-4 text-sm">
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-slate-500">สิทธิ์</h3>
          <UserRoleForm id={id} role={role} />
        </div>
        <div className={sec}>
          <h3 className="text-xs font-medium text-slate-500">สถานะ: <span className="text-slate-800">{statusLabel}</span></h3>
          <UserStatusForm id={id} status={status} />
        </div>
        {status === "INVITED" && (
          <div className={sec}>
            <h3 className="text-xs font-medium text-slate-500">ลิงก์เชิญ (ผู้ใช้ยังไม่ได้เข้าใช้ครั้งแรก)</h3>
            <ResendInviteForm id={id} />
          </div>
        )}
        {status === "ACTIVE" && (
          <div className={sec}>
            <h3 className="text-xs font-medium text-slate-500">ลืมรหัสผ่าน / ทำมือถือหาย</h3>
            <UserRecovery id={id} />
          </div>
        )}
      </div>
    </PopupButton>
  );
}
