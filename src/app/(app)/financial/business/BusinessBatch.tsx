"use client";

import Link from "next/link";
import { Fragment, useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { money, qty, thDate } from "@/lib/format";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { batchDividends, batchValues, type ActionState } from "./actions";

export type BizHolder = { personId: string; name: string; shares: number | null; pct: number };
export type BizRow = { id: string; name: string; currency: string; value: number | null; valueDate: string | null; holders: BizHolder[] };
export type BizBank = { id: string; name: string; currency: string; owners: string[] };

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const n = (s: string) => Number((s ?? "").replace(/,/g, ""));
const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TAX_RATE = 0.1;
const METHODS: [string, string][] = [["USER_ESTIMATE", "ประมาณเอง"], ["APPRAISAL", "ผู้ประเมิน"], ["LATEST_TRANSACTION", "ราคาซื้อขายล่าสุด"]];

/**
 * แท็บ "บันทึกปันผล / มูลค่า" ของหน้า Private Business — 2 ส่วน แต่ละส่วนกดบันทึกครั้งเดียว (ผิดแถวเดียว = ไม่บันทึกทั้งชุด)
 *   ปันผล: 1 แถว = ผู้ถือหุ้น 1 คน → เข้าบัญชีของคนนั้น · รายได้เป็นของคนนั้น · ใส่ "ปันผลต่อหุ้น" แล้วคิดยอดรายคนให้
 *   มูลค่า: 1 แถว = 1 กิจการ · วันที่ / วิธีประเมินเดียวทั้งชุด
 */
export default function BusinessBatch({ rows, banks, today, minDate, canWrite }: {
  rows: BizRow[]; banks: BizBank[]; today: string; minDate: string; canWrite: boolean;
}) {
  return (
    <div className="space-y-6">
      <DividendBatch rows={rows} banks={banks} today={today} minDate={minDate} canWrite={canWrite} />
      <ValueBatch rows={rows} today={today} minDate={minDate} canWrite={canWrite} />
    </div>
  );
}

function Result({ s }: { s: ActionState }) {
  return <>{s.error && <span className="text-sm text-red-600">{s.error}</span>}{s.ok && <span className="text-sm text-emerald-700">{s.ok}</span>}</>;
}

function DividendBatch({ rows, banks, today, minDate, canWrite }: { rows: BizRow[]; banks: BizBank[]; today: string; minDate: string; canWrite: boolean }) {
  const router = useRouter();
  const cf = useConfirmSubmit();
  const [date, setDate] = useState(today);
  const [dps, setDps] = useState<Record<string, string>>({});
  const [vals, setVals] = useState<Record<string, string>>({});
  const [tax, setTax] = useState<Record<string, string>>({});
  // บัญชีตั้งต้น = บัญชีของผู้ถือหุ้นคนนั้น (สกุลเดียวกับกิจการก่อน)
  const [bank, setBank] = useState<Record<string, string>>(() => Object.fromEntries(rows.flatMap((r) => r.holders.map((h) => {
    const own = banks.filter((b) => b.owners.includes(h.personId));
    return [`${r.id}:${h.personId}`, (own.find((b) => b.currency === r.currency) ?? own[0])?.id ?? ""];
  }))));
  const [state, action, pending] = useActionState<ActionState, FormData>(batchDividends, {});
  useEffect(() => { if (state.ok) { setVals({}); setTax({}); setDps({}); router.refresh(); } }, [state, router]);

  const lines = rows.flatMap((r) => r.holders.filter((h) => (vals[`${r.id}:${h.personId}`] ?? "").trim())
    .map((h) => ({ r, h, k: `${r.id}:${h.personId}` })));
  const payload = lines.map(({ r, h, k }) => ({ asset_id: r.id, person_id: h.personId, amount: vals[k], tax: tax[k] ?? "", bank_asset_id: bank[k] ?? "" }));
  const bankName = new Map(banks.map((b) => [b.id, b.name]));
  const onSubmit = cf.guard(`บันทึกปันผล ${lines.length} รายการ วันที่ ${thDate(date)} ?\n${lines.map(({ r, h, k }) =>
    `• ${r.name} · ${h.name} ${vals[k]}${tax[k]?.trim() ? ` (ภาษี ${tax[k]})` : ""} → ${bankName.get(bank[k]) ?? "ไม่ผ่านบัญชี"}`).join("\n")}`, { okLabel: "ยืนยันบันทึก" });
  const fillDps = (r: BizRow, v: string) => {
    setDps({ ...dps, [r.id]: v });
    if (!v.trim() || Number.isNaN(n(v))) return;
    setVals({ ...vals, ...Object.fromEntries(r.holders.filter((h) => h.shares != null).map((h) => [`${r.id}:${h.personId}`, fmt(Math.round(h.shares! * n(v) * 100) / 100)])) });
  };
  const taxAll = () => setTax({ ...tax, ...Object.fromEntries(lines.filter(({ k }) => !Number.isNaN(n(vals[k]))).map(({ k }) => [k, fmt(Math.round(n(vals[k]) * TAX_RATE * 100) / 100)])) });

  return (
    <section className="space-y-3">
      {cf.dialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium text-slate-900">รับปันผล (แยกตามผู้ถือหุ้น)</h2>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">วันที่รับ
              <input type="date" value={date} min={minDate || undefined} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={small} />
            </label>
            {lines.length > 0 && <button type="button" onClick={taxAll} className="text-blue-700 hover:underline">คิดภาษี 10% ทุกแถวที่กรอก</button>}
          </div>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">กิจการ / ผู้ถือหุ้น</th><th className="px-3 text-right">หุ้น / สัดส่วน</th>
              {canWrite && <><th className="px-3 text-right">ปันผลก่อนภาษี</th><th className="px-3 text-right">ภาษีหัก ณ ที่จ่าย</th><th className="px-3 text-right">สุทธิ</th><th className="px-3">เข้าบัญชี</th></>}</tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">ไม่มีกิจการที่ดำเนินการอยู่</td></tr>}
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-t border-slate-200 bg-slate-50/60">
                  <td className="px-3 py-2"><Link href={`/financial/business/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                    <span className="ml-2 text-xs text-slate-400">{r.currency}</span></td>
                  <td className="px-3 text-right text-xs text-slate-500">{r.holders.some((h) => h.shares != null) ? `${qty(r.holders.reduce((s, h) => s + (h.shares ?? 0), 0))} หุ้น` : ""}</td>
                  {canWrite && <td colSpan={4} className="px-3 py-2">
                    {r.holders.some((h) => h.shares != null) && (
                      <label className="flex items-center justify-end gap-2 text-xs text-slate-600">ปันผลต่อหุ้น
                        <input inputMode="decimal" data-money="off" value={dps[r.id] ?? ""} onChange={(e) => fillDps(r, e.target.value)} aria-label={`ปันผลต่อหุ้น ${r.name}`}
                          className={`w-24 text-right ${small}`} />
                        <span className="text-slate-400">→ คิดยอดรายคนให้ (แก้ได้)</span>
                      </label>
                    )}
                  </td>}
                </tr>
                {r.holders.length === 0 && <tr><td colSpan={6} className="px-6 py-2 text-xs text-slate-400">ยังไม่ได้ระบุผู้ถือหุ้น · ตั้งที่หน้ากิจการ</td></tr>}
                {r.holders.map((h) => {
                  const k = `${r.id}:${h.personId}`;
                  const v = vals[k] ?? "";
                  const has = v.trim() !== "" && !Number.isNaN(n(v));
                  const net = has ? n(v) - (tax[k]?.trim() ? n(tax[k]) : 0) : null;
                  const own = banks.filter((b) => b.owners.includes(h.personId));
                  const others = banks.filter((b) => !b.owners.includes(h.personId));
                  return (
                    <tr key={k} className={`border-t border-slate-100 ${has ? "bg-blue-50/40" : ""}`}>
                      <td className="py-2 pl-8 pr-3">{h.name}</td>
                      <td className="px-3 text-right tabular-nums text-xs text-slate-500">{h.shares != null ? `${qty(h.shares)} หุ้น · ` : ""}{h.pct.toFixed(2)}%</td>
                      {canWrite && <>
                        <td className="px-3 text-right"><input inputMode="decimal" value={v} placeholder={r.currency} aria-label={`ปันผล ${r.name} ${h.name}`}
                          onChange={(e) => setVals({ ...vals, [k]: e.target.value })} className={`w-32 text-right ${small}`} /></td>
                        <td className="px-3 text-right"><input inputMode="decimal" value={tax[k] ?? ""} disabled={!has} aria-label={`ภาษี ${r.name} ${h.name}`}
                          onChange={(e) => setTax({ ...tax, [k]: e.target.value })} className={`w-28 text-right ${small}`} /></td>
                        <td className={`px-3 text-right tabular-nums ${net != null && net <= 0 ? "text-red-700" : ""}`}>{net != null && !Number.isNaN(net) ? money(net) : <span className="text-slate-400">-</span>}</td>
                        <td className="px-3">
                          <select value={bank[k] ?? ""} onChange={(e) => setBank({ ...bank, [k]: e.target.value })} className={`max-w-[15rem] ${small}`} aria-label={`เข้าบัญชี ${h.name}`}>
                            <option value="">— ไม่ผ่านบัญชี —</option>
                            {own.length > 0 && <optgroup label={`บัญชีของ ${h.name}`}>{own.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}</optgroup>}
                            {others.length > 0 && <optgroup label="บัญชีอื่น">{others.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}</optgroup>}
                          </select>
                        </td>
                      </>}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {canWrite && (
        <form action={action} onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="rows" value={JSON.stringify(payload)} />
          <button disabled={pending || lines.length === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกปันผล ${lines.length} รายการ`}
          </button>
          {lines.length > 0 && !pending && <button type="button" onClick={() => { setVals({}); setTax({}); setDps({}); }} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>}
          <Result s={state} />
        </form>
      )}
      <p className="text-xs text-slate-500">กรอกเฉพาะผู้ถือหุ้นที่ได้รับ (ช่องว่าง = ไม่บันทึก) · รายได้ &ldquo;ปันผลกิจการ&rdquo; เป็นของคนนั้น 100% เข้าบัญชีที่เลือก · ผู้ถือหุ้นคนไหนผิด จะไม่บันทึกเลยทั้งชุด · แก้ / ลบรายการได้ที่หน้า Income &amp; Expenses</p>
    </section>
  );
}

