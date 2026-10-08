"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createLoan, type ActionState } from "../actions";
import OwnerShares from "@/components/OwnerShares";
import { CURRENCIES, thDate } from "@/lib/format";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export default function NewLoanForm(props: {
  persons: { id: string; name: string }[]; banks: { asset_id: string; name: string; currency: string }[];
  goLive: string; openingDate: string; today: string; isSetup: boolean; isAdmin: boolean;
}) {
  const { persons, banks, goLive, openingDate, today, isSetup, isAdmin } = props;
  const [state, action, pending] = useActionState<ActionState, FormData>(createLoan, {});
  const [opening, setOpening] = useState(isSetup);
  return (
    <form action={action} className="space-y-6">
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium text-slate-900">ข้อมูลเงินกู้</h2>
        <label className={label}>ชื่อรายการ *<input name="name" required placeholder="เช่น ให้น้องยืมซื้อรถ" className={input} /></label>
        <label className={label}>ผู้กู้ *<input name="borrower_name" required className={input} /></label>
        <label className={label}>เงินต้นตามสัญญา *<input name="principal" required inputMode="decimal" className={input} /></label>
        <label className={label}>อัตราดอกเบี้ย (% ต่อปี)<input name="interest_rate" inputMode="decimal" className={input} /></label>
        <label className={label}>วันที่ให้กู้<input name="loan_date" type="date" max={today} className={input} /></label>
        <label className={label}>ครบกำหนดคืน<input name="due_date" type="date" className={input} /></label>
        <label className={`${label} md:col-span-2`}>หมายเหตุ {opening && !isSetup && "(เหตุผล · จำเป็น)"}
          <input name="notes" required={opening && !isSetup} className={input} />
        </label>
      </section>

      <OwnerShares persons={persons} title="ผู้ให้กู้ (เจ้าของสิทธิ์เรียกเงินคืน)" />

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">ยอดเงิน</h2>
        {(isSetup || isAdmin) && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="is_opening" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="mt-1" />
            <span>ให้กู้ไปก่อน Go-live ({thDate(goLive)}) — ใส่เงินต้นคงเหลือ ณ สิ้นวัน {thDate(openingDate)}
              {!isSetup && <span className="block text-xs text-amber-700">ระบบ LIVE แล้ว: เฉพาะ ADMIN และต้องมีเหตุผล</span>}</span>
          </label>
        )}
        {opening ? (
          <div className="grid gap-4 md:grid-cols-2">
            <label className={label}>เงินต้นคงเหลือ ณ วันตั้งต้น<input name="opening_outstanding" inputMode="decimal" placeholder="ไม่ใส่ = เท่าเงินต้น" className={input} /></label>
            <label className={label}>สกุลเงิน
              <select name="currency" defaultValue="THB" className={input}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <label className={label}>จ่ายเงินกู้จากบัญชี *
              <select name="disburse_from_asset_id" required className={input}>
                {banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}
              </select>
            </label>
            <label className={label}>วันที่จ่ายเงิน *<input name="disburse_date" type="date" required defaultValue={today} min={goLive} max={today} className={input} /></label>
            <p className="md:col-span-2 text-xs text-slate-500">ระบบสร้างรายการเงินออก &ldquo;ให้กู้&rdquo; จากบัญชีให้ (ไม่ใช่ค่าใช้จ่าย)</p>
          </div>
        )}
      </section>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-5 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <Link href="/financial/loans" className="rounded-md border border-slate-300 px-5 py-2 text-sm">ยกเลิก</Link>
      </div>
    </form>
  );
}
