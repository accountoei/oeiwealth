"use client";

import { useActionState, useRef, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { deleteEntity, type RecState } from "@/lib/records";
import Modal from "./Modal";

/** ตัวเลือก "ลบ…" ในช่องสถานะ (ทำแบบเดียวกับ "สถานะพอร์ต") */
export type RemoveOpt = {
  kind: "asset" | "liability" | "card" | "lease" | "policy"; id: string; redirectTo?: string; paths?: string[];
  label?: string; hint?: string; needReason?: boolean;
};
export const DELETE_VALUE = "__delete";

/** ฟอร์มยืนยันลบ — ต้องพิมพ์เหตุผล · ถ้ายังมีรายการเงินผูกอยู่ ระบบจะปฏิเสธพร้อมบอกวิธีแก้ */
export function DeleteForm({ kind, id, redirectTo, paths = [], label = "ลบรายการนี้", hint, needReason = true, onCancel }: RemoveOpt & { onCancel: () => void }) {
  const [state, action, pending] = useActionState<RecState, FormData>(deleteEntity, {});
  return (
    <form action={action} className="mt-2 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      {redirectTo && <input type="hidden" name="redirect" value={redirectTo} />}
      <p className="font-medium text-red-800">{label}</p>
      <p className="text-xs text-red-800">
        ใช้เมื่อกรอกผิดหรือบันทึกซ้ำ · ถ้าขาย / ปิด / ยกเลิกจริง ให้เปลี่ยนสถานะแทน เพื่อเก็บประวัติ{hint ? ` · ${hint}` : ""}
      </p>
      {needReason && <input name="reason" required placeholder="เหตุผลที่ลบ (บันทึกใน Audit Log)" className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />}
      <div className="flex items-center gap-2">
        <button disabled={pending} className="rounded-md bg-red-700 px-3 py-1.5 text-xs text-white disabled:opacity-50">{pending ? "กำลังลบ…" : "ยืนยันลบ"}</button>
        <button type="button" onClick={onCancel} className="text-xs text-slate-500">ยกเลิก</button>
      </div>
      {state.error && <p className="text-xs text-red-700">{state.error}</p>}
    </form>
  );
}

/**
 * ช่วยต่อช่องสถานะ (select) ให้มีตัวเลือก "ลบ…": เลือกแล้วเปิดหน้าต่างยืนยัน · ยกเลิก = ช่องกลับเป็นค่าเดิม
 *   const del = useStatusDelete(remove, value);
 *   <select onChange={(e) => { if (del.pick(e)) return; …บันทึกสถานะ… }}>{…}{del.option}</select>{del.dialog}
 */
export function useStatusDelete(remove: RemoveOpt | undefined, value: string) {
  const [ask, setAsk] = useState(false);
  const last = useRef(value);
  const sel = useRef<HTMLSelectElement | null>(null);
  const pick = (e: React.ChangeEvent<HTMLSelectElement>) => {
    sel.current = e.currentTarget;
    if (e.currentTarget.value !== DELETE_VALUE) { last.current = e.currentTarget.value; return false; }
    e.currentTarget.value = last.current;              // ช่องสถานะไม่เปลี่ยน จนกว่าจะยืนยันลบ
    setAsk(true);
    return true;
  };
  const option = remove ? <option value={DELETE_VALUE}>{remove.label ?? "ลบรายการนี้"}…</option> : null;
  const dialog = remove && ask ? (
    <Modal onClose={() => setAsk(false)}>
      <DeleteForm {...remove} onCancel={() => setAsk(false)} />
    </Modal>
  ) : null;
  return { pick, option, dialog };
}

/** ปุ่มลบแยก (ใช้กับรายการย่อยที่ไม่มีช่องสถานะ เช่น สัญญาเช่า) */
export default function DeleteEntity({ kind, id, redirectTo, paths = [], label = "ลบรายการนี้", hint, needReason = true, buttonCls = "text-xs text-red-600 underline" }: RemoveOpt & { buttonCls?: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(buttonCls)}>{label}</button>;
  if (!open) return trigger;
  return present(trigger, (
    <DeleteForm kind={kind} id={id} redirectTo={redirectTo} paths={paths} label={label} hint={hint} needReason={needReason} onCancel={() => setOpen(false)} />
  ));
}
