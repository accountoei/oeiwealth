"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { SMALL_BTN, SMALL_DEL_BTN, COST_STATUS, PROPERTY_COST_TYPE_LABEL, money, thDate, thMonth } from "@/lib/format";
import { batchPropertyExpenses, type BatchState } from "./actions";
import { RecordedLines, type Recorded } from "@/lib/recorded-edit";
import { InfoTip } from "@/components/HeaderBar";
import { BatchBar, BatchSave, FillAll, FilterSelect, useBatchSave } from "@/components/BatchSave";
import { inputAmount as fmt } from "@/lib/batch-entry";

export type CostRow = {
  key: string; utilityId: string; assetId: string; property: string; label: string; type: string; typeLabel: string; period: string; due: string | null;
  expected: number; paid: number; currency: string; status: string; category: string;
  /** "จ่ายจาก" ที่ตั้งไว้ในรายการค่าใช้จ่ายประจำ (a: / c:) */ pay?: string;
  /** สัญญาเช่าที่ตั้ง "ค่าน้ำไฟ: เราจ่ายแล้วเรียกเก็บผู้เช่า" (ไฟ / น้ำ) */ rebillLease?: string; rebillLabel?: string;
  /** ที่จ่ายแล้วของงวด (ทีละครั้ง · กดเพื่อแก้ / ลบ) */ edits?: Recorded[];
};
export type PayOpt = { value: string; label: string; currency: string };
/** ค่าใช้จ่ายที่จ่ายในเดือนนี้ที่ไม่อยู่ในแถวค่าใช้จ่ายประจำ (เดิมอยู่ตาราง "ค่าใช้จ่ายทรัพย์สินที่บันทึกแล้ว") · amount = ยอดบาท กดแก้ได้ */
export type OtherCost = { key: string; assetId: string; property: string; date: string; label: string; amount: ReactNode };
type Extra = { id: number; asset: string; ctype: string; description: string; amount: string; pay: string };

const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const OTHER_CATEGORY = "บ้าน / สาธารณูปโภค";

/**
 * บันทึกค่าใช้จ่ายของทรัพย์สินหลายรายการพร้อมกัน · ตารางเดียว (ตกลง 5 พ.ย. 2026 · เดิม 3 กล่อง)
 *   ค่าใช้จ่ายประจำงวดเดือนนี้ (ไฟ / น้ำ / ส่วนกลาง / ภาษีที่ดิน) + งวดก่อนที่ยังค้างจ่าย (ยกมา) → ค่าใช้จ่ายอื่น (ซ่อม ฯลฯ) เพิ่มแถวได้
 *   → รายการอื่นที่จ่ายแล้วในเดือนนี้ → ยอดจ่ายเดือนนี้รวม (ตามวันที่จ่าย)
 *   ช่องยอดว่าง = ไม่บันทึก · กดบันทึกครั้งเดียว · ผิดแถวเดียว = ไม่บันทึกเลย
 *   ฟอร์มบันทึกครอบเฉพาะปุ่มบันทึก ไม่ครอบตาราง (ในตารางอาจมีปุ่มที่เป็นฟอร์มของตัวเอง · ฟอร์มซ้อนฟอร์ม = กดไม่ได้)
 */
