"use client";

import { useActionState, useState } from "react";
import { useActionSlot } from "@/components/ActionBar";
import { money } from "@/lib/format";
import { addExpense, addMovement } from "../../income-expenses/actions";
import Flash from "@/components/Flash";

/**
 * จ่ายออกจากบัญชีเงินฝากในพอร์ต: ค่าใช้จ่าย · จ่ายบัตรเครดิต
 *   ใช้คำสั่งชุดเดียวกับหน้า Income & Expenses (add_expense / pay_credit_card) → ขึ้นทั้งสองหน้า แก้ / ลบได้ทั้งสองที่
 */
export type PfPayCtx = {
  accounts: { id: string; name: string; currency: string; is_default_cash: boolean }[];
  categories: string[];
  persons: { id: string; name: string }[];
  cards: { id: string; label: string; currency: string; outstanding_balance: number }[];
};
type St = { error?: string; ok?: string };

const input = "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const obtn = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50";
const lbl = "block text-sm text-slate-700";
function Msg({ s }: { s: St }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>;
  if (s.ok) return <Flash on={s} as="p" className="text-sm text-emerald-700" />;
  return null;
}
const defAcc = (ctx: PfPayCtx, fixed?: string) =>
  fixed ?? (ctx.accounts.find((a) => a.is_default_cash) ?? ctx.accounts[0])?.id ?? "";

function AccountField({ ctx, name, value, onChange, fixed, prefix = "" }: {
  ctx: PfPayCtx; name: string; value: string; onChange: (v: string) => void; fixed?: string; prefix?: string;
}) {
  const a = ctx.accounts.find((x) => x.id === value);
  if (fixed) return <><input type="hidden" name={name} value={`${prefix}${fixed}`} /><div className={lbl}>จ่ายจากบัญชี<div className="mt-1 py-2 text-sm">{a?.name} ({a?.currency})</div></div></>;
  return (
    <label className={lbl}>จ่ายจากบัญชีเงินฝากในพอร์ต *
      <select name={name} value={`${prefix}${value}`} onChange={(e) => onChange(e.target.value.slice(prefix.length))} required className={input}>
        {ctx.accounts.map((x) => <option key={x.id} value={`${prefix}${x.id}`}>{x.name} ({x.currency}){x.is_default_cash ? " ★" : ""}</option>)}
      </select>
    </label>
  );
}

