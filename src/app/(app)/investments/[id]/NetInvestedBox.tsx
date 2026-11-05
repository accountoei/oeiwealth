"use client";

import { useActionState, useState, type ReactNode } from "react";
import Modal from "@/components/Modal";
import Flash from "@/components/Flash";
import RowActions from "@/components/RowActions";
import { addCapitalTransfer, type ActionState } from "../actions";
import { SMALL_BTN, money, thDate, signedMoney, signedPct } from "@/lib/format";
import { vsInvested, type CapitalLine } from "@/lib/net-invested";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const sign = (v: number) => (v > 0 ? "text-emerald-700" : v < 0 ? "text-red-700" : "text-slate-500");
const signed = (v: number, ccy?: string) => signedMoney(v, ccy, 0);
const pctTxt = (p: number | null) => (p == null ? "" : ` (${signedPct(p)})`);

/**
 * กล่องสรุปมูลค่าพอร์ต (รวมกล่องมูลค่าเป็นบาท + เงินลงทุนสุทธิ · ตกลง 5 พ.ย. 2026)
 * หัวกล่อง (children) = มูลค่าเป็นบาทที่ใช้ในความมั่งคั่งสุทธิ · ต่อด้วยเงินลงทุนสุทธิ / กำไร / ขาดทุนรวม / รายได้ลงทุน
 * เงินลงทุนสุทธิ = เงินโอนเข้าก่อน Go-live (กรอกที่นี่) + โอนไป − โอนกลับ หลัง Go-live (ปุ่มโอนเงิน) · เทียบมูลค่าล่าสุด (รวมเงินโอนรอใส่ยอด)
 * พอร์ตต่างประเทศ: บาท = รวมผลค่าเงิน · สกุลพอร์ต = ผลการลงทุนล้วน · พอร์ตปิดแล้ว = กำไร / ขาดทุนที่รับรู้แล้ว
 * missingPre = พอร์ตมียอดตั้งต้นก่อน Go-live แต่ยังไม่ได้ใส่เงินโอนก่อน Go-live → ไม่แสดง % (ยอดยังไม่ครบ)
 */
