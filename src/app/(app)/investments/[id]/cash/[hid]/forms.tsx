"use client";

import { useActionState } from "react";
import { saveValuations, setDefaultCash, type ActionState } from "../../../actions";
import { updateRecord, type RecState } from "@/lib/records";
import Flash from "@/components/Flash";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <Flash on={s} as="p" className="text-sm text-emerald-700" />;
  return null;
}

/** บันทึกยอดเงินฝากในพอร์ตตาม Statement (บัญชีเดียว) — ใช้คำสั่งเดียวกับ "อัปเดตราคา / Statement" ของพอร์ต */
export function CashStatementForm({ assetId, holdingId, currency, today, minDate }:
  { assetId: string; holdingId: string; currency: string; today: string; minDate: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveValuations, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name={`qty_${holdingId}`} value="0" />
      <input type="hidden" name={`cash_${holdingId}`} value="1" />
      <label className="text-sm">ยอดคงเหลือ ({currency})
        <input name={`mv_${holdingId}`} required inputMode="decimal" className={`mt-1 block w-44 ${input}`} />
      </label>
      <label className="text-sm">ยอด ณ วันที่
        <input name="valuation_date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block ${input}`} />
      </label>
      <p className="w-full text-xs text-slate-500">ยอดตาม Statement เป็นจุดตั้งต้นใหม่ของยอดคงเหลือ · รายการก่อน / วันเดียวกับวันที่นี้ถือว่าอยู่ในยอดนี้แล้ว</p>
      <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกยอด"}</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  );
}

/** แก้ข้อมูลบัญชีเงินฝากในพอร์ต: ชื่อ · วัตถุประสงค์ · ดอกเบี้ย */
export function CashInfoForm({ id, name, purpose, interestRate, paths }: {
  id: string; name: string; purpose: string | null; interestRate: number | null; paths: string[];
}) {
  const [state, action, pending] = useActionState<RecState, FormData>(updateRecord, {});
  return (
    <form action={action} className="space-y-3 text-sm">
      <input type="hidden" name="table" value="investment_holdings" />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs text-slate-600">ชื่อบัญชี<input name="f_name" required defaultValue={name} className={`mt-1 block w-full ${input}`} /></label>
        <label className="text-xs text-slate-600">วัตถุประสงค์<input name="f_purpose" defaultValue={purpose ?? ""} className={`mt-1 block w-full ${input}`} /></label>
        <label className="text-xs text-slate-600">ดอกเบี้ย % ต่อปี<input name="f_interest_rate" inputMode="decimal" defaultValue={interestRate ?? ""} className={`mt-1 block w-full ${input}`} /></label>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        <Flash on={state}>บันทึกแล้ว</Flash>
      </div>
    </form>
  );
}

/** ตั้งเป็นบัญชีหลักของสกุล */
export function SetDefaultButton({ assetId, holdingId }: { assetId: string; holdingId: string }) {
  return (
    <form action={setDefaultCash}>
      <input type="hidden" name="holding_id" value={holdingId} /><input type="hidden" name="asset_id" value={assetId} />
      <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">ตั้งเป็นบัญชีหลักของสกุลนี้</button>
    </form>
  );
}
