// โครงเมนูตาม Core Schema V1.1 Section 1 (Navigation)
export type NavItem = { label: string; href: string; match?: string; ready?: boolean };
export type NavGroup = { label: string; href?: string; match?: string; ready?: boolean; items?: NavItem[] };

export const NAV: NavGroup[] = [
  { label: "Dashboard", href: "/", ready: true },
  { label: "Income & Expenses", href: "/income-expenses", ready: true },
  { label: "Cash & Bank Accounts", href: "/financial/cash", ready: true },
  { label: "Loans Receivable", href: "/financial/loans", ready: true },
  { label: "Investments", href: "/investments", ready: true },
  { label: "Private Business", href: "/financial/business", ready: true },
  { label: "Property", href: "/property", ready: true },
  { label: "Alternative Assets", href: "/alternative", ready: true },
  { label: "Insurance", href: "/insurance", ready: true },
  { label: "Liabilities", href: "/liabilities", ready: true },
  // รวมเป็นแท็บ (ตกลง 27 ต.ค. 2026): match = path ที่ถือว่าอยู่ในเมนูนี้
  { label: "Family & Documents", href: "/family/members", match: "/family", ready: true },
  { label: "Settings", href: "/settings/month-closing", match: "/settings", ready: true },
];

/** ทุก href ในเมนู (ใช้เลือกเมนูที่ตรงที่สุดตอนไฮไลต์) */
export const NAV_HREFS: string[] = NAV.flatMap((g) => (g.items ? g.items.map((i) => i.match ?? i.href) : g.href ? [g.match ?? g.href] : []))
  .map((h) => h.split("#")[0]);
