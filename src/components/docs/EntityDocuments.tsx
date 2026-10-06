import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fileSize, thDate, todayBangkok, addDays } from "@/lib/format";
import RowActions from "@/components/RowActions";
import DocumentUpload from "./DocumentUpload";
import { OpenDoc } from "./DocButtons";

type Doc = { id: string; module: string; document_type: string; title: string; mime_type: string | null; file_size: number | null;
  issue_date: string | null; expiry_date: string | null; version_status: string; notes: string | null; created_at: string };

/** ส่วน "เอกสาร" ในหน้ารายละเอียดของทรัพย์สิน / หนี้ / กรมธรรม์ */
export default async function EntityDocuments({ entityType, entityId, module, role, title = "เอกสาร", paths: pagePaths = [] }: {
  entityType: string; entityId: string; module: string; role: string; title?: string; paths?: string[];
}) {
  const supabase = await createClient();
  const [{ data: links }, { data: status }] = await Promise.all([
    supabase.from("document_links").select("id,documents(id,module,document_type,title,mime_type,file_size,issue_date,expiry_date,version_status,notes,created_at,deleted_at)")
      .eq("entity_type", entityType).eq("entity_id", entityId).is("deleted_at", null),
    supabase.rpc("drive_status"),
  ]);
  const docs = (links ?? []).map((l) => (Array.isArray(l.documents) ? l.documents[0] : l.documents) as (Doc & { deleted_at: string | null }) | null)
    .filter((d): d is Doc & { deleted_at: string | null } => !!d && !d.deleted_at)
    .sort((a, b) => (a.version_status === b.version_status ? (a.created_at < b.created_at ? 1 : -1) : a.version_status === "CURRENT" ? -1 : 1));
  const connected = !!(status as { connected?: boolean } | null)?.connected;
  const canWrite = role !== "VIEWER";
  const canDelete = role === "ADMIN" || role === "EDITOR";
  const today = todayBangkok();
  const paths = ["/documents", ...pagePaths];
  const current = docs.filter((d) => d.version_status === "CURRENT");
  const old = docs.filter((d) => d.version_status !== "CURRENT");

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-slate-900">{title}</h2>
        <Link href="/documents" className="text-xs text-slate-500 hover:underline">เอกสารทั้งหมด →</Link>
      </div>
      {current.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีเอกสาร</p> : (
        <ul className="divide-y divide-slate-100 text-sm">
          {current.map((d) => <Row key={d.id} d={d} today={today} canWrite={canWrite} canDelete={canDelete} paths={paths} connected={connected} />)}
        </ul>
      )}
      {old.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-slate-500">ฉบับเก่า {old.length} รายการ</summary>
          <ul className="mt-1 divide-y divide-slate-100 opacity-70">
            {old.map((d) => <Row key={d.id} d={d} today={today} canWrite={canWrite} canDelete={canDelete} paths={paths} connected={connected} />)}
          </ul>
        </details>
      )}
      {canWrite && (
        <div className="mt-3">
          {connected ? <DocumentUpload module={module} link={{ type: entityType, id: entityId }} />
            : <p className="text-xs text-amber-700">ยังไม่ได้เชื่อม Google Drive — ADMIN เชื่อมได้ที่หน้า <Link href="/documents" className="underline">Documents</Link></p>}
        </div>
      )}
    </section>
  );
}

function Row({ d, today, canWrite, canDelete, paths, connected }: {
  d: Doc; today: string; canWrite: boolean; canDelete: boolean; paths: string[]; connected: boolean;
}) {
  const expired = d.expiry_date && d.expiry_date < today;
  const soon = !expired && d.expiry_date && d.expiry_date <= addDays(today, 60);
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2">
      <div>
        <div className="font-medium text-slate-900">{d.title}
          {d.version_status !== "CURRENT" && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs font-normal text-slate-500">ฉบับเก่า</span>}
        </div>
        <div className="text-xs text-slate-500">
          {d.document_type}{d.issue_date && ` · ออก ${thDate(d.issue_date)}`}
          {d.expiry_date && <span className={expired ? "text-red-600" : soon ? "text-amber-700" : ""}> · หมดอายุ {thDate(d.expiry_date)}{expired ? " (หมดแล้ว)" : soon ? " (ใกล้หมด)" : ""}</span>}
          {d.file_size ? ` · ${fileSize(d.file_size)}` : ""}
          {d.notes && ` · ${d.notes}`}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {connected && <OpenDoc id={d.id} title={d.title} mime={d.mime_type} />}
        {canWrite && connected && d.version_status === "CURRENT" &&
          <DocumentUpload supersedes={{ id: d.id, title: d.title, document_type: d.document_type, module: d.module }} label="อัปโหลดฉบับใหม่" />}
        {canWrite && <RowActions table="documents" id={d.id} paths={paths} canDelete={canDelete}
          deleteNote="ลบออกจากระบบ (ไฟล์ใน Google Drive ยังเก็บไว้ · ADMIN กู้คืนได้)" fields={[
            { name: "title", label: "ชื่อ", value: d.title, width: "w-48" }, { name: "document_type", label: "ประเภท", value: d.document_type },
            { name: "issue_date", label: "วันที่ออก", type: "date", value: d.issue_date }, { name: "expiry_date", label: "หมดอายุ", type: "date", value: d.expiry_date },
            { name: "notes", label: "หมายเหตุ", value: d.notes, width: "w-40" }]} />}
      </div>
    </li>
  );
}
