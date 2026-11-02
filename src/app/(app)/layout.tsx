import { Suspense } from "react";
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
  return (
    <div className="flex min-h-screen">
      <Sidebar dots={due ? ["/settings/month-closing"] : []} initialOrder={order}
        initialCollapsed={jar.get(NAV_COLLAPSED_COOKIE)?.value === "1"} initialWidth={Number(jar.get(NAV_WIDTH_COOKIE)?.value)}
        familyName={(family as { name: string } | null)?.name ?? ""} familyPhoto={(family as { photo: string | null } | null)?.photo ?? null} />
      <NavPendingProvider><div className="flex-1 min-w-0">
        <AppHeader todo={todo} user={{ name: (person as { name: string } | null)?.name ?? "", email: user.email, role: ROLE_LABEL[user.role] }} />
        <main className="mx-auto max-w-7xl p-4 md:p-8 2xl:max-w-[100rem]"><KeepHeight><CurrencyProvider used={ccy.used} others={ccy.others}>
          <Suspense><NavReset><PendingArea>{children}</PendingArea></NavReset><RowHighlight /></Suspense>
        </CurrencyProvider></KeepHeight></main>
        <Toaster />
      </div></NavPendingProvider>
    </div>
  );
}
