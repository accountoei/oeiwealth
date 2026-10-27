import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fileSize, thDate, todayBangkok, addDays } from "@/lib/format";
import RowActions from "@/components/RowActions";
import DocumentUpload from "./DocumentUpload";
import { DownloadDoc } from "./DocButtons";

type Doc = { id: string; module: string; document_type: string; title: string; mime_type: string | null; file_size: number | null;
  issue_date: string | null; expiry_date: string | null; version_status: string; notes: string | null; created_at: string };

/** ส่วน "เอกสาร" ในหน้ารายละเอียดของทรัพย์สิน / หนี้ / กรมธรรม์ */
export default async function EntityDocuments({ entityType, entityId, module, role, title = "เอกสาร", paths: pagePaths = [], bare = false, fill = false, category }: {
  entityType: string; entityId: string; module: string; role: string; title?: string; paths?: string[];
  /** หมวดเอกสาร = หน้าที่แนบ (lib/format DOC_CATEGORY_LABEL) → รายการประเภทให้เลือกตอนแนบ */
  category?: string;
  /** วางในกล่องอื่น (ไม่มีกรอบของตัวเอง) */
  bare?: boolean;
  /** ยืดเต็มความสูงของช่องที่วาง */
  fill?: boolean;
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
  const paths = ["/family/documents", ...pagePaths];
  // ฉบับปัจจุบัน: หมดอายุ / ใกล้หมดอายุขึ้นก่อน แล้วตามวันที่แนบล่าสุด · แสดง 5 ฉบับแรก ที่เหลือกด "ดูทั้งหมด"
  const warn = (d: Doc) => !!d.expiry_date && d.expiry_date <= addDays(today, 60);
  const current = docs.filter((d) => d.version_status === "CURRENT").sort((a, b) => Number(warn(b)) - Number(warn(a)));
  const first = current.slice(0, 5), more = current.slice(5);
  const old = docs.filter((d) => d.version_status !== "CURRENT");

  return (
    <section className={bare ? "" : `rounded-xl border border-slate-200 bg-white p-5${fill ? " flex-1" : ""}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className={bare ? "text-sm font-medium text-slate-800" : "font-medium text-slate-900"}>{title}</h2>
        <Link href="/family/documents" className="text-xs text-slate-500 hover:underline">เอกสารทั้งหมด →</Link>
      </div>
      {current.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีเอกสาร</p> : (
        <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
          {first.map((d) => <Row key={d.id} d={d} today={today} canWrite={canWrite} canDelete={canDelete} paths={paths} connected={connected} category={category} />)}
        </tbody></table>
      )}
      {more.length > 0 && (
        <details className="group text-sm">
          <summary className="cursor-pointer list-none py-1 text-xs text-blue-700 hover:underline [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">ดูทั้งหมด ({current.length} ฉบับ) ▾</span><span className="hidden group-open:inline">ย่อ ▴</span></summary>
          <table className="w-full"><tbody className="divide-y divide-slate-100">
            {more.map((d) => <Row key={d.id} d={d} today={today} canWrite={canWrite} canDelete={canDelete} paths={paths} connected={connected} category={category} />)}
          </tbody></table>
        </details>
      )}
      {old.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-slate-500">ฉบับเก่า {old.length} รายการ</summary>
          <table className="mt-1 w-full opacity-70"><tbody className="divide-y divide-slate-100">
            {old.map((d) => <Row key={d.id} d={d} today={today} canWrite={canWrite} canDelete={canDelete} paths={paths} connected={connected} category={category} />)}
          </tbody></table>
        </details>
      )}
      {canWrite && (
        <div className="mt-3">
          {connected ? <DocumentUpload module={module} link={{ type: entityType, id: entityId }} category={category} />
            : <p className="text-xs text-amber-700">ยังไม่ได้เชื่อม Google Drive — ADMIN เชื่อมได้ที่หน้า <Link href="/family/documents" className="underline">Documents</Link></p>}
        </div>
      )}
    </section>
  );
}

function Row({ d, today, canWrite, canDelete, paths, connected, category }: {
  d: Doc; today: string; canWrite: boolean; canDelete: boolean; paths: string[]; connected: boolean; category?: string;
}) {
  const expired = d.expiry_date && d.expiry_date < today;
  const soon = !expired && d.expiry_date && d.expiry_date <= addDays(today, 60);
  return (
    <tr className="align-top">
      <td className="py-2">
        <div className="font-medium text-slate-900">
          {connected ? <a href={`/view/${d.id}`} target="_blank" rel="noopener" className="hover:underline">{d.title}</a> : d.title}
          {d.version_status !== "CURRENT" && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs font-normal text-slate-500">ฉบับเก่า</span>}
        </div>
        <div className="text-xs text-slate-500">
          {d.document_type} · แนบ {thDate(new Date(d.created_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" }))}{d.issue_date && ` · ออก ${thDate(d.issue_date)}`}
          {d.expiry_date && <span className={expired ? "text-red-600" : soon ? "text-amber-700" : ""}> · หมดอายุ {thDate(d.expiry_date)}{expired ? " (หมดแล้ว)" : soon ? " (ใกล้หมด)" : ""}</span>}
          {d.file_size ? ` · ${fileSize(d.file_size)}` : ""}
          {d.notes && ` · ${d.notes}`}
        </div>
        <RowActions table="documents" id={d.id} paths={paths} canEdit={canWrite} canDelete={canWrite && canDelete}
          deleteNote="ลบออกจากระบบ (ไฟล์ใน Google Drive ยังเก็บไว้ · ADMIN กู้คืนได้)"
          extra={connected ? <>
            <DownloadDoc id={d.id} title={d.title} mime={d.mime_type} />
            {canWrite && d.version_status === "CURRENT" &&
              <DocumentUpload supersedes={{ id: d.id, title: d.title, document_type: d.document_type, module: d.module }} category={category} label="อัปโหลดฉบับใหม่" />}
          </> : undefined}
          fields={[
            { name: "title", label: "ชื่อ", value: d.title, width: "w-48" }, { name: "document_type", label: "ประเภท", value: d.document_type },
            { name: "issue_date", label: "วันที่ออก", type: "date", value: d.issue_date }, { name: "expiry_date", label: "หมดอายุ", type: "date", value: d.expiry_date },
            { name: "notes", label: "หมายเหตุ", value: d.notes, width: "w-40" }]} />
      </td>
    </tr>
  );
}
