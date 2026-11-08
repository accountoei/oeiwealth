"use client";

import { TabActionsSlot } from "./TabActions";
import { resetKeptHeight } from "@/components/KeepHeight";
import TabLabel from "./TabLabel";
import { tabClass } from "@/lib/format";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

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

// ขอบจางของแถวแท็บ (มีแท็บซ่อนอยู่ด้านซ้าย / ขวา) · เขียนเต็มทุกแบบเพื่อให้ Tailwind สร้าง class
const FADE = {
  "": "",
  L: "[mask-image:linear-gradient(to_right,transparent,#000_2.5rem)]",
  R: "[mask-image:linear-gradient(to_right,#000_calc(100%_-_2.5rem),transparent)]",
  LR: "[mask-image:linear-gradient(to_right,transparent,#000_2.5rem,#000_calc(100%_-_2.5rem),transparent)]",
} as const;

/**
 * แถวแท็บ + ปุ่ม "+ เพิ่ม…" ของหน้า (TabActions) ชิดขวา
 *   จอแคบ (มือถือ · 8 พ.ย. 2026): ชื่อแท็บบรรทัดเดียว ไม่ตัดคำ · แท็บยาวเกินจอ = ปัดแถวแท็บซ้าย–ขวา ขอบจางบอกว่ายังมีแท็บ
 *   แท็บกับปุ่มวางแถวเดียวไม่พอ → ปุ่มขึ้นไปแถวบนชิดขวา (flex-wrap-reverse) · ปุ่มหลายปุ่มตัดบรรทัดในแถวของปุ่มเอง
 *   แท็บที่เลือกเลื่อนมาให้เห็นเสมอ (เลื่อนเฉพาะแถวแท็บ ไม่เลื่อนหน้า) · จอกว้างหน้าตาเหมือนเดิม
 */
export function TabNav({ tabs }: { tabs: readonly (readonly [string, string])[] }) {
  const { active, setActive } = useContext(Ctx);
  const row = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<keyof typeof FADE>("");
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const sync = () => {
      const l = el.scrollLeft > 1, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setFade(l && r ? "LR" : l ? "L" : r ? "R" : "");
    };
    const b = el.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (b && el.scrollWidth > el.clientWidth) {
      if (b.offsetLeft < el.scrollLeft) el.scrollLeft = b.offsetLeft;
      else if (b.offsetLeft + b.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = b.offsetLeft + b.offsetWidth - el.clientWidth;
    }
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", sync); ro.disconnect(); };
  }, [active]);
  return (
    <nav className="flex flex-wrap-reverse items-end gap-x-1 gap-y-2 text-sm" aria-label="มุมมอง">
      {/* -mb-px ที่แถว (ไม่ใช่ที่แท็บ): แถวเลื่อนได้ตัดส่วนที่ล้นทิ้ง · เส้นใต้สีน้ำเงินยังทับเส้นเทาของหน้าเหมือนเดิม */}
      <div ref={row} className={`relative -mb-px flex min-w-0 max-w-full gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${FADE[fade]}`}>
        {tabs.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setActive(k)} aria-pressed={active === k}
            className={`shrink-0 whitespace-nowrap ${tabClass(active === k).replace("-mb-px ", "")}`}>
            <TabLabel>{l}</TabLabel>
          </button>
        ))}
      </div>
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
