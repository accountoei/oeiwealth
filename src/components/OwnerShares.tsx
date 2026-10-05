"use client";

import { useState } from "react";

/** ช่องกรอกสัดส่วน % ต่อสมาชิก (ส่งค่าเป็น input ชื่อ owner_<person_id>) */
export default function OwnerShares({ persons, title, hint }: {
  persons: { id: string; name: string }[]; title: string; hint?: string;
}) {
  const [shares, setShares] = useState<Record<string, string>>(
    persons.length === 1 ? { [persons[0].id]: "100" } : {},
  );
  const total = Object.values(shares).reduce((s, v) => s + (Number(v) || 0), 0);
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-medium text-slate-900">{title}</h2>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {persons.length === 0 && <p className="text-sm text-amber-700">ยังไม่มีสมาชิกครอบครัว — เพิ่มที่ Family &amp; Users ก่อน</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {persons.map((p) => (
          <label key={p.id} className="flex items-center gap-3 text-sm">
            <span className="w-40 truncate">{p.name}</span>
            <input name={`owner_${p.id}`} inputMode="decimal" value={shares[p.id] ?? ""} placeholder="0"
              onChange={(e) => setShares({ ...shares, [p.id]: e.target.value })}
              className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-right" />
            <span>%</span>
          </label>
        ))}
      </div>
      <p className={`text-xs ${total === 100 ? "text-emerald-700" : total > 100 ? "text-red-600" : "text-amber-700"}`}>
        รวม {total}% {total < 100 && `· ยังไม่ระบุ ${100 - total}% (บันทึกได้ แต่ต้องครบก่อน Go-live)`}
        {total > 100 && "· เกิน 100%"}
      </p>
    </section>
  );
}
