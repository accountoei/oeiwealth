"use client";

import { useActionState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { confirmGoLive, type GoLiveState } from "./actions";
import Flash from "@/components/Flash";

/**
 * ปุ่ม "Confirm Go-live" (ADMIN · ก่อน LIVE) อยู่ข้างปุ่มเปลี่ยนวัน Go-live ในกล่องบนสุด (ตกลง 4 พ.ย. 2026) → pop up ยืนยัน
 * ยังมีรายการ "ยังขาด" → pop up บอกเหตุผล ไม่มีปุ่มยืนยัน (ฐานข้อมูลตรวจซ้ำตอนยืนยันเสมอ)
 */
export default function ConfirmGoLive({ missing, warn, goLive }: { missing: number; warn: number; goLive: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<GoLiveState, FormData>(confirmGoLive, {});
  const blocked = missing > 0;
  const trigger = <button type="button" onClick={() => setOpen(!open)}
    className={activeCls("rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800")}>Confirm Go-live</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-3">
      <h2 className="font-medium text-slate-900">Confirm Go-live ({goLive})</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        <li>วัน Go-live ({goLive}) และสกุลเงินหลักจะแก้ไม่ได้อีก</li>
        <li>ยอดตั้งต้นทุกรายการจะถูกล็อก แก้ได้เฉพาะ ADMIN พร้อมเหตุผล (บันทึกใน Audit Log)</li>
        <li>บันทึกรายการที่ลงวันที่ก่อน Go-live ไม่ได้อีก</li>
        <li>เริ่มปิดงวดรายเดือน (Month Closing) ได้</li>
      </ul>
      {blocked ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          ยังกดไม่ได้: ต้องแก้รายการ “ยังขาด” ให้หมดก่อน ({missing} รายการ) · ดูได้ในหมวดด้านล่างที่เปิดไว้ให้
        </p>
      ) : (
        <>
          {warn > 0 && <p className="text-sm text-amber-700">มี {warn} รายการที่ควรตรวจ (เช่น มูลค่าเก่ากว่า 90 วัน) — Confirm ได้ แต่ควรดูก่อน</p>}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="ack" className="mt-1" />
            <span>ฉันตรวจยอดตั้งต้นแล้ว และเข้าใจว่าหลัง Go-live จะแก้ได้ยาก</span>
          </label>
        </>
      )}
      <div className="flex items-center gap-3">
        {!blocked && (
          <button disabled={pending} className="rounded-md bg-emerald-700 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-40">
            {pending ? "กำลังตรวจสอบ…" : "ยืนยัน Go-live"}</button>
        )}
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <Flash on={state} as="p" className="text-sm text-emerald-700" />
    </form>
  ));
}
