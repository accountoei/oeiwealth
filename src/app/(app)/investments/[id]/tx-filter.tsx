"use client";

import { useState } from "react";

type Meta = { m: string; type: string; h: string[] };

/**
 * ตัวกรองรายการในเบราว์เซอร์ (ไม่โหลดหน้าใหม่) — ซ่อนแถว <tr data-tx> ที่ไม่ตรงด้วย CSS
 * แถวต้องมี data-m (YYYY-MM) · data-type · data-h (id หลักทรัพย์ / บัญชีเงินสด คั่นด้วยช่องว่าง)
 */
export default function TxFilter({ months, types, holdings, meta, initial }: {
  months: { value: string; label: string }[]; types: [string, string][]; holdings: { id: string; name: string }[];
  meta: Meta[]; initial: { m: string; type: string; h: string };
}) {
  const [m, setM] = useState(initial.m);
  const [type, setType] = useState(initial.type);
  const [h, setH] = useState(initial.h);
  const sync = (k: string, v: string) => {
    try {
      const u = new URL(window.location.href);
      if (v) u.searchParams.set(k, v); else u.searchParams.delete(k);
      window.history.replaceState(window.history.state, "", u);
    } catch { /* แค่ URL ไม่เปลี่ยน */ }
  };
  const count = meta.filter((x) => (m === "all" || x.m === m) && (!type || x.type === type) && (!h || x.h.includes(h))).length;
  const esc = (s: string) => s.replace(/["\\]/g, "");
  const conds = [
    m !== "all" ? `:not([data-m="${esc(m)}"])` : "",
    type ? `:not([data-type="${esc(type)}"])` : "",
    h ? `:not([data-h~="${esc(h)}"])` : "",
  ].filter(Boolean);
  const css = conds.map((c) => `tr[data-tx]${c}{display:none}`).join("");
  const sel = "mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm";
  return (
    <div className="mb-3">
      {css && <style>{css}</style>}
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="text-xs text-slate-600">เดือน
          <select value={m} onChange={(e) => { setM(e.target.value); sync("m", e.target.value); }} className={sel}>
            {months.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">ประเภท
          <select value={type} onChange={(e) => { setType(e.target.value); sync("type", e.target.value); }} className={sel}>
            <option value="">ทุกประเภท</option>
            {types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">หลักทรัพย์ / บัญชี
          <select value={h} onChange={(e) => { setH(e.target.value); sync("h", e.target.value); }} className={`${sel} max-w-xs`}>
            <option value="">ทั้งหมด</option>
            {holdings.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        {(type || h || m !== initial.m) && (
          <button type="button" onClick={() => { setM(initial.m); setType(""); setH(""); sync("m", ""); sync("type", ""); sync("h", ""); }}
            className="text-xs text-slate-500 underline">ล้างตัวกรอง</button>
        )}
        <span className="ml-auto text-xs text-slate-500">{count} รายการ</span>
      </div>
      {count === 0 && <p className="mt-4 text-center text-sm text-slate-500">ไม่มีรายการตามที่เลือก</p>}
    </div>
  );
}
