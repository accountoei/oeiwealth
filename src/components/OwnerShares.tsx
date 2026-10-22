"use client";

import { useState } from "react";
import { numOrZero as num } from "@/lib/format";

/**
 * ช่องกรอกส่วนของสมาชิก
 *   unit = "percent" → % (input ชื่อ owner_<person_id>) · "shares" → จำนวนหุ้น (input ชื่อ shares_<person_id>)
 */
export default function OwnerShares({ persons, title, hint, unit = "percent", totalShares, onTotal }: {
  persons: { id: string; name: string }[]; title: string; hint?: string;
  unit?: "percent" | "shares"; totalShares?: number | null; onTotal?: (n: number) => void;
}) {
  const [shares, setShares] = useState<Record<string, string>>(
    persons.length === 1 && unit === "percent" ? { [persons[0].id]: "100" } : {},
  );
  const total = Object.values(shares).reduce((s, v) => s + num(v), 0);
  const set = (id: string, v: string) => {
    const next = { ...shares, [id]: v };
    setShares(next);
    onTotal?.(Object.values(next).reduce((s, x) => s + num(x), 0));
  };
  if (unit === "shares") return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-medium text-slate-900">{title}</h2>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {persons.map((p) => (
          <label key={p.id} className="flex items-center gap-3 text-sm">
            <span className="w-40 truncate">{p.name}</span>
            <input name={`shares_${p.id}`} inputMode="decimal" data-money="off" value={shares[p.id] ?? ""} placeholder="0"
              onChange={(e) => set(p.id, e.target.value)}
              className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-right" />
            <span>หุ้น</span>
          </label>
        ))}
      </div>
      <p className={`text-xs ${totalShares && total > totalShares ? "text-red-600" : "text-slate-600"}`}>
        ครอบครัวถือรวม {total.toLocaleString("th-TH")} หุ้น
        {totalShares ? ` · ${((total * 100) / totalShares).toLocaleString("th-TH", { maximumFractionDigits: 2 })}% ของบริษัท` : ""}
        {totalShares && total > totalShares ? " · เกินจำนวนหุ้นทั้งหมด" : ""}
      </p>
    </section>
  );
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
              onChange={(e) => set(p.id, e.target.value)}
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
