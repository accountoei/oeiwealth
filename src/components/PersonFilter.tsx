"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useNavPending } from "./HeaderBar";

/** เลือกดู "ทั้งครอบครัว" หรือทีละสมาชิก (?p=) · คงพารามิเตอร์อื่นในลิงก์ไว้ (เช่น เดือน / แท็บ)
 *   inHeader = อยู่ที่แถบบน: ไม่มีบรรทัดหมายเหตุใต้ช่อง (ย้ายไปเป็นคำอธิบายเมื่อชี้) */
export default function PersonFilter({ persons, value, shareNote = true, inHeader = true }: {
  persons: { id: string; name: string }[]; value: string; shareNote?: boolean; inHeader?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { start } = useNavPending();
  const go = (v: string) => {
    const q = new URLSearchParams(sp.toString());
    if (v) q.set("p", v); else q.delete("p");
    start(() => router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false }));
  };
  const name = persons.find((p) => p.id === value)?.name;
  return (
    <div className="flex flex-col items-end gap-1">
      <label className="sr-only" htmlFor="person-filter">มุมมอง</label>
      <select id="person-filter" value={value} onChange={(e) => go(e.target.value)}
        title={value && shareNote ? `แสดงเฉพาะส่วนของ ${name} · มูลค่าตามสัดส่วน` : undefined}
        className={`rounded-md border px-3 py-1.5 text-sm ${value ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-300 bg-white"}`}>
        <option value="">ทั้งครอบครัว</option>
        {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {value && shareNote && !inHeader && <span className="text-xs text-blue-700">แสดงเฉพาะส่วนของ {name} · มูลค่าตามสัดส่วน</span>}
    </div>
  );
}
