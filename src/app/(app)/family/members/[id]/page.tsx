import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { ageFrom, money, PERSON_STATUS_LABEL, RELATIONSHIP_LABEL, thDate, todayBangkok } from "@/lib/format";
import EntityDocuments from "@/components/docs/EntityDocuments";
import { OpenDoc } from "@/components/docs/DocButtons";
import { PersonDetailsForm, type PersonDetails } from "./details-form";

const FIELDS = "id,name,relationship,status,title_prefix,full_name_th,full_name_en,nickname,birth_date,photo,phone,email,address," +
  "emergency_contact_name,emergency_contact_phone,national_id,passport_no,passport_expiry,house_registration_no,notes";

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
  const [{ data: person }, { data: nw }, { data: links }, { data: status }, { count: policies }] = await Promise.all([
    supabase.from("persons").select(FIELDS).eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("v_net_worth_by_person").select("total_assets,total_liabilities,net_worth").eq("person_id", id).maybeSingle(),
    supabase.from("document_links").select("documents(id,title,document_type,mime_type,version_status,deleted_at,created_at)")
      .eq("entity_type", "PERSON").eq("entity_id", id).is("deleted_at", null),
    supabase.rpc("drive_status"),
    supabase.from("insurance_policies").select("id", { count: "exact", head: true }).eq("person_id", id).eq("status", "ACTIVE").is("deleted_at", null),
  ]);
  if (!person) notFound();
  const p = person as unknown as PersonDetails & { name: string; relationship: string | null; status: string };
  const canEdit = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();
  const age = ageFrom(p.birth_date, today);
  const connected = !!(status as { connected?: boolean } | null)?.connected;
  const docs = (links ?? []).map((l) => (Array.isArray(l.documents) ? l.documents[0] : l.documents) as Doc | null)
    .filter((d): d is Doc => !!d && !d.deleted_at && d.version_status === "CURRENT")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  /** สำเนาเอกสารล่าสุดตามประเภท (ประเภทที่ใช้ในหน้า Documents) */
  const docOf = (...types: string[]) => docs.find((d) => types.some((t) => d.document_type.toLowerCase().includes(t.toLowerCase())));
  const DocLink = ({ types }: { types: string[] }) => {
    const d = docOf(...types);
    if (!d) return <span className="text-xs text-slate-400">ยังไม่ได้แนบสำเนา</span>;
    return connected ? <span className="text-xs text-slate-600">สำเนา: <OpenDoc id={d.id} title={d.title} mime={d.mime_type} /></span>
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
            {RELATIONSHIP_LABEL[p.relationship ?? ""] ?? "-"}
            {age != null && ` · อายุ ${age} ปี`}
            {p.status !== "ACTIVE" && ` · ${PERSON_STATUS_LABEL[p.status]}`}
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
          [`/family/cards?p=${id}`, "บัตร & สมาชิก"], [`/documents?p=${id}`, "เอกสาร"]].map(([href, l]) => (
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

      {canEdit && <PersonDetailsForm p={p} />}

      <EntityDocuments entityType="PERSON" entityId={id} module="FAMILY" role={me.role} title="เอกสารส่วนตัว" paths={[`/family/members/${id}`]} />
    </div>
  );
}
