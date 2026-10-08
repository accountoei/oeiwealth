import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser, ROLE_LABEL } from "@/lib/auth";
import SecurityPanel from "./SecurityPanel";

const ACTION_LABEL: Record<string, string> = {
  CREATE: "สร้าง", UPDATE: "แก้ไข", DELETE: "ลบ", RESTORE: "กู้คืน", VIEW_SENSITIVE: "ดูข้อมูลอ่อนไหว", VIEW_DOCUMENT: "เปิดเอกสาร",
  DOWNLOAD_DOCUMENT: "ดาวน์โหลดเอกสาร", EXPORT: "ส่งออก", LOGIN: "เข้าระบบ", INVITE_USER: "เชิญผู้ใช้", DISABLE_USER: "ปิดผู้ใช้",
  ENABLE_USER: "เปิดผู้ใช้", CHANGE_ROLE: "เปลี่ยนสิทธิ์", FX_OVERRIDE: "แก้ FX", FINALIZE_MONTH: "ปิดเดือน", REOPEN_MONTH: "เปิดเดือนกลับ",
  CONFIRM_GO_LIVE: "Confirm Go-live", EDIT_OPENING_POSITION: "แก้ยอดตั้งต้น", SET_SENSITIVE: "ตั้งข้อมูลอ่อนไหว", HARD_DELETE: "ลบถาวร",
};
const PAGE = 100;

type Sp = Promise<{ action?: string; user?: string; entity?: string; page?: string }>;

export default async function SecurityPage({ searchParams }: { searchParams: Sp }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const isAdmin = me.role === "ADMIN";
  const supabase = await createClient();
  const page = Math.max(0, Number(sp.page ?? 0) || 0);

  let logs: { id: number; event_at: string; user_id: string | null; actor_type: string; action: string; entity_type: string;
    entity_id: string | null; field_name: string | null; metadata: Record<string, unknown> | null }[] = [];
  let users: { id: string; email: string }[] = [];
  if (isAdmin) {
    let q = supabase.from("audit_logs").select("id,event_at,user_id,actor_type,action,entity_type,entity_id,field_name,metadata")
      .order("event_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (sp.action) q = q.eq("action", sp.action);
    if (sp.user) q = q.eq("user_id", sp.user);
    if (sp.entity) q = q.eq("entity_type", sp.entity);
    const [{ data: l }, { data: u }] = await Promise.all([q, supabase.from("app_users").select("id,email").order("email")]);
    logs = l ?? []; users = u ?? [];
  }
  const email = new Map(users.map((u) => [u.id, u.email]));
  const qs = (p: Record<string, string | number | undefined>) =>
    "/settings/security?" + new URLSearchParams(Object.entries({ ...sp, ...p }).filter(([, v]) => v !== undefined && v !== "") as [string, string][]);
  const meta = (m: Record<string, unknown> | null) => {
    if (!m) return "";
    const keys = Object.keys(m).filter((k) => !["created_at", "updated_at", "created_by", "updated_by"].includes(k));
    return keys.slice(0, 4).map((k) => `${k}: ${typeof m[k] === "object" ? JSON.stringify(m[k]).slice(0, 40) : String(m[k]).slice(0, 40)}`).join(" · ");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Security</h1>
        <p className="text-sm text-slate-500">{me.email} · {ROLE_LABEL[me.role]}</p>
      </div>
      <SecurityPanel isAdmin={isAdmin} />

      {isAdmin && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <h2 className="font-medium text-slate-900">Audit Log</h2>
            <p className="text-xs text-slate-500">บันทึกทุกการสร้าง / แก้ / ลบ / เข้าระบบ / ดูเลขบัญชี · แก้หรือลบไม่ได้ (เฉพาะผู้ดูแลระบบเห็น)</p>
          </div>
          <form className="flex flex-wrap items-end gap-2 text-sm" action="/settings/security">
            <select name="action" defaultValue={sp.action ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5">
              <option value="">ทุกการกระทำ</option>{Object.entries(ACTION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select name="user" defaultValue={sp.user ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5">
              <option value="">ทุกผู้ใช้</option>{users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
            </select>
            <input name="entity" defaultValue={sp.entity ?? ""} placeholder="ตาราง เช่น assets" className="rounded-md border border-slate-300 px-2 py-1.5" />
            <button className="rounded-md bg-blue-600 px-3 py-1.5 text-white">กรอง</button>
            <Link href="/settings/security" className="text-xs text-slate-500 underline">ล้าง</Link>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>รายการ</th><th>รายละเอียด</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {logs.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-500">ไม่มีรายการ</td></tr>}
                {logs.map((l) => (
                  <tr key={l.id} className="align-top">
                    <td className="whitespace-nowrap py-1.5 pr-3 text-xs">{new Date(l.event_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</td>
                    <td className="pr-3 text-xs">{l.user_id ? email.get(l.user_id) ?? "-" : l.actor_type === "SYSTEM" ? "ระบบ" : "-"}</td>
                    <td className="pr-3">{ACTION_LABEL[l.action] ?? l.action}</td>
                    <td className="pr-3 text-xs text-slate-600">{l.entity_type}{l.field_name && ` · ${l.field_name}`}</td>
                    <td className="max-w-md truncate text-xs text-slate-500" title={l.metadata ? JSON.stringify(l.metadata) : ""}>{meta(l.metadata)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3 text-sm">
            {page > 0 && <Link href={qs({ page: page - 1 })} className="underline">← ใหม่กว่า</Link>}
            {logs.length === PAGE && <Link href={qs({ page: page + 1 })} className="underline">เก่ากว่า →</Link>}
          </div>
        </section>
      )}
    </div>
  );
}
