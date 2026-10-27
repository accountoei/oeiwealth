"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { createClient } from "@/lib/supabase/client";
import { GROUP_LABEL, type EntityOption } from "./DocumentUpload";

type Linked = { id: string; key: string; name: string };

/**
 * ส่วน "เอกสารของ" ในหน้าต่างแก้ไขรายการของหน้า Documents (กดที่บรรทัด)
 *   ผูกเพิ่ม = link_document · ยกเลิกผูก = soft delete document_links (ADMIN / EDITOR ตามสิทธิ์ลบ · ตัวเอกสารไม่ถูกลบ)
 *   ผูกเพิ่ม: เลือกประเภทก่อน (ค่าเริ่มต้น = ประเภทของรายการแรกที่ผูกอยู่) แล้วค่อยเลือกรายการ
 *   ผูกผิดรายการ = ยกเลิกผูกอันเดิม แล้วผูกอันใหม่ในหน้าต่างเดียวกัน
 */
export default function LinkDocument({ docId, title, options, linked, canUnlink, defaultGroup }: {
  docId: string; title: string; options: EntityOption[]; linked: Linked[]; canUnlink: boolean; defaultGroup?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [entity, setEntity] = useState("");
  const { ask, dialog } = useConfirm();
  const keys = linked.map((l) => l.key);
  const avail = options.filter((o) => !keys.includes(`${o.type}:${o.id}`));
  const groups = [...new Set(avail.map((o) => o.group))];
  const [group, setGroup] = useState(defaultGroup && groups.includes(defaultGroup) ? defaultGroup : groups[0] ?? "");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!entity) return;
    const [type, id] = entity.split(":");
    setBusy(true); setErr("");
    const { error } = await createClient().rpc("link_document", { p_document_id: docId, p_entity_type: type, p_entity_id: id });
    setBusy(false);
    if (error) { setErr(error.message.replace(/^INVALID:\s*/, "")); return; }
    setEntity(""); router.refresh();
  }

  async function unlink(l: Linked) {
    if (!(await ask(`ยกเลิกผูกเอกสาร "${title}" กับ "${l.name}"?\nตัวเอกสารยังอยู่ในระบบ`, { danger: true, okLabel: "ยกเลิกผูก" }))) return;
    setBusy(true); setErr("");
    const { data, error } = await createClient().from("document_links").update({ deleted_at: new Date().toISOString() }).eq("id", l.id).select("id");
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (!data?.length) { setErr("คุณไม่มีสิทธิ์ยกเลิกผูก (เฉพาะ ADMIN / EDITOR)"); return; }
    router.refresh();
  }

  const sel = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
  return (
    <div className="space-y-3 text-left text-sm" data-keep-open>
      <div>
        <h3 className="mb-1 font-medium text-slate-900">เอกสารของ</h3>
        {linked.length === 0 ? <p className="text-amber-700">ยังไม่ผูกกับรายการ</p> : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {linked.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>{l.name}</span>
                {canUnlink && <button type="button" disabled={busy} onClick={() => unlink(l)}
                  className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50">ยกเลิกผูก</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <form onSubmit={add} className="space-y-2">
        <div className="text-xs text-slate-500">ผูกเพิ่ม</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-slate-700">ประเภทรายการ
            <select value={group} onChange={(e) => { setGroup(e.target.value); setEntity(""); }} className={sel}>
              {groups.map((g) => <option key={g} value={g}>{GROUP_LABEL[g] ?? g}</option>)}
            </select>
          </label>
          <label className="block text-slate-700">รายการ
            <select value={entity} required onChange={(e) => setEntity(e.target.value)} className={sel}>
              <option value="">— เลือกรายการ —</option>
              {avail.filter((o) => o.group === group).map((o) => <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>{o.label}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-slate-500">หมวดของเอกสารเปลี่ยนตามรายการที่ผูก (รายการแรก) · ผูกผิด = กด &ldquo;ยกเลิกผูก&rdquo; อันเดิม แล้วเลือกอันใหม่</p>
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={busy || !entity} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{busy ? "กำลังบันทึก…" : "ผูก"}</button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </form>
      {dialog}
    </div>
  );
}
