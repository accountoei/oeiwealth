"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createProperty, type ActionState } from "../actions";
import OwnerShares from "@/components/OwnerShares";
import LeaseFields, { type Bank } from "../LeaseFields";
import { CURRENCIES, PROPERTY_TYPE_LABEL, USAGE_LABEL, thDate } from "@/lib/format";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export default function NewPropertyForm(props: {
  persons: { id: string; name: string }[]; banks: Bank[];
  goLive: string; openingDate: string; today: string; isSetup: boolean; isAdmin: boolean;
}) {
  const { persons, banks, goLive, openingDate, today, isSetup, isAdmin } = props;
  const [state, action, pending] = useActionState<ActionState, FormData>(createProperty, {});
  const [opening, setOpening] = useState(isSetup);
  const [usage, setUsage] = useState("OWNER_OCCUPIED");
  const [currency, setCurrency] = useState("THB");

  return (
    <form action={action} className="space-y-6">
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium text-slate-900">ข้อมูลทรัพย์สิน</h2>
        <label className={label}>ชื่อที่ใช้เรียก *<input name="name" required placeholder="เช่น บ้านบางนา" className={input} /></label>
        <label className={label}>ประเภท *
          <select name="property_type" defaultValue="HOUSE" className={input}>
            {Object.entries(PROPERTY_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={label}>การใช้งาน *
          <select name="usage_type" value={usage} onChange={(e) => setUsage(e.target.value)} className={input}>
            {Object.entries(USAGE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={label}>สกุลเงิน
          <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={input}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className={label}>กลุ่มทำเล<input name="location_group" placeholder="เช่น กรุงเทพ · เชียงใหม่" className={input} /></label>
        <label className={label}>ที่อยู่<input name="address" className={input} /></label>
        <div className={label}>เนื้อที่ (ไร่-งาน-ตารางวา)
          <div className="mt-1 flex gap-2">
            <input name="land_rai" inputMode="numeric" placeholder="ไร่" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input name="land_ngan" inputMode="numeric" placeholder="งาน" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input name="land_wa" inputMode="decimal" placeholder="ตร.ว." className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>
        <label className={label}>ประเภทเอกสารสิทธิ์<input name="title_type" placeholder="เช่น โฉนด · น.ส.3ก · อ.ช.2" className={input} /></label>
        <label className={label}>เลขที่โฉนด / เอกสารสิทธิ์<input name="title_deed_no" className={input} /></label>
        <label className={label}>เลขที่ดิน<input name="land_no" className={input} /></label>
        <label className={label}>วันที่ได้มา {!opening && "*"}
          <input name="acquisition_date" type="date" required={!opening} min={opening ? undefined : goLive} max={today} className={input} />
        </label>
        <label className={label}>ราคาที่ได้มา<input name="acquisition_cost" inputMode="decimal" className={input} /></label>
      </section>

      <OwnerShares persons={persons} title="เจ้าของ" hint="สัดส่วนกรรมสิทธิ์ · ใช้แบ่งมูลค่า ค่าเช่า และหนี้เงินประกันตามสัดส่วน" />

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">มูลค่า (บังคับ)</h2>
        {(isSetup || isAdmin) && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="is_opening" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="mt-1" />
            <span>
              มีอยู่ก่อน Go-live ({thDate(goLive)}) — ใช้เป็น <b>มูลค่าตั้งต้น</b> ณ สิ้นวัน {thDate(openingDate)}
              {!isSetup && <span className="block text-xs text-amber-700">ระบบ LIVE แล้ว: ต้องระบุเหตุผลในหมายเหตุ</span>}
            </span>
          </label>
        )}
        {!opening && (
          <p className="text-xs text-slate-500">ได้มาหลัง Go-live: ถ้าจ่ายเงินซื้อจากบัญชี ให้บันทึกรายการเงินออก &ldquo;ซื้อทรัพย์สิน&rdquo; ที่หน้า Income &amp; Expenses ด้วย</p>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <label className={label}>มูลค่า *<input name="value" required inputMode="decimal" className={input} /></label>
          <label className={label}>มูลค่า ณ วันที่ *
            {opening
              ? <><input type="hidden" name="value_date" value={openingDate} /><input disabled value={thDate(openingDate)} className={`${input} bg-slate-50`} /></>
              : <input name="value_date" type="date" required min={goLive} max={today} defaultValue={today} className={input} />}
          </label>
          <label className={label}>วิธีประเมิน
            <select name="valuation_method" defaultValue="USER_ESTIMATE" className={input}>
              <option value="USER_ESTIMATE">ประมาณเอง</option>
              <option value="APPRAISAL">ประเมินโดยผู้ประเมิน / ธนาคาร</option>
              <option value="BOOK_VALUE">ราคาทุน</option>
              <option value="LATEST_TRANSACTION">ราคาซื้อขายล่าสุด</option>
            </select>
          </label>
        </div>
        <label className={label}>หมายเหตุ {opening && !isSetup && "(เหตุผล · จำเป็น)"}
          <textarea name="notes" rows={2} required={opening && !isSetup} className={input} />
        </label>
      </section>

      {usage === "RENTAL" && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">สัญญาเช่าปัจจุบัน</h2>
          <p className="text-xs text-slate-500">ถ้ายังไม่มีผู้เช่า ให้เลือกการใช้งานเป็น &ldquo;ว่าง&rdquo; แล้วเพิ่มสัญญาภายหลัง</p>
          <LeaseFields banks={banks} goLive={goLive} currency={currency} />
        </section>
      )}

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-3">
        <button disabled={pending} className="rounded-md bg-slate-900 px-5 py-2 text-sm text-white disabled:opacity-50">
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <Link href="/property" className="rounded-md border border-slate-300 px-5 py-2 text-sm">ยกเลิก</Link>
      </div>
    </form>
  );
}
