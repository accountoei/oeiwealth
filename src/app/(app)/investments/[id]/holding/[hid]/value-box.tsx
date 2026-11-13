import type { ReactNode } from "react";
import { money, qty, signTone, signedMoney, signedPct } from "@/lib/format";

/** ยอดบาท + สกุลหลักทรัพย์ (null = ไม่ทราบ / ไม่แสดง) */
export type Amt = { thb: number | null; ccy: number | null };
/** ผลตอบแทนรายตัว · บรรทัดย่อยเป็นสกุลหลักทรัพย์ */
export type HoldingSplit = {
  pre: Amt | null;
  since: Amt & { income: number; price: number | null };
  total: Amt & { pctThb: number | null; pctCcy: number | null };
};

const pctTxt = (p: number | null) => (p == null ? "" : ` (${signedPct(p)})`);

/**
 * กล่องมูลค่าหลักทรัพย์รายตัว — บรรทัดชุดเดียวกับกล่องมูลค่าพอร์ต (NetInvestedBox · ตกลง 13 พ.ย. 2026)
 * มูลค่าเป็นบาท (+ สกุลหลักทรัพย์สีน้ำเงิน) · ต้นทุนที่ยังถือ · ผลตอบแทนก่อน / ตั้งแต่ Go-live · รวมผลตอบแทน (%)
 * บาท = รวมผลจากค่าเงิน · สกุลหลักทรัพย์ = ผลการลงทุนล้วน · เงินที่โอนไปจริงก่อน Go-live อยู่ระดับพอร์ต (ไม่แยกรายตัว)
 */
export default function HoldingValueBox({ currency, value, cost, dateNote, lump, quantity, avgCost, split, incomeCount, soldSince }: {
  currency: string; value: Amt; cost: Amt; dateNote: ReactNode; lump: boolean; quantity: number; avgCost: number | null;
  split: HoldingSplit | null; incomeCount: number; soldSince: boolean;
}) {
  const fx = currency !== "THB";
  const two = (label: ReactNode, a: Amt, signed: boolean, pThb?: number | null, pCcy?: number | null) => (
    <div className="flex justify-between gap-3"><dt className="text-slate-500">{label}</dt>
      <dd className="text-right tabular-nums">
        {a.thb != null && <div className={`text-sm font-medium ${signed ? signTone(a.thb) : ""}`}>{signed ? signedMoney(a.thb, "THB") : money(a.thb, "THB")}{pctTxt(pThb ?? null)}</div>}
        {fx && a.ccy != null && <div className={signed ? signTone(a.ccy) : "font-medium text-blue-700"}>{signed ? signedMoney(a.ccy, currency) : money(a.ccy, currency)}{pctTxt(pCcy ?? null)}</div>}</dd></div>
  );
  const sub = (label: string, v: number | null, extra = "") => v != null && (
    <div className="flex justify-between gap-3 pl-3 text-slate-400"><dt>· {label}</dt><dd className={`tabular-nums ${signTone(v)}`}>{signedMoney(v, currency)}{extra}</dd></div>
  );
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
      <div className="text-xs text-slate-500">มูลค่าตลาด (THB)</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{money(value.thb)}</div>
      {fx && <div className="mt-1 text-xs text-slate-500">= <span className="font-medium text-blue-700">{money(value.ccy, currency)}</span></div>}
      {dateNote}
      <dl className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs">
        {lump ? <div className="flex justify-between gap-3"><dt className="text-slate-500">วิธีนับ</dt><dd>มูลค่าก้อนเดียว</dd></div>
          : <div className="flex justify-between gap-3"><dt className="text-slate-500">จำนวนที่ถือ · ต้นทุนเฉลี่ย</dt>
            <dd className="tabular-nums">{qty(quantity)} · {money(avgCost, fx ? currency : undefined, 4)}</dd></div>}
        {two("ต้นทุนที่ยังถือ", cost, false)}
        {split && <>
          {split.pre && <>
            {two("ผลตอบแทนก่อน Go-live", split.pre, true)}
            {sub("ราคาเปลี่ยน (ยังไม่รับรู้)", fx ? split.pre.ccy : split.pre.thb)}
          </>}
          {two("ผลตอบแทนตั้งแต่ Go-live (ก่อนภาษี)", split.since, true)}
          {sub("ปันผล ดอกเบี้ย คูปอง (รับแล้ว)", split.since.income, ` · ${incomeCount} ครั้ง`)}
          {sub(soldSince ? "ราคาเปลี่ยน / ขาย / ครบกำหนด" : "ราคาเปลี่ยน (ยังไม่รับรู้)", split.since.price)}
          {two("รวมผลตอบแทน", split.total, true, split.total.pctThb, split.total.pctCcy)}
        </>}
      </dl>
      {fx && split && <p className="mt-2 text-xs text-slate-400">บาท = รวมผลจากค่าเงิน · {currency} = ผลการลงทุนล้วน</p>}
    </div>
  );
}
