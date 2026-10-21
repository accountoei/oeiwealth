"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { landParts, landTaxCalc, money } from "@/lib/format";
import { useActionSlot } from "@/components/ActionBar";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { copyTaxYear, deleteTaxLine, saveTaxLine, type ActionState } from "../actions";

export type TaxLine = {
  id: string; sort_order: number; description: string | null; land_sq_wa: number | null; land_price_per_sq_wa: number | null;
  building_type: string | null; building_sqm: number | null; building_price_per_sqm: number | null; building_age: number | null;
  depreciation_pct: number; exemption: number; exemption_reason: string | null; rate_pct: number; discount_pct: number; notes: string | null;
};

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));
const s = (v: number | null | undefined) => (v == null ? "" : String(v));

function Msg({ st }: { st: ActionState }) {
  if (st.error) return <p className="text-sm text-red-600">{st.error}</p>;
  if (st.ok) return <p className="text-sm text-emerald-700">{st.ok}</p>;
  return null;
}

/** เพิ่ม / แก้รายการภาษีที่ดิน 1 รายการ (pop up) · เห็นผลคำนวณทันทีขณะกรอก */
export function TaxLineForm({ assetId, year, line, defaults, label, primary = false, canDelete = false }: {
  assetId: string; year: number; line?: TaxLine; label: string; primary?: boolean;
  /** แก้ไข: ปุ่ม "ลบรายการนี้" อยู่ในหน้าต่าง (ADMIN / EDITOR) */
  canDelete?: boolean;
  defaults?: { rate_pct: number; land_sq_wa: number | null; sort_order: number };
}) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const [state, action, pending] = useActionState<ActionState, FormData>(saveTaxLine, {});
  const land = landParts(line ? line.land_sq_wa : defaults?.land_sq_wa);
  const [v, setV] = useState<Record<string, string>>(() => ({
    rai: land.rai, ngan: land.ngan, wa: land.wa, land_price_per_sq_wa: s(line?.land_price_per_sq_wa),
    building_sqm: s(line?.building_sqm), building_price_per_sqm: s(line?.building_price_per_sqm),
    depreciation_pct: s(line?.depreciation_pct ?? 0), exemption: s(line?.exemption ?? 0),
    rate_pct: s(line?.rate_pct ?? defaults?.rate_pct ?? 0.3), discount_pct: s(line?.discount_pct ?? 0),
  }));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const sqwa = (n(v.rai) ?? 0) * 400 + (n(v.ngan) ?? 0) * 100 + (n(v.wa) ?? 0);
  const c = landTaxCalc({ land_sq_wa: sqwa, land_price_per_sq_wa: n(v.land_price_per_sq_wa), building_sqm: n(v.building_sqm),
    building_price_per_sqm: n(v.building_price_per_sqm), depreciation_pct: n(v.depreciation_pct), exemption: n(v.exemption),
    rate_pct: n(v.rate_pct), discount_pct: n(v.discount_pct) });
  const trigger = <button type="button" onClick={() => setOpen(!open)}
    className={activeCls(primary ? "rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700" : "rounded-md bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700")}>{label}</button>;
  if (!open) return trigger;
  const f = `mt-1 block w-full ${input}`;
  return present(trigger, (<>
    <form action={action} className="space-y-4">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="tax_year" value={year} />
      {line && <input type="hidden" name="id" value={line.id} />}
      <h3 className="font-medium text-slate-900">{line ? "แก้ไขรายการภาษี" : "เพิ่มรายการภาษี"} · ปี {year + 543}</h3>
      <div className="grid gap-3 md:grid-cols-[1fr_6rem]">
        <label className="text-sm">รายการ (เช่น ชั้น 1 ร้านค้า / ห้องชุด / ที่ดินเปล่า)
          <input name="description" defaultValue={line?.description ?? ""} className={f} /></label>
        <label className="text-sm">ลำดับ<input name="sort_order" inputMode="numeric" data-plain defaultValue={line?.sort_order ?? defaults?.sort_order ?? 1} className={f} /></label>
      </div>

      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">ที่ดิน <span className="text-xs font-normal text-slate-500">(ห้องชุด / ชั้นที่ไม่นับที่ดินซ้ำ เว้นว่างได้)</span></legend>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1.5fr]">
          <label className="text-sm">ไร่<input name="land_rai" inputMode="numeric" data-plain value={v.rai} onChange={set("rai")} className={f} /></label>
          <label className="text-sm">งาน<input name="land_ngan" inputMode="numeric" data-plain value={v.ngan} onChange={set("ngan")} className={f} /></label>
          <label className="text-sm">ตร.ว.<input name="land_wa" inputMode="decimal" data-money="off" value={v.wa} onChange={set("wa")} className={f} /></label>
          <label className="text-sm">ราคาประเมิน / ตร.ว. (บาท)<input name="land_price_per_sq_wa" inputMode="decimal" value={v.land_price_per_sq_wa} onChange={set("land_price_per_sq_wa")} className={f} /></label>
        </div>
        <p className="mt-2 text-xs text-slate-500">รวม {sqwa.toLocaleString("th-TH")} ตร.ว. · ราคาประเมินที่ดิน <b className="tabular-nums text-slate-700">{money(c.land)}</b></p>
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">สิ่งปลูกสร้าง <span className="text-xs font-normal text-slate-500">(ที่ดินเปล่า เว้นว่างได้)</span></legend>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm md:col-span-3">ประเภทสิ่งปลูกสร้าง (เช่น บ้านเดี่ยว (103) · ตึกแถว 4 ชั้น (400))
            <input name="building_type" defaultValue={line?.building_type ?? ""} className={f} /></label>
          <label className="text-sm">พื้นที่ (ตร.ม.)<input name="building_sqm" inputMode="decimal" data-money="off" value={v.building_sqm} onChange={set("building_sqm")} className={f} /></label>
          <label className="text-sm">ราคาประเมิน / ตร.ม. (บาท)<input name="building_price_per_sqm" inputMode="decimal" value={v.building_price_per_sqm} onChange={set("building_price_per_sqm")} className={f} /></label>
          <label className="text-sm">อายุอาคาร (ปี)<input name="building_age" inputMode="numeric" data-plain defaultValue={s(line?.building_age)} className={f} /></label>
          <label className="text-sm">ค่าเสื่อม (%)<input name="depreciation_pct" inputMode="decimal" data-money="off" value={v.depreciation_pct} onChange={set("depreciation_pct")} className={f} /></label>
        </div>
        <p className="mt-2 text-xs text-slate-500">ราคาประเมิน {money(c.gross)} − ค่าเสื่อม {money(c.dep)} = <b className="tabular-nums text-slate-700">{money(c.building)}</b></p>
      </fieldset>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-sm">หักมูลค่ายกเว้น (บาท)<input name="exemption" inputMode="decimal" value={v.exemption} onChange={set("exemption")} className={f} />
          <span className="text-xs text-slate-500">ติดลบ = ปรับเพิ่มฐานภาษี</span></label>
        <label className="text-sm">เหตุผลยกเว้น<input name="exemption_reason" placeholder="เช่น บ้านหลังแรก" defaultValue={line?.exemption_reason ?? ""} className={f} /></label>
        <label className="text-sm">อัตราภาษี (%)<input name="rate_pct" required inputMode="decimal" data-money="off" value={v.rate_pct} onChange={set("rate_pct")} className={f} />
          <span className="text-xs text-slate-500">เช่น 0.02 · 0.3</span></label>
        <label className="text-sm">ส่วนลด (%)<input name="discount_pct" inputMode="decimal" data-money="off" value={v.discount_pct} onChange={set("discount_pct")} className={f} /></label>
        <label className="text-sm md:col-span-4">หมายเหตุ<input name="notes" defaultValue={line?.notes ?? ""} className={f} /></label>
      </div>

      <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
        <div><div className="text-xs text-slate-500">รวมราคาประเมิน</div><div className="tabular-nums">{money(c.total)}</div></div>
        <div><div className="text-xs text-slate-500">ฐานภาษี (หลังยกเว้น)</div><div className="tabular-nums">{money(c.taxable)}</div></div>
        <div><div className="text-xs text-slate-500">ภาษีเต็ม</div><div className="tabular-nums">{money(c.full)}</div></div>
        <div><div className="text-xs text-slate-500">ภาษีที่ต้องชำระ</div><div className="text-lg font-semibold tabular-nums text-slate-900">{money(c.tax)}</div></div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ยกเลิก</button>
        <Msg st={state} />
      </div>
    </form>
    {line && canDelete && (
      <div className="mt-4 border-t border-slate-100 pt-3">
        <DeleteTaxLine assetId={assetId} year={year} id={line.id} label={line.description || "รายการ"} />
      </div>
    )}
  </>));
}

