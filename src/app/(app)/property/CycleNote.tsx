import { cycleNote } from "@/lib/lease";

/** ช่วงวันของงวดค่าเช่าที่ไม่เต็มรอบ (งวดแรกที่เข้าอยู่ไม่ตรงวันจ่าย / งวดสุดท้ายที่ออกกลางรอบ · คิดตามจำนวนวัน) — งวดเต็มไม่แสดง */
export default function CycleNote({ start, end, expected, rent }: {
  start: string | null | undefined; end: string | null | undefined; expected: number; rent: number | undefined;
}) {
  const t = cycleNote(start, end, expected, rent);
  return t ? <div className="text-xs font-normal text-slate-500">{t}</div> : null;
}
