"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { addCategory, createAlternative, type ActionState } from "../actions";
import OwnerShares from "@/components/OwnerShares";
import { CURRENCIES, thDate } from "@/lib/format";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export default function NewAlternativeForm(props: {
  persons: { id: string; name: string }[]; categories: { id: string; name: string }[];
  goLive: string; openingDate: string; today: string; isSetup: boolean; isAdmin: boolean;
}) {
  const { persons, categories, goLive, openingDate, today, isSetup, isAdmin } = props;
  const [state, action, pending] = useActionState<ActionState, FormData>(createAlternative, {});
  const [cs, catAction, adding] = useActionState<ActionState, FormData>(addCategory, {});
  const [opening, setOpening] = useState(isSetup);
  const [newCat, setNewCat] = useState(false);
  return (
    <div className="space-y-6">
      <form action={action} className="space-y-6">
        <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2">
          <h2 className="md:col-span-2 font-medium text-slate-900">ข้อมูลสินทรัพย์</h2>
          <label className={label}>ชื่อ *<input name="name" required placeholder="เช่น ทองแท่ง 10 บาท" className={input} /></label>
          <label className={label}>หมวด *
            <select name="category_id" required className={input}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <button type="button" onClick={() => setNewCat(!newCat)} className="mt-1 text-xs text-slate-600 underline">+ เพิ่มหมวดเอง</button>
          </label>
          <label className={label}>ยี่ห้อ<input name="brand" className={input} /></label>
          <label className={label}>รุ่น<input name="model" className={input} /></label>
          <label className={label}>Serial / เลขใบรับรอง<input name="serial_no" className={input} /></label>
          <label className={label}>จำนวน (เช่น น้ำหนักบาท / หน่วย)<input name="quantity" inputMode="decimal" className={input} /></label>
          <label className={label}>ที่เก็บ<input name="storage_location" placeholder="เช่น ตู้เซฟธนาคาร" className={input} /></label>
          <label className={label}>สภาพ<input name="condition" className={input} /></label>
          <label className={`${label} md:col-span-2`}>รายละเอียด<input name="details" className={input} /></label>
          <label className={label}>วันที่ได้มา {!opening && "*"}<input name="acquisition_date" type="date" required={!opening} min={opening ? undefined : goLive} max={today} className={input} /></label>
          <label className={label}>ราคาที่ซื้อ<input name="acquisition_cost" inputMode="decimal" className={input} /></label>
        </section>

        <OwnerShares persons={persons} title="เจ้าของ" />

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">มูลค่า (บังคับ)</h2>
          {(isSetup || isAdmin) && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="is_opening" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="mt-1" />
              <span>มีอยู่ก่อน Go-live ({thDate(goLive)}) — มูลค่าตั้งต้น ณ สิ้นวัน {thDate(openingDate)}
                {!isSetup && <span className="block text-xs text-amber-700">ระบบ LIVE แล้ว: ต้องระบุเหตุผลในหมายเหตุ</span>}</span>
            </label>
          )}
          <div className="grid gap-4 md:grid-cols-4">
            <label className={label}>มูลค่า *<input name="value" required inputMode="decimal" className={input} /></label>
            <label className={label}>สกุลเงิน
              <select name="currency" defaultValue="THB" className={input}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <label className={label}>ณ วันที่ *
              {opening ? <><input type="hidden" name="value_date" value={openingDate} /><input disabled value={thDate(openingDate)} className={`${input} bg-slate-50`} /></>
                : <input name="value_date" type="date" required min={goLive} max={today} defaultValue={today} className={input} />}
            </label>
            <label className={label}>วิธีประเมิน
              <select name="valuation_method" defaultValue="USER_ESTIMATE" className={input}>
                <option value="USER_ESTIMATE">ประมาณเอง</option><option value="APPRAISAL">ผู้ประเมิน / ร้าน</option>
                <option value="LATEST_TRANSACTION">ราคาตลาดล่าสุด</option><option value="BOOK_VALUE">ราคาทุน</option>
              </select>
            </label>
          </div>
          <label className={label}>หมายเหตุ {opening && !isSetup && "(เหตุผล · จำเป็น)"}<textarea name="notes" rows={2} required={opening && !isSetup} className={input} /></label>
          {!opening && <p className="text-xs text-slate-500">ถ้าจ่ายเงินซื้อจากบัญชี ให้บันทึกรายการเงินออกจากบัญชีด้วย (เงินออกอื่น ๆ)</p>}
        </section>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <div className="flex gap-3">
          <button disabled={pending} className="rounded-md bg-slate-900 px-5 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
          <Link href="/alternative" className="rounded-md border border-slate-300 px-5 py-2 text-sm">ยกเลิก</Link>
        </div>
      </form>
      {newCat && (
        <form action={catAction} className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4">
          <label className="text-sm">ชื่อหมวดใหม่<input name="category_name" required placeholder="เช่น พระเครื่อง / งานศิลปะ" className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm" /></label>
          <button disabled={adding} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">เพิ่มหมวด</button>
          {cs.error && <span className="text-sm text-red-600">{cs.error}</span>}
          {cs.ok && <span className="text-sm text-emerald-700">{cs.ok} (เลือกได้ในช่องหมวดด้านบน)</span>}
        </form>
      )}
    </div>
  );
}
