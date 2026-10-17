"use client";

import { useActionState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { addCapital, recordDividend, updateBusinessInfo, type ActionState } from "../actions";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
type Bank = { asset_id: string; name: string; currency: string };

function Box({ title, label, children, action, pending, state }: {
  title: string; label: string; children: React.ReactNode; action: (f: FormData) => void; pending: boolean; state: ActionState;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls("rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50")}>{label}</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="w-full space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="font-medium text-slate-900">{title}</h3>
      {children}
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  ));
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

/** แก้รายละเอียดธุรกิจ (ชื่อรายการ · ข้อมูลบริษัท · หุ้น · เงินลงทุน · หมายเหตุ) */
export function BusinessInfoForm({ assetId, byShares, v }: {
  assetId: string; byShares: boolean;
  v: { name: string; company_name: string; registration_no: string | null; business_type: string | null; total_shares: number | null;
    shares_owned: number | null; company_ownership_percent: number | null; investment_cost: number | null; notes: string | null };
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateBusinessInfo, {});
  const dv = (x: number | null) => (x == null ? "" : String(Number(x)));
  return (
    <form action={action} className="grid gap-3 md:grid-cols-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <label className="text-sm">ชื่อรายการ *<input name="name" required defaultValue={v.name} className={input} /></label>
      <label className="text-sm md:col-span-2">ชื่อบริษัท *<input name="company_name" required defaultValue={v.company_name} className={input} /></label>
      <label className="text-sm">เลขทะเบียน<input name="registration_no" defaultValue={v.registration_no ?? ""} className={input} /></label>
      <label className="text-sm">ประเภทกิจการ<input name="business_type" defaultValue={v.business_type ?? ""} className={input} /></label>
      <label className="text-sm">เงินลงทุน<input name="investment_cost" inputMode="decimal" defaultValue={dv(v.investment_cost)} className={input} /></label>
      <label className="text-sm">หุ้นทั้งหมดของบริษัท<input name="total_shares" inputMode="decimal" data-money="off" defaultValue={dv(v.total_shares)} className={input} /></label>
      {byShares ? (
        <p className="self-end text-xs text-slate-500 md:col-span-2">หุ้นที่ครอบครัวถือ และ % ของบริษัท คำนวณจากจำนวนหุ้นของสมาชิก (แก้ที่ &ldquo;สมาชิกที่เป็นเจ้าของ&rdquo; ด้านล่าง)</p>
      ) : (
        <>
          <label className="text-sm">หุ้นที่ครอบครัวถือ<input name="shares_owned" inputMode="decimal" data-money="off" defaultValue={dv(v.shares_owned)} className={input} /></label>
          <label className="text-sm">% ที่ถือในบริษัท<input name="company_ownership_percent" inputMode="decimal" defaultValue={dv(v.company_ownership_percent)} className={input} /></label>
        </>
      )}
      <label className="text-sm md:col-span-3">หมายเหตุ<textarea name="notes" rows={2} defaultValue={v.notes ?? ""} className={input} /></label>
      <div className="flex items-center gap-3 md:col-span-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึกรายละเอียด"}</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}
