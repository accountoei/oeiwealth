"use client";

import { useActionState, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { FX_BBL_RATE_LABEL } from "@/lib/format";
import { setFxSource, type FxState } from "./actions";
import { FX_BTN } from "./FxRefreshButton";

/** ADMIN เลือกแหล่งอัตราแลกเปลี่ยน — มีผลตั้งแต่วันนี้ · อัตราที่บันทึกไว้แล้วไม่เปลี่ยน */
export default function FxSourceForm({ source, bblRate }: { source: string; bblRate: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<FxState, FormData>(setFxSource, {});
  const [src, setSrc] = useState(source);
  const trigger = <button type="button" onClick={() => setOpen(!open)}
    className={activeCls(FX_BTN)}>เปลี่ยนแหล่งอัตรา</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-3">
      <h2 className="font-medium text-slate-900">แหล่งอัตราแลกเปลี่ยน</h2>
      <div className="space-y-2 text-sm">
        {[["BOT", "ธปท. — อัตราเฉลี่ยรายวัน (อัตรากลาง) · ไม่มีค่าใช้จ่าย"], ["BBL", "ธนาคารกรุงเทพ — อัตราประกาศของธนาคาร (ต้องมี BBL_API_KEY)"]].map(([v, l]) => (
          <label key={v} className="flex items-start gap-2">
            <input type="radio" name="source" value={v} checked={src === v} onChange={() => setSrc(v)} className="mt-1" />
            <span>{l}</span>
          </label>
        ))}
      </div>
      {src === "BBL" && (
        <label className="block text-sm text-slate-700">อัตราที่ใช้คำนวณ
          <select name="bbl_rate" defaultValue={bblRate} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            {Object.entries(FX_BBL_RATE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      )}
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
        <li>มีผลตั้งแต่อัตราของวันนี้เป็นต้นไป · อัตราที่บันทึกไว้แล้วทุกวัน <b>ไม่เปลี่ยน</b> (Net Worth เดือนก่อน ๆ เท่าเดิม)</li>
        <li>ถ้าวันนี้ระบบดึงอัตราของแหล่งเดิมไปแล้ว (รอบ 09:30 / 14:30) อัตราของวันนี้ยังเป็นของแหล่งเดิม แหล่งใหม่จะเริ่มจากวันพรุ่งนี้</li>
        <li>ธนาคารกรุงเทพ: อัตราที่ต่างจากอัตราก่อนหน้าเกิน 5% ระบบจะไม่บันทึก และแจ้งในประวัติ Job (กันอ่านตัวเลขผิด)</li>
      </ul>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-700">{state.ok}</p>}
    </form>
  ));
}
