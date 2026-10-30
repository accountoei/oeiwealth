"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * ลิงก์จากช่องค้นหา (?hl=<รหัสบรรทัด>) → เลื่อนไปบรรทัด [data-row] นั้นแล้วไฮไลต์สีเหลืองจาง ๆ ~3 วินาที (ตกลง 30 ต.ค. 2026)
 * รอตารางขึ้นได้ ~4 วินาที · ไม่เจอ (เช่น ถูกตัวกรองซ่อน) = เปิดหน้าตามปกติ · ใช้แล้วลบ hl ออกจาก URL (Refresh ไม่ไฮไลต์ซ้ำ)
 */
export default function RowHighlight() {
  const hl = useSearchParams().get("hl");
  useEffect(() => {
    if (!hl) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const strip = () => {
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete("hl");
        window.history.replaceState(null, "", u);
      } catch { /* ไม่เป็นไร */ }
    };
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-row="${CSS.escape(hl)}"]`);
      if (el && el.offsetParent !== null) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.remove("row-hl");
        void el.offsetWidth;               // เริ่มแอนิเมชันใหม่ถ้าเคยไฮไลต์แล้ว
        el.classList.add("row-hl");
        timer = setTimeout(() => el.classList.remove("row-hl"), 3200);
        strip();
      } else if (++tries < 40) timer = setTimeout(tick, 100);
      else strip();
    };
    timer = setTimeout(tick, 50);
    return () => clearTimeout(timer);
  }, [hl]);
  return null;
}
