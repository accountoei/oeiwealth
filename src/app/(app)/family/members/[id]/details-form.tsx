"use client";

import { useActionState, useState } from "react";
import { updatePersonDetails, type ActionState } from "../actions";
import { PERSON_STATUS_LABEL, RELATIONSHIP_LABEL, TITLE_PREFIXES } from "@/lib/format";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-sm text-slate-700";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

export type PersonDetails = {
  id: string; name: string; relationship: string | null; status: string; death_date: string | null;
  father_id: string | null; mother_id: string | null; spouse_id: string | null; title_prefix: string | null; full_name_th: string | null; full_name_en: string | null; nickname: string | null;
  birth_date: string | null; photo: string | null; phone: string | null; email: string | null; address: string | null;
  emergency_contact_name: string | null; emergency_contact_phone: string | null; national_id: string | null;
  passport_no: string | null; passport_expiry: string | null; house_registration_no: string | null; notes: string | null;
};

/** ย่อรูปเป็นสี่เหลี่ยมจัตุรัส 256 px (JPEG) ในเบราว์เซอร์ → data URL เล็ก ๆ */
async function resizePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("เปิดรูปไม่ได้ — ลองใช้ไฟล์ JPG หรือ PNG")); i.src = url;
    });
    const size = 256, side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement("canvas"); c.width = size; c.height = size;
    c.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return c.toDataURL("image/jpeg", 0.85);
  } finally { URL.revokeObjectURL(url); }
}

