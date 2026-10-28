import { Suspense } from "react";
import { cookies } from "next/headers";
import Sidebar, { type TodoCount } from "@/components/Sidebar";
import SearchBox from "@/components/SearchBox";
import NavReset from "@/components/NavReset";
import { HEADER_SLOT_ID, HeaderTitle, NavPendingProvider, PendingArea, PendingBar } from "@/components/HeaderBar";
import { NAV_COLLAPSED_COOKIE, NAV_ORDER_COOKIE } from "@/components/nav";
import { requireAppUser, ROLE_LABEL } from "@/lib/auth";
import { CurrencyProvider } from "@/components/CurrencyContext";
import { getCurrencyLists } from "@/lib/currencies";
import { createClient } from "@/lib/supabase/server";
import { Toaster } from "@/components/Modal";
import KeepHeight from "@/components/KeepHeight";
import { monthToClose } from "@/lib/closing";
import { getAttention } from "@/lib/attention";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAppUser();
  const supabase = await createClient();
  const [ccy, due, jar, { data: person }] = await Promise.all([
    getCurrencyLists(supabase), monthToClose(), cookies(),
    user.person_id ? supabase.from("persons").select("name").eq("id", user.person_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // จำนวนงานค้างที่เมนู "สิ่งที่ต้องทำ": ไม่รอ (ส่งเป็น Promise → ตัวเลขขึ้นเมื่อคำนวณเสร็จ หน้าไม่ช้าลง)
  const todo: Promise<TodoCount | null> = getAttention()
    .then((a) => ({ total: a.length, red: a.filter((x) => x.tone === "red").length }))
    .catch(() => null);
  const order = decodeURIComponent(jar.get(NAV_ORDER_COOKIE)?.value ?? "").split("|").filter(Boolean);
  return (
    <div className="flex min-h-screen">
      <Sidebar dots={due ? ["/settings/month-closing"] : []} todo={todo} initialOrder={order}
        initialCollapsed={jar.get(NAV_COLLAPSED_COOKIE)?.value === "1"}
        user={{ name: (person as { name: string } | null)?.name ?? "", email: user.email, role: ROLE_LABEL[user.role] }} />
      <NavPendingProvider><div className="flex-1 min-w-0">
        {/* แถบบน (28 ต.ค. 2026): ชื่อเมนู · ช่องค้นหาตรงกลาง · คน / เดือนของหน้า (HeaderFilters) · มือถือเว้นที่ให้ปุ่ม ☰ และตัวเลือกขึ้นบรรทัดที่สอง */}
        <header className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white/90 py-2 pl-28 pr-4 backdrop-blur md:grid-cols-[minmax(0,1fr)_minmax(16rem,28rem)_minmax(0,1fr)] md:px-8">
          <HeaderTitle />
          <div className="flex justify-center"><SearchBox /></div>
          <div id={HEADER_SLOT_ID} className="col-span-2 -ml-24 flex justify-end empty:hidden md:col-span-1 md:ml-0" />
          <PendingBar />
        </header>
        <main className="mx-auto max-w-7xl p-4 md:p-8"><KeepHeight><CurrencyProvider used={ccy.used} others={ccy.others}>
          <Suspense><NavReset><PendingArea>{children}</PendingArea></NavReset></Suspense>
        </CurrencyProvider></KeepHeight></main>
        <Toaster />
      </div></NavPendingProvider>
    </div>
  );
}