function ValueBatch({ rows, today, minDate, canWrite }: { rows: BizRow[]; today: string; minDate: string; canWrite: boolean }) {
  const router = useRouter();
  const cf = useConfirmSubmit();
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState(METHODS[0][0]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [state, action, pending] = useActionState<ActionState, FormData>(batchValues, {});
  useEffect(() => { if (state.ok) { setVals({}); router.refresh(); } }, [state, router]);
  const chosen = rows.filter((r) => (vals[r.id] ?? "").trim());
  const onSubmit = cf.guard(`บันทึกมูลค่า ${chosen.length} กิจการ ณ ${thDate(date)} ?\n${chosen.map((r) => `• ${r.name} ${vals[r.id]}`).join("\n")}`, { okLabel: "ยืนยันบันทึก" });

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
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={small}>
                {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">กิจการ</th><th className="px-3 text-right">มูลค่าล่าสุด</th>{canWrite && <><th className="px-3 text-right">มูลค่าใหม่</th><th className="px-3 text-right">เปลี่ยนแปลง</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const v = vals[r.id] ?? "";
              const has = v.trim() !== "" && !Number.isNaN(n(v));
              const diff = has && r.value != null ? n(v) - r.value : null;
              return (
                <tr key={r.id} className={has ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2"><Link href={`/financial/business/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link></td>
                  <td className="px-3 text-right tabular-nums">{r.value != null ? money(r.value, r.currency) : "-"}
                    <div className="text-xs text-slate-400">{r.valueDate ? `ณ ${thDate(r.valueDate)}` : "ยังไม่มีมูลค่า"}</div></td>
                  {canWrite && <>
                    <td className="px-3 text-right"><input inputMode="decimal" value={v} placeholder={r.currency} aria-label={`มูลค่าใหม่ ${r.name}`}
                      onChange={(e) => setVals({ ...vals, [r.id]: e.target.value })} className={`w-40 text-right ${small}`} /></td>
                    <td className={`px-3 text-right tabular-nums ${diff == null ? "text-slate-400" : diff >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {diff == null ? "-" : `${diff >= 0 ? "+" : "−"}${money(Math.abs(diff))}${r.value ? ` (${((diff * 100) / r.value).toFixed(1)}%)` : ""}`}</td>
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
          <input type="hidden" name="method" value={method} />
          <input type="hidden" name="rows" value={JSON.stringify(chosen.map((r) => ({ asset_id: r.id, value: vals[r.id] })))} />
          <button disabled={pending || chosen.length === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกมูลค่า ${chosen.length} กิจการ`}
          </button>
          {chosen.length > 0 && !pending && <button type="button" onClick={() => setVals({})} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>}
          <Result s={state} />
        </form>
      )}
      <p className="text-xs text-slate-500">กรอกเฉพาะกิจการที่มีมูลค่าใหม่ · มูลค่าใหม่เป็นมูลค่าปัจจุบันของกิจการ (ส่วนของครอบครัว) · ประวัติ / ลบ ดูที่หน้ากิจการ</p>
    </section>
  );
}
