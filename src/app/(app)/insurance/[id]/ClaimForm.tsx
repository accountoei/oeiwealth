"use client";

import { useActionState, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { addClaim, type ActionState } from "../actions";
import { CLAIM_STATUS, COVERAGE_LABEL, covName } from "@/lib/format";
import Flash from "@/components/Flash";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/** บันทึกเคลม · เล่มที่มีสัญญาเพิ่มเติม (parts) = เลือกส่วนของเล่ม · เลือกความคุ้มครองแล้วส่วนเปลี่ยนตามให้ (ตกลง 7 พ.ย. 2026) */
export default function ClaimForm({ policyId, currency, today, coverages = [], parts }: {
  policyId: string; currency: string; today: string; parts?: { id: string; label: string }[];
  coverages?: { id: string; coverage_type: string; limit_amount: number; policy_id?: string; part?: string; label?: string | null }[];
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(addClaim, {});
  const [pol, setPol] = useState(policyId);
  const [cov, setCov] = useState("");
  const pick = parts && parts.length > 1;
  // เลือกส่วนแล้ว → เหลือเฉพาะความคุ้มครองของส่วนนั้น
  const covList = pick ? coverages.filter((c) => (c.policy_id ?? policyId) === pol) : coverages;
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls("rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50")}>+ บันทึกเคลม</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-3 rounded-lg bg-slate-50 p-4">
      {!pick && <input type="hidden" name="policy_id" value={policyId} />}
      <input type="hidden" name="currency" value={currency} />
      <div className="grid gap-3 md:grid-cols-3">
        {pick && (
          <label className="text-sm">ส่วนของเล่ม
            <select name="policy_id" value={pol} onChange={(e) => { setPol(e.target.value); setCov(""); }} className={input}>
              {parts.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm">วันเกิดเหตุ<input name="incident_date" type="date" max={today} className={input} /></label>
        <label className="text-sm">วันยื่นเคลม<input name="claim_date" type="date" defaultValue={today} max={today} className={input} /></label>
        <label className="text-sm">ยอดที่เคลม ({currency})<input name="claimed_amount" inputMode="decimal" className={input} /></label>
        <label className="text-sm">สถานะ
          <select name="status" defaultValue="SUBMITTED" className={input}>{CLAIM_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        {covList.length > 0 && (
          <label className="text-sm">เคลมจากความคุ้มครอง
            <select name="coverage_id" value={cov} onChange={(e) => setCov(e.target.value)} className={input}>
              <option value="">— ไม่ระบุ —</option>
              {covList.map((c) => <option key={c.id} value={c.id}>{c.coverage_type === "OTHER" ? covName(c.coverage_type, c.label) : COVERAGE_LABEL[c.coverage_type]?.join(" ").trim() ?? c.coverage_type}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm md:col-span-2">หมายเหตุ<input name="notes" className={input} /></label>
      </div>
      <p className="text-xs text-slate-500">เงินเคลมที่ได้รับคืนจากค่ารักษา ให้บันทึกเป็น &ldquo;เงินคืน&rdquo; ของค่าใช้จ่ายนั้นที่หน้า Income &amp; Expenses (ไม่ใช่รายได้)</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="text-sm text-emerald-700" />
      </div>
    </form>
  ));
}
