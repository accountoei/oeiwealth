"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HOLDING_TYPE_LABEL, money, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { bankId, endpointValue, holdingId, parseEndpoint } from "@/lib/money-endpoint";
import { batchInvestmentIncome, type ActionState, type BatchIncomeRow } from "./actions";
import type { Bank, CashAcct } from "./[id]/forms";

// แท็บ "รอรับเดือนนี้" (ส่วนที่กรอกได้) — ตารางเดียวทุกพอร์ต (ตกลง 24 ต.ค. 2026):
//   ดอกเบี้ย / Coupon · เงินต้นครบกำหนด · ดอกเบี้ยบัญชีเงินฝากในพอร์ต → กดบันทึกครั้งเดียว (ผิดแถวเดียว = ไม่บันทึกเลยทั้งชุด)
//   ด้านบน (แบบแท็บรับดอกเบี้ยของ Cash & Bank): ตัวกรองพอร์ต + กรอกตามตารางทุกแถว · คิดภาษี 15% + วันที่รับ (ใช้กับทุกแถว)
//   เงินต้นไม่ใช่รายได้ · บันทึกแล้วหลักทรัพย์ปิดเป็น "ครบกำหนด" (batch_record_investment_income → record_holding_maturity)

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

/** แถวในตาราง: รายการตามตาราง (ดอกเบี้ย / เงินต้น) หรือดอกเบี้ยบัญชีเงินฝากในพอร์ต */
type Row = { key: string; pf: string; pfName: string; currency: string; item?: DueItem; cash?: PfCash };

