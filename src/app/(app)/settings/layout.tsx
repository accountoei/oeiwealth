import SectionTabs from "@/components/SectionTabs";
import { monthToClose } from "@/lib/closing";

// เมนู Settings: แท็บเรียงตามการใช้งาน (ตกลง 27 ต.ค. 2026) · จุดแดง = มีเดือนที่ถึงเวลาปิดแล้วยังไม่ปิด
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const due = await monthToClose();
  return (
    <>
      <SectionTabs tabs={[
        { href: "/settings/month-closing", label: "Month Closing", dot: !!due },
        { href: "/settings/system", label: "FX & Prices" },
        { href: "/settings/family-users", label: "User & Security" },
        { href: "/settings/opening", label: "Opening Setup" },
      ]} />
      {children}
    </>
  );
}
