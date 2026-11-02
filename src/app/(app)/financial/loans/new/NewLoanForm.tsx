"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createLoan, type ActionState } from "../actions";
import OwnerShares from "@/components/OwnerShares";
import { money, thDate } from "@/lib/format";
import { CurrencySelect } from "@/components/CurrencyContext";
import BalanceGuard from "@/components/BalanceGuard";
import { numOrZero } from "@/lib/format";
import NewLoanSchedule, { type NewSched } from "./NewLoanSchedule";
import { openingFromSchedule } from "@/lib/loan-schedule";
import ContractParties, { type PartyOptions } from "../ContractParties";
import PartyPicker, { type BorrowerBank } from "@/components/PartyPicker";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export default function NewLoanForm(props: {
  persons: { id: string; name: string }[]; banks: { asset_id: string; name: string; currency: string }[];
  goLive: string; openingDate: string; today: string; isSetup: boolean; isAdmin: boolean;
  /** ADMIN / EDITOR ตั้งตารางผ่อนได้ (ฐานข้อมูลบังคับ) */
  canSchedule: boolean;
  partyOpt: PartyOptions;
  borrowerBanks: BorrowerBank[];
}) {
  const { persons, banks, goLive, openingDate, today, isSetup, isAdmin, canSchedule, partyOpt, borrowerBanks } = props;
  // ช่องที่ตารางผ่อนใช้ (ส่วน "ตั้งตารางผ่อนเลย" ด้านล่าง)
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("");
  const [loanDate, setLoanDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(createLoan, {});
  const [opening, setOpening] = useState(isSetup);
  const [currency, setCurrency] = useState("THB");
  // ตารางผ่อน (ส่วน "ตั้งตารางผ่อนเลย") → ยอดตั้งต้นจากตาราง = เงินต้นตามสัญญา − เงินต้นงวดที่ครบกำหนดถึงวันตั้งต้น (ตกลง 2 พ.ย. 2026)
  const [sched, setSched] = useState<NewSched>({ lines: [], errors: [] });
  const [openOut, setOpenOut] = useState("");
  const fromSched = opening && sched.lines.length && numOrZero(principal) > 0 ? openingFromSchedule(numOrZero(principal), sched.lines, openingDate) : null;
  const openingValue = openOut.trim() ? openOut : fromSched ? fromSched.outstanding.toFixed(2) : "";
  return (
    <form action={action} className="space-y-6">
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium text-slate-900">ข้อมูลเงินกู้</h2>
        <label className={label}>ชื่อรายการ *<input name="name" required placeholder="เช่น ให้น้องยืมซื้อรถ" className={input} /></label>
        <PartyPicker kindLabel="ผู้กู้เป็น" label="ชื่อผู้กู้" nameField="borrower_name" personField="borrower_person_id" businessField="borrower_business_id" required
          persons={persons} businesses={partyOpt.businesses.map((b) => ({ id: b.asset_id, name: b.company_name }))} placeholder="ชื่อ-นามสกุลเต็ม พร้อมคำนำหน้า"
          bankField="borrower_bank_asset_id" banks={borrowerBanks} />
        <label className={label}>เบอร์ติดต่อผู้กู้<input name="borrower_phone" type="tel" maxLength={50} className={input} /></label>
        <label className={label}>เงินต้นตามสัญญา *<input name="principal" required inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} className={input} /></label>
        <label className={label}>อัตราดอกเบี้ย (% ต่อปี)<input name="interest_rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={input} /></label>
        <label className={label}>วันที่ให้กู้<input name="loan_date" type="date" max={today} value={loanDate} onChange={(e) => setLoanDate(e.target.value)} className={input} /></label>
        <label className={label}>ครบกำหนดคืน<input name="due_date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={input} /></label>
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
            <label className={label}>เงินต้นคงเหลือ ณ วันตั้งต้น
              <input value={openOut} onChange={(e) => setOpenOut(e.target.value)} inputMode="decimal"
                placeholder={fromSched ? `${money(fromSched.outstanding)} (จากตาราง)` : "ไม่ใส่ = เท่าเงินต้น"} className={input} />
              <input type="hidden" name="opening_outstanding" value={openingValue} />
              {fromSched ? (
                <span className={`mt-1 block text-xs ${fromSched.outstanding < 0 ? "text-red-600" : "text-slate-500"}`}>
                  {openOut.trim() ? "ตามตารางผ่อน" : "ว่าง = ใช้ยอดจากตารางผ่อน"}: {money(numOrZero(principal))} − เงินต้น {fromSched.count} งวดที่ครบกำหนดถึง {thDate(openingDate)} {money(fromSched.paid)} = <b>{money(fromSched.outstanding)}</b>
                  {fromSched.outstanding < 0 && " — เงินต้นงวดก่อน Go-live เกินเงินต้นตามสัญญา"}
                  {openOut.trim() && Math.abs(numOrZero(openOut) - fromSched.outstanding) > 0.005 &&
                    <span className="block text-amber-700">ใส่ต่างจากตาราง: งวดก่อน Go-live ที่ยังไม่ได้รับจะขึ้น &ldquo;เลยกำหนด&rdquo; (ใช้เมื่อผู้กู้ค้างชำระจริง) ·{" "}
                      <button type="button" onClick={() => setOpenOut("")} className="text-blue-700 underline">ใช้ยอดจากตาราง</button></span>}
                </span>
              ) : <span className="mt-1 block text-xs text-slate-500">ตั้งตารางผ่อนด้านล่างแล้ว ระบบเติมยอดนี้จากตารางให้</span>}
            </label>
            <label className={label}>สกุลเงิน
              <CurrencySelect name="currency" defaultValue="THB" onChange={setCurrency} className={input} />
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

      <details className="group rounded-xl border border-slate-200 bg-white p-5">
        <summary className="cursor-pointer font-medium text-slate-900">รายละเอียดสำหรับพิมพ์สัญญา <span className="text-sm font-normal text-slate-500">(ไม่บังคับ · ที่อยู่ เลขบัตร ผู้ค้ำ พยาน สถานที่ บัญชีรับชำระ)</span></summary>
        <div className="mt-4"><ContractParties opt={partyOpt} canSensitive={canSchedule} /></div>
      </details>

      {canSchedule && <NewLoanSchedule amount={numOrZero(principal)} ratePct={numOrZero(rate)} loanDate={loanDate} dueDate={dueDate} today={today}
        currency={currency} openingDate={opening ? openingDate : undefined} onChange={setSched} />}

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {sched.errors.length > 0 && <p className="text-sm text-red-600">ตารางผ่อน: {sched.errors[0]}{sched.errors.length > 1 ? ` (และอีก ${sched.errors.length - 1} จุด)` : ""}</p>}
      <div className="flex gap-3">
        <button disabled={pending || sched.errors.length > 0} className="rounded-md bg-blue-600 px-5 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <BalanceGuard bank="disburse_from_asset_id" amount="principal" date="disburse_date" />
        <Link href="/financial/loans" className="rounded-md border border-slate-300 px-5 py-2 text-sm">ยกเลิก</Link>
      </div>
    </form>
  );
}
