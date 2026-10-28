"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { money, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { RecordedLines, type Recorded } from "@/lib/recorded-edit";
import { batchAltIncome, batchAltValues, type ActionState } from "./actions";

export type AltRow = { id: string; name: string; category: string; currency: string; value: number | null; valueDate: string | null; auto: boolean;
  /** ผลตอบแทนที่รับแล้วเดือนนี้ (ทีละครั้ง · กดเพื่อแก้ / ลบ) */ edits?: Recorded[] };
export type AltBank = { id: string; name: string; currency: string };

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const n = (s: string) => Number((s ?? "").replace(/,/g, ""));
const METHODS: [string, string][] = [["USER_ESTIMATE", "ประมาณเอง"], ["APPRAISAL", "ผู้ประเมิน / ร้าน"], ["LATEST_TRANSACTION", "ราคาตลาดล่าสุด"]];

function Result({ s }: { s: ActionState }) {
  return <>{s.error && <span className="text-sm text-red-600">{s.error}</span>}{s.ok && <span className="text-sm text-emerald-700">{s.ok}</span>}</>;
}

/**
 * แท็บ "บันทึกรับผลตอบแทน/อัพเดตมูลค่า" ของหน้า Alternative Assets (ตกลง 27 ต.ค. 2026) — 2 ส่วน แต่ละส่วนกดบันทึกครั้งเดียว
 *   รับผลตอบแทน: รายได้ "อื่น ๆ" ผูกสินทรัพย์ → แบ่งให้เจ้าของตามสัดส่วน (แบบค่าเช่า Property) · เข้าบัญชีที่เลือก
 *   อัปเดตมูลค่า: มูลค่าใหม่หลายรายการ · ทองที่ตั้งราคาอัตโนมัติไม่ต้องกรอก
 *   ผิดแถวเดียว = ไม่บันทึกทั้งชุด
 */
export default function AltBatch({ rows, banks, today, minDate, canWrite }: {
  rows: AltRow[]; banks: AltBank[]; today: string; minDate: string; canWrite: boolean;
}) {
  return (
    <div className="space-y-6">
      <IncomeBatch rows={rows} banks={banks} today={today} minDate={minDate} canWrite={canWrite} />
      <ValueBatch rows={rows} today={today} minDate={minDate} canWrite={canWrite} />
    </div>
  );
}

