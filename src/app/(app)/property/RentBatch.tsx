"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { money, thDate } from "@/lib/format";
import { batchRent, type BatchState } from "./actions";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { RecordedLines, type Recorded } from "@/lib/recorded-edit";
import { BatchSave, FillAll, STICKY_BAR, TaxAll } from "@/components/BatchSave";

export type RentRow = {
  key: string; leaseId: string; assetId: string; property: string; tenant: string; period: string; due: string | null;
  expected: number; received: number; currency: string; status: string; bank: string;
  /** ค่าน้ำไฟที่เราจ่ายแล้วเรียกเก็บผู้เช่า (lease_utility_charges) */ chargeId?: string;
  /** ค่าเช่าที่รับแล้วของงวด (ทีละครั้ง · กดเพื่อแก้ / ลบ) */ edits?: Recorded[];
  /** รายละเอียดสัญญา (แถวแรกของสัญญา · เดิมอยู่ตาราง "สัญญาเช่าที่มีผล") */
  lease?: { id: string; term: string; freq: string; badge?: { text: string; cls: string } };
  /** สัญญาที่ไม่มีงวดเดือนนี้ (status NONE) → งวดถัดไป / เริ่มสัญญา */ note?: string;
  /** งวดไม่เต็มรอบ (คิดตามจำนวนวัน) → ช่วงวันของงวด */ cycle?: string;
  /** เลยวันครบกำหนด (ณ วันนี้): จำนวนวัน · ยังอยู่ในช่วงผ่อนผัน · ค่าปรับ */ late?: { days: number; inGrace: boolean; grace: number; fee: number };
  /** ค่าปรับล่าช้าต่อวัน (สัญญาที่ตั้งไว้) + วันผ่อนผัน → เติมค่าปรับตามวันที่รับ */ feePerDay?: number; grace?: number;
};
/** รายได้ที่รับในเดือนนี้ที่ไม่อยู่ในแถวงวดค่าเช่า (เดิมอยู่ตาราง "รายได้จากทรัพย์สินที่บันทึกแล้ว") · amount = ยอดบาท กดแก้ได้ */
export type OtherIncome = { key: string; assetId: string; property: string; date: string; label: string; amount: ReactNode };
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
    // ผ่อนผัน (ตกลง 6 พ.ย. 2026): เลยกำหนดไม่เกินวันผ่อนผัน = ครบกำหนด (ส้ม) · เกิน = ค้างรับ (แดง) + ค่าปรับ
    if (r.late?.inGrace) return <span className="whitespace-nowrap text-amber-700">ครบกำหนด · เลย {d} วัน (ผ่อนผัน {r.late.grace} วัน)</span>;
    return <span className="whitespace-nowrap text-red-700">ค้างรับ{d > 0 && ` · เลยกำหนด ${d} วัน`}{r.late && r.late.fee > 0 && ` · ค่าปรับ ${money(r.late.fee)}`}</span>;
  }
  if (r.status === "NONE") return <span className="text-slate-500">{r.note}</span>;
  if (r.due && r.due === today) return <span className="text-amber-700">ถึงกำหนดวันนี้</span>;
  return <span className="text-slate-500">{r.chargeId ? "รอรับคืน" : "รอรับ"}</span>;
}

/**
 * รับค่าเช่าหลายสัญญาพร้อมกัน: สัญญาที่มีงวดในเดือนที่เลือกขึ้นเป็นแถวให้อัตโนมัติ · กดบันทึกครั้งเดียว (ผิดแถวเดียว = ไม่บันทึกเลยทั้งชุด)
 *   จัดแบบเดียวกับแท็บรับของ Investments / Cash (ตกลง 2 พ.ย. 2026): กล่องบน = ตัวกรองทรัพย์สิน + กรอกตามสัญญาทุกแถว · คิดภาษี 5% + วันที่รับ
 *   สถานะใต้วันครบกำหนด · รับแล้วใต้ยอดตามสัญญา · คอลัมน์กว้างคงที่ · ภาษีหัก ณ ที่จ่าย + ยอดเข้าบัญชีสุทธิ
 *   ตารางเดียวทั้งแท็บ (ตกลง 5 พ.ย. 2026): งวดเดือนก่อนที่ยังค้างรับยกมา · สัญญาทุกฉบับ (ไม่มีงวดเดือนนี้ = บอกงวดถัดไป)
 *   · รายได้อื่นที่รับในเดือนนี้ต่อท้าย · บรรทัดสุดท้าย = ยอดรับเข้าเดือนนี้ (ตามวันที่รับ)
 */
