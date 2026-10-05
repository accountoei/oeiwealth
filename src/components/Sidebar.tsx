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
      className={`flex items-center justify-between rounded-md px-3 py-1.5 text-sm ${nested ? "pl-6" : ""} ${
        active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}>
      <span>{label}</span>
      {!ready && <span className="text-[10px] text-slate-500">เร็ว ๆ นี้</span>}
    </Link>
  );
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(!open)} aria-label="เปิดเมนู"
        className="md:hidden fixed top-3 left-3 z-30 rounded-md bg-slate-900 text-white px-3 py-1.5 text-sm">☰ เมนู</button>
      <aside className={`${open ? "block" : "hidden"} md:block fixed md:sticky top-0 z-20 h-screen w-64 shrink-0 overflow-y-auto bg-slate-900 p-3`}>
        <div className="px-3 py-3 mb-2 text-white font-semibold tracking-wide">Family Wealth Vault</div>
        <nav className="space-y-0.5" onClick={() => setOpen(false)}>
          {NAV.map((g) =>
            g.items ? (
              <div key={g.label} className="pt-2">
                <div className="px-3 pb-1 text-[11px] uppercase tracking-wider text-slate-500">{g.label}</div>
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
