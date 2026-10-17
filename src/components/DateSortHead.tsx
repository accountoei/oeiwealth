"use client";

import Link from "next/link";

/** หัวคอลัมน์ "วันที่" + ปุ่มเรียงเล็ก ๆ (น้อย → มาก / มาก → น้อย) · ใช้ได้ทั้งแบบกดในหน้า (onToggle) และลิงก์ (href) */
export default function DateSortHead({ asc, onToggle, href, label = "วันที่" }: { asc: boolean; onToggle?: () => void; href?: string; label?: string }) {
  const title = asc ? "เรียงน้อย → มาก (ล่าสุดอยู่ล่าง) · กดเพื่อสลับ" : "เรียงมาก → น้อย (ล่าสุดอยู่บน) · กดเพื่อสลับ";
  const icon = (
    <span aria-hidden className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 bg-white text-[10px] leading-none text-slate-600 hover:border-slate-400 hover:text-slate-900">
      {asc ? "↑" : "↓"}
    </span>
  );
  return (
    <span className="inline-flex items-center whitespace-nowrap">
      {label}
      {href
        ? <Link href={href} scroll={false} title={title} aria-label={title}>{icon}</Link>
        : <button type="button" onClick={onToggle} title={title} aria-label={title}>{icon}</button>}
    </span>
  );
}