export default function RentBatch({ rows, others, incByAsset, totalLabel, banks, defaultDate, today, minDate, canWrite }: {
  rows: RentRow[]; others: OtherIncome[]; incByAsset: Record<string, number>; totalLabel: string;
  banks: BankOpt[]; defaultDate: string; today: string; minDate: string; canWrite: boolean;
}) {
  const router = useRouter();
  const [prop, setProp] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [tax, setTax] = useState<Record<string, string>>({});
  const [fee, setFee] = useState<Record<string, string>>({});   // ไม่มีในนี้ = ค่าปรับตามวันที่รับ
  const [bank, setBank] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.key, r.bank])));
  const [state, action, pending] = useActionState<BatchState, FormData>(batchRent, {});
  const cf = useConfirmSubmit();
  useEffect(() => { if (state.ok) { setVals({}); setTax({}); setFee({}); router.refresh(); } }, [state, router]);

  const propList = [...new Map(rows.map((r) => [r.assetId, r.property])).entries()].sort((a, b) => a[1].localeCompare(b[1], "th"));
  const shown = rows.filter((r) => !prop || r.assetId === prop);
  const shownOthers = others.filter((o) => !prop || o.assetId === prop);
  const total = Object.entries(incByAsset).reduce((t, [id, v]) => t + (!prop || id === prop ? v : 0), 0);
  const cols = canWrite ? 7 : 3;
  const editable = (r: RentRow) => canWrite && (r.status === "PENDING" || r.status === "OVERDUE");
  const gap = (r: RentRow) => Math.max(r.expected - r.received, 0);
  const filled = (r: RentRow) => editable(r) && (vals[r.key] ?? "").trim() !== "";
  const chosen = rows.filter(filled);
  const hiddenChosen = chosen.filter((r) => !shown.includes(r)).length;
  const taxOf = (r: RentRow) => (r.chargeId ? "" : tax[r.key] ?? "");
  // ค่าปรับล่าช้า ณ วันที่รับ = (วันที่เลยกำหนด − วันผ่อนผัน) × ค่าปรับต่อวัน · แก้ / ลบได้ (ไม่เก็บ = ลบเป็นว่าง)
  const autoFee = (r: RentRow) => {
    if (!r.feePerDay || !r.due || r.chargeId) return "";
    const days = Math.round((Date.parse(date) - Date.parse(r.due)) / 86400000) - (r.grace ?? 0);
    return days > 0 ? fmt(days * r.feePerDay) : "";
  };
  const feeOf = (r: RentRow) => (r.feePerDay ? fee[r.key] ?? autoFee(r) : "");
  // ยอดเข้าบัญชีสุทธิ = ยอดก่อนภาษี − ภาษี + ค่าปรับล่าช้า (เข้าบัญชีเดียวกัน)
  const net = (r: RentRow) => n(vals[r.key] ?? "") - (taxOf(r).trim() ? n(taxOf(r)) : 0) + (feeOf(r).trim() ? n(feeOf(r)) : 0);
  const payload = chosen.map((r) => r.chargeId
    ? { charge_id: r.chargeId, amount: vals[r.key], date, received_to_asset_id: bank[r.key] ?? "" }
    : { lease_id: r.leaseId, amount: vals[r.key], tax: taxOf(r), late_fee: feeOf(r).replace(/,/g, ""), date, received_to_asset_id: bank[r.key] ?? "", income_period: r.period });

  const fillable = shown.filter((r) => editable(r) && gap(r) > 0 && !(vals[r.key] ?? "").trim());
  const fillAll = () => setVals({ ...vals, ...Object.fromEntries(fillable.map((r) => [r.key, fmt(gap(r))])) });
  const taxable = shown.filter((r) => filled(r) && !r.chargeId && !Number.isNaN(n(vals[r.key])));
  const taxAll = () => setTax({ ...tax, ...Object.fromEntries(taxable.map((r) => [r.key, fmt(Math.round(n(vals[r.key]) * TAX_RATE * 100) / 100)])) });
  const onSubmit = cf.guard(`บันทึกรับค่าเช่า ${chosen.length} รายการ ณ วันที่ ${thDate(date)} ?\n${chosen.map((r) =>
    `• ${r.property} · ${r.tenant} ${vals[r.key]}${taxOf(r).trim() ? ` (ภาษี ${taxOf(r)})` : ""}${n(feeOf(r)) > 0 ? ` + ค่าปรับ ${feeOf(r)}` : ""}`).join("\n")}`, { okLabel: "ยืนยันบันทึก" });

  return (
    <>
    {cf.dialog}
    <div className="space-y-3">
      {canWrite && (
        <div className={`space-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm ${STICKY_BAR}`}>
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
              <FillAll onClick={fillAll} disabled={fillable.length === 0} />
            </div>
            <BatchSave action={action} onSubmit={onSubmit} fields={{ rows: JSON.stringify(payload) }}
              count={chosen.length} pending={pending} onClear={() => { setVals({}); setTax({}); setFee({}); }} state={state}
              date={date} onDate={setDate} minDate={minDate} maxDate={today}
              note={hiddenChosen > 0 && <span className="text-xs text-amber-700">รวม {hiddenChosen} รายการที่กรอกไว้ในทรัพย์สินอื่น</span>}
              info={<>กรอกเฉพาะรายการที่ได้รับ (ช่องว่าง = ไม่บันทึก) · วันที่รับใช้กับทุกแถวที่กรอก (รับคนละวัน = บันทึกทีละรอบ)
            · ยอดก่อนภาษี = ค่าเช่าเต็มตามสัญญา ยอดเข้าบัญชีสุทธิ = ยอดก่อนภาษี − ภาษีหัก ณ ที่จ่าย (ผู้เช่านิติบุคคลหัก 5%) + ค่าปรับล่าช้า
            · ค่าปรับล่าช้า (สัญญาที่ตั้งไว้) เติมให้ตามวันที่รับ นับเฉพาะวันที่เกินวันผ่อนผัน แก้หรือลบได้ บันทึกเป็นรายได้อื่น &ldquo;ค่าปรับชำระค่าเช่าล่าช้า&rdquo;
            · งวดเดือนก่อนที่ยังค้างรับยกมาให้ · ค่าน้ำไฟเรียกเก็บผู้เช่าที่ยังไม่ได้รับคืนแสดงต่อท้าย (นับเป็นรายได้อื่น ไม่มีภาษี) · ยกเว้นงวดทำที่หน้าของทรัพย์สิน</>}>
              <TaxAll pct={5} onClick={taxAll} disabled={taxable.length === 0} />
            </BatchSave>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {/* ทุกคอลัมน์ยกเว้นชื่อกว้างคงที่ → กรอกตัวเลขแล้วคอลัมน์ไม่ขยับ */}
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="min-w-[13rem] px-3 py-2">ทรัพย์สิน / ผู้เช่า</th><th className="w-44 px-3">วันครบกำหนด</th>
              <th className="w-40 px-3 text-right">ค่าเช่าตามสัญญา</th>
              {canWrite && <><th className="w-32 px-2 text-right">ยอดก่อนภาษี</th><th className="w-28 px-2 text-right">ภาษีหัก ณ ที่จ่าย</th>
                <th className="w-40 whitespace-nowrap px-2 text-right">ยอดเข้าบัญชีสุทธิ</th><th className="w-44 px-2">เข้าบัญชี</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={cols} className="px-4 py-6 text-center text-slate-500">ไม่มีสัญญาเช่า / ค่าเช่าในเดือนนี้</td></tr>}
            {shown.map((r) => {
              const open = editable(r);
              const v = vals[r.key] ?? "";
              const has = v.trim() !== "" && !Number.isNaN(n(v));
              const sameCcy = banks.filter((b) => b.currency === r.currency);
              return (
                <tr key={r.key} className={`${!open && (r.status === "RECEIVED" || r.status === "NONE") ? "text-slate-500" : ""} ${open && v.trim() ? "bg-blue-50/40" : ""}`}>
                  <td className="break-words px-3 py-2.5">
                    <Link href={`/property/${r.assetId}`} className="font-medium text-slate-900 hover:underline">{r.property}</Link>
                    <div className="text-xs text-slate-500">{r.tenant}</div>
                    {r.lease && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                        <span className="whitespace-nowrap">สัญญา {r.lease.term}</span>
                        {r.lease.badge && <span className={`whitespace-nowrap rounded px-1.5 py-0.5 ${r.lease.badge.cls}`}>{r.lease.badge.text}</span>}
                        <Link href={`/print/lease/${r.lease.id}`} target="_blank" className="whitespace-nowrap text-blue-700 hover:underline">พิมพ์สัญญา</Link>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><div className="whitespace-nowrap">{r.due ? thDate(r.due) : r.status !== "NONE" && <span className="text-slate-400">-</span>}</div>
                    <div className="text-xs"><RentStatus r={r} today={today} /></div></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{money(r.expected, r.currency)}
                    {r.lease?.freq && <span className="text-xs text-slate-400">{r.lease.freq}</span>}
                    {r.cycle && <div className="text-xs text-slate-500">{r.cycle}</div>}
                    {r.edits?.length ? <RecordedLines items={r.edits} />
                      : r.received > 0 && <div className="text-xs text-emerald-700">รับแล้ว {money(r.received, r.currency)}</div>}
                    {r.status === "RECEIVED" && r.received - r.expected > 0.005 && <div className="text-xs text-amber-700">รับเกิน {money(r.received - r.expected, r.currency)}</div>}</td>
                  {canWrite && (!open ? <td colSpan={4} /> : <>
                    <td className="px-2 text-right">
                      <input inputMode="decimal" value={v} aria-label={`ยอดก่อนภาษี ${r.property}`} placeholder={r.currency}
                        onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })} className={`w-28 text-right ${small}`} />
                      {r.feePerDay && v.trim() && (fee[r.key] !== undefined || autoFee(r)) && (
                        <label className="mt-1 block text-right text-xs text-slate-500"><span className="block whitespace-nowrap">+ ค่าปรับล่าช้า</span>
                          <input inputMode="decimal" value={feeOf(r)} placeholder="0.00" aria-label={`ค่าปรับล่าช้า ${r.property}`}
                            onChange={(e) => setFee({ ...fee, [r.key]: e.target.value })} className={`mt-0.5 w-28 text-right ${small}`} />
                        </label>
                      )}
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
            {shownOthers.length > 0 && (
              <tr className="bg-slate-50/60"><td colSpan={cols} className="px-3 py-1.5 text-xs font-medium text-slate-500">รายได้อื่นที่รับในเดือนนี้</td></tr>
            )}
            {shownOthers.map((o) => (
              <tr key={o.key}>
                <td className="break-words px-3 py-2.5">
                  <Link href={`/property/${o.assetId}`} className="font-medium text-slate-900 hover:underline">{o.property}</Link>
                  <div className="text-xs text-slate-500">{o.label}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">{thDate(o.date)}<div className="text-xs text-emerald-700">รับแล้ว</div></td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-emerald-700">{o.amount} <span className="text-slate-400">THB</span></td>
                {canWrite && <td colSpan={4} />}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
            <tr><td colSpan={2} className="px-3 py-2">{totalLabel}</td>
              <td className="whitespace-nowrap px-3 text-right tabular-nums text-emerald-700">{money(total, "THB")}</td>{canWrite && <td colSpan={4} />}</tr>
          </tfoot>
        </table>
      </div>

    </div>
    </>
  );
}
