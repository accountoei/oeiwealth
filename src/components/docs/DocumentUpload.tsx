"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { callDrive } from "./drive";
import { DOC_MODULE_LABEL, DOC_TYPES, ENTITY_MODULE } from "@/lib/format";

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
    setEntity(v);
    const opt = entityOptions?.find((o) => `${o.type}:${o.id}` === v);
    if (opt && !fixedModule) setModule(ENTITY_MODULE[opt.group] ?? ENTITY_MODULE[opt.type] ?? module);
  }
  function pickFile(f: File | undefined) {
    if (f && !title) setTitle(f.name.replace(/\.[A-Za-z0-9]{1,6}$/, ""));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) { setMsg({ error: "กรุณาเลือกไฟล์" }); return; }
    if (file.size > 20 * 1024 * 1024) { setMsg({ error: "ไฟล์ใหญ่เกิน 20 MB" }); return; }
    const links = link ? [{ entity_type: link.type, entity_id: link.id }]
      : entity ? [{ entity_type: entity.split(":")[0], entity_id: entity.split(":")[1] }] : [];
    const meta = {
      module, title: String(f.get("title") ?? "").trim(), document_type: String(f.get("document_type") ?? "").trim(),
      issue_date: String(f.get("issue_date") ?? ""), expiry_date: String(f.get("expiry_date") ?? ""),
      notes: String(f.get("notes") ?? ""), links, supersedes_document_id: supersedes?.id ?? null,
    };
    const body = new FormData();
    body.append("file", file);
    body.append("meta", JSON.stringify(meta));
    setBusy(true); setMsg({});
    try {
      await callDrive(body);
      setMsg({ ok: "อัปโหลดแล้ว" });
      formRef.current?.reset(); setTitle(""); setEntity(""); setOpen(false);
      router.refresh();
    } catch (err) {
      setMsg({ error: err instanceof Error ? err.message : String(err) });
    } finally { setBusy(false); }
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
          <input name="document_type" required list={`doc-types-${module}`} defaultValue={supersedes?.document_type ?? ""} placeholder="เลือกหรือพิมพ์เอง" className={input} />
          <datalist id={`doc-types-${module}`}>{(DOC_TYPES[module] ?? []).map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <label className="text-sm md:col-span-2">ชื่อเอกสาร *<input name="title" required value={title} onChange={(e) => setTitle(e.target.value)} className={input} /></label>
        <label className="text-sm">วันที่ออกเอกสาร<input name="issue_date" type="date" className={input} /></label>
        <label className="text-sm">วันหมดอายุ<input name="expiry_date" type="date" className={input} /></label>
        <label className="text-sm">หมายเหตุ<input name="notes" className={input} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={busy} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "กำลังอัปโหลด…" : "อัปโหลด"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
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
