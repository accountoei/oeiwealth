"use client";

import { createContext, useActionState, useContext, useId, type ReactNode } from "react";
import { updateRecord, type RecState } from "@/lib/records";
import { useStatusDelete, type RemoveOpt } from "./DeleteEntity";

type Props = {
  table: string; id: string; value: string; options: [string, string][]; paths: string[]; field?: string; label?: string;
  remove?: RemoveOpt;
};

/** ช่องสถานะ (select) + ฟอร์มบันทึกของมันแยกกัน — ช่องผูกกับฟอร์มด้วย form={id} จึงวางไว้ในฟอร์มอื่นได้ (ข้างปุ่มบันทึก) */
function useStatusControl(p: Props | undefined) {
  const [state, action, pending] = useActionState<RecState, FormData>(updateRecord, {});
  const del = useStatusDelete(p?.remove, p?.value ?? "");
  const formId = `status-${useId()}`;
  if (!p) return { control: null, form: null };
  const control = (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="text-xs text-slate-500">{p.label ?? "สถานะ"}</span>
      <select form={formId} name={`f_${p.field ?? "status"}`} defaultValue={p.value} disabled={pending}
        onChange={(e) => { if (del.pick(e)) return; e.currentTarget.form?.requestSubmit(); }}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm">
        {p.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        {del.option}
      </select>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      {state.ok && <span className="text-xs text-emerald-700">✓</span>}
    </span>
  );
  const form = (
    <>
      <form id={formId} action={action} className="hidden">
        <input type="hidden" name="table" value={p.table} />
        <input type="hidden" name="id" value={p.id} />
        <input type="hidden" name="paths" value={p.paths.join(",")} />
      </form>
      {del.dialog}
    </>
  );
  return { control, form };
}

/**
 * เปลี่ยนสถานะทันทีเมื่อเลือก (เช่น ปิดบัญชี / ขายแล้ว)
 *   remove: เพิ่มตัวเลือก "ลบ…" ท้ายรายการ (ADMIN / EDITOR) → หน้าต่างยืนยันลบ (แบบเดียวกับ "สถานะพอร์ต")
 */
export default function StatusSelect(props: Props) {
  const s = useStatusControl(props);
  return <>{s.control}{s.form}</>;
}

const StatusSlotCtx = createContext<ReactNode>(null);
/** ที่วางช่องสถานะของ <WithStatus> — ใส่ไว้ข้างปุ่มบันทึกของฟอร์มแก้ไข · นอก WithStatus ไม่แสดงอะไร */
export function StatusSlot() { return useContext(StatusSlotCtx); }

/**
 * ฟอร์มแก้ไขข้อมูล + ช่องสถานะ (ที่มี "ลบ…" อยู่ข้างใน) ข้างปุ่มบันทึก (ตกลง 27 ต.ค. 2026)
 *   <WithStatus status={{…}}><EditXForm /></WithStatus> · EditXForm วาง <StatusSlot /> ต่อจากปุ่มบันทึก
 *   ช่องสถานะยังบันทึกทันทีเมื่อเลือก (ไม่ต้องกดบันทึก) · status2 = ช่องที่สอง (เช่น ธุรกิจ: สถานะกิจการ + นับเป็นทรัพย์สิน)
 */
export function WithStatus({ status, status2, children }: { status: Props; status2?: Props; children: ReactNode }) {
  const a = useStatusControl(status);
  const b = useStatusControl(status2);
  return (
    <>
      <StatusSlotCtx.Provider value={<>{a.control}{b.control}</>}>{children}</StatusSlotCtx.Provider>
      {a.form}{b.form}
    </>
  );
}
