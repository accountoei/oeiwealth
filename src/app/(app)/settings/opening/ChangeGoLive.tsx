"use client";

import { useActionState, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { thDate, thMonth } from "@/lib/format";
import { changeGoLiveDate, type GoLiveState } from "./actions";

const addDay = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** ปุ่ม "เปลี่ยนวัน Go-live" (ADMIN · ก่อน Confirm) → pop up เลือกเดือน */
export default function ChangeGoLive({ current }: { current: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<GoLiveState, FormData>(changeGoLiveDate, {});
  const [month, setMonth] = useState(current.slice(0, 7));
  const trigger = <button type="button" onClick={() => setOpen(!open)}
    className={activeCls("rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50")}>เปลี่ยนวัน Go-live</button>;
  if (!open) return trigger;
  const next = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : null;
  const changed = next && next !== current;
  return present(trigger, (
    <form action={action} className="space-y-3">
      <h2 className="font-medium text-slate-900">เปลี่ยนวัน Go-live</h2>
      <p className="text-sm text-slate-600">ตอนนี้: {thDate(current)} · ยอดตั้งต้น ณ สิ้นวัน {thDate(addDay(current, -1))}</p>
      <label className="block text-sm text-slate-700">เดือนที่เริ่มใช้จริง (Go-live = วันที่ 1 ของเดือน)
        <input type="month" name="month" value={month} onChange={(e) => setMonth(e.target.value)} required
          className="mt-1 block w-48 rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>
      {changed && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Go-live ใหม่ {thDate(next)} ({thMonth(next)}) · ยอดตั้งต้นใหม่ ณ สิ้นวัน {thDate(addDay(next, -1))}</p>
          {next > current ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              <li>ยอดตั้งต้นใหม่ = <b>ยอดตามระบบ ณ สิ้นวัน {thDate(addDay(next, -1))}</b> (บัญชี · ทรัพย์สิน · หนี้ · พอร์ต · เงินให้กู้ · บัตร) ระบบตั้งให้</li>
              <li>รายการที่ลงไว้ก่อน {thDate(next)} ไม่เปลี่ยน — กลายเป็นรายการก่อน Go-live (ประวัติ) · หลัง Confirm แก้ / ลบไม่ได้</li>
              <li>ยอดตั้งต้นเดิมเก็บไว้ใน Audit Log · ถ้ายอดจริงต่างจากยอดตามระบบ แก้ตัวเลขที่หน้าของรายการนั้นได้</li>
              <li>ทำได้ตั้งแต่วันที่ {thDate(addDay(next, -1))} เป็นต้นไป (ต้องรู้ยอดสิ้นวันนั้นก่อน) · ต้องไม่มีเดือนที่ปิดอยู่</li>
            </ul>
          ) : (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              <li>ยอดตั้งต้นที่ลงวันที่ {thDate(addDay(current, -1))} (บัญชี · ทรัพย์สิน · หนี้ · พอร์ต · เงินให้กู้ · บัตร · เจ้าของ) ย้ายไปวันที่ {thDate(addDay(next, -1))} ให้ — ตัวเลขเท่าเดิม</li>
              <li>ถ้ายอดจริง ณ วันใหม่ต่างจากเดิม ให้แก้ตัวเลขเองหลังเปลี่ยน แล้วลงรายการย้อนหลังตั้งแต่ {thDate(next)}</li>
              <li>ต้องมีอัตราแลกเปลี่ยนของวันที่ {thDate(addDay(next, -1))} ด้วย (หน้า Opening Setup จะบอกถ้าขาด)</li>
              <li>ทำได้เฉพาะตอนยังไม่มีการปิดเดือนและการกระทบยอดบัญชีธนาคาร</li>
            </ul>
          )}
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" name="ack" className="mt-1" />
            <span>เข้าใจแล้ว ให้เปลี่ยนวัน Go-live</span>
          </label>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button disabled={pending || !changed} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
          {pending ? "กำลังเปลี่ยน…" : "เปลี่ยนวัน Go-live"}</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-700">{state.ok}</p>}
    </form>
  ));
}
