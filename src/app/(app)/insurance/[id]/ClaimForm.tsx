"use client";

import { useActionState, useState } from "react";
import { addClaim, type ActionState } from "../actions";
import { CLAIM_STATUS, COVERAGE_LABEL } from "@/lib/format";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

export default function ClaimForm({ policyId, currency, today, coverages = [] }: {
  policyId: string; currency: string; today: string; coverages?: { id: string; coverage_type: string; limit_amount: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(addClaim, {});
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">+ บันทึกเคลม</button>;
  return (
    <form action={action} className="space-y-3 rounded-lg bg-slate-50 p-4">
      <input type="hidden" name="policy_id" value={policyId} />
      <input type="hidden" name="currency" value={currency} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">วันเกิดเหตุ<input name="incident_date" type="date" max={today} className={input} /></label>
        <label className="text-sm">วันยื่นเคลม<input name="claim_date" type="date" defaultValue={today} max={today} className={input} /></label>
        <label className="text-sm">ยอดที่เคลม ({currency})<input name="claimed_amount" inputMode="decimal" className={input} /></label>
        <label className="text-sm">สถานะ
          <select name="status" defaultValue="SUBMITTED" className={input}>{CLAIM_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        {coverages.length > 0 && (
          <label className="text-sm">เคลมจากความคุ้มครอง
            <select name="coverage_id" defaultValue="" className={input}>
              <option value="">— ไม่ระบุ —</option>
              {coverages.map((c) => <option key={c.id} value={c.id}>{COVERAGE_LABEL[c.coverage_type]?.join(" ") ?? c.coverage_type}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm md:col-span-2">หมายเหตุ<input name="notes" className={input} /></label>
      </div>
      <p className="text-xs text-slate-500">เงินเคลมที่ได้รับคืนจากค่ารักษา ให้บันทึกเป็น &ldquo;เงินคืน&rdquo; ของค่าใช้จ่ายนั้นที่หน้า Income &amp; Expenses (ไม่ใช่รายได้)</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}
