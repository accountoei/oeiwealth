import { createClient } from "@/lib/supabase/server";
import { PageInfo } from "@/components/HeaderBar";
import { requireAppUser, ROLE_LABEL, type Role } from "@/lib/auth";
import { InviteButton, UserManage } from "./forms";
import { TabActions } from "@/components/TabActions";
import SecuritySection, { type SecuritySp } from "../security/SecuritySection";

const USER_STATUS: Record<string, string> = { INVITED: "รอเข้าใช้ครั้งแรก", ACTIVE: "ใช้งาน", DISABLED: "ปิดการใช้งาน" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<SecuritySp> }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  const isAdmin = me.role === "ADMIN";

  const [{ data: family }, { data: persons }, { data: users, error: usersError }] = await Promise.all([
    supabase.from("families").select("name,go_live_date,system_status").maybeSingle(),
    supabase.from("persons").select("id,name,status").is("deleted_at", null).order("sort_order").order("created_at"),
    supabase.from("app_users").select("id,email,role,status,last_login_at,person_id,persons!app_users_person_id_fkey(name)").order("created_at"),
  ]);

  return (
    <div className="space-y-8">
      <PageInfo>{family?.name} · Go-live {family?.go_live_date} · {family?.system_status}</PageInfo>
      {/* ปุ่มเชิญผู้ใช้อยู่แถวแท็บ (ตกลง 30 ต.ค. 2026) */}
      {isAdmin && <TabActions><InviteButton persons={(persons ?? []).filter((p) => p.status === "ACTIVE"
        && !(users ?? []).some((u) => u.person_id === p.id)).map((p) => ({ id: p.id, name: p.name }))} /></TabActions>}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-medium text-slate-900">ผู้ใช้ระบบ</h2>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          {isAdmin ? "กด “จัดการ” เพื่อเปลี่ยนสิทธิ์ · เปิด / ปิดการใช้งาน · ลิงก์ตั้งรหัสผ่านใหม่ · รีเซ็ต MFA · ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คนเสมอ"
                   : "แสดงเฉพาะบัญชีของคุณ"}
        </p>
        {usersError && <p className="mb-2 text-sm text-red-600">โหลดรายชื่อผู้ใช้ไม่สำเร็จ: {usersError.message}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-2 pr-4">อีเมล</th><th className="pr-4">สมาชิก</th><th className="pr-4">สิทธิ์</th>
                <th className="pr-4">สถานะ</th><th className="pr-4">เข้าใช้ล่าสุด</th>{isAdmin && <th />}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(users ?? []).map((u) => {
                const person = (u.persons as unknown as { name: string } | null)?.name;
                return (
                  <tr key={u.id} className="align-middle">
                    <td className="py-2 pr-4">{u.email}{u.id === me.id && <span className="ml-1 text-xs text-slate-400">(คุณ)</span>}</td>
                    <td className="pr-4 text-slate-600">{person ?? <span className="text-slate-400">ผู้ดูแลระบบ</span>}</td>
                    <td className="pr-4">{ROLE_LABEL[u.role as Role]}</td>
                    <td className={`pr-4 ${u.status === "DISABLED" ? "text-red-700" : ""}`}>{USER_STATUS[u.status]}</td>
                    <td className="pr-4 text-slate-500">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "-"}
                    </td>
                    {isAdmin && <td className="py-2 text-right">{u.id !== me.id &&
                      <UserManage id={u.id} email={u.email} role={u.role} status={u.status} statusLabel={USER_STATUS[u.status]} />}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <SecuritySection sp={sp} />
    </div>
  );
}
