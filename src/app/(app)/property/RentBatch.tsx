"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { money, thDate } from "@/lib/format";
import { batchRent, type BatchState } from "./actions";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { RecordedLines, type Recorded } from "@/lib/recorded-edit";
import Flash from "@/components/Flash";

export type RentRow = {
  key: string; leaseId: string; assetId: string; property: string; tenant: string; period: string; due: string | null;
  expected: number; received: number; currency: string; status: string; bank: string;
  /** ค่าน้ำไฟที่เราจ่ายแล้วเรียกเก็บผู้เช่า (lease_utility_charges) */ chargeId?: string;
  /** ค่าเช่าที่รับแล้วของงวด (ทีละครั้ง · กดเพื่อแก้ / ลบ) */ edits?: Recorded[];
};
export type BankOpt = { id: string; name: string; currency: string };

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const n = (s: string) => Number((s ?? "").replace(/,/g, ""));
const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** ผู้เช่านิติบุคคลหักภาษี ณ ที่จ่ายค่าเช่า 5% */
const TAX_RATE = 0.05;

/** สถานะเป็นบรรทัดเล็กใต้วันครบกำหนด (แบบเดียวกับแท็บรับของ Investments) */
function RentStatus({ r, today }: { r: RentRow; today: string }) {
  if (r.status === "RECEIVED") return <span className="text-emerald-700">ได้รับแล้ว</span>;
  if (r.status === "DISMISSED") return <span className="text-slate-400">ยกเว้น</span>;
  if (r.status === "OVERDUE") {
    const d = r.due ? Math.round((Date.parse(today) - Date.parse(r.due)) / 86400000) : 0;
    return <span className="text-red-700">ค้างรับ{d > 0 && ` · เลยกำหนด ${d} วัน`}</span>;
  }
  if (r.due && r.due === today) return <span className="text-amber-700">ถึงกำหนดวันนี้</span>;
  return <span className="text-slate-500">{r.chargeId ? "รอรับคืน" : "รอรับ"}</span>;
}

/**
 * รับค่าเช่าหลายสัญญาพร้อมกัน: สัญญาที่มีงวดในเดือนที่เลือกขึ้นเป็นแถวให้อัตโนมัติ · กดบันทึกครั้งเดียว (ผิดแถวเดียว = ไม่บันทึกเลยทั้งชุด)
 *   จัดแบบเดียวกับแท็บรับของ Investments / Cash (ตกลง 2 พ.ย. 2026): กล่องบน = ตัวกรองทรัพย์สิน + กรอกตามสัญญาทุกแถว · คิดภาษี 5% + วันที่รับ
 *   สถานะใต้วันครบกำหนด · รับแล้วใต้ยอดตามสัญญา · คอลัมน์กว้างคงที่ · ภาษีหัก ณ ที่จ่าย + ยอดเข้าบัญชีสุทธิ
 */
