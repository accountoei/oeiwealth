import Sidebar from "@/components/Sidebar";
import { requireAppUser, ROLE_LABEL } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAppUser();
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 flex items-center justify-end gap-3 border-b border-slate-200 bg-white/90 px-4 py-2.5 text-sm backdrop-blur md:px-8">
          <span className="mr-auto" />
          <span className="truncate text-slate-700">{user.email}</span>
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-100">{ROLE_LABEL[user.role]}</span>
          <form action="/auth/signout" method="post">
            <button className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900">ออกจากระบบ</button>
          </form>
        </header>
        <main className="mx-auto max-w-7xl p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