function IncomeBatch({ rows, banks, today, minDate, canWrite }: { rows: AltRow[]; banks: AltBank[]; today: string; minDate: string; canWrite: boolean }) {
  const router = useRouter();
  const cf = useConfirmSubmit();
  const [date, setDate] = useState(today);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [tax, setTax] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [bank, setBank] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) =>
    [r.id, (banks.find((b) => b.currency === r.currency) ?? banks[0])?.id ?? ""])));
  const [state, action, pending] = useActionState<ActionState, FormData>(batchAltIncome, {});
  useEffect(() => { if (state.ok) { setVals({}); setTax({}); setNotes({}); router.refresh(); } }, [state, router]);

  const chosen = rows.filter((r) => (vals[r.id] ?? "").trim() !== "");
  const payload = chosen.map((r) => ({ asset_id: r.id, label: r.name, amount: vals[r.id], tax: tax[r.id] ?? "", bank_asset_id: bank[r.id] ?? "", notes: notes[r.id] ?? "" }));
  const bankOf = new Map(banks.map((b) => [b.id, b]));
  const onSubmit = cf.guard(`บันทึกรับผลตอบแทน ${chosen.length} รายการ วันที่ ${thDate(date)} ?\n${chosen.map((r) =>
    `• ${r.name} ${vals[r.id]}${tax[r.id]?.trim() ? ` (ภาษี ${tax[r.id]})` : ""} → ${bankOf.get(bank[r.id] ?? "")?.name ?? "(ยังไม่เลือกบัญชี)"}`).join("\n")}`, { okLabel: "ยืนยันบันทึก" });

  return (
    <section className="space-y-3">
      {cf.dialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium text-slate-900">รับผลตอบแทน <span className="text-xs font-normal text-slate-500">(ค่าเช่า / ค่าให้ยืม · Staking · ผลตอบแทนอื่น)</span></h2>
        {canWrite && (
          <label className="flex items-center gap-2 text-sm">วันที่รับ
            <input type="date" value={date} min={minDate || undefined} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={small} />
          </label>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            {/* ทุกคอลัมน์ยกเว้นชื่อกว้างคงที่ → กรอกตัวเลขแล้วคอลัมน์ไม่ขยับ */}
            <tr><th className="min-w-[12rem] px-3 py-2">สินทรัพย์</th>
              {canWrite && <><th className="w-40 px-3 text-right">ยอดที่ได้รับ (ก่อนภาษี)</th><th className="w-36 px-3 text-right">ภาษีหัก ณ ที่จ่าย</th><th className="w-44 px-3 text-right">สุทธิ</th>
                <th className="w-60 px-3">เข้าบัญชี</th><th className="w-48 px-3">หมายเหตุ</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">ไม่มีสินทรัพย์ที่ถืออยู่</td></tr>}
            {rows.map((r) => {
              const v = vals[r.id] ?? "";
              const has = v.trim() !== "" && !Number.isNaN(n(v));
              const net = has ? n(v) - (tax[r.id]?.trim() ? n(tax[r.id]) : 0) : null;
              const ccy = bankOf.get(bank[r.id] ?? "")?.currency ?? r.currency;
              return (
                <tr key={r.id} className={has ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2"><Link href={`/alternative/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                    <div className="text-xs text-slate-500">{r.category}</div><RecordedLines items={r.edits} /></td>
                  {canWrite && <>
                    <td className="px-3 text-right"><input inputMode="decimal" value={v} placeholder={ccy} aria-label={`ผลตอบแทน ${r.name}`}
                      onChange={(e) => setVals({ ...vals, [r.id]: e.target.value })} className={`w-32 text-right ${small}`} /></td>
                    <td className="px-3 text-right"><input inputMode="decimal" value={tax[r.id] ?? ""} disabled={!has} aria-label={`ภาษี ${r.name}`}
                      onChange={(e) => setTax({ ...tax, [r.id]: e.target.value })} className={`w-28 text-right ${small}`} /></td>
                    <td className={`whitespace-nowrap px-3 text-right tabular-nums ${net != null && net <= 0 ? "text-red-700" : ""}`}>{net != null && !Number.isNaN(net) ? money(net, ccy) : <span className="text-slate-400">-</span>}</td>
                    <td className="px-3">
                      <select value={bank[r.id] ?? ""} onChange={(e) => setBank({ ...bank, [r.id]: e.target.value })} className={`w-full max-w-[14rem] ${small}`} aria-label={`เข้าบัญชี ${r.name}`}>
                        <option value="">— เลือกบัญชี —</option>
                        {banks.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}
                      </select>
                    </td>
                    <td className="px-3"><input value={notes[r.id] ?? ""} disabled={!has} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                      aria-label={`หมายเหตุ ${r.name}`} className={`w-40 ${small}`} /></td>
                  </>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canWrite && (
        <form action={action} onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="rows" value={JSON.stringify(payload)} />
          <button disabled={pending || chosen.length === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกรับผลตอบแทน ${chosen.length} รายการ`}
          </button>
          {chosen.length > 0 && !pending && <button type="button" onClick={() => { setVals({}); setTax({}); setNotes({}); }} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>}
          <Result s={state} />
        </form>
      )}
      <p className="text-xs text-slate-500">บันทึกเป็นรายได้ &ldquo;อื่น ๆ&rdquo; ผูกกับสินทรัพย์ · แบ่งให้เจ้าของตามสัดส่วน · ยอดเป็นสกุลของบัญชีที่รับ · ผิดแถวเดียว = ไม่บันทึกทั้งชุด</p>
    </section>
  );
}

function ValueBatch({ rows, today, minDate, canWrite }: { rows: AltRow[]; today: string; minDate: string; canWrite: boolean }) {
  const router = useRouter();
  const cf = useConfirmSubmit();
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState("USER_ESTIMATE");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [state, action, pending] = useActionState<ActionState, FormData>(batchAltValues, {});
  useEffect(() => { if (state.ok) { setVals({}); router.refresh(); } }, [state, router]);
  const chosen = rows.filter((r) => !r.auto && (vals[r.id] ?? "").trim() !== "");
  const payload = chosen.map((r) => ({ asset_id: r.id, label: r.name, value: vals[r.id] }));
  const onSubmit = cf.guard(`บันทึกมูลค่า ${chosen.length} รายการ ณ วันที่ ${thDate(date)} ?\n${chosen.map((r) => `• ${r.name} ${vals[r.id]}`).join("\n")}`, { okLabel: "ยืนยันบันทึก" });

  return (
    <section className="space-y-3">
      {cf.dialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium text-slate-900">อัปเดตมูลค่า</h2>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">ณ วันที่
              <input type="date" value={date} min={minDate || undefined} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={small} />
            </label>
            <label className="flex items-center gap-2">วิธีประเมิน
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={small}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
          </div>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">สินทรัพย์</th><th className="w-48 px-3 text-right">มูลค่าล่าสุด</th>{canWrite && <th className="w-60 px-3 text-right">มูลค่าใหม่</th>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500">ไม่มีสินทรัพย์ที่ถืออยู่</td></tr>}
            {rows.map((r) => {
              const v = vals[r.id] ?? "";
              return (
                <tr key={r.id} className={v.trim() ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2"><Link href={`/alternative/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                    <div className="text-xs text-slate-500">{r.category}</div></td>
                  <td className="px-3 text-right tabular-nums">{r.value != null ? money(r.value, r.currency) : "-"}
                    {r.valueDate && <div className="text-xs text-slate-500">ณ {thDate(r.valueDate)}</div>}</td>
                  {canWrite && <td className="px-3 py-2 text-right">
                    {r.auto ? <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">ราคาอัตโนมัติ · ไม่ต้องกรอก</span>
                      : <input inputMode="decimal" value={v} placeholder={r.currency} aria-label={`มูลค่าใหม่ ${r.name}`}
                          onChange={(e) => setVals({ ...vals, [r.id]: e.target.value })} className={`w-36 text-right ${small}`} />}
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canWrite && (
        <form action={action} onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="method" value={method} />
          <input type="hidden" name="rows" value={JSON.stringify(payload)} />
          <button disabled={pending || chosen.length === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกมูลค่า ${chosen.length} รายการ`}
          </button>
          {chosen.length > 0 && !pending && <button type="button" onClick={() => setVals({})} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>}
          <Result s={state} />
        </form>
      )}
      <p className="text-xs text-slate-500">ทองที่ตั้งราคาอัตโนมัติ ระบบลงราคารับซื้อให้ทุกวันทำการ · ทองที่ปิดราคาอัตโนมัติ / ต้องคำนวณจากน้ำหนัก ใช้ฟอร์มในหน้าสินทรัพย์ · ผิดแถวเดียว = ไม่บันทึกทั้งชุด</p>
    </section>
  );
}
