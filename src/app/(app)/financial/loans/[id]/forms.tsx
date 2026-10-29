"use client";

import Link from "next/link";
import { useActionSlot } from "@/components/ActionBar";
import { useActionState, useState } from "react";
import { closeLoan, disburseMore, receivePayment, updateLoanInfo, type ActionState } from "../actions";
import { ROW_BTN, numOrZero as num, thDate } from "@/lib/format";
import BalanceGuard from "@/components/BalanceGuard";
import { StatusSlot } from "@/components/StatusSelect";
import Flash from "@/components/Flash";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";
type Bank = { asset_id: string; name: string; currency: string };

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <Flash on={s} as="p" className="text-sm text-emerald-700" />;
  return null;
}

const amt = (v?: number) => (v ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

/**
 * บันทึกรับชำระ · ใช้จากตารางผ่อนได้ (เติมเงินต้น / ดอกเบี้ยของงวดให้ แก้ได้ถ้ารับจริงไม่เท่า)
 * interestOwed: ดอกเบี้ยค้างตามตาราง → มีช่อง "ยอดรวมที่รับ" แบ่งให้เอง: หักดอกเบี้ยค้างก่อน ที่เหลือเป็นเงินต้น
 * principalDue: เงินต้นที่ถึงกำหนดตามตาราง → บันทึกแล้วถ้ารับเงินต้นเกิน / ขาด ถามต่อว่าจะคำนวณงวดที่เหลือใหม่ไหม
 */
export function PaymentForm({ assetId, currency, banks, today, minDate, principal, interest, interestOwed, principalDue, title, outstanding,
  button = "บันทึกรับชำระ", small = false }: {
  assetId: string; currency: string; banks: Bank[]; today: string; minDate: string;
  principal?: number; interest?: number; interestOwed?: number; principalDue?: number; title?: string; button?: string; small?: boolean;
  /** เงินต้นคงเหลือก่อนรับ → รับครบแล้วถามต่อว่าจะปิดสัญญาไหม */
  outstanding?: number;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(receivePayment, {});
  const [p, setP] = useState(amt(principal));
  const [i, setI] = useState(amt(interest));
  const [total, setTotal] = useState(amt((principal ?? 0) + (interest ?? 0)));
  const list = banks.filter((b) => b.currency === currency);
  const split = (v: string) => {
    setTotal(v);
    const t = num(v);
    const ii = Math.min(t, Math.max(0, interestOwed ?? 0));
    setI(amt(Math.round(ii * 100) / 100)); setP(amt(Math.round((t - ii) * 100) / 100));
  };
  const sumOf = (pp: string, iv: string) => setTotal(amt(num(pp) + num(iv)));
  const extra = principalDue != null ? Math.round((num(p) - principalDue) * 100) / 100 : 0;
  const [dismissed, setDismissed] = useState(false);
  const [closeState, closeAction, closing] = useActionState<ActionState, FormData>(closeLoan, {});
  const trigger = <button type="button" onClick={() => setOpen(!open)}
    className={activeCls(small ? ROW_BTN : btn)}>{button}</button>;
  if (state.ok && outstanding != null && num(p) >= outstanding - 0.005 && !dismissed && open) {
    // รับเงินต้นครบ → ถามต่อในหน้าต่างเดิมว่าจะปิดสัญญาไหม (ไม่ปิดเอง)
    return present(trigger, (
      <form action={closeAction} data-keep-open className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-left text-sm">
        <input type="hidden" name="asset_id" value={assetId} />
        <p className="text-emerald-700">{state.ok}</p>
        {closeState.ok ? <p className="font-medium text-emerald-800">{closeState.ok}</p> : <>
          <p className="font-medium text-slate-900">รับเงินต้นครบแล้ว (คงเหลือ 0) — เปลี่ยนสถานะเป็น &ldquo;ปิดแล้ว&rdquo; เลยไหม?</p>
          <div className="flex flex-wrap gap-2">
            <button disabled={closing} className="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50">{closing ? "กำลังปิด…" : "ปิดสัญญา"}</button>
            <button type="button" onClick={() => { setDismissed(true); setOpen(false); }} className="px-2 text-slate-500 underline">ยังไม่ปิด</button>
          </div>
          {closeState.error && <p className="text-red-600">{closeState.error}</p>}
        </>}
        {closeState.ok && <button type="button" onClick={() => { setDismissed(true); setOpen(false); }} className="text-slate-500 underline">ปิดหน้าต่าง</button>}
      </form>
    ));
  }
  if (state.ok && Math.abs(extra) > 0.01 && !dismissed && open) {
    const more = extra > 0;
    const href = (k: string) => `/financial/loans/${assetId}?restructure=${k}`;
    // ถามต่อในหน้าต่างเดิม (ไม่ปิดเอง)
    return present(trigger, (
      <div data-keep-open className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left text-sm">
        <p className="text-emerald-700">{state.ok}</p>
        <p className="font-medium text-slate-900">รับเงินต้น{more ? "เกิน" : "ขาด"}งวด {amt(Math.abs(extra))} — จะคำนวณงวดที่เหลือใหม่จากเงินต้นคงเหลือจริงเลยไหม?</p>
        <div className="flex flex-wrap gap-2">
          <Link href={href("end")} onClick={() => { setDismissed(true); setOpen(false); }} className="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700">{more ? "ลดค่างวด" : "เพิ่มค่างวด"} (จบวันเดิม)</Link>
          <Link href={href("payment")} onClick={() => { setDismissed(true); setOpen(false); }} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">{more ? "จบเร็วขึ้น" : "ขยายงวด"} (ค่างวดเดิม)</Link>
          <button type="button" onClick={() => { setDismissed(true); setOpen(false); }} className="px-2 text-slate-500 underline">ไม่ต้อง (ตารางเดิม)</button>
        </div>
        <p className="text-xs text-slate-500">{more ? "ไม่ปรับก็ได้ — ส่วนที่เกินจะหักงวดถัดไปตามลำดับ" : "ไม่ปรับก็ได้ — ส่วนที่ขาดเป็นยอดค้างของงวดนี้ (เลยกำหนดแล้วขึ้น \"เลยกำหนด\")"} · ปรับตาราง = ดอกเบี้ยงวดที่เหลือคิดใหม่ตามยอดคงเหลือ</p>
      </div>
    ));
  }
  if (state.ok && small && !open) return <Flash on={state} className="text-xs text-emerald-700" />;
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-left">
      <input type="hidden" name="asset_id" value={assetId} />
      <h3 className="font-medium text-slate-900">{title ?? "รับชำระเงินกู้"}</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">วันที่ได้รับ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className="text-sm">เข้าบัญชี *
          <select name="bank_asset_id" required className={input}>{list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}</select>
        </label>
        <span />
        {interestOwed != null && (
          <label className="text-sm md:col-span-3">ยอดรวมที่รับ (ตาม Statement)
            <input value={total} onChange={(e) => split(e.target.value)} inputMode="decimal" data-money="off" className={`${input} md:w-1/3`} />
            <span className="mt-1 block text-xs text-slate-500">
              แบ่งให้เอง: หักดอกเบี้ยค้าง {amt(interestOwed) || "0.00"} ก่อน ที่เหลือเป็นเงินต้น · แก้ 2 ช่องด้านล่างเองได้
            </span>
          </label>
        )}
        <label className="text-sm">ส่วนเงินต้น<input name="principal" inputMode="decimal" value={p}
          onChange={(e) => { setP(e.target.value); sumOf(e.target.value, i); }} className={input} /></label>
        <label className="text-sm">ส่วนดอกเบี้ย (Gross)<input name="interest" inputMode="decimal" value={i}
          onChange={(e) => { setI(e.target.value); sumOf(p, e.target.value); }} className={input} /></label>
        <label className="text-sm">ภาษีหัก ณ ที่จ่ายของดอกเบี้ย<input name="interest_tax" inputMode="decimal" className={input} /></label>
        <label className="text-sm md:col-span-3">หมายเหตุ<input name="notes" className={input} /></label>
      </div>
      <p className="text-xs text-slate-500">เงินต้น = ลดยอดเงินให้กู้ (ไม่ใช่รายได้) · ดอกเบี้ย = รายได้ · ระบบสร้างรายการเงินเข้าบัญชีให้ทั้งสองส่วน</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}

export function DisburseForm({ assetId, currency, banks, today, minDate, hasOpenSchedule = false }: {
  assetId: string; currency: string; banks: Bank[]; today: string; minDate: string;
  /** มีงวดที่ยังไม่ได้รับ → บันทึกแล้วถามต่อว่าจะคำนวณงวดที่เหลือใหม่ไหม (ตารางเดิมไม่รวมยอดที่ให้กู้เพิ่ม) */
  hasOpenSchedule?: boolean;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [state, action, pending] = useActionState<ActionState, FormData>(disburseMore, {});
  const [dismissed, setDismissed] = useState(false);
  const list = banks.filter((b) => b.currency === currency);
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(obtn)}>ให้กู้เพิ่ม</button>;
  if (state.ok && hasOpenSchedule && !dismissed && open) {
    return present(trigger, (
      <div data-keep-open className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left text-sm">
        <p className="text-emerald-700">{state.ok}</p>
        <p className="font-medium text-slate-900">ตารางผ่อนยังไม่รวมยอดที่ให้กู้เพิ่ม — จะคำนวณงวดที่เหลือใหม่เลยไหม?</p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/financial/loans/${assetId}?restructure=disburse`} onClick={() => { setDismissed(true); setOpen(false); }}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700">คำนวณงวดที่เหลือใหม่</Link>
          <button type="button" onClick={() => { setDismissed(true); setOpen(false); }} className="px-2 text-slate-500 underline">ไว้ทีหลัง</button>
        </div>
        <p className="text-xs text-slate-500">ไม่ปรับก็ได้ — งวดเดิมไม่เปลี่ยน · ยอดที่ให้กู้เพิ่มยังไม่มีในตาราง</p>
      </div>
    ));
  }
  if (!open) return trigger;
  return present(trigger, (
    <form action={action} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <input type="hidden" name="asset_id" value={assetId} />
      <h3 className="font-medium text-slate-900">ให้กู้เพิ่ม</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className="text-sm">จ่ายจากบัญชี *
          <select name="bank_asset_id" required className={input}>{list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}</select>
        </label>
        <label className="text-sm">จำนวนเงิน *<input name="amount" required inputMode="decimal" className={input} /></label>
        <label className="text-sm md:col-span-3">รายละเอียด<input name="description" className={input} /></label>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <BalanceGuard />
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}

/** แก้รายละเอียดเงินให้กู้ (ชื่อรายการ · ผู้กู้ · ดอกเบี้ย · ครบกำหนด · หมายเหตุ) */
export function LoanInfoForm({ assetId, v, minDue, risk, hasOpenSchedule = false }: {
  /** งวดสุดท้ายในตารางผ่อน → วันครบกำหนดสัญญาต้องไม่ก่อนวันนี้ */
  minDue?: string | null;
  /** สถานะ "มีความเสี่ยง": ช่องมูลค่าคาดว่าจะได้รับคืน (เก็บเป็นส่วนที่มีความเสี่ยง · แสดงอย่างเดียว ไม่กระทบ Net Worth) */
  risk?: { outstanding: number; expected: number | null; date: string | null; note: string | null; currency: string; today: string };
  hasOpenSchedule?: boolean;
  assetId: string; v: { name: string; borrower_name: string; interest_rate: number | null; due_date: string | null; notes: string | null;
    borrower_phone: string | null; contract_no: string | null; purpose: string | null };
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateLoanInfo, {});
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="asset_id" value={assetId} />
      <label className="text-sm">ชื่อรายการ *<input name="name" required defaultValue={v.name} className={input} /></label>
      <label className="text-sm">ผู้กู้ *<input name="borrower_name" required defaultValue={v.borrower_name} className={input} /></label>
      <label className="text-sm">เบอร์ติดต่อผู้กู้<input name="borrower_phone" type="tel" maxLength={50} defaultValue={v.borrower_phone ?? ""} className={input} /></label>
      <label className="text-sm">เลขที่สัญญา<input name="contract_no" maxLength={100} defaultValue={v.contract_no ?? ""} className={input} /></label>
      <label className="text-sm md:col-span-2">วัตถุประสงค์<input name="purpose" maxLength={500} defaultValue={v.purpose ?? ""} className={input} /></label>
      <label className="text-sm">ดอกเบี้ย (% ต่อปี)<input name="interest_rate" inputMode="decimal" defaultValue={v.interest_rate ?? ""} className={input} /></label>
      <label className="text-sm">ครบกำหนดสัญญา<input name="due_date" type="date" defaultValue={v.due_date ?? ""} min={minDue ?? undefined} required={!!minDue} className={input} />
        {minDue && <span className="mt-1 block text-xs text-slate-500">ต้องไม่ก่อนงวดสุดท้ายในตารางผ่อน ({thDate(minDue)})</span>}</label>
      <label className="text-sm md:col-span-2">หมายเหตุ<textarea name="notes" rows={2} defaultValue={v.notes ?? ""} className={input} /></label>
      {risk && (
        <fieldset className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 md:col-span-2 md:grid-cols-2">
          <legend className="px-1 text-sm font-medium text-amber-800">มีความเสี่ยงไม่ได้คืน</legend>
          <label className="text-sm">มูลค่าคาดว่าจะได้รับคืน ({risk.currency})
            <input name="expected_recoverable" inputMode="decimal" defaultValue={risk.expected == null ? "" : amt(risk.expected) || "0.00"} className={input} />
            <span className="mt-1 block text-xs text-slate-500">จากเงินต้นคงเหลือ {amt(risk.outstanding) || "0.00"} · ส่วนที่เหลือ = ส่วนที่มีความเสี่ยง (แสดงแยก · Net Worth ยังนับเต็มจนตัดหนี้สูญ)</span></label>
          <label className="text-sm">ประเมิน ณ วันที่<input name="risk_assessed_date" type="date" defaultValue={risk.date ?? risk.today} max={risk.today} className={input} /></label>
          <label className="text-sm md:col-span-2">เหตุผล / หมายเหตุการประเมิน<input name="risk_note" defaultValue={risk.note ?? ""} className={input} /></label>
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกรายละเอียด"}</button>
        <StatusSlot />
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        <Flash on={state} as="span" className="text-sm text-emerald-700" />
      </div>
      {state.ok && state.rateChanged && hasOpenSchedule && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-slate-700 md:col-span-2">
          เปลี่ยนอัตราดอกเบี้ยแล้ว — ตารางผ่อนยังคิดดอกเบี้ยอัตราเดิม ·{" "}
          <Link href={`/financial/loans/${assetId}?restructure=rate`} className="text-blue-700 hover:underline">คำนวณงวดที่เหลือใหม่ด้วยอัตราใหม่ →</Link>
        </p>
      )}
    </form>
  );
}
