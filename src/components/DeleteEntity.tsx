"use client";

import { useActionState, useState } from "react";
import { deleteEntity, type RecState } from "@/lib/records";

/** ลบรายการหลักทั้งชุด — ต้องพิมพ์เหตุผล · ถ้ายังมีรายการเงินผูกอยู่ ระบบจะปฏิเสธพร้อมบอกวิธีแก้ */
export default function DeleteEntity({ kind, id, redirectTo, paths = [], label = "ลบรายการนี้", hint, needReason = true }: {
  kind: "asset" | "liability" | "card" | "lease" | "policy"; id: string; redirectTo?: string; paths?: string[];
  label?: string; hint?: string; needReason?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<RecState, FormData>(deleteEntity, {});
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs text-red-600 underline">{label}</button>;
  return (
    <form action={action} className="mt-2 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      {redirectTo && <input type="hidden" name="redirect" value={redirectTo} />}
      <p className="text-xs text-red-800">
        ใช้เมื่อกรอกผิดหรือบันทึกซ้ำ · ถ้าขาย / ปิด / ยกเลิกจริง ให้เปลี่ยนสถานะแทน เพื่อเก็บประวัติ{hint ? ` · ${hint}` : ""}
      </p>
      {needReason && <input name="reason" required placeholder="เหตุผลที่ลบ (บันทึกใน Audit Log)" className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />}
      <div className="flex items-center gap-2">
        <button disabled={pending} className="rounded-md bg-red-700 px-3 py-1.5 text-xs text-white disabled:opacity-50">{pending ? "กำลังลบ…" : "ยืนยันลบ"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      </div>
      {state.error && <p className="text-xs text-red-700">{state.error}</p>}
    </form>
  );
}
