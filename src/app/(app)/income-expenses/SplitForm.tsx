"use client";

import Modal from "@/components/Modal";
import { useRowPanel } from "@/components/RowPanel";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { splitPending, type ActionState } from "./actions";
import { INCOME_TYPE_LABEL, money } from "@/lib/format";
import type { SplitMove } from "@/lib/split-moves";
import { findHint, type ExpHint } from "@/lib/category-hints";

type Line = { description: string; amount: string; cat: string; person_id: string; move: string; to: string; auto?: boolean };
const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const n = (s: string) => Number(s.replace(/,/g, "")) || 0;
const blank = (): Line => ({ description: "", amount: "", cat: "", person_id: "", move: "", to: "" });   // หมวด / ประเภท ต้องเลือกเอง

/** แยกรายการรอแยกรายละเอียด → หลายบรรทัด · ยอดรวมต้องไม่เกินก้อน (ส่วนที่เหลือยังรอแยก) */
export default function SplitForm({ kind, id, amount, currency, persons, categories = [], moves = [], personDefault = "ตามเจ้าของบัญชี / บัตร", label = "แยกรายการ", hints = [], rowClick = false, buttonCls }: {
  kind: "EXPENSE" | "INCOME"; id: string; amount: number; currency: string; persons: { id: string; name: string }[]; categories?: string[];
  /** บรรทัดแบบเคลื่อนเงินที่ก้อนนี้แยกได้ (ไม่มี = แยกเป็นรายได้ / ค่าใช้จ่ายอย่างเดียว) */
  moves?: SplitMove[];
  /** ข้อความของ "ไม่ระบุคน" */
  personDefault?: string;
  label?: string;
  /** ค่าใช้จ่าย: เดาหมวดจากรายการเดิมที่รายละเอียดเหมือนกัน */
  hints?: ExpHint[];
  /** กดที่แถวตารางเพื่อเปิด (ไม่มีปุ่ม) — ใช้ในกล่องเงินเข้า–ออก */
  rowClick?: boolean;
  /** สีปุ่ม (ค่าเริ่มต้น เส้นขอบน้ำเงิน) */
  buttonCls?: string;
}) {
  const income = kind === "INCOME";
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [state, action, pending] = useActionState<ActionState, FormData>(splitPending, {});
  const router = useRouter();
  // บันทึกแล้ว → โหลดข้อมูลหน้าใหม่ทันที (ยอดที่ยังรอแยกอัปเดต · กดแยกต่อได้เลย)
  useEffect(() => { if (state.ok) router.refresh(); }, [state, router]);
  const box = useRef<HTMLFormElement>(null);
  const row = useRowPanel(rowClick);
  const isOpen = rowClick ? row.open : open;
  const close = () => { if (rowClick) row.setOpen(false); else setOpen(false); setLines([blank()]); };
  if (rowClick && !isOpen) return row.render(null);
  if (state.ok && !isOpen) return <p className="text-xs text-emerald-700">{state.ok}</p>;
  if (!isOpen) return <button type="button" onClick={() => setOpen(true)} className={buttonCls ?? "rounded-md border border-blue-600 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-50"}>{label}</button>;
  const sum = lines.reduce((t, l) => t + n(l.amount), 0);
  const left = Math.round((amount - sum) * 100) / 100;
  // เกินยอดก้อนได้เฉพาะส่วนที่เป็นเงินโอน → ส่วนเกินเป็นก้อนรอแยกฝั่งตรงข้ามในบัญชีเดียวกัน (กติกาจริงอยู่ใน public.split_lump)
  const fixedSum = lines.filter((l) => l.move !== "TRANSFER").reduce((t, l) => t + n(l.amount), 0);
  const hasXfer = lines.some((l) => l.move === "TRANSFER" && n(l.amount) > 0);
  const overOk = left < 0 && hasXfer && fixedSum <= amount + 0.005;
  const missingCat = lines.some((l) => !l.move && (l.description.trim() || l.amount.trim()) && !l.cat.trim());
  const missingTo = lines.some((l) => l.move && l.amount.trim() && !l.to);
  const moveOf = (l: Line) => moves.find((m) => m.value === l.move);
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const body = (<>
    <form ref={box} action={action} className="space-y-2 text-left" data-no-row-click>
      {!income && hints.length > 0 && <datalist id={`split-hints-${id}`}>{hints.slice(0, 300).map((h) => <option key={h.d} value={h.d} />)}</datalist>}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="lines" value={JSON.stringify(lines.map((l) => (l.move
        ? { move: l.move, target: l.to, description: l.description, amount: l.amount }
        : { description: l.description, amount: l.amount, person_id: l.person_id,
            ...(income ? { income_type: l.cat } : { expense_category: l.cat }) })))} />
      {lines.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          {moves.length > 0 && (
            <select value={l.move} onChange={(e) => set(i, { move: e.target.value, to: "" })} className={small}>
              <option value="">{income ? "รายได้" : "ค่าใช้จ่าย"}</option>
              {moves.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          )}
          <input value={l.description} list={!income && hints.length ? `split-hints-${id}` : undefined} autoComplete="off"
            onChange={(e) => {
              // หมวดที่ระบบเดาไว้ (ยังไม่ได้เลือกเอง) เปลี่ยนตามรายละเอียดได้เรื่อย ๆ
              const h = !income && !l.move && (!l.cat || l.auto) ? findHint(hints.filter((x) => categories.includes(x.c)), e.target.value) : null;
              set(i, { description: e.target.value, ...(h ? { cat: h.c, auto: true } : {}) });
            }} placeholder={l.move ? "รายละเอียด (ไม่บังคับ)" : "รายละเอียด"} className={`min-w-40 flex-1 ${small}`} />
          {l.move ? (
            <select value={l.to} onChange={(e) => set(i, { to: e.target.value })} className={`${small} ${l.to ? "" : "border-amber-400 text-slate-500"}`}>
              <option value="">{moveOf(l)?.pick ?? "— เลือก —"}</option>
              {(moveOf(l)?.targets ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : income ? (
            <select value={l.cat} onChange={(e) => set(i, { cat: e.target.value, auto: false })} className={`${small} ${l.cat ? "" : "border-amber-400 text-slate-500"}`}>
              <option value="">— เลือกประเภท —</option>
              {Object.entries(INCOME_TYPE_LABEL).filter(([v]) => !["DIVIDEND", "COUPON", "RENT", "INSURANCE_BENEFIT"].includes(v))
                .map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          ) : (
            <select value={l.cat} onChange={(e) => set(i, { cat: e.target.value, auto: false })} className={`${small} ${l.cat ? "" : "border-amber-400 text-slate-500"}`}>
              <option value="">— เลือกหมวด —</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {!l.move && (
            <select value={l.person_id} onChange={(e) => set(i, { person_id: e.target.value })} className={small}>
              <option value="">{personDefault}</option>
              {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <input value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} inputMode="decimal" placeholder="จำนวน" className={`w-32 ${small}`} />
          {lines.length > 1 && <button type="button" onClick={() => setLines(lines.filter((_, k) => k !== i))} className="text-xs text-slate-500">ลบ</button>}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button type="button" onClick={() => setLines([...lines, blank()])} className="text-slate-700 underline">+ เพิ่มบรรทัด</button>
        {missingCat && <span className="text-amber-700">เลือก{income ? "ประเภท" : "หมวด"}ให้ทุกบรรทัดก่อนบันทึก</span>}
        {missingTo && <span className="text-amber-700">เลือกบัญชี / บัตร / หนี้ ของบรรทัดเคลื่อนเงินก่อนบันทึก</span>}
        <span>แยกแล้ว {money(sum, currency)} · {left < 0
          ? overOk
            ? <b className="text-amber-700">โอนเกิน {money(-left, currency)} → เป็น{income ? "ค่าใช้จ่าย" : "รายได้"}รอแยกในบัญชีเดียวกัน</b>
            : <b className="text-red-700">เกิน {money(-left, currency)}{hasXfer ? " (เกินได้เฉพาะเงินโอน)" : ""}</b>
          : <>ยังรอแยก {money(left, currency)}</>}</span>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={pending || (left < 0 && !overOk) || sum <= 0 || missingCat || missingTo} className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50">
          {pending ? "…" : "บันทึกการแยก"}</button>
        <button type="button" data-close onClick={close} className="text-xs text-slate-500">ปิด</button>
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      <p className="text-xs text-slate-500">ยอดรวมไม่เกินก้อน (ยกเว้นเงินโอน: ส่วนที่โอนเกินเป็นก้อนรอแยกฝั่งตรงข้ามในบัญชีเดียวกัน) · ส่วนที่ไม่ได้แยกยังเป็น &ldquo;รอแยก&rdquo; · ทำได้แม้ปิดงวดแล้ว (Net Worth ไม่เปลี่ยน)
        {moves.length > 0 && <> · {moves.map((m) => m.label).join(" / ")} บันทึกเป็นรายการเคลื่อนเงินวันเดียวกับก้อน (แก้ / ลบได้ที่กล่องเงินเข้า–ออกในภาพรวม · งวดที่ปิดแล้วต้อง Reopen ก่อน)</>}</p>
    </form>
    {state.ok && <p className="text-sm text-emerald-700">{state.ok}</p>}
  </>);
  if (rowClick) return row.render(body, label, "lg");
  return <Modal title={label} size="lg" onClose={() => setOpen(false)}>{body}</Modal>;
}
