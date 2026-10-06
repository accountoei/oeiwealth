"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createBusiness, type ActionState } from "../actions";
import OwnerShares from "@/components/OwnerShares";
import { CURRENCIES, thDate } from "@/lib/format";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export default function NewBusinessForm(props: {
  persons: { id: string; name: string }[]; goLive: string; openingDate: string; today: string; isSetup: boolean; isAdmin: boolean;
}) {
  const { persons, goLive, openingDate, today, isSetup, isAdmin } = props;
  const [state, action, pending] = useActionState<ActionState, FormData>(createBusiness, {});
  const [opening, setOpening] = useState(isSetup);
  return (
    <form action={action} className="space-y-6">
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium text-slate-900">ข้อมูลกิจการ</h2>
        <label className={label}>ชื่อบริษัท *<input name="company_name" required className={input} /></label>
        <label className={label}>ชื่อที่ใช้เรียก<input name="name" placeholder="ไม่ใส่ = ชื่อบริษัท" className={input} /></label>
        <label className={label}>เลขทะเบียนนิติบุคคล<input name="registration_no" className={input} /></label>
        <label className={label}>ประเภทธุรกิจ<input name="business_type" className={input} /></label>
        <label className={label}>จำนวนหุ้นทั้งหมดของบริษัท<input name="total_shares" inputMode="decimal" className={input} /></label>
        <label className={label}>จำนวนหุ้นที่ครอบครัวถือ<input name="shares_owned" inputMode="decimal" className={input} /></label>
        <label className={label}>% ที่ครอบครัวถือในบริษัท<input name="company_ownership_percent" inputMode="decimal" className={input} /></label>
        <label className={label}>เงินลงทุน (ต้นทุน)<input name="investment_cost" inputMode="decimal" className={input} /></label>
        <label className={label}>วันที่ได้มา {!opening && "*"}<input name="acquisition_date" type="date" required={!opening} min={opening ? undefined : goLive} max={today} className={input} /></label>
      </section>

      <OwnerShares persons={persons} title="สมาชิกที่เป็นเจ้าของหุ้นส่วนนี้" hint="สัดส่วนภายในครอบครัว (คนละเรื่องกับ % ที่ถือในบริษัท)" />

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">มูลค่าส่วนของครอบครัว (บังคับ)</h2>
        {(isSetup || isAdmin) && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="is_opening" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="mt-1" />
            <span>มีอยู่ก่อน Go-live ({thDate(goLive)}) — มูลค่าตั้งต้น ณ สิ้นวัน {thDate(openingDate)}
              {!isSetup && <span className="block text-xs text-amber-700">ระบบ LIVE แล้ว: ต้องระบุเหตุผลในหมายเหตุ</span>}</span>
          </label>
        )}
        <div className="grid gap-4 md:grid-cols-4">
          <label className={label}>มูลค่า *<input name="value" required inputMode="decimal" className={input} /></label>
          <label className={label}>สกุลเงิน<select name="currency" defaultValue="THB" className={input}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className={label}>ณ วันที่ *
            {opening ? <><input type="hidden" name="value_date" value={openingDate} /><input disabled value={thDate(openingDate)} className={`${input} bg-slate-50`} /></>
              : <input name="value_date" type="date" required min={goLive} max={today} defaultValue={today} className={input} />}
          </label>
          <label className={label}>วิธีประเมิน
            <select name="valuation_method" defaultValue="BOOK_VALUE" className={input}>
              <option value="BOOK_VALUE">มูลค่าตามบัญชี (ส่วนของผู้ถือหุ้น)</option><option value="USER_ESTIMATE">ประมาณเอง</option>
              <option value="APPRAISAL">ผู้ประเมิน</option><option value="LATEST_TRANSACTION">ราคาซื้อขายล่าสุด</option>
            </select>
          </label>
        </div>
        <label className={label}>หมายเหตุ {opening && !isSetup && "(เหตุผล · จำเป็น)"}<textarea name="notes" rows={2} required={opening && !isSetup} className={input} /></label>
      </section>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-3">
        <button disabled={pending} className="rounded-md bg-slate-900 px-5 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <Link href="/financial/business" className="rounded-md border border-slate-300 px-5 py-2 text-sm">ยกเลิก</Link>
      </div>
    </form>
  );
}