/** ค่าใช้จ่ายที่จ่ายจากพอร์ต (เช่น ค่าเทอม · โอนให้คนภายนอก) */
export function PfExpenseBody({ ctx, today, minDate, fixed, onClose }: { ctx: PfPayCtx; today: string; minDate: string; fixed?: string; onClose: () => void }) {
  const [state, action, pending] = useActionState<St, FormData>(addExpense, {});
  const [acc, setAcc] = useState(defAcc(ctx, fixed));
  const [reimb, setReimb] = useState(false);
  const ccy = ctx.accounts.find((a) => a.id === acc)?.currency ?? "";
  if (!ctx.accounts.length) return <p className="text-sm text-slate-500">ยังไม่มีบัญชีเงินฝากในพอร์ต</p>;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="pay_via" value="portfolio" />
      <div className="grid gap-4 md:grid-cols-3">
        <AccountField ctx={ctx} name="pf_cash_id" value={acc} onChange={setAcc} fixed={fixed} />
        <label className={lbl}>วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className={lbl}>จำนวนเงิน ({ccy}) *<input name="amount" required inputMode="decimal" className={input} /></label>
        <label className={`${lbl} md:col-span-2`}>รายละเอียด *<input name="description" required placeholder="เช่น ค่าเทอม" className={input} /></label>
        <label className={lbl}>หมวด *
          <select name="expense_category" required defaultValue="" className={input}>
            <option value="" disabled>— เลือกหมวด —</option>
            {ctx.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className={lbl}>ของใคร
          <select name="person_id" defaultValue="" className={input}>
            <option value="">— ตามเจ้าของพอร์ต —</option>
            {ctx.persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className={`${lbl} md:col-span-2`}>หมายเหตุ<input name="notes" className={input} /></label>
        <label className="flex items-start gap-2 text-sm md:col-span-3">
          <input type="checkbox" name="is_reimbursable" checked={reimb} onChange={(e) => setReimb(e.target.checked)} className="mt-1" />
          <span>จะได้เงินคืน (เช่น เคลมประกัน เบิกบริษัท)</span>
        </label>
        {reimb && <label className={lbl}>ยอดที่คาดว่าจะได้คืน<input name="expected_reimbursement_amount" inputMode="decimal" placeholder="ไม่ใส่ = เต็มจำนวน" className={input} /></label>}
      </div>
      <p className="text-xs text-slate-500">บันทึกเป็นค่าใช้จ่ายของครอบครัว (ขึ้นที่หน้า Income &amp; Expenses ด้วย) · ระบบหักเงินฝากในพอร์ตให้ · โอนเข้าบัญชีของครอบครัวเอง / จ่ายบัตร ไม่ใช่ค่าใช้จ่าย</p>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกค่าใช้จ่าย"}</button>
        <button type="button" data-close onClick={onClose} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/** จ่ายบัตรเครดิตจากพอร์ต (บัตรสกุลเดียวกับบัญชี) */
export function PfCardPayBody({ ctx, today, minDate, fixed, onClose }: { ctx: PfPayCtx; today: string; minDate: string; fixed?: string; onClose: () => void }) {
  const [state, action, pending] = useActionState<St, FormData>(addMovement, {});
  const [acc, setAcc] = useState(defAcc(ctx, fixed));
  const [upd, setUpd] = useState(false);
  const ccy = ctx.accounts.find((a) => a.id === acc)?.currency ?? "";
  const cards = ctx.cards.filter((c) => c.currency === ccy);
  if (!ctx.accounts.length) return <p className="text-sm text-slate-500">ยังไม่มีบัญชีเงินฝากในพอร์ต</p>;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="movement_type" value="CARD_PAYMENT" />
      <div className="grid gap-4 md:grid-cols-3">
        <AccountField ctx={ctx} name="from_asset_id" value={acc} onChange={setAcc} fixed={fixed} prefix="h:" />
        <label className={lbl}>บัตร *
          <select key={ccy} name="card_id" required className={input}>
            {cards.map((c) => <option key={c.id} value={c.id}>{c.label} · ค้าง {money(c.outstanding_balance)}</option>)}
          </select>
          {cards.length === 0 && <span className="mt-1 block text-xs text-amber-700">ไม่มีบัตรสกุล {ccy}</span>}
        </label>
        <label className={lbl}>วันที่ *<input name="date" type="date" required defaultValue={today} min={minDate} max={today} className={input} /></label>
        <label className={lbl}>จำนวนเงิน ({ccy}) *<input name="amount" required inputMode="decimal" className={input} /></label>
        <label className={`${lbl} md:col-span-2`}>รายละเอียด<input name="description" className={input} /></label>
        <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm md:col-span-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="update_balance" checked={upd} onChange={(e) => setUpd(e.target.checked)} />
            มียอดตาม Statement ใหม่ของบัตร (ไม่บังคับ · ยอดบัตรลดเองตามที่จ่ายอยู่แล้ว)
          </label>
          {upd && <input name="new_balance" required inputMode="decimal" placeholder="ยอดคงค้างใหม่" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />}
          <p className="text-xs text-slate-500">ไม่ใช่ค่าใช้จ่าย (ค่าใช้จ่ายบันทึกตอนรูดบัตรแล้ว) · เงินฝากในพอร์ตลด · ยอดค้างบัตรลด</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending || cards.length === 0} className={btn}>{pending ? "กำลังบันทึก…" : "บันทึกการจ่ายบัตร"}</button>
        <button type="button" data-close onClick={onClose} className="text-sm text-slate-500">ปิด</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

/** ปุ่มเดียว "+ ค่าใช้จ่าย / จ่ายบัตร" (หน้าบัญชีเงินฝากในพอร์ต · ล็อกบัญชีไว้) */
export function PfPayButton({ ctx, today, minDate, fixed }: { ctx: PfPayCtx; today: string; minDate: string; fixed?: string }) {
  const { open, setOpen, present, activeCls } = useActionSlot(false, { size: "lg" });
  const [kind, setKind] = useState<"expense" | "card">("expense");
  const trigger = <button onClick={() => setOpen(!open)} className={activeCls(obtn)}>+ ค่าใช้จ่าย / จ่ายบัตร</button>;
  if (!open) return trigger;
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
  return present(trigger, (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="font-medium text-slate-900">จ่ายออกจากบัญชีเงินฝากในพอร์ต</h3>
      <div className="flex gap-2">
        <button type="button" onClick={() => setKind("expense")} className={chip(kind === "expense")}>ค่าใช้จ่าย</button>
        <button type="button" onClick={() => setKind("card")} className={chip(kind === "card")}>จ่ายบัตรเครดิต</button>
      </div>
      {kind === "expense"
        ? <PfExpenseBody ctx={ctx} today={today} minDate={minDate} fixed={fixed} onClose={() => setOpen(false)} />
        : <PfCardPayBody ctx={ctx} today={today} minDate={minDate} fixed={fixed} onClose={() => setOpen(false)} />}
    </div>
  ));
}
