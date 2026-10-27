"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** แถบแท็บของเมนูที่รวมหลายหน้า (Family & Documents · Settings) — แต่ละแท็บเป็นหน้าของตัวเอง โหลดเฉพาะข้อมูลของแท็บที่เปิด */
export default function SectionTabs({ tabs }: { tabs: { href: string; label: string; dot?: boolean }[] }) {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 text-sm" aria-label="แท็บ">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 ${active ? "border-blue-600 font-medium text-blue-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
            {t.label}
            {t.dot && <span className="h-2 w-2 rounded-full bg-red-500" aria-label="มีงานค้าง" />}
          </Link>
        );
      })}
    </nav>
  );
}
