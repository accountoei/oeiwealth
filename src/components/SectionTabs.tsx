"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { TabActionsSlot } from "./TabActions";

/**
 * แถบแท็บของเมนูที่รวมหลายหน้า (Family & Documents · Settings) — แต่ละแท็บเป็นหน้าของตัวเอง
 *   ไม่หน่วง: โหลดข้อมูลของแท็บอื่นล่วงหน้า (prefetch) · กดแล้วแท็บเปลี่ยนสีทันที + โครงหน้า (loading.tsx) ระหว่างรอ
 */
export default function SectionTabs({ tabs }: { tabs: { href: string; label: string; dot?: boolean }[] }) {
  const pathname = usePathname();
  // แท็บที่เพิ่งกด (ใช้จนกว่า URL จะเปลี่ยน)
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null);
  const current = pending && pending.from === pathname ? pending.href : pathname;
  return (
    <div className="mb-6 flex items-end border-b border-slate-200">
    <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto overflow-y-hidden text-sm [scrollbar-width:none]" aria-label="แท็บ">
      {tabs.map((t) => {
        const active = current === t.href || current.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href} prefetch aria-current={active ? "page" : undefined}
            onClick={() => setPending({ href: t.href, from: pathname })}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 ${active ? "border-blue-600 font-medium text-blue-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
            {t.label}
            {t.dot && <span className="h-2 w-2 rounded-full bg-red-500" aria-label="มีงานค้าง" />}
          </Link>
        );
      })}
    </nav>
    {/* ปุ่ม "+ เพิ่ม…" ของแต่ละหน้า (TabActions) ชิดขวาสุดของแถวแท็บ */}
    <TabActionsSlot />
    </div>
  );
}
