"use client";

import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Modal from "./Modal";

// แถวปุ่มคำสั่ง: ปุ่มอยู่แถวบนตลอด · กดปุ่มไหน ฟอร์มนั้นเปิดเป็นหน้าต่าง pop up (Modal) ทีละฟอร์ม
// ฟอร์มที่เปิดค้างตั้งแต่แรก (initial) ไม่ใช่ pop up: กาง "ใต้แถว" ใน <ActionBar> หรือแทนที่ปุ่มเหมือนเดิม
type Ctx = { active: string | null; setActive: (k: string | null) => void; panel: HTMLElement | null };
const BarCtx = createContext<Ctx | null>(null);

export function ActionBar({ children, right, className = "" }: { children: ReactNode; right?: ReactNode; className?: string }) {
  const [active, setActive] = useState<string | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  return (
    <BarCtx.Provider value={{ active, setActive, panel }}>
      <div className={className}>
        {/* ปุ่มซ้ายขึ้นบรรทัดใหม่ได้ · ส่วนขวา (เช่น สถานะพอร์ต) อยู่บรรทัดแรกชิดขวาเสมอ */}
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">{children}</div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
        <div ref={setPanel} className="[&:not(:empty)]:mt-3" />
      </div>
    </BarCtx.Provider>
  );
}

/**
 * ใช้แทน useState(false) ของฟอร์มที่เปิดจากปุ่ม
 *   const { open, setOpen, present, activeCls } = useActionSlot();
 *   const trigger = <button onClick={() => setOpen(!open)} className={activeCls(cls)}>…</button>;
 *   if (!open) return trigger;
 *   return present(trigger, <form>…</form>);
 */
export function useActionSlot(initial = false, opts: { modal?: boolean; size?: "md" | "lg" } = {}) {
  const modal = opts.modal ?? !initial;                       // ค่าเริ่มต้น: pop up · ฟอร์มที่เปิดค้างตั้งแต่แรก = กางในหน้า
  const bar = useContext(BarCtx);
  const id = useId();
  const [local, setLocal] = useState(initial);
  const setBarActive = bar?.setActive;
  // เปิดฟอร์มค้างไว้ตั้งแต่แรก (เช่น มาจากลิงก์ที่สั่งให้เปิดฟอร์มนี้)
  useEffect(() => { if (initial && setBarActive) setBarActive(id); }, [initial, setBarActive, id]);
  const inBar = !!bar;
  const open = bar ? bar.active === id : local;
  const setOpen = (v: boolean) => (bar ? bar.setActive(v ? id : null) : setLocal(v));
  const activeCls = (cls: string) => (inBar && open ? `${cls} ring-2 ring-blue-500 ring-offset-1` : cls);
  const present = (trigger: ReactNode, form: ReactNode) =>
    modal ? <>{trigger}{open && <Modal size={opts.size} onClose={() => setOpen(false)}>{form}</Modal>}</>
    : bar && bar.panel ? <>{trigger}{createPortal(form, bar.panel)}</> : <>{form}</>;
  return { open, setOpen, present, activeCls, inBar };
}

/**
 * แถวตารางที่มีปุ่มคำสั่งในช่องท้าย · กดปุ่ม → ฟอร์มกางเป็นแถวใหม่ "ใต้แถวนี้" (เต็มความกว้างตาราง)
 *   ใช้กับฟอร์มที่เปิดด้วย useActionSlot (เช่น บันทึกรับ / บันทึกจ่าย)
 */
export function ActionRow({ cells, actions, colSpan, className = "" }: {
  cells: ReactNode; actions?: ReactNode; colSpan: number; className?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [panel, setPanel] = useState<HTMLTableCellElement | null>(null);
  return (
    <BarCtx.Provider value={{ active, setActive, panel }}>
      <tr className={`align-top ${active ? "bg-blue-50/60" : ""} ${className}`}>
        {cells}
        <td className="py-2 pl-2 text-right">
          {actions && <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 whitespace-nowrap">{actions}</div>}
        </td>
      </tr>
      <tr hidden={!active} className="has-[>td:empty]:hidden">
        <td ref={setPanel} colSpan={colSpan} className="bg-slate-50 px-3 py-3" />
      </tr>
    </BarCtx.Provider>
  );
}
