"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { money, thDate } from "@/lib/format";
import { batchInterest, type BatchState } from "./actions";
import { useOnMainTab } from "../../income-expenses/tabs";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { RecordedLines, type Recorded } from "@/lib/recorded-edit";

export type InterestRow = {
  id: string; name: string; bank: string; currency: string; type: string;
  rate: number | null; maturity: string | null; received: number;
  /** ยอดคาดว่าจะได้รับ (ก่อนภาษี) — เฉพาะเงินฝากประจำที่ครบกำหนดในเดือนที่เลือก · อื่น ๆ = null */
  expected: number | null;
  /** ดอกเบี้ยที่รับแล้วในเดือน (ทีละครั้ง · กดเพื่อแก้ / ลบ) */
  edits?: Recorded[];
};

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const n = (s: string) => Number(s.replace(/,/g, ""));
const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TAX_RATE = 0.15;

/**
 * รับดอกเบี้ยหลายบัญชีพร้อมกัน: เลือกวันที่รับ → กรอกดอกเบี้ยก่อนภาษี (+ ภาษีหัก ณ ที่จ่าย) เฉพาะบัญชีที่ได้ → บันทึกครั้งเดียว
 *   ช่องว่าง = ไม่บันทึก · บัญชีไหนผิด = ไม่บันทึกเลยสักบัญชี · บัญชีที่อัปเดตยอดไปแล้ว ก้อนรอแยกลดลงเอง (ไม่นับซ้ำ)
 */
