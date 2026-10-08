"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createLiability, type ActionState } from "../actions";
import OwnerShares from "@/components/OwnerShares";
import { CURRENCIES, LIABILITY_TYPE_LABEL, thDate } from "@/lib/format";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export default function NewLiabilityForm(props: {
  persons: { id: string; name: string }[]; assets: { id: string; name: string; asset_group: string }[];
  goLive: string; openingDate: string; today: string; isSetup: boolean; isAdmin: boolean;
}) {
  const { persons, assets, goLive, openingDate, today, isSetup, isAdmin } = props;
  const [state, action, pending] = useActionState<ActionState, FormData>(createLiability, {});
  const [opening, setOpening] = useState(isSetup);

  return (
    <form action={action} className="space-y-6">
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium text-slate-900">ข้อมูลหนี้สิน</h2>
        <label className={label}>ประเภท *
          <select name="liability_type" defaultValue="MORTGAGE" className={input}>
            {Object.entries(LIABILITY_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={label}>ชื่อที่ใช้เรียก *<input name="name" required placeholder="เช่น สินเชื่อบ้าน A" className={input} /></label>
        <label className={label}>ผู้ให้กู้<input name="lender" placeholder="เช่น SCB" className={input} /></label>
        <label className={label}>สกุลเงิน
          <select name="currency" defaultValue="THB" className={input}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label className={label}>วงเงินกู้เริ่มต้น<input name="original_amount" inputMode="decimal" className={input} /></label>
        <label className={label}>อัตราดอกเบี้ย (% ต่อปี)<input name="interest_rate" inputMode="decimal" className={input} /></label>
        <label className={label}>ค่างวดต่อเดือน<input name="monthly_payment" inputMode="decimal" className={input} /></label>
        <label className={label}>ครบกำหนดจ่ายทุกวันที่<input name="payment_due_day" type="number" min={1} max={31} className={input} /></label>
        <label className={label}>วันเริ่มสัญญา<input name="start_date" type="date" className={input} /></label>
        <label className={label}>วันครบกำหนดสัญญา<input name="due_date" type="date" className={input} /></label>
        <label className={`${label} md:col-span-2`}>ผูกกับทรัพย์สิน (ไม่บังคับ · ใช้แสดง &ldquo;ส่วนของเจ้าของ&rdquo; เท่านั้น ไม่หักหนี้ออกจากมูลค่าทรัพย์สิน)
          <select name="linked_asset_id" defaultValue="" className={input}>
            <option value="">— ไม่ผูก —</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </section>

      <OwnerShares persons={persons} title="ผู้รับผิดชอบหนี้" hint="สัดส่วนที่แต่ละคนรับผิดชอบ · ส่วนที่ไม่ระบุแสดงเป็น Unallocated" />

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">ยอดคงค้าง (บังคับ)</h2>
        {(isSetup || isAdmin) && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="is_opening" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="mt-1" />
            <span>
              หนี้มีอยู่ก่อน Go-live ({thDate(goLive)}) — ใช้เป็น <b>ยอดตั้งต้น</b> ณ สิ้นวัน {thDate(openingDate)}
              {!isSetup && <span className="block text-xs text-amber-700">ระบบ LIVE แล้ว: ต้องระบุเหตุผลในหมายเหตุ</span>}
            </span>
          </label>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <label className={label}>ยอดคงค้าง *<input name="balance" required inputMode="decimal" className={input} /></label>
          <label className={label}>ยอด ณ วันที่ *
            {opening
              ? <><input type="hidden" name="balance_date" value={openingDate} /><input disabled value={thDate(openingDate)} className={`${input} bg-slate-50`} /></>
              : <input name="balance_date" type="date" required min={goLive} max={today} defaultValue={today} className={input} />}
          </label>
        </div>
        <label className={label}>หมายเหตุ {opening && !isSetup && "(เหตุผล · จำเป็น)"}
          <textarea name="notes" rows={2} required={opening && !isSetup} className={input} />
        </label>
      </section>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-5 py-2 text-sm text-white disabled:opacity-50">
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <Link href="/liabilities" className="rounded-md border border-slate-300 px-5 py-2 text-sm">ยกเลิก</Link>
      </div>
    </form>
  );
}
