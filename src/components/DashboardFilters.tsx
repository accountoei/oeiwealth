"use client";

import { useRouter } from "next/navigation";

/** Dropdown เลือกสมาชิก + เดือน ของ Dashboard (เปลี่ยนแล้วโหลดหน้าใหม่ตาม ?p= &m=) */
export default function DashboardFilters({ persons, months, person, month }: {
  persons: { id: string; name: string }[]; months: { value: string; label: string }[]; person: string; month: string;
}) {
  const router = useRouter();
  const go = (p: string, m: string) => {
    const q = new URLSearchParams();
    if (p) q.set("p", p);
    if (m) q.set("m", m);
    router.push(q.size ? `/?${q}` : "/");
  };
  const sel = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="dash-person">มุมมอง</label>
      <select id="dash-person" value={person} onChange={(e) => go(e.target.value, month)} className={sel}>
        <option value="">ทั้งครอบครัว</option>
        {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <label className="sr-only" htmlFor="dash-month">เดือน</label>
      <select id="dash-month" value={month} onChange={(e) => go(person, e.target.value)} className={sel}>
        {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
    </div>
  );
}