export default function InterestBatch({ rows, defaultDate, today, minDate, monthLabel, canWrite }: {
  rows: InterestRow[]; defaultDate: string; today: string; minDate: string; monthLabel: string; canWrite: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [tax, setTax] = useState<Record<string, string>>({});
  const [bank, setBank] = useState("");
  useOnMainTab(() => setBank(""));
  const bankList = [...new Set(rows.map((r) => r.bank))].sort((a, b) => a.localeCompare(b, "th"));
  const shown = bank ? rows.filter((r) => r.bank === bank) : rows;
  const [state, action, pending] = useActionState<BatchState, FormData>(batchInterest, {});
  const cf = useConfirmSubmit();
  useEffect(() => { if (state.ok) { setVals({}); setTax({}); router.refresh(); } }, [state, router]);

  const chosen = rows.filter((r) => (vals[r.id] ?? "").trim() !== "");
  const hiddenChosen = chosen.filter((r) => !shown.includes(r)).length;
  const net = (r: InterestRow) => n(vals[r.id] ?? "") - (tax[r.id]?.trim() ? n(tax[r.id]) : 0);
  const payload = chosen.map((r) => ({ asset_id: r.id, amount: vals[r.id], tax: tax[r.id] ?? "" }));
  const onSubmit = cf.guard(`บันทึกรับดอกเบี้ย ${chosen.length} บัญชี วันที่ ${thDate(date)} ?\n${chosen.map((r) => `• ${r.name} ${vals[r.id]}${tax[r.id]?.trim() ? ` (ภาษี ${tax[r.id]})` : ""}`).join("\n")}`,
    { okLabel: "ยืนยันบันทึก" });
  // กรอกตามยอดคาดว่าจะได้รับ (แถวที่แสดง ยังว่าง มียอดคาดการณ์) · แบบแท็บบันทึกรับผลตอบแทนของ Investments
  const fillable = shown.filter((r) => r.expected != null && !(vals[r.id] ?? "").trim());
  const fillAll = () => setVals({ ...vals, ...Object.fromEntries(fillable.map((r) => [r.id, fmt(r.expected!)])) });
  const taxAll = () => setTax({ ...tax, ...Object.fromEntries(chosen.filter((r) => !Number.isNaN(n(vals[r.id]))).map((r) => [r.id, fmt(Math.round(n(vals[r.id]) * TAX_RATE * 100) / 100)])) });

  return (
    <>
    {cf.dialog}
    <form action={action} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {bankList.length > 1 && (
              <label className="flex items-center gap-2">ธนาคาร
                <select value={bank} onChange={(e) => setBank(e.target.value)} className={small}>
                  <option value="">ทุกธนาคาร</option>
                  {bankList.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
            )}
            {canWrite && fillable.length > 0 && <button type="button" onClick={fillAll} className="text-sm text-blue-700 hover:underline">กรอกตามยอดคาดว่าจะได้รับ ({fillable.length})</button>}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {canWrite && chosen.length > 0 && (
              <button type="button" onClick={taxAll} className="text-sm text-blue-700 hover:underline">คิดภาษี 15% ทุกแถวที่กรอก</button>
            )}
            <label className="flex items-center gap-2">วันที่รับ
              <input type="date" value={date} min={minDate || undefined} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={small} />
            </label>
          </div>
        </div>
        <p className="text-xs text-slate-500">กรอกดอกเบี้ยก่อนหักภาษีเฉพาะบัญชีที่ได้รับ (ช่องว่าง = ไม่บันทึก) · ภาษีหัก ณ ที่จ่ายใส่เองหรือกด &ldquo;คิดภาษี 15%&rdquo; · ยอดเข้าบัญชีสุทธิ = ดอกเบี้ยก่อนภาษี − ภาษีหัก ณ ที่จ่าย
          · ยอดคาดว่าจะได้รับ = เฉพาะเงินฝากประจำที่ครบกำหนดเดือนนี้ (เงินต้น × อัตรา × วันฝาก ÷ 365 · ประมาณการ)
          · ถ้าอัปเดตยอดคงเหลือไปแล้ว ก้อน &ldquo;รอแยกรายละเอียด&rdquo; จะลดลงเองตามดอกเบี้ยที่บันทึก</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {/* คอลัมน์เรียงแบบเดียวกับแท็บ "บันทึกรับผลตอบแทน" ของ Investments (ตกลง 28 ต.ค. 2026) · ทุกคอลัมน์ยกเว้นชื่อกว้างคงที่ (กรอกแล้วไม่ขยับ) */}
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="min-w-[13rem] px-3 py-2">บัญชี</th><th className="w-32 px-3">วันครบกำหนด</th>
              <th className="w-40 px-3 text-right">ยอดคาดว่าจะได้รับ</th>
              <th className="w-40 px-3 text-right">ดอกเบี้ยก่อนภาษี</th><th className="w-36 px-3 text-right">ภาษีหัก ณ ที่จ่าย</th><th className="w-44 whitespace-nowrap px-3 text-right">ยอดเข้าบัญชีสุทธิ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">ไม่มีบัญชีที่ใช้งานอยู่</td></tr>}
            {shown.map((r) => {
              const v = vals[r.id] ?? "";
              const has = v.trim() !== "" && !Number.isNaN(n(v));
              const dueSoon = r.maturity && r.maturity.slice(0, 7) === date.slice(0, 7);
              return (
                <tr key={r.id} className={has ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2">
                    <Link href={`/financial/cash/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                    <div className="text-xs text-slate-500">{r.bank} · {r.type} · {r.currency}{r.rate != null && ` · อัตรา ${r.rate.toFixed(2)}%`}</div>
                  </td>
                  <td className="whitespace-nowrap px-3">{r.maturity ? <span className={dueSoon ? "text-amber-700" : ""}>{thDate(r.maturity)}</span> : <span className="text-slate-400">-</span>}</td>
                  <td className="whitespace-nowrap px-3 text-right tabular-nums">{r.expected != null ? money(r.expected, r.currency) : <span className="text-slate-400">-</span>}
                    {r.edits?.length ? <RecordedLines items={r.edits} />
                      : r.received > 0 && <div className="text-xs text-emerald-700">รับแล้ว {monthLabel} {money(r.received, r.currency)}</div>}</td>
                  <td className="px-3 text-right">
                    <input inputMode="decimal" value={v} disabled={!canWrite} placeholder={r.currency} aria-label={`ดอกเบี้ย ${r.name}`}
                      onChange={(e) => setVals({ ...vals, [r.id]: e.target.value })} className={`w-32 text-right ${small}`} />
                  </td>
                  <td className="px-3 text-right">
                    <input inputMode="decimal" value={tax[r.id] ?? ""} disabled={!canWrite || !has} aria-label={`ภาษี ${r.name}`}
                      onChange={(e) => setTax({ ...tax, [r.id]: e.target.value })} className={`w-28 text-right ${small}`} />
                  </td>
                  <td className={`whitespace-nowrap px-3 text-right tabular-nums ${has && net(r) <= 0 ? "text-red-700" : ""}`}>{has && !Number.isNaN(net(r)) ? money(net(r), r.currency) : <span className="text-slate-400">-</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending || chosen.length === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกรับดอกเบี้ย ${chosen.length} บัญชี`}
          </button>
          {hiddenChosen > 0 && !pending && <span className="text-xs text-amber-700">รวม {hiddenChosen} บัญชีที่กรอกไว้ในธนาคารอื่น</span>}
          {chosen.length > 0 && !pending && (
            <button type="button" onClick={() => { setVals({}); setTax({}); }} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>
          )}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
        </div>
      )}
      <p className="text-xs text-slate-500">บันทึกเป็นรายได้ &ldquo;ดอกเบี้ย&rdquo; เข้าบัญชีนั้น (แบ่งตามเจ้าของบัญชี) · กดยอด &ldquo;รับแล้ว …&rdquo; เพื่อแก้ / ลบ (หรือที่หน้า Income &amp; Expenses)
        · ดอกเบี้ยบัญชีเงินฝากในพอร์ตลงทุน บันทึกที่หน้า Investments → แท็บ &ldquo;บันทึกรับผลตอบแทน&rdquo;</p>
    </form>
    </>
  );
}