export default function ExpenseBatch({ rows, others, total, totalLabel, props, pays, defaultDate, today, ym, canWrite }: {
  rows: CostRow[]; others: OtherCost[]; total: number; totalLabel: string;
  props: { id: string; name: string }[]; pays: PayOpt[]; defaultDate: string; today: string; ym: string; canWrite: boolean;
}) {
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
  const { state, action, pending, confirm, dialog } = useBatchSave<BatchState>(batchPropertyExpenses, () => { setVals({}); setExtra([blank(Date.now())]); });
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
  const onSubmit = confirm(`บันทึกค่าใช้จ่าย ${count} รายการ ณ วันที่ ${thDate(date)} ?\n${[
    ...chosen.map((r) => `• ${r.property} · ${r.label} ${vals[r.key]}${rebillOn(r) ? " (เรียกเก็บผู้เช่า)" : ""}`),
    ...extras.map((x) => `• ${name.get(x.asset) ?? "(ยังไม่เลือกทรัพย์สิน)"} · ${PROPERTY_COST_TYPE_LABEL[x.ctype] ?? "(ยังไม่เลือกประเภท)"} · ${x.description || "(ไม่มีรายการ)"} ${x.amount}`),
  ].join("\n")}`);
  const cols = canWrite ? 6 : 4;
  const setX = (id: number, patch: Partial<Extra>) => setExtra(extra.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const PaySelect = ({ value, onChange, ccy }: { value: string; onChange: (v: string) => void; ccy?: string }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`max-w-[14rem] ${small}`}>
      <option value="">— เลือกบัญชี / บัตร —</option>
      {pays.filter((p) => !ccy || p.currency === ccy).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
    </select>
  );

  return (
    <>
    {dialog}
    <div className="space-y-3">
      {/* แถบบนแบบเดียวกันทุกหน้า (ตกลง 6 พ.ย. 2026): ชื่อ · ประเภท · ใส่ยอดทุกแถว | บันทึก + วันที่ */}
      <BatchBar title={<>ค่าใช้จ่ายทรัพย์สิน งวด {thMonth(`${ym}-01`)}
              {rows.some((r) => r.period < `${ym}-01` && r.status === "OVERDUE") && <span className="text-sm font-normal text-red-700"> + ค้างจ่ายยกมา</span>}
              <InfoTip label="คำอธิบาย">หมวดค่าใช้จ่าย &ldquo;บ้าน / สาธารณูปโภค&rdquo; · แบ่งตามสัดส่วนเจ้าของบัญชี / บัตรที่จ่าย · รายการไหนผิด จะไม่บันทึกเลยทั้งชุด · &ldquo;เดือนนี้ไม่ได้จ่าย&rdquo; / แก้ไข ทำที่หน้าของทรัพย์สิน · ติ๊ก &ldquo;เรียกเก็บผู้เช่า&rdquo; = ตั้งยอดรอรับคืนเท่ายอดที่จ่าย (รับได้ที่แท็บรับค่าเช่า) · กดยอดที่จ่ายแล้วเพื่อแก้ / ลบ</InfoTip></>}
        filters={kinds.length > 1 && <FilterSelect label="ประเภท" value={kind} onChange={setKind}
          options={kinds.map(([k, l]) => [k, `${l} (${rows.filter((r) => r.type === k).length})`])} />}
        fill={canWrite && <FillAll disabled={!open.some((r) => r.expected > 0)}
          onClick={() => setVals({ ...vals, ...Object.fromEntries(open.filter((r) => r.expected > 0).map((r) => [r.key, fmt(r.expected)])) })} />}>
        {canWrite && (
          <BatchSave action={action} onSubmit={onSubmit} fields={{ rows: JSON.stringify(payload) }}
            count={count} pending={pending} onClear={() => { setVals({}); setExtra([blank(Date.now())]); }} state={state}
            date={date} onDate={setDate} maxDate={today}
            info={<>วันที่ด้านขวาใช้กับทุกแถวที่กรอก · ช่องยอดว่าง = ไม่บันทึก</>} />
        )}
      </BatchBar>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">ทรัพย์สิน / รายการ</th><th className="px-3">ครบกำหนด</th><th className="px-3 text-right">ยอดประมาณ</th>
              <th className="px-3">สถานะ</th>{canWrite && <><th className="px-3 text-right">ยอดที่จ่าย</th><th className="px-3">จ่ายจาก</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shownRows.length === 0 && <tr><td colSpan={cols} className="px-4 py-4 text-center text-slate-500">ไม่มีค่าใช้จ่ายประจำงวดเดือนนี้หรือค้างจ่าย (ตั้งค่าได้ที่หน้าของทรัพย์สิน)</td></tr>}
            {shownRows.map((r) => {
              const done = r.status === "PAID" || r.status === "DISMISSED";
              const v = vals[r.key] ?? "";
              return (
                <tr key={r.key} className={v.trim() ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2">
                    <Link href={`/property/${r.assetId}`} className="font-medium text-slate-900 hover:underline">{r.property}</Link>
                    <div className="text-xs text-slate-500">{r.label}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 text-xs">{thDate(r.due)}
                    {/* งวดเดือนก่อน: ค้างจ่ายยกมา / จ่ายในเดือนนี้ (ตกลง 5 พ.ย. 2026) */}
                    {r.period < `${ym}-01` && <div className={r.status === "OVERDUE" ? "text-red-700" : "text-slate-500"}>งวด {thMonth(r.period)}</div>}</td>
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
            {/* ค่าใช้จ่ายอื่น (เดิมกล่องแยก) · ใช้คอลัมน์ยอดที่จ่าย / จ่ายจาก เดียวกับแถวด้านบน */}
            {canWrite && <>
              <tr className="bg-slate-50/60"><td colSpan={cols} className="px-3 py-1.5 text-xs font-medium text-slate-500">
                ค่าใช้จ่ายอื่นของทรัพย์สิน <span className="font-normal">(ซ่อมแซม · ประกันอัคคีภัย · ค่านายหน้า ฯลฯ)</span></td></tr>
              {extra.map((x) => (
                <tr key={x.id} className={x.amount.trim() ? "bg-blue-50/40" : ""}>
                  <td className="px-3 py-2">
                    <select value={x.asset} onChange={(e) => setX(x.id, { asset: e.target.value })} aria-label="ทรัพย์สิน" className={`w-full max-w-[14rem] ${small}`}>
                      <option value="">— เลือกทรัพย์สิน —</option>
                      {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td colSpan={3} className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <select value={x.ctype} onChange={(e) => setX(x.id, { ctype: e.target.value })} aria-label="ประเภท" className={small}>
                        <option value="">— เลือกประเภท —</option>
                        {Object.entries(PROPERTY_COST_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <input value={x.description} onChange={(e) => setX(x.id, { description: e.target.value })} placeholder="รายการ เช่น ซ่อมหลังคา" aria-label="รายการ"
                        className={`min-w-0 flex-1 ${small}`} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <input inputMode="decimal" value={x.amount} placeholder="THB" aria-label="ยอดที่จ่าย (THB)" onChange={(e) => setX(x.id, { amount: e.target.value })}
                      className={`w-32 text-right ${small}`} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <PaySelect value={x.pay} onChange={(v) => setX(x.id, { pay: v })} ccy="THB" />
                      {extra.length > 1 && <button type="button" onClick={() => setExtra(extra.filter((y) => y.id !== x.id))} className={SMALL_DEL_BTN}>ลบ</button>}
                    </div>
                  </td>
                </tr>
              ))}
              <tr><td colSpan={cols} className="px-3 py-2">
                <button type="button" onClick={() => setExtra([...extra, blank(Date.now())])} className={SMALL_BTN}>+ เพิ่มแถว</button></td></tr>
            </>}
            {/* รายการอื่นที่จ่ายแล้วในเดือนนี้ (เดิมตาราง "ค่าใช้จ่ายทรัพย์สินที่บันทึกแล้ว") */}
            {others.length > 0 && (
              <tr className="bg-slate-50/60"><td colSpan={cols} className="px-3 py-1.5 text-xs font-medium text-slate-500">รายการอื่นที่จ่ายแล้วในเดือนนี้</td></tr>
            )}
            {others.map((o) => (
              <tr key={o.key}>
                <td className="px-3 py-2">
                  <Link href={`/property/${o.assetId}`} className="font-medium text-slate-900 hover:underline">{o.property}</Link>
                  <div className="text-xs text-slate-500">{o.label}</div>
                </td>
                <td className="whitespace-nowrap px-3 text-xs">{thDate(o.date)}</td>
                <td className="whitespace-nowrap px-3 text-right text-red-700">{o.amount} <span className="text-slate-400">THB</span></td>
                <td className="px-3 text-xs text-emerald-700">จ่ายแล้ว</td>
                {canWrite && <td colSpan={2} />}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-medium">
            <tr><td colSpan={2} className="px-3 py-2">{totalLabel}</td>
              <td className="whitespace-nowrap px-3 text-right tabular-nums text-red-700">{money(total, "THB")}</td><td colSpan={cols - 3} /></tr>
          </tfoot>
        </table>
      </div>

    </div>
    </>
  );
}
