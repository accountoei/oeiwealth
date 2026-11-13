"use client";

import { Fragment, useActionState, useState, type ReactNode } from "react";
import Modal from "@/components/Modal";
import Flash from "@/components/Flash";
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
 * เงินลงทุนสุทธิ = ต้นทุนรวมของยอดตั้งต้น (ก่อน Go-live · ตกลง 12 พ.ย. 2026) + โอนไป − โอนกลับ หลัง Go-live (ปุ่มโอนเงิน / ซื้อขายกับบัญชีธนาคารโดยตรง) · เทียบมูลค่าล่าสุด (รวมเงินโอนรอใส่ยอด)
 * พอร์ตต่างประเทศ: บาท = รวมผลค่าเงิน · สกุลพอร์ต = ผลการลงทุนล้วน · พอร์ตปิดแล้ว = กำไร / ขาดทุนที่รับรู้แล้ว
 * receivedThb / Ccy = ปันผล / ดอกเบี้ย / Coupon ที่เข้าบัญชีธนาคารโดยตรง (ไม่อยู่ในมูลค่า) → บวกกลับในกำไร / ขาดทุน (ตกลง 12 พ.ย. 2026)
 * cost = ต้นทุนรวมของยอดตั้งต้น เมื่อใส่เงินที่โอนไปจริงก่อน Go-live แล้ว → แสดง เงินที่โอนไปจริง / ปรับกำไร (ขาดทุน) ก่อน Go-live / รวมต้นทุนยอดตั้งต้น (ตกลง 12 พ.ย. 2026)
 */
