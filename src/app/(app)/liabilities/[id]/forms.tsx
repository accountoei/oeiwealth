"use client";

import { useActionState } from "react";
import { addLiabilityBalance, updateLiabilityInfo, type ActionState } from "../actions";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <p className="text-sm text-emerald-700">{s.ok}</p>;
  return null;
}

export function AddBalanceForm({ liabilityId, currency, today, minDate }:
  { liabilityId: string; currency: string; today: string; minDate: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addLiabilityBalance, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="liability_id" value={liabilityId} />
      <label className="text-sm">ยอดคงค้าง ({currency})
        <input name="balance" required inputMode="decimal" className={`mt-1 block w-44 ${input}`} />
      </label>
      <label className="text-sm">ยอด ณ วันที่
        <input name="valuation_date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block ${input}`} />
      </label>
      <label className="text-sm">ที่มา
        <select name="source" defaultValue="STATEMENT" className={`mt-1 block ${input}`}>
          <option value="STATEMENT">Statement / ใบแจ้งยอด</option>
          <option value="USER">ผู้ใช้ประมาณเอง</option>
        </select>
      </label>
      <label className="text-sm flex-1 min-w-48">หมายเหตุ
        <input name="notes" className={`mt-1 block w-full ${input}`} />
      </label>
      <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกยอด"}</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  );
}

type Info = { id: string; name: string; lender: string | null; interest_rate: number | null; monthly_payment: number | null;
  payment_due_day: number | null; due_date: string | null; status: string; notes: string | null };

export function EditLiabilityForm({ l }: { l: Info }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateLiabilityInfo, {});
  const f = "mt-1 block w-full " + input;
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="liability_id" value={l.id} />
      <label className="text-sm">ชื่อที่ใช้เรียก<input name="name" required defaultValue={l.name} className={f} /></label>
      <label className="text-sm">ผู้ให้กู้<input name="lender" defaultValue={l.lender ?? ""} className={f} /></label>
      <label className="text-sm">อัตราดอกเบี้ย (% ต่อปี)<input name="interest_rate" inputMode="decimal" defaultValue={l.interest_rate ?? ""} className={f} /></label>
      <label className="text-sm">ค่างวดต่อเดือน<input name="monthly_payment" inputMode="decimal" defaultValue={l.monthly_payment ?? ""} className={f} /></label>
      <label className="text-sm">ครบกำหนดจ่ายทุกวันที่<input name="payment_due_day" type="number" min={1} max={31} defaultValue={l.payment_due_day ?? ""} className={f} /></label>
      <label className="text-sm">วันครบกำหนดสัญญา<input name="due_date" type="date" defaultValue={l.due_date ?? ""} className={f} /></label>
      <label className="text-sm">สถานะ
        <select name="status" defaultValue={l.status} className={f}>
          <option value="ACTIVE">ยังผ่อนอยู่</option>
          <option value="CLOSED">ปิดหนี้แล้ว</option>
          <option value="WRITTEN_OFF">ตัดหนี้สูญ / ยกหนี้</option>
        </select>
      </label>
      <label className="text-sm">หมายเหตุ<input name="notes" defaultValue={l.notes ?? ""} className={f} /></label>
      <div className="md:col-span-2 flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกข้อมูล"}</button>
        <Msg s={state} />
      </div>
      <p className="md:col-span-2 text-xs text-slate-500">
        ก่อนเปลี่ยนเป็น &ldquo;ปิดหนี้แล้ว&rdquo; ให้บันทึกยอดคงค้าง 0 ไว้ด้วย เพื่อให้ประวัติยอดครบ
      </p>
    </form>
  );
}
