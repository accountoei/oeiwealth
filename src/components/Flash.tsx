"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast, useInModal } from "./Modal";

/** ข้อความสำเร็จ (สีเขียว) แสดงสักครู่แล้วหายเอง (ตกลง 29 ต.ค. 2026) — ข้อความผิดพลาดไม่ใช้ตัวนี้ (ค้างไว้จนกด / บันทึกใหม่)
 *  on = state ที่ได้จาก server action ({ ok?: string }) · บันทึกใหม่ได้ state ใหม่ → แสดงอีกครั้ง
 *  นับเวลาจากครั้งแรกที่เห็น state นั้น → ปิดแล้วเปิด popup ใหม่หลังหมดเวลา ไม่เห็นข้อความเก่า
 *  นอกหน้าต่าง pop up → แจ้งมุมขวาล่างแทน (ตกลง 29 ต.ค. 2026) · ในหน้าต่างยังแสดงในฟอร์ม (หน้าต่างใช้ข้อความนี้ตัดสินว่าบันทึกสำเร็จ → ปิดเอง + แจ้งมุมจอ) */
const FLASH_MS = 4000;
const firstSeen = new WeakMap<object, number>();
const toasted = new WeakSet<object>();
const left = (on: object) => {
  const t0 = firstSeen.get(on) ?? Date.now();
  if (!firstSeen.has(on)) firstSeen.set(on, t0);
  return t0 + FLASH_MS - Date.now();
};

export default function Flash({ on, as: Tag = "span", className = "text-sm text-emerald-700", children }: {
  on: { ok?: string | null } | null | undefined; as?: "span" | "p" | "div"; className?: string; /** ข้อความแทน on.ok */ children?: ReactNode;
}) {
  const inModal = useInModal();
  const text = useRef<HTMLSpanElement>(null);
  const [gone, setGone] = useState<object | null>(() => (on?.ok && left(on) <= 0 ? on : null));
  useEffect(() => {
    if (!on?.ok) return;
    if (!inModal && !toasted.has(on) && left(on) > 0) {
      toasted.add(on);
      const t = (text.current?.textContent ?? "").trim();
      toast(t.length > 2 ? t : on.ok);                      // ✓ อย่างเดียว → ใช้ข้อความเต็ม
    }
    const t = setTimeout(() => setGone(on), Math.max(left(on), 0));
    return () => clearTimeout(t);
  }, [on, inModal]);
  if (!on?.ok || gone === on) return null;
  if (!inModal) return <span ref={text} hidden>{children ?? on.ok}</span>;
  return <Tag className={className}>{children ?? on.ok}</Tag>;
}
