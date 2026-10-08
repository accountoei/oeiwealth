"use client";

import { useActionState, useState } from "react";
import {
  addUtility, addValuation, createLease, recordRent, setUsage, settleDeposit, terminateLease, updatePropertyInfo,
  type ActionState,
} from "../actions";
import LeaseFields, { type Bank, type CarryOption } from "../LeaseFields";
import { PROPERTY_TYPE_LABEL, USAGE_LABEL, landParts, money } from "@/lib/format";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const sbtn = "rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50";
const link = "text-xs text-slate-700 underline";

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <p className="text-sm text-emerald-700">{s.ok}</p>;
  return null;
}

export function ValuationForm({ assetId, currency, today, minDate }:
  { assetId: string; currency: string; today: string; minDate: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addValuation, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <label className="text-sm">มูลค่า ({currency})
        <input name="value" required inputMode="decimal" className={`mt-1 block w-44 ${input}`} />
      </label>
      <label className="text-sm">ณ วันที่
        <input name="valuation_date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block ${input}`} />
      </label>
      <label className="text-sm">วิธีประเมิน
        <select name="valuation_method" defaultValue="USER_ESTIMATE" className={`mt-1 block ${input}`}>
          <option value="USER_ESTIMATE">ประมาณเอง</option>
          <option value="APPRAISAL">ผู้ประเมิน / ธนาคาร</option>
          <option value="LATEST_TRANSACTION">ราคาซื้อขายล่าสุด</option>
        </select>
      </label>
      <label className="text-sm flex-1 min-w-48">หมายเหตุ
        <input name="notes" className={`mt-1 block w-full ${input}`} />
      </label>
      <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกมูลค่า"}</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  );
}

export function SuggestVacant({ assetId }: { assetId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setUsage, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="usage_type" value="VACANT" />
      <span className="text-amber-800">ไม่มีสัญญาเช่าที่มีผลแล้ว — เปลี่ยนการใช้งานเป็น &ldquo;ว่าง&rdquo; หรือไม่?</span>
      <button disabled={pending} className={sbtn}>เปลี่ยนเป็น ว่าง</button>
      <Msg s={state} />
    </form>
  );
}

export function NewLeaseForm({ assetId, banks, goLive, currency, carryOptions, label }: {
  assetId: string; banks: Bank[]; goLive: string; currency: string; carryOptions: CarryOption[]; label: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(createLease, {});
  if (!open) return <button onClick={() => setOpen(true)} className={btn}>{label}</button>;
  return (
    <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="asset_id" value={assetId} />
      <h3 className="font-medium text-slate-900">สัญญาเช่าใหม่</h3>
      <p className="text-xs text-slate-500">ต่อสัญญา = สร้างสัญญาใหม่ (สัญญาเดิมไม่ถูกแก้ ประวัติค่าเช่าแต่ละช่วงยังอยู่) · การใช้งานจะเปลี่ยนเป็น &ldquo;ปล่อยเช่า&rdquo;</p>
      <LeaseFields banks={banks} goLive={goLive} currency={currency} carryOptions={carryOptions} />
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกสัญญา"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function RecordRentForm({ assetId, leaseId, period, expected, currency, banks, today }: {
  assetId: string; leaseId: string; period: string; expected: number; currency: string; banks: Bank[]; today: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(recordRent, {});
  if (state.ok) return <span className="text-xs text-emerald-700">{state.ok}</span>;
  if (!open) return <button onClick={() => setOpen(true)} className={link}>บันทึกรับ</button>;
  const sameCcy = banks.filter((b) => b.currency === currency);
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2 text-left">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="lease_id" value={leaseId} />
      <input type="hidden" name="income_period" value={period} />
      <input type="hidden" name="currency" value={currency} />
      <label className="text-xs">ยอดที่ได้รับ
        <input name="amount" required inputMode="decimal" defaultValue={String(expected)} className={`mt-1 block w-28 ${small}`} />
      </label>
      <label className="text-xs">วันที่รับ
        <input name="date" type="date" required defaultValue={today} max={today} className={`mt-1 block ${small}`} />
      </label>
      <label className="text-xs">เข้าบัญชี
        <select name="received_to_asset_id" defaultValue={sameCcy[0]?.asset_id ?? ""} className={`mt-1 block ${small}`}>
          <option value="">— ไม่ผ่านบัญชี (เงินสด) —</option>
          {sameCcy.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
        </select>
      </label>
      <button disabled={pending} className={sbtn}>บันทึก</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  );
}

export function TerminateLeaseForm({ assetId, leaseId, today, startDate }:
  { assetId: string; leaseId: string; today: string; startDate: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(terminateLease, {});
  if (!open) return <button onClick={() => setOpen(true)} className={link}>เลิกสัญญาก่อนกำหนด</button>;
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="lease_id" value={leaseId} />
      <label className="text-xs">วันที่เลิกสัญญา
        <input name="terminated_date" type="date" required defaultValue={today} min={startDate} className={`mt-1 block ${small}`} />
      </label>
      <button disabled={pending} className={sbtn}>ยืนยันเลิกสัญญา</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      <p className="w-full text-xs text-slate-500">ระบบหยุดคาดค่าเช่าหลังวันนี้ · เงินประกันยังเป็นหนี้จนกว่าจะบันทึกคืน</p>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  );
}

export function SettleDepositForm({ assetId, leaseId, deposit, currency, banks, minDate, today }: {
  assetId: string; leaseId: string; deposit: number; currency: string; banks: Bank[]; minDate: string; today: string;
}) {
  const [open, setOpen] = useState(false);
  const [refund, setRefund] = useState(String(deposit));
  const [asIncome, setAsIncome] = useState(true);
  const [state, action, pending] = useActionState<ActionState, FormData>(settleDeposit, {});
  const deduct = deposit - (Number(refund.replace(/,/g, "")) || 0);
  if (state.ok) return <p className="text-xs text-emerald-700">{state.ok}</p>;
  if (!open) return <button onClick={() => setOpen(true)} className={link}>คืน / หักเงินประกัน</button>;
  const sameCcy = banks.filter((b) => b.currency === currency);
  return (
    <form action={action} className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="lease_id" value={leaseId} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">ยอดที่คืนผู้เช่า (เต็ม {money(deposit, currency)})
          <input name="refunded_amount" required inputMode="decimal" value={refund} onChange={(e) => setRefund(e.target.value)}
            className={`mt-1 block w-32 ${small}`} />
        </label>
        <label className="text-xs">วันที่คืน
          <input name="settled_date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block ${small}`} />
        </label>
        <label className="text-xs">จ่ายคืนจากบัญชี
          <select name="refund_from_asset_id" defaultValue={sameCcy[0]?.asset_id ?? ""} className={`mt-1 block ${small}`}>
            <option value="">— เลือกบัญชี —</option>
            {sameCcy.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
          </select>
        </label>
      </div>
      {deduct > 0 && (
        <div className="space-y-2">
          <label className="block text-xs">เหตุผลที่หัก {money(deduct, currency)} (จำเป็น)
            <input name="deduction_reason" required placeholder="เช่น ค่าซ่อมผนัง" className={`mt-1 block w-full ${small}`} />
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" name="record_as_income" checked={asIncome} onChange={(e) => setAsIncome(e.target.checked)} className="mt-0.5" />
            <span>บันทึกส่วนที่หักเป็นรายได้อื่น (แนะนำ)</span>
          </label>
          {!asIncome && (
            <p className="text-xs text-amber-700">ถ้าไม่บันทึกเป็นรายได้: หนี้เงินประกันหายแต่เงินยังอยู่ในบัญชี → ความมั่งคั่งเพิ่มขึ้นเท่าส่วนที่หัก · ถ้ายังมีข้อพิพาท ให้รอก่อนจึงบันทึก</p>
          )}
        </div>
      )}
      {asIncome && <input type="hidden" name="record_as_income" value="on" />}
      <div className="flex items-center gap-2">
        <button disabled={pending} className={sbtn}>ยืนยัน</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      </div>
      <Msg s={state} />
    </form>
  );
}

type Info = { asset_id: string; name: string; notes: string | null; acquisition_date: string | null; acquisition_cost: number | null;
  property_type: string; usage_type: string; location_group: string | null; address: string | null;
  land_area_sq_wa: number | null; title_type: string | null; title_deed_no: string | null; land_no: string | null };

export function EditPropertyForm({ p }: { p: Info }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updatePropertyInfo, {});
  const f = "mt-1 block w-full " + input;
  const land = landParts(p.land_area_sq_wa);
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="asset_id" value={p.asset_id} />
      <label className="text-sm">ชื่อที่ใช้เรียก<input name="name" required defaultValue={p.name} className={f} /></label>
      <label className="text-sm">ประเภท
        <select name="property_type" defaultValue={p.property_type} className={f}>
          {Object.entries(PROPERTY_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="text-sm">การใช้งาน
        <select name="usage_type" defaultValue={p.usage_type} className={f}>
          {Object.entries(USAGE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="text-sm">กลุ่มทำเล<input name="location_group" defaultValue={p.location_group ?? ""} className={f} /></label>
      <label className="text-sm md:col-span-2">ที่อยู่<input name="address" defaultValue={p.address ?? ""} className={f} /></label>
      <div className="text-sm">เนื้อที่ (ไร่-งาน-ตารางวา)
        <div className="mt-1 flex gap-2">
          <input name="land_rai" inputMode="numeric" placeholder="ไร่" defaultValue={land.rai} className={`w-full ${input}`} />
          <input name="land_ngan" inputMode="numeric" placeholder="งาน" defaultValue={land.ngan} className={`w-full ${input}`} />
          <input name="land_wa" inputMode="decimal" placeholder="ตร.ว." defaultValue={land.wa} className={`w-full ${input}`} />
        </div>
      </div>
      <label className="text-sm">ประเภทเอกสารสิทธิ์<input name="title_type" defaultValue={p.title_type ?? ""} className={f} /></label>
      <label className="text-sm">เลขที่โฉนด<input name="title_deed_no" defaultValue={p.title_deed_no ?? ""} className={f} /></label>
      <label className="text-sm">เลขที่ดิน<input name="land_no" defaultValue={p.land_no ?? ""} className={f} /></label>
      <label className="text-sm">วันที่ได้มา<input name="acquisition_date" type="date" defaultValue={p.acquisition_date ?? ""} className={f} /></label>
      <label className="text-sm">ราคาที่ได้มา<input name="acquisition_cost" inputMode="decimal" defaultValue={p.acquisition_cost ?? ""} className={f} /></label>
      <label className="text-sm md:col-span-2">หมายเหตุ<input name="notes" defaultValue={p.notes ?? ""} className={f} /></label>
      <div className="md:col-span-2 flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกข้อมูล"}</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function UtilityForm({ assetId, propertyId }: { assetId: string; propertyId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(addUtility, {});
  if (!open) return <button onClick={() => setOpen(true)} className={link}>+ เพิ่มมิเตอร์ / บัญชีสาธารณูปโภค</button>;
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="property_id" value={propertyId} />
      <label className="text-xs">ประเภท
        <select name="utility_type" className={`mt-1 block ${small}`}>
          <option value="ELECTRICITY">ไฟฟ้า</option><option value="WATER">ประปา</option><option value="OTHER">อื่น ๆ</option>
        </select>
      </label>
      <label className="text-xs">ผู้ให้บริการ<input name="provider" placeholder="เช่น กฟน." className={`mt-1 block w-28 ${small}`} /></label>
      <label className="text-xs">เลขที่ผู้ใช้<input name="account_no" className={`mt-1 block w-32 ${small}`} /></label>
      <label className="text-xs">เลขมิเตอร์<input name="meter_no" className={`mt-1 block w-32 ${small}`} /></label>
      <label className="text-xs">หมายเหตุ<input name="notes" className={`mt-1 block w-32 ${small}`} /></label>
      <button disabled={pending} className={sbtn}>เพิ่ม</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ปิด</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  );
}
