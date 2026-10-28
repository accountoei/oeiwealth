"use client";

import { useActionState, useState } from "react";
import { savePropertyValuation, type ActionState } from "./actions";
import { money, numOrZero } from "@/lib/format";
import { partsSum, splitByArea, type ValuePart } from "./valueParts";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

export type DeedOpt = { id: string; label: string; area: number | null };
type Row = { key: string; type: ValuePart["type"]; deed_id?: string; label: string; value: string; source_movement_id?: string | null };

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * อัปเดตมูลค่า Property แยกตามโฉนด + อาคาร (ตกลง 28 ต.ค. 2026) — Net Worth ใช้ยอดรวม
 *   ใส่รายส่วน → ระบบรวมให้ · หรือใส่ยอดรวมแล้วกด "เฉลี่ยตามเนื้อที่" (หักอาคาร / อื่น ๆ ที่ใส่เองก่อน)
 *   ไม่ใส่รายส่วนเลย = มูลค่ารวมอย่างเดียว (เหมือนเดิม) · ตั้งต้นจากรายละเอียดของมูลค่าล่าสุด
 */
export default function ValuePartsForm({ assetId, currency, today, minDate, deeds, latest }: {
  assetId: string; currency: string; today: string; minDate: string; deeds: DeedOpt[];
  /** รายละเอียดของมูลค่าล่าสุด (ค่าตั้งต้นของแถว) */ latest: ValuePart[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(savePropertyValuation, {});
  const init = (): Row[] => [
    ...deeds.map((d) => {
      const p = latest.find((x) => x.type === "DEED" && x.deed_id === d.id);
      return { key: `d${d.id}`, type: "DEED" as const, deed_id: d.id, label: d.label, value: p ? fmt(p.value) : "" };
    }),
    ...latest.filter((x) => x.type !== "DEED").map((x, i) => ({ key: `x${i}`, type: x.type, label: x.label ?? "", value: fmt(x.value),
      source_movement_id: x.source_movement_id ?? null })),
  ];
  const [rows, setRows] = useState<Row[]>(init);
  const [total, setTotal] = useState("");
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.value.trim() !== "");
  const sum = partsSum(filled.map((r) => ({ value: numOrZero(r.value) })));
  const hasParts = filled.length > 0;
  const deedRows = rows.filter((r) => r.type === "DEED");
  const spread = () => {
    const others = partsSum(rows.filter((r) => r.type !== "DEED").map((r) => ({ value: numOrZero(r.value) })));
    const vals = splitByArea(numOrZero(total) - others, deedRows.map((r) => deeds.find((d) => d.id === r.deed_id)?.area ?? 0));
    setRows((rs) => rs.map((r) => { const i = deedRows.findIndex((x) => x.key === r.key); return i >= 0 ? { ...r, value: fmt(vals[i]) } : r; }));
  };
  const parts: ValuePart[] = filled.map((r) => ({ type: r.type, deed_id: r.deed_id ?? null, label: r.label || null, value: numOrZero(r.value),
    source_movement_id: r.source_movement_id ?? null }));

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="parts" value={JSON.stringify(parts)} />
      {hasParts && <input type="hidden" name="value" value={String(sum)} />}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">ส่วน</th><th className="w-48 text-right">มูลค่า ({currency})</th><th className="w-12"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="py-1.5 pr-2">
                  {r.type === "DEED" ? <>{r.label}{(() => { const a = deeds.find((d) => d.id === r.deed_id)?.area; return a ? <span className="text-xs text-slate-400"> · {a.toLocaleString("en-US")} ตร.ว.</span> : null; })()}</>
                    : <input value={r.label} onChange={(e) => set(r.key, { label: e.target.value })} aria-label="ชื่อส่วน"
                        placeholder={r.type === "BUILDING" ? "อาคาร เช่น บ้าน 3 ชั้น" : "อื่น ๆ"} className={`w-full ${input}`} />}
                  {r.type !== "DEED" && <span className="text-xs text-slate-400">{r.type === "BUILDING" ? "อาคาร / สิ่งปลูกสร้าง" : "อื่น ๆ"}</span>}
                </td>
                <td><input value={r.value} onChange={(e) => set(r.key, { value: e.target.value })} onBlur={(e) => e.target.value.trim() && set(r.key, { value: fmt(numOrZero(e.target.value)) })}
                  inputMode="decimal" data-plain aria-label="มูลค่า" className={`w-full text-right tabular-nums ${input}`} /></td>
                <td className="pl-2 text-right">{r.type !== "DEED" &&
                  <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-xs text-red-600 hover:underline">ลบ</button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-200">
            <tr><td className="py-2 font-medium">มูลค่ารวม (นับใน Net Worth)</td>
              <td className="text-right">{hasParts
                ? <span className="font-semibold tabular-nums">{money(sum, currency)}</span>
                : <input name="value" required value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" data-plain aria-label="มูลค่ารวม"
                    className={`w-full text-right tabular-nums ${input}`} />}</td><td></td></tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" onClick={() => setRows((rs) => [...rs, { key: `b${Date.now()}`, type: "BUILDING", label: "", value: "" }])}
          className="text-blue-700 hover:underline">+ เพิ่มอาคาร</button>
        <button type="button" onClick={() => setRows((rs) => [...rs, { key: `o${Date.now()}`, type: "OTHER", label: "", value: "" }])}
          className="text-blue-700 hover:underline">+ อื่น ๆ</button>
        {deedRows.length > 0 && (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500">ใส่ยอดรวม</span>
            <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" data-plain aria-label="ยอดรวมสำหรับเฉลี่ย"
              className={`w-40 text-right tabular-nums ${input}`} />
            <button type="button" onClick={spread} disabled={!numOrZero(total)} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
              เฉลี่ยให้โฉนดตามเนื้อที่</button>
          </span>
        )}
        {hasParts && <button type="button" onClick={() => setRows((rs) => rs.filter((r) => r.type === "DEED").map((r) => ({ ...r, value: "" })))}
          className="text-xs text-slate-500 underline">ล้างรายส่วน (ใส่ยอดรวมอย่างเดียว)</button>}
      </div>
      <p className="text-xs text-slate-500">ใส่ทีละส่วนแล้วระบบรวมให้ หรือใส่ยอดรวมแล้วกดเฉลี่ย (หักอาคาร / อื่น ๆ ที่ใส่เองก่อน ที่เหลือแบ่งให้โฉนดตามเนื้อที่ · แก้รายใบได้) · ไม่ใส่รายส่วน = มูลค่ารวมอย่างเดียว</p>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-sm">ณ วันที่<input name="valuation_date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block w-full ${input}`} /></label>
        <label className="text-sm">วิธีประเมิน
          <select name="valuation_method" defaultValue="USER_ESTIMATE" className={`mt-1 block w-full ${input}`}>
            <option value="USER_ESTIMATE">ประมาณเอง</option>
            <option value="APPRAISAL">ผู้ประเมิน / ธนาคาร / ราชการ</option>
            <option value="LATEST_TRANSACTION">ราคาซื้อขายล่าสุด</option>
          </select></label>
        <label className="text-sm md:col-span-2">หมายเหตุ<input name="notes" className={`mt-1 block w-full ${input}`} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกมูลค่า"}</button>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.ok && <p className="text-sm text-emerald-700">{state.ok}</p>}
      </div>
    </form>
  );
}
