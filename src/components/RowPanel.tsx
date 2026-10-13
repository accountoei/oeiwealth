"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// กดที่แถวของตาราง → เปิดกล่องแก้ไข / ลบ ใต้แถวนั้น (เปิดได้ทีละแถวทั้งหน้า)
//   ใช้กับคอมโพเนนต์ที่วางไว้ในเซลล์ของแถว (เช่น RowActions) · ไม่อยู่ในตาราง = ใช้ปุ่มแบบเดิม
const OPEN_EVENT = "fwv:row-panel-open";
// คลิกโดนสิ่งที่กดได้อยู่แล้วในแถว (ลิงก์ / ปุ่ม / ช่องกรอก) → ไม่เปิดกล่อง
const INTERACTIVE = "a,button,input,select,textarea,label,form,summary,details,[data-no-row-click]";

export function useRowPanel(enabled: boolean) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [row, setRow] = useState<HTMLTableRowElement | null>(null);
  const [checked, setChecked] = useState(false);        // ตรวจแล้วว่าอยู่ในแถวตารางหรือไม่
  const [open, setOpenState] = useState(false);
  const openRef = useRef(false);
  const [host, setHost] = useState<HTMLElement | null>(null);

  const setOpen = useCallback((v: boolean) => {
    openRef.current = v;
    setOpenState(v);
    if (v) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
  }, [id]);

  // หาแถวที่อยู่ + ทำให้กดได้
  useEffect(() => {
    const tr = enabled ? anchor.current?.closest("tr") ?? null : null;
    setChecked(true);
    if (!tr) return;
    setRow(tr);
    tr.classList.add("cursor-pointer", "hover:bg-slate-50");
    if (!tr.title) tr.title = "กดเพื่อแก้ไข / ลบ";
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(INTERACTIVE)) return;
      if (window.getSelection()?.toString()) return;          // กำลังลากเลือกข้อความ
      setOpen(!openRef.current);
    };
    tr.addEventListener("click", onClick);
    return () => {
      tr.removeEventListener("click", onClick);
      tr.classList.remove("cursor-pointer", "hover:bg-slate-50", "bg-blue-50/60");
      setRow(null);
    };
  }, [enabled, setOpen]);

  // เปิดแถวอื่น → ปิดแถวนี้
  useEffect(() => {
    const onOther = (e: Event) => { if ((e as CustomEvent).detail !== id) { openRef.current = false; setOpenState(false); } };
    window.addEventListener(OPEN_EVENT, onOther);
    return () => window.removeEventListener(OPEN_EVENT, onOther);
  }, [id]);

  // แถวกล่องแก้ไขใต้แถว (สร้างเฉพาะตอนเปิด)
  useEffect(() => {
    if (!row || !open) { setHost(null); return; }
    const panelRow = document.createElement("tr");
    panelRow.setAttribute("data-row-panel", "");
    const td = document.createElement("td");
    td.colSpan = Array.from(row.cells).reduce((s, c) => s + (c.colSpan || 1), 0);
    td.className = "bg-slate-50 px-3 py-2";
    panelRow.appendChild(td);
    row.after(panelRow);
    row.classList.add("bg-blue-50/60");
    setHost(td);
    return () => { panelRow.remove(); row.classList.remove("bg-blue-50/60"); };
  }, [row, open]);

  const inRow = !!row;
  /** ยังไม่รู้ (ก่อนโหลดเสร็จ) หรืออยู่ในแถว = ไม่ต้องแสดงปุ่มแบบเดิม */
  const showButtons = checked && !inRow;
  /** ตัวยึดตำแหน่ง (ใส่ในเซลล์) + กล่องแก้ไขใต้แถวเมื่อเปิด */
  const render = (panel: ReactNode) => (
    <>
      <span ref={anchor} className="hidden" />
      {inRow && open && host ? createPortal(panel, host) : null}
    </>
  );
  return { inRow, showButtons, open, setOpen, render };
}
