"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { COST_STATUS, PROPERTY_COST_TYPE_LABEL, money, thDate, thMonth } from "@/lib/format";
import { batchPropertyExpenses, type BatchState } from "./actions";
import { useConfirmSubmit } from "@/components/ConfirmDialog";
import { RecordedLines, type Recorded } from "@/lib/recorded-edit";
import Flash from "@/components/Flash";

export type CostRow = {
  key: string; utilityId: string; assetId: string; property: string; label: string; type: string; typeLabel: string; period: string; due: string | null;
  expected: number; paid: number; currency: string; status: string; category: string;
  /** "จ่ายจาก" ที่ตั้งไว้ในรายการค่าใช้จ่ายประจำ (a: / c:) */ pay?: string;
  /** สัญญาเช่าที่ตั้ง "ค่าน้ำไฟ: เราจ่ายแล้วเรียกเก็บผู้เช่า" (ไฟ / น้ำ) */ rebillLease?: string; rebillLabel?: string;
  /** ที่จ่ายแล้วของงวด (ทีละครั้ง · กดเพื่อแก้ / ลบ) */ edits?: Recorded[];
};
export type PayOpt = { value: string; label: string; currency: string };
type Extra = { id: number; asset: string; ctype: string; description: string; amount: string; pay: string };

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const OTHER_CATEGORY = "บ้าน / สาธารณูปโภค";

/**
 * บันทึกค่าใช้จ่ายของทรัพย์สินหลายรายการพร้อมกัน
 *   ส่วนบน = ค่าใช้จ่ายประจำงวดเดือนนี้ที่ยังไม่จ่าย (ไฟ / น้ำ / ส่วนกลาง / ภาษีที่ดิน) · ส่วนล่าง = รายการอื่น (ซ่อม ฯลฯ) เพิ่มแถวได้
 *   ช่องยอดว่าง = ไม่บันทึก · กดบันทึกครั้งเดียว · ผิดแถวเดียว = ไม่บันทึกเลย
 */
