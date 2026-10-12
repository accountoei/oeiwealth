import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser, ROLE_LABEL, type Role } from "@/lib/auth";
import { InviteForm, ResendInviteForm, UserRecovery, UserRoleForm, UserStatusForm } from "./forms";

const USER_STATUS: Record<string, string> = { INVITED: "รอเข้าใช้ครั้งแรก", ACTIVE: "ใช้งาน", DISABLED: "ปิดการใช้งาน" };

export default async function UsersPage() {
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
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
        <p className="text-sm text-slate-500">{family?.name} · Go-live {family?.go_live_date} · {family?.system_status}</p>
      </div>

      <p className="text-sm text-slate-500">
        รายชื่อสมาชิกครอบครัวย้ายไปอยู่เมนู <Link href="/family/members" className="text-blue-700 hover:underline">Family → Members</Link>
      </p>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">ผู้ใช้ระบบ</h2>
        <p className="mb-3 text-xs text-slate-500">
          {isAdmin ? "เปลี่ยนสิทธิ์หรือปิดการใช้งานได้ · ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คนเสมอ"
                   : "แสดงเฉพาะบัญชีของคุณ"}
        </p>
        {usersError && <p className="mb-2 text-sm text-red-600">โหลดรายชื่อผู้ใช้ไม่สำเร็จ: {usersError.message}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-2 pr-4">อีเมล</th><th className="pr-4">สมาชิก</th><th className="pr-4">สิทธิ์</th>
                <th className="pr-4">สถานะ</th><th className="pr-4">เข้าใช้ล่าสุด</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(users ?? []).map((u) => {
                const person = (u.persons as unknown as { name: string } | null)?.name;
                return (
                  <tr key={u.id} className="align-middle">
                    <td className="py-2 pr-4">{u.email}{u.id === me.id && <span className="ml-1 text-xs text-slate-400">(คุณ)</span>}</td>
                    <td className="pr-4 text-slate-600">{person ?? <span className="text-slate-400">ผู้ดูแลระบบ</span>}</td>
                    <td className="pr-4">{isAdmin && u.id !== me.id ? <UserRoleForm id={u.id} role={u.role} /> : ROLE_LABEL[u.role as Role]}</td>
                    <td className="pr-4">
                      <div className="flex items-center gap-2">
                        <span>{USER_STATUS[u.status]}</span>
                        {isAdmin && u.id !== me.id && <UserStatusForm id={u.id} status={u.status} />}
                      </div>
                      {isAdmin && u.status === "INVITED" && <ResendInviteForm id={u.id} />}
                      {isAdmin && u.status === "ACTIVE" && u.id !== me.id && <UserRecovery id={u.id} />}
                    </td>
                    <td className="pr-4 text-slate-500">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {isAdmin && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="mb-1 text-sm font-medium text-slate-900">เชิญผู้ใช้ใหม่</h3>
            <p className="mb-2 text-xs text-slate-500">
              ระบบสร้างลิงก์ให้คัดลอกไปส่งเอง · ผู้รับเปิดลิงก์ ตั้งรหัสผ่าน แล้วเข้าใช้ได้ทันที · ผู้ดูแลระบบต้องตั้ง MFA ต่อ
            </p>
            <InviteForm persons={(persons ?? []).filter((p) => p.status === "ACTIVE"
              && !(users ?? []).some((u) => u.person_id === p.id)).map((p) => ({ id: p.id, name: p.name }))} />
          </div>
        )}
      </section>
    </div>
  );
}
