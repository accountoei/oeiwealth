"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { thDate } from "@/lib/format";
import { cancelGoLive, type GoLiveState } from "./actions";

/** ปุ่ม "ยกเลิก Go-live" (ADMIN · หลัง LIVE) → pop up ใส่เหตุผล · ต้อง Reopen ทุกเดือนก่อน */
export default function CancelGoLive({ goLive, finalMonths }: { goLive: string; finalMonths: number }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<GoLiveState, FormData>(cancelGoLive, {});
  const trigger = <button type="button" onClick={() => setOpen(!open)}
    className={activeCls("rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50")}>ยกเลิก Go-live</button>;
  if (!open) return trigger;
  const blocked = finalMonths > 0;
  return present(trigger, (
    <form action={action} className="space-y-3">
      <h2 className="font-medium text-slate-900">ยกเลิก Go-live</h2>
      <p className="text-sm text-slate-600">Go-live ตอนนี้: {thDate(goLive)}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
        <li>ระบบกลับเป็นช่วงตั้งค่า (SETUP): แก้ยอดตั้งต้น · ลงรายการย้อนหลัง · เปลี่ยนวัน Go-live ได้ แล้วกด Confirm Go-live ใหม่</li>
        <li>ข้อมูลที่บันทึกไว้ไม่ถูกลบ · ยอดสิ้นเดือนอัตโนมัติจะคำนวณใหม่หลัง Confirm</li>
        <li>เดือนที่ Reopen ไว้ (ยังไม่ปิดใหม่) จะถูกล้าง ต้องปิดเดือนใหม่หลัง Confirm</li>
      </ul>
      {blocked ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          ยังมีเดือนที่ปิดอยู่ {finalMonths} เดือน — ไปที่ <Link href="/settings/month-closing" className="underline">Month Closing</Link> แล้ว Reopen ทุกเดือนก่อน (ไล่จากเดือนล่าสุด)
        </p>
      ) : (
        <>
          <label className="block text-sm text-slate-700">เหตุผล *
            <input name="reason" required className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="ack" className="mt-1" />
            <span>เข้าใจแล้ว ให้ยกเลิก Go-live (บันทึกใน Audit Log)</span>
          </label>
        </>
      )}
      <div className="flex items-center gap-3">
        <button disabled={pending || blocked} className="rounded-md bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50">
          {pending ? "กำลังยกเลิก…" : "ยกเลิก Go-live"}</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-700">{state.ok}</p>}
    </form>
  ));
}
