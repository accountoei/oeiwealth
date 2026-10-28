"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, useTransition, type ReactNode, type TransitionStartFunction } from "react";
import { createPortal } from "react-dom";
import { NAV, NAV_HREFS } from "./nav";

/**
 * แถบบน (ตกลง 28 ต.ค. 2026): ชื่อเมนู (ซ้าย) · ช่องค้นหา (กลาง) · เลือกคน / เดือน ของหน้านั้น (ขวา)
 *   ตัวเลือกคน / เดือนยังเป็นของแต่ละหน้า (ไม่จำข้ามหน้า) — หน้าส่งเข้ามาที่แถบบนด้วย <HeaderFilters>
 *   เปลี่ยนคน / เดือน = คงหน้าเดิมไว้แต่จางลงจนข้อมูลใหม่มาครบ (ไม่ล้างเป็นโครงเทา → กล่องไม่กระโดด)
 */
export const HEADER_SLOT_ID = "header-filters";

/** ชื่อเมนูของหน้าที่อยู่ (เมนูที่ตรงที่สุด · หน้ารายละเอียด = ชื่อเมนูแม่) */
export function HeaderTitle() {
  const pathname = usePathname();
  const match = (h: string) => (h === "/" ? pathname === "/" : pathname === h || pathname.startsWith(`${h}/`));
  const best = NAV_HREFS.filter(match).sort((a, b) => b.length - a.length)[0];
  const group = NAV.find((g) => (g.match ?? g.href) === best);
  return <div className="truncate text-lg font-semibold text-slate-900">{group?.label ?? ""}</div>;
}

/** ตัวเลือกของหน้า → ไปแสดงที่แถบบนด้านขวา */
export function HeaderFilters({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setTarget(document.getElementById(HEADER_SLOT_ID)), []);
  return target ? createPortal(<div className="flex flex-wrap items-center justify-end gap-2">{children}</div>, target) : null;
}

const Pending = createContext<{ pending: boolean; start: TransitionStartFunction }>({ pending: false, start: (f) => { void f(); } });
/** ตัวเลือกคน / เดือนใช้ start(() => router.push(...)) → ระหว่างรอ หน้าเดิมจาง (ไม่ล้างหน้า) */
export const useNavPending = () => useContext(Pending);

export function NavPendingProvider({ children }: { children: ReactNode }) {
  const [pending, start] = useTransition();
  return <Pending.Provider value={{ pending, start }}>{children}</Pending.Provider>;
}

/** เนื้อหาหน้า: จางระหว่างโหลดข้อมูลคน / เดือนใหม่ */
export function PendingArea({ children }: { children: ReactNode }) {
  const { pending } = useNavPending();
  return <div aria-busy={pending} className={pending ? "pointer-events-none opacity-50 transition-opacity duration-300" : "transition-opacity"}>{children}</div>;
}

/** แถบโหลดบาง ๆ ใต้แถบบน */
export function PendingBar() {
  const { pending } = useNavPending();
  if (!pending) return null;
  return <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-blue-100"><div className="h-full w-1/3 animate-[pending_1s_ease-in-out_infinite] bg-blue-500" /></div>;
}
