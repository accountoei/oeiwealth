"use client";

import { useActionState, useState } from "react";
import { disburseMore, receivePayment, type ActionState } from "../actions";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";
type Bank = { asset_id: string; name: string; currency: string };

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <p className="text-sm text-emerald-700">{s.ok}</p>;
  return null;
}

/** บันทึกรับชำระ · ใช้จากตารางผ่อนได้ (เติมเงินต้น / ดอกเบี้ยของงวดให้ แก้ได้ถ้ารับจริงไม่เท่า) */
export function PaymentForm({ assetId, currency, banks, today, minDate, principal, interest, title, button = "บันทึกรับชำระ", small = false }: {
  assetId: string; currency: string; banks: Bank[]; today: string; minDate: string;
  principal?: number; interest?: number; title?: string; button?: string; small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(receivePayment, {});
  const list = banks.filter((b) => b.currency === currency);
  const amt = (v?: number) => (v ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
  if (state.ok && small) return <span className="text-xs text-emerald-700">{state.ok}</span>;
  if (!open) return <button type="button" onClick={() => setOpen(true)}
    className={small ? "rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" : btn}>{button}</button>;
  return (
    <form action={action} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-left">
      <input type="hidden" name="asset_id" value={assetId} />
      <h3 className="font-medium text-slate-900">{title ?? "รับชำระเงินกู้"}</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">วันที่ได้รับ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className="text-sm">เข้าบัญชี *
          <select name="bank_asset_id" required className={input}>{list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}</select>
        </label>
        <span />
        <label className="text-sm">ส่วนเงินต้น<input name="principal" inputMode="decimal" defaultValue={amt(principal)} className={input} /></label>
        <label className="text-sm">ส่วนดอกเบี้ย (Gross)<input name="interest" inputMode="decimal" defaultValue={amt(interest)} className={input} /></label>
        <label className="text-sm">ภาษีหัก ณ ที่จ่ายของดอกเบี้ย<input name="interest_tax" inputMode="decimal" className={input} /></label>
        <label className="text-sm md:col-span-3">หมายเหตุ<input name="notes" className={input} /></label>
      </div>
      <p className="text-xs text-slate-500">เงินต้น = ลดยอดเงินให้กู้ (ไม่ใช่รายได้) · ดอกเบี้ย = รายได้ · ระบบสร้างรายการเงินเข้าบัญชีให้ทั้งสองส่วน</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function DisburseForm({ assetId, currency, banks, today, minDate }: { assetId: string; currency: string; banks: Bank[]; today: string; minDate: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(disburseMore, {});
  const list = banks.filter((b) => b.currency === currency);
  if (!open) return <button onClick={() => setOpen(true)} className={obtn}>ให้กู้เพิ่ม</button>;
  return (
    <form action={action} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="asset_id" value={assetId} />
      <h3 className="font-medium text-slate-900">ให้กู้เพิ่ม</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className="text-sm">จ่ายจากบัญชี *
          <select name="bank_asset_id" required className={input}>{list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}</select>
        </label>
        <label className="text-sm">จำนวนเงิน *<input name="amount" required inputMode="decimal" className={input} /></label>
        <label className="text-sm md:col-span-3">รายละเอียด<input name="description" className={input} /></label>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}
