import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ageFrom, PERSON_STATUS_LABEL, RELATIONSHIP_LABEL, todayBangkok } from "@/lib/format";
import { movePerson } from "./actions";
import { AddPersonForm, FamilyNameForm } from "./forms";
import { FamilyTree } from "./tree";
import { SortToggle } from "@/components/SortControls";
import { ActionBar } from "@/components/ActionBar";

const arrow = "rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30";

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ view?: string; archived?: string; order?: string }> }) {
  const sp = await searchParams;
  const tree = sp.view === "tree";
  const me = await requireAppUser();
  const supabase = await createClient();
  const canEdit = me.role === "ADMIN" || me.role === "EDITOR";
  const isAdmin = me.role === "ADMIN";
  const ordering = canEdit && !tree && sp.order === "1";
  const showArchived = sp.archived === "1" || ordering;   // โหมดจัดลำดับ: แสดงทุกคน (ลำดับนับรวมคนที่ซ่อน)
  const url = (q: { view?: string; archived?: boolean; order?: boolean }) => {
    const u = new URLSearchParams();
    if (q.view) u.set("view", q.view);
    if (q.archived) u.set("archived", "1");
    if (q.order) u.set("order", "1");
    const t = u.toString();
    return `/family/members${t ? `?${t}` : ""}`;
  };

  const [{ data: family }, { data: persons, error }] = await Promise.all([
    supabase.from("families").select("name,head_person_id").maybeSingle(),
    supabase.from("persons").select("id,name,relationship,status,photo,nickname,birth_date,full_name_th,title_prefix,father_id,mother_id,spouse_id").is("deleted_at", null).order("sort_order").order("created_at"),
  ]);
  const all = persons ?? [];
  const archivedCount = all.filter((p) => p.status === "DECEASED").length;
  const list = showArchived ? all : all.filter((p) => p.status !== "DECEASED");
  const today = todayBangkok();

  const active = all.filter((p) => p.status === "ACTIVE");
  const ages = active.map((p) => ageFrom(p.birth_date, today)).filter((a): a is number => a != null);
  const head = all.find((p) => p.id === family?.head_person_id);
  const byRel = new Map<string, number>();
  active.forEach((p) => { const k = RELATIONSHIP_LABEL[p.relationship ?? ""] ?? "อื่น ๆ"; byRel.set(k, (byRel.get(k) ?? 0) + 1); });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Members</h1>
          <p className="text-sm text-slate-500">สมาชิกครอบครัว · ลำดับในหน้านี้ใช้เรียงรายชื่อทุกหน้าและตัวกรองสมาชิก</p>
        </div>
        {me.role !== "VIEWER" && <ActionBar><AddPersonForm /></ActionBar>}
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-500">ชื่อครอบครัว {isAdmin && <ActionBar><FamilyNameForm name={family?.name ?? ""} /></ActionBar>}</div>
          <div className="mt-1 truncate text-xl font-semibold">{family?.name || "-"}</div>
          <div className="mt-1 text-xs text-slate-500">แสดงเป็นหัวข้อหน้า Dashboard</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">สมาชิก</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{active.length} <span className="text-sm font-normal text-slate-500">คน</span></div>
          <div className="mt-1 text-xs text-slate-500">{archivedCount > 0 ? `Archived ${archivedCount} คน` : "ไม่มี Archived"}
            {all.length - active.length - archivedCount > 0 && ` · สถานะอื่น ${all.length - active.length - archivedCount} คน`}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">หัวหน้าครอบครัว</div>
          <div className="mt-1 truncate text-xl font-semibold">{head ? <Link href={`/family/members/${head.id}`} className="hover:underline">{head.name}</Link> : "-"}</div>
          <div className="mt-1 text-xs text-slate-500">ความสัมพันธ์ของทุกคนคิดเทียบกับคนนี้</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">ตามความสัมพันธ์</div>
          <div className="mt-1 space-y-0.5 text-xs">
            {[...byRel.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2"><span className="text-slate-600">{k}</span><span className="tabular-nums">{v}</span></div>))}
            {ages.length > 0 && <div className="pt-1 text-slate-500">อายุ {Math.min(...ages)}–{Math.max(...ages)} ปี</div>}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-medium text-slate-900">สมาชิกครอบครัว</h2>
            <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-xs">
              <Link href={url({ archived: sp.archived === "1" })} className={`px-2.5 py-1 ${!tree ? "bg-blue-600 text-white" : "bg-white hover:bg-slate-50"}`}>รายชื่อ</Link>
              <Link href={url({ view: "tree", archived: sp.archived === "1" })} className={`border-l border-slate-300 px-2.5 py-1 ${tree ? "bg-blue-600 text-white" : "bg-white hover:bg-slate-50"}`}>ผังครอบครัว</Link>
            </div>
            {archivedCount > 0 && !ordering && (
              <Link href={url({ view: tree ? "tree" : undefined, archived: sp.archived !== "1" })}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${sp.archived === "1" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                Archived ({archivedCount})
              </Link>
            )}
          </div>
          {canEdit && !tree && list.length > 1 && (
            <SortToggle active={ordering} href={url({ archived: sp.archived === "1", order: true })} doneHref={url({ archived: sp.archived === "1" })} />
          )}
        </div>
        <p className="mb-3 mt-2 text-xs text-slate-500">
          รายชื่อนี้ใช้เลือกเจ้าของทรัพย์สินและมุมมองรายบุคคล · ผู้ดูแลระบบที่ไม่ใช่สมาชิกครอบครัวจะไม่อยู่ในรายชื่อนี้
          · กดที่ชื่อเพื่อดูและแก้ข้อมูลของแต่ละคน{ordering && " · โหมดจัดลำดับ: กด ↑ ↓ (มีผลทันที) แล้วกด เสร็จ"}
        </p>
        {error && <p className="mb-2 text-sm text-red-600">โหลดรายชื่อสมาชิกไม่สำเร็จ: {error.message}</p>}
        {tree ? <div className="mt-4"><FamilyTree people={list} headId={family?.head_person_id ?? null} /></div> : (
        <div className="divide-y divide-slate-100">
          {list.length === 0 && <p className="py-2 text-sm text-slate-500">ยังไม่มีสมาชิก</p>}
          {list.map((p, i) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="w-6 text-right text-xs text-slate-400">{i + 1}</span>
              {ordering && (
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
                className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50 ${p.status === "DECEASED" ? "opacity-60" : ""}`}>
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
      </section>
    </div>
  );
}
