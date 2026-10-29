"use client";

import { useActionState, useState } from "react";
import ComponentTable from "../ComponentTable";
import type { Component } from "../components";
import { useActionSlot } from "@/components/ActionBar";
import {
  addUtility, addValuation, createLease, receiveUtilityCharge, recordPropertyCost, recordRent, setUsage, settleDeposit, terminateLease,
  updatePropertyInfo, type ActionState,
} from "../actions";
import LeaseFields, { type Bank, type CarryOption } from "../LeaseFields";
import { ENCUMBRANCE_LABEL, PROPERTY_TYPE_LABEL, ROW_BTN, TH_MONTHS, USAGE_LABEL, UTIL_LABEL, money } from "@/lib/format";
import { DismissCostForm } from "@/app/(app)/income-expenses/forms";
import BalanceGuard from "@/components/BalanceGuard";
import { StatusSlot } from "@/components/StatusSelect";

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
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(createLease, {});
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(btn)}>{label}</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="asset_id" value={assetId} />
      <h3 className="font-medium text-slate-900">สัญญาเช่าใหม่</h3>
      <p className="text-xs text-slate-500">ต่อสัญญา = สร้างสัญญาใหม่ (สัญญาเดิมไม่ถูกแก้ ประวัติค่าเช่าแต่ละช่วงยังอยู่) · การใช้งานจะเปลี่ยนเป็น &ldquo;ปล่อยเช่า&rdquo;</p>
      <LeaseFields banks={banks} goLive={goLive} currency={currency} carryOptions={carryOptions} />
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกสัญญา"}</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}

export function RecordRentForm({ assetId, leaseId, period, expected, currency, banks, today, defaultBank }: {
  assetId: string; leaseId: string; period: string; expected: number; currency: string; banks: Bank[]; today: string;
  /** บัญชีรับค่าเช่าที่ตั้งไว้ในสัญญา (หรือบัญชีที่รับครั้งล่าสุด) */ defaultBank?: string;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(recordRent, {});
  if (state.ok) return <span className="text-xs text-emerald-700">{state.ok}</span>;
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(link)}>บันทึกรับ</button>;
  if (!open) return trigger;
  const sameCcy = banks.filter((b) => b.currency === currency);
  return present(trigger, (
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
        <select name="received_to_asset_id" defaultValue={sameCcy.find((b) => b.asset_id === defaultBank)?.asset_id ?? sameCcy[0]?.asset_id ?? ""} className={`mt-1 block ${small}`}>
          <option value="">— ไม่ผ่านบัญชี (เงินสด) —</option>
          {sameCcy.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
        </select>
      </label>
      <button disabled={pending} className={sbtn}>บันทึก</button>
      <button type="button" data-close onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  ));
}

export function TerminateLeaseForm({ assetId, leaseId, today, startDate }:
  { assetId: string; leaseId: string; today: string; startDate: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(terminateLease, {});
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(link)}>เลิกสัญญาก่อนกำหนด</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="lease_id" value={leaseId} />
      <label className="text-xs">วันที่เลิกสัญญา
        <input name="terminated_date" type="date" required defaultValue={today} min={startDate} className={`mt-1 block ${small}`} />
      </label>
      <button disabled={pending} className={sbtn}>ยืนยันเลิกสัญญา</button>
      <button type="button" data-close onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      <p className="w-full text-xs text-slate-500">ระบบหยุดคาดค่าเช่าหลังวันนี้ · เงินประกันยังเป็นหนี้จนกว่าจะบันทึกคืน</p>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  ));
}

export function SettleDepositForm({ assetId, leaseId, deposit, currency, banks, minDate, today }: {
  assetId: string; leaseId: string; deposit: number; currency: string; banks: Bank[]; minDate: string; today: string;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [refund, setRefund] = useState(String(deposit));
  const [asIncome, setAsIncome] = useState(true);
  const [state, action, pending] = useActionState<ActionState, FormData>(settleDeposit, {});
  const deduct = deposit - (Number(refund.replace(/,/g, "")) || 0);
  if (state.ok) return <p className="text-xs text-emerald-700">{state.ok}</p>;
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(link)}>คืน / หักเงินประกัน</button>;
  if (!open) return trigger;
  const sameCcy = banks.filter((b) => b.currency === currency);
  return present(trigger, (
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
        <BalanceGuard bank="refund_from_asset_id" amount="refunded_amount" date="settled_date" />
        <button type="button" data-close onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      </div>
      <Msg s={state} />
    </form>
  ));
}

