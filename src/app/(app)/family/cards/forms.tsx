"use client";

import { useActionState, useState } from "react";
import { createCard, updateCardBalance, updateCardStatus, type ActionState } from "@/app/(app)/liabilities/actions";
import { CURRENCIES } from "@/lib/format";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <p className="text-sm text-emerald-700">{s.ok}</p>;
  return null;
}

export function NewCardForm({ persons, defaultDate, today, minDate, isSetup }: {
  persons: { id: string; name: string }[]; defaultDate: string; today: string; minDate: string; isSetup: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(createCard, {});
  if (!open) return <button onClick={() => setOpen(true)} className={btn}>+ เพิ่มบัตรเครดิต</button>;
  return (
    <form action={action} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-3">
      <h2 className="md:col-span-3 font-medium text-slate-900">เพิ่มบัตรเครดิต</h2>
      <label className="text-sm">ผู้ถือบัตร *
        <select name="person_id" required className={input}>
          {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="text-sm">ธนาคาร / ผู้ออกบัตร *<input name="issuer" required placeholder="เช่น KBank" className={input} /></label>
      <label className="text-sm">ชื่อบัตร<input name="card_name" placeholder="เช่น Platinum" className={input} /></label>
      <label className="text-sm">เลขบัตร 4 ตัวท้าย
        <input name="card_last4" inputMode="numeric" maxLength={4} autoComplete="off" placeholder="1234" className={input} />
      </label>
      <label className="text-sm">สกุลเงิน
        <select name="currency" defaultValue="THB" className={input}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
      </label>
      <label className="text-sm">วงเงิน<input name="credit_limit" inputMode="decimal" className={input} /></label>
      <label className="text-sm">วันตัดรอบ (ทุกวันที่)<input name="statement_day" type="number" min={1} max={31} className={input} /></label>
      <label className="text-sm">วันครบกำหนดชำระ (ทุกวันที่)<input name="due_day" type="number" min={1} max={31} className={input} /></label>
      <label className="text-sm">ค่าธรรมเนียมรายปี<input name="annual_fee" inputMode="decimal" className={input} /></label>
      <label className="text-sm">วันหมดอายุบัตร<input name="expiry_date" type="date" className={input} /></label>
      <label className="text-sm">ยอดค้างชำระ<input name="outstanding_balance" inputMode="decimal" defaultValue="0" className={input} /></label>
      <label className="text-sm">ยอด ณ วันที่
        <input name="balance_date" type="date" required defaultValue={defaultDate} min={isSetup ? undefined : minDate} max={today} className={input} />
      </label>
      <label className="text-sm md:col-span-3">หมายเหตุ<input name="notes" className={input} /></label>
      <p className="md:col-span-3 text-xs text-slate-500">
        {isSetup
          ? `ช่วงตั้งต้น: ใช้ยอดค้างของบัตร ณ วันก่อน Go-live (${defaultDate}) เพื่อนับเป็นยอดตั้งต้น`
          : `ยอด ณ วันที่ต้องไม่ก่อนวัน Go-live (${minDate})`}
        {" · "}ห้ามกรอกเลขบัตรเต็ม / CVV
      </p>
      <div className="md:col-span-3 flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกบัตร"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function CardBalanceForm({ cardId, currency, today, minDate }:
  { cardId: string; currency: string; today: string; minDate: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(updateCardBalance, {});
  if (!open) return <button onClick={() => setOpen(true)} className="text-xs text-slate-700 underline">อัปเดตยอด</button>;
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="card_id" value={cardId} />
      <label className="text-xs">ยอดค้าง ({currency})
        <input name="outstanding_balance" required inputMode="decimal" className="mt-1 block w-32 rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </label>
      <label className="text-xs">ณ วันที่
        <input name="balance_date" type="date" required defaultValue={today} min={minDate} max={today}
          className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </label>
      <label className="text-xs">หมายเหตุ (ไม่บังคับ)
        <input name="notes" className="mt-1 block w-40 rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </label>
      <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">บันทึก</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  );
}

export function CardStatusForm({ cardId, status }: { cardId: string; status: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateCardStatus, {});
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="card_id" value={cardId} />
      <select name="status" defaultValue={status} disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs">
        <option value="ACTIVE">ใช้งาน</option>
        <option value="SUSPENDED">ระงับชั่วคราว</option>
        <option value="CLOSED">ยกเลิกบัตรแล้ว</option>
      </select>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
