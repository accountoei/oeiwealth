"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import IntentLink from "./IntentLink";
import { TabActionsSlot } from "./TabActions";

/**
 * แถบแท็บของเมนูที่รวมหลายหน้า (Family & Documents · Settings) — แต่ละแท็บเป็นหน้าของตัวเอง
 *   ไม่หน่วง: ชี้เมาส์ค้างที่แท็บ → โหลดข้อมูลแท็บนั้นล่วงหน้า (IntentLink) · กดแล้วแท็บเปลี่ยนสีทันที + โครงหน้า (loading.tsx) ระหว่างรอ
 *   (30 ต.ค. 2026 เลิกโหลดทุกแท็บพร้อมกันตอนเปิดหน้า — เดิมเปิด Family = โหลดอีก 5 หน้า, Settings = อีก 3 หน้า แย่ง Supabase กับหน้าที่เปิดจริง)
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
          <IntentLink key={t.href} href={t.href} aria-current={active ? "page" : undefined}
            onClick={() => setPending({ href: t.href, from: pathname })}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 ${active ? "border-blue-600 font-medium text-blue-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
            {t.label}
            {t.dot && <span className="h-2 w-2 rounded-full bg-red-500" aria-label="มีงานค้าง" />}
          </IntentLink>
        );
      })}
    </nav>
    {/* ปุ่ม "+ เพิ่ม…" ของแต่ละหน้า (TabActions) ชิดขวาสุดของแถวแท็บ */}
    <TabActionsSlot />
    </div>
  );
}
