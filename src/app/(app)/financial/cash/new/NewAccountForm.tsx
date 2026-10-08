"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createBankAccount, type ActionState } from "../actions";
import { ACCOUNT_TYPE_LABEL, CURRENCIES, thDate } from "@/lib/format";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export default function NewAccountForm(props: {
  persons: { id: string; name: string }[];
  goLive: string; openingDate: string; today: string; isSetup: boolean; isAdmin: boolean;
}) {
  const { persons, goLive, openingDate, today, isSetup, isAdmin } = props;
  const [state, action, pending] = useActionState<ActionState, FormData>(createBankAccount, {});
  // ช่วง SETUP: ค่าเริ่มต้น = บัญชีที่มีอยู่ก่อน Go-live (ยอดตั้งต้น) · หลัง LIVE: เฉพาะ ADMIN พร้อมเหตุผล
  const canOpening = isSetup || isAdmin;
  const [opening, setOpening] = useState(isSetup);
  const [shares, setShares] = useState<Record<string, string>>(
    persons.length === 1 ? { [persons[0].id]: "100" } : {},
  );
  const total = Object.values(shares).reduce((s, v) => s + (Number(v) || 0), 0);

  return (
    <form action={action} className="space-y-6">
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium text-slate-900">ข้อมูลบัญชี</h2>
        <label className={label}>ชื่อที่ใช้เรียกบัญชี *
          <input name="name" required placeholder="เช่น KBank ออมทรัพย์ (พ่อ)" className={input} />
        </label>
        <label className={label}>ธนาคาร *
          <input name="bank_name" required placeholder="เช่น KBank" className={input} />
        </label>
        <label className={label}>ประเภทบัญชี
          <select name="account_type" defaultValue="SAVING" className={input}>
            {Object.entries(ACCOUNT_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={label}>สกุลเงิน
          <select name="currency" defaultValue="THB" className={input}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className={label}>ชื่อบัญชี (ตามสมุด)
          <input name="account_name" className={input} />
        </label>
        <label className={label}>สาขา
          <input name="branch" className={input} />
        </label>
        <label className={label}>อัตราดอกเบี้ย (% ต่อปี)
          <input name="interest_rate" inputMode="decimal" className={input} />
        </label>
        <label className={label}>วันครบกำหนด (ฝากประจำ)
          <input name="maturity_date" type="date" className={input} />
        </label>
        <label className={`${label} md:col-span-2`}>เลขบัญชีเต็ม (ไม่บังคับ · ระบบเข้ารหัสเก็บ และแสดงเฉพาะ 4 ตัวท้าย)
          <input name="account_no" inputMode="numeric" autoComplete="off" placeholder="เช่น 123-4-56789-0" className={input} />
        </label>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">เจ้าของบัญชี</h2>
        {persons.length === 0 && <p className="text-sm text-amber-700">ยังไม่มีสมาชิกครอบครัว — เพิ่มที่ Family &amp; Users ก่อน</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {persons.map((p) => (
            <label key={p.id} className="flex items-center gap-3 text-sm">
              <span className="w-40 truncate">{p.name}</span>
              <input name={`owner_${p.id}`} inputMode="decimal" value={shares[p.id] ?? ""} placeholder="0"
                onChange={(e) => setShares({ ...shares, [p.id]: e.target.value })}
                className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-right" />
              <span>%</span>
            </label>
          ))}
        </div>
        <p className={`text-xs ${total === 100 ? "text-emerald-700" : total > 100 ? "text-red-600" : "text-amber-700"}`}>
          รวม {total}% {total < 100 && `· ยังไม่ระบุเจ้าของ ${100 - total}% (บันทึกได้ แต่ต้องครบก่อน Go-live)`}
          {total > 100 && "· เกิน 100%"}
        </p>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">ยอดคงเหลือแรก</h2>
        {canOpening && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="is_opening" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="mt-1" />
            <span>
              บัญชีมีอยู่ก่อน Go-live ({thDate(goLive)}) — ใช้เป็น <b>ยอดตั้งต้น</b> ณ สิ้นวัน {thDate(openingDate)}
              {!isSetup && <span className="block text-xs text-amber-700">ระบบ LIVE แล้ว: การเพิ่มยอดตั้งต้นต้องระบุเหตุผลในหมายเหตุ และถ้ามีเดือนที่ปิดแล้วต้อง Reopen ก่อน</span>}
            </span>
          </label>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <label className={label}>ยอดคงเหลือ *
            <input name="balance" required inputMode="decimal" placeholder="0.00" className={input} />
          </label>
          <label className={label}>ยอด ณ วันที่ *
            {opening
              ? <><input type="hidden" name="balance_date" value={openingDate} />
                  <input disabled value={thDate(openingDate)} className={`${input} bg-slate-50`} /></>
              : <input name="balance_date" type="date" required min={goLive} max={today} defaultValue={today} className={input} />}
          </label>
        </div>
        <label className={label}>หมายเหตุ {opening && !isSetup && "(เหตุผล · จำเป็น)"}
          <textarea name="notes" rows={2} required={opening && !isSetup} className={input} />
        </label>
      </section>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-3">
        <button disabled={pending || total > 100}
          className="rounded-md bg-blue-600 px-5 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
          {pending ? "กำลังบันทึก…" : "บันทึกบัญชี"}
        </button>
        <Link href="/financial/cash" className="rounded-md border border-slate-300 px-5 py-2 text-sm">ยกเลิก</Link>
      </div>
    </form>
  );
}
