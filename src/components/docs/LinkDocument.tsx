"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";
import { GROUP_LABEL, type EntityOption } from "./DocumentUpload";

/**
 * ผูกเอกสารที่มีอยู่แล้วกับรายการ (หน้า Documents คอลัมน์ "เอกสารของ")
 *   linked = รายการที่ผูกอยู่แล้ว ("TYPE:id") → ไม่แสดงให้เลือกซ้ำ
 */
export default function LinkDocument({ docId, title, options, linked, label }: {
  docId: string; title: string; options: EntityOption[]; linked: string[]; label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [entity, setEntity] = useState("");
  const avail = options.filter((o) => !linked.includes(`${o.type}:${o.id}`));
  const groups = [...new Set(avail.map((o) => o.group))];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!entity) return;
    const [type, id] = entity.split(":");
    setBusy(true); setErr("");
    const { error } = await createClient().rpc("link_document", { p_document_id: docId, p_entity_type: type, p_entity_id: id });
    setBusy(false);
    if (error) { setErr(error.message.replace(/^INVALID:\s*/, "")); return; }
    setOpen(false); setEntity(""); router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setErr(""); }} className="text-sky-700 underline hover:text-sky-900">{label}</button>
      {open && (
        <Modal onClose={() => setOpen(false)} title={`ผูกเอกสาร "${title}"`}>
          <form onSubmit={save} className="space-y-3 text-left" data-keep-open>
            <label className="block text-sm">เป็นเอกสารของ
              <select value={entity} required onChange={(e) => setEntity(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">— เลือกรายการ —</option>
                {groups.map((g) => (
                  <optgroup key={g} label={GROUP_LABEL[g] ?? g}>
                    {avail.filter((o) => o.group === g).map((o) => <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>{o.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <p className="text-xs text-slate-500">หมวดของเอกสารจะเปลี่ยนตามรายการที่ผูก (รายการแรก)</p>
            <div className="flex flex-wrap items-center gap-3">
              <button disabled={busy || !entity} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "กำลังบันทึก…" : "ผูก"}</button>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ยกเลิก</button>
              {err && <span className="text-sm text-red-600">{err}</span>}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
