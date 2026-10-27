"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { money, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { batchPayDebts, type ActionState } from "./actions";

export type DebtRow = {
  key: string; kind: "LOAN" | "CARD"; id: string; href: string; name: string; sub: string | null; currency: string;
  balance: number; monthly: number | null; dueDay: number | null; autopay: boolean; defaultBank: string;
};
export type BankOpt = { id: string; name: string; currency: string };

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (s: string) => Number((s ?? "").replace(/,/g, ""));

/**
 * แท็บ "จ่ายชำระเงินกู้/บัตรเครดิต" ของหน้า Liabilities (ตกลง 27 ต.ค. 2026)
 *   เงินกู้: เงินต้น (ลดยอดหนี้) + ดอกเบี้ย (ค่าใช้จ่าย "ดอกเบี้ยจ่าย") · บัตร: ยอดที่จ่าย (บัตรตัดอัตโนมัติ = ยืนยันว่าตัดแล้ว)
 *   วันที่ช่องเดียวใช้กับทุกแถว · ช่องยอดว่าง = ไม่บันทึก · กดบันทึกครั้งเดียว · ผิดแถวเดียว = ไม่บันทึกเลย
 */
export default function PayBatch({ rows, banks, today, minDate, canWrite }: {
  rows: DebtRow[]; banks: BankOpt[]; today: string; minDate: string; canWrite: boolean;
}) {
  const router = useRouter();
  const cf = useConfirmSubmit();
  const [date, setDate] = useState(today);
  const [pr, setPr] = useState<Record<string, string>>({});     // เงินต้น (เงินกู้) / ยอดที่จ่าย (บัตร)
  const [int, setInt] = useState<Record<string, string>>({});   // ดอกเบี้ย (เงินกู้)
  const [bank, setBank] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.key, r.defaultBank])));
  const [state, action, pending] = useActionState<ActionState, FormData>(batchPayDebts, {});
  useEffect(() => { if (state.ok) { setPr({}); setInt({}); router.refresh(); } }, [state, router]);

  const has = (r: DebtRow) => (pr[r.key] ?? "").trim() !== "" || (r.kind === "LOAN" && (int[r.key] ?? "").trim() !== "");
  const chosen = rows.filter(has);
  const payload = chosen.map((r) => ({ kind: r.kind, id: r.id, label: r.name, bank_asset_id: bank[r.key] ?? "", autopay: r.autopay,
    ...(r.kind === "LOAN" ? { principal: pr[r.key] ?? "", interest: int[r.key] ?? "" } : { amount: pr[r.key] ?? "" }) }));
  const bankName = new Map(banks.map((b) => [b.id, b.name]));
  const total = (r: DebtRow) => (pr[r.key]?.trim() ? n(pr[r.key]) : 0) + (r.kind === "LOAN" && int[r.key]?.trim() ? n(int[r.key]) : 0);
  const onSubmit = cf.guard(`บันทึกจ่าย ${chosen.length} รายการ วันที่ ${thDate(date)} ?\n${chosen.map((r) =>
    `• ${r.name} ${fmt(total(r))}${r.kind === "LOAN" && int[r.key]?.trim() ? ` (ดอกเบี้ย ${int[r.key]})` : ""} จาก ${bankName.get(bank[r.key] ?? "") ?? "(ยังไม่เลือกบัญชี)"}`).join("\n")}`,
    { okLabel: "ยืนยันบันทึก" });
  const loans = rows.filter((r) => r.kind === "LOAN");
  const cards = rows.filter((r) => r.kind === "CARD");

  const bankSel = (r: DebtRow) => (
    <select value={bank[r.key] ?? ""} onChange={(e) => setBank({ ...bank, [r.key]: e.target.value })} className={`max-w-[14rem] ${small}`} aria-label={`จ่ายจาก ${r.name}`}>
      <option value="">— เลือกบัญชี —</option>
      {banks.filter((b) => b.currency === r.currency).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
  const nameCell = (r: DebtRow) => (
    <td className="px-3 py-2">
      <Link href={r.href} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
      {r.sub && <div className="text-xs text-slate-500">{r.sub}</div>}
    </td>
  );

  return (
    <>
    {cf.dialog}
    <form action={action} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <label className="flex items-center gap-2">วันที่จ่าย
            <input type="date" value={date} min={minDate || undefined} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={small} />
          </label>
          <span className="text-xs text-slate-500">ใช้กับทุกแถวที่กรอก · ช่องยอดว่าง = ไม่บันทึก</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <h2 className="font-medium text-slate-900">เงินกู้</h2>
          {canWrite && loans.some((r) => r.monthly) && (
            <button type="button" onClick={() => setPr({ ...pr, ...Object.fromEntries(loans.filter((r) => r.monthly).map((r) => [r.key, fmt(r.monthly!)])) })}
              className="text-sm text-blue-700 hover:underline">ใส่ค่างวดเป็นเงินต้นทุกแถว</button>
          )}
        </div>
        <table className="mt-3 w-full min-w-[56rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">เงินกู้</th><th className="px-3 text-right">ยอดหนี้คงค้าง</th><th className="px-3 text-right">ค่างวด / วันที่จ่าย</th>
              {canWrite && <><th className="px-3 text-right">เงินต้น</th><th className="px-3 text-right">ดอกเบี้ย</th><th className="px-3">จ่ายจาก</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loans.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">ไม่มีเงินกู้ที่ยังผ่อนอยู่</td></tr>}
            {loans.map((r) => (
              <tr key={r.key} className={has(r) ? "bg-blue-50/40" : ""}>
                {nameCell(r)}
                <td className="px-3 text-right tabular-nums">{money(r.balance, r.currency)}</td>
                <td className="px-3 text-right text-xs tabular-nums">{r.monthly ? money(r.monthly, r.currency) : "-"}{r.dueDay ? <div className="text-slate-500">ทุกวันที่ {r.dueDay}</div> : null}</td>
                {canWrite && <>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {r.monthly ? <button type="button" onClick={() => setPr({ ...pr, [r.key]: fmt(r.monthly!) })} className="mr-2 text-xs text-blue-700 hover:underline">ตามค่างวด</button> : null}
                    <input inputMode="decimal" value={pr[r.key] ?? ""} placeholder={r.currency} aria-label={`เงินต้น ${r.name}`}
                      onChange={(e) => setPr({ ...pr, [r.key]: e.target.value })} className={`w-32 text-right ${small}`} />
                  </td>
                  <td className="px-3 text-right"><input inputMode="decimal" value={int[r.key] ?? ""} aria-label={`ดอกเบี้ย ${r.name}`}
                    onChange={(e) => setInt({ ...int, [r.key]: e.target.value })} className={`w-28 text-right ${small}`} /></td>
                  <td className="px-3">{bankSel(r)}</td>
                </>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <h2 className="font-medium text-slate-900">บัตรเครดิต</h2>
          {canWrite && cards.some((r) => r.balance > 0) && (
            <button type="button" onClick={() => setPr({ ...pr, ...Object.fromEntries(cards.filter((r) => r.balance > 0).map((r) => [r.key, fmt(r.balance)])) })}
              className="text-sm text-blue-700 hover:underline">ใส่ยอดค้างเต็มจำนวนทุกบัตร</button>
          )}
        </div>
        <table className="mt-3 w-full min-w-[56rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">บัตร</th><th className="px-3 text-right">ยอดค้างปัจจุบัน</th><th className="px-3 text-right">ชำระภายใน</th>
              {canWrite && <><th className="px-3 text-right">ยอดที่จ่าย</th><th className="px-3">จ่ายจาก</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cards.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">ไม่มีบัตรที่ใช้งานอยู่</td></tr>}
            {cards.map((r) => (
              <tr key={r.key} className={has(r) ? "bg-blue-50/40" : ""}>
                {nameCell(r)}
                <td className="px-3 text-right tabular-nums">{money(r.balance, r.currency)}</td>
                <td className="px-3 text-right text-xs">{r.dueDay ? `วันที่ ${r.dueDay}` : "-"}{r.autopay && <div className="text-blue-700">ตัดบัญชีอัตโนมัติ</div>}</td>
                {canWrite && <>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {r.balance > 0 && <button type="button" onClick={() => setPr({ ...pr, [r.key]: fmt(r.balance) })} className="mr-2 text-xs text-blue-700 hover:underline">เต็มจำนวน</button>}
                    <input inputMode="decimal" value={pr[r.key] ?? ""} placeholder={r.currency} aria-label={`ยอดที่จ่าย ${r.name}`}
                      onChange={(e) => setPr({ ...pr, [r.key]: e.target.value })} className={`w-32 text-right ${small}`} />
                  </td>
                  <td className="px-3">{bankSel(r)}</td>
                </>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending || chosen.length === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกจ่าย ${chosen.length} รายการ`}
          </button>
          {chosen.length > 0 && !pending && <button type="button" onClick={() => { setPr({}); setInt({}); }} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
        </div>
      )}
      <p className="text-xs text-slate-500">เงินต้นลดยอดหนี้ · ดอกเบี้ยลงค่าใช้จ่าย &ldquo;ดอกเบี้ยจ่าย&rdquo; · จ่ายบัตรไม่เปลี่ยนยอด Statement (ยอดปัจจุบันลดตามการจ่าย) · จ่ายบัตรจากบัญชีเงินฝากในพอร์ต / อัปเดตยอดตาม Statement ทำที่หน้าบัตร / หน้าเงินกู้ · รายการไหนผิด จะไม่บันทึกเลยทั้งชุด</p>
    </form>
    </>
  );
}
