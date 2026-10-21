"use client";

import { useActionState } from "react";
import { resolvePendingPrice, type PendingState } from "@/lib/pending-price-actions";
import { money, thDate } from "@/lib/format";

/** ราคาอัตโนมัติที่ระบบยังไม่บันทึก (เก็บใน price_pending โดย Job ราคา) */
export type Pending = {
  date: string; price?: number; value?: number; price_per_baht_965?: number; previous?: number | null; previous_date?: string | null;
  reason: string; source_reference?: string | null;
};

const REASON: Record<string, string> = {
  NEEDS_BASELINE: "ยังไม่มีราคาครั้งก่อนให้เทียบ (ครั้งแรก หรือเว้นไปเกิน 30 วัน) — ตรวจแล้วยืนยันเป็นราคาฐาน",
  DEVIATION_OVER_20PCT: "ต่างจากราคาครั้งก่อนเกิน 20% — อาจอ่านราคาผิดตัว / ผิดหน่วย หรือราคาเปลี่ยนจริง",
};

export default function PendingPrice({ kind, id, pending, currency, canResolve, paths }: {
  kind: "holding" | "gold"; id: string; pending: Pending; currency: string; canResolve: boolean; paths: string[];
}) {
  const [state, action, busy] = useActionState<PendingState, FormData>(resolvePendingPrice, {});
  const main = kind === "holding" ? pending.price : pending.value;
  const chg = pending.previous && main ? (main / Number(pending.previous) - 1) * 100 : null;
  if (state.ok) return <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{state.ok}</div>;
  return (
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
      <div className="font-medium text-amber-900">ราคาอัตโนมัติรอยืนยัน</div>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs text-amber-800">{kind === "holding" ? "ราคาที่ดึงได้" : "มูลค่าที่คำนวณได้"}</dt>
          <dd className="tabular-nums font-medium">{money(main, currency, kind === "holding" ? 4 : 2)} · {thDate(pending.date)}</dd></div>
        {kind === "gold" && pending.price_per_baht_965 != null && (
          <div><dt className="text-xs text-amber-800">ราคาทองต่อบาททองคำ (96.5%)</dt><dd className="tabular-nums">{money(pending.price_per_baht_965)}</dd></div>)}
        <div><dt className="text-xs text-amber-800">ครั้งก่อน</dt>
          <dd className="tabular-nums">{pending.previous != null ? `${money(pending.previous, currency, kind === "holding" ? 4 : 2)} · ${thDate(pending.previous_date ?? "")}` : "ไม่มี"}
            {chg != null && <span className={chg >= 0 ? " text-emerald-700" : " text-red-700"}> ({chg >= 0 ? "+" : ""}{chg.toFixed(2)}%)</span>}</dd></div>
        {pending.source_reference && <div><dt className="text-xs text-amber-800">ที่มา</dt><dd className="break-all text-xs">{pending.source_reference}</dd></div>}
      </dl>
      <p className="text-xs text-amber-800">{REASON[pending.reason] ?? pending.reason} · ระบบยังไม่ใช้ราคานี้คำนวณมูลค่า</p>
      {canResolve ? (
        <form action={action} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="paths" value={paths.join(",")} />
          <button name="op" value="confirm" disabled={busy} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? "กำลังบันทึก…" : "ยืนยันเป็นราคาฐาน"}</button>
          <button name="op" value="dismiss" disabled={busy} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">ไม่ใช้ราคานี้</button>
          <span className="text-xs text-slate-500">หรือบันทึกราคาจาก Statement เอง แล้วระบบจะใช้เป็นราคาฐาน</span>
          {state.error && <span className="w-full text-sm text-red-600">{state.error}</span>}
        </form>
      ) : <p className="text-xs text-slate-500">ADMIN / EDITOR เป็นผู้ยืนยัน</p>}
    </div>
  );
}
