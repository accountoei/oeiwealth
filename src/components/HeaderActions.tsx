"use client";

import { usePathname } from "next/navigation";
import { Suspense, use, useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, ChevronDown, LogOut, Type } from "lucide-react";
import IntentLink from "./IntentLink";
import FontPicker from "./FontPicker";
import { familyInitials } from "@/lib/format";

/** งานค้างที่ปุ่มกระดิ่ง (โหลดตามหลัง ไม่ทำให้หน้าช้า) · red = เรื่องด่วน */
export type TodoCount = { total: number; red: number };

/**
 * ปุ่มขวาสุดของแถบบน (ตกลง 2 พ.ย. 2026 · แทน To-Do List และกล่องผู้ใช้ที่แถบซ้าย)
 *   กระดิ่ง = ไปหน้า To-Do List (ตัวเลขงานค้าง แดง = ด่วน / เหลือง = รอทำ)
 *   วงกลมชื่อย่อ = ชี้แล้วเห็นชื่อ · กด / แตะ = เมนู ชื่อ · อีเมล · สิทธิ์ · การแสดงผล (เลือกแบบอักษร · 4 พ.ย. 2026) · ออกจากระบบ
 */
export default function HeaderActions({ todo, user, className = "" }: {
  todo: Promise<TodoCount | null>; user: { name: string; email: string; role: string }; className?: string;
}) {
  return (
    <div className={`flex shrink-0 items-center gap-1 ${className}`}>
      <Suspense fallback={<TodoBell t={null} />}><TodoBellCount todo={todo} /></Suspense>
      <UserMenu user={user} />
    </div>
  );
}

/** คำอธิบายเมื่อชี้เมาส์ (ขึ้นทันที ไม่ต้องรอแบบ title · จอสัมผัสไม่แสดง) */
function Tip({ children, hide }: { children: ReactNode; hide?: boolean }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute right-0 top-full z-40 mt-2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-xs font-normal text-white opacity-0 shadow-sm transition-opacity duration-150 ${
      hide ? "" : "group-hover:opacity-100 group-focus-visible:opacity-100"}`}>{children}</span>
  );
}

function TodoBellCount({ todo }: { todo: Promise<TodoCount | null> }) {
  return <TodoBell t={use(todo)} />;
}

function TodoBell({ t }: { t: TodoCount | null }) {
  const pathname = usePathname();
  const active = pathname === "/todo" || pathname.startsWith("/todo/");
  const n = t?.total ?? 0;
  const label = t == null ? "To-Do List" : n ? `To-Do List · ค้าง ${n} รายการ${t.red ? ` (ด่วน ${t.red})` : ""}` : "To-Do List · ไม่มีงานค้าง";
  return (
    <IntentLink href="/todo" aria-label={label} aria-current={active ? "page" : undefined}
      className={`group relative grid h-9 w-9 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
        active ? "bg-blue-50 text-blue-700 ring-1 ring-blue-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}>
      <Bell className="h-5 w-5" aria-hidden strokeWidth={1.9} />
      {n > 0 && (
        <span aria-hidden className={`absolute -right-0.5 -top-0.5 h-[18px] min-w-[18px] rounded-full px-1 text-center text-[11px] font-semibold leading-[18px] ring-2 ring-white ${
          t?.red ? "bg-red-600 text-white" : "bg-amber-400 text-amber-950"}`}>{n > 99 ? "99+" : n}</span>
      )}
      <Tip>{label}</Tip>
    </IntentLink>
  );
}

function UserMenu({ user }: { user: { name: string; email: string; role: string } }) {
  const pathname = usePathname();
  // เปิดค้างไว้เฉพาะหน้าที่เปิด → เปลี่ยนหน้าแล้วเมนูปิดเอง (ไม่ต้อง setState ใน effect)
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const byKey = useRef(false);
  const [fontOpen, setFontOpen] = useState(false);
  const name = user.name.trim() || user.email;
  const initials = user.name.trim() ? familyInitials(user.name) : user.email.charAt(0).toUpperCase();

  useEffect(() => {
    if (!open) return;
    // เปิดด้วยแป้นพิมพ์ → โฟกัสรายการแรก (เปิดด้วยเมาส์ / แตะ ไม่ต้อง)
    if (byKey.current) first.current?.focus();
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpenAt(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpenAt(null); btn.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const avatar = (size: string) => (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full bg-blue-100 font-semibold text-blue-800 ${size}`}>{initials}</span>
  );

  return (
    <div ref={wrap} className="relative"
      onBlur={(e) => { if (open && !wrap.current?.contains(e.relatedTarget as Node | null)) setOpenAt(null); }}>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls="user-menu" aria-label={`${name} · เมนูผู้ใช้`}
        onClick={(e) => { byKey.current = e.detail === 0; setOpenAt(open ? null : pathname); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); byKey.current = true; setOpenAt(pathname); } }}
        className={`group relative flex h-9 items-center gap-0.5 rounded-full p-0.5 md:pr-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
          open ? "bg-slate-100" : "hover:bg-slate-100"}`}>
        {avatar("h-8 w-8 text-[13px]")}
        <ChevronDown className={`hidden h-3.5 w-3.5 text-slate-500 transition-transform md:block duration-150 ${open ? "rotate-180" : ""}`} aria-hidden />
        <Tip hide={open}>{name}</Tip>
      </button>
      {open && (
        <div id="user-menu" role="menu" aria-label="เมนูผู้ใช้"
          className="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-start gap-3 p-3">
            {avatar("h-10 w-10 text-sm")}
            <div className="min-w-0 flex-1 leading-snug">
              <div className="truncate font-semibold text-slate-900">{name}</div>
              {user.name.trim() && <div className="break-all text-xs text-slate-500">{user.email}</div>}
              <span className="mt-1.5 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">สิทธิ์: {user.role}</span>
            </div>
          </div>
          <div className="border-t border-slate-100 p-1">
            <button ref={first} type="button" role="menuitem" onClick={() => { setOpenAt(null); setFontOpen(true); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none">
              <Type className="h-4 w-4 shrink-0" aria-hidden />การแสดงผล
            </button>
          </div>
          <form action="/auth/signout" method="post" className="border-t border-slate-100 p-1">
            <button role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-red-50 hover:text-red-700 focus-visible:bg-red-50 focus-visible:text-red-700 focus-visible:outline-none">
              <LogOut className="h-4 w-4 shrink-0" aria-hidden />ออกจากระบบ
            </button>
          </form>
        </div>
      )}
      {fontOpen && <FontPicker onClose={() => setFontOpen(false)} />}
    </div>
  );
}
