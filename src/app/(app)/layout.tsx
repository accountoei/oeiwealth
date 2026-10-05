import Sidebar from "@/components/Sidebar";
import { requireAppUser, ROLE_LABEL } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAppUser();
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex-1 min-w-0">
        <header className="flex items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 py-2 text-sm">
          <span className="text-slate-600 truncate">{user.email}</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{ROLE_LABEL[user.role]}</span>
          <form action="/auth/signout" method="post">
            <button className="text-slate-500 hover:text-slate-900">ออกจากระบบ</button>
          </form>
        </header>
        <main className="p-4 md:p-8 max-w-6xl">{children}</main>
      </div>
    </div>
  );
}