export default function DueBatch({ groups, cash, banks, today, minDate, defaultDate, canWrite }: {
  groups: DueGroup[]; cash: PfCash[]; banks: Bank[]; today: string; minDate: string; defaultDate: string; canWrite: boolean;
}) {
  const router = useRouter();
  const cf = useConfirmSubmit();
  const [pf, setPf] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [tax, setTax] = useState<Record<string, string>>({});
  const [dest, setDest] = useState<Record<string, string>>({});
  const [state, action, pending] = useActionState<ActionState, FormData>(batchInvestmentIncome, {});
  useEffect(() => { if (state.ok) { setVals({}); setTax({}); router.refresh(); } }, [state, router]);

  const rows: Row[] = [
    ...groups.flatMap((g) => g.rows.map((it) => ({ key: it.key, pf: g.pf, pfName: g.name, currency: it.holding.currency, item: it }))),
    ...cash.map((c) => ({ key: `cash:${c.id}`, pf: c.pf, pfName: c.pfName, currency: c.currency, cash: c })),
  ];
  const pfList = [...new Map(rows.map((r) => [r.pf, r.pfName])).entries()].sort((a, b) => a[1].localeCompare(b[1], "th"));
  const shown = rows.filter((r) => !pf || r.pf === pf);
  // แถวที่กรอกได้: รายการที่ยังไม่รับ (เงินต้น = หลักทรัพย์ยังถืออยู่) · ดอกเบี้ยเงินฝากกรอกได้ทุกเดือน
  const editable = (r: Row) => canWrite && (r.cash ? true : !r.item!.received && (r.item!.kind === "INTEREST" || r.item!.holding.status === "ACTIVE"));

  // ปลายทาง (ดอกเบี้ย / เงินต้นของหลักทรัพย์): บัญชีเงินฝากในพอร์ต (สกุลเดียวกัน · บัญชีหลักก่อน) หรือบัญชีธนาคาร
  const pfCash = (p: string, ccy: string) => cash.filter((c) => c.pf === p && c.currency === ccy).sort((a, b) => Number(b.is_default_cash) - Number(a.is_default_cash));
  const destOf = (r: Row) => dest[r.key] ?? (pfCash(r.pf, r.currency)[0] ? endpointValue({ kind: "portfolio", id: pfCash(r.pf, r.currency)[0].id })
    : banks.find((b) => b.currency === r.currency) ? endpointValue({ kind: "bank", id: banks.find((b) => b.currency === r.currency)!.asset_id }) : "");

  const filled = (r: Row) => editable(r) && (vals[r.key] ?? "").trim() !== "";
  type Line = BatchIncomeRow & { title: string };
  const lines: Line[] = rows.filter(filled).map((r) => {
    if (r.cash) return { portfolio_asset_id: r.pf, type: "INTEREST", holding_id: r.cash.id, date, amount: vals[r.key], tax: tax[r.key] ?? "",
      cash_holding_id: null, bank_asset_id: null, notes: "", title: `${r.pfName} · ${r.cash.name} · ดอกเบี้ยเงินฝาก` };
    const it = r.item!, d = parseEndpoint(destOf(r));
    return { portfolio_asset_id: r.pf, type: it.kind === "PRINCIPAL" ? "MATURITY" : "COUPON", holding_id: it.holding.id, date,
      amount: vals[r.key], tax: tax[r.key] ?? "", cash_holding_id: holdingId(d), bank_asset_id: bankId(d),
      notes: `${it.label} (ครบ ${thDate(it.due)})`, title: `${it.holding.name} · ${it.label}` };
  });
  const hiddenChosen = rows.filter((r) => filled(r) && !shown.includes(r)).length;
  const maturities = lines.filter((l) => l.type === "MATURITY").length;
  const net = (k: string) => n(vals[k] ?? "") - ((tax[k] ?? "").trim() ? n(tax[k]) : 0);

  // ด้านบน: กรอกตามตาราง (แถวที่แสดง ยังว่าง มียอดคาดการณ์) · คิดภาษี 15% (ดอกเบี้ยที่กรอก ไม่รวมเงินต้น)
  //   ทุกแถวที่แสดงอยู่ (รวมงวดที่ยังไม่ถึงกำหนด — รับก่อนกำหนดได้ ระบบจับคู่งวดตั้งแต่ 20 วันก่อนวันรับ)
  const fillable = shown.filter((r) => editable(r) && r.item?.expected != null && !(vals[r.key] ?? "").trim());
  const fillAll = () => setVals({ ...vals, ...Object.fromEntries(fillable.map((r) => [r.key, fmt(r.item!.expected!)])) });
  const taxable = shown.filter((r) => filled(r) && r.item?.kind !== "PRINCIPAL" && !Number.isNaN(n(vals[r.key])));
  const taxAll = () => setTax({ ...tax, ...Object.fromEntries(taxable.map((r) => [r.key, fmt(Math.round(n(vals[r.key]) * TAX_RATE * 100) / 100)])) });

  const onSubmit = cf.guard(`บันทึกรับ ${lines.length} รายการ วันที่ ${thDate(date)} ?\n${lines.map((l) => `• ${l.title} ${l.amount}${l.tax.trim() ? ` (ภาษี ${l.tax})` : ""}`).join("\n")}`
    + (maturities ? `\n\nเงินต้นครบกำหนด ${maturities} รายการ: หลักทรัพย์จะปิดเป็น "ครบกำหนด" (เงินต้นไม่ใช่รายได้)` : ""), { okLabel: "ยืนยันบันทึก" });

  if (rows.length === 0) return null;
  return (
    <>
    {cf.dialog}
    <div className="space-y-3">
      {canWrite && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {pfList.length > 1 && (
                <label className="flex items-center gap-2">พอร์ต
                  <select value={pf} onChange={(e) => setPf(e.target.value)} className={small}>
                    <option value="">ทุกพอร์ต</option>
                    {pfList.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </label>
              )}
              {fillable.length > 0 && <button type="button" onClick={fillAll} className="text-sm text-blue-700 hover:underline">กรอกตามตารางทุกแถว ({fillable.length})</button>}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              {taxable.length > 0 && <button type="button" onClick={taxAll} className="text-sm text-blue-700 hover:underline">คิดภาษี 15% ทุกแถวที่กรอก</button>}
              <label className="flex items-center gap-2">วันที่รับ
                <input type="date" value={date} min={minDate || undefined} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={small} />
              </label>
            </div>
          </div>
          <p className="text-xs text-slate-500">กรอกเฉพาะรายการที่ได้รับ (ช่องว่าง = ไม่บันทึก) · วันที่รับใช้กับทุกแถวที่กรอก (รับคนละวัน = บันทึกทีละรอบ) · ยอดเข้าบัญชีสุทธิ = ยอดก่อนภาษี − ภาษีหัก ณ ที่จ่าย
            · เงินต้นครบกำหนดไม่ใช่รายได้ บันทึกแล้วหลักทรัพย์ปิดเป็น &ldquo;ครบกำหนด&rdquo; · ดอกเบี้ยเงินฝากในพอร์ตเข้าบัญชีนั้นเอง</p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">หลักทรัพย์ / บัญชี</th><th className="px-3">รายการ</th><th className="px-3">วันครบกำหนด</th>
              <th className="px-3 text-right">ยอดคาดว่าจะได้รับ</th>
              {canWrite && <><th className="px-2 text-right">ยอดก่อนภาษี</th><th className="px-2 text-right">ภาษีหัก ณ ที่จ่าย</th>
                <th className="w-36 whitespace-nowrap px-2 text-right">ยอดเข้าบัญชีสุทธิ</th><th className="px-2">เข้าบัญชี</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={canWrite ? 8 : 4} className="px-4 py-6 text-center text-slate-500">ไม่มีรายการของพอร์ตนี้</td></tr>}
            {shown.map((r) => {
              const it = r.item, c = r.cash;
              const open = editable(r);
              const v = vals[r.key] ?? "";
              const has = v.trim() !== "" && !Number.isNaN(n(v));
              return (
                <tr key={r.key} className={`${it?.received ? "text-slate-500" : ""} ${open && v.trim() ? "bg-blue-50/40" : ""}`}>
                  <td className="break-words px-3 py-2.5">
                    {it ? <Link href={`/investments/${r.pf}/holding/${it.holding.id}`} className="font-medium text-slate-900 hover:underline">{it.holding.name}</Link>
                      : <Link href={`/investments/${r.pf}/cash/${c!.id}`} className="font-medium text-slate-900 hover:underline">{c!.name}</Link>}
                    <div className="text-xs text-slate-400">{r.pfName} · {it ? HOLDING_TYPE_LABEL[it.holding.holding_type] ?? it.holding.holding_type : "เงินฝากในพอร์ต"} · {r.currency}</div>
                  </td>
                  <td className="px-3 py-2.5">{it ? it.label : <>ดอกเบี้ยเงินฝาก{c!.rate != null && <div className="text-xs text-slate-400">อัตรา {c!.rate.toFixed(2)}%</div>}</>}</td>
                  {/* สถานะเป็นบรรทัดเล็กใต้วันครบกำหนด (เลิกคอลัมน์สถานะ · ตกลง 24 ต.ค.) */}
                  <td className="px-3 py-2.5"><div className="whitespace-nowrap">{it ? thDate(it.due) : <span className="text-slate-400">-</span>}</div>
                    <div className="text-xs">{it ? <DueStatus due={it.due} received={it.received} today={today} />
                      : c!.received > 0 ? <span className="text-emerald-700">รับแล้วเดือนนี้ {money(c!.received, r.currency)}</span> : null}</div></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{it?.expected != null ? money(it.expected, r.currency) : <span className="text-slate-400">-</span>}
                    {it?.received && <div className="text-xs text-emerald-700">ได้รับ {money(it.received.amount, r.currency)}</div>}</td>
                  {canWrite && (!open ? <td colSpan={4} /> : <>
                    <td className="px-2 text-right">
                      <input inputMode="decimal" value={v} placeholder={r.currency} aria-label={it?.kind === "PRINCIPAL" ? "เงินต้นที่ได้คืน" : "ยอดก่อนภาษี"}
                        onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })} className={`w-28 text-right ${small}`} />
                    </td>
                    <td className="px-2 text-right"><input inputMode="decimal" value={tax[r.key] ?? ""} disabled={!v.trim()} aria-label="ภาษีหัก ณ ที่จ่าย"
                      onChange={(e) => setTax({ ...tax, [r.key]: e.target.value })} className={`w-24 text-right ${small}`} /></td>
                    <td className={`whitespace-nowrap px-2 text-right tabular-nums ${has && net(r.key) <= 0 ? "text-red-700" : ""}`}>
                      {has && !Number.isNaN(net(r.key)) ? money(net(r.key), r.currency) : <span className="text-slate-400">-</span>}</td>
                    <td className="px-2">
                      {c ? <span className="text-xs text-slate-500">บัญชีนี้</span> : (
                        <select value={destOf(r)} onChange={(e) => setDest({ ...dest, [r.key]: e.target.value })} className={`max-w-[11rem] ${small}`} aria-label="เข้าบัญชี">
                          {pfCash(r.pf, r.currency).map((x) => <option key={x.id} value={endpointValue({ kind: "portfolio", id: x.id })}>ในพอร์ต · {x.name}</option>)}
                          {banks.filter((b) => b.currency === r.currency).map((b) => <option key={b.asset_id} value={endpointValue({ kind: "bank", id: b.asset_id })}>ธนาคาร · {b.name}</option>)}
                        </select>
                      )}
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
          <input type="hidden" name="rows" value={JSON.stringify(lines.map((l) => ({ ...l, title: undefined })))} />
          <button disabled={pending || lines.length === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกรับ ${lines.length} รายการ ณ ${thDate(date)}`}
          </button>
          {hiddenChosen > 0 && !pending && <span className="text-xs text-amber-700">รวม {hiddenChosen} รายการที่กรอกไว้ในพอร์ตอื่น</span>}
          {lines.length > 0 && !pending && <button type="button" onClick={() => { setVals({}); setTax({}); }} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
        </form>
      )}
    </div>
    </>
  );
}
