"use client";

import { useActionState, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { addClaim, type ActionState } from "../actions";
import { CLAIM_STATUS, COVERAGE_LABEL, ROW_BTN, covName } from "@/lib/format";
import Flash from "@/components/Flash";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/** กรมธรรม์ให้เลือก (แท็บความคุ้มครองของหน้ารวม · ตกลง 8 พ.ย. 2026) */
export type ClaimPolicyOpt = { id: string; label: string; currency: string };
export type ClaimCoverageOpt = { id: string; coverage_type: string; limit_amount: number; policy_id?: string; part?: string; label?: string | null };

/**
 * บันทึกเคลม (ปุ่ม "+ บันทึกเคลม" → pop up)
 *   หน้ากรมธรรม์: กรมธรรม์ตามหน้า · เล่มที่มีสัญญาเพิ่มเติม (parts) = เลือกส่วนของเล่ม (ตกลง 7 พ.ย. 2026)
 *   แท็บความคุ้มครองของหน้ารวม (policies): เลือกกรมธรรม์ก่อน (ตกลง 8 พ.ย. 2026)
 *   เลือกกรมธรรม์ / ส่วนแล้ว ความคุ้มครองเหลือเฉพาะของกรมธรรม์นั้น
 */
export default function ClaimForm({ policyId = "", policies, currency = "THB", today, coverages = [], parts }: {
  policyId?: string; policies?: ClaimPolicyOpt[]; currency?: string; today: string; parts?: { id: string; label: string }[];
  coverages?: ClaimCoverageOpt[];
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(addClaim, {});
  const choices: ClaimPolicyOpt[] | null = policies ?? (parts && parts.length > 1 ? parts.map((x) => ({ ...x, currency })) : null);
  const [pol, setPol] = useState(policies ? (policies.length === 1 ? policies[0].id : "") : policyId);
  const [cov, setCov] = useState("");
  const ccy = choices?.find((x) => x.id === pol)?.currency ?? currency;
  const covList = choices ? coverages.filter((c) => (c.policy_id ?? policyId) === pol) : coverages;
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(ROW_BTN)}>+ บันทึกเคลม</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-3 text-left">
      <h3 className="font-medium text-slate-900">บันทึกเคลม</h3>
      {!choices && <input type="hidden" name="policy_id" value={policyId} />}
      <input type="hidden" name="currency" value={ccy} />
      <div className="grid gap-3 md:grid-cols-3">
        {choices && (
          <label className={`text-sm ${policies ? "md:col-span-3" : ""}`}>{policies ? "กรมธรรม์ *" : "ส่วนของเล่ม"}
            <select name="policy_id" required value={pol} onChange={(e) => { setPol(e.target.value); setCov(""); }} className={input}>
              {policies && policies.length !== 1 && <option value="">— เลือกกรมธรรม์ —</option>}
              {choices.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm">วันเกิดเหตุ<input name="incident_date" type="date" max={today} className={input} /></label>
        <label className="text-sm">วันยื่นเคลม<input name="claim_date" type="date" defaultValue={today} max={today} className={input} /></label>
        <label className="text-sm">ยอดที่เคลม ({ccy})<input name="claimed_amount" inputMode="decimal" className={input} /></label>
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
      <p className="text-xs text-slate-500">ได้เงินแล้ว กด &ldquo;บันทึกรับเงิน&rdquo; ที่เคลมนั้น (เงินคืนค่าใช้จ่ายที่จ่ายไปก่อน หรือเงินชดเชย / สินไหม)</p>
      <div className="flex items-center gap-3">
        <button disabled={pending || !pol} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="text-sm text-emerald-700" />
      </div>
    </form>
  ));
}
