"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const RESET_EVENT = "fwv:keep-height-reset";

/** เรียกเมื่อกดเปลี่ยนแท็บ → ล้างความสูงที่จำไว้ (หน้ายาวพอดีกับแท็บใหม่ · ตกลง 5 พ.ย. 2026) */
export function resetKeptHeight() {
  try { window.dispatchEvent(new Event(RESET_EVENT)); } catch { /* ไม่เป็นไร */ }
}

/**
 * กันหน้าจอเด้งเมื่อกดตัวกรอง / เปลี่ยนเดือน: ระหว่างอยู่หน้าเดิม (path เดิม เปลี่ยนแค่ ?…) เนื้อหาไม่หดต่ำกว่าความสูงที่เคยมี
 * — ผลกรองสั้นลง browser จะไม่ดึงหน้าจอขึ้น (เหลือที่ว่างด้านล่างแทน) · เปลี่ยนหน้า หรือกดเปลี่ยนแท็บ (resetKeptHeight) → เริ่มนับใหม่
 */
export default function KeepHeight({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.minHeight = "";
    let max = 0;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h > max) { max = h; el.style.minHeight = `${max}px`; }
    });
    ro.observe(el);
    // แท็บใหม่: ปล่อยความสูง · ResizeObserver จะจำความสูงของแท็บใหม่เองเมื่อเนื้อหาเปลี่ยน
    const reset = () => { max = 0; el.style.minHeight = ""; };
    window.addEventListener(RESET_EVENT, reset);
    return () => { ro.disconnect(); window.removeEventListener(RESET_EVENT, reset); };
  }, [pathname]);
  return <div ref={ref}>{children}</div>;
}