export default function RentBatch({ rows, banks, defaultDate, today, minDate, canWrite }: {
  rows: RentRow[]; banks: BankOpt[]; defaultDate: string; today: string; minDate: string; canWrite: boolean;
}) {
  const router = useRouter();
  const [prop, setProp] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [tax, setTax] = useState<Record<string, string>>({});
  const [bank, setBank] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.key, r.bank])));
  const [state, action, pending] = useActionState<BatchState, FormData>(batchRent, {});
  const cf = useConfirmSubmit();
  useEffect(() => { if (state.ok) { setVals({}); setTax({}); router.refresh(); } }, [state, router]);

  const propList = [...new Map(rows.map((r) => [r.assetId, r.property])).entries()].sort((a, b) => a[1].localeCompare(b[1], "th"));
  const shown = rows.filter((r) => !prop || r.assetId === prop);
  const editable = (r: RentRow) => canWrite && r.status !== "RECEIVED" && r.status !== "DISMISSED";
  const gap = (r: RentRow) => Math.max(r.expected - r.received, 0);
  const filled = (r: RentRow) => editable(r) && (vals[r.key] ?? "").trim() !== "";
  const chosen = rows.filter(filled);
  const hiddenChosen = chosen.filter((r) => !shown.includes(r)).length;
  const taxOf = (r: RentRow) => (r.chargeId ? "" : tax[r.key] ?? "");
  const net = (r: RentRow) => n(vals[r.key] ?? "") - (taxOf(r).trim() ? n(taxOf(r)) : 0);
  const payload = chosen.map((r) => r.chargeId
    ? { charge_id: r.chargeId, amount: vals[r.key], date, received_to_asset_id: bank[r.key] ?? "" }
    : { lease_id: r.leaseId, amount: vals[r.key], tax: taxOf(r), date, received_to_asset_id: bank[r.key] ?? "", income_period: r.period });

  const fillable = shown.filter((r) => editable(r) && gap(r) > 0 && !(vals[r.key] ?? "").trim());
  const fillAll = () => setVals({ ...vals, ...Object.fromEntries(fillable.map((r) => [r.key, fmt(gap(r))])) });
  const taxable = shown.filter((r) => filled(r) && !r.chargeId && !Number.isNaN(n(vals[r.key])));
  const taxAll = () => setTax({ ...tax, ...Object.fromEntries(taxable.map((r) => [r.key, fmt(Math.round(n(vals[r.key]) * TAX_RATE * 100) / 100)])) });
  const onSubmit = cf.guard(`บันทึกรับค่าเช่า ${chosen.length} รายการ วันที่ ${thDate(date)} ?\n${chosen.map((r) =>
    `• ${r.property} · ${r.tenant} ${vals[r.key]}${taxOf(r).trim() ? ` (ภาษี ${taxOf(r)})` : ""}`).join("\n")}`, { okLabel: "ยืนยันบันทึก" });

  return (
    <>
    {cf.dialog}
    <div className="space-y-3">
      {canWrite && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {propList.length > 1 && (
                <label className="flex items-center gap-2">ทรัพย์สิน
                  <select value={prop} onChange={(e) => setProp(e.target.value)} className={`max-w-[16rem] ${small}`}>
                    <option value="">ทุกรายการ</option>
                    {propList.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </label>
              )}
              {fillable.length > 0 && <button type="button" onClick={fillAll} className="text-sm text-blue-700 hover:underline">กรอกตามสัญญาทุกแถว ({fillable.length})</button>}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              {taxable.length > 0 && <button type="button" onClick={taxAll} className="text-sm text-blue-700 hover:underline">คิดภาษี 5% ทุกแถวที่กรอก</button>}
              <label className="flex items-center gap-2">วันที่รับ
                <input type="date" value={date} min={minDate || undefined} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={small} />
              </label>
            </div>
          </div>
          <p className="text-xs text-slate-500">กรอกเฉพาะรายการที่ได้รับ (ช่องว่าง = ไม่บันทึก) · วันที่รับใช้กับทุกแถวที่กรอก (รับคนละวัน = บันทึกทีละรอบ)
            · ยอดก่อนภาษี = ค่าเช่าเต็มตามสัญญา ยอดเข้าบัญชีสุทธิ = ยอดก่อนภาษี − ภาษีหัก ณ ที่จ่าย (ผู้เช่านิติบุคคลหัก 5%)
            · ค่าน้ำไฟเรียกเก็บผู้เช่าที่ยังไม่ได้รับคืนแสดงต่อท้าย (นับเป็นรายได้อื่น ไม่มีภาษี) · ยกเว้นงวดทำที่หน้าของทรัพย์สิน</p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {/* ทุกคอลัมน์ยกเว้นชื่อกว้างคงที่ → กรอกตัวเลขแล้วคอลัมน์ไม่ขยับ */}
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="min-w-[13rem] px-3 py-2">ทรัพย์สิน / ผู้เช่า</th><th className="w-40 px-3">วันครบกำหนด</th>
              <th className="w-40 px-3 text-right">ค่าเช่าตามสัญญา</th>
              {canWrite && <><th className="w-32 px-2 text-right">ยอดก่อนภาษี</th><th className="w-28 px-2 text-right">ภาษีหัก ณ ที่จ่าย</th>
                <th className="w-40 whitespace-nowrap px-2 text-right">ยอดเข้าบัญชีสุทธิ</th><th className="w-44 px-2">เข้าบัญชี</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={canWrite ? 7 : 3} className="px-4 py-6 text-center text-slate-500">ไม่มีค่าเช่างวดเดือนนี้</td></tr>}
            {shown.map((r) => {
              const open = editable(r);
              const v = vals[r.key] ?? "";
              const has = v.trim() !== "" && !Number.isNaN(n(v));
              const sameCcy = banks.filter((b) => b.currency === r.currency);
              return (
                <tr key={r.key} className={`${!open && r.status === "RECEIVED" ? "text-slate-500" : ""} ${open && v.trim() ? "bg-blue-50/40" : ""}`}>
                  <td className="break-words px-3 py-2.5">
                    <Link href={`/property/${r.assetId}`} className="font-medium text-slate-900 hover:underline">{r.property}</Link>
                    <div className="text-xs text-slate-500">{r.tenant} · {r.currency}</div>
                  </td>
                  <td className="px-3 py-2.5"><div className="whitespace-nowrap">{r.due ? thDate(r.due) : <span className="text-slate-400">-</span>}</div>
                    <div className="text-xs"><RentStatus r={r} today={today} /></div></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{money(r.expected, r.currency)}
                    {r.edits?.length ? <RecordedLines items={r.edits} />
                      : r.received > 0 && <div className="text-xs text-emerald-700">รับแล้ว {money(r.received, r.currency)}</div>}</td>
                  {canWrite && (!open ? <td colSpan={4} /> : <>
                    <td className="px-2 text-right">
                      <input inputMode="decimal" value={v} aria-label={`ยอดก่อนภาษี ${r.property}`} placeholder={r.currency}
                        onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })} className={`w-28 text-right ${small}`} />
                    </td>
                    <td className="px-2 text-right">{r.chargeId ? <span className="text-xs text-slate-400">-</span>
                      : <input inputMode="decimal" value={tax[r.key] ?? ""} disabled={!v.trim()} aria-label={`ภาษีหัก ณ ที่จ่าย ${r.property}`}
                          onChange={(e) => setTax({ ...tax, [r.key]: e.target.value })} className={`w-24 text-right ${small}`} />}</td>
                    <td className={`whitespace-nowrap px-2 text-right tabular-nums ${has && net(r) <= 0 ? "text-red-700" : ""}`}>
                      {has && !Number.isNaN(net(r)) ? money(net(r), r.currency) : <span className="text-slate-400">-</span>}</td>
                    <td className="px-2">
                      <select value={bank[r.key] ?? ""} onChange={(e) => setBank({ ...bank, [r.key]: e.target.value })} className={`w-full max-w-[11rem] ${small}`} aria-label={`เข้าบัญชี ${r.property}`}>
                        <option value="">— ไม่ผ่านบัญชี (เงินสด) —</option>
                        {sameCcy.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </td>
                  </>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canWrite && rows.some(editable) && (
        <form action={action} onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="rows" value={JSON.stringify(payload)} />
          <button disabled={pending || chosen.length === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกรับ ${chosen.length} รายการ ณ ${thDate(date)}`}
          </button>
          {hiddenChosen > 0 && !pending && <span className="text-xs text-amber-700">รวม {hiddenChosen} รายการที่กรอกไว้ในทรัพย์สินอื่น</span>}
          {chosen.length > 0 && !pending && <button type="button" onClick={() => { setVals({}); setTax({}); }} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          <Flash on={state} as="span" className="text-sm text-emerald-700" />
        </form>
      )}
    </div>
    </>
  );
}
