"use client";

import { useActionState } from "react";
import { updatePropertyPayment, type TradeState } from "@/lib/asset-trade";
import { PropertyPayExtras, type CompOpt } from "@/components/AssetTrade";
import { DeleteSlot } from "@/components/RowActions";
import Flash from "@/components/Flash";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/** แก้รายการจ่ายซื้อ / จ่ายเพิ่มของ Property: วันที่ · ยอด · รายละเอียด · แถวของรายการ (ตกลง 28 ต.ค. 2026)
 *  ต้องเลือกแถวของรายการจ่าย (รายการเก่าที่ยังไม่ระบุแถว เลือกตอนแก้ · ตกลง 29 ต.ค. 2026)
 *  มูลค่าที่ระบบเพิ่มให้ตอนจ่ายปรับตามยอด / วันที่ใหม่ในฐานข้อมูล · ไม่มีติ๊ก "เพิ่มมูลค่า" แล้ว (ตกลง 29 ต.ค. 2026)
 *  รายการเก่าที่ไม่ได้ติ๊ก = คงไว้ตามเดิม · แนะนำลบแล้วบันทึกใหม่เป็นค่าใช้จ่าย */
export default function PropertyPaymentForm({ assetId, currency, paths, m, addedValue, components }: {
  assetId: string; currency: string; paths: string[];
  m: { id: string; movement_date: string; amount: number; description: string | null; component_id: string | null };
  /** รายการนี้เพิ่มมูลค่าให้แล้ว */ addedValue: boolean;
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
      <PropertyPayExtras addValue={addedValue} components={components}
        component={m.component_id && components.some((c) => c.id === m.component_id) ? m.component_id : ""} />
      <p className="text-xs text-slate-500 md:col-span-4">{addedValue
        ? "แก้ยอด / วันที่ → มูลค่าที่เพิ่มจากรายการนี้ปรับตาม · ลบรายการ → มูลค่านั้นถูกลบด้วย"
        : <span className="text-amber-700">รายการนี้บันทึกแบบเดิม (ไม่ได้เพิ่มมูลค่า และไม่นับเป็นราคาที่ได้มา) · ถ้าเป็นค่าซ่อม / ปรับปรุง ให้กด &ldquo;ลบ&rdquo; แล้วบันทึกใหม่ที่ปุ่ม &ldquo;+ ค่าใช้จ่าย&rdquo; ในกล่อง &ldquo;ค่าใช้จ่ายของทรัพย์สินนี้&rdquo; ด้านล่างของหน้า</span>}</p>
      <div className="flex flex-wrap items-center gap-3 md:col-span-4">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <DeleteSlot />
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <Flash on={state} as="p" className="text-sm text-emerald-700" />
      </div>
    </form>
  );
}
