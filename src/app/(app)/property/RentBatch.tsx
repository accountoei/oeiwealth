"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { money, thDate, thMonth } from "@/lib/format";
import { batchRent, type BatchState } from "./actions";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { RecordedLines, type Recorded } from "@/lib/recorded-edit";

export type RentRow = {
  key: string; leaseId: string; assetId: string; property: string; tenant: string; period: string; due: string | null;
  expected: number; received: number; currency: string; status: string; bank: string;
  /** ค่าน้ำไฟที่เราจ่ายแล้วเรียกเก็บผู้เช่า (lease_utility_charges) */ chargeId?: string;
  /** ค่าเช่าที่รับแล้วของงวด (ทีละครั้ง · กดเพื่อแก้ / ลบ) */ edits?: Recorded[];
};
export type BankOpt = { id: string; name: string; currency: string };

const STATUS: Record<string, { text: string; cls: string }> = {
  RECEIVED: { text: "ได้รับแล้ว", cls: "text-emerald-700" }, PENDING: { text: "รอรับ", cls: "text-slate-600" },
  OVERDUE: { text: "ค้างรับ", cls: "text-red-600" }, DISMISSED: { text: "ยกเว้น", cls: "text-slate-400" },
};
const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * รับค่าเช่าหลายสัญญาพร้อมกัน: สัญญาที่มีงวดในเดือนที่เลือกขึ้นเป็นแถวให้อัตโนมัติ
 *   กรอกยอดเฉพาะแถวที่ได้รับ (ช่องว่าง = ไม่บันทึก) · ปุ่ม "ตามสัญญา" ใส่ยอดที่ยังค้างให้ · กดบันทึกครั้งเดียว
 */
export default function RentBatch({ rows, banks, defaultDate, today, ym, canWrite }: {
  rows: RentRow[]; banks: BankOpt[]; defaultDate: string; today: string; ym: string; canWrite: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [bank, setBank] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.key, r.bank])));
  const [state, action, pending] = useActionState<BatchState, FormData>(batchRent, {});
  const cf = useConfirmSubmit();
  useEffect(() => { if (state.ok) { setVals({}); router.refresh(); } }, [state, router]);
  const open = rows.filter((r) => r.status !== "RECEIVED" && r.status !== "DISMISSED");
  const gap = (r: RentRow) => Math.max(r.expected - r.received, 0);
  const chosen = rows.filter((r) => (vals[r.key] ?? "").trim() !== "");
  const payload = chosen.map((r) => r.chargeId
    ? { charge_id: r.chargeId, amount: vals[r.key], date, received_to_asset_id: bank[r.key] ?? "" }
    : { lease_id: r.leaseId, amount: vals[r.key], date, received_to_asset_id: bank[r.key] ?? "", income_period: r.period });
  const onSubmit = cf.guard(`บันทึกรับค่าเช่า ${chosen.length} รายการ วันที่ ${thDate(date)} ?\n${chosen.map((r) => `• ${r.property} · ${r.tenant} ${vals[r.key]}`).join("\n")}`,
    { okLabel: "ยืนยันบันทึก" });

  return (
    <>
    {cf.dialog}
    <form action={action} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <h2 className="font-medium text-slate-900">ค่าเช่างวด {thMonth(`${ym}-01`)}</h2>
          {canWrite && open.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">วันที่รับ
                <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={small} />
              </label>
              <button type="button" onClick={() => setVals({ ...vals, ...Object.fromEntries(open.map((r) => [r.key, fmt(gap(r))])) })}
                className="text-sm text-blue-700 hover:underline">ใส่ตามสัญญาทุกแถว</button>
            </div>
          )}
        </div>
        <table className="mt-3 w-full min-w-[52rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">ทรัพย์สิน / ผู้เช่า</th><th className="px-3">ครบกำหนด</th><th className="px-3 text-right">ตามสัญญา</th>
              <th className="px-3 text-right">รับแล้ว</th><th className="px-3">สถานะ</th>
              {canWrite && <><th className="px-3 text-right">ยอดที่ได้รับ</th><th className="px-3">เข้าบัญชี</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">ไม่มีค่าเช่างวดเดือนนี้</td></tr>}
            {rows.map((r) => {
              const done = r.status === "RECEIVED" || r.status === "DISMISSED";
              const v = vals[r.key] ?? "";
              const sameCcy = banks.filter((b) => b.currency === r.currency);
              return (
                <tr key={r.key} className={v.trim() ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2">
                    <Link href={`/property/${r.assetId}`} className="font-medium text-slate-900 hover:underline">{r.property}</Link>
                    <div className="text-xs text-slate-500">{r.tenant}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 text-xs">{thDate(r.due)}</td>
                  <td className="px-3 text-right tabular-nums">{money(r.expected, r.currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.edits?.length ? <RecordedLines items={r.edits} />
                    : r.received > 0 ? money(r.received, r.currency) : <span className="text-slate-400">-</span>}</td>
                  <td className={`px-3 text-xs ${STATUS[r.status]?.cls ?? ""}`}>{STATUS[r.status]?.text ?? r.status}</td>
                  {canWrite && (done ? <td colSpan={2} className="px-3 text-xs text-slate-400">-</td> : <>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button type="button" onClick={() => setVals({ ...vals, [r.key]: fmt(gap(r)) })} className="mr-2 text-xs text-blue-700 hover:underline">ตามสัญญา</button>
                      <input inputMode="decimal" value={v} aria-label={`ยอดที่ได้รับ ${r.property}`} placeholder={r.currency}
                        onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })} className={`w-32 text-right ${small}`} />
                    </td>
                    <td className="px-3">
                      <select value={bank[r.key] ?? ""} onChange={(e) => setBank({ ...bank, [r.key]: e.target.value })} className={`max-w-[14rem] ${small}`}>
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
      {canWrite && open.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending || chosen.length === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกรับค่าเช่า ${chosen.length} รายการ`}
          </button>
          {chosen.length > 0 && !pending && <button type="button" onClick={() => setVals({})} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
        </div>
      )}
      <p className="text-xs text-slate-500">ค่าน้ำไฟเรียกเก็บผู้เช่าที่ยังไม่ได้รับคืนแสดงต่อท้าย (นับเป็นรายได้อื่น ไม่ใช่ค่าเช่า) · กรอกยอดเฉพาะสัญญาที่ได้รับแล้ว (ช่องว่าง = ไม่บันทึก) · รายการไหนผิด จะไม่บันทึกเลยทั้งชุด · ยกเว้นงวด / แก้ไขรายการ ทำที่หน้าของทรัพย์สิน</p>
    </form>
    </>
  );
}
