import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ageFrom, PERSON_STATUS_LABEL, RELATIONSHIP_LABEL, todayBangkok } from "@/lib/format";
import { movePerson } from "./actions";
import { AddPersonForm, FamilyNameForm } from "./forms";
import { FamilyTree } from "./tree";

const arrow = "rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30";

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const tree = (await searchParams).view === "tree";
  const me = await requireAppUser();
  const supabase = await createClient();
  const canEdit = me.role === "ADMIN" || me.role === "EDITOR";
  const isAdmin = me.role === "ADMIN";

  const [{ data: family }, { data: persons, error }] = await Promise.all([
    supabase.from("families").select("name,head_person_id").maybeSingle(),
    supabase.from("persons").select("id,name,relationship,status,photo,nickname,birth_date,full_name_th,title_prefix,father_id,mother_id,spouse_id").is("deleted_at", null).order("sort_order").order("created_at"),
  ]);
  const list = persons ?? [];
  const today = todayBangkok();

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium text-slate-900">สมาชิกครอบครัว</h2>
          <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm">
            <Link href="/family/members" className={`px-3 py-1 ${!tree ? "bg-slate-800 text-white" : "bg-white hover:bg-slate-50"}`}>รายชื่อ</Link>
            <Link href="/family/members?view=tree" className={`border-l border-slate-300 px-3 py-1 ${tree ? "bg-slate-800 text-white" : "bg-white hover:bg-slate-50"}`}>ผังครอบครัว</Link>
          </div>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          รายชื่อนี้ใช้เลือกเจ้าของทรัพย์สินและมุมมองรายบุคคล · ผู้ดูแลระบบที่ไม่ใช่สมาชิกครอบครัวจะไม่อยู่ในรายชื่อนี้
          · กดที่ชื่อเพื่อดูและแก้ข้อมูลของแต่ละคน{canEdit && " · กด ↑ ↓ เพื่อจัดลำดับ"}
        </p>
        {error && <p className="mb-2 text-sm text-red-600">โหลดรายชื่อสมาชิกไม่สำเร็จ: {error.message}</p>}
        {tree ? <div className="mt-4"><FamilyTree people={list} headId={family?.head_person_id ?? null} /></div> : (
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
              <Link href={`/family/members/${p.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                {p.photo
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.photo} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
                  : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-base text-slate-500">{p.name.slice(0, 1)}</span>}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">
                    {p.name}{p.nickname && <span className="font-normal text-slate-500"> ({p.nickname})</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {p.id === family?.head_person_id ? "★ หัวหน้าครอบครัว" : RELATIONSHIP_LABEL[p.relationship ?? ""] ?? "-"}
                    {(() => { const a = ageFrom(p.birth_date, today); return a != null ? ` · ${a} ปี` : ""; })()}
                    {p.full_name_th && ` · ${[p.title_prefix, p.full_name_th].filter(Boolean).join(" ")}`}
                  </div>
                </div>
                {p.status !== "ACTIVE" && (
                  <span className={`ml-auto shrink-0 rounded px-2 py-0.5 text-xs ${p.status === "DECEASED" ? "bg-slate-200 text-slate-700" : "bg-amber-50 text-amber-700"}`}>
                    {PERSON_STATUS_LABEL[p.status]}
                  </span>
                )}
                <span className="shrink-0 text-slate-300">›</span>
              </Link>
            </div>
          ))}
        </div>
        )}
        {me.role !== "VIEWER" && (
          <div className="mt-4 border-t border-slate-100 pt-4"><AddPersonForm /></div>
        )}
      </section>
    </div>
  );
}
