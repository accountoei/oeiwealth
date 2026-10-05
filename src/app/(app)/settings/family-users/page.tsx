import { createClient } from "@/lib/supabase/server";
import { requireAppUser, ROLE_LABEL, type Role } from "@/lib/auth";
import { AddPersonForm, PersonRow, UserRoleForm, UserStatusForm } from "./forms";

const USER_STATUS: Record<string, string> = { INVITED: "รอเข้าใช้ครั้งแรก", ACTIVE: "ใช้งาน", DISABLED: "ปิดการใช้งาน" };

export default async function FamilyUsersPage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const canEdit = me.role === "ADMIN" || me.role === "EDITOR";
  const isAdmin = me.role === "ADMIN";

  const [{ data: family }, { data: persons }, { data: users }] = await Promise.all([
    supabase.from("families").select("name,go_live_date,system_status").maybeSingle(),
    supabase.from("persons").select("id,name,relationship,status").is("deleted_at", null).order("created_at"),
    supabase.from("app_users").select("id,email,role,status,last_login_at,person_id,persons(name)").order("created_at"),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Family &amp; Users</h1>
        <p className="text-sm text-slate-500">{family?.name} · Go-live {family?.go_live_date} · {family?.system_status}</p>
      </div>

      <section id="members" className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">สมาชิกครอบครัว</h2>
        <p className="mb-3 text-xs text-slate-500">
          รายชื่อนี้ใช้เลือกเจ้าของทรัพย์สินและมุมมองรายบุคคล · ผู้ดูแลระบบที่ไม่ใช่สมาชิกครอบครัวจะไม่อยู่ในรายชื่อนี้
        </p>
        <div className="divide-y divide-slate-100">
          {(persons ?? []).length === 0 && <p className="py-2 text-sm text-slate-500">ยังไม่มีสมาชิก</p>}
          {(persons ?? []).map((p) => canEdit
            ? <PersonRow key={p.id} p={p} />
            : <div key={p.id} className="py-2 text-sm">{p.name}</div>)}
        </div>
        {me.role !== "VIEWER" && (
          <div className="mt-4 border-t border-slate-100 pt-4"><AddPersonForm /></div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">ผู้ใช้ระบบ</h2>
        <p className="mb-3 text-xs text-slate-500">
          {isAdmin ? "เปลี่ยนสิทธิ์หรือปิดการใช้งานได้ · ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คนเสมอ"
                   : "แสดงเฉพาะบัญชีของคุณ"}
        </p>
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
          <p className="mt-4 text-xs text-slate-500">การเชิญผู้ใช้ใหม่ผ่านหน้านี้จะเปิดใช้ในรอบถัดไป (ต้องใช้ Edge Function)</p>
        )}
      </section>
    </div>
  );
}
