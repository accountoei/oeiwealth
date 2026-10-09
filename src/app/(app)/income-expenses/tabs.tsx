"use client";

import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";

// สลับแท็บในเบราว์เซอร์ทันที ไม่ต้องโหลดหน้าใหม่ (ข้อมูลทุกแท็บโหลดมาพร้อมกันตั้งแต่เปิดหน้าอยู่แล้ว)
// URL ยังเปลี่ยนตาม (?tab=) → กด Refresh / ส่งลิงก์ต่อ แล้วเปิดแท็บเดิมได้
const Ctx = createContext<{ active: string; setActive: (k: string) => void }>({ active: "overview", setActive: () => {} });

export function TabsProvider({ initial, children }: { initial: string; children: ReactNode }) {
  const [active, setState] = useState(initial);
  const setActive = (k: string) => {
    setState(k);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("tab", k);
      window.history.replaceState(window.history.state, "", u);
    } catch { /* ไม่เป็นไร แค่ URL ไม่เปลี่ยน */ }
  };
  return <Ctx.Provider value={{ active, setActive }}>{children}</Ctx.Provider>;
}

export function TabNav({ tabs }: { tabs: [string, string][] }) {
  const { active, setActive } = useContext(Ctx);
  return (
    <nav className="flex gap-1 border-b border-slate-200">
      {tabs.map(([k, l]) => (
        <button key={k} type="button" onClick={() => setActive(k)}
          className={`-mb-px border-b-2 px-4 py-2 text-sm ${active === k ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{l}</button>
      ))}
    </nav>
  );
}

/** ปุ่มเลื่อนเดือน (โหลดข้อมูลเดือนใหม่จาก Server) · คงแท็บที่เปิดอยู่ */
export function MonthNav({ prev, next, label }: { prev: string; next: string; label: string }) {
  const { active } = useContext(Ctx);
  const href = (m: string) => `/income-expenses?tab=${active}&m=${m}`;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Link href={href(prev)} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">←</Link>
      <span className="min-w-28 text-center font-medium">{label}</span>
      <Link href={href(next)} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">→</Link>
    </div>
  );
}

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  const { active } = useContext(Ctx);
  return <div hidden={active !== id} className="space-y-6">{children}</div>;
}
