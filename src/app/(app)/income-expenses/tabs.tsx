"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// สลับแท็บในเบราว์เซอร์ทันที ไม่ต้องโหลดหน้าใหม่ (ข้อมูลทุกแท็บโหลดมาพร้อมกันตั้งแต่เปิดหน้าอยู่แล้ว)
// URL ยังเปลี่ยนตาม (?tab=) → กด Refresh / ส่งลิงก์ต่อ แล้วเปิดแท็บเดิมได้
const Ctx = createContext<{ active: string; setActive: (k: string) => void }>({ active: "overview", setActive: () => {} });

export function TabsProvider({ initial, children }: { initial: string; children: ReactNode }) {
  const [active, setState] = useState(initial);
  // ลิงก์ในหน้าเดียวกันที่เปลี่ยน ?tab= (เช่น "ดูรายการทั้งหมด →") → สลับแท็บตามทันที ไม่ต้อง Refresh
  useEffect(() => { setState(initial); }, [initial]);
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

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  const { active } = useContext(Ctx);
  return <div hidden={active !== id} className="space-y-6">{children}</div>;
}

/** ลิงก์ไปแท็บอื่นในหน้านี้ · สลับแท็บทันที (ไม่ต้องรอโหลด / Refresh) */
export function TabLink({ tab, href, className, children }: { tab: string; href: string; className?: string; children: ReactNode }) {
  const { setActive } = useContext(Ctx);
  return (
    <Link href={href} scroll={false} className={className}
      onClick={() => { setActive(tab); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{children}</Link>
  );
}