type Info = { asset_id: string; name: string; notes: string | null; acquisition_date: string | null; acquisition_cost: number | null;
  property_type: string; usage_type: string; location_group: string | null; address: string | null;
  land_area_sq_wa: number | null; title_type: string | null; title_deed_no: string | null; land_no: string | null;
  deed_book: string | null; deed_page: string | null; map_sheet: string | null; survey_page: string | null;
  subdistrict: string | null; district: string | null; province: string | null;
  map_url?: string | null; latitude?: number | null; longitude?: number | null;
  vacant_since?: string | null; vacant_plan?: string | null; vacant_plan_date?: string | null;
  encumbrance_type?: string | null; encumbrance_details?: string | null; opportunity_rate_pct?: number | null;
  acq_building_cost?: number | null; acq_building_years?: number | null };

/** แก้ข้อมูลทรัพย์สิน + ตารางส่วนประกอบ (ข้อมูล · ต้นทุน · มูลค่ารายแถว) ในฟอร์มเดียว ปุ่มบันทึกปุ่มเดียว (ตกลง 29 ต.ค. 2026) */
export function EditPropertyForm({ p, components, latest, currency, currentValue, today, minDate }: {
  p: Info; components: Component[]; latest: Record<string, number>; currency: string; currentValue: number | null; today: string; minDate: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updatePropertyInfo, {});
  const [usage, setUsage] = useState(p.usage_type);
  const [enc, setEnc] = useState(p.encumbrance_type ?? "");
  const f = "mt-1 block w-full " + input;
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
        <select name="usage_type" value={usage} onChange={(e) => setUsage(e.target.value)} className={f}>
          {Object.entries(USAGE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {usage === "VACANT" && (
        <div className="grid gap-3 rounded-lg bg-amber-50 p-3 md:col-span-2 md:grid-cols-3">
          <label className="text-sm">ว่างตั้งแต่
            <input name="vacant_since" type="date" defaultValue={p.vacant_since ?? ""} max={new Date().toISOString().slice(0, 10)} className={f} />
            <span className="text-xs text-slate-500">{p.usage_type === "VACANT" ? "แก้ย้อนได้" : "เว้นว่าง = วันนี้"}</span></label>
          <label className="text-sm md:col-span-2">แผน / โครงการ
            <input name="vacant_plan" defaultValue={p.vacant_plan ?? ""} placeholder="เช่น สร้างบ้านให้ลูก · รอขาย" className={f} /></label>
          <label className="text-sm">กำหนดเริ่ม (ไม่บังคับ)
            <input name="vacant_plan_date" type="date" defaultValue={p.vacant_plan_date ?? ""} className={f} /></label>
          <p className="self-end text-xs text-slate-500 md:col-span-2">ว่างต่อเนื่องเกิน 3 ปี ภาษีที่ดินอาจสูงขึ้น ระบบจะเตือนล่วงหน้า 6 เดือน · เปลี่ยนเป็นการใช้งานอื่นแล้ว ระบบเก็บช่วงที่ว่างไว้เป็นประวัติ</p>
        </div>
      )}
      <label className="text-sm">กลุ่มทำเล<input name="location_group" defaultValue={p.location_group ?? ""} className={f} /></label>
      <label className="text-sm md:col-span-2">ที่อยู่<input name="address" defaultValue={p.address ?? ""} className={f} /></label>
      <label className="text-sm">ลิงก์ Google Maps
        <input name="map_url" type="url" defaultValue={p.map_url ?? ""} placeholder="https://maps.app.goo.gl/…" className={f} />
        <span className="text-xs text-slate-500">Google Maps → แชร์ → คัดลอกลิงก์</span></label>
      <label className="text-sm">พิกัด (ละติจูด, ลองจิจูด)
        <input name="coords" data-plain defaultValue={p.latitude != null && p.longitude != null ? `${Number(p.latitude)}, ${Number(p.longitude)}` : ""}
          placeholder="เช่น 13.7563, 100.5018" className={f} />
        <span className="text-xs text-slate-500">คลิกขวาที่จุดใน Google Maps → กดตัวเลขบรรทัดบน (คัดลอกพิกัด) · มีพิกัดจะแสดงแผนที่เล็ก</span></label>
      <div className="grid gap-3 md:col-span-2 md:grid-cols-3">
        <label className="text-sm">ตำบล / แขวง<input name="subdistrict" defaultValue={p.subdistrict ?? ""} className={f} /></label>
        <label className="text-sm">อำเภอ / เขต<input name="district" defaultValue={p.district ?? ""} className={f} /></label>
        <label className="text-sm">จังหวัด<input name="province" defaultValue={p.province ?? ""} className={f} /></label>
      </div>
      <label className="text-sm">ภาระผูกพัน
        <select name="encumbrance_type" value={enc} onChange={(e) => setEnc(e.target.value)} className={f}>
          <option value="">— ยังไม่ระบุ —</option>
          {Object.entries(ENCUMBRANCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
      <label className="text-sm">รายละเอียดภาระผูกพัน
        <input name="encumbrance_details" defaultValue={p.encumbrance_details ?? ""} disabled={!enc || enc === "NONE"}
          placeholder="เช่น ทางเข้าออกกว้าง 4 ม. ให้แปลงข้างเคียง" className={`${f} disabled:bg-slate-50`} /></label>
      <div className="space-y-1 md:col-span-2">
        <h3 className="text-sm font-medium text-slate-800">ส่วนประกอบ · ต้นทุน · มูลค่า</h3>
        <ComponentTable mode="edit" currency={currency} initial={components} latest={latest} acquisitionCost={p.acquisition_cost}
          currentValue={currentValue} today={today} minDate={minDate} />
      </div>
      <label className="text-sm">วันที่ได้มา<input name="acquisition_date" type="date" defaultValue={p.acquisition_date ?? ""} className={f} />
        <span className="text-xs text-slate-500">แถวที่ไม่ได้ใส่วันที่ได้มา ใช้วันที่นี้</span></label>
      <label className="text-sm">อัตราดอกเบี้ยเทียบของแปลงนี้ (% ต่อปี)
        <input name="opportunity_rate_pct" inputMode="decimal" data-money="off" defaultValue={p.opportunity_rate_pct ?? ""} placeholder="ว่าง = ใช้อัตราครอบครัว" className={f} />
        <span className="text-xs text-slate-500">ใช้คิด &ldquo;ราคาขายขั้นต่ำที่คุ้ม&rdquo; (ไม่นับใน Net Worth) · อัตราครอบครัวตั้งที่ Settings › FX &amp; Prices</span></label>
      <label className="text-sm md:col-span-2">หมายเหตุ<input name="notes" defaultValue={p.notes ?? ""} className={f} /></label>
      <div className="md:col-span-2 flex flex-wrap items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกข้อมูล"}</button>
        <StatusSlot />
        <Msg s={state} />
      </div>
    </form>
  );
}

export type PropertyPick = { id: string; assetId: string; name: string; currency: string };

/** เพิ่มค่าใช้จ่ายประจำ / สาธารณูปโภค · หน้ารายละเอียดทรัพย์สินส่ง propertyId มา · หน้า Income & Expenses ส่งรายการทรัพย์สินให้เลือก */
export function UtilityForm({ assetId, propertyId, currency, properties, label = "+ เพิ่มค่าใช้จ่ายประจำ / สาธารณูปโภค", tracked = false, pays }: {
  assetId?: string; propertyId?: string; currency?: string; properties?: PropertyPick[]; label?: string; tracked?: boolean;
  /** ตัวเลือก "จ่ายจาก" ค่าตั้งต้น [ค่า (a:/c:), ชื่อ] */ pays?: [string, string][];
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [freq, setFreq] = useState(tracked ? "MONTHLY" : "");
  const [type, setType] = useState("COMMON_FEE");
  const [pick, setPick] = useState(properties?.[0]?.id ?? "");
  const [state, action, pending] = useActionState<ActionState, FormData>(addUtility, {});
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(link)}>{label}</button>;
  if (!open) return trigger;
  const meter = type === "ELECTRICITY" || type === "WATER";
  const chosen = properties?.find((x) => x.id === pick);
  const ccy = chosen?.currency ?? currency ?? "THB";
  return present(trigger, (
    <form action={action} className="mt-2 space-y-3 rounded-lg bg-slate-50 p-3">
      <input type="hidden" name="asset_id" value={chosen?.assetId ?? assetId ?? ""} />
      <input type="hidden" name="property_id" value={chosen?.id ?? propertyId ?? ""} />
      <input type="hidden" name="currency" value={ccy} />
      {properties && (
        <label className="block text-xs">ทรัพย์สิน
          <select value={pick} onChange={(e) => setPick(e.target.value)} required className={`mt-1 block max-w-full ${small}`}>
            {properties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">ประเภท
          <select name="utility_type" value={type} onChange={(e) => setType(e.target.value)} className={`mt-1 block ${small}`}>
            {Object.entries(UTIL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs">{type === "LAND_TAX" ? "หน่วยงาน" : type === "COMMON_FEE" ? "นิติบุคคล / ผู้เก็บ" : "ผู้ให้บริการ"}
          <input name="provider" placeholder={type === "LAND_TAX" ? "เช่น อบต. / เขต" : type === "COMMON_FEE" ? "" : "เช่น กฟน."} className={`mt-1 block w-36 ${small}`} />
        </label>
        {meter && <>
          <label className="text-xs">เลขที่ผู้ใช้<input name="account_no" className={`mt-1 block w-32 ${small}`} /></label>
          <label className="text-xs">เลขมิเตอร์<input name="meter_no" className={`mt-1 block w-32 ${small}`} /></label>
        </>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">ยอดประมาณ ({ccy})
          <input name="expected_amount" inputMode="decimal" placeholder="เว้นว่าง = ไม่ติดตาม" className={`mt-1 block w-36 ${small}`} />
        </label>
        <label className="text-xs">จ่าย
          <select name="frequency" value={freq} onChange={(e) => setFreq(e.target.value)} className={`mt-1 block ${small}`}>
            <option value="">— ไม่ติดตาม —</option>
            <option value="MONTHLY">รายเดือน</option><option value="QUARTERLY">ราย 3 เดือน</option><option value="YEARLY">รายปี</option>
          </select>
        </label>
        {(freq === "YEARLY" || freq === "QUARTERLY") && (
          <label className="text-xs">{freq === "YEARLY" ? "เดือนที่ครบกำหนด" : "เริ่มเดือน"}
            <select name="due_month" defaultValue={type === "LAND_TAX" ? "4" : "1"} className={`mt-1 block ${small}`}>
              {TH_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
        )}
        {freq && (
          <label className="text-xs">ทุกวันที่
            <input name="due_day" inputMode="numeric" placeholder="1–31" className={`mt-1 block w-16 ${small}`} />
          </label>
        )}
        <label className="text-xs">หมายเหตุ<input name="notes" className={`mt-1 block w-40 ${small}`} /></label>
        {pays && (
          <label className="text-xs">จ่ายจาก (ค่าตั้งต้นตอนบันทึกจ่าย)
            <select name="pay_default" defaultValue="" className={`mt-1 block max-w-[16rem] ${small}`}>
              <option value="">— ไม่ระบุ —</option>
              {pays.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={sbtn}>เพิ่ม</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-xs text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}

type Card = { id: string; label: string; currency: string };
type Person = { id: string; name: string };

/** บันทึกจ่ายค่าใช้จ่ายประจำ 1 งวด (ใช้ทั้งหน้ารายละเอียดและหน้ารวม) */
export function RecordCostForm({ assetId, utilityId, period, label, expected, currency, category, banks, cards, persons, today, defaultBank, defaultCard, rebillLeases = [] }: {
  assetId: string; utilityId: string; period: string; label: string; expected: number; currency: string; category: string;
  banks: Bank[]; cards: Card[]; persons: Person[]; today: string;
  /** "จ่ายจาก" ที่ตั้งไว้ในรายการค่าใช้จ่ายประจำ */ defaultBank?: string | null; defaultCard?: string | null;
  /** สัญญาเช่าที่ "เราจ่ายแล้วเรียกเก็บ" (มี → ติ๊กเรียกเก็บผู้เช่าไว้ให้) */ rebillLeases?: { id: string; label: string }[];
}) {
  const [rebill, setRebill] = useState(rebillLeases.length > 0);
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [via, setVia] = useState(defaultCard && cards.some((c) => c.id === defaultCard) ? "card"
    : defaultBank && banks.some((b) => b.asset_id === defaultBank) ? "bank" : banks.length ? "bank" : cards.length ? "card" : "cash");
  const [mode, setMode] = useState<"record" | "dismiss">("record");
  const [state, action, pending] = useActionState<ActionState, FormData>(recordPropertyCost, {});
  if (state.ok) return <span className="text-xs text-emerald-700">{state.ok}</span>;
  const trigger = <button type="button" onClick={() => { setMode("record"); setOpen(!open); }} className={activeCls(ROW_BTN)}>บันทึกจ่าย</button>;
  if (!open) return trigger;
  if (mode === "dismiss") return present(trigger,
    <DismissCostForm sourceType="PROPERTY" sourceId={utilityId} period={period} onBack={() => setMode("record")} onClose={() => setOpen(false)} />);
  const sameBanks = banks.filter((b) => b.currency === currency);
  const sameCards = cards.filter((c) => c.currency === currency);
  return present(trigger, (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2 text-left">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="utility_id" value={utilityId} />
      <input type="hidden" name="cost_period" value={period} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="expense_category" value={category} />
      <input type="hidden" name="description" value={label} />
      <label className="text-xs">ยอดที่จ่าย
        <input name="amount" required inputMode="decimal" defaultValue={expected > 0 ? String(expected) : ""} className={`mt-1 block w-28 ${small}`} />
      </label>
      <label className="text-xs">วันที่จ่าย
        <input name="date" type="date" required defaultValue={today} max={today} className={`mt-1 block ${small}`} />
      </label>
      <label className="text-xs">จ่ายจาก
        <select name="pay_via" value={via} onChange={(e) => setVia(e.target.value)} className={`mt-1 block ${small}`}>
          <option value="bank">บัญชีธนาคาร</option><option value="card">บัตรเครดิต</option><option value="cash">เงินสด</option>
        </select>
      </label>
      {via === "bank" && (
        <label className="text-xs">บัญชี
          <select name="bank_asset_id" required defaultValue={sameBanks.find((b) => b.asset_id === defaultBank)?.asset_id} className={`mt-1 block ${small}`}>
            {sameBanks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {via === "card" && (
        <label className="text-xs">บัตร
          <select name="card_id" required defaultValue={sameCards.find((c) => c.id === defaultCard)?.id} className={`mt-1 block ${small}`}>
            {sameCards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}
      {via === "cash" && (
        <label className="text-xs">ผู้จ่าย
          <select name="person_id" required className={`mt-1 block ${small}`}>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      <label className="text-xs">หมายเหตุ<input name="notes" className={`mt-1 block w-32 ${small}`} /></label>
      {rebillLeases.length > 0 && (
        <div className="flex w-full flex-wrap items-end gap-2 rounded-md bg-amber-50 px-2 py-1.5">
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="rebill" checked={rebill} onChange={(e) => setRebill(e.target.checked)} />
            เรียกเก็บผู้เช่า (รับคืนแล้วนับเป็นรายได้)</label>
          {rebill && <>
            {rebillLeases.length > 1 ? (
              <select name="rebill_lease_id" className={small}>{rebillLeases.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
            ) : <input type="hidden" name="rebill_lease_id" value={rebillLeases[0].id} />}
            <label className="text-xs">ยอดเรียกเก็บ<input name="rebill_amount" inputMode="decimal" placeholder="เท่ายอดที่จ่าย" className={`ml-1 w-28 ${small}`} /></label>
          </>}
        </div>
      )}
      <button disabled={pending} className={sbtn}>บันทึก</button>
      <BalanceGuard />
      <button type="button" data-close onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      <button type="button" onClick={() => setMode("dismiss")} className="ml-auto text-xs text-slate-600 underline">เดือนนี้ไม่ได้จ่าย…</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  ));
}

/** รับค่าน้ำไฟที่เรียกเก็บผู้เช่า 1 รายการ (รายได้อื่นของ Property) */
export function ReceiveChargeForm({ assetId, chargeId, amount, currency, banks, today, defaultBank }: {
  assetId: string; chargeId: string; amount: number; currency: string; banks: Bank[]; today: string; defaultBank?: string;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(receiveUtilityCharge, {});
  if (state.ok) return <span className="text-xs text-emerald-700">{state.ok}</span>;
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(link)}>บันทึกรับ</button>;
  if (!open) return trigger;
  const sameCcy = banks.filter((b) => b.currency === currency);
  return present(trigger, (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2 text-left">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="charge_id" value={chargeId} />
      <label className="text-xs">ยอดที่ได้รับ
        <input name="amount" required inputMode="decimal" defaultValue={String(amount)} className={`mt-1 block w-28 ${small}`} />
      </label>
      <label className="text-xs">วันที่รับ
        <input name="date" type="date" required defaultValue={today} max={today} className={`mt-1 block ${small}`} />
      </label>
      <label className="text-xs">เข้าบัญชี
        <select name="received_to_asset_id" defaultValue={sameCcy.find((b) => b.asset_id === defaultBank)?.asset_id ?? sameCcy[0]?.asset_id ?? ""} className={`mt-1 block ${small}`}>
          <option value="">— ไม่ผ่านบัญชี (เงินสด) —</option>
          {sameCcy.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
        </select>
      </label>
      <button disabled={pending} className={sbtn}>บันทึก</button>
      <button type="button" data-close onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  ));
}
