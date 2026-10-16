"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// กดที่แถวของตาราง → เปิดกล่องแก้ไข / ลบ ใต้แถวนั้น (เปิดได้ทีละแถวทั้งหน้า)
//   ใช้กับคอมโพเนนต์ที่วางไว้ในเซลล์ของแถว (เช่น RowActions) · ไม่อยู่ในตาราง = ใช้ปุ่มแบบเดิม
//   กดที่อื่น (นอกแถว / กล่อง) · กด Esc · สลับแท็บ → ปิดเอง
//   เปิดแล้วแถวที่กดอยู่ตำแหน่งเดิมบนจอ (ไม่กระโดดเพราะกล่องของแถวอื่นปิด) · กล่องเลื่อนมาให้เห็นเท่าที่จำเป็น
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
  const anchorTop = useRef<number | null>(null);         // ตำแหน่งแถวบนจอตอนกด (ไว้คงที่หลังเปิด)

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
      anchorTop.current = openRef.current ? null : tr.getBoundingClientRect().top;
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
    panelRow.appendChild(td);
    td.className = "border-l-4 border-blue-500 bg-blue-50/40 px-4 py-3";
    row.after(panelRow);
    row.classList.add("bg-blue-50/60");
    setHost(td);
    // แถวที่กดอยู่ที่เดิมบนจอ (กล่องของแถวอื่นที่ปิดไปทำให้เนื้อหาเลื่อน) แล้วเลื่อนให้เห็นกล่องเท่าที่จำเป็น
    if (anchorTop.current != null) {
      const shift = row.getBoundingClientRect().top - anchorTop.current;
      if (Math.abs(shift) > 1) window.scrollBy({ top: shift, behavior: "instant" as ScrollBehavior });
      anchorTop.current = null;
    }
    const raf = requestAnimationFrame(() => panelRow.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    // กดที่อื่น / Esc → ปิด
    const close = () => { openRef.current = false; setOpenState(false); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || row.contains(t) || panelRow.contains(t)) return;
      if ((t as HTMLElement).closest?.("[role=dialog],[data-keep-row-panel]")) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      panelRow.remove(); row.classList.remove("bg-blue-50/60");
    };
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
