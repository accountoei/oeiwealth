"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HOLDING_TYPE_LABEL, money, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { batchInvestmentIncome, type ActionState, type BatchIncomeRow } from "./actions";
import { MaturityForm, type Bank, type CashAcct } from "./[id]/forms";

// แท็บ "รอรับเดือนนี้" (ส่วนที่กรอกได้): ดอกเบี้ย / Coupon หลายรายการ + ดอกเบี้ยบัญชีเงินฝากในพอร์ต → กดบันทึกครั้งเดียว
//   เงินต้นครบกำหนดยังบันทึกทีละรายการ (ถามยืนยัน + ปิดหลักทรัพย์) · ผิดแถวเดียว = ไม่บันทึกเลยทั้งชุด

export type DueItem = {
  key: string; kind: "INTEREST" | "PRINCIPAL"; label: string; due: string; expected: number | null;
  received: { date: string; amount: number } | null; defaultDate: string;
  holding: { id: string; name: string; holding_type: string; currency: string; status: string };
};
export type DueGroup = { pf: string; name: string; rows: DueItem[] };
export type PfCash = CashAcct & { pf: string; pfName: string; rate: number | null; received: number };

export function DueStatus({ due, received, today }: { due: string; received: { date: string } | null; today: string }) {
  if (received) return <span className="text-emerald-700">รับแล้ว {thDate(received.date)}</span>;
  if (due < today) {
    const d = Math.round((Date.parse(today) - Date.parse(due)) / 86400000);
    return <span className="text-red-700">ค้างรับ · เลยกำหนด {d} วัน</span>;
  }
  if (due === today) return <span className="text-amber-700">ถึงกำหนดวันนี้</span>;
  return <span className="text-slate-500">รอรับ (ยังไม่ถึงกำหนด)</span>;
}

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const n = (s: string) => Number((s ?? "").replace(/,/g, ""));
const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TAX_RATE = 0.15;