export default function NetInvestedBox({ assetId, currency, investedThb, investedCcy, valueThb, valueCcy, incomeThb, missingPre, closed, lines, goLive, canWrite, canDelete, paths, children }: {
  assetId: string; currency: string; investedThb: number; investedCcy: number | null; valueThb: number | null; valueCcy: number | null;
  incomeThb: number; missingPre: boolean;
  closed: boolean; lines: CapitalLine[]; goLive: string; canWrite: boolean; canDelete: boolean; paths: string[]; children: ReactNode;
}) {
  const [list, setList] = useState(false);
  const [add, setAdd] = useState(false);
  const fx = currency !== "THB";
  const thb = vsInvested(valueThb, investedThb);
  const ccy = fx ? vsInvested(valueCcy, investedCcy) : null;
  const plLabel = closed ? "กำไร / ขาดทุน (รับรู้แล้ว)" : "กำไร / ขาดทุนรวม";
  const pct = (p: number | null) => (missingPre ? "" : pctTxt(p));
  const tone = (v: number) => (missingPre ? "text-slate-500" : sign(v));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 num-box">
      {children}
      <dl className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs">
        <div className="flex justify-between gap-3"><dt className="text-slate-500">เงินลงทุนสุทธิ<div className="text-slate-400">เงินโอนเข้า − โอนกลับ</div></dt>
          <dd className="text-right tabular-nums">{lines.length === 0 ? <span className="text-slate-500">ยังไม่มีเงินโอน</span> : <>
            <div className="text-sm font-medium">{money(investedThb, "THB", 0)}</div>
            {fx && <div className="text-slate-500">{investedCcy == null ? `${currency} ยังไม่ครบ` : money(investedCcy, currency, 0)}</div>}</>}</dd></div>
        {lines.length > 0 && (
          <div className="flex justify-between gap-3"><dt className="text-slate-500">{plLabel}</dt>
            <dd className="text-right tabular-nums">
              {thb && <div className={`text-sm font-medium ${tone(thb.pl)}`}>{signed(thb.pl, "THB")}{pct(thb.pct)}</div>}
              {ccy && <div className={tone(ccy.pl)}>{signed(ccy.pl, currency)}{pct(ccy.pct)}</div>}</dd></div>
        )}
        <div className="flex justify-between gap-3"><dt className="text-slate-500">รายได้ลงทุนตั้งแต่ Go-live<div className="text-slate-400">ก่อนภาษี</div></dt>
          <dd className="text-sm tabular-nums">{money(incomeThb, "THB", 0)}</dd></div>
      </dl>
      {missingPre && (
        <p className="mt-2 text-xs text-amber-700">ยังไม่ได้ใส่เงินโอนก่อน Go-live · กำไร / ขาดทุนยังไม่ครบ{canWrite && goLive ? " (กด “+ เงินโอนก่อน Go-live”)" : ""}</p>
      )}
      {fx && lines.length > 0 && <p className="mt-2 text-xs text-slate-400">บาท = รวมผลจากค่าเงิน · {currency} = ผลการลงทุนล้วน</p>}
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        {lines.length > 0 && <button type="button" onClick={() => setList(true)} className={SMALL_BTN}>ดูรายการเงินโอน ({lines.length})</button>}
        {canWrite && goLive && <button type="button" onClick={() => setAdd(true)} className={SMALL_BTN}>+ เงินโอนก่อน Go-live</button>}
      </div>

      {list && (
        <Modal title="รายการเงินโอนเข้า-ออกพอร์ต" size="lg" onClose={() => setList(false)}>
          <div data-keep-open className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">วันที่</th><th>รายการ</th>
                <th className="text-right">บาท</th>{fx && <th className="text-right">{currency}</th>}<th></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => (
                  <tr key={l.key} className="align-top">
                    <td className="py-1.5">{thDate(l.date)}</td>
                    <td>{l.kind === "PRE" ? "โอนเข้า (ก่อน Go-live)" : l.kind === "OUT" ? "โอนเข้าพอร์ต" : "โอนกลับจากพอร์ต"}
                      {l.pre?.notes && <div className="text-xs text-slate-500">{l.pre.notes}</div>}
                      {l.kind !== "PRE" && <div className="text-xs text-slate-400">แก้ที่รายการโอนในหน้าพอร์ต</div>}</td>
                    <td className={`text-right tabular-nums ${sign(l.thb)}`}>{signed(l.thb)}</td>
                    {fx && <td className={`text-right tabular-nums ${l.ccy == null ? "text-slate-400" : sign(l.ccy)}`}>{l.ccy == null ? "—" : signed(l.ccy)}</td>}
                    <td className="pl-2 text-right">{l.pre && canWrite && <RowActions table="portfolio_capital_transfers" id={l.pre.id} paths={paths} canDelete={canDelete}
                      deleteEffect="ลบเฉพาะข้อมูลอ้างอิง ไม่กระทบยอดบัญชี / มูลค่าพอร์ต"
                      fields={[{ name: "transfer_date", label: "วันที่โอน", type: "date", value: l.pre.transfer_date },
                        { name: "amount_thb", label: "เงินบาทที่โอน", type: "number", value: l.pre.amount_thb },
                        ...(fx ? [{ name: "amount_ccy", label: `${currency} ที่พอร์ตได้รับ`, type: "number" as const, value: l.pre.amount_ccy }] : []),
                        { name: "notes", label: "หมายเหตุ", value: l.pre.notes, wide: true }]} />}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 font-medium">
                <tr><td className="py-1.5" colSpan={2}>เงินลงทุนสุทธิ</td>
                  <td className="text-right tabular-nums">{money(investedThb, undefined, 0)}</td>
                  {fx && <td className="text-right tabular-nums">{investedCcy == null ? "—" : money(investedCcy, undefined, 0)}</td>}<td></td></tr>
              </tfoot>
            </table>
            <p className="mt-2 text-xs text-slate-500">หลัง Go-live นับจากปุ่ม &ldquo;โอนเงิน&rdquo; ของพอร์ตให้อัตโนมัติ · — = ยังไม่ทราบยอดฝั่งพอร์ต (ไม่นับในยอด {currency})</p>
          </div>
        </Modal>
      )}
      {add && (
        <Modal title="เงินโอนเข้าพอร์ตก่อน Go-live" onClose={() => setAdd(false)}>
          <AddForm assetId={assetId} currency={currency} goLive={goLive} />
        </Modal>
      )}
    </div>
  );
}

function AddForm({ assetId, currency, goLive }: { assetId: string; currency: string; goLive: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addCapitalTransfer, {});
  const fx = currency !== "THB";
  // วันสุดท้ายก่อน Go-live (ฐานข้อมูลตรวจซ้ำ)
  const max = new Date(Date.parse(goLive) - 86400000).toISOString().slice(0, 10);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="asset_id" value={assetId} />
      <div className={`grid gap-3 ${fx ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <label className="block text-sm text-slate-700">วันที่โอน *<input type="date" name="transfer_date" required max={max} className={input} /></label>
        <label className="block text-sm text-slate-700">เงินบาทที่โอน *<input name="amount_thb" inputMode="decimal" required className={input} /></label>
        {fx && <label className="block text-sm text-slate-700">{currency} ที่พอร์ตได้รับ<input name="amount_ccy" inputMode="decimal" className={input} /></label>}
        <label className="block text-sm text-slate-700 sm:col-span-full">หมายเหตุ<input name="notes" className={input} /></label>
      </div>
      <p className="text-xs text-slate-500">ใช้เทียบเงินลงทุนกับมูลค่าล่าสุดเท่านั้น ไม่กระทบยอดบัญชี มูลค่าพอร์ต หรือความมั่งคั่งสุทธิ · ต้องเป็นวันที่ก่อน Go-live ({thDate(goLive)}) · โอนตั้งแต่วัน Go-live ใช้ปุ่ม &ldquo;โอนเงิน&rdquo;
        {fx && ` · ไม่ทราบยอด ${currency} เว้นว่างได้ (ยอดเทียบเป็น ${currency} จะยังไม่แสดง)`}</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="text-sm text-emerald-700" />
      </div>
    </form>
  );
}
