"use client";

import { useActionState, useState } from "react";
import { addMembership, addPoints, type ActionState } from "./actions";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
type P = { id: string; name: string };

function Shell({ label, title, action, pending, state, children }: {
  label: string; title: string; action: (f: FormData) => void; pending: boolean; state: ActionState; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">{label}</button>;
  return (
    <form action={action} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="font-medium text-slate-900">{title}</h3>
      {children}
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}

export function MembershipForm({ persons }: { persons: P[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addMembership, {});
  return (
    <Shell label="+ สมาชิกภาพ" title="เพิ่มสมาชิกภาพ (สายการบิน โรงแรม ร้านค้า ฯลฯ)" action={action} pending={pending} state={state}>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">สมาชิก *<select name="person_id" required className={input}>{persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="text-sm">โปรแกรม *<input name="program_name" required placeholder="เช่น Royal Orchid Plus" className={input} /></label>
        <label className="text-sm">เลขสมาชิก<input name="member_id" autoComplete="off" className={input} /></label>
        <label className="text-sm">ระดับ<input name="tier" placeholder="เช่น Gold" className={input} /></label>
        <label className="text-sm">หมดอายุ<input name="expiry_date" type="date" className={input} /></label>
        <label className="text-sm">สิทธิประโยชน์<input name="benefits" className={input} /></label>
      </div>
    </Shell>
  );
}

export function PointsForm({ persons, links, today }: { persons: P[]; links: { value: string; label: string }[]; today: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addPoints, {});
  return (
    <Shell label="+ แต้ม / ไมล์" title="เพิ่มบัญชีแต้มสะสม / ไมล์" action={action} pending={pending} state={state}>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">สมาชิก *<select name="person_id" required className={input}>{persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="text-sm">โปรแกรม *<input name="program_name" required placeholder="เช่น KTC Forever / ไมล์ ROP" className={input} /></label>
        <label className="text-sm">ผูกกับ
          <select name="link" defaultValue="" className={input}><option value="">— ไม่ผูก —</option>{links.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select>
        </label>
        <label className="text-sm">ยอดแต้มคงเหลือ<input name="balance" inputMode="decimal" className={input} /></label>
        <label className="text-sm">ณ วันที่<input name="balance_date" type="date" defaultValue={today} max={today} className={input} /></label>
        <label className="text-sm">แต้มหมดอายุ<input name="expiry_date" type="date" className={input} /></label>
      </div>
      <p className="text-xs text-slate-500">แต้ม / ไมล์ ไม่นับรวมใน Net Worth</p>
    </Shell>
  );
}
