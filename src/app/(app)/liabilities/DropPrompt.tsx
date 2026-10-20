"use client";

import { useActionState, useState } from "react";
import { money, thDate } from "@/lib/format";
import { payFromDrop, type ActionState, type Drop } from "./actions";
import BalanceGuard from "@/components/BalanceGuard";

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";

/**
 * หลังบันทึกยอดตาม Statement ที่ต่ำกว่าที่คำนวณ: ระบบลงส่วนที่ลดเป็นรายได้ก้อนรอแยกไว้แล้ว
 * กล่องนี้ถามต่อว่า "เป็นการจ่ายหรือไม่" → ลงเป็นการจ่ายจากบัญชี (ก้อนลด / หายเอง) หรือ "ไม่ใช่" (เก็บเป็นรายได้รอแยก)
 */
export default function DropPrompt({ drop, currency, banks }: {
  drop: Drop; currency: string; banks: { asset_id: string; name: string }[];
}) {
  const [closed, setClosed] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(payFromDrop, {});
  if (closed) return null;
  if (state.ok) return <p className="w-full text-sm text-emerald-700">{state.ok}</p>;
  const what = drop.kind === "CARD" ? "ยอดบัตร" : "ยอดหนี้";
  return (
    <form action={action} className="w-full space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <input type="hidden" name="kind" value={drop.kind} />
      <input type="hidden" name="id" value={drop.id} />
      <input type="hidden" name="date" value={drop.date} />
      <p className="text-amber-900">
        {what}ลดลงมากกว่าที่บันทึก <b className="tabular-nums">{money(drop.amount, currency)}</b> — เป็นการจ่าย{drop.kind === "CARD" ? "บัตร" : "หนี้"}จากบัญชีที่ยังไม่ได้บันทึกหรือไม่?
      </p>
      {banks.length === 0 ? (
        <p className="text-xs text-amber-800">ไม่มีบัญชีสกุล {currency} ให้เลือก · ส่วนต่างเก็บเป็นรายได้ก้อนรอแยกไว้แล้ว</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">จ่ายจากบัญชี
            <select name="bank_asset_id" required defaultValue="" className={`mt-1 block ${small}`}>
              <option value="">— เลือก —</option>
              {banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
            </select>
          </label>
          <label className="text-xs">ยอดที่จ่าย ({currency})
            <input name="amount" required inputMode="decimal" defaultValue={drop.amount.toFixed(2)} className={`mt-1 block w-32 ${small}`} />
          </label>
          <span className="pb-1.5 text-xs text-slate-600">วันที่ {thDate(drop.date)}</span>
          <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50">
          <BalanceGuard />
            {pending ? "กำลังบันทึก…" : "ลงเป็นการจ่าย"}
          </button>
          <button type="button" onClick={() => setClosed(true)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700">
            ไม่ใช่การจ่าย
          </button>
        </div>
      )}
      <p className="text-xs text-slate-500">
        ลงเป็นการจ่าย → เงินออกจากบัญชีวันเดียวกับยอด · รายได้ก้อนรอแยกลดลงตามยอดที่จ่าย (ยอดที่เหลือยังแยกได้ที่ Income &amp; Expenses)
        · ไม่ใช่การจ่าย → เก็บเป็นรายได้ก้อนรอแยก{drop.kind === "CARD" ? " (เงินคืน / เครดิต)" : " (ส่วนลด / ลดหนี้)"} ไว้แยกทีหลัง
      </p>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
