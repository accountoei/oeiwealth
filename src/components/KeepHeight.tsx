"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * กันหน้าจอเด้งเมื่อกดตัวกรอง / แท็บ: ระหว่างอยู่หน้าเดิม (path เดิม เปลี่ยนแค่ ?…) เนื้อหาไม่หดต่ำกว่าความสูงที่เคยมี
 * — ผลกรองสั้นลง browser จะไม่ดึงหน้าจอขึ้น (เหลือที่ว่างด้านล่างแทน) · เปลี่ยนหน้า → เริ่มนับใหม่
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
    return () => ro.disconnect();
  }, [pathname]);
  return <div ref={ref}>{children}</div>;
}
