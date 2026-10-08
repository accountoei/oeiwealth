import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { DOC_MODULE_LABEL, addDays, fileSize, thDate, todayBangkok } from "@/lib/format";
import RowActions from "@/components/RowActions";
import DocumentUpload, { type EntityOption } from "@/components/docs/DocumentUpload";
import { ConnectDrive, OpenDoc } from "@/components/docs/DocButtons";

type Doc = { id: string; module: string; document_type: string; title: string; mime_type: string | null; file_size: number | null;
  issue_date: string | null; expiry_date: string | null; version_status: string; notes: string | null; created_at: string; derived_status: string | null };
type Sp = Promise<{ m?: string; q?: string; all?: string; drive?: string; drive_error?: string }>;

const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;

export default async function DocumentsPage({ searchParams }: { searchParams: Sp }) {
  const sp = await searchParams;
  const me = await requireAppUser();
  const supabase = await createClient();
  let q = supabase.from("v_documents_status").select("*").order("created_at", { ascending: false }).limit(300);
  if (sp.m && DOC_MODULE_LABEL[sp.m]) q = q.eq("module", sp.m);
  if (!sp.all) q = q.eq("version_status", "CURRENT");
  if (sp.q?.trim()) q = q.or(`title.ilike.%${sp.q.trim().replace(/[%,()]/g, " ")}%,document_type.ilike.%${sp.q.trim().replace(/[%,()]/g, " ")}%`);
  const [{ data: rows }, { data: status }, { data: assets }, { data: liabs }, { data: pols }, { data: persons }, { data: cards }, { data: expiring }] = await Promise.all([
    q,
    supabase.rpc("drive_status"),
    supabase.from("assets").select("id,name,asset_group,asset_type,status").is("deleted_at", null).order("name"),
    supabase.from("liabilities").select("id,name,status").is("deleted_at", null).order("name"),
    supabase.from("insurance_policies").select("id,insurer,policy_no,status,persons(name)").is("deleted_at", null).order("insurer"),
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("created_at"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4").is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("v_documents_status").select("id,title,document_type,expiry_date,derived_status,mime_type")
      .eq("version_status", "CURRENT").not("derived_status", "is", null).order("expiry_date"),
  ]);
  const docs = (rows as Doc[] | null) ?? [];
  const ids = docs.map((d) => d.id);
  const { data: links } = ids.length
    ? await supabase.from("document_links").select("id,document_id,entity_type,entity_id").in("document_id", ids).is("deleted_at", null)
    : { data: [] };

  const st = (status ?? {}) as { connected?: boolean; account_email?: string | null; connected_at?: string | null; root_folder_id?: string | null };
  const isAdmin = me.role === "ADMIN";
  const canWrite = me.role !== "VIEWER";
  const canDelete = me.role === "ADMIN" || me.role === "EDITOR";
  const today = todayBangkok();

  // ชื่อ + ลิงก์ของรายการที่ผูก
  const label = new Map<string, { name: string; href: string }>();
  (assets ?? []).forEach((a) => label.set(`ASSET:${a.id}`, { name: a.name, href: `/a/${a.id}` }));
  (liabs ?? []).forEach((l) => label.set(`LIABILITY:${l.id}`, { name: l.name, href: `/liabilities/${l.id}` }));
  const polName = (p: { insurer: string; policy_no: string | null; persons: unknown }) =>
    [p.insurer, p.policy_no, one(p.persons as { name: string } | null)?.name].filter(Boolean).join(" · ");
  (pols ?? []).forEach((p) => label.set(`INSURANCE_POLICY:${p.id}`, { name: polName(p), href: `/insurance/${p.id}` }));
  (persons ?? []).forEach((p) => label.set(`PERSON:${p.id}`, { name: p.name, href: "/settings/family-users#members" }));
  const cardName = (c: { issuer: string; card_name: string | null; card_last4: string | null }) =>
    [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ");
  (cards ?? []).forEach((c) => label.set(`CREDIT_CARD:${c.id}`, { name: cardName(c), href: "/family/cards" }));
  const byDoc = new Map<string, { id: string; key: string }[]>();
  (links ?? []).forEach((l) => byDoc.set(l.document_id, [...(byDoc.get(l.document_id) ?? []), { id: l.id, key: `${l.entity_type}:${l.entity_id}` }]));

  const options: EntityOption[] = [
    ...(assets ?? []).filter((a) => a.status === "ACTIVE").map((a) => ({ type: "ASSET", id: a.id, label: a.name, group: a.asset_group })),
    ...(liabs ?? []).filter((l) => l.status === "ACTIVE").map((l) => ({ type: "LIABILITY", id: l.id, label: l.name, group: "LIABILITY" })),
    ...(pols ?? []).filter((p) => !["CANCELLED", "SURRENDERED"].includes(p.status)).map((p) => ({ type: "INSURANCE_POLICY", id: p.id, label: polName(p), group: "INSURANCE_POLICY" })),
    ...(persons ?? []).map((p) => ({ type: "PERSON", id: p.id, label: p.name, group: "PERSON" })),
    ...(cards ?? []).map((c) => ({ type: "CREDIT_CARD", id: c.id, label: cardName(c), group: "CREDIT_CARD" })),
  ];
  const href = (patch: Partial<Record<"m" | "q" | "all", string | undefined>>) => {
    const p = new URLSearchParams();
    const v = { m: sp.m, q: sp.q, all: sp.all, ...patch };
    Object.entries(v).forEach(([k, x]) => { if (x) p.set(k, x); });
    const s = p.toString();
    return s ? `/documents?${s}` : "/documents";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Documents</h1>
        <p className="text-sm text-slate-500">ไฟล์เก็บใน Google Drive ของระบบ · เปิดได้เฉพาะผู้ใช้ในระบบ (ทุกการเปิดบันทึกใน Audit Log)</p>
      </div>

      {sp.drive === "connected" && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">เชื่อม Google Drive เรียบร้อยแล้ว</p>}
      {sp.drive_error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">เชื่อม Google Drive ไม่สำเร็จ: {sp.drive_error}</p>}

      <section className={`rounded-xl border p-5 ${st.connected ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50"}`}>
        {st.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <div className="font-medium text-slate-900">Google Drive เชื่อมแล้ว</div>
              <div className="text-slate-500">บัญชี {st.account_email} · ตั้งแต่ {thDate(st.connected_at?.slice(0, 10) ?? null)}</div>
            </div>
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-3">
                {st.root_folder_id && <a href={`https://drive.google.com/drive/folders/${st.root_folder_id}`} target="_blank" rel="noreferrer"
                  className="text-sm text-sky-700 underline">เปิดโฟลเดอร์ใน Drive</a>}
                <ConnectDrive label="เชื่อมใหม่" />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="font-medium text-amber-900">ยังไม่ได้เชื่อม Google Drive</div>
            {isAdmin ? (
              <>
                <p className="text-amber-900">กดปุ่มด้านล่าง แล้วเข้าสู่ระบบด้วยบัญชี Google ที่จะใช้เก็บเอกสาร และกดอนุญาต — ระบบขอสิทธิ์เฉพาะไฟล์ที่ระบบสร้างเอง (ไม่เห็นไฟล์อื่นใน Drive)</p>
                <ConnectDrive />
              </>
            ) : <p className="text-amber-900">ให้ผู้ดูแลระบบ (ADMIN) เชื่อม Google Drive ก่อน จึงจะแนบเอกสารได้</p>}
          </div>
        )}
      </section>

      {(expiring ?? []).length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-white p-5">
          <h2 className="mb-2 font-medium text-slate-900">เอกสารหมดอายุ / ใกล้หมดอายุ (60 วัน)</h2>
          <ul className="space-y-1 text-sm">
            {(expiring ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{d.title} <span className="text-xs text-slate-500">· {d.document_type}</span></span>
                <span className="flex items-center gap-3">
                  <span className={d.derived_status === "EXPIRED" ? "text-red-600" : "text-amber-700"}>{d.derived_status === "EXPIRED" ? "หมดแล้ว" : "หมด"} {thDate(d.expiry_date)}</span>
                  {st.connected && <OpenDoc id={d.id} title={d.title} mime={d.mime_type} />}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canWrite && st.connected && (
        <section>
          <DocumentUpload entityOptions={options} label="+ อัปโหลดเอกสาร" />
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={href({ m: undefined })} className={`rounded-full px-3 py-1 ${!sp.m ? "bg-blue-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>ทั้งหมด</Link>
          {Object.entries(DOC_MODULE_LABEL).map(([k, v]) => (
            <Link key={k} href={href({ m: k })} className={`rounded-full px-3 py-1 ${sp.m === k ? "bg-blue-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>{v}</Link>
          ))}
        </div>
        <form className="flex flex-wrap items-center gap-2 text-sm" action="/documents">
          {sp.m && <input type="hidden" name="m" value={sp.m} />}
          <input name="q" defaultValue={sp.q ?? ""} placeholder="ค้นหาชื่อ / ประเภทเอกสาร" className="w-64 rounded-md border border-slate-300 px-3 py-1.5" />
          <label className="flex items-center gap-1 text-slate-600"><input type="checkbox" name="all" value="1" defaultChecked={!!sp.all} /> รวมฉบับเก่า</label>
          <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">ค้นหา</button>
        </form>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">เอกสาร</th><th className="px-3">เป็นของ</th><th className="px-3">วันที่ออก / หมดอายุ</th><th className="px-3">อัปโหลด</th><th className="px-3"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">ยังไม่มีเอกสาร</td></tr>}
              {docs.map((d) => {
                const ls = byDoc.get(d.id) ?? [];
                return (
                  <tr key={d.id} className={`align-top ${d.version_status !== "CURRENT" ? "opacity-60" : ""}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{d.title}
                        {d.version_status !== "CURRENT" && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs font-normal text-slate-500">ฉบับเก่า</span>}</div>
                      <div className="text-xs text-slate-500">{DOC_MODULE_LABEL[d.module] ?? d.module} · {d.document_type}{d.file_size ? ` · ${fileSize(d.file_size)}` : ""}{d.notes && ` · ${d.notes}`}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {ls.length === 0 ? <span className="text-slate-400">—</span> : ls.map((l) => {
                        const x = label.get(l.key);
                        return <div key={l.id}>{x ? <Link href={x.href} className="text-slate-700 hover:underline">{x.name}</Link> : <span className="text-slate-400">(รายการถูกลบ)</span>}</div>;
                      })}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {d.issue_date ? thDate(d.issue_date) : "-"}
                      {d.expiry_date && <div className={d.expiry_date < today ? "text-red-600" : d.expiry_date <= addDays(today, 60) ? "text-amber-700" : ""}>ถึง {thDate(d.expiry_date)}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{thDate(d.created_at.slice(0, 10))}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex flex-col items-end gap-1">
                        {st.connected && <OpenDoc id={d.id} title={d.title} mime={d.mime_type} />}
                        {canWrite && st.connected && d.version_status === "CURRENT" &&
                          <DocumentUpload supersedes={{ id: d.id, title: d.title, document_type: d.document_type, module: d.module }} label="อัปโหลดฉบับใหม่" />}
                        {canWrite && <RowActions table="documents" id={d.id} paths={["/documents"]} canDelete={canDelete}
                          deleteNote="ลบออกจากระบบ (ไฟล์ใน Google Drive ยังเก็บไว้ · ADMIN กู้คืนได้)" fields={[
                            { name: "title", label: "ชื่อ", value: d.title, width: "w-48" }, { name: "document_type", label: "ประเภท", value: d.document_type },
                            { name: "issue_date", label: "วันที่ออก", type: "date", value: d.issue_date }, { name: "expiry_date", label: "หมดอายุ", type: "date", value: d.expiry_date },
                            { name: "notes", label: "หมายเหตุ", value: d.notes, width: "w-40" }]} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {docs.length >= 300 && <p className="text-xs text-slate-500">แสดง 300 รายการล่าสุด — ใช้ตัวกรองหรือค้นหาเพื่อดูรายการอื่น</p>}
      </section>
    </div>
  );
}
