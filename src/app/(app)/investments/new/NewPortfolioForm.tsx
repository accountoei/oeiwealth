"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createPortfolio, type ActionState } from "../actions";
import OwnerShares from "@/components/OwnerShares";
import { PORTFOLIO_TYPE_LABEL, thDate } from "@/lib/format";
import { CurrencySelect } from "@/components/CurrencyContext";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export default function NewPortfolioForm(props: {
  persons: { id: string; name: string }[]; goLive: string; openingDate: string; today: string; isSetup: boolean; isAdmin: boolean;
}) {
  const { persons, goLive, openingDate, today, isSetup, isAdmin } = props;
  const [state, action, pending] = useActionState<ActionState, FormData>(createPortfolio, {});
  const [opening, setOpening] = useState(isSetup);
  // หลัง Go-live: ซ่อนตัวเลือก "มีอยู่ก่อน Go-live" (ไม่ติ๊ก) · ADMIN กดลิงก์เล็กเพื่อเพิ่มรายการที่ตกหล่น
  const [late, setLate] = useState(false);
  const [currency, setCurrency] = useState("THB");

  return (
    <form action={action} className="space-y-6">
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium text-slate-900">ข้อมูลพอร์ต</h2>
        <label className={label}>ชื่อพอร์ต *<input name="name" required placeholder="เช่น หุ้นไทย KS" className={input} /></label>
        <label className={label}>สถาบัน / โบรกเกอร์ *<input name="institution" required placeholder="เช่น Kasikorn Securities" className={input} /></label>
        <label className={label}>ประเภท
          <select name="portfolio_type" defaultValue="BROKERAGE" className={input}>
            {Object.entries(PORTFOLIO_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={label}>สกุลเงินของพอร์ต
          <CurrencySelect name="currency" value={currency} onChange={setCurrency} className={input} />
          <span className="mt-1 block text-xs text-slate-500">ต้องตรงกับบัญชีธนาคารที่ใช้โอนเงินเข้า–ออก</span>
        </label>
        <label className={label}>วันที่เปิดพอร์ต<input name="start_date" type="date" max={today} className={input} /></label>
        <label className={label}>หมายเหตุ {opening && !isSetup && "(เหตุผล · จำเป็น)"}
          <input name="notes" required={opening && !isSetup} className={input} />
        </label>
      </section>

      <OwnerShares persons={persons} title="เจ้าของพอร์ต" hint="สัดส่วนกรรมสิทธิ์ · ใช้แบ่งมูลค่าพอร์ตและผลตอบแทนตามสัดส่วน" />

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">เงินฝากในพอร์ต</h2>
        {!isSetup && isAdmin && !late && (
          <button type="button" onClick={() => setLate(true)} className="text-left text-xs text-slate-400 underline hover:text-slate-600">เพิ่มรายการที่ตกหล่นก่อน Go-live (ADMIN)</button>
        )}
        {(isSetup || late) && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="is_opening" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="mt-1" />
            <span>
              พอร์ตมีอยู่ก่อน Go-live ({thDate(goLive)}) — ใส่เงินฝากคงเหลือ ณ สิ้นวัน {thDate(openingDate)} เป็นยอดตั้งต้น
              {!isSetup && <span className="block text-xs text-amber-700">ระบบ LIVE แล้ว: ต้องระบุเหตุผลในหมายเหตุ</span>}
            </span>
          </label>
        )}
        {opening ? (
          <div className="grid gap-4 md:grid-cols-2">
            <label className={label}>เงินฝากคงเหลือในพอร์ต ({currency})
              <input name="opening_cash" inputMode="decimal" defaultValue="0" className={input} />
            </label>
            {currency !== "THB" && (
              <label className={label}>FX ต้นทุนของเงินฝาก (บาทต่อ 1 {currency}) · ไม่ใส่ = ใช้อัตรา ธปท. ณ วันตั้งต้น
                <input name="opening_fx" inputMode="decimal" className={input} />
              </label>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">พอร์ตใหม่เริ่มที่เงินฝาก 0 · โอนเงินเข้าด้วยปุ่ม &ldquo;โอนเงิน&rdquo; ในหน้าพอร์ต</p>
        )}
        <p className="text-xs text-slate-500">หุ้น / กองทุนที่ถืออยู่ เพิ่มในหน้าพอร์ตหลังบันทึก</p>
      </section>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-5 py-2 text-sm text-white disabled:opacity-50">
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <Link href="/investments" className="rounded-md border border-slate-300 px-5 py-2 text-sm">ยกเลิก</Link>
      </div>
    </form>
  );
}
