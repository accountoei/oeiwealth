"use client";

import { useActionState, useState } from "react";
import { saveBeneficiaries, type ActionState } from "./actions";

type Row = { person_id: string; name: string; percent: string };

/** รายชื่อผู้รับผลประโยชน์ (สมาชิก หรือ บุคคลภายนอก) — ส่งเป็น JSON ในช่อง beneficiaries */
export function BeneficiaryRows({ persons, rows, setRows }: {
  persons: { id: string; name: string }[]; rows: Row[]; setRows: (r: Row[]) => void;
}) {
  const total = rows.reduce((s, r) => s + (Number(r.percent) || 0), 0);
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const cls = "rounded-md border border-slate-300 px-2 py-1 text-sm";
  return (
    <div className="space-y-2 text-sm">
      <input type="hidden" name="beneficiaries" value={JSON.stringify(rows.filter((r) => (r.person_id || r.name.trim()) && Number(r.percent) > 0)
        .map((r) => ({ person_id: r.person_id || null, name: r.person_id ? null : r.name, percent: Number(r.percent) })))} />
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select value={r.person_id} onChange={(e) => set(i, { person_id: e.target.value })} className={cls}>
            <option value="">— บุคคลภายนอก —</option>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {!r.person_id && <input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="ชื่อ" className={cls} />}
          <input value={r.percent} onChange={(e) => set(i, { percent: e.target.value })} inputMode="decimal" placeholder="%" className={`w-20 text-right ${cls}`} />
          <span className="text-xs text-slate-500">%</span>
          <button type="button" onClick={() => setRows(rows.filter((_, k) => k !== i))} className="text-xs text-red-600">ลบ</button>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setRows([...rows, { person_id: "", name: "", percent: "" }])} className="text-xs text-slate-700 underline">+ เพิ่มผู้รับผลประโยชน์</button>
        <span className={`text-xs ${total === 100 ? "text-emerald-700" : total > 100 ? "text-red-600" : "text-amber-700"}`}>รวม {total}%</span>
      </div>
    </div>
  );
}

export default function BeneficiaryEditor({ policyId, persons, current }: {
  policyId: string; persons: { id: string; name: string }[]; current: { person_id: string | null; name: string | null; percent: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(current.map((c) => ({ person_id: c.person_id ?? "", name: c.name ?? "", percent: String(c.percent) })));
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBeneficiaries, {});
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs text-slate-700 underline">แก้ผู้รับผลประโยชน์</button>;
  return (
    <form action={action} className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
      <input type="hidden" name="policy_id" value={policyId} />
      <BeneficiaryRows persons={persons} rows={rows} setRows={setRows} />
      <div className="flex items-center gap-2">
        <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">บันทึก</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ปิด</button>
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
        {state.ok && <span className="text-xs text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}
