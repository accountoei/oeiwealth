import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ageFrom, money, PERSON_STATUS_LABEL, RELATIONSHIP_LABEL, thDate, todayBangkok } from "@/lib/format";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { PersonDetailsForm, type PersonDetails } from "./details-form";
import { setFamilyHead } from "../actions";

const FIELDS = "id,name,relationship,status,title_prefix,full_name_th,full_name_en,nickname,birth_date,photo,phone,email,address," +
  "emergency_contact_name,emergency_contact_phone,national_id,passport_no,passport_expiry,house_registration_no,notes,father_id,mother_id,spouse_id,death_date";

type Doc = { id: string; title: string; document_type: string; mime_type: string | null; version_status: string; deleted_at: string | null; created_at: string };

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900 whitespace-pre-line">{children || <span className="text-slate-400">-</span>}</dd>
    </div>
  );
}

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
    supabase.from("persons").select("id,name,status,father_id,mother_id,spouse_id").is("deleted_at", null).order("sort_order").order("created_at"),
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

  return (
    <div className="space-y-6">
      <Link href="/family/members" className="text-sm text-slate-500 hover:underline">← Members</Link>

      <section className="flex flex-wrap items-center gap-5 rounded-xl border border-slate-200 bg-white p-5">
        {p.photo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={p.photo} alt="" className="h-24 w-24 rounded-full object-cover" />
          : <div className="flex h-24 w-24 items-center justify-center rounded-full bg-slate-100 text-2xl font-semibold text-slate-400">{p.name.slice(0, 1)}</div>}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-slate-900">{p.name}{p.nickname && <span className="ml-2 text-base font-normal text-slate-500">({p.nickname})</span>}</h1>
          {fullName && <p className="text-sm text-slate-700">{fullName}</p>}
          {p.full_name_en && <p className="text-sm text-slate-500">{p.full_name_en}</p>}
          <p className="mt-1 text-xs text-slate-500">
            {isHead && <span className="mr-1 rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">★ หัวหน้าครอบครัว</span>}
            {!isHead && (RELATIONSHIP_LABEL[p.relationship ?? ""] ?? "-")}
            {age != null && ` · อายุ ${age} ปี`}
            {p.status !== "ACTIVE" && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{PERSON_STATUS_LABEL[p.status]}</span>}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Net Worth (ตามสัดส่วน)</div>
          <div className="text-xl font-semibold tabular-nums">{money(nw?.net_worth ?? 0, "THB", 0)}</div>
          <div className="text-xs text-slate-500">สินทรัพย์ {money(nw?.total_assets ?? 0, "THB", 0)} · หนี้ {money(nw?.total_liabilities ?? 0, "THB", 0)}</div>
        </div>
      </section>

      <nav className="flex flex-wrap gap-2 text-sm">
        {[[`/?p=${id}`, "Dashboard ของคนนี้"], [`/insurance?p=${id}`, `กรมธรรม์ (${policies ?? 0})`], [`/family/health?p=${id}`, "สุขภาพ"],
          [`/family/memberships?p=${id}`, "สมาชิกภาพ & แต้ม"], [`/documents?p=${id}`, "เอกสาร"]].map(([href, l]) => (
          <Link key={href} href={href} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">{l}</Link>
        ))}
      </nav>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-medium text-slate-900">ข้อมูลทั่วไป</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Item label="คำนำหน้า / ชื่อ-นามสกุล (ไทย)">{fullName}</Item>
            <Item label="ชื่อ-นามสกุล (อังกฤษ)">{p.full_name_en}</Item>
            <Item label="ชื่อเล่น">{p.nickname}</Item>
            <Item label="วันเกิด">{p.birth_date ? `${thDate(p.birth_date)}${age != null ? ` (${age} ปี)` : ""}` : ""}</Item>
            {archived && <Item label="วันที่เสียชีวิต">{p.death_date ? thDate(p.death_date) : ""}</Item>}
            <div className="sm:col-span-2"><Item label="หมายเหตุ">{p.notes}</Item></div>
          </dl>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-medium text-slate-900">การติดต่อ</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Item label="เบอร์โทร">{p.phone && <a href={`tel:${p.phone}`} className="text-blue-700 hover:underline">{p.phone}</a>}</Item>
            <Item label="อีเมล">{p.email && <a href={`mailto:${p.email}`} className="text-blue-700 hover:underline">{p.email}</a>}</Item>
            <div className="sm:col-span-2"><Item label="ที่อยู่">{p.address}</Item></div>
            <Item label="ผู้ติดต่อฉุกเฉิน">{p.emergency_contact_name}</Item>
            <Item label="เบอร์ผู้ติดต่อฉุกเฉิน">{p.emergency_contact_phone && <a href={`tel:${p.emergency_contact_phone}`} className="text-blue-700 hover:underline">{p.emergency_contact_phone}</a>}</Item>
          </dl>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium text-slate-900">ครอบครัว</h2>
            {me.role === "ADMIN" && !isHead && p.status === "ACTIVE" && (
              <form action={setFamilyHead}>
                <input type="hidden" name="id" value={id} />
                <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50">ตั้งเป็นหัวหน้าครอบครัว</button>
              </form>
            )}
          </div>
          <dl className="grid gap-3 sm:grid-cols-4">
            <Item label="พ่อ"><PLink pid={p.father_id} /></Item>
            <Item label="แม่"><PLink pid={p.mother_id} /></Item>
            <Item label="คู่สมรส"><PLink pid={p.spouse_id} /></Item>
            <Item label="ลูก">{children.length > 0 && children.map((c, i) => <span key={c.id}>{i > 0 && ", "}<PLink pid={c.id} /></span>)}</Item>
          </dl>
          <p className="mt-2 text-xs text-slate-500">
            ความสัมพันธ์คำนวณเทียบกับหัวหน้าครอบครัว{nameOf.get(family?.head_person_id ?? "") ? ` (${nameOf.get(family?.head_person_id ?? "")})` : ""}
            {me.role === "ADMIN" && !isHead && p.status === "ACTIVE" && " · กดปุ่ม \"ตั้งเป็นหัวหน้าครอบครัว\" แล้วความสัมพันธ์ของทุกคนจะเปลี่ยนตาม"}
          </p>
        </section>

        {archived && (
          <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-5 lg:col-span-2">
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
              </table>
            )}
          </section>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <h2 className="mb-3 font-medium text-slate-900">เอกสารประจำตัว</h2>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1"><Item label="เลขบัตรประชาชน">{fmtNid(p.national_id)}</Item><DocLink types={["บัตรประชาชน"]} /></div>
            <div className="space-y-1"><Item label="เลขทะเบียนบ้าน">{p.house_registration_no}</Item><DocLink types={["ทะเบียนบ้าน"]} /></div>
            <div className="space-y-1">
              <Item label="หนังสือเดินทาง">
                {p.passport_no}{p.passport_expiry && <span className={passportExpired ? "text-red-600" : "text-slate-500"}> · หมดอายุ {thDate(p.passport_expiry)}{passportExpired ? " (หมดแล้ว)" : ""}</span>}
              </Item>
              <DocLink types={["หนังสือเดินทาง", "passport"]} />
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">แนบสำเนาที่ส่วน &ldquo;เอกสารส่วนตัว&rdquo; ด้านล่าง โดยเลือกประเภท บัตรประชาชน / ทะเบียนบ้าน / หนังสือเดินทาง — ลิงก์จะขึ้นข้างเลขให้เอง</p>
        </section>
      </div>

      {canEdit && <PersonDetailsForm p={p} others={people.filter((x) => x.id !== id).map((x) => ({ id: x.id, name: x.name }))}
        isHead={isHead} headCandidates={people.filter((x) => x.id !== id && x.status === "ACTIVE").map((x) => ({ id: x.id, name: x.name }))} />}

      <EntityDocuments entityType="PERSON" entityId={id} module="FAMILY" role={me.role} title="เอกสารส่วนตัว" paths={[`/family/members/${id}`]} />
    </div>
  );
}
