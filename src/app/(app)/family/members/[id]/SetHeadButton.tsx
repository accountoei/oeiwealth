"use client";

import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { setFamilyHead } from "../actions";

/** ตั้งเป็นหัวหน้าครอบครัว (ADMIN) — ยืนยันก่อน เพราะความสัมพันธ์ของทุกคนจะคำนวณใหม่ */
export default function SetHeadButton({ id, name }: { id: string; name: string }) {
  const c = useConfirmSubmit();
  return (
    <>
      <form action={setFamilyHead} onSubmit={c.guard(`ตั้ง ${name} เป็นหัวหน้าครอบครัว?\nความสัมพันธ์ของสมาชิกทุกคนจะคำนวณใหม่เทียบกับคนนี้`)}>
        <input type="hidden" name="id" value={id} />
        <button className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">ตั้งเป็นหัวหน้าครอบครัว</button>
      </form>
      {c.dialog}
    </>
  );
}
