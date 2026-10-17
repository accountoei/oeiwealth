"use client";

import { useActionState } from "react";
import { ALT_UNITS_ANY, ALT_UNITS_BY_CODE } from "@/lib/format";
import { updateAlternativeInfo, type ActionState } from "../actions";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const dv = (v: number | string | null | undefined) => (v == null ? "" : String(v));

export type AltInfo = {
  name: string; acquisition_date: string | null; acquisition_cost: number | null; notes: string | null;
  brand: string | null; model: string | null; serial_no: string | null; quantity: number | null; unit: string | null; purity_pct: number | null;
  storage_location: string | null; condition: string | null; details: string | null; auto_price?: boolean;
};

/** แก้ข้อมูลสินทรัพย์ (ในหน้าต่าง "แก้ไขข้อมูล") */
export function AltInfoForm({ assetId, code, defaultUnit, v }: { assetId: string; code: string; defaultUnit: string | null; v: AltInfo }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateAlternativeInfo, {});
  const units = [...new Set([defaultUnit, ...(ALT_UNITS_BY_CODE[code] ?? ALT_UNITS_ANY)].filter(Boolean) as string[])];
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="asset_id" value={assetId} />
      <label className="text-sm md:col-span-2">ชื่อ<input name="name" required defaultValue={v.name} className={input} /></label>
      <label className="text-sm">ยี่ห้อ<input name="brand" defaultValue={dv(v.brand)} className={input} /></label>
      <label className="text-sm">รุ่น<input name="model" defaultValue={dv(v.model)} className={input} /></label>
      <label className="text-sm">Serial / เลขใบรับรอง<input name="serial_no" defaultValue={dv(v.serial_no)} className={input} data-plain /></label>
      <div className="grid grid-cols-[1fr_9rem] gap-2">
        <label className="text-sm">จำนวน<input name="quantity" inputMode="decimal" data-money="off" defaultValue={dv(v.quantity)} className={input} /></label>
        <label className="text-sm">หน่วย<input name="unit" list="alt-units-edit" defaultValue={v.unit ?? defaultUnit ?? ""} className={input} />
          <datalist id="alt-units-edit">{units.map((u) => <option key={u} value={u} />)}</datalist></label>
      </div>
      {(code === "GOLD" || v.purity_pct != null) && (
        <label className="text-sm">ความบริสุทธิ์ (%)<input name="purity_pct" inputMode="decimal" data-money="off" placeholder="เช่น 96.5" defaultValue={dv(v.purity_pct)} className={input} /></label>
      )}
      {code === "GOLD" && (
        <label className="flex items-start gap-2 text-sm md:col-span-2">
          <input type="hidden" name="auto_price_shown" value="1" />
          <input type="checkbox" name="auto_price" defaultChecked={!!v.auto_price} className="mt-1" />
          <span>ประเมินมูลค่าอัตโนมัติทุกวันทำการ <span className="block text-xs text-slate-500">ประมาณจากราคาทองตลาดโลก × อัตราแลกเปลี่ยน (บาทต่อบาททองคำ 96.5% ปรับตามความบริสุทธิ์) · ใช้กับหน่วย บาททองคำ / กรัม · มูลค่าที่ต่างจากเดิมเกิน 20% ระบบไม่บันทึก</span></span>
        </label>
      )}
      <label className="text-sm">ที่เก็บ<input name="storage_location" defaultValue={dv(v.storage_location)} className={input} /></label>
      <label className="text-sm">สภาพ<input name="condition" defaultValue={dv(v.condition)} className={input} /></label>
      <label className="text-sm">วันที่ได้มา<input name="acquisition_date" type="date" defaultValue={dv(v.acquisition_date)} className={input} /></label>
      <label className="text-sm">ราคาที่ได้มา (ราคาทุน)<input name="acquisition_cost" inputMode="decimal" defaultValue={dv(v.acquisition_cost)} className={input} /></label>
      <label className="text-sm md:col-span-2">รายละเอียด<input name="details" defaultValue={dv(v.details)} className={input} /></label>
      <label className="text-sm md:col-span-2">หมายเหตุ<input name="notes" defaultValue={dv(v.notes)} className={input} /></label>
      <div className="flex items-center gap-3 md:col-span-2">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึกข้อมูล"}</button>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.ok && <p className="text-sm text-emerald-700">{state.ok}</p>}
      </div>
    </form>
  );
}