export function DeleteTaxLine({ assetId, year, id, label }: { assetId: string; year: number; id: string; label: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(deleteTaxLine, {});
  const cf = useConfirmSubmit();
  return (
    <>
      {cf.dialog}
      <form action={action} onSubmit={cf.guard(`ลบรายการภาษี "${label}"?`, { danger: true, okLabel: "ลบ" })} className="inline">
        <input type="hidden" name="asset_id" value={assetId} /><input type="hidden" name="tax_year" value={year} /><input type="hidden" name="id" value={id} />
        <button disabled={pending} className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">{pending ? "กำลังลบ…" : "ลบรายการนี้"}</button>
        {state.error && <span className="ml-2 text-xs text-red-600">{state.error}</span>}
      </form>
    </>
  );
}

export function CopyTaxYear({ assetId, from, to }: { assetId: string; from: number; to: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(copyTaxYear, {});
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="asset_id" value={assetId} /><input type="hidden" name="from_year" value={from} /><input type="hidden" name="to_year" value={to} />
      <button disabled={pending} className="rounded-md border border-blue-600 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50">
        {pending ? "กำลังคัดลอก…" : `คัดลอกจากปี ${from + 543}`}</button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/** เลือกปีภาษี (dropdown) · ✓ = มีข้อมูลแล้ว */
export function TaxYearSelect({ years, value, withData, hrefOf }: { years: number[]; value: number; withData: number[]; hrefOf: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">ปีภาษี
      <select value={value} onChange={(e) => router.push(hrefOf.replace("__Y__", e.target.value), { scroll: false })}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
        {years.map((y) => <option key={y} value={y}>{y + 543}{withData.includes(y) ? " ✓" : ""}</option>)}
      </select>
    </label>
  );
}
