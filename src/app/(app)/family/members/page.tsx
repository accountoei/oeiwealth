import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ageFrom, daysToBirthday, EDUCATION_LEVEL_LABEL, GEN_FILTER_LABEL, GENDER_LABEL, genderOf, kinLabel, money, PERSON_STATUS_LABEL, RELATION_GEN, todayBangkok } from "@/lib/format";
import { movePerson } from "./actions";
import { AddPersonForm, FamilyNameForm } from "./forms";
import { FamilyTree } from "./tree";
import { SortToggle } from "@/components/SortControls";
import { ActionBar } from "@/components/ActionBar";

const arrow = "rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30";
const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`;

type Sp = { view?: string; archived?: string; order?: string; q?: string; gen?: string; g?: string; missing?: string };

export default async function MembersPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const tree = sp.view === "tree";
  const me = await requireAppUser();
  const supabase = await createClient();
  const canEdit = me.role === "ADMIN" || me.role === "EDITOR";
  const isAdmin = me.role === "ADMIN";
  const ordering = canEdit && !tree && sp.order === "1";
  const showArchived = sp.archived === "1" || ordering;   // โหมดจัดลำดับ: แสดงทุกคน (ลำดับนับรวมคนที่ซ่อน)
  // ตัวกรองรายชื่อ (เฉพาะมุมมองรายชื่อ · ไม่ใช้ในโหมดจัดลำดับ)
  const q = (sp.q ?? "").trim();
  const fGen = sp.gen && sp.gen in GEN_FILTER_LABEL ? sp.gen : "";
  const fG = sp.g === "M" || sp.g === "F" ? sp.g : "";
  const fMissing = sp.missing === "1";
  const filtering = !tree && !ordering && !!(q || fGen || fG || fMissing);
  const url = (o: { view?: string; archived?: boolean; order?: boolean; q?: string; gen?: string; g?: string; missing?: boolean }) => {
    const u = new URLSearchParams();
    if (o.view) u.set("view", o.view);
    if (o.archived) u.set("archived", "1");
    if (o.order) u.set("order", "1");
    if (o.q) u.set("q", o.q);
    if (o.gen) u.set("gen", o.gen);
    if (o.g) u.set("g", o.g);
    if (o.missing) u.set("missing", "1");
    const t = u.toString();
    return `/family/members${t ? `?${t}` : ""}`;
  };
  const cur = { archived: sp.archived === "1", q, gen: fGen, g: fG, missing: fMissing };

  const [{ data: family }, { data: persons, error }, { data: nwRows }, { data: policyRows }] = await Promise.all([
    supabase.from("families").select("name,head_person_id").maybeSingle(),
    supabase.from("persons").select("id,name,relationship,status,photo,nickname,birth_date,full_name_th,full_name_en,title_prefix,gender,national_id,education_level,occupation,workplace,job_title,passport_expiry,father_id,mother_id,spouse_id").is("deleted_at", null).order("sort_order").order("created_at"),
    supabase.from("v_net_worth_by_person").select("person_id,net_worth"),
    supabase.from("insurance_policies").select("person_id").eq("status", "ACTIVE").is("deleted_at", null),
  ]);
  const nwOf = new Map((nwRows ?? []).map((r) => [r.person_id as string, r]));
  // Net Worth ทั้งครอบครัว (รวมรายการที่ไม่ได้ระบุเจ้าของ) → % ของแต่ละคน
  const familyNw = (nwRows ?? []).reduce((t, r) => t + Number(r.net_worth ?? 0), 0);
  const policiesOf = new Map<string, number>();
  (policyRows ?? []).forEach((r) => { if (r.person_id) policiesOf.set(r.person_id, (policiesOf.get(r.person_id) ?? 0) + 1); });
  const all = persons ?? [];
  const archivedCount = all.filter((p) => p.status === "DECEASED").length;
  const shown = showArchived ? all : all.filter((p) => p.status !== "DECEASED");
  const today = todayBangkok();
  const headId = family?.head_person_id ?? null;
  const genOf = (p: (typeof all)[number]) => (p.id === headId ? "mid" : RELATION_GEN[p.relationship ?? ""] ?? "other");
  /** ข้อมูลหลักที่ยังไม่ได้กรอก (ใช้ตอนนำเข้าข้อมูลจริง) */
  const missingOf = (p: (typeof all)[number]) => [
    !p.full_name_th && "ชื่อ-นามสกุลจริง", !genderOf(p, all) && "เพศ", !p.birth_date && "วันเกิด", !p.national_id && "เลขบัตรประชาชน",
  ].filter((x): x is string => !!x);
  /** ป้ายด้านขวาของแถว: เรื่องที่ต้องดู (พาสปอร์ต · วันเกิด) + ข้อมูลยังไม่ครบ */
  const badgesOf = (p: (typeof all)[number]) => {
    const b: { text: string; cls: string; title?: string }[] = [];
    if (p.status !== "DECEASED") {
      if (p.passport_expiry) {
        const months = (Date.parse(p.passport_expiry) - Date.parse(today)) / (30.44 * 86400000);
        if (months < 0) b.push({ text: "พาสปอร์ตหมดอายุแล้ว", cls: "bg-red-50 text-red-700" });
        else if (months <= 6) b.push({ text: months < 1 ? "พาสปอร์ตหมดอายุใน 1 เดือน" : `พาสปอร์ตหมดอายุใน ${Math.ceil(months)} เดือน`, cls: "bg-amber-50 text-amber-700" });
      }
      const d = daysToBirthday(p.birth_date, today);
      if (d === 0) b.push({ text: "วันเกิดวันนี้", cls: "bg-emerald-50 text-emerald-700" });
      else if (d != null && d <= 30) b.push({ text: `วันเกิดอีก ${d} วัน`, cls: "bg-sky-50 text-sky-700" });
    }
    const miss = missingOf(p);
    if (miss.length > 0) b.push({ text: `ขาด ${miss.length} ช่อง`, cls: "bg-amber-50 text-amber-700", title: `ยังไม่ได้กรอก: ${miss.join(", ")}` });
    return b;
  };
  const needle = q.toLowerCase();
  const list = !filtering ? shown : shown.filter((p) =>
    (!needle || [p.name, p.nickname, p.full_name_th, p.full_name_en].some((x) => x?.toLowerCase().includes(needle)))
    && (!fGen || genOf(p) === fGen)
    && (!fG || genderOf(p, all) === fG)
    && (!fMissing || missingOf(p).length > 0));
  const genCount = (g: string) => shown.filter((p) => genOf(p) === g).length;
  const missingCount = shown.filter((p) => missingOf(p).length > 0).length;

  const active = all.filter((p) => p.status === "ACTIVE");
  const ages = active.map((p) => ageFrom(p.birth_date, today)).filter((a): a is number => a != null);
  const head = all.find((p) => p.id === family?.head_person_id);
  const byRel = new Map<string, number>();
  active.forEach((p) => { const k = kinLabel(p, all, headId); byRel.set(k, (byRel.get(k) ?? 0) + 1); });

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
          {canEdit && !tree && !filtering && list.length > 1 && (
            <SortToggle active={ordering} href={url({ archived: sp.archived === "1", order: true })} doneHref={url({ archived: sp.archived === "1" })} />
          )}
        </div>
        <p className="mb-3 mt-2 text-xs text-slate-500">
          รายชื่อนี้ใช้เลือกเจ้าของทรัพย์สินและมุมมองรายบุคคล · ผู้ดูแลระบบที่ไม่ใช่สมาชิกครอบครัวจะไม่อยู่ในรายชื่อนี้
          · กดที่ชื่อเพื่อดูและแก้ข้อมูลของแต่ละคน{ordering && " · โหมดจัดลำดับ: กด ↑ ↓ (มีผลทันที) แล้วกด เสร็จ"}
        </p>
        {!tree && !ordering && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <form method="get" action="/family/members" className="flex items-center gap-1">
              {cur.archived && <input type="hidden" name="archived" value="1" />}
              {fGen && <input type="hidden" name="gen" value={fGen} />}
              {fG && <input type="hidden" name="g" value={fG} />}
              {fMissing && <input type="hidden" name="missing" value="1" />}
              <input name="q" defaultValue={q} placeholder="ค้นหาชื่อ / ชื่อเล่น" data-plain
                className="w-44 rounded-md border border-slate-300 px-2.5 py-1 text-sm" aria-label="ค้นหาสมาชิก" />
              <button className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">ค้นหา</button>
            </form>
            <span className="mx-1 h-4 w-px bg-slate-200" />
            <Link href={url({ ...cur, gen: "" })} className={chip(!fGen)}>ทุกรุ่น</Link>
            {Object.entries(GEN_FILTER_LABEL).filter(([k]) => genCount(k) > 0).map(([k, l]) => (
              <Link key={k} href={url({ ...cur, gen: fGen === k ? "" : k })} className={chip(fGen === k)}>{l} ({genCount(k)})</Link>))}
            <span className="mx-1 h-4 w-px bg-slate-200" />
            {Object.entries(GENDER_LABEL).map(([k, l]) => (
              <Link key={k} href={url({ ...cur, g: fG === k ? "" : k })} className={chip(fG === k)}>{l}</Link>))}
            <span className="mx-1 h-4 w-px bg-slate-200" />
            <Link href={url({ ...cur, missing: !fMissing })} className={fMissing || missingCount === 0 ? chip(fMissing) : "rounded-full border border-amber-300 px-2.5 py-0.5 text-xs text-amber-700 hover:bg-amber-50"}>
              ข้อมูลยังไม่ครบ ({missingCount})
            </Link>
            {filtering && <Link href={url({ archived: cur.archived })} className="text-xs text-slate-500 underline">ล้างตัวกรอง</Link>}
          </div>
        )}
        {error && <p className="mb-2 text-sm text-red-600">โหลดรายชื่อสมาชิกไม่สำเร็จ: {error.message}</p>}
        {tree ? <div className="mt-4"><FamilyTree people={list} kin={all} headId={headId} /></div> : (
        <div className="divide-y divide-slate-100">
          {list.length > 0 && !ordering && (
            <div className="hidden items-center gap-3 pb-1.5 text-sm text-slate-500 sm:flex">
              <span className="w-6" />
              <div className="flex flex-1 items-center gap-3 px-2">
                <span className="w-11 shrink-0" />
                <span className="flex-1">สมาชิก</span>
                <span className="hidden w-20 shrink-0 text-right md:block">กรมธรรม์</span>
                <span className="hidden w-40 shrink-0 text-right md:block">สิ่งที่ต้องดู</span>
                <span className="w-48 shrink-0 text-right">Net Worth</span>
                <span className="invisible shrink-0">›</span>
              </div>
            </div>
          )}
          {list.length === 0 && <p className="py-2 text-sm text-slate-500">{filtering ? "ไม่พบสมาชิกตามตัวกรอง" : "ยังไม่มีสมาชิก"}</p>}
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
                className={`flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50 ${p.status === "DECEASED" ? "opacity-60" : ""}`}>
                {p.photo
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.photo} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
                  : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-base text-slate-500">{p.name.slice(0, 1)}</span>}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">
                    {p.name}{p.nickname && <span className="font-normal text-slate-500"> ({p.nickname})</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {p.id === headId ? "★ หัวหน้าครอบครัว" : kinLabel(p, all, headId)}
                    {(() => { const a = ageFrom(p.birth_date, today); return a != null ? ` · ${a} ปี` : ""; })()}
                    {p.full_name_th && ` · ${[p.title_prefix, p.full_name_th].filter(Boolean).join(" ")}`}
                  </div>
                  {(() => {
                    const work = [p.job_title, p.workplace].filter(Boolean).join(" · ") || p.occupation;
                    const edu = p.education_level ? EDUCATION_LEVEL_LABEL[p.education_level] : null;
                    return (work || edu) && <div className="truncate text-xs text-slate-500">{[work, edu].filter(Boolean).join(" · ")}</div>;
                  })()}
                  {fMissing && <div className="truncate text-xs text-amber-700">ยังไม่ได้กรอก: {missingOf(p).join(", ")}</div>}
                </div>
                <div className="hidden w-20 shrink-0 text-right text-sm tabular-nums text-slate-700 md:block">
                  {policiesOf.get(p.id) ? `${policiesOf.get(p.id)} ฉบับ` : <span className="text-slate-300">-</span>}
                </div>
                <div className="hidden w-40 shrink-0 flex-col items-end gap-1 md:flex">
                  {p.status !== "ACTIVE" && (
                    <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${p.status === "DECEASED" ? "bg-slate-200 text-slate-700" : "bg-amber-50 text-amber-700"}`}>
                      {PERSON_STATUS_LABEL[p.status]}
                    </span>
                  )}
                  {badgesOf(p).map((x) => <span key={x.text} title={x.title} className={`shrink-0 rounded px-2 py-0.5 text-xs ${x.cls}`}>{x.text}</span>)}
                </div>
                {(() => {
                  const nw = nwOf.get(p.id);
                  const pct = nw && familyNw > 0 ? (Number(nw.net_worth) / familyNw) * 100 : null;
                  return (
                    <div className="hidden w-48 shrink-0 text-right tabular-nums sm:block">
                      {nw && <div className="text-sm font-medium text-slate-900">{money(nw.net_worth, "THB", 0)}</div>}
                      {pct != null && <div className="text-[11px] text-slate-500">{pct.toFixed(1)}%</div>}
                    </div>
                  );
                })()}
                <span className="shrink-0 self-center text-slate-300">›</span>
              </Link>
            </div>
          ))}
        </div>
        )}
      </section>
    </div>
  );
}
