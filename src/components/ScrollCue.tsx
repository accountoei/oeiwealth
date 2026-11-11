"use client";

import { useEffect } from "react";

/**
 * บอกว่า "ยังเลื่อนซ้าย / ขวาได้" ทุกหน้า โดยไม่ต้องแก้แต่ละหน้า (เหมือน NumberInputs · Modern Web Guidance รอบ 2 ข้อ 2 · 11 พ.ย. 2026)
 *   ตารางกว้างกว่ากล่อง (กล่อง overflow-x-auto ที่มี <table>) → เงาจาง ๆ ที่ขอบด้านที่ยังมีคอลัมน์ซ่อนอยู่
 *   แถวแท็บที่ใส่ data-scroll-cue="fade" (SectionTabs · แท็บ Income & Expenses) → ขอบจางแบบเดียวกับ TabNav
 *   ใส่ data-edge="l" / "r" / "lr" ที่กล่อง แล้ว globals.css วาดเงา / ขอบจาง · ไม่ล้น = ไม่มี data-edge = หน้าตาเดิม
 *   ใส่ data-scroll-cue="off" ที่กล่อง = ไม่ใช้ตัวนี้
 */
const SEL = ".overflow-x-auto, [data-scroll-cue]";

function edge(el: HTMLElement) {
  const l = el.scrollLeft > 1, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  return l && r ? "lr" : l ? "l" : r ? "r" : "";
}

function sync(el: HTMLElement) {
  const v = edge(el);
  if ((el.dataset.edge ?? "") === v) return;
  if (v) el.dataset.edge = v; else delete el.dataset.edge;
}

export default function ScrollCue() {
  useEffect(() => {
    const boxes = new Set<HTMLElement>();
    // กล่องเปลี่ยนขนาด (หมุนจอ / ย่อเมนู) → คำนวณใหม่
    const ro = new ResizeObserver((es) => es.forEach((e) => sync(e.target as HTMLElement)));
    const scan = () => {
      boxes.forEach((el) => { if (!el.isConnected) { ro.unobserve(el); boxes.delete(el); } else sync(el); });
      document.querySelectorAll<HTMLElement>(SEL).forEach((el) => {
        if (boxes.has(el) || el.dataset.scrollCue === "off") return;
        if (!el.dataset.scrollCue && !el.querySelector("table")) return;
        boxes.add(el);
        ro.observe(el);
        sync(el);
      });
    };
    // เลื่อนกล่องไหนก็ตาม (scroll ไม่ bubble → ฟังแบบ capture ที่ document)
    const onScroll = (e: Event) => { if (e.target instanceof HTMLElement && boxes.has(e.target)) sync(e.target); };
    // เนื้อหาเปลี่ยน (เปลี่ยนหน้า / โหลดแถวเพิ่ม / เปิด pop up) → หากล่องใหม่ + คำนวณกล่องเดิมใหม่ (รวมไว้ทีเดียวต่อเฟรม)
    let raf = 0;
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; scan(); }); });
    scan();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      mo.disconnect();
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
