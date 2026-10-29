"use client";

import { useEffect, useState, type ReactNode } from "react";

/** ข้อความสำเร็จ (สีเขียว) แสดงสักครู่แล้วหายเอง (ตกลง 29 ต.ค. 2026) — ข้อความผิดพลาดไม่ใช้ตัวนี้ (ค้างไว้จนกด / บันทึกใหม่)
 *  on = state ที่ได้จาก server action ({ ok?: string }) · บันทึกใหม่ได้ state ใหม่ → แสดงอีกครั้ง
 *  นับเวลาจากครั้งแรกที่เห็น state นั้น → ปิดแล้วเปิด popup ใหม่หลังหมดเวลา ไม่เห็นข้อความเก่า */
const FLASH_MS = 4000;
const firstSeen = new WeakMap<object, number>();
const left = (on: object) => {
  const t0 = firstSeen.get(on) ?? Date.now();
  if (!firstSeen.has(on)) firstSeen.set(on, t0);
  return t0 + FLASH_MS - Date.now();
};

export default function Flash({ on, as: Tag = "span", className = "text-sm text-emerald-700", children }: {
  on: { ok?: string | null } | null | undefined; as?: "span" | "p" | "div"; className?: string; /** ข้อความแทน on.ok */ children?: ReactNode;
}) {
  const [gone, setGone] = useState<object | null>(() => (on?.ok && left(on) <= 0 ? on : null));
  useEffect(() => {
    if (!on?.ok) return;
    const t = setTimeout(() => setGone(on), Math.max(left(on), 0));
    return () => clearTimeout(t);
  }, [on]);
  if (!on?.ok || gone === on) return null;
  return <Tag className={className}>{children ?? on.ok}</Tag>;
}
