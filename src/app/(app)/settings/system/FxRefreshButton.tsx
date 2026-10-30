"use client";

import { useActionState } from "react";
import { refreshFxNow, type FxState } from "./actions";
import Flash from "@/components/Flash";

/** ปุ่มคำสั่งของกล่องอัตราแลกเปลี่ยน (อัปเดต / เปลี่ยนแหล่ง / Override) — ขนาดเท่ากัน */
// ปุ่มสีน้ำเงินเหมือนปุ่มอื่นในแถวแท็บ (ตกลง 30 ต.ค. 2026)
export const FX_BTN = "inline-flex items-center justify-center whitespace-nowrap rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

/** ปุ่ม "อัปเดตอัตราตอนนี้" (ADMIN · ห่างกันอย่างน้อย 5 นาที) */
export default function FxRefreshButton() {
  const [state, action, pending] = useActionState<FxState>(refreshFxNow, {});
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button disabled={pending} className={FX_BTN}>
        {pending ? "กำลังสั่ง…" : "อัปเดตอัตราตอนนี้"}
      </button>
      {state.error && <span className="max-w-72 text-right text-xs text-red-600">{state.error}</span>}
      <Flash on={state} as="span" className="max-w-72 text-right text-xs text-emerald-700" />
    </form>
  );
}
