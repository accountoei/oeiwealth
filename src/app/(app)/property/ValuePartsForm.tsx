"use client";

import { useActionState, useState } from "react";
import { savePropertyValuation, type ActionState } from "./actions";
import { diffText, money, numOrZero } from "@/lib/format";
import { partsSum, splitByArea, type ValuePart } from "./valueParts";
import Flash from "@/components/Flash";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";

export type DeedOpt = { id: string; label: string; area: number | null; type: "LAND" | "BUILDING" | "OTHER";
  /** ราคาที่ได้มาของแถว (ต้นทุน + จ่ายเพิ่มที่เพิ่มมูลค่า) · null = ไม่ได้แยกรายแถว */ cost?: number | null };
type Row = { key: string; type: ValuePart["type"]; deed_id?: string; label: string; area: number; cost: number | null;
  /** มูลค่าในครั้งล่าสุด · null = ไม่รู้ */ last: number | null; value: string; source_movement_id?: string | null;
  /** last เป็นค่าประมาณ (ครั้งล่าสุดไม่ได้แยกรายแถว → แบ่งยอดรวมตามสัดส่วนราคาที่ได้มา) */ est?: boolean };

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (d: number, base: number) => diffText(d, base);

/**
 * ปรับมูลค่าของ Property รายส่วนประกอบ (ตกลง 28–29 ต.ค. 2026) — Net Worth ใช้ยอดรวม
 *   แถว = ส่วนประกอบทุกแถว · คอลัมน์ ราคาที่ได้มา · มูลค่าล่าสุด · มูลค่าใหม่ · ผลต่างจากราคาที่ได้มา (บาท / %)
 *   มูลค่าใหม่ว่าง = ใช้มูลค่าล่าสุด · ใส่ยอดรวม → หักสิ่งปลูกสร้าง (ยอดใหม่ หรือยอดล่าสุด) แล้วแบ่งที่เหลือให้ที่ดินตามเนื้อที่ทันที (ไม่ต้องกดปุ่ม)
 *   มูลค่าเดิมที่ไม่ได้ผูกแถว แต่ชื่อตรงกับแถวสิ่งปลูกสร้าง → รวมเข้าแถวนั้น (ข้อมูลจากบั๊กก่อน 29 ต.ค. 2026)
 */
