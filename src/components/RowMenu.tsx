"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * ปุ่ม "จัดการ ▾" ท้ายแถว → เมนูเล็กรวมคำสั่งของแถวนั้น (บันทึกรับ / จ่าย · แก้ไข · ลบ · แยกรายละเอียด ฯลฯ)
 *   คำสั่งข้างในเปิดหน้าต่าง pop up ของตัวเอง · เมนูซ่อน (ไม่ถูกถอด) เพื่อให้หน้าต่างที่เปิดจากเมนูยังอยู่
 *   เมนูวางลอยบนสุดของหน้า (ไม่ถูกตัดโดยตารางที่เลื่อนซ้ายขวาได้)
 */
export default function RowMenu({ children, label = "จัดการ" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => setMounted(true), []);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: Math.max(window.innerWidth - r.right, 8) });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || panel.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.("[role=dialog]")) return;           // คลิกในหน้าต่าง pop up ที่เปิดจากเมนู
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onMove = () => setOpen(false);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className={`whitespace-nowrap rounded-md border px-2.5 py-1 text-xs ${open ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
        {label} ▾
      </button>
      {mounted && createPortal(
        <div ref={panel} hidden={!open} style={pos ? { top: pos.top, right: pos.right } : undefined}
          className="fixed z-40 w-max min-w-44 max-w-xs rounded-lg border border-slate-200 bg-white p-3 text-left text-sm shadow-lg"
          // กดคำสั่งในเมนู → ซ่อนเมนู (หน้าต่างของคำสั่งนั้นเปิดต่อ)
          onClickCapture={(e) => { if ((e.target as HTMLElement).closest("button,a")) setTimeout(() => setOpen(false), 0); }}>
          <div className="flex flex-col items-start gap-2.5">{children}</div>
        </div>,
        document.body,
      )}
    </>
  );
}
