"use client";

import { useEffect } from "react";
import { beToCe } from "@/lib/format";

/**
 * ช่องวันที่ทุกช่อง (type="date" / "month") พิมพ์ปี พ.ศ. ได้ (ตกลง 30 ต.ค. 2026)
 *   Chrome / Edge บนคอมพิวเตอร์ไม่รู้จัก พ.ศ. → พิมพ์ 2568 จะได้ปี ค.ศ. 2568
 *   ตัวนี้แปลงให้ทันทีเมื่อออกจากช่อง (และก่อนส่งฟอร์มอีกชั้น): ปี > 2400 → ลบ 543
 *   แล้วขึ้นข้อความเล็กใต้ช่อง "แปลงจาก พ.ศ. 2568 แล้ว" ~4 วินาที
 *   วันที่ที่ไม่มีจริงหลังแปลง (29 ก.พ.) → ขึ้นข้อความสีแดง + บันทึกไม่ได้จนกว่าจะแก้
 *   iPhone / Safari ที่ตั้งปฏิทินพุทธ ส่งค่าเป็น ค.ศ. อยู่แล้ว → ไม่ถูกแตะ
 *   ทำงานกับช่องเดิมทุกช่องโดยไม่ต้องแก้แต่ละหน้า (เหมือน NumberInputs) · ใส่ data-plain = ไม่ใช้ตัวนี้
 */
function sel(el: EventTarget | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && (el.type === "date" || el.type === "month") && !el.hasAttribute("data-plain");
}

// เปลี่ยนค่าแบบที่ React รับรู้ (onChange ของช่องที่คุมด้วย state ทำงานด้วย)
function put(el: HTMLInputElement, v: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// ข้อความเล็กใต้ช่อง: ลอยทับ (position fixed) ไม่ดันเลย์เอาต์ของฟอร์ม
function tip(el: HTMLInputElement, text: string, warn: boolean) {
  const r = el.getBoundingClientRect();
  const t = document.createElement("div");
  t.textContent = text;
  t.setAttribute("role", "status");
  t.className = `pointer-events-none fixed z-[100] rounded px-1.5 py-0.5 text-xs shadow-sm ${warn ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`;
  t.style.left = `${r.left}px`;
  t.style.top = `${r.bottom + 2}px`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function fix(el: HTMLInputElement) {
  const r = beToCe(el.value);
  el.setCustomValidity("");
  if (!r) return;
  if (!r.ok) {
    // เช่น 29 ก.พ. 2568 → ปี 2025 ไม่มี 29 ก.พ.: ไม่แปลงเอง · กันไม่ให้บันทึกจนกว่าจะแก้
    const msg = `ปี พ.ศ. ${r.be} ไม่มีวันที่นี้ในปี ค.ศ. ${r.be - 543} — แก้วันที่`;
    el.setCustomValidity(msg);
    tip(el, msg, true);
    return;
  }
  put(el, r.value);
  tip(el, `แปลงจาก พ.ศ. ${r.be} แล้ว`, false);
}

export default function DateInputs() {
  useEffect(() => {
    const onBlur = (e: Event) => { if (sel(e.target)) fix(e.target); };
    // ก่อนส่งฟอร์ม: แปลงช่องที่ยังไม่ได้ออก (กด Enter ทั้งที่อยู่ในช่อง)
    const onSubmit = (e: Event) => {
      if (e.target instanceof HTMLFormElement) e.target.querySelectorAll("input").forEach((el) => { if (sel(el)) fix(el); });
    };
    document.addEventListener("blur", onBlur, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("blur", onBlur, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);
  return null;
}
