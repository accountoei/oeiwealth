"use client";

import { useActionState } from "react";
import { updatePropertyPayment, type TradeState } from "@/lib/asset-trade";
import { PropertyPayExtras, type CompOpt } from "@/components/AssetTrade";
import { DeleteSlot } from "@/components/RowActions";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/** แก้รายการจ่ายซื้อ / จ่ายเพิ่มของ Property: วันที่ · ยอด · รายละเอียด + ติ๊กอาคาร (ตกลง 28 ต.ค. 2026)
 *  มูลค่าที่ระบบเพิ่มให้ตอนจ่าย (ถ้าติ๊กไว้) ปรับตามยอด / วันที่ใหม่ในฐานข้อมูล · ติ๊ก / เอาติ๊ก "เพิ่มมูลค่า" ย้อนหลังได้ */
export default function PropertyPaymentForm({ assetId, currency, paths, m, building, years, addedValue, components }: {
  assetId: string; currency: string; paths: string[];
  m: { id: string; movement_date: string; amount: number; description: string | null; component_id: string | null };
  building: boolean; years: number; /** รายการนี้เพิ่มมูลค่าให้แล้ว */ addedValue: boolean;
  /** ส่วนประกอบที่เลือกได้ (เปลี่ยนแถวของรายการจ่าย) */ components: CompOpt[];
}) {
  const [state, action, pending] = useActionState<TradeState, FormData>(updatePropertyPayment, {});
  return (
    <form action={action} className="grid gap-3 md:grid-cols-4">
      <input type="hidden" name="id" value={m.id} />
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      <label className="text-sm">วันที่<input name="date" type="date" required defaultValue={m.movement_date} className={input} /></label>
      <label className="text-sm">จำนวนเงิน ({currency})<input name="amount" required inputMode="decimal" defaultValue={String(m.amount)} className={input} /></label>
      <label className="text-sm md:col-span-2">รายละเอียด<input name="description" defaultValue={m.description ?? ""} className={input} /></label>
      <PropertyPayExtras addValue={addedValue} building={building} years={years} components={components}
        component={m.component_id && components.some((c) => c.id === m.component_id) ? m.component_id : ""} />
      <p className="text-xs text-slate-500 md:col-span-4">{addedValue
        ? "รายการนี้เพิ่มมูลค่าทรัพย์สินให้แล้ว · แก้ยอด / วันที่ → มูลค่านั้นปรับตาม · เอาติ๊กออก หรือลบรายการ → มูลค่านั้นถูกลบด้วย"
        : "ติ๊ก \"เพิ่มมูลค่า\" ย้อนหลังได้ → มูลค่าใหม่ ณ วันที่จ่าย = มูลค่าล่าสุดก่อนหน้า + ยอดจ่าย"}</p>
      <div className="flex flex-wrap items-center gap-3 md:col-span-4">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <DeleteSlot />
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.ok && <p className="text-sm text-emerald-700">{state.ok}</p>}
      </div>
    </form>
  );
}
