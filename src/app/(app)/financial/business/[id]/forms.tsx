"use client";

import { useActionState, useState } from "react";
import { addCapital, recordDividend, type ActionState } from "../actions";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
type Bank = { asset_id: string; name: string; currency: string };

function Box({ title, label, children, action, pending, state }: {
  title: string; label: string; children: React.ReactNode; action: (f: FormData) => void; pending: boolean; state: ActionState;
}) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">{label}</button>;
  return (
    <form action={action} className="w-full space-y-3 rounded-xl border border-slate-200 bg-white p-5">
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

export function DividendForm({ assetId, banks, today, minDate }: { assetId: string; banks: Bank[]; today: string; minDate: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(recordDividend, {});
  return (
    <Box title="รับเงินปันผลจากกิจการ" label="+ รับปันผล" action={action} pending={pending} state={state}>
      <input type="hidden" name="asset_id" value={assetId} />
      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-sm">วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className="text-sm">ยอดก่อนหักภาษี *<input name="amount" required inputMode="decimal" className={input} /></label>
        <label className="text-sm">ภาษีหัก ณ ที่จ่าย<input name="tax" inputMode="decimal" className={input} /></label>
        <label className="text-sm">เข้าบัญชี
          <select name="bank_asset_id" defaultValue={banks[0]?.asset_id ?? ""} className={input}>
            <option value="">— ไม่ผ่านบัญชี —</option>{banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}
          </select>
        </label>
        <label className="text-sm md:col-span-4">หมายเหตุ<input name="notes" className={input} /></label>
      </div>
      <p className="text-xs text-slate-500">บันทึกเป็นรายได้ &ldquo;ปันผลกิจการ&rdquo; แบ่งตามสัดส่วนเจ้าของ</p>
    </Box>
  );
}

export function CapitalForm({ assetId, banks, today, minDate }: { assetId: string; banks: Bank[]; today: string; minDate: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addCapital, {});
  return (
    <Box title="ลงทุนเพิ่ม / เพิ่มทุน" label="+ ลงทุนเพิ่ม" action={action} pending={pending} state={state}>
      <input type="hidden" name="asset_id" value={assetId} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className="text-sm">จ่ายจากบัญชี *
          <select name="bank_asset_id" required className={input}>{banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}</select>
        </label>
        <label className="text-sm">จำนวนเงิน *<input name="amount" required inputMode="decimal" className={input} /></label>
        <label className="text-sm md:col-span-3">รายละเอียด<input name="description" className={input} /></label>
      </div>
      <p className="text-xs text-slate-500">เงินออกจากบัญชี (ไม่ใช่ค่าใช้จ่าย) · มูลค่ากิจการไม่เปลี่ยนเอง ให้อัปเดตมูลค่าด้านล่างหลังบันทึก</p>
    </Box>
  );
}
