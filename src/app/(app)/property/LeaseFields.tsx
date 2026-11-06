"use client";

import { useState } from "react";
import { FREQ_LABEL, PRORATE_BASIS_LABEL, UTILITIES_BILLING_LABEL, money, thDate } from "@/lib/format";
import { firstRentCycle, nextDay, termEnd, termMonths } from "@/lib/lease";
import { CurrencySelect } from "@/components/CurrencyContext";
import LeaseContractFields, { type LeaseDetail, type LeaseDetailOptions } from "./LeaseContractFields";
import BankOptions from "@/components/BankOptions";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export type Bank = { asset_id: string; name: string; currency: string };
export type CarryOption = { id: string; label: string; deposit: number; currency: string };
/** สัญญาเดิมของทรัพย์สินนี้ (ต่อสัญญา → ดึงข้อมูลมาเป็นค่าตั้งต้น) */
export type LeasePrefill = Partial<LeaseDetail> & {
  id: string; label: string; unit_label: string | null; tenant_name: string; start_date: string; end_date: string;
  terminated_date: string | null; rent_amount: number; rent_currency: string; payment_frequency: string; payment_due_day: number | null;
  rent_to_asset_id: string | null; utilities_billing: string | null; deposit_months: number | null; prorate_basis: string | null;
};
export const DEPOSIT_MONTHS_DEFAULT = 2;
const num = (v: string) => Number(v.replace(/,/g, "")) || 0;

/**
 * ช่องกรอกสัญญาเช่า (ชื่อ input ขึ้นต้นด้วย lease_)
 *   อายุสัญญา (ปี / เดือน) ↔ วันสิ้นสุด คำนวณให้กันทั้งสองทาง · เงินประกัน = ค่าเช่า × จำนวนเดือน (แก้ยอดเองได้)
 *   ต่อสัญญา: เลือกสัญญาเดิม → ดึงผู้เช่า ค่าเช่า บัญชี รายละเอียดสัญญามาให้ · เริ่มวันถัดจากสัญญาเดิม อายุเท่าเดิม
 *     ยกเงินประกันได้เฉพาะตอนต่อสัญญา และยกจากฉบับที่เลือกเท่านั้น (สัญญาใหม่กรอกเอง = ไม่ยก · ตกลง 6 พ.ย. 2026)
 *   งวดแรก: แสดงตัวอย่างตามวันเริ่ม / วันจ่าย / วิธีคิดวันเศษ (สูตรจริง = private.lease_cycles)
 *   detail = ส่วนรายละเอียดสำหรับพิมพ์สัญญา (ไม่ส่ง = ไม่แสดง เช่นฟอร์มเพิ่มทรัพย์สินใหม่ → กรอกทีหลังที่ปุ่ม "รายละเอียดสัญญา")
 */
