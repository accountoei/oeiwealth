"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type F = { action: string; user: string; entity: string };

/** ตัวกรอง Audit Log · ปุ่มเดียว: "กรอง" → แสดงรายการ · กรองแล้วไม่ได้เปลี่ยนตัวเลือก → ปุ่มเป็น "ล้าง" (กลับเป็นยังไม่แสดง) */
export default function AuditFilter({ actions, users, applied, shown }: {
  actions: [string, string][]; users: { id: string; email: string }[]; applied: F; shown: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState<F>(applied);
  const same = shown && f.action === applied.action && f.user === applied.user && f.entity.trim() === applied.entity;
  const sel = "rounded-md border border-slate-300 px-2 py-1.5";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (same) {
      setF({ action: "", user: "", entity: "" });
      router.push("/settings/family-users#security", { scroll: false });
      return;
    }
    const qs = new URLSearchParams({ show: "1" });
    if (f.action) qs.set("action", f.action);
    if (f.user) qs.set("user", f.user);
    if (f.entity.trim()) qs.set("entity", f.entity.trim());
    router.push(`/settings/family-users?${qs}#security`, { scroll: false });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 text-sm">
      <select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} className={sel}>
        <option value="">ทุกการกระทำ</option>{actions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <select value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} className={sel}>
        <option value="">ทุกผู้ใช้</option>{users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
      </select>
      <input value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })} placeholder="ตาราง เช่น assets" className={sel} data-plain />
      <button className={same ? "min-w-20 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
        : "min-w-20 rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700"}>{same ? "ล้าง" : "กรอง"}</button>
    </form>
  );
}
