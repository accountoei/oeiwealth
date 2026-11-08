"use client";

import { useEffect } from "react";

/**
 * ลิงก์เดิมที่เปิดแท็บของหน้ากรมธรรม์ (?tab=flow / premium / benefit / cv) — หน้ากรมธรรม์ไม่มีแท็บแล้ว (ตกลง 8 พ.ย. 2026)
 *   = เลื่อนลงไปที่ส่วนนั้นของหน้า (ใช้ ?tab แทน #id เพราะลิงก์ไปหน้าสัญญาเพิ่มเติมจะถูกส่งต่อไปหน้ารายการหลัก)
 */
export default function ScrollToId({ id }: { id: string }) {
  useEffect(() => {
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 50);
    return () => clearTimeout(t);
  }, [id]);
  return null;
}
