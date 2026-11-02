"use client";

import { useEffect, type RefObject } from "react";

/**
 * React รีเซ็ตฟอร์มหลัง Server Action เสร็จ → ช่อง select กลับไปค่าเริ่มต้น (defaultValue) แต่ state ใน component ยังเป็นค่าเดิม
 * ใช้กับ select แบบไม่ผูกค่า (defaultValue + onChange): ฟัง reset ของฟอร์ม แล้วอ่านค่าจริงจากช่องกลับมาใส่ state
 */
export function useResetSync(ref: RefObject<HTMLSelectElement | null>, set: (v: string) => void) {
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const h = () => setTimeout(() => { if (ref.current) set(ref.current.value); }, 0);
    form.addEventListener("reset", h);
    return () => form.removeEventListener("reset", h);
  }, [ref, set]);
}
