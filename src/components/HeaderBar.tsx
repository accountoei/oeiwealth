"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useState, useSyncExternalStore, useTransition, type ReactNode, type TransitionStartFunction } from "react";
import { Info } from "lucide-react";
import { createPortal } from "react-dom";
import { NAV, NAV_HREFS } from "./nav";

/**
 * แถบบน (ตกลง 28 ต.ค. 2026 · ปรับ 2 พ.ย. 2026 ดู AppHeader): ชื่อเมนู (ซ้าย) · ช่องค้นหา (ชิดซ้าย ที่เดิมทุกหน้า) · เลือกคน / เดือน ของหน้านั้น · กระดิ่ง / ผู้ใช้ (ขวา)
 *   ตัวเลือกคน / เดือนยังเป็นของแต่ละหน้า (ไม่จำข้ามหน้า) — หน้าส่งเข้ามาที่แถบบนด้วย <HeaderFilters>
 *   เปลี่ยนคน / เดือน = คงหน้าเดิมไว้แต่จางลงจนข้อมูลใหม่มาครบ (ไม่ล้างเป็นโครงเทา → กล่องไม่กระโดด)
 */
export const HEADER_SLOT_ID = "header-filters";
/** ที่วาง ⓘ คำอธิบายหน้า (ข้างชื่อเมนู) */
export const HEADER_INFO_ID = "header-info";

/** ชื่อเมนูของหน้าที่อยู่ (เมนูที่ตรงที่สุด · หน้ารายละเอียด = ชื่อเมนูแม่) */
export function HeaderTitle() {
  const pathname = usePathname();
  const match = (h: string) => (h === "/" ? pathname === "/" : pathname === h || pathname.startsWith(`${h}/`));
  const best = NAV_HREFS.filter(match).sort((a, b) => b.length - a.length)[0];
  const group = NAV.find((g) => (g.match ?? g.href) === best);
  const label = group?.label ?? (pathname === "/search" ? "ผลการค้นหา" : "");
  return <div className="truncate text-base font-semibold text-slate-900 @min-[40rem]:text-lg">{label}</div>;
}

const noSubscribe = () => () => {};

/** ตัวเลือกของหน้า → ไปแสดงที่แถบบนด้านขวา */
export function HeaderFilters({ children }: { children: ReactNode }) {
  // ฝั่งเซิร์ฟเวอร์ / ตอน hydrate = ยังไม่มีที่วาง → วาดหลังโหลดหน้า (ไม่ใช้ setState ใน effect)
  const target = useSyncExternalStore(noSubscribe, () => document.getElementById(HEADER_SLOT_ID), () => null);
  // มือถือ: ช่องเลือกแคบลงเล็กน้อย → คน + เดือนอยู่บรรทัดเดียวกันบนจอ ~390px
  return target ? createPortal(<div className="flex flex-wrap items-center justify-end gap-2 max-md:[&_select]:px-2">{children}</div>, target) : null;
}

/** คำอธิบายหน้า → ไอคอน ⓘ ข้างชื่อเมนูที่แถบบน (ตกลง 28 ต.ค. 2026 · แทนบรรทัดคำอธิบายใต้หัวหน้า) · ชี้ / แตะ = แสดง */
export function PageInfo({ children }: { children: ReactNode }) {
  const target = useSyncExternalStore(noSubscribe, () => document.getElementById(HEADER_INFO_ID), () => null);
  return target ? createPortal(<InfoTip>{children}</InfoTip>, target) : null;
}

/** ไอคอน ⓘ ชี้ / แตะ แล้วแสดงคำอธิบาย · ใช้ที่หัวกล่องได้ด้วย · กล่องคำอธิบายเริ่มที่ไอคอน แล้วเลื่อนซ้ายเองเมื่อทางขวาไม่พอ (ไม่ล้นจอ) */
export function InfoTip({ children, label = "คำอธิบายหน้านี้" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const show = (el: HTMLElement, v: boolean) => {
    if (v) {
      const r = el.getBoundingClientRect(), w = Math.min(352, window.innerWidth * 0.8);
      setShift(Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) - r.left);
    }
    setOpen(v);
  };
  return (
    <span className="relative inline-flex" onMouseEnter={(e) => show(e.currentTarget, true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={(e) => show(e.currentTarget, !open)} onBlur={() => setOpen(false)}
        className="tap rounded-full p-0.5 text-slate-400 hover:text-slate-700"><Info className="h-4 w-4" /></button>
      {/* whitespace-normal / text-left: กล่องไม่รับค่าจากที่วาง (หัวตารางที่ nowrap → ข้อความล้นกล่องทับตาราง · แก้ 8 พ.ย. 2026) */}
      {open && (
        <span role="tooltip" style={{ left: shift }} className={`absolute top-full z-30 mt-1 w-[min(22rem,80vw)] whitespace-normal rounded-lg border border-slate-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed text-slate-600 shadow-lg`}>
          {children}
        </span>
      )}
    </span>
  );
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
