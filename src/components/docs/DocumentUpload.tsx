"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { callDrive } from "./drive";
import { createClient } from "@/lib/supabase/client";
import { DOC_MODULE_LABEL, DOC_TYPES, ENTITY_MODULE, thDate } from "@/lib/format";

type Cand = { id: string; title: string; expiry_date: string | null; created_at: string };
type Pending = { file: File; meta: Record<string, unknown>; cands: Cand[]; picked: string[] };

async function sha256(file: File) {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");
}

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
export type EntityOption = { type: string; id: string; label: string; group: string };

/**
 * อัปโหลดเอกสารเข้า Google Drive แล้วบันทึกในระบบ
 * - หน้ารายการ (เช่น บ้าน A): ส่ง link + module มา → ผูกให้อัตโนมัติ
 * - หน้า Documents: เลือกรายการที่จะผูกจาก entityOptions (ไม่บังคับ)
 * - ฉบับใหม่แทนฉบับเดิม: ส่ง supersedes มา
 */
export default function DocumentUpload({ module: fixedModule, link, entityOptions, supersedes, label = "+ แนบเอกสาร" }: {
  module?: string; link?: { type: string; id: string }; entityOptions?: EntityOption[];
  supersedes?: { id: string; title: string; document_type: string; module: string }; label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [entity, setEntity] = useState("");
  const [module, setModule] = useState(supersedes?.module ?? fixedModule ?? "PROPERTY");
  const [title, setTitle] = useState(supersedes?.title ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dup, setDup] = useState<{ id: string; title: string; linked: boolean } | null>(null);

  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <button type="button" onClick={() => { setOpen(true); setMsg({}); }}
          className={supersedes ? "text-xs text-slate-600 underline" : "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"}>{label}</button>
        {msg.ok && <span className="text-xs text-emerald-700">{msg.ok}</span>}
      </span>
    );
  }

  function pickEntity(v: string) {
    setEntity(v); setPending(null); setDup(null);
    const opt = entityOptions?.find((o) => `${o.type}:${o.id}` === v);
    if (opt && !fixedModule) setModule(ENTITY_MODULE[opt.group] ?? ENTITY_MODULE[opt.type] ?? module);
  }
  function pickFile(f: File | undefined) {
    setPending(null); setDup(null);
    if (f && !title) setTitle(f.name.replace(/\.[A-Za-z0-9]{1,6}$/, ""));
  }

  async function send(file: File, meta: Record<string, unknown>, replace: string[]) {
    const body = new FormData();
    body.append("file", file);
    body.append("meta", JSON.stringify({ ...meta, supersedes_document_ids: replace }));
    setBusy(true); setMsg({});
    try {
      await callDrive(body);
      setMsg({ ok: replace.length ? `อัปโหลดแล้ว · ฉบับเดิม ${replace.length} ฉบับเป็นฉบับเก่า` : "อัปโหลดแล้ว" });
      formRef.current?.reset(); setTitle(""); setEntity(""); setPending(null); setOpen(false);
      router.refresh();
    } catch (err) {
      setMsg({ error: err instanceof Error ? err.message : String(err) });
    } finally { setBusy(false); }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDup(null); setPending(null);
    const f = new FormData(e.currentTarget);
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) { setMsg({ error: "กรุณาเลือกไฟล์" }); return; }
    if (file.size > 20 * 1024 * 1024) { setMsg({ error: "ไฟล์ใหญ่เกิน 20 MB" }); return; }
    const target = link ?? (entity ? { type: entity.split(":")[0], id: entity.split(":")[1] } : null);
    const docType = String(f.get("document_type") ?? "").trim();
    const meta = {
      module, title: String(f.get("title") ?? "").trim(), document_type: docType,
      issue_date: String(f.get("issue_date") ?? ""), expiry_date: String(f.get("expiry_date") ?? ""),
      notes: String(f.get("notes") ?? ""), links: target ? [{ entity_type: target.type, entity_id: target.id }] : [],
    };
    setBusy(true); setMsg({});
    try {
      const db = createClient();
      // 1) ไฟล์เดียวกันทุกไบต์มีอยู่แล้วหรือไม่
      const { data: same } = await db.from("documents").select("id,title").eq("content_sha256", await sha256(file))
        .is("deleted_at", null).limit(1).maybeSingle();
      if (same) {
        let linked = false;
        if (target) {
          const { data: l } = await db.from("document_links").select("id").eq("document_id", same.id)
            .eq("entity_type", target.type).eq("entity_id", target.id).is("deleted_at", null).limit(1);
          linked = !!l?.length;
        }
        setDup({ id: same.id, title: same.title, linked }); setBusy(false); return;
      }
      // 2) รายการนี้มีเอกสารประเภทเดียวกัน (ฉบับปัจจุบัน) อยู่แล้วหรือไม่
      if (supersedes) { await send(file, meta, [supersedes.id]); return; }
      if (target) {
        const { data: rows } = await db.from("document_links")
          .select("documents(id,title,document_type,expiry_date,version_status,deleted_at,created_at)")
          .eq("entity_type", target.type).eq("entity_id", target.id).is("deleted_at", null);
        const cands = (rows ?? []).map((r) => (Array.isArray(r.documents) ? r.documents[0] : r.documents) as
            (Cand & { document_type: string; version_status: string; deleted_at: string | null }) | null)
          .filter((d): d is Cand & { document_type: string; version_status: string; deleted_at: string | null } =>
            !!d && !d.deleted_at && d.version_status === "CURRENT" && d.document_type.trim().toLowerCase() === docType.toLowerCase())
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        if (cands.length) { setPending({ file, meta, cands, picked: cands.map((c) => c.id) }); setBusy(false); return; }
      }
      await send(file, meta, []);
    } catch (err) {
      setMsg({ error: err instanceof Error ? err.message : String(err) }); setBusy(false);
    }
  }

  async function linkExisting() {
    if (!dup || !(link ?? entity)) return;
    const target = link ?? { type: entity.split(":")[0], id: entity.split(":")[1] };
    setBusy(true);
    const { error } = await createClient().rpc("link_document", { p_document_id: dup.id, p_entity_type: target.type, p_entity_id: target.id });
    setBusy(false);
    if (error) { setMsg({ error: error.message.replace(/^INVALID:\s*/, "") }); return; }
    setDup(null); setMsg({ ok: "ผูกเอกสารเดิมกับรายการนี้แล้ว" }); setOpen(false); router.refresh();
  }

  const groups = [...new Set((entityOptions ?? []).map((o) => o.group))];
  return (
    <form ref={formRef} onSubmit={submit} className="mt-2 w-full space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-left">
      <h3 className="text-sm font-medium text-slate-900">{supersedes ? `อัปโหลดฉบับใหม่แทน "${supersedes.title}"` : "แนบเอกสาร"}</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm md:col-span-3">ไฟล์ * <span className="text-xs text-slate-500">(PDF, รูปภาพ, Word, Excel · ไม่เกิน 20 MB)</span>
          <input name="file" type="file" required onChange={(e) => pickFile(e.target.files?.[0])}
            accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt" className={`${input} bg-slate-50`} />
        </label>
        {entityOptions && !link && (
          <label className="text-sm md:col-span-2">เป็นเอกสารของ
            <select value={entity} onChange={(e) => pickEntity(e.target.value)} className={input}>
              <option value="">— ไม่ผูกกับรายการ —</option>
              {groups.map((g) => (
                <optgroup key={g} label={GROUP_LABEL[g] ?? g}>
                  {entityOptions.filter((o) => o.group === g).map((o) => <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>{o.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {!fixedModule && !supersedes && (
          <label className="text-sm">หมวด
            <select value={module} onChange={(e) => setModule(e.target.value)} className={input}>
              {Object.entries(DOC_MODULE_LABEL).filter(([k]) => k !== "SYSTEM").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm">ประเภทเอกสาร *
          <input name="document_type" required onChange={() => setPending(null)} list={`doc-types-${module}`} defaultValue={supersedes?.document_type ?? ""} placeholder="เลือกหรือพิมพ์เอง" className={input} />
          <datalist id={`doc-types-${module}`}>{(DOC_TYPES[module] ?? []).map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <label className="text-sm md:col-span-2">ชื่อเอกสาร *<input name="title" required value={title} onChange={(e) => setTitle(e.target.value)} className={input} /></label>
        <label className="text-sm">วันที่ออกเอกสาร<input name="issue_date" type="date" className={input} /></label>
        <label className="text-sm">วันหมดอายุ<input name="expiry_date" type="date" className={input} /></label>
        <label className="text-sm">หมายเหตุ<input name="notes" className={input} /></label>
      </div>
      {dup && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div>ไฟล์นี้มีอยู่ในระบบแล้ว ชื่อ &ldquo;{dup.title}&rdquo; — ไม่บันทึกซ้ำ</div>
          {(link || entity) && !dup.linked && (
            <button type="button" onClick={linkExisting} disabled={busy} className="rounded-md bg-amber-700 px-3 py-1.5 text-xs text-white disabled:opacity-50">
              ผูกเอกสารเดิมกับรายการนี้แทน</button>
          )}
          {dup.linked && <div className="text-xs">เอกสารนี้ผูกกับรายการนี้อยู่แล้ว</div>}
        </div>
      )}
      {pending && (
        <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <div className="font-medium">
            รายการนี้มีเอกสาร &ldquo;{String(pending.meta.document_type)}&rdquo; อยู่แล้ว {pending.cands.length} ฉบับ
            {pending.cands.length > 1 ? " — ฉบับใหม่นี้แทนฉบับไหน?" : " — ไฟล์นี้เป็นฉบับใหม่แทนฉบับเดิมหรือไม่?"}
          </div>
          {pending.cands.length > 1 ? (
            <ul className="space-y-1">
              {pending.cands.map((c) => (
                <li key={c.id}><label className="flex items-center gap-2">
                  <input type="checkbox" checked={pending.picked.includes(c.id)}
                    onChange={(e) => setPending({ ...pending, picked: e.target.checked ? [...pending.picked, c.id] : pending.picked.filter((x) => x !== c.id) })} />
                  {c.title}<span className="text-xs text-sky-700">{c.expiry_date ? ` · หมด ${thDate(c.expiry_date)}` : ""} · อัปโหลด {thDate(c.created_at.slice(0, 10))}</span>
                </label></li>
              ))}
            </ul>
          ) : (
            <div className="text-xs">ฉบับเดิม: {pending.cands[0].title}{pending.cands[0].expiry_date ? ` · หมด ${thDate(pending.cands[0].expiry_date)}` : ""}</div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !pending.picked.length} onClick={() => send(pending.file, pending.meta, pending.picked)}
              className="rounded-md bg-sky-700 px-3 py-1.5 text-xs text-white disabled:opacity-50">
              {busy ? "กำลังอัปโหลด…" : pending.cands.length > 1 ? `ใช่ — เป็นฉบับใหม่แทนที่ติ๊กไว้ (${pending.picked.length})` : "ใช่ — เป็นฉบับใหม่ (ฉบับเดิมเป็นฉบับเก่า)"}</button>
            <button type="button" disabled={busy} onClick={() => send(pending.file, pending.meta, [])}
              className="rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs disabled:opacity-50">ไม่ใช่ — เพิ่มเป็นอีกฉบับ</button>
            <button type="button" disabled={busy} onClick={() => setPending(null)} className="text-xs text-sky-800 underline">ยกเลิก</button>
          </div>
          <p className="text-xs text-sky-700">ฉบับเก่ายังเก็บไว้ เปิดดูได้ แต่จะไม่เตือนวันหมดอายุอีก</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={busy || !!pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy && !pending ? "กำลังตรวจ / อัปโหลด…" : "อัปโหลด"}</button>
        <button type="button" onClick={() => { setOpen(false); setPending(null); setDup(null); }} className="text-sm text-slate-500">ปิด</button>
        {msg.error && <span className="text-sm text-red-600">{msg.error}</span>}
      </div>
      {supersedes && <p className="text-xs text-slate-500">ฉบับเดิมยังเก็บไว้ (สถานะ &ldquo;ฉบับเก่า&rdquo;) · ฉบับใหม่ผูกกับรายการเดียวกันให้อัตโนมัติ</p>}
    </form>
  );
}

const GROUP_LABEL: Record<string, string> = {
  FINANCIAL: "การเงิน", INVESTMENT: "การลงทุน", PROPERTY: "อสังหาริมทรัพย์", ALTERNATIVE: "สินทรัพย์อื่น",
  LIABILITY: "หนี้สิน", INSURANCE_POLICY: "ประกัน", PERSON: "สมาชิกครอบครัว", CREDIT_CARD: "บัตรเครดิต",
};
