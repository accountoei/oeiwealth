"use client";

import { useActionState, useState } from "react";
import {
  addExpense, addIncome, addMovement, addReimbursement, addTemplate, dismissExpected, setMonthStatus, toggleTemplate,
  type ActionState,
} from "./actions";
import { CURRENCIES, EXPENSE_CATEGORIES, INCOME_TYPE_LABEL, money } from "@/lib/format";

export type Bank = { asset_id: string; name: string; currency: string };
export type Card = { id: string; label: string; currency: string; outstanding_balance: number };
export type Person = { id: string; name: string };
export type Claim = { id: string; label: string; currency: string };
export type Liab = { id: string; name: string; currency: string; outstanding_amount: number | null };

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const small = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const sbtn = "rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50";
const lbl = "block text-sm text-slate-700";

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <p className="text-sm text-emerald-700">{s.ok}</p>;
  return null;
}
const n = (s: string) => Number(s.replace(/,/g, "")) || 0;

function Toggle({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button onClick={() => setOpen(true)} className={btn}>{label}</button>;
  return <>{children(() => setOpen(false))}</>;
}

/* ================================================================== รายได้ */
export function IncomeForm({ banks, persons, today, minDate }: { banks: Bank[]; persons: Person[]; today: string; minDate: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addIncome, {});
  const [amt, setAmt] = useState(""); const [tax, setTax] = useState("");
  const [bank, setBank] = useState(banks[0]?.asset_id ?? "");
  const ccy = banks.find((b) => b.asset_id === bank)?.currency;
  return (
    <Toggle label="+ รายได้">
      {(close) => (
        <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-medium text-slate-900">บันทึกรายได้</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <label className={lbl}>ประเภท
              <select name="income_type" defaultValue="SALARY" className={input}>
                {Object.entries(INCOME_TYPE_LABEL).filter(([v]) => !["DIVIDEND", "COUPON", "RENT"].includes(v))
                  .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className={lbl}>ของใคร
              <select name="person_id" defaultValue={persons[0]?.id ?? ""} className={input}>
                <option value="">— ส่วนกลางครอบครัว —</option>
                {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className={lbl}>วันที่ได้รับ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
            <label className={lbl}>ยอดก่อนหักภาษี (Gross) *<input name="amount" required inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} className={input} /></label>
            <label className={lbl}>ภาษีหัก ณ ที่จ่าย<input name="tax" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} className={input} /></label>
            <label className={lbl}>เข้าบัญชี
              <select name="received_to_asset_id" value={bank} onChange={(e) => setBank(e.target.value)} className={input}>
                <option value="">— ไม่ผ่านบัญชีในระบบ (เงินสด ฯลฯ) —</option>
                {banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}
              </select>
            </label>
            {!bank && (
              <label className={lbl}>สกุลเงิน
                <select name="currency" defaultValue="THB" className={input}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
              </label>
            )}
            <label className={`${lbl} md:col-span-2`}>หมายเหตุ<input name="notes" className={input} /></label>
          </div>
          {n(amt) > 0 && (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              รายได้ {money(n(amt), ccy)}{n(tax) > 0 && ` · ภาษี ${money(n(tax))}`}
              {bank ? ` · เงินเข้าบัญชีจริง ${money(n(amt) - n(tax), ccy)} (ระบบสร้างรายการเงินเข้าให้)` : " · ไม่มีเงินเข้าบัญชีในระบบ"}
            </p>
          )}
          <p className="text-xs text-slate-500">ปันผล / ดอกเบี้ยจากพอร์ต บันทึกที่หน้า Investments · ค่าเช่าบันทึกจากการ์ด &ldquo;รายได้ที่คาดไว้&rdquo; หรือหน้า Property</p>
          <div className="flex items-center gap-3">
            <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
            <button type="button" onClick={close} className="text-sm text-slate-500">ปิด</button>
            <Msg s={state} />
          </div>
        </form>
      )}
    </Toggle>
  );
}

export function ExpectedActions(props: {
  sourceType: string; sourceId: string; period: string; incomeType: string; personId: string | null;
  expected: number; currency: string; receiveTo: string | null; banks: Bank[]; today: string; minDate: string;
}) {
  const { sourceType, sourceId, period, incomeType, personId, expected, currency, receiveTo, banks, today, minDate } = props;
  const [mode, setMode] = useState<"" | "record" | "dismiss">("");
  const [rs, recordAction, recording] = useActionState<ActionState, FormData>(addIncome, {});
  const [ds, dismissAction, dismissing] = useActionState<ActionState, FormData>(dismissExpected, {});
  if (rs.ok || ds.ok) return <span className="text-xs text-emerald-700">{rs.ok ?? ds.ok}</span>;
  const list = banks.filter((b) => b.currency === currency);
  if (!mode) return (
    <div className="flex gap-3 text-xs">
      <button onClick={() => setMode("record")} className="text-slate-800 underline">บันทึกรับ</button>
      <button onClick={() => setMode("dismiss")} className="text-slate-500 underline">เดือนนี้ไม่ได้รับ</button>
    </div>
  );
  if (mode === "dismiss") return (
    <form action={dismissAction} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="source_type" value={sourceType} />
      <input type="hidden" name="source_id" value={sourceId} />
      <input type="hidden" name="income_period" value={period} />
      <input name="reason" required placeholder="เหตุผล เช่น ผู้เช่าขอเลื่อน" className={`w-52 ${small}`} />
      <button disabled={dismissing} className={sbtn}>ยืนยัน</button>
      <button type="button" onClick={() => setMode("")} className="text-xs text-slate-500">ยกเลิก</button>
      <div className="w-full"><Msg s={ds} /></div>
    </form>
  );
  return (
    <form action={recordAction} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name={sourceType === "LEASE" ? "lease_id" : "recurring_template_id"} value={sourceId} />
      <input type="hidden" name="income_period" value={period} />
      <input type="hidden" name="income_type" value={incomeType} />
      <input type="hidden" name="person_id" value={personId ?? ""} />
      <input type="hidden" name="currency" value={currency} />
      <label className="text-xs">ยอดจริง (Gross)<input name="amount" required inputMode="decimal" defaultValue={String(expected)} className={`mt-1 block w-28 ${small}`} /></label>
      <label className="text-xs">ภาษี<input name="tax" inputMode="decimal" className={`mt-1 block w-20 ${small}`} /></label>
      <label className="text-xs">วันที่รับ<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block ${small}`} /></label>
      <label className="text-xs">เข้าบัญชี
        <select name="received_to_asset_id" defaultValue={receiveTo ?? list[0]?.asset_id ?? ""} className={`mt-1 block ${small}`}>
          <option value="">— ไม่ผ่านบัญชี —</option>
          {list.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
        </select>
      </label>
      <button disabled={recording} className={sbtn}>บันทึก</button>
      <button type="button" onClick={() => setMode("")} className="text-xs text-slate-500">ยกเลิก</button>
      <div className="w-full"><Msg s={rs} /></div>
    </form>
  );
}

export function TemplateForm({ banks, persons, today }: { banks: Bank[]; persons: Person[]; today: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addTemplate, {});
  return (
    <Toggle label="+ รายได้ประจำ">
      {(close) => (
        <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <h3 className="font-medium text-slate-900">รายได้ประจำ (เช่น เงินเดือน)</h3>
            <p className="text-xs text-slate-500">ระบบแสดงเป็น &ldquo;รายได้ที่คาดไว้&rdquo; ทุกงวด ให้กดบันทึกยอดจริงเอง (ไม่สร้างรายได้อัตโนมัติ)</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className={lbl}>ชื่อ *<input name="name" required placeholder="เช่น เงินเดือน บริษัท A" className={input} /></label>
            <label className={lbl}>ประเภท
              <select name="income_type" defaultValue="SALARY" className={input}>
                {Object.entries(INCOME_TYPE_LABEL).filter(([v]) => !["DIVIDEND", "COUPON", "RENT"].includes(v))
                  .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className={lbl}>ของใคร
              <select name="person_id" defaultValue={persons[0]?.id ?? ""} className={input}>
                <option value="">— ส่วนกลาง —</option>
                {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className={lbl}>ยอดปกติ (Gross) *<input name="expected_amount" required inputMode="decimal" className={input} /></label>
            <label className={lbl}>ความถี่
              <select name="frequency" defaultValue="MONTHLY" className={input}>
                <option value="MONTHLY">รายเดือน</option><option value="QUARTERLY">ราย 3 เดือน</option><option value="YEARLY">รายปี</option>
              </select>
            </label>
            <label className={lbl}>ได้รับทุกวันที่<input name="due_day" type="number" min={1} max={31} className={input} /></label>
            <label className={lbl}>เข้าบัญชีตามปกติ
              <select name="receive_to_asset_id" defaultValue="" className={input}>
                <option value="">— ไม่ระบุ —</option>
                {banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}
              </select>
            </label>
            <label className={lbl}>เริ่มตั้งแต่ *<input name="start_date" type="date" required defaultValue={today} className={input} /></label>
            <label className={lbl}>สิ้นสุด (ถ้ามี)<input name="end_date" type="date" className={input} /></label>
          </div>
          <div className="flex items-center gap-3">
            <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
            <button type="button" onClick={close} className="text-sm text-slate-500">ปิด</button>
            <Msg s={state} />
          </div>
        </form>
      )}
    </Toggle>
  );
}

export function TemplateToggle({ id, active }: { id: string; active: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(toggleTemplate, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <button disabled={pending} className="text-xs text-slate-600 underline">{active ? "หยุดใช้" : "เปิดใช้"}</button>
      {state.error && <span className="ml-2 text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/* ================================================================== ค่าใช้จ่าย */
export function ExpenseForm({ banks, cards, persons, today, minDate }:
  { banks: Bank[]; cards: Card[]; persons: Person[]; today: string; minDate: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addExpense, {});
  const [via, setVia] = useState(banks.length ? "bank" : "cash");
  const [reimb, setReimb] = useState(false);
  return (
    <Toggle label="+ ค่าใช้จ่าย">
      {(close) => (
        <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-medium text-slate-900">บันทึกค่าใช้จ่าย</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <label className={lbl}>วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
            <label className={`${lbl} md:col-span-2`}>รายละเอียด *<input name="description" required placeholder="เช่น ค่าใช้จ่ายทั่วไปประจำเดือน" className={input} /></label>
            <label className={lbl}>จำนวนเงิน *<input name="amount" required inputMode="decimal" className={input} /></label>
            <label className={lbl}>หมวด
              <input name="expense_category" list="exp-cats" placeholder="เลือกหรือพิมพ์เอง" className={input} />
              <datalist id="exp-cats">{EXPENSE_CATEGORIES.filter((c) => c !== "BANK_FEE").map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <div className={lbl}>จ่ายด้วย
              <div className="mt-2 flex flex-wrap gap-3">
                <label className="flex items-center gap-1"><input type="radio" name="pay_via" value="bank" checked={via === "bank"} onChange={() => setVia("bank")} /> บัญชี</label>
                <label className="flex items-center gap-1"><input type="radio" name="pay_via" value="card" checked={via === "card"} onChange={() => setVia("card")} /> บัตรเครดิต</label>
                <label className="flex items-center gap-1"><input type="radio" name="pay_via" value="cash" checked={via === "cash"} onChange={() => setVia("cash")} /> เงินสด / อื่น ๆ</label>
              </div>
            </div>
            {via === "bank" && (
              <label className={lbl}>บัญชีที่จ่าย *
                <select name="bank_asset_id" required className={input}>
                  {banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}
                </select>
              </label>
            )}
            {via === "card" && (
              <label className={lbl}>บัตร *
                <select name="card_id" required className={input}>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
            )}
            {via === "cash" && (
              <>
                <label className={lbl}>ของใคร
                  <select name="person_id" defaultValue="" className={input}>
                    <option value="">— ส่วนกลางครอบครัว —</option>
                    {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className={lbl}>สกุลเงิน
                  <select name="currency" defaultValue="THB" className={input}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
                </label>
              </>
            )}
            <label className="flex items-start gap-2 text-sm md:col-span-3">
              <input type="checkbox" name="is_reimbursable" checked={reimb} onChange={(e) => setReimb(e.target.checked)} className="mt-1" />
              <span>จะได้เงินคืน (เช่น เคลมประกัน เบิกบริษัท)</span>
            </label>
            {reimb && <label className={lbl}>ยอดที่คาดว่าจะได้คืน<input name="expected_reimbursement_amount" inputMode="decimal" placeholder="ไม่ใส่ = เต็มจำนวน" className={input} /></label>}
            <label className={`${lbl} md:col-span-2`}>หมายเหตุ<input name="notes" className={input} /></label>
          </div>
          <p className="text-xs text-slate-500">
            {via === "bank" ? "ระบบสร้างรายการเงินออกจากบัญชีให้" : via === "card" ? "ยังไม่มีเงินออกจากบัญชี จนกว่าจะบันทึก \"จ่ายบัตรเครดิต\"" : "ไม่มีเงินออกจากบัญชีในระบบ"}
            {" · "}ซื้อทรัพย์สิน / ลงทุน / โอน / จ่ายหนี้ ไม่ใช่ค่าใช้จ่าย ให้บันทึกที่แท็บ &ldquo;โอน &amp; จ่ายหนี้&rdquo;
          </p>
          <div className="flex items-center gap-3">
            <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
            <button type="button" onClick={close} className="text-sm text-slate-500">ปิด</button>
            <Msg s={state} />
          </div>
        </form>
      )}
    </Toggle>
  );
}

export function MonthStatusForm({ month, status }: { month: string; status: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setMonthStatus, {});
  const next = status === "COMPLETE" ? "PARTIAL" : "COMPLETE";
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="status" value={next} />
      <button disabled={pending} className={status === "COMPLETE" ? "text-xs text-slate-600 underline" : sbtn}>
        {status === "COMPLETE" ? "ยกเลิกการยืนยัน (กลับเป็นบางส่วน)" : "ยืนยันว่าบันทึกครบแล้ว"}
      </button>
      <Msg s={state} />
    </form>
  );
}

export function ReimbursementForm({ itemId, remaining, currency, banks, cards, claims = [], today, minDate }: {
  itemId: string; remaining: number; currency: string; banks: Bank[]; cards: Card[]; claims?: Claim[]; today: string; minDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [via, setVia] = useState("bank");
  const [state, action, pending] = useActionState<ActionState, FormData>(addReimbursement, {});
  if (state.ok) return <span className="text-xs text-emerald-700">{state.ok}</span>;
  if (!open) return <button onClick={() => setOpen(true)} className="text-xs text-slate-800 underline">บันทึกเงินคืน</button>;
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2 text-left">
      <input type="hidden" name="expense_item_id" value={itemId} />
      <label className="text-xs">ยอดเงินคืน (ค้าง {money(remaining, currency)})
        <input name="amount" required inputMode="decimal" defaultValue={String(remaining)} className={`mt-1 block w-28 ${small}`} />
      </label>
      <label className="text-xs">วันที่ได้รับ<input name="received_date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block ${small}`} /></label>
      <label className="text-xs">รับเข้า
        <select name="to_via" value={via} onChange={(e) => setVia(e.target.value)} className={`mt-1 block ${small}`}>
          <option value="bank">บัญชี</option><option value="card">คืนเข้าบัตร</option><option value="none">เงินสด / นอกระบบ</option>
        </select>
      </label>
      {via === "bank" && (
        <select name="bank_asset_id" required className={small}>
          {banks.filter((b) => b.currency === currency).map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
        </select>
      )}
      {via === "card" && (
        <select name="card_id" required className={small}>
          {cards.filter((c) => c.currency === currency).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      )}
      {claims.some((c) => c.currency === currency) && (
        <label className="text-xs">จากเคลมประกัน
          <select name="insurance_claim_id" defaultValue="" className={`mt-1 block max-w-64 ${small}`}>
            <option value="">— ไม่ผูก —</option>
            {claims.filter((c) => c.currency === currency).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}
      <button disabled={pending} className={sbtn}>บันทึก</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ยกเลิก</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  );
}

/* ================================================================== โอน / จ่ายบัตร / จ่ายหนี้ */
const MOVE_TYPES: [string, string][] = [
  ["TRANSFER", "โอนระหว่างบัญชี (สกุลเดียวกัน)"], ["FX_EXCHANGE", "แลกเงินระหว่างบัญชี (คนละสกุล)"],
  ["CARD_PAYMENT", "จ่ายบัตรเครดิต"], ["LIABILITY_PAYMENT", "จ่ายหนี้ / ค่างวด"],
  ["OTHER_IN", "เงินเข้าอื่น ๆ (ไม่ใช่รายได้)"], ["OTHER_OUT", "เงินออกอื่น ๆ (ไม่ใช่ค่าใช้จ่าย)"],
];

export function MovementForm({ banks, cards, liabilities, today, minDate }:
  { banks: Bank[]; cards: Card[]; liabilities: Liab[]; today: string; minDate: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addMovement, {});
  const [type, setType] = useState("TRANSFER");
  const [from, setFrom] = useState(banks[0]?.asset_id ?? "");
  const [upd, setUpd] = useState(false);
  const fromCcy = banks.find((b) => b.asset_id === from)?.currency ?? "THB";
  const hasFee = type === "TRANSFER" || type === "FX_EXCHANGE";
  const toList = type === "TRANSFER" ? banks.filter((b) => b.currency === fromCcy && b.asset_id !== from)
    : type === "FX_EXCHANGE" ? banks.filter((b) => b.currency !== fromCcy) : banks;
  return (
    <Toggle label="+ โอน / จ่ายบัตร / จ่ายหนี้">
      {(close) => (
        <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-medium text-slate-900">บันทึกเงินเคลื่อนไหว</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <label className={`${lbl} md:col-span-2`}>ประเภท
              <select name="movement_type" value={type} onChange={(e) => { setType(e.target.value); setUpd(false); }} className={input}>
                {MOVE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className={lbl}>วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
            {type !== "OTHER_IN" && (
              <label className={lbl}>จากบัญชี *
                <select name="from_asset_id" value={from} onChange={(e) => setFrom(e.target.value)} required className={input}>
                  {banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}
                </select>
              </label>
            )}
            {(type === "TRANSFER" || type === "FX_EXCHANGE" || type === "OTHER_IN") && (
              <label className={lbl}>{type === "OTHER_IN" ? "เข้าบัญชี *" : "ไปบัญชี *"}
                <select name="to_asset_id" required className={input}>
                  {toList.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}
                </select>
                {toList.length === 0 && <span className="mt-1 block text-xs text-amber-700">ไม่มีบัญชีที่ใช้ได้</span>}
              </label>
            )}
            {type === "CARD_PAYMENT" && (
              <label className={lbl}>บัตร *
                <select name="card_id" required className={input}>
                  {cards.filter((c) => c.currency === fromCcy).map((c) => <option key={c.id} value={c.id}>{c.label} · ค้าง {money(c.outstanding_balance)}</option>)}
                </select>
              </label>
            )}
            {type === "LIABILITY_PAYMENT" && (
              <label className={lbl}>หนี้ *
                <select name="liability_id" required className={input}>
                  {liabilities.filter((l) => l.currency === fromCcy).map((l) => <option key={l.id} value={l.id}>{l.name} · ค้าง {money(l.outstanding_amount)}</option>)}
                </select>
              </label>
            )}
            <label className={lbl}>จำนวนเงิน{type === "FX_EXCHANGE" ? " ที่ออก" : ""} *<input name="amount" required inputMode="decimal" className={input} /></label>
            {type === "FX_EXCHANGE" && <label className={lbl}>ยอดที่ได้รับในบัญชีปลายทาง *<input name="counter_amount" required inputMode="decimal" className={input} /></label>}
            {hasFee && (
              <>
                <label className={lbl}>ค่าธรรมเนียม (หักจากบัญชีต้นทาง)<input name="fee" inputMode="decimal" className={input} /></label>
                <label className="flex items-center gap-2 text-sm md:mt-6"><input type="checkbox" name="fee_as_expense" defaultChecked /> นับค่าธรรมเนียมเป็นค่าใช้จ่าย</label>
              </>
            )}
            {(type === "CARD_PAYMENT" || type === "LIABILITY_PAYMENT") && (
              <div className="md:col-span-3 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="update_balance" checked={upd} onChange={(e) => setUpd(e.target.checked)} />
                  {type === "CARD_PAYMENT" ? "จ่ายแล้วอัปเดตยอดบัตรเลย" : "บันทึกยอดคงค้างใหม่หลังจ่าย"}
                </label>
                {upd && <input name="new_balance" required inputMode="decimal" placeholder="ยอดคงค้างใหม่" className={small} />}
                <p className="text-xs text-slate-500">
                  ไม่ใช่ค่าใช้จ่าย · ระบบไม่ลดยอดหนี้เองจากการจ่าย (ไม่รู้ส่วนเงินต้น/ดอกเบี้ย) — อัปเดตจาก Statement หรือติ๊กช่องนี้
                </p>
              </div>
            )}
            <label className={`${lbl} md:col-span-3`}>รายละเอียด<input name="description" className={input} /></label>
          </div>
          <div className="flex items-center gap-3">
            <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
            <button type="button" onClick={close} className="text-sm text-slate-500">ปิด</button>
            <Msg s={state} />
          </div>
        </form>
      )}
    </Toggle>
  );
}
