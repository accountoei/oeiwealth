import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { PERSON_STATUS_LABEL, RELATIONSHIP_LABEL } from "@/lib/format";
import { movePerson } from "./actions";
import { AddPersonForm, FamilyNameForm, PersonRow } from "./forms";

const arrow = "rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30";

export default async function MembersPage() {
  const me = await requireAppUser();
  const supabase = await createClient();
  const canEdit = me.role === "ADMIN" || me.role === "EDITOR";
  const isAdmin = me.role === "ADMIN";

  const [{ data: family }, { data: persons, error }] = await Promise.all([
    supabase.from("families").select("name").maybeSingle(),
    supabase.from("persons").select("id,name,relationship,status").is("deleted_at", null).order("sort_order").order("created_at"),
  ]);
  const list = persons ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Members</h1>
        <p className="text-sm text-slate-500">สมาชิกครอบครัว · ลำดับในหน้านี้ใช้เรียงรายชื่อทุกหน้าและตัวกรองสมาชิก</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">ชื่อครอบครัว</h2>
        <p className="mb-3 text-xs text-slate-500">แสดงเป็นหัวข้อหน้า Dashboard{!isAdmin && " · แก้ได้เฉพาะผู้ดูแลระบบ"}</p>
        {isAdmin ? <FamilyNameForm name={family?.name ?? ""} /> : <p className="text-sm">{family?.name ?? "-"}</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">สมาชิกครอบครัว</h2>
        <p className="mb-3 text-xs text-slate-500">
          รายชื่อนี้ใช้เลือกเจ้าของทรัพย์สินและมุมมองรายบุคคล · ผู้ดูแลระบบที่ไม่ใช่สมาชิกครอบครัวจะไม่อยู่ในรายชื่อนี้
          {canEdit && " · กด ↑ ↓ เพื่อจัดลำดับ"}
        </p>
        {error && <p className="mb-2 text-sm text-red-600">โหลดรายชื่อสมาชิกไม่สำเร็จ: {error.message}</p>}
        <div className="divide-y divide-slate-100">
          {list.length === 0 && <p className="py-2 text-sm text-slate-500">ยังไม่มีสมาชิก</p>}
          {list.map((p, i) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="w-6 text-right text-xs text-slate-400">{i + 1}</span>
              {canEdit && (
                <div className="flex gap-1">
                  <form action={movePerson}>
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="dir" value="-1" />
                    <button disabled={i === 0} className={arrow} aria-label="ย้ายขึ้น">↑</button>
                  </form>
                  <form action={movePerson}>
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="dir" value="1" />
                    <button disabled={i === list.length - 1} className={arrow} aria-label="ย้ายลง">↓</button>
                  </form>
                </div>
              )}
              {canEdit ? <PersonRow p={p} /> : (
                <div className="text-sm">
                  {p.name}
                  <span className="ml-2 text-xs text-slate-500">
                    {RELATIONSHIP_LABEL[p.relationship ?? ""] ?? ""}{p.status !== "ACTIVE" && ` · ${PERSON_STATUS_LABEL[p.status]}`}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
        {me.role !== "VIEWER" && (
          <div className="mt-4 border-t border-slate-100 pt-4"><AddPersonForm /></div>
        )}
      </section>
    </div>
  );
}
