"use client";

import { useActionState, useState } from "react";
import { saveCostItem, type ActionState } from "./actions";
import { DeleteSlot } from "@/components/RowActions";
import Flash from "@/components/Flash";

export type CostLot = {
  asset_id: string; source: string; item_id: string | null; movement_id: string | null; lot_date: string; amount: number;
  description: string | null; is_building: boolean; depreciation_years: number | null; notes: string | null;
  rate_pct: number; years_held: number; interest: number; depreciation: number;
};

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

/**
 * ต้นทุนเพิ่มที่กรอกเอง (ราคาขายขั้นต่ำที่คุ้ม · ไม่นับใน Net Worth) เช่น ค่าก่อสร้างก่อน go-live
 * อาคาร = หักค่าเสื่อมเส้นตรง (ค่าตั้งต้น 20 ปี) · จ่ายเพิ่มที่บันทึกในระบบ ติ๊กอาคารที่รายการจ่ายแทน (ตกลง 28 ต.ค. 2026)
 */
export default function CostItemForm({ assetId, currency, today, edit }: {
  assetId: string; currency: string; today: string; edit?: CostLot;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCostItem, {});
  const [building, setBuilding] = useState(edit ? edit.is_building : true);
  return (
    <form action={action} className="grid gap-3 md:grid-cols-4">
      <input type="hidden" name="asset_id" value={assetId} />
      {edit?.item_id && <input type="hidden" name="id" value={edit.item_id} />}
      <p className="text-xs text-slate-500 md:col-span-4">ใช้คิดราคาขายขั้นต่ำที่คุ้มเท่านั้น ไม่นับใน Net Worth · ดอกเบี้ยคิดจากวันที่จ่ายถึงวันนี้</p>
      <label className="text-sm">วันที่จ่าย
        <input name="cost_date" type="date" required max={today} defaultValue={edit?.lot_date ?? ""} className={input} /></label>
      <label className="text-sm">ยอดเงิน ({currency})
        <input name="amount" required inputMode="decimal" defaultValue={edit ? String(edit.amount) : ""} className={input} /></label>
      <label className="text-sm md:col-span-2">รายการ
        <input name="description" defaultValue={edit?.description ?? ""} placeholder="เช่น ค่าก่อสร้างบ้าน · ถมดิน · รีโนเวต" className={input} /></label>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" name="is_building" checked={building} onChange={(e) => setBuilding(e.target.checked)} />
        อาคาร / สิ่งปลูกสร้าง (หักค่าเสื่อม)</label>
      {building ? (
        <label className="text-sm">อายุการใช้งาน (ปี)
          <input name="depreciation_years" inputMode="numeric" data-plain defaultValue={String(edit?.depreciation_years ?? 20)} className={input} /></label>
      ) : <input type="hidden" name="depreciation_years" value={String(edit?.depreciation_years ?? 20)} />}
      <label className="text-sm md:col-span-2">หมายเหตุ<input name="notes" defaultValue={edit?.notes ?? ""} className={input} /></label>
      <div className="flex flex-wrap items-center gap-3 md:col-span-4">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกต้นทุน"}</button>
        {edit?.item_id && <DeleteSlot />}
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <Flash on={state} as="p" className="text-sm text-emerald-700" />
      </div>
    </form>
  );
}
