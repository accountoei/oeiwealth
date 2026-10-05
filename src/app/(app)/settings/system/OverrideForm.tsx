"use client";

import { useActionState } from "react";
import { overrideFx, type FxState } from "./actions";
import { CURRENCIES } from "@/lib/format";

const input = "mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm";

export default function OverrideForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState<FxState, FormData>(overrideFx, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">วันที่ของ Rate<input name="rate_date" type="date" required max={today} className={input} /></label>
      <label className="text-sm">สกุลเงิน
        <select name="currency" className={input}>{CURRENCIES.filter((c) => c !== "THB").map((c) => <option key={c}>{c}</option>)}</select>
      </label>
      <label className="text-sm">1 หน่วย = ? บาท<input name="rate_to_thb" required inputMode="decimal" className={`${input} w-32`} /></label>
      <label className="text-sm min-w-60 flex-1">เหตุผล *<input name="reason" required placeholder="เช่น ธปท. ไม่มีข้อมูลวันนี้" className={`${input} w-full`} /></label>
      <button disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">บันทึก Override</button>
      {state.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="w-full text-sm text-emerald-700">{state.ok}</p>}
    </form>
  );
}
