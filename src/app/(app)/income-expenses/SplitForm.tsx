"use client";

import { useActionState, useState } from "react";
import { splitPending, type ActionState } from "./actions";
import { EXPENSE_CATEGORIES, INCOME_TYPE_LABEL, money } from "@/lib/format";

type Line = { description: string; amount: string; cat: string; person_id: string };
const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const n = (s: string) => Number(s.replace(/,/g, "")) || 0;
const blank = (income: boolean): Line => ({ description: "", amount: "", cat: income ? "OTHER" : "ทั่วไป", person_id: "" });

/** แยกรายการรอแยกรายละเอียด → หลายบรรทัด · ยอดรวมต้องไม่เกินก้อน (ส่วนที่เหลือยังรอแยก) */
export default function SplitForm({ kind, id, amount, currency, persons }: {
  kind: "EXPENSE" | "INCOME"; id: string; amount: number; currency: string; persons: { id: string; name: string }[];
}) {
  const income = kind === "INCOME";
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([blank(income)]);
  const [state, action, pending] = useActionState<ActionState, FormData>(splitPending, {});
  if (state.ok) return <p className="text-xs text-emerald-700">{state.ok}</p>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-blue-600 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-50">แยกรายการ</button>;
  const sum = lines.reduce((t, l) => t + n(l.amount), 0);
  const left = Math.round((amount - sum) * 100) / 100;
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <form action={action} className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 text-left" data-no-row-click>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="lines" value={JSON.stringify(lines.map((l) => ({
        description: l.description, amount: l.amount, person_id: l.person_id,
        ...(income ? { income_type: l.cat } : { expense_category: l.cat }) })))} />
      {lines.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input value={l.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="รายละเอียด" className={`min-w-40 flex-1 ${small}`} />
          {income ? (
            <select value={l.cat} onChange={(e) => set(i, { cat: e.target.value })} className={small}>
              {Object.entries(INCOME_TYPE_LABEL).filter(([v]) => !["DIVIDEND", "COUPON", "RENT", "INSURANCE_BENEFIT"].includes(v))
                .map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          ) : (
            <>
              <input value={l.cat} onChange={(e) => set(i, { cat: e.target.value })} list="split-cats" placeholder="หมวด" className={`w-36 ${small}`} />
            </>
          )}
          <select value={l.person_id} onChange={(e) => set(i, { person_id: e.target.value })} className={small}>
            <option value="">{income ? "ตามเจ้าของบัญชี" : "ตามเจ้าของบัญชี / บัตร"}</option>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} inputMode="decimal" placeholder="จำนวน" className={`w-32 ${small}`} />
          {lines.length > 1 && <button type="button" onClick={() => setLines(lines.filter((_, k) => k !== i))} className="text-xs text-slate-500">ลบ</button>}
        </div>
      ))}
      <datalist id="split-cats">{EXPENSE_CATEGORIES.filter((c) => c !== "BANK_FEE").map((c) => <option key={c} value={c} />)}</datalist>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button type="button" onClick={() => setLines([...lines, blank(income)])} className="text-slate-700 underline">+ เพิ่มบรรทัด</button>
        <span>แยกแล้ว {money(sum, currency)} · {left < 0 ? <b className="text-red-700">เกิน {money(-left, currency)}</b> : <>ยังรอแยก {money(left, currency)}</>}</span>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={pending || left < 0 || sum <= 0} className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50">
          {pending ? "…" : "บันทึกการแยก"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ปิด</button>
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      <p className="text-xs text-slate-500">ยอดรวมไม่เกินก้อน · ส่วนที่ไม่ได้แยกยังเป็น &ldquo;รอแยก&rdquo; · ทำได้แม้ปิดงวดแล้ว (Net Worth ไม่เปลี่ยน)</p>
    </form>
  );
}
