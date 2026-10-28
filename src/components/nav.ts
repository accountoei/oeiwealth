// โครงเมนูตาม Core Schema V1.1 Section 1 (Navigation)
/** icon = ชื่อไอคอนใน Sidebar (ICONS) */
export type NavItem = { label: string; href: string; match?: string; ready?: boolean; icon?: string };
export type NavGroup = { label: string; href?: string; match?: string; ready?: boolean; icon?: string; items?: NavItem[] };

export const NAV: NavGroup[] = [
  { label: "Dashboard", href: "/", ready: true, icon: "dashboard" },
  // ย้ายจากท้ายหน้า Dashboard (ตกลง 27 ต.ค. 2026): สิ่งที่ต้องทำ + ความครบถ้วนของข้อมูล
  { label: "To-Do List", href: "/todo", ready: true, icon: "todo" },
  { label: "Income & Expenses", href: "/income-expenses", ready: true, icon: "income" },
  { label: "Cash & Bank Accounts", href: "/financial/cash", ready: true, icon: "cash" },
  { label: "Loans Receivable", href: "/financial/loans", ready: true, icon: "loans" },
  { label: "Investments", href: "/investments", ready: true, icon: "investments" },
  { label: "Private Business", href: "/financial/business", ready: true, icon: "business" },
  { label: "Property", href: "/property", ready: true, icon: "property" },
  { label: "Alternative Assets", href: "/alternative", ready: true, icon: "alternative" },
  { label: "Insurance", href: "/insurance", ready: true, icon: "insurance" },
  { label: "Liabilities", href: "/liabilities", ready: true, icon: "liabilities" },
  // รวมเป็นแท็บ (ตกลง 27 ต.ค. 2026): match = path ที่ถือว่าอยู่ในเมนูนี้
  { label: "Family & Documents", href: "/family/members", match: "/family", ready: true, icon: "family" },
  { label: "Settings", href: "/settings/month-closing", match: "/settings", ready: true, icon: "settings" },
];

/** เมนูที่ล็อกตำแหน่ง (จัดเรียงไม่ได้): Dashboard บนสุด · Settings ล่างสุด */
export const NAV_PINNED_FIRST = "/";
export const NAV_PINNED_LAST = "/settings/month-closing";
/** cookie ของแต่ละเครื่อง (ไม่เก็บในฐานข้อมูล): ลำดับเมนู / ยุบแถบ */
export const NAV_ORDER_COOKIE = "fwv_nav_order";
export const NAV_COLLAPSED_COOKIE = "fwv_nav_collapsed";

/** ทุก href ในเมนู (ใช้เลือกเมนูที่ตรงที่สุดตอนไฮไลต์) */
export const NAV_HREFS: string[] = NAV.flatMap((g) => (g.items ? g.items.map((i) => i.match ?? i.href) : g.href ? [g.match ?? g.href] : []))
  .map((h) => h.split("#")[0]);

/** เรียงเมนูตามลำดับที่บันทึกไว้ (href) · เมนูใหม่ที่ไม่อยู่ในลำดับเดิมต่อท้าย (ก่อน Settings) */
export function orderNav(order: string[]): NavGroup[] {
  const first = NAV.filter((g) => g.href === NAV_PINNED_FIRST);
  const last = NAV.filter((g) => g.href === NAV_PINNED_LAST);
  const mid = NAV.filter((g) => g.href !== NAV_PINNED_FIRST && g.href !== NAV_PINNED_LAST);
  const pos = (g: NavGroup) => { const i = order.indexOf(g.href ?? ""); return i < 0 ? order.length + mid.indexOf(g) : i; };
  return [...first, ...[...mid].sort((a, b) => pos(a) - pos(b)), ...last];
}
