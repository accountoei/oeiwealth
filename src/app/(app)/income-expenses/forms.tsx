"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionSlot } from "@/components/ActionBar";
import {
  addExpense, addExpenseTemplate, addIncome, addMovement, addReimbursement, addTemplate, dismissExpected, dismissExpense,
  payRecurringExpense, saveEntry, setMonthStatus, toggleExpenseTemplate, toggleTemplate, undoDismissExpense,
  type ActionState,
} from "./actions";
import { INCOME_TYPE_LABEL, ROW_BTN, money } from "@/lib/format";
import { findHint, type ExpHint } from "@/lib/category-hints";
import { CurrencySelect } from "@/components/CurrencyContext";
import BalanceGuard from "@/components/BalanceGuard";
import type { PfCash } from "@/lib/pf-cash";
import { confirmCardPayment } from "@/app/(app)/liabilities/actions";

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
  const { open, setOpen, present, activeCls } = useActionSlot();
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(btn)}>{label}</button>;
  if (!open) return trigger;
  return present(trigger, <>{children(() => setOpen(false))}</>);
}

/** แก้รายการที่บันทึกเอง · ปุ่ม "บันทึก" ปุ่มเดียว (ช่องทั่วไป + บัญชี / บัตร / เงินสด + ประเภทรายได้) · อยู่ในกล่องแก้ไขใต้แถว */
export type EntryValues = {
  date: string; amount: number | string; tax?: number | string | null; description?: string | null; category?: string | null;
  person_id?: string | null; notes?: string | null; income_type?: string; income_subtype?: string | null;
  expected_reimbursement_amount?: number | string | null; bank?: string | null; card?: string | null;
  /** จ่ายจากบัญชีเงินฝากในพอร์ต */
  hold?: string | null;
};
export function EntryEditor({ kind, id, currency, values, banks, cards = [], pfCash = [], persons, categories = [], subtypes = [],
  accountEditable = true, reimbursable = false, personFallback }: {
  kind: "INCOME" | "EXPENSE"; id: string; currency: string; values: EntryValues; banks: Bank[]; cards?: Card[]; pfCash?: PfCash[]; persons: Person[];
  categories?: string[]; subtypes?: string[]; accountEditable?: boolean; reimbursable?: boolean;
  /** ข้อความ "ของใคร" เมื่อไม่ได้เลือกคน (ถ้าไม่ส่ง ระบบเลือกตามบัญชี / บัตรที่เลือก) */
  personFallback?: string;
}) {
  const income = kind === "INCOME";
  const [state, action, pending] = useActionState<ActionState, FormData>(saveEntry, {});
  const router = useRouter();
  useEffect(() => { if (state.ok) router.refresh(); }, [state, router]);
  const sameBanks = banks.filter((b) => b.currency === currency || b.asset_id === values.bank);
  const sameCards = cards.filter((c) => c.currency === currency || c.id === values.card);
  const samePf = income ? [] : pfCash.filter((h) => h.currency === currency || h.id === values.hold);
  const [via, setVia] = useState(values.card ? "card" : values.bank ? "bank" : values.hold ? "portfolio" : "cash");
  const [itype, setItype] = useState(values.income_type ?? "OTHER");
  const keep = (list: string[], cur?: string | null) => (cur && !list.includes(cur) ? [cur, ...list] : list);
  const who = personFallback ?? (via === "card" ? "ตามเจ้าของบัตร" : via === "bank" ? "ตามเจ้าของบัญชี" : via === "portfolio" ? "ตามเจ้าของพอร์ต" : "ส่วนกลาง");
  const f = (label: string, el: React.ReactNode) => <label className="text-xs text-slate-600">{label}{el}</label>;
  const cls = `mt-0.5 block ${small}`;
  return (
    <form action={action} className="flex w-full flex-wrap items-end gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      {f("วันที่", <input name="f_date" type="date" required defaultValue={values.date} className={cls} />)}
      {!income && f("รายละเอียด", <input name="f_description" defaultValue={values.description ?? ""} className={`${cls} w-44`} />)}
      {f(income ? "Gross" : "จำนวน", <input name="f_amount" inputMode="decimal" required defaultValue={String(values.amount ?? "")} className={`${cls} w-32`} />)}
      {income && f("ภาษี", <input name="f_tax" inputMode="decimal" defaultValue={values.tax == null ? "" : String(values.tax)} className={`${cls} w-28`} />)}
      {!income && f("หมวด", (
        <select name="f_expense_category" required defaultValue={values.category ?? ""} className={cls}>
          {!values.category && <option value="" disabled>— เลือกหมวด —</option>}
          {keep(categories, values.category).map((c) => <option key={c} value={c}>{c === "BANK_FEE" ? "ค่าธรรมเนียมธนาคาร" : c}</option>)}
        </select>
      ))}
      {income && accountEditable && f("ประเภท", (
        <select name="income_type" value={itype} onChange={(e) => setItype(e.target.value)} className={cls}>
          {Object.entries(INCOME_TYPE_LABEL).filter(([v]) => v === values.income_type || !["DIVIDEND", "COUPON", "RENT"].includes(v))
            .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ))}
      {income && itype === "OTHER" && (subtypes.length > 0 || values.income_subtype) && f("ประเภทย่อย", (
        <select name="f_income_subtype" defaultValue={values.income_subtype ?? ""} className={cls}>
          <option value="">— ไม่ระบุ —</option>
          {keep(subtypes, values.income_subtype).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      ))}
      {accountEditable && f(income ? "รับเข้า" : "จ่ายด้วย", (
        <select name="pay_via" value={via} onChange={(e) => setVia(e.target.value)} className={cls}>
          <option value="bank">บัญชี</option>
          {!income && sameCards.length > 0 && <option value="card">บัตรเครดิต</option>}
          {samePf.length > 0 && <option value="portfolio">เงินฝากในพอร์ต</option>}
          <option value="cash">{income ? "ไม่ผ่านบัญชี (เงินสด ฯลฯ)" : "เงินสด / อื่น ๆ"}</option>
        </select>
      ))}
      {accountEditable && via === "bank" && f("บัญชี", (
        <select name="bank_asset_id" required defaultValue={values.bank ?? sameBanks[0]?.asset_id ?? ""} className={`${cls} max-w-56`}>
          {sameBanks.length === 0 && <option value="">— ไม่มีบัญชีสกุล {currency} —</option>}
          {sameBanks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
        </select>
      ))}
      {accountEditable && via === "card" && f("บัตร", (
        <select name="card_id" required defaultValue={values.card ?? sameCards[0]?.id ?? ""} className={`${cls} max-w-56`}>
          {sameCards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      ))}
      {accountEditable && via === "portfolio" && f("บัญชีในพอร์ต", (
        <select name="pf_cash_id" required defaultValue={values.hold ?? samePf[0]?.id ?? ""} className={`${cls} max-w-64`}>
          {samePf.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
        </select>
      ))}
      {f("ของใคร", (
        <select name="f_person_id" defaultValue={values.person_id ?? ""} className={cls}>
          <option value="">{who}</option>
          {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      ))}
      {reimbursable && f("คาดได้คืน", (
        <input name="f_expected_reimbursement_amount" inputMode="decimal"
          defaultValue={values.expected_reimbursement_amount == null ? "" : String(values.expected_reimbursement_amount)} className={`${cls} w-28`} />
      ))}
      {f("หมายเหตุ", <input name="f_notes" defaultValue={values.notes ?? ""} className={`${cls} w-40`} />)}
      <button disabled={pending} className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50">
        {pending ? "…" : "บันทึก"}
      </button>
      {state.error && <span className="w-full text-xs text-red-600">{state.error}</span>}
      {state.ok && <span className="w-full text-xs text-emerald-700">{state.ok}</span>}
    </form>
  );
}

export function IncomeForm({ banks, persons, today, minDate, subtypes = [] }: { banks: Bank[]; persons: Person[]; today: string; minDate: string; subtypes?: string[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addIncome, {});
  const [amt, setAmt] = useState(""); const [tax, setTax] = useState("");
  const [bank, setBank] = useState(banks[0]?.asset_id ?? "");
  const [itype, setItype] = useState("SALARY");
  const ccy = banks.find((b) => b.asset_id === bank)?.currency;
  return (
    <Toggle label="+ บันทึกรายได้">
      {(close) => (
        <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-medium text-slate-900">บันทึกรายได้</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <label className={lbl}>ประเภท
              <select name="income_type" value={itype} onChange={(e) => setItype(e.target.value)} className={input}>
                {Object.entries(INCOME_TYPE_LABEL).filter(([v]) => !["DIVIDEND", "COUPON", "RENT"].includes(v))
                  .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            {itype === "OTHER" && subtypes.length > 0 && (
              <label className={lbl}>ประเภทย่อย
                <select name="income_subtype" defaultValue="" className={input}>
                  <option value="">— ไม่ระบุ —</option>
                  {subtypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            )}
            <label className={lbl}>ของใคร
              <select name="person_id" defaultValue={persons[0]?.id ?? ""} className={input}>
                <option value="">— ตามเจ้าของบัญชีที่รับ (ไม่มีบัญชี = ส่วนกลาง) —</option>
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
                <CurrencySelect name="currency" defaultValue="THB" className={input} />
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
          <p className="text-xs text-slate-500">ปันผล / ดอกเบี้ยจากพอร์ต บันทึกที่หน้า Investments · ค่าเช่าบันทึกจากการ์ดใน &ldquo;รายได้ที่ต้องได้รับ&rdquo; หรือหน้า Property</p>
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
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [mode, setMode] = useState<"record" | "dismiss">("record");
  const [rs, recordAction, recording] = useActionState<ActionState, FormData>(addIncome, {});
  const [ds, dismissAction, dismissing] = useActionState<ActionState, FormData>(dismissExpected, {});
  if (rs.ok || ds.ok) return <span className="text-xs text-emerald-700">{rs.ok ?? ds.ok}</span>;
  const list = banks.filter((b) => b.currency === currency);
  const trigger = <button type="button" onClick={() => { setMode("record"); setOpen(!open); }} className={activeCls(ROW_BTN)}>บันทึกรับ</button>;
  if (!open) return trigger;
  const close = () => setOpen(false);
  // ฟอร์มเดียว: บันทึกรับ (ยอดจริง) หรือ "เดือนนี้ไม่ได้รับ" (สลับในฟอร์ม)
  const form = mode === "dismiss" ? (
    <form action={dismissAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="source_type" value={sourceType} />
      <input type="hidden" name="source_id" value={sourceId} />
      <input type="hidden" name="income_period" value={period} />
      <label className="text-xs">เดือนนี้ไม่ได้รับ · เหตุผล
        <input name="reason" required placeholder="เช่น ผู้เช่าขอเลื่อน" className={`mt-1 block w-60 ${small}`} />
      </label>
      <button disabled={dismissing} className={sbtn}>ยืนยัน &ldquo;เดือนนี้ไม่ได้รับ&rdquo;</button>
      <button type="button" onClick={() => setMode("record")} className="text-xs text-slate-600 underline">← กลับไปบันทึกรับ</button>
      <button type="button" onClick={close} className="text-xs text-slate-500">ยกเลิก</button>
      <div className="w-full"><Msg s={ds} /></div>
    </form>
  ) : (
    <form action={recordAction} className="flex flex-wrap items-end gap-2">
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
      <button type="button" onClick={close} className="text-xs text-slate-500">ยกเลิก</button>
      <button type="button" onClick={() => setMode("dismiss")} className="ml-auto text-xs text-slate-600 underline">เดือนนี้ไม่ได้รับ…</button>
      <div className="w-full"><Msg s={rs} /></div>
    </form>
  );
  return present(trigger, form);
}

export function TemplateForm({ banks, persons, today }: { banks: Bank[]; persons: Person[]; today: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addTemplate, {});
  return (
    <Toggle label="+ รายได้ประจำ">
      {(close) => (
        <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <h3 className="font-medium text-slate-900">รายได้ประจำ (เช่น เงินเดือน)</h3>
            <p className="text-xs text-slate-500">ระบบแสดงใน &ldquo;รายได้ที่ต้องได้รับ&rdquo; ทุกงวด ให้กดบันทึกยอดจริงเอง (ไม่สร้างรายได้อัตโนมัติ)</p>
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
      <button disabled={pending} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">{active ? "หยุดใช้รายได้ประจำนี้" : "เปิดใช้อีกครั้ง"}</button>
      {state.error && <span className="ml-2 text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/* ================================================================== ค่าใช้จ่ายประจำทั่วไป */
export function ExpenseTemplateForm({ banks, cards, persons, categories, today }:
  { banks: Bank[]; cards: Card[]; persons: Person[]; categories: string[]; today: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addExpenseTemplate, {});
  const [via, setVia] = useState(banks.length ? "BANK" : "CASH");
  return (
    <Toggle label="+ ค่าใช้จ่ายประจำ">
      {(close) => (
        <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <h3 className="font-medium text-slate-900">ค่าใช้จ่ายประจำ (เช่น ค่าโทรศัพท์ ค่าอินเทอร์เน็ต ค่าเรียนพิเศษ)</h3>
            <p className="text-xs text-slate-500">ระบบแสดงใน &ldquo;ที่ต้องจ่าย&rdquo; ทุกงวด ให้กดบันทึกจ่ายด้วยยอดจริงเอง (ไม่สร้างค่าใช้จ่ายอัตโนมัติ) · ค่าใช้จ่ายของบ้าน / ที่ดิน ให้ตั้งที่หน้าทรัพย์สิน</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className={lbl}>ชื่อ *<input name="name" required placeholder="เช่น ค่าอินเทอร์เน็ตบ้าน" className={input} /></label>
            <label className={lbl}>หมวด *
              <select name="expense_category" required defaultValue="" className={input}>
                <option value="" disabled>— เลือกหมวด —</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className={lbl}>ของใคร
              <select name="person_id" defaultValue="" className={input}>
                <option value="">— ตามเจ้าของบัญชี / บัตร —</option>
                {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className={lbl}>ยอดปกติ *<input name="expected_amount" required inputMode="decimal" className={input} /></label>
            <label className={lbl}>ความถี่
              <select name="frequency" defaultValue="MONTHLY" className={input}>
                <option value="MONTHLY">รายเดือน</option><option value="QUARTERLY">ราย 3 เดือน</option><option value="YEARLY">รายปี</option>
              </select>
            </label>
            <label className={lbl}>จ่ายทุกวันที่<input name="due_day" type="number" min={1} max={31} className={input} /></label>
            <label className={lbl}>จ่ายจาก
              <select name="pay_via" value={via} onChange={(e) => setVia(e.target.value)} className={input}>
                <option value="BANK">บัญชีธนาคาร</option><option value="CARD">บัตรเครดิต</option><option value="CASH">เงินสด</option>
              </select>
            </label>
            {via === "BANK" && (
              <label className={lbl}>บัญชี
                <select name="pay_from_asset_id" defaultValue={banks[0]?.asset_id ?? ""} className={input}>
                  <option value="">— ไม่ระบุ —</option>
                  {banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}
                </select>
              </label>
            )}
            {via === "CARD" && (
              <label className={lbl}>บัตร *
                <select name="pay_from_credit_card_id" required defaultValue={cards[0]?.id ?? ""} className={input}>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.label} ({c.currency})</option>)}
                </select>
              </label>
            )}
            {via === "CASH" && <label className={lbl}>สกุลเงิน<CurrencySelect name="currency" defaultValue="THB" className={input} /></label>}
            <label className={lbl}>เริ่มตั้งแต่ *<input name="start_date" type="date" required defaultValue={today} className={input} /></label>
            <label className={lbl}>สิ้นสุด (ถ้ามี)<input name="end_date" type="date" className={input} /></label>
            <label className={lbl}>หมายเหตุ<input name="notes" className={input} /></label>
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

export function ExpenseTemplateToggle({ id, active }: { id: string; active: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(toggleExpenseTemplate, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <button disabled={pending} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">{active ? "หยุดใช้ค่าใช้จ่ายประจำนี้" : "เปิดใช้อีกครั้ง"}</button>
      {state.error && <span className="ml-2 text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/** บันทึกสำเร็จแล้วโหลดข้อมูลหน้าใหม่ทันที (ไม่ต้องกด Refresh เอง) */
function useRefreshOnOk(s: ActionState) {
  const router = useRouter();
  useEffect(() => { if (s.ok) router.refresh(); }, [s, router]);
}

/** ฟอร์ม "เดือนนี้ไม่ได้จ่าย" (ใช้ในปุ่มบันทึกจ่ายของค่าใช้จ่ายประจำทั่วไป และของทรัพย์สิน) */
export function DismissCostForm({ sourceType, sourceId, period, onBack, onClose }: {
  sourceType: "RECURRING" | "PROPERTY"; sourceId: string; period: string; onBack: () => void; onClose: () => void;
}) {
  const [ds, action, pending] = useActionState<ActionState, FormData>(dismissExpense, {});
  useRefreshOnOk(ds);
  if (ds.ok) return <span className="text-xs text-emerald-700">{ds.ok}</span>;
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2 text-left">
      <input type="hidden" name="source_type" value={sourceType} />
      <input type="hidden" name="source_id" value={sourceId} />
      <input type="hidden" name="cost_period" value={period} />
      <label className="text-xs">เดือนนี้ไม่ได้จ่าย · เหตุผล
        <input name="reason" required placeholder="เช่น ยกเลิกบริการชั่วคราว" className={`mt-1 block w-60 ${small}`} />
      </label>
      <button disabled={pending} className={sbtn}>ยืนยัน &ldquo;เดือนนี้ไม่ได้จ่าย&rdquo;</button>
      <button type="button" onClick={onBack} className="text-xs text-slate-600 underline">← กลับไปบันทึกจ่าย</button>
      <button type="button" onClick={onClose} className="text-xs text-slate-500">ยกเลิก</button>
      <div className="w-full"><Msg s={ds} /></div>
    </form>
  );
}

/** ยกเลิก "เดือนนี้ไม่ได้จ่าย" → กลับเป็นรอจ่าย */
export function UndoDismissButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(undoDismissExpense, {});
  useRefreshOnOk(state);
  if (state.ok) return <span className="text-xs text-emerald-700">{state.ok}</span>;
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <button disabled={pending} className="text-xs text-slate-600 underline disabled:opacity-50">ยกเลิก</button>
      {state.error && <span className="ml-2 text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/** บันทึกจ่ายค่าใช้จ่ายประจำทั่วไป 1 งวด · ค่าตั้งต้นจากรายการประจำ · สลับเป็น "เดือนนี้ไม่ได้จ่าย" ได้ในฟอร์ม */
export function RecurringPayActions(props: {
  templateId: string; period: string; label: string; category: string; expected: number; currency: string;
  payVia: string; bankId: string | null; cardId: string | null; personId: string | null;
  banks: Bank[]; cards: Card[]; persons: Person[]; today: string; minDate: string;
}) {
  const { templateId, period, label, category, expected, currency, payVia, bankId, cardId, personId, banks, cards, persons, today, minDate } = props;
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [mode, setMode] = useState<"record" | "dismiss">("record");
  const sameBanks = banks.filter((b) => b.currency === currency);
  const sameCards = cards.filter((c) => c.currency === currency);
  const [via, setVia] = useState(payVia === "CARD" && sameCards.length ? "card" : payVia === "BANK" && sameBanks.length ? "bank" : "cash");
  const [rs, action, pending] = useActionState<ActionState, FormData>(payRecurringExpense, {});
  if (rs.ok) return <span className="text-xs text-emerald-700">{rs.ok}</span>;
  const trigger = <button type="button" onClick={() => { setMode("record"); setOpen(!open); }} className={activeCls(ROW_BTN)}>บันทึกจ่าย</button>;
  if (!open) return trigger;
  const close = () => setOpen(false);
  if (mode === "dismiss") return present(trigger,
    <DismissCostForm sourceType="RECURRING" sourceId={templateId} period={period} onBack={() => setMode("record")} onClose={close} />);
  return present(trigger, (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2 text-left">
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="cost_period" value={period} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="expense_category" value={category} />
      <input type="hidden" name="description" value={label} />
      <label className="text-xs">ยอดที่จ่าย
        <input name="amount" required inputMode="decimal" defaultValue={expected > 0 ? String(expected) : ""} className={`mt-1 block w-28 ${small}`} />
      </label>
      <label className="text-xs">วันที่จ่าย
        <input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={`mt-1 block ${small}`} />
      </label>
      <label className="text-xs">จ่ายจาก
        <select name="pay_via" value={via} onChange={(e) => setVia(e.target.value)} className={`mt-1 block ${small}`}>
          <option value="bank">บัญชีธนาคาร</option><option value="card">บัตรเครดิต</option><option value="cash">เงินสด</option>
        </select>
      </label>
      {via === "bank" && (
        <label className="text-xs">บัญชี
          <select name="bank_asset_id" required defaultValue={bankId && sameBanks.some((b) => b.asset_id === bankId) ? bankId : sameBanks[0]?.asset_id} className={`mt-1 block ${small}`}>
            {sameBanks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {via === "card" && (
        <label className="text-xs">บัตร
          <select name="card_id" required defaultValue={cardId && sameCards.some((c) => c.id === cardId) ? cardId : sameCards[0]?.id} className={`mt-1 block ${small}`}>
            {sameCards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}
      <label className="text-xs">ของใคร
        <select name="person_id" defaultValue={personId ?? ""} required={via === "cash"} className={`mt-1 block ${small}`}>
          <option value="">{via === "cash" ? "— เลือก —" : "ตามเจ้าของบัญชี / บัตร"}</option>
          {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="text-xs">หมายเหตุ<input name="notes" className={`mt-1 block w-32 ${small}`} /></label>
      <button disabled={pending} className={sbtn}>บันทึก</button>
      <BalanceGuard />
      <button type="button" onClick={close} className="text-xs text-slate-500">ยกเลิก</button>
      <button type="button" onClick={() => setMode("dismiss")} className="ml-auto text-xs text-slate-600 underline">เดือนนี้ไม่ได้จ่าย…</button>
      <div className="w-full"><Msg s={rs} /></div>
    </form>
  ));
}

/* ================================================================== ค่าใช้จ่าย */
export function ExpenseForm({ banks, cards, pfCash = [], persons, today, minDate, categories, hints = [] }:
  { banks: Bank[]; cards: Card[]; pfCash?: PfCash[]; persons: Person[]; today: string; minDate: string; categories: string[]; hints?: ExpHint[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addExpense, {});
  const [via, setVia] = useState(banks.length ? "bank" : "cash");
  const [reimb, setReimb] = useState(false);
  // เดาหมวด / บัญชี จากรายการเดิมที่รายละเอียดเหมือนกัน (เฉพาะช่องที่ยังไม่ได้เลือกเอง)
  const [cat, setCat] = useState("");
  const [bank, setBank] = useState(banks[0]?.asset_id ?? "");
  const [card, setCard] = useState(cards[0]?.id ?? "");
  const [guess, setGuess] = useState<ExpHint | null>(null);
  const touched = useRef({ cat: false, acc: false });
  // บันทึกแล้ว (ฟอร์มล้างค่า) → เริ่มเดาใหม่สำหรับรายการถัดไป
  useEffect(() => { if (state.ok) { setCat(""); setGuess(null); touched.current = { cat: false, acc: false }; } }, [state]);
  const onDesc = (text: string) => {
    const h = findHint(hints, text);
    setGuess(h);
    if (!h) return;
    if (!touched.current.cat) setCat(h.c);
    if (!touched.current.acc) {
      if (h.via === "bank" && h.acc && banks.some((b) => b.asset_id === h.acc)) { setVia("bank"); setBank(h.acc); }
      else if (h.via === "card" && h.acc && cards.some((c) => c.id === h.acc)) { setVia("card"); setCard(h.acc); }
      else if (h.via === "cash") setVia("cash");
    }
  };
  const accName = guess?.acc ? (banks.find((b) => b.asset_id === guess.acc)?.name ?? cards.find((c) => c.id === guess.acc)?.label) : null;
  return (
    <Toggle label="+ บันทึกค่าใช้จ่าย">
      {(close) => (
        <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-medium text-slate-900">บันทึกค่าใช้จ่าย</h3>
          <datalist id="exp-desc-hints">{hints.slice(0, 300).map((h) => <option key={h.d} value={h.d} />)}</datalist>
          <div className="grid gap-4 md:grid-cols-3">
            <label className={lbl}>วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
            <label className={`${lbl} md:col-span-2`}>รายละเอียด *<input name="description" required list="exp-desc-hints" autoComplete="off"
              onChange={(e) => onDesc(e.target.value)} placeholder="เช่น ค่าใช้จ่ายทั่วไปประจำเดือน" className={input} />
              {guess && <span className="mt-1 block text-xs text-blue-700">เดาจากรายการเดิม: หมวด {guess.c}{accName ? ` · ${guess.via === "card" ? "บัตร" : "บัญชี"} ${accName}` : guess.via === "cash" ? " · เงินสด" : ""} (เปลี่ยนเองได้)</span>}
            </label>
            <label className={lbl}>จำนวนเงิน *<input name="amount" required inputMode="decimal" className={input} /></label>
            <label className={lbl}>หมวด *
              <select name="expense_category" required value={cat} onChange={(e) => { touched.current.cat = true; setCat(e.target.value); }} className={input}>
                <option value="" disabled>— เลือกหมวด —</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <div className={lbl}>จ่ายด้วย
              <div className="mt-2 flex flex-wrap gap-3">
                <label className="flex items-center gap-1"><input type="radio" name="pay_via" value="bank" checked={via === "bank"} onChange={() => { touched.current.acc = true; setVia("bank"); }} /> บัญชี</label>
                <label className="flex items-center gap-1"><input type="radio" name="pay_via" value="card" checked={via === "card"} onChange={() => { touched.current.acc = true; setVia("card"); }} /> บัตรเครดิต</label>
                {pfCash.length > 0 && <label className="flex items-center gap-1"><input type="radio" name="pay_via" value="portfolio" checked={via === "portfolio"} onChange={() => { touched.current.acc = true; setVia("portfolio"); }} /> เงินฝากในพอร์ต</label>}
                <label className="flex items-center gap-1"><input type="radio" name="pay_via" value="cash" checked={via === "cash"} onChange={() => { touched.current.acc = true; setVia("cash"); }} /> เงินสด / อื่น ๆ</label>
              </div>
            </div>
            {via === "bank" && (
              <label className={lbl}>บัญชีที่จ่าย *
                <select name="bank_asset_id" required value={bank} onChange={(e) => { touched.current.acc = true; setBank(e.target.value); }} className={input}>
                  {banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}
                </select>
              </label>
            )}
            {via === "card" && (
              <label className={lbl}>บัตร *
                <select name="card_id" required value={card} onChange={(e) => { touched.current.acc = true; setCard(e.target.value); }} className={input}>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
            )}
            {via === "portfolio" && (
              <label className={lbl}>บัญชีเงินฝากในพอร์ต *
                <select name="pf_cash_id" required defaultValue={pfCash[0]?.id ?? ""} className={input}>
                  {pfCash.map((h) => <option key={h.id} value={h.id}>{h.label} ({h.currency})</option>)}
                </select>
              </label>
            )}
            <label className={lbl}>ของใคร
              <select name="person_id" defaultValue="" className={input}>
                <option value="">{via === "bank" ? "— ตามเจ้าของบัญชี —" : via === "card" ? "— ตามเจ้าของบัตร —" : via === "portfolio" ? "— ตามเจ้าของพอร์ต —" : "— ส่วนกลางครอบครัว —"}</option>
                {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            {via === "cash" && (
              <label className={lbl}>สกุลเงิน
                <CurrencySelect name="currency" defaultValue="THB" className={input} />
              </label>
            )}
            <label className="flex items-start gap-2 text-sm md:col-span-3">
              <input type="checkbox" name="is_reimbursable" checked={reimb} onChange={(e) => setReimb(e.target.checked)} className="mt-1" />
              <span>จะได้เงินคืน (เช่น เคลมประกัน เบิกบริษัท)</span>
            </label>
            {reimb && <label className={lbl}>ยอดที่คาดว่าจะได้คืน<input name="expected_reimbursement_amount" inputMode="decimal" placeholder="ไม่ใส่ = เต็มจำนวน" className={input} /></label>}
            <label className={`${lbl} md:col-span-2`}>หมายเหตุ<input name="notes" className={input} /></label>
          </div>
          <p className="text-xs text-slate-500">
            {via === "bank" ? "ระบบสร้างรายการเงินออกจากบัญชีให้" : via === "portfolio" ? "ระบบหักเงินฝากในพอร์ตให้ (ดูได้ที่หน้าบัญชีเงินฝากในพอร์ต)" : via === "card" ? "ยังไม่มีเงินออกจากบัญชี จนกว่าจะบันทึก \"จ่ายบัตรเครดิต\"" : "ไม่มีเงินออกจากบัญชีในระบบ"}
            {" · "}ซื้อทรัพย์สิน / ลงทุน / โอน / จ่ายหนี้ ไม่ใช่ค่าใช้จ่าย ให้บันทึกที่ปุ่ม &ldquo;โอน / จ่ายบัตร / จ่ายหนี้&rdquo; ในแท็บภาพรวม
          </p>
          <div className="flex items-center gap-3">
            <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
            <BalanceGuard />
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
  const { open, setOpen, present, activeCls } = useActionSlot();
  const [via, setVia] = useState("bank");
  const [state, action, pending] = useActionState<ActionState, FormData>(addReimbursement, {});
  if (state.ok) return <span className="text-xs text-emerald-700">{state.ok}</span>;
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls("text-xs text-slate-800 underline")}>บันทึกเงินคืน</button>;
  if (!open) return trigger;
  return present(trigger, (
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
  ));
}

/* ================================================================== โอน / จ่ายบัตร / จ่ายหนี้ */
const MOVE_TYPES: [string, string][] = [
  ["TRANSFER", "โอนระหว่างบัญชี (สกุลเดียวกัน)"], ["FX_EXCHANGE", "แลกเงินระหว่างบัญชี (คนละสกุล)"],
  ["CARD_PAYMENT", "จ่ายบัตรเครดิต"], ["LIABILITY_PAYMENT", "จ่ายหนี้ / ค่างวด"],
  ["OTHER_IN", "เงินเข้าอื่น ๆ (ไม่ใช่รายได้)"], ["OTHER_OUT", "เงินออกอื่น ๆ (ไม่ใช่ค่าใช้จ่าย)"],
];

export function MovementForm({ banks, cards, pfCash = [], liabilities, today, minDate }:
  { banks: Bank[]; cards: Card[]; pfCash?: PfCash[]; liabilities: Liab[]; today: string; minDate: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addMovement, {});
  const [type, setType] = useState("TRANSFER");
  const [from, setFrom] = useState(banks[0]?.asset_id ?? "");
  const [upd, setUpd] = useState(false);
  const [pr, setPr] = useState(""); const [it, setIt] = useState("");
  // จ่ายบัตร: จ่ายจากบัญชีเงินฝากในพอร์ตได้ (ค่า "h:<id>") — เฉพาะบัตรสกุลเดียวกับบัญชี
  const fromPf = from.startsWith("h:") ? pfCash.find((h) => `h:${h.id}` === from) : undefined;
  const fromCcy = fromPf?.currency ?? banks.find((b) => b.asset_id === from)?.currency ?? "THB";
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
              <select name="movement_type" value={type} onChange={(e) => { setType(e.target.value); setUpd(false); setPr(""); setIt("");
                if (e.target.value !== "CARD_PAYMENT" && from.startsWith("h:")) setFrom(banks[0]?.asset_id ?? ""); }} className={input}>
                {MOVE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className={lbl}>วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
            {type !== "OTHER_IN" && (
              <label className={lbl}>จากบัญชี *
                <select name="from_asset_id" value={from} onChange={(e) => setFrom(e.target.value)} required className={input}>
                  {type === "CARD_PAYMENT" && pfCash.length > 0 ? (<>
                    <optgroup label="บัญชีธนาคาร">{banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}</optgroup>
                    <optgroup label="เงินฝากในพอร์ต">{pfCash.map((h) => <option key={h.id} value={`h:${h.id}`}>{h.label} ({h.currency})</option>)}</optgroup>
                  </>) : banks.map((b) => <option key={b.asset_id} value={b.asset_id}>{b.name} ({b.currency})</option>)}
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
            {type === "LIABILITY_PAYMENT" ? (
              <>
                <label className={lbl}>เงินต้น (ลดยอดหนี้)<input name="principal" inputMode="decimal" value={pr} onChange={(e) => setPr(e.target.value)} className={input} /></label>
                <label className={lbl}>ดอกเบี้ย (เป็นค่าใช้จ่าย)<input name="interest" inputMode="decimal" value={it} onChange={(e) => setIt(e.target.value)} className={input} /></label>
              </>
            ) : (
              <label className={lbl}>จำนวนเงิน{type === "FX_EXCHANGE" ? " ที่ออก" : ""} *<input name="amount" required inputMode="decimal" className={input} /></label>
            )}
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
                  {type === "CARD_PAYMENT" ? "มียอดตาม Statement ใหม่ (ไม่บังคับ · ยอดบัตรลดเองตามที่จ่ายอยู่แล้ว)" : "มียอดคงค้างตาม Statement หลังจ่าย (ใช้แทนยอดที่ระบบหักให้)"}
                </label>
                {upd && <input name="new_balance" required inputMode="decimal" placeholder="ยอดคงค้างใหม่" className={small} />}
                <p className="text-xs text-slate-500">
                  {type === "CARD_PAYMENT"
                    ? "ไม่ใช่ค่าใช้จ่าย (ค่าใช้จ่ายบันทึกตอนรูดบัตรแล้ว) · ยอดค้างบัตรลดลงตามที่จ่ายทันที"
                    : <>รวมจ่าย {money(n(pr) + n(it), fromCcy)} · เงินต้นลดยอดหนี้ให้ทันที · ดอกเบี้ยบันทึกเป็นค่าใช้จ่าย &ldquo;ดอกเบี้ยจ่าย&rdquo;</>}
                </p>
              </div>
            )}
            <label className={`${lbl} md:col-span-3`}>รายละเอียด<input name="description" className={input} /></label>
          </div>
          <div className="flex items-center gap-3">
            <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
            <BalanceGuard bank="from_asset_id" amount={["amount", "fee", "principal", "interest"]} />
            <button type="button" onClick={close} className="text-sm text-slate-500">ปิด</button>
            <Msg s={state} />
          </div>
        </form>
      )}
    </Toggle>
  );
}

/* ================================================================== บัตรตัดบัญชีอัตโนมัติ: ยืนยัน */
export function AutopayConfirmForm({ cardId, bankId, holdId = null, currency, dueDate, amount, minimum, today, minDate }: {
  /** ตัดจากบัญชีธนาคาร (bankId) หรือ บัญชีเงินฝากในพอร์ต (holdId) */
  cardId: string; bankId: string | null; holdId?: string | null; currency: string; dueDate: string; amount: number; minimum: boolean; today: string; minDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(confirmCardPayment, {});
  if (state.ok) return <p className="text-xs text-emerald-700">{state.ok}</p>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={sbtn}>ยืนยันว่าตัดแล้ว</button>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="card_id" value={cardId} />
      {bankId && <input type="hidden" name="bank_asset_id" value={bankId} />}
      {holdId && <input type="hidden" name="cash_holding_id" value={holdId} />}
      <input type="hidden" name="autopay" value="true" />
      <label className="text-xs">วันที่ตัด<input name="date" type="date" required defaultValue={dueDate > today ? today : dueDate}
        min={minDate} max={today} className={`mt-0.5 block ${small}`} /></label>
      <label className="text-xs">ยอดที่ตัดจริง ({currency})
        <input name="amount" required inputMode="decimal" defaultValue={minimum || !amount ? "" : amount.toFixed(2)}
          placeholder={minimum ? "ยอดขั้นต่ำตามใบแจ้งยอด" : ""} className={`mt-0.5 block w-36 ${small}`} />
      </label>
      <button disabled={pending} className={sbtn}>{pending ? "…" : "บันทึก"}</button>
      <BalanceGuard />
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">ปิด</button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  );
}
