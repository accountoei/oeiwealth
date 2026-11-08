"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { addCoverage, payPremium, receiveBenefit, syncCashValue, updatePolicyInfo, type ActionState, type PayState } from "../actions";
import AssetValuationForm from "@/components/AssetValuationForm";
import { SMALL_BTN, COVERAGE_LABEL, INS_TAX, INS_TYPE, INS_TYPE_EDITABLE, ROW_BTN, money, thDate } from "@/lib/format";
import { useRowPanel } from "@/components/RowPanel";
import BalanceGuard from "@/components/BalanceGuard";
import { StatusSlot } from "@/components/StatusSelect";
import Flash from "@/components/Flash";
import BankOptions from "@/components/BankOptions";
import PayDefaultSelect from "../PayDefaultSelect";

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";
const sbtn = "rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50";

type Bank = { asset_id: string; name: string; currency: string };
type Card = { id: string; label: string; currency: string };
type Person = { id: string; name: string };

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <span className="text-sm text-red-600">{s.error}</span>;
  if (s.ok) return <Flash on={s} as="span" className="text-sm text-emerald-700" />;
  return null;
}

/** บันทึกจ่ายเบี้ยของงวด → ค่าใช้จ่ายหมวด "ประกัน" (บัญชี / บัตร / เงินสด) */
/** มูลค่าเวนคืนของกรมธรรม์ (ใช้ถามต่อหลังบันทึกจ่ายเบี้ย) · suggest = ตามตารางในสัญญา ปีล่าสุดที่ถึงวันแล้ว */
export type CashValueCtx = { assetId: string; currency: string; current: number | null; minDate: string; paths: string[];
  suggest: { value: number; year: number; date: string } | null };

