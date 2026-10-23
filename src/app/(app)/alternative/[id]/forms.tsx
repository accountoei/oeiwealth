"use client";

import { useActionState, useRef, useState } from "react";
import { ALT_UNITS_ANY, ALT_UNITS_BY_CODE, GRAM_PER_GOLD_BAHT } from "@/lib/format";
import { addGoldValuation, updateAlternativeInfo, type ActionState } from "../actions";
import AssetValuationForm from "@/components/AssetValuationForm";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const dv = (v: number | string | null | undefined) => (v == null ? "" : String(v));

export type AltInfo = {
  name: string; acquisition_date: string | null; acquisition_cost: number | null; notes: string | null;
  brand: string | null; model: string | null; serial_no: string | null; quantity: number | null; unit: string | null; purity_pct: number | null;
  storage_location: string | null; condition: string | null; details: string | null; auto_price?: boolean;
  gold_form?: string | null; deduct_per_baht?: number | null;
};

/** บาททองคำ ↔ กรัม: ตัวคูณจากหน่วยเดิมไปหน่วยใหม่ (คู่อื่น = null ไม่แปลง) */
const GOLD_FACTOR: Record<string, number> = { "บาททองคำ>กรัม": GRAM_PER_GOLD_BAHT, "กรัม>บาททองคำ": 1 / GRAM_PER_GOLD_BAHT };

