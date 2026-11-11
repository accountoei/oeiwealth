"use client";

import Link from "next/link";
import { useState } from "react";
import { HOLDING_TYPE_LABEL, money, qty, thDate } from "@/lib/format";
import { batchValuations, type ActionState } from "./actions";
import { BatchSave, HiddenFilled, STICKY_BAR, useBatchSave } from "@/components/BatchSave";
import { inputNumber as n } from "@/lib/batch-entry";

export type UpdateRow = {
  id: string; pf: string; pfName: string; name: string; symbol: string | null; type: string; currency: string; qty: number;
  price: number | null; value: number | null; date: string | null;
  /** บัญชีเงินฝากในพอร์ต / มูลค่าก้อนเดียว = กรอกได้แค่มูลค่า · auto = ดึงราคาอัตโนมัติทุกวัน */
  cash: boolean; lump: boolean; auto: boolean;
};

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const filled = (s: string | undefined) => (s ?? "").trim() !== "";

/**
 * อัปเดตราคา / ยอดตาม Statement หลายพอร์ตพร้อมกัน (ตกลง 25 ต.ค. 2026) — ทำงานแบบปุ่ม "อัปเดตราคา / Statement" ของแต่ละพอร์ต
 *   ตัวกรองพอร์ต (ซ้าย) · วันที่เดียวทั้งชุด (ขวา) · ช่องว่าง = ไม่บันทึก · ยอดที่กรอกในพอร์ตที่ถูกตัวกรองซ่อนยังบันทึกด้วย
 */