export function PayPremiumForm({ policyId, lineId, label, amount, currency, banks, cards, persons, defaultPerson, defaultPay = "", today, cashValue }: {
  policyId: string; lineId: string; label: string; amount: number; currency: string;
  banks: Bank[]; cards: Card[]; persons: Person[]; defaultPerson?: string | null;
  /** จ่ายเบี้ยจาก (ค่าตั้งต้นของกรมธรรม์): "a:<บัญชี>" / "c:<บัตร>" · ไม่มี / ไม่ตรงสกุล = บัญชีแรกแบบเดิม */ defaultPay?: string;
  today: string; cashValue?: CashValueCtx | null;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const defBank = defaultPay.startsWith("a:") && banks.some((b) => b.asset_id === defaultPay.slice(2) && b.currency === currency) ? defaultPay.slice(2) : undefined;
  const defCard = defaultPay.startsWith("c:") && cards.some((c) => c.id === defaultPay.slice(2) && c.currency === currency) ? defaultPay.slice(2) : undefined;
  const [via, setVia] = useState(defCard ? "card" : defBank || banks.length ? "bank" : cards.length ? "card" : "cash");
  const [state, action, pending] = useActionState<PayState, FormData>(payPremium, {});
  if (state.ok) {
    const done = <Flash on={state} className="text-xs text-emerald-700" />;
    // ลงตามตารางในสัญญาให้แล้ว หรือไม่มีมูลค่าเวนคืน → จบ · ไม่งั้นถามอัปเดตมูลค่าเวนคืนต่อ (กดข้ามได้)
    if (state.cv && state.cv.added > 0) return <Flash on={state} className="text-xs text-emerald-700">{state.ok} · มูลค่าเวนคืนตามสัญญา {money(state.cv.value)} (ปีที่ {state.cv.policy_year})</Flash>;
    if (!cashValue || !open) return done;
    const sug = cashValue.suggest;
    return present(done, (
      <div className="space-y-3 text-left">
        <div>
          <h3 className="font-medium text-slate-900">{state.ok} · อัปเดตมูลค่าเวนคืนด้วยไหม?</h3>
          <p className="text-xs text-slate-500">ตอนนี้ {money(cashValue.current, cashValue.currency)}
            {sug ? <> · ตามตารางในสัญญา สิ้นปีกรมธรรม์ที่ {sug.year} ({thDate(sug.date)}) = {money(sug.value, cashValue.currency)}</>
              : " · ยังไม่มีตารางมูลค่าเวนคืนตามสัญญา (ใส่ได้ที่ส่วน \"มูลค่าเวนคืน\" ด้านล่าง)"}</p>
        </div>
        <AssetValuationForm assetId={cashValue.assetId} currency={cashValue.currency} today={today} minDate={cashValue.minDate} paths={cashValue.paths}
          defaultValue={sug?.value ?? cashValue.current ?? undefined} defaultNotes={sug ? `ตามตารางในสัญญา ปีที่ ${sug.year}` : undefined}
          methods={[["STATEMENT", "ตามหนังสือแจ้ง / ตารางในสัญญา"], ["USER_ESTIMATE", "ประมาณเอง"]]} />
        <button type="button" onClick={() => setOpen(false)} className={SMALL_BTN}>ข้าม</button>
      </div>
    ));
  }
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(ROW_BTN)}>บันทึกจ่าย</button>;
  if (!open) return trigger;
  const sameBanks = banks.filter((b) => b.currency === currency);
  const sameCards = cards.filter((c) => c.currency === currency);
  return present(trigger, (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2 text-left">
      <input type="hidden" name="policy_id" value={policyId} />
      <input type="hidden" name="line_id" value={lineId} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="description" value={label} />
      <label className="text-xs">ยอดที่จ่าย<input name="amount" required inputMode="decimal" defaultValue={amount > 0 ? amount.toFixed(2) : ""} className={`mt-1 block w-28 ${small}`} /></label>
      <label className="text-xs">วันที่จ่าย<input name="date" type="date" required defaultValue={today} max={today} className={`mt-1 block ${small}`} /></label>
      <label className="text-xs">จ่ายจาก
        <select name="pay_via" value={via} onChange={(e) => setVia(e.target.value)} className={`mt-1 block ${small}`}>
          <option value="bank">บัญชีธนาคาร</option><option value="card">บัตรเครดิต</option><option value="cash">เงินสด</option>
        </select>
      </label>
      {via === "bank" && <label className="text-xs">บัญชี<select name="bank_asset_id" required defaultValue={defBank} className={`mt-1 block ${small}`}>
        <BankOptions banks={sameBanks} /></select></label>}
      {via === "card" && <label className="text-xs">บัตร<select name="card_id" required defaultValue={defCard} className={`mt-1 block ${small}`}>
        {sameCards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
      {via === "cash" && <label className="text-xs">ผู้จ่าย<select name="person_id" required defaultValue={defaultPerson ?? undefined} className={`mt-1 block ${small}`}>
        {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <label className="text-xs">หมายเหตุ<input name="notes" className={`mt-1 block w-32 ${small}`} /></label>
      <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-50">บันทึก</button>
      <BalanceGuard />
      <button type="button" data-close onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  ));
}

/**
 * รับผลประโยชน์ / ครบสัญญา / เวนคืน / สินไหม
 * มีมูลค่าเวนคืน: ถอนจากมูลค่าเวนคืนก่อน ส่วนที่เกิน = รายได้ "ผลประโยชน์ประกัน"
 */
export function BenefitForm({ policyId, lineId, amount, currency, banks, persons, hasCashValue, cashValue, today, button = "บันทึกรับ",
  small: isSmall = false, canClose = true }: {
  policyId: string; lineId?: string; amount?: number; currency: string; banks: Bank[]; persons: Person[];
  hasCashValue: boolean; cashValue?: number | null; today: string; button?: string; small?: boolean; canClose?: boolean;
}) {
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [outcome, setOutcome] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(receiveBenefit, {});
  if (state.ok && isSmall) return <Flash on={state} className="text-xs text-emerald-700" />;
  const trigger = <button type="button" onClick={() => setOpen(!open)} className={activeCls(isSmall ? ROW_BTN : obtn)}>{button}</button>;
  if (!open) return trigger;
  const sameBanks = banks.filter((b) => b.currency === currency);
  return present(trigger, (
    <form action={action} className="w-full space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-left">
      <input type="hidden" name="policy_id" value={policyId} />
      {lineId && <input type="hidden" name="line_id" value={lineId} />}
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">ยอดที่ได้รับ ({currency}) *<input name="amount" required inputMode="decimal" defaultValue={amount ? amount.toFixed(2) : ""} className={input} /></label>
        <label className="text-sm">วันที่ได้รับ *<input name="date" type="date" required defaultValue={today} max={today} className={input} /></label>
        <label className="text-sm">เข้าบัญชี *<select name="bank_asset_id" required className={input}>
          <BankOptions banks={sameBanks} /></select></label>
        {canClose && (
          <label className="text-sm">เป็นการ
            <select name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={input}>
              <option value="">รับผลประโยชน์ (กรมธรรม์ยังมีผล)</option>
              <option value="MATURED">ครบสัญญา (ปิดกรมธรรม์)</option>
              <option value="SURRENDERED">เวนคืน (ปิดกรมธรรม์)</option>
              <option value="CLAIMED">สินไหมมรณกรรม / เคลมจบ (ปิดกรมธรรม์)</option>
            </select>
          </label>
        )}
        <label className="text-sm">ผู้รับเงิน
          <select name="person_id" defaultValue="" className={input}>
            <option value="">{hasCashValue ? "ตามเจ้าของมูลค่าเวนคืน" : "ผู้จ่ายเบี้ย"}</option>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-sm">หมายเหตุ<input name="notes" className={input} /></label>
        {hasCashValue && (
          <label className="flex items-start gap-2 text-sm md:col-span-3">
            <input type="hidden" name="use_cash_value" value="off" />
            <input type="checkbox" name="use_cash_value" value="on" defaultChecked className="mt-1" />
            <span>ถอนจากมูลค่าเวนคืนก่อน{cashValue != null && ` (ตอนนี้ ${money(cashValue, currency)})`} — ส่วนที่เกินนับเป็นรายได้
              <span className="block text-xs text-slate-500">ไม่ติ๊ก = นับเป็นรายได้ทั้งหมด (เช่น บำนาญ / สินไหมที่ไม่เกี่ยวกับมูลค่าเวนคืน)</span></span>
          </label>
        )}
      </div>
      {outcome && <p className="text-xs text-amber-700">ปิดกรมธรรม์: สถานะเปลี่ยนเป็น &ldquo;{outcome === "MATURED" ? "ครบสัญญา" : outcome === "SURRENDERED" ? "เวนคืนแล้ว" : "เคลมจบแล้ว"}&rdquo;{hasCashValue && " · มูลค่าเวนคืนที่เหลือเป็น 0"} · งวดเบี้ยที่ยังไม่จ่ายไม่ต้องจ่ายแล้ว</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button type="button" data-close onClick={() => setOpen(false)} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  ));
}

/**
 * แก้ข้อมูลกรมธรรม์ (ในหน้าต่าง "แก้ไขข้อมูล") · แบบผสม (ตกลง 7 พ.ย. 2026)
 *   booklet = สัญญาหลักของเล่ม: ช่องที่ต้องเหมือนกันทั้งเล่มเปลี่ยนตามให้สัญญาเพิ่มเติม
 *   part = สัญญาเพิ่มเติม: แก้ได้เฉพาะ วันสิ้นสุด · ทุน · เบี้ย · หมายเหตุ (ที่เหลือตามสัญญาหลัก)
 */
export function PolicyInfoForm({ policyId, persons, showInsured, banks, cards, currency, v, booklet, part }: {
  policyId: string; persons: Person[]; showInsured: boolean; banks: Bank[]; cards: Card[]; currency: string;
  v: { person_id: string | null; payer_person_id: string | null; insurer: string; policy_no: string | null; start_date: string | null;
    end_date: string | null; insured_amount: number | null; premium: number | null; notes: string | null; pay_default: string; insurance_type: string;
    plan_name?: string | null };
  booklet?: boolean; part?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updatePolicyInfo, {});
  const [type, setType] = useState(v.insurance_type);
  const d = (x: string | number | null) => (x == null ? "" : String(x));
  const canType = INS_TYPE_EDITABLE.includes(v.insurance_type);
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="policy_id" value={policyId} />
      {part && <input type="hidden" name="part" value="1" />}
      {canType && (
        <label className="text-sm md:col-span-2">ประเภท
          <select name="insurance_type" value={type} onChange={(e) => setType(e.target.value)} className={input}>
            {INS_TYPE.filter(([k]) => INS_TYPE_EDITABLE.includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {type !== v.insurance_type && (
            <span className="mt-1 block text-xs text-amber-700">เปลี่ยนประเภทมีผลกับภาษี: {INS_TAX[type]} (เดิม: {INS_TAX[v.insurance_type]})
              · แบบภาษีที่ยื่นแล้วไม่เปลี่ยน · แบบที่ยังไม่ยื่นกด &ldquo;ดึงยอดจากระบบใหม่&rdquo; ในหน้าภาษี · หัวข้อความคุ้มครองเปลี่ยนตามประเภท</span>
          )}
        </label>
      )}
      <label className="text-sm md:col-span-2">ชื่อแบบประกัน<input name="plan_name" maxLength={200} defaultValue={d(v.plan_name ?? null)} placeholder="ตามหน้ากรมธรรม์"
        className={`${input} placeholder:text-slate-400`} /></label>
      {!part && <>
        <label className="text-sm">บริษัทประกัน<input name="insurer" required defaultValue={v.insurer} className={input} /></label>
        <label className="text-sm">เลขกรมธรรม์<input name="policy_no" defaultValue={d(v.policy_no)} className={input} data-plain /></label>
        {showInsured && (
          <label className="text-sm">ผู้เอาประกัน
            <select name="person_id" defaultValue={d(v.person_id)} className={input}>
              {persons.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm">ผู้จ่ายเบี้ย
          <select name="payer_person_id" defaultValue={d(v.payer_person_id)} className={input}>
            <option value="">คนเดียวกับผู้เอาประกัน</option>
            {persons.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label className="text-sm">จ่ายเบี้ยจาก (ค่าตั้งต้น)
          <PayDefaultSelect banks={banks} cards={cards} currency={currency} value={v.pay_default} className={input} />
        </label>
        <label className="text-sm">เริ่มคุ้มครอง<input name="start_date" type="date" defaultValue={d(v.start_date)} className={input} /></label>
      </>}
      <label className="text-sm">สิ้นสุด<input name="end_date" type="date" defaultValue={d(v.end_date)} className={input} /></label>
      <label className="text-sm">ทุนประกัน<input name="insured_amount" inputMode="decimal" defaultValue={d(v.insured_amount)} className={input} /></label>
      <label className="text-sm">เบี้ยต่อปี<input name="premium" inputMode="decimal" defaultValue={d(v.premium)} className={input} /></label>
      <label className={`text-sm ${part ? "" : "md:col-span-2"}`}>หมายเหตุ<input name="notes" defaultValue={d(v.notes)} className={input} /></label>
      {(booklet || part) && (
        <p className="text-xs text-slate-500 md:col-span-2">
          {part ? "บริษัท · เลขกรมธรรม์ · ผู้เอาประกัน · ผู้จ่ายเบี้ย · จ่ายเบี้ยจาก · เริ่มคุ้มครอง ตามสัญญาหลัก (แก้ที่ด้านบน)"
            : "บริษัท · เลขกรมธรรม์ · ผู้เอาประกัน · ผู้จ่ายเบี้ย · จ่ายเบี้ยจาก · เริ่มคุ้มครอง ใช้กับทั้งเล่ม: แก้ที่นี่แล้วสัญญาเพิ่มเติมเปลี่ยนตาม"}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกข้อมูล"}</button>
        <StatusSlot />
        <Msg s={state} />
      </div>
    </form>
  );
}

/** ลงมูลค่าเวนคืนตามตาราง (ปีที่ถึงวันแล้วแต่ยังไม่ได้ลง) */
export function SyncCashValueButton({ policyId }: { policyId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(syncCashValue, {});
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="policy_id" value={policyId} />
      <button disabled={pending} className={sbtn}>{pending ? "กำลังลง…" : "ลงมูลค่าตามตาราง"}</button>
      <Msg s={state} />
    </form>
  );
}

/**
 * แถว "เสียชีวิต · ตามทุนประกัน" (ยังไม่ได้ใส่ความคุ้มครองชนิดนี้ · ตกลง 6 พ.ย. 2026)
 *   ใช้ทุนประกันของกรมธรรม์ (ไม่คัดลอกไปเก็บ) · กดที่แถว → บันทึกเป็นรายการจริง เมื่อเล่มนั้นจ่ายไม่เท่าทุนประกัน
 */
export function SumCoverageRow({ policyId, type, amount, currency, canWrite, children }: {
  policyId: string; type: string; amount: number; currency: string; canWrite: boolean; children: ReactNode;
}) {
  const row = useRowPanel(canWrite);
  const [state, action, pending] = useActionState<ActionState, FormData>(addCoverage, {});
  const { setOpen } = row;
  useEffect(() => { if (state.ok) setOpen(false); }, [state, setOpen]);
  const [label, unit] = COVERAGE_LABEL[type] ?? [type, ""];
  return (
    <tr className="text-slate-600">
      {children}
      <td className="pl-2 text-right">{row.render(
        <form action={action} className="space-y-3 text-left">
          <input type="hidden" name="policy_id" value={policyId} />
          <input type="hidden" name="coverage_type" value={type} />
          <input type="hidden" name="currency" value={currency} />
          <p className="text-sm text-slate-600">ตอนนี้ใช้ทุนประกัน {money(amount, currency)} · บันทึกเป็นรายการของเล่มนี้เมื่อวงเงินจริงไม่เท่าทุนประกัน (แก้ทุนประกันภายหลัง รายการนี้ไม่เปลี่ยนตาม)</p>
          <label className="block text-sm">{label}{unit && ` (${unit})`} ({currency})
            <input name="limit_amount" required inputMode="decimal" defaultValue={amount.toFixed(2)} className={input} /></label>
          <label className="block text-sm">หมายเหตุ<input name="notes" className={input} /></label>
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
            <Msg s={state} />
          </div>
        </form>, `${label} · บันทึกเป็นรายการของเล่มนี้`, "sm")}</td>
    </tr>
  );
}
