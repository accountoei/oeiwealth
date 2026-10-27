"use client";

import Link from "next/link";
import { startTransition, useActionState, useRef, useState } from "react";
import { addCategory, createAlternative, type ActionState } from "../actions";
import OwnerShares from "@/components/OwnerShares";
import { ALT_UNITS_ANY, ALT_UNITS_BY_CODE, thDate } from "@/lib/format";
import { CurrencySelect } from "@/components/CurrencyContext";

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";

export default function NewAlternativeForm(props: {
  persons: { id: string; name: string }[]; categories: { id: string; name: string; code: string; unit: string | null }[];
  goLive: string; openingDate: string; today: string; isSetup: boolean; isAdmin: boolean;
  banks: { asset_id: string; name: string; currency: string }[];
}) {
  const { persons, categories, goLive, openingDate, today, isSetup, isAdmin, banks } = props;
  const [currency, setCurrency] = useState("THB");
  const [state, action, pending] = useActionState<ActionState, FormData>(createAlternative, {});
  const [cs, catAction, adding] = useActionState<ActionState, FormData>(addCategory, {});
  const [opening, setOpening] = useState(isSetup);
  // หลัง Go-live: ซ่อนตัวเลือก "มีอยู่ก่อน Go-live" (ไม่ติ๊ก) · ADMIN กดลิงก์เล็กเพื่อเพิ่มรายการที่ตกหล่น
  const [late, setLate] = useState(false);
  const [newCat, setNewCat] = useState(false);
  const catName = useRef<HTMLInputElement>(null);
  const catUnit = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});   // หมวดที่เลือก ต่อรอบของรายการหมวด (เพิ่มหมวดใหม่ = เลือกหมวดใหม่)
  // เพิ่มหมวดโดยไม่ส่งฟอร์มหลัก (ข้อมูลที่กรอกไว้ไม่หาย)
  const addCat = () => {
    const fd = new FormData();
    fd.set("category_name", catName.current?.value ?? "");
    fd.set("default_unit", catUnit.current?.value ?? "");
    startTransition(() => catAction(fd));
  };
  const cats = cs.id && !categories.some((c) => c.id === cs.id) ? [...categories, { id: cs.id, name: cs.name ?? "", code: "", unit: cs.unit ?? "ชิ้น" }] : categories;
  const chosenId = picked[cs.id ?? "base"] ?? cs.id ?? categories[0]?.id;
  const chosen = cats.find((c) => c.id === chosenId) ?? cats[0];
  const units = [...new Set([chosen?.unit, ...(ALT_UNITS_BY_CODE[chosen?.code ?? ""] ?? ALT_UNITS_ANY)].filter(Boolean) as string[])];
  return (
    <div className="space-y-6">
      <form action={action} className="space-y-6">
        <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2">
          <h2 className="md:col-span-2 font-medium text-slate-900">ข้อมูลสินทรัพย์</h2>
          <label className={label}>ชื่อ *<input name="name" required placeholder="เช่น ทองแท่ง 10 บาท" className={input} /></label>
          <div className={label}>
            <label htmlFor="category_id">หมวด *</label>
            {/* หมวดที่เพิ่งเพิ่ม → อยู่ในรายการและถูกเลือกทันที */}
            <select id="category_id" name="category_id" required key={cs.id ?? "base"} defaultValue={cs.id ?? categories[0]?.id}
              onChange={(e) => setPicked({ ...picked, [cs.id ?? "base"]: e.target.value })} className={input}>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!newCat ? (
              <button type="button" onClick={() => setNewCat(true)} className="mt-1 text-xs text-slate-600 underline">+ เพิ่มหมวดเอง</button>
            ) : (
              <div className="mt-2 rounded-lg bg-slate-50 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input ref={catName} placeholder="ชื่อหมวดใหม่ เช่น พระเครื่อง / งานศิลปะ" aria-label="ชื่อหมวดใหม่"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCat(); } }}
                    className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
                  <input ref={catUnit} placeholder="หน่วย เช่น องค์" aria-label="หน่วยตั้งต้นของหมวด" list="alt-units-any"
                    className="w-32 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
                  <datalist id="alt-units-any">{ALT_UNITS_ANY.map((u) => <option key={u} value={u} />)}</datalist>
                  <button type="button" onClick={addCat} disabled={adding}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{adding ? "…" : "เพิ่มหมวด"}</button>
                  <button type="button" onClick={() => setNewCat(false)} className="text-xs text-slate-500">ปิด</button>
                </div>
                {cs.error && <p className="mt-1 text-xs text-red-600">{cs.error}</p>}
                {cs.ok && <p className="mt-1 text-xs text-emerald-700">{cs.ok}</p>}
              </div>
            )}
          </div>
          <label className={label}>ยี่ห้อ<input name="brand" className={input} /></label>
          <label className={label}>รุ่น<input name="model" className={input} /></label>
          <label className={label}>Serial / เลขใบรับรอง<input name="serial_no" className={input} /></label>
          <div className="grid grid-cols-[1fr_9rem] gap-2">
            <label className={label}>จำนวน<input name="quantity" inputMode="decimal" data-money="off" className={input} /></label>
            <label className={label}>หน่วย<input name="unit" key={chosen?.id} list="alt-units" defaultValue={chosen?.unit ?? ""} className={input} />
              <datalist id="alt-units">{units.map((u) => <option key={u} value={u} />)}</datalist></label>
          </div>
          {chosen?.code === "GOLD" && (
            <label className={label}>ความบริสุทธิ์ (%)<input name="purity_pct" inputMode="decimal" data-money="off" placeholder="เช่น 96.5 / 99.99" className={input} /></label>
          )}
          <label className={label}>ที่เก็บ<input name="storage_location" placeholder="เช่น ตู้เซฟธนาคาร" className={input} /></label>
          <label className={label}>สภาพ<input name="condition" className={input} /></label>
          <label className={`${label} md:col-span-2`}>รายละเอียด<input name="details" className={input} /></label>
          <label className={label}>วันที่ได้มา {!opening && "*"}<input name="acquisition_date" type="date" required={!opening} min={opening ? undefined : goLive} max={today} className={input} /></label>
          <label className={label}>ราคาที่ซื้อ<input name="acquisition_cost" inputMode="decimal" className={input} /></label>
          {!opening && (
            <label className={`${label} md:col-span-2`}>จ่ายจากบัญชี
              <select name="pay_bank_asset_id" defaultValue="" className={input}>
                <option value="">— ไม่บันทึกเงินออก (ยังไม่จ่าย / จ่ายเป็นงวด) —</option>
                {banks.filter((b) => b.currency === currency).map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
              </select>
              <span className="mt-1 block text-xs text-slate-500">เลือกบัญชี → บันทึกเงินออก &ldquo;ซื้อทรัพย์สิน&rdquo; = ราคาที่ซื้อ ณ วันที่ได้มา (บัญชีสกุลเดียวกับสินทรัพย์) · จ่ายเป็นงวด ให้เว้นว่างแล้วใช้ &ldquo;+ จ่ายซื้อ / จ่ายเพิ่ม&rdquo; ในหน้าสินทรัพย์</span>
            </label>
          )}
        </section>

        <OwnerShares persons={persons} title="เจ้าของ" />

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium text-slate-900">มูลค่า (บังคับ)</h2>
          {!isSetup && isAdmin && !late && (
            <button type="button" onClick={() => setLate(true)} className="text-left text-xs text-slate-400 underline hover:text-slate-600">เพิ่มรายการที่ตกหล่นก่อน Go-live (ADMIN)</button>
          )}
          {(isSetup || late) && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="is_opening" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="mt-1" />
              <span>มีอยู่ก่อน Go-live ({thDate(goLive)}) — มูลค่าตั้งต้น ณ สิ้นวัน {thDate(openingDate)}
                {!isSetup && <span className="block text-xs text-amber-700">ระบบ LIVE แล้ว: ต้องระบุเหตุผลในหมายเหตุ</span>}</span>
            </label>
          )}
          <div className="grid gap-4 md:grid-cols-4">
            <label className={label}>มูลค่า *<input name="value" required inputMode="decimal" className={input} /></label>
            <label className={label}>สกุลเงิน
              <CurrencySelect name="currency" value={currency} onChange={setCurrency} className={input} />
            </label>
            <label className={label}>ณ วันที่ *
              {opening ? <><input type="hidden" name="value_date" value={openingDate} /><input disabled value={thDate(openingDate)} className={`${input} bg-slate-50`} /></>
                : <input name="value_date" type="date" required min={goLive} max={today} defaultValue={today} className={input} />}
            </label>
            <label className={label}>วิธีประเมิน
              <select name="valuation_method" defaultValue="USER_ESTIMATE" className={input}>
                <option value="USER_ESTIMATE">ประมาณเอง</option><option value="APPRAISAL">ผู้ประเมิน / ร้าน</option>
                <option value="LATEST_TRANSACTION">ราคาตลาดล่าสุด</option><option value="BOOK_VALUE">ราคาทุน</option>
              </select>
            </label>
          </div>
          <label className={label}>หมายเหตุ {opening && !isSetup && "(เหตุผล · จำเป็น)"}<textarea name="notes" rows={2} required={opening && !isSetup} className={input} /></label>
        </section>
        {state.error && <p className="text-sm text-red-600">{state.error}{state.created && <> · <Link href={state.created} className="underline">เปิดหน้าสินทรัพย์</Link></>}</p>}
        <div className="flex gap-3">
          <button disabled={pending || !!state.created} className="rounded-md bg-blue-600 px-5 py-2 text-sm text-white disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
          <Link href="/alternative" className="rounded-md border border-slate-300 px-5 py-2 text-sm">ยกเลิก</Link>
        </div>
      </form>
    </div>
  );
}