export default function ExpenseBatch({ rows, props, pays, defaultDate, today, ym, canWrite }: {
  rows: CostRow[]; props: { id: string; name: string }[]; pays: PayOpt[]; defaultDate: string; today: string; ym: string; canWrite: boolean;
}) {
  const router = useRouter();
  const firstPay = (ccy: string) => pays.find((p) => p.currency === ccy)?.value ?? "";
  const [date, setDate] = useState(defaultDate);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [pay, setPay] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.key,
    r.pay && pays.some((p) => p.value === r.pay && p.currency === r.currency) ? r.pay : firstPay(r.currency)])));
  const blank = (id: number): Extra => ({ id, asset: "", ctype: "", description: "", amount: "", pay: firstPay("THB") });
  const [extra, setExtra] = useState<Extra[]>([blank(1)]);
  const [rebill, setRebill] = useState<Record<string, boolean>>({});
  const rebillOn = (r: CostRow) => !!r.rebillLease && rebill[r.key] !== false;
  const [kind, setKind] = useState("");
  const kinds = [...new Map(rows.map((r) => [r.type, r.typeLabel]))];
  const shownRows = kind ? rows.filter((r) => r.type === kind) : rows;
  const [state, action, pending] = useActionState<BatchState, FormData>(batchPropertyExpenses, {});
  const cf = useConfirmSubmit();
  useEffect(() => { if (state.ok) { setVals({}); setExtra([blank(Date.now())]); router.refresh(); } }, [state, router]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = rows.filter((r) => r.status !== "PAID" && r.status !== "DISMISSED");
  const chosen = open.filter((r) => (vals[r.key] ?? "").trim() !== "");
  const extras = extra.filter((x) => x.amount.trim() !== "");
  const payload = [
    ...chosen.map((r) => ({ date, description: r.label, amount: vals[r.key], pay: pay[r.key] ?? "", currency: r.currency,
      expense_category: r.category, property_utility_id: r.utilityId, cost_period: r.period,
      ...(rebillOn(r) ? { rebill_lease_id: r.rebillLease } : {}) })),
    ...extras.map((x) => ({ date, description: x.description, amount: x.amount, pay: x.pay, related_asset_id: x.asset, expense_category: OTHER_CATEGORY, property_cost_type: x.ctype })),
  ];
  const name = new Map(props.map((p) => [p.id, p.name]));
  const count = payload.length;
  const onSubmit = cf.guard(`บันทึกค่าใช้จ่าย ${count} รายการ วันที่ ${thDate(date)} ?\n${[
    ...chosen.map((r) => `• ${r.property} · ${r.label} ${vals[r.key]}${rebillOn(r) ? " (เรียกเก็บผู้เช่า)" : ""}`),
    ...extras.map((x) => `• ${name.get(x.asset) ?? "(ยังไม่เลือกทรัพย์สิน)"} · ${PROPERTY_COST_TYPE_LABEL[x.ctype] ?? "(ยังไม่เลือกประเภท)"} · ${x.description || "(ไม่มีรายการ)"} ${x.amount}`),
  ].join("\n")}`, { okLabel: "ยืนยันบันทึก" });
  const setX = (id: number, patch: Partial<Extra>) => setExtra(extra.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const PaySelect = ({ value, onChange, ccy }: { value: string; onChange: (v: string) => void; ccy?: string }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`max-w-[14rem] ${small}`}>
      <option value="">— เลือกบัญชี / บัตร —</option>
      {pays.filter((p) => !ccy || p.currency === ccy).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
    </select>
  );

  return (
    <>
    {cf.dialog}
    <form action={action} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <label className="flex items-center gap-2">วันที่จ่าย
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={small} />
          </label>
          <span className="text-xs text-slate-500">ใช้กับทุกแถวที่กรอก · ช่องยอดว่าง = ไม่บันทึก</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-medium text-slate-900">ค่าใช้จ่ายประจำ งวด {thMonth(`${ym}-01`)}</h2>
            {kinds.length > 1 && (
              <div className="flex flex-wrap gap-1 text-xs">
                {[["", "ทั้งหมด"] as [string, string], ...kinds].map(([k, l]) => (
                  <button key={k || "all"} type="button" onClick={() => setKind(k)}
                    className={`rounded-full border px-2.5 py-0.5 ${kind === k ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                    {l}{k && ` (${rows.filter((r) => r.type === k).length})`}</button>
                ))}
              </div>
            )}
          </div>
          {canWrite && open.length > 0 && (
            <button type="button" onClick={() => setVals({ ...vals, ...Object.fromEntries(open.filter((r) => r.expected > 0).map((r) => [r.key, fmt(r.expected)])) })}
              className="text-sm text-blue-700 hover:underline">ใส่ยอดประมาณทุกแถว</button>
          )}
        </div>
        <table className="mt-3 w-full min-w-[52rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">ทรัพย์สิน / รายการ</th><th className="px-3">ครบกำหนด</th><th className="px-3 text-right">ยอดประมาณ</th>
              <th className="px-3">สถานะ</th>{canWrite && <><th className="px-3 text-right">ยอดที่จ่าย</th><th className="px-3">จ่ายจาก</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shownRows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">ไม่มีค่าใช้จ่ายประจำงวดเดือนนี้ (ตั้งค่าได้ที่หน้าของทรัพย์สิน)</td></tr>}
            {shownRows.map((r) => {
              const done = r.status === "PAID" || r.status === "DISMISSED";
              const v = vals[r.key] ?? "";
              return (
                <tr key={r.key} className={v.trim() ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2">
                    <Link href={`/property/${r.assetId}`} className="font-medium text-slate-900 hover:underline">{r.property}</Link>
                    <div className="text-xs text-slate-500">{r.label}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 text-xs">{thDate(r.due)}</td>
                  <td className="px-3 text-right tabular-nums">{r.expected > 0 ? money(r.expected, r.currency) : <span className="text-slate-400">-</span>}</td>
                  <td className={`px-3 text-xs ${COST_STATUS[r.status]?.cls ?? ""}`}>{COST_STATUS[r.status]?.text ?? r.status}
                    {r.edits?.length ? <RecordedLines items={r.edits} />
                      : r.status === "PAID" && <span className="ml-1 text-slate-400">{money(r.paid, r.currency)}</span>}</td>
                  {canWrite && (done ? <td colSpan={2} className="px-3 text-xs text-slate-400">-</td> : <>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {r.expected > 0 && <button type="button" onClick={() => setVals({ ...vals, [r.key]: fmt(r.expected) })} className="mr-2 text-xs text-blue-700 hover:underline">ตามประมาณ</button>}
                      <input inputMode="decimal" value={v} aria-label={`ยอดที่จ่าย ${r.property} ${r.label}`} placeholder={r.currency}
                        onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })} className={`w-32 text-right ${small}`} />
                      {r.rebillLease && (
                        <label className="mt-1 flex items-center justify-end gap-1 text-xs text-slate-600" title={r.rebillLabel}>
                          <input type="checkbox" checked={rebillOn(r)} onChange={(e) => setRebill({ ...rebill, [r.key]: e.target.checked })} />
                          เรียกเก็บผู้เช่า
                        </label>
                      )}
                    </td>
                    <td className="px-3"><PaySelect value={pay[r.key] ?? ""} onChange={(x) => setPay({ ...pay, [r.key]: x })} ccy={r.currency} /></td>
                  </>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canWrite && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <h2 className="px-4 pt-4 font-medium text-slate-900">ค่าใช้จ่ายอื่นของทรัพย์สิน <span className="text-xs font-normal text-slate-500">(ซ่อมแซม · ประกันอัคคีภัย · ค่านายหน้า ฯลฯ)</span></h2>
          <table className="mt-3 w-full min-w-[52rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-3 py-2">ทรัพย์สิน</th><th className="px-3">ประเภท</th><th className="px-3">รายการ</th><th className="px-3 text-right">ยอดที่จ่าย (THB)</th><th className="px-3">จ่ายจาก</th><th className="px-3"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {extra.map((x) => (
                <tr key={x.id} className={x.amount.trim() ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2">
                    <select value={x.asset} onChange={(e) => setX(x.id, { asset: e.target.value })} className={`max-w-[14rem] ${small}`}>
                      <option value="">— เลือกทรัพย์สิน —</option>
                      {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3">
                    <select value={x.ctype} onChange={(e) => setX(x.id, { ctype: e.target.value })} aria-label="ประเภท" className={small}>
                      <option value="">— เลือกประเภท —</option>
                      {Object.entries(PROPERTY_COST_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td className="px-3"><input value={x.description} onChange={(e) => setX(x.id, { description: e.target.value })} placeholder="เช่น ซ่อมหลังคา" className={`w-56 ${small}`} /></td>
                  <td className="px-3 text-right"><input inputMode="decimal" value={x.amount} onChange={(e) => setX(x.id, { amount: e.target.value })} className={`w-32 text-right ${small}`} /></td>
                  <td className="px-3"><PaySelect value={x.pay} onChange={(v) => setX(x.id, { pay: v })} ccy="THB" /></td>
                  <td className="px-3 text-right">
                    {extra.length > 1 && <button type="button" onClick={() => setExtra(extra.filter((y) => y.id !== x.id))} className="text-xs text-slate-500 hover:text-red-700">ลบแถว</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3">
            <button type="button" onClick={() => setExtra([...extra, blank(Date.now())])} className="text-sm text-blue-700 hover:underline">+ เพิ่มแถว</button>
          </div>
        </div>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending || count === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : `บันทึกค่าใช้จ่าย ${count} รายการ`}
          </button>
          {count > 0 && !pending && (
            <button type="button" onClick={() => { setVals({}); setExtra([blank(Date.now())]); }} className="text-sm text-slate-500 underline hover:text-slate-800">ล้างช่องที่กรอก</button>
          )}
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          <Flash on={state} as="span" className="text-sm text-emerald-700" />
        </div>
      )}
      <p className="text-xs text-slate-500">หมวดค่าใช้จ่าย &ldquo;บ้าน / สาธารณูปโภค&rdquo; · แบ่งตามสัดส่วนเจ้าของบัญชี / บัตรที่จ่าย · รายการไหนผิด จะไม่บันทึกเลยทั้งชุด · &ldquo;เดือนนี้ไม่ได้จ่าย&rdquo; / แก้ไข ทำที่หน้าของทรัพย์สิน · ติ๊ก &ldquo;เรียกเก็บผู้เช่า&rdquo; = ตั้งยอดรอรับคืนเท่ายอดที่จ่าย (รับได้ที่แท็บรับค่าเช่า)</p>
    </form>
    </>
  );
}
