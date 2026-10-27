"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DeleteSlot } from "@/components/RowActions";
import { updateTransfer, type ActionState } from "./actions";

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";

/** แก้เงินโอนระหว่างบัญชี: บัญชีต้นทาง / ปลายทาง · วันที่ · ยอด · ค่าธรรมเนียม · รายละเอียด (บันทึกครั้งเดียว) */
export default function TransferEditor({ id, banks, values }: {
  id: string; banks: { asset_id: string; name: string }[];
  values: { from: string; to: string; date: string; amount: number; fee: number | null; description: string | null };
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateTransfer, {});
  const router = useRouter();
  useEffect(() => { if (state.ok) router.refresh(); }, [state, router]);
  const f = (label: string, el: React.ReactNode) => <label className="text-xs text-slate-600">{label}{el}</label>;
  const cls = `mt-0.5 block ${small}`;
  return (
    <form action={action} className="flex w-full flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      {f("จากบัญชี", (
        <select name="from_asset_id" defaultValue={values.from} className={cls}>
          {banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
        </select>
      ))}
      {f("ไปบัญชี", (
        <select name="to_asset_id" defaultValue={values.to} className={cls}>
          {banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
        </select>
      ))}
      {f("วันที่", <input name="movement_date" type="date" required defaultValue={values.date} className={cls} />)}
      {f("จำนวน", <input name="amount" inputMode="decimal" required defaultValue={String(values.amount)} className={`${cls} w-32`} />)}
      {f("ค่าธรรมเนียม", <input name="fee" inputMode="decimal" defaultValue={values.fee == null ? "" : String(values.fee)} className={`${cls} w-28`} />)}
      {f("รายละเอียด", <input name="description" defaultValue={values.description ?? ""} className={`${cls} w-44`} />)}
      <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50">
        {pending ? "กำลังบันทึก…" : "บันทึก"}</button>
      <DeleteSlot />
      {state.error && <span className="w-full text-xs text-red-600">{state.error}</span>}
      {state.ok && <span className="text-xs text-emerald-700">{state.ok}</span>}
    </form>
  );
}
