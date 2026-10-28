"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * ปุ่ม "+ เพิ่ม…" ของหน้า → ไปอยู่ท้ายแถวแท็บ ชิดขวา ตำแหน่งเดียวกันทุกเมนู (ตกลง 28 ต.ค. 2026)
 *   แถวแท็บ (TabNav / SectionTabs) วาง <TabActionsSlot /> · หน้าห่อปุ่มด้วย <TabActions>
 *   ใช้ store เล็ก ๆ แทน getElementById: แถวแท็บกับปุ่มวาดในรอบเดียวกัน → ปุ่มรู้ตัวเมื่อที่วางพร้อม
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const setSlot = (el: HTMLElement | null) => {
  if (el === null && slot && slot.isConnected) return;   // แถวแท็บอีกอันยังอยู่
  slot = el;
  listeners.forEach((f) => f());
};

export function TabActionsSlot() {
  // ขนาดปุ่มเท่ากันทุกเมนู: ปุ่ม / ลิงก์ในที่วางนี้ใช้ขนาดเดียวกับ ADD_BTN (ฟอร์มที่เปิดเป็น pop up อยู่นอกที่วางนี้ ไม่โดน)
  return <div ref={setSlot} className="ml-auto flex shrink-0 items-center gap-2 self-center pb-1 pl-3 empty:hidden [&_a]:!px-3 [&_a]:!py-1.5 [&_a]:!text-sm [&_button]:!px-3 [&_button]:!py-1.5 [&_button]:!text-sm" />;
}

export function TabActions({ children }: { children: ReactNode }) {
  const target = useSyncExternalStore(subscribe, () => slot, () => null);
  return target ? createPortal(children, target) : null;
}
