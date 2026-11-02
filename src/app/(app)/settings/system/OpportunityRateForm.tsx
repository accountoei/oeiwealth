"use client";

import { useActionState, useRef, useState } from "react";
import { useResetSync } from "@/lib/useResetSync";
import { setOpportunityRate, type FxState } from "./actions";
import Flash from "@/components/Flash";
import { OPPORTUNITY_METHOD_LABEL } from "@/lib/format";

/** อัตราดอกเบี้ยเทียบ (ต้นทุนเสียโอกาส) ของครอบครัว — ADMIN แก้ · ใช้คิดราคาขายขั้นต่ำที่คุ้มของ Property (ไม่นับใน Net Worth)
 *  วิธีคิด: อัตราคงที่ (ตัวเลข = อัตราเต็ม) หรือ เงินเฟ้อ + ส่วนเพิ่ม (ตัวเลข = ส่วนเพิ่มเหนือเงินเฟ้อ) · เปลี่ยนวิธี = ต้องกรอกตัวเลขใหม่ (ตกลง 2 พ.ย. 2026) */
export default function OpportunityRateForm({ rate, method, canEdit }: { rate: number | null; method: string; canEdit: boolean }) {
  const [state, action, pending] = useActionState<FxState, FormData>(setOpportunityRate, {});
  const [m, setM] = useState(method === "CPI_PLUS" ? "CPI_PLUS" : "FIXED");
  const ref = useRef<HTMLSelectElement>(null);
  useResetSync(ref, setM);
  const same = m === method;
  const cpi = m === "CPI_PLUS";
  return (
    <form action={action} className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">วิธีคิด
          <select ref={ref} name="method" defaultValue={m} onChange={(e) => setM(e.target.value)} disabled={!canEdit}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50">
            {Object.entries(OPPORTUNITY_METHOD_LABEL).reverse().map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        <label className="flex items-center gap-2">{cpi ? "ส่วนเพิ่มเหนือเงินเฟ้อ" : "อัตรา"}
          {/* เปลี่ยนวิธี → ช่องว่าง ให้กรอกใหม่ (ตัวเลขเดิมคนละความหมาย) */}
          <input key={m} name="rate" inputMode="decimal" data-money="off" defaultValue={same ? (rate ?? "") : ""} disabled={!canEdit}
            placeholder={cpi ? "แนะนำ 2" : "เช่น 4"} required={!same}
            className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm disabled:bg-slate-50" />
          % ต่อปี</label>
        {canEdit && <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
          {pending ? "กำลังบันทึก…" : "บันทึก"}</button>}
        {state.error && <span className="text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="text-emerald-700" />
      </div>
      <p className="text-xs text-slate-500">
        {cpi
          ? <>ดอกเบี้ยแต่ละก้อน = เงินเฟ้อจริงตั้งแต่ปีที่จ่ายถึงปีล่าสุดในตารางด้านล่าง + ส่วนเพิ่มนี้ทบต้นทุกปี · ส่วนเพิ่ม = ผลตอบแทนจริงที่ควรได้เหนือเงินเฟ้อ (แนะนำ 2%)</>
          : <>ดอกเบี้ยแต่ละก้อน = อัตรานี้ทบต้นทุกปีตามระยะเวลาที่ถือ</>}
        {!same && <span className="text-amber-700"> · เปลี่ยนวิธีคิดแล้ว กรอกตัวเลขใหม่</span>}
      </p>
    </form>
  );
}