export default function UpdateBatch({ rows, today, initialDate, minDate, canWrite }: { rows: UpdateRow[]; today: string; initialDate: string; minDate: string; canWrite: boolean }) {
  const [pf, setPf] = useState("");
  const [date, setDate] = useState(initialDate);
  const [price, setPrice] = useState<Record<string, string>>({});
  const [mv, setMv] = useState<Record<string, string>>({});
  // บันทึกแล้ว → ล้างช่องที่กรอก + โหลดราคาใหม่
  const { state, action, pending, confirm, dialog } = useBatchSave<ActionState>(batchValuations, () => { setPrice({}); setMv({}); });

  const pfList = [...new Map(rows.map((r) => [r.pf, r.pfName])).entries()];
  const shown = rows.filter((r) => !pf || r.pf === pf);
  // มูลค่าใหม่: มูลค่ารวมที่กรอก หรือ ราคา × จำนวนที่ถือ
  const newValue = (r: UpdateRow) => filled(mv[r.id]) ? n(mv[r.id]) : !r.cash && !r.lump && filled(price[r.id]) ? n(price[r.id]) * r.qty : null;
  const chosen = rows.filter((r) => filled(mv[r.id]) || (!r.cash && !r.lump && filled(price[r.id])));
  const hiddenChosen = chosen.filter((r) => !shown.includes(r)).length;
  const onSubmit = confirm(`บันทึกราคา / ยอดตาม Statement ${chosen.length} รายการ ณ วันที่ ${thDate(date)} ?\n${chosen.map((r) => `• ${r.pfName} · ${r.name}`).join("\n")}`);

  return (
    <>
    {dialog}
    <div className="space-y-3">
      <div className={`space-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm ${STICKY_BAR}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {pfList.length > 1 && (
            <label className="flex items-center gap-2">พอร์ต
              <select value={pf} onChange={(e) => setPf(e.target.value)} className={small}>
                <option value="">ทุกพอร์ต</option>
                {pfList.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
          )}
          <BatchSave canWrite={canWrite} action={action} onSubmit={onSubmit} fields={{ date, rows: JSON.stringify(chosen.map((r) => ({
              holding_id: r.id, mv: filled(mv[r.id]) ? mv[r.id] : undefined, price: !r.cash && !r.lump && filled(price[r.id]) ? price[r.id] : undefined }))) }}
            count={chosen.length} pending={pending} onClear={() => { setPrice({}); setMv({}); }} state={state}
            date={date} onDate={setDate} minDate={minDate} maxDate={today}
            note={<HiddenFilled count={hiddenChosen} label="รายการที่กรอกไว้ในพอร์ตอื่น" />}
            info={<>กรอกตาม Statement เฉพาะตัวที่มีราคาใหม่ (ช่องว่าง = ไม่บันทึก) · ใส่ราคาต่อหน่วย หรือมูลค่ารวม · บัญชีเงินฝากในพอร์ต / มูลค่าก้อนเดียว ใส่มูลค่า · ราคาจาก Statement ใช้แทนราคาอัตโนมัติของวันนั้น · สลับพอร์ตได้ ยอดที่กรอกไว้ยังอยู่และบันทึกพร้อมกัน</>} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {/* ทุกคอลัมน์ยกเว้นชื่อกว้างคงที่ → กรอกตัวเลขแล้วคอลัมน์ไม่ขยับ */}
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="min-w-[13rem] px-3 py-2">หลักทรัพย์ / บัญชี</th>
              <th className="w-28 px-3 text-right">จำนวนที่ถือ</th>
              <th className="w-44 px-3 text-right">ล่าสุด</th>
              <th className="w-32 px-3 text-right">ราคาต่อหน่วย</th>
              <th className="w-40 px-3 text-right">หรือ มูลค่ารวม</th>
              <th className="w-40 whitespace-nowrap px-3 text-right">มูลค่าใหม่</th>
              <th className="w-40 whitespace-nowrap px-3 text-right">ส่วนต่าง</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">ไม่มีหลักทรัพย์ที่ถืออยู่</td></tr>}
            {shown.map((r, i) => {
              const nv = newValue(r);
              const has = nv != null && !Number.isNaN(nv);
              const diff = has && r.value != null ? Math.round((nv - r.value) * 100) / 100 : null;
              const head = !pf && (i === 0 || shown[i - 1].pf !== r.pf);
              return [
                head && (
                  <tr key={`h-${r.pf}`} className="bg-slate-50/60">
                    <td colSpan={7} className="px-3 py-1.5 text-xs font-medium text-slate-700">
                      <Link href={`/investments/${r.pf}`} className="hover:underline">{r.pfName}</Link></td>
                  </tr>
                ),
                <tr key={r.id} className={has ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2">
                    <Link href={r.cash ? `/investments/${r.pf}/cash/${r.id}` : `/investments/${r.pf}/holding/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                    {r.auto && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">อัตโนมัติ</span>}
                    <div className="text-xs text-slate-500">{r.cash ? "บัญชีเงินฝากในพอร์ต" : HOLDING_TYPE_LABEL[r.type] ?? r.type}{r.symbol ? ` · ${r.symbol}` : ""} · {r.currency}</div>
                  </td>
                  <td className="px-3 text-right tabular-nums">{r.cash ? "-" : r.lump ? <span className="text-xs text-slate-400">ก้อนเดียว</span> : qty(r.qty)}</td>
                  <td className="whitespace-nowrap px-3 text-right tabular-nums">
                    {r.value == null ? "-" : money(r.value, r.currency)}
                    <div className="text-xs text-slate-400">{!r.cash && !r.lump && r.price != null ? `${money(r.price, undefined, 4)} · ` : ""}{r.date ? thDate(r.date) : "ยังไม่มีราคา"}</div>
                  </td>
                  <td className="px-3 text-right">
                    {r.cash || r.lump ? <span className="text-xs text-slate-400">—</span> : (
                      <input inputMode="decimal" value={price[r.id] ?? ""} disabled={!canWrite} aria-label={`ราคาต่อหน่วย ${r.name}`}
                        data-money="off"
                        onChange={(e) => setPrice({ ...price, [r.id]: e.target.value })} className={`w-28 text-right ${small}`} />
                    )}
                  </td>
                  <td className="px-3 text-right">
                    <input inputMode="decimal" value={mv[r.id] ?? ""} disabled={!canWrite} placeholder={r.cash ? "ยอดตาม Statement" : r.currency}
                      aria-label={`มูลค่ารวม ${r.name}`} onChange={(e) => setMv({ ...mv, [r.id]: e.target.value })} className={`w-36 text-right ${small}`} />
                  </td>
                  <td className="whitespace-nowrap px-3 text-right tabular-nums">{has ? money(nv, r.currency) : <span className="text-slate-400">-</span>}</td>
                  <td className={`whitespace-nowrap px-3 text-right tabular-nums ${diff == null ? "text-slate-400" : Math.abs(diff) < 0.005 ? "text-emerald-700" : diff > 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {diff == null ? "-" : Math.abs(diff) < 0.005 ? "เท่าเดิม" : `${diff > 0 ? "+" : ""}${money(diff, r.currency)}`}
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>

    </div>
    </>
  );
}
