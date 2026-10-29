import SectionTabs from "@/components/SectionTabs";

// เมนู Family & Documents: แท็บ Members · Membership & Points · Health · Tax · Donations · Documents (Documents ท้ายสุด · ตกลง 29 ต.ค. 2026)
export default function FamilyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionTabs tabs={[
        { href: "/family/members", label: "Members" },
        { href: "/family/memberships", label: "Membership & Points" },
        { href: "/family/health", label: "Health" },
        { href: "/family/donations", label: "Donations" },
        { href: "/family/documents", label: "Documents" },
      ]} />
      {children}
    </>
  );
}
