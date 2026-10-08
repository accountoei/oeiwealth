"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV } from "./nav";

function NavLink({ href, label, ready, nested }: { href: string; label: string; ready?: boolean; nested?: boolean }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href.split("#")[0]);
  return (
    <Link href={href}
      className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${nested ? "pl-6" : ""} ${
        active ? "bg-blue-50 font-semibold text-blue-700 ring-1 ring-blue-100" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"}`}>
      <span>{label}</span>
      {!ready && <span className="text-[11px] text-slate-400">เร็ว ๆ นี้</span>}
    </Link>
  );
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  return (
    <>
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
              <NavLink key={g.label} href={g.href!} label={g.label} ready={g.ready} />
            ),
          )}
        </nav>
      </aside>
    </>
  );
}
