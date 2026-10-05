"use client";

import { useState } from "react";
import { CURRENCIES, FREQ_LABEL, money, thDate } from "@/lib/format";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export type Bank = { asset_id: string; name: string; currency: string };
export type CarryOption = { id: string; label: string; deposit: number; currency: string };

/** ช่องกรอกสัญญาเช่า (ชื่อ input ขึ้นต้นด้วย lease_) */
export default function LeaseFields({ banks, goLive, currency = "THB", carryOptions = [], defaultStart }: {
  banks: Bank[]; goLive: string; currency?: string; carryOptions?: CarryOption[]; defaultStart?: string;
}) {
  const [start, setStart] = useState(defaultStart ?? "");
  const [recvDate, setRecvDate] = useState("");
  const [deposit, setDeposit] = useState("");
  const [carry, setCarry] = useState(carryOptions.length > 0);
  const [carryId, setCarryId] = useState(carryOptions[0]?.id ?? "");
  const carried = carry ? carryOptions.find((c) => c.id === carryId) : undefined;
  const effRecv = carried ? start : (recvDate || start);
  const beforeGoLive = !!effRecv && effRecv < goLive;
  const extra = (Number(deposit.replace(/,/g, "")) || 0) - (carried?.deposit ?? 0);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className={label}>ชื่อผู้เช่า *<input name="lease_tenant_name" required className={input} /></label>
      <label className={label}>ห้อง / ส่วนที่เช่า<input name="lease_unit_label" placeholder="เช่น ห้อง 502 · ชั้น 1" className={input} /></label>
      <label className={label}>วันเริ่มสัญญา *
        <input name="lease_start_date" type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={input} />
      </label>
      <label className={label}>วันสิ้นสุดสัญญา *<input name="lease_end_date" type="date" required min={start || undefined} className={input} /></label>
      <label className={label}>ค่าเช่าต่องวด *<input name="lease_rent_amount" required inputMode="decimal" className={input} /></label>
      <label className={label}>สกุลเงินค่าเช่า
        <select name="lease_rent_currency" defaultValue={currency} className={input}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
      </label>
      <label className={label}>งวดการจ่าย
        <select name="lease_payment_frequency" defaultValue="MONTHLY" className={input}>
          {Object.entries(FREQ_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className={label}>ครบกำหนดจ่ายทุกวันที่<input name="lease_payment_due_day" type="number" min={1} max={31} className={input} /></label>
      <label className={label}>เลขที่สัญญา<input name="lease_contract_no" className={input} /></label>
      <label className={label}>หมายเหตุสัญญา<input name="lease_notes" className={input} /></label>

      <div className="md:col-span-2 space-y-3 rounded-lg bg-slate-50 p-4">
        <div className="text-sm font-medium text-slate-800">เงินประกัน (นับเป็นหนี้สินจนกว่าจะคืน)</div>
        {carryOptions.length > 0 && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="lease_carry" checked={carry} onChange={(e) => setCarry(e.target.checked)} className="mt-1" />
            <span>ต่อสัญญา: ยกเงินประกันจากสัญญาเดิมมาใช้ต่อ (สัญญาเดิมจะปิดเงินประกันในวันเริ่มสัญญาใหม่)</span>
          </label>
        )}
        {carry && carryOptions.length > 0 && (
          <label className={label}>ยกมาจากสัญญา
            <select name="lease_carried_from_lease_id" value={carryId} onChange={(e) => setCarryId(e.target.value)} className={input}>
              {carryOptions.map((c) => <option key={c.id} value={c.id}>{c.label} · {money(c.deposit, c.currency)}</option>)}
            </select>
          </label>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <label className={label}>เงินประกันทั้งหมดของสัญญานี้
            <input name="lease_security_deposit" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)}
              placeholder={carried ? `อย่างน้อย ${money(carried.deposit)}` : "ไม่มี = เว้นว่าง"} className={input} />
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
              {banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">ระบบสร้างรายการเงินเข้า &ldquo;รับเงินประกัน&rdquo; ให้ (ไม่ใช่รายได้)</span>
          </label>
        ))}
      </div>
    </div>
  );
}