export default function NetInvestedBox({ currency, investedThb, investedCcy, valueThb, valueCcy, incomeThb, receivedThb, receivedCcy, closed, lines, openings = [], cost = null, preEdits = {}, moveEdits = {}, addPre = null, children }: {
  currency: string; investedThb: number; investedCcy: number | null; valueThb: number | null; valueCcy: number | null;
  incomeThb: number; receivedThb: number; receivedCcy: number | null;
  closed: boolean; lines: CapitalLine[];
  /** ต้นทุนยอดตั้งต้นรายตัว (แสดงใต้บรรทัดก่อน Go-live) · edit = RowActions ของรายการยอดตั้งต้น → คลิกแถวเพื่อแก้ (ตกลง 12 พ.ย. 2026) */
  openings?: { key: string; name: string; thb: number; local: number; currency: string; edit: ReactNode }[];
  /** ต้นทุนรวมของยอดตั้งต้น (เฉพาะเมื่อมีเงินที่โอนไปจริงก่อน Go-live) · preEdits = RowActions ของเงินที่โอนไปจริงแต่ละแถว · addPre = ปุ่มใส่เงินที่โอนไปจริง */
  cost?: CapitalLine | null; preEdits?: Record<string, ReactNode>; addPre?: { assetId: string; goLive: string } | null;
  /** เงินโอนหลัง Go-live (key = moveId) → RowActions เดียวกับรายการโอนในหน้าพอร์ต / ซื้อ-ขายในแท็บรายการ → คลิกแถวเพื่อแก้ / ลบ */
  moveEdits?: Record<string, ReactNode>;
  children: ReactNode;
}) {
  const [list, setList] = useState(false);
  const [add, setAdd] = useState(false);
  // แถวก่อน Go-live สุดท้าย → ต่อด้วยบรรทัดปรับกำไร (ขาดทุน) / รวมต้นทุนยอดตั้งต้น / ต้นทุนรายตัว
  const lastPre = lines.reduce((k, l, i) => (l.kind === "PRE" ? i : k), -1);
  const sent = lines.filter((l) => l.pre);
  const sentCcy = sent.some((l) => l.ccy == null) ? null : sent.reduce((t, l) => t + (l.ccy ?? 0), 0);
  const adj = cost && { thb: cost.thb - sent.reduce((t, l) => t + l.thb, 0), ccy: cost.ccy == null || sentCcy == null ? null : cost.ccy - sentCcy };
  const costHint = openings.some((o) => o.edit) ? "คลิกแถวรายตัวด้านล่างเพื่อแก้ต้นทุน" : "ต้นทุนรายตัวด้านล่าง";
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
        <div className="flex justify-between gap-3"><dt className="text-slate-500">เงินลงทุนสุทธิ<div className="text-slate-400">{cost ? "เงินที่โอนไปจริง" : "ต้นทุนยอดตั้งต้น"} + โอนเข้า − โอนกลับ</div></dt>
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
                {lines.map((l, i) => (
                  <Fragment key={l.key}>
                  <tr className="align-top">
                    <td className="py-1.5">{thDate(l.date)}</td>
                    <td>{l.pre ? "เงินที่โอนไปจริงก่อน Go-live" : l.kind === "PRE" ? "ต้นทุนรวมของยอดตั้งต้น (ก่อน Go-live)" : l.derived ? (l.kind === "OUT" ? "ซื้อ (ตัดบัญชีธนาคาร)" : "ขาย / ไถ่ถอน / ครบกำหนด (เข้าบัญชีธนาคาร)")
                      : l.kind === "OUT" ? "โอนเข้าพอร์ต" : "โอนกลับจากพอร์ต"}
                      {l.pre?.notes && <div className="text-xs text-slate-500">{l.pre.notes}</div>}
                      <div className="text-xs text-slate-400">{l.pre ? (preEdits[l.pre.id] ? "คลิกแถวเพื่อแก้" : "") : l.kind === "PRE" ? costHint
                        : l.moveId && moveEdits[l.moveId] ? (l.derived ? "คลิกแถวเพื่อแก้ / ลบรายการซื้อขาย" : "คลิกแถวเพื่อแก้ / ลบ")
                        : l.derived ? "แก้ที่รายการในแท็บรายการ" : "แก้ที่รายการโอนในหน้าพอร์ต"}</div>
                      {l.pre && preEdits[l.pre.id]}{l.moveId && moveEdits[l.moveId]}</td>
                    <td className={`text-right tabular-nums ${sign(l.thb)}`}>{signed(l.thb)}</td>
                    {fx && <td className={`text-right tabular-nums ${l.ccy == null ? "text-slate-400" : sign(l.ccy)}`}>{l.ccy == null ? "—" : signed(l.ccy)}</td>}
                  </tr>
                  {i === lastPre && cost && adj && <>
                    <tr className="align-top text-slate-600">
                      <td></td>
                      <td className="py-1.5">ปรับกำไร (ขาดทุน) ก่อน Go-live<div className="text-xs text-slate-400">ต้นทุนรวมของยอดตั้งต้น − เงินที่โอนไปจริง · ไม่นับในเงินลงทุนสุทธิ</div></td>
                      <td className="text-right tabular-nums">{signed(adj.thb)}</td>
                      {fx && <td className="text-right tabular-nums">{adj.ccy == null ? "—" : signed(adj.ccy)}</td>}
                    </tr>
                    <tr className="align-top text-slate-600">
                      <td className="py-1.5">{thDate(cost.date)}</td>
                      <td>รวมต้นทุนยอดตั้งต้น<div className="text-xs text-slate-400">{costHint}</div></td>
                      <td className="text-right tabular-nums">{money(cost.thb, undefined, 0)}</td>
                      {fx && <td className="text-right tabular-nums">{cost.ccy == null ? "—" : money(cost.ccy, undefined, 0)}</td>}
                    </tr>
                  </>}
                  {i === lastPre && openings.map((o) => (
                    <tr key={o.key} className="align-top text-xs text-slate-600">
                      <td></td>
                      <td className="py-1 pl-3">{o.name}{o.edit}</td>
                      <td className="text-right tabular-nums">{money(o.thb)}</td>
                      {fx && <td className="text-right tabular-nums">{money(o.local)}{o.currency !== currency ? ` ${o.currency}` : ""}</td>}
                    </tr>
                  ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 font-medium">
                <tr><td className="py-1.5" colSpan={2}>เงินลงทุนสุทธิ</td>
                  <td className="text-right tabular-nums">{money(investedThb, undefined, 0)}</td>
                  {fx && <td className="text-right tabular-nums">{investedCcy == null ? "—" : money(investedCcy, undefined, 0)}</td>}</tr>
              </tfoot>
            </table>
            <p className="mt-2 text-xs text-slate-500">ก่อน Go-live = เงินที่โอนไปจริง (ถ้าใส่ไว้) ไม่เช่นนั้นใช้ต้นทุนรวมของยอดตั้งต้น · หลัง Go-live นับจากปุ่ม &ldquo;โอนเงิน&rdquo; ของพอร์ต และซื้อ / ขายที่ชำระกับบัญชีธนาคารโดยตรงให้อัตโนมัติ · — = ยังไม่ทราบยอดฝั่งพอร์ต (ไม่นับในยอด {currency})</p>
            {addPre && <div className="mt-3"><button type="button" onClick={() => setAdd(true)} className={SMALL_BTN}>+ เงินที่โอนไปจริงก่อน Go-live</button></div>}
          </div>
        </Modal>
      )}
      {add && addPre && (
        <Modal title="เงินที่โอนไปจริงก่อน Go-live" onClose={() => setAdd(false)}>
          <AddForm assetId={addPre.assetId} currency={currency} goLive={addPre.goLive} />
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
        <label className="block text-sm text-slate-700">วันที่ *<input type="date" name="transfer_date" required max={max} defaultValue={max} className={input} /></label>
        <label className="block text-sm text-slate-700">เงินบาทที่โอนไป *<input name="amount_thb" inputMode="decimal" required className={input} /></label>
        {fx && <label className="block text-sm text-slate-700">{currency} ที่พอร์ตได้รับ<input name="amount_ccy" inputMode="decimal" className={input} /></label>}
        <label className="block text-sm text-slate-700 sm:col-span-full">หมายเหตุ<input name="notes" className={input} /></label>
      </div>
      <p className="text-xs text-slate-500">ใส่เงินที่โอนไปพอร์ตจริงก่อน Go-live (ยอดรวมยอดเดียว หรือแยกทีละครั้งก็ได้) · ระบบใช้ยอดนี้เป็นเงินลงทุนสุทธิแทนต้นทุนรวมของยอดตั้งต้น ส่วนต่างแสดงเป็น &ldquo;ปรับกำไร (ขาดทุน) ก่อน Go-live&rdquo;
        · ไม่กระทบยอดบัญชี มูลค่าพอร์ต หรือความมั่งคั่งสุทธิ · ต้องเป็นวันที่ก่อน Go-live ({thDate(goLive)})
        {fx && ` · ไม่ทราบยอด ${currency} เว้นว่างได้ (ยอดเทียบเป็น ${currency} จะยังไม่แสดง)`}</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="text-sm text-emerald-700" />
      </div>
    </form>
  );
}