export default function DueBatch({ groups, cash, banks, today, minDate, defaultDate, canWrite }: {
  groups: DueGroup[]; cash: PfCash[]; banks: Bank[]; today: string; minDate: string; defaultDate: string; canWrite: boolean;
}) {
  const router = useRouter();
  const cf = useConfirmSubmit();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [tax, setTax] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const [dest, setDest] = useState<Record<string, string>>({});
  const [state, action, pending] = useActionState<ActionState, FormData>(batchInvestmentIncome, {});
  useEffect(() => { if (state.ok) { setVals({}); setTax({}); router.refresh(); } }, [state, router]);

  // ปลายทาง: บัญชีเงินฝากในพอร์ต (สกุลเดียวกัน · บัญชีหลักก่อน) หรือบัญชีธนาคาร
  const pfCash = (pf: string, ccy: string) => cash.filter((c) => c.pf === pf && c.currency === ccy).sort((a, b) => Number(b.is_default_cash) - Number(a.is_default_cash));
  const destOf = (pf: string, it: DueItem) => dest[it.key] ?? (pfCash(pf, it.holding.currency)[0] ? `c:${pfCash(pf, it.holding.currency)[0].id}`
    : banks.find((b) => b.currency === it.holding.currency) ? `b:${banks.find((b) => b.currency === it.holding.currency)!.asset_id}` : "");

  type Line = BatchIncomeRow & { title: string };
  const lines: Line[] = [];
  groups.forEach((g) => g.rows.forEach((it) => {
    if (it.kind !== "INTEREST" || it.received || !(vals[it.key] ?? "").trim()) return;
    const d = destOf(g.pf, it);
    lines.push({ portfolio_asset_id: g.pf, type: "COUPON", holding_id: it.holding.id, date: dates[it.key] ?? it.defaultDate,
      amount: vals[it.key], tax: tax[it.key] ?? "", cash_holding_id: d.startsWith("c:") ? d.slice(2) : null, bank_asset_id: d.startsWith("b:") ? d.slice(2) : null,
      notes: `${it.label} (ครบ ${thDate(it.due)})`, title: `${it.holding.name} · ${it.label}` });
  }));
  cash.forEach((c) => {
    const k = `cash:${c.id}`;
    if (!(vals[k] ?? "").trim()) return;
    lines.push({ portfolio_asset_id: c.pf, type: "INTEREST", holding_id: c.id, date: dates[k] ?? defaultDate, amount: vals[k], tax: tax[k] ?? "",
      cash_holding_id: null, bank_asset_id: null, notes: "", title: `${c.pfName} · ${c.name} · ดอกเบี้ยเงินฝาก` });
  });
  const keysWithVals = Object.keys(vals).filter((k) => (vals[k] ?? "").trim() && !Number.isNaN(n(vals[k])));
  const taxAll = () => setTax({ ...tax, ...Object.fromEntries(keysWithVals.map((k) => [k, fmt(Math.round(n(vals[k]) * TAX_RATE * 100) / 100)])) });
  const onSubmit = cf.guard(`บันทึกรับ ${lines.length} รายการ ?\n${lines.map((l) => `• ${l.title} ${l.amount}${l.tax.trim() ? ` (ภาษี ${l.tax})` : ""} · ${thDate(l.date)}`).join("\n")}`,
    { okLabel: "ยืนยันบันทึก" });

  const inputs = (k: string, ccy: string, date: string, expected: number | null) => {
    const v = vals[k] ?? "";
    return (<>
      <td className="whitespace-nowrap px-2 py-2 text-right">
        {expected != null && <button type="button" onClick={() => setVals({ ...vals, [k]: fmt(expected) })} className="mr-1 text-xs text-blue-700 hover:underline">ตามตาราง</button>}
        <input inputMode="decimal" value={v} placeholder={ccy} aria-label="ยอดก่อนภาษี" onChange={(e) => setVals({ ...vals, [k]: e.target.value })} className={`w-28 text-right ${small}`} />
      </td>
      <td className="px-2"><input inputMode="decimal" value={tax[k] ?? ""} disabled={!v.trim()} aria-label="ภาษีหัก ณ ที่จ่าย"
        onChange={(e) => setTax({ ...tax, [k]: e.target.value })} className={`w-24 text-right ${small}`} /></td>
      <td className="px-2"><input type="date" value={dates[k] ?? date} min={minDate || undefined} max={today} aria-label="วันที่รับ"
        onChange={(e) => e.target.value && setDates({ ...dates, [k]: e.target.value })} className={small} /></td>
    </>);
  };
  const head = (
    <thead className="bg-slate-50 text-left text-xs text-slate-500">
      <tr><th className="px-3 py-2">หลักทรัพย์</th><th className="px-3">รายการ</th><th className="px-3">วันครบกำหนด</th>
        <th className="px-3 text-right">ยอดคาดว่าจะได้รับ</th><th className="px-3">สถานะ</th>
        {canWrite && <><th className="px-2 text-right">ยอดก่อนภาษี</th><th className="px-2">ภาษี</th><th className="px-2">วันที่รับ</th><th className="px-2">เข้าบัญชี</th></>}</tr>
    </thead>
  );

  return (
    <>
    {cf.dialog}
    {/* ช่องกรอกอยู่นอก <form> (เก็บใน state) → ฟอร์มเงินต้นครบกำหนดของแต่ละแถวไม่ซ้อนอยู่ในฟอร์มนี้ */}
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.pf} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <h2 className="px-4 pt-4 font-medium text-slate-900"><Link href={`/investments/${g.pf}`} className="hover:underline">{g.name}</Link></h2>
          <table className="mt-2 w-full min-w-[78rem] text-sm">
            {head}
            <tbody className="divide-y divide-slate-100">
              {g.rows.map((it) => {
                const h = it.holding;
                const open = canWrite && !it.received;
                const d = destOf(g.pf, it);
                return (
                  <tr key={it.key} className={`${it.received ? "text-slate-500" : ""} ${(vals[it.key] ?? "").trim() ? "bg-blue-50/40" : ""}`}>
                    <td className="break-words px-3 py-2.5"><Link href={`/investments/${g.pf}/holding/${h.id}`} className="font-medium text-slate-900 hover:underline">{h.name}</Link>
                      <div className="text-xs text-slate-400">{HOLDING_TYPE_LABEL[h.holding_type] ?? h.holding_type} · {h.currency}</div></td>
                    <td className="px-3 py-2.5">{it.label}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{thDate(it.due)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{it.expected != null ? money(it.expected, h.currency) : "-"}
                      {it.received && <div className="text-xs text-emerald-700">ได้รับ {money(it.received.amount, h.currency)}</div>}</td>
                    <td className="px-3 py-2.5 text-xs"><DueStatus due={it.due} received={it.received} today={today} /></td>
                    {canWrite && (!open ? <td colSpan={4} /> : it.kind === "INTEREST" ? <>
                      {inputs(it.key, h.currency, it.defaultDate, it.expected)}
                      <td className="px-2">
                        <select value={d} onChange={(e) => setDest({ ...dest, [it.key]: e.target.value })} className={`max-w-[13rem] ${small}`} aria-label="เข้าบัญชี">
                          {pfCash(g.pf, h.currency).map((c) => <option key={c.id} value={`c:${c.id}`}>ในพอร์ต · {c.name}</option>)}
                          {banks.filter((b) => b.currency === h.currency).map((b) => <option key={b.asset_id} value={`b:${b.asset_id}`}>ธนาคาร · {b.name}</option>)}
                        </select>
                      </td>
                    </> : (
                      <td colSpan={4} className="px-2 py-2 text-right">
                        {h.status === "ACTIVE" && <MaturityForm assetId={g.pf} portfolioName={g.name} banks={banks} cashAccounts={cash.filter((c) => c.pf === g.pf)}
                          holding={{ id: h.id, name: h.name, symbol: null, holding_type: h.holding_type, currency: h.currency, quantity: 0, current_price: null, status: h.status }}
                          today={today} minDate={minDate} label="บันทึกรับเงินต้น" defaultAmount={it.expected} defaultDate={it.defaultDate} />}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      {cash.length > 0 && (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <h2 className="px-4 pt-4 font-medium text-slate-900">ดอกเบี้ยบัญชีเงินฝากในพอร์ต</h2>
          <p className="px-4 text-xs text-slate-500">ดอกเบี้ยเข้าบัญชีนั้นเอง · รับแล้ว = ดอกเบี้ยสุทธิที่บันทึกในเดือนที่เลือก</p>
          <table className="mt-2 w-full min-w-[60rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-3 py-2">พอร์ต / บัญชี</th><th className="px-3 text-right">อัตรา</th><th className="px-3 text-right">รับแล้ว</th>
                {canWrite && <><th className="px-2 text-right">ยอดก่อนภาษี</th><th className="px-2">ภาษี</th><th className="px-2">วันที่รับ</th></>}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cash.map((c) => (
                <tr key={c.id} className={(vals[`cash:${c.id}`] ?? "").trim() ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2"><Link href={`/investments/${c.pf}/cash/${c.id}`} className="font-medium text-slate-900 hover:underline">{c.name}</Link>
                    <div className="text-xs text-slate-400">{c.pfName} · {c.currency}{c.is_default_cash ? " · บัญชีหลัก" : ""}</div></td>
                  <td className="px-3 text-right tabular-nums">{c.rate != null ? `${c.rate.toFixed(2)}%` : <span className="text-slate-400">-</span>}</td>
                  <td className="px-3 text-right tabular-nums">{c.received > 0 ? <span className="text-emerald-700">{money(c.received, c.currency)}</span> : <span className="text-slate-400">-</span>}</td>
                  {canWrite && inputs(`cash:${c.id}`, c.currency, defaultDate, null)}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {canWrite && (groups.some((g) => g.rows.some((r) => r.kind === "INTEREST" && !r.received)) || cash.length > 0) && (
        <form action={action} onSubmit={onSubmit} className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/95 py-3">
          <input type="hidden" name="rows" value={JSON.stringify(lines.map((l) => ({ ...l, title: undefined })))} />
          <button disabled={pending || lines.length === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกรับ ${lines.length} รายการ`}
          </button>
          {keysWithVals.length > 0 && !pending && <button type="button" onClick={taxAll} className="text-sm text-blue-700 hover:underline">คิดภาษี 15% ทุกแถวที่กรอก</button>}
          {lines.length > 0 && !pending && <button type="button" onClick={() => { setVals({}); setTax({}); }} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
        </form>
      )}
    </div>
    </>
  );
}
