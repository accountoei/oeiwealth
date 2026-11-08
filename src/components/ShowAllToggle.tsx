"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * กล่องที่ซ่อนแถวว่างไว้ + ปุ่ม "แสดงทุกหัวข้อ" (ตกลง 8 พ.ย. 2026 · แท็บความคุ้มครอง)
 *   หน้าเซิร์ฟเวอร์ส่งแถวมาครบ · แถวที่ซ่อนได้ใส่ "hidden group-data-[all=1]/all:table-row" (tbody: table-row-group)
 *   ปุ่มสลับแค่ data-all ของกล่อง (ไม่โหลดหน้าใหม่)
 */
const Ctx = createContext<{ all: boolean; toggle: () => void } | null>(null);

export function ShowAllBox({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [all, setAll] = useState(false);
  return (
    <Ctx.Provider value={{ all, toggle: () => setAll((v) => !v) }}>
      <section data-all={all ? "1" : "0"} className={`group/all ${className}`}>{children}</section>
    </Ctx.Provider>
  );
}

export function ShowAllButton({ off = "แสดงทุกหัวข้อ", on = "แสดงเฉพาะที่มี" }: { off?: string; on?: string }) {
  const c = useContext(Ctx);
  if (!c) return null;
  return <button type="button" onClick={c.toggle} aria-pressed={c.all} className="text-sm text-blue-700 hover:underline">{c.all ? on : off}</button>;
}
