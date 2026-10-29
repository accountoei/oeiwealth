"use client";

import { useActionState, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { setOwnership, type RecState } from "@/lib/records";
import Flash from "@/components/Flash";

/** แก้สัดส่วนเจ้าของ (asset) หรือผู้รับผิดชอบหนี้ (liability) */
export default function OwnershipEditor({ kind, id, persons, current, paths, today, startOpen = false, unit = "percent", totalShares }: {
  kind: "asset" | "liability"; id: string; persons: { id: string; name: string }[];
  current: { person_id: string; percent: number; shares?: number | null; cost?: number | null }[]; paths: string[]; today: string; startOpen?: boolean;
  /** ธุรกิจ: แก้เป็นจำนวนหุ้น (totalShares = หุ้นทั้งหมดของบริษัท) */
  unit?: "percent" | "shares"; totalShares?: number | null;
}) {
  const bySh = unit === "shares";
  const { open, setOpen, present, activeCls } = useActionSlot(startOpen);
  const [mode, setMode] = useState("CORRECT");
  const [shares, setShares] = useState<Record<string, string>>(
    Object.fromEntries(current.map((c) => [c.person_id, bySh ? (c.shares != null ? String(Number(c.shares)) : "") : String(c.percent)])));
  const [costs, setCosts] = useState<Record<string, string>>(
    Object.fromEntries(current.map((c) => [c.person_id, c.cost != null ? String(Number(c.cost)) : ""])));
  const [state, action, pending] = useActionState<RecState, FormData>(setOwnership, {});
  const total = Object.values(shares).reduce((s, v) => s + (Number(String(v).replace(/,/g, "")) || 0), 0);
  const over = bySh ? !!totalShares && total > totalShares : total > 100;
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls("text-xs text-slate-700 underline")}>{bySh ? "แก้จำนวนหุ้น" : "แก้สัดส่วน"}</button>;
  if (!open) return trigger;
  return present(trigger, (
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
      <div className={`grid gap-2 ${bySh ? "" : "sm:grid-cols-2"}`}>
        {persons.map((p) => (
          <label key={p.id} className="flex items-center gap-2">
            <span className="flex-1">{p.name}</span>
            <input name={bySh ? `shares_${p.id}` : `owner_${p.id}`} inputMode="decimal" data-money={bySh ? "off" : undefined} value={shares[p.id] ?? ""} placeholder="0"
              onChange={(e) => setShares({ ...shares, [p.id]: e.target.value })} className={`${bySh ? "w-28" : "w-20"} rounded-md border border-slate-300 px-2 py-1 text-right`} />
            <span className="text-xs text-slate-500">{bySh ? "หุ้น" : "%"}</span>
            {bySh && <>
              <input name={`cost_${p.id}`} inputMode="decimal" value={costs[p.id] ?? ""} placeholder="ทุน/หุ้น" title="ราคาทุนต่อหุ้น (ว่าง = เฉลี่ยจากเงินลงทุน)"
                onChange={(e) => setCosts({ ...costs, [p.id]: e.target.value })} className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right" />
              <span className="text-xs text-slate-500">บาท/หุ้น</span>
            </>}
          </label>
        ))}
      </div>
      {bySh ? (
        <div className={`text-xs ${over ? "text-red-600" : "text-slate-600"}`}>
          ครอบครัวถือรวม {total.toLocaleString("th-TH")} หุ้น
          {totalShares ? ` · ${((total * 100) / totalShares).toLocaleString("th-TH", { maximumFractionDigits: 2 })}% ของบริษัท` : ""}
          {over && " · เกินจำนวนหุ้นทั้งหมด"} · ใส่ตาม บอจ.5 ฉบับล่าสุด (ไม่ต้องใส่ผู้ถือหุ้นนอกครอบครัว) · ราคาทุนต่อหุ้นไม่บังคับ (ว่าง = เฉลี่ยจากเงินลงทุน)
        </div>
      ) : (
        <div className={`text-xs ${total === 100 ? "text-emerald-700" : total > 100 ? "text-red-600" : "text-amber-700"}`}>
          รวม {total}%{total < 100 && ` · ส่วนที่เหลือ ${100 - total}% จะเป็น "ยังไม่ระบุเจ้าของ"`}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button disabled={pending || over} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">{pending ? "…" : "บันทึก"}</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-xs text-slate-500">ปิด</button>
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="text-xs text-emerald-700" />
      </div>
    </form>
  ));
}
