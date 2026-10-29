"use client";

import { useActionState } from "react";
import { undoWhole, type UndoState } from "@/lib/undo-actions";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import Flash from "@/components/Flash";

/** ปุ่ม "ยกเลิกทั้งก้อน" · ถามยืนยันก่อน · ฐานข้อมูลย้อนทุกส่วนพร้อมกัน */
export default function UndoButton({ kind, id, paths = [], label = "ยกเลิกทั้งก้อน", confirmText }: {
  kind: "BENEFIT" | "DEPOSIT" | "PAYMENT" | "ALT_PART_SALE"; id: string; paths?: string[]; label?: string; confirmText: string;
}) {
  const [state, action, pending] = useActionState<UndoState, FormData>(undoWhole, {});
  const cf = useConfirmSubmit();
  if (state.ok) return <Flash on={state} as="span" className="text-xs text-emerald-700" />;
  return (
    <form action={action} onSubmit={cf.guard(confirmText, { danger: true })} className="inline-flex flex-col items-end">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      <button disabled={pending} className="whitespace-nowrap rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50">
        {pending ? "…" : label}
      </button>
      {state.error && <span className="mt-1 max-w-60 text-right text-xs text-red-600">{state.error}</span>}
      {cf.dialog}
    </form>
  );
}
