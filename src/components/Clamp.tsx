"use client";

import { useState } from "react";

/**
 * ข้อความยาวที่ตัดท้ายด้วย … · กดเพื่อขยาย / ย่อ (ตกลง 9 พ.ย. 2026 · iPad ไม่มีชี้เมาส์ จึงใช้กด · ใช้ร่วมกันตั้งแต่ 11 พ.ย. 2026)
 *   บนคอมฯ ชี้เมาส์เห็นข้อความเต็ม (title) · ข้อความสั้นแสดงเหมือนเดิม · เป็นปุ่ม → กดแล้วไม่เปิดหน้าต่างแก้ของแถว
 *   className = ขนาด / สี / ชิดซ้าย-ขวา ของข้อความ (เช่น "block w-full text-left" หรือ "ml-auto block max-w-[9rem] text-right")
 */
export default function Clamp({ text, className = "block w-full text-left" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" onClick={() => setOpen(!open)} title={open ? undefined : text} aria-expanded={open}
      className={`${className} ${open ? "whitespace-normal break-words" : "truncate"}`}>{text}</button>
  );
}