export function PersonDetailsForm({ p, others }: { p: PersonDetails; others: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(p.photo);
  const [newPhoto, setNewPhoto] = useState("");
  const [clear, setClear] = useState(false);
  const [photoErr, setPhotoErr] = useState("");
  const [status, setStatus] = useState(p.status);
  const [state, action, pending] = useActionState<ActionState, FormData>(updatePersonDetails, {});

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">แก้ไขข้อมูล</button>;

  async function pick(f: File | undefined) {
    setPhotoErr("");
    if (!f) return;
    try { const d = await resizePhoto(f); setNewPhoto(d); setPhoto(d); setClear(false); }
    catch (e) { setPhotoErr(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <form action={action} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="id" value={p.id} />
      <input type="hidden" name="photo" value={newPhoto} />
      <input type="hidden" name="photo_clear" value={clear ? "1" : ""} />

      <div className="flex flex-wrap items-center gap-4">
        {photo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={photo} alt="" className="h-20 w-20 rounded-full object-cover" />
          : <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-400">ไม่มีรูป</div>}
        <div className="space-y-1 text-sm">
          <label className="cursor-pointer text-blue-700 underline">
            เลือกรูปโปรไฟล์<input type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          {photo && <button type="button" onClick={() => { setPhoto(null); setNewPhoto(""); setClear(true); }} className="block text-xs text-slate-500 underline">ลบรูป</button>}
          <p className="text-xs text-slate-500">ไม่บังคับ · ระบบย่อรูปให้อัตโนมัติ</p>
          {photoErr && <p className="text-xs text-red-600">{photoErr}</p>}
        </div>
      </div>

      <fieldset className="grid gap-4 md:grid-cols-4">
        <legend className="mb-2 text-sm font-medium text-slate-900">ข้อมูลทั่วไป</legend>
        <label className={`${label} md:col-span-2`}>ชื่อที่ใช้ในระบบ *<input name="name" required defaultValue={p.name} className={input} /></label>
        <label className={label}>ความสัมพันธ์ *
          <select name="relationship" required defaultValue={p.relationship ?? ""} className={input}>
            <option value="" disabled>เลือก…</option>
            {Object.entries(RELATIONSHIP_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={label}>สถานะ
          <select name="status" defaultValue={p.status} onChange={(e) => setStatus(e.target.value)} className={input}>
            {Object.entries(PERSON_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {status === "DECEASED" && (
          <>
            <label className={label}>วันที่เสียชีวิต<input type="date" name="death_date" defaultValue={p.death_date ?? ""} className={input} /></label>
            {p.status !== "DECEASED" && <p className="self-end text-xs text-amber-700 md:col-span-3">ตั้งเป็น Archived → ระบบจะสร้างรายการติดตามกรมธรรม์ที่เกี่ยวข้องให้ (เคลม / เวนคืน / เปลี่ยนผู้รับผลประโยชน์) และซ่อนจากรายชื่อหลัก</p>}
          </>
        )}
        {p.status === "DECEASED" && status !== "DECEASED" && <p className="text-xs text-amber-700 md:col-span-4">เปลี่ยนจาก Archived → รายการติดตามกรมธรรม์ที่ยังไม่เริ่มจะถูกปิดเป็น &ldquo;ไม่ต้องทำ&rdquo; ให้เอง (ถ้าตั้ง Archived อีกครั้ง จะเปิดกลับให้)</p>}
        {status === "INACTIVE" && <p className="text-xs text-slate-500 md:col-span-4">Inactive: ไม่ขึ้นในช่องเลือกคนตอนสร้างรายการใหม่ · รายการเดิมยังอยู่และนับใน Net Worth ตามปกติ</p>}
        <label className={label}>คำนำหน้า
          <input name="title_prefix" list="title-prefixes" defaultValue={p.title_prefix ?? ""} className={input} />
          <datalist id="title-prefixes">{TITLE_PREFIXES.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <label className={`${label} md:col-span-2`}>ชื่อ-นามสกุล (ไทย)<input name="full_name_th" defaultValue={p.full_name_th ?? ""} className={input} /></label>
        <label className={label}>ชื่อเล่น<input name="nickname" defaultValue={p.nickname ?? ""} className={input} /></label>
        <label className={`${label} md:col-span-2`}>ชื่อ-นามสกุล (อังกฤษ)<input name="full_name_en" defaultValue={p.full_name_en ?? ""} className={input} /></label>
        <label className={label}>วันเกิด<input type="date" name="birth_date" defaultValue={p.birth_date ?? ""} className={input} /></label>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="mb-2 text-sm font-medium text-slate-900">ครอบครัว (ใช้คำนวณความสัมพันธ์และผังครอบครัว)</legend>
        {([["father_id", "พ่อ", p.father_id], ["mother_id", "แม่", p.mother_id], ["spouse_id", "คู่สมรส", p.spouse_id]] as const).map(([n, l, v]) => (
          <label key={n} className={label}>{l}
            <select name={n} defaultValue={v ?? ""} className={input}>
              <option value="">— ไม่ระบุ / ไม่อยู่ในระบบ —</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        ))}
        <p className="text-xs text-slate-500 md:col-span-3">ผูกพ่อ / แม่ / คู่สมรสแล้ว ระบบคำนวณ &ldquo;ความสัมพันธ์&rdquo; เทียบกับหัวหน้าครอบครัวให้เอง (ค่าที่เลือกเองจะถูกแทน) · คู่สมรสผูกให้สองทาง</p>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-2 text-sm font-medium text-slate-900">การติดต่อ</legend>
        <label className={label}>เบอร์โทร<input name="phone" type="tel" defaultValue={p.phone ?? ""} className={input} /></label>
        <label className={label}>อีเมล<input name="email" type="email" defaultValue={p.email ?? ""} className={input} /></label>
        <label className={`${label} md:col-span-2`}>ที่อยู่<textarea name="address" rows={2} defaultValue={p.address ?? ""} className={input} /></label>
        <label className={label}>ผู้ติดต่อฉุกเฉิน (ชื่อ / ความสัมพันธ์)<input name="emergency_contact_name" defaultValue={p.emergency_contact_name ?? ""} className={input} /></label>
        <label className={label}>เบอร์ผู้ติดต่อฉุกเฉิน<input name="emergency_contact_phone" type="tel" defaultValue={p.emergency_contact_phone ?? ""} className={input} /></label>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-2 text-sm font-medium text-slate-900">เอกสารประจำตัว</legend>
        <label className={label}>เลขบัตรประชาชน (13 หลัก)<input name="national_id" inputMode="numeric" data-plain defaultValue={p.national_id ?? ""} className={input} /></label>
        <label className={label}>เลขทะเบียนบ้าน<input name="house_registration_no" data-plain defaultValue={p.house_registration_no ?? ""} className={input} /></label>
        <label className={label}>เลขหนังสือเดินทาง<input name="passport_no" data-plain defaultValue={p.passport_no ?? ""} className={input} /></label>
        <label className={label}>หนังสือเดินทางหมดอายุ<input type="date" name="passport_expiry" defaultValue={p.passport_expiry ?? ""} className={input} /></label>
      </fieldset>

      <label className={label}>หมายเหตุ<textarea name="notes" rows={2} defaultValue={p.notes ?? ""} className={input} /></label>

      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}
