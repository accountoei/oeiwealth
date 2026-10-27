"use client";

import { useActionState, useId, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { createCard, setCardAutopay, updateCardBalance, updateCardInfo, updateCardStatus, type ActionState } from "../actions";
import { CurrencySelect } from "@/components/CurrencyContext";
import DropPrompt from "../DropPrompt";
import { useStatusDelete, type RemoveOpt } from "@/components/DeleteEntity";

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
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(createCard, {});
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(btn)}>+ เพิ่มบัตรเครดิต</button>;
  if (!open) return trigger;
  return present(trigger, (
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
        <CurrencySelect name="currency" defaultValue="THB" className={input} />
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
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}

export function CardBalanceForm({ cardId, currency, today, minDate, banks = [], label = "อัปเดตยอดตาม Statement" }:
  { cardId: string; currency: string; today: string; minDate: string; banks?: { asset_id: string; name: string }[]; label?: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(updateCardBalance, {});
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls("text-xs text-slate-700 underline")}>{label}</button>;
  if (!open) return trigger;
  return present(trigger, (<div className="mt-2 space-y-2">
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="card_id" value={cardId} />
      <label className="text-xs">ยอดตาม Statement ({currency})
        <input name="outstanding_balance" required inputMode="decimal" className="mt-1 block w-32 rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </label>
      <label className="text-xs">ณ วันที่
        <input name="balance_date" type="date" required defaultValue={today} min={minDate} max={today}
          className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </label>
      <label className="text-xs">หมายเหตุ (ไม่บังคับ)
        <input name="notes" className="mt-1 block w-40 rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </label>
      <p className="w-full text-xs text-slate-500">ส่วนต่างลงเป็นก้อน &ldquo;รอแยกรายละเอียด&rdquo; ของเดือนนี้ให้อัตโนมัติ (สูงกว่าที่บันทึก → ค่าใช้จ่ายก้อน · ต่ำกว่า → รายได้ก้อนเข้าบัตร เช่น เงินคืน / เครดิต แล้วถามต่อว่าเป็นการจ่ายบัตรจากบัญชีหรือไม่)</p>
      <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">บันทึก</button>
      <button type="button" data-close onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
    {state.drop && <DropPrompt key={state.drop.n} drop={state.drop} currency={currency} banks={banks} />}
  </div>));
}

/** สถานะบัตร (มี "ลบ…" อยู่ข้างใน) — บันทึกทันทีเมื่อเลือก · ช่องผูกกับฟอร์มด้วย form={id} จึงวางข้างปุ่มบันทึกของฟอร์มข้อมูลบัตรได้ */
function useCardStatus(cardId: string, status: string, remove?: RemoveOpt) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateCardStatus, {});
  const del = useStatusDelete(remove, status);
  const formId = `card-status-${useId()}`;
  const control = (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="text-xs text-slate-500">สถานะ</span>
      <select form={formId} name="status" defaultValue={status} disabled={pending}
        onChange={(e) => { if (del.pick(e)) return; e.currentTarget.form?.requestSubmit(); }}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm">
        <option value="ACTIVE">ใช้งาน</option>
        <option value="SUSPENDED">ระงับชั่วคราว</option>
        <option value="CLOSED">ยกเลิกบัตรแล้ว</option>
        {del.option}
      </select>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </span>
  );
  const form = (
    <>
      <form id={formId} action={action} className="hidden"><input type="hidden" name="card_id" value={cardId} /></form>
      {del.dialog}
    </>
  );
  return { control, form };
}

