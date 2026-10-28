"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, Suspense, use, useContext, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpDown, Briefcase, Building2, ChevronsLeft, ChevronsRight, CreditCard, Gem, HandCoins,
  Landmark, LayoutDashboard, ListChecks, LogOut, Settings, ShieldCheck, TrendingUp, Users, type LucideIcon,
} from "lucide-react";
import { clampNavWidth, NAV_COLLAPSED_COOKIE, NAV_HREFS, NAV_ORDER_COOKIE, NAV_WIDTH_COOKIE, NAV_PINNED_FIRST, NAV_PINNED_LAST, orderNav, type NavGroup } from "./nav";
import { NAV_RESET_EVENT } from "./NavReset";
import { familyInitials } from "@/lib/format";

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, todo: ListChecks, income: ArrowLeftRight, cash: Landmark, loans: HandCoins, investments: TrendingUp,
  business: Briefcase, property: Building2, alternative: Gem, insurance: ShieldCheck, liabilities: CreditCard, family: Users, settings: Settings,
};

/** งานค้างที่เมนู "สิ่งที่ต้องทำ" (โหลดตามหลัง ไม่ทำให้หน้าช้า) */
export type TodoCount = { total: number; red: number };

// เมนูที่เพิ่งกด → ไฮไลต์ทันทีไม่ต้องรอหน้าใหม่ (ใช้จนกว่า URL จะเปลี่ยน)
const PendingCtx = createContext<{ path: string; setPending: (href: string) => void }>({ path: "", setPending: () => {} });

// Link ของ Next.js 16 รองรับ unstable_dynamicOnHover (โหลดทั้งหน้าเมื่อเอาเมาส์วาง / แตะ) แต่ type ที่ export ยังไม่มี
const HOVER_FULL_PREFETCH = { unstable_dynamicOnHover: true } as object;
// Dashboard: โหลดล่วงหน้าทั้งหน้าเสมอ (ตกลง 27 ต.ค. 2026 · เฉพาะหน้านี้ เพื่อไม่ให้ Supabase แผนฟรีหนัก) · เบราว์เซอร์จำไว้ ~5 นาที / จนมีการบันทึก
const DASHBOARD_PREFETCH = { prefetch: true };

