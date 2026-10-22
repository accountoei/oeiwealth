"use client";

import { useActionState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { overrideFx, type FxState } from "./actions";
import { CurrencySelect } from "@/components/CurrencyContext";
import { FX_BTN } from "./FxRefreshButton";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/** ปุ่ม "FX Override" (ADMIN) → pop up ใส่อัตราเอง */
export default function OverrideForm({ today }: { today: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<FxState, FormData>(overrideFx, {});
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(FX_BTN)}>FX Override</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-3">
      <h2 className="font-medium text-slate-900">FX Override (ADMIN)</h2>
      <p className="text-xs text-slate-500">ใช้เฉพาะเมื่อแหล่งอัตราไม่มีข้อมูลหรือระบบดึงไม่สำเร็จ · ระบบดึงอัตโนมัติจะไม่เขียนทับค่าที่ Override · บันทึกใน Audit Log · วันที่อยู่ในเดือนที่ปิดงวดแล้วแก้ไม่ได้ (ต้อง Reopen ก่อน)</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">วันที่ของ Rate<input name="rate_date" type="date" required max={today} className={input} /></label>
        <label className="text-sm">สกุลเงิน
          <CurrencySelect name="currency" className={input} exclude={["THB"]} />
        </label>
        <label className="text-sm">1 หน่วย = ? บาท<input name="rate_to_thb" required inputMode="decimal" className={input} /></label>
      </div>
      <label className="block text-sm">เหตุผล *<input name="reason" required placeholder="เช่น ธปท. ไม่มีข้อมูลวันนี้" className={input} /></label>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก Override"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-emerald-700">{state.ok}</p>}
    </form>
  ));
}
