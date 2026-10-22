import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ageFrom, EDUCATION_LEVEL_LABEL, GENDER_LABEL, genderOf, kinLabel, money, PERSON_STATUS_LABEL, thDate, todayBangkok } from "@/lib/format";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { PersonDetailsForm, type PersonDetails } from "./details-form";
import { DetailItem as Item } from "@/components/Boxes";

const FIELDS = "id,name,relationship,status,title_prefix,full_name_th,full_name_en,nickname,birth_date,photo,phone,email,address," +
  "emergency_contact_name,emergency_contact_phone,national_id,passport_no,passport_expiry,house_registration_no,notes,father_id,mother_id,spouse_id,death_date," +
  "gender,education_level,education_institution,education_major,occupation,workplace,job_title,social_positions";

type Doc = { id: string; title: string; document_type: string; mime_type: string | null; version_status: string; deleted_at: string | null; created_at: string };


function fmtNid(n: string | null) {
  return n && n.length === 13 ? `${n[0]}-${n.slice(1, 5)}-${n.slice(5, 10)}-${n.slice(10, 12)}-${n[12]}` : n;
}

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAppUser();
  const supabase = await createClient();
  const [{ data: person }, { data: nw }, { data: links }, { data: status }, { count: policies }, { data: all }, { data: family }] = await Promise.all([
    supabase.from("persons").select(FIELDS).eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_net_worth_by_person").select("total_assets,total_liabilities,net_worth").eq("person_id", id).maybeSingle(),
    supabase.from("document_links").select("documents(id,title,document_type,mime_type,version_status,deleted_at,created_at)")
      .eq("entity_type", "PERSON").eq("entity_id", id).is("deleted_at", null),
    supabase.rpc("drive_status"),
    supabase.from("insurance_policies").select("id", { count: "exact", head: true }).eq("person_id", id).eq("status", "ACTIVE").is("deleted_at", null),
    supabase.from("persons").select("id,name,status,relationship,gender,title_prefix,birth_date,father_id,mother_id,spouse_id").is("deleted_at", null).order("sort_order").order("created_at"),
    supabase.from("families").select("head_person_id").maybeSingle(),
  ]);
  // สมาชิก Archived: ทรัพย์สิน / หนี้ที่ยังมีชื่ออยู่ (ต้องโอนให้ทายาท / จัดการ)
  const { data: estate } = (person as { status?: string } | null)?.status === "DECEASED"
    ? await supabase.from("v_net_worth_items_current")
        .select("item_type,asset_id,liability_id,credit_card_id,lease_id,item_name,item_group,value,currency,base_value,ownership_percent")
        .eq("person_id", id)
    : { data: null };
  if (!person) notFound();
  const p = person as unknown as PersonDetails & { name: string; relationship: string | null; status: string };
  const canEdit = me.role === "ADMIN" || me.role === "EDITOR";
  const isHead = family?.head_person_id === id;
  const people = all ?? [];
  const nameOf = new Map(people.map((x) => [x.id, x.name]));
  const children = people.filter((x) => x.father_id === id || x.mother_id === id);
  const PLink = ({ pid }: { pid: string | null }) => pid && nameOf.has(pid)
    ? <Link href={`/family/members/${pid}`} className="text-blue-700 hover:underline">{nameOf.get(pid)}</Link> : null;
  const today = todayBangkok();
  const archived = p.status === "DECEASED";
  const age = ageFrom(p.birth_date, archived && p.death_date ? p.death_date : today);
  const connected = !!(status as { connected?: boolean } | null)?.connected;
  const docs = (links ?? []).map((l) => (Array.isArray(l.documents) ? l.documents[0] : l.documents) as Doc | null)
    .filter((d): d is Doc => !!d && !d.deleted_at && d.version_status === "CURRENT")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  /** สำเนาเอกสารล่าสุดตามประเภท (ประเภทที่ใช้ในหน้า Documents) */
  const docOf = (...types: string[]) => docs.find((d) => types.some((t) => d.document_type.toLowerCase().includes(t.toLowerCase())));
  const DocLink = ({ types }: { types: string[] }) => {
    const d = docOf(...types);
    if (!d) return <span className="text-xs text-slate-400">ยังไม่ได้แนบสำเนา</span>;
    return connected ? <span className="text-xs text-slate-600">สำเนา: <a href={`/view/${d.id}`} target="_blank" rel="noopener" className="text-sky-700 hover:underline">{d.title}</a></span>
      : <span className="text-xs text-slate-500">มีสำเนา (ต้องเชื่อม Google Drive เพื่อเปิด)</span>;
  };
  const passportExpired = p.passport_expiry && p.passport_expiry < today;
  const fullName = [p.title_prefix, p.full_name_th].filter(Boolean).join(" ");
  const gender = genderOf(p, people);
  const education = [p.education_level ? EDUCATION_LEVEL_LABEL[p.education_level] : null, p.education_major, p.education_institution].filter(Boolean).join(" · ");

  const headLabel = nameOf.get(family?.head_person_id ?? "");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/family/members" className="text-sm text-slate-500 hover:underline">← Members</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4">
            {p.photo
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={p.photo} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
              : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xl font-semibold text-slate-400">{p.name.slice(0, 1)}</div>}
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-slate-900">{p.name}{p.nickname && <span className="ml-2 text-base font-normal text-slate-500">({p.nickname})</span>}</h1>
              <p className="text-sm text-slate-500">
                {isHead ? <span className="mr-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">★ หัวหน้าครอบครัว</span> : kinLabel(p, people, family?.head_person_id)}
                {age != null && ` · อายุ ${age} ปี`}
                {p.status !== "ACTIVE" && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{PERSON_STATUS_LABEL[p.status]}</span>}
              </p>
            </div>
          </div>
        </div>
      </div>

      <nav className="flex flex-wrap gap-2 text-sm">
        {[[`/?p=${id}`, "Dashboard ของคนนี้"], [`/insurance?p=${id}`, `กรมธรรม์ (${policies ?? 0})`], [`/family/health?p=${id}`, "สุขภาพ"],
          [`/family/memberships?p=${id}`, "สมาชิกภาพ & แต้ม"], [`/documents?p=${id}`, "เอกสาร"]].map(([href, l]) => (
          <Link key={href} href={href} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">{l}</Link>
        ))}
      </nav>

      <section className="grid gap-4 md:grid-cols-3">
        {/* ซ้าย: Net Worth + เอกสาร */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
            <div className="text-xs text-slate-500">Net Worth (ตามสัดส่วน)</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{money(nw?.net_worth ?? 0, "THB", 0)}</div>
            <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">สินทรัพย์</dt><dd className="tabular-nums">{money(nw?.total_assets ?? 0, "THB", 0)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">หนี้สิน</dt><dd className="tabular-nums">{money(nw?.total_liabilities ?? 0, "THB", 0)}</dd></div>
            </dl>
          </div>
          <div className="flex flex-1 flex-col">
            <EntityDocuments category="PERSON" entityType="PERSON" entityId={id} module="FAMILY" role={me.role} title="เอกสารส่วนตัว" paths={[`/family/members/${id}`]} fill />
          </div>
        </div>

        <div className="space-y-6 rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
          <div>
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="font-medium text-slate-900">รายละเอียด</h2>
              {canEdit && <PersonDetailsForm p={p} others={people.filter((x) => x.id !== id).map((x) => ({ id: x.id, name: x.name }))}
                isHead={isHead} headCandidates={people.filter((x) => x.id !== id && x.status === "ACTIVE").map((x) => ({ id: x.id, name: x.name }))} />}
            </div>
            <dl className="text-sm grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Item dash label="คำนำหน้า / ชื่อ-นามสกุล (ไทย)">{fullName}</Item>
              <Item dash label="ชื่อ-นามสกุล (อังกฤษ)">{p.full_name_en}</Item>
              <Item dash label="ชื่อเล่น">{p.nickname}</Item>
              <Item dash label="วันเกิด">{p.birth_date ? `${thDate(p.birth_date)}${age != null ? ` (${age} ปี)` : ""}` : ""}</Item>
              <Item dash label="เพศ">{gender ? `${GENDER_LABEL[gender]}${p.gender ? "" : " (ดูจากคำนำหน้า / ผัง)"}` : ""}</Item>
              {archived && <Item dash label="วันที่เสียชีวิต">{p.death_date ? thDate(p.death_date) : ""}</Item>}
              <Item dash wide label="หมายเหตุ">{p.notes}</Item>
            </dl>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <h2 className="mb-3 font-medium text-slate-900">การศึกษาและการงาน</h2>
            <dl className="text-sm grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Item dash label="การศึกษา">{education}</Item>
              <Item dash label="อาชีพ">{p.occupation}</Item>
              <Item dash label="ตำแหน่ง / ที่ทำงาน">{[p.job_title, p.workplace].filter(Boolean).join(" · ")}</Item>
              <Item dash wide label="ตำแหน่งทางสังคม">{p.social_positions && <span className="whitespace-pre-line">{p.social_positions}</span>}</Item>
            </dl>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <h2 className="mb-3 font-medium text-slate-900">การติดต่อ</h2>
            <dl className="text-sm grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Item dash label="เบอร์โทร">{p.phone && <a href={`tel:${p.phone}`} className="text-blue-700 hover:underline">{p.phone}</a>}</Item>
              <Item dash label="อีเมล">{p.email && <a href={`mailto:${p.email}`} className="text-blue-700 hover:underline">{p.email}</a>}</Item>
              <Item dash label="ผู้ติดต่อฉุกเฉิน">{[p.emergency_contact_name, p.emergency_contact_phone].filter(Boolean).join(" · ")}</Item>
              <Item dash wide label="ที่อยู่">{p.address}</Item>
            </dl>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <h2 className="mb-3 font-medium text-slate-900">ครอบครัว</h2>
            <dl className="text-sm grid gap-3 sm:grid-cols-4">
              <Item dash label="พ่อ"><PLink pid={p.father_id} /></Item>
              <Item dash label="แม่"><PLink pid={p.mother_id} /></Item>
              <Item dash label="คู่สมรส"><PLink pid={p.spouse_id} /></Item>
              <Item dash label="ลูก">{children.length > 0 && children.map((c, i) => <span key={c.id}>{i > 0 && ", "}<PLink pid={c.id} /></span>)}</Item>
            </dl>
            <p className="mt-2 text-xs text-slate-500">ความสัมพันธ์คำนวณเทียบกับหัวหน้าครอบครัว{headLabel ? ` (${headLabel})` : ""}</p>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <h2 className="mb-3 font-medium text-slate-900">เอกสารประจำตัว</h2>
            <dl className="text-sm grid gap-4 sm:grid-cols-3">
              <div className="space-y-1"><Item dash label="เลขบัตรประชาชน">{fmtNid(p.national_id)}</Item><DocLink types={["บัตรประชาชน"]} /></div>
              <div className="space-y-1"><Item dash label="เลขทะเบียนบ้าน">{p.house_registration_no}</Item><DocLink types={["ทะเบียนบ้าน"]} /></div>
              <div className="space-y-1">
                <Item dash label="หนังสือเดินทาง">
                  {p.passport_no}{p.passport_expiry && <span className={passportExpired ? "text-red-600" : "text-slate-500"}> · หมดอายุ {thDate(p.passport_expiry)}{passportExpired ? " (หมดแล้ว)" : ""}</span>}
                </Item>
                <DocLink types={["หนังสือเดินทาง", "passport"]} />
              </div>
            </dl>
            <p className="mt-3 text-xs text-slate-500">แนบสำเนาที่กล่อง &ldquo;เอกสารส่วนตัว&rdquo; โดยเลือกประเภท บัตรประชาชน / ทะเบียนบ้าน / หนังสือเดินทาง — ลิงก์จะขึ้นข้างเลขให้เอง</p>
          </div>
        </div>
      </section>

      {archived && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-5">
          <h2 className="font-medium text-slate-900">ทรัพย์สินที่ต้องจัดการ</h2>
          <p className="mb-3 text-xs text-slate-500">
            รายการที่ยังมีชื่อของสมาชิกคนนี้ (นับใน Net Worth ตามสัดส่วน) · โอนให้ทายาท: เปิดรายการ → แก้เจ้าของ → เลือก &ldquo;เปลี่ยนเจ้าของ&rdquo; พร้อมวันที่มีผล · โอนหมดแล้วรายการจะหายไปเอง
          </p>
          {(estate ?? []).length === 0 ? <p className="text-sm text-emerald-700">ไม่มีรายการค้าง — จัดการครบแล้ว</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1.5 pr-3">รายการ</th><th className="pr-3">ประเภท</th><th className="pr-3 text-right">สัดส่วน</th><th className="text-right">มูลค่าส่วนนี้ (บาท)</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(estate ?? []).map((e, i) => {
                  const href = e.asset_id ? `/a/${e.asset_id}` : e.liability_id ? `/liabilities/${e.liability_id}`
                    : e.credit_card_id ? `/liabilities/cards/${e.credit_card_id}` : e.lease_id ? "/property" : null;
                  const debt = e.item_type !== "ASSET";
                  return (
                    <tr key={i}>
                      <td className="py-1.5 pr-3">{href ? <Link href={href} className="text-blue-700 hover:underline">{e.item_name}</Link> : e.item_name}</td>
                      <td className="pr-3 text-xs text-slate-500">{debt ? "หนี้สิน" : "สินทรัพย์"}{e.item_group ? ` · ${e.item_group}` : ""}</td>
                      <td className="pr-3 text-right tabular-nums">{Number(e.ownership_percent).toLocaleString("th-TH", { maximumFractionDigits: 2 })}%</td>
                      <td className={`text-right tabular-nums ${debt ? "text-red-700" : ""}`}>{debt ? "-" : ""}{money(e.base_value, "THB", 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
                <tr><td className="py-1.5 pr-3" colSpan={3}>รวมสุทธิ</td>
                  <td className="text-right tabular-nums">{money((estate ?? []).reduce((t, e) => t + (e.item_type !== "ASSET" ? -1 : 1) * Number(e.base_value ?? 0), 0), "THB", 0)}</td></tr>
              </tfoot>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
