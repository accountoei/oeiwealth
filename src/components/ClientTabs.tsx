"use client";

import { TabActionsSlot } from "./TabActions";
import { resetKeptHeight } from "@/components/KeepHeight";
import TabLabel from "./TabLabel";
import { tabClass } from "@/lib/format";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// แท็บที่สลับในเบราว์เซอร์ทันที (ไม่โหลดหน้าใหม่ · หน้าไม่เด้งขึ้นบน)
// ข้อมูลทุกแท็บโหลดมาพร้อมกันตั้งแต่เปิดหน้า · URL เปลี่ยนตาม (?<param>=) → Refresh / ส่งลิงก์ แล้วเปิดแท็บเดิมได้
const Ctx = createContext<{ active: string; setActive: (k: string) => void }>({ active: "", setActive: () => {} });

export function TabsProvider({ initial, param = "tab", defaultKey, children }: {
  initial: string; param?: string; defaultKey?: string; children: ReactNode;
}) {
  const [active, setState] = useState(initial);
  // URL เปลี่ยน ?<param>= จากภายนอก (เช่น กดชื่อเมนูซ้ายของหน้านี้ → กลับแท็บแรก) → สลับแท็บตาม
  useEffect(() => { setState(initial); }, [initial]);
  const setActive = (k: string) => {
    if (k !== active) resetKeptHeight();   // แท็บใหม่ = หน้ายาวพอดีกับแท็บนั้น (ไม่ค้างความสูงของแท็บที่ยาวกว่า)
    setState(k);
    try {
      const u = new URL(window.location.href);
      if (k === defaultKey) u.searchParams.delete(param); else u.searchParams.set(param, k);
      window.history.replaceState(null, "", u);   // null = ให้ Next.js รับรู้ URL ใหม่ด้วย (ไม่หลุดหลังบันทึก)
    } catch { /* แค่ URL ไม่เปลี่ยน */ }
  };
  return <Ctx.Provider value={{ active, setActive }}>{children}</Ctx.Provider>;
}

export function TabNav({ tabs }: { tabs: readonly (readonly [string, string])[] }) {
  const { active, setActive } = useContext(Ctx);
  return (
    <nav className="flex gap-1 text-sm" aria-label="มุมมอง">
      {tabs.map(([k, l]) => (
        <button key={k} type="button" onClick={() => setActive(k)} aria-pressed={active === k}
          className={tabClass(active === k)}>
          <TabLabel>{l}</TabLabel>
        </button>
      ))}
      {/* ปุ่ม "+ เพิ่ม…" ของหน้า (TabActions) ชิดขวาสุดของแถวแท็บ */}
      <TabActionsSlot />
    </nav>
  );
}

/** เนื้อหาของแท็บ (ซ่อนด้วย hidden ไม่ถอดออก → สลับกลับมาไม่ต้องโหลดใหม่) */
export function TabPanel({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const { active } = useContext(Ctx);
  return <div hidden={active !== id} className={className}>{children}</div>;
}
