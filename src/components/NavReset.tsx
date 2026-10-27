"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

/** Sidebar ส่งเมื่อกดเมนูของหน้าที่อยู่: "now" = URL เดิมอยู่แล้ว · "next" = รอหน้าใหม่มาก่อน */
export const NAV_RESET_EVENT = "fwv:nav-reset";

/**
 * กดชื่อเมนูซ้ายของหน้าที่อยู่ → กลับหน้าหลักของเมนูจริง ๆ (ตกลง 27 ต.ค. 2026)
 * Next.js เก็บสถานะในหน้า (แท็บ / ตัวกรอง / ช่องที่กางไว้) ไว้เมื่อไปหน้า path เดิม → สร้างเนื้อหาหน้าใหม่ (key) หลัง URL เปลี่ยน
 * ไม่โหลดข้อมูลเพิ่ม: ใช้ข้อมูลหน้าที่ได้จากการกดลิงก์ตามปกติ
 */
export default function NavReset({ children }: { children: ReactNode }) {
  const [n, setN] = useState(0);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const waiting = useRef(false);

  useEffect(() => {
    const onReset = (e: Event) => {
      if ((e as CustomEvent).detail === "now") { setN((x) => x + 1); window.scrollTo(0, 0); }
      else waiting.current = true;
    };
    window.addEventListener(NAV_RESET_EVENT, onReset);
    return () => window.removeEventListener(NAV_RESET_EVENT, onReset);
  }, []);

  useEffect(() => {
    if (!waiting.current) return;
    waiting.current = false;
    setN((x) => x + 1);   // รีเซ็ตหลังหน้าใหม่มาถึง
    window.scrollTo(0, 0);
  }, [pathname, search]);

  return <Fragment key={n}>{children}</Fragment>;
}
