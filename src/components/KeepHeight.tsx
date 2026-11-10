"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const RESET_EVENT = "fwv:keep-height-reset";
// กดแท็บที่เป็นหน้าของตัวเอง (SectionTabs) → path เปลี่ยน แต่หน้าจอต้องอยู่ที่เดิม (ไม่เริ่มนับความสูงใหม่จาก 0)
let tabNavPending = false;

/**
 * เรียกเมื่อกดเปลี่ยนแท็บ → ล้างความสูงที่จำไว้ (หน้ายาวพอดีกับแท็บใหม่ · ตกลง 5 พ.ย. 2026)
 * แต่ไม่ให้หน้าเด้ง (10 พ.ย. 2026): แท็บใหม่สั้นกว่าเดิม → เหลือที่ว่างด้านล่างเท่าที่ต้องใช้ให้แถวแท็บอยู่ตำแหน่งเดิมบนจอ
 * ที่ว่างนั้นหดเองเมื่อเลื่อนหน้าขึ้น (หดเฉพาะส่วนที่อยู่นอกจอด้านล่าง หน้าไม่ขยับ)
 * nav = แท็บที่เปลี่ยนหน้า (SectionTabs) · ไม่ใส่ = แท็บที่สลับในหน้าเดิม
 */
export function resetKeptHeight(nav = false) {
  if (nav) tabNavPending = true;
  try { window.dispatchEvent(new Event(RESET_EVENT)); } catch { /* ไม่เป็นไร */ }
}

/**
 * กันหน้าจอเด้งเมื่อกดตัวกรอง / เปลี่ยนเดือน / เปลี่ยนแท็บ: ผลกรองหรือแท็บใหม่สั้นลง browser จะไม่ดึงหน้าจอขึ้น
 *   ตัวกรอง (path เดิม เปลี่ยนแค่ ?…) → เนื้อหาไม่หดต่ำกว่าความสูงที่เคยมี
 *   แท็บ (resetKeptHeight) → สูงพอให้ตำแหน่งเลื่อนเดิมยังอยู่ แล้วหดตามเมื่อเลื่อนขึ้น
 *   เปลี่ยนหน้า (ไม่ใช่กดแท็บ) → เริ่มนับใหม่
 */
export default function KeepHeight({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const el = ref.current, box = inner.current;
    if (!el || !box) return;
    let keep = 0;
    let shrink = false;   // หลังเปลี่ยนแท็บ: ที่ว่างเกินเนื้อหาจริง หดได้เมื่อเลื่อนขึ้น
    const apply = () => { el.style.minHeight = keep > 0 ? `${keep}px` : ""; };
    // ความสูงที่ต้องมีเพื่อให้หน้าจออยู่ตำแหน่งเดิม (ขอบล่างของเนื้อหาไม่ขึ้นมาเหนือขอบล่างจอ)
    const needed = () => Math.max(0, Math.ceil(window.innerHeight - el.getBoundingClientRect().top));
    if (tabNavPending) {
      // มาจากการกดแท็บที่เป็นหน้า: เก็บความสูงที่ตั้งไว้ตอนกด (ไม่ล้าง)
      tabNavPending = false;
      keep = Math.max(parseFloat(el.style.minHeight || "0"), box.offsetHeight);
      shrink = true;
    } else el.style.minHeight = "";
    const ro = new ResizeObserver(() => {
      const h = box.offsetHeight;
      if (h > keep) { keep = h; shrink = false; apply(); }
    });
    ro.observe(box);
    const reset = () => {
      keep = Math.max(needed(), 0);
      shrink = true;
      apply();
    };
    const onScroll = () => {
      if (!shrink) return;
      const want = Math.max(box.offsetHeight, needed());
      if (want < keep) { keep = want; apply(); }
      if (keep <= box.offsetHeight) shrink = false;
    };
    window.addEventListener(RESET_EVENT, reset);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { ro.disconnect(); window.removeEventListener(RESET_EVENT, reset); window.removeEventListener("scroll", onScroll); };
  }, [pathname]);
  return <div ref={ref}><div ref={inner}>{children}</div></div>;
}
