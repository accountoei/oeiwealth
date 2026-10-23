import Form from "next/form";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth";
import { DOC_CATEGORY_LABEL, DOC_MODULE_LABEL, addDays, docCategory, fileSize, thDate, todayBangkok } from "@/lib/format";
import RowActions from "@/components/RowActions";
import DocumentUpload, { type EntityOption } from "@/components/docs/DocumentUpload";
import { ConnectDrive, DownloadDoc } from "@/components/docs/DocButtons";
import LinkDocument from "@/components/docs/LinkDocument";
import { ActionBar } from "@/components/ActionBar";
import { StatBox } from "@/components/Boxes";

type Doc = { id: string; module: string; document_type: string; title: string; mime_type: string | null; file_size: number | null;
  issue_date: string | null; expiry_date: string | null; version_status: string; notes: string | null; created_at: string; derived_status: string | null };
type Sp = Promise<{ c?: string; m?: string; q?: string; all?: string; u?: string; drive?: string; drive_error?: string }>;

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
    supabase.from("persons").select("id,name").is("deleted_at", null).eq("status", "ACTIVE").order("sort_order").order("created_at"),
    supabase.from("credit_cards").select("id,issuer,card_name,card_last4").is("deleted_at", null).neq("status", "CLOSED"),
    supabase.from("v_documents_status").select("id,title,document_type,expiry_date,derived_status,mime_type")
      .eq("version_status", "CURRENT").not("derived_status", "is", null).order("expiry_date"),
  ]);
  const allDocs = (rows as Doc[] | null) ?? [];
  const ids = allDocs.map((d) => d.id);
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
  (persons ?? []).forEach((p) => label.set(`PERSON:${p.id}`, { name: p.name, href: "/family/members" }));
  const cardName = (c: { issuer: string; card_name: string | null; card_last4: string | null }) =>
    [c.issuer, c.card_name, c.card_last4 ? `••${c.card_last4}` : null].filter(Boolean).join(" ");
  (cards ?? []).forEach((c) => label.set(`CREDIT_CARD:${c.id}`, { name: cardName(c), href: `/liabilities/cards/${c.id}` }));
  const byDoc = new Map<string, { id: string; key: string }[]>();
  (links ?? []).forEach((l) => byDoc.set(l.document_id, [...(byDoc.get(l.document_id) ?? []), { id: l.id, key: `${l.entity_type}:${l.entity_id}` }]));
  // หมวดเอกสาร = ตามหน้าที่แนบ (รายการที่ผูกรายการแรก) · ไม่ผูก = ตามหมวดเดิม (module)
  const assetBy = new Map((assets ?? []).map((a) => [a.id as string, a]));
  const catOf = (d: Doc) => {
    const l = (links ?? []).find((x) => x.document_id === d.id);
    const a = l?.entity_type === "ASSET" ? assetBy.get(l.entity_id) : undefined;
    return docCategory(l?.entity_type, a?.asset_type, a?.asset_group, l ? undefined : d.module);
  };
  const cat = new Map(allDocs.map((d) => [d.id, catOf(d)]));
  const catCount = new Map<string, number>();
  allDocs.forEach((d) => catCount.set(cat.get(d.id)!, (catCount.get(cat.get(d.id)!) ?? 0) + 1));
  const isUnlinked = (d: Doc) => !(byDoc.get(d.id) ?? []).length;
  const inCat = sp.c && DOC_CATEGORY_LABEL[sp.c] ? allDocs.filter((d) => cat.get(d.id) === sp.c) : allDocs;
  // u = เฉพาะเอกสารที่ยังไม่ผูกกับรายการ (ใช้ร่วมกับหมวดได้)
  const docs = sp.u ? inCat.filter(isUnlinked) : inCat;

  const options: EntityOption[] = [
    ...(assets ?? []).filter((a) => a.status === "ACTIVE").map((a) => ({ type: "ASSET", id: a.id, label: a.name, group: a.asset_group,
      category: docCategory("ASSET", a.asset_type, a.asset_group) })),
    ...(liabs ?? []).filter((l) => l.status === "ACTIVE").map((l) => ({ type: "LIABILITY", id: l.id, label: l.name, group: "LIABILITY", category: "LIABILITY" })),
    ...(pols ?? []).filter((p) => !["CANCELLED", "SURRENDERED"].includes(p.status)).map((p) => ({ type: "INSURANCE_POLICY", id: p.id, label: polName(p), group: "INSURANCE_POLICY", category: "INSURANCE" })),
    ...(persons ?? []).map((p) => ({ type: "PERSON", id: p.id, label: p.name, group: "PERSON", category: "PERSON" })),
    ...(cards ?? []).map((c) => ({ type: "CREDIT_CARD", id: c.id, label: cardName(c), group: "CREDIT_CARD", category: "CARD" })),
  ];
  const href = (patch: Partial<Record<"c" | "m" | "q" | "all" | "u", string | undefined>>) => {
    const p = new URLSearchParams();
    const v = { c: sp.c, m: sp.m, q: sp.q, all: sp.all, u: sp.u, ...patch };
    Object.entries(v).forEach(([k, x]) => { if (x) p.set(k, x); });
    const s = p.toString();
    return s ? `/documents?${s}` : "/documents";
  };

  const exp = (expiring ?? []) as { id: string; title: string; document_type: string; expiry_date: string | null; derived_status: string | null; mime_type: string | null }[];
  const expired = exp.filter((d) => d.derived_status === "EXPIRED").length;
  const totalSize = docs.reduce((t, d) => t + Number(d.file_size ?? 0), 0);
  const unlinked = inCat.filter(isUnlinked).length;
  const unlinkedAll = allDocs.filter(isUnlinked).length;
  const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Documents</h1>
          <p className="text-sm text-slate-500">ไฟล์เก็บใน Google Drive ของระบบ · เปิดได้เฉพาะผู้ใช้ในระบบ (ทุกการเปิดบันทึกใน Audit Log)</p>
        </div>
        {canWrite && st.connected && <ActionBar><DocumentUpload entityOptions={options} label="+ อัปโหลดเอกสาร" /></ActionBar>}
      </div>

      {sp.drive === "connected" && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">เชื่อม Google Drive เรียบร้อยแล้ว</p>}
      {sp.drive_error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">เชื่อม Google Drive ไม่สำเร็จ: {sp.drive_error}</p>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className={`rounded-xl border p-5 ${st.connected ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50"}`}>
          <div className="text-xs text-slate-500">Google Drive</div>
          {st.connected ? (
            <>
              <div className="mt-1 text-xl font-semibold text-emerald-700">เชื่อมแล้ว</div>
              <div className="mt-1 truncate text-xs text-slate-500" title={st.account_email ?? ""}>{st.account_email} · ตั้งแต่ {thDate(st.connected_at?.slice(0, 10) ?? null)}</div>
              {isAdmin && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {st.root_folder_id && <a href={`https://drive.google.com/drive/folders/${st.root_folder_id}`} target="_blank" rel="noreferrer"
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">เปิดโฟลเดอร์</a>}
                  <ConnectDrive link label="เปลี่ยนบัญชี"
                    ask={"เปลี่ยนบัญชี / เชื่อม Google Drive ใหม่?\n\nระบบจะพาไปหน้า Google ให้เข้าสู่ระบบและกดอนุญาตอีกครั้ง\nใช้เมื่อต้องการเปลี่ยนบัญชีที่เก็บเอกสาร หรือเมื่อเปิด / อัปโหลดไฟล์แล้วแจ้งว่าการเชื่อมถูกยกเลิก\nถ้าใช้บัญชีอื่น เอกสารเดิมยังอยู่ในบัญชีเดิม"} />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mt-1 text-xl font-semibold text-amber-900">ยังไม่ได้เชื่อม</div>
              {isAdmin ? (
                <div className="mt-2 space-y-2 text-xs text-amber-900">
                  <p>เข้าสู่ระบบด้วยบัญชี Google ที่จะเก็บเอกสาร แล้วกดอนุญาต — ระบบเห็นเฉพาะไฟล์ที่ระบบสร้างเอง</p>
                  <ConnectDrive />
                </div>
              ) : <p className="mt-1 text-xs text-amber-900">ให้ผู้ดูแลระบบ (ADMIN) เชื่อมก่อน จึงจะแนบเอกสารได้</p>}
            </>
          )}
        </div>
        <StatBox label={<>เอกสาร{sp.c && DOC_CATEGORY_LABEL[sp.c] ? `หมวด ${DOC_CATEGORY_LABEL[sp.c]}` : sp.m ? `หมวด ${DOC_MODULE_LABEL[sp.m] ?? sp.m}` : ""}{sp.q ? " (ตามที่ค้นหา)" : ""}</>} value={docs.length} unit="ไฟล์" sub={<>{totalSize ? `รวม ${fileSize(totalSize)}` : "-"}{sp.all ? " · รวมฉบับเก่า" : ""}</>} />
        <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
          <div className="text-xs text-slate-500">หมดอายุ / ใกล้หมด (60 วัน)</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${exp.length ? "text-amber-700" : ""}`}>{exp.length} <span className="text-sm font-normal text-slate-500">ไฟล์</span></div>
          <div className={`mt-1 text-xs ${expired ? "text-red-600" : "text-slate-500"}`}>{expired ? `หมดแล้ว ${expired} ไฟล์` : "ยังไม่มีไฟล์ที่หมดแล้ว"}</div>
        </div>
        <Link href={href({ u: sp.u ? undefined : "1" })} scroll={false} className={`block rounded-xl ${sp.u ? "ring-2 ring-blue-600" : "hover:ring-1 hover:ring-slate-300"}`}>
          <StatBox label="ยังไม่ผูกกับรายการ" value={unlinked} unit="ไฟล์" valueClass={unlinked ? "text-amber-700" : ""}
            sub={unlinked ? (sp.u ? "กำลังแสดงเฉพาะที่ยังไม่ผูก · กดอีกครั้งเพื่อแสดงทั้งหมด" : "กดเพื่อดูเฉพาะที่ยังไม่ผูก แล้วกด \"ผูก\" ในคอลัมน์เอกสารของ") : "ผูกครบทุกไฟล์แล้ว"} />
        </Link>
      </section>

      {exp.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-white p-5">
          <h2 className="mb-2 font-medium text-slate-900">เอกสารหมดอายุ / ใกล้หมดอายุ (60 วัน)</h2>
          <ul className="space-y-1 text-sm">
            {exp.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{st.connected ? <a href={`/view/${d.id}`} target="_blank" rel="noopener" className="hover:underline">{d.title}</a> : d.title} <span className="text-xs text-slate-500">· {d.document_type}</span></span>
                <span className={d.derived_status === "EXPIRED" ? "text-red-600" : "text-amber-700"}>{d.derived_status === "EXPIRED" ? "หมดแล้ว" : "หมด"} {thDate(d.expiry_date)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-medium text-slate-900">เอกสารทั้งหมด</h2>
              <div className="flex flex-wrap gap-1 text-xs">
                <Link href={href({ c: undefined, m: undefined, u: undefined })} scroll={false} className={chip(!sp.c && !sp.m && !sp.u)}>ทั้งหมด ({allDocs.length})</Link>
                {Object.entries(DOC_CATEGORY_LABEL).filter(([k]) => catCount.get(k) || sp.c === k).map(([k, v]) =>
                  <Link key={k} href={href({ c: k, m: undefined })} scroll={false} className={chip(sp.c === k)}>{v} ({catCount.get(k) ?? 0})</Link>)}
                {(unlinkedAll > 0 || sp.u) && <Link href={href({ u: sp.u ? undefined : "1" })} scroll={false} className={chip(!!sp.u)}>ยังไม่ผูก ({unlinkedAll})</Link>}
              </div>
            </div>
            <Form className="flex flex-wrap items-center gap-2 text-sm" action="/documents" scroll={false}>
              {sp.c && <input type="hidden" name="c" value={sp.c} />}
              {sp.m && <input type="hidden" name="m" value={sp.m} />}
              {sp.u && <input type="hidden" name="u" value={sp.u} />}
              <input name="q" defaultValue={sp.q ?? ""} placeholder="ค้นหาชื่อ / ประเภท" className="w-48 rounded-md border border-slate-300 px-2.5 py-1" />
              <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" name="all" value="1" defaultChecked={!!sp.all} /> รวมฉบับเก่า</label>
              <button className="rounded-md border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50">ค้นหา</button>
            </Form>
          </div>
          <table className="mt-2 w-full min-w-[44rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">เอกสาร</th><th className="px-3">เอกสารของ</th><th className="px-3">วันที่ออก / หมดอายุ</th><th className="px-3">อัปโหลด</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">{sp.u ? "ไม่มีเอกสารที่ยังไม่ผูก" : "ยังไม่มีเอกสาร"}</td></tr>}
              {docs.map((d) => {
                const ls = byDoc.get(d.id) ?? [];
                return (
                  <tr key={d.id} className={`align-top ${d.version_status !== "CURRENT" ? "opacity-60" : ""}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">
                        {st.connected ? <a href={`/view/${d.id}`} target="_blank" rel="noopener" className="hover:underline">{d.title}</a> : d.title}
                        {d.version_status !== "CURRENT" && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs font-normal text-slate-500">ฉบับเก่า</span>}</div>
                      <div className="text-xs text-slate-500">{DOC_CATEGORY_LABEL[cat.get(d.id) ?? "OTHER"]} · {d.document_type}{d.file_size ? ` · ${fileSize(d.file_size)}` : ""}{d.notes && ` · ${d.notes}`}</div>
                      <RowActions table="documents" id={d.id} paths={["/documents"]} canEdit={canWrite} canDelete={canWrite && canDelete}
                        deleteNote="ลบออกจากระบบ (ไฟล์ใน Google Drive ยังเก็บไว้ · ADMIN กู้คืนได้)"
                        extra={st.connected ? <>
                          <DownloadDoc id={d.id} title={d.title} mime={d.mime_type} />
                          {canWrite && d.version_status === "CURRENT" &&
                            <DocumentUpload category={cat.get(d.id)} supersedes={{ id: d.id, title: d.title, document_type: d.document_type, module: d.module }} label="อัปโหลดฉบับใหม่" />}
                        </> : undefined}
                        fields={[
                          { name: "title", label: "ชื่อ", value: d.title, width: "w-48" }, { name: "document_type", label: "ประเภท", value: d.document_type },
                          { name: "issue_date", label: "วันที่ออก", type: "date", value: d.issue_date }, { name: "expiry_date", label: "หมดอายุ", type: "date", value: d.expiry_date },
                          { name: "notes", label: "หมายเหตุ", value: d.notes, width: "w-40" }]} />
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {ls.length === 0 ? <span className="text-amber-700">ยังไม่ผูก</span> : ls.map((l) => {
                        const x = label.get(l.key);
                        return <div key={l.id}>{x ? <Link href={x.href} className="text-slate-700 hover:underline">{x.name}</Link> : <span className="text-slate-400">(รายการถูกลบ)</span>}</div>;
                      })}
                      {canWrite && d.version_status === "CURRENT" && (
                        <div className={ls.length ? "mt-0.5" : "inline"}>{ls.length ? "" : " · "}
                          <LinkDocument docId={d.id} title={d.title} options={options} linked={ls.map((l) => l.key)} label={ls.length ? "+ ผูกเพิ่ม" : "ผูก"} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {d.issue_date ? thDate(d.issue_date) : "-"}
                      {d.expiry_date && <div className={d.expiry_date < today ? "text-red-600" : d.expiry_date <= addDays(today, 60) ? "text-amber-700" : ""}>ถึง {thDate(d.expiry_date)}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{thDate(new Date(d.created_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" }))}</td>
                  </tr>
                );
              })}
            </tbody>
            {docs.length > 0 && (
              <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
                <tr><td className="px-4 py-2.5">รวม {docs.length} ไฟล์{totalSize ? ` · ${fileSize(totalSize)}` : ""}</td><td colSpan={3}></td></tr>
              </tfoot>
            )}
          </table>
        </div>
        {docs.length >= 300 && <p className="text-xs text-slate-500">แสดง 300 รายการล่าสุด — ใช้ตัวกรองหรือค้นหาเพื่อดูรายการอื่น</p>}
      </section>
    </div>
  );
}
