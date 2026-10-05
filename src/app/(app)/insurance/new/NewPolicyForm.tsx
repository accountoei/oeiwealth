"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createPolicy, type ActionState } from "../actions";
import { BeneficiaryRows } from "../Beneficiaries";
import OwnerShares from "@/components/OwnerShares";
import { CURRENCIES, INS_TYPE, thDate } from "@/lib/format";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export default function NewPolicyForm(props: {
  persons: { id: string; name: string }[]; assets: { id: string; name: string }[];
  goLive: string; openingDate: string; today: string; isSetup: boolean; isAdmin: boolean;
}) {
  const { persons, assets, goLive, openingDate, today, isSetup, isAdmin } = props;
  const [state, action, pending] = useActionState<ActionState, FormData>(createPolicy, {});
  const [type, setType] = useState("LIFE");
  const [hasCv, setHasCv] = useState(false);
  const [opening, setOpening] = useState(isSetup);
  const [rows, setRows] = useState([{ person_id: "", name: "", percent: "" }]);
  return (
    <form action={action} className="space-y-6">
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium text-slate-900">ข้อมูลกรมธรรม์</h2>
        <label className={label}>ประเภท *
          <select name="insurance_type" value={type} onChange={(e) => setType(e.target.value)} className={input}>
            {INS_TYPE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={label}>บริษัทประกัน *<input name="insurer" required className={input} /></label>
        <label className={label}>เลขกรมธรรม์<input name="policy_no" className={input} /></label>
        {type === "PROPERTY" ? (
          <label className={label}>ทรัพย์สินที่เอาประกัน
            <select name="insured_asset_id" defaultValue="" className={input}>
              <option value="">— ไม่ระบุ —</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        ) : (
          <label className={label}>ผู้เอาประกัน
            <select name="person_id" defaultValue={persons[0]?.id ?? ""} className={input}>
              <option value="">— ไม่ระบุ —</option>{persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <label className={label}>วันเริ่มคุ้มครอง<input name="start_date" type="date" className={input} /></label>
        <label className={label}>วันสิ้นสุด / ครบสัญญา<input name="end_date" type="date" className={input} /></label>
        <label className={label}>ทุนประกัน<input name="insured_amount" inputMode="decimal" className={input} /></label>
        <label className={label}>เบี้ยประกัน (ต่อปี)<input name="premium" inputMode="decimal" className={input} /></label>
        <label className={label}>สกุลเงิน
          <select name="currency" defaultValue="THB" className={input}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label className={label}>หมายเหตุ {hasCv && opening && !isSetup && "(เหตุผล · จำเป็น)"}<input name="notes" required={hasCv && opening && !isSetup} className={input} /></label>
      </section>

      {type !== "PROPERTY" && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">ผู้รับผลประโยชน์</h2>
          <BeneficiaryRows persons={persons} rows={rows} setRows={setRows} />
        </section>
      )}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="has_cash_value" checked={hasCv} onChange={(e) => setHasCv(e.target.checked)} className="mt-1" />
          <span><b>มีมูลค่าเวนคืน</b> (เช่น ประกันชีวิตสะสมทรัพย์) — นับมูลค่าเวนคืนเป็นสินทรัพย์ของครอบครัว</span>
        </label>
        {hasCv && (
          <>
            {(isSetup || isAdmin) && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="is_opening" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="mt-1" />
                <span>มีอยู่ก่อน Go-live ({thDate(goLive)}) — มูลค่าเวนคืน ณ สิ้นวัน {thDate(openingDate)} เป็นยอดตั้งต้น</span>
              </label>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <label className={label}>มูลค่าเวนคืน *<input name="cash_value" required inputMode="decimal" className={input} /></label>
              <label className={label}>ณ วันที่ *
                {opening ? <><input type="hidden" name="cash_value_date" value={openingDate} /><input disabled value={thDate(openingDate)} className={`${input} bg-slate-50`} /></>
                  : <input name="cash_value_date" type="date" required min={goLive} max={today} defaultValue={today} className={input} />}
              </label>
            </div>
            <OwnerShares persons={persons} title="เจ้าของมูลค่าเวนคืน (ผู้ถือกรมธรรม์)" />
          </>
        )}
      </section>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-3">
        <button disabled={pending} className="rounded-md bg-slate-900 px-5 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <Link href="/insurance" className="rounded-md border border-slate-300 px-5 py-2 text-sm">ยกเลิก</Link>
      </div>
    </form>
  );
}
