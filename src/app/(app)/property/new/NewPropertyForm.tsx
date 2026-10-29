"use client";

import Link from "next/link";
import { useActionState, useCallback, useState } from "react";
import { createProperty, type ActionState } from "../actions";
import OwnerShares from "@/components/OwnerShares";
import LeaseFields, { type Bank } from "../LeaseFields";
import { PROPERTY_TYPE_LABEL, USAGE_LABEL, thDate } from "@/lib/format";
import { CurrencySelect } from "@/components/CurrencyContext";
import ComponentTable from "../ComponentTable";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export default function NewPropertyForm(props: {
  persons: { id: string; name: string }[]; banks: Bank[];
  goLive: string; openingDate: string; today: string; isSetup: boolean; isAdmin: boolean;
}) {
  const { persons, banks, goLive, openingDate, today, isSetup, isAdmin } = props;
  const [state, action, pending] = useActionState<ActionState, FormData>(createProperty, {});
  const [usage, setUsage] = useState("OWNER_OCCUPIED");
  const [currency, setCurrency] = useState("THB");
  // วันที่ได้มา = วันที่เก่าสุดของแถวในตารางส่วนประกอบ · ก่อน Go-live = ยอดตั้งต้น (ไม่มีช่องติ๊กแยก · ตกลง 29 ต.ค. 2026)
  const [earliest, setEarliest] = useState("");
  const onEarliest = useCallback((d: string) => setEarliest(d), []);
  const opening = !!earliest && earliest < goLive;
  const blocked = opening && !isSetup && !isAdmin;
  const [payMode, setPayMode] = useState<"PAID" | "CREDIT" | "NONE">("PAID");
  const bankOptions = banks.filter((b) => b.currency === currency).map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>);

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
          <CurrencySelect name="currency" value={currency} onChange={setCurrency} className={input} />
        </label>
        <label className={label}>กลุ่มทำเล<input name="location_group" placeholder="เช่น กรุงเทพ · เชียงใหม่" className={input} /></label>
        <label className={label}>ที่อยู่<input name="address" className={input} /></label>
        {/* ส่วนประกอบ: ที่ดิน (โฉนด) · อาคาร · สิ่งปลูกสร้างอื่น — ข้อมูล + ต้นทุน + มูลค่ารายแถว ในกล่องเดียวกัน (ตกลง 29 ต.ค. 2026) */}
        <div className="md:col-span-2 space-y-1">
          <h3 className="text-sm font-medium text-slate-800">ส่วนประกอบ · ต้นทุน · มูลค่า</h3>
          <ComponentTable mode="new" currency={currency} onEarliest={onEarliest} />
        </div>
        {opening ? (
          <div className="md:col-span-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <input type="hidden" name="is_opening" value="on" /><input type="hidden" name="value_date" value={openingDate} />
            วันที่ได้มาเก่าสุด {thDate(earliest)} อยู่ก่อน Go-live ({thDate(goLive)}) → บันทึกเป็น <b>มูลค่าตั้งต้น</b> ณ สิ้นวัน {thDate(openingDate)} · ไม่มีเงินออกจากบัญชี
            {!isSetup && (isAdmin
              ? <span className="block text-xs">ระบบ LIVE แล้ว: ต้องระบุเหตุผลในหมายเหตุ</span>
              : <span className="block text-xs font-medium">ระบบ LIVE แล้ว: เพิ่มทรัพย์สินที่มีอยู่ก่อน Go-live ได้เฉพาะ ADMIN</span>)}
          </div>
        ) : (
          <fieldset className="md:col-span-2 space-y-2">
            <input type="hidden" name="value_date" value={earliest || today} />
            <legend className="text-sm text-slate-700">การจ่าย</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {([["PAID", "จ่ายครบแล้ว"], ["CREDIT", "ยังจ่ายไม่ครบ / ผ่อนกับผู้ขาย"], ["NONE", "ไม่มีเงินออก (เช่น มรดก / ได้รับให้)"]] as const).map(([v, l]) => (
                <label key={v} className="flex items-center gap-1.5">
                  <input type="radio" name="pay_mode" value={v} checked={payMode === v} onChange={() => setPayMode(v)} />{l}</label>
              ))}
            </div>
            {payMode === "PAID" && (
              <div className="grid gap-3 md:grid-cols-2">
                <label className={label}>จ่ายจากบัญชี *
                  <select name="pay_bank_asset_id" required defaultValue="" className={input}>
                    <option value="" disabled>— เลือกบัญชี —</option>{bankOptions}
                  </select>
                </label>
                <p className="self-end text-xs text-slate-500">บันทึกเงินออก &ldquo;ซื้อทรัพย์สิน&rdquo; = ต้นทุนรวมในตาราง ณ วันที่ได้มา · จ่ายหลายบัญชี: เลือกบัญชีหลักที่นี่ แล้วแก้ / เพิ่มที่ &ldquo;จ่ายซื้อ / จ่ายเพิ่ม&rdquo; ในหน้าทรัพย์สิน</p>
              </div>
            )}
            {payMode === "CREDIT" && (
              <div className="grid gap-3 md:grid-cols-3">
                <label className={label}>เงินดาวน์ / จ่ายไปแล้ว<input name="down_payment" inputMode="decimal" placeholder="0.00" className={`${input} text-right`} /></label>
                <label className={label}>จ่ายดาวน์จากบัญชี
                  <select name="pay_bank_asset_id" defaultValue="" className={input}><option value="">— ไม่มีเงินดาวน์ —</option>{bankOptions}</select>
                </label>
                <label className={label}>ผู้ขาย / เจ้าหนี้<input name="seller" placeholder="เช่น โครงการ / ชื่อผู้ขาย" className={input} /></label>
                <p className="md:col-span-3 text-xs text-slate-500">ส่วนที่เหลือ (ต้นทุน − เงินดาวน์) สร้างเป็นหนี้สิน &ldquo;ค้างจ่ายค่าซื้อ&rdquo; ผูกกับทรัพย์สินนี้ · จ่ายงวดที่หน้าหนี้สิน (ต้นทุนไม่นับซ้ำ)</p>
              </div>
            )}
          </fieldset>
        )}
        <label className={`${label} md:col-span-2`}>หมายเหตุ {opening && !isSetup && "(เหตุผล · จำเป็น)"}
          <textarea name="notes" rows={2} required={opening && !isSetup} className={input} />
        </label>
      </section>

      <OwnerShares persons={persons} title="เจ้าของ" hint="สัดส่วนกรรมสิทธิ์ · ใช้แบ่งมูลค่า ค่าเช่า และหนี้เงินประกันตามสัดส่วน" />

      {usage === "RENTAL" && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">สัญญาเช่าปัจจุบัน</h2>
          <p className="text-xs text-slate-500">ถ้ายังไม่มีผู้เช่า ให้เลือกการใช้งานเป็น &ldquo;ว่าง&rdquo; แล้วเพิ่มสัญญาภายหลัง</p>
          <LeaseFields banks={banks} goLive={goLive} currency={currency} />
        </section>
      )}

      {state.error && <p className="text-sm text-red-600">{state.error}{state.created && <> · <Link href={state.created} className="underline">เปิดหน้าทรัพย์สิน</Link></>}</p>}
      {blocked && <p className="text-sm text-red-600">เพิ่มทรัพย์สินที่มีอยู่ก่อน Go-live ได้เฉพาะ ADMIN</p>}
      <div className="flex gap-3">
        <button disabled={pending || !!state.created || blocked} className="rounded-md bg-blue-600 px-5 py-2 text-sm text-white disabled:opacity-50">
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <Link href="/property" className="rounded-md border border-slate-300 px-5 py-2 text-sm">ยกเลิก</Link>
      </div>
    </form>
  );
}
