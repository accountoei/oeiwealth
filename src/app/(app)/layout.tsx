import { Suspense } from "react";
// แบบอักษรที่ให้เลือกเพิ่ม (src/lib/fonts.ts) · ประกาศไว้เฉย ๆ เบราว์เซอร์โหลดไฟล์เฉพาะแบบที่ใช้จริง
import "@fontsource/noto-sans-thai-looped/400.css";
import "@fontsource/noto-sans-thai-looped/500.css";
import "@fontsource/noto-sans-thai-looped/600.css";
import "@fontsource/noto-sans-thai-looped/700.css";
import "@fontsource/sarabun/400.css";
import "@fontsource/sarabun/500.css";
import "@fontsource/sarabun/600.css";
import "@fontsource/sarabun/700.css";
import { cookies } from "next/headers";
import Sidebar from "@/components/Sidebar";
import AppHeader from "@/components/AppHeader";
import type { TodoCount } from "@/components/HeaderActions";
import NavReset from "@/components/NavReset";
import RowHighlight from "@/components/RowHighlight";
import { NavPendingProvider, PendingArea } from "@/components/HeaderBar";
import { NAV_COLLAPSED_COOKIE, NAV_ORDER_COOKIE, NAV_WIDTH_COOKIE } from "@/components/nav";
import { requireAppUser, ROLE_LABEL } from "@/lib/auth";
import { CurrencyProvider } from "@/components/CurrencyContext";
import { getCurrencyLists } from "@/lib/currencies";
import { createClient } from "@/lib/supabase/server";
import { Toaster } from "@/components/Modal";
import KeepHeight from "@/components/KeepHeight";
import { monthToClose } from "@/lib/closing";
import { getTodoCount } from "@/lib/attention";
import { DEFAULT_FONT, FONT_COOKIE, fontKey, fontStack } from "@/lib/fonts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAppUser();
  const supabase = await createClient();
  const [ccy, due, jar, { data: person }, { data: family }] = await Promise.all([
    getCurrencyLists(supabase), monthToClose(), cookies(),
    user.person_id ? supabase.from("persons").select("name").eq("id", user.person_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("families").select("name,photo").maybeSingle(),
  ]);
  // จำนวนงานค้างที่ปุ่มกระดิ่ง (To-Do List): ไม่รอ (ส่งเป็น Promise → ตัวเลขขึ้นเมื่อคำนวณเสร็จ หน้าไม่ช้าลง) · จำไว้ 5 นาที / จนมีการบันทึก
  const todo: Promise<TodoCount | null> = getTodoCount().catch(() => null);
  const order = decodeURIComponent(jar.get(NAV_ORDER_COOKIE)?.value ?? "").split("|").filter(Boolean);
  // แถบเมนูยุบ: "1" = ยุบ · "0" = ขยาย (กดเลือกเอง) · ไม่มี = ยังไม่เคยเลือก (iPad ยุบให้เอง)
  const navCollapsed = jar.get(NAV_COLLAPSED_COOKIE)?.value;
  // แบบอักษรที่เลือกไว้ที่เครื่องนี้ → ใส่ตั้งแต่ Server สร้างหน้า (ไม่กระพริบเป็นแบบเดิมก่อน) · มีผลทั้งหน้า รวม pop up
  const font = fontKey(jar.get(FONT_COOKIE)?.value);
  return (
    <div className="flex min-h-screen">
      {font !== DEFAULT_FONT && <style>{`:root{--font-sans:${fontStack(font)}}`}</style>}
      <Sidebar dots={due ? ["/settings/month-closing"] : []} initialOrder={order}
        initialCollapsed={navCollapsed === "1" ? true : navCollapsed === "0" ? false : undefined} initialWidth={Number(jar.get(NAV_WIDTH_COOKIE)?.value)}
        familyName={(family as { name: string } | null)?.name ?? ""} familyPhoto={(family as { photo: string | null } | null)?.photo ?? null} />
      <NavPendingProvider><div className="flex-1 min-w-0">
        <AppHeader todo={todo} user={{ name: (person as { name: string } | null)?.name ?? "", email: user.email, role: ROLE_LABEL[user.role] }} />
        <main className="mx-auto max-w-[90rem] p-4 md:p-8"><KeepHeight><CurrencyProvider used={ccy.used} others={ccy.others}>
          <Suspense><NavReset><PendingArea>{children}</PendingArea></NavReset><RowHighlight /></Suspense>
        </CurrencyProvider></KeepHeight></main>
        <Toaster />
      </div></NavPendingProvider>
    </div>
  );
}
