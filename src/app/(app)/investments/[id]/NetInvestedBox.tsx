"use client";

import { useState, type ReactNode } from "react";
import Modal from "@/components/Modal";
import { SMALL_BTN, money, thDate, signedMoney, signedPct } from "@/lib/format";
import { vsInvested, type CapitalLine } from "@/lib/net-invested";

const sign = (v: number) => (v > 0 ? "text-emerald-700" : v < 0 ? "text-red-700" : "text-slate-500");
const signed = (v: number, ccy?: string) => signedMoney(v, ccy, 0);
const pctTxt = (p: number | null) => (p == null ? "" : ` (${signedPct(p)})`);

/**
 * กล่องสรุปมูลค่าพอร์ต (รวมกล่องมูลค่าเป็นบาท + เงินลงทุนสุทธิ · ตกลง 5 พ.ย. 2026)
 * หัวกล่อง (children) = มูลค่าเป็นบาทที่ใช้ในความมั่งคั่งสุทธิ · ต่อด้วยเงินลงทุนสุทธิ / กำไร / ขาดทุนรวม / รายได้ลงทุน
 * เงินลงทุนสุทธิ = ต้นทุนรวมของยอดตั้งต้น (ก่อน Go-live · ตกลง 12 พ.ย. 2026) + โอนไป − โอนกลับ หลัง Go-live (ปุ่มโอนเงิน / ซื้อขายกับบัญชีธนาคารโดยตรง) · เทียบมูลค่าล่าสุด (รวมเงินโอนรอใส่ยอด)
 * พอร์ตต่างประเทศ: บาท = รวมผลค่าเงิน · สกุลพอร์ต = ผลการลงทุนล้วน · พอร์ตปิดแล้ว = กำไร / ขาดทุนที่รับรู้แล้ว
 * receivedThb / Ccy = ปันผล / ดอกเบี้ย / Coupon ที่เข้าบัญชีธนาคารโดยตรง (ไม่อยู่ในมูลค่า) → บวกกลับในกำไร / ขาดทุน (ตกลง 12 พ.ย. 2026)
 */
export default function NetInvestedBox({ currency, investedThb, investedCcy, valueThb, valueCcy, incomeThb, receivedThb, receivedCcy, closed, lines, children }: {
  currency: string; investedThb: number; investedCcy: number | null; valueThb: number | null; valueCcy: number | null;
  incomeThb: number; receivedThb: number; receivedCcy: number | null;
  closed: boolean; lines: CapitalLine[]; children: ReactNode;
}) {
  const [list, setList] = useState(false);
  const fx = currency !== "THB";
  const thb = vsInvested(valueThb, investedThb, receivedThb);
  const ccy = fx ? vsInvested(valueCcy, investedCcy, receivedCcy) : null;
  const hasReceived = Math.abs(receivedThb) > 0.005;
  const plLabel = closed ? "กำไร / ขาดทุน (รับรู้แล้ว)" : "กำไร / ขาดทุนรวม";
  const pct = pctTxt;
  const tone = sign;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
      {children}
      <dl className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs">
        <div className="flex justify-between gap-3"><dt className="text-slate-500">เงินลงทุนสุทธิ<div className="text-slate-400">ต้นทุนยอดตั้งต้น + โอนเข้า − โอนกลับ</div></dt>
          <dd className="text-right tabular-nums">{lines.length === 0 ? <span className="text-slate-500">ยังไม่มียอดตั้งต้น / เงินโอน</span> : <>
            <div className="text-sm font-medium">{money(investedThb, "THB", 0)}</div>
            {fx && <div className="text-slate-500">{investedCcy == null ? `${currency} ยังไม่ครบ` : money(investedCcy, currency, 0)}</div>}</>}</dd></div>
        {lines.length > 0 && (
          <div className="flex justify-between gap-3"><dt className="text-slate-500">{plLabel}
            {hasReceived && <div className="text-slate-400">รวมปันผล / ดอกเบี้ยที่เข้าบัญชีธนาคาร {money(receivedThb, "THB", 0)}</div>}</dt>
            <dd className="text-right tabular-nums">
              {thb && <div className={`text-sm font-medium ${tone(thb.pl)}`}>{signed(thb.pl, "THB")}{pct(thb.pct)}</div>}
              {ccy && <div className={tone(ccy.pl)}>{signed(ccy.pl, currency)}{pct(ccy.pct)}</div>}</dd></div>
        )}
        <div className="flex justify-between gap-3"><dt className="text-slate-500">รายได้ลงทุนตั้งแต่ Go-live<div className="text-slate-400">ก่อนภาษี</div></dt>
          <dd className="text-sm tabular-nums">{money(incomeThb, "THB", 0)}</dd></div>
      </dl>
      {fx && lines.length > 0 && <p className="mt-2 text-xs text-slate-400">บาท = รวมผลจากค่าเงิน · {currency} = ผลการลงทุนล้วน</p>}
      {lines.length > 0 && <div className="mt-3 text-sm">
        <button type="button" onClick={() => setList(true)} className={SMALL_BTN}>ดูรายการเงินโอน ({lines.length})</button>
      </div>}

      {list && (
        <Modal title="รายการเงินโอนเข้า-ออกพอร์ต" size="lg" onClose={() => setList(false)}>
          <div data-keep-open className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th>รายการ</th>
                <th className="text-right">บาท</th>{fx && <th className="text-right">{currency}</th>}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => (
                  <tr key={l.key} className="align-top">
                    <td className="py-1.5">{thDate(l.date)}</td>
                    <td>{l.kind === "PRE" ? "ต้นทุนรวมของยอดตั้งต้น (ก่อน Go-live)" : l.derived ? (l.kind === "OUT" ? "ซื้อ (ตัดบัญชีธนาคาร)" : "ขาย / ไถ่ถอน / ครบกำหนด (เข้าบัญชีธนาคาร)")
                      : l.kind === "OUT" ? "โอนเข้าพอร์ต" : "โอนกลับจากพอร์ต"}
                      <div className="text-xs text-slate-400">{l.kind === "PRE" ? "แก้ต้นทุนที่รายการยอดตั้งต้นของแต่ละตัวในแท็บรายการ"
                        : l.derived ? "แก้ที่รายการในแท็บรายการ" : "แก้ที่รายการโอนในหน้าพอร์ต"}</div></td>
                    <td className={`text-right tabular-nums ${sign(l.thb)}`}>{signed(l.thb)}</td>
                    {fx && <td className={`text-right tabular-nums ${l.ccy == null ? "text-slate-400" : sign(l.ccy)}`}>{l.ccy == null ? "—" : signed(l.ccy)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 font-medium">
                <tr><td className="py-1.5" colSpan={2}>เงินลงทุนสุทธิ</td>
                  <td className="text-right tabular-nums">{money(investedThb, undefined, 0)}</td>
                  {fx && <td className="text-right tabular-nums">{investedCcy == null ? "—" : money(investedCcy, undefined, 0)}</td>}</tr>
              </tfoot>
            </table>
            <p className="mt-2 text-xs text-slate-500">หลัง Go-live นับจากปุ่ม &ldquo;โอนเงิน&rdquo; ของพอร์ต และซื้อ / ขายที่ชำระกับบัญชีธนาคารโดยตรงให้อัตโนมัติ · — = ยังไม่ทราบยอดฝั่งพอร์ต (ไม่นับในยอด {currency})</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