export default function ValuePartsForm({ assetId, currency, today, minDate, deeds, latest, acqTotal = null, currentValue = null }: {
  assetId: string; currency: string; today: string; minDate: string; deeds: DeedOpt[];
  /** รายละเอียดของมูลค่าล่าสุด (ค่าตั้งต้นของแถว) */ latest: ValuePart[];
  /** ราคาที่ได้มารวม (ใช้เมื่อไม่ได้แยกรายแถว) */ acqTotal?: number | null; /** มูลค่าล่าสุดรวม */ currentValue?: number | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(savePropertyValuation, {});
  const hasLatest = latest.length > 0;
  const ownerOf = (x: ValuePart) => x.deed_id && deeds.some((d) => d.id === x.deed_id) ? x.deed_id
    : deeds.find((d) => d.type !== "LAND" && x.type !== "DEED" && !!x.label && d.label === x.label)?.id ?? null;
  // ครั้งล่าสุดเป็นยอดรวมอย่างเดียว → ประมาณรายแถวตามสัดส่วนราคาที่ได้มา (ตกลง 29 ต.ค. 2026) · ไม่มีราคาที่ได้มารายแถว = ไม่รู้
  const est = !hasLatest && currentValue != null && deeds.some((d) => (d.cost ?? 0) > 0)
    ? splitByArea(currentValue, deeds.map((d) => d.cost ?? 0)) : null;
  const init = (): Row[] => [
    ...deeds.map((d, i) => {
      const own = latest.filter((x) => ownerOf(x) === d.id);
      return { key: `d${d.id}`, type: d.type === "LAND" ? "DEED" as const : d.type, deed_id: d.id, label: d.label, area: d.area ?? 0,
        cost: d.cost ?? null, last: hasLatest ? round2(own.reduce((t, x) => t + x.value, 0)) : est ? est[i] : null, est: !!est, value: "" };
    }),
    // รายส่วนเดิมที่ยังไม่ผูกกับแถวใด (ถ้ามี) → คงไว้ให้แก้ / ลบได้
    ...latest.filter((x) => !ownerOf(x)).map((x, i) => ({ key: `x${i}`, type: x.type, label: x.label ?? "", area: 0, cost: null, last: x.value,
      value: "", source_movement_id: x.source_movement_id ?? null })),
  ];
  const [rows, setRows] = useState<Row[]>(init);
  const [total, setTotal] = useState("");
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const typed = (r: Row) => r.value.trim() !== "";
  const totalTyped = total.trim() !== "";
  // แถวที่รับส่วนที่เหลือของยอดรวม: ที่ดิน (แบ่งตามเนื้อที่) · ไม่มีที่ดิน → แถวเดียวที่ไม่ได้ใส่ยอด
  const landRows = rows.filter((r) => r.type === "DEED");
  const lands = landRows.length > 0 ? landRows : rows.filter((r) => !typed(r)).length === 1 ? rows.filter((r) => !typed(r)) : [];
  const byTotal = totalTyped && lands.length > 0;
  // มูลค่าใหม่ของแต่ละแถว: ใส่เอง > (ใส่ยอดรวม → ที่ดินเฉลี่ยตามเนื้อที่) > มูลค่าล่าสุด
  const eff: Record<string, number | null> = {};
  for (const r of rows) eff[r.key] = typed(r) ? numOrZero(r.value) : r.last;
  if (byTotal) {
    const others = round2(rows.filter((r) => !lands.includes(r)).reduce((t, r) => t + (eff[r.key] ?? 0), 0));
    const share = splitByArea(round2(numOrZero(total) - others), lands.map((r) => r.area));
    lands.forEach((r, i) => { eff[r.key] = share[i]; });
  }
  const touched = totalTyped || rows.some(typed);
  // ใส่ยอดรวมแต่แบ่งให้แถวไม่ได้ (ไม่มีที่ดิน และไม่ได้ใส่หลายแถว) → ยอดรวมอย่างเดียว ไม่ส่งรายแถว
  const complete = rows.length > 0 && rows.every((r) => eff[r.key] != null) && !(totalTyped && !byTotal && rows.some((r) => !typed(r)));
  // ส่งรายแถวเมื่อทุกแถวมียอด · ไม่ครบ (ครั้งก่อนเป็นยอดรวม และใส่ไม่ครบ) = ยอดรวมอย่างเดียว
  const parts: ValuePart[] = complete ? rows.map((r) => ({ type: r.type, deed_id: r.deed_id ?? null, label: r.label || null, value: eff[r.key]!,
    source_movement_id: r.source_movement_id ?? null })) : [];
  const newTotal = complete ? partsSum(parts) : totalTyped ? numOrZero(total) : null;
  const mismatch = totalTyped && complete && !byTotal && Math.abs(numOrZero(total) - (newTotal ?? 0)) > 0.005;
  const costTotal = rows.some((r) => r.cost != null) ? round2(rows.reduce((t, r) => t + (r.cost ?? 0), 0)) : acqTotal;
  const negLand = byTotal && lands.some((r) => (eff[r.key] ?? 0) < 0);
  const diffCell = (v: number | null, cost: number | null) => (v == null || !cost ? <td className="text-right text-slate-400">-</td> : (
    <td className={`text-right text-xs tabular-nums ${v >= cost ? "text-emerald-700" : "text-red-600"}`}>{pct(v - cost, cost)}</td>));

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="parts" value={JSON.stringify(parts)} />
      {newTotal != null && <input type="hidden" name="value" value={String(newTotal)} />}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1">ส่วนประกอบ</th><th className="w-32 text-right">ราคาที่ได้มา</th><th className="w-32 text-right">มูลค่าล่าสุด</th>
              <th className="w-40 pl-2 text-right">มูลค่าใหม่ ({currency})</th><th className="w-40 text-right">ผลต่างจากราคาที่ได้มา</th><th className="w-10"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const auto = byTotal && lands.includes(r);
              return (
                <tr key={r.key}>
                  <td className="py-1.5 pr-2">
                    {r.deed_id ? <>{r.label}{r.area > 0 && <span className="text-xs text-slate-400"> · {r.area.toLocaleString("en-US")} ตร.ว.</span>}</>
                      : <input value={r.label} onChange={(e) => set(r.key, { label: e.target.value })} aria-label="ชื่อส่วน" className={`w-full ${input}`} />}
                    {r.type !== "DEED" && <span className="block text-xs text-slate-400">สิ่งปลูกสร้าง{!r.deed_id && " · ยังไม่ผูกแถว"}</span>}
                  </td>
                  <td className="text-right tabular-nums text-slate-600">{r.cost != null ? money(r.cost, undefined, 0) : "-"}</td>
                  <td className={`text-right tabular-nums ${r.est ? "italic text-slate-400" : "text-slate-600"}`}
                    title={r.est ? "ประมาณจากสัดส่วนราคาที่ได้มา (ครั้งล่าสุดบันทึกเป็นยอดรวมอย่างเดียว)" : undefined}>{r.last != null ? money(r.last, undefined, 0) : "-"}</td>
                  <td className="pl-2">{auto
                    ? <div className="px-3 py-2 text-right tabular-nums text-blue-700">{money(eff[r.key], undefined, 2)}</div>
                    : <input value={r.value} onChange={(e) => set(r.key, { value: e.target.value })} inputMode="decimal" aria-label="มูลค่าใหม่"
                        placeholder={r.last != null ? money(r.last, undefined, 2) : ""} className={`w-full ${input}`} />}</td>
                  {diffCell(eff[r.key], r.cost)}
                  <td className="pl-2 text-right">{!r.deed_id &&
                    <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-xs text-red-600 hover:underline">ลบ</button>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-slate-200">
            <tr className="align-top">
              <td className="py-2 font-medium">มูลค่ารวม (นับใน Net Worth)</td>
              <td className="py-2 text-right tabular-nums">{costTotal != null ? money(costTotal, undefined, 0) : "-"}</td>
              <td className="py-2 text-right tabular-nums">{currentValue != null ? money(currentValue, undefined, 0) : "-"}</td>
              <td className="pl-2 pt-1">
                <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" aria-label="มูลค่ารวมใหม่" required={!touched || !complete}
                  placeholder={complete && !byTotal ? money(newTotal, undefined, 2) : "ใส่ยอดรวม"} className={`w-full font-semibold ${input}`} />
              </td>
              {diffCell(newTotal, costTotal)}
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-slate-500">ใส่มูลค่าใหม่รายแถว (ว่าง = เท่ามูลค่าล่าสุด) แล้วระบบรวมให้ · หรือใส่ยอดรวม → หักสิ่งปลูกสร้าง (ยอดใหม่ที่ใส่ หรือยอดล่าสุด) ที่เหลือแบ่งให้ที่ดินตามเนื้อที่ทันที (ตัวเลขสีน้ำเงิน)
        · ผลต่าง = มูลค่าใหม่ − ราคาที่ได้มา (% ของราคาที่ได้มา)</p>
      {rows.some((r) => r.est) && <p className="text-xs text-slate-500"><span className="italic text-slate-400">ตัวเลขเอียงสีเทา</span> = มูลค่าล่าสุดรายแถวโดยประมาณ (ครั้งล่าสุดบันทึกเป็นยอดรวม จึงแบ่งตามสัดส่วนราคาที่ได้มา) · บันทึกครั้งนี้แล้วจะเก็บตัวเลขรายแถวจริง</p>}
      {mismatch && <p className="text-sm text-amber-700">ยอดรวมที่ใส่ ({money(numOrZero(total), undefined, 2)}) ไม่เท่าผลรวมรายแถว ({money(newTotal, undefined, 2)}) · ระบบจะใช้ผลรวมรายแถว — แก้ยอดรวมหรือล้างช่องยอดรวม</p>}
      {negLand && <p className="text-sm text-amber-700">ยอดรวมน้อยกว่ามูลค่าสิ่งปลูกสร้าง · ที่ดินติดลบ — ใส่มูลค่าสิ่งปลูกสร้างใหม่ หรือแก้ยอดรวม</p>}
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
        <button disabled={pending || negLand || mismatch || (!touched && !totalTyped)} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกมูลค่า"}</button>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <Flash on={state} as="p" className="text-sm text-emerald-700" />
      </div>
    </form>
  );
}