export default function LeaseFields({ banks, goLive, currency = "THB", carryOptions = [], defaultStart, renewals = [], detail, initialFrom }: {
  banks: Bank[]; goLive: string; currency?: string; carryOptions?: CarryOption[]; defaultStart?: string;
  renewals?: LeasePrefill[]; detail?: { opt: LeaseDetailOptions; canSensitive: boolean };
  /** ปุ่ม "ต่อสัญญา" บนการ์ด → เลือกสัญญาเดิมไว้ให้ */ initialFrom?: string;
}) {
  const [fromId, setFromId] = useState(initialFrom ?? "");
  const from = renewals.find((r) => r.id === fromId);
  return (
    <div className="space-y-4">
      {renewals.length > 0 && (
        <label className={label}>ต่อจากสัญญาเดิม (ดึงข้อมูลมาให้ แก้ได้)
          <select name="lease_renew_from" value={fromId} onChange={(e) => setFromId(e.target.value)} className={input}>
            <option value="">— สัญญาใหม่ (กรอกเอง) —</option>
            {renewals.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
      )}
      <Inner key={fromId || "new"} p={from} banks={banks} goLive={goLive} currency={currency} carryOptions={carryOptions}
        defaultStart={defaultStart} detail={detail} />
    </div>
  );
}

function Inner({ p, banks, goLive, currency, carryOptions, defaultStart, detail }: {
  p?: LeasePrefill; banks: Bank[]; goLive: string; currency: string; carryOptions: CarryOption[]; defaultStart?: string;
  detail?: { opt: LeaseDetailOptions; canSensitive: boolean };
}) {
  const prevEnd = p ? (p.terminated_date ?? p.end_date) : null;
  const prevTerm = p ? termMonths(p.start_date, p.end_date) : 0;
  const start0 = prevEnd ? nextDay(prevEnd) : (defaultStart ?? "");
  const [start, setStart] = useState(start0);
  const [term, setTerm] = useState({ y: prevTerm ? String(Math.floor(prevTerm / 12)) : "", m: prevTerm ? String(prevTerm % 12) : "" });
  const [end, setEnd] = useState(prevTerm ? termEnd(start0, prevTerm) : "");
  const [rent, setRent] = useState(p ? money(p.rent_amount) : "");
  const [depMonths, setDepMonths] = useState(String(p?.deposit_months ?? DEPOSIT_MONTHS_DEFAULT));
  const [deposit, setDeposit] = useState<string | null>(null);   // null = คำนวณจากค่าเช่า × เดือน
  const [recvDate, setRecvDate] = useState("");
  const carryFrom = p ? carryOptions.find((c) => c.id === p.id) : undefined;
  const [carry, setCarry] = useState(!!carryFrom);
  const carried = carry ? carryFrom : undefined;
  const [freq, setFreq] = useState(p?.payment_frequency ?? "MONTHLY");
  const [dueDay, setDueDay] = useState(p?.payment_due_day ? String(p.payment_due_day) : "");
  const [basis, setBasis] = useState(p?.prorate_basis ?? "ACTUAL");
  const step = freq === "MONTHLY" ? 1 : freq === "QUARTERLY" ? 3 : freq === "YEARLY" ? 12 : 0;
  const first = step && start && num(rent) > 0 ? firstRentCycle(start, num(dueDay) || null, num(rent), basis, step) : null;
  const effRecv = carried ? start : (recvDate || start);
  const beforeGoLive = !!effRecv && effRecv < goLive;
  const autoDeposit = num(rent) * num(depMonths);
  const depShown = deposit ?? (autoDeposit > 0 ? money(autoDeposit) : "");
  const extra = num(depShown) - (carried?.deposit ?? 0);

  const setTermPart = (k: "y" | "m", v: string) => {
    const t = { ...term, [k]: v };
    setTerm(t);
    const months = num(t.y) * 12 + num(t.m);
    if (start && months > 0) setEnd(termEnd(start, months));
  };
  const onStart = (v: string) => {
    setStart(v);
    const months = num(term.y) * 12 + num(term.m);
    if (v && months > 0) setEnd(termEnd(v, months));
  };
  const onEnd = (v: string) => {
    setEnd(v);
    if (start && v > start) { const m = termMonths(start, v); setTerm({ y: String(Math.floor(m / 12)), m: String(m % 12) }); }
  };
  const termOk = start && end && end > start && termEnd(start, termMonths(start, end)) === end;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className={label}>ชื่อผู้เช่า *<input name="lease_tenant_name" required defaultValue={p?.tenant_name ?? ""} className={input} /></label>
      <label className={label}>ห้อง / ส่วนที่เช่า<input name="lease_unit_label" defaultValue={p?.unit_label ?? ""} placeholder="เช่น ห้อง 502 · ชั้น 1" className={input} /></label>
      <label className={label}>วันเริ่มสัญญา *
        <input name="lease_start_date" type="date" required value={start} onChange={(e) => onStart(e.target.value)} className={input} />
      </label>
      <div className={label}>อายุสัญญา
        <div className="mt-1 flex items-center gap-2">
          <input type="number" min={0} max={99} value={term.y} onChange={(e) => setTermPart("y", e.target.value)} aria-label="ปี"
            className="w-20 rounded-md border border-slate-300 px-3 py-2 text-right text-sm" /> ปี
          <input type="number" min={0} max={11} value={term.m} onChange={(e) => setTermPart("m", e.target.value)} aria-label="เดือน"
            className="w-20 rounded-md border border-slate-300 px-3 py-2 text-right text-sm" /> เดือน
        </div>
        <span className="mt-1 block text-xs text-slate-500">ใส่อายุ → คำนวณวันสิ้นสุดให้ · ใส่วันสิ้นสุด → คำนวณอายุให้</span>
      </div>
      <label className={label}>วันสิ้นสุดสัญญา *
        <input name="lease_end_date" type="date" required min={start || undefined} value={end} onChange={(e) => onEnd(e.target.value)} className={input} />
        {start && end > start && !termOk && <span className="mt-1 block text-xs text-amber-700">ไม่ครบเดือนพอดี (อายุ {term.y || 0} ปี {term.m || 0} เดือน กับอีกบางวัน)</span>}
      </label>
      <label className={label}>ค่าเช่าต่องวด *
        <input name="lease_rent_amount" required inputMode="decimal" defaultValue={rent} onInput={(e) => setRent(e.currentTarget.value)} className={input} /></label>
      <label className={label}>สกุลเงินค่าเช่า
        <CurrencySelect name="lease_rent_currency" defaultValue={p?.rent_currency ?? currency} className={input} />
      </label>
      <label className={label}>งวดการจ่าย
        <select name="lease_payment_frequency" value={freq} onChange={(e) => setFreq(e.target.value)} className={input}>
          {Object.entries(FREQ_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className={label}>ครบกำหนดจ่ายทุกวันที่
        <input name="lease_payment_due_day" type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)}
          placeholder={start ? `ว่าง = วันที่ ${Number(start.slice(8, 10))} (ตรงวันเริ่มสัญญา)` : "ว่าง = วันเดียวกับวันเริ่มสัญญา"} className={input} />
      </label>
      <label className={label}>คิดค่าเช่าวันเศษ
        <select name="lease_prorate_basis" value={basis} onChange={(e) => setBasis(e.target.value)} className={input}>
          {Object.entries(PRORATE_BASIS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="mt-1 block text-xs text-slate-500">ใช้กับงวดแรก / งวดสุดท้ายที่ไม่เต็มรอบ (เข้าอยู่ไม่ตรงวันจ่าย · ออกก่อนครบรอบ)</span>
      </label>
      {first && (
        <p className="md:col-span-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-slate-700">
          งวดแรก {thDate(first.from)} – {thDate(first.to)}
          {first.full ? ` = ${money(first.amount)} (เต็มรอบ)` : ` (${first.days} วัน) = ${money(first.amount)} คิดตามจำนวนวัน`}
          {" "}ครบกำหนด {thDate(first.due)} (ภายใน 5 วันนับจากวันเริ่มสัญญา) · งวดต่อไปเต็มรอบ จ่ายล่วงหน้าทุกวันที่ {num(dueDay) || Number(start.slice(8, 10))}
        </p>
      )}
      <label className={label}>บัญชีรับค่าเช่า (ค่าตั้งต้นตอนบันทึกรับ · ใช้ในสัญญาที่พิมพ์)
        <select name="lease_rent_to_asset_id" defaultValue={p?.rent_to_asset_id ?? ""} className={input}>
          <option value="">— ไม่ระบุ (ใช้บัญชีที่รับครั้งล่าสุด) —</option>
          <BankOptions banks={banks} ccy />
        </select>
      </label>
      <label className={label}>ค่าน้ำ / ค่าไฟ
        <select name="lease_utilities_billing" defaultValue={p?.utilities_billing ?? ""} className={input}>
          <option value="">— ไม่ระบุ —</option>
          {Object.entries(UTILITIES_BILLING_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="mt-1 block text-xs text-slate-500">&ldquo;เราจ่ายแล้วเรียกเก็บ&rdquo; = ตอนบันทึกจ่ายค่าน้ำไฟจะติ๊ก &ldquo;เรียกเก็บผู้เช่า&rdquo; ให้</span>
      </label>
      <label className={label}>เลขที่สัญญา<input name="lease_contract_no" className={input} /></label>
      <label className={label}>หมายเหตุสัญญา<input name="lease_notes" className={input} /></label>

      <div className="md:col-span-2 space-y-3 rounded-lg bg-slate-50 p-4">
        <div className="text-sm font-medium text-slate-800">เงินประกัน (นับเป็นหนี้สินจนกว่าจะคืน)</div>
        {carryFrom && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="lease_carry" checked={carry} onChange={(e) => setCarry(e.target.checked)} className="mt-1" />
            <span>ต่อสัญญา: ยกเงินประกัน {money(carryFrom.deposit, carryFrom.currency)} จากสัญญาเดิมมาใช้ต่อ (สัญญาเดิมจะปิดเงินประกันในวันเริ่มสัญญาใหม่)</span>
          </label>
        )}
        {carried && <input type="hidden" name="lease_carried_from_lease_id" value={carried.id} />}
        <div className="grid gap-4 md:grid-cols-3">
          <label className={label}>จำนวนเดือนที่วางประกัน
            <input name="lease_deposit_months" inputMode="decimal" data-money="off" value={depMonths}
              onChange={(e) => { setDepMonths(e.target.value); setDeposit(null); }} className={input} />
            <span className="mt-1 block text-xs text-slate-500">เปลี่ยนเดือน → คำนวณยอดใหม่จากค่าเช่า</span>
          </label>
          <label className={label}>เงินประกันทั้งหมดของสัญญานี้
            <input name="lease_security_deposit" inputMode="decimal" value={depShown} onChange={(e) => setDeposit(e.target.value)}
              placeholder={carried ? `อย่างน้อย ${money(carried.deposit)}` : "ไม่มี = เว้นว่าง"} className={input} />
            {deposit != null && autoDeposit > 0 && num(deposit) !== autoDeposit && (
              <button type="button" onClick={() => setDeposit(null)} className="mt-1 text-xs text-blue-700 hover:underline">ใช้ค่าเช่า × {depMonths} เดือน = {money(autoDeposit)}</button>
            )}
          </label>
          {!carried && (
            <label className={label}>วันที่รับเงินประกันจริง (ไม่ระบุ = วันเริ่มสัญญา)
              <input name="lease_deposit_received_date" type="date" value={recvDate} onChange={(e) => setRecvDate(e.target.value)} className={input} />
            </label>
          )}
        </div>
        {extra > 0 && (beforeGoLive ? (
          <p className="text-xs text-slate-600">
            รับเงินประกันก่อน Go-live ({thDate(goLive)}) → เงินนี้อยู่ในยอดบัญชีตั้งต้นแล้ว ไม่ต้องเลือกบัญชี
          </p>
        ) : (
          <label className={label}>
            {carried ? `รับเงินประกันเพิ่ม ${money(extra)} เข้าบัญชี` : "รับเงินประกันเข้าบัญชี"}
            <select name="lease_deposit_to_asset_id" defaultValue="" className={input}>
              <option value="">— ไม่บันทึกเงินเข้าบัญชี —</option>
              <BankOptions banks={banks} ccy />
            </select>
            <span className="mt-1 block text-xs text-slate-500">ระบบสร้างรายการเงินเข้า &ldquo;รับเงินประกัน&rdquo; ให้ (ไม่ใช่รายได้)</span>
          </label>
        ))}
      </div>

      {detail && (
        <div className="md:col-span-2 space-y-3 rounded-lg border border-slate-200 p-4">
          <div className="text-sm font-medium text-slate-800">รายละเอียดสำหรับพิมพ์สัญญา <span className="font-normal text-slate-500">(ไม่บังคับ · ว่าง = เว้นเส้นให้เขียนเอง)</span></div>
          <LeaseContractFields v={p ? { ...p, tenant_id_last4: null } : undefined} opt={detail.opt} canSensitive={detail.canSensitive} idCopyFrom={p?.tenant_id_last4} />
        </div>
      )}
    </div>
  );
}
