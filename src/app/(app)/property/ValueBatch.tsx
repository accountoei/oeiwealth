"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { MARKET_CONFIDENCE_LABEL, addDays, diffText, marketStale, money, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import ModalButton from "@/components/ModalButton";
import MarketValuationForm, { type MarketValuation } from "./MarketValuationForm";
import { batchPropertyValues, type ActionState } from "./actions";

export type ValueRow = {
  id: string; name: string; typeLabel: string; currency: string; value: number | null; date: string | null;
  defaultUnit: string; areaSqWa: number | null; market: MarketValuation | null;
  /** อัตราเป็นบาท × สัดส่วนของสมาชิกที่เลือก → ยอดรวมท้ายตาราง */ factor: number;
};

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const n = (s: string) => Number(s.replace(/,/g, ""));
const filled = (s: string | undefined) => (s ?? "").trim() !== "";

/**
 * แท็บ อัปเดตมูลค่า (ตกลง 28 ต.ค. 2026) — มูลค่าใน Net Worth ของทุกทรัพย์สินในตารางเดียว + ราคาตลาด (อ้างอิง · ไม่นับใน Net Worth)
 *   กรอกมูลค่าใหม่เฉพาะแถวที่เปลี่ยน (ช่องว่าง = ไม่บันทึก) · วันที่ / วิธีเดียวทั้งชุด · ปุ่ม "ราคาตลาด" ของแต่ละแถวบันทึกแยก
 */