/** แก้ข้อมูลสินทรัพย์ (ในหน้าต่าง "แก้ไขข้อมูล") · หมวดเปลี่ยนไม่ได้ (เลือกตอนสร้างเท่านั้น) */
export function AltInfoForm({ assetId, code, catName, defaultUnit, v }: { assetId: string; code: string; catName: string | null; defaultUnit: string | null; v: AltInfo }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateAlternativeInfo, {});
  const [form, setForm] = useState(v.gold_form === "ORNAMENT" ? "ORNAMENT" : "BAR");
  const units = [...new Set([defaultUnit, ...(ALT_UNITS_BY_CODE[code] ?? ALT_UNITS_ANY)].filter(Boolean) as string[])];
  // สลับหน่วยระหว่างบาททองคำกับกรัม → ถามว่าจะแปลงจำนวนด้วยไหม (กัน 5 บาททองคำ กลายเป็น 5 กรัม)
  const qtyRef = useRef<HTMLInputElement>(null);
  const [qtyUnitNow, setQtyUnitNow] = useState(v.unit ?? defaultUnit ?? "");   // หน่วยที่ตัวเลขในช่องจำนวนใช้อยู่
  const [unit, setUnit] = useState(v.unit ?? defaultUnit ?? "");
  const factor = GOLD_FACTOR[`${qtyUnitNow}>${unit.trim()}`] ?? null;
  const [qtyText, setQtyText] = useState(dv(v.quantity));
  const qtyNow = Number(qtyText.replace(/,/g, ""));
  const askConvert = factor != null && qtyNow > 0;
  const converted = askConvert ? Number((qtyNow * (factor as number)).toFixed(4)) : null;
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="asset_id" value={assetId} />
      <label className="text-sm md:col-span-2">ชื่อ<input name="name" required defaultValue={v.name} className={input} /></label>
      <p className="text-xs text-slate-500 md:col-span-2">หมวด: <span className="font-medium text-slate-700">{catName ?? "-"}</span>
        {" · "}เปลี่ยนหมวดไม่ได้ (ข้อมูลเฉพาะหมวด เช่น ความบริสุทธิ์ / ราคาทองอัตโนมัติ ผูกกับหมวด) · ถ้าเลือกหมวดผิด ให้ลบรายการนี้แล้วสร้างใหม่</p>
      <label className="text-sm">ยี่ห้อ<input name="brand" defaultValue={dv(v.brand)} className={input} /></label>
      <label className="text-sm">รุ่น<input name="model" defaultValue={dv(v.model)} className={input} /></label>
      <label className="text-sm">Serial / เลขใบรับรอง<input name="serial_no" defaultValue={dv(v.serial_no)} className={input} data-plain /></label>
      <div className="grid grid-cols-[1fr_9rem] gap-2">
        <label className="text-sm">จำนวน<input ref={qtyRef} name="quantity" inputMode="decimal" data-money="off" defaultValue={dv(v.quantity)}
          onChange={(e) => setQtyText(e.target.value)} className={input} /></label>
        <label className="text-sm">หน่วย<input name="unit" list="alt-units-edit" value={unit} onChange={(e) => setUnit(e.target.value)} className={input} />
          <datalist id="alt-units-edit">{units.map((u) => <option key={u} value={u} />)}</datalist></label>
      </div>
      {askConvert && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 md:col-span-2">
          เปลี่ยนหน่วยจาก {qtyUnitNow} เป็น {unit.trim()} แต่จำนวนยังเป็น {qtyNow.toLocaleString("en-US", { maximumFractionDigits: 8 })} เหมือนเดิม
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
              onClick={() => { if (qtyRef.current) qtyRef.current.value = String(converted); setQtyText(String(converted)); setQtyUnitNow(unit.trim()); }}>
              แปลงจำนวนเป็น {converted?.toLocaleString("en-US", { maximumFractionDigits: 4 })} {unit.trim()}
            </button>
            <button type="button" className="rounded-md border border-amber-400 px-3 py-1 text-xs text-amber-900 hover:bg-amber-100"
              onClick={() => setQtyUnitNow(unit.trim())}>ไม่ต้องแปลง (จำนวนถูกแล้ว)</button>
          </div>
        </div>
      )}
      {(code === "GOLD" || v.purity_pct != null) && (
        <label className="text-sm">ความบริสุทธิ์ (%)<input name="purity_pct" inputMode="decimal" data-money="off" placeholder="เช่น 96.5" defaultValue={dv(v.purity_pct)} className={input} /></label>
      )}
      {code === "GOLD" && (
        <>
          <label className="text-sm">ชนิดทอง
            <select name="gold_form" value={form} onChange={(e) => setForm(e.target.value)} className={input}>
              <option value="BAR">ทองคำแท่ง</option>
              <option value="ORNAMENT">ทองรูปพรรณ</option>
            </select>
          </label>
          {form === "ORNAMENT" ? (
            <label className="text-sm">หักจากราคารับซื้อ (บาท ต่อ 1 บาททองคำ)
              <input name="deduct_per_baht" inputMode="decimal" placeholder="เช่น 500 · ไม่หัก = เว้นว่าง" defaultValue={dv(v.deduct_per_baht)} className={input} />
            </label>
          ) : <div />}
          <label className="flex items-start gap-2 text-sm md:col-span-2">
            <input type="hidden" name="auto_price_shown" value="1" />
            <input type="checkbox" name="auto_price" defaultChecked={!!v.auto_price} className="mt-1" />
            <span>ประเมินมูลค่าอัตโนมัติทุกวันทำการ <span className="block text-xs text-slate-500">ราคารับซื้อของสมาคมค้าทองคำ (ทองคำแท่ง / ทองรูปพรรณ ตามชนิด) × จำนวน × ความบริสุทธิ์ ÷ 96.5% − ค่าหัก · ราคาโลก × USD/THB ใช้เทียบ (ต่างเกิน 3% ไม่บันทึก) · ใช้กับหน่วย บาททองคำ / กรัม · ราคาครั้งแรก / ต่างจากครั้งก่อนเกิน 20% รอยืนยัน</span></span>
          </label>
        </>
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

/** มูลค่าทองคำ: ใส่ราคาต่อ 1 บาททองคำ (ระบบคำนวณ) หรือ มูลค่ารวม (แบบเดิม) */
export function GoldValuationForm({ assetId, today, minDate, paths, qtyBaht, purity, ornament, deduct }: {
  assetId: string; today: string; minDate: string; paths: string[]; qtyBaht: number | null; purity: number | null; ornament: boolean; deduct: number | null;
}) {
  const [mode, setMode] = useState<"price" | "total">(qtyBaht ? "price" : "total");
  const [state, action, pending] = useActionState<ActionState, FormData>(addGoldValuation, {});
  const [price, setPrice] = useState("");
  const p = Number(price.replace(/,/g, ""));
  const preview = qtyBaht && p > 0
    ? Math.max(0, Math.round((qtyBaht * p * (purity ?? 96.5) / 96.5 - (ornament ? qtyBaht * (deduct ?? 0) : 0)) * 100) / 100) : null;
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
  const box = "rounded-md border border-slate-300 px-3 py-2 text-sm";
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode("price")} disabled={!qtyBaht} className={`${chip(mode === "price")} disabled:opacity-50`}>ใส่ราคาต่อบาททองคำ</button>
        <button type="button" onClick={() => setMode("total")} className={chip(mode === "total")}>ใส่มูลค่ารวม</button>
      </div>
      {mode === "total" ? <AssetValuationForm assetId={assetId} currency="THB" today={today} minDate={minDate} paths={paths} /> : (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="asset_id" value={assetId} />
          <label className="text-sm">ราคารับซื้อ ต่อ 1 บาททองคำ (96.5%)
            <input name="price_per_baht" required inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={`mt-1 block w-48 ${box}`} /></label>
          <label className="text-sm">ณ วันที่<input name="valuation_date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block ${box}`} /></label>
          <label className="text-sm">วิธี
            <select name="valuation_method" defaultValue="LATEST_TRANSACTION" className={`mt-1 block ${box}`}>
              <option value="LATEST_TRANSACTION">ราคาประกาศ (สมาคมฯ / ร้านทอง)</option>
              <option value="APPRAISAL">ร้านประเมิน</option>
              <option value="USER_ESTIMATE">ประมาณเอง</option>
            </select>
          </label>
          <label className="min-w-48 flex-1 text-sm">หมายเหตุ<input name="notes" placeholder="เช่น สมาคมค้าทองคำ ครั้งที่ 1" className={`mt-1 block w-full ${box}`} /></label>
          <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึกมูลค่า"}</button>
          <p className="w-full text-xs text-slate-500">
            {qtyBaht?.toLocaleString("th-TH", { maximumFractionDigits: 4 })} บาททองคำ × ราคา × {purity ?? 96.5}% ÷ 96.5%
            {ornament && deduct ? ` − หัก ${deduct.toLocaleString("th-TH")} บาท/บาททองคำ` : ""}
            {preview != null && <> = <b className="tabular-nums text-slate-800">{preview.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</b></>}
            {" "}· ใช้ราคารับซื้อ (ไม่ใช่ราคาขาย) จะตรงกับเงินที่ได้จริงถ้าขาย
          </p>
          <div className="w-full">
            {state.error && <p className="text-sm text-red-600">{state.error}</p>}
            {state.ok && <p className="text-sm text-emerald-700">{state.ok}</p>}
          </div>
        </form>
      )}
    </div>
  );
}
