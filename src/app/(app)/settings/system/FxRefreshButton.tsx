"use client";

import { useActionState } from "react";
import { refreshFxNow, type FxState } from "./actions";

/** ปุ่ม "อัปเดตอัตราตอนนี้" (ADMIN · ห่างกันอย่างน้อย 5 นาที) */
export default function FxRefreshButton() {
  const [state, action, pending] = useActionState<FxState>(refreshFxNow, {});
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button disabled={pending} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
        {pending ? "กำลังสั่ง…" : "อัปเดตอัตราตอนนี้"}
      </button>
      {state.error && <span className="max-w-72 text-right text-xs text-red-600">{state.error}</span>}
      {state.ok && <span className="max-w-72 text-right text-xs text-emerald-700">{state.ok}</span>}
    </form>
  );
}
