"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { batchReceiveLoans, type ActionState } from "./actions";

export type LoanRow = {
  id: string; name: string; borrower: string; currency: string;
  /** งวดในเดือนที่เลือก + งวดที่ค้างจากเดือนก่อน */
  lines: { no: number; due: string; total: number; remaining: number; status: string; statusText: string; statusCls: string; carried: boolean }[];
  /** ยอดที่ถึงกำหนดถึงสิ้นเดือน (ยังไม่ได้รับ) */
  dueP: number; dueI: number; defaultBank: string;
};
export type BankOpt = { id: string; name: string; currency: string };

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const fmt = (v: number) => (v ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
const n = (s: string | undefined) => Number((s ?? "").replace(/,/g, "")) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * แท็บ "บันทึกรับชำระคืนเงินกู้" (ตกลง 27 ต.ค. 2026 · แบบเดียวกับแท็บบันทึกของเมนูอื่น)
 *   1 แถว = 1 สัญญา · ยอดรวมที่รับ → แบ่งให้เอง: หักดอกเบี้ยที่ถึงกำหนดก่อน ที่เหลือเป็นเงินต้น · แก้ 2 ช่องเองได้
 *   วันที่ช่องเดียวใช้กับทุกแถว · ช่องว่าง = ไม่บันทึก · กดบันทึกครั้งเดียว · ผิดแถวเดียว = ไม่บันทึกเลย
 *   เงินต้นที่รับไม่เท่าที่ถึงกำหนด (เกิน / ขาด) → หลังบันทึกถาม: ตารางเดิม หรือ "คำนวณงวดที่เหลือใหม่" ของสัญญานั้น
 */
export default function LoanBatch({ rows, others, banks, today, minDate, canWrite }: {
  rows: LoanRow[]; others: LoanRow[]; banks: BankOpt[]; today: string; minDate: string; canWrite: boolean;
}) {
  const router = useRouter();
  const cf = useConfirmSubmit();
  const [date, setDate] = useState(today);
  const [showOthers, setShowOthers] = useState(false);
  const [tot, setTot] = useState<Record<string, string>>({});
  const [pr, setPr] = useState<Record<string, string>>({});
  const [int, setInt] = useState<Record<string, string>>({});
  const [tax, setTax] = useState<Record<string, string>>({});
  const all = [...rows, ...others];
  const [bank, setBank] = useState<Record<string, string>>(() => Object.fromEntries(all.map((r) => [r.id, r.defaultBank])));
  const [state, action, pending] = useActionState<ActionState, FormData>(batchReceiveLoans, {});
  const sent = useRef<{ id: string; name: string; extra: number }[]>([]);
  const [over, setOver] = useState<{ id: string; name: string; extra: number }[]>([]);
  useEffect(() => {
    if (!state.ok) return;
    setOver(sent.current); setTot({}); setPr({}); setInt({}); setTax({}); router.refresh();
  }, [state, router]);

  const shown = showOthers ? all : rows;
  const has = (r: LoanRow) => (pr[r.id] ?? "").trim() !== "" || (int[r.id] ?? "").trim() !== "";
  const chosen = shown.filter(has);
  const payload = chosen.map((r) => ({ loan_asset_id: r.id, label: r.name, bank_asset_id: bank[r.id] ?? "",
    principal: pr[r.id] ?? "", interest: int[r.id] ?? "", interest_tax: tax[r.id] ?? "" }));
  const bankName = new Map(banks.map((b) => [b.id, b.name]));
  const total = (r: LoanRow) => n(pr[r.id]) + n(int[r.id]);
  const split = (r: LoanRow, v: string) => {
    setTot({ ...tot, [r.id]: v });
    if (v.trim() === "") { setPr({ ...pr, [r.id]: "" }); setInt({ ...int, [r.id]: "" }); return; }
    const t = n(v), i = r2(Math.min(t, Math.max(r.dueI, 0)));
    setInt({ ...int, [r.id]: fmt(i) || (r.dueI > 0 ? "0.00" : "") }); setPr({ ...pr, [r.id]: fmt(r2(t - i)) });
  };
  const fill = (list: LoanRow[]) => {
    const p = { ...pr }, i = { ...int }, t = { ...tot };
    list.filter((r) => r.dueP + r.dueI > 0.005).forEach((r) => { p[r.id] = fmt(r.dueP); i[r.id] = fmt(r.dueI); t[r.id] = fmt(r2(r.dueP + r.dueI)); });
    setPr(p); setInt(i); setTot(t);
  };
  const guard = cf.guard(`บันทึกรับชำระ ${chosen.length} สัญญา วันที่ ${thDate(date)} ?\n${chosen.map((r) =>
    `• ${r.name} ${fmt(total(r)) || "0.00"} (เงินต้น ${pr[r.id] || "0.00"} · ดอกเบี้ย ${int[r.id] || "0.00"}) เข้า ${bankName.get(bank[r.id] ?? "") ?? "(ยังไม่เลือกบัญชี)"}`).join("\n")}`,
    { okLabel: "ยืนยันบันทึก" });
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    sent.current = chosen.map((r) => ({ id: r.id, name: r.name, extra: r2(n(pr[r.id]) - r.dueP) })).filter((x) => Math.abs(x.extra) > 0.01);
    guard(e);
  };

  const row = (r: LoanRow) => {
    const done = r.lines.length > 0 && r.lines.every((x) => x.status === "PAID");
    return (
      <tr key={r.id} className={`align-top ${has(r) ? "bg-blue-50/40" : ""}`}>
        <td className="min-w-[10rem] px-3 py-2">
          <Link href={`/financial/loans/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
          <div className="text-xs text-slate-500">{r.borrower}</div>
        </td>
        <td className="min-w-[15rem] px-3 py-2 text-xs">
          {r.lines.length === 0 ? <span className="text-slate-400">ไม่มีงวดในเดือนนี้</span> : r.lines.map((x) => (
            <div key={x.no}>งวด {x.no} · {thDate(x.due)} · {money(x.total)}{" "}
              <span className={`whitespace-nowrap rounded px-1 ${x.statusCls}`}>{x.statusText}</span>
              {x.status !== "PAID" && x.remaining < x.total - 0.005 && <span className="text-slate-500"> ค้าง {money(x.remaining)}</span>}
              {x.carried && <span className="text-red-600"> · ค้างจากเดือนก่อน</span>}
            </div>
          ))}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">
          {r.dueP + r.dueI > 0.005 ? <>{money(r2(r.dueP + r.dueI), r.currency)}<div className="text-slate-500">ต้น {money(r.dueP)} · ดอก {money(r.dueI)}</div></> : <span className="text-slate-400">-</span>}
        </td>
        {canWrite && (done ? <td colSpan={2} className="px-3 py-2 text-xs text-emerald-700">รับครบแล้ว ✓</td> : <>
          <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-slate-500">
            {/* 2 บรรทัดแบบคอลัมน์ "ถึงกำหนด": บน = ยอดรวม · ภาษี · ล่าง = เงินต้น · ดอกเบี้ย */}
            <div className="flex items-center justify-end gap-1.5">
              {r.dueP + r.dueI > 0.005 && <button type="button" onClick={() => fill([r])} className="mr-1 text-blue-700 hover:underline">ตามงวด</button>}
              <input inputMode="decimal" value={tot[r.id] ?? ""} onChange={(e) => split(r, e.target.value)} data-money="off" placeholder={`ยอดรวม ${r.currency}`}
                aria-label={`ยอดรวมที่รับ ${r.name}`} className={`w-28 text-right ${small}`} />
              <span className="ml-1">ภาษี</span>
              <input inputMode="decimal" value={tax[r.id] ?? ""} aria-label={`ภาษีหัก ณ ที่จ่าย ${r.name}`}
                onChange={(e) => setTax({ ...tax, [r.id]: e.target.value })} className={`w-24 text-right ${small}`} />
            </div>
            <div className="mt-1 flex items-center justify-end gap-1.5">
              <span>ต้น</span>
              <input inputMode="decimal" value={pr[r.id] ?? ""} aria-label={`เงินต้น ${r.name}`}
                onChange={(e) => { setPr({ ...pr, [r.id]: e.target.value }); setTot({ ...tot, [r.id]: fmt(r2(n(e.target.value) + n(int[r.id]))) }); }}
                className={`w-28 text-right ${small}`} />
              <span className="ml-1">ดอก</span>
              <input inputMode="decimal" value={int[r.id] ?? ""} aria-label={`ดอกเบี้ย ${r.name}`}
                onChange={(e) => { setInt({ ...int, [r.id]: e.target.value }); setTot({ ...tot, [r.id]: fmt(r2(n(pr[r.id]) + n(e.target.value))) }); }}
                className={`w-28 text-right ${small}`} />
            </div>
          </td>
          <td className="px-3 py-2">
            <select value={bank[r.id] ?? ""} onChange={(e) => setBank({ ...bank, [r.id]: e.target.value })} className={`w-full max-w-[11rem] ${small}`} aria-label={`เข้าบัญชี ${r.name}`}>
              <option value="">— เลือกบัญชี —</option>
              {banks.filter((b) => b.currency === r.currency).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </td>
        </>)}
      </tr>
    );
  };

  return (
    <>
    {cf.dialog}
    <form action={action} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <label className="flex items-center gap-2">วันที่ได้รับ
            <input type="date" value={date} min={minDate || undefined} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={small} />
          </label>
          <span className="text-xs text-slate-500">ใช้กับทุกแถวที่กรอก · ช่องว่าง = ไม่บันทึก · ยอดรวมแบ่งให้เอง: หักดอกเบี้ยที่ถึงกำหนดก่อน ที่เหลือเป็นเงินต้น</span>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <label className="inline-flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} />
            แสดงสัญญาอื่นที่ยังไม่ปิด ({others.length})</label>
          {canWrite && shown.some((r) => r.dueP + r.dueI > 0.005) && (
            <button type="button" onClick={() => fill(shown)} className="text-sm text-blue-700 hover:underline">ใส่ยอดตามงวดทุกแถว</button>
          )}
        </div>
        <table className="mt-3 w-full min-w-[52rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">สัญญา / ผู้กู้</th><th className="px-3">งวด</th><th className="px-3 text-right">ถึงกำหนด (ยังไม่รับ)</th>
              {canWrite && <><th className="px-3 py-2 text-right">ยอดรวมที่รับ · ภาษีหัก ณ ที่จ่าย<div className="font-normal">เงินต้น · ดอกเบี้ย (Gross)</div></th>
                <th className="px-3">เข้าบัญชี</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={canWrite ? 5 : 3} className="px-4 py-6 text-center text-slate-500">ไม่มีงวดที่ต้องรับในเดือนนี้</td></tr>}
            {shown.map(row)}
          </tbody>
        </table>
      </div>
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending || chosen.length === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกรับ ${chosen.length} สัญญา`}
          </button>
          {chosen.length > 0 && !pending && <button type="button" onClick={() => { setTot({}); setPr({}); setInt({}); setTax({}); }} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
        </div>
      )}
      {state.ok && over.length > 0 && (
        <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-slate-900">เงินต้นที่รับไม่เท่างวด — จะคำนวณงวดที่เหลือใหม่จากเงินต้นคงเหลือจริงไหม? (ดอกเบี้ยงวดที่เหลือคิดใหม่ตามยอดคงเหลือ)</p>
          {over.map((x) => (
            <p key={x.id}>{x.name} {x.extra > 0 ? "เกิน" : "ขาด"} {money(Math.abs(x.extra))} ·{" "}
              <Link href={`/financial/loans/${x.id}?restructure=end`} className="text-blue-700 hover:underline">{x.extra > 0 ? "ลดค่างวด" : "เพิ่มค่างวด"} (จบวันเดิม)</Link>{" · "}
              <Link href={`/financial/loans/${x.id}?restructure=payment`} className="text-blue-700 hover:underline">{x.extra > 0 ? "จบเร็วขึ้น" : "ขยายงวด"} (ค่างวดเดิม)</Link></p>
          ))}
          <p className="text-xs text-slate-500">ไม่ปรับก็ได้ — ตารางเดิม: ส่วนที่เกินหักงวดถัดไปตามลำดับ · ส่วนที่ขาดเป็นยอดค้างของงวดนั้น</p>
        </div>
      )}
    </form>
    </>
  );
}
