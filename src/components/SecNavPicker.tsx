"use client";

import { useState, useTransition } from "react";
import { fetchSecNav, type SecNav } from "@/app/(app)/investments/actions";
import { thDate } from "@/lib/format";

/**
 * ปุ่ม "ดึง NAV จาก ก.ล.ต." — ใส่ชื่อย่อกองทุน / ชื่อชนิดหน่วย แล้วดึง NAV ของวันที่กำหนด (หรือวันทำการก่อนหน้า)
 * แสดงชื่อเต็มกองทุน + ชนิดหน่วย + วันที่ของ NAV ให้ผู้ใช้เทียบกับ Statement ก่อนใช้ · กองทุนหลายชนิดหน่วย = ให้เลือก
 * ไม่ใช่ <form> (อยู่ในฟอร์มอื่นได้) · ไม่บันทึกอะไร — ส่ง NAV ให้ฟอร์มผ่าน onNav
 */
export default function SecNavPicker({ date, initialQuery, onNav }: {
  date: string; initialQuery?: string; onNav: (nav: SecNav) => void;
}) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [hit, setHit] = useState<SecNav | null>(null);

  const run = (q: string) => {
    if (!q.trim()) { setErr("ใส่ชื่อย่อกองทุน หรือชื่อชนิดหน่วยก่อน"); return; }
    setErr(null); setClasses([]); setHit(null);
    start(async () => {
      const r = await fetchSecNav(q.trim(), date);
      if (r.nav) { setHit(r.nav); onNav(r.nav); return; }
      setErr(r.error ?? "ดึง NAV ไม่ได้");
      setClasses(r.classes ?? []);
    });
  };

  return (
    <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-xs text-slate-600">ชื่อย่อกองทุน / ชื่อชนิดหน่วย
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="เช่น K-FIXED-A" data-plain
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); run(query); } }}
            className="mt-1 block w-48 rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </label>
        <button type="button" onClick={() => run(query)} disabled={busy}
          className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50">
          {busy ? "กำลังดึง…" : `ดึง NAV ณ ${thDate(date)} จาก ก.ล.ต.`}</button>
      </div>
      {classes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-600">เลือกชนิดหน่วยที่ถือ:</span>
          {classes.map((c) => (
            <button key={c} type="button" onClick={() => { setQuery(c); run(c); }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50">{c}</button>
          ))}
        </div>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
      {hit && (
        <p className="text-xs text-slate-700">
          <span className="font-medium">{hit.name_th ?? hit.proj_id}</span>
          {hit.class && <> · ชนิดหน่วย <span className="font-medium">{hit.class}</span></>}
          {" "}· NAV <span className="tabular-nums font-medium">{hit.nav.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>
          {" "}ณ {thDate(hit.nav_date)}
          {hit.nav_date !== date && <span className="text-amber-700"> (วันทำการก่อนหน้า)</span>}
          <span className="block text-slate-500">ตรวจชื่อกองทุน / ชนิดหน่วยให้ตรงกับ Statement ก่อนบันทึก</span>
        </p>
      )}
    </div>
  );
}