export default function ValueBatch({ rows, today, minDate, canWrite, shareNote }: {
  rows: ValueRow[]; today: string; minDate: string; canWrite: boolean; shareNote: string | null;
}) {
  const router = useRouter();
  const cf = useConfirmSubmit();
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState("USER_ESTIMATE");
  const [notes, setNotes] = useState("");
  const [nv, setNv] = useState<Record<string, string>>({});
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, form) => {
    const r = await batchPropertyValues(prev, form);
    if (r.ok) { setNv({}); setNotes(""); router.refresh(); }
    return r;
  }, {});

  const chosen = rows.filter((r) => filled(nv[r.id]));
  const onSubmit = cf.guard(`บันทึกมูลค่าใหม่ ${chosen.length} รายการ ณ ${thDate(date)} ?\n${chosen.map((r) => `• ${r.name}`).join("\n")}`, { okLabel: "ยืนยันบันทึก" });
  // ยอดรวม (บาท · ตามสัดส่วนของสมาชิกที่เลือก) · ราคาตลาดรวมเฉพาะรายการที่ประเมินแล้ว
  const nwTotal = rows.reduce((t, r) => t + Number(r.value ?? 0) * r.factor, 0);
  const valued = rows.filter((r) => r.market);
  const mkTotal = valued.reduce((t, r) => t + Number(r.market!.market_value) * r.factor, 0);
  const nwOfValued = valued.reduce((t, r) => t + Number(r.value ?? 0) * r.factor, 0);
  const netTotal = valued.reduce((t, r) => t + Number(r.market!.net_before_debt) * r.factor, 0);

  return (
    <>
    {cf.dialog}
    {/* ฟอร์มบันทึกอยู่ล่างตาราง (ตารางมีฟอร์มราคาตลาดใน pop up ของแต่ละแถว → ห้ามซ้อนฟอร์ม) */}
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">วิธี
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={small}>
              <option value="USER_ESTIMATE">ประมาณเอง</option>
              <option value="APPRAISAL">ราคาประเมิน (ราชการ / ธนาคาร)</option>
            </select></label>
          <label className="flex min-w-[12rem] flex-1 items-center gap-2">หมายเหตุ
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="เช่น ราคาประเมินราชการรอบใหม่" className={`w-full ${small}`} /></label>
          <label className="ml-auto flex items-center gap-2">มูลค่า ณ วันที่
            <input type="date" value={date} min={minDate || undefined} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={small} />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          มูลค่าใหม่ = มูลค่าที่นับใน Net Worth (กรอกเฉพาะรายการที่เปลี่ยน · ช่องว่าง = ไม่บันทึก) · ราคาตลาดเป็นข้อมูลอ้างอิงเท่านั้น ไม่นับใน Net Worth
          บันทึกที่ปุ่ม &ldquo;ราคาตลาด&rdquo; ของแต่ละแถว{shareNote && ` · ${shareNote}`}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="min-w-[12rem] px-3 py-2">ทรัพย์สิน</th>
              <th className="w-40 px-3 text-right">มูลค่าใน Net Worth</th>
              <th className="w-40 px-3 text-right">มูลค่าใหม่</th>
              <th className="w-44 px-3 text-right">ราคาตลาด (อ้างอิง)</th>
              <th className="w-44 px-3 text-right">ส่วนต่างจาก Net Worth</th>
              <th className="w-40 px-3 text-right">ถ้าขายได้สุทธิ</th>
              <th className="w-28 px-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">ไม่มีทรัพย์สินที่ถืออยู่</td></tr>}
            {rows.map((r) => {
              const m = r.market;
              const v = Number(r.value ?? 0);
              const nwStale = !r.date || r.date < addDays(today, -365);
              return (
                <tr key={r.id} className={`align-top ${filled(nv[r.id]) ? "bg-blue-50/40" : ""}`}>
                  <td className="px-3 py-2">
                    <Link href={`/property/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                    <div className="text-xs text-slate-500">{r.typeLabel} · {r.currency}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {r.value == null ? "-" : money(r.value, r.currency, 0)}
                    <div className={`text-xs ${nwStale ? "text-amber-700" : "text-slate-400"}`}>{r.date ? thDate(r.date) : "ยังไม่มีมูลค่า"}{nwStale && r.date && " · เกิน 12 เดือน"}</div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input inputMode="decimal" value={nv[r.id] ?? ""} disabled={!canWrite} placeholder={r.currency} aria-label={`มูลค่าใหม่ ${r.name}`}
                      onChange={(e) => setNv({ ...nv, [r.id]: e.target.value })} className={`w-36 text-right ${small}`} />
                    {filled(nv[r.id]) && r.value != null && !Number.isNaN(n(nv[r.id])) && (
                      <div className={`text-xs tabular-nums ${n(nv[r.id]) >= v ? "text-emerald-700" : "text-red-700"}`}>{diffText(n(nv[r.id]) - v, v)}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {!m ? <span className="text-xs text-slate-400">ยังไม่ประเมิน</span> : (<>
                      {money(m.market_value, r.currency, 0)}
                      <div className={`text-xs ${marketStale(m.valuation_date, today) ? "text-amber-700" : "text-slate-400"}`}>
                        {thDate(m.valuation_date)}{m.confidence && ` · ${MARKET_CONFIDENCE_LABEL[m.confidence]}`}{marketStale(m.valuation_date, today) && " · เกิน 12 เดือน"}</div>
                    </>)}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums ${!m ? "text-slate-400" : Number(m.market_value) >= v ? "text-emerald-700" : "text-red-700"}`}>
                    {m && r.value != null ? diffText(Number(m.market_value) - v, v) : "-"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{m ? money(m.net_before_debt, r.currency, 0) : <span className="text-slate-400">-</span>}
                    {m && Number(m.selling_cost) > 0 && <div className="text-xs text-slate-400">หักค่าใช้จ่ายขาย {money(m.selling_cost, undefined, 0)}</div>}</td>
                  <td className="px-3 py-2 text-right">
                    {canWrite && (
                      <ModalButton label="ราคาตลาด" title={`ประเมินราคาตลาด · ${r.name}`} size="lg">
                        <MarketValuationForm assetId={r.id} currency={r.currency} today={today} defaultUnit={r.defaultUnit} areaSqWa={r.areaSqWa} last={m} />
                      </ModalButton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
              <tr className="align-top">
                <td className="px-3 py-2">รวม (THB)</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(nwTotal, "THB", 0)}</td>
                <td></td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{valued.length ? money(mkTotal, "THB", 0) : "-"}
                  {valued.length < rows.length && <div className="text-xs font-normal text-amber-700">ยังไม่ประเมิน {rows.length - valued.length} รายการ</div>}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums ${mkTotal >= nwOfValued ? "text-emerald-700" : "text-red-700"}`}>
                  {valued.length ? diffText(mkTotal - nwOfValued, nwOfValued) : "-"}
                  {valued.length > 0 && valued.length < rows.length && <div className="font-normal text-slate-400">เทียบเฉพาะ {valued.length} รายการที่ประเมินแล้ว</div>}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{valued.length ? money(netTotal, "THB", 0) : "-"}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {canWrite && (
        <form action={action} onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="valuation_method" value={method} />
          <input type="hidden" name="notes" value={notes} />
          <input type="hidden" name="rows" value={JSON.stringify(chosen.map((r) => ({ asset_id: r.id, value: nv[r.id] })))} />
          <button disabled={pending || chosen.length === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกมูลค่า ${chosen.length} รายการ ณ ${thDate(date)}`}
          </button>
          {chosen.length > 0 && !pending && (
            <button type="button" onClick={() => setNv({})} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>
          )}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
        </form>
      )}
    </div>
    </>
  );
}

