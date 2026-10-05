// โครงเมนูตาม Core Schema V1.1 Section 1 (Navigation)
export type NavItem = { label: string; href: string; ready?: boolean };
export type NavGroup = { label: string; href?: string; ready?: boolean; items?: NavItem[] };

export const NAV: NavGroup[] = [
  { label: "Dashboard", href: "/", ready: true },
  {
    label: "Financial Assets",
    items: [
      { label: "Cash & Deposits", href: "/financial/cash", ready: true },
      { label: "Loans Receivable", href: "/financial/loans" },
      { label: "Private Business", href: "/financial/business" },
    ],
  },
  { label: "Investments", href: "/investments" },
  { label: "Property", href: "/property" },
  { label: "Alternative Assets", href: "/alternative" },
  { label: "Income & Expenses", href: "/income-expenses" },
  { label: "Insurance", href: "/insurance" },
  {
    label: "Family",
    items: [
      { label: "Members", href: "/settings/family-users#members", ready: true },
      { label: "Health", href: "/family/health" },
      { label: "Cards & Membership", href: "/family/cards", ready: true },
    ],
  },
  { label: "Liabilities", href: "/liabilities", ready: true },
  { label: "Documents", href: "/documents" },
  { label: "Month Closing", href: "/month-closing" },
  {
    label: "Settings",
    items: [
      { label: "Family & Users", href: "/settings/family-users", ready: true },
      { label: "System", href: "/settings/system", ready: true },
      { label: "Opening Setup", href: "/settings/opening", ready: true },
      { label: "Security", href: "/settings/security" },
    ],
  },
];
