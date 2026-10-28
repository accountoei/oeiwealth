"use client";

import { useActionState } from "react";
import { setOpportunityRate, type FxState } from "./actions";

/** อัตราดอกเบี้ยเทียบ (ต้นทุนเสียโอกาส) ของครอบครัว — ADMIN แก้ · ใช้คิดราคาขายขั้นต่ำที่คุ้มของ Property (ไม่นับใน Net Worth) */
export default function OpportunityRateForm({ rate, canEdit }: { rate: number | null; canEdit: boolean }) {
  const [state, action, pending] = useActionState<FxState, FormData>(setOpportunityRate, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">อัตรา
        <input name="rate" inputMode="decimal" data-money="off" defaultValue={rate ?? ""} disabled={!canEdit} placeholder="เช่น 3"
          className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm disabled:bg-slate-50" />
        % ต่อปี</label>
      {canEdit && <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
        {pending ? "กำลังบันทึก…" : "บันทึก"}</button>}
      {state.error && <span className="text-red-600">{state.error}</span>}
      {state.ok && <span className="text-emerald-700">{state.ok}</span>}
    </form>
  );
}
