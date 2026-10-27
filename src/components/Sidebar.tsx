"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { NAV, NAV_HREFS } from "./nav";

// เมนูที่เพิ่งกด → ไฮไลต์ทันทีไม่ต้องรอหน้าใหม่ (ใช้จนกว่า URL จะเปลี่ยน)
const PendingCtx = createContext<{ path: string; setPending: (href: string) => void }>({ path: "", setPending: () => {} });

// Link ของ Next.js 16 รองรับ unstable_dynamicOnHover (โหลดทั้งหน้าเมื่อเอาเมาส์วาง / แตะ) แต่ type ที่ export ยังไม่มี
const HOVER_FULL_PREFETCH = { unstable_dynamicOnHover: true } as object;

function NavLink({ href, match: prefix, label, ready, nested, dot }: { href: string; match?: string; label: string; ready?: boolean; nested?: boolean; dot?: boolean }) {
  const { path: pathname, setPending } = useContext(PendingCtx);
  const base = prefix ?? href.split("#")[0];
  // เลือกเมนูที่ตรงที่สุด (ถ้ามีเมนูย่อยที่ path ยาวกว่า ให้ไฮไลต์เมนูย่อยนั้นแทน)
  const match = (h: string) => (h === "/" ? pathname === "/" : pathname === h || pathname.startsWith(`${h}/`));
  const active = match(base) && !NAV_HREFS.some((h) => h !== base && h.startsWith(`${base}/`) && match(h));
  return (
    // ไม่หน่วง: เอาเมาส์วาง (หรือแตะ) → โหลดข้อมูลหน้านั้นล่วงหน้าทั้งหน้า · กดแล้วไฮไลต์ทันที + โครงหน้า (loading.tsx) ระหว่างรอ
    <Link href={href} {...HOVER_FULL_PREFETCH} onClick={() => setPending(href.split("#")[0])}
      className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${nested ? "pl-6" : ""} ${
        active ? "bg-blue-50 font-semibold text-blue-700 ring-1 ring-blue-100" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"}`}>
      <span className="flex items-center gap-1.5">{label}{dot && <span className="h-2 w-2 rounded-full bg-red-500" aria-label="มีงานค้าง" />}</span>
      {!ready && <span className="text-[11px] text-slate-400">เร็ว ๆ นี้</span>}
    </Link>
  );
}

/** dots = href ของเมนูที่ต้องแสดงจุดแดง (เช่น Settings เมื่อมีเดือนที่ถึงเวลาปิดแล้วยังไม่ปิด) */
export default function Sidebar({ dots = [] }: { dots?: string[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [pending, setPendingState] = useState<{ href: string; from: string } | null>(null);
  const path = pending && pending.from === pathname ? pending.href : pathname;
  return (
    <PendingCtx.Provider value={{ path, setPending: (href) => setPendingState({ href, from: pathname }) }}>
      <button onClick={() => setOpen(!open)} aria-label="เปิดเมนู"
        className="md:hidden fixed top-2.5 left-3 z-30 rounded-md bg-blue-600 text-white px-3 py-1.5 text-sm shadow">☰ เมนู</button>
      <aside className={`${open ? "block" : "hidden"} md:block fixed md:sticky top-0 z-20 h-screen w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3`}>
        <div className="mb-3 flex items-center gap-2.5 px-2 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-600 text-sm font-bold text-white">FW</span>
          <span className="leading-tight">
            <span className="block text-[15px] font-bold text-slate-900">Family Wealth Vault</span>
            <span className="block text-xs text-slate-500">ทรัพย์สินครอบครัว</span>
          </span>
        </div>
        <nav className="space-y-0.5" onClick={() => setOpen(false)}>
          {NAV.map((g) =>
            g.items ? (
              <div key={g.label} className="pt-2">
                <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{g.label}</div>
                {g.items.map((i) => <NavLink key={i.href} {...i} nested />)}
              </div>
            ) : (
              <NavLink key={g.label} href={g.href!} match={g.match} label={g.label} ready={g.ready} dot={dots.includes(g.href!)} />
            ),
          )}
        </nav>
      </aside>
    </PendingCtx.Provider>
  );
}
