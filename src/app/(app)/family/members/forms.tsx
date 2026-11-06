"use client";

import { useActionState, useState } from "react";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { useActionSlot } from "@/components/ActionBar";
import { addPerson, updateFamily, type ActionState } from "./actions";
import { ROW_BTN, SMALL_DEL_BTN, SMALL_BTN, familyInitials, RELATIONSHIP_LABEL } from "@/lib/format";
import Flash from "@/components/Flash";

const input = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";
const btn = "rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <span className="text-xs text-red-600">{s.error}</span>;
  if (s.ok) return <Flash on={s} as="span" className="text-xs text-emerald-700" />;
  return null;
}

function RelationshipSelect({ defaultValue }: { defaultValue?: string }) {
  return (
    <select name="relationship" defaultValue={defaultValue ?? ""} required className={input}>
      <option value="" disabled>ความสัมพันธ์…</option>
      {Object.entries(RELATIONSHIP_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

/**
 * รูปครอบครัว: ไม่ตัดรูป (กล่องครอบครัวแสดงแนวนอน 3:2 · เมนูซ้ายแสดงสี่เหลี่ยมเล็ก) · ย่อให้ด้านยาวไม่เกิน 840 px
 * ให้คมบนจอความละเอียดสูง · ไฟล์ไม่เกิน 300,000 ตัวอักษรตามเงื่อนไขฐานข้อมูล (ลดคุณภาพทีละขั้นถ้ายังใหญ่) (ตกลง 6 พ.ย. 2026)
 */
async function resizeFamilyPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("เปิดรูปไม่ได้ — ลองใช้ไฟล์ JPG หรือ PNG")); i.src = url;
    });
    const scale = Math.min(1, 840 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);   // PNG โปร่งใส → พื้นขาว (JPEG ไม่มีความโปร่งใส)
    ctx.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.72, 0.62, 0.5]) {
      const d = c.toDataURL("image/jpeg", q);
      if (d.length <= 290000) return d;
    }
    throw new Error("รูปใหญ่เกินไป — ลองใช้รูปอื่น");
  } finally { URL.revokeObjectURL(url); }
}

/** แก้ไขชื่อครอบครัว + รูป + หัวหน้าครอบครัว (ADMIN) — เปลี่ยนหัวหน้าต้องยืนยัน เพราะความสัมพันธ์ของทุกคนจะคำนวณใหม่ */
export function FamilyForm({ name, headId, photo: photo0 = null, candidates }: {
  name: string; headId: string | null; photo?: string | null; candidates: { id: string; name: string }[];
}) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "sm" });
  const [state, action, pending] = useActionState(updateFamily, {});
  const [head, setHead] = useState(headId ?? "");
  // รูปครอบครัว (กล่องครอบครัว + มุมซ้ายบนของเมนู) — ย่อในเบราว์เซอร์ · photo0 = ลิงก์รูปปัจจุบัน
  const [photo, setPhoto] = useState<string | null>(photo0);
  const [newPhoto, setNewPhoto] = useState("");
  const [clear, setClear] = useState(false);
  const [photoErr, setPhotoErr] = useState("");
  const c = useConfirmSubmit();
  const reset = () => { setHead(headId ?? ""); setPhoto(photo0); setNewPhoto(""); setClear(false); setPhotoErr(""); };
  const trigger = <button type="button" onClick={() => { reset(); setOpen(!open); }} className={activeCls(SMALL_BTN)}>แก้ไข</button>;
  if (!open) return trigger;
  const newHead = candidates.find((x) => x.id === head)?.name;
  async function pick(f: File | undefined) {
    setPhotoErr("");
    if (!f) return;
    try { const d = await resizeFamilyPhoto(f); setNewPhoto(d); setPhoto(d); setClear(false); }
    catch (e) { setPhotoErr(e instanceof Error ? e.message : String(e)); }
  }
  return present(trigger, (
    <>
      <form action={action} className="space-y-3"
        onSubmit={c.guard(`ตั้ง ${newHead} เป็นหัวหน้าครอบครัว?\nความสัมพันธ์ของสมาชิกทุกคนจะคำนวณใหม่เทียบกับคนนี้`, {}, !!head && head !== (headId ?? ""))}>
        <h2 className="font-medium text-slate-900">แก้ไขครอบครัว</h2>
        <input type="hidden" name="photo" value={newPhoto} />
        <input type="hidden" name="photo_clear" value={clear ? "1" : ""} />
        <div className="flex flex-wrap items-center gap-4">
          {photo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={photo} alt="" className="aspect-[3/2] w-36 rounded-xl bg-slate-100 object-cover" />
            : <span className="grid aspect-[3/2] w-36 place-items-center rounded-xl bg-blue-600 text-2xl font-bold text-white">{familyInitials(name)}</span>}
          <div className="space-y-1 text-sm">
            <label className={`${SMALL_BTN} cursor-pointer`}>
              เลือกรูปครอบครัว<input type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            {photo && <button type="button" onClick={() => { setPhoto(null); setNewPhoto(""); setClear(true); }} className={`${SMALL_DEL_BTN} ml-2`}>ลบรูป (ใช้ชื่อย่อแทน)</button>}
            <p className="text-xs text-slate-500">ไม่บังคับ · แสดงในกล่องครอบครัว (แนวนอน) และมุมซ้ายบนของเมนู · ระบบย่อรูปให้อัตโนมัติ</p>
            {photoErr && <p className="text-xs text-red-600">{photoErr}</p>}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-700">ชื่อครอบครัว *
            <input name="name" defaultValue={name} required maxLength={120} className={`${input} mt-1 block w-full`} />
            <span className="mt-1 block text-xs text-slate-500">แสดงมุมซ้ายบนของเมนู</span>
          </label>
          <label className="text-sm text-slate-700">หัวหน้าครอบครัว *
            <select name="head_person_id" value={head} onChange={(e) => setHead(e.target.value)} required className={`${input} mt-1 block w-full`}>
              <option value="" disabled>เลือกสมาชิก…</option>
              {candidates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">ความสัมพันธ์ของทุกคนคิดเทียบกับคนนี้ (เลือกได้เฉพาะสมาชิก Active)</span>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
          <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
          <Msg s={state} />
        </div>
      </form>
      {c.dialog}
    </>
  ));
}

export function AddPersonForm() {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState(addPerson, {});
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(ROW_BTN)}>+ เพิ่มสมาชิก</button>;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-3">
      <h2 className="font-medium text-slate-900">เพิ่มสมาชิกครอบครัว</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-slate-700">ชื่อสมาชิก *<input name="name" required className={`${input} mt-1 block w-full`} /></label>
        <label className="text-sm text-slate-700">ความสัมพันธ์ *<div className="mt-1 [&>select]:w-full"><RelationshipSelect /></div></label>
        <label className="text-sm text-slate-700">วันเกิด<input name="birth_date" type="date" className={`${input} mt-1 block w-full`} /></label>
      </div>
      <p className="text-xs text-slate-500">ข้อมูลอื่น (ชื่อเต็ม รูป ที่อยู่ เอกสาร) ใส่ต่อได้ที่หน้าของสมาชิกคนนั้น</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "เพิ่มสมาชิก"}</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}
