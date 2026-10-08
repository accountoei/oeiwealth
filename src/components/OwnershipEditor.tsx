"use client";

import { useActionState, useState } from "react";
import { setOwnership, type RecState } from "@/lib/records";

/** แก้สัดส่วนเจ้าของ (asset) หรือผู้รับผิดชอบหนี้ (liability) */
export default function OwnershipEditor({ kind, id, persons, current, paths, today }: {
  kind: "asset" | "liability"; id: string; persons: { id: string; name: string }[];
  current: { person_id: string; percent: number }[]; paths: string[]; today: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("CORRECT");
  const [shares, setShares] = useState<Record<string, string>>(
    Object.fromEntries(current.map((c) => [c.person_id, String(c.percent)])));
  const [state, action, pending] = useActionState<RecState, FormData>(setOwnership, {});
  const total = Object.values(shares).reduce((s, v) => s + (Number(v) || 0), 0);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs text-slate-700 underline">แก้สัดส่วน</button>;
  return (
    <form action={action} className="mt-2 space-y-3 rounded-lg bg-slate-50 p-3 text-sm">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="paths" value={paths.join(",")} />
      {kind === "asset" && (
        <div className="space-y-1 text-xs">
          <label className="flex items-start gap-2"><input type="radio" name="mode" value="CORRECT" checked={mode === "CORRECT"} onChange={() => setMode("CORRECT")} className="mt-0.5" />
            <span>แก้ข้อมูลที่กรอกผิด (ใช้สัดส่วนใหม่ย้อนไปตั้งแต่แรก)</span></label>
          <label className="flex items-start gap-2"><input type="radio" name="mode" value="CHANGE" checked={mode === "CHANGE"} onChange={() => setMode("CHANGE")} className="mt-0.5" />
            <span>เปลี่ยนเจ้าของจริง (เช่น โอน / ให้) ตั้งแต่วันที่ — เก็บประวัติเดิมไว้</span></label>
          {mode === "CHANGE" && <input name="effective_date" type="date" required defaultValue={today} className="ml-6 rounded-md border border-slate-300 px-2 py-1" />}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {persons.map((p) => (
          <label key={p.id} className="flex items-center gap-2">
            <span className="flex-1">{p.name}</span>
            <input name={`owner_${p.id}`} inputMode="decimal" value={shares[p.id] ?? ""} placeholder="0"
              onChange={(e) => setShares({ ...shares, [p.id]: e.target.value })} className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right" />
            <span className="text-xs text-slate-500">%</span>
          </label>
        ))}
      </div>
      <div className={`text-xs ${total === 100 ? "text-emerald-700" : total > 100 ? "text-red-600" : "text-amber-700"}`}>
        รวม {total}%{total < 100 && ` · ส่วนที่เหลือ ${100 - total}% จะเป็น "ยังไม่ระบุเจ้าของ"`}
      </div>
      <div className="flex items-center gap-2">
        <button disabled={pending || total > 100} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">{pending ? "…" : "บันทึก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ปิด</button>
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
        {state.ok && <span className="text-xs text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}
