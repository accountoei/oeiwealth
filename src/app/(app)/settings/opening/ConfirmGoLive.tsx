"use client";

import { useActionState } from "react";
import { confirmGoLive, type GoLiveState } from "./actions";

export default function ConfirmGoLive({ missing, warn, goLive }: { missing: number; warn: number; goLive: string }) {
  const [state, action, pending] = useActionState<GoLiveState, FormData>(confirmGoLive, {});
  const blocked = missing > 0;
  return (
    <form action={action} className="space-y-3">
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        <li>วัน Go-live ({goLive}) และสกุลเงินหลักจะแก้ไม่ได้อีก</li>
        <li>ยอดตั้งต้นทุกรายการจะถูกล็อก แก้ได้เฉพาะ ADMIN พร้อมเหตุผล (บันทึกใน Audit Log)</li>
        <li>บันทึกรายการที่ลงวันที่ก่อน Go-live ไม่ได้อีก</li>
        <li>เริ่มปิดงวดรายเดือน (Month Closing) ได้</li>
      </ul>
      {warn > 0 && !blocked && (
        <p className="text-sm text-amber-700">มี {warn} รายการที่ควรตรวจ (เช่น มูลค่าเก่ากว่า 90 วัน) — Confirm ได้ แต่ควรดูก่อน</p>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="ack" disabled={blocked} className="mt-1" />
        <span>ฉันตรวจยอดตั้งต้นแล้ว และเข้าใจว่าหลัง Go-live จะแก้ได้ยาก</span>
      </label>
      <button disabled={blocked || pending}
        className="rounded-md bg-emerald-700 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-40">
        {pending ? "กำลังตรวจสอบ…" : "Confirm Go-live"}
      </button>
      {blocked && <p className="text-sm text-red-600">ยังกดไม่ได้: ต้องแก้รายการ “ยังขาด” ให้หมดก่อน ({missing} รายการ)</p>}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-700">{state.ok}</p>}
    </form>
  );
}
