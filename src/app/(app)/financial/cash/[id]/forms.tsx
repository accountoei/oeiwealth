"use client";

import { useActionState, useEffect, useState } from "react";
import { revealAccountNo, setAccountNo, updateAccountInfo, updateBalance, type ActionState } from "../actions";
import { ACCOUNT_TYPE_LABEL } from "@/lib/format";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <p className="text-sm text-emerald-700">{s.ok}</p>;
  return null;
}

export function UpdateBalanceForm({ assetId, currency, today, minDate }:
  { assetId: string; currency: string; today: string; minDate: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateBalance, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <label className="text-sm">ยอดคงเหลือ ({currency})
        <input name="value" required inputMode="decimal" className={`mt-1 block w-44 ${input}`} />
      </label>
      <label className="text-sm">ยอด ณ วันที่
        <input name="valuation_date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block ${input}`} />
      </label>
      <label className="text-sm flex-1 min-w-48">หมายเหตุ
        <input name="notes" className={`mt-1 block w-full ${input}`} />
      </label>
      <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกยอด"}</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  );
}

export function AccountNoPanel({ assetId, bankAccountId, masked, canReveal, canSet }:
  { assetId: string; bankAccountId: string; masked: string | null; canReveal: boolean; canSet: boolean }) {
  const [revealState, revealAction, revealing] = useActionState<ActionState, FormData>(revealAccountNo, {});
  const [setState, setAction, setting] = useActionState<ActionState, FormData>(setAccountNo, {});
  const [shown, setShown] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // แสดงเลขเต็ม 30 วินาทีแล้วซ่อนเอง (ทุกครั้งที่ดูถูกบันทึกใน Audit Log)
  useEffect(() => {
    if (!revealState.value) return;
    setShown(revealState.value);
    const t = setTimeout(() => setShown(null), 30000);
    return () => clearTimeout(t);
  }, [revealState]);

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-base">{shown ?? masked ?? "ยังไม่ได้บันทึก"}</span>
        {canReveal && masked && !shown && (
          <form action={revealAction}>
            <input type="hidden" name="bank_account_id" value={bankAccountId} />
            <button disabled={revealing} className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">
              {revealing ? "…" : "แสดงเลขเต็ม"}
            </button>
          </form>
        )}
        {shown && <button onClick={() => setShown(null)} className="text-xs text-slate-500 hover:underline">ซ่อน</button>}
        {canSet && !editing && (
          <button onClick={() => setEditing(true)} className="text-xs text-slate-500 hover:underline">
            {masked ? "เปลี่ยนเลขบัญชี" : "บันทึกเลขบัญชี"}
          </button>
        )}
      </div>
      {shown && <p className="text-xs text-slate-500">ซ่อนอัตโนมัติใน 30 วินาที · การดูถูกบันทึกใน Audit Log</p>}
      {revealState.error && <p className="text-sm text-red-600">{revealState.error}</p>}
      {editing && (
        <form action={setAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="bank_account_id" value={bankAccountId} />
          <input type="hidden" name="asset_id" value={assetId} />
          <input name="account_no" required inputMode="numeric" autoComplete="off" placeholder="เลขบัญชีเต็ม" className={input} />
          <button disabled={setting} className={btn}>บันทึก</button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500">ยกเลิก</button>
        </form>
      )}
      <Msg s={setState} />
    </div>
  );
}

type Acc = { asset_id: string; name: string; bank_name: string; account_name: string | null; account_type: string;
  branch: string | null; interest_rate: number | null; maturity_date: string | null; notes: string | null };

export function EditInfoForm({ acc }: { acc: Acc }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateAccountInfo, {});
  const field = "mt-1 block w-full " + input;
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="asset_id" value={acc.asset_id} />
      <label className="text-sm">ชื่อที่ใช้เรียกบัญชี<input name="name" required defaultValue={acc.name} className={field} /></label>
      <label className="text-sm">ธนาคาร<input name="bank_name" required defaultValue={acc.bank_name} className={field} /></label>
      <label className="text-sm">ประเภทบัญชี
        <select name="account_type" defaultValue={acc.account_type} className={field}>
          {Object.entries(ACCOUNT_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="text-sm">ชื่อบัญชี (ตามสมุด)<input name="account_name" defaultValue={acc.account_name ?? ""} className={field} /></label>
      <label className="text-sm">สาขา<input name="branch" defaultValue={acc.branch ?? ""} className={field} /></label>
      <label className="text-sm">อัตราดอกเบี้ย (% ต่อปี)<input name="interest_rate" inputMode="decimal" defaultValue={acc.interest_rate ?? ""} className={field} /></label>
      <label className="text-sm">วันครบกำหนด<input name="maturity_date" type="date" defaultValue={acc.maturity_date ?? ""} className={field} /></label>
      <label className="text-sm md:col-span-2">หมายเหตุ<textarea name="notes" rows={2} defaultValue={acc.notes ?? ""} className={field} /></label>
      <div className="md:col-span-2 flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกข้อมูลบัญชี"}</button>
        <Msg s={state} />
      </div>
    </form>
  );
}