/** cookie ของเครื่องนี้ 1 ปี (ลำดับเมนู / ยุบแถบ) — Server อ่านตอนสร้างหน้า → ไม่กระพริบ */
function setCookie(name: string, value: string | null) {
  document.cookie = value == null ? `${name}=; path=/; max-age=0; samesite=lax`
    : `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

function TodoBadge({ todo, collapsed }: { todo: Promise<TodoCount | null>; collapsed: boolean }) {
  const t = use(todo);
  if (!t?.total) return null;
  const cls = t.red ? "bg-red-500 text-white" : "bg-amber-100 text-amber-800";
  return collapsed
    ? <span className={`absolute right-1 top-1 h-2 w-2 rounded-full ${t.red ? "bg-red-500" : "bg-amber-400"}`} aria-label={`งานค้าง ${t.total} รายการ`} />
    : <span className={`min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 ${cls}`} aria-label={`งานค้าง ${t.total} รายการ`}>{t.total}</span>;
}

function NavLink({ g, dot, collapsed, todo }: { g: NavGroup; dot?: boolean; collapsed: boolean; todo?: Promise<TodoCount | null> }) {
  const { path: pathname, setPending } = useContext(PendingCtx);
  const href = g.href!;
  const base = g.match ?? href.split("#")[0];
  // เลือกเมนูที่ตรงที่สุด (ถ้ามีเมนูย่อยที่ path ยาวกว่า ให้ไฮไลต์เมนูย่อยนั้นแทน)
  const match = (h: string) => (h === "/" ? pathname === "/" : pathname === h || pathname.startsWith(`${h}/`));
  const active = match(base) && !NAV_HREFS.some((h) => h !== base && h.startsWith(`${base}/`) && match(h));
  const Icon = ICONS[g.icon ?? ""] ?? LayoutDashboard;
  const onClick = () => {
    setPending(href.split("#")[0]);
    // กดเมนูของหน้าที่อยู่ → กลับหน้าหลักของเมนู: ล้างแท็บ / ตัวกรองที่ค้างในหน้า (NavReset) + เลื่อนขึ้นบน
    if (active) {
      const here = window.location.pathname + window.location.search;
      window.dispatchEvent(new CustomEvent(NAV_RESET_EVENT, { detail: here === href ? "now" : "next" }));
    }
  };
  return (
    // ไม่หน่วง: เอาเมาส์วาง (หรือแตะ) → โหลดข้อมูลหน้านั้นล่วงหน้าทั้งหน้า · กดแล้วไฮไลต์ทันที + โครงหน้า (loading.tsx) ระหว่างรอ
    <Link href={href} {...(href === "/" ? DASHBOARD_PREFETCH : HOVER_FULL_PREFETCH)} onClick={onClick} title={collapsed ? g.label : undefined} aria-label={collapsed ? g.label : undefined}
      className={`relative flex items-center gap-2.5 rounded-lg py-[7px] text-sm ${collapsed ? "justify-center px-2" : "px-3"} ${
        active ? "bg-blue-50 font-semibold text-blue-700 ring-1 ring-blue-100" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"}`}>
      <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-blue-600" : "text-slate-500"}`} aria-hidden strokeWidth={1.9} />
      {!collapsed && <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">{g.label}{dot && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-label="มีงานค้าง" />}</span>}
      {collapsed && dot && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" aria-label="มีงานค้าง" />}
      {todo && <Suspense fallback={null}><TodoBadge todo={todo} collapsed={collapsed} /></Suspense>}
      {!g.ready && !collapsed && <span className="text-[11px] text-slate-400">เร็ว ๆ นี้</span>}
    </Link>
  );
}

/** แถวเมนูตอนจัดเรียง: ลูกศรขึ้น / ลง (Dashboard / Settings ล็อกไว้) */
function SortRow({ g, onUp, onDown }: { g: NavGroup; onUp?: () => void; onDown?: () => void }) {
  const Icon = ICONS[g.icon ?? ""] ?? LayoutDashboard;
  const btn = "grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-25 disabled:hover:bg-transparent";
  return (
    <div className={`flex items-center gap-2.5 rounded-lg px-3 py-1 text-sm ${onUp || onDown ? "bg-slate-50 text-slate-800" : "text-slate-400"}`}>
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden strokeWidth={1.9} />
      <span className="min-w-0 flex-1 truncate">{g.label}</span>
      {onUp || onDown ? <>
        <button type="button" className={btn} onClick={onUp} disabled={!onUp} aria-label={`เลื่อน ${g.label} ขึ้น`}><ArrowUp className="h-4 w-4" /></button>
        <button type="button" className={btn} onClick={onDown} disabled={!onDown} aria-label={`เลื่อน ${g.label} ลง`}><ArrowDown className="h-4 w-4" /></button>
      </> : <span className="text-[11px]">ล็อก</span>}
    </div>
  );
}

/**
 * dots = href ของเมนูที่ต้องแสดงจุดแดง (เช่น Settings เมื่อมีเดือนที่ถึงเวลาปิดแล้วยังไม่ปิด)
 * initialOrder / initialCollapsed = ค่าจาก cookie ของเครื่องนี้ · todo = จำนวนงานค้าง (Promise → แสดงเมื่อพร้อม)
 */
export default function Sidebar({ dots = [], user, familyName = "", familyPhoto = null, initialOrder = [], initialCollapsed = false, initialWidth, todo }: {
  dots?: string[]; user: { name: string; email: string; role: string }; familyName?: string; familyPhoto?: string | null; initialOrder?: string[]; initialCollapsed?: boolean;
  initialWidth?: number; todo?: Promise<TodoCount | null>;
}) {
  const [open, setOpen] = useState(false);
  const [collapsedPref, setCollapsed] = useState(initialCollapsed);
  const [order, setOrder] = useState<string[]>(initialOrder);
  const [sorting, setSorting] = useState(false);
  const [width, setWidth] = useState(clampNavWidth(initialWidth ?? 0));
  const [dragging, setDragging] = useState(false);
  const pathname = usePathname();
  const [pending, setPendingState] = useState<{ href: string; from: string } | null>(null);
  const path = pending && pending.from === pathname ? pending.href : pathname;
  // ยุบได้เฉพาะจอใหญ่ (มือถือเปิดจากปุ่ม ☰ เต็มแถบเสมอ) · ระหว่างจัดเรียงแสดงเต็ม
  const collapsed = collapsedPref && !open && !sorting;
  const nav = orderNav(order);
  const mid = nav.filter((g) => g.href !== NAV_PINNED_FIRST && g.href !== NAV_PINNED_LAST).map((g) => g.href!);

  const toggle = () => { setCollapsed(!collapsedPref); setCookie(NAV_COLLAPSED_COOKIE, collapsedPref ? null : "1"); };
  const move = (i: number, d: -1 | 1) => {
    const next = [...mid];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setOrder(next);
    setCookie(NAV_ORDER_COOKIE, next.join("|"));
  };
  const resetOrder = () => { setOrder([]); setCookie(NAV_ORDER_COOKIE, null); };
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();
  const title = familyName.trim() || "Family Wealth Vault";

  // ลากเส้นขอบขวาเพื่อยืด / หดแถบเมนู (จอใหญ่) · ปล่อยแล้วจำไว้ที่เครื่องนี้ · ดับเบิลคลิก = กลับขนาดเดิม
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    let w = w0;
    setDragging(true);
    const onMove = (ev: PointerEvent) => { w = clampNavWidth(w0 + ev.clientX - x0); setWidth(w); };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragging(false);
      setCookie(NAV_WIDTH_COOKIE, w === clampNavWidth(0) ? null : String(w));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const resetWidth = () => { setWidth(clampNavWidth(0)); setCookie(NAV_WIDTH_COOKIE, null); };

  return (
    <PendingCtx.Provider value={{ path, setPending: (href) => setPendingState({ href, from: pathname }) }}>
      <button onClick={() => setOpen(!open)} aria-label="เปิดเมนู"
        className="md:hidden fixed top-2.5 left-3 z-30 rounded-md bg-blue-600 text-white px-3 py-1.5 text-sm shadow">☰ เมนู</button>
      <aside style={collapsed ? undefined : { width }}
        className={`${open ? "flex" : "hidden"} md:flex fixed md:sticky top-0 z-20 h-screen shrink-0 flex-col pt-10 md:pt-0 border-r border-slate-200 bg-white ${
        dragging ? "select-none" : "transition-[width] duration-150"} ${collapsed ? "w-16" : ""}`}>
        {/* มุมซ้ายบน: ชื่อครอบครัว + "Wealth Vault" · รูปครอบครัว (ใส่ที่ Members → แก้ไข) · ไม่มีรูป → ชื่อย่อ (ตกลง 28 ต.ค. 2026) */}
        <div className={`flex items-center gap-2 pb-3 pt-5 ${collapsed ? "flex-col px-2" : "pl-5 pr-3"}`}>
          {familyPhoto
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={familyPhoto} alt="" title={collapsed ? title : undefined} className="h-9 w-9 shrink-0 rounded-xl object-cover" />
            : <span title={collapsed ? title : undefined}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-600 text-sm font-bold text-white">{familyInitials(familyName)}</span>}
          {!collapsed && (
            <span className="min-w-0 flex-1 leading-tight" title={title}>
              <span className="block truncate text-[15px] font-bold text-slate-900">{title}</span>
              <span className="block text-xs text-slate-500">Wealth Vault</span>
            </span>
          )}
          {!collapsed && !sorting && (
            <button type="button" onClick={() => setSorting(true)} aria-label="จัดเรียงเมนู" title="จัดเรียงเมนู (จำไว้ที่เครื่องนี้)"
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <ArrowUpDown className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={toggle} aria-label={collapsed ? "ขยายเมนู" : "ยุบเมนู"} title={collapsed ? "ขยายเมนู" : "ยุบเมนู (แสดงแต่ไอคอน)"}
            className="hidden rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 md:block">
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>

        {sorting ? (
          <div className="flex-1 space-y-1 overflow-y-auto px-3">
            <p className="px-1 pb-1 text-xs text-slate-500">จัดเรียงเมนู (จำไว้ที่เครื่องนี้)</p>
            {nav.map((g) => {
              const i = mid.indexOf(g.href!);
              return <SortRow key={g.href} g={g} onUp={i > 0 ? () => move(i, -1) : undefined} onDown={i >= 0 && i < mid.length - 1 ? () => move(i, 1) : undefined} />;
            })}
            <div className="flex gap-2 px-1 pt-2">
              <button type="button" onClick={() => setSorting(false)} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">เสร็จ</button>
              <button type="button" onClick={resetOrder} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">คืนค่าเดิม</button>
            </div>
          </div>
        ) : (
          <nav className={`flex-1 space-y-0.5 overflow-y-auto ${collapsed ? "px-2" : "px-3"}`} onClick={() => setOpen(false)}>
            {nav.map((g) => (
              <NavLink key={g.href} g={g} collapsed={collapsed} dot={dots.includes(g.href!)} todo={g.href === "/todo" ? todo : undefined} />
            ))}
          </nav>
        )}

        {/* ผู้ใช้ + ออกจากระบบ (ย้ายจากแถบบน 27 ต.ค. 2026) */}
        <div className={`border-t border-slate-200 py-2.5 ${collapsed ? "px-2" : "px-3"}`}>
          <div className={`flex items-center gap-2.5 ${collapsed ? "flex-col" : "px-1"}`}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700" title={collapsed ? `${user.name || user.email} · ${user.role}` : undefined}>{initial}</span>
            {!collapsed && (
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm text-slate-800" title={user.email}>{user.name || user.email}</span>
                <span className="block truncate text-xs text-slate-500">{user.role}{user.name ? ` · ${user.email}` : ""}</span>
              </span>
            )}
          </div>
          <form action="/auth/signout" method="post" className="mt-1.5">
            <button aria-label="ออกจากระบบ" title={collapsed ? "ออกจากระบบ" : undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg py-1.5 text-sm text-slate-600 hover:bg-red-50 hover:text-red-700 ${collapsed ? "justify-center px-2" : "px-3"}`}>
              <LogOut className="h-4 w-4 shrink-0" aria-hidden />{!collapsed && "ออกจากระบบ"}
            </button>
          </form>
        </div>
        {!collapsed && (
          <div onPointerDown={startDrag} onDoubleClick={resetWidth} role="separator" aria-orientation="vertical" aria-label="ลากเพื่อยืด / หดเมนู"
            title="ลากเพื่อยืด / หดเมนู · ดับเบิลคลิก = ขนาดเดิม"
            className={`absolute inset-y-0 -right-1 hidden w-2 cursor-col-resize md:block ${dragging ? "bg-blue-400/40" : "hover:bg-blue-300/40"}`} />
        )}
      </aside>
    </PendingCtx.Provider>
  );
}
