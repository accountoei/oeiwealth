"use client";

import { useActionState, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { money } from "@/lib/format";
import { addLiabilityBalance, payLiability, updateLiabilityInfo, type ActionState } from "../actions";
import DropPrompt from "../DropPrompt";
import { useStatusDelete, type RemoveOpt } from "@/components/DeleteEntity";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <p className="text-sm text-emerald-700">{s.ok}</p>;
  return null;
}

export function AddBalanceForm({ liabilityId, currency, today, minDate, banks = [] }:
  { liabilityId: string; currency: string; today: string; minDate: string; banks?: { asset_id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addLiabilityBalance, {});
  return (<div className="space-y-3">
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
      <p className="w-full text-xs text-slate-500">
        ส่วนต่างลงเป็นก้อน &ldquo;รอแยกรายละเอียด&rdquo; ให้อัตโนมัติ: สูงกว่าที่ระบบคำนวณ (ดอกเบี้ย / ค่าธรรมเนียมที่ทบเข้าหนี้) → ค่าใช้จ่ายก้อน
        · ต่ำกว่า → รายได้ก้อน แล้วถามต่อว่าเป็นการจ่ายจากบัญชีหรือไม่
      </p>
      <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกยอด"}</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
    {state.drop && <DropPrompt key={state.drop.n} drop={state.drop} currency={currency} banks={banks} />}
  </div>);
}

type Info = { id: string; name: string; lender: string | null; interest_rate: number | null; monthly_payment: number | null;
  payment_due_day: number | null; due_date: string | null; status: string; notes: string | null };

export function EditLiabilityForm({ l, remove }: { l: Info; remove?: RemoveOpt }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateLiabilityInfo, {});
  const del = useStatusDelete(remove, l.status);
  const f = "mt-1 block w-full " + input;
  return (
    <>
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="liability_id" value={l.id} />
      <label className="text-sm">ชื่อที่ใช้เรียก<input name="name" required defaultValue={l.name} className={f} /></label>
      <label className="text-sm">ผู้ให้กู้<input name="lender" defaultValue={l.lender ?? ""} className={f} /></label>
      <label className="text-sm">อัตราดอกเบี้ย (% ต่อปี)<input name="interest_rate" inputMode="decimal" defaultValue={l.interest_rate ?? ""} className={f} /></label>
      <label className="text-sm">ค่างวดต่อเดือน<input name="monthly_payment" inputMode="decimal" defaultValue={l.monthly_payment ?? ""} className={f} /></label>
      <label className="text-sm">ครบกำหนดจ่ายทุกวันที่<input name="payment_due_day" type="number" min={1} max={31} defaultValue={l.payment_due_day ?? ""} className={f} /></label>
      <label className="text-sm">วันครบกำหนดสัญญา<input name="due_date" type="date" defaultValue={l.due_date ?? ""} className={f} /></label>
      <label className="text-sm">สถานะ
        <select name="status" defaultValue={l.status} onChange={(e) => { del.pick(e); }} className={f}>
          <option value="ACTIVE">ยังผ่อนอยู่</option>
          <option value="CLOSED">ปิดหนี้แล้ว</option>
          <option value="WRITTEN_OFF">ตัดหนี้สูญ / ยกหนี้</option>
          {del.option}
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
    {del.dialog}
    </>
  );
}

const n = (s: string) => Number(s.replace(/,/g, "")) || 0;

/** จ่ายค่างวด: แยกเงินต้น / ดอกเบี้ย (แบบเดียวกับ "รับชำระ" ของเงินให้กู้) */
export function PayLiabilityForm({ liabilityId, currency, banks, monthlyPayment, today, minDate }: {
  liabilityId: string; currency: string; banks: { asset_id: string; name: string }[]; monthlyPayment: number | null; today: string; minDate: string;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(payLiability, {});
  const [pr, setPr] = useState(""); const [it, setIt] = useState(""); const [upd, setUpd] = useState(false);
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(btn)}>+ จ่ายค่างวด</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="w-full space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="liability_id" value={liabilityId} />
      <h3 className="font-medium text-slate-900">จ่ายค่างวด / จ่ายหนี้</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">วันที่จ่าย *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block w-full ${input}`} /></label>
        <label className="text-sm md:col-span-2">จ่ายจากบัญชี ({currency}) *
          <select name="bank_asset_id" required className={`mt-1 block w-full ${input}`}>
            <option value="">— เลือก —</option>
            {banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
          </select>
          {banks.length === 0 && <span className="mt-1 block text-xs text-amber-700">ไม่มีบัญชีสกุล {currency}</span>}
        </label>
        <label className="text-sm">เงินต้น (ลดยอดหนี้)<input name="principal" inputMode="decimal" value={pr} onChange={(e) => setPr(e.target.value)} className={`mt-1 block w-full ${input}`} /></label>
        <label className="text-sm">ดอกเบี้ย (เป็นค่าใช้จ่าย)<input name="interest" inputMode="decimal" value={it} onChange={(e) => setIt(e.target.value)} className={`mt-1 block w-full ${input}`} /></label>
        <div className="text-sm">รวมจ่าย
          <div className="mt-1 py-2 font-medium tabular-nums">{money(n(pr) + n(it), currency)}</div>
          {monthlyPayment ? <div className="text-xs text-slate-500">ค่างวดปกติ {money(monthlyPayment)}</div> : null}
        </div>
        <label className="text-sm md:col-span-3">หมายเหตุ<input name="notes" placeholder="เช่น งวดที่ 12" className={`mt-1 block w-full ${input}`} /></label>
      </div>
      <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="update_balance" checked={upd} onChange={(e) => setUpd(e.target.checked)} />
          มียอดคงค้างตาม Statement หลังจ่าย (ใช้แทนยอดที่ระบบหักให้)
        </label>
        {upd && <input name="new_balance" required inputMode="decimal" placeholder="ยอดคงค้างใหม่" className={input} />}
        <p className="text-xs text-slate-500">ระบบสร้างเงินออกจากบัญชีให้ · เงินต้นลดยอดหนี้ทันที · ดอกเบี้ยบันทึกเป็นค่าใช้จ่าย &ldquo;ดอกเบี้ยจ่าย&rdquo;</p>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกการจ่าย"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}