/** ตั้งค่าตัดบัญชีอัตโนมัติ: ถึงวันครบชำระ หน้า Income &amp; Expenses จะแสดงรายการ "รอยืนยัน" */
export function CardAutopayForm({ cardId, banks, pfCash = [], bank, hold = null, mode }: {
  cardId: string; banks: { asset_id: string; name: string }[];
  /** บัญชีเงินฝากในพอร์ต (สกุลเดียวกับบัตร) */
  pfCash?: { id: string; label: string }[];
  bank: string | null; hold?: string | null; mode: string | null;
}) {
  const [edit, setEdit] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(setCardAutopay, {});
  const [sel, setSel] = useState(bank ?? (hold ? `h:${hold}` : ""));
  if (!edit) {
    return (
      <button type="button" onClick={() => setEdit(true)} className="mt-1 text-left text-xs text-blue-700 hover:underline">
        {bank || hold ? "แก้ตัดบัญชีอัตโนมัติ" : "+ ตั้งตัดบัญชีอัตโนมัติ"}
      </button>
    );
  }
  return (
    <form action={action} className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2 text-xs">
      <input type="hidden" name="card_id" value={cardId} />
      <label className="block">ตัดจากบัญชี
        <select name="autopay_asset_id" value={sel} onChange={(e) => setSel(e.target.value)} className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-1">
          <option value="">— ไม่ตัดอัตโนมัติ —</option>
          {pfCash.length > 0 ? (<>
            <optgroup label="บัญชีธนาคาร">{banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}</optgroup>
            <optgroup label="เงินฝากในพอร์ต">{pfCash.map((h) => <option key={h.id} value={`h:${h.id}`}>{h.label}</option>)}</optgroup>
          </>) : banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
        </select>
      </label>
      {sel && (
        <div className="flex gap-3">
          <label className="flex items-center gap-1"><input type="radio" name="autopay_mode" value="FULL" defaultChecked={mode !== "MINIMUM"} /> เต็มจำนวน</label>
          <label className="flex items-center gap-1"><input type="radio" name="autopay_mode" value="MINIMUM" defaultChecked={mode === "MINIMUM"} /> ขั้นต่ำ</label>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "…" : "บันทึก"}</button>
        <button type="button" onClick={() => setEdit(false)} className="text-slate-500">ปิด</button>
      </div>
      <Msg s={state} />
    </form>
  );
}

/** แก้ข้อมูลบัตร (ในหน้าต่าง "แก้ไขข้อมูล") */
export function CardInfoForm({ cardId, v, status, remove }: { cardId: string; v: {
  issuer: string; card_name: string | null; card_last4: string | null; credit_limit: number | null; statement_day: number | null;
  due_day: number | null; annual_fee: number | null; expiry_date: string | null; notes: string | null };
  /** สถานะบัตร → ช่องสถานะข้างปุ่มบันทึก */
  status: string; remove?: RemoveOpt }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateCardInfo, {});
  const st = useCardStatus(cardId, status, remove);
  const d = (x: string | number | null) => (x == null ? "" : String(x));
  return (
    <>
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="card_id" value={cardId} />
      <label className="text-sm">ผู้ออกบัตร<input name="issuer" required defaultValue={v.issuer} className={input} /></label>
      <label className="text-sm">ชื่อบัตร<input name="card_name" defaultValue={d(v.card_name)} className={input} /></label>
      <label className="text-sm">เลขท้าย 4 ตัว<input name="card_last4" maxLength={4} inputMode="numeric" data-plain defaultValue={d(v.card_last4)} className={input} /></label>
      <label className="text-sm">วงเงิน<input name="credit_limit" inputMode="decimal" defaultValue={d(v.credit_limit)} className={input} /></label>
      <label className="text-sm">ตัดรอบวันที่<input name="statement_day" inputMode="numeric" data-plain defaultValue={d(v.statement_day)} className={input} /></label>
      <label className="text-sm">ชำระภายในวันที่<input name="due_day" inputMode="numeric" data-plain defaultValue={d(v.due_day)} className={input} /></label>
      <label className="text-sm">ค่าธรรมเนียมรายปี<input name="annual_fee" inputMode="decimal" defaultValue={d(v.annual_fee)} className={input} /></label>
      <label className="text-sm">บัตรหมดอายุ<input name="expiry_date" type="date" defaultValue={d(v.expiry_date)} className={input} /></label>
      <label className="text-sm md:col-span-2">หมายเหตุ<input name="notes" defaultValue={d(v.notes)} className={input} /></label>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกข้อมูล"}</button>
        {st.control}
        <Msg s={state} />
      </div>
    </form>
    {st.form}
    </>
  );
}
